"""Angel login must renew itself: the daily "restart the server" problem was an expired token that was never replaced."""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import angel_broker as ab


class FakeSmart:
    instances = []

    def __init__(self, api_key=None):
        self.n = len(FakeSmart.instances)
        FakeSmart.instances.append(self)
        self.calls = 0

    def generateSession(self, code, pwd, totp):
        return {"status": True, "data": {"jwtToken": f"jwt{self.n}", "feedToken": "f"}}

    def ltpData(self, **kw):
        self.calls += 1
        if self.n == 0 and getattr(FakeSmart, "expire_first", False):
            return {"status": False, "message": "Invalid Token", "errorcode": "AG8001", "data": None}
        return {"status": True, "data": {"ltp": 100.0}}


@pytest.fixture
def smart(monkeypatch):
    FakeSmart.instances = []
    FakeSmart.expire_first = False
    mod = types.ModuleType("SmartApi")
    mod.SmartConnect = FakeSmart
    monkeypatch.setitem(sys.modules, "SmartApi", mod)
    for k in ("ANGEL_API_KEY", "ANGEL_CLIENT_CODE", "ANGEL_PASSWORD"):
        monkeypatch.setenv(k, "x")
    monkeypatch.setenv("ANGEL_TOTP_SECRET", "JBSWY3DPEHPK3PXP")
    monkeypatch.setattr(ab, "_angel_obj", None)
    monkeypatch.setattr(ab, "_auth_token", None)
    monkeypatch.setattr(ab, "_session_at", 0.0)
    return FakeSmart


def test_session_is_reused_while_fresh(smart):
    a = ab.get_angel_client()
    b = ab.get_angel_client()
    assert a is b and len(smart.instances) == 1


def test_session_is_renewed_when_old(smart, monkeypatch):
    ab.get_angel_client()
    monkeypatch.setattr(ab, "_session_at", ab.time.time() - ab._SESSION_MAX_AGE - 5)
    ab.get_angel_client()
    assert len(smart.instances) == 2


def test_force_renews_immediately(smart):
    ab.get_angel_client()
    ab.get_angel_client(force=True)
    assert len(smart.instances) == 2


def test_invalid_token_triggers_a_new_login_and_a_retry(smart):
    """The bug: Angel says 'Invalid Token', which the old code never recognised, so every call failed until a restart."""
    smart.expire_first = True
    res = ab.call_angel("ltpData", exchange="NSE", tradingsymbol="X", symboltoken="1")
    assert res["status"] and res["data"]["ltp"] == 100.0
    assert len(smart.instances) == 2                     # logged in again, once


def test_a_failed_refresh_keeps_the_old_session(smart, monkeypatch):
    first = ab.get_angel_client()
    monkeypatch.setattr(ab, "_session_at", ab.time.time() - ab._SESSION_MAX_AGE - 5)
    monkeypatch.setattr(FakeSmart, "generateSession", lambda self, *a: {"status": False, "message": "rate limited"})
    assert ab.get_angel_client() is first                # not None: the old token may still work


def test_non_session_errors_are_not_retried(smart):
    class Boom(FakeSmart):
        def ltpData(self, **kw):
            raise RuntimeError("network down")
    smart.__init__ = Boom.__init__
    ab._angel_obj = Boom()
    ab._auth_token, ab._session_at = "t", ab.time.time()
    with pytest.raises(RuntimeError):
        ab.call_angel("ltpData")


@pytest.mark.parametrize("text,expected", [
    ("Invalid Token", True), ("Session Expired", True), ("AG8002", True), ("Token has expired", True),
    ("Access denied because of exceeding access rate", False), ("No Data Available", False), ("Symbol not found", False),
])
def test_what_counts_as_a_session_error(text, expected):
    assert ab._is_session_error(text) is expected


# ───────────── scrip master refresh ─────────────
def _item(name, symbol):
    return {"token": "1", "symbol": symbol, "name": name, "expiry": "10NOV2026", "strike": "2310000.000000", "lotsize": "65",
            "instrumenttype": "OPTIDX", "exch_seg": "NFO"}


def test_master_is_reloaded_when_old_and_swapped_in_whole(monkeypatch):
    monkeypatch.setattr(ab, "_CACHE_PATH", None)
    monkeypatch.setattr(ab, "_next_attempt", 0.0)
    versions = iter([[_item("NIFTY", "NIFTY03NOV2623100CE")], [_item("NIFTY", "NIFTY10NOV2623100CE")]])
    monkeypatch.setattr(ab, "_fetch_master", lambda max_age=None: next(versions))
    monkeypatch.setattr(ab, "_is_loaded", False)
    monkeypatch.setattr(ab, "_master_lookup", {})
    monkeypatch.setattr(ab, "_bg_loading", False)
    ab.load_master_contract()
    assert "NIFTY03NOV2623100CE" in ab._master_lookup

    assert ab.refresh_master_if_stale() is False                 # just loaded: nothing to do
    monkeypatch.setattr(ab, "_loaded_at", ab.time.time() - ab._MASTER_REFRESH_AGE - 10)
    done = []
    monkeypatch.setattr(ab.threading, "Thread", lambda target, **kw: types.SimpleNamespace(start=lambda: (target(), done.append(1))))
    assert ab.refresh_master_if_stale() is True and done
    assert "NIFTY10NOV2623100CE" in ab._master_lookup and "NIFTY03NOV2623100CE" not in ab._master_lookup
    assert ab._bg_loading is False


def test_session_info_shape():
    info = ab.session_info()
    assert {"logged_in", "session_age_s", "last_ok_s_ago", "last_error", "master_loaded", "master_age_s"} <= set(info)
