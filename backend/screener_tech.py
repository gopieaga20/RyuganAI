"""Technical half of the techno-funda screener (blueprint sections 3, 4 and 5). Pure functions over DAILY candles, no network, no database.

Candles are dicts {ts (ms), o, h, l, c, v} (optionally "deliv_per"), oldest first, one per trading day. Everything at bar i uses bars up to and including i only,
so a signal read at the close of bar i is something you could have acted on that evening.

What is here
  indicators()        EMA 20/50/200, ATR 14, Wilder RSI 14, 20-day volume average, 52-week high, per bar
  rs_ratings()        percentile (1-99) of each stock's 3- and 6-month performance relative to the benchmark
  technical_gate()    the hard gate of blueprint section 3 (trend stack, RS > 80, within 15% of the 52-week high)
  technical_score()   the 50-point technical score of blueprint section 4
  breakout_setup() / pullback_setup()   the two trade templates of section 5 (entry, stop, T1, T2)
  position_size()     the risk calculator
  new_trade() / advance()   the trade lifecycle shared by the backtest and the live paper-trade watcher (stop, T1 half, breakeven, 20-EMA trail, T2)
"""
from __future__ import annotations

import math
from typing import Optional

from strategy_vote import atr as _atr, ema as _ema

MIN_BARS = 230                 # 200-EMA, its 20-session slope and a 52-week window
YEAR = 252
BASE_DAYS = 20                 # a consolidation base is judged over the 20 sessions before the breakout
MAX_BASE_RANGE = 0.15          # ... and must be no wider than 15% of its high
MAX_EXTENSION_ATR = 1.0        # a breakout already more than 1 ATR above its entry is chasing: no setup
RSI_BREAKOUT_MAX = 78
RSI_PULLBACK = (45, 60)
SWING_DAYS = 10


# ───────────── indicators ─────────────
def rsi_wilder(closes: list, period: int = 14) -> list:
    out = [float("nan")] * len(closes)
    if len(closes) <= period:
        return out
    gain = loss = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gain += max(d, 0.0)
        loss += max(-d, 0.0)
    gain, loss = gain / period, loss / period
    out[period] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        gain = (gain * (period - 1) + max(d, 0.0)) / period
        loss = (loss * (period - 1) + max(-d, 0.0)) / period
        out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def indicators(candles: list) -> dict:
    """Per-bar arrays: ema20, ema50, ema200, atr, rsi, vol_sma (average volume of the PRIOR 20 sessions), hh52 (highest high of the last 252 bars incl. this one)."""
    n = len(candles)
    closes = [c["c"] for c in candles]
    vols = [c.get("v") or 0 for c in candles]
    vol_sma = [float("nan")] * n
    run = 0.0
    for i in range(n):
        if i >= 20:
            vol_sma[i] = run / 20                      # average of bars i-20 .. i-1
            run += vols[i] - vols[i - 20]
        else:
            run += vols[i]
    hh52 = [0.0] * n
    for i in range(n):
        hh52[i] = max(c["h"] for c in candles[max(0, i - YEAR + 1): i + 1])
    return {"ema20": _ema(closes, 20), "ema50": _ema(closes, 50), "ema200": _ema(closes, 200), "atr": _atr(candles, 14),
            "rsi": rsi_wilder(closes, 14), "vol_sma": vol_sma, "hh52": hh52}


# ───────────── relative strength ─────────────
def relative_performance(closes: list, bench: list, i: int) -> Optional[float]:
    """Blend of the 3-month (63 sessions) and 6-month (126 sessions) excess return over the benchmark at bar i (None if there is not enough history).
    `closes` and `bench` must be aligned bar for bar."""
    if i < 126 or i >= len(closes) or i >= len(bench) or not (bench[i - 63] > 0 and bench[i - 126] > 0 and closes[i - 63] > 0 and closes[i - 126] > 0):
        return None
    p3, p6 = closes[i] / closes[i - 63] - 1, closes[i] / closes[i - 126] - 1
    b3, b6 = bench[i] / bench[i - 63] - 1, bench[i] / bench[i - 126] - 1
    return 0.5 * (p3 - b3) + 0.5 * (p6 - b6)


def rs_ratings(rel: dict) -> dict:
    """{symbol: relative performance} -> {symbol: rating 1-99} by percentile rank (ties share the average rank). Symbols with None are left out."""
    items = sorted(((v, k) for k, v in rel.items() if v is not None and v == v))
    n = len(items)
    out: dict = {}
    if n == 0:
        return out
    if n == 1:
        return {items[0][1]: 50}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and items[j + 1][0] == items[i][0]:
            j += 1
        pct = ((i + j) / 2) / (n - 1)
        for q in range(i, j + 1):
            out[items[q][1]] = int(round(1 + 98 * pct))
        i = j + 1
    return out


# ───────────── gate and score ─────────────
def _ok(x) -> bool:
    return x is not None and x == x


def technical_gate(candles: list, ind: dict, i: int, rs: Optional[float]) -> dict:
    """Blueprint section 3 as a hard gate at bar i. Returns {pass, checks:{trend, slope, rs, proximity}, near_high_pct}."""
    c = candles[i]["c"]
    trend = c > ind["ema50"][i] > ind["ema200"][i]
    slope = i >= 20 and ind["ema200"][i] > ind["ema200"][i - 20]
    near = c / ind["hh52"][i] if ind["hh52"][i] else 0.0
    checks = {"trend": bool(trend), "slope": bool(slope), "rs": bool(_ok(rs) and rs > 80), "proximity": near >= 0.85}
    return {"pass": all(checks.values()), "checks": checks, "near_high_pct": round((1 - near) * 100, 1)}


def base_breakout(candles: list, ind: dict, i: int) -> Optional[dict]:
    """A close above the highest high of the previous 20 sessions, out of a base no wider than 15%, on volume of at least 1.5x the 20-day average.
    Returns {resistance, base_range, vol_ratio} or None."""
    if i < BASE_DAYS + 1:
        return None
    prior = candles[i - BASE_DAYS: i]
    res = max(c["h"] for c in prior)
    low = min(c["l"] for c in prior)
    base_range = (res - low) / res if res else 1.0
    v, vs = candles[i].get("v") or 0, ind["vol_sma"][i]
    if not (candles[i]["c"] > res and base_range <= MAX_BASE_RANGE and _ok(vs) and vs > 0 and v >= 1.5 * vs):
        return None
    return {"resistance": res, "base_range": base_range, "vol_ratio": v / vs}


def technical_score(candles: list, ind: dict, i: int, rs: Optional[float], breakout: Optional[dict]) -> dict:
    """Blueprint section 4 technical score (50 max, binary points). Delivery percentage unknown -> that 5 points is unavailable and the score is scaled over the points that exist.
    Returns {score (0-50, scaled), earned, available, parts:{name: {earned, max, ok|None}}}."""
    c = candles[i]
    parts = {}
    parts["trend"] = {"max": 15, "ok": bool(c["c"] > ind["ema20"][i] > ind["ema50"][i] > ind["ema200"][i])}
    parts["rs"] = {"max": 15, "ok": bool(_ok(rs) and rs > 80)}
    vs, v = ind["vol_sma"][i], c.get("v") or 0
    parts["volume"] = {"max": 5, "ok": bool(_ok(vs) and vs > 0 and v >= 1.5 * vs)}
    dp = c.get("deliv_per")
    parts["delivery"] = {"max": 5, "ok": (dp is not None and dp > 50) if dp is not None else None}
    near = c["c"] / ind["hh52"][i] if ind["hh52"][i] else 0.0
    parts["structure"] = {"max": 10, "ok": bool(near >= 0.90 or breakout)}
    earned = available = 0
    for p in parts.values():
        if p["ok"] is None:
            p["earned"] = None
            continue
        p["earned"] = p["max"] if p["ok"] else 0
        earned += p["earned"]
        available += p["max"]
    return {"score": round(earned / available * 50, 1) if available else 0.0, "earned": earned, "available": available, "parts": parts}


# ───────────── trade setups ─────────────
def breakout_setup(candles: list, ind: dict, i: int, brk: Optional[dict] = None, max_stop_pct: Optional[float] = None) -> Optional[dict]:
    """Setup A. Entry = resistance + 0.15 ATR, stop = min(breakout low, swing low) - 0.5 ATR, T1 = 2R, T2 = 3R. None when there is no breakout, RSI is over 78,
    or the close is already more than 1 ATR above the entry (chasing)."""
    brk = brk or base_breakout(candles, ind, i)
    a = ind["atr"][i]
    if not brk or not (a > 0) or ind["rsi"][i] != ind["rsi"][i] or ind["rsi"][i] > RSI_BREAKOUT_MAX:
        return None
    entry = brk["resistance"] + 0.15 * a
    if candles[i]["c"] - entry > MAX_EXTENSION_ATR * a:
        return None
    swing = min(c["l"] for c in candles[max(0, i - SWING_DAYS + 1): i + 1])
    stop = min(candles[i]["l"], swing) - 0.5 * a
    if not (entry > stop):
        return None
    risk = entry - stop
    if max_stop_pct is not None and risk / entry * 100 > max_stop_pct:
        return None                                    # stop too far below the entry: no setup (`max_stop_pct` None = no cap, as in the backtest)
    return {"type": "BREAKOUT", "entry": entry, "stop": stop, "t1": entry + 2 * risk, "t2": entry + 3 * risk, "risk": risk, "rr": 2.0, "trigger": "buy-stop"}


def pullback_setup(candles: list, ind: dict, i: int, max_stop_pct: Optional[float] = None) -> Optional[dict]:
    """Setup B. A bullish reversal candle that dipped into the 20/50-EMA zone with RSI between 45 and 60. Entry = the close (limit next session), stop = zone low - 1 ATR,
    T1 = the recent swing high (setup suppressed when that is under 1:2), T2 = 3R."""
    c, a = candles[i], ind["atr"][i]
    e20, e50, r = ind["ema20"][i], ind["ema50"][i], ind["rsi"][i]
    if not (a > 0) or r != r or not (RSI_PULLBACK[0] <= r <= RSI_PULLBACK[1]):
        return None
    zone_lo, zone_hi = min(e20, e50), max(e20, e50)
    reversal = c["c"] > c["o"] and c["c"] > (c["h"] + c["l"]) / 2 and c["l"] <= zone_hi and c["c"] >= zone_lo
    if not reversal:
        return None
    entry = c["c"]
    stop = min(c["l"], zone_lo) - 1.0 * a
    if not (entry > stop):
        return None
    risk = entry - stop
    if max_stop_pct is not None and risk / entry * 100 > max_stop_pct:
        return None                                    # stop too far below the entry: no setup (`max_stop_pct` None = no cap, as in the backtest)
    t1 = max(x["h"] for x in candles[max(0, i - 30): i])
    if not (t1 - entry >= 2 * risk):
        return None
    return {"type": "PULLBACK", "entry": entry, "stop": stop, "t1": t1, "t2": max(entry + 3 * risk, t1), "risk": risk, "rr": round((t1 - entry) / risk, 2),
            "trigger": "limit", "zone": [round(zone_lo, 2), round(zone_hi, 2)]}


def position_size(capital: float, risk_pct: float, entry: float, stop: float, max_pct_of_capital: float = 20.0, cash: Optional[float] = None) -> int:
    """floor(capital x risk% / (entry - stop)), capped by max % of capital per position and by free cash. 0 when it does not fit."""
    if not (entry > stop > 0) or capital <= 0:
        return 0
    qty = math.floor(capital * risk_pct / 100.0 / (entry - stop))
    qty = min(qty, math.floor(capital * max_pct_of_capital / 100.0 / entry))
    if cash is not None:
        qty = min(qty, math.floor(max(cash, 0) / entry))
    return max(int(qty), 0)


# ───────────── trade lifecycle (shared by the backtest and the live watcher) ─────────────
def new_trade(entry: float, qty: int, stop: float, t1: float, t2: float) -> dict:
    return {"entry": entry, "qty": qty, "qty_open": qty, "stop": stop, "t1": t1, "t2": t2, "stage": "OPEN", "realised": 0.0, "days": 0}


def advance(tr: dict, o: float, h: float, l: float, c: float, ema20: Optional[float] = None) -> list:
    """Move a long trade through one bar. Returns the exits it made as [(price, qty, reason)] and updates `tr` in place.
    Order inside a bar is pessimistic: a gap or a stop is honoured before any target. Stop: whole position. T1: sell HALF (rounded up) and move the stop to the entry.
    T2: sell the rest. After T1, at each close the stop is raised to the 20-EMA (never lowered). `tr["stage"]` is OPEN -> T1_DONE -> TRAIL -> CLOSED."""
    exits = []
    if tr["stage"] == "CLOSED":
        return exits
    tr["days"] += 1
    q = tr["qty_open"]

    def close(price, reason):
        nonlocal q
        exits.append((price, q, reason))
        tr["realised"] += (price - tr["entry"]) * q
        q = 0
        tr["qty_open"], tr["stage"] = 0, "CLOSED"

    if o <= tr["stop"]:
        close(o, "STOP (gap)")
        return exits
    if l <= tr["stop"]:
        close(tr["stop"], "STOP" if tr["stage"] == "OPEN" else ("BREAKEVEN / TRAIL STOP"))
        return exits
    if tr["stage"] == "OPEN" and (o >= tr["t1"] or h >= tr["t1"]):
        px = max(o, tr["t1"]) if o >= tr["t1"] else tr["t1"]
        sell = max(1, math.ceil(q / 2)) if q > 1 else q
        exits.append((px, sell, "T1"))
        tr["realised"] += (px - tr["entry"]) * sell
        q -= sell
        tr["qty_open"] = q
        tr["stage"] = "T1_DONE" if q > 0 else "CLOSED"
        tr["stop"] = max(tr["stop"], tr["entry"])
        if q == 0:
            return exits
        if o >= tr["t2"] or h >= tr["t2"]:                 # the same bar also reached T2
            close(max(o, tr["t2"]) if o >= tr["t2"] else tr["t2"], "T2")
            return exits
    elif tr["stage"] in ("T1_DONE", "TRAIL") and (o >= tr["t2"] or h >= tr["t2"]):
        close(max(o, tr["t2"]) if o >= tr["t2"] else tr["t2"], "T2")
        return exits
    if tr["stage"] in ("T1_DONE", "TRAIL") and ema20 is not None and ema20 == ema20 and ema20 < c:
        tr["stop"] = max(tr["stop"], ema20)
        tr["stage"] = "TRAIL"
    return exits
