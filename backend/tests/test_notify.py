"""Telegram alerts: nothing is sent unless switched on and configured, failures never break trading, messages are clean,
and each trading event sends exactly one message. No test contacts Telegram: the sender is replaced by a fake."""
import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
import notify
from test_live_exits import ExitDB, exit_row, pos, watch, tick      # noqa: F401  (fixtures and helpers)


class SettingsPool:
    def __init__(self, settings=None):
        self.settings = settings

    def acquire(self):
        pool = self

        class Ctx:
            async def __aenter__(self):
                return Conn(pool)

            async def __aexit__(self, *a):
                return False
        return Ctx()


class Conn:
    def __init__(self, pool):
        self.pool = pool

    async def fetchrow(self, q, *a):
        return {"value": json.dumps(self.pool.settings)} if self.pool.settings is not None else None

    async def execute(self, q, *a):
        self.pool.settings = json.loads(a[1])


ON = {"enabled": True, "live_orders": True, "live_exits": True, "paper": True, "calls": True, "call_min_confidence": 80}


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def fake(text):
        out.append(text)
        return True
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:secret-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
    monkeypatch.setattr(notify, "_sender", fake)
    notify._cache.update(at=0.0, value=None)
    notify._sent_keys.clear()
    notify._recent.clear()
    return out


def run(coro):
    async def go():
        r = await coro
        await notify.drain()
        return r
    return asyncio.run(go())


# ───────────── switches, secrets and failures ─────────────
def test_nothing_is_sent_until_alerts_are_switched_on(sent):
    pool = SettingsPool(None)
    assert run(notify.notify(pool, "calls", "hello")) is False and sent == []
    pool.settings = {**ON, "enabled": False}
    notify._cache.update(at=0.0, value=None)
    assert run(notify.notify(pool, "calls", "hello")) is False and sent == []


def test_each_event_type_has_its_own_switch(sent):
    pool = SettingsPool({**ON, "calls": False})
    assert run(notify.notify(pool, "calls", "a")) is False
    assert run(notify.notify(pool, "paper", "b")) is True
    assert sent == ["b"]


def test_nothing_is_sent_without_a_token_and_chat_id(sent, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN")
    assert run(notify.notify(SettingsPool(ON), "paper", "x")) is False and sent == []
    assert notify.configured() is False
    assert run(notify.send_test())["ok"] is False


def test_the_same_event_key_is_sent_only_once(sent):
    pool = SettingsPool(ON)
    assert run(notify.notify(pool, "calls", "x", key="k1")) is True
    assert run(notify.notify(pool, "calls", "x", key="k1")) is False
    assert run(notify.notify(pool, "calls", "y", key="k2")) is True and len(sent) == 2


def test_a_burst_is_limited(sent):
    pool = SettingsPool(ON)
    results = [run(notify.notify(pool, "paper", f"m{i}")) for i in range(30)]
    assert results.count(True) == notify.MAX_PER_MINUTE and len(sent) == notify.MAX_PER_MINUTE


def test_a_failing_sender_never_raises_into_trading(sent, monkeypatch):
    async def boom(text):
        raise RuntimeError("network down")
    monkeypatch.setattr(notify, "_sender", boom)
    assert run(notify.notify(SettingsPool(ON), "paper", "x")) is True        # queued; the failure is swallowed in the background
    broken = SettingsPool(ON)
    broken.acquire = lambda: (_ for _ in ()).throw(RuntimeError("db down"))
    notify._cache.update(at=0.0, value=None)
    assert run(notify.notify(broken, "paper", "y")) is False                 # a database error is swallowed too


def test_settings_are_cleaned_and_saved():
    c = notify.clean_settings({"enabled": 1, "calls": 0, "call_min_confidence": 500, "junk": 1})
    assert c["enabled"] is True and c["calls"] is False and c["call_min_confidence"] == 100 and "junk" not in c
    assert notify.clean_settings(None)["enabled"] is False and notify.clean_settings({"call_min_confidence": "x"})["call_min_confidence"] == 80
    pool = SettingsPool(None)
    saved = asyncio.run(notify.save_settings(pool, {"enabled": True, "call_min_confidence": 85}))
    assert saved["enabled"] and pool.settings["call_min_confidence"] == 85


# ───────────── message text ─────────────
ORDER = {"symbol": "NIFTY10NOV2623950CE", "side": "BUY", "qty": 65, "order_type": "LIMIT", "product": "INTRADAY", "price": 140.0,
         "trigger_price": 0, "sl_pct": 30, "tp_pct": 50, "trail_pct": 0}


def test_live_order_messages_say_live_and_never_hide_an_unknown_outcome():
    ok = notify.live_order(ORDER, {"state": "PLACED", "order_id": "999", "message": ""})
    assert ok.startswith("LIVE ORDER PLACED") and "BUY 65 NIFTY10NOV2623950CE" in ok and "stop 30%" in ok and "999" in ok
    unk = notify.live_order(ORDER, {"state": "UNKNOWN", "message": "timeout"})
    assert "OUTCOME UNKNOWN" in unk and "Angel app" in unk
    assert "REFUSED" in notify.live_order(ORDER, {"state": "REJECTED", "message": "RMS: no margin"})


def test_exit_and_call_and_paper_messages():
    r = {"id": 1, "symbol": "NIFTY10NOV2623950CE", "entry": 140.0}
    assert "STOP-LOSS HIT" in notify.live_exit(r, "STOP", 65, 98.0, {"state": "PLACED", "order_id": "5"})
    assert "TRAILING STOP HIT" in notify.live_exit(r, "TRAIL", 65, 120.0, {"state": "PLACED", "order_id": "5"})
    assert "NOT re-sent" in notify.live_exit(r, "TARGET", 65, 210.0, {"state": "UNKNOWN"})
    assert notify.paper_close("X", "SL Hit", 10.0, -5.5).startswith("PAPER STOP-LOSS HIT")
    assert notify.paper_close("X", "Target Hit", 10.0, 5.5).startswith("PAPER TARGET HIT")
    call = notify.strong_call({"symbol": "NIFTY 50", "call": "BUY CE", "confidence": 84, "price": 24500.5})
    assert "84%" in call and "BUY CE" in call and "not a recommendation" in call


def test_no_message_ever_contains_the_token(sent):
    pool = SettingsPool(ON)
    for text in (notify.live_order(ORDER, {"state": "PLACED", "order_id": "1"}), notify.strong_call({"symbol": "A", "call": "BUY CE", "confidence": 90})):
        run(notify.notify(pool, "live_orders", text, key=text))
    assert sent and all("secret-token" not in t for t in sent)


# ───────────── the hooks ─────────────
def test_strong_calls_alert_once_per_candle_and_paper_orders_alert(sent):
    pool = SettingsPool(ON)
    rows = [{"symbol": "NIFTY 50", "call": "BUY CE", "confidence": 84, "candle_ts": 100, "price": 24500.0, "action": "SKIP"},
            {"symbol": "RELIANCE", "call": "BUY PE", "confidence": 79, "candle_ts": 100, "action": "SKIP"},          # below 80
            {"symbol": "TCS", "call": "WAIT", "confidence": 95, "candle_ts": 100, "action": "SKIP"},                  # not a call
            {"symbol": "SBIN", "call": "BUY CE", "confidence": 88, "candle_ts": 100, "action": "ORDER", "position_id": 7,
             "detail": "SBIN10NOV26800CE x750 @ 12.00 (SL 8, TP 16)"}]
    run(main._notify_scan(pool, rows))
    assert len(sent) == 3 and sum("CALL" in t for t in sent) == 2 and sum(t.startswith("PAPER ORDER") for t in sent) == 1
    run(main._notify_scan(pool, rows))                                       # the same candle again: nothing new
    assert len(sent) == 3


def test_the_call_threshold_follows_the_setting(sent):
    pool = SettingsPool({**ON, "call_min_confidence": 90})
    run(main._notify_scan(pool, [{"symbol": "A", "call": "BUY CE", "confidence": 88, "candle_ts": 1, "action": "SKIP"}]))
    assert sent == []


class AlertingExitDB(ExitDB):
    """The watcher uses one pool for the exits table and for the alert settings."""

    def acquire(self):
        import test_live_exits as t
        db = self

        class C(t.Conn):
            async def fetchrow(self, q, *a):
                return {"value": json.dumps(ON)} if "app_settings" in q else None

        class Ctx:
            async def __aenter__(self):
                return C(db)

            async def __aexit__(self, *a):
                return False
        return Ctx()


def test_a_live_stop_sends_the_sell_and_exactly_one_alert(watch, sent):
    db = AlertingExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 60.0
    run(main._live_exit_tick(db))
    assert len(watch["sent"]) == 1                                           # the real exit order went out
    assert len(sent) == 1 and sent[0].startswith("LIVE STOP-LOSS HIT")
    run(main._live_exit_tick(db))
    assert len(watch["sent"]) == 1 and len(sent) == 1                        # nothing repeats


def test_the_exit_is_sent_even_if_the_alert_system_is_broken(watch, sent, monkeypatch):
    async def broken(pool, fresh=False):
        raise RuntimeError("settings unreadable")
    monkeypatch.setattr(notify, "load_settings", broken)
    db = ExitDB([exit_row(state="ARMED", entry=100.0, peak=100.0)])
    watch["positions"], watch["ltp"] = pos(), 60.0
    run(main._live_exit_tick(db))
    assert len(watch["sent"]) == 1 and sent == [] and db.rows[0]["state"] == "EXIT_SENT"
