"""The live-price WebSocket must follow symbol changes made after connecting."""
import os
import sys

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main

PRICES = {"A": 1.0, "B": 2.0, "C": 3.0}


@pytest.fixture
def client(monkeypatch):
    async def fake_ltp(sym):
        return PRICES.get(sym)          # unknown symbols have no price

    monkeypatch.setattr(main, "_fetch_ltp", fake_ltp)
    monkeypatch.setattr(main, "_WS_PUSH_SECONDS", 0.05)
    # Not used as a context manager on purpose: that would start the app lifespan (database, network).
    return TestClient(main.app)


def _next_with(ws, wanted, tries=40):
    """Read pushes until one contains exactly the wanted symbols."""
    for _ in range(tries):
        got = set(ws.receive_json()["prices"])
        if got == wanted:
            return True
    return False


def test_first_message_sets_the_symbols(client):
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"symbols": ["A"]})
        assert set(ws.receive_json()["prices"]) == {"A"}


def test_symbols_added_later_are_picked_up(client):
    """The bug: a position opened after the socket was connected never received prices."""
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"symbols": ["A"]})
        assert _next_with(ws, {"A"})
        ws.send_json({"symbols": ["A", "B", "C"]})
        assert _next_with(ws, {"A", "B", "C"}), "pushes never included the symbols sent after connecting"


def test_symbols_removed_later_stop_being_pushed(client):
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"symbols": ["A", "B"]})
        assert _next_with(ws, {"A", "B"})
        ws.send_json({"symbols": ["B"]})
        assert _next_with(ws, {"B"})


def test_symbols_without_a_price_are_left_out_not_zeroed(client):
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"symbols": ["A", "NOPE"]})
        assert set(ws.receive_json()["prices"]) == {"A"}


def test_garbage_first_message_is_rejected(client):
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"nope": 1})
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
        assert info.value.code == 1008


def test_a_garbage_update_keeps_the_previous_symbols(client):
    with client.websocket_connect("/ws/prices") as ws:
        ws.send_json({"symbols": ["A"]})
        assert _next_with(ws, {"A"})
        ws.send_json({"symbols": []})        # ignored
        ws.send_json({"hello": "world"})     # ignored
        assert _next_with(ws, {"A"})
