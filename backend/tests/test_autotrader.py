"""Auto paper-trader: the safety rules, the option choice and one full cycle, with no database or network."""
import asyncio
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import autotrader as at

IST = at.IST
MON_10AM = dt.datetime(2026, 11, 2, 10, 30, tzinfo=IST)        # a Monday
SAT_10AM = dt.datetime(2026, 11, 7, 10, 0, tzinfo=IST)
# the older tests trade stocks from 10:15; the defaults changed on 14 Nov 2026 (indices only, entries from 11:30) and have their own tests at the end
CFG = {**at.DEFAULTS, "enabled": True, "universe": ["NIFTY 50", "RELIANCE", "TCS"], "auto_stocks": True, "entry_from_min": 10 * 60 + 15}
NO_PORTFOLIO_RULES = {"max_same_direction": 0, "max_stops_per_day": 0, "nifty_agree": False}      # for tests of the OTHER limits


def call(sym="RELIANCE", call="BUY CE", conf=90, price=1300.0, ts=111):
    return {"sym": sym, "ok": True, "call": call, "confidence": conf, "price": price, "candle_ts": ts, "note": ""}


# ───────────── pure helpers ─────────────
def test_market_hours():
    assert at.market_open(dt.datetime(2026, 11, 2, 9, 15, tzinfo=IST))
    assert not at.market_open(dt.datetime(2026, 11, 2, 9, 14, tzinfo=IST))
    assert at.market_open(dt.datetime(2026, 11, 2, 15, 29, tzinfo=IST))
    assert not at.market_open(dt.datetime(2026, 11, 2, 15, 30, tzinfo=IST))
    assert not at.market_open(SAT_10AM)


def test_underlying_mapping():
    assert at.underlying_of("NIFTY 50") == "NIFTY" and at.underlying_of("bank nifty") == "BANKNIFTY"
    assert at.underlying_of("SENSEX") is None
    assert at.underlying_of("HDFCBANK.NS") == "HDFCBANK" and at.underlying_of("TATA STEEL") == "TATASTEEL"
    assert at.underlying_from_contract("NIFTY03NOV2623450CE") == "NIFTY"
    assert at.underlying_from_contract("360ONE24NOV26900PE") == "360ONE"
    assert at.underlying_from_contract("garbage") is None


def test_news_label_matches_the_dashboard_rules():
    assert at.news_label([]) is None
    assert at.news_label([{"title": "Markets rally on strong gains"}, {"title": "Stocks surge, record high"}]) == "BULLISH"
    assert at.news_label([{"title": "Crash fears as stocks plunge"}]) == "BEARISH"
    assert at.news_label([{"title": "Market opens flat"}]) == "NEUTRAL"


def test_payload_parsing_drops_bad_rows():
    payload = {"chart": {"result": [{"timestamp": [1, 2, 3], "indicators": {"quote": [
        {"open": [1, None, 3], "high": [1, 2, 3], "low": [1, 2, 3], "close": [1, 2, None], "volume": [5, 6, 7]}]}}]}}
    c = at.payload_to_candles(payload)
    assert len(c) == 1 and c[0]["v"] == 5 and c[0]["ts"] == 1000
    assert at.payload_to_candles({}) == []


CONTRACTS = [
    {"symbol": f"X{d[:5]}{d[7:]}{k}{t}", "expiry": d, "strike": float(k), "type": t}      # real format: NAME 03NOV26 1300 CE
    for d in ("03NOV2026", "10NOV2026", "24NOV2026") for t in ("CE", "PE") for k in (1250, 1300, 1350)
]


def test_pick_contract_nearest_expiry_and_atm_strike():
    c = at.pick_contract(CONTRACTS, 1311.0, dt.date(2026, 11, 2), "CE")
    assert c["expiry"] == "03NOV2026" and c["strike"] == 1300 and c["type"] == "CE"
    assert at.pick_contract(CONTRACTS, 1340.0, dt.date(2026, 11, 2), "PE")["strike"] == 1350


def test_pick_contract_skips_same_day_expiry():
    c = at.pick_contract(CONTRACTS, 1300.0, dt.date(2026, 11, 3), "CE", min_days=1)       # 03NOV expires today
    assert c["expiry"] == "10NOV2026"
    assert at.pick_contract([], 100, dt.date(2026, 11, 2), "CE") is None


def test_seconds_to_next_run_is_aligned_to_five_minutes():
    t = dt.datetime(2026, 11, 2, 10, 2, 30, tzinfo=IST).timestamp()
    assert at.seconds_to_next_run(t) == pytest.approx(158.0)           # 10:05:00 + 8 s settle
    t2 = dt.datetime(2026, 11, 2, 10, 5, 0, tzinfo=IST).timestamp()
    assert at.seconds_to_next_run(t2) == pytest.approx(308.0)


# ───────────── the safety rules ─────────────
@pytest.mark.parametrize("res,why", [
    (call(conf=84), "below"),
    (call(call="WAIT"), None),
    (call(sym="SENSEX"), "no NSE option chain"),
])
def test_decide_rejects(res, why):
    ok, reason = at.decide(res, CFG, [], MON_10AM)
    assert not ok and (why is None or why in reason)


def test_decide_accepts_a_strong_call():
    assert at.decide(call(conf=85), CFG, [], MON_10AM) == (True, "ok")


def test_decide_respects_the_entry_window():
    assert not at.decide(call(), CFG, [], dt.datetime(2026, 11, 2, 9, 20, tzinfo=IST))[0]
    assert not at.decide(call(), CFG, [], dt.datetime(2026, 11, 2, 14, 45, tzinfo=IST))[0]
    assert at.decide(call(), CFG, [], dt.datetime(2026, 11, 2, 14, 30, tzinfo=IST))[0]


def test_decide_enforces_max_positions_and_one_per_underlying():
    five = [{"id": i, "symbol": f"AAA{i}03NOV2610CE"} for i in range(5)]
    assert "max 5" in at.decide(call(), CFG, five, MON_10AM)[1]
    held = [{"id": 1, "symbol": "RELIANCE10NOV261300CE"}]
    assert "already has" in at.decide(call(), CFG, held, MON_10AM)[1]
    assert at.decide(call(sym="TCS"), CFG, held, MON_10AM)[0]
    assert "already acted" in at.decide(call(), CFG, [], MON_10AM, acted_on_candle=True)[1]


# ───────────── a whole cycle ─────────────
class MemStore(at.Store):
    def __init__(self, refuse=False):
        self.positions, self.logs, self.refuse = [], [], refuse
        self.last_scan = None

    async def save_last_scan(self, scan):
        self.last_scan = scan

    async def open_auto_positions(self):
        return list(self.positions)

    async def acted_on(self, symbol, candle_ts):
        return any(l["symbol"] == symbol and l["candle_ts"] == candle_ts and l["action"] == "ORDER" for l in self.logs)

    async def orders_today(self, day):
        return sum(1 for l in self.logs if l["action"] == "ORDER")

    async def orders_today_by_und(self, day):
        out = {}
        for l in self.logs:
            if l["action"] == "ORDER":
                u = at.underlying_of(l["symbol"]) or l["symbol"]
                out[u] = out.get(u, 0) + 1
        return out

    async def place(self, symbol, qty, price, sl, tp, product="NRML"):
        self.products = getattr(self, "products", []) + [product]
        if self.refuse:
            raise RuntimeError("Insufficient margin")
        pid = len(self.positions) + 1
        self.positions.append({"id": pid, "symbol": symbol, "qty": qty, "price": price, "sl": sl, "tp": tp})
        return pid, qty * price

    async def log(self, row):
        self.logs.append(row)


def make_deps(ltp=100.0, lots=None, contracts=CONTRACTS):
    async def nothing(*a):
        return []

    async def price(symbol):
        return ltp
    return at.Deps(fetch_candles=nothing, fetch_headlines=nothing,
                   get_contracts=lambda und: [{**c, "symbol": f"{und}{c['symbol'][1:]}"} for c in contracts],
                   get_lot_size=lambda und: (lots or {}).get(und, 500), fetch_ltp=price)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(at, "LTP_RETRY_SLEEP", 0)


@pytest.fixture
def patch_scan(monkeypatch):
    def install(results):
        async def fake(sym, deps):
            return dict(results[sym])
        monkeypatch.setattr(at, "scan_symbol", fake)
    return install


def run(coro):
    return asyncio.run(coro)


def test_cycle_buys_the_atm_option_with_the_configured_stop_and_target(patch_scan):
    patch_scan({"NIFTY 50": call("NIFTY 50", "BUY PE", 90, 23100.0), "RELIANCE": call("RELIANCE", "WAIT"), "TCS": call("TCS", "BUY CE", 70)})
    store = MemStore()
    out = run(at.run_cycle(store, CFG, make_deps(ltp=100.0, lots={"NIFTY": 65}), now=MON_10AM))
    assert len(store.positions) == 1                                    # TCS at 70% is below 85
    p = store.positions[0]
    assert p["symbol"].startswith("NIFTY") and p["symbol"].endswith("PE")
    assert p["qty"] == 130 and p["sl"] == 70.0 and p["tp"] == 130.0       # Nifty: always 130 units; stop -30%, target +30%
    orders = [d for d in out if d["action"] == "ORDER"]
    assert len(orders) == 1 and orders[0]["position_id"] == 1


def test_cycle_never_exceeds_the_position_limit_and_prefers_the_strongest(patch_scan):
    syms = [f"S{i}" for i in range(8)]
    patch_scan({s: call(s, "BUY CE", 85 + i, 1300.0, ts=i) for i, s in enumerate(syms)})
    store = MemStore()
    run(at.run_cycle(store, {**CFG, "universe": syms, "max_trades_per_day": 99, **NO_PORTFOLIO_RULES}, make_deps(), now=MON_10AM))
    assert len(store.positions) == 5
    bought = {at.underlying_from_contract(p["symbol"]) for p in store.positions}
    assert bought == {"S7", "S6", "S5", "S4", "S3"}                     # the five highest confidences


def test_second_cycle_on_the_same_candle_does_not_double_up(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90, ts=555)})
    store = MemStore()
    cfg = {**CFG, "universe": ["RELIANCE"]}
    run(at.run_cycle(store, cfg, make_deps(), now=MON_10AM))
    run(at.run_cycle(store, cfg, make_deps(), now=MON_10AM))
    assert len(store.positions) == 1


def test_dry_run_orders_nothing(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90)})
    store = MemStore()
    out = run(at.run_cycle(store, {**CFG, "universe": ["RELIANCE"]}, make_deps(), now=MON_10AM, dry=True))
    assert store.positions == [] and out[0]["action"] == "WOULD ORDER"


def test_refused_order_is_logged_not_raised(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90)})
    store = MemStore(refuse=True)
    out = run(at.run_cycle(store, {**CFG, "universe": ["RELIANCE"]}, make_deps(), now=MON_10AM))
    assert out[0]["action"] == "SKIP" and "refused" in out[0]["detail"]


def test_no_price_or_no_contract_means_no_order(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90)})
    cfg = {**CFG, "universe": ["RELIANCE"]}
    s1 = MemStore()
    out = run(at.run_cycle(s1, cfg, make_deps(ltp=0), now=MON_10AM))
    assert s1.positions == [] and "no live price" in out[0]["detail"]
    s2 = MemStore()
    out = run(at.run_cycle(s2, cfg, make_deps(contracts=[]), now=MON_10AM))
    assert s2.positions == [] and "no suitable option contract" in out[0]["detail"]


def test_scan_errors_are_isolated():
    async def boom(*a):
        raise RuntimeError("yahoo down")
    deps = at.Deps(fetch_candles=boom, fetch_headlines=boom, get_contracts=lambda u: [], get_lot_size=lambda u: 1, fetch_ltp=boom)
    r = run(at.scan_symbol("RELIANCE", deps))
    assert r["call"] == "WAIT" and not r["ok"]


def test_dry_run_also_respects_the_position_limit(patch_scan):
    syms = [f"S{i}" for i in range(8)]
    patch_scan({s: call(s, "BUY CE", 90, 1300.0, ts=i) for i, s in enumerate(syms)})
    out = run(at.run_cycle(MemStore(), {**CFG, "universe": syms, "max_trades_per_day": 99, **NO_PORTFOLIO_RULES}, make_deps(), now=MON_10AM, dry=True))
    assert sum(1 for d in out if d["action"] == "WOULD ORDER") == 5


def test_a_flaky_price_is_retried(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90)})
    answers = iter([None, 0, 101.0])

    async def price(symbol):
        return next(answers)
    deps = make_deps()
    deps.fetch_ltp = price
    store = MemStore()
    run(at.run_cycle(store, {**CFG, "universe": ["RELIANCE"]}, deps, now=MON_10AM))
    assert len(store.positions) == 1 and store.positions[0]["price"] == 101.0


# ───────────── daily trade limit, Nifty quantity, settings ─────────────
def test_defaults_are_the_requested_rules():
    d = at.DEFAULTS
    assert d["sl_pct"] == 0.30 and d["tp_pct"] == 0.30 and d["max_trades_per_day"] == 5 and d["nifty_qty"] == 130
    assert d["min_confidence"] == 85 and d["max_positions"] == 5


def test_decide_enforces_the_daily_trade_limit():
    assert at.decide(call(), CFG, [], MON_10AM, orders_today=4)[0]
    ok, why = at.decide(call(), CFG, [], MON_10AM, orders_today=5)
    assert not ok and "daily limit" in why


def test_only_five_orders_a_day_even_with_free_slots(patch_scan):
    syms = [f"S{i}" for i in range(9)]
    patch_scan({s: call(s, "BUY CE", 90, 1300.0, ts=i) for i, s in enumerate(syms)})
    store = MemStore()
    cfg = {**CFG, "universe": syms, "max_positions": 20, **NO_PORTFOLIO_RULES}
    run(at.run_cycle(store, cfg, make_deps(), now=MON_10AM))
    assert len(store.positions) == 5
    # a later scan the same day (some positions already closed) must still respect the day's count
    store.positions.clear()
    patch_scan({s: call(s, "BUY CE", 90, 1300.0, ts=100 + i) for i, s in enumerate(syms)})
    out = run(at.run_cycle(store, cfg, make_deps(), now=MON_10AM))
    assert len(store.positions) == 0 and all("daily limit" in d["detail"] for d in out if d["call"] == "BUY CE")


def test_nifty_is_always_130_units_and_others_one_lot():
    assert at.order_qty("NIFTY", 65, at.DEFAULTS) == 130
    assert at.order_qty("NIFTY", 75, at.DEFAULTS) == 150            # a changed lot size: nearest whole number of lots
    assert at.order_qty("BANKNIFTY", 30, at.DEFAULTS) == 30
    assert at.order_qty("RELIANCE", 500, at.DEFAULTS) == 500
    assert at.order_qty("NIFTY", 65, {**at.DEFAULTS, "nifty_qty": 0}) == 65


def test_legacy_saved_row_only_carries_over_genuine_user_choices():
    import json
    stale = json.dumps({"enabled": True, "tp_pct": 0.5, "sl_pct": 0.1, "nifty_qty": 50, "max_positions": 3, "min_confidence": 90})
    cfg = at.merge_settings(stale, legacy=True)
    assert cfg["enabled"] is True and cfg["max_positions"] == 3 and cfg["min_confidence"] == 90
    assert cfg["tp_pct"] == 0.30 and cfg["sl_pct"] == 0.30 and cfg["nifty_qty"] == 130              # old whole-config values ignored
    assert at.merge_settings("not json")["tp_pct"] == 0.30 and at.merge_settings(None)["enabled"] is False


def test_new_settings_row_honours_stop_target_lots_and_symbols():
    import json
    raw = json.dumps({"sl_pct": 0.2, "tp_pct": 0.6, "lots": 3, "symbols": {"reliance": {"sl_pct": 0.1, "lots": 4}}, "nifty_qty": 1})
    cfg = at.merge_settings(raw)
    assert cfg["sl_pct"] == 0.2 and cfg["tp_pct"] == 0.6 and cfg["lots"] == 3
    assert cfg["symbols"] == {"RELIANCE": {"sl_pct": 0.1, "lots": 4}}
    assert cfg["nifty_qty"] == 130                                                                      # not user-changeable


def test_symbol_overrides_are_validated():
    cleaned = at.clean_symbols({"tcs": {"sl_pct": 0.2, "tp_pct": 9, "lots": 0, "enabled": False, "evil": 1}, "x": "no", "itc": {"lots": "2"}})
    assert cleaned == {"TCS": {"sl_pct": 0.2, "enabled": False}, "ITC": {"lots": 2}}      # out-of-range / unknown fields dropped
    assert at.clean_symbols(None) == {}


def test_per_symbol_lots_stop_and_target_are_used(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90), "TCS": call("TCS", "BUY CE", 90, ts=2)})
    store = MemStore()
    cfg = {**CFG, "universe": ["RELIANCE", "TCS"], "symbols": {"RELIANCE": {"sl_pct": 0.2, "tp_pct": 0.6, "lots": 3}}}
    run(at.run_cycle(store, cfg, make_deps(ltp=100.0), now=MON_10AM))
    rel = next(p for p in store.positions if p["symbol"].startswith("RELIANCE"))
    tcs = next(p for p in store.positions if p["symbol"].startswith("TCS"))
    assert rel["qty"] == 3 * 500 and rel["sl"] == 80.0 and rel["tp"] == 160.0                # its own settings
    assert tcs["qty"] == 500 and tcs["sl"] == 70.0 and tcs["tp"] == 130.0                    # global defaults


def test_nifty_own_lots_beats_the_fixed_130():
    assert at.order_qty("NIFTY", 65, {**at.DEFAULTS, "symbols": {"NIFTY": {"lots": 3}}}) == 195
    assert at.order_qty("NIFTY", 65, at.DEFAULTS) == 130


def test_a_symbol_switched_off_in_settings_is_skipped():
    cfg = {**CFG, "symbols": {"RELIANCE": {"enabled": False}}}
    ok, why = at.decide(call("RELIANCE"), cfg, [], MON_10AM)
    assert not ok and "switched off" in why and at.decide(call("TCS"), cfg, [], MON_10AM)[0]


def test_the_last_scan_lists_every_symbol_including_waits(patch_scan):
    patch_scan({"NIFTY 50": call("NIFTY 50", "BUY PE", 90, 23100.0), "RELIANCE": {**call("RELIANCE", "WAIT", 32), "note": "ADX 12 is below 20"},
                "TCS": call("TCS", "BUY CE", 70)})
    store = MemStore()
    run(at.run_cycle(store, CFG, make_deps(lots={"NIFTY": 65}), now=MON_10AM))
    rows = {r["symbol"]: r for r in store.last_scan["rows"]}
    assert set(rows) == {"NIFTY 50", "RELIANCE", "TCS"} and store.last_scan["at"] == MON_10AM.timestamp()
    assert rows["RELIANCE"]["detail"] == "ADX 12 is below 20" and rows["NIFTY 50"]["action"] == "ORDER"
    assert rows["TCS"]["detail"].startswith("confidence 70%")


def test_a_dry_run_does_not_overwrite_the_last_scan(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90)})
    store = MemStore()
    run(at.run_cycle(store, {**CFG, "universe": ["RELIANCE"]}, make_deps(), now=MON_10AM, dry=True))
    assert store.last_scan is None


# ───────────── Nifty one at a time, stocks once a day, product ─────────────
NIFTY_CALL = lambda **kw: call("NIFTY 50", price=23100.0, **kw)          # noqa: E731


def test_nifty_can_trade_many_times_a_day_but_only_one_position_at_a_time():
    held = [{"id": 1, "symbol": "NIFTY10NOV2623100PE"}]
    ok, why = at.decide(NIFTY_CALL(), CFG, held, MON_10AM, by_und={"NIFTY": 1})
    assert not ok and "waiting for it to hit its target or stop" in why
    assert at.decide(NIFTY_CALL(), CFG, [], MON_10AM, by_und={"NIFTY": 1})[0]               # previous one closed: next is allowed
    assert at.decide(NIFTY_CALL(), CFG, [], MON_10AM, by_und={"NIFTY": 2})[0]               # still under the Nifty limit of 3
    ok, why = at.decide(NIFTY_CALL(), CFG, [], MON_10AM, by_und={"NIFTY": 3})
    assert not ok and "limit 3 a day" in why


def test_nifty_is_not_stopped_by_the_shared_stock_cap():
    assert at.decide(NIFTY_CALL(), CFG, [], MON_10AM, orders_today=5, by_und={"NIFTY": 2})[0]
    assert not at.decide(call("TCS"), CFG, [], MON_10AM, orders_today=5)[0]                 # the cap still stops the stocks


def test_a_stock_is_traded_once_a_day_by_default_and_the_limit_is_changeable():
    ok, why = at.decide(call("RELIANCE"), CFG, [], MON_10AM, by_und={"RELIANCE": 1})
    assert not ok and "already had 1 auto order today" in why and "limit 1 a day" in why
    assert at.decide(call("TCS"), CFG, [], MON_10AM, by_und={"RELIANCE": 1})[0]             # other stocks are unaffected
    two = {**CFG, "stock_max_per_day": 2}
    assert at.decide(call("RELIANCE"), two, [], MON_10AM, by_und={"RELIANCE": 1})[0]
    assert not at.decide(call("RELIANCE"), two, [], MON_10AM, by_und={"RELIANCE": 2})[0]
    own = {**CFG, "symbols": {"RELIANCE": {"max_per_day": 3}}}                              # a per-stock override wins
    assert at.decide(call("RELIANCE"), own, [], MON_10AM, by_und={"RELIANCE": 2})[0]
    assert not at.decide(call("TCS"), own, [], MON_10AM, by_und={"TCS": 1})[0]


def test_a_cycle_orders_a_stock_only_once_a_day(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90, 1300.0, ts=111)})
    store = MemStore()
    cfg = {**CFG, "universe": ["RELIANCE"]}
    run(at.run_cycle(store, cfg, make_deps(ltp=100.0, lots={"RELIANCE": 250}), now=MON_10AM))
    assert len(store.positions) == 1
    store.positions.clear()                                                                   # it hit its target
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90, 1300.0, ts=222)})                 # a fresh signal on a later candle
    out = run(at.run_cycle(store, cfg, make_deps(ltp=100.0, lots={"RELIANCE": 250}), now=MON_10AM))
    assert len(store.positions) == 0 and "limit 1 a day" in out[0]["detail"]


def test_the_product_is_a_setting_with_a_per_stock_override():
    assert at.DEFAULTS["product"] == "INTRADAY"
    assert at.symbol_params(CFG, "TCS")["product"] == "INTRADAY"
    assert at.symbol_params({**CFG, "product": "CARRYFORWARD"}, "TCS")["product"] == "CARRYFORWARD"
    mixed = {**CFG, "product": "INTRADAY", "symbols": at.clean_symbols({"RELIANCE": {"product": "carryforward", "max_per_day": 2}, "TCS": {"product": "bogus"}})}
    assert at.symbol_params(mixed, "RELIANCE")["product"] == "CARRYFORWARD" and at.symbol_params(mixed, "RELIANCE")["max_per_day"] == 2
    assert "TCS" not in mixed["symbols"] and at.symbol_params(mixed, "TCS")["product"] == "INTRADAY"


def test_the_chosen_product_is_what_the_paper_position_gets(patch_scan):
    patch_scan({"RELIANCE": call("RELIANCE", "BUY CE", 90, 1300.0)})
    for chosen, stored in (("INTRADAY", "MIS"), ("CARRYFORWARD", "NRML")):
        store = MemStore()
        run(at.run_cycle(store, {**CFG, "universe": ["RELIANCE"], "product": chosen}, make_deps(ltp=100.0, lots={"RELIANCE": 250}), now=MON_10AM))
        assert store.products == [stored]


def test_intraday_square_off_time():
    assert not at.squareoff_due(dt.datetime(2026, 11, 2, 15, 14, tzinfo=IST))
    assert at.squareoff_due(dt.datetime(2026, 11, 2, 15, 15, tzinfo=IST))
    assert not at.squareoff_due(dt.datetime(2026, 11, 1, 16, 0, tzinfo=IST))                  # a Sunday


# ───────────── portfolio risk: same-way cap, daily stops, Nifty agreement, entry from 10:15 ─────────────
def held(*symbols):
    return [{"id": i + 1, "symbol": s} for i, s in enumerate(symbols)]


def test_at_most_two_positions_bet_the_same_way():
    two_ce = held("RELIANCE23NOV261300CE", "TCS23NOV263400CE")
    ok, why = at.decide(call("INFY", "BUY CE"), CFG, two_ce, MON_10AM)
    assert not ok and "2 call (CE) positions already open" in why and "together" in why
    assert at.decide(call("INFY", "BUY PE"), CFG, two_ce, MON_10AM)[0]                      # the other way is still allowed
    assert at.decide(call("INFY", "BUY CE"), CFG, held("RELIANCE23NOV261300CE", "TCS23NOV263400PE"), MON_10AM)[0]
    assert at.decide(call("INFY", "BUY CE"), {**CFG, "max_same_direction": 3}, two_ce, MON_10AM)[0]       # changeable in Settings
    assert at.decide(call("INFY", "BUY CE"), {**CFG, "max_same_direction": 0}, two_ce, MON_10AM)[0]       # 0 = off


def test_no_new_trades_after_the_days_stop_limit():
    ok, why = at.decide(call(), CFG, [], MON_10AM, stops_today=2)
    assert not ok and "2 stop-losses already today" in why
    assert at.decide(call(), CFG, [], MON_10AM, stops_today=1)[0]
    assert at.decide(call(), {**CFG, "max_stops_per_day": 0}, [], MON_10AM, stops_today=9)[0]


def test_a_stock_call_must_agree_with_the_nifty():
    ok, why = at.decide(call("RELIANCE", "BUY CE"), CFG, [], MON_10AM, nifty_score=-4)
    assert not ok and "Nifty's own signal" in why
    assert not at.decide(call("RELIANCE", "BUY CE"), CFG, [], MON_10AM, nifty_score=1)[0]          # too weak to agree
    assert at.decide(call("RELIANCE", "BUY CE"), CFG, [], MON_10AM, nifty_score=3)[0]
    assert at.decide(call("RELIANCE", "BUY PE"), CFG, [], MON_10AM, nifty_score=-3)[0]
    assert not at.decide(call("RELIANCE", "BUY PE"), CFG, [], MON_10AM, nifty_score=3)[0]
    assert at.decide(call("NIFTY 50", "BUY CE", price=23100.0), CFG, [], MON_10AM, nifty_score=-4)[0]   # the Nifty itself is exempt
    assert at.decide(call("RELIANCE", "BUY CE"), CFG, [], MON_10AM, nifty_score=None)[0]            # no Nifty reading: the rule cannot apply
    assert at.decide(call("RELIANCE", "BUY CE"), {**CFG, "nifty_agree": False}, [], MON_10AM, nifty_score=-4)[0]


def test_entries_start_at_10_15():
    assert at.DEFAULTS["entry_from_min"] == 11 * 60 + 30          # the default; these older tests run with CFG, which starts at 10:15
    assert not at.decide(call(), CFG, [], dt.datetime(2026, 11, 2, 10, 14, tzinfo=IST))[0]
    assert at.decide(call(), CFG, [], dt.datetime(2026, 11, 2, 10, 15, tzinfo=IST))[0]


def test_a_cycle_uses_the_nifty_reading_and_todays_stops(patch_scan):
    nifty = {**call("NIFTY 50", "WAIT", 40, 23100.0), "score": -4}
    patch_scan({"NIFTY 50": nifty, "RELIANCE": {**call("RELIANCE", "BUY CE", 90), "score": 6}})
    store = MemStore()
    out = run(at.run_cycle(store, {**CFG, "universe": ["NIFTY 50", "RELIANCE"]}, make_deps(lots={"RELIANCE": 250}), now=MON_10AM))
    assert not store.positions and "Nifty's own signal (-4)" in next(d["detail"] for d in out if d["symbol"] == "RELIANCE")

    class Stopped(MemStore):
        async def stops_today(self, day):
            return 2
    patch_scan({"NIFTY 50": {**nifty, "score": 5}, "RELIANCE": {**call("RELIANCE", "BUY CE", 90), "score": 6}})
    out = run(at.run_cycle(Stopped(), {**CFG, "universe": ["NIFTY 50", "RELIANCE"]}, make_deps(lots={"RELIANCE": 250}), now=MON_10AM))
    assert "stop-losses already today" in next(d["detail"] for d in out if d["symbol"] == "RELIANCE")


def test_the_new_settings_are_saved_and_have_safe_defaults():
    d = at.DEFAULTS
    assert d["max_same_direction"] == 2 and d["max_stops_per_day"] == 2 and d["nifty_agree"] is True
    assert {"max_same_direction", "max_stops_per_day", "nifty_agree"} <= at.USER_KEYS
    assert at.merge_settings('{"max_same_direction": 1, "nifty_agree": false}')["max_same_direction"] == 1
    assert at.direction_of_contract("NIFTY10NOV2623950CE") == 1 and at.direction_of_contract("NIFTY10NOV2623950PE") == -1


def test_built_in_defaults_from_the_reversal_study():
    assert at.symbol_params(CFG, "NIFTY")["product"] == "INTRADAY"          # overnight gaps cost more than carrying earned
    base = {**at.DEFAULTS, "enabled": True}
    for und in ("NIFTY", "BANKNIFTY"):
        assert at.symbol_params(base, und)["enabled"] is True          # the indices trade automatically
    for und in ("HDFCBANK", "SBIN", "TCS", "RELIANCE"):
        assert at.symbol_params(base, und)["enabled"] is False         # stocks are alert-only by default
    assert at.symbol_params({**base, "auto_stocks": True}, "TCS")["enabled"] is True
    # a per-stock choice always wins, both ways
    on = {**base, "symbols": at.clean_symbols({"SBIN": {"enabled": True}, "BANKNIFTY": {"enabled": False}})}
    assert at.symbol_params(on, "SBIN")["enabled"] is True and at.symbol_params(on, "HDFCBANK")["enabled"] is False
    assert at.symbol_params(on, "BANKNIFTY")["enabled"] is False
    off = {**base, "auto_stocks": True, "symbols": at.clean_symbols({"TCS": {"enabled": False}})}
    assert at.symbol_params(off, "TCS")["enabled"] is False and at.symbol_params(off, "ITC")["enabled"] is True


def test_the_default_entry_window_starts_at_11_30_and_a_stock_call_is_refused_with_the_reason():
    d = {**at.DEFAULTS, "enabled": True}
    assert not at.decide(call("NIFTY 50", price=23100.0), d, [], dt.datetime(2026, 11, 2, 11, 29, tzinfo=IST))[0]
    assert at.decide(call("NIFTY 50", price=23100.0), d, [], dt.datetime(2026, 11, 2, 11, 30, tzinfo=IST))[0]
    ok, why = at.decide(call("TCS"), d, [], dt.datetime(2026, 11, 2, 12, 0, tzinfo=IST))
    assert not ok and "switched off for TCS" in why and "alert-only" in why
    assert at.decide(call("TCS"), {**d, "auto_stocks": True, "nifty_agree": False}, [], dt.datetime(2026, 11, 2, 12, 0, tzinfo=IST))[0]


def test_every_call_goes_to_the_outcome_log_traded_or_not_but_a_dry_run_logs_nothing(patch_scan):
    patch_scan({"NIFTY 50": call("NIFTY 50", "BUY PE", 90, 23100.0), "RELIANCE": {**call("RELIANCE", "WAIT", 32), "note": "x"},
                "TCS": call("TCS", "BUY CE", 70)})

    class Rec(MemStore):
        def __init__(self):
            super().__init__(); self.signals = []

        async def record_signal(self, rec):
            self.signals.append(rec)

    store = Rec()
    run(at.run_cycle(store, CFG, make_deps(lots={"NIFTY": 65}), now=MON_10AM))
    got = {s["symbol"]: s for s in store.signals}
    assert set(got) == {"NIFTY 50", "TCS"} and got["NIFTY 50"]["traded"] is True and got["TCS"]["traded"] is False
    dry = Rec()
    run(at.run_cycle(dry, CFG, make_deps(lots={"NIFTY": 65}), now=MON_10AM, dry=True))
    assert dry.signals == []


# ───────────── rules from the paper-trade review (13 Nov) ─────────────
def test_every_trade_gets_about_the_same_premium():
    cfg = {**at.DEFAULTS, "premium_per_trade": 15000}
    assert at.order_qty("NIFTY", 65, cfg, premium=250) == 65              # 2 lots would be 32,500: one lot fits
    assert at.order_qty("ITC", 1725, cfg, premium=4.65) == 1725           # 1 lot is 8,021: 2 would be 16,043, over budget
    assert at.order_qty("RELIANCE", 500, cfg, premium=12) == 1000         # 2 lots = 12,000
    assert at.order_qty("BANKNIFTY", 30, cfg, premium=700) == 30          # one lot is over the budget: still one lot
    assert at.order_qty("TCS", 175, {**cfg, "symbols": {"TCS": {"lots": 3}}}, premium=50) == 525   # the stock's own lots win
    assert at.order_qty("NIFTY", 65, {**cfg, "premium_per_trade": 0}, premium=250) == 130          # budget off: old rule


def test_no_reentry_on_the_same_underlying_soon_after_a_stop():
    stop = {"NIFTY": MON_10AM - dt.timedelta(minutes=20)}
    ok, why = at.decide(NIFTY_CALL(), CFG, [], MON_10AM, last_stops=stop)
    assert not ok and "20 min ago" in why
    assert at.decide(NIFTY_CALL(), CFG, [], MON_10AM, last_stops={"NIFTY": MON_10AM - dt.timedelta(minutes=61)})[0]
    assert at.decide(call("TCS"), CFG, [], MON_10AM, last_stops=stop)[0]                     # other underlyings are not affected
    assert at.decide(NIFTY_CALL(), {**CFG, "sl_cooldown_min": 0}, [], MON_10AM, last_stops=stop)[0]


def test_no_auto_entry_on_a_results_day():
    ok, why = at.decide(call("TCS"), CFG, [], MON_10AM, events={"TCS": "Financial Results"})
    assert not ok and "Financial Results" in why
    assert at.decide(call("RELIANCE"), CFG, [], MON_10AM, events={"TCS": "Financial Results"})[0]


def test_a_cycle_uses_the_event_calendar_and_survives_without_it(patch_scan):
    patch_scan({"TCS": call("TCS", "BUY CE", 90)})

    async def events(day):
        return {"TCS": "Financial Results"}

    async def broken(day):
        raise RuntimeError("NSE down")
    deps = make_deps()
    deps.fetch_events = events
    out = run(at.run_cycle(MemStore(), {**CFG, "universe": ["TCS"]}, deps, now=MON_10AM))
    assert out[0]["action"] == "SKIP" and "scheduled event" in out[0]["detail"]
    deps.fetch_events = broken
    out = run(at.run_cycle(MemStore(), {**CFG, "universe": ["TCS"]}, deps, now=MON_10AM))
    assert out[0]["action"] == "ORDER"


def test_news_keywords_match_whole_words_only():
    label = lambda *t: at.news_label([{"title": x} for x in t])
    assert label("HDFC Bank opens new branch", "SBI bank results on Friday") == "NEUTRAL"      # "ban" inside "bank"
    assert label("Infosys enterprise deal") == "NEUTRAL"                                       # "rise" inside "enterprise"
    assert label("Nifty against the trend") == "NEUTRAL"                                       # "gain" inside "against"
    assert label("Markets weigh risk of rate cut", "Analysts voice concern") == "NEUTRAL"      # dropped words
    assert label("Reliance shares rallied 3%", "TCS gains after deal") == "BULLISH"            # inflected forms still count
    assert label("Govt bans exports", "Stock dropped 4%", "Shares falling") == "BEARISH"


def test_strategies_switched_off_are_left_out_of_the_scan_and_news_is_not_fetched(monkeypatch):
    seen = {}

    def fake_eval(candles, intraday=True, news_label=None, disable=None, **kw):
        seen.setdefault("disable", []).append(disable)
        return {"ok": True, "call": "WAIT", "confidence": 30, "score": 0, "maxScore": 8, "adx": 25, "votes": [], "price": 100.0}
    monkeypatch.setattr(at.sv, "evaluate", fake_eval)
    fetched = []

    async def candles(sym, interval, rng):
        return [{"ts": i, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for i in range(70)]

    async def heads(key):
        fetched.append(key)
        return []
    deps = at.Deps(fetch_candles=candles, fetch_headlines=heads, get_contracts=lambda u: [], get_lot_size=lambda u: 1,
                   fetch_ltp=None, disabled_strategies=["news", "smc"])
    run(at.scan_symbol("TCS", deps))
    assert seen["disable"] == [["news", "smc"]] * 2 and fetched == []                 # both timeframes, and no headline request
    deps.disabled_strategies = None
    run(at.scan_symbol("TCS", deps))
    assert fetched == ["TCS"]


def test_the_nifty_agreement_rule_works_with_a_single_strategy(patch_scan):
    # VWAP alone has a maximum score of 1: "agrees" must then mean the same side, not 2 points that can never be reached
    nifty = {**call("NIFTY 50", "BUY CE", 95, 23100.0), "score": 1, "maxScore": 1}
    tcs_ce = {**call("TCS", "BUY CE", 95), "score": 1, "maxScore": 1}
    tcs_pe = {**call("TCS", "BUY PE", 95), "score": -1, "maxScore": 1}
    cfg = {**CFG, "universe": ["NIFTY 50", "TCS"], "auto_stocks": True, "max_same_direction": 5}
    patch_scan({"NIFTY 50": nifty, "TCS": tcs_ce})
    out = {r["symbol"]: r for r in run(at.run_cycle(MemStore(), cfg, make_deps(lots={"NIFTY": 65}), now=MON_10AM))}
    assert out["TCS"]["action"] == "ORDER"
    patch_scan({"NIFTY 50": nifty, "TCS": tcs_pe})
    out = {r["symbol"]: r for r in run(at.run_cycle(MemStore(), cfg, make_deps(lots={"NIFTY": 65}), now=MON_10AM))}
    assert out["TCS"]["action"] == "SKIP" and "Nifty's own signal" in out["TCS"]["detail"]

