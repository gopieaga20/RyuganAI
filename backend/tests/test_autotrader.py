"""Auto paper-trader: the safety rules, the option choice and one full cycle, with no database or network."""
import asyncio
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import autotrader as at

IST = at.IST
MON_10AM = dt.datetime(2026, 11, 2, 10, 0, tzinfo=IST)        # a Monday
SAT_10AM = dt.datetime(2026, 11, 7, 10, 0, tzinfo=IST)
CFG = {**at.DEFAULTS, "enabled": True, "universe": ["NIFTY 50", "RELIANCE", "TCS"]}


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
    run(at.run_cycle(store, {**CFG, "universe": syms, "max_trades_per_day": 99}, make_deps(), now=MON_10AM))
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
    out = run(at.run_cycle(MemStore(), {**CFG, "universe": syms, "max_trades_per_day": 99}, make_deps(), now=MON_10AM, dry=True))
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
    cfg = {**CFG, "universe": syms, "max_positions": 20}
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
    assert at.decide(NIFTY_CALL(), CFG, [], MON_10AM, by_und={"NIFTY": 9})[0]               # still under the Nifty limit of 10
    ok, why = at.decide(NIFTY_CALL(), CFG, [], MON_10AM, by_und={"NIFTY": 10})
    assert not ok and "limit 10 a day" in why


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
    assert at.DEFAULTS["product"] == "CARRYFORWARD"
    assert at.symbol_params(CFG, "TCS")["product"] == "CARRYFORWARD"
    assert at.symbol_params({**CFG, "product": "INTRADAY"}, "TCS")["product"] == "INTRADAY"
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
