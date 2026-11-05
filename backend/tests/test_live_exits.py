"""Stop-loss / target / trailing stop for real positions: the maths, and the watcher that sends the exit order.
Nothing here contacts Angel: the broker is a fake that records what it was asked to send."""
import asyncio
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_exits as lx
import live_rules as lr
import main

IST = lr.IST
OPEN = dt.datetime(2026, 11, 2, 10, 30, tzinfo=IST)
SYM = "NIFTY10NOV2623950CE"


# ───────────── the maths ─────────────
def test_clean_accepts_blank_and_rejects_silly_values():
    assert lx.clean(None, "", 0) == {"sl_pct": 0.0, "tp_pct": 0.0, "trail_pct": 0.0}
    assert lx.clean(30, 50, 20) == {"sl_pct": 30.0, "tp_pct": 50.0, "trail_pct": 20.0}
    for bad in ((0.5, 0, 0), (95, 0, 0), (0, 600, 0), (0, 0, 91)):
        with pytest.raises(ValueError):
            lx.clean(*bad)
    assert not lx.any_rule({"sl_pct": 0, "tp_pct": 0, "trail_pct": 0}) and lx.any_rule({"trail_pct": 10})


def test_fixed_stop_and_target():
    rule = {"sl_pct": 30, "tp_pct": 50, "trail_pct": 0}
    ev = lx.evaluate(rule, 100.0, 110.0)
    assert ev["action"] is None and ev["stop"] == 70.0 and ev["target"] == 150.0
    assert lx.evaluate(rule, 100.0, 70.0)["action"] == "STOP"
    assert lx.evaluate(rule, 100.0, 150.0)["action"] == "TARGET"
    assert lx.evaluate(rule, 100.0, 69.0)["action"] == "STOP"


def test_trailing_stop_follows_the_peak_up_and_never_down():
    rule = {"sl_pct": 30, "tp_pct": 0, "trail_pct": 20}
    ev = lx.evaluate(rule, 100.0, 100.0)
    assert ev["stop"] == 80.0 and ev["action"] is None          # trail 100 x 0.8 beats the fixed 70
    ev = lx.evaluate(rule, 100.0, 150.0, ev["peak"])
    assert ev["peak"] == 150.0 and ev["stop"] == 120.0
    ev = lx.evaluate(rule, 100.0, 130.0, ev["peak"])            # price falls back: the peak and the stop stay up
    assert ev["peak"] == 150.0 and ev["stop"] == 120.0 and ev["action"] is None
    assert lx.evaluate(rule, 100.0, 119.0, 150.0)["action"] == "TRAIL"


def test_the_fixed_stop_wins_when_it_is_higher_than_the_trail():
    rule = {"sl_pct": 10, "tp_pct": 0, "trail_pct": 40}
    ev = lx.evaluate(rule, 100.0, 100.0)
    assert ev["stop"] == 90.0
    assert lx.evaluate(rule, 100.0, 89.0)["action"] == "STOP"


def test_orders_can_carry_rules_only_on_a_buy():
    base = {"symbol": SYM, "side": "BUY", "qty": 65, "order_type": "LIMIT", "product": "INTRADAY", "price": 140.0, "trigger_price": 0}
    ctx = {"limits": {"max_order_value": 20000, "max_lots": 2, "max_daily_loss": 5000}, "contract_found": True, "lot_size": 65,
           "ltp": 140.0, "net_long_qty": 65, "day_loss": 0, "now": OPEN}
    ok = lr.validate_order({**base, "sl_pct": 30, "tp_pct": 40, "trail_pct": 15}, ctx)
    assert ok["ok"] and any("watched by this server" in w for w in ok["warnings"])
    assert not lr.validate_order({**base, "side": "SELL", "sl_pct": 30}, ctx)["ok"]
    assert not lr.validate_order({**base, "sl_pct": 99.5}, ctx)["ok"]


# ───────────── the watcher ─────────────
class ExitDB:
    """Just enough of a database for the watcher: one live_exits table and a record of the live_orders traffic."""

    def __init__(self, rows):
        self.rows, self.orders, self.claims = rows, [], 0

    def acquire(self):
        db = self

        class Ctx:
            async def __aenter__(self):
                return Conn(db)

            async def __aexit__(self, *a):
                return False
        return Ctx()


class Conn:
    def __init__(self, db):
        self.db = db

    def _row(self, id_):
        return next(r for r in self.db.rows if r["id"] == id_)

    async def fetch(self, q, *a):
        return [dict(r) for r in self.db.rows if r["state"] in ("WAITING", "ARMED")]

    async def fetchval(self, q, *a):
        r = self._row(a[0])
        if "'TRIGGERED'" in q and r["state"] == "ARMED":
            r["state"], r["reason"] = "TRIGGERED", a[1]
            self.db.claims += 1
            return r["id"]
        return None

    async def execute(self, q, *a):
        q = " ".join(q.split())
        if q.startswith("INSERT INTO live_orders"):
            self.db.orders.append({"client_id": a[0], "symbol": a[1], "qty": a[2], "state": "SENDING"})
        elif q.startswith("UPDATE live_orders"):
            o = next(o for o in self.db.orders if o["client_id"] == a[3])
            o.update(state=a[0], broker_order_id=a[1], message=a[2])
        elif "SET state = 'ARMED', entry" in q:
            self._row(a[0]).update(state="ARMED", entry=a[1], peak=a[1], qty=a[2])
        elif "SET state = 'EXIT_SENT'" in q:
            self._row(a[0]).update(state="EXIT_SENT", message=a[1])
        elif "SET state = 'UNKNOWN'" in q:
            self._row(a[0]).update(state="UNKNOWN", message=a[1])
        elif "SET state = $2, attempts = $3" in q:
            self._row(a[0]).update(state=a[1], attempts=a[2], message=a[3])
        elif "SET state = 'DONE'" in q:
            self._row(a[0]).update(state="DONE")
        elif "SET state = 'EXPIRED'" in q:
            self._row(a[0]).update(state="EXPIRED")
        elif "SET state = 'EXIT_FAILED'" in q:
            self._row(a[0]).update(state="EXIT_FAILED", message=a[1])
        elif "SET peak = $2" in q:
            self._row(a[0]).update(peak=a[1], stop=a[2], target=a[3])


def exit_row(**kw):
    r = {"id": 1, "created": main._utc_now(), "symbol": SYM, "product": "INTRADAY", "qty": 65, "sl_pct": 30, "tp_pct": 50, "trail_pct": 0,
         "entry": None, "peak": None, "stop": None, "target": None, "state": "WAITING", "attempts": 0, "reason": "", "message": ""}
    r.update(kw)
    return r


@pytest.fixture
def watch(monkeypatch):
    st = {"positions": [], "ltp": 100.0, "place": {"state": "PLACED", "order_id": "55", "message": "ok"}, "sent": []}
    main._live_state.update(enabled=True, enabled_at=1)
    monkeypatch.setattr(main.autotrader, "now_ist", lambda ts=None: OPEN)
    monkeypatch.setattr(main, "_fetch_ltp", lambda s: _async(st["ltp"]))
    monkeypatch.setattr(main._angel_broker, "_master_lookup", {SYM: {"exch": "NFO", "token": "777", "name": SYM}})
    monkeypatch.setattr(main.live_broker, "positions", lambda: st["positions"])
    monkeypatch.setattr(main.live_broker, "place", lambda params: st["sent"].append(params) or st["place"])
    yield st
    main._live_state.update(enabled=False, enabled_at=None)


async def _async(v):
    return v


def pos(qty=65, avg=100.0, ltp=100.0):
    return [{"symbol": SYM, "product": "INTRADAY", "net_qty": qty, "buy_avg": avg, "ltp": ltp, "pnl": 0}]


def tick(db):
    asyncio.run(main._live_exit_tick(db))


def test_a_waiting_rule_arms_itself_when_the_buy_shows_up_as_a_position(watch):
    db = ExitDB([exit_row()])
    tick(db)
    assert db.rows[0]["state"] == "WAITING" and not watch["sent"]          # no position yet
    watch["positions"] = pos(avg=120.0)
    tick(db)
    assert db.rows[0]["state"] == "ARMED" and db.rows[0]["entry"] == 120.0 and db.rows[0]["peak"] == 120.0


def test_a_buy_that_never_fills_expires_instead_of_waiting_forever(watch):
    old = main._utc_now() - dt.timedelta(minutes=45)
    db = ExitDB([exit_row(created=old)])
    tick(db)
    assert db.rows[0]["state"] == "EXPIRED"


def test_the_stop_sends_one_market_sell_and_only_once(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 69.0
    tick(db)
    assert len(watch["sent"]) == 1
    p = watch["sent"][0]
    assert p["transactiontype"] == "SELL" and p["ordertype"] == "MARKET" and p["quantity"] == "65" and p["symboltoken"] == "777"
    assert db.rows[0]["state"] == "EXIT_SENT" and db.rows[0]["reason"] == "STOP"
    assert db.orders[0]["state"] == "PLACED"
    tick(db)
    tick(db)
    assert len(watch["sent"]) == 1                                         # the same exit is never sent twice


def test_the_target_exit_and_the_ledger_record(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 151.0
    tick(db)
    assert db.rows[0]["reason"] == "TARGET" and len(watch["sent"]) == 1 and db.orders[0]["qty"] == 65


def test_the_trailing_stop_ratchets_up_then_sells_on_the_pullback(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0, sl_pct=0, tp_pct=0, trail_pct=20)])
    watch["positions"] = pos()
    for price in (110.0, 140.0, 130.0):
        watch["ltp"] = price
        tick(db)
    assert db.rows[0]["peak"] == 140.0 and db.rows[0]["stop"] == 112.0 and not watch["sent"]
    watch["ltp"] = 111.0
    tick(db)
    assert len(watch["sent"]) == 1 and db.rows[0]["reason"] == "TRAIL"


def test_it_sells_no_more_than_you_still_hold(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0, qty=130)])
    watch["positions"], watch["ltp"] = pos(qty=65), 60.0
    tick(db)
    assert watch["sent"][0]["quantity"] == "65"


def test_a_position_closed_by_hand_ends_the_rule_without_selling(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = [], 50.0
    tick(db)
    assert db.rows[0]["state"] == "DONE" and not watch["sent"]


def test_nothing_happens_while_live_mode_is_off_or_the_market_is_closed(watch, monkeypatch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 10.0
    main._live_state["enabled"] = False
    tick(db)
    main._live_state["enabled"] = True
    monkeypatch.setattr(main.autotrader, "now_ist", lambda ts=None: dt.datetime(2026, 11, 2, 16, 0, tzinfo=IST))
    tick(db)
    assert not watch["sent"] and db.rows[0]["state"] == "ARMED"


def test_an_unknown_outcome_is_never_sent_again(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 60.0
    watch["place"] = {"state": "UNKNOWN", "order_id": None, "message": "timeout"}
    tick(db)
    tick(db)
    assert len(watch["sent"]) == 1 and db.rows[0]["state"] == "UNKNOWN"


def test_a_refused_exit_is_retried_a_few_times_then_gives_up(watch):
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 60.0
    watch["place"] = {"state": "REJECTED", "order_id": None, "message": "RMS: no margin"}
    for _ in range(6):
        tick(db)
    assert len(watch["sent"]) == 3 and db.rows[0]["state"] == "EXIT_FAILED"
