"""The database pool must survive PostgreSQL being down at startup and connections dying overnight."""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db


class FakeConn:
    def __init__(self, dead=False):
        self.dead = dead
        self.terminated = False

    async def fetchval(self, q):
        if self.dead:
            raise ConnectionError("connection was closed")
        return 1

    def terminate(self):
        self.terminated = True


class FakePool:
    def __init__(self, world):
        self.world = world
        self.released = []
        self.was_terminated = False

    async def acquire(self):
        return FakeConn(dead=self.world["dead_connections"])

    async def release(self, conn):
        self.released.append(conn)

    def terminate(self):
        self.was_terminated = True

    async def close(self):
        pass


@pytest.fixture
def world(monkeypatch):
    w = {"down": False, "dead_connections": False, "created": []}

    async def create_pool(dsn, **kw):
        if w["down"]:
            raise OSError("connection refused")
        p = FakePool(w)
        w["created"].append(p)
        return p

    monkeypatch.setattr(db.asyncpg, "create_pool", create_pool)
    return w


def run(coro):
    return asyncio.run(coro)


def test_database_down_at_startup_then_comes_up(world):
    async def go():
        rp = db.ResilientPool("dsn")
        world["down"] = True
        assert await rp.connect() is False                      # the app still starts
        with pytest.raises(HTTPException) as e:
            async with rp.acquire():
                pass
        assert e.value.status_code == 503
        world["down"] = False                                    # PostgreSQL is now reachable: no restart needed
        async with rp.acquire() as conn:
            assert await conn.fetchval("SELECT 1") == 1
    run(go())


def test_dead_connections_after_sleep_trigger_a_rebuild(world):
    async def go():
        rp = db.ResilientPool("dsn")
        assert await rp.connect() is True
        world["dead_connections"] = True                         # laptop slept: pooled sockets are dead
        world["created"].clear()

        async def heal(*a, **k):
            world["dead_connections"] = False                    # a freshly built pool gets good connections
        orig = db.asyncpg.create_pool

        async def create_pool(dsn, **kw):
            await heal()
            return await orig(dsn, **kw)
        db.asyncpg.create_pool = create_pool
        try:
            async with rp.acquire() as conn:
                assert await conn.fetchval("SELECT 1") == 1
        finally:
            db.asyncpg.create_pool = orig
        assert len(world["created"]) == 1                        # exactly one new pool was built
    run(go())


def test_a_database_that_stays_dead_gives_503_not_a_hang(world):
    async def go():
        rp = db.ResilientPool("dsn")
        await rp.connect()
        world["dead_connections"] = True
        with pytest.raises(HTTPException) as e:
            async with rp.acquire():
                pass
        assert e.value.status_code == 503
    run(go())


def test_schema_hook_runs_on_every_new_pool(world):
    calls = []

    async def hook(pool):
        calls.append(pool)

    async def go():
        rp = db.ResilientPool("dsn", on_ready=hook)
        await rp.connect()
        await rp._reset()
        async with rp.acquire():
            pass
    run(go())
    assert len(calls) == 2


def test_healthy_connection_is_released_back(world):
    async def go():
        rp = db.ResilientPool("dsn")
        await rp.connect()
        pool = world["created"][0]
        async with rp.acquire():
            pass
        assert len(pool.released) == 1 and not pool.released[0].terminated
    run(go())
