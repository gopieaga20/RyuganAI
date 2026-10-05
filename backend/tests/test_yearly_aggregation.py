"""Unit tests for main._aggregate_yearly (monthly -> yearly candle roll-up)."""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _aggregate_yearly


def _ts(year, month):
    return int(datetime.datetime(year, month, 1, 4, 0, tzinfo=datetime.timezone.utc).timestamp())


def _chart(rows):
    """rows: [(year, month, o, h, l, c, v), ...] -> Yahoo-shaped chart JSON."""
    return {"chart": {"result": [{
        "meta": {"symbol": "TEST"},
        "timestamp": [_ts(y, m) for y, m, *_ in rows],
        "indicators": {"quote": [{
            "open": [r[2] for r in rows], "high": [r[3] for r in rows],
            "low": [r[4] for r in rows], "close": [r[5] for r in rows],
            "volume": [r[6] for r in rows],
        }]},
    }]}}


def test_groups_months_into_calendar_years():
    out = _aggregate_yearly(_chart([
        (2023, 1, 100, 110, 95, 105, 10),
        (2023, 6, 105, 130, 100, 120, 20),
        (2023, 12, 120, 125, 90, 115, 30),
        (2024, 1, 115, 140, 110, 135, 5),
    ]))
    res = out["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    assert len(res["timestamp"]) == 2
    assert q["open"] == [100, 115]
    assert q["high"] == [130, 140]
    assert q["low"] == [90, 110]
    assert q["close"] == [115, 135]
    assert q["volume"] == [60, 5]


def test_skips_months_with_missing_close():
    out = _aggregate_yearly(_chart([
        (2023, 1, 100, 110, 95, 105, 10),
        (2023, 2, None, None, None, None, None),
        (2023, 3, 105, 112, 100, 108, 10),
    ]))
    q = out["chart"]["result"][0]["indicators"]["quote"][0]
    assert q["close"] == [108]
    assert q["volume"] == [20]


def test_output_is_sorted_by_year():
    out = _aggregate_yearly(_chart([
        (2024, 1, 1, 2, 1, 2, 1),
        (2022, 1, 1, 2, 1, 2, 1),
        (2023, 1, 1, 2, 1, 2, 1),
    ]))
    ts = out["chart"]["result"][0]["timestamp"]
    assert ts == sorted(ts)
