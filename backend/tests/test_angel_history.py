"""Long Angel histories are fetched in capped, throttled windows and merged."""
import os
import sys
from datetime import datetime, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import angel_broker as ab


class FakeClient:
    def __init__(self, behaviour=None):
        self.calls = []
        self.behaviour = behaviour

    def getCandleData(self, historicDataParams):
        self.calls.append(historicDataParams)
        if self.behaviour:
            r = self.behaviour(len(self.calls), historicDataParams)
            if r is not None:
                return r
        start = datetime.strptime(historicDataParams["fromdate"], "%Y-%m-%d %H:%M")
        return {"status": True, "data": [[(start + timedelta(minutes=15 * k)).strftime("%Y-%m-%dT%H:%M:%S+05:30"), 1, 2, 0.5, 1.5, 100] for k in range(3)]}


@pytest.fixture
def setup(monkeypatch):
    sleeps = []
    monkeypatch.setattr(ab.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(ab, "_is_loaded", True)
    monkeypatch.setattr(ab, "_lookup_with_fuzzy", lambda s: (s, {"exch": "NSE", "token": "1"}))

    def install(client):
        monkeypatch.setattr(ab, "get_angel_client", lambda: client)
        return client
    return install, sleeps


def test_two_years_is_split_into_windows_within_the_cap(setup):
    install, sleeps = setup
    c = install(FakeClient())
    out = ab.get_historical("RELIANCE.NS", "15m", days=730)
    assert len(c.calls) == 5                                   # 730 days / 180-day cap
    for p in c.calls:
        span = datetime.strptime(p["todate"], "%Y-%m-%d %H:%M") - datetime.strptime(p["fromdate"], "%Y-%m-%d %H:%M")
        assert span <= timedelta(days=180, minutes=1)
    assert len(sleeps) == 4 and all(s >= 1 for s in sleeps)    # spaced out between calls
    ts = [x["t"] for x in out]
    assert ts == sorted(ts) and len(ts) == len(set(ts))


def test_short_request_is_a_single_call(setup):
    install, _ = setup
    c = install(FakeClient())
    ab.get_historical("RELIANCE.NS", "15m", days=30)
    assert len(c.calls) == 1


def test_throttled_call_is_retried(setup):
    install, sleeps = setup

    def behaviour(n, p):
        return {"status": False, "message": "Access denied because of exceeding access rate"} if n == 1 else None
    c = install(FakeClient(behaviour))
    out = ab.get_historical("RELIANCE.NS", "15m", days=30)
    assert out and len(c.calls) == 2 and sleeps[0] >= ab._THROTTLE_WAIT_S


def test_partial_history_is_returned_when_a_later_window_keeps_failing(setup):
    install, _ = setup

    def behaviour(n, p):
        return None if n == 1 else {"status": False, "message": "Access denied because of exceeding access rate"}
    install(FakeClient(behaviour))
    out = ab.get_historical("RELIANCE.NS", "15m", days=400)
    assert out and len(out) == 3                               # first window kept, the rest gave up


def test_nothing_fetched_returns_none(setup):
    install, _ = setup
    install(FakeClient(lambda n, p: {"status": False, "message": "Session expired"}))
    assert ab.get_historical("RELIANCE.NS", "15m", days=30) is None


def test_index_symbols_use_the_built_in_index_tokens(setup, monkeypatch):
    install, _ = setup
    monkeypatch.setattr(ab, "_lookup_with_fuzzy", lambda s: (s, {"exch": "NFO", "token": "WRONG"}))   # a stray entry must not win
    c = install(FakeClient())
    assert ab.get_historical("^NSEI", "15m", days=30)
    assert c.calls[0]["symboltoken"] == "99926000" and c.calls[0]["exchange"] == "NSE"
    c.calls.clear()
    assert ab.get_historical("^BSESN", "15m", days=30)
    assert c.calls[0]["symboltoken"] == "99919000" and c.calls[0]["exchange"] == "BSE"
