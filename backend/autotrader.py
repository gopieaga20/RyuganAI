"""Server-side auto paper-trader.

Every 5 minutes in market hours it scans a universe of symbols with the same strategy vote the dashboard shows
(15-minute chart confirmed by the 5-minute chart, plus news sentiment), and for strong calls buys the ATM option
contract with virtual money. It runs on the server, so it keeps working with the browser closed.

Safety rules (all enforced in `decide`):
  * OFF until the user turns it on; it only ever touches the paper portfolio, never a broker;
  * confidence >= min_confidence (default 85);
  * at most max_trades_per_day new auto orders per day (default 5) and max_positions open at once (default 5);
  * one auto position per underlying at a time, and one order per symbol per candle;
  * entries only inside the entry window (default 09:30-14:30 IST). There is no end-of-day square-off: a position stays
    open until its stop or target is hit (or the user exits it).

Everything that touches the database or the network goes through `Deps` / `Store`, so the logic is unit-tested
without either.
"""
import asyncio
import datetime as dt
import json
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import strategy_vote as sv

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

DEFAULT_UNIVERSE = ["NIFTY 50", "BANK NIFTY", "SENSEX", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS",
                    "SBIN", "TATASTEEL", "AXISBANK", "ITC", "LT", "BHARTIARTL", "MARUTI"]

DEFAULTS = {
    "enabled": False,                # opt-in: nothing trades until the user switches it on
    "min_confidence": 85,
    "max_positions": 5,
    "max_trades_per_day": 5,         # new auto orders per IST trading day
    "sl_pct": 0.30,                  # option stop: -30% of the premium paid
    "tp_pct": 0.30,                  # option target: +30%
    "lots": 1,
    "nifty_qty": 130,                # Nifty options are always bought in this quantity (2 lots of 65)
    "entry_from_min": 9 * 60 + 30,   # IST minutes since midnight
    "entry_to_min": 14 * 60 + 30,
    "min_days_to_expiry": 1,         # skip contracts that expire today
    "universe": DEFAULT_UNIVERSE,
}

# Only these can be changed by the user (through the API); everything else always comes from the code defaults above,
# so an old saved value can never override a rule change.
USER_KEYS = {"enabled", "min_confidence", "max_positions", "max_trades_per_day", "universe"}

LTP_TRIES = 3
LTP_RETRY_SLEEP = 1.5

_BULLISH = ["rally", "rise", "gain", "surge", "strong", "buy", "profit", "upgrade", "record", "beat", "growth",
            "positive", "expansion", "bullish", "outperform", "breakout", "momentum", "inflow", "rebound",
            "recovery", "optimism"]
_BEARISH = ["crash", "fall", "drop", "decline", "sell-off", "selloff", "weak", "loss", "ban", "penalty", "raid",
            "inflation", "rate hike", "recession", "downgrade", "slump", "plunge", "tanking", "bloodbath",
            "warning", "default", "fear", "concern", "risk", "uncertainty", "profit booking"]


# ───────────── pure helpers ─────────────
def now_ist(ts: Optional[float] = None) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, IST) if ts is not None else dt.datetime.now(IST)


def minutes(now: dt.datetime) -> int:
    return now.hour * 60 + now.minute


def market_open(now: dt.datetime) -> bool:
    return now.weekday() < 5 and 9 * 60 + 15 <= minutes(now) < 15 * 60 + 30


def underlying_of(symbol: str) -> Optional[str]:
    """Underlying whose NSE option chain to use, or None when there is none (Sensex options trade on BSE)."""
    s = re.sub(r"\.NS$", "", symbol.upper().strip())
    if s in ("NIFTY 50", "NIFTY", "^NSEI"):
        return "NIFTY"
    if s in ("BANK NIFTY", "BANKNIFTY", "^NSEBANK"):
        return "BANKNIFTY"
    if s in ("SENSEX", "^BSESN"):
        return None
    return re.sub(r"\s+", "", s)


def underlying_from_contract(contract_symbol: str) -> Optional[str]:
    m = re.match(r"^(.+?)\d{2}[A-Z]{3}\d{2}\d+(CE|PE)$", contract_symbol.upper())
    return m.group(1) if m else None


def news_label(headlines: list) -> Optional[str]:
    """Same keyword scoring as the dashboard's NewsFilter; None when there are no headlines."""
    if not headlines:
        return None
    bull = bear = 0
    for h in headlines:
        t = (h.get("title") or "").lower()
        if any(k in t for k in _BULLISH):
            bull += 1
        if any(k in t for k in _BEARISH):
            bear += 1
    score = (bull - bear) / max(bull + bear, 1)
    return "BULLISH" if score > 0.2 else "BEARISH" if score < -0.2 else "NEUTRAL"


def payload_to_candles(payload: dict) -> list:
    """Yahoo-shaped chart JSON -> candle dicts, dropping rows with missing prices."""
    r = ((payload or {}).get("chart") or {}).get("result") or []
    if not r or not r[0].get("timestamp"):
        return []
    q = ((r[0].get("indicators") or {}).get("quote") or [{}])[0]
    opens, highs, lows, closes, vols = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))
    out = []
    for i, t in enumerate(r[0]["timestamp"]):
        try:
            o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        except IndexError:
            continue
        if None in (o, h, l, c):
            continue
        v = (vols[i] if i < len(vols) else 0) or 0
        out.append({"ts": t * 1000, "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def pick_contract(contracts: list, spot: float, today: dt.date, opt_type: str, min_days: int = 1) -> Optional[dict]:
    """Nearest expiry that is at least `min_days` away, then the strike closest to the spot price."""
    best_exp, pool = None, []
    for c in contracts:
        if c.get("type") != opt_type:
            continue
        try:
            exp = dt.datetime.strptime(c["expiry"], "%d%b%Y").date()
        except (KeyError, ValueError):
            continue
        if (exp - today).days < min_days:
            continue
        if best_exp is None or exp < best_exp:
            best_exp, pool = exp, [c]
        elif exp == best_exp:
            pool.append(c)
    if not pool:
        return None
    return min(pool, key=lambda c: (abs(c["strike"] - spot), c["strike"]))


def decide(result: dict, cfg: dict, open_auto: list, now: dt.datetime, acted_on_candle: bool = False, orders_today: int = 0) -> tuple:
    """Return (take_it, reason). The first failing rule is the reason."""
    if not result.get("ok", False) or result.get("call") not in ("BUY CE", "BUY PE"):
        return False, result.get("note") or "no call"
    if result["confidence"] < cfg["min_confidence"]:
        return False, f"confidence {result['confidence']}% is below {cfg['min_confidence']}%"
    m = minutes(now)
    if not (cfg["entry_from_min"] <= m <= cfg["entry_to_min"]):
        return False, "outside the entry window"
    if orders_today >= cfg["max_trades_per_day"]:
        return False, f"daily limit reached ({orders_today} auto trades today, max {cfg['max_trades_per_day']})"
    if len(open_auto) >= cfg["max_positions"]:
        return False, f"already {len(open_auto)} auto positions open (max {cfg['max_positions']})"
    und = underlying_of(result["sym"])
    if und is None:
        return False, "no NSE option chain for this symbol"
    if any(underlying_from_contract(p["symbol"]) == und for p in open_auto):
        return False, f"{und} already has an open auto position"
    if acted_on_candle:
        return False, "already acted on this candle"
    return True, "ok"


# ───────────── plumbing (injected, so tests need no DB or network) ─────────────
@dataclass
class Deps:
    fetch_candles: Callable[[str, str, str], Awaitable[list]]      # (symbol, interval, range) -> candles
    fetch_headlines: Callable[[str], Awaitable[list]]              # underlying/news key -> headlines
    get_contracts: Callable[[str], list]                           # underlying -> option contracts
    get_lot_size: Callable[[str], Optional[int]]
    fetch_ltp: Callable[[str], Awaitable[Optional[float]]]


class Store:
    """Database access used by the cycle; PgStore implements it, tests use an in-memory version."""
    async def open_auto_positions(self) -> list: raise NotImplementedError
    async def acted_on(self, symbol: str, candle_ts: int) -> bool: raise NotImplementedError
    async def orders_today(self, day: dt.date) -> int: raise NotImplementedError
    async def place(self, symbol: str, qty: int, price: float, sl: float, tp: float) -> tuple: raise NotImplementedError
    async def log(self, row: dict) -> None: raise NotImplementedError


async def scan_symbol(sym: str, deps: Deps) -> dict:
    key = underlying_of(sym) or re.sub(r"\s+", "", sym.upper())
    try:
        c15, c5, heads = await asyncio.gather(
            deps.fetch_candles(sym, "15m", "5d"), deps.fetch_candles(sym, "5m", "5d"),
            deps.fetch_headlines(key), return_exceptions=True)
        if isinstance(c15, Exception) or len(c15) < 60:
            return {"sym": sym, "ok": False, "call": "WAIT", "confidence": 0,
                    "note": f"no usable 15m data ({c15 if isinstance(c15, Exception) else len(c15)})"}
        label = news_label(heads) if not isinstance(heads, Exception) else None
        r15 = sv.evaluate(c15, intraday=True, news_label=label)
        r5 = sv.evaluate(c5, intraday=True) if not isinstance(c5, Exception) and len(c5) >= 60 else None
        fin = sv.combine(r15, r5)
        fin["sym"] = sym
        fin["candle_ts"] = c15[-1]["ts"]
        fin["news"] = label
        return fin
    except Exception as e:                      # one bad symbol must never stop the cycle
        return {"sym": sym, "ok": False, "call": "WAIT", "confidence": 0, "note": f"scan error: {e}"}


async def run_cycle(store: Store, cfg: dict, deps: Deps, now: Optional[dt.datetime] = None, dry: bool = False) -> list:
    """One scan of the universe. Returns the decisions made (also written to the log)."""
    now = now or now_ist()
    sem = asyncio.Semaphore(4)

    async def one(s):
        async with sem:
            return await scan_symbol(s, deps)

    results = await asyncio.gather(*(one(s) for s in cfg["universe"]))
    decisions = []
    placed_today = await store.orders_today(now.date())
    previewed = []                      # a dry run counts what it WOULD open, so the position limit still applies
    # strongest calls first, so the position limit goes to the best ones
    for r in sorted(results, key=lambda x: (x.get("call") == "WAIT", -(x.get("confidence") or 0))):
        row = {"symbol": r["sym"], "call": r.get("call", "WAIT"), "confidence": r.get("confidence", 0),
               "candle_ts": r.get("candle_ts"), "action": "SKIP", "detail": "", "position_id": None}
        if r.get("call") in ("BUY CE", "BUY PE"):
            open_auto = await store.open_auto_positions() + previewed
            acted = bool(r.get("candle_ts")) and await store.acted_on(r["sym"], r["candle_ts"])
            ok, why = decide(r, cfg, open_auto, now, acted, placed_today)
            if not ok:
                row["detail"] = why
            else:
                row.update(await _order(store, cfg, deps, r, now, dry))
                if row["action"] in ("ORDER", "WOULD ORDER"):
                    placed_today += 1
                if row["action"] == "WOULD ORDER":
                    previewed.append({"id": -1, "symbol": row["detail"].split(" ")[0]})
            await store.log(row)
        elif not r.get("ok", True):
            row["detail"] = r.get("note", "")
            row["action"] = "ERROR"
            await store.log(row)
        decisions.append(row)
    return decisions


def order_qty(und: str, lot: int, cfg: dict) -> int:
    """Units to buy: Nifty is always cfg['nifty_qty'] (rounded to whole lots, at least one); everything else is cfg['lots'] lots."""
    if und == "NIFTY" and cfg.get("nifty_qty"):
        return max(1, round(cfg["nifty_qty"] / lot)) * lot
    return lot * cfg["lots"]


async def _order(store: Store, cfg: dict, deps: Deps, r: dict, now: dt.datetime, dry: bool) -> dict:
    und = underlying_of(r["sym"])
    opt_type = "CE" if r["call"] == "BUY CE" else "PE"
    contract = pick_contract(deps.get_contracts(und), r["price"], now.date(), opt_type, cfg["min_days_to_expiry"])
    if not contract:
        return {"action": "SKIP", "detail": "no suitable option contract (contract list still loading?)"}
    lot = deps.get_lot_size(und)
    if not lot:
        return {"action": "SKIP", "detail": f"no lot size for {und}"}
    ltp = None
    for attempt in range(LTP_TRIES):                       # Angel quotes are occasionally empty or throttled: retry briefly
        ltp = await deps.fetch_ltp(contract["symbol"])
        if ltp and ltp > 0:
            break
        if attempt < LTP_TRIES - 1:
            await asyncio.sleep(LTP_RETRY_SLEEP)
    if not ltp or ltp <= 0:
        return {"action": "SKIP", "detail": f"no live price for {contract['symbol']}"}
    qty = order_qty(und, lot, cfg)
    sl, tp = round(ltp * (1 - cfg["sl_pct"]), 2), round(ltp * (1 + cfg["tp_pct"]), 2)
    if dry:
        return {"action": "WOULD ORDER", "detail": f"{contract['symbol']} x{qty} @ {ltp:.2f} (SL {sl}, TP {tp})"}
    try:
        pid, margin = await store.place(contract["symbol"], qty, ltp, sl, tp)
    except Exception as e:
        return {"action": "SKIP", "detail": f"order refused: {getattr(e, 'detail', e)}"}
    return {"action": "ORDER", "detail": f"{contract['symbol']} x{qty} @ {ltp:.2f} (SL {sl}, TP {tp}, margin {margin:,.0f})",
            "position_id": pid}


def seconds_to_next_run(now_ts: float, every: int = 300, settle: int = 8) -> float:
    """Seconds until the next 5-minute boundary (plus a few seconds for the candle to settle)."""
    nxt = (int(now_ts) // every + 1) * every + settle
    return nxt - now_ts


# ───────────── PostgreSQL store ─────────────
class PgStore(Store):
    def __init__(self, pool, open_position):
        self.pool = pool
        self._open_position = open_position       # main._open_position

    async def open_auto_positions(self) -> list:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("SELECT id, symbol FROM positions WHERE source = 'auto'")
        return [dict(r) for r in rows]

    async def orders_today(self, day: dt.date) -> int:
        async with self.pool.acquire() as conn:
            return int(await conn.fetchval(
                "SELECT COUNT(*) FROM autotrade_log WHERE action = 'ORDER' AND (ts AT TIME ZONE 'Asia/Kolkata')::date = $1", day))

    async def acted_on(self, symbol: str, candle_ts: int) -> bool:
        async with self.pool.acquire() as conn:
            return bool(await conn.fetchval(
                "SELECT 1 FROM autotrade_log WHERE symbol = $1 AND candle_ts = $2 AND action = 'ORDER' LIMIT 1",
                symbol, candle_ts))

    async def place(self, symbol: str, qty: int, price: float, sl: float, tp: float) -> tuple:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                return await self._open_position(conn, symbol, "LONG", qty, price, sl, tp, "MARKET", "MIS", symbol, source="auto")

    async def log(self, row: dict) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO autotrade_log (symbol, call, confidence, action, detail, position_id, candle_ts) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                row["symbol"], row["call"], int(row["confidence"] or 0), row["action"], row["detail"][:500], row.get("position_id"), row.get("candle_ts"))
            await conn.execute("DELETE FROM autotrade_log WHERE id < (SELECT COALESCE(MAX(id), 0) - 500 FROM autotrade_log)")


def merge_settings(raw: Optional[str]) -> dict:
    """Code defaults, overridden only by the user-changeable keys found in the stored JSON."""
    cfg = dict(DEFAULTS)
    if raw:
        try:
            stored = json.loads(raw)
            cfg.update({k: v for k, v in stored.items() if k in USER_KEYS})
        except (ValueError, TypeError, AttributeError):
            pass
    return cfg


async def _stored(pool) -> Optional[str]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM app_settings WHERE key = 'autotrade'")
    return row["value"] if row else None


async def load_settings(pool) -> dict:
    return merge_settings(await _stored(pool))


async def save_settings(pool, patch: dict) -> dict:
    try:
        stored = {k: v for k, v in json.loads(await _stored(pool) or "{}").items() if k in USER_KEYS}
    except (ValueError, TypeError, AttributeError):
        stored = {}
    stored.update({k: v for k, v in patch.items() if k in USER_KEYS})
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('autotrade', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            json.dumps(stored))
    return merge_settings(json.dumps(stored))
