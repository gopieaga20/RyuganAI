import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import screener_tech as st

DAY = 86400000
T0 = 1767571200000


def candle(i, o, h, l, c, v=1000, deliv=None):
    d = {"ts": T0 + i * DAY, "o": o, "h": h, "l": l, "c": c, "v": v}
    if deliv is not None:
        d["deliv_per"] = deliv
    return d


def uptrend(n=300, start=100.0, step=0.4):
    out, p = [], start
    for i in range(n):
        o = p
        p += step
        out.append(candle(i, o, p + 0.3, o - 0.3, p))
    return out


def with_base_and_breakout(vol_mult=2.0, base_range=0.06, rise_after=0.0):
    """260 rising bars, 20 bars of a tight base, then a breakout bar on volume."""
    cs = uptrend(260)
    top = cs[-1]["c"]
    lo, hi = top * (1 - base_range), top
    for k in range(20):
        i = len(cs)
        mid = (lo + hi) / 2 + (0.2 if k % 2 else -0.2)
        cs.append(candle(i, mid, min(hi, mid + 0.5), max(lo, mid - 0.5), mid))
    cs[-8]["l"] = lo                                                                       # one candle reaches the bottom of the base, so its range is really base_range
    res = max(c["h"] for c in cs[-20:])
    i = len(cs)
    close = res + 0.8 + rise_after
    cs.append(candle(i, res - 0.2, close + 0.3, res - 0.3, close, v=int(1000 * vol_mult)))
    return cs


# ───────────── indicators ─────────────
def test_wilder_rsi_extremes_and_range():
    up = [100 + i for i in range(40)]
    assert st.rsi_wilder(up)[-1] == 100.0
    assert st.rsi_wilder([100 - i * 0.5 for i in range(40)])[-1] < 1
    alt = [100 + (i % 2) for i in range(60)]
    assert 40 < st.rsi_wilder(alt)[-1] < 60
    assert math.isnan(st.rsi_wilder(up)[5]) and len(st.rsi_wilder(up)) == 40


def test_the_volume_average_uses_only_the_prior_20_sessions():
    cs = [candle(i, 10, 11, 9, 10, v=100) for i in range(30)]
    cs[25]["v"] = 10000                                         # a spike today must not raise today's own average
    ind = st.indicators(cs)
    assert ind["vol_sma"][25] == pytest.approx(100.0) and ind["vol_sma"][26] == pytest.approx((19 * 100 + 10000) / 20)
    assert math.isnan(ind["vol_sma"][19]) and ind["vol_sma"][20] == pytest.approx(100.0)


def test_the_52_week_high_window():
    cs = uptrend(300)
    ind = st.indicators(cs)
    assert ind["hh52"][-1] == max(c["h"] for c in cs[-252:]) and ind["hh52"][10] == max(c["h"] for c in cs[:11])


def test_indicators_do_not_look_ahead():
    cs = uptrend(320)
    full, part = st.indicators(cs), st.indicators(cs[:290])
    for k in ("ema20", "ema50", "ema200", "atr", "hh52"):
        assert full[k][289] == pytest.approx(part[k][289])
    assert full["rsi"][289] == pytest.approx(part["rsi"][289]) and full["vol_sma"][289] == pytest.approx(part["vol_sma"][289])


# ───────────── relative strength ─────────────
def test_relative_performance_blends_three_and_six_months_against_the_benchmark():
    stock = [100 * (1 + 0.004 * i) for i in range(200)]
    bench = [100 * (1 + 0.001 * i) for i in range(200)]
    r = st.relative_performance(stock, bench, 199)
    p3, p6 = stock[199] / stock[136] - 1, stock[199] / stock[73] - 1
    b3, b6 = bench[199] / bench[136] - 1, bench[199] / bench[73] - 1
    assert r == pytest.approx(0.5 * (p3 - b3) + 0.5 * (p6 - b6)) and r > 0
    assert st.relative_performance(stock, bench, 100) is None


def test_rs_rating_is_a_percentile_with_shared_ties():
    r = st.rs_ratings({"A": 0.5, "B": 0.1, "C": -0.2, "D": 0.1, "E": None})
    assert r["A"] == 99 and r["C"] == 1 and r["B"] == r["D"] and 1 < r["B"] < 99 and "E" not in r
    assert st.rs_ratings({"X": 0.3}) == {"X": 50} and st.rs_ratings({}) == {}


# ───────────── gate and score ─────────────
def test_the_gate_needs_trend_slope_relative_strength_and_proximity():
    cs = uptrend(300)
    ind = st.indicators(cs)
    g = st.technical_gate(cs, ind, 299, 90)
    assert g["pass"] and all(g["checks"].values())
    assert not st.technical_gate(cs, ind, 299, 70)["pass"] and not st.technical_gate(cs, ind, 299, None)["pass"]
    crash = cs + [candle(300, cs[-1]["c"], cs[-1]["c"], cs[-1]["c"] * 0.70, cs[-1]["c"] * 0.72)]          # 28% under the high
    gc = st.technical_gate(crash, st.indicators(crash), 300, 90)
    assert not gc["pass"] and not gc["checks"]["proximity"]
    down = [candle(i, 200 - i * 0.3, 200.5 - i * 0.3, 199.5 - i * 0.3, 200 - (i + 1) * 0.3) for i in range(300)]
    assert not st.technical_gate(down, st.indicators(down), 299, 99)["checks"]["trend"]


def test_the_score_is_binary_points_scaled_over_the_data_that_exists():
    cs = with_base_and_breakout()
    ind = st.indicators(cs)
    brk = st.base_breakout(cs, ind, len(cs) - 1)
    full = st.technical_score(cs, ind, len(cs) - 1, 90, brk)
    assert full["parts"]["delivery"]["ok"] is None and full["available"] == 45          # delivery % unknown: those 5 points are unavailable
    assert full["earned"] == 15 + 15 + 5 + 10 and full["score"] == pytest.approx(50.0)
    cs[-1]["deliv_per"] = 62
    withd = st.technical_score(cs, ind, len(cs) - 1, 90, brk)
    assert withd["available"] == 50 and withd["earned"] == 50 and withd["parts"]["delivery"]["earned"] == 5
    cs[-1]["deliv_per"] = 30
    low = st.technical_score(cs, ind, len(cs) - 1, 60, None)
    assert low["parts"]["rs"]["earned"] == 0 and low["parts"]["delivery"]["earned"] == 0


# ───────────── setups ─────────────
def test_breakout_setup_arithmetic():
    cs = with_base_and_breakout()
    ind = st.indicators(cs)
    i = len(cs) - 1
    brk = st.base_breakout(cs, ind, i)
    assert brk and brk["vol_ratio"] >= 1.5 and brk["base_range"] <= 0.15
    s = st.breakout_setup(cs, ind, i)
    a = ind["atr"][i]
    assert s["type"] == "BREAKOUT" and s["entry"] == pytest.approx(brk["resistance"] + 0.15 * a)
    swing = min(c["l"] for c in cs[i - 9: i + 1])
    assert s["stop"] == pytest.approx(min(cs[i]["l"], swing) - 0.5 * a)
    risk = s["entry"] - s["stop"]
    assert s["t1"] == pytest.approx(s["entry"] + 2 * risk) and s["t2"] == pytest.approx(s["entry"] + 3 * risk) and s["trigger"] == "buy-stop"


def test_a_breakout_needs_volume_a_tight_base_and_no_chasing():
    weak = with_base_and_breakout(vol_mult=1.1)
    assert st.breakout_setup(weak, st.indicators(weak), len(weak) - 1) is None            # no volume
    wide = with_base_and_breakout(base_range=0.30)
    assert st.base_breakout(wide, st.indicators(wide), len(wide) - 1) is None
    chase = with_base_and_breakout(rise_after=6.0)                                         # closed far above the entry
    assert st.breakout_setup(chase, st.indicators(chase), len(chase) - 1) is None
    hot = with_base_and_breakout()
    ind = st.indicators(hot)
    ind["rsi"][-1] = 80.0
    assert st.breakout_setup(hot, ind, len(hot) - 1) is None


def pullback_fixture(room=40.0, rsi=52.0, bullish=True):
    cs = uptrend(300)
    i = 299
    ind = st.indicators(cs)
    e20 = ind["ema20"][i]
    cs[i] = candle(i, e20 - 0.2, e20 + 1.5, e20 - 0.6, e20 + 1.2) if bullish else candle(i, e20 + 0.5, e20 + 0.6, e20 - 0.9, e20 - 0.5)
    cs[i - 5]["h"] = cs[i]["c"] + room                                                      # the recent swing high
    ind = st.indicators(cs)
    ind["rsi"][i] = rsi
    ind["atr"][i] = 1.0
    return cs, ind, i


def test_pullback_setup_arithmetic_and_the_one_to_two_rule():
    cs, ind, i = pullback_fixture()
    s = st.pullback_setup(cs, ind, i)
    zone_lo = min(ind["ema20"][i], ind["ema50"][i])
    assert s and s["type"] == "PULLBACK" and s["trigger"] == "limit"
    assert s["entry"] == pytest.approx(cs[i]["c"]) and s["stop"] == pytest.approx(min(cs[i]["l"], zone_lo) - 1.0)
    assert s["t1"] == pytest.approx(max(x["h"] for x in cs[i - 30: i])) and s["rr"] >= 2 and s["t2"] >= s["t1"]
    near, ind_n, _ = pullback_fixture(room=0.5)                                             # the swing high is too close: R:R under 1:2, suppressed
    cs_n = near
    cs_n[299 - 5]["h"] = cs_n[299]["c"] + 0.5
    for k in range(299 - 30, 299):
        cs_n[k]["h"] = min(cs_n[k]["h"], cs_n[299]["c"] + 0.5)
    assert st.pullback_setup(cs_n, ind_n, 299) is None


def test_pullback_needs_rsi_in_the_zone_and_a_bullish_reversal_candle():
    cs, ind, i = pullback_fixture(rsi=72.0)
    assert st.pullback_setup(cs, ind, i) is None
    cs2, ind2, i2 = pullback_fixture(bullish=False)
    assert st.pullback_setup(cs2, ind2, i2) is None


def test_position_size():
    assert st.position_size(1_000_000, 1, 100, 95) == 2000                                  # 10,000 risk / 5 per share
    assert st.position_size(1_000_000, 1, 100, 95, max_pct_of_capital=10) == 1000           # capped at 10% of capital = 100,000
    assert st.position_size(1_000_000, 1, 100, 95, cash=30_000) == 300                      # capped by cash
    assert st.position_size(1_000_000, 1, 100, 100) == 0 and st.position_size(0, 1, 100, 95) == 0 and st.position_size(1_000_000, 1, 100, 120) == 0


# ───────────── lifecycle ─────────────
def trade(qty=1000):
    return st.new_trade(100.0, qty, 95.0, 110.0, 115.0)


def test_stop_closes_everything_and_a_gap_fills_at_the_open():
    t = trade()
    assert st.advance(t, 99, 101, 94, 96) == [(95.0, 1000, "STOP")] and t["stage"] == "CLOSED" and t["realised"] == pytest.approx(-5000)
    g = trade()
    assert st.advance(g, 92, 93, 90, 91) == [(92, 1000, "STOP (gap)")] and g["realised"] == pytest.approx(-8000)
    assert st.advance(g, 100, 120, 99, 118) == []                                           # nothing happens to a closed trade


def test_t1_sells_half_and_moves_the_stop_to_the_entry_then_t2_or_breakeven():
    t = trade()
    ex = st.advance(t, 101, 111, 100, 109, ema20=None)
    assert ex == [(110.0, 500, "T1")] and t["stage"] == "T1_DONE" and t["qty_open"] == 500 and t["stop"] == pytest.approx(100.0)      # breakeven
    ex2 = st.advance(t, 109, 116, 108, 115, ema20=104)
    assert ex2 == [(115.0, 500, "T2")] and t["stage"] == "CLOSED" and t["realised"] == pytest.approx(10 * 500 + 15 * 500)
    b = trade()
    st.advance(b, 101, 111, 100, 109, ema20=None)
    ex3 = st.advance(b, 104, 105, 99, 100)
    assert ex3 and ex3[0][2] == "BREAKEVEN / TRAIL STOP" and b["realised"] == pytest.approx(10 * 500 + 0)


def test_the_trail_only_ever_rises_and_a_same_bar_t1_t2_is_honoured():
    t = trade()
    st.advance(t, 101, 111, 100, 109, ema20=103)
    assert t["stop"] == pytest.approx(103) and t["stage"] == "TRAIL"
    st.advance(t, 109, 112, 108, 111, ema20=101)                                            # the EMA fell: the stop must not
    assert t["stop"] == pytest.approx(103)
    st.advance(t, 111, 113, 109, 112, ema20=108)
    assert t["stop"] == pytest.approx(108)
    j = trade()
    ex = st.advance(j, 109, 116, 108, 115)
    assert [e[2] for e in ex] == ["T1", "T2"] and j["stage"] == "CLOSED"


def test_a_gap_above_t1_fills_at_the_open_and_odd_quantities_round_the_half_up():
    t = trade(7)
    ex = st.advance(t, 112, 113, 111, 112)
    assert ex[0] == (112, 4, "T1") and t["qty_open"] == 3
    one = st.new_trade(100.0, 1, 95.0, 110.0, 115.0)
    assert st.advance(one, 101, 111, 100, 110) == [(110.0, 1, "T1")] and one["stage"] == "CLOSED"


def test_stop_before_target_inside_one_bar():
    t = trade()
    ex = st.advance(t, 100, 112, 94, 100)                                                   # both the stop and T1 are inside the bar: pessimistic order
    assert ex == [(95.0, 1000, "STOP")]
