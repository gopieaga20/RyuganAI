"""Paper-trading rules: stop-loss/target must be on the correct side, and symbols must price consistently."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import validate_sl_tp, _to_price_symbol, sl_tp_breached


# ── stop-loss / target sides ───────────────────────────────────────────────

def test_long_with_sl_below_and_target_above_is_valid():
    assert validate_sl_tp("LONG", 100, 95, 110) is None


def test_short_with_sl_above_and_target_below_is_valid():
    assert validate_sl_tp("SHORT", 100, 105, 90) is None


@pytest.mark.parametrize("sl,tp", [(105, 110), (100, 110), (95, 90), (95, 100)])
def test_long_rejects_wrong_side_or_equal_levels(sl, tp):
    assert validate_sl_tp("LONG", 100, sl, tp) is not None


@pytest.mark.parametrize("sl,tp", [(95, 90), (100, 90), (105, 110), (105, 100)])
def test_short_rejects_wrong_side_or_equal_levels(sl, tp):
    assert validate_sl_tp("SHORT", 100, sl, tp) is not None


def test_error_message_names_the_problem_and_the_entry_price():
    msg = validate_sl_tp("LONG", 22869.55, 22969.55, 23169.55)
    assert "stop-loss" in msg and "LONG" in msg and "22869.55" in msg


def test_a_trade_the_validator_accepts_is_not_instantly_closed():
    """The whole point: at the entry price itself, an accepted trade must not already be breached."""
    for t, e, sl, tp in [("LONG", 100, 95, 110), ("SHORT", 100, 105, 90)]:
        assert validate_sl_tp(t, e, sl, tp) is None
        assert sl_tp_breached(t, e, sl, tp) is None


def test_a_trade_the_validator_rejects_would_have_closed_immediately():
    """The bug that was reproduced: LONG with stop above price closes at once."""
    assert validate_sl_tp("LONG", 100, 105, 130) is not None
    assert sl_tp_breached("LONG", 100, 105, 130) == "SL Hit"


# ── symbol resolution for the SL/TP watcher (rows saved without a price symbol) ──

@pytest.mark.parametrize("stored,expected", [
    ("NIFTY 50", "^NSEI"), ("NIFTY", "^NSEI"),
    ("BANK NIFTY", "^NSEBANK"), ("BANKNIFTY", "^NSEBANK"),
    ("SENSEX", "^BSESN"),
    ("FINNIFTY", "FINNIFTY"), ("MIDCPNIFTY", "MIDCPNIFTY"), ("NIFTYNXT50", "NIFTYNXT50"),
    ("RELIANCE", "RELIANCE.NS"), ("reliance", "RELIANCE.NS"),
    ("HDFC BANK", "HDFCBANK.NS"), ("TATA STEEL", "TATASTEEL.NS"),
    ("HDFCBANK.NS", "HDFCBANK.NS"), ("^NSEI", "^NSEI"), ("USDINR=X", "USDINR=X"),
    ("NIFTY27OCT2623100CE", "NIFTY27OCT2623100CE"),
    ("360ONE27OCT26900CE", "360ONE27OCT26900CE"),
])
def test_price_symbol_resolution(stored, expected):
    assert _to_price_symbol(stored) == expected
