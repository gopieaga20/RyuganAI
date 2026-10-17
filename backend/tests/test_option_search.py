"""Offline tests for real option-contract search and option-symbol handling."""
import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import angel_broker as ab
from main import _to_price_symbol, _OPTION_SYMBOL_RE


def _contract(name, exp, strike, typ):
    return {"symbol": f"{name}{exp}{strike:g}{typ}".replace(exp, exp[:5] + exp[7:]),
            "token": "1", "expiry": exp, "strike": float(strike), "type": typ}


@pytest.fixture(autouse=True)
def fake_index(monkeypatch):
    future = (datetime.date.today() + datetime.timedelta(days=20)).strftime("%d%b%Y").upper()
    later = (datetime.date.today() + datetime.timedelta(days=50)).strftime("%d%b%Y").upper()
    past = (datetime.date.today() - datetime.timedelta(days=5)).strftime("%d%b%Y").upper()
    index = {
        "NIFTY": [_contract("NIFTY", e, 23100, t) for e in (past, future, later) for t in ("CE", "PE")],
        "NIFTYNXT50": [_contract("NIFTYNXT50", future, 23100, "CE")],
        "BANKNIFTY": [_contract("BANKNIFTY", future, 51000, t) for t in ("CE", "PE")],
        "RELIANCE": [_contract("RELIANCE", future, 1260, "CE")],
    }
    monkeypatch.setattr(ab, "_options_index", index)
    monkeypatch.setattr(ab, "_is_loaded", True)
    return {"future": future, "later": later, "past": past}


def test_requires_a_strike():
    assert ab.search_option_contracts("NIFTY") == []


def test_matches_underlying_and_strike_and_hides_expired(fake_index):
    res = ab.search_option_contracts("nifty 23100")
    assert res, "expected contracts"
    assert all(r["underlying"] == "NIFTY" for r in res)  # NIFTYNXT50 must not leak in
    assert all(r["expiry"] != fake_index["past"] for r in res)
    exps = [datetime.datetime.strptime(r["expiry"], "%d%b%Y") for r in res]
    assert exps == sorted(exps)  # soonest first


def test_type_filter():
    res = ab.search_option_contracts("NIFTY 23100 PE")
    assert res and all(r["type"] == "PE" for r in res)


def test_bank_nifty_with_space_matches_banknifty():
    res = ab.search_option_contracts("bank nifty 51000")
    assert {r["underlying"] for r in res} == {"BANKNIFTY"}


def test_stock_underlying():
    res = ab.search_option_contracts("reliance 1260 ce")
    assert len(res) == 1 and res[0]["underlying"] == "RELIANCE"


def test_bare_number_searches_index_underlyings_only():
    res = ab.search_option_contracts("23100")
    assert res and {r["underlying"] for r in res} <= {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}


def test_unlisted_strike_returns_nothing():
    assert ab.search_option_contracts("NIFTY 99999") == []


@pytest.mark.parametrize("sym", ["NIFTY27OCT2623100CE", "BANKNIFTY27OCT2651000PE", "RELIANCE27OCT261260CE", "360ONE27OCT26900CE", "M&M27OCT263000PE"])
def test_option_symbol_regex_and_price_symbol_passthrough(sym):
    assert _OPTION_SYMBOL_RE.match(sym)
    assert _to_price_symbol(sym) == sym  # must not get ".NS" appended


@pytest.mark.parametrize("sym", ["RELIANCE", "TCS", "NIFTY", "SBIN"])
def test_plain_stocks_are_not_option_symbols(sym):
    assert not _OPTION_SYMBOL_RE.match(sym)
    assert _to_price_symbol(sym) == sym + ".NS"
