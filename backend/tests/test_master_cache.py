"""The scrip master is a slow ~7 MB download: it must be cached, retried politely, and never block requests."""
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import angel_broker as ab

ITEM = [{"token": "1", "symbol": "NIFTY27OCT26FUT", "name": "NIFTY", "expiry": "27OCT2026", "strike": "-1.000000",
         "lotsize": "65", "instrumenttype": "FUTIDX", "exch_seg": "NFO"}]


class _Resp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode()
        self._pos = 0
        self.headers = {}
        self.status = 200

    def read(self, n=-1):
        end = len(self._b) if n < 0 else self._pos + n
        out, self._pos = self._b[self._pos:end], min(end, len(self._b))
        return out

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(ab, "_CACHE_PATH", str(tmp_path / "scrip_master.json"))
    monkeypatch.setattr(ab, "_is_loaded", False)
    monkeypatch.setattr(ab, "_next_attempt", 0.0)
    monkeypatch.setattr(ab, "_master_lookup", {})
    monkeypatch.setattr(ab, "_lot_sizes", {})
    return tmp_path


def test_download_is_cached_and_reused(fresh, monkeypatch):
    calls = []
    monkeypatch.setattr(ab.urllib.request, "urlopen", lambda *a, **k: calls.append(1) or _Resp(ITEM))
    ab.load_master_contract()
    assert len(calls) == 1 and os.path.exists(ab._CACHE_PATH)
    monkeypatch.setattr(ab, "_is_loaded", False)          # simulate a restart
    ab.load_master_contract()
    assert len(calls) == 1                                  # served from disk, no second download


def test_stale_cache_is_used_when_the_download_fails(fresh, monkeypatch):
    with open(ab._CACHE_PATH, "w") as f:
        json.dump(ITEM, f)
    old = time.time() - 3 * 24 * 3600
    os.utime(ab._CACHE_PATH, (old, old))

    def boom(*a, **k):
        raise TimeoutError("slow")
    monkeypatch.setattr(ab.urllib.request, "urlopen", boom)
    ab.load_master_contract()
    assert ab.master_ready() and ab.get_lot_sizes() == {"NIFTY": 65}


def test_failed_download_is_not_retried_immediately(fresh, monkeypatch):
    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise TimeoutError("slow")
    monkeypatch.setattr(ab.urllib.request, "urlopen", boom)
    ab.load_master_contract()
    after_first = len(calls)                  # the first attempt may retry/resume internally
    ab.load_master_contract()
    ab.load_master_contract()
    assert len(calls) == after_first and not ab.master_ready()


def test_quote_returns_immediately_while_the_master_is_not_loaded(fresh, monkeypatch):
    monkeypatch.setattr(ab, "get_angel_client", lambda: object())
    started = []
    monkeypatch.setattr(ab, "ensure_master_loading", lambda: started.append(1))
    t0 = time.time()
    assert ab.get_quote("^NSEI") is None
    assert time.time() - t0 < 0.5 and started


def test_interrupted_download_resumes_with_a_range_request(fresh, monkeypatch):
    body = json.dumps(ITEM).encode()
    seen = []

    class Cut(_Resp):
        def __init__(self, start, cut):
            super().__init__(ITEM)
            self._b = body[start:]
            self._cut = cut
            self.headers = {"Content-Length": str(len(body))}
            self.status = 206 if start else 200

        def read(self, n=-1):
            if self._cut is not None and self._pos >= self._cut:
                raise ConnectionError("dropped")
            return super().read(n)

    def fake(req, timeout=None):
        rng = req.headers.get("Range")
        seen.append(rng)
        return Cut(0, 10) if not rng else Cut(int(rng.split("=")[1].rstrip("-")), None)

    monkeypatch.setattr(ab.urllib.request, "urlopen", fake)
    ab.load_master_contract()
    assert ab.master_ready()
    assert seen[0] is None and seen[1] is not None
