"""Broker connections: the Upstox adapter (against a fake HTTP server), the TradingView-style connect flow, and switching brokers.
No test contacts Upstox or Angel."""
import datetime as dt
import json
import os
import sys
import time

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
from brokers import registry
from brokers import upstox as ux
from brokers.angel import AngelBroker
from brokers.upstox import UpstoxBroker
from test_live_trading import api, SYM, BODY, LIMITS, OPEN    # noqa: F401  (the endpoint fixture and helpers)

IST = ux.IST
EXPIRY_MS = int(dt.datetime(2026, 11, 10, 15, 30, tzinfo=IST).timestamp() * 1000)
INSTRUMENTS = [
    {"segment": "NSE_FO", "instrument_type": "CE", "underlying_symbol": "NIFTY", "name": "NIFTY", "expiry": EXPIRY_MS, "strike_price": 23950.0,
     "lot_size": 65, "instrument_key": "NSE_FO|71001", "trading_symbol": "NIFTY 23950 CE 10 NOV 26", "tick_size": 5.0},
    {"segment": "NSE_FO", "instrument_type": "PE", "underlying_symbol": "NIFTY", "name": "NIFTY", "expiry": EXPIRY_MS, "strike_price": 23950.0,
     "lot_size": 65, "instrument_key": "NSE_FO|71002", "trading_symbol": "NIFTY 23950 PE 10 NOV 26"},
    {"segment": "NSE_FO", "instrument_type": "CE", "underlying_symbol": "RELIANCE", "name": "RELIANCE INDUSTRIES LTD", "expiry": EXPIRY_MS,
     "strike_price": 1300.0, "lot_size": 250, "instrument_key": "NSE_FO|72001", "trading_symbol": "RELIANCE 1300 CE 10 NOV 26"},
    {"segment": "NSE_EQ", "instrument_type": "EQ", "name": "RELIANCE", "instrument_key": "NSE_EQ|INE002A01018"},
]


def make(handler, connected=True):
    """An Upstox adapter whose HTTP goes to `handler(request) -> httpx.Response`."""
    b = UpstoxBroker()
    b._http = httpx.Client(transport=httpx.MockTransport(handler))
    b.set_instruments(INSTRUMENTS)
    if connected:
        b.restore("tok-123", "UP1234", time.time() + 3600)
    return b


def ok(data):
    return httpx.Response(200, json={"status": "success", "data": data})


# ───────────── symbols and instruments ─────────────
def test_symbols_parse_and_round_trip():
    assert ux.parse_symbol("NIFTY10NOV2623950CE") == ("NIFTY", dt.date(2026, 11, 10), 23950, "CE")
    assert ux.parse_symbol("M&M25DEC262900PE") == ("M&M", dt.date(2026, 12, 25), 2900, "PE")
    assert ux.parse_symbol("RELIANCE") is None and ux.parse_symbol("NIFTY10XYZ2623950CE") is None
    assert ux.app_symbol("NIFTY", dt.date(2026, 11, 10), 23950.0, "CE") == "NIFTY10NOV2623950CE"


def test_the_app_symbol_resolves_to_the_upstox_instrument_key_and_lot_size():
    b = make(lambda r: ok({}))
    info = b.resolve("NIFTY10NOV2623950CE")
    assert info["token"] == "NSE_FO|71001" and info["exch"] == "NFO" and info["lot_size"] == 65
    assert b.resolve("NIFTY10NOV2623950PE")["token"] == "NSE_FO|71002"
    assert b.resolve("RELIANCE10NOV261300CE")["token"] == "NSE_FO|72001"
    assert b.resolve("NIFTY10NOV2623951CE") is None                  # no such strike
    assert b.resolve("NIFTY17NOV2623950CE") is None                  # no such expiry
    assert b.resolve("garbage") is None


# ───────────── order parameters ─────────────
@pytest.mark.parametrize("otype,product,expect", [
    ("LIMIT", "INTRADAY", {"order_type": "LIMIT", "product": "I", "price": 140.0, "trigger_price": 0}),
    ("MARKET", "CARRYFORWARD", {"order_type": "MARKET", "product": "D", "price": 0, "trigger_price": 0}),
    ("STOPLOSS_LIMIT", "INTRADAY", {"order_type": "SL", "product": "I", "price": 140.0, "trigger_price": 142.0}),
    ("STOPLOSS_MARKET", "CARRYFORWARD", {"order_type": "SL-M", "product": "D", "price": 0, "trigger_price": 142.0}),
])
def test_params_map_the_app_names_to_upstox_codes(otype, product, expect):
    b = make(lambda r: ok({}))
    o = {"symbol": SYM, "side": "BUY", "qty": 65, "order_type": otype, "product": product, "price": 140.0, "trigger_price": 142.0}
    p = b.build_params(o, {"token": "NSE_FO|71001"}, tag="RYUGAN123456789012345678")
    assert {k: p[k] for k in expect} == expect
    assert p["instrument_token"] == "NSE_FO|71001" and p["transaction_type"] == "BUY" and p["quantity"] == 65
    assert p["validity"] == "DAY" and p["is_amo"] is False and len(p["tag"]) <= 20


# ───────────── sending: once, and honest about what is unknown ─────────────
def test_a_placed_order_returns_the_order_id_and_sends_the_token():
    seen = []

    def handler(req):
        seen.append(req)
        return ok({"order_id": "250101000123"})
    b = make(handler)
    r = b.place({"instrument_token": "NSE_FO|71001", "quantity": 65})
    assert r["state"] == "PLACED" and r["order_id"] == "250101000123"
    assert len(seen) == 1 and seen[0].headers["authorization"] == "Bearer tok-123" and seen[0].url.path.endswith("/order/place")


def test_a_refusal_carries_the_reason():
    b = make(lambda r: httpx.Response(400, json={"status": "error", "errors": [{"errorCode": "UDAPI100060", "message": "Insufficient funds"}]}))
    r = b.place({})
    assert r["state"] == "REJECTED" and "Insufficient funds" in r["message"]


def test_an_expired_token_or_rate_limit_means_nothing_was_sent():
    calls = []
    b = make(lambda r: calls.append(1) or httpx.Response(401, json={"status": "error"}))
    r = b.place({})
    assert r["state"] == "NOT_SENT" and "Connect" in r["message"] and not b.connected() and calls == [1]
    b2 = make(lambda r: httpx.Response(429, json={}))
    assert b2.place({})["state"] == "NOT_SENT"


def test_not_connected_sends_nothing():
    calls = []
    b = make(lambda r: calls.append(1) or ok({"order_id": "1"}), connected=False)
    assert b.place({})["state"] == "NOT_SENT" and calls == []


def test_a_server_error_or_timeout_after_sending_is_unknown_and_never_retried():
    calls = []
    b = make(lambda r: calls.append(1) or httpx.Response(503, text="bad gateway"))
    assert b.place({})["state"] == "UNKNOWN" and calls == [1]

    def slow(req):
        calls.append(2)
        raise httpx.ReadTimeout("slow", request=req)
    b2 = make(slow)
    assert b2.place({})["state"] == "UNKNOWN" and calls.count(2) == 1


def test_a_connection_that_never_opened_is_not_sent():
    def refuse(req):
        raise httpx.ConnectError("no route", request=req)
    assert make(refuse).place({})["state"] == "NOT_SENT"


# ───────────── reading the account ─────────────
def test_orders_and_positions_are_normalised_with_the_apps_symbols():
    def handler(req):
        if req.url.path.endswith("/order/retrieve-all"):
            return ok([{"order_id": "9", "instrument_token": "NSE_FO|71001", "trading_symbol": "NIFTY 23950 CE 10 NOV 26", "transaction_type": "BUY",
                        "order_type": "SL-M", "product": "I", "quantity": 65, "filled_quantity": 0, "price": 0, "trigger_price": 120.5,
                        "status": "trigger pending", "status_message": "", "order_timestamp": "2026-11-02 10:30:00"}])
        if req.url.path.endswith("/short-term-positions"):
            return ok([{"instrument_token": "NSE_FO|71001", "trading_symbol": "NIFTY 23950 CE 10 NOV 26", "exchange": "NFO", "product": "D", "quantity": 65,
                        "day_buy_quantity": 65, "day_sell_quantity": 0, "buy_price": 140.0, "sell_price": 0, "last_price": 150.0, "pnl": 650.0}])
        return httpx.Response(404)
    b = make(handler)
    o = b.order_book()[0]
    assert o["symbol"] == "NIFTY10NOV2623950CE" and o["order_type"] == "STOPLOSS_MARKET" and o["product"] == "INTRADAY" and o["open"] is True and o["trigger"] == 120.5
    p = b.positions()[0]
    assert p["symbol"] == "NIFTY10NOV2623950CE" and p["product"] == "CARRYFORWARD" and p["net_qty"] == 65 and p["buy_avg"] == 140.0 and p["pnl"] == 650.0


def test_funds_and_last_price():
    def handler(req):
        if "get-funds-and-margin" in req.url.path:
            return ok({"equity": {"available_margin": 52000.5, "used_margin": 1000.0}})
        if "market-quote/ltp" in req.url.path:
            assert req.url.params["instrument_key"] == "NSE_FO|71001"
            return ok({"NSE_FO:NIFTY23950CE": {"last_price": 141.25, "instrument_token": "NSE_FO|71001"}})
        return httpx.Response(404)
    b = make(handler)
    assert b.funds()["available_cash"] == 52000.5 and b.ltp("NIFTY10NOV2623950CE") == 141.25
    assert b.ltp("NIFTY10NOV2623951CE") is None


def test_an_expired_session_on_a_read_is_a_clear_error():
    b = make(lambda r: httpx.Response(401, json={}))
    with pytest.raises(RuntimeError, match="expired"):
        b.positions()
    assert not b.connected()


# ───────────── the connect (login) flow ─────────────
@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("UPSTOX_API_KEY", "key-abc")
    monkeypatch.setenv("UPSTOX_API_SECRET", "secret-xyz")
    monkeypatch.setenv("UPSTOX_REDIRECT_URI", "https://ryugan.example/api/brokers/upstox/callback")


def test_the_login_url_points_at_upstox_with_our_state(env):
    b = UpstoxBroker()
    url = httpx.URL(b.login_url("st-1"))
    assert url.host == "api.upstox.com" and url.path.endswith("/login/authorization/dialog")
    assert url.params["client_id"] == "key-abc" and url.params["state"] == "st-1" and url.params["response_type"] == "code"
    assert url.params["redirect_uri"] == "https://ryugan.example/api/brokers/upstox/callback"
    assert "secret-xyz" not in str(url)


def test_not_set_up_is_reported_not_crashed(monkeypatch):
    for k in ("UPSTOX_API_KEY", "UPSTOX_API_SECRET", "UPSTOX_REDIRECT_URI"):
        monkeypatch.delenv(k, raising=False)
    b = UpstoxBroker()
    assert b.status()["configured"] is False and "UPSTOX_API_KEY" in b.status()["message"]
    with pytest.raises(RuntimeError):
        b.login_url("x")


def test_the_code_is_exchanged_for_a_token_that_lasts_until_the_next_0330(env):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"access_token": "tok-new", "user_id": "AB1234", "user_name": "Someone"})
    b = make(handler, connected=False)
    st = b.complete_login({"code": "one-time"})
    assert st["connected"] is True and st["account"] == "AB1234" and "tok-new" not in json.dumps(st)
    body = seen[0].content.decode()
    assert "code=one-time" in body and "client_secret=secret-xyz" in body and "grant_type=authorization_code" in body
    assert b.session_for_storage()["token"] == "tok-new"
    exp = dt.datetime.fromtimestamp(b._expires, IST)
    assert (exp.hour, exp.minute) == (3, 30) and exp > dt.datetime.now(IST)


def test_login_failures_are_explained(env):
    b = make(lambda r: httpx.Response(401, json={"errors": [{"message": "Invalid Auth code"}]}), connected=False)
    with pytest.raises(ValueError, match="Invalid Auth code"):
        b.complete_login({"code": "bad"})
    with pytest.raises(ValueError):
        b.complete_login({})
    assert not b.connected()


def test_a_saved_session_is_restored_only_while_it_is_valid():
    b = UpstoxBroker()
    b.restore("t", "A", time.time() + 60)
    assert b.connected() and b.session_for_storage()["account"] == "A"
    b2 = UpstoxBroker()
    b2.restore("t", "A", time.time() - 60)
    assert not b2.connected() and b2.session_for_storage() is None


def test_the_token_expiry_rolls_to_the_next_morning():
    before = dt.datetime(2026, 11, 2, 2, 0, tzinfo=IST)
    after = dt.datetime(2026, 11, 2, 10, 0, tzinfo=IST)
    assert dt.datetime.fromtimestamp(ux.next_expiry_of_token(before), IST) == dt.datetime(2026, 11, 2, 3, 30, tzinfo=IST)
    assert dt.datetime.fromtimestamp(ux.next_expiry_of_token(after), IST) == dt.datetime(2026, 11, 3, 3, 30, tzinfo=IST)


# ───────────── endpoints ─────────────
@pytest.fixture
def clean(api, monkeypatch, env):
    registry.set_active("angel")
    main._oauth_states.clear()
    up = registry.get("upstox")
    up.disconnect()
    monkeypatch.setattr(up, "_http", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    up.set_instruments(INSTRUMENTS)
    yield api
    registry.set_active("angel")
    up.disconnect()


def test_the_broker_list_shows_both_brokers_and_angel_as_active(clean):
    d = clean.get("/api/brokers").json()
    assert d["active"] == "angel" and [b["id"] for b in d["brokers"]] == ["angel", "upstox"]
    up = next(b for b in d["brokers"] if b["id"] == "upstox")
    assert up["login"] == "oauth" and up["configured"] and not up["connected"]
    assert clean.get("/api/live/status").json()["broker"]["id"] == "angel"


def test_connect_hands_out_the_brokers_login_url_and_a_one_time_state(clean):
    r = clean.get("/api/brokers/upstox/login")
    url = httpx.URL(r.json()["url"])
    assert url.host == "api.upstox.com" and url.params["state"] in main._oauth_states
    assert clean.get("/api/brokers/angel/login").status_code == 400            # Angel signs in by itself
    assert clean.get("/api/brokers/nope/login").status_code == 404


def test_the_callback_rejects_a_login_this_server_did_not_start(clean, monkeypatch):
    called = []
    monkeypatch.setattr(registry.get("upstox"), "complete_login", lambda p: called.append(p))
    for path in ("/api/brokers/upstox/callback?code=abc", "/api/brokers/upstox/callback?code=abc&state=forged"):
        r = clean.get(path, follow_redirects=False)
        assert r.status_code == 303 and "status=error" in r.headers["location"]
    assert called == []


def test_a_good_callback_connects_once_and_never_shows_the_token(clean, monkeypatch):
    up = registry.get("upstox")
    monkeypatch.setattr(up, "_http", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"access_token": "tok-secret", "user_id": "U9"}))))
    state = httpx.URL(clean.get("/api/brokers/upstox/login").json()["url"]).params["state"]
    r = clean.get(f"/api/brokers/upstox/callback?code=abc&state={state}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/#/live?") and "status=connected" in r.headers["location"]   # straight back into the app
    assert "tok-secret" not in r.headers["location"] and "tok-secret" not in r.text
    assert up.connected() and any(q.startswith("INSERT INTO broker_sessions") for q, _ in clean.pool.sql)
    again = clean.get(f"/api/brokers/upstox/callback?code=abc&state={state}", follow_redirects=False)      # the state is single-use
    assert "status=error" in again.headers["location"]


def test_a_failed_exchange_shows_the_reason_and_stays_disconnected(clean, monkeypatch):
    up = registry.get("upstox")
    monkeypatch.setattr(up, "_http", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"errors": [{"message": "Invalid Auth code"}]}))))
    state = httpx.URL(clean.get("/api/brokers/upstox/login").json()["url"]).params["state"]
    r = clean.get(f"/api/brokers/upstox/callback?code=bad&state={state}", follow_redirects=False)
    loc = httpx.URL("http://x" + r.headers["location"].replace("/#", "/?", 1))
    assert r.status_code == 303 and loc.params["status"] == "error" and "Invalid Auth code" in loc.params["msg"] and not up.connected()


def test_switching_broker_is_refused_while_live_is_on_or_rules_are_watching(clean, monkeypatch):
    clean.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    r = clean.post("/api/brokers/active", json={"id": "upstox"})
    assert r.status_code == 400 and "OFF" in r.json()["detail"] and registry.active_id() == "angel"
    clean.post("/api/live/disable")
    import test_live_trading as t

    async def two(self, q, *a):
        return 2
    monkeypatch.setattr(t.Conn, "fetchval", two)
    r = clean.post("/api/brokers/active", json={"id": "upstox"})
    assert r.status_code == 400 and "rule" in r.json()["detail"] and registry.active_id() == "angel"


def test_switching_works_when_idle_and_is_remembered(clean):
    assert clean.post("/api/brokers/active", json={"id": "upstox"}).json()["active"] == "upstox"
    assert registry.active_id() == "upstox"
    assert any(q.startswith("INSERT INTO app_settings") and "upstox" in a for q, a in clean.pool.sql)       # remembered across restarts
    assert clean.post("/api/brokers/active", json={"id": "nope"}).status_code == 404


def test_live_cannot_be_switched_on_for_a_broker_that_is_not_connected(clean):
    clean.post("/api/brokers/active", json={"id": "upstox"})
    r = clean.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    assert r.status_code == 400 and "not connected" in r.json()["detail"]
    registry.get("upstox").restore("t", "A", time.time() + 600)
    assert clean.post("/api/live/enable", json={"phrase": "ENABLE LIVE"}).json()["enabled"] is True


def test_an_active_upstox_account_gets_the_order_and_the_record_names_the_broker(clean, monkeypatch):
    up = registry.get("upstox")
    up.restore("t", "A", time.time() + 600)
    clean.post("/api/brokers/active", json={"id": "upstox"})
    placed = []
    monkeypatch.setattr(up, "positions", lambda: [])
    monkeypatch.setattr(up, "ltp", lambda s: 140.0)
    monkeypatch.setattr(up, "place", lambda params: placed.append(params) or {"state": "PLACED", "order_id": "U-1", "message": ""})
    monkeypatch.setattr(main, "get_lot_sizes", lambda: {"NIFTY": 65})
    clean.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    p = clean.post("/api/live/preview", json={**BODY, "symbol": "NIFTY10NOV2623950CE"}).json()
    assert p["ok"], p["errors"]
    r = clean.post("/api/live/order", json={"preview_id": p["preview_id"]})
    assert r.json()["state"] == "PLACED" and len(placed) == 1
    assert placed[0]["instrument_token"] == "NSE_FO|71001" and placed[0]["product"] == "I"
    assert clean.sent == []                                                       # nothing went to Angel
    ledger = [a for q, a in clean.pool.sql if q.startswith("INSERT INTO live_orders")]
    assert ledger and "upstox" in ledger[0]


def test_angel_still_resolves_and_orders_exactly_as_before(clean):
    assert isinstance(registry.active(), AngelBroker)
    info = registry.active().resolve(SYM)
    assert info["token"] == "777" and info["exch"] == "NFO"
