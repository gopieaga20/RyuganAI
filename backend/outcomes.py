"""Outcome log: what happened after every BUY CE / BUY PE call the scanner made, traded or not.

Why: the backtests used a modelled option price and found no proven edge, so the only honest way to learn what works is to
record every real call and score it later. This module never places orders and never changes any setting; it only records
and measures. A suggestion list ("this symbol's calls keep reversing") is read-only and needs the user's decision.

Scoring uses the UNDERLYING price (no option model): entering at the open of the candle after the signal, did the market move
1 ATR in the call's direction before it moved 1 ATR against it, by the 15:15 square-off of the same day?
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Optional

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
CANDLE_SECONDS = 15 * 60
SQUAREOFF_MIN = 15 * 60 + 15
HORIZON_CANDLES = 4                       # "next hour" on 15-minute candles
MIN_SAMPLE = 50                           # fewer resolved calls than this is never judged
SCHEMA = """
CREATE TABLE IF NOT EXISTS signal_outcomes (
    id            SERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    symbol        TEXT NOT NULL,
    call          TEXT NOT NULL,
    candle_ts     BIGINT NOT NULL,
    confidence    INTEGER NOT NULL DEFAULT 0,
    score         NUMERIC(6, 2),
    adx           NUMERIC(6, 2),
    price         NUMERIC(14, 2),
    atr           NUMERIC(14, 4),
    votes         JSONB NOT NULL DEFAULT '[]',
    traded        BOOLEAN NOT NULL DEFAULT FALSE,
    action        TEXT NOT NULL DEFAULT '',
    detail        TEXT NOT NULL DEFAULT '',
    position_id   INTEGER,
    resolved      BOOLEAN NOT NULL DEFAULT FALSE,
    outcome       TEXT,
    mfe_atr       NUMERIC(8, 3),
    mae_atr       NUMERIC(8, 3),
    ret_1h_atr    NUMERIC(8, 3),
    ret_eod_atr   NUMERIC(8, 3),
    resolved_at   TIMESTAMPTZ,
    opt_entry     NUMERIC(12, 2),
    opt_peak      NUMERIC(12, 2),
    opt_low       NUMERIC(12, 2),
    opt_exit      NUMERIC(12, 2),
    news          TEXT,
    UNIQUE (symbol, candle_ts, call)
)
"""


def direction(call: str) -> int:
    return 1 if call == "BUY CE" else -1 if call == "BUY PE" else 0


def signal_record(scan: dict, row: dict) -> Optional[dict]:
    """The row to store for one scanner result, or None when it was not a call. `scan` is scan_symbol's result, `row` the decision."""
    call = scan.get("call")
    if call not in ("BUY CE", "BUY PE") or not scan.get("candle_ts"):
        return None
    levels = scan.get("levels") or {}
    atr = levels.get("atr") or scan.get("atr")
    votes = [{"id": v.get("id"), "w": v.get("weight"), "v": v.get("vote")} for v in (scan.get("votes") or [])]
    return {"symbol": scan["sym"], "call": call, "candle_ts": int(scan["candle_ts"]), "confidence": int(scan.get("confidence") or 0),
            "score": scan.get("score"), "adx": scan.get("adx"), "price": scan.get("price"), "atr": atr, "votes": votes,
            "traded": row.get("action") in ("ORDER", "WOULD ORDER"), "action": row.get("action") or "", "detail": (row.get("detail") or "")[:300],
            "position_id": row.get("position_id"), "news": scan.get("news")}


def compute_outcome(candles: list, candle_ts: int, call: str, atr: float) -> Optional[dict]:
    """Score one call from the candles after it. Returns None while the same trading day is still running (not enough data yet).

    Entry is the open of the candle after the signal candle. `outcome`: 'worked' (+1 ATR first), 'reversed' (-1 ATR first),
    'neither' (neither level reached by 15:15). mfe/mae are the best/worst excursions in ATR; ret_* the close-to-entry move in ATR.
    """
    d = direction(call)
    if not d or not atr or atr <= 0:
        return None
    sig_end = candle_ts + CANDLE_SECONDS
    day = dt.datetime.fromtimestamp(candle_ts, IST).date()
    after = [c for c in candles if c["ts"] >= sig_end and dt.datetime.fromtimestamp(c["ts"], IST).date() == day]
    if not after:
        return None
    last_min = max(dt.datetime.fromtimestamp(c["ts"], IST).hour * 60 + dt.datetime.fromtimestamp(c["ts"], IST).minute for c in after)
    day_over = last_min >= SQUAREOFF_MIN - CANDLE_SECONDS // 60 or dt.datetime.now(IST).date() > day
    if not day_over:
        return None
    entry = after[0]["o"]
    outcome, mfe, mae, ret1h, last_close = None, 0.0, 0.0, None, entry
    for k, c in enumerate(after):
        m = dt.datetime.fromtimestamp(c["ts"], IST)
        if m.hour * 60 + m.minute >= SQUAREOFF_MIN:
            break
        fav = ((c["h"] - entry) if d > 0 else (entry - c["l"])) / atr
        adv = ((entry - c["l"]) if d > 0 else (c["h"] - entry)) / atr
        if outcome is None:
            if fav >= 1 and adv >= 1:
                outcome = "reversed"            # both inside one candle: count the pessimistic one
            elif adv >= 1:
                outcome = "reversed"
            elif fav >= 1:
                outcome = "worked"
        mfe, mae = max(mfe, fav), max(mae, adv)
        last_close = c["c"]
        if k + 1 == HORIZON_CANDLES:
            ret1h = d * (c["c"] - entry) / atr
    ret_eod = d * (last_close - entry) / atr
    return {"outcome": outcome or "neither", "mfe_atr": round(mfe, 3), "mae_atr": round(mae, 3),
            "ret_1h_atr": None if ret1h is None else round(ret1h, 3), "ret_eod_atr": round(ret_eod, 3)}


def summarise(rows: list) -> dict:
    """Tally resolved calls. A symbol is only ever judged with MIN_SAMPLE or more, and 'suggestions' are advice for the user, never actions."""
    def tally(items):
        res = [r for r in items if r.get("resolved") and r.get("outcome")]
        w = sum(1 for r in res if r["outcome"] == "worked")
        rv = sum(1 for r in res if r["outcome"] == "reversed")
        decided = w + rv
        vals = lambda k: [float(r[k]) for r in res if r.get(k) is not None]
        avg = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
        return {"signals": len(items), "resolved": len(res), "worked": w, "reversed": rv, "neither": len(res) - decided,
                "worked_pct": round(100 * w / decided, 1) if decided else None,
                "avg_ret_1h_atr": avg(vals("ret_1h_atr")), "avg_ret_eod_atr": avg(vals("ret_eod_atr")),
                "traded": sum(1 for r in items if r.get("traded"))}

    by_sym: dict = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], []).append(r)
    symbols = {s: tally(v) for s, v in by_sym.items()}
    tips = []
    for s, t in sorted(symbols.items()):
        decided = t["worked"] + t["reversed"]
        if decided < MIN_SAMPLE or t["worked_pct"] is None:
            continue
        # With 1-ATR levels a coin flip works ~50% of the time; far below that over 50+ decided calls is worth the user's attention.
        z = (t["worked"] - decided / 2) / ((decided * 0.25) ** 0.5)
        if z <= -1.64:
            tips.append({"symbol": s, "advice": "alert-only", "why": f"only {t['worked_pct']}% of its last {decided} decided calls moved 1 ATR the right way first"})
        elif z >= 1.64:
            tips.append({"symbol": s, "advice": "keep", "why": f"{t['worked_pct']}% of {decided} decided calls worked, better than a coin flip"})
    by_conf = {}
    for r in rows:
        by_conf.setdefault("85+" if (r.get("confidence") or 0) >= 85 else "below 85", []).append(r)
    by_news = {}
    for r in rows:
        by_news.setdefault(r.get("news") or "none", []).append(r)
    return {"overall": tally(rows), "by_symbol": symbols, "by_confidence": {k: tally(v) for k, v in by_conf.items()},
            "by_news": {k: tally(v) for k, v in by_news.items()},
            "suggestions": tips, "min_sample": MIN_SAMPLE}


# ───────────── database ─────────────
async def ensure_schema(conn) -> None:
    await conn.execute(SCHEMA)
    await conn.execute("ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS news TEXT")


async def record(pool, rec: dict) -> None:
    """Store one call. Calling it again for the same candle only refreshes whether it was traded; it never raises."""
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO signal_outcomes (symbol, call, candle_ts, confidence, score, adx, price, atr, votes, traded, action, detail, position_id, news)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
                   ON CONFLICT (symbol, candle_ts, call) DO UPDATE SET
                     traded = signal_outcomes.traded OR EXCLUDED.traded,
                     action = CASE WHEN EXCLUDED.traded THEN EXCLUDED.action ELSE signal_outcomes.action END,
                     position_id = COALESCE(signal_outcomes.position_id, EXCLUDED.position_id)""",
                rec["symbol"], rec["call"], rec["candle_ts"], rec["confidence"], rec["score"], rec["adx"], rec["price"], rec["atr"],
                json.dumps(rec["votes"]), rec["traded"], rec["action"], rec["detail"], rec["position_id"], rec.get("news"))
    except Exception as e:
        print(f"[WARN] outcome log skipped: {e}")


async def track_premium(pool, position_id, ltp: float, closed_at: Optional[float] = None) -> None:
    """Keep the real option premium path of a position the auto-trader opened: entry, highest, lowest and exit. Never raises."""
    try:
        async with pool.acquire() as conn:
            if closed_at is None:
                await conn.execute(
                    """UPDATE signal_outcomes SET opt_entry = COALESCE(opt_entry, $2), opt_peak = GREATEST(COALESCE(opt_peak, $2), $2),
                              opt_low = LEAST(COALESCE(opt_low, $2), $2) WHERE position_id = $1 AND opt_exit IS NULL""", position_id, ltp)
            else:
                await conn.execute("UPDATE signal_outcomes SET opt_exit = $2 WHERE position_id = $1", position_id, ltp)
    except Exception as e:
        print(f"[WARN] premium tracking skipped: {e}")


async def resolve_pending(pool, fetch_candles, limit: int = 40) -> int:
    """Score calls whose trading day is over. Calls older than the data we can fetch are closed as 'no data'. Returns how many were scored."""
    done = 0
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, symbol, call, candle_ts, atr FROM signal_outcomes WHERE NOT resolved ORDER BY candle_ts LIMIT $1", limit)
    cache: dict = {}
    for r in rows:
        age_days = (dt.datetime.now(IST) - dt.datetime.fromtimestamp(r["candle_ts"], IST)).days
        try:
            if r["symbol"] not in cache:
                cache[r["symbol"]] = await fetch_candles(r["symbol"], "15m", "5d")
            res = compute_outcome(cache[r["symbol"]], int(r["candle_ts"]), r["call"], float(r["atr"] or 0))
        except Exception as e:
            print(f"[WARN] outcome resolve {r['symbol']}: {e}")
            res = None
        async with pool.acquire() as conn:
            if res:
                await conn.execute(
                    """UPDATE signal_outcomes SET resolved = TRUE, outcome = $2, mfe_atr = $3, mae_atr = $4, ret_1h_atr = $5, ret_eod_atr = $6,
                              resolved_at = NOW() WHERE id = $1""", r["id"], res["outcome"], res["mfe_atr"], res["mae_atr"], res["ret_1h_atr"], res["ret_eod_atr"])
                done += 1
            elif age_days >= 4:
                await conn.execute("UPDATE signal_outcomes SET resolved = TRUE, outcome = 'no data', resolved_at = NOW() WHERE id = $1", r["id"])
    return done


async def load_rows(pool, days: int = 90) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM signal_outcomes WHERE ts > NOW() - make_interval(days => $1) ORDER BY candle_ts DESC LIMIT 5000", days)
    return [dict(r) for r in rows]
