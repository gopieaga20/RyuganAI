"""
Unit tests for the pure trading-math helpers in main.py:
compute_margin, compute_pnl, sl_tp_breached.

These run without a database or network access — they only exercise
arithmetic/comparison logic extracted out of the paper-trading routes
and the SL/TP watcher.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import compute_margin, compute_pnl, sl_tp_breached


# ── compute_margin ──────────────────────────────────────────────────────────

def test_compute_margin_basic():
    assert compute_margin(qty=10, price=100.0) == 1000.0


def test_compute_margin_rounds_to_two_decimals():
    assert compute_margin(qty=3, price=33.333) == round(3 * 33.333, 2)


# ── compute_pnl ──────────────────────────────────────────────────────────────

def test_compute_pnl_long_profit():
    assert compute_pnl("LONG", entry_price=100, exit_price=110, qty=10) == 100.0


def test_compute_pnl_long_loss():
    assert compute_pnl("LONG", entry_price=100, exit_price=90, qty=10) == -100.0


def test_compute_pnl_long_breakeven():
    assert compute_pnl("LONG", entry_price=100, exit_price=100, qty=50) == 0.0


def test_compute_pnl_short_profit():
    assert compute_pnl("SHORT", entry_price=100, exit_price=90, qty=10) == 100.0


def test_compute_pnl_short_loss():
    assert compute_pnl("SHORT", entry_price=100, exit_price=110, qty=10) == -100.0


def test_compute_pnl_short_breakeven():
    assert compute_pnl("SHORT", entry_price=100, exit_price=100, qty=50) == 0.0


# ── sl_tp_breached ─────────────────────────────────────────────────────────

def test_sl_tp_long_sl_hit():
    assert sl_tp_breached("LONG", ltp=95, sl=95, tp=110) == "SL Hit"
    assert sl_tp_breached("LONG", ltp=90, sl=95, tp=110) == "SL Hit"


def test_sl_tp_long_target_hit():
    assert sl_tp_breached("LONG", ltp=110, sl=95, tp=110) == "Target Hit"
    assert sl_tp_breached("LONG", ltp=120, sl=95, tp=110) == "Target Hit"


def test_sl_tp_long_no_breach():
    assert sl_tp_breached("LONG", ltp=100, sl=95, tp=110) is None


def test_sl_tp_short_sl_hit():
    assert sl_tp_breached("SHORT", ltp=105, sl=105, tp=90) == "SL Hit"
    assert sl_tp_breached("SHORT", ltp=110, sl=105, tp=90) == "SL Hit"


def test_sl_tp_short_target_hit():
    assert sl_tp_breached("SHORT", ltp=90, sl=105, tp=90) == "Target Hit"
    assert sl_tp_breached("SHORT", ltp=80, sl=105, tp=90) == "Target Hit"


def test_sl_tp_short_no_breach():
    assert sl_tp_breached("SHORT", ltp=100, sl=105, tp=90) is None
