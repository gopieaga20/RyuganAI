"""A self-healing wrapper around the asyncpg pool.

Why: the app used to create the pool once at startup. If PostgreSQL was not reachable at that moment, paper trading
stayed disabled until the server was restarted; and if the laptop slept or the database dropped idle connections
overnight, every pooled connection was dead the next morning and every paper-trading call failed until a restart.

ResilientPool is a drop-in for `asyncpg.Pool` where this app uses it (`acquire()` as an async context manager,
`close()`): it creates the pool lazily, checks a connection with `SELECT 1` before handing it out, and rebuilds the
whole pool when a connection turns out to be dead.
"""
import asyncio
from typing import Awaitable, Callable, Optional

import asyncpg
from fastapi import HTTPException

_HEALTH_TIMEOUT_S = 5.0


class ResilientPool:
    def __init__(self, dsn: str, on_ready: Optional[Callable[[asyncpg.Pool], Awaitable[None]]] = None,
                 min_size: int = 1, max_size: int = 10):
        self._dsn = dsn
        self._on_ready = on_ready          # run once after each (re)connect, e.g. to create the schema
        self._min, self._max = min_size, max_size
        self._pool: Optional[asyncpg.Pool] = None
        self._lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self._pool is not None

    async def _ensure(self) -> asyncpg.Pool:
        if self._pool is not None:
            return self._pool
        async with self._lock:
            if self._pool is None:
                pool = await asyncpg.create_pool(
                    self._dsn, min_size=self._min, max_size=self._max,
                    command_timeout=30, max_inactive_connection_lifetime=240,
                )
                try:
                    if self._on_ready:
                        await self._on_ready(pool)
                except Exception:
                    await pool.close()
                    raise
                self._pool = pool
            return self._pool

    async def connect(self) -> bool:
        """Try to connect now (startup). Returns False instead of raising, so the app can start without a database."""
        try:
            await self._ensure()
            return True
        except Exception as e:
            print(f"[WARN] Database connection failed: {e}")
            return False

    async def _reset(self):
        async with self._lock:
            pool, self._pool = self._pool, None
        if pool is not None:
            try:
                pool.terminate()
            except Exception:
                pass

    def acquire(self):
        return _Acquire(self)

    async def close(self):
        pool, self._pool = self._pool, None
        if pool is not None:
            await pool.close()


class _Acquire:
    """`async with pool.acquire() as conn:` that only yields a connection that answered a ping."""

    def __init__(self, owner: ResilientPool):
        self._owner = owner
        self._pool: Optional[asyncpg.Pool] = None
        self._conn = None

    async def __aenter__(self):
        last: Optional[Exception] = None
        for attempt in range(2):                 # second attempt runs on a freshly rebuilt pool
            try:
                pool = await self._owner._ensure()
            except Exception as e:
                last = e
                break
            conn = None
            try:
                conn = await pool.acquire()
                await asyncio.wait_for(conn.fetchval("SELECT 1"), _HEALTH_TIMEOUT_S)
                self._pool, self._conn = pool, conn
                return conn
            except Exception as e:
                last = e
                if conn is not None:
                    try:
                        conn.terminate()
                        await pool.release(conn)
                    except Exception:
                        pass
                print(f"[WARN] Database connection was dead ({type(e).__name__}); rebuilding the pool")
                await self._owner._reset()
        raise HTTPException(
            status_code=503,
            detail=f"Database not available ({type(last).__name__ if last else 'unknown'}). "
                   "Check DATABASE_URL and that PostgreSQL is running; the app reconnects automatically."
        )

    async def __aexit__(self, exc_type, exc, tb):
        if self._conn is not None and self._pool is not None:
            try:
                await self._pool.release(self._conn)
            except Exception:
                pass
        return False
