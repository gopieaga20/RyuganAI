import asyncio
import datetime as dt
import json
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import screener as sc
import screener_fund as sfund

DAY = 86400000
T0 = 1735689600000                                      # 2025-01-01
TODAY = dt.date(2026, 11, 14)


def series(n, start=100.0, step=0.5, vol=100000, last_vol=None):
    out, p = [], start
    for i in range(n):
        p += step
        out.append({"ts": T0 + i * DAY, "o": p - 0.2, "h": p + 0.5, "l": p - 0.6, "c": p, "v": last_vol if (i == n - 1 and last_vol) else vol})
    return out


def raw_good():
    return {"annual": {"net_income": [("2026-03-31", 1150.0), ("2025-03-31", 1000.0)], "ebit": [("2026-03-31", 1800.0)], "ebitda": [("2026-03-31", 2000.0)],
                       "interest_expense": [("2026-03-31", 100.0)], "total_debt": [("2026-03-31", 2000.0)], "equity": [("2026-03-31", 6000.0)],
                       "total_assets": [("2026-03-31", 12000.0)], "current_liabilities": [("2026-03-31", 4000.0)], "ocf": [("2026-03-31", 1700.0)]},
            "quarterly": {"net_income": [("2026-09-30", 300.0), ("2026-06-30", 280.0), ("2026-03-31", 270.0), ("2025-12-31", 260.0), ("2025-09-30", 240.0)],
                          "ebitda": [("2026-09-30", 600.0), ("2026-06-30", 550.0), ("2026-03-31", 500.0)]},
            "info": {"insiders": 0.55, "market_cap": 5e11}}


def universe_of(n=260):
    flat = series(n, 100.0, 0.05)                         # laggard: gently rising, weak relative to the leader
    lead = series(n, 100.0, 0.6, last_vol=400000)         # leader: strong uptrend, volume spike on the last day
    return {"LEAD": {"candles": lead, "bucket": "CORPORATE", "industry": "X"}, "SLOW": {"candles": flat, "bucket": "CORPORATE", "industry": "X"},
            "TINY": {"candles": series(50), "bucket": "CORPORATE", "industry": "X"}}


def run(universe=None, fund=None, flags=None, settings=None):
    s = {**sc.DEFAULTS, "min_turnover_cr": 0.0, **(settings or {})}
    return sc.build_rows(universe or universe_of(), series(260, 100.0, 0.1), fund if fund is not None else {"LEAD": raw_good(), "SLOW": raw_good()},
                         {"LEAD": {"deliv_per": 62.0}}, flags or {"asm": set(), "gsm": set(), "ban": set()}, s, 1_000_000, TODAY)


def test_short_history_is_left_out():
    assert {r["symbol"] for r in run()} == {"LEAD", "SLOW"}


def test_the_leader_ranks_first_with_a_full_breakdown():
    rows = run()
    lead = rows[0]
    assert lead["symbol"] == "LEAD" and lead["rs"] > rows[1]["rs"]
    assert lead["tech_gate"]["pass"] and lead["fund_gate"]["pass"] and lead["hygiene"]["ok"]
    assert lead["deliv_per"] == 62.0 and lead["tech_parts"]["delivery"]["ok"] is True
    assert lead["score"] == pytest.approx(lead["fund_score"] + lead["tech_score"], abs=0.11) and lead["coverage"] == 0.9


def test_feed_needs_everything_and_the_threshold():
    assert run()[0]["feed"] is True
    assert not run(settings={"min_score": 101})[0]["feed"]
    nofund = run(fund={})
    assert not nofund[0]["feed"] and not nofund[0]["has_fundamentals"] and nofund[0]["fund_gate"]["unchecked"]


def test_surveillance_and_ban_lists_exclude_a_stock():
    for flag in ("asm", "gsm", "ban"):
        flags = {"asm": set(), "gsm": set(), "ban": set()}
        flags[flag] = {"LEAD"}
        lead = next(r for r in run(flags=flags) if r["symbol"] == "LEAD")
        assert not lead["hygiene"]["ok"] and not lead["feed"], flag


def test_unreachable_lists_are_flagged_not_assumed_clean():
    rows = run(flags={"asm": None, "gsm": None, "ban": None})
    h = next(r for r in rows if r["symbol"] == "LEAD")["hygiene"]
    assert h["ok"] and set(h["unchecked"]) >= {"asm", "gsm", "ban"}


def test_turnover_and_market_cap_gates():
    lead = next(r for r in run(settings={"min_turnover_cr": 1e6}) if r["symbol"] == "LEAD")
    assert not lead["hygiene"]["ok"]
    f = {"LEAD": raw_good(), "SLOW": raw_good()}
    f["LEAD"]["info"]["market_cap"] = 1e9                  # 100 crore
    assert not next(r for r in run(fund=f, settings={"min_mcap_cr": 5000}) if r["symbol"] == "LEAD")["hygiene"]["ok"]


def test_setup_quantity_respects_risk_and_caps():
    u = universe_of()
    cs = u["LEAD"]["candles"]
    cs[-1] = {**cs[-1], "c": cs[-1]["c"] * 1.0}
    for r in run(u):
        if r["setup"]:
            s = r["setup"]
            assert s["stop"] < s["entry"] < s["t1"] <= s["t2"] and s["qty"] >= 0
            assert s["qty"] * s["entry"] <= 1_000_000 * 0.2 + s["entry"]


def test_summary_counts():
    rows = run()
    s = sc.summarise(rows, sc.DEFAULTS)
    assert s["universe"] == 2 and s["feed"] == sum(1 for r in rows if r["feed"]) and s["min_score"] == 75


def test_settings_are_validated():
    cur = dict(sc.DEFAULTS)
    new = sc.clean_settings({"min_score": 500, "risk_pct": "x", "auto_delivery": 1, "bogus": 1, "max_delivery_positions": 3.7, "intraday_feed_size": 0}, cur)
    assert new["min_score"] == 100 and new["risk_pct"] == cur["risk_pct"] and new["auto_delivery"] is True
    assert new["max_delivery_positions"] == 3 and new["intraday_feed_size"] == 1 and "bogus" not in new


def test_settings_default_to_the_safe_side():
    assert sc.DEFAULTS["auto_delivery"] is False and sc.DEFAULTS["intraday_feed"] is False and sc.DEFAULTS["min_score"] == 75


def test_stale_symbols_picks_missing_then_oldest():
    now = dt.datetime(2026, 11, 14, tzinfo=dt.timezone.utc)
    fetched = {"A": now - dt.timedelta(days=30), "B": now - dt.timedelta(days=2), "C": now - dt.timedelta(days=10)}
    assert sc.stale_symbols(["A", "B", "C", "D"], fetched, 7, now) == ["D", "A", "C"]
    assert sc.stale_symbols(["A", "B", "C", "D"], fetched, 7, now, limit=2) == ["D", "A"]


def test_nightly_run_time_skips_weekends():
    ist = dt.timezone(dt.timedelta(hours=5, minutes=30))
    assert sc.seconds_to_next_night_run(dt.datetime(2026, 11, 13, 10, 0, tzinfo=ist)) == 8.5 * 3600            # Friday morning -> Friday 18:30
    nxt = dt.datetime(2026, 11, 13, 19, 0, tzinfo=ist)                                                          # Friday evening -> Monday
    assert sc.seconds_to_next_night_run(nxt) == (dt.datetime(2026, 11, 16, 18, 30, tzinfo=ist) - nxt).total_seconds()


class FakePool:
    def __init__(self):
        self.store = {}

    def acquire(self):
        pool = self

        class C:
            async def __aenter__(s): return s
            async def __aexit__(s, *a): return False
            async def fetchval(s, q, *a): return pool.store.get(a[0]) if "app_settings" in q else None
            async def execute(s, q, *a):
                if "app_settings" in q:
                    pool.store[a[0]] = a[1]
        return C()


def test_settings_endpoints_roundtrip():
    pool = FakePool()
    req = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(pool=pool)))
    out = asyncio.run(sc.save_settings(sc.SettingsPatch(min_score=80, auto_delivery=True), req))
    assert out["min_score"] == 80 and out["auto_delivery"] is True
    assert asyncio.run(sc.read_settings(req))["min_score"] == 80
    assert json.loads(pool.store[sc.SETTINGS_KEY])["min_score"] == 80


def test_a_second_run_is_refused_while_one_is_going(monkeypatch):
    monkeypatch.setitem(sc.state, "running", True)
    assert asyncio.run(sc.run_screen(FakePool())) == {"started": False, "reason": "already running"}


# ───────────── follow-up: intraday scan list, summary, restore ─────────────
def _feed_rows(n=14):
    return [{"symbol": f"S{i}", "feed": i < n, "score": 90 - i, "setup": {"type": "BREAKOUT", "entry": 100, "stop": 95, "t1": 110, "t2": 115, "qty": 5}} for i in range(16)]


def test_feed_universe_is_indices_plus_top_stocks_within_the_cap():
    u = sc.feed_universe(_feed_rows(), 10)
    assert u[:2] == ["NIFTY 50", "BANK NIFTY"] and u[2:] == [f"S{i}" for i in range(10)]
    assert sc.feed_universe(_feed_rows(3), 10)[2:] == ["S0", "S1", "S2"]            # fewer than asked
    assert sc.feed_universe([{**r, "feed": False} for r in _feed_rows()], 10) == ["NIFTY 50", "BANK NIFTY"]
    assert len(sc.feed_universe([{"symbol": f"X{i}", "feed": True} for i in range(100)], 99)) == sc.UNIVERSE_CAP


def test_scan_list_is_saved_once_replaced_and_restored(monkeypatch):
    import autotrader
    store, saved = {}, {"universe": ["MY1", "MY2"]}

    async def get_setting(pool, k, d=""): return store.get(k, d)
    async def set_setting(pool, k, v): store[k] = v
    async def load_settings(pool): return {"universe": list(saved["universe"])}
    async def save_settings(pool, patch): saved.update(patch)
    monkeypatch.setattr(sc.auth, "get_setting", get_setting)
    monkeypatch.setattr(sc.auth, "set_setting", set_setting)
    monkeypatch.setattr(autotrader, "load_settings", load_settings)
    monkeypatch.setattr(autotrader, "save_settings", save_settings)
    asyncio.run(sc.apply_intraday_feed(None, _feed_rows(), 2))
    assert saved["universe"] == ["NIFTY 50", "BANK NIFTY", "S0", "S1"] and json.loads(store[sc.PREV_UNIVERSE_KEY]) == ["MY1", "MY2"]
    asyncio.run(sc.apply_intraday_feed(None, _feed_rows(), 3))                      # a second night must not overwrite the owner's list
    assert json.loads(store[sc.PREV_UNIVERSE_KEY]) == ["MY1", "MY2"]
    assert asyncio.run(sc.restore_universe(None)) == ["MY1", "MY2"] and saved["universe"] == ["MY1", "MY2"]
    assert asyncio.run(sc.restore_universe(None)) is None                           # nothing left to restore


def test_summary_text_lists_the_top_five_and_the_caveat():
    t = sc.summary_text(_feed_rows(), sc.DEFAULTS)
    assert t.startswith("SCREENER: 14 stock(s) at 75+") and t.count("entry 100") == 5 and "not a recommendation" in t


def test_follow_up_steps_are_independent(monkeypatch):
    import notify
    calls = []

    async def boom(pool, rows, settings): raise RuntimeError("db down")
    async def feed(pool, rows, size): calls.append("feed"); return []
    async def send(pool, kind, text, key=None): calls.append(kind)
    monkeypatch.setattr(sc.delivery, "after_run", boom)
    monkeypatch.setattr(sc, "apply_intraday_feed", feed)
    monkeypatch.setattr(notify, "notify", send)
    async def w52(pool, settings=None): return {"high_break": [], "near_high": [], "low_break": [], "near_low": [], "checked": 5, "asof": "2026-11-17", "break_pts": 20, "near_pts": 30}
    monkeypatch.setattr(sc, "week52_lists", w52)
    out = asyncio.run(sc.follow_up(None, _feed_rows(), {**sc.DEFAULTS, "intraday_feed": True}))
    assert out["delivery"] == {"error": "db down"} and calls == ["feed", "screener", "week52"]
    calls.clear()
    asyncio.run(sc.follow_up(None, _feed_rows(), sc.DEFAULTS))
    assert calls == ["screener", "week52"]                                          # the scan list is untouched unless switched on


def test_evening_52_week_message_is_sent_once_per_closing_date(monkeypatch):
    import notify
    sent = []

    async def send(pool, kind, text, key=None): sent.append((kind, key, text))
    async def nothing(*a, **k): return {}
    async def w52(pool, settings=None):
        return {"high_break": [{"symbol": "ICICIBANK", "close": 1500.0, "gap": 20.0}], "near_high": [], "low_break": [], "near_low": [],
                "checked": 218, "asof": "2026-11-05", "break_pts": 20, "near_pts": 30}
    monkeypatch.setattr(notify, "notify", send)
    monkeypatch.setattr(sc.delivery, "after_run", nothing)
    monkeypatch.setattr(sc, "week52_lists", w52)
    out = asyncio.run(sc.follow_up(None, [], sc.DEFAULTS))
    kind, key, text = sent[-1]
    assert kind == "week52" and key == "week52:2026-11-05" and out["week52"]["high_break"] == 1
    assert "52-WEEK HIGH / LOW" in text and "ICICIBANK 1,500.00 (+20.0)" in text and "not a recommendation" in text


def test_screener_applies_the_stop_cap():
    assert sc.DEFAULTS["max_stop_pct"] == 8.0
    loose = [r["setup"] for r in run(settings={"max_stop_pct": 30}) if r["setup"]]
    tight = [r["setup"] for r in run(settings={"max_stop_pct": 0.01}) if r["setup"]]
    assert tight == [] and all((s["entry"] - s["stop"]) / s["entry"] * 100 <= 30 for s in loose)
    assert sc.clean_settings({"max_stop_pct": 99}, dict(sc.DEFAULTS))["max_stop_pct"] == 30
