import datetime as dt

import outcomes as oc

IST = oc.IST


def ts(h, m, day=(2026, 11, 10)):
    return int(dt.datetime(*day, h, m, tzinfo=IST).timestamp())


def candle(h, m, o, hi, lo, c, day=(2026, 11, 10)):
    return {"ts": ts(h, m, day), "o": o, "h": hi, "l": lo, "c": c, "v": 1}


def day_candles(path, start=(10, 30)):
    """15-minute candles from `start` to 15:15 following a list of (o, h, l, c)."""
    out, t = [], start[0] * 60 + start[1]
    for o, h, l, c in path:
        out.append(candle(t // 60, t % 60, o, h, l, c)); t += 15
    return out


def test_a_call_that_moves_one_atr_the_right_way_first_worked():
    sig = candle(10, 15, 100, 101, 99, 100)
    flat = [(100, 100.5, 99.5, 100)] * 2 + [(100, 111, 99.8, 110)] + [(110, 110, 109, 110)] * 17
    r = oc.compute_outcome([sig] + day_candles(flat), sig["ts"], "BUY CE", 10.0)
    assert r["outcome"] == "worked" and r["mfe_atr"] >= 1 and r["ret_eod_atr"] == 1.0


def test_a_call_that_reverses_is_counted_even_if_it_recovers():
    sig = candle(10, 15, 100, 101, 99, 100)
    path = [(100, 100.5, 89, 90)] + [(90, 120, 90, 118)] + [(118, 118, 117, 118)] * 18
    r = oc.compute_outcome([sig] + day_candles(path), sig["ts"], "BUY CE", 10.0)
    assert r["outcome"] == "reversed" and r["mae_atr"] >= 1


def test_puts_are_scored_in_the_opposite_direction():
    sig = candle(10, 15, 100, 101, 99, 100)
    path = [(100, 100.2, 88, 89)] + [(89, 89, 88, 88)] * 19
    r = oc.compute_outcome([sig] + day_candles(path), sig["ts"], "BUY PE", 10.0)
    assert r["outcome"] == "worked" and r["ret_eod_atr"] > 1


def test_neither_level_reached():
    sig = candle(10, 15, 100, 101, 99, 100)
    r = oc.compute_outcome([sig] + day_candles([(100, 101, 99, 100)] * 20), sig["ts"], "BUY CE", 10.0)
    assert r["outcome"] == "neither"


def test_not_scored_while_the_day_is_still_running(monkeypatch):
    today = dt.datetime.now(IST).date()
    day = (today.year, today.month, today.day)
    sig = candle(10, 15, 100, 101, 99, 100, day)
    c = [candle(10, 30, 100, 105, 99, 104, day)]
    assert oc.compute_outcome([sig] + c, sig["ts"], "BUY CE", 2.0) is None


def test_signal_record_only_for_calls_and_keeps_the_vote_snapshot():
    scan = {"sym": "NIFTY 50", "call": "BUY CE", "candle_ts": 123, "confidence": 88, "score": 8, "adx": 25.0, "price": 100.0,
            "levels": {"atr": 2.5}, "votes": [{"id": "trend", "weight": 2, "vote": 1, "reason": "x"}]}
    rec = oc.signal_record(scan, {"action": "ORDER", "detail": "ok", "position_id": 7})
    assert rec["traded"] and rec["atr"] == 2.5 and rec["votes"] == [{"id": "trend", "w": 2, "v": 1}] and rec["position_id"] == 7
    assert oc.signal_record({**scan, "call": "WAIT"}, {}) is None
    assert oc.signal_record({**scan, "candle_ts": None}, {}) is None


def _rows(sym, worked, reversed_, conf=88):
    return ([{"symbol": sym, "resolved": True, "outcome": "worked", "confidence": conf, "traded": False}] * worked
            + [{"symbol": sym, "resolved": True, "outcome": "reversed", "confidence": conf, "traded": False}] * reversed_)


def test_summary_never_judges_a_small_sample():
    s = oc.summarise(_rows("SBIN", 3, 20))
    assert s["suggestions"] == [] and s["by_symbol"]["SBIN"]["worked_pct"] == 13.0


def test_summary_suggests_alert_only_for_a_clearly_bad_symbol_and_keep_for_a_good_one():
    s = oc.summarise(_rows("SBIN", 20, 45) + _rows("NIFTY 50", 45, 20) + _rows("ITC", 33, 32))
    advice = {t["symbol"]: t["advice"] for t in s["suggestions"]}
    assert advice == {"SBIN": "alert-only", "NIFTY 50": "keep"}          # ITC is a coin flip: no advice
    assert s["overall"]["resolved"] == 195


def test_event_calendar_is_read_for_one_day():
    from nse_client import events_on
    cal = [{"symbol": "TCS", "purpose": "Financial Results", "date": "14-Nov-2026"},
           {"symbol": "ITC", "purpose": "", "date": "15-Nov-2026"}, {"symbol": "BAD", "purpose": "x", "date": "soon"}]
    assert events_on(cal, dt.date(2026, 11, 14)) == {"TCS": "Financial Results"}
    assert events_on(cal, dt.date(2026, 11, 15)) == {"ITC": "board meeting"}
