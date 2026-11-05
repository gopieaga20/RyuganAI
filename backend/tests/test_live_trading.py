"""Real-money manual trading: every rule, the order parameters, the send-once behaviour and the endpoints.
No test ever contacts Angel: the broker is replaced by a fake that records what it was asked to do."""
import datetime as dt
import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_broker as lb
import live_rules as lr

IST = lr.IST
OPEN = dt.datetime(2026, 11, 2, 10, 30, tzinfo=IST)          # Monday, market open
CLOSED = dt.datetime(2026, 11, 2, 16, 0, tzinfo=IST)
SYM = "NIFTY10NOV2623950CE"
LIMITS = {"max_order_value": 20000, "max_lots": 2, "max_daily_loss": 5000}


def order(**kw):
    o = {"symbol": SYM, "side": "BUY", "qty": 65, "order_type": "LIMIT", "product": "INTRADAY", "price": 140.0, "trigger_price": 0}
    o.update(kw)
    return o


def ctx(**kw):
    c = {"limits": LIMITS, "contract_found": True, "lot_size": 65, "ltp": 140.0, "net_long_qty": 0, "day_loss": 0, "now": OPEN}
    c.update(kw)
    return c


def check(o=None, **kw):
    return lr.validate_order(o or order(), ctx(**kw))


def has(res, text):
    return any(text in e for e in res["errors"])


# ───────────── rules ─────────────
def test_a_normal_buy_passes_and_reports_the_cost():
    r = check()
    assert r["ok"] and r["est"]["lots"] == 1 and r["est"]["value"] == 140 * 65 and r["est"]["charges"] > 20


def test_nothing_is_allowed_until_limits_are_set():
    assert has(check(limits={}), "Set your live trading limits")
    assert has(check(limits={"max_order_value": 20000, "max_lots": 2}), "Set your live trading limits")
    assert not lr.limits_ready(None)


def test_order_value_and_lot_limits():
    assert has(check(order(price=400.0), ltp=400.0), "above your limit of 20,000")
    assert has(check(order(qty=195)), "lots is above your limit of 2 lots")
    assert check(order(qty=130, price=100.0), ltp=100.0)["ok"]                      # 2 lots, value 13,000


def test_quantity_must_be_whole_lots():
    assert has(check(order(qty=70)), "whole number of lots")
    assert has(check(lot_size=None), "lot size")


def test_unknown_contract_and_missing_price():
    assert has(check(contract_found=False), "not a known NSE option")
    assert has(check(ltp=None), "No live price")


def test_orders_only_while_the_exchange_is_open():
    assert has(check(now=CLOSED), "exchange is closed")
    assert has(check(now=dt.datetime(2026, 11, 7, 11, 0, tzinfo=IST)), "exchange is closed")        # Saturday


def test_fat_finger_guard_and_tick_size():
    assert has(check(order(price=300.0)), "away from the last traded price")
    assert has(check(order(price=140.03)), "steps of 0.05")
    assert not has(check(order(price=150.0)), "away from")                         # about 7% away is fine


def test_stop_loss_orders_need_a_sensible_trigger():
    sell = order(side="SELL", order_type="STOPLOSS_LIMIT", price=105.0, trigger_price=110.0)
    assert has(check(sell, net_long_qty=65), "BELOW the last price") is False and check(sell, net_long_qty=65)["ok"]
    assert has(check(order(side="SELL", order_type="STOPLOSS_MARKET", trigger_price=150.0), net_long_qty=65), "BELOW the last price")
    far = order(side="SELL", order_type="STOPLOSS_LIMIT", price=60.0, trigger_price=110.0)
    assert has(check(far, net_long_qty=65), "away from the trigger")
    deep = order(side="SELL", order_type="STOPLOSS_LIMIT", price=90.0, trigger_price=95.0)       # a stop 30% under the price is legitimate
    assert check(deep, net_long_qty=65)["ok"]
    assert has(check(order(side="BUY", order_type="STOPLOSS_MARKET", trigger_price=130.0)), "ABOVE the last price")
    assert has(check(order(order_type="STOPLOSS_MARKET", trigger_price=0)), "trigger price is required")


def test_selling_can_only_close_a_long_position():
    assert has(check(order(side="SELL")), "would open a short position")
    assert check(order(side="SELL"), net_long_qty=65)["ok"]
    assert has(check(order(side="SELL", qty=130), net_long_qty=65), "would open a short position")


def test_daily_loss_cap_blocks_buys_but_never_exits():
    assert has(check(day_loss=5000), "reached your daily cap")
    assert check(order(side="SELL"), net_long_qty=65, day_loss=9000)["ok"]          # you can always get out


def test_market_and_carry_forward_carry_warnings():
    r = check(order(order_type="MARKET", price=0, product="CARRYFORWARD"))
    assert r["ok"] and len(r["warnings"]) == 2
    assert r["est"]["price"] == pytest.approx(140 * 1.05)                           # a market buy is costed 5% above the last price


def test_invalid_choices_are_refused():
    assert has(check(order(side="SHORT")), "BUY or SELL")
    assert has(check(order(product="MIS")), "INTRADAY or CARRYFORWARD")
    assert has(check(order(order_type="BRACKET")), "Order type")


# ───────────── order parameters ─────────────
def test_params_for_a_limit_order():
    p = lb.build_params(order(), 12345, "NFO", tag="RYUGANabc")
    assert p == {"variety": "NORMAL", "tradingsymbol": SYM, "symboltoken": "12345", "transactiontype": "BUY", "exchange": "NFO",
                 "ordertype": "LIMIT", "producttype": "INTRADAY", "duration": "DAY", "price": "140.00", "squareoff": "0", "stoploss": "0",
                 "quantity": "65", "ordertag": "RYUGANabc"}


def test_params_for_market_and_stoploss_orders():
    m = lb.build_params(order(order_type="MARKET", price=0), 1)
    assert m["ordertype"] == "MARKET" and m["price"] == "0" and "triggerprice" not in m
    s = lb.build_params(order(side="SELL", order_type="STOPLOSS_LIMIT", price=105, trigger_price=110), 1)
    assert s["variety"] == "STOPLOSS" and s["triggerprice"] == "110.00" and s["price"] == "105.00" and s["transactiontype"] == "SELL"


# ───────────── sending: at most once ─────────────
class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.sent = []

    def placeOrderFullResponse(self, params):
        self.sent.append(params)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def angel(monkeypatch):
    def install(*clients):
        seq = list(clients)
        monkeypatch.setattr(lb.ab, "get_angel_client", lambda *a, **k: seq.pop(0) if len(seq) > 1 else seq[0])
        monkeypatch.setattr(lb.ab, "invalidate_session", lambda: None)
        return clients
    return install


OK = {"status": True, "message": "SUCCESS", "data": {"orderid": "2511020001", "uniqueorderid": "u1"}}


def test_a_placed_order_returns_the_broker_order_id(angel):
    c = FakeClient([OK])
    angel(c)
    r = lb.place({"a": 1})
    assert r["state"] == "PLACED" and r["order_id"] == "2511020001" and len(c.sent) == 1


def test_a_refusal_is_reported_with_the_reason(angel):
    c = FakeClient([{"status": False, "message": "RMS: Margin Exceeds"}])
    angel(c)
    r = lb.place({})
    assert r["state"] == "REJECTED" and "Margin" in r["message"] and len(c.sent) == 1


def test_a_failure_that_may_have_reached_the_exchange_is_never_retried(angel):
    c = FakeClient([ConnectionError("read timed out"), OK])
    angel(c)
    r = lb.place({})
    assert r["state"] == "UNKNOWN" and "order book" in r["message"] and len(c.sent) == 1


def test_a_bad_token_reply_is_retried_once_after_a_fresh_login(angel):
    c1 = FakeClient([{"status": False, "message": "Invalid Token", "errorcode": "AG8001"}])
    c2 = FakeClient([OK])
    angel(c1, c2)
    r = lb.place({})
    assert r["state"] == "PLACED" and len(c1.sent) == 1 and len(c2.sent) == 1


def test_no_session_means_nothing_is_sent(monkeypatch):
    monkeypatch.setattr(lb.ab, "get_angel_client", lambda *a, **k: None)
    assert lb.place({})["state"] == "NOT_SENT"


def test_order_book_and_position_normalising():
    o = lb.normalize_order({"orderid": "1", "tradingsymbol": SYM, "transactiontype": "BUY", "quantity": "65", "filledshares": "0", "price": "140", "orderstatus": "open"})
    assert o["open"] and o["qty"] == 65 and o["price"] == 140.0
    assert lb.normalize_order({"orderstatus": "complete"})["open"] is False
    assert lb.normalize_order({"orderstatus": "trigger pending"})["open"] is True
    p = lb.normalize_position({"tradingsymbol": SYM, "producttype": "INTRADAY", "netqty": "65", "ltp": "150", "pnl": "650"})
    assert p["net_qty"] == 65 and p["pnl"] == 650.0


# ───────────── endpoints ─────────────
import main


class Conn:
    def __init__(self, pool):
        self.pool = pool

    async def fetchrow(self, q, *a):
        if "app_settings" in q and a and a[0] == "live_limits":
            return {"value": json.dumps(self.pool.limits)} if self.pool.limits else None
        return None

    async def fetchval(self, q, *a):
        return 0

    async def execute(self, q, *a):
        self.pool.sql.append((q.split()[0] + " " + " ".join(q.split()[1:4]), a))

    async def fetch(self, q, *a):
        return []


class Pool:
    connected = True

    def __init__(self):
        self.limits, self.sql = dict(LIMITS), []

    def acquire(self):
        pool = self

        class Ctx:
            async def __aenter__(self):
                return Conn(pool)

            async def __aexit__(self, *a):
                return False
        return Ctx()


@pytest.fixture
def api(monkeypatch):
    pool = Pool()
    main.app.state.pool = pool
    main._live_state.update(enabled=False, enabled_at=None)
    main._live_previews.clear()
    sent = []
    state = {"positions": [], "orders": [], "ltp": 140.0, "place": {"state": "PLACED", "order_id": "999", "message": "ok"}, "cancelled": []}
    monkeypatch.setattr(main.autotrader, "now_ist", lambda ts=None: OPEN)
    monkeypatch.setattr(main, "_fetch_ltp", lambda s: _async(state["ltp"]))
    monkeypatch.setattr(main, "get_lot_sizes", lambda: {"NIFTY": 65})
    monkeypatch.setattr(main._angel_broker, "_master_lookup", {SYM: {"exch": "NFO", "token": "777", "name": SYM}})
    monkeypatch.setattr(main.live_broker, "positions", lambda: state["positions"])
    monkeypatch.setattr(main.live_broker, "order_book", lambda: state["orders"])
    monkeypatch.setattr(main.live_broker, "funds", lambda: {"available_cash": 100000.0})
    monkeypatch.setattr(main.live_broker, "place", lambda params: sent.append(params) or state["place"])
    monkeypatch.setattr(main.live_broker, "cancel", lambda oid, variety="NORMAL": state["cancelled"].append(oid) or {"ok": True, "message": "ok"})
    c = TestClient(main.app)
    c.pool, c.sent, c.state = pool, sent, state
    return c


async def _async(v):
    return v


BODY = {"symbol": SYM, "side": "BUY", "qty": 65, "order_type": "LIMIT", "product": "INTRADAY", "price": 140.0}


def test_live_mode_needs_the_exact_phrase_and_starts_off(api):
    assert api.get("/api/live/status").json()["enabled"] is False
    assert api.post("/api/live/enable", json={"phrase": "enable live"}).status_code == 400
    assert api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"}).json()["enabled"] is True
    assert api.post("/api/live/disable").json()["enabled"] is False


def test_preview_sends_nothing_and_an_order_needs_live_mode(api):
    p = api.post("/api/live/preview", json=BODY).json()
    assert p["ok"] and p["preview_id"] and api.sent == []
    r = api.post("/api/live/order", json={"preview_id": p["preview_id"]})
    assert r.status_code == 403 and api.sent == []                    # live mode is off


def test_full_flow_places_the_previewed_order_once(api):
    api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    p = api.post("/api/live/preview", json=BODY).json()
    r = api.post("/api/live/order", json={"preview_id": p["preview_id"]})
    assert r.status_code == 200 and r.json()["state"] == "PLACED" and r.json()["order_id"] == "999"
    assert len(api.sent) == 1 and api.sent[0]["symboltoken"] == "777" and api.sent[0]["quantity"] == "65" and api.sent[0]["price"] == "140.00"
    again = api.post("/api/live/order", json={"preview_id": p["preview_id"]})        # a double click / replay
    assert again.status_code == 409 and len(api.sent) == 1


def test_the_order_is_recorded_before_it_is_sent_and_updated_after(api):
    api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    p = api.post("/api/live/preview", json=BODY).json()
    api.post("/api/live/order", json={"preview_id": p["preview_id"]})
    kinds = [q for q, _ in api.pool.sql]
    assert kinds[0].startswith("INSERT INTO live_orders") and kinds[-1].startswith("UPDATE live_orders SET")


def test_an_unknown_outcome_is_recorded_not_hidden(api):
    api.state["place"] = {"state": "UNKNOWN", "message": "timed out"}
    api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    p = api.post("/api/live/preview", json=BODY).json()
    r = api.post("/api/live/order", json={"preview_id": p["preview_id"]}).json()
    assert r["state"] == "UNKNOWN"
    assert any(a[3] == "UNKNOWN" or "UNKNOWN" in a for q, a in api.pool.sql if q.startswith("UPDATE"))


def test_the_order_is_checked_again_at_send_time(api, monkeypatch):
    api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    p = api.post("/api/live/preview", json=BODY).json()
    monkeypatch.setattr(main.autotrader, "now_ist", lambda ts=None: CLOSED)         # the market closed in between
    r = api.post("/api/live/order", json={"preview_id": p["preview_id"]})
    assert r.status_code == 400 and "closed" in r.json()["detail"] and api.sent == []


def test_a_failing_preview_gets_no_id_and_cannot_be_sent(api):
    p = api.post("/api/live/preview", json={**BODY, "qty": 195}).json()
    assert p["ok"] is False and "preview_id" not in p
    assert api.post("/api/live/order", json={"preview_id": "x" * 16}).status_code in (403, 409)


def test_limits_endpoint_validates_and_blocks_orders_until_set(api):
    api.pool.limits = {}
    assert api.post("/api/live/preview", json=BODY).json()["ok"] is False
    assert api.post("/api/live/limits", json={"max_order_value": 0, "max_lots": 1, "max_daily_loss": 1}).status_code == 422
    assert api.post("/api/live/limits", json={"max_order_value": 20000, "max_lots": 2, "max_daily_loss": 5000}).json()["limits_ready"] is True


def test_selling_only_closes_what_you_hold(api):
    sell = {**BODY, "side": "SELL"}
    assert api.post("/api/live/preview", json=sell).json()["ok"] is False
    api.state["positions"] = [{"symbol": SYM, "product": "INTRADAY", "net_qty": 65, "pnl": 100.0}]
    assert api.post("/api/live/preview", json=sell).json()["ok"] is True


def test_exit_preview_sells_what_is_held_a_little_below_the_last_price(api):
    api.state["positions"] = [{"symbol": SYM, "product": "INTRADAY", "net_qty": 65, "pnl": 0.0}]
    p = api.post("/api/live/exit-preview", json={"symbol": SYM, "product": "INTRADAY"}).json()
    assert p["ok"] and p["order"]["side"] == "SELL" and p["order"]["qty"] == 65 and p["order"]["price"] == 137.2     # 98% of 140, in 0.05 steps
    assert api.post("/api/live/exit-preview", json={"symbol": SYM, "product": "CARRYFORWARD"}).status_code == 400


def test_cancel_works_even_with_live_mode_off(api):
    assert api.post("/api/live/cancel", json={"order_id": "12345"}).status_code == 200
    assert api.state["cancelled"] == ["12345"]


def test_kill_switch_turns_live_off_and_cancels_open_orders_only(api):
    api.post("/api/live/enable", json={"phrase": "ENABLE LIVE"})
    api.state["orders"] = [{"order_id": "1", "open": True, "variety": "NORMAL"}, {"order_id": "2", "open": False, "variety": "NORMAL"},
                           {"order_id": "3", "open": True, "variety": "STOPLOSS"}]
    r = api.post("/api/live/kill").json()
    assert r["enabled"] is False and r["cancelled"] == ["1", "3"]
    assert api.get("/api/live/status").json()["enabled"] is False


def test_status_reports_everything_the_page_needs(api):
    s = api.get("/api/live/status").json()
    assert s["limits_ready"] is True and s["market_open"] is True and s["funds"]["available_cash"] == 100000.0 and s["phrase"] == "ENABLE LIVE"
