"""Techno-Funda screener: storage, the nightly pipeline, settings and the /api/screener endpoints.

Pipeline (blueprint section 1): hygiene gate -> fundamental gate/score (screener_fund) -> technical gate/score (screener_tech) -> 0-100 score -> trade setups -> feed.
`build_rows()` is pure (all inputs passed in) so the whole pipeline is testable without a network; `run_screen()` does the I/O around it.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import auth
import delivery
import week52
import screener_data as sdata
import screener_fund as sfund
import screener_tech as stech

router = APIRouter(prefix="/api/screener")
SETTINGS_KEY = "screener_settings"
DEFAULTS = {
    "min_score": 75,              # feed threshold (blueprint)
    "risk_pct": 1.0,              # % of capital risked per setup
    "max_pct_per_position": 20.0,
    "max_stop_pct": 8.0,          # a setup whose stop is further than this below the entry is dropped
    "min_turnover_cr": 10.0,      # average 20-day traded value, Rs crore
    "min_mcap_cr": 5000.0,        # market cap, Rs crore (unknown = not excluded)
    "fundamentals_max_age_days": 7,
    "auto_delivery": False,       # nightly: paper-trade the top setups by itself
    "max_delivery_positions": 5,
    "intraday_feed": False,       # nightly: replace the intraday scan list
    "intraday_feed_size": 10,
    "w52_break_pts": 20.0,        # 52-week lists: a close up to this many rupees beyond the 52-week high / low
    "w52_near_pts": 30.0,         # ... or up to this many rupees short of it
}
RUN_HOUR_IST, RUN_MINUTE_IST = 18, 30
CANDLE_GAP_S = 3.0
BENCH = "^NSEI"
state: dict = {"running": False, "phase": "", "done": 0, "total": 0, "started": None, "error": None, "last_run": None,
               "fund_running": False, "fund_done": 0, "fund_total": 0, "fund_errors": 0}
PREV_UNIVERSE_KEY = "screener.prev_universe"
INDEX_SCAN = ["NIFTY 50", "BANK NIFTY"]
UNIVERSE_CAP = 60                          # autotrader scans at most this many


# ───────────── storage ─────────────
async def ensure_schema(conn) -> None:
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_candles (
            symbol TEXT NOT NULL, d DATE NOT NULL,
            o DOUBLE PRECISION NOT NULL, h DOUBLE PRECISION NOT NULL, l DOUBLE PRECISION NOT NULL, c DOUBLE PRECISION NOT NULL,
            v BIGINT NOT NULL DEFAULT 0, deliv_per DOUBLE PRECISION,
            PRIMARY KEY (symbol, d)
        )""")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS fundamentals (
            symbol TEXT PRIMARY KEY, data JSONB NOT NULL, source TEXT NOT NULL DEFAULT 'yfinance',
            fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS screener_runs (
            id SERIAL PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            universe_n INT NOT NULL DEFAULT 0, rows JSONB NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb
        )""")


async def get_settings(pool) -> dict:
    raw = await auth.get_setting(pool, SETTINGS_KEY, "")
    try:
        saved = json.loads(raw) if raw else {}
    except ValueError:
        saved = {}
    return {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}


def clean_settings(patch: dict, current: dict) -> dict:
    """Validate a settings patch against the defaults' types and sane ranges; unknown keys are dropped."""
    out = dict(current)
    ranges = {"min_score": (0, 100), "risk_pct": (0.05, 5), "max_pct_per_position": (1, 50), "max_stop_pct": (1, 30), "min_turnover_cr": (0, 10000), "min_mcap_cr": (0, 10 ** 7),
              "fundamentals_max_age_days": (1, 60), "max_delivery_positions": (1, 20), "intraday_feed_size": (1, 40), "w52_break_pts": (0.5, 5000), "w52_near_pts": (0.5, 5000)}
    for k, v in patch.items():
        if k not in DEFAULTS or v is None:
            continue
        if isinstance(DEFAULTS[k], bool):
            out[k] = bool(v)
        elif k in ranges:
            lo, hi = ranges[k]
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            out[k] = int(min(max(f, lo), hi)) if isinstance(DEFAULTS[k], int) else round(min(max(f, lo), hi), 2)
    return out


# ───────────── the pure pipeline ─────────────
def _bench_aligned(candles: list, bench_by_date: dict) -> list:
    """Benchmark closes aligned bar for bar with a stock's candles (carrying the last known close over a missing day)."""
    out, last = [], 0.0
    for c in candles:
        d = dt.datetime.fromtimestamp(c["ts"] / 1000, dt.timezone.utc).date().isoformat()
        last = bench_by_date.get(d, last)
        out.append(last)
    return out


def build_rows(universe: dict, bench: list, fundamentals: dict, bhav: dict, flags: dict, settings: dict, capital: float,
               today: Optional[dt.date] = None) -> list:
    """`universe` {symbol: {"candles": [...], "bucket": "CORPORATE"|"FINANCIALS", "industry": str}}, `bench` benchmark candles, `fundamentals` {symbol: raw row},
    `bhav` {symbol: {deliv_per, ...}} for the newest session, `flags` {"asm": set|None, "gsm": set|None, "ban": set|None}.
    Returns rows sorted by score (best first): one per symbol with enough history that passes the hygiene gate; rows failing hygiene are returned too with `hygiene.ok` False."""
    today = today or dt.date.today()
    bench_by_date = {dt.datetime.fromtimestamp(c["ts"] / 1000, dt.timezone.utc).date().isoformat(): c["c"] for c in bench}
    prep, rel = {}, {}
    for sym, u in universe.items():
        cs = u["candles"]
        if len(cs) < stech.MIN_BARS:
            continue
        if sym in bhav and bhav[sym].get("deliv_per") is not None and not cs[-1].get("deliv_per"):
            cs = cs[:-1] + [{**cs[-1], "deliv_per": bhav[sym]["deliv_per"]}]
        ind = stech.indicators(cs)
        i = len(cs) - 1
        prep[sym] = (cs, ind, i)
        rel[sym] = stech.relative_performance([c["c"] for c in cs], _bench_aligned(cs, bench_by_date), i) if bench_by_date else None
    rs = stech.rs_ratings(rel)
    rows = []
    for sym, (cs, ind, i) in prep.items():
        u, c = universe[sym], cs[i]
        raw = fundamentals.get(sym)
        info = (raw or {}).get("info") or {}
        turnover_cr = sum(x["c"] * (x.get("v") or 0) for x in cs[-20:]) / 20 / 1e7
        mcap_cr = info.get("market_cap") / 1e7 if info.get("market_cap") else None
        asm, gsm, ban = flags.get("asm"), flags.get("gsm"), flags.get("ban")
        hyg = {"turnover_cr": round(turnover_cr, 1), "mcap_cr": round(mcap_cr, 0) if mcap_cr else None,
               "asm": (sym in asm) if asm is not None else None, "gsm": (sym in gsm) if gsm is not None else None, "ban": (sym in ban) if ban is not None else None}
        hyg["ok"] = bool(turnover_cr >= settings["min_turnover_cr"] and (mcap_cr is None or mcap_cr >= settings["min_mcap_cr"])
                         and not hyg["asm"] and not hyg["gsm"] and not hyg["ban"])
        hyg["unchecked"] = [k for k in ("asm", "gsm", "ban") if hyg[k] is None] + (["mcap"] if mcap_cr is None else [])
        bucket = u.get("bucket") or "CORPORATE"
        metrics = sfund.compute_metrics(raw, today) if raw else None
        fscore = sfund.fundamental_score(metrics, bucket) if metrics else {"score": 0.0, "coverage": 0.0, "ok_to_feed": False, "parts": {}, "available": 0, "earned": 0}
        fgate = sfund.fundamental_gate(metrics, bucket) if metrics else {"pass": False, "failed": [], "unchecked": ["no fundamentals yet"]}
        rr = rs.get(sym)
        tgate = stech.technical_gate(cs, ind, i, rr)
        brk = stech.base_breakout(cs, ind, i)
        tscore = stech.technical_score(cs, ind, i, rr, brk)
        cap = settings.get("max_stop_pct")
        setup = stech.breakout_setup(cs, ind, i, brk, cap) or stech.pullback_setup(cs, ind, i, cap)
        if setup:
            setup = {**setup, "qty": stech.position_size(capital, settings["risk_pct"], setup["entry"], setup["stop"], settings["max_pct_per_position"]),
                     "invalidation": f"Daily close below {setup['stop']:.2f}"}
            for k in ("entry", "stop", "t1", "t2", "risk"):
                setup[k] = round(setup[k], 2)
        total = round(fscore["score"] + tscore["score"], 1)
        feed = bool(hyg["ok"] and tgate["pass"] and fscore["ok_to_feed"] and fgate["pass"] and total >= settings["min_score"])
        rows.append({
            "symbol": sym, "bucket": bucket, "industry": u.get("industry") or "", "close": round(c["c"], 2), "asof": dt.datetime.fromtimestamp(c["ts"] / 1000, dt.timezone.utc).date().isoformat(),
            "score": total, "fund_score": fscore["score"], "tech_score": tscore["score"], "coverage": fscore["coverage"], "rs": rr, "rsi": round(ind["rsi"][i], 1),
            "near_high_pct": tgate["near_high_pct"], "ema20": round(ind["ema20"][i], 2), "vol_ratio": round(c["v"] / ind["vol_sma"][i], 2) if ind["vol_sma"][i] and ind["vol_sma"][i] == ind["vol_sma"][i] and ind["vol_sma"][i] > 0 else None,
            "deliv_per": c.get("deliv_per"), "hygiene": hyg, "tech_gate": tgate, "fund_gate": fgate, "fund_parts": fscore["parts"], "tech_parts": tscore["parts"],
            "metrics": metrics, "fund_stale": bool(metrics and metrics.get("stale")), "has_fundamentals": raw is not None, "setup": setup, "feed": feed,
        })
    rows.sort(key=lambda r: (not r["feed"], -r["score"], r["symbol"]))
    return rows


def summarise(rows: list, settings: dict) -> dict:
    ok = [r for r in rows if r["hygiene"]["ok"]]
    return {"universe": len(rows), "hygiene_ok": len(ok), "with_fundamentals": sum(1 for r in ok if r["has_fundamentals"] and not r["fund_stale"]),
            "tech_pass": sum(1 for r in ok if r["tech_gate"]["pass"]), "feed": sum(1 for r in rows if r["feed"]),
            "with_setup": sum(1 for r in rows if r["feed"] and r["setup"]), "min_score": settings["min_score"]}


# ───────────── I/O around the pipeline ─────────────
async def load_candles(pool, symbols: list) -> dict:
    async with pool.acquire() as conn:
        recs = await conn.fetch("SELECT symbol, d, o, h, l, c, v, deliv_per FROM daily_candles WHERE symbol = ANY($1::text[]) AND d >= CURRENT_DATE - 520 ORDER BY symbol, d", symbols)
    by: dict = {}
    for r in recs:
        by.setdefault(r["symbol"], []).append((r["d"], r["o"], r["h"], r["l"], r["c"], r["v"], r["deliv_per"]))
    return {s: sdata.rows_to_candles(v) for s, v in by.items()}


async def ingest_candles(pool, symbols: list, today: dt.date) -> int:
    """Incremental daily candles from Angel (about 3 s per symbol). A symbol that fails is skipped (it keeps what is stored); returns the number fetched."""
    import angel_broker
    async with pool.acquire() as conn:
        last = {r["symbol"]: r["d"].isoformat() for r in await conn.fetch("SELECT symbol, MAX(d) AS d FROM daily_candles GROUP BY symbol")}
    n = 0
    for k, sym in enumerate(symbols):
        state.update(done=k, total=len(symbols))
        days = sdata.days_to_fetch(last.get(sym), today)
        if days == 0:
            continue
        if n:
            await asyncio.sleep(CANDLE_GAP_S)
        raw = await asyncio.to_thread(angel_broker.get_historical, f"{sym}.NS" if not sym.startswith("^") else sym, "1d", days)
        rows = sdata.angel_to_rows(raw or [])
        if rows:
            async with pool.acquire() as conn:
                await conn.executemany(
                    "INSERT INTO daily_candles (symbol, d, o, h, l, c, v) VALUES ($1, $2, $3, $4, $5, $6, $7) "
                    "ON CONFLICT (symbol, d) DO UPDATE SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v",
                    [(sym, dt.date.fromisoformat(r[0]), *r[1:]) for r in rows])
            n += 1
    state.update(done=len(symbols), total=len(symbols))
    return n


async def store_delivery(pool, bhav_date, bhav: dict) -> None:
    if not bhav_date or not bhav:
        return
    recs = [(s, bhav_date, v["deliv_per"]) for s, v in bhav.items() if v.get("deliv_per") is not None]
    async with pool.acquire() as conn:
        await conn.executemany("UPDATE daily_candles SET deliv_per = $3 WHERE symbol = $1 AND d = $2", recs)


async def load_fundamentals(pool) -> tuple:
    async with pool.acquire() as conn:
        recs = await conn.fetch("SELECT symbol, data, fetched_at FROM fundamentals")
    data, fetched = {}, {}
    for r in recs:
        data[r["symbol"]] = json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]
        fetched[r["symbol"]] = r["fetched_at"]
    return data, fetched


def stale_symbols(symbols: list, fetched: dict, max_age_days: int, now: Optional[dt.datetime] = None, limit: Optional[int] = None) -> list:
    """Symbols with no row or a row older than `max_age_days`, never-fetched first then oldest first, at most `limit`."""
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=max_age_days)
    old = [s for s in symbols if s not in fetched or fetched[s] < cutoff]
    old.sort(key=lambda s: (s in fetched, fetched.get(s) or now))
    return old[:limit] if limit else old


async def refresh_fundamentals(pool, symbols: list) -> int:
    """Paced Yahoo refresh of the given symbols; each row is saved as it arrives. Returns how many were stored."""
    state.update(fund_running=True, fund_done=0, fund_total=len(symbols), fund_errors=0)
    stored = 0
    try:
        for s in symbols:
            raw = await asyncio.to_thread(sfund.refresh_many, [s], sfund.fetch_fundamentals, time.sleep, 0, (10, 30, 60))
            raw = raw.get(s)
            if raw:
                async with pool.acquire() as conn:
                    await conn.execute("INSERT INTO fundamentals (symbol, data, source, fetched_at) VALUES ($1, $2::jsonb, 'yfinance', NOW()) "
                                       "ON CONFLICT (symbol) DO UPDATE SET data = EXCLUDED.data, source = EXCLUDED.source, fetched_at = NOW()", s, json.dumps(raw))
                stored += 1
            else:
                state["fund_errors"] += 1
            state["fund_done"] += 1
            await asyncio.sleep(2.0)
    finally:
        state["fund_running"] = False
    return stored


async def fo_stock_symbols() -> list:
    from nse_client import get_fo_underlyings
    return sorted({u["symbol"].upper() for u in await get_fo_underlyings() if u.get("type") == "STOCK"})


async def run_screen(pool, force_ingest: bool = True) -> dict:
    """The whole nightly job. Safe to call twice: a second call while one is running returns immediately."""
    if state["running"]:
        return {"started": False, "reason": "already running"}
    state.update(running=True, phase="universe", done=0, total=0, started=time.time(), error=None)
    try:
        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
        settings = await get_settings(pool)
        symbols = await fo_stock_symbols()
        if not symbols:
            async with pool.acquire() as conn:
                symbols = [r["symbol"] for r in await conn.fetch("SELECT DISTINCT symbol FROM daily_candles WHERE symbol NOT LIKE '^%'")]
        if not symbols:
            raise RuntimeError("No F&O stock list (NSE unreachable and nothing stored yet)")
        state["phase"] = "NSE files"
        (bhav_date, bhav), industry = await asyncio.gather(asyncio.to_thread(sdata.latest_bhavcopy, today), asyncio.to_thread(sdata.fetch_nifty500))
        surv = await asyncio.to_thread(sdata.fetch_surveillance)
        ban = await asyncio.to_thread(sdata.fetch_ban_list, bhav_date) if bhav_date else None
        if force_ingest:
            state["phase"] = "daily candles"
            await ingest_candles(pool, symbols + [BENCH, "^NSEBANK"], today)      # Bank Nifty: for the pre-market report's levels
        await store_delivery(pool, bhav_date, bhav)
        state["phase"] = "fundamentals"
        fdata, fetched = await load_fundamentals(pool)
        due = stale_symbols(symbols, fetched, settings["fundamentals_max_age_days"], limit=30)       # about a week's turnover per night
        if due:
            await refresh_fundamentals(pool, due)
            fdata, fetched = await load_fundamentals(pool)
        state["phase"] = "scoring"
        cmap = await load_candles(pool, symbols + [BENCH])
        universe = {s: {"candles": cmap[s], "bucket": (industry.get(s) or {}).get("bucket", "CORPORATE"), "industry": (industry.get(s) or {}).get("industry", "")}
                    for s in symbols if s in cmap}
        async with pool.acquire() as conn:
            capital = float(await conn.fetchval("SELECT capital FROM portfolio WHERE id = 1") or 1_000_000)
        rows = await asyncio.to_thread(build_rows, universe, cmap.get(BENCH, []), fdata, bhav, {"asm": surv.get("asm"), "gsm": surv.get("gsm"), "ban": ban}, settings, capital, today)
        meta = {"summary": summarise(rows, settings), "bhav_date": bhav_date.isoformat() if bhav_date else None, "industry_map": bool(industry),
                "asm_checked": surv.get("asm") is not None, "gsm_checked": surv.get("gsm") is not None, "ban_checked": ban is not None, "capital": capital}
        async with pool.acquire() as conn:
            await conn.execute("INSERT INTO screener_runs (universe_n, rows, meta) VALUES ($1, $2::jsonb, $3::jsonb)", len(rows), json.dumps(rows), json.dumps(meta))
            await conn.execute("DELETE FROM screener_runs WHERE id NOT IN (SELECT id FROM screener_runs ORDER BY id DESC LIMIT 7)")
        state.update(last_run=time.time())
        state["phase"] = "follow-up"
        meta["follow_up"] = await follow_up(pool, rows, settings)
        async with pool.acquire() as conn:
            await conn.execute("UPDATE screener_runs SET meta = $1::jsonb WHERE id = (SELECT MAX(id) FROM screener_runs)", json.dumps(meta, default=str))
        return {"started": True, **meta}
    except Exception as e:
        state["error"] = str(e)
        print(f"[WARN] screener run failed: {e}")
        return {"started": True, "error": str(e)}
    finally:
        state.update(running=False, phase="")


async def latest_run(pool) -> Optional[dict]:
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT id, ran_at, rows, meta FROM screener_runs ORDER BY id DESC LIMIT 1")
    if not r:
        return None
    rows = json.loads(r["rows"]) if isinstance(r["rows"], str) else r["rows"]
    meta = json.loads(r["meta"]) if isinstance(r["meta"], str) else r["meta"]
    return {"id": r["id"], "ran_at": r["ran_at"].isoformat(), "rows": rows, "meta": meta}


# ───────────── follow-up of a run: delivery orders, intraday scan list, Telegram ─────────────
def feed_universe(rows: list, size: int) -> list:
    """The intraday scan list: Nifty 50 and Bank Nifty, then the best `size` feed stocks (best score first), capped at what the scanner takes."""
    top = [r["symbol"] for r in rows if r["feed"]][:max(size, 0)]
    return (INDEX_SCAN + [s for s in top if s not in INDEX_SCAN])[:UNIVERSE_CAP]


async def apply_intraday_feed(pool, rows: list, size: int) -> list:
    """Replace the auto-trader's scan list with the screened one. The list in use before is saved once (never overwritten by a later night), so Restore brings back the owner's own."""
    import autotrader
    cur = await autotrader.load_settings(pool)
    if not await auth.get_setting(pool, PREV_UNIVERSE_KEY, ""):
        await auth.set_setting(pool, PREV_UNIVERSE_KEY, json.dumps(cur["universe"]))
    new = feed_universe(rows, size)
    await autotrader.save_settings(pool, {"universe": new})
    return new


async def restore_universe(pool) -> Optional[list]:
    import autotrader
    raw = await auth.get_setting(pool, PREV_UNIVERSE_KEY, "")
    try:
        prev = json.loads(raw) if raw else None
    except ValueError:
        prev = None
    if not prev:
        return None
    await autotrader.save_settings(pool, {"universe": prev})
    await auth.set_setting(pool, PREV_UNIVERSE_KEY, "")
    return prev


def summary_text(rows: list, settings: dict) -> str:
    feed = [r for r in rows if r["feed"]]
    lines = [f"SCREENER: {len(feed)} stock(s) at {settings['min_score']}+ today"]
    for r in feed[:5]:
        s = r.get("setup")
        lines.append(f"{r['symbol']} {r['score']:.0f}" + (f" · {s['type'].lower()} entry {s['entry']} stop {s['stop']} T1 {s['t1']} T2 {s['t2']}" if s else " · no setup today"))
    lines.append("A shortlist to study, not a recommendation. The technical rules showed no proven edge in backtests.")
    return "\n".join(lines)


async def follow_up(pool, rows: list, settings: dict) -> dict:
    """Everything after the ranking is stored. Each step is independent: one failing never stops the others."""
    import notify
    out: dict = {}
    try:
        out["delivery"] = await delivery.after_run(pool, rows, settings)
    except Exception as e:
        out["delivery"] = {"error": str(e)}
        print(f"[WARN] screener delivery step failed: {e}")
    if settings.get("intraday_feed"):
        try:
            out["intraday_feed"] = await apply_intraday_feed(pool, rows, settings["intraday_feed_size"])
        except Exception as e:
            out["intraday_feed"] = {"error": str(e)}
            print(f"[WARN] screener intraday feed failed: {e}")
    try:
        await notify.notify(pool, "screener", summary_text(rows, settings), key=f"screener:{dt.date.today().isoformat()}")
    except Exception as e:
        print(f"[WARN] screener summary not sent: {e}")
    return out


# ───────────── nightly loop ─────────────
def seconds_to_next_night_run(now_ist: dt.datetime) -> float:
    """Seconds until the next weekday 18:30 IST."""
    t = now_ist.replace(hour=RUN_HOUR_IST, minute=RUN_MINUTE_IST, second=0, microsecond=0)
    if now_ist >= t:
        t += dt.timedelta(days=1)
    while t.weekday() >= 5:
        t += dt.timedelta(days=1)
    return (t - now_ist).total_seconds()


async def screener_loop(pool) -> None:
    import autotrader
    while True:
        try:
            await asyncio.sleep(seconds_to_next_night_run(autotrader.now_ist()))
            await run_screen(pool)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[WARN] screener loop: {e}")
            await asyncio.sleep(600)


# ───────────── endpoints ─────────────
def _pool(request: Request):
    return request.app.state.pool


class SettingsPatch(BaseModel):
    min_score: Optional[float] = None
    risk_pct: Optional[float] = None
    max_pct_per_position: Optional[float] = None
    max_stop_pct: Optional[float] = None
    min_turnover_cr: Optional[float] = None
    min_mcap_cr: Optional[float] = None
    fundamentals_max_age_days: Optional[int] = None
    auto_delivery: Optional[bool] = None
    max_delivery_positions: Optional[int] = None
    intraday_feed: Optional[bool] = None
    intraday_feed_size: Optional[int] = None
    w52_break_pts: Optional[float] = None
    w52_near_pts: Optional[float] = None


async def week52_lists(pool, settings: Optional[dict] = None) -> dict:
    """The four 52-week lists from the stored daily candles of the F&O stocks (no network)."""
    settings = settings or await get_settings(pool)
    async with pool.acquire() as conn:
        syms = [r["symbol"] for r in await conn.fetch("SELECT DISTINCT symbol FROM daily_candles WHERE symbol NOT LIKE '^%'")]
    cmap = await load_candles(pool, syms) if syms else {}
    return week52.lists(cmap, settings["w52_break_pts"], settings["w52_near_pts"])


@router.get("/week52")
async def week52_endpoint(request: Request):
    return await week52_lists(_pool(request))


@router.get("/results")
async def results(request: Request):
    pool = _pool(request)
    run = await latest_run(pool)
    return {"run": run, "settings": await get_settings(pool), "state": dict(state)}


@router.get("/status")
async def status(request: Request):
    return dict(state)


@router.get("/settings")
async def read_settings(request: Request):
    return await get_settings(_pool(request))


@router.patch("/settings")
async def save_settings(patch: SettingsPatch, request: Request):
    pool = _pool(request)
    new = clean_settings(patch.model_dump(exclude_none=True), await get_settings(pool))
    await auth.set_setting(pool, SETTINGS_KEY, json.dumps(new))
    return new


@router.post("/run")
async def run_now(request: Request):
    if state["running"]:
        raise HTTPException(status_code=409, detail="A screener run is already in progress.")
    asyncio.create_task(run_screen(_pool(request)))
    return {"started": True}


@router.post("/fundamentals/refresh")
async def fundamentals_refresh(request: Request):
    if state["fund_running"]:
        raise HTTPException(status_code=409, detail="A fundamentals refresh is already in progress.")
    pool = _pool(request)
    symbols = await fo_stock_symbols()
    if not symbols:
        raise HTTPException(status_code=503, detail="Could not get the F&O stock list from NSE.")
    asyncio.create_task(refresh_fundamentals(pool, symbols))
    return {"started": True, "total": len(symbols)}


@router.get("/fundamentals/status")
async def fundamentals_status(request: Request):
    pool = _pool(request)
    data, fetched = await load_fundamentals(pool)
    now = dt.datetime.now(dt.timezone.utc)
    metrics = [sfund.compute_metrics(d) for d in data.values()]
    keys = ("profit_growth", "roe", "roce", "debt_equity", "interest_coverage", "ocf_ebitda", "promoter_pct", "nii_growth")
    return {"stored": len(data), "stale_rows": sum(1 for m in metrics if m["stale"]),
            "oldest_days": max(((now - f).days for f in fetched.values()), default=None),
            "coverage": {k: sum(1 for m in metrics if m.get(k) is not None) for k in keys}, "state": {k: state[k] for k in ("fund_running", "fund_done", "fund_total", "fund_errors")}}


@router.post("/restore-universe")
async def restore_scan_list(request: Request):
    prev = await restore_universe(_pool(request))
    if prev is None:
        raise HTTPException(status_code=404, detail="There is no saved scan list to restore.")
    return {"universe": prev}


class PaperTrade(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)


@router.post("/paper-trade")
async def paper_trade(body: PaperTrade, request: Request):
    """Queue the latest run's setup for this stock as a pending delivery (CNC) paper order."""
    pool = _pool(request)
    run = await latest_run(pool)
    sym = body.symbol.strip().upper()
    row = next((r for r in (run or {}).get("rows", []) if r["symbol"] == sym), None)
    if not row:
        raise HTTPException(status_code=404, detail=f"{sym} is not in the latest screener run.")
    try:
        return await delivery.place_order(pool, row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
