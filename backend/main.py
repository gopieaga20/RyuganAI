"""
Ryugan AI — Trading Backend
FastAPI + asyncpg (PostgreSQL) backend for Paper Trading and Yahoo Finance proxy.
"""

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
import asyncio
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncpg
import httpx
import os
import datetime
import time
import json
import re
from urllib.parse import quote
import xml.etree.ElementTree as ET
from pydantic import BaseModel, Field
from typing import Optional, Any
from dotenv import load_dotenv

try:
    from angel_broker import ( # type: ignore
        get_quote as get_angel_quote,
        get_historical as get_angel_historical,
        get_nse_equities,
        get_option_contracts,
        search_option_contracts,
        get_lot_sizes,
        get_angel_client,
        load_master_contract,
    )
    import angel_broker as _angel_broker # type: ignore
except ImportError:
    def get_angel_quote(sym): return None
    def get_angel_historical(sym, interval="15m", days=90): return None
    def get_nse_equities(): return []
    def get_option_contracts(underlying): return []
    def search_option_contracts(query, limit=40): return []
    def get_lot_sizes(): return {}
    def get_angel_client(): return None
    def load_master_contract(): pass
    _angel_broker = None

from nse_client import get_fo_underlyings
from db import ResilientPool
import autotrader
import live_broker
import live_rules
import live_exits
import uuid

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:202020@localhost:5432/trading_app"
)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022").strip()

# ─────────────────────────────────────────────
# APP LIFESPAN — connection pool init/teardown
# ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Set up the database pool (self-healing, see db.py) and the SL/TP watcher; tear them down on shutdown."""
    # Warm the Angel scrip master in the background so the first stock/option search is instant.
    master_task = asyncio.create_task(asyncio.to_thread(load_master_contract))
    pool = ResilientPool(DATABASE_URL, on_ready=_ensure_schema)
    app.state.pool = pool
    if await pool.connect():
        print("[OK] PostgreSQL connected and schema verified.")
    else:
        print("       Starting without DB: paper trading answers 503 until PostgreSQL is reachable, then reconnects by itself.")
    watcher_task = asyncio.create_task(_sl_tp_watcher(pool))
    auto_task = asyncio.create_task(_autotrade_loop(pool))
    exit_task = asyncio.create_task(_live_exit_loop(pool))
    yield
    master_task.cancel()
    for task in (watcher_task, auto_task, exit_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    await pool.close()
    print("PostgreSQL pool closed.")


async def _autotrade_deps() -> "autotrader.Deps":
    async def candles(sym, interval, rng):
        resp = await get_yahoo_chart(_to_price_symbol(sym), interval, rng)
        return autotrader.payload_to_candles(json.loads(resp.body))

    async def headlines(key):
        data = await get_news(q=key, limit=8)
        return data.get("headlines", [])

    def contracts(und):
        return get_option_contracts(und)

    def lot(und):
        return get_lot_sizes().get(und)

    return autotrader.Deps(fetch_candles=candles, fetch_headlines=headlines, get_contracts=contracts,
                           get_lot_size=lot, fetch_ltp=_fetch_ltp)


_autotrade_state = {"last_run": None, "next_run": None, "running": False}


async def _run_autotrade_cycle(pool, dry=False, now=None):
    if _autotrade_state["running"]:
        return []
    _autotrade_state["running"] = True
    try:
        cfg = await autotrader.load_settings(pool)
        store = autotrader.PgStore(pool, _open_position)
        out = await autotrader.run_cycle(store, cfg, await _autotrade_deps(), now=now, dry=dry)
        _autotrade_state["last_run"] = time.time()
        return out
    finally:
        _autotrade_state["running"] = False


async def _autotrade_loop(pool):
    """Every 5 minutes (just after the candle closes): if auto-trading is on and the market is open, run a cycle."""
    last_error = None
    while True:
        wait = autotrader.seconds_to_next_run(time.time())
        _autotrade_state["next_run"] = time.time() + wait
        await asyncio.sleep(wait)
        try:
            cfg = await autotrader.load_settings(pool)
            if cfg["enabled"] and autotrader.market_open(autotrader.now_ist()):
                await _run_autotrade_cycle(pool)
            last_error = None
        except asyncio.CancelledError:
            raise
        except Exception as e:
            detail = str(getattr(e, "detail", e))
            if detail != last_error:
                print(f"[WARN] auto-trader cycle failed: {detail}")
                last_error = detail


def compute_margin(qty: int, price: float) -> float:
    """Margin required to open a position of `qty` at `price`."""
    return round(float(qty) * float(price), 2)


# Paper-account margin: bought options cost their full premium; everything else (futures-like index
# positions, stocks, short options) is leveraged. 5x by default, like intraday margins.
PAPER_LEVERAGE = max(1.0, float(os.getenv("PAPER_LEVERAGE", "5")))
CHARGE_PER_LEG = 20.0          # flat brokerage per order leg (entry and exit)


def required_margin(symbol: str, pos_type: str, qty: int, price: float) -> float:
    """Margin blocked for a position. Long option buyers pay the whole premium; others get leverage."""
    notional = compute_margin(qty, price)
    if pos_type == "LONG" and _OPTION_SYMBOL_RE.match(symbol.upper()):
        return notional
    return round(notional / PAPER_LEVERAGE, 2)


def order_fills(order_type: str, pos_type: str, price: float, ltp: float) -> bool:
    """Whether a pending LIMIT / SL / SL-M order at `price` is executable at market price `ltp`.
    LIMIT buys at or below, sells at or above. Stop orders trigger on the way up for buys, down for sells."""
    if order_type == "LIMIT":
        return ltp <= price if pos_type == "LONG" else ltp >= price
    return ltp >= price if pos_type == "LONG" else ltp <= price


def compute_pnl(pos_type: str, entry_price: float, exit_price: float, qty: int) -> float:
    """Realized PnL for closing a LONG/SHORT position."""
    if pos_type == "LONG":
        return round((float(exit_price) - float(entry_price)) * int(qty), 2)
    return round((float(entry_price) - float(exit_price)) * int(qty), 2)


def validate_sl_tp(pos_type: str, entry: float, sl: float, tp: float) -> Optional[str]:
    """Return an error message if the stop-loss/target are on the wrong side of the entry price, else None.
    LONG: sl < entry < tp.   SHORT: tp < entry < sl.
    A wrong-side level is breached by the very next price tick, so the trade would close immediately."""
    if pos_type == "LONG":
        if sl >= entry:
            return f"Invalid stop-loss for a LONG: it must be below the entry price ({entry:.2f}), but you gave {sl:.2f}."
        if tp <= entry:
            return f"Invalid target for a LONG: it must be above the entry price ({entry:.2f}), but you gave {tp:.2f}."
    else:
        if sl <= entry:
            return f"Invalid stop-loss for a SHORT: it must be above the entry price ({entry:.2f}), but you gave {sl:.2f}."
        if tp >= entry:
            return f"Invalid target for a SHORT: it must be below the entry price ({entry:.2f}), but you gave {tp:.2f}."
    return None


def sl_tp_breached(pos_type: str, ltp: float, sl: float, tp: float) -> Optional[str]:
    """Return 'SL Hit' / 'Target Hit' if ltp breaches the position's stop-loss/target, else None."""
    if pos_type == "LONG":
        if ltp <= sl:
            return "SL Hit"
        if ltp >= tp:
            return "Target Hit"
    else:
        if ltp >= sl:
            return "SL Hit"
        if ltp <= tp:
            return "Target Hit"
    return None


async def _close_position(pool: asyncpg.Pool, position_id: int, exit_price: float, reason: str) -> Optional[float]:
    """Close an open position at exit_price: release margin, book PnL, record history.
    Returns the gross PnL (before the ₹20 exit charge), or None if the position no longer exists (already closed)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            pos = await conn.fetchrow(
                "SELECT * FROM positions WHERE id = $1 FOR UPDATE", position_id
            )
            if not pos:
                return None

            margin_release = float(pos["margin"]) if pos["margin"] is not None                 else compute_margin(int(pos["qty"]), float(pos["entry_price"]))
            pnl = compute_pnl(pos["type"], float(pos["entry_price"]), exit_price, int(pos["qty"]))

            now = datetime.datetime.now(datetime.timezone.utc)
            await conn.execute("DELETE FROM positions WHERE id = $1", position_id)
            await conn.execute(
                """UPDATE portfolio
                   SET used_margin = used_margin - $1,
                       capital     = capital + $2,
                       total_pnl   = total_pnl + $3
                   WHERE id = 1""",
                margin_release, pnl - CHARGE_PER_LEG, pnl - CHARGE_PER_LEG
            )
            # Brokerage is ₹20 per leg: the entry leg was taken when the position opened, this is the exit leg.
            charges = CHARGE_PER_LEG * 2
            await conn.execute(
                """INSERT INTO history
                   (symbol, type, qty, entry_price, exit_price, pnl, charges, reason, exit_time, source)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
                pos["symbol"], pos["type"], pos["qty"],
                pos["entry_price"], exit_price, pnl, charges, reason, now, pos["source"]
            )
    return pnl


# ─────────────────────────────────────────────
# LIVE PRICE LOOKUP — shared by the SL/TP watcher
# ─────────────────────────────────────────────
_SYMBOL_ALIASES = {
    "NIFTY 50": "^NSEI", "NIFTY": "^NSEI",
    "BANK NIFTY": "^NSEBANK", "BANKNIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
    # Angel prices these bare index names directly; Yahoo has no equivalent.
    "FINNIFTY": "FINNIFTY", "MIDCPNIFTY": "MIDCPNIFTY", "NIFTYNXT50": "NIFTYNXT50",
}


# Real option contract trading symbol, e.g. NIFTY27OCT2623100CE / RELIANCE27OCT261260PE
_OPTION_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9&-]*\d{2}[A-Z]{3}\d{2}\d+(CE|PE)$")


def _to_price_symbol(symbol: str) -> str:
    """Map a position's stored symbol to a Yahoo/Angel-lookup-friendly symbol."""
    symbol = symbol.upper()
    if symbol in _SYMBOL_ALIASES:
        return _SYMBOL_ALIASES[symbol]
    if "^" in symbol or "=" in symbol or symbol.endswith(".NS") or _OPTION_SYMBOL_RE.match(symbol):
        return symbol
    return symbol.replace(" ", "") + ".NS"


async def _fetch_ltp(symbol: str) -> Optional[float]:
    """Fetch last traded price for a position symbol: Angel One first, Yahoo Finance fallback."""
    price_sym = _to_price_symbol(symbol)

    angel_data = await asyncio.to_thread(get_angel_quote, price_sym)
    if angel_data:
        try:
            return float(angel_data["chart"]["result"][0]["meta"]["regularMarketPrice"])
        except Exception:
            pass

    try:
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{quote(price_sym, safe='^=')}?interval=1m&range=1d&includePrePost=false"
        )
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return None
            j = r.json()
            price = j["chart"]["result"][0]["meta"].get("regularMarketPrice")
            return float(price) if price is not None else None
    except Exception:
        return None


_SL_TP_POLL_SECONDS = 20


async def _sl_tp_watcher(pool: asyncpg.Pool):
    """Background loop: auto square-off any open position whose SL/TP has been breached,
    independent of whether a browser tab is open."""
    last_error = None
    while True:
        try:
            async with pool.acquire() as conn:
                positions = await conn.fetch("SELECT * FROM positions")
            for pos in positions:
                ltp = await _fetch_ltp(pos["price_symbol"] or pos["symbol"])
                if ltp is None:
                    continue
                reason = sl_tp_breached(pos["type"], ltp, float(pos["sl"]), float(pos["tp"]))
                if reason:
                    await _close_position(pool, pos["id"], ltp, reason)
            await _fill_pending_orders(pool)
            if _angel_broker:
                _angel_broker.refresh_master_if_stale()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            detail = getattr(e, "detail", e)
            if str(detail) != last_error:               # say it once per distinct problem, not every 20 seconds
                print(f"[WARN] SL/TP watcher error: {detail}")
                last_error = str(detail)
        else:
            last_error = None
        await asyncio.sleep(_SL_TP_POLL_SECONDS)


async def _open_position(conn, symbol, pos_type, qty, price, sl, tp, order_type, product, price_symbol, source='manual') -> tuple:
    """Block margin, take the entry charge and insert the position. Caller holds a transaction.
    Returns (position id, margin). Raises HTTPException(400) if funds are short."""
    margin = required_margin(symbol, pos_type, qty, price)
    port = await conn.fetchrow("SELECT * FROM portfolio WHERE id = 1 FOR UPDATE")
    available = float(port["capital"]) - float(port["used_margin"])
    if available < margin + CHARGE_PER_LEG:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient margin. Available: ₹{available:,.2f}, Required: ₹{margin + CHARGE_PER_LEG:,.2f}"
        )
    await conn.execute(
        """UPDATE portfolio SET used_margin = used_margin + $1,
                  capital = capital - $2, total_pnl = total_pnl - $2 WHERE id = 1""",
        margin, CHARGE_PER_LEG
    )
    row = await conn.fetchrow(
        """INSERT INTO positions (symbol, type, qty, entry_price, sl, tp, entry_time, price_symbol, order_type, product, margin, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id""",
        symbol, pos_type, qty, price, sl, tp, datetime.datetime.now(datetime.timezone.utc),
        price_symbol, order_type, product, margin, source
    )
    return row["id"], margin


async def _fill_pending_orders(pool: asyncpg.Pool):
    """Turn pending LIMIT/SL orders into positions once the market reaches their price."""
    async with pool.acquire() as conn:
        orders = await conn.fetch("SELECT * FROM orders ORDER BY id")
    for o in orders:
        ltp = await _fetch_ltp(o["price_symbol"] or o["symbol"])
        if ltp is None or not order_fills(o["order_type"], o["type"], float(o["price"]), ltp):
            continue
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    gone = await conn.fetchrow("DELETE FROM orders WHERE id = $1 RETURNING id", o["id"])
                    if not gone:
                        continue                      # cancelled or filled meanwhile
                    problem = validate_sl_tp(o["type"], ltp, float(o["sl"]), float(o["tp"]))
                    if problem:
                        print(f"[WARN] Pending order #{o['id']} cancelled at fill: {problem}")
                        continue
                    await _open_position(conn, o["symbol"], o["type"], int(o["qty"]), ltp,
                                         float(o["sl"]), float(o["tp"]), o["order_type"], o["product"], o["price_symbol"])
        except HTTPException as e:
            print(f"[WARN] Pending order #{o['id']} dropped: {e.detail}")   # the failed transaction rolled the delete back; drop the order for good
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM orders WHERE id = $1", o["id"])


async def _ensure_schema(pool: asyncpg.Pool):
    """Create tables, migrate schema, and seed default portfolio."""
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio (
                id          SERIAL PRIMARY KEY,
                capital     NUMERIC(14, 2) NOT NULL DEFAULT 1000000.00,
                used_margin NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
                total_pnl   NUMERIC(14, 2) NOT NULL DEFAULT 0.00
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS positions (
                id          SERIAL PRIMARY KEY,
                symbol      TEXT NOT NULL,
                type        TEXT NOT NULL CHECK (type IN ('LONG', 'SHORT')),
                qty         INTEGER NOT NULL CHECK (qty > 0),
                entry_price NUMERIC(12, 2) NOT NULL,
                sl          NUMERIC(12, 2) NOT NULL,
                tp          NUMERIC(12, 2) NOT NULL,
                order_type  TEXT NOT NULL DEFAULT 'MARKET',
                product     TEXT NOT NULL DEFAULT 'MIS',
                entry_time  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id          SERIAL PRIMARY KEY,
                symbol      TEXT NOT NULL,
                type        TEXT NOT NULL,
                qty         INTEGER NOT NULL,
                entry_price NUMERIC(12, 2) NOT NULL,
                exit_price  NUMERIC(12, 2) NOT NULL,
                pnl         NUMERIC(12, 2) NOT NULL,
                charges     NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                reason      TEXT,
                exit_time   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS backtest_runs (
                id          SERIAL PRIMARY KEY,
                symbol      TEXT NOT NULL,
                timeframe   TEXT NOT NULL,
                params      JSONB NOT NULL DEFAULT '{}',
                stats       JSONB NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id           SERIAL PRIMARY KEY,
                symbol       TEXT NOT NULL,
                type         TEXT NOT NULL CHECK (type IN ('LONG', 'SHORT')),
                qty          INTEGER NOT NULL CHECK (qty > 0),
                price        NUMERIC(12, 2) NOT NULL,
                sl           NUMERIC(12, 2) NOT NULL,
                tp           NUMERIC(12, 2) NOT NULL,
                order_type   TEXT NOT NULL,
                product      TEXT NOT NULL DEFAULT 'MIS',
                price_symbol TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS autotrade_log (
                id          SERIAL PRIMARY KEY,
                ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                symbol      TEXT NOT NULL,
                call        TEXT NOT NULL,
                confidence  INTEGER NOT NULL DEFAULT 0,
                action      TEXT NOT NULL,
                detail      TEXT NOT NULL DEFAULT '',
                position_id INTEGER,
                candle_ts   BIGINT
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS live_orders (
                id              SERIAL PRIMARY KEY,
                client_id       TEXT UNIQUE NOT NULL,
                ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                symbol          TEXT NOT NULL,
                side            TEXT NOT NULL,
                qty             INTEGER NOT NULL,
                order_type      TEXT NOT NULL,
                product         TEXT NOT NULL,
                price           NUMERIC(12, 2),
                trigger_price   NUMERIC(12, 2),
                state           TEXT NOT NULL,
                broker_order_id TEXT,
                message         TEXT NOT NULL DEFAULT ''
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS live_exits (
                id            SERIAL PRIMARY KEY,
                created       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                symbol        TEXT NOT NULL,
                product       TEXT NOT NULL,
                qty           INTEGER NOT NULL,
                sl_pct        NUMERIC(6, 2) NOT NULL DEFAULT 0,
                tp_pct        NUMERIC(6, 2) NOT NULL DEFAULT 0,
                trail_pct     NUMERIC(6, 2) NOT NULL DEFAULT 0,
                entry         NUMERIC(12, 2),
                peak          NUMERIC(12, 2),
                stop          NUMERIC(12, 2),
                target        NUMERIC(12, 2),
                state         TEXT NOT NULL DEFAULT 'WAITING',
                attempts      INTEGER NOT NULL DEFAULT 0,
                reason        TEXT NOT NULL DEFAULT '',
                message       TEXT NOT NULL DEFAULT ''
            )
        """)
        # Safe migration: add new columns if they don't exist on old tables
        for stmt in [
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'MARKET'",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'MIS'",
            "ALTER TABLE history   ADD COLUMN IF NOT EXISTS charges NUMERIC(10,2) NOT NULL DEFAULT 0.00",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS price_symbol TEXT",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS margin NUMERIC(14,2)",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'",
            "ALTER TABLE history   ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'",
        ]:
            await conn.execute(stmt)
        # Seed default portfolio row
        await conn.execute("""
            INSERT INTO portfolio (id, capital, used_margin, total_pnl)
            SELECT 1, 1000000.00, 0.00, 0.00
            WHERE NOT EXISTS (SELECT 1 FROM portfolio WHERE id = 1)
        """)

# ─────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────
app = FastAPI(title="Ryugan AI Backend", version="2.0.0", lifespan=lifespan)

_allowed_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def revalidate_static_files(request: Request, call_next):
    """The ES modules in frontend/js are loaded without version suffixes, so without this a browser
    can keep serving stale copies after an update. no-cache = always revalidate (cheap 304 via ETag)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response


_STARTED_AT = time.time()


@app.get("/api/health")
async def health(request: Request):
    """Liveness check. It does not query the database (a deploy platform's health check should reflect whether the
    process is up), but it reports what the process knows, which is the first thing to look at when something stops working."""
    pool = request.app.state.pool
    info = {"status": "ok", "uptime_s": round(time.time() - _STARTED_AT), "db_connected": bool(pool and pool.connected)}
    try:
        info["angel"] = _angel_broker.session_info() if _angel_broker else None
    except Exception:
        info["angel"] = None
    return info


def _get_pool(request: Request) -> ResilientPool:
    """The shared pool. It connects lazily and reconnects after a dropped connection, so this never fails by itself;
    a database that is really down shows up as a 503 from acquire()."""
    return request.app.state.pool

# ─────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────
class TradeRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=50)
    type: str = Field(..., pattern="^(LONG|SHORT)$")
    qty: int = Field(..., gt=0)
    entry_price: float = Field(..., gt=0)
    sl: float = Field(..., gt=0)
    tp: float = Field(..., gt=0)
    order_type: str = Field(default="MARKET", max_length=10)
    product: str = Field(default="MIS", max_length=10)
    # Price-feed symbol resolved by the UI at order time (e.g. ^NSEI, HDFCBANK.NS, NIFTY27OCT2623100CE).
    # Stored with the position so the SL/TP watcher prices it exactly as the screen does.
    price_symbol: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9^=.&_-]{1,60}$")

class ExitRequest(BaseModel):
    id: int = Field(..., gt=0)
    exit_price: float = Field(..., gt=0)
    reason: str = Field(default="Manual Square Off", max_length=100)

class ModifyPositionRequest(BaseModel):
    sl: Optional[float] = Field(default=None, gt=0)
    tp: Optional[float] = Field(default=None, gt=0)

class AiChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=8000)

class AiChatRequest(BaseModel):
    system: str = Field(..., min_length=1, max_length=4000)
    messages: list[AiChatMessage] = Field(..., min_length=1, max_length=40)

class BacktestSaveRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=50)
    timeframe: str = Field(..., min_length=1, max_length=20)
    params: dict[str, Any] = Field(default_factory=dict)
    stats: dict[str, Any] = Field(...)

# ─────────────────────────────────────────────
# PAPER TRADING ROUTES
# ─────────────────────────────────────────────
@app.get("/api/paper/portfolio")
async def get_portfolio(request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        port = await conn.fetchrow("SELECT * FROM portfolio WHERE id = 1")
        positions = await conn.fetch("SELECT * FROM positions ORDER BY entry_time DESC")
    return {
        "portfolio": dict(port),
        "positions": [dict(p) for p in positions]
    }


@app.get("/api/paper/history")
async def get_history(request: Request, page: int = 1, page_size: int = 25):
    """Closed trades, newest first, one page at a time."""
    pool = _get_pool(request)
    page_size = max(5, min(100, page_size))
    async with pool.acquire() as conn:
        total = int(await conn.fetchval("SELECT COUNT(*) FROM history"))
        pages = max(1, -(-total // page_size))
        page = max(1, min(page, pages))
        hist = await conn.fetch(
            "SELECT * FROM history ORDER BY exit_time DESC, id DESC LIMIT $1 OFFSET $2", page_size, (page - 1) * page_size
        )
    return {"history": [dict(h) for h in hist], "total": total, "page": page, "pages": pages, "page_size": page_size}


@app.post("/api/paper/trade")
async def execute_trade(req: TradeRequest, request: Request):
    pool = _get_pool(request)
    pos_type = req.type.upper()
    order_type = req.order_type.upper()
    symbol = req.symbol.upper()
    price = req.entry_price
    pending = False

    if order_type in ("LIMIT", "SL", "SL-M"):
        # `entry_price` is the limit price (LIMIT) or the trigger price (SL / SL-M).
        ltp = await _fetch_ltp(req.price_symbol or symbol)
        if ltp is None:
            raise HTTPException(status_code=400, detail="No live price available, so a LIMIT/SL order cannot be placed now.")
        if order_fills(order_type, pos_type, price, ltp):
            if order_type == "LIMIT":
                price = ltp                    # marketable limit: fills at the better market price
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Trigger {price:.2f} is already {'below' if pos_type == 'LONG' else 'above'} the market ({ltp:.2f}); "
                           f"a {pos_type} stop must trigger {'above' if pos_type == 'LONG' else 'below'} it.")
        else:
            pending = True

    problem = validate_sl_tp(pos_type, price, req.sl, req.tp)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    async with pool.acquire() as conn:
        async with conn.transaction():
            if pending:
                row = await conn.fetchrow(
                    """INSERT INTO orders (symbol, type, qty, price, sl, tp, order_type, product, price_symbol)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id""",
                    symbol, pos_type, req.qty, price, req.sl, req.tp, order_type, req.product, req.price_symbol)
                return {"status": "pending", "order_id": row["id"], "id": row["id"], "margin_used": 0}
            pos_id, margin = await _open_position(
                conn, symbol, pos_type, req.qty, price, req.sl, req.tp, order_type, req.product, req.price_symbol)
    return {"status": "success", "id": pos_id, "margin_used": margin, "fill_price": price}


@app.get("/api/paper/orders")
async def get_orders(request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders ORDER BY id DESC")
    return {"orders": [dict(r) for r in rows]}


@app.delete("/api/paper/orders/{order_id}")
async def cancel_order(order_id: int, request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        gone = await conn.fetchrow("DELETE FROM orders WHERE id = $1 RETURNING id", order_id)
    if not gone:
        raise HTTPException(status_code=404, detail="Order not found (already filled or cancelled)")
    return {"status": "success"}


@app.post("/api/paper/exit")
async def exit_trade(req: ExitRequest, request: Request):
    pool = _get_pool(request)
    pnl = await _close_position(pool, req.id, req.exit_price, req.reason)
    if pnl is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return {"status": "success", "pnl": pnl}


@app.post("/api/paper/reset")
async def reset_portfolio(request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM positions")
            await conn.execute("DELETE FROM orders")
            await conn.execute("DELETE FROM autotrade_log")
            await conn.execute("DELETE FROM history")
            await conn.execute(
                "UPDATE portfolio SET capital = 1000000.00, used_margin = 0.00, total_pnl = 0.00 WHERE id = 1"
            )
    return {"status": "success", "message": "Portfolio reset to ₹10,00,000"}


@app.patch("/api/paper/position/{position_id}")
async def modify_position(position_id: int, req: ModifyPositionRequest, request: Request):
    """Update SL and/or Target on an open position."""
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        pos = await conn.fetchrow("SELECT * FROM positions WHERE id = $1", position_id)
        if not pos:
            raise HTTPException(status_code=404, detail="Position not found")
        new_sl = req.sl if req.sl is not None else float(pos["sl"])
        new_tp = req.tp if req.tp is not None else float(pos["tp"])
        problem = validate_sl_tp(pos["type"], float(pos["entry_price"]), new_sl, new_tp)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        await conn.execute(
            "UPDATE positions SET sl = $1, tp = $2 WHERE id = $3",
            new_sl, new_tp, position_id
        )
    return {"status": "success", "sl": new_sl, "tp": new_tp}


class AutoTradeToggle(BaseModel):
    enabled: bool


class SymbolSetting(BaseModel):
    sl_pct: Optional[float] = Field(default=None, ge=0.05, le=0.90)
    tp_pct: Optional[float] = Field(default=None, ge=0.05, le=3.0)
    lots: Optional[int] = Field(default=None, ge=1, le=100)
    enabled: Optional[bool] = None


class AutoTradeSettings(BaseModel):
    min_confidence: Optional[int] = Field(default=None, ge=50, le=100)
    max_positions: Optional[int] = Field(default=None, ge=1, le=20)
    max_trades_per_day: Optional[int] = Field(default=None, ge=1, le=50)
    sl_pct: Optional[float] = Field(default=None, ge=0.05, le=0.90)
    tp_pct: Optional[float] = Field(default=None, ge=0.05, le=3.0)
    lots: Optional[int] = Field(default=None, ge=1, le=100)
    universe: Optional[list[str]] = Field(default=None, max_length=60)
    symbols: Optional[dict[str, SymbolSetting]] = None


def _settings_view(cfg: dict) -> dict:
    """Global values plus one row per symbol in the universe: lot size, the default and the value in force."""
    lots_map = get_lot_sizes() or {}
    rows = []
    for sym in cfg["universe"]:
        und = autotrader.underlying_of(sym)
        lot = lots_map.get(und) if und else None
        sp = autotrader.symbol_params(cfg, und)
        default_lots = (max(1, round(cfg["nifty_qty"] / lot)) if (und == "NIFTY" and lot and cfg.get("nifty_qty")) else cfg["lots"])
        rows.append({
            "symbol": sym, "underlying": und, "lot_size": lot, "tradable": und is not None,
            "default": {"sl_pct": cfg["sl_pct"], "tp_pct": cfg["tp_pct"], "lots": default_lots},
            "value": {"sl_pct": sp["sl_pct"], "tp_pct": sp["tp_pct"], "lots": sp["lots"] or default_lots, "enabled": sp["enabled"]},
        })
    return {"settings": {k: cfg[k] for k in ("min_confidence", "max_positions", "max_trades_per_day", "sl_pct", "tp_pct", "lots", "universe")},
            "symbols": rows}


@app.get("/api/autotrade/status")
async def autotrade_status(request: Request):
    pool = _get_pool(request)
    cfg = await autotrader.load_settings(pool)
    async with pool.acquire() as conn:
        open_auto = await conn.fetchval("SELECT COUNT(*) FROM positions WHERE source = 'auto'")
        orders = await conn.fetch("SELECT ts, symbol, call, confidence, action, detail, position_id, candle_ts FROM autotrade_log WHERE action = 'ORDER' ORDER BY id DESC LIMIT 100")
        pnl = await conn.fetchval("SELECT COALESCE(SUM(pnl - charges), 0) FROM history WHERE source = 'auto'")
        trades = await conn.fetchval("SELECT COUNT(*) FROM history WHERE source = 'auto'")
        orders_today = await conn.fetchval("SELECT COUNT(*) FROM autotrade_log WHERE action = 'ORDER' AND (ts AT TIME ZONE 'Asia/Kolkata')::date = $1",
                                           autotrader.now_ist().date())
    now = autotrader.now_ist()
    return {
        "enabled": cfg["enabled"], "market_open": autotrader.market_open(now),
        "settings": {k: cfg[k] for k in ("min_confidence", "max_positions", "max_trades_per_day", "sl_pct", "tp_pct", "lots", "nifty_qty", "universe", "symbols")},
        "orders_today": orders_today,
        "state": _autotrade_state, "open_auto_positions": open_auto,
        "closed_auto_trades": trades, "closed_auto_net_pnl": float(pnl),
        "orders": [dict(r) for r in orders],
        "last_scan": await autotrader.load_last_scan(pool),
    }


@app.post("/api/autotrade/enable")
async def autotrade_enable(req: AutoTradeToggle, request: Request):
    cfg = await autotrader.save_settings(_get_pool(request), {"enabled": req.enabled})
    return {"enabled": cfg["enabled"]}


@app.get("/api/autotrade/settings")
async def autotrade_get_settings(request: Request):
    return _settings_view(await autotrader.load_settings(_get_pool(request)))


@app.post("/api/autotrade/settings")
async def autotrade_settings(req: AutoTradeSettings, request: Request):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if "universe" in patch:
        patch["universe"] = [s.strip().upper() for s in patch["universe"] if s.strip()] or autotrader.DEFAULT_UNIVERSE
    if "symbols" in patch:
        patch["symbols"] = autotrader.clean_symbols({k: {f: x for f, x in v.items() if x is not None} for k, v in patch["symbols"].items()})
    cfg = await autotrader.save_settings(_get_pool(request), patch)
    return _settings_view(cfg)


@app.post("/api/autotrade/run")
async def autotrade_run(request: Request, dry: bool = True, as_if_open: bool = False):
    """Run one scan now. `dry=true` (default) only reports what it WOULD order; `dry=false` really orders,
    and only if auto-trading is switched on. `as_if_open=true` (dry runs only) evaluates the entry window as if
    it were 10:00 IST today, to preview what would happen during market hours."""
    pool = _get_pool(request)
    if not dry:
        cfg = await autotrader.load_settings(pool)
        if not cfg["enabled"]:
            raise HTTPException(status_code=400, detail="Auto-trading is off. Switch it on first, or run with dry=true.")
    now = autotrader.now_ist().replace(hour=10, minute=0) if (dry and as_if_open) else None
    decisions = await _run_autotrade_cycle(pool, dry=dry, now=now)
    return {"dry": dry, "decisions": decisions}


# ─────────────────────────────────────────────
# LIVE (REAL-MONEY) MANUAL TRADING — see live_rules.py and live_broker.py
# Live mode is held in memory only, so it is OFF again after every server restart.
# ─────────────────────────────────────────────
_live_state = {"enabled": False, "enabled_at": None}
_live_previews: dict = {}                 # preview_id -> {"order": ..., "expires": ...}; an order is only sent from a preview
_PREVIEW_TTL = 120
_LIVE_PHRASE = "ENABLE LIVE"


class LiveOrderIn(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=40)
    side: str = Field(..., pattern="^(BUY|SELL)$")
    qty: int = Field(..., ge=1, le=1000000)
    order_type: str = Field(..., pattern="^(LIMIT|MARKET|STOPLOSS_LIMIT|STOPLOSS_MARKET)$")
    product: str = Field(..., pattern="^(INTRADAY|CARRYFORWARD)$")
    price: Optional[float] = Field(default=None, ge=0)
    trigger_price: Optional[float] = Field(default=None, ge=0)
    sl_pct: Optional[float] = Field(default=None, ge=0, le=100)       # exit rules for a BUY: managed by the server after it fills
    tp_pct: Optional[float] = Field(default=None, ge=0, le=1000)
    trail_pct: Optional[float] = Field(default=None, ge=0, le=100)


class LiveConfirm(BaseModel):
    preview_id: str = Field(..., min_length=8, max_length=64)


class LiveEnable(BaseModel):
    phrase: str = ""


class LiveLimits(BaseModel):
    max_order_value: float = Field(..., gt=0, le=10_000_000)
    max_lots: int = Field(..., ge=1, le=1000)
    max_daily_loss: float = Field(..., gt=0, le=10_000_000)


async def _live_limits(pool) -> dict:
    raw = await autotrader._row(pool, "live_limits")
    try:
        return json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        return {}


async def _live_context(pool, o: dict) -> dict:
    sym = o["symbol"].upper()
    info = _angel_broker._master_lookup.get(sym) if _angel_broker else None
    found = bool(info and info.get("exch") == "NFO" and _OPTION_SYMBOL_RE.match(sym))
    und = autotrader.underlying_from_contract(sym)
    lot = (get_lot_sizes() or {}).get(und) if und else None
    problems = []
    try:
        ltp = await _fetch_ltp(sym) if found else None
    except Exception as e:
        ltp = None
        problems.append(f"Could not read the live price: {e}")
    try:
        pos = await asyncio.to_thread(live_broker.positions)
    except Exception as e:
        pos = []
        problems.append(f"Could not read your positions from the broker ({e}), so the order cannot be checked safely.")
    net_long = sum(p["net_qty"] for p in pos if p["symbol"] == sym and p["product"] == o["product"] and p["net_qty"] > 0)
    day_loss = max(0.0, -sum((p["pnl"] or 0) for p in pos))
    try:
        limits = await _live_limits(pool)
    except Exception as e:
        limits = {}
        problems.append(f"Could not read your saved limits ({e}).")
    return {"limits": limits, "problems": problems, "contract_found": found, "lot_size": lot, "ltp": ltp, "net_long_qty": net_long,
            "day_loss": day_loss, "now": autotrader.now_ist(), "info": info}


def _live_preview_payload(o: dict, ctx: dict, check: dict) -> dict:
    return {"order": o, "ltp": ctx["ltp"], "lot_size": ctx["lot_size"], "live_enabled": _live_state["enabled"], **check}


@app.exception_handler(Exception)
async def _live_error_detail(request: Request, exc: Exception):
    """An unexpected error on a live endpoint is shown to the user with its reason, instead of a bare 'HTTP 500'."""
    from fastapi.responses import JSONResponse
    print(f"[ERROR] {request.method} {request.url.path}: {exc!r}")
    if request.url.path.startswith("/api/live/"):
        return JSONResponse(status_code=500, content={"detail": f"Server error: {exc}"})
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/api/live/status")
async def live_status(request: Request):
    pool = _get_pool(request)
    limits = await _live_limits(pool)
    funds = None
    try:
        funds = await asyncio.to_thread(live_broker.funds)
    except Exception as e:
        funds = {"error": str(e)}
    async with pool.acquire() as conn:
        orders_today = await conn.fetchval("SELECT COUNT(*) FROM live_orders WHERE state = 'PLACED' AND (ts AT TIME ZONE 'Asia/Kolkata')::date = $1",
                                           autotrader.now_ist().date())
    return {"enabled": _live_state["enabled"], "enabled_at": _live_state["enabled_at"], "limits": limits, "limits_ready": live_rules.limits_ready(limits),
            "market_open": live_rules.market_open(autotrader.now_ist()), "funds": funds, "orders_today": orders_today,
            "phrase": _LIVE_PHRASE}


@app.post("/api/live/enable")
async def live_enable(req: LiveEnable):
    if req.phrase.strip() != _LIVE_PHRASE:
        raise HTTPException(status_code=400, detail=f"Type exactly {_LIVE_PHRASE} to switch live trading on.")
    _live_state.update(enabled=True, enabled_at=time.time())
    return {"enabled": True}


@app.post("/api/live/disable")
async def live_disable():
    _live_state.update(enabled=False, enabled_at=None)
    return {"enabled": False}


@app.post("/api/live/limits")
async def live_set_limits(req: LiveLimits, request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO app_settings (key, value) VALUES ('live_limits', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                           json.dumps(req.model_dump()))
    return {"limits": req.model_dump(), "limits_ready": True}


@app.post("/api/live/preview")
async def live_preview(req: LiveOrderIn, request: Request):
    """Check an order against every rule and return what it would cost. Sends nothing. A passing preview can be confirmed
    within two minutes, and only the previewed order can be sent."""
    pool = _get_pool(request)
    o = {**req.model_dump(), "symbol": req.symbol.upper()}
    ctx = await _live_context(pool, o)
    check = live_rules.validate_order(o, ctx)
    if ctx.get("problems"):
        check["errors"] = list(ctx["problems"]) + check["errors"]; check["ok"] = False
    out = _live_preview_payload(o, ctx, check)
    now = time.time()
    for k in [k for k, v in _live_previews.items() if v["expires"] < now]:
        _live_previews.pop(k, None)
    if check["ok"]:
        pid = uuid.uuid4().hex
        _live_previews[pid] = {"order": o, "expires": now + _PREVIEW_TTL}
        out["preview_id"] = pid
        out["expires_in"] = _PREVIEW_TTL
    return out


@app.post("/api/live/order")
async def live_place(req: LiveConfirm, request: Request):
    """Send the previewed order to the broker, once."""
    if not _live_state["enabled"]:
        raise HTTPException(status_code=403, detail="Live trading is OFF. Switch it on (type the phrase) first.")
    pool = _get_pool(request)
    item = _live_previews.pop(req.preview_id, None)
    if not item or item["expires"] < time.time():
        raise HTTPException(status_code=409, detail="This preview has expired or was already used. Preview the order again.")
    o = item["order"]
    ctx = await _live_context(pool, o)                     # re-check with fresh prices and positions
    check = live_rules.validate_order(o, ctx)
    if ctx.get("problems"):
        check["errors"] = list(ctx["problems"]) + check["errors"]; check["ok"] = False
    if not check["ok"]:
        raise HTTPException(status_code=400, detail=" ".join(check["errors"]))
    params = live_broker.build_params(o, ctx["info"]["token"], ctx["info"]["exch"], tag="RYUGAN" + req.preview_id[:6])
    async with pool.acquire() as conn:                     # written BEFORE sending: if anything goes wrong there is still a record
        await conn.execute(
            """INSERT INTO live_orders (client_id, symbol, side, qty, order_type, product, price, trigger_price, state)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SENDING')""",
            req.preview_id, o["symbol"], o["side"], o["qty"], o["order_type"], o["product"], o.get("price") or None, o.get("trigger_price") or None)
    result = await asyncio.to_thread(live_broker.place, params)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE live_orders SET state = $1, broker_order_id = $2, message = $3 WHERE client_id = $4",
                           result["state"], result.get("order_id"), (result.get("message") or "")[:500], req.preview_id)
    print(f"[LIVE] {o['side']} {o['qty']} {o['symbol']} {o['order_type']} -> {result['state']} {result.get('order_id') or ''} {result.get('message') or ''}")
    rule = {k: o.get(k) or 0 for k in ("sl_pct", "tp_pct", "trail_pct")}
    if result["state"] == "PLACED" and o["side"] == "BUY" and live_exits.any_rule(rule):
        try:
            await _live_exit_create(pool, o["symbol"], o["product"], o["qty"], rule)
        except Exception as e:
            print(f"[WARN] could not save the exit rules for {o['symbol']}: {e}")
            result["message"] = (result.get("message") or "") + " WARNING: the stop-loss/target rules could not be saved: set them again on the position."
    return {"state": result["state"], "order_id": result.get("order_id"), "message": result.get("message", ""), "est": check["est"]}


@app.get("/api/live/orders")
async def live_orders(request: Request):
    pool = _get_pool(request)
    try:
        book = await asyncio.to_thread(live_broker.order_book)
    except Exception as e:
        book = []
        print(f"[WARN] live order book failed: {e}")
    async with pool.acquire() as conn:
        ledger = await conn.fetch("SELECT * FROM live_orders ORDER BY id DESC LIMIT 50")
    return {"orders": book, "ledger": [dict(r) for r in ledger]}


@app.get("/api/live/positions")
async def live_positions():
    pos = await asyncio.to_thread(live_broker.positions)
    return {"positions": [p for p in pos if p["net_qty"] != 0 or (p["pnl"] or 0) != 0]}


# ── stop-loss / target / trailing stop, managed by the server for real positions ──
class LiveExitRule(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=40)
    product: str = Field(..., pattern="^(INTRADAY|CARRYFORWARD)$")
    sl_pct: Optional[float] = Field(default=None, ge=0, le=100)
    tp_pct: Optional[float] = Field(default=None, ge=0, le=1000)
    trail_pct: Optional[float] = Field(default=None, ge=0, le=100)


class LiveExitCancel(BaseModel):
    id: int = Field(..., ge=1)


class LiveExitDefaults(BaseModel):
    sl_pct: Optional[float] = Field(default=None, ge=0, le=100)
    tp_pct: Optional[float] = Field(default=None, ge=0, le=1000)
    trail_pct: Optional[float] = Field(default=None, ge=0, le=100)


_EXIT_WAIT_SECS = 30 * 60        # a buy that has not shown up as a position after this long is given up on
_EXIT_MAX_ATTEMPTS = 3           # a sell the exchange refused is tried this many times; an unknown outcome is never retried


async def _live_exit_create(pool, symbol: str, product: str, qty: int, rule: dict) -> int:
    async with pool.acquire() as conn:
        await conn.execute("UPDATE live_exits SET state = 'CANCELLED', reason = 'replaced', updated = NOW() WHERE symbol = $1 AND product = $2 AND state IN ('WAITING', 'ARMED')",
                           symbol, product)
        return await conn.fetchval("INSERT INTO live_exits (symbol, product, qty, sl_pct, tp_pct, trail_pct) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
                                   symbol, product, qty, rule["sl_pct"], rule["tp_pct"], rule["trail_pct"])


async def _live_send_exit(pool, r, qty: int, action: str):
    """Sell `qty` at market to close a position because its stop / trailing stop / target was hit. Recorded before it is sent;
    an outcome that is unknown is never sent again."""
    info = _angel_broker._master_lookup.get(r["symbol"]) if _angel_broker else None
    if not info:
        async with pool.acquire() as conn:
            await conn.execute("UPDATE live_exits SET state = 'EXIT_FAILED', message = $2, updated = NOW() WHERE id = $1", r["id"], "contract not in the scrip master")
        return
    o = {"symbol": r["symbol"], "side": "SELL", "qty": qty, "order_type": "MARKET", "product": r["product"], "price": 0, "trigger_price": 0}
    client_id = f"EXIT{r['id']}-{uuid.uuid4().hex[:8]}"
    params = live_broker.build_params(o, info["token"], info["exch"], tag=f"RYEXIT{r['id']}"[:20])
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO live_orders (client_id, symbol, side, qty, order_type, product, state, message) VALUES ($1, $2, 'SELL', $3, 'MARKET', $4, 'SENDING', $5)",
                           client_id, r["symbol"], qty, r["product"], f"auto exit: {action}")
    result = await asyncio.to_thread(live_broker.place, params)
    st = result["state"]
    async with pool.acquire() as conn:
        await conn.execute("UPDATE live_orders SET state = $1, broker_order_id = $2, message = $3 WHERE client_id = $4",
                           st, result.get("order_id"), (f"auto exit: {action}. " + (result.get("message") or ""))[:500], client_id)
        if st == "PLACED":
            await conn.execute("UPDATE live_exits SET state = 'EXIT_SENT', message = $2, updated = NOW() WHERE id = $1", r["id"], f"order {result.get('order_id')}")
        elif st == "UNKNOWN":
            await conn.execute("UPDATE live_exits SET state = 'UNKNOWN', message = $2, updated = NOW() WHERE id = $1", r["id"],
                               "The exit order's outcome is unknown. It was NOT sent again: check your broker app.")
        else:                                                    # refused or never sent: safe to try again, a few times
            attempts = (r["attempts"] or 0) + 1
            await conn.execute("UPDATE live_exits SET state = $2, attempts = $3, message = $4, updated = NOW() WHERE id = $1", r["id"],
                               "ARMED" if attempts < _EXIT_MAX_ATTEMPTS else "EXIT_FAILED", attempts, (result.get("message") or st)[:300])
    print(f"[LIVE-EXIT] {action} SELL {qty} {r['symbol']} -> {st} {result.get('order_id') or ''} {result.get('message') or ''}")


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


async def _live_exit_tick(pool):
    """One look at every position that has exit rules. Does nothing unless live mode is ON and the exchange is open."""
    now = autotrader.now_ist()
    if not _live_state["enabled"] or not live_rules.market_open(now):
        return
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM live_exits WHERE state IN ('WAITING', 'ARMED') ORDER BY id")
    if not rows:
        return
    pos = await asyncio.to_thread(live_broker.positions)
    for r in rows:
        mine = [p for p in pos if p["symbol"] == r["symbol"] and p["product"] == r["product"] and p["net_qty"] > 0]
        held = sum(p["net_qty"] for p in mine)
        if r["state"] == "WAITING":
            if held <= 0:
                if (_utc_now() - r["created"]).total_seconds() > _EXIT_WAIT_SECS:
                    async with pool.acquire() as conn:
                        await conn.execute("UPDATE live_exits SET state = 'EXPIRED', message = 'the buy never became a position', updated = NOW() WHERE id = $1", r["id"])
                continue
            entry = float(mine[0].get("buy_avg") or mine[0].get("ltp") or 0)
            if entry <= 0:
                continue
            async with pool.acquire() as conn:
                await conn.execute("UPDATE live_exits SET state = 'ARMED', entry = $2, peak = $2, qty = $3, updated = NOW() WHERE id = $1", r["id"], entry, min(int(r["qty"]), held))
            continue
        if held <= 0:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE live_exits SET state = 'DONE', message = 'the position is closed', updated = NOW() WHERE id = $1", r["id"])
            continue
        try:
            ltp = await _fetch_ltp(r["symbol"])
        except Exception:
            ltp = None
        ltp = ltp or mine[0].get("ltp")
        if not ltp:
            continue
        rule = {"sl_pct": float(r["sl_pct"]), "tp_pct": float(r["tp_pct"]), "trail_pct": float(r["trail_pct"])}
        entry = float(r["entry"])
        ev = live_exits.evaluate(rule, entry, float(ltp), float(r["peak"] or entry))
        if ev["action"]:
            async with pool.acquire() as conn:
                claimed = await conn.fetchval("UPDATE live_exits SET state = 'TRIGGERED', reason = $2, updated = NOW() WHERE id = $1 AND state = 'ARMED' RETURNING id", r["id"], ev["action"])
            if claimed:
                await _live_send_exit(pool, r, min(int(r["qty"]), held), ev["action"])
        else:
            old = (float(r["peak"] or 0), float(r["stop"]) if r["stop"] is not None else None, float(r["target"]) if r["target"] is not None else None)
            if (ev["peak"], ev["stop"], ev["target"]) != old:
                async with pool.acquire() as conn:
                    await conn.execute("UPDATE live_exits SET peak = $2, stop = $3, target = $4, updated = NOW() WHERE id = $1", r["id"], ev["peak"], ev["stop"], ev["target"])


async def _live_exit_loop(pool):
    last = None
    while True:
        await asyncio.sleep(4)
        try:
            await _live_exit_tick(pool)
            last = None
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if str(e) != last:
                print(f"[WARN] live exit watcher: {e}")
                last = str(e)


@app.get("/api/live/exits")
async def live_exits_list(request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM live_exits WHERE state IN ('WAITING', 'ARMED') OR updated > NOW() - INTERVAL '1 day' ORDER BY id DESC LIMIT 30")
        raw = await conn.fetchrow("SELECT value FROM app_settings WHERE key = 'live_exit_defaults'")
    try:
        defaults = json.loads(raw["value"]) if raw else {}
    except (ValueError, TypeError):
        defaults = {}
    return {"exits": [dict(r) for r in rows], "watching": _live_state["enabled"], "defaults": defaults}


@app.post("/api/live/exits/set")
async def live_exits_set(req: LiveExitRule, request: Request):
    """Put (or replace) stop-loss / target / trailing rules on a position you already hold."""
    pool = _get_pool(request)
    try:
        rule = live_exits.clean(req.sl_pct, req.tp_pct, req.trail_pct)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    sym = req.symbol.upper()
    pos = await asyncio.to_thread(live_broker.positions)
    held = sum(p["net_qty"] for p in pos if p["symbol"] == sym and p["product"] == req.product and p["net_qty"] > 0)
    if held <= 0:
        raise HTTPException(status_code=400, detail="You do not hold this contract long with this product, so there is nothing to protect.")
    if not live_exits.any_rule(rule):
        async with pool.acquire() as conn:
            await conn.execute("UPDATE live_exits SET state = 'CANCELLED', reason = 'removed', updated = NOW() WHERE symbol = $1 AND product = $2 AND state IN ('WAITING', 'ARMED')", sym, req.product)
        return {"removed": True}
    return {"id": await _live_exit_create(pool, sym, req.product, held, rule)}


@app.post("/api/live/exits/cancel")
async def live_exits_cancel(req: LiveExitCancel, request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE live_exits SET state = 'CANCELLED', reason = 'cancelled by you', updated = NOW() WHERE id = $1 AND state IN ('WAITING', 'ARMED')", req.id)
    return {"cancelled": req.id}


@app.post("/api/live/exit-defaults")
async def live_exit_defaults(req: LiveExitDefaults, request: Request):
    pool = _get_pool(request)
    try:
        rule = live_exits.clean(req.sl_pct, req.tp_pct, req.trail_pct)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO app_settings (key, value) VALUES ('live_exit_defaults', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", json.dumps(rule))
    return {"defaults": rule}


class LiveCancel(BaseModel):
    order_id: str = Field(..., min_length=3, max_length=40)
    variety: str = Field(default="NORMAL", pattern="^(NORMAL|STOPLOSS|AMO|ROBO)$")


@app.post("/api/live/cancel")
async def live_cancel(req: LiveCancel):
    """Cancelling is always allowed, even with live mode off: it can only reduce risk."""
    res = await asyncio.to_thread(live_broker.cancel, req.order_id, req.variety)
    if not res["ok"]:
        raise HTTPException(status_code=400, detail=res.get("message") or "The broker did not cancel the order.")
    return res


class LiveExit(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=40)
    product: str = Field(..., pattern="^(INTRADAY|CARRYFORWARD)$")


@app.post("/api/live/exit-preview")
async def live_exit_preview(req: LiveExit, request: Request):
    """Preview an order that closes a long position: a SELL limit order a little below the last price so it fills."""
    pool = _get_pool(request)
    sym = req.symbol.upper()
    pos = await asyncio.to_thread(live_broker.positions)
    held = sum(p["net_qty"] for p in pos if p["symbol"] == sym and p["product"] == req.product and p["net_qty"] > 0)
    if held <= 0:
        raise HTTPException(status_code=400, detail="There is no long position to close for this contract and product.")
    ltp = await _fetch_ltp(sym)
    if not ltp:
        raise HTTPException(status_code=503, detail="No live price for this contract right now.")
    price = max(0.05, round(ltp * 0.98 / 0.05) * 0.05)
    return await live_preview(LiveOrderIn(symbol=sym, side="SELL", qty=held, order_type="LIMIT", product=req.product, price=round(price, 2)), request)


@app.post("/api/live/kill")
async def live_kill():
    """Emergency stop: switch live trading off and cancel every open order. Open positions are NOT closed (do that deliberately)."""
    _live_state.update(enabled=False, enabled_at=None)
    try:
        async with app.state.pool.acquire() as conn:
            await conn.execute("UPDATE live_exits SET state = 'CANCELLED', reason = 'kill switch', updated = NOW() WHERE state IN ('WAITING', 'ARMED')")
    except Exception as e:
        print(f"[WARN] kill switch could not cancel the exit rules: {e}")
    cancelled, failed = [], []
    try:
        for o in await asyncio.to_thread(live_broker.order_book):
            if o["open"]:
                r = await asyncio.to_thread(live_broker.cancel, o["order_id"], o["variety"])
                (cancelled if r["ok"] else failed).append(o["order_id"])
    except Exception as e:
        print(f"[WARN] kill switch could not read the order book: {e}")
        return {"enabled": False, "cancelled": cancelled, "failed": failed, "error": str(e)}
    return {"enabled": False, "cancelled": cancelled, "failed": failed}


@app.get("/api/paper/stats")
async def get_paper_stats(request: Request):
    """Return today's paper trading statistics."""
    pool = _get_pool(request)
    today = datetime.datetime.now(datetime.timezone.utc).date()
    async with pool.acquire() as conn:
        port = await conn.fetchrow("SELECT * FROM portfolio WHERE id = 1")
        today_hist: list = await conn.fetch(
            "SELECT pnl, charges FROM history WHERE exit_time::date = $1", today
        )
    trades = len(today_hist)
    day_pnl = sum(float(h["pnl"]) for h in today_hist)
    day_charges = sum(float(h["charges"]) for h in today_hist)
    wins = sum(1 for h in today_hist if float(h["pnl"]) > 0)
    win_rate = round(float((wins / trades * 100) if trades else 0.0), 1)
    return {
        "trades_today": trades,
        "day_pnl": round(float(day_pnl), 2),
        "day_charges": round(float(day_charges), 2),
        "net_day_pnl": round(float(day_pnl - day_charges), 2),
        "win_rate": win_rate,
        "total_pnl": float(port["total_pnl"]) if port else 0,
    }


# ─────────────────────────────────────────────
# BACKTEST RESULTS — save/list past backtest runs
# ─────────────────────────────────────────────
@app.post("/api/backtest/save")
async def save_backtest(req: BacktestSaveRequest, request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO backtest_runs (symbol, timeframe, params, stats)
               VALUES ($1, $2, $3::jsonb, $4::jsonb)
               RETURNING id, created_at""",
            req.symbol.upper(), req.timeframe, json.dumps(req.params), json.dumps(req.stats)
        )
    return {"status": "success", "id": row["id"], "created_at": row["created_at"]}


@app.get("/api/backtest/history")
async def get_backtest_history(request: Request, limit: int = 20):
    pool = _get_pool(request)
    limit = max(1, min(50, limit))
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, symbol, timeframe, params, stats, created_at
               FROM backtest_runs ORDER BY created_at DESC LIMIT $1""",
            limit
        )
    runs = []
    for r in rows:
        d = dict(r)
        d["params"] = json.loads(d["params"]) if isinstance(d["params"], str) else d["params"]
        d["stats"] = json.loads(d["stats"]) if isinstance(d["stats"], str) else d["stats"]
        runs.append(d)
    return {"runs": runs}


# ─────────────────────────────────────────────
# AI ANALYST — Claude Messages API proxy
# Key stays server-side; never sent to the browser.
# ─────────────────────────────────────────────

@app.post("/api/ai/chat")
async def ai_chat(req: AiChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI not configured on server (set ANTHROPIC_API_KEY in backend/.env)."
        )

    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1200,
        "system": req.system,
        "messages": [m.model_dump() for m in req.messages],
    }
    headers = {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Anthropic API request timed out")
        except httpx.ConnectError as e:
            raise HTTPException(status_code=502, detail=f"Cannot reach Anthropic API: {e}")

    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Anthropic API error: {r.text[:300]}")

    data = r.json()
    text = "\n".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    )
    return {"text": text}


# ─────────────────────────────────────────────
# WEBSOCKET — live price streaming
# Client sends {"symbols": [...]} once after connecting, then receives
# {"prices": {symbol: ltp, ...}, "ts": epoch_seconds} every few seconds.
# ─────────────────────────────────────────────
_WS_PUSH_SECONDS = 5
_WS_MAX_SYMBOLS = 30

def _parse_ws_symbols(msg) -> Optional[list]:
    """Pull a clean symbol list out of a {"symbols": [...]} message, or None if it isn't one."""
    symbols = msg.get("symbols") if isinstance(msg, dict) else None
    if not isinstance(symbols, list) or not symbols:
        return None
    return [str(s)[:50] for s in symbols][:_WS_MAX_SYMBOLS]


@app.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    await websocket.accept()
    reader = None
    try:
        symbols = _parse_ws_symbols(await websocket.receive_json())
        if not symbols:
            await websocket.close(code=1008)
            return

        # The page sends a new {"symbols": [...]} whenever positions change; keep listening for those.
        async def listen_for_updates():
            while True:
                new = _parse_ws_symbols(await websocket.receive_json())
                if new:
                    symbols[:] = new
        reader = asyncio.create_task(listen_for_updates())

        sem = asyncio.Semaphore(4)

        async def price_of(sym):
            async with sem:
                return sym, await _fetch_ltp(sym)

        while not reader.done():  # the reader ends when the client disconnects
            results = await asyncio.gather(*(price_of(s) for s in list(symbols)))
            prices = {sym: ltp for sym, ltp in results if ltp is not None}
            await websocket.send_json({"prices": prices, "ts": time.time()})
            await asyncio.sleep(_WS_PUSH_SECONDS)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WARN] ws_prices error: {e}")
    finally:
        if reader:
            reader.cancel()


# ─────────────────────────────────────────────
# SYMBOL UNIVERSE — full NSE stock list + F&O underlyings
# ─────────────────────────────────────────────

@app.get("/api/stocks")
async def list_stocks():
    """Full NSE cash-market equity list (~2700 symbols), from Angel's public
    scrip master — no broker session/API key required for this endpoint."""
    equities = await asyncio.to_thread(get_nse_equities)
    if not equities:
        raise HTTPException(status_code=503, detail="Stock list unavailable (scrip master failed to load).")
    return {"stocks": equities, "count": len(equities)}


_fo_underlyings_cache: dict = {}
_FO_UNDERLYINGS_TTL = 24 * 60 * 60  # 24h — this list changes rarely

@app.get("/api/fo/underlyings")
async def list_fo_underlyings():
    """Full list of F&O underlyings (indices + ~211 stocks) from NSE."""
    now = time.time()
    if _fo_underlyings_cache.get("fetched_at") and now - _fo_underlyings_cache["fetched_at"] < _FO_UNDERLYINGS_TTL:
        return {"underlyings": _fo_underlyings_cache["data"], "cached": True}
    data = await get_fo_underlyings()
    _fo_underlyings_cache["data"] = data
    _fo_underlyings_cache["fetched_at"] = now
    return {"underlyings": data, "cached": False}


@app.get("/api/lot-sizes")
async def lot_sizes():
    """Current lot size for every F&O underlying, read from Angel's contract list (not hardcoded)."""
    sizes = await asyncio.to_thread(get_lot_sizes)
    if not sizes:
        raise HTTPException(status_code=503, detail="Lot sizes unavailable (contract list failed to load).")
    return {"lot_sizes": sizes, "count": len(sizes)}


@app.get("/api/options/search")
async def search_options(q: str, limit: int = 40):
    """Real, unexpired option contracts matching free text like "NIFTY 23100" or "reliance 1260 ce".
    Powers the symbol-box suggestions. Needs a strike in the query; returns [] otherwise.
    Uses only Angel's public scrip master, so no broker login is required."""
    limit = max(1, min(100, limit))
    results = await asyncio.to_thread(search_option_contracts, q, limit)
    return {"contracts": results, "count": len(results)}


def _parse_angel_expiry(s: str) -> datetime.datetime:
    """Parse Angel's 'DDMMMYYYY' expiry strings (e.g. '29SEP2026') for sorting."""
    try:
        return datetime.datetime.strptime(s, "%d%b%Y")
    except Exception:
        return datetime.datetime.max


@app.get("/api/fo/option-chain")
async def get_option_chain(underlying: str, expiry: Optional[str] = None, strikes: int = 10,
                           center: Optional[float] = None):
    """Real option chain (LTP, OI, % change) for an F&O underlying, from Angel One.
    `strikes` = how many strikes to include on each side of the window centre, which is the
    ATM strike by default or `center` (e.g. a specific contract's strike) when given."""
    client = await asyncio.to_thread(get_angel_client)
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Angel One session unavailable — check ANGEL_* credentials in backend/.env."
        )
    await asyncio.to_thread(load_master_contract)

    key = underlying.strip().upper()
    contracts = get_option_contracts(key)
    if not contracts:
        raise HTTPException(status_code=404, detail=f"No F&O contracts found for '{underlying}'.")

    all_expiries = sorted({c["expiry"] for c in contracts}, key=_parse_angel_expiry)
    if expiry:
        if expiry not in all_expiries:
            raise HTTPException(status_code=400, detail=f"Unknown expiry '{expiry}' for {underlying}.")
        chosen_expiry = expiry
    else:
        today = datetime.datetime.now()
        future = [e for e in all_expiries if _parse_angel_expiry(e) >= today]
        chosen_expiry = future[0] if future else all_expiries[0]

    exp_contracts = [c for c in contracts if c["expiry"] == chosen_expiry]
    strike_vals = sorted({c["strike"] for c in exp_contracts})

    # Spot price, to center the strike window on the ATM strike.
    spot = None
    spot_info = _angel_broker._master_lookup.get(key) or _angel_broker._master_lookup.get(key + "-EQ")
    if spot_info:
        try:
            res = await asyncio.to_thread(
                _angel_broker.call_angel, "getMarketData", mode="LTP", exchangeTokens={spot_info["exch"]: [spot_info["token"]]})
            fetched = (res or {}).get("data", {}).get("fetched") or []
            if fetched:
                spot = float(fetched[0]["ltp"])
        except Exception as e:
            print(f"[WARN] option-chain spot lookup failed for {key}: {e}")

    if center is not None:
        atm_idx = min(range(len(strike_vals)), key=lambda i: abs(strike_vals[i] - center))
    elif spot:
        atm_idx = min(range(len(strike_vals)), key=lambda i: abs(strike_vals[i] - spot))
    else:
        atm_idx = len(strike_vals) // 2
    lo = max(0, atm_idx - strikes)
    hi = min(len(strike_vals), atm_idx + strikes + 1)
    selected_strikes = strike_vals[lo:hi]

    by_strike: dict = {}
    for c in exp_contracts:
        if c["strike"] in selected_strikes:
            by_strike.setdefault(c["strike"], {})[c["type"]] = c

    tokens = [c["token"] for row in by_strike.values() for c in row.values()]
    quotes: dict = {}
    for i in range(0, len(tokens), 50):  # Angel caps tokens per request
        batch = tokens[i:i + 50]
        try:
            res = await asyncio.to_thread(_angel_broker.call_angel, "getMarketData", mode="FULL", exchangeTokens={"NFO": batch})
            for item in (res or {}).get("data", {}).get("fetched") or []:
                quotes[item["symbolToken"]] = item
        except Exception as e:
            print(f"[WARN] option-chain quote batch failed: {e}")

    def _row(c):
        q = quotes.get(c["token"])
        if not q:
            return None
        return {
            "symbol": c["symbol"],
            "ltp": q.get("ltp"),
            "change_pct": q.get("percentChange"),
            "oi": q.get("opnInterest"),
            "volume": q.get("tradeVolume"),
        }

    rows = []
    for strike in selected_strikes:
        pair = by_strike.get(strike, {})
        rows.append({
            "strike": strike,
            "ce": _row(pair["CE"]) if "CE" in pair else None,
            "pe": _row(pair["PE"]) if "PE" in pair else None,
        })

    return {
        "underlying": key,
        "spot": spot,
        "expiry": chosen_expiry,
        "expiries": all_expiries[:12],
        "rows": rows,
    }


# ─────────────────────────────────────────────
# ANGEL ONE BROKER ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/angel/status")
async def get_angel_status():
    """Check whether Angel One session is active and master contract is loaded."""
    try:
        # angel_broker is imported at module level (with try/except guard).
        # Import the module-level singletons directly to avoid repeated imports.
        import angel_broker as _ab # type: ignore
        client = await asyncio.to_thread(_ab.get_angel_client)
        return {
            "connected": bool(client and _ab._auth_token),
            "master_loaded": _ab._is_loaded,
            "symbols_count": len(_ab._master_lookup),
            **_ab.session_info(),
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


@app.post("/api/angel/reconnect")
async def angel_reconnect():
    """Force a fresh Angel login now (it also happens by itself on a schedule and after any auth error)."""
    client = await asyncio.to_thread(_angel_broker.get_angel_client, True)
    return {"connected": bool(client), **_angel_broker.session_info()}


@app.get("/api/angel/historical")
async def angel_historical(
    symbol: str,
    interval: str = "15m",
    days: int = 90,
):
    """
    Fetch OHLCV historical candle data from Angel One for backtesting.

    Args:
        symbol:   Frontend symbol (e.g. '^NSEI', 'RELIANCE.NS', 'NIFTY 24 MAR 23100 CE')
        interval: Candle size — 1m, 5m, 15m, 30m, 1h, 1d, 1wk
        days:     Calendar days of data to fetch (long ranges are fetched in several throttled windows)

    Returns:
        { candles: [{t, o, h, l, c, v}, ...] } sorted ascending by time
    """
    if interval not in ("1m", "5m", "15m", "30m", "1h", "1d", "1wk"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    if days < 1 or days > 1500:
        raise HTTPException(status_code=400, detail="days must be 1-1500")

    candles = await asyncio.to_thread(get_angel_historical, symbol, interval=interval, days=days)
    if candles is None:
        raise HTTPException(
            status_code=503,
            detail="Angel One historical data unavailable. Check broker credentials or symbol."
        )
    return {"symbol": symbol, "interval": interval, "candles": candles, "count": len(candles)}


# ─────────────────────────────────────────────
# GLOBAL MARKET CUES — Real prices via Angel + Yahoo
# ─────────────────────────────────────────────

_global_cache: dict = {}
_GLOBAL_TTL = 50  # the page refreshes every 60 s, so a 50 s cache means every refresh sees fresh data

@app.get("/api/global-cues")
async def get_global_cues():
    """
    Fetch live global market cues:
    - GIFT Nifty (via Angel One for ^NSEI, labeled as GIFT/SGX Nifty)
    - Dow Jones, WTI Crude, Gold, DXY, USD/INR via Yahoo Finance proxy
    Returns compact JSON structured for the frontend global cues panel.
    """
    now = time.time()
    if _global_cache.get("fetched_at") and now - _global_cache["fetched_at"] < _global_cache.get("ttl", _GLOBAL_TTL):
        return {**_global_cache["data"], "cached": True}

    def _pct(c, p):
        if not c or not p or p == 0:
            return 0.0
        return round((c - p) / p * 100, 2)

    async def _yq(sym: str):
        """Fetch a Yahoo Finance quote via the existing Yahoo proxy logic."""
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{sym}?interval=1d&range=2d&includePrePost=false"
        )
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(url, headers=headers)
                if r.status_code != 200:
                    return None
                j = r.json()
                meta = j["chart"]["result"][0]["meta"]
                c = meta.get("regularMarketPrice") or meta.get("previousClose")
                p = meta.get("chartPreviousClose") or meta.get("previousClose") or c
                return {"c": c, "p": p, "pct": _pct(c, p), "diff": round((c or 0) - (p or 0), 2)}
        except Exception:
            return None

    # Fetch proxy for GIFT Nifty (Current month NIFTY FUT from Angel One)
    gift_data = None
    try:
        import angel_broker as _ab
        if not _ab.master_ready():
            _ab.ensure_master_loading()       # don't make the page wait for a slow download; the GIFT proxy is optional
            raise RuntimeError("scrip master still loading")
        import re
        fut_pattern = re.compile(r"^NIFTY\d{2}[A-Z]{3}\d{2}FUT$")
        nifty_futs = [k for k in _ab._master_lookup.keys() if fut_pattern.match(k)]
        if nifty_futs:
            def _parse_fut_date(sym):
                try:
                    return datetime.datetime.strptime(sym[5:-3], "%d%b%y")
                except Exception:
                    return datetime.datetime.max
            nearest_fut = sorted(nifty_futs, key=_parse_fut_date)[0]
            gift_data = await asyncio.to_thread(get_angel_quote, nearest_fut)
    except Exception as e:
        print("Error resolving NIFTY FUT:", e)

    if gift_data:
        try:
            meta = gift_data["chart"]["result"][0]["meta"]
            gc = meta.get("regularMarketPrice")
            gp = meta.get("chartPreviousClose") or gc
            gift = {"c": gc, "p": gp, "pct": _pct(gc, gp), "diff": round((gc or 0) - (gp or 0), 2)}
        except Exception:
            gift = None
    else:
        gift = None

    # Parallel fetch for global indices
    dj, crude, gold, dxy, inr, nsei_yf = await asyncio.gather(
        _yq("^DJI"), _yq("CL=F"), _yq("GC=F"), _yq("DX-Y.NYB"), _yq("INR=X"), _yq("^NSEI")
    )

    # Fall back to Yahoo for GIFT Nifty if Angel failed
    if not gift and nsei_yf:
        gift = nsei_yf

    def _fmt(d, prefix="", suffix="", decimals=2):
        if not d:
            return {"val": "N/A", "pct": 0, "up": None}
        val = d["c"]
        formatted = f"{prefix}{val:,.{decimals}f}{suffix}"
        return {"val": formatted, "pct": d["pct"], "diff": d.get("diff", 0), "up": d["pct"] >= 0}

    bias_pts = 0
    if gift and gift["pct"] >= 0: bias_pts += 2
    elif gift: bias_pts -= 2
    if dj and dj["pct"] >= 0: bias_pts += 1
    elif dj: bias_pts -= 1
    if crude and crude["pct"] < -1: bias_pts -= 1  # falling crude = mildly bad
    bias = "POSITIVE" if bias_pts > 0 else "NEGATIVE" if bias_pts < 0 else "NEUTRAL"

    payload = {
        "gift_nifty": _fmt(gift, decimals=0),
        "dow":        _fmt(dj, decimals=0),
        "crude":      _fmt(crude, prefix="$"),
        "gold":       _fmt(gold, prefix="$", decimals=0),
        "dxy":        _fmt(dxy),
        "usdinr":     _fmt(inr),
        "bias":       bias,
        # the server may run in UTC (cloud VMs do), so stamp the time in IST explicitly
        "timestamp":  autotrader.now_ist().strftime("%d %b %H:%M:%S IST"),
        "fetched_at": now,
    }
    missing = sum(1 for k in ("gift_nifty", "dow", "crude", "gold", "dxy", "usdinr") if payload[k]["val"] == "N/A")
    _global_cache["data"] = payload
    _global_cache["fetched_at"] = now
    _global_cache["ttl"] = _GLOBAL_TTL if missing == 0 else 15       # a partial failure is retried soon, not kept for two minutes
    return {**payload, "cached": False}


# ─────────────────────────────────────────────
# YAHOO FINANCE PROXY
# ─────────────────────────────────────────────

@app.get("/api/yahoo/search")
async def search_yahoo(q: str):
    """Proxy for Yahoo Finance search autosuggest (useful for getting exact options symbols)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json"
    }
    url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=10&newsCount=0"
    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Yahoo Search Failed")
        return r.json()

_INTRADAY_INTERVALS = {"1m", "5m", "15m", "30m"}
_LONG_RANGES = {"3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}


_OPTION_CHART_DAYS = {
    "1d": 1, "2d": 2, "5d": 5, "1mo": 30, "3mo": 90, "6mo": 180,
    "1y": 365, "2y": 365, "5y": 365, "10y": 365, "ytd": 365, "max": 365,
}
_ANGEL_INTRADAY = {"1m", "5m", "15m", "30m", "1h"}


async def _option_chart(symbol: str, interval: str, range_: str) -> dict:
    """Candles for a real option contract from Angel, shaped like Yahoo's chart JSON.
    Angel has no weekly/monthly history for contracts (and they only live weeks anyway),
    so those timeframes fall back to daily candles."""
    if interval not in _ANGEL_INTRADAY and interval != "1d":
        interval = "1d"
    days = _OPTION_CHART_DAYS.get(range_, 30)
    if interval in _ANGEL_INTRADAY:
        days = min(days, 60)  # keep within Angel's intraday history limits
    candles = await asyncio.to_thread(get_angel_historical, symbol, interval, days)
    if not candles:
        raise HTTPException(
            status_code=503,
            detail=f"No candle data for {symbol} (Angel One session/key unavailable, or contract has no history)."
        )
    closes = [c["c"] for c in candles]
    return {"chart": {"result": [{
        "meta": {
            "symbol": symbol,
            "regularMarketPrice": closes[-1],
            "chartPreviousClose": closes[0],
        },
        "timestamp": [c["t"] for c in candles],
        "indicators": {"quote": [{
            "open": [c["o"] for c in candles],
            "high": [c["h"] for c in candles],
            "low": [c["l"] for c in candles],
            "close": closes,
            "volume": [c["v"] for c in candles],
        }]},
    }], "error": None}}


def _aggregate_yearly(chart_json: dict) -> dict:
    """Yahoo has no yearly interval, so roll its monthly candles up into calendar years
    (open = first month's open, close = last month's close, high/low = extremes, volume = sum).
    The result keeps Yahoo's response shape so existing frontend parsing works unchanged."""
    result = chart_json["chart"]["result"][0]
    ts = result.get("timestamp") or []
    q = result["indicators"]["quote"][0]

    years: dict = {}
    for i, t in enumerate(ts):
        c = q["close"][i]
        if c is None:
            continue
        o, h, l, v = q["open"][i], q["high"][i], q["low"][i], q["volume"][i]
        y = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).year
        b = years.get(y)
        if b is None:
            years[y] = {
                "t": t, "o": o if o is not None else c,
                "h": h if h is not None else c, "l": l if l is not None else c,
                "c": c, "v": v or 0,
            }
        else:
            if h is not None:
                b["h"] = max(b["h"], h)
            if l is not None:
                b["l"] = min(b["l"], l)
            b["c"] = c
            b["v"] += v or 0

    ordered = [years[y] for y in sorted(years)]
    result["timestamp"] = [b["t"] for b in ordered]
    result["indicators"] = {"quote": [{
        "open": [b["o"] for b in ordered],
        "high": [b["h"] for b in ordered],
        "low": [b["l"] for b in ordered],
        "close": [b["c"] for b in ordered],
        "volume": [b["v"] for b in ordered],
    }]}
    return chart_json

# Short-lived cache + concurrency cap for Yahoo candles: the dashboard scanner asks for the same few symbols every
# 5 minutes and the chart re-asks when you flip timeframes, so identical requests shouldn't each hit Yahoo.
_CANDLE_TTL = 60.0
_CANDLE_CACHE_MAX = 400
_candle_cache: dict = {}                   # (symbol, interval, range) -> (stored_at, payload)
_yahoo_slots = asyncio.Semaphore(4)


def _candle_cache_get(key, now=None):
    hit = _candle_cache.get(key)
    if hit and (now or time.monotonic()) - hit[0] < _CANDLE_TTL:
        return hit[1]
    return None


def _candle_cache_put(key, payload, now=None):
    if len(_candle_cache) >= _CANDLE_CACHE_MAX:
        oldest = min(_candle_cache, key=lambda k: _candle_cache[k][0])
        _candle_cache.pop(oldest, None)
    _candle_cache[key] = (now or time.monotonic(), payload)


@app.get("/api/yahoo-chart/{symbol}")
async def get_yahoo_chart(symbol: str, interval: str = "15m", range: str = "3mo"):
    """
    Proxy to Yahoo Finance v8 chart API.
    Uses Angel One SmartAPI for single LTP lookups (range=1d or 2d).
    Falls back to Yahoo Finance for historical OHLCV chart data needed by the signal engine.
    """
    # Only intercept with Angel One for simple LTP lookups (small range, not historical chart data)
    if range in ("1d", "2d"):
        angel_data = await asyncio.to_thread(get_angel_quote, symbol)
        if angel_data:
            return JSONResponse(content=angel_data)

    # Real option contracts aren't on Yahoo — serve Angel's candles in Yahoo's response shape.
    if _OPTION_SYMBOL_RE.match(symbol.upper()):
        return JSONResponse(content=await _option_chart(symbol.upper(), interval, range))

    cache_key = (symbol, interval, range)
    cached = _candle_cache_get(cache_key)
    if cached is not None:
        return JSONResponse(content=cached)

    yearly = interval == "1y"
    if yearly:
        # No native yearly interval: fetch monthly history and aggregate it below.
        interval = "1mo"
        if range not in ("5y", "10y", "max"):
            range = "max"
    elif interval in _INTRADAY_INTERVALS and range in _LONG_RANGES:
        range = "60d"
    elif interval == "1h" and range in ("5y", "10y", "max"):
        range = "2y"  # Yahoo only serves ~730 days of hourly data

    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{symbol}?interval={interval}&range={range}&includePrePost=false"
    )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }

    async with _yahoo_slots:
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                response = await client.get(url, headers=headers)
            except httpx.ConnectError as e:
                raise HTTPException(status_code=502, detail=f"Cannot reach Yahoo Finance: {e}")
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Yahoo Finance request timed out")

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Yahoo Finance returned {response.status_code}"
        )

    payload = response.json()
    if yearly:
        try:
            payload = _aggregate_yearly(payload)
        except (KeyError, IndexError, TypeError):
            raise HTTPException(status_code=502, detail="Could not build yearly candles from Yahoo data")
    _candle_cache_put(cache_key, payload)
    return JSONResponse(content=payload)


# ─────────────────────────────────────────────
# NEWS PROXY — Yahoo Finance RSS  (15-min cache)
# ─────────────────────────────────────────────

_news_cache: dict[str, dict] = {}          # { cache_key → {data, fetched_at} }
_NEWS_TTL = 900                            # 15 minutes in seconds

_RSS_FEEDS = {
    "default": "https://news.google.com/rss/search?q=Indian+Stock+Market&hl=en-IN&gl=IN&ceid=IN:en",
    "symbol":  "https://news.google.com/rss/search?q={sym}+stock+India&hl=en-IN&gl=IN&ceid=IN:en",
    "market":  "https://news.google.com/rss/search?q=NSE+BSE+Nifty+Sensex&hl=en-IN&gl=IN&ceid=IN:en",
}

def _sym_to_query(sym: str) -> str:
    """Convert frontend symbol to a Google News-compatible query."""
    sym = sym.strip().upper()
    mapping = {
        "NIFTY 50": "NIFTY 50", "NIFTY": "NIFTY 50",
        "BANK NIFTY": "Bank Nifty", "BANKNIFTY": "Bank Nifty",
        "SENSEX": "BSE Sensex", "VIX": "India VIX",
    }
    if sym in mapping:
        return mapping[sym].replace(" ", "+")
    return sym.replace(" ", "+")
def _parse_rss(xml_text: str, limit: int) -> list[dict]:
    """Parse Yahoo Finance RSS XML and return headline objects."""
    items = []
    try:
        root = ET.fromstring(xml_text)
        ns = "{http://search.yahoo.com/mrss/}"
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            link  = (item.findtext("link")  or "").strip()
            pub   = (item.findtext("pubDate") or "").strip()
            if title:
                items.append({"title": title, "link": link, "published": pub})
            if len(items) >= limit:
                break
    except ET.ParseError:
        pass
    return items

@app.get("/api/news")
async def get_news(q: str = "NIFTY", limit: int = 10):
    """
    Fetch latest financial headlines from Yahoo Finance RSS.

    Args:
        q:     Symbol or market name (e.g. 'NIFTY', 'RELIANCE', 'BANKNIFTY')
        limit: Max headlines to return (1–20)

    Returns:
        { headlines: [{title, link, published}], sentiment_hint: str, cached: bool }
    """
    limit = max(1, min(20, limit))
    cache_key = f"{q.upper()}:{limit}"
    now = time.time()

    # Serve from cache if fresh
    if cache_key in _news_cache:
        entry = _news_cache[cache_key]
        if now - entry["fetched_at"] < _NEWS_TTL:
            return {**entry["data"], "cached": True}

    q_sym = _sym_to_query(q)
    urls = [
        _RSS_FEEDS["symbol"].format(sym=q_sym),
        _RSS_FEEDS["market"],
        _RSS_FEEDS["default"],
    ]

    headlines: list[dict] = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        for url in urls:
            if len(headlines) >= limit:
                break
            try:
                r = await client.get(url, headers=headers, follow_redirects=True)
                if r.status_code == 200:
                    parsed = _parse_rss(r.text, limit - len(headlines))
                    # Deduplicate by title
                    seen = {h["title"] for h in headlines}
                    for item in parsed:
                        if item["title"] not in seen:
                            headlines.append(item)
                            seen.add(item["title"])
            except Exception:
                continue

    payload = {"headlines": headlines[:limit], "count": len(headlines)}
    _news_cache[cache_key] = {"data": payload, "fetched_at": now}
    return {**payload, "cached": False}


# ─────────────────────────────────────────────
# STATIC FRONTEND
# ─────────────────────────────────────────────
_frontend_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
if os.path.isdir(_frontend_path):
    app.mount("/", StaticFiles(directory=_frontend_path, html=True), name="frontend")
