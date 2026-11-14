"""Delivery (multi-day, long-only, CNC) paper trades created from the screener's setups.

Lifecycle of a delivery position (the same rules `screener_tech.advance` uses in the backtest, applied to live prices):
  pending order (buy-stop for a breakout, limit for a pullback; valid for the next session only)
  -> OPEN with stop and T1/T2 -> price reaches T1: sell half, stop moves to the entry (breakeven), stage T1_DONE
  -> every night the stop is raised to the 20-day EMA when that is higher (stage TRAIL), never lowered
  -> price reaches T2: close the rest; price falls to the stop: close what is left.
Everything here is either pure (tested) or works on the `orders` / `positions` tables; the money movements (margin, charges, history) stay in main.py.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from typing import Optional

import auth

SOURCE = "delivery"
PRODUCT = "CNC"


async def ensure_schema(conn) -> None:
    for stmt in (
        "ALTER TABLE positions ADD COLUMN IF NOT EXISTS t1 NUMERIC(12,2)",
        "ALTER TABLE positions ADD COLUMN IF NOT EXISTS stage TEXT",
        "ALTER TABLE positions ADD COLUMN IF NOT EXISTS setup TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS t1 NUMERIC(12,2)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS setup TEXT",
        "ALTER TABLE history ADD COLUMN IF NOT EXISTS product TEXT",
    ):
        await conn.execute(stmt)


# ───────────── pure rules ─────────────
def next_action(stage: Optional[str], ltp: float, entry: float, sl: float, t1: Optional[float], tp: float, qty: int) -> Optional[tuple]:
    """What to do with an open delivery position at price `ltp`: ('CLOSE', reason) | ('PARTIAL', qty_to_sell) | None.
    Stop is checked first (a gap through it is closed at the market price), then the final target, then T1 (sell half, rounded up)."""
    if ltp <= sl:
        return ("CLOSE", "SL Hit" if stage in (None, "OPEN") else "Trailing stop")
    if ltp >= tp:
        return ("CLOSE", "Target 2 Hit")
    if stage in (None, "OPEN") and t1 is not None and ltp >= t1 and qty >= 2:
        return ("PARTIAL", math.ceil(qty / 2))
    return None


def trailed_stop(current_sl: float, ema20: Optional[float], last_close: float) -> Optional[float]:
    """The new stop after T1: the 20-day EMA if it is above the current stop and still under the last close, else None (leave it)."""
    if ema20 is None or ema20 != ema20:
        return None
    new = round(ema20, 2)
    return new if (new > current_sl and new < last_close) else None


def order_expired(created_at_ist: dt.datetime, now_ist: dt.datetime) -> bool:
    """A delivery order is good for the first trading day after it was placed (placed after the close, the next weekday; placed before the close, today).
    It is expired once that day is over."""
    created_after_close = created_at_ist.hour * 60 + created_at_ist.minute >= 15 * 60 + 30
    valid = created_at_ist.date() + dt.timedelta(days=1 if created_after_close else 0)
    while valid.weekday() >= 5:
        valid += dt.timedelta(days=1)
    return now_ist.date() > valid or (now_ist.date() == valid and now_ist.hour * 60 + now_ist.minute >= 15 * 60 + 30)


def pick_for_auto(rows: list, held: set, free_slots: int, min_score: float) -> list:
    """Top feed rows with a setup and a quantity, skipping symbols already held or pending, at most `free_slots`."""
    out = []
    for r in rows:
        if len(out) >= max(free_slots, 0):
            break
        s = r.get("setup")
        if r.get("feed") and s and s.get("qty", 0) > 0 and r["score"] >= min_score and r["symbol"] not in held:
            out.append(r)
    return out


# ───────────── tables ─────────────
async def held_symbols(pool) -> set:
    """Symbols with an open delivery position or a pending delivery order."""
    async with pool.acquire() as conn:
        a = await conn.fetch("SELECT symbol FROM positions WHERE source = $1", SOURCE)
        b = await conn.fetch("SELECT symbol FROM orders WHERE source = $1", SOURCE)
    return {r["symbol"] for r in a} | {r["symbol"] for r in b}


async def place_order(pool, row: dict) -> dict:
    """Queue the row's setup as a pending CNC order (buy-stop for a breakout, limit for a pullback). Raises ValueError with a plain reason when it cannot."""
    s = row.get("setup")
    if not s:
        raise ValueError(f"{row['symbol']} has no trade setup today.")
    if s.get("qty", 0) <= 0:
        raise ValueError(f"{row['symbol']}: the stop is too far for the risk limit (the quantity rounds to zero).")
    if row["symbol"] in await held_symbols(pool):
        raise ValueError(f"{row['symbol']} already has a delivery position or a pending delivery order.")
    otype = "SL" if s["trigger"] == "buy-stop" else "LIMIT"
    async with pool.acquire() as conn:
        oid = await conn.fetchval(
            "INSERT INTO orders (symbol, type, qty, price, sl, tp, order_type, product, price_symbol, source, t1, setup) "
            "VALUES ($1, 'LONG', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id",
            row["symbol"], int(s["qty"]), s["entry"], s["stop"], s["t2"], otype, PRODUCT, row["symbol"] + ".NS", SOURCE, s["t1"], s["type"])
    return {"order_id": oid, "symbol": row["symbol"], "order_type": otype, "entry": s["entry"], "stop": s["stop"], "t1": s["t1"], "t2": s["t2"], "qty": s["qty"]}


async def expire_orders(pool, now_ist: dt.datetime) -> int:
    ist = now_ist.tzinfo
    async with pool.acquire() as conn:
        recs = await conn.fetch("SELECT id, created_at FROM orders WHERE source = $1", SOURCE)
        dead = [r["id"] for r in recs if order_expired(r["created_at"].astimezone(ist), now_ist)]
        if dead:
            await conn.execute("DELETE FROM orders WHERE id = ANY($1::int[])", dead)
    return len(dead)


async def trail_stops(pool, rows: list) -> int:
    """Nightly: raise the stop of every delivery position past T1 to the 20-day EMA when that is higher. Returns how many moved."""
    by = {r["symbol"]: r for r in rows}
    moved = 0
    async with pool.acquire() as conn:
        pos = await conn.fetch("SELECT id, symbol, sl, stage FROM positions WHERE source = $1 AND stage IN ('T1_DONE', 'TRAIL')", SOURCE)
        for p in pos:
            r = by.get(p["symbol"])
            new = trailed_stop(float(p["sl"]), r.get("ema20") if r else None, r["close"] if r else 0.0)
            if new is not None:
                await conn.execute("UPDATE positions SET sl = $1, stage = 'TRAIL' WHERE id = $2", new, p["id"])
                moved += 1
    return moved


async def after_run(pool, rows: list, settings: dict, now_ist: Optional[dt.datetime] = None) -> dict:
    """Follow-up of the nightly screener run: expire stale orders, trail stops, and (only when the owner switched auto mode on) queue the top setups."""
    import autotrader
    now = now_ist or autotrader.now_ist()
    out = {"expired": await expire_orders(pool, now), "trailed": await trail_stops(pool, rows), "placed": []}
    if settings.get("auto_delivery"):
        held = await held_symbols(pool)
        for r in pick_for_auto(rows, held, settings["max_delivery_positions"] - len(held), settings["min_score"]):
            try:
                out["placed"].append((await place_order(pool, r))["symbol"])
            except ValueError:
                pass
    return out
