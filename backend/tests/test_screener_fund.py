import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import screener_fund as sf

TODAY = dt.date(2026, 11, 14)


def raw_corp(**over):
    a = {
        "net_income": [("2026-03-31", 1150.0), ("2025-03-31", 1000.0)],
        "ebit": [("2026-03-31", 1800.0)],
        "ebitda": [("2026-03-31", 2000.0)],
        "interest_expense": [("2026-03-31", 100.0)],
        "total_debt": [("2026-03-31", 2000.0)],
        "equity": [("2026-03-31", 6000.0)],
        "total_assets": [("2026-03-31", 12000.0)],
        "current_liabilities": [("2026-03-31", 4000.0)],
        "ocf": [("2026-03-31", 1700.0)],
    }
    q = {"net_income": [("2026-09-30", 300.0), ("2026-06-30", 280.0), ("2026-03-31", 270.0), ("2025-12-31", 260.0), ("2025-09-30", 240.0)],
         "ebitda": [("2026-09-30", 600.0), ("2026-06-30", 550.0), ("2026-03-31", 500.0)]}
    r = {"annual": a, "quarterly": q, "info": {"insiders": 0.55}}
    r.update(over)
    return r


def test_metrics_are_computed_from_the_statements():
    m = sf.compute_metrics(raw_corp(), TODAY)
    assert not m["stale"]
    assert m["profit_growth"] == 25.0 and m["profit_growth_source"] == "quarterly YoY"      # 300 vs 240
    assert m["roe"] == 19.2                                  # 1150 / 6000
    assert m["roce"] == 22.5                                 # 1800 / (12000-4000)
    assert m["debt_equity"] == 0.33
    assert m["interest_coverage"] == 18.0
    assert m["ocf_ebitda"] == 0.85
    assert m["promoter_pct"] == 55.0
    assert m["ebitda_accelerating"] is True
    assert m["pledge_pct"] is None


def test_growth_falls_back_to_annual_then_yahoo_figure():
    r = raw_corp()
    r["quarterly"]["net_income"] = r["quarterly"]["net_income"][:4]      # no year-ago quarter
    m = sf.compute_metrics(r, TODAY)
    assert m["profit_growth"] == 15.0 and m["profit_growth_source"] == "annual YoY"
    r["annual"]["net_income"] = r["annual"]["net_income"][:1]
    r["info"]["earnings_growth"] = 0.2
    m = sf.compute_metrics(r, TODAY)
    assert m["profit_growth"] == 20.0 and m["profit_growth_source"] == "Yahoo earnings growth"


def test_growth_is_not_computed_from_a_loss_base():
    r = raw_corp()
    r["quarterly"]["net_income"][4] = ("2025-09-30", -50.0)
    m = sf.compute_metrics(r, TODAY)
    assert m["profit_growth_source"] == "annual YoY"


def test_stale_annual_data_is_not_scored():
    r = raw_corp()
    r["annual"]["net_income"] = [("2024-03-31", 1000.0)]
    m = sf.compute_metrics(r, TODAY)
    assert m["stale"] and m["roe"] is None and m["profit_growth"] is None
    sc = sf.fundamental_score(m, "CORPORATE")
    assert not sc["ok_to_feed"]
    assert not sf.fundamental_gate(m, "CORPORATE")["pass"]


def test_stale_quarter_series_is_ignored():
    r = raw_corp()
    r["quarterly"] = {"net_income": [("2025-06-30", 300.0), ("2025-03-31", 280.0), ("2024-12-31", 270.0), ("2024-09-30", 260.0), ("2024-06-30", 240.0)], "ebitda": []}
    m = sf.compute_metrics(r, TODAY)
    assert m["profit_growth_source"] == "annual YoY" and m["ebitda_accelerating"] is None


def test_a_strong_corporate_scores_full_marks_less_the_missing_pledge():
    m = sf.compute_metrics(raw_corp(), TODAY)
    sc = sf.fundamental_score(m, "CORPORATE")
    assert sc["available"] == 45 and sc["earned"] == 45 and sc["score"] == 50.0       # pledge (5) unavailable, scaled
    assert sc["coverage"] == 0.9 and sc["ok_to_feed"]
    assert sc["parts"]["pledge"]["ok"] is None


def test_weak_numbers_lose_their_points():
    r = raw_corp()
    r["annual"]["total_debt"] = [("2026-03-31", 9000.0)]
    r["annual"]["net_income"] = [("2026-03-31", 300.0), ("2025-03-31", 1000.0)]
    r["quarterly"]["net_income"] = [("2026-09-30", 100.0)] + r["quarterly"]["net_income"][1:]
    r["quarterly"]["ebitda"] = [("2026-09-30", 400.0), ("2026-06-30", 550.0), ("2026-03-31", 500.0)]
    sc = sf.fundamental_score(sf.compute_metrics(r, TODAY), "CORPORATE")
    assert not sc["parts"]["debt"]["ok"] and not sc["parts"]["roe"]["ok"] and not sc["parts"]["growth"]["ok"]
    assert sc["score"] < 25


def test_growth_point_also_accepts_accelerating_ebitda():
    r = raw_corp()
    r["quarterly"]["net_income"] = [("2026-09-30", 250.0)] + r["quarterly"]["net_income"][1:]        # +4% only
    sc = sf.fundamental_score(sf.compute_metrics(r, TODAY), "CORPORATE")
    assert sc["parts"]["growth"]["ok"] is True


def test_financials_use_their_own_rules_and_report_missing_asset_quality():
    r = {"annual": {"net_income": [("2026-03-31", 700.0)], "equity": [("2026-03-31", 4000.0)], "total_assets": [("2026-03-31", 40000.0)],
                    "nii": [("2026-03-31", 2800.0), ("2025-03-31", 2400.0)]},
         "quarterly": {"nii": [("2026-09-30", 760.0), ("2026-06-30", 740.0), ("2026-03-31", 720.0), ("2025-12-31", 700.0), ("2025-09-30", 650.0)]},
         "info": {"insiders": 0.003}}
    m = sf.compute_metrics(r, TODAY)
    assert m["nii_growth"] == pytest.approx(16.9, abs=0.1) and m["roa"] == 1.75 and m["roe"] == 17.5
    sc = sf.fundamental_score(m, "FINANCIALS")
    assert sc["parts"]["asset_quality"]["ok"] is None
    assert sc["parts"]["growth"]["ok"] and sc["parts"]["roa"]["ok"] and not sc["parts"]["promoter"]["ok"]
    assert sc["coverage"] == 0.7 and sc["ok_to_feed"]


def test_missing_data_lowers_coverage_below_the_feed_limit():
    r = {"annual": {"net_income": [("2026-03-31", 1000.0)]}, "quarterly": {}, "info": {}}
    sc = sf.fundamental_score(sf.compute_metrics(r, TODAY), "CORPORATE")
    assert sc["coverage"] < sf.MIN_COVERAGE and not sc["ok_to_feed"]


def test_gate_passes_a_good_company_and_names_what_failed():
    g = sf.fundamental_gate(sf.compute_metrics(raw_corp(), TODAY), "CORPORATE")
    assert g["pass"] and g["failed"] == []
    r = raw_corp()
    r["annual"]["total_debt"] = [("2026-03-31", 9000.0)]
    g = sf.fundamental_gate(sf.compute_metrics(r, TODAY), "CORPORATE")
    assert not g["pass"] and any("Debt" in f for f in g["failed"])


def test_gate_does_not_pass_on_too_little_data():
    r = {"annual": {"net_income": [("2026-03-31", 1000.0), ("2025-03-31", 500.0)]}, "quarterly": {}, "info": {}}
    g = sf.fundamental_gate(sf.compute_metrics(r, TODAY), "CORPORATE")
    assert not g["pass"] and g["unchecked"]


# ───────────── adapter edge ─────────────
class FakeFrame:
    def __init__(self, rows):
        self._rows = rows
        self.empty = not rows
        self.index = list(rows)

    @property
    def loc(self):
        rows = self._rows

        class L:
            def __getitem__(s, k):
                class Row:
                    def items(self_):
                        return rows[k].items()
                return Row()
        return L()


def test_series_reads_the_first_matching_row_newest_first_and_skips_nan():
    df = FakeFrame({"Net Income": {"2025-03-31": 5.0, "2026-03-31": 7.0, "2024-03-31": float("nan")}})
    assert sf._series(df, ["Net Income Common Stockholders", "Net Income"]) == [("2026-03-31", 7.0), ("2025-03-31", 5.0)]
    assert sf._series(df, ["Nope"]) == []
    assert sf._series(None, ["Net Income"]) == []


def test_fetch_fundamentals_never_raises(monkeypatch):
    import builtins
    real = builtins.__import__

    def boom(name, *a, **k):
        if name == "yfinance":
            raise RuntimeError("429 Too Many Requests")
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", boom)
    assert sf.fetch_fundamentals("RELIANCE") is None


def test_refresh_many_paces_and_backs_off_then_skips():
    calls, sleeps, saved = [], [], []
    answers = {"A": [None, {"x": 1}], "B": [{"y": 2}], "C": [None, None, None, None]}

    def fetch(s):
        calls.append(s)
        return answers[s].pop(0)
    out = sf.refresh_many(["A", "B", "C"], fetch, sleep=sleeps.append, gap=2.0, on_row=lambda s, r: saved.append((s, r)))
    assert out == {"A": {"x": 1}, "B": {"y": 2}, "C": None}
    assert calls == ["A", "A", "B", "C", "C", "C", "C"]
    assert sleeps == [10, 2.0, 2.0, 10, 30, 60]
    assert [s for s, _ in saved] == ["A", "B", "C"]
