"""Trade history is served one page at a time (with a stable order and a clamped page number)."""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main

ROWS = [{"id": i, "symbol": f"S{i}", "pnl": float(i), "exit_time": f"2026-11-05T10:{i % 60:02d}:00+00:00"} for i in range(1, 58)]   # 57 trades, id 57 newest


class FakeConn:
    async def fetchval(self, q, *a):
        assert "COUNT" in q
        return len(ROWS)

    async def fetch(self, q, limit, offset):
        assert "ORDER BY exit_time DESC, id DESC" in q
        newest_first = sorted(ROWS, key=lambda r: -r["id"])
        return newest_first[offset: offset + limit]


class FakePool:
    connected = True

    def acquire(self):
        class Ctx:
            async def __aenter__(self_inner):
                return FakeConn()

            async def __aexit__(self_inner, *a):
                return False
        return Ctx()


@pytest.fixture
def client(monkeypatch):
    main.app.state.pool = FakePool()
    return TestClient(main.app)          # not a context manager: no lifespan, no database


def ids(resp):
    return [h["id"] for h in resp.json()["history"]]


def test_first_page_is_the_newest_trades(client):
    d = client.get("/api/paper/history?page=1&page_size=25").json()
    assert d["total"] == 57 and d["pages"] == 3 and d["page"] == 1 and d["page_size"] == 25
    assert [h["id"] for h in d["history"]] == list(range(57, 32, -1))


def test_pages_do_not_overlap_and_cover_everything(client):
    seen = []
    for p in (1, 2, 3):
        seen += ids(client.get(f"/api/paper/history?page={p}&page_size=25"))
    assert seen == list(range(57, 0, -1))


def test_last_page_is_partial(client):
    assert len(ids(client.get("/api/paper/history?page=3&page_size=25"))) == 7


def test_out_of_range_page_is_clamped(client):
    d = client.get("/api/paper/history?page=99&page_size=25").json()
    assert d["page"] == 3 and len(d["history"]) == 7
    assert client.get("/api/paper/history?page=-4").json()["page"] == 1


def test_page_size_is_bounded(client):
    assert client.get("/api/paper/history?page_size=1").json()["page_size"] == 5
    assert client.get("/api/paper/history?page_size=100000").json()["page_size"] == 100
    assert client.get("/api/paper/history").json()["page_size"] == 25
