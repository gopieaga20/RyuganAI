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


def run_js(candles, ends, intraday, news):
    p = subprocess.run([NODE, DUMP], input=json.dumps({"candles": candles, "ends": ends, "intraday": intraday, "news": news}),
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
    assert nonzero >= 1, "the generator should produce some SMC setups so the comparison means something"
    print(f"seed {seed}: {nonzero} non-zero SMC votes compared")


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
