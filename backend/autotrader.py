"""Server-side auto paper-trader.

Every 5 minutes in market hours it scans a universe of symbols with the same strategy vote the dashboard shows
(15-minute chart confirmed by the 5-minute chart, plus news sentiment), and for strong calls buys the ATM option
contract with virtual money. It runs on the server, so it keeps working with the browser closed.

Safety rules (all enforced in `decide`):
  * OFF until the user turns it on; it only ever touches the paper portfolio, never a broker;
  * confidence >= min_confidence (default 85);
  * Nifty 50 may be traded several times a day (nifty_max_per_day, default 10) but only ONE position at a time: the next
    Nifty order waits until the previous one has hit its target or stop;
  * every other stock at most stock_max_per_day orders a day (default 1), changeable in Settings, also per stock;
  * at most max_trades_per_day new auto orders a day for the stocks together (default 5), max_positions open at once (default 5);
  * one auto position per underlying at a time, and one order per symbol per candle;
  * entries only inside the entry window (default 09:30-14:30 IST). The product decides what happens at the close:
    CARRYFORWARD (default) stays open until its stop or target is hit (or the user exits it); INTRADAY is squared off at 15:15 IST.

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
    "nifty_max_per_day": 10,         # Nifty 50: orders a day (one open at a time)
    "stock_max_per_day": 1,          # every other underlying: orders a day each
    "product": "CARRYFORWARD",       # INTRADAY (squared off at 15:15 IST) or CARRYFORWARD (kept until stop/target)
    "nifty_qty": 130,                # Nifty options are always bought in this quantity (2 lots of 65)
    "entry_from_min": 9 * 60 + 30,   # IST minutes since midnight
    "entry_to_min": 14 * 60 + 30,
    "min_days_to_expiry": 1,         # skip contracts that expire today
    "universe": DEFAULT_UNIVERSE,
    "symbols": {},                   # per-underlying overrides, e.g. {"RELIANCE": {"sl_pct": .2, "tp_pct": .4, "lots": 2, "enabled": true}}
}

# What the user can change (Paper Trading page -> Settings). Everything else always comes from the code defaults above.
USER_KEYS = {"enabled", "min_confidence", "max_positions", "max_trades_per_day", "universe", "sl_pct", "tp_pct", "lots", "symbols",
             "nifty_max_per_day", "stock_max_per_day", "product"}
PRODUCTS = ("INTRADAY", "CARRYFORWARD")
SQUAREOFF_MIN = 15 * 60 + 15      # INTRADAY auto positions are closed from 15:15 IST
# The first version of the settings row saved the WHOLE config (including old stop/target values), so when it is migrated
# only the keys that were genuinely user choices are carried over.
LEGACY_KEYS = {"enabled", "min_confidence", "max_positions", "max_trades_per_day", "universe"}
SETTINGS_KEY, LEGACY_SETTINGS_KEY, LAST_SCAN_KEY = "autotrade_v2", "autotrade", "autotrade_last_scan"
SYMBOL_FIELDS = {"sl_pct": (0.05, 0.90), "tp_pct": (0.05, 3.00), "lots": (1, 100), "max_per_day": (1, 50)}

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


def decide(result: dict, cfg: dict, open_auto: list, now: dt.datetime, acted_on_candle: bool = False, orders_today: int = 0,
           by_und: Optional[dict] = None) -> tuple:
    """Return (take_it, reason). The first failing rule is the reason.
    `orders_today` is the number of auto orders today for stocks other than Nifty (the shared daily cap);
    `by_und` is {underlying: orders today}, for the per-underlying daily limit."""
    if not result.get("ok", False) or result.get("call") not in ("BUY CE", "BUY PE"):
        return False, result.get("note") or "no call"
    if result["confidence"] < cfg["min_confidence"]:
        return False, f"confidence {result['confidence']}% is below {cfg['min_confidence']}%"
    m = minutes(now)
    if not (cfg["entry_from_min"] <= m <= cfg["entry_to_min"]):
        return False, "outside the entry window"
    und = underlying_of(result["sym"])
    if und is None:
        return False, "no NSE option chain for this symbol"
    if und != "NIFTY" and orders_today >= cfg["max_trades_per_day"]:
        return False, f"daily limit reached ({orders_today} auto trades today, max {cfg['max_trades_per_day']})"
    if len(open_auto) >= cfg["max_positions"]:
        return False, f"already {len(open_auto)} auto positions open (max {cfg['max_positions']})"
    sp = symbol_params(cfg, und)
    if not sp["enabled"]:
        return False, f"auto-trading is switched off for {und} in Settings"
    if any(underlying_from_contract(p["symbol"]) == und for p in open_auto):
        return False, (f"Nifty already has an open position: waiting for it to hit its target or stop" if und == "NIFTY"
                       else f"{und} already has an open auto position")
    done = (by_und or {}).get(und, 0)
    if done >= sp["max_per_day"]:
        return False, f"{und} already had {done} auto order{'s' if done != 1 else ''} today (limit {sp['max_per_day']} a day, see Settings)"
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
    async def orders_today_by_und(self, day: dt.date) -> dict:
        return {}
    async def place(self, symbol: str, qty: int, price: float, sl: float, tp: float) -> tuple: raise NotImplementedError
    async def log(self, row: dict) -> None: raise NotImplementedError
    async def save_last_scan(self, scan: dict) -> None: return None


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
    by_und = dict(await store.orders_today_by_und(now.date()))
    previewed = []                      # a dry run counts what it WOULD open, so the position limit still applies
    # strongest calls first, so the position limit goes to the best ones
    for r in sorted(results, key=lambda x: (x.get("call") == "WAIT", -(x.get("confidence") or 0))):
        row = {"symbol": r["sym"], "call": r.get("call", "WAIT"), "confidence": r.get("confidence", 0),
               "candle_ts": r.get("candle_ts"), "action": "SKIP", "detail": r.get("note") or "", "position_id": None,
               "price": r.get("price"), "score": r.get("score"), "max_score": r.get("maxScore"), "adx": r.get("adx"),
               "news": r.get("news")}
        if r.get("call") in ("BUY CE", "BUY PE"):
            open_auto = await store.open_auto_positions() + previewed
            acted = bool(r.get("candle_ts")) and await store.acted_on(r["sym"], r["candle_ts"])
            others = sum(n for u, n in by_und.items() if u != "NIFTY")
            ok, why = decide(r, cfg, open_auto, now, acted, others, by_und)
            row["detail"] = ""
            if not ok:
                row["detail"] = why
            else:
                row.update(await _order(store, cfg, deps, r, now, dry))
                if row["action"] in ("ORDER", "WOULD ORDER"):
                    u = underlying_of(r["sym"]) or r["sym"]
                    by_und[u] = by_und.get(u, 0) + 1
                if row["action"] == "WOULD ORDER":
                    previewed.append({"id": -1, "symbol": row["detail"].split(" ")[0]})
            await store.log(row)
        elif not r.get("ok", True):
            row["detail"] = r.get("note", "")
            row["action"] = "ERROR"
            await store.log(row)
        decisions.append(row)
    if not dry:
        await store.save_last_scan({"at": now.timestamp(), "rows": decisions})
    return decisions


def clean_symbols(raw) -> dict:
    """Validate per-symbol overrides: keys are underlyings, values may hold sl_pct, tp_pct, lots, enabled. Anything else is dropped."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if not isinstance(v, dict):
            continue
        row = {}
        for f, (lo, hi) in SYMBOL_FIELDS.items():
            if v.get(f) is not None:
                try:
                    x = float(v[f])
                except (TypeError, ValueError):
                    continue
                if lo <= x <= hi:
                    row[f] = int(x) if f in ("lots", "max_per_day") else round(x, 4)
        if v.get("enabled") is False:
            row["enabled"] = False
        if str(v.get("product") or "").upper() in PRODUCTS:
            row["product"] = str(v["product"]).upper()
        if row:
            out[str(k).strip().upper()] = row
    return out


def symbol_params(cfg: dict, und: Optional[str]) -> dict:
    """The stop, target, lots and on/off to use for one underlying: its own override, else the global value.
    `lots` is None when neither an override nor a global rule applies (then Nifty uses its fixed quantity)."""
    ov = (cfg.get("symbols") or {}).get(und or "", {})
    default_cap = cfg.get("nifty_max_per_day", 10) if und == "NIFTY" else cfg.get("stock_max_per_day", 1)
    product = ov.get("product") or (cfg.get("product") if cfg.get("product") in PRODUCTS else "CARRYFORWARD")
    return {"sl_pct": ov.get("sl_pct", cfg["sl_pct"]), "tp_pct": ov.get("tp_pct", cfg["tp_pct"]),
            "lots": ov.get("lots"), "enabled": ov.get("enabled", True) is not False,
            "max_per_day": int(ov.get("max_per_day") or default_cap), "product": product}


def order_qty(und: str, lot: int, cfg: dict) -> int:
    """Units to buy: the symbol's own lots if set in Settings; else Nifty is always cfg['nifty_qty'] (rounded to whole lots,
    at least one); everything else is cfg['lots'] lots."""
    own = symbol_params(cfg, und)["lots"]
    if own:
        return int(own) * lot
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
    sp = symbol_params(cfg, und)
    sl, tp = round(ltp * (1 - sp["sl_pct"]), 2), round(ltp * (1 + sp["tp_pct"]), 2)
    if dry:
        return {"action": "WOULD ORDER", "detail": f"{contract['symbol']} x{qty} @ {ltp:.2f} (SL {sl}, TP {tp})"}
    try:
        pid, margin = await store.place(contract["symbol"], qty, ltp, sl, tp, "MIS" if sp["product"] == "INTRADAY" else "NRML")
    except Exception as e:
        return {"action": "SKIP", "detail": f"order refused: {getattr(e, 'detail', e)}"}
    return {"action": "ORDER", "detail": f"{contract['symbol']} x{qty} @ {ltp:.2f} (SL {sl}, TP {tp}, margin {margin:,.0f})",
            "position_id": pid}


def squareoff_due(now: dt.datetime) -> bool:
    """INTRADAY auto positions are closed from 15:15 IST on a trading day."""
    return now.weekday() < 5 and minutes(now) >= SQUAREOFF_MIN


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
        return sum((await self.orders_today_by_und(day)).values())

    async def orders_today_by_und(self, day: dt.date) -> dict:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT symbol, COUNT(*) AS n FROM autotrade_log WHERE action = 'ORDER' AND (ts AT TIME ZONE 'Asia/Kolkata')::date = $1 GROUP BY symbol", day)
        out: dict = {}
        for r in rows:
            und = underlying_of(r["symbol"]) or str(r["symbol"]).upper()
            out[und] = out.get(und, 0) + int(r["n"])
        return out

    async def acted_on(self, symbol: str, candle_ts: int) -> bool:
        async with self.pool.acquire() as conn:
            return bool(await conn.fetchval(
                "SELECT 1 FROM autotrade_log WHERE symbol = $1 AND candle_ts = $2 AND action = 'ORDER' LIMIT 1",
                symbol, candle_ts))

    async def place(self, symbol: str, qty: int, price: float, sl: float, tp: float, product: str = "NRML") -> tuple:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                return await self._open_position(conn, symbol, "LONG", qty, price, sl, tp, "MARKET", product, symbol, source="auto")

    async def save_last_scan(self, scan: dict) -> None:
        slim = [{k: v for k, v in r.items() if k != "candle_ts"} for r in scan["rows"]]
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                LAST_SCAN_KEY, json.dumps({"at": scan["at"], "rows": slim}, default=str))

    async def log(self, row: dict) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO autotrade_log (symbol, call, confidence, action, detail, position_id, candle_ts) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                row["symbol"], row["call"], int(row["confidence"] or 0), row["action"], row["detail"][:500], row.get("position_id"), row.get("candle_ts"))
            await conn.execute("DELETE FROM autotrade_log WHERE id < (SELECT COALESCE(MAX(id), 0) - 500 FROM autotrade_log)")


def merge_settings(raw: Optional[str], legacy: bool = False) -> dict:
    """Code defaults, overridden only by the user-changeable keys found in the stored JSON."""
    allowed = LEGACY_KEYS if legacy else USER_KEYS
    cfg = dict(DEFAULTS)
    if raw:
        try:
            stored = json.loads(raw)
            cfg.update({k: v for k, v in stored.items() if k in allowed})
        except (ValueError, TypeError, AttributeError):
            pass
    cfg["symbols"] = clean_symbols(cfg.get("symbols"))
    return cfg


async def _row(pool, key: str) -> Optional[str]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM app_settings WHERE key = $1", key)
    return row["value"] if row else None


async def _stored(pool) -> dict:
    """What the user has saved. Falls back to the legacy row (only its genuine user choices) until the first save."""
    raw = await _row(pool, SETTINGS_KEY)
    legacy = False
    if raw is None:
        raw, legacy = await _row(pool, LEGACY_SETTINGS_KEY), True
    try:
        data = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        data = {}
    allowed = LEGACY_KEYS if legacy else USER_KEYS
    return {k: v for k, v in data.items() if k in allowed}


async def load_settings(pool) -> dict:
    return merge_settings(json.dumps(await _stored(pool)))


async def save_settings(pool, patch: dict) -> dict:
    stored = await _stored(pool)
    stored.update({k: v for k, v in patch.items() if k in USER_KEYS})
    if "symbols" in stored:
        stored["symbols"] = clean_symbols(stored["symbols"])
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            SETTINGS_KEY, json.dumps(stored))
    return merge_settings(json.dumps(stored))


async def load_last_scan(pool) -> Optional[dict]:
    raw = await _row(pool, LAST_SCAN_KEY)
    try:
        return json.loads(raw) if raw else None
    except (ValueError, TypeError):
        return None
