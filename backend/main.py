"""
Ryugan AI — Trading Backend
FastAPI + asyncpg (PostgreSQL) backend for Paper Trading and Yahoo Finance proxy.
"""

from fastapi import FastAPI, HTTPException, Request
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
import xml.etree.ElementTree as ET
from pydantic import BaseModel, Field
from typing import Optional
from dotenv import load_dotenv

try:
    from angel_broker import get_quote as get_angel_quote, get_historical as get_angel_historical # type: ignore
except ImportError:
    def get_angel_quote(sym): return None
    def get_angel_historical(sym, interval="15m", days=90): return None

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:202020@localhost:5432/trading_app"
)

# ─────────────────────────────────────────────
# APP LIFESPAN — connection pool init/teardown
# ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the asyncpg pool on startup, teardown on shutdown."""
    try:
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        app.state.pool = pool
        await _ensure_schema(pool)
        print("✅ PostgreSQL connected and schema verified.")
    except Exception as e:
        print(f"⚠️  Database connection failed: {e}")
        print("     Starting without DB — paper trading endpoints will return 503.")
        app.state.pool = None
    yield
    if app.state.pool:
        await app.state.pool.close()
        print("PostgreSQL pool closed.")


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
        # Safe migration: add new columns if they don't exist on old tables
        for stmt in [
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'MARKET'",
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'MIS'",
            "ALTER TABLE history   ADD COLUMN IF NOT EXISTS charges NUMERIC(10,2) NOT NULL DEFAULT 0.00",
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class ExitRequest(BaseModel):
    id: int = Field(..., gt=0)
    exit_price: float = Field(..., gt=0)
    reason: str = Field(default="Manual Square Off", max_length=100)

class ModifyPositionRequest(BaseModel):
    sl: Optional[float] = Field(default=None, gt=0)
    tp: Optional[float] = Field(default=None, gt=0)

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
    margin_req = round(float(req.qty * req.entry_price), 2)

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
                """INSERT INTO positions (symbol, type, qty, entry_price, sl, tp, entry_time)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   RETURNING id""",
                req.symbol.upper(), req.type.upper(), req.qty,
                req.entry_price, req.sl, req.tp,
                datetime.datetime.now(datetime.timezone.utc)
            )
    return {"status": "success", "id": row["id"], "margin_used": margin_req}


@app.post("/api/paper/exit")
async def exit_trade(req: ExitRequest, request: Request):
    pool = _get_pool(request)

    async with pool.acquire() as conn:
        async with conn.transaction():
            pos = await conn.fetchrow(
                "SELECT * FROM positions WHERE id = $1 FOR UPDATE", req.id
            )
            if not pos:
                raise HTTPException(status_code=404, detail="Position not found")

            margin_release = round(float(float(pos["qty"]) * float(pos["entry_price"])), 2)

            if pos["type"] == "LONG":
                pnl = round(float((req.exit_price - float(pos["entry_price"])) * int(pos["qty"])), 2)
            else:
                pnl = round(float((float(pos["entry_price"]) - req.exit_price) * int(pos["qty"])), 2)

            now = datetime.datetime.now(datetime.timezone.utc)
            await conn.execute("DELETE FROM positions WHERE id = $1", req.id)
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
                pos["entry_price"], req.exit_price, pnl, charges, req.reason, now
            )

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
# ANGEL ONE BROKER ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/angel/status")
async def get_angel_status():
    """Check whether Angel One session is active and master contract is loaded."""
    try:
        # angel_broker is imported at module level (with try/except guard).
        # Import the module-level singletons directly to avoid repeated imports.
        import angel_broker as _ab # type: ignore
        client = _ab.get_angel_client()
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

    candles = get_angel_historical(symbol, interval=interval, days=days)
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
        _ab.load_master_contract()
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
            gift_data = get_angel_quote(nearest_fut)
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

@app.get("/api/yahoo-chart/{symbol}")
async def get_yahoo_chart(symbol: str, interval: str = "15m", range: str = "3mo"):
    """
    Proxy to Yahoo Finance v8 chart API.
    Uses Angel One SmartAPI for single LTP lookups (range=1d or 2d).
    Falls back to Yahoo Finance for historical OHLCV chart data needed by the signal engine.
    """
    # Only intercept with Angel One for simple LTP lookups (small range, not historical chart data)
    if range in ("1d", "2d"):
        angel_data = get_angel_quote(symbol)
        if angel_data:
            return JSONResponse(content=angel_data)

    if interval in _INTRADAY_INTERVALS and range in _LONG_RANGES:
        range = "60d"

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

    return JSONResponse(content=response.json())


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
