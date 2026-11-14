import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import screener_data as sd

BHAV = """SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
RELIANCE, EQ, 13-Nov-2026, 1400.0, 1405.0, 1420.0, 1398.0, 1415.0, 1414.5, 1410.0, 6440327, 90800.5, 250000, 3015000, 46.82
HDFCBANK, EQ, 13-Nov-2026, 900.0, 901.0, 905.0, 899.0, 903.0, 903.5, 902.0, 5000000, 45000.0, 200000, 2500000, 50.00
SOMEETF, BE, 13-Nov-2026, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 100, 1.0, 5, -, -
NODELIV, EQ, 13-Nov-2026, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 100, 1.0, 5, -, -
"""


def test_bhavcopy_parses_eq_rows_and_dashes():
    b = sd.parse_bhavcopy(BHAV)
    assert set(b) == {"RELIANCE", "HDFCBANK", "NODELIV"}
    assert b["RELIANCE"] == {"close": 1414.5, "volume": 6440327, "turnover": 90800.5, "deliv_per": 46.82}
    assert b["NODELIV"]["deliv_per"] is None


def test_bhavcopy_garbage_gives_empty():
    assert sd.parse_bhavcopy("<html>Access Denied</html>") == {}
    assert sd.parse_bhavcopy("") == {}


def test_nifty500_buckets():
    txt = "﻿Company Name,Industry,Symbol,Series,ISIN Code\nHDFC Bank Ltd.,Financial Services,HDFCBANK,EQ,X\nMaruti Suzuki India Ltd.,Automobile and Auto Components,MARUTI,EQ,Y\n"
    m = sd.parse_nifty500(txt)
    assert m["HDFCBANK"]["bucket"] == "FINANCIALS" and m["MARUTI"] == {"industry": "Automobile and Auto Components", "bucket": "CORPORATE"}


def test_ban_list_and_surveillance_shapes():
    assert sd.parse_ban_list("Securities in ban period:\n1,RBLBANK\n2, GRANULES \n") == {"RBLBANK", "GRANULES"}
    assert sd.parse_surveillance({"longterm": {"data": [{"symbol": "ABC"}]}, "shortterm": {"data": [{"symbol": "xyz "}]}}) == {"ABC", "XYZ"}
    assert sd.parse_surveillance([{"Symbol": "Q"}]) == {"Q"}
    assert sd.parse_surveillance({}) == set()


def test_angel_candles_become_ist_dated_rows():
    ts = int(dt.datetime(2026, 11, 12, 18, 30, tzinfo=dt.timezone.utc).timestamp())          # 00:00 IST on the 13th
    rows = sd.angel_to_rows([{"t": ts, "o": 1, "h": 2, "l": 1, "c": 2, "v": 5}, {"t": ts, "o": 1, "h": 3, "l": 1, "c": 3, "v": 6},
                             {"t": ts + 86400, "o": 0, "h": 0, "l": 0, "c": 0, "v": 0}, {"bad": 1}])
    assert rows == [("2026-11-13", 1.0, 3.0, 1.0, 3.0, 6)]


def test_rows_to_candles_sorted_with_delivery():
    c = sd.rows_to_candles([("2026-11-13", 1, 2, 1, 2, 5, 55.5), (dt.date(2026, 11, 12), 1, 2, 1, 1.5, 4, None)])
    assert [x["c"] for x in c] == [1.5, 2.0] and c[1]["deliv_per"] == 55.5 and "deliv_per" not in c[0]
    assert c[1]["ts"] - c[0]["ts"] == 86400000


def test_days_to_fetch():
    t = dt.date(2026, 11, 14)
    assert sd.days_to_fetch(None, t) == 420
    assert sd.days_to_fetch("2026-11-13", t) == 11
    assert sd.days_to_fetch("2026-11-14", t) == 0
    assert sd.days_to_fetch("2020-01-01", t) == 420


def test_fetchers_degrade_to_nothing(monkeypatch):
    monkeypatch.setattr(sd, "_get", lambda *a, **k: None)
    assert sd.fetch_bhavcopy(dt.date(2026, 11, 13)) == {}
    assert sd.latest_bhavcopy(dt.date(2026, 11, 14)) == (None, {})
    assert sd.fetch_nifty500() == {} and sd.fetch_ban_list(dt.date(2026, 11, 13)) is None
    assert sd.fetch_surveillance() == {"asm": None, "gsm": None}


def test_latest_bhavcopy_skips_weekends_and_holidays(monkeypatch):
    seen = []

    def fake(day):
        seen.append(day)
        return {"X": {}} if day == dt.date(2026, 11, 12) else {}
    monkeypatch.setattr(sd, "fetch_bhavcopy", fake)
    d, rows = sd.latest_bhavcopy(dt.date(2026, 11, 15))           # Sunday
    assert d == dt.date(2026, 11, 12) and rows and dt.date(2026, 11, 14) not in seen
