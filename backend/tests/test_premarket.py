import asyncio
import datetime as dt
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import premarket as pm

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TODAY = dt.date(2026, 11, 16)


def test_pivots():
    p = pm.pivots(110, 90, 100)
    assert p["P"] == 100 and p["R1"] == 110 and p["S1"] == 90 and p["R2"] == 120 and p["S2"] == 80


def test_gap_estimate_labels_and_weights():
    assert pm.gap_estimate({"Dow": 1.0, "S&P 500 fut": 0.8, "Nikkei": 0.5, "Hang Seng": 0.2, "Crude": 0.0})["label"] == "likely gap-up"
    assert pm.gap_estimate({"Dow": -1.0, "S&P 500 fut": -0.8, "Nikkei": -0.5, "Hang Seng": -0.2})["label"] == "likely gap-down"
    assert pm.gap_estimate({"Dow": 0.1, "S&P 500 fut": -0.1, "Nikkei": 0.2, "Hang Seng": 0.0})["label"] == "likely flat to small gap"
    assert pm.gap_estimate({"Dow": 2.0, "S&P 500 fut": None, "Nikkei": None, "Hang Seng": None})["score"] is None   # one input is not enough
    hot = pm.gap_estimate({"Dow": 0.45, "S&P 500 fut": 0.45, "Crude": 3.0})
    assert hot["score"] == pytest.approx(0.35) and hot["label"] == "likely flat to small gap"                   # crude spike counts against
    assert "Crude" in hot["used"] and "Nikkei" not in hot["used"]


def test_schedule_is_weekdays_at_845():
    assert pm.seconds_to_next(dt.datetime(2026, 11, 16, 8, 0, tzinfo=IST)) == 45 * 60
    fri = dt.datetime(2026, 11, 13, 9, 0, tzinfo=IST)
    assert pm.seconds_to_next(fri) == (dt.datetime(2026, 11, 16, 8, 45, tzinfo=IST) - fri).total_seconds()


def test_holiday_parsing_and_decision():
    h = pm.parse_holidays({"CM": [{"tradingDate": "16-Nov-2026"}, {"tradingDate": "bad"}], "FO": [{"tradingDate": "17-Nov-2026"}]})
    assert h == {dt.date(2026, 11, 16)}
    assert pm.parse_holidays(None) == set() and pm.parse_holidays([]) == set()

    async def hol(): return {TODAY}
    async def none(): return None
    async def empty(): return set()
    assert asyncio.run(pm.should_send(TODAY, hol)) == (False, "")
    ok, note = asyncio.run(pm.should_send(TODAY, none))
    assert ok and "unavailable" in note
    assert asyncio.run(pm.should_send(TODAY, empty)) == (True, "")
    assert asyncio.run(pm.should_send(dt.date(2026, 11, 15), empty))[0] is False          # Sunday


def full():
    return {"date": TODAY, "gap": pm.gap_estimate({"Dow": 0.6, "S&P 500 fut": 0.5, "Nikkei": 0.4, "Hang Seng": 0.3, "Crude": -0.5}), "vix": 12.34,
            "levels": {"Nifty 50": {"date": "13 Nov", "h": 25200, "l": 25000, "c": 25150}, "Bank Nifty": {"date": "13 Nov", "h": 57000, "l": 56500, "c": 56800}},
            "screener": {"ran_at": "14 Nov 18:54", "feed": 2, "min_score": 75,
                         "top": [{"symbol": "PETRONET", "score": 100, "setup": None},
                                 {"symbol": "TCS", "score": 80, "setup": {"type": "BREAKOUT", "entry": 101, "stop": 95, "t1": 113, "t2": 119, "qty": 10}}]},
            "positions": {"open": [{"symbol": "INFY", "qty": 5, "entry": 1500, "sl": 1500, "tp": 1700, "t1": 1600, "stage": "T1_DONE"}],
                          "orders": [{"symbol": "TCS", "qty": 10, "price": 101, "sl": 95, "order_type": "SL"}], "other_open": 2},
            "events": {"WIPRO": "Financial Results"}, "news": ["Markets eye Fed", "Crude slips"]}


def test_report_contains_every_section():
    t = pm.build_report(full())
    for s in ("PRE-MARKET REPORT · Mon 16 Nov 2026", "estimate from global markets, not GIFT Nifty", "Likely gap-up", "Nifty 50 close 25,150.00",
              "P 25,117", "India VIX 12.34", "Run 14 Nov 18:54: 2 stock(s) at 75+", "PETRONET 100 · no setup", "TCS 80 · breakout entry 101.00",
              "INFY 5 @ 1,500.00", "half sold", "pending buy-stop TCS 10 @ 101.00", "+ 2 other open paper position(s)", "WIPRO (Financial Results)",
              "- Markets eye Fed", "not a recommendation"):
        assert s in t, s


def test_report_survives_every_section_missing():
    t = pm.build_report({"date": TODAY})
    assert "Nifty 50: n/a" in t and "India VIX n/a" in t and "n/a (no run yet)" in t and t.count("n/a") >= 6


def test_long_reports_are_trimmed_under_the_telegram_limit():
    d = full()
    d["news"] = ["x" * 900] * 5
    d["events"] = {f"S{i}": "y" * 200 for i in range(15)}
    t = pm.build_report(d)
    assert len(t) <= pm.MAX_LEN and t.endswith("(trimmed)")


def test_send_now_needs_telegram_and_preview_sends_nothing(monkeypatch):
    sent = []

    async def fake_collect(pool, *a, **k): return {"date": TODAY}
    async def fake_notify(pool, kind, text, key=None): sent.append(kind); return True
    monkeypatch.setattr(pm, "collect", fake_collect)
    monkeypatch.setattr(pm.notify, "notify", fake_notify)
    req = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(pool=None)))
    assert "PRE-MARKET" in asyncio.run(pm.preview(req))["text"] and sent == []
    monkeypatch.setattr(pm.notify, "configured", lambda: False)
    with pytest.raises(pm.HTTPException):
        asyncio.run(pm.send_now(req))
    monkeypatch.setattr(pm.notify, "configured", lambda: True)
    assert asyncio.run(pm.send_now(req))["sent"] and sent == ["premarket"]


def test_the_kind_is_a_known_alert_kind():
    assert "premarket" in pm.notify.KINDS and pm.notify.DEFAULTS["premarket"] is True
