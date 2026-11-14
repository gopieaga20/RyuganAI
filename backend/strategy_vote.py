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
    "trend": 2, "rsi": 1, "vwap": 1, "structure": 2, "fvg": 1, "volume": 1, "smc": 2, "sr": 0, "news": 1,
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


# ───────────── smart money concepts: port of 'Smart Money Concepts [LuxAlgo]' (CC BY-NC-SA 4.0), same rules as frontend/js/smc.js ─────────────
def pivots(candles, i, k=3):
    out = []
    for j in range(k, i - k + 1):
        is_h = is_l = True
        for q in range(j - k, j + k + 1):
            if q == j:
                continue
            if candles[q]["h"] >= candles[j]["h"]:
                is_h = False
            if candles[q]["l"] <= candles[j]["l"]:
                is_l = False
        if is_h:
            out.append({"idx": j, "price": candles[j]["h"], "type": "H"})
        if is_l:
            out.append({"idx": j, "price": candles[j]["l"], "type": "L"})
    return out


NAN = float("nan")
SWING_SIZE, INTERNAL_SIZE, EQUAL_SIZE, EQUAL_THRESHOLD, ATR_LENGTH, MAX_BLOCKS = 50, 5, 3, 0.1, 200, 100
BULL, BEAR = 1, -1


def _isnan(x):
    return x != x


def _atr_series(candles, length):
    n = len(candles)
    out = [NAN] * n
    total, rma = 0.0, NAN
    for i in range(n):
        c = candles[i]
        if i == 0:
            tr = c["h"] - c["l"]
        else:
            pc = candles[i - 1]["c"]
            tr = max(c["h"] - c["l"], abs(c["h"] - pc), abs(c["l"] - pc))
        if i < length:
            total += tr
            if i == length - 1:
                rma = total / length
                out[i] = rma
        else:
            rma = (rma * (length - 1) + tr) / length
            out[i] = rma
    return out


def _new_pivot():
    return {"level": NAN, "last": NAN, "crossed": False, "idx": -1, "prev": NAN}


def build_smc(candles):
    """Port of 'Smart Money Concepts [LuxAlgo]' (c) LuxAlgo, CC BY-NC-SA 4.0: same rules as frontend/js/smc.js (see the notes there).
    Returns the events, order blocks, gaps, equal highs/lows, trailing range, both trends and this app's SMC vote per bar; `last` is the
    full reading at the final bar."""
    n = len(candles)
    atr = _atr_series(candles, ATR_LENGTH)
    parsed_h, parsed_l = [0.0] * n, [0.0] * n
    events, obs, fvgs, eqs = [], [], [], []
    trail_top, trail_bottom = [NAN] * n, [NAN] * n
    swing_bias, internal_bias, votes = [0] * n, [0] * n, [0] * n
    swing_high, swing_low, internal_high, internal_low = _new_pivot(), _new_pivot(), _new_pivot(), _new_pivot()
    equal_high, equal_low = _new_pivot(), _new_pivot()
    legs = {"swing": {"leg": 0, "prev": 0}, "internal": {"leg": 0, "prev": 0}, "equal": {"leg": 0, "prev": 0}}
    trailing = {"top": NAN, "bottom": NAN}
    trend = {"swing": 0, "internal": 0}
    live = {"internal": [], "swing": []}
    live_fvg = []
    cum_delta = 0.0
    last = None

    def structure(i, size, st, equal_hl, internal):
        if i >= size:
            hi, lo = -float("inf"), float("inf")
            for q in range(i - size + 1, i + 1):
                if candles[q]["h"] > hi:
                    hi = candles[q]["h"]
                if candles[q]["l"] < lo:
                    lo = candles[q]["l"]
            if candles[i - size]["h"] > hi:
                st["leg"] = 0
            elif candles[i - size]["l"] < lo:
                st["leg"] = 1
        change = (st["leg"] - st["prev"]) if i >= 1 else 0
        st["prev"] = st["leg"]
        if change == 0:
            return
        p = candles[i - size]
        if change == 1:
            pv = equal_low if equal_hl else internal_low if internal else swing_low
            if equal_hl and abs(pv["level"] - p["l"]) < EQUAL_THRESHOLD * atr[i]:
                eqs.append({"type": "EQL", "i": i, "level": p["l"], "a": pv["idx"], "b": i - size})
            pv["last"], pv["level"], pv["crossed"], pv["idx"] = pv["level"], p["l"], False, i - size
            if not equal_hl and not internal:
                trailing["bottom"] = pv["level"]
        else:
            pv = equal_high if equal_hl else internal_high if internal else swing_high
            if equal_hl and abs(pv["level"] - p["h"]) < EQUAL_THRESHOLD * atr[i]:
                eqs.append({"type": "EQH", "i": i, "level": p["h"], "a": pv["idx"], "b": i - size})
            pv["last"], pv["level"], pv["crossed"], pv["idx"] = pv["level"], p["h"], False, i - size
            if not equal_hl and not internal:
                trailing["top"] = pv["level"]

    def store_block(i, pv, internal, bias):
        arr = parsed_h if bias == BEAR else parsed_l
        best = pv["idx"]
        for q in range(pv["idx"], i):
            if (arr[q] > arr[best]) if bias == BEAR else (arr[q] < arr[best]):
                best = q
        ob = {"bias": bias, "top": parsed_h[best], "bottom": parsed_l[best], "idx": best, "formedAt": i, "internal": internal, "mitigatedAt": None}
        obs.append(ob)
        lst = live["internal"] if internal else live["swing"]
        if len(lst) >= MAX_BLOCKS:
            lst.pop()
        lst.insert(0, ob)

    def display(i, internal):
        c = candles[i]
        prev_close = candles[i - 1]["c"] if i >= 1 else NAN
        hi = internal_high if internal else swing_high
        lo = internal_low if internal else swing_low
        key = "internal" if internal else "swing"
        up = (not _isnan(hi["level"])) and (not _isnan(hi["prev"])) and c["c"] > hi["level"] and prev_close <= hi["prev"]
        if up and not hi["crossed"] and ((internal_high["level"] != swing_high["level"]) if internal else True):
            typ = "CHoCH" if trend[key] == BEAR else "BOS"
            hi["crossed"] = True
            trend[key] = BULL
            events.append({"i": i, "type": typ, "dir": "LONG", "level": hi["level"], "pivotIdx": hi["idx"], "internal": internal})
            store_block(i, hi, internal, BULL)
        down = (not _isnan(lo["level"])) and (not _isnan(lo["prev"])) and c["c"] < lo["level"] and prev_close >= lo["prev"]
        if down and not lo["crossed"] and ((internal_low["level"] != swing_low["level"]) if internal else True):
            typ = "CHoCH" if trend[key] == BULL else "BOS"
            lo["crossed"] = True
            trend[key] = BEAR
            events.append({"i": i, "type": typ, "dir": "SHORT", "level": lo["level"], "pivotIdx": lo["idx"], "internal": internal})
            store_block(i, lo, internal, BEAR)

    def mitigate(i, lst):
        c = candles[i]
        for k in range(len(lst) - 1, -1, -1):
            ob = lst[k]
            if (ob["bias"] == BEAR and c["h"] > ob["top"]) or (ob["bias"] == BULL and c["l"] < ob["bottom"]):
                ob["mitigatedAt"] = i
                del lst[k]

    def read(i, full):
        c = candles[i]
        bias = trend["internal"]

        def zero(reason):
            return {"vote": 0, "reason": reason, "bias": bias, "swing": trend["swing"], "ob": None, "eq": None, "zone": 0}
        if not bias:
            return zero("Structure undecided: no SMC setup")
        word = "Bullish" if bias > 0 else "Bearish"
        if trend["swing"] == -bias:
            return zero(f"{word} internal structure but the swing structure points the other way")
        hit = None
        for ob in sorted(live["internal"] + live["swing"], key=lambda o: -o["formedAt"]):
            if ob["bias"] != bias or ob["formedAt"] >= i:
                continue
            tapped = (c["l"] <= ob["top"] and c["c"] > c["o"]) if bias > 0 else (c["h"] >= ob["bottom"] and c["c"] < c["o"])
            if tapped:
                hit = ob
                break
        eq = (trailing["top"] + trailing["bottom"]) / 2
        zone = 0 if _isnan(eq) else (1 if c["c"] < eq else -1 if c["c"] > eq else 0)
        base = {"bias": bias, "swing": trend["swing"], "ob": hit, "eq": None if _isnan(eq) else eq, "zone": zone}
        if not hit:
            return {**base, "vote": 0, "reason": f"{word} structure but price is not tapping an order block" if full else ""}
        if zone != bias:
            half = "middle" if zone == 0 else "discount" if zone > 0 else "premium"
            return {**base, "vote": 0, "reason": f"{word} setup at an order block, but price is in the {half} half: wait for {'discount' if bias > 0 else 'premium'}" if full else ""}
        return {**base, "vote": bias, "reason": f"{word} structure, {'internal' if hit['internal'] else 'swing'} order block {hit['bottom']:.2f}-{hit['top']:.2f} tapped in the {'discount' if bias > 0 else 'premium'} half" if full else ""}

    for i in range(n):
        c = candles[i]
        hv = (c["h"] - c["l"]) >= 2 * atr[i]
        parsed_h[i] = c["l"] if hv else c["h"]
        parsed_l[i] = c["h"] if hv else c["l"]
        trailing["top"] = NAN if _isnan(trailing["top"]) else max(c["h"], trailing["top"])
        trailing["bottom"] = NAN if _isnan(trailing["bottom"]) else min(c["l"], trailing["bottom"])

        for k in range(len(live_fvg) - 1, -1, -1):
            g = live_fvg[k]
            if (g["dir"] == "LONG" and c["l"] < g["bottom"]) or (g["dir"] == "SHORT" and c["h"] > g["top"]):
                g["filledAt"] = i
                del live_fvg[k]

        structure(i, SWING_SIZE, legs["swing"], False, False)
        structure(i, INTERNAL_SIZE, legs["internal"], False, True)
        structure(i, EQUAL_SIZE, legs["equal"], True, False)
        display(i, True)
        display(i, False)
        mitigate(i, live["internal"])
        mitigate(i, live["swing"])
        for p in (internal_high, internal_low, swing_high, swing_low):
            p["prev"] = p["level"]

        if i >= 1:
            last_close, last_open = candles[i - 1]["c"], candles[i - 1]["o"]
            delta = (last_close - last_open) / (last_open * 100)
            cum_delta += abs(delta)
            if i >= 2:
                thr = cum_delta / i * 2
                h2, l2 = candles[i - 2]["h"], candles[i - 2]["l"]
                if c["l"] > h2 and last_close > h2 and delta > thr:
                    g = {"dir": "LONG", "top": c["l"], "bottom": h2, "i": i, "filledAt": None}
                    fvgs.append(g)
                    live_fvg.append(g)
                if c["h"] < l2 and last_close < l2 and -delta > thr:
                    g = {"dir": "SHORT", "top": c["h"], "bottom": l2, "i": i, "filledAt": None}
                    fvgs.append(g)
                    live_fvg.append(g)

        trail_top[i], trail_bottom[i] = trailing["top"], trailing["bottom"]
        swing_bias[i], internal_bias[i] = trend["swing"], trend["internal"]
        is_last = i == n - 1
        r = read(i, is_last)
        votes[i] = r["vote"]
        if is_last:
            last = r
    return {"events": events, "obs": obs, "fvgs": fvgs, "eqs": eqs, "trail_top": trail_top, "trail_bottom": trail_bottom,
            "swing_bias": swing_bias, "internal_bias": internal_bias, "votes": votes,
            "last": last or {"vote": 0, "reason": "No data", "bias": 0, "swing": 0, "ob": None, "eq": None, "zone": 0}}


def smc_signal(candles):
    """The SMC reading at the last candle: {vote, reason, bias, swing, ob, eq, zone}."""
    if len(candles) < 2:
        return {"vote": 0, "reason": "No data", "bias": 0, "swing": 0, "ob": None, "eq": None, "zone": 0}
    return build_smc(candles)["last"]


# ───────────── support and resistance (same rules as frontend/js/sr.js) ─────────────
def session_levels(candles, i):
    day = ist_day(candles[i]["ts"])
    start = i
    while start > 0 and ist_day(candles[start - 1]["ts"]) == day:
        start -= 1
    if start == 0:
        return None
    prev_day = ist_day(candles[start - 1]["ts"])
    hi, lo, q = float("-inf"), float("inf"), start - 1
    while q >= 0 and ist_day(candles[q]["ts"]) == prev_day:
        hi = max(hi, candles[q]["h"])
        lo = min(lo, candles[q]["l"])
        q -= 1
    return {"pdh": hi, "pdl": lo, "pdc": candles[start - 1]["c"], "start": start}


def avg_range(candles, i, n=14):
    s, k = 0.0, 0
    for q in range(max(0, i - n), i):
        s += candles[q]["h"] - candles[q]["l"]
        k += 1
    return s / k if k else 0


def sr_signal(candles, i, k=3):
    none = {"vote": 0, "kind": None, "reason": "No previous session to take levels from"}
    L = session_levels(candles, i)
    if not L:
        return none
    c = candles[i]
    rng = c["h"] - c["l"]
    atr_v = avg_range(candles, i)
    buf = 0.1 * atr_v
    out = {"vote": 0, "kind": None, "reason": "Inside the previous day's range, no level event"}
    if not (rng > 0) or not (atr_v > 0):
        return out

    def strong(direction):
        if direction > 0:
            return c["c"] > c["o"] and (c["c"] - c["l"]) / rng >= 0.6
        return c["c"] < c["o"] and (c["h"] - c["c"]) / rng >= 0.6

    brk = 0
    if c["c"] > L["pdh"] + buf and strong(1):
        for q in range(max(0, i - 3), i):
            if candles[q]["c"] <= L["pdh"]:
                brk = 1
                break
    elif c["c"] < L["pdl"] - buf and strong(-1):
        for q in range(max(0, i - 3), i):
            if candles[q]["c"] >= L["pdl"]:
                brk = -1
                break

    rtst = 0
    if not brk:
        frm = max(L["start"], i - 24)
        up_broke = down_broke = False
        for q in range(frm, i):
            if candles[q]["c"] > L["pdh"] + buf:
                up_broke = True
            if candles[q]["c"] < L["pdl"] - buf:
                down_broke = True
        if up_broke and not down_broke and c["l"] <= L["pdh"] + 0.15 * atr_v and c["c"] > L["pdh"] and c["c"] > c["o"]:
            rtst = 1
        elif down_broke and not up_broke and c["h"] >= L["pdl"] - 0.15 * atr_v and c["c"] < L["pdl"] and c["c"] < c["o"]:
            rtst = -1

    rev = 0
    pv = pivots(candles, i, k)
    res, sup = [L["pdh"]], [L["pdl"]]
    nh = nl = 0
    for q in range(len(pv) - 1, -1, -1):
        if not (nh < 2 or nl < 2):
            break
        if pv[q]["type"] == "H" and nh < 2:
            res.append(pv[q]["price"])
            nh += 1
        if pv[q]["type"] == "L" and nl < 2:
            sup.append(pv[q]["price"])
            nl += 1
    upper_wick = (c["h"] - max(c["o"], c["c"])) / rng
    lower_wick = (min(c["o"], c["c"]) - c["l"]) / rng
    for lv in res:
        if c["h"] > lv and c["c"] < lv and c["c"] < c["o"] and upper_wick >= 0.4:
            rev = -1
            break
    if not rev:
        for lv in sup:
            if c["l"] < lv and c["c"] > lv and c["c"] > c["o"] and lower_wick >= 0.4:
                rev = 1
                break

    signs = [x for x in (brk, rtst, rev) if x]
    if not signs:
        return out
    if any(x != signs[0] for x in signs):
        return {"vote": 0, "kind": None, "reason": "Level signals conflict on this bar, no call"}
    vote = signs[0]
    kind = "breakout" if brk else "retest" if rtst else "rejection"
    word = {"breakout": "Fresh breakout above the previous day high" if vote > 0 else "Fresh breakdown below the previous day low",
            "retest": "Break-and-retest: the previous day " + ("high held as support" if vote > 0 else "low held as resistance"),
            "rejection": "Rejection at " + ("support" if vote > 0 else "resistance") + ": a wick took the level and price closed back"}[kind]
    return {"vote": vote, "kind": kind, "reason": word}


# ───────────── the vote (same rules as strategies.js evaluate) ─────────────
def evaluate(candles, intraday: bool = True, news_label: Optional[str] = None, swing_k: int = 3, disable=None, rule: str = "score") -> dict:
    """`disable`: strategy ids left out of the vote (Profile > Strategies). `rule`: "score" = the weighted score must reach +-3; "all" = every switched-on
    strategy that carries weight must vote the same way. Same rules as strategies.js `opts.disable` / `opts.callRule`."""
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
    off = set(disable or ())

    def add(id_, vote, reason):
        if id_ in off:
            return
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

    sm = {"vote": 0, "reason": "switched off"} if "smc" in off else smc_signal(candles)
    add("smc", sm["vote"], sm["reason"])

    if intraday:
        sr = sr_signal(candles, i, swing_k)
        add("sr", sr["vote"], sr["reason"])

    if news_label:
        add("news", 1 if news_label == "BULLISH" else -1 if news_label == "BEARISH" else 0, f"Headlines are {news_label.lower()}")

    score = sum(v["vote"] * v["weight"] for v in votes)
    max_score = sum(v["weight"] for v in votes)
    call, why = "WAIT", ""
    if max_score <= 0:
        why = "No strategy with a vote weight is switched on"
    elif adx_v < MIN_ADX:
        why = f"ADX {adx_v:.0f} is below {MIN_ADX}: range-bound, no call"
    elif rule == "all":
        voters = [v["vote"] for v in votes if v["weight"] > 0]
        if all(x == 1 for x in voters):
            call = "BUY CE"
        elif all(x == -1 for x in voters):
            call = "BUY PE"
        else:
            why = f"Not every switched-on strategy agrees ({sum(1 for x in voters if x == 1)} up, {sum(1 for x in voters if x == -1)} down, {sum(1 for x in voters if x == 0)} neutral)"
    elif score >= CALL_SCORE:
        call = "BUY CE"
    elif score <= -CALL_SCORE:
        call = "BUY PE"
    else:
        why = f"Votes are mixed (score {score:+d} of ±{max_score})"
    if max_score <= 0:
        confidence = 0
    elif call == "WAIT":
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
