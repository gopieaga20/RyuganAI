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
    """Create the asyncpg pool on startup, teardown on shutdown."""
    watcher_task = None
    # Warm the Angel scrip master in the background so the first stock/option search is instant.
    master_task = asyncio.create_task(asyncio.to_thread(load_master_contract))
    try:
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        app.state.pool = pool
        await _ensure_schema(pool)
        print("[OK] PostgreSQL connected and schema verified.")
        watcher_task = asyncio.create_task(_sl_tp_watcher(pool))
    except Exception as e:
        print(f"[WARN] Database connection failed: {e}")
        print("       Starting without DB - paper trading endpoints will return 503.")
        app.state.pool = None
    yield
    master_task.cancel()
    if watcher_task:
        watcher_task.cancel()
        try:
            await watcher_task
        except asyncio.CancelledError:
            pass
    if app.state.pool:
        await app.state.pool.close()
        print("PostgreSQL pool closed.")


def compute_margin(qty: int, price: float) -> float:
    """Margin required to open a position of `qty` at `price`."""
    return round(float(qty) * float(price), 2)


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
    Returns the realized PnL, or None if the position no longer exists (already closed)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            pos = await conn.fetchrow(
                "SELECT * FROM positions WHERE id = $1 FOR UPDATE", position_id
            )
            if not pos:
                return None

            margin_release = compute_margin(int(pos["qty"]), float(pos["entry_price"]))
            pnl = compute_pnl(pos["type"], float(pos["entry_price"]), exit_price, int(pos["qty"]))

            now = datetime.datetime.now(datetime.timezone.utc)
            await conn.execute("DELETE FROM positions WHERE id = $1", position_id)
            await conn.execute(
                """UPDATE portfolio
                   SET used_margin = used_margin - $1,
                       capital     = capital + $2,
                       total_pnl   = total_pnl + $3
                   WHERE id = 1""",
                margin_release, pnl, pnl
            )
            # Simulate brokerage: ₹20 flat per leg (entry already charged), here exit
            charges = 20.0
            await conn.execute(
                """INSERT INTO history
                   (symbol, type, qty, entry_price, exit_price, pnl, charges, reason, exit_time)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                pos["symbol"], pos["type"], pos["qty"],
                pos["entry_price"], exit_price, pnl, charges, reason, now
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
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[WARN] SL/TP watcher error: {e}")
        await asyncio.sleep(_SL_TP_POLL_SECONDS)


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
        # Safe migration: add new columns if they don't exist on old tables
        for stmt in [
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'MARKET'",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'MIS'",
            "ALTER TABLE history   ADD COLUMN IF NOT EXISTS charges NUMERIC(10,2) NOT NULL DEFAULT 0.00",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS price_symbol TEXT",
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


@app.get("/api/health")
async def health():
    """Liveness check — deliberately doesn't touch the DB, so a deploy platform's
    health check reflects whether the process is up, not whether Postgres is."""
    return {"status": "ok"}


def _get_pool(request: Request) -> asyncpg.Pool:
    pool = request.app.state.pool
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="Database not available. Check DATABASE_URL and PostgreSQL connection."
        )
    return pool

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
async def get_history(request: Request):
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        hist = await conn.fetch(
            "SELECT * FROM history ORDER BY exit_time DESC LIMIT 100"
        )
    return {"history": [dict(h) for h in hist]}


@app.post("/api/paper/trade")
async def execute_trade(req: TradeRequest, request: Request):
    pool = _get_pool(request)
    problem = validate_sl_tp(req.type.upper(), req.entry_price, req.sl, req.tp)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    margin_req = compute_margin(req.qty, req.entry_price)

    async with pool.acquire() as conn:
        async with conn.transaction():
            port = await conn.fetchrow("SELECT * FROM portfolio WHERE id = 1 FOR UPDATE")
            available = float(port["capital"]) - float(port["used_margin"])
            if available < margin_req:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient margin. Available: ₹{available:,.2f}, Required: ₹{margin_req:,.2f}"
                )

            await conn.execute(
                "UPDATE portfolio SET used_margin = used_margin + $1 WHERE id = 1",
                margin_req
            )
            row = await conn.fetchrow(
                """INSERT INTO positions (symbol, type, qty, entry_price, sl, tp, entry_time, price_symbol)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   RETURNING id""",
                req.symbol.upper(), req.type.upper(), req.qty,
                req.entry_price, req.sl, req.tp,
                datetime.datetime.now(datetime.timezone.utc),
                req.price_symbol
            )
    return {"status": "success", "id": row["id"], "margin_used": margin_req}


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
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


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
        days:     Calendar days of data to fetch (max 365 for intraday)

    Returns:
        { candles: [{t, o, h, l, c, v}, ...] } sorted ascending by time
    """
    if interval not in ("1m", "5m", "15m", "30m", "1h", "1d", "1wk"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    if days < 1 or days > 365:
        raise HTTPException(status_code=400, detail="days must be 1-365")

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
_GLOBAL_TTL = 120  # 2-minute cache for global cues

@app.get("/api/global-cues")
async def get_global_cues():
    """
    Fetch live global market cues:
    - GIFT Nifty (via Angel One for ^NSEI, labeled as GIFT/SGX Nifty)
    - Dow Jones, WTI Crude, Gold, DXY, USD/INR via Yahoo Finance proxy
    Returns compact JSON structured for the frontend global cues panel.
    """
    now = time.time()
    if _global_cache.get("fetched_at") and now - _global_cache["fetched_at"] < _GLOBAL_TTL:
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
        await asyncio.to_thread(_ab.load_master_contract)
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
        "timestamp":  datetime.datetime.now().strftime("%H:%M:%S IST"),
    }
    _global_cache["data"] = payload
    _global_cache["fetched_at"] = now
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
