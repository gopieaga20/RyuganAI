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

    async def open_auto_positions(self):
        return list(self.positions)

    async def acted_on(self, symbol, candle_ts):
        return any(l["symbol"] == symbol and l["candle_ts"] == candle_ts and l["action"] == "ORDER" for l in self.logs)

    async def place(self, symbol, qty, price, sl, tp):
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
    assert p["qty"] == 65 and p["sl"] == 70.0 and p["tp"] == 150.0
    orders = [d for d in out if d["action"] == "ORDER"]
    assert len(orders) == 1 and orders[0]["position_id"] == 1


def test_cycle_never_exceeds_the_position_limit_and_prefers_the_strongest(patch_scan):
    syms = [f"S{i}" for i in range(8)]
    patch_scan({s: call(s, "BUY CE", 85 + i, 1300.0, ts=i) for i, s in enumerate(syms)})
    store = MemStore()
    run(at.run_cycle(store, {**CFG, "universe": syms}, make_deps(), now=MON_10AM))
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
    out = run(at.run_cycle(MemStore(), {**CFG, "universe": syms}, make_deps(), now=MON_10AM, dry=True))
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
