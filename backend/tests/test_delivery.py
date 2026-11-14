import asyncio
import datetime as dt
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import delivery as dv

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def test_action_stop_first_then_target_then_t1():
    a = lambda **k: dv.next_action(**{"stage": "OPEN", "ltp": 100, "entry": 100, "sl": 95, "t1": 110, "tp": 115, "qty": 10, **k})
    assert a() is None
    assert a(ltp=94.9) == ("CLOSE", "SL Hit")
    assert a(ltp=80) == ("CLOSE", "SL Hit")                       # gap through the stop: closed at the market price
    assert a(ltp=110) == ("PARTIAL", 5)
    assert a(ltp=116) == ("CLOSE", "Target 2 Hit")                # straight past both targets: close everything
    assert a(qty=7, ltp=110) == ("PARTIAL", 4)                    # odd quantity sells the larger half
    assert a(qty=1, ltp=110) is None                              # one share cannot be split: wait for T2 or the stop


def test_after_t1_the_stop_is_a_trailing_stop_and_t1_is_not_sold_twice():
    a = lambda **k: dv.next_action(**{"stage": "T1_DONE", "ltp": 112, "entry": 100, "sl": 100, "t1": 110, "tp": 130, "qty": 5, **k})
    assert a() is None
    assert a(ltp=100) == ("CLOSE", "Trailing stop")
    assert a(ltp=131) == ("CLOSE", "Target 2 Hit")


def test_trailing_only_raises_and_stays_under_the_close():
    assert dv.trailed_stop(100, 104.567, 120) == 104.57
    assert dv.trailed_stop(105, 104.0, 120) is None               # never lowered
    assert dv.trailed_stop(100, 125.0, 120) is None               # EMA above the price: leave it
    assert dv.trailed_stop(100, None, 120) is None
    assert dv.trailed_stop(100, float("nan"), 120) is None


def test_order_validity():
    fri_eve = dt.datetime(2026, 11, 13, 18, 45, tzinfo=IST)         # placed after the close on Friday: good for Monday
    assert not dv.order_expired(fri_eve, dt.datetime(2026, 11, 16, 11, 0, tzinfo=IST))
    assert dv.order_expired(fri_eve, dt.datetime(2026, 11, 16, 15, 31, tzinfo=IST))
    assert dv.order_expired(fri_eve, dt.datetime(2026, 11, 17, 9, 20, tzinfo=IST))
    mon_morning = dt.datetime(2026, 11, 16, 10, 0, tzinfo=IST)      # placed in-session: good for today
    assert not dv.order_expired(mon_morning, dt.datetime(2026, 11, 16, 14, 0, tzinfo=IST))
    assert dv.order_expired(mon_morning, dt.datetime(2026, 11, 17, 9, 15, tzinfo=IST))


def row(sym, score=80, qty=10, feed=True, setup=True):
    return {"symbol": sym, "score": score, "feed": feed, "close": 100.0, "ema20": 98.0,
            "setup": {"type": "BREAKOUT", "trigger": "buy-stop", "entry": 101.0, "stop": 95.0, "t1": 113.0, "t2": 119.0, "qty": qty} if setup else None}


def test_auto_picks_respect_slots_held_and_threshold():
    rows = [row("A", 90), row("B", 85), row("C", 80), row("D", 70, feed=True), row("E", 99, feed=False), row("F", 78, qty=0), row("G", 77, setup=False)]
    assert [r["symbol"] for r in dv.pick_for_auto(rows, {"A"}, 2, 75)] == ["B", "C"]
    assert dv.pick_for_auto(rows, set(), 0, 75) == []
    assert dv.pick_for_auto(rows, set(), -3, 75) == []
    assert [r["symbol"] for r in dv.pick_for_auto(rows, set(), 9, 75)] == ["A", "B", "C"]


class Pool:
    def __init__(self, held=()):
        self.orders, self.positions, self.sql = [], [{"symbol": s, "sl": 90.0, "stage": "T1_DONE", "id": i} for i, s in enumerate(held, 1)], []

    def acquire(self):
        pool = self

        class C:
            async def __aenter__(s): return s
            async def __aexit__(s, *a): return False
            async def fetch(s, q, *a):
                if "FROM positions" in q and "stage IN" in q:
                    return pool.positions
                if "FROM positions" in q:
                    return [{"symbol": p["symbol"]} for p in pool.positions]
                if "FROM orders" in q:
                    return [{"symbol": o[0]} for o in pool.orders]
                return []
            async def fetchval(s, q, *a):
                pool.orders.append(a)
                return len(pool.orders)
            async def execute(s, q, *a): pool.sql.append((q, a))
        return C()


def test_place_order_breakout_is_a_buy_stop_and_refuses_duplicates_and_bad_setups():
    pool = Pool()
    out = asyncio.run(dv.place_order(pool, row("TCS")))
    assert out["order_type"] == "SL" and out["qty"] == 10 and pool.orders[0][0] == "TCS"
    with pytest.raises(ValueError, match="already has"):
        asyncio.run(dv.place_order(pool, row("TCS")))
    with pytest.raises(ValueError, match="no trade setup"):
        asyncio.run(dv.place_order(pool, row("X", setup=False)))
    with pytest.raises(ValueError, match="rounds to zero"):
        asyncio.run(dv.place_order(pool, row("Y", qty=0)))


def test_pullback_uses_a_limit_order():
    r = row("INFY")
    r["setup"]["trigger"] = "limit"
    assert asyncio.run(dv.place_order(Pool(), r))["order_type"] == "LIMIT"


def test_after_run_trails_and_only_queues_when_auto_is_on():
    pool = Pool(held=["HELD"])
    rows = [{**row("HELD"), "close": 120.0, "ema20": 105.5}, row("NEW1"), row("NEW2")]
    settings = {"auto_delivery": False, "max_delivery_positions": 5, "min_score": 75}
    now = dt.datetime(2026, 11, 14, 19, 0, tzinfo=IST)
    out = asyncio.run(dv.after_run(pool, rows, settings, now))
    assert out["placed"] == [] and out["trailed"] == 1 and any("SET sl" in q and a[0] == 105.5 for q, a in pool.sql)
    pool = Pool(held=["HELD"])
    out = asyncio.run(dv.after_run(pool, rows, {**settings, "auto_delivery": True, "max_delivery_positions": 2}, now))
    assert out["placed"] == ["NEW1"]                                         # 2 slots, 1 already held


def test_margin_for_delivery_is_the_full_amount():
    import main
    assert main.required_margin("RELIANCE", "LONG", 10, 100.0, "CNC") == 1000.0
    assert main.required_margin("RELIANCE", "LONG", 10, 100.0) == 200.0              # intraday stays leveraged
    assert main.required_margin("RELIANCE", "LONG", 10, 100.0, "MIS") == 200.0
