# Ryugan AI — Trading Command Center

A browser-based NSE/BSE trading dashboard with AI-assisted signals, paper trading, backtesting, and live market data. Single-page vanilla JS frontend + FastAPI backend that proxies market data and brokers a simulated portfolio through Postgres.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (`frontend/`), no framework, no build step |
| Backend | FastAPI + `asyncpg` (`backend/main.py`) |
| Database | PostgreSQL (`portfolio`, `positions`, `history` tables) |
| Market data | Angel One SmartAPI (primary), Yahoo Finance chart API (fallback), Google News RSS (headlines) |
| AI | Anthropic Claude API, called **directly from the browser** using a user-supplied key |

## Repo layout

```
backend/
  main.py          FastAPI app: paper trading API, Angel One endpoints, Yahoo/news proxies, serves frontend/
  angel_broker.py   Angel One SmartAPI session mgmt, scrip-master lookup, LTP + historical candles
  init_db.sql       Standalone schema (superseded by auto-migration in main.py's _ensure_schema)
  requirements.txt
  .env / .env.example   DATABASE_URL (+ ANGEL_* creds, read via os.getenv in angel_broker.py)
frontend/
  index.html        Tabbed single-page UI
  script.js         All client logic (~2800 lines, single file, modules delimited by comment banners)
  styles.css
dalal-street-complete.html   Original monolithic prototype (pre-split)
split_app.py                 One-off script that extracted dalal-street-complete.html into frontend/{css,js} + patched Yahoo proxy URLs
deploy_ubuntu.sh             Deployment script
```

`main.py` mounts `frontend/` as static files at `/`, so the FastAPI process serves both API and UI on one port (default 8000).

## Backend (`backend/main.py`)

- **Lifespan**: creates an `asyncpg` pool on startup, calls `_ensure_schema()` (creates tables + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations + seeds a default portfolio row). If Postgres is unreachable, the app still starts but paper-trading routes return `503`.
- **Paper trading API** (`/api/paper/*`): portfolio, positions, history, trade execution, exit, reset, SL/TP modification, daily stats. All money math done in Postgres with `FOR UPDATE` row locks inside transactions (margin check → insert position → margin release → history row on exit).
- **Angel One endpoints** (`/api/angel/*`): session status, historical OHLCV candles for backtesting.
- **Global cues** (`/api/global-cues`): blends Angel One (NIFTY futures as GIFT Nifty proxy) with Yahoo Finance (Dow, crude, gold, DXY, USD/INR) into a single payload with a simple bias score; cached 120s in-memory.
- **Yahoo proxy** (`/api/yahoo/search`, `/api/yahoo-chart/{symbol}`): search autosuggest + OHLC chart data; for `range=1d|2d` it tries Angel One first (`get_angel_quote`) before falling back to Yahoo.
- **News proxy** (`/api/news`): scrapes Google News RSS per symbol, 15-min in-memory cache.

No auth on any endpoint. CORS is wide open (`allow_origins=["*"]`).

## Angel One integration (`backend/angel_broker.py`)

- Module-level singleton session (`_angel_obj`, `_auth_token`) created via `pyotp` TOTP + `SmartApi.SmartConnect.generateSession`. Re-used across requests; invalidated and re-created on "Session Expired" errors.
- Downloads and caches Angel's full scrip master JSON (NSE/NFO only) into `_master_lookup` (symbol → exchange + token) once per process (`load_master_contract`).
- `_map_symbol` / `_lookup_with_fuzzy` translate frontend-style symbols (`^NSEI`, `RELIANCE.NS`, `NIFTY 24 MAR 23100 CE`) into Angel trading symbols, with a fuzzy regex fallback for options whose year digits don't match exactly.
- `get_quote()` returns a dict shaped like Yahoo's chart API response so the frontend's `yahooFetch()` can consume either source transparently.
- `get_historical()` maps interval strings to Angel's `getCandleData` intervals and normalizes candles to `{t,o,h,l,c,v}`.
- Falls back silently (`None`) on any failure — callers in `main.py` then fall back to Yahoo Finance.

## Database schema

- `portfolio` — single row (`id=1`): `capital`, `used_margin`, `total_pnl`.
- `positions` — open paper positions: `symbol`, `type` (LONG/SHORT), `qty`, `entry_price`, `sl`, `tp`, `order_type`, `product`.
- `history` — closed trades: entry/exit price, `pnl`, flat ₹20 `charges` per exit, `reason`.

`init_db.sql` is the original manual-setup script; `main.py`'s `_ensure_schema()` now handles creation and migration automatically on every startup, so `init_db.sql` is mostly historical.

## Frontend (`frontend/script.js`)

Single file organized into comment-delimited modules, driven by tab navigation (`switchTab`) — no router, no bundler.

**Tabs / features** (`index.html` nav):
- **Nifty** — live index tile + AI/algo signal card (`generateSignal`, `refreshNiftySignal`)
- **Signals** — recent signal history (`addRecentSignal`, `renderSigCard`)
- **Morning Brief** — AI-generated market open summary (`algoMorningBrief`, `generateMorningBrief`)
- **F&O** — options analysis (`algoFO`, `analyzeFO`)
- **Sectors** — sector rotation view (`algoSectors`, `loadSectors`)
- **Backtest** — strategy backtester with equity curve, trade log, replay mode, Sharpe/max-drawdown stats (`runBacktest`, `renderBTResults`, `drawEquityCurve`, `initReplay`/`rStep`/`drawReplay`)
- **Analyst** — freeform AI chat (`sendChat`, `askAIQa`, `getAIReview`)
- **Trade Log** — history view
- **Paper Trading** — virtual portfolio: place/exit orders, modify SL/TP, watchlist, live LTP polling (`ptPlaceOrder`, `squareOffPosition`, `paperTradingLoop`, `renderPTPositions`)

**Key modules:**
- `CONFIG` — Claude API URL/model, `PROXY_BASE` (auto-switches to `http://127.0.0.1:8000` when opened as a local `file://` page, otherwise same-origin).
- `ApiKeyStore` — Anthropic API key stored in **`sessionStorage`** (not localStorage) so it clears on tab close; validated to start with `sk-ant-`.
- `callClaude()` — calls Anthropic's Messages API **directly from the browser** with the user's own key (`anthropic-dangerous-direct-browser-access: true` header). On 401/403 it clears the key and falls back to `algoFallback()` — a set of deterministic, non-AI heuristics (`algoFallback`, `algoMorningBrief`, `algoFO`, `algoSectors`, `algoGlobal`, `algoSignal`) so the app is still usable with zero AI cost/key.
- `yahooFetch()` / `getPrice()` — hit the backend's `/api/yahoo-chart` proxy.
- `NewsFilter` / `applyNewsSentiment` — lightweight keyword-based sentiment tagging over fetched headlines.
- Backtest engine — client-side simulation over historical candles (`genDemoData` for offline demo mode, `applyTrailingStop`, `calcMaxDD`, `calcSharpe`) with a candle-by-candle replay UI (`stepAuto`, `drawReplay`).
- Paper trading — talks to `/api/paper/*`; `paperTradingLoop()` polls prices to auto-trigger SL/TP.

## Notable design choices / risks

- **Anthropic API key lives client-side** and calls go straight from the browser to `api.anthropic.com` — the key is visible to anyone with devtools access to that browser tab (mitigated only by `sessionStorage` + tab-close clearing). There is no backend proxy for AI calls.
- **No authentication anywhere** — paper trading endpoints and the Angel One broker session are shared/global, not per-user.
- **CORS is `*`** and DB credentials in `backend/.env` (currently tracked as modified in git status — verify it isn't committed with real secrets).
- Angel One session/master-contract are process-level singletons — fine for single-instance deployment, not safe for multi-worker/horizontal scaling without external session storage.
