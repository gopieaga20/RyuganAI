"""Lot sizes must come from the exchange contract list, never be hardcoded."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import angel_broker as ab


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _item(name, symbol, itype, lot, exch="NFO", strike="2310000.000000"):
    return {"token": "1", "symbol": symbol, "name": name, "expiry": "27OCT2026", "strike": strike,
            "lotsize": str(lot), "instrumenttype": itype, "exch_seg": exch}


@pytest.fixture
def fake_master(monkeypatch):
    data = [
        _item("NIFTY", "NIFTY27OCT2623100CE", "OPTIDX", 65),
        _item("NIFTY", "NIFTY27OCT26FUT", "FUTIDX", 65, strike="-1.000000"),
        _item("RELIANCE", "RELIANCE27OCT261260CE", "OPTSTK", 500, strike="126000.000000"),
        _item("BADLOT", "BADLOT27OCT26FUT", "FUTSTK", "abc", strike="-1.000000"),
        _item("ZERO", "ZERO27OCT26FUT", "FUTSTK", 0, strike="-1.000000"),
        _item("SENSEX", "SENSEX27OCT2678000CE", "OPTIDX", 20, exch="BFO"),
        _item("SOMEBSE", "SOMEBSE27OCT26FUT", "FUTSTK", 99, exch="BFO", strike="-1.000000"),
        # Cash-market equity: its "lotsize" of 1 must never be reported as an F&O lot.
        {"token": "2885", "symbol": "RELIANCE-EQ", "name": "RELIANCE", "expiry": "", "strike": "-1.000000",
         "lotsize": "1", "instrumenttype": "", "exch_seg": "NSE"},
    ]
    monkeypatch.setattr(ab.urllib.request, "urlopen", lambda *a, **k: _Resp(data))
    monkeypatch.setattr(ab, "_is_loaded", False)
    monkeypatch.setattr(ab, "_master_lookup", {})
    monkeypatch.setattr(ab, "_nse_equities", [])
    monkeypatch.setattr(ab, "_options_index", {})
    monkeypatch.setattr(ab, "_lot_sizes", {})


def test_lot_sizes_come_from_the_contract_list(fake_master):
    assert ab.get_lot_sizes() == {"NIFTY": 65, "RELIANCE": 500, "SENSEX": 20}


def test_equity_lot_of_one_is_not_reported(fake_master):
    assert ab.get_lot_sizes()["RELIANCE"] == 500


def test_unparseable_or_zero_lot_sizes_are_skipped(fake_master):
    sizes = ab.get_lot_sizes()
    assert "BADLOT" not in sizes and "ZERO" not in sizes


def test_bse_index_lots_are_included_but_bse_stock_derivatives_are_not(fake_master):
    sizes = ab.get_lot_sizes()
    assert sizes["SENSEX"] == 20
    assert "SOMEBSE" not in sizes


def test_returns_a_copy_so_callers_cannot_corrupt_the_cache(fake_master):
    ab.get_lot_sizes()["NIFTY"] = 1
    assert ab.get_lot_sizes()["NIFTY"] == 65
