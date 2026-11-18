import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import week52 as w
import premarket as pm

DAY = 86400000


def series(n=260, base=1000.0, last=None, hi_at=100, hi=1100.0, lo_at=50, lo=900.0, v=1000, last_v=None):
    cs = []
    for i in range(n):
        h, l = base + 5, base - 5
        if i == hi_at:
            h = hi
        if i == lo_at:
            l = lo
        cs.append({"ts": i * DAY, "o": base, "h": h, "l": l, "c": base, "v": v})
    if last is not None:
        cs[-1] = {"ts": (n - 1) * DAY, "o": last, "h": max(last, base), "l": min(last, base), "c": last, "v": last_v or v}
    return cs


def test_the_four_cases_and_their_gaps():
    assert w.classify(series(last=1115.0))["kind"] == "high_break" and w.classify(series(last=1115.0))["gap"] == 15.0
    assert w.classify(series(last=1121.0))["kind"] is None                    # more than 20 above: already gone
    r = w.classify(series(last=1075.0))
    assert r["kind"] == "near_high" and r["gap"] == -25.0 and r["high52"] == 1100.0
    assert w.classify(series(last=1100.0))["kind"] == "near_high"             # exactly at the high: not yet broken
    assert w.classify(series(last=1065.0))["kind"] is None                    # more than 30 below
    assert w.classify(series(last=890.0))["kind"] == "low_break" and w.classify(series(last=890.0))["gap"] == -10.0
    assert w.classify(series(last=925.0))["kind"] == "near_low"
    assert w.classify(series(last=1000.0))["kind"] is None


def test_the_window_is_the_previous_year_only():
    old = series(n=400, hi_at=20, hi=5000.0, last=1015.0)                    # a high 380 sessions ago is outside the 52 weeks (the year high is 1005)
    r = w.classify(old)
    assert r["high52"] < 5000 and r["kind"] == "high_break"


def test_not_enough_history_and_custom_distances():
    assert w.classify(series(n=150, last=1110.0)) is None
    assert w.classify(series(last=1140.0), break_pts=50)["kind"] == "high_break"
    assert w.classify(series(last=1050.0), near_pts=60)["kind"] == "near_high"


def test_lists_sort_nearest_first_and_volume_ratio():
    m = {"A": series(last=1118.0), "B": series(last=1102.0), "C": series(last=1090.0), "D": series(last=1080.0, last_v=3000), "E": series(n=10)}
    out = w.lists(m)
    assert [r["symbol"] for r in out["high_break"]] == ["B", "A"]
    assert [r["symbol"] for r in out["near_high"]] == ["C", "D"]
    assert out["checked"] == 4 and out["near_high"][1]["vol_ratio"] == 3.0


def test_telegram_section():
    out = w.lists({"A": series(last=1110.0), "B": series(last=905.0)})
    lines = w.telegram_lines(out)
    assert "Above 52w high" in lines[1] and "A 1,110.00 (+10.0)" in lines[1] and "near" not in lines[1]
    assert "Within Rs 30 above 52w low" in lines[4] and "B 905.00" in lines[4]
    assert "n/a" in w.telegram_lines(None)[0]
    text = pm.build_report({"week52": out})
    assert "52-WEEK HIGH / LOW" in text and "A 1,110.00" in text
    assert "52-WEEK" not in pm.build_report({})
