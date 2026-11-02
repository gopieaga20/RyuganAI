"""Identical Yahoo candle requests inside a minute are served from memory (the scanner and chart re-ask a lot)."""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main

PAYLOAD = {"chart": {"result": [{"timestamp": [1], "indicators": {"quote": [{"open": [1], "high": [1], "low": [1], "close": [1], "volume": [1]}]}}]}}


class _Resp:
    status_code = 200

    def json(self):
        return PAYLOAD


@pytest.fixture
def client(monkeypatch):
    calls = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            calls.append(url)
            return _Resp()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    main._candle_cache.clear()
    # Not used as a context manager on purpose: that would start the app lifespan (database, network).
    return TestClient(main.app), calls


def test_same_request_twice_hits_yahoo_once(client):
    c, calls = client
    assert c.get("/api/yahoo-chart/%5ENSEI?interval=15m&range=5d").status_code == 200
    assert c.get("/api/yahoo-chart/%5ENSEI?interval=15m&range=5d").status_code == 200
    assert len(calls) == 1


def test_different_interval_or_symbol_is_a_separate_entry(client):
    c, calls = client
    c.get("/api/yahoo-chart/%5ENSEI?interval=15m&range=5d")
    c.get("/api/yahoo-chart/%5ENSEI?interval=5m&range=5d")
    c.get("/api/yahoo-chart/RELIANCE.NS?interval=15m&range=5d")
    assert len(calls) == 3


def test_entries_expire(monkeypatch):
    main._candle_cache.clear()
    main._candle_cache_put(("A", "5m", "1d"), {"x": 1}, now=100.0)
    assert main._candle_cache_get(("A", "5m", "1d"), now=100.0 + main._CANDLE_TTL - 1) == {"x": 1}
    assert main._candle_cache_get(("A", "5m", "1d"), now=100.0 + main._CANDLE_TTL + 1) is None


def test_cache_is_bounded(monkeypatch):
    main._candle_cache.clear()
    monkeypatch.setattr(main, "_CANDLE_CACHE_MAX", 3)
    for i in range(10):
        main._candle_cache_put((str(i), "5m", "1d"), {"i": i}, now=float(i))
    assert len(main._candle_cache) <= 3
    assert ("9", "5m", "1d") in main._candle_cache       # newest survive, oldest are evicted
