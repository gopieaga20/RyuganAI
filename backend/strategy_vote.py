"""Server-side port of the dashboard's strategy vote (frontend/js/strategies.js, smc-structure.js, indicators.js).

The auto paper-trader runs on the server so it keeps working with the browser closed, which means the same rules
must exist in Python. tests/test_strategy_parity.py runs both implementations on the same candles and fails if they
ever disagree, so the two cannot drift apart silently.

Candles are dicts {ts (ms), o, h, l, c, v}, oldest first.
"""
import math
from typing import Optional

IST_MS = 5.5 * 3600 * 1000

STRATEGIES = {  # id -> weight
    "trend": 2, "rsi": 1, "vwap": 1, "structure": 2, "fvg": 1, "volume": 1, "news": 1,
}
MIN_ADX = 20
CALL_SCORE = 3


def _round(x: float) -> int:
    """JavaScript's Math.round (halves round up), not Python's banker's rounding."""
    return int(math.floor(x + 0.5))


# ───────────── indicators (same maths as indicators.js) ─────────────
def ema(values, period):
    k = 2 / (period + 1)
    out, e = [], None
    for i, v in enumerate(values):
        e = v if i == 0 else v * k + e * (1 - k)
        out.append(e)
    return out


def rsi(closes, period=14):
    out = []
    for i in range(len(closes)):
        if i < period:
            out.append(50.0)
            continue
        gain = loss = 0.0
        for j in range(i - period + 1, i + 1):
            d = closes[j] - closes[j - 1]
            if d > 0:
                gain += d
            else:
                loss -= d
        rs = (gain / period) / ((loss / period) or 0.0001)
        out.append(100 - 100 / (1 + rs))
    return out


def atr(candles, period=14):
    out = [0.0]
    for i in range(1, len(candles)):
        c, p = candles[i], candles[i - 1]
        tr = max(c["h"] - c["l"], abs(c["h"] - p["c"]), abs(c["l"] - p["c"]))
        if i < period:
            out.append(tr)
        elif i == period:
            out.append((sum(out) + tr) / period)
        else:
            out.append((out[i - 1] * (period - 1) + tr) / period)
    return out


def adx(candles, period=14):
    n = len(candles)
    out = [0.0] * n
    tr14 = p14 = m14 = 0.0
    dx = []
    for i in range(1, n):
        c, p = candles[i], candles[i - 1]
        tr = max(c["h"] - c["l"], abs(c["h"] - p["c"]), abs(c["l"] - p["c"]))
        up, dn = c["h"] - p["h"], p["l"] - c["l"]
        pdm = up if (up > dn and up > 0) else 0.0
        mdm = dn if (dn > up and dn > 0) else 0.0
        if i <= period:
            tr14 += tr; p14 += pdm; m14 += mdm
        else:
            tr14 = tr14 - tr14 / period + tr
            p14 = p14 - p14 / period + pdm
            m14 = m14 - m14 / period + mdm
        if i >= period:
            pdi = 100 * p14 / (tr14 or 1)
            mdi = 100 * m14 / (tr14 or 1)
            dx.append(100 * abs(pdi - mdi) / ((pdi + mdi) or 1))
            if len(dx) == period:
                out[i] = sum(dx) / period
            elif len(dx) > period:
                out[i] = (out[i - 1] * (period - 1) + dx[-1]) / period
    return out


def ist_day(ts_ms: float) -> str:
    import datetime as _dt
    return (_dt.datetime(1970, 1, 1) + _dt.timedelta(milliseconds=ts_ms + IST_MS)).strftime("%Y-%m-%d")


def vwap_ist(candles):
    """Per-IST-day VWAP; equal weights when the feed has no volume (Yahoo index data)."""
    out, tpv, vol, last = [], 0.0, 0.0, ""
    for c in candles:
        d = ist_day(c["ts"])
        if d != last:
            tpv, vol, last = 0.0, 0.0, d
        w = c.get("v") or 1
        tpv += (c["h"] + c["l"] + c["c"]) / 3 * w
        vol += w
        out.append(tpv / vol)
    return out


# ───────────── market structure (same as smc-structure.js) ─────────────
def build_structure(candles, k=3):
    n = len(candles)
    events = [None] * n
    trend = [0] * n
    fvgs = []
    last_h = last_l = None
    t = 0
    for i in range(n):
        j = i - k
        if j >= k:
            is_h = is_l = True
            for q in range(j - k, j + k + 1):
                if q == j:
                    continue
                if candles[q]["h"] >= candles[j]["h"]:
                    is_h = False
                if candles[q]["l"] <= candles[j]["l"]:
                    is_l = False
            if is_h:
                last_h = {"price": candles[j]["h"], "broken": False}
            if is_l:
                last_l = {"price": candles[j]["l"], "broken": False}
        c = candles[i]["c"]
        if last_h and not last_h["broken"] and c > last_h["price"]:
            events[i] = {"type": "BOS" if t == 1 else "CHoCH", "dir": "LONG"}
            last_h["broken"] = True
            t = 1
        elif last_l and not last_l["broken"] and c < last_l["price"]:
            events[i] = {"type": "BOS" if t == -1 else "CHoCH", "dir": "SHORT"}
            last_l["broken"] = True
            t = -1
        trend[i] = t
        if i >= 2:
            if candles[i - 2]["h"] < candles[i]["l"]:
                fvgs.append({"dir": "LONG", "top": candles[i]["l"], "bottom": candles[i - 2]["h"], "i": i, "used": False})
            elif candles[i - 2]["l"] > candles[i]["h"]:
                fvgs.append({"dir": "SHORT", "top": candles[i - 2]["l"], "bottom": candles[i]["h"], "i": i, "used": False})
    return {"events": events, "trend": trend, "fvgs": fvgs}


def fvg_retest(S, candles, i, direction, max_age=12):
    for q in range(len(S["fvgs"]) - 1, -1, -1):
        z = S["fvgs"][q]
        if z["i"] >= i:
            continue
        if i - z["i"] > max_age:
            break
        if z["dir"] != direction or z["used"] or i - z["i"] < 2:
            continue
        dead = False
        for m in range(z["i"] + 1, i):
            if (candles[m]["c"] < z["bottom"]) if direction == "LONG" else (candles[m]["c"] > z["top"]):
                dead = True
                break
        if dead:
            continue
        c = candles[i]
        if direction == "LONG" and c["l"] <= z["top"] and c["c"] > z["top"] and c["c"] > c["o"]:
            return z
        if direction == "SHORT" and c["h"] >= z["bottom"] and c["c"] < z["bottom"] and c["c"] < c["o"]:
            return z
    return None


# ───────────── the vote (same rules as strategies.js evaluate) ─────────────
def evaluate(candles, intraday: bool = True, news_label: Optional[str] = None, swing_k: int = 3) -> dict:
    n = len(candles)
    if n < 60:
        return {"ok": False, "reason": f"Need at least 60 candles (have {n})", "votes": [], "call": "WAIT",
                "confidence": 0, "score": 0, "maxScore": 0}
    i = n - 1
    c = candles[i]
    price = c["c"]
    closes = [x["c"] for x in candles]
    ef, es, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    rsi_v = rsi(closes, 14)[i]
    atr_v = atr(candles, 14)[i] or (c["h"] - c["l"]) or 1
    adx_v = adx(candles, 14)[i]
    vw = vwap_ist(candles)[i] if intraday else None
    S = build_structure(candles, swing_k)

    votes = []

    def add(id_, vote, reason):
        votes.append({"id": id_, "weight": STRATEGIES[id_], "vote": vote, "reason": reason})

    if ef[i] > es[i] and es[i] > e50[i] and price > e50[i]:
        add("trend", 1, "EMA9 > EMA21 > EMA50, price above all")
    elif ef[i] < es[i] and es[i] < e50[i] and price < e50[i]:
        add("trend", -1, "EMA9 < EMA21 < EMA50, price below all")
    else:
        add("trend", 0, "EMAs are tangled, no clean trend stack")

    if rsi_v >= 75:
        add("rsi", 0, f"RSI {rsi_v:.0f} is overbought, not chasing")
    elif rsi_v > 55:
        add("rsi", 1, f"RSI {rsi_v:.0f} shows bullish momentum")
    elif rsi_v <= 25:
        add("rsi", 0, f"RSI {rsi_v:.0f} is oversold, not chasing")
    elif rsi_v < 45:
        add("rsi", -1, f"RSI {rsi_v:.0f} shows bearish momentum")
    else:
        add("rsi", 0, f"RSI {rsi_v:.0f} is neutral")

    if intraday:
        if price > vw:
            add("vwap", 1, f"Price {price:.2f} is above VWAP {vw:.2f}")
        elif price < vw:
            add("vwap", -1, f"Price {price:.2f} is below VWAP {vw:.2f}")
        else:
            add("vwap", 0, "Price is at VWAP")

    bias = S["trend"][i]
    if bias == 1:
        add("structure", 1, "Higher-high structure")
    elif bias == -1:
        add("structure", -1, "Lower-low structure")
    else:
        add("structure", 0, "Structure undecided")

    dir_t = "LONG" if bias == 1 else "SHORT" if bias == -1 else None
    z = fvg_retest(S, candles, i, dir_t, 12) if dir_t else None
    if z:
        add("fvg", 1 if dir_t == "LONG" else -1, f"Retest of a {'bullish' if dir_t == 'LONG' else 'bearish'} gap held")
    else:
        add("fvg", 0, "No fresh gap being retested")

    v_sum, v_k = 0.0, 0
    for q in range(max(0, i - 20), i):
        v_sum += candles[q].get("v") or 0
        v_k += 1
    v_avg = v_sum / v_k if v_k else 0
    cv = c.get("v") or 0
    if not (cv > 0) or not (v_avg > 0):
        add("volume", 0, "No volume data for this symbol")
    elif cv > 1.5 * v_avg and c["c"] > c["o"]:
        add("volume", 1, f"Up candle on {cv / v_avg:.1f}x average volume")
    elif cv > 1.5 * v_avg and c["c"] < c["o"]:
        add("volume", -1, f"Down candle on {cv / v_avg:.1f}x average volume")
    else:
        add("volume", 0, "Volume is ordinary")

    if news_label:
        add("news", 1 if news_label == "BULLISH" else -1 if news_label == "BEARISH" else 0, f"Headlines are {news_label.lower()}")

    score = sum(v["vote"] * v["weight"] for v in votes)
    max_score = sum(v["weight"] for v in votes)
    call, why = "WAIT", ""
    if adx_v < MIN_ADX:
        why = f"ADX {adx_v:.0f} is below {MIN_ADX}: range-bound, no call"
    elif score >= CALL_SCORE:
        call = "BUY CE"
    elif score <= -CALL_SCORE:
        call = "BUY PE"
    else:
        why = f"Votes are mixed (score {score:+d} of ±{max_score})"
    if call == "WAIT":
        confidence = _round(30 + 20 * abs(score) / max_score)
    else:
        confidence = min(95, _round(50 + 45 * abs(score) / max_score))
    d = 1 if call == "BUY CE" else -1 if call == "BUY PE" else (1 if score >= 0 else -1)
    levels = {"entry": price, "sl": price - d * 1.5 * atr_v, "t1": price + d * 2 * atr_v, "t2": price + d * 3.5 * atr_v, "atr": atr_v}
    return {"ok": True, "call": call, "confidence": confidence, "score": score, "maxScore": max_score, "adx": adx_v,
            "rsi": rsi_v, "price": price, "atr": atr_v, "votes": votes, "levels": levels, "reason": why, "ts": c["ts"]}


def combine(primary: dict, confirm: Optional[dict]) -> dict:
    """Primary timeframe decides; the faster timeframe must not disagree."""
    if not primary or not primary.get("ok"):
        return {**(primary or {}), "call": "WAIT", "confidence": 0, "note": (primary or {}).get("reason") or "No data"}
    out = {**primary, "note": primary.get("reason") or ""}
    if not confirm or not confirm.get("ok") or primary["call"] == "WAIT":
        return out
    pc, cc = primary["call"], confirm["call"]
    if (pc == "BUY CE" and cc == "BUY PE") or (pc == "BUY PE" and cc == "BUY CE"):
        return {**out, "call": "WAIT", "confidence": 40,
                "note": f"{pc} on the slower chart is contradicted by {cc} on the faster chart"}
    if cc == pc:
        return {**out, "confidence": min(97, primary["confidence"] + 5), "note": "Both timeframes agree"}
    return out
