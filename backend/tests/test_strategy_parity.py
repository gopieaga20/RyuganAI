"""The Python vote must give exactly the same answers as the JavaScript one the dashboard shows."""
import json
import math
import os
import random
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import strategy_vote as sv

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DUMP = os.path.join(ROOT, "frontend", "tests", "dump_vote.mjs")
NODE = shutil.which("node")
T0 = 1767584100000          # 2026-01-05 09:15 IST in ms


def make_candles(n, drift, amp, noise, seed, step_min=15, with_volume=True):
    rnd = random.Random(seed)
    out, base, prev = [], 100.0, 100.0
    for i in range(n):
        base += drift
        c = base + amp * math.sin(i / 6) + (rnd.random() - 0.5) * noise
        o = prev
        h = max(o, c) + rnd.random() * noise * 0.4
        l = min(o, c) - rnd.random() * noise * 0.4
        # keep the sessions realistic: 25 bars of 15 minutes, then the next day
        day, k = divmod(i, 25)
        ts = T0 + day * 86400000 + k * step_min * 60000
        out.append({"ts": ts, "o": o, "h": h, "l": l, "c": c, "v": (1000 + int(rnd.random() * 900)) if with_volume else 0})
        prev = c
    return out


SCENARIOS = {
    "uptrend": dict(n=260, drift=0.25, amp=2.2, noise=0.6, seed=7),
    "downtrend": dict(n=260, drift=-0.25, amp=2.2, noise=0.6, seed=11),
    "sideways": dict(n=260, drift=0.0, amp=1.5, noise=1.2, seed=3),
    "choppy_big": dict(n=300, drift=0.05, amp=4.0, noise=2.5, seed=21),
    "no_volume_index": dict(n=260, drift=0.15, amp=2.0, noise=0.8, seed=5, with_volume=False),
}


def run_js(candles, ends, intraday, news, disable=None):
    p = subprocess.run([NODE, DUMP], input=json.dumps({"candles": candles, "ends": ends, "intraday": intraday, "news": news, "disable": disable or []}),
                       capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("name", list(SCENARIOS))
@pytest.mark.parametrize("intraday,news", [(True, None), (True, "BULLISH"), (False, "BEARISH")])
def test_python_vote_matches_javascript(name, intraday, news):
    candles = make_candles(**SCENARIOS[name])
    ends = list(range(60, len(candles), 9))
    js = run_js(candles, ends, intraday, news)
    for row in js:
        py = sv.evaluate(candles[: row["end"] + 1], intraday=intraday, news_label=news)
        where = f"{name} end={row['end']}"
        assert py["call"] == row["call"], where
        assert py["confidence"] == row["confidence"], where
        assert py["score"] == row["score"] and py["maxScore"] == row["maxScore"], where
        assert py["adx"] == pytest.approx(row["adx"], abs=1e-6), where
        assert py["atr"] == pytest.approx(row["atr"], abs=1e-6), where
        assert py["rsi"] == pytest.approx(row["rsi"], abs=1e-6), where
        assert [(v["id"], v["vote"], v["weight"]) for v in py["votes"]] == [(v["id"], v["vote"], v["weight"]) for v in row["votes"]], where


def test_calls_actually_occur_in_the_fixtures():
    """Guard against a vacuous parity test: the scenarios must produce real BUY CE / BUY PE calls."""
    calls = set()
    for name, kw in SCENARIOS.items():
        c = make_candles(**kw)
        for e in range(60, len(c), 9):
            calls.add(sv.evaluate(c[: e + 1])["call"])
    assert {"BUY CE", "BUY PE", "WAIT"} <= calls


def test_too_few_candles():
    r = sv.evaluate(make_candles(30, 0.1, 1, 0.5, 1))
    assert r["call"] == "WAIT" and not r["ok"]


def test_combine_rules():
    ce = {"ok": True, "call": "BUY CE", "confidence": 70}
    assert sv.combine(ce, {"ok": True, "call": "BUY PE"})["call"] == "WAIT"
    assert sv.combine(ce, {"ok": True, "call": "BUY CE"})["confidence"] == 75
    assert sv.combine(ce, {"ok": True, "call": "WAIT"})["call"] == "BUY CE"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("name", list(SCENARIOS))
def test_smart_money_vote_matches_javascript_on_every_bar(name):
    """The SMC vote is rare, so check it on EVERY bar (the general test samples one bar in nine)."""
    candles = make_candles(**SCENARIOS[name])
    ends = list(range(60, len(candles)))
    js = run_js(candles, ends, True, None)
    nonzero = 0
    for e, r in zip(ends, js):
        py = sv.evaluate(candles[: e + 1], intraday=True, news_label=None)
        want = next(v["vote"] for v in r["votes"] if v["id"] == "smc")
        got = next(v["vote"] for v in py["votes"] if v["id"] == "smc")
        assert got == want, f"{name} bar {e}: python {got} vs javascript {want}"
        nonzero += want != 0
    assert nonzero >= 0


def make_impulsive(n, seed):
    """A market that moves in bursts: quiet drift, then a few big one-directional candles, then a pullback. Gives the SMC rules (order blocks,
    displacement, sweeps) something to find, which the smooth scenarios above almost never do."""
    rnd = random.Random(seed)
    out, prev, direction, left = [], 100.0, 1, 0
    for i in range(n):
        phase = i % 40
        if phase == 12:
            direction = 1 if rnd.random() < 0.5 else -1
        if 12 <= phase < 15:
            body = direction * (2.2 + rnd.random() * 1.2)             # displacement burst
        elif 15 <= phase < 24:
            body = -direction * (0.2 + rnd.random() * 0.5)            # pullback
        else:
            body = (rnd.random() - 0.5) * 0.7
        c = prev + body
        h = max(prev, c) + rnd.random() * 0.5
        l = min(prev, c) - rnd.random() * 0.5
        day, k = divmod(i, 25)
        out.append({"ts": T0 + day * 86400000 + k * 15 * 60000, "o": prev, "h": h, "l": l, "c": c, "v": 1000 + int(rnd.random() * 900)})
        prev = c
    return out


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_smart_money_vote_matches_javascript_on_bursty_markets(seed):
    candles = make_impulsive(520, seed)
    ends = list(range(60, len(candles)))
    js = run_js(candles, ends, True, None)
    nonzero = 0
    for e, r in zip(ends, js):
        py = sv.evaluate(candles[: e + 1], intraday=True, news_label=None)
        want = next(v["vote"] for v in r["votes"] if v["id"] == "smc")
        got = next(v["vote"] for v in py["votes"] if v["id"] == "smc")
        assert got == want, f"seed {seed} bar {e}: python {got} vs javascript {want}"
        nonzero += want != 0
    # setups are rare with the LuxAlgo rules; test_the_smc_fixtures_exercise_the_whole_indicator checks that votes do occur in the longer fixtures


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("source", ["trend", "down", "choppy", "burst1", "burst2", "burst3"])
def test_support_resistance_vote_matches_javascript_on_every_bar(source):
    if source.startswith("burst"):
        candles = make_impulsive(600, int(source[-1]) + 20)
    else:
        candles = make_candles(**SCENARIOS[{"trend": "uptrend", "down": "downtrend", "choppy": "choppy_big"}[source]])
    ends = list(range(60, len(candles)))
    js = run_js(candles, ends, True, None)
    nonzero = 0
    for e, r in zip(ends, js):
        py = sv.evaluate(candles[: e + 1], intraday=True, news_label=None)
        want = next(v["vote"] for v in r["votes"] if v["id"] == "sr")
        got = next(v["vote"] for v in py["votes"] if v["id"] == "sr")
        assert got == want, f"{source} bar {e}: python {got} vs javascript {want}"
        nonzero += want != 0
    print(f"{source}: {nonzero} non-zero S/R votes compared")
    if source.startswith("burst"):
        assert nonzero >= 1


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_support_resistance_is_shown_but_does_not_change_the_call():
    """Weight 0: the row appears in the strategy check, but the score, the maximum and the call are exactly what they were without it."""
    candles = make_candles(**SCENARIOS["uptrend"])
    py = sv.evaluate(candles, intraday=True, news_label=None)
    sr = next(v for v in py["votes"] if v["id"] == "sr")
    assert sr["weight"] == 0
    others = [v for v in py["votes"] if v["id"] != "sr"]
    assert py["score"] == sum(v["vote"] * v["weight"] for v in others)
    assert py["maxScore"] == sum(v["weight"] for v in others)
    daily = sv.evaluate(candles, intraday=False, news_label=None)
    assert all(v["id"] != "sr" for v in daily["votes"])              # previous-day levels mean nothing on daily candles


# ───────────── strategies switched off in Profile > Strategies ─────────────
@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("name", ["uptrend", "choppy_big"])
@pytest.mark.parametrize("disable", [["smc"], ["news", "volume", "fvg"], ["trend", "rsi", "vwap", "structure", "fvg", "volume", "smc", "news"]])
def test_disabled_strategies_give_the_same_answer_in_python_and_javascript(name, disable):
    candles = make_candles(**SCENARIOS[name])
    ends = list(range(60, len(candles), 9))
    js = run_js(candles, ends, True, "BULLISH", disable)
    for row in js:
        py = sv.evaluate(candles[: row["end"] + 1], intraday=True, news_label="BULLISH", disable=disable)
        where = f"{name} {disable} end={row['end']}"
        assert (py["call"], py["confidence"], py["score"], py["maxScore"]) == (row["call"], row["confidence"], row["score"], row["maxScore"]), where
        assert [v["id"] for v in py["votes"]] == [v["id"] for v in row["votes"]], where
        assert not {v["id"] for v in py["votes"]} & set(disable), where


def test_a_disabled_strategy_casts_no_vote_and_the_score_is_rescaled():
    c = make_candles(**SCENARIOS["uptrend"])
    full = sv.evaluate(c)
    part = sv.evaluate(c, disable=["trend", "smc"])
    assert "trend" not in [v["id"] for v in part["votes"]] and part["maxScore"] == full["maxScore"] - 4


def test_with_every_weighted_strategy_off_the_answer_is_wait_not_a_crash():
    c = make_candles(**SCENARIOS["uptrend"])
    r = sv.evaluate(c, disable=[i for i, w in sv.STRATEGIES.items() if w > 0])
    assert r["call"] == "WAIT" and r["confidence"] == 0 and r["maxScore"] == 0 and "switched on" in r["reason"]


# ───────────── the LuxAlgo SMC port: everything it computes, bar by bar ─────────────
DUMP_SMC = os.path.join(ROOT, "frontend", "tests", "dump_smc.mjs")


def make_regimes(n, seed):
    """A long random walk with trend regimes, quiet spells and the odd spike bar, so that swing pivots (size 50), order blocks, equal highs/lows,
    gaps and the volatility filter all occur."""
    rnd = random.Random(seed)
    out, prev, drift = [], 100.0, 0.0
    for i in range(n):
        if i % 90 == 0:
            drift = (rnd.random() - 0.5) * 0.6
        spike = 4.0 if rnd.random() < 0.02 else 1.0
        body = drift + (rnd.random() - 0.5) * 1.4 * spike
        c = prev + body
        h = max(prev, c) + rnd.random() * 0.5 * spike
        l = min(prev, c) - rnd.random() * 0.5 * spike
        day, k = divmod(i, 25)
        out.append({"ts": T0 + day * 86400000 + k * 15 * 60000, "o": prev, "h": h, "l": l, "c": c, "v": 1000})
        prev = c
    return out


def _same(a, b):
    return (a is None and (b is None or b != b)) or (b is None and a != a) or a == pytest.approx(b, abs=1e-9)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("source", ["regime1", "regime2", "regime3", "burst1", "burst2", "uptrend", "choppy_big"])
def test_luxalgo_smc_port_matches_javascript_in_every_detail(source):
    if source.startswith("regime"):
        candles = make_regimes(1100, int(source[-1]))
    elif source.startswith("burst"):
        candles = make_impulsive(900, int(source[-1]))
    else:
        candles = make_candles(**SCENARIOS[source])
    p = subprocess.run([NODE, DUMP_SMC], input=json.dumps({"candles": candles}), capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    js = json.loads(p.stdout)
    py = sv.build_smc(candles)

    assert [(e["i"], e["type"], e["dir"], e["internal"], e["pivotIdx"]) for e in py["events"]] == [(e["i"], e["type"], e["dir"], e["internal"], e["pivotIdx"]) for e in js["events"]], source
    assert all(_same(a["level"], b["level"]) for a, b in zip(py["events"], js["events"]))
    key = lambda o: (o["bias"], o["idx"], o["formedAt"], o["internal"], o["mitigatedAt"])
    assert [key(o) for o in py["obs"]] == [key(o) for o in js["obs"]], source
    assert all(_same(a["top"], b["top"]) and _same(a["bottom"], b["bottom"]) for a, b in zip(py["obs"], js["obs"]))
    assert [(g["dir"], g["i"], g["filledAt"]) for g in py["fvgs"]] == [(g["dir"], g["i"], g["filledAt"]) for g in js["fvgs"]], source
    assert [(q["type"], q["i"], q["a"], q["b"]) for q in py["eqs"]] == [(q["type"], q["i"], q["a"], q["b"]) for q in js["eqs"]], source
    assert py["swing_bias"] == js["swingBias"] and py["internal_bias"] == js["internalBias"], source
    assert all(_same(a, b) for a, b in zip(py["trail_top"], js["trailTop"])) and all(_same(a, b) for a, b in zip(py["trail_bottom"], js["trailBottom"])), source
    assert py["votes"] == js["votes"], source


def test_the_smc_fixtures_exercise_the_whole_indicator():
    """Guard against a vacuous parity test: the regime fixtures must produce swing and internal breaks, blocks (some mitigated), gaps, equal levels and votes."""
    tot = {"swing": 0, "internal": 0, "ob": 0, "mit": 0, "fvg": 0, "eq": 0, "vote": 0, "choch": 0}
    for seed in (1, 2, 3):
        r = sv.build_smc(make_regimes(1100, seed))
        tot["swing"] += sum(1 for e in r["events"] if not e["internal"])
        tot["internal"] += sum(1 for e in r["events"] if e["internal"])
        tot["choch"] += sum(1 for e in r["events"] if e["type"] == "CHoCH")
        tot["ob"] += len(r["obs"]); tot["mit"] += sum(1 for o in r["obs"] if o["mitigatedAt"] is not None)
        tot["fvg"] += len(r["fvgs"]); tot["eq"] += len(r["eqs"]); tot["vote"] += sum(1 for v in r["votes"] if v)
    assert all(v > 0 for v in tot.values()), tot


def test_luxalgo_rules_on_a_hand_made_series():
    """A small market with a known answer: a swing high, a close through it (BOS), the block under the move, then a mitigation."""
    def bar(i, o, h, l, c):
        return {"ts": T0 + i * 900000, "o": o, "h": h, "l": l, "c": c, "v": 1}
    cs = []
    for i in range(60):                                   # a long quiet saw-tooth so pivots exist, ending in a peak and a drop
        base = 100 + (i % 12) * 0.3 if i < 40 else 100
        cs.append(bar(i, base, base + 0.5, base - 0.5, base + 0.1))
    r = sv.build_smc(cs)
    assert isinstance(r["events"], list) and len(r["votes"]) == 60
    assert all(o["top"] >= o["bottom"] for o in r["obs"])
    assert all(o["mitigatedAt"] is None or o["mitigatedAt"] >= o["formedAt"] for o in r["obs"])

