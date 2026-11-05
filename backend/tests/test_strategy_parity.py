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
