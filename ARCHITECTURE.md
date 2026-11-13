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

---

## v3 dashboard (chart, scanner, CE/PE calls)

The default page is **Dashboard** (`#tab-dash`), built from these ES modules in `frontend/js/`:

| Module | Role |
|---|---|
| `dash.js` | Wires the page: scanner table, chart toolbar, side panel (strategy check / news / option chain) |
| `chart-view.js` | lightweight-charts v4 candlestick chart: 9 timeframes (`CHART_TF` in `timeframes.js`), EMA/VWAP/Bollinger/volume/RSI overlays, BOS/CHoCH markers, FVG zones, SL/target lines, live last-price tick, and **bar replay** (`startReplay`/`stepReplay`/`playReplay`: the chart, overlays and strategy check use only the candles up to the replay bar) |
| `strategies.js` | `evaluate(candles, {news})`: weighted vote of EMA trend, RSI, VWAP, BOS/CHoCH structure, FVG retest, volume and news -> BUY CE / BUY PE / WAIT (needs ADX >= 20 and a score of 3+). `combine()` requires the 5m chart not to contradict the 15m call |
| `smc-structure.js` | Swing pivots (confirmed k bars late, no look-ahead), BOS, CHoCH, fair value gaps |
| `scanner.js` | Every 5 minutes (09:15-15:30 IST Mon-Fri, aligned to candle closes) scans the universe (default: 3 indices + 12 stocks, editable, kept in localStorage), 4 symbols at a time; also looks up the ATM option contract for each call |
| `scan-utils.js`, `candles.js` | Pure helpers (symbol mapping, session change, IST time, VWAP, Yahoo JSON -> candles) |

`ui.css` is loaded after `styles.css`: it re-maps the old colour tokens to a dark palette (light via `data-theme="light"`, toggle in the top bar) and styles the new top bar / nav rail / dashboard.

Backend: `/api/yahoo-chart/{symbol}` now keeps a 60-second in-memory cache and allows 4 concurrent Yahoo requests.

The scan runs in the browser, so it only runs while the page is open. The calls use standard indicator rules; backtests did not show a proven edge, and the UI says so.

Tests: `node --test frontend/tests/*.test.mjs` (strategies, structure, helpers) and `pytest backend/tests`.

## Telegram alerts (notify.py)
Optional alerts for live and paper orders, stop-loss / target / trailing hits and calls at 80%+ confidence. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the server .env (create the bot with @BotFather, press Start in its chat, read the chat id from getUpdates), restart, then switch alerts on under Paper > Auto-trade settings > Telegram alerts. Sending is in the background with a timeout and can never block or break an order; the token is never stored in the database or put in a message. Settings live in app_settings key notify_settings.

## Brokers for live trading (backend/brokers/)
One broker is active at a time (Live page > Broker). `brokers/base.py` is the interface; `angel.py` adapts the existing Angel code (live_broker.py, angel_broker.py) with no change in behaviour; `upstox.py` is the Upstox adapter. The safety logic (live_rules, preview-then-confirm, the send-once ledger, stop/target watcher, kill switch) is broker-independent. Connect works like TradingView: the Live page opens the broker's own login page, the broker redirects to /api/brokers/<id>/callback with a one-time code, the server checks the `state` it issued, exchanges the code for a token and stores it (memory + table broker_sessions, valid until about 03:30 IST next day). Switching broker is refused while live is ON or a stop/target rule is watching. Orders and rules record which broker they went to (column `broker`).
Upstox setup: create the app, set the Redirect URL to UPSTOX_REDIRECT_URI, register the server's reserved public IP, put UPSTOX_* in backend/.env, restart. The Upstox adapter was written from Upstox's documentation and has NOT been run against the real service: test with Upstox's sandbox (tiny orders only) before any real order. Add another broker by implementing `Broker` and registering it in `registry.load_defaults()`.

## Theme and tiles
Tokens live in the "white + midnight cyan" block of frontend/ui.css (dark: midnight cyan #0A2A33 primary, white secondary; light: white primary, midnight cyan secondary; --brand/--on-brand carry the button swap). Every data-table row (table.dtbl, table.scan-table) is drawn as a tile by the "tiles" block in ui.css; js/tiles.js stamps data-label (column name) and data-tone (profit/loss) on cells. Add class keep-table to a table that must stay a real table (the per-stock settings table and the option chain do).

## Smart money concepts (SMC)
frontend/js/smc.js (ported to backend/strategy_vote.py, parity-tested on every bar): structure bias + an order block, fair-value-gap or liquidity-sweep point of interest, taken in the discount (long) or premium (short) half of the last swing range. It is a weight-2 vote in the strategy vote, so a BUY CE / BUY PE (ATM) call now needs the SMC setup to agree to reach 85% confidence. tools/bt_strategies.mjs backtests every strategy alone and in combinations and writes reports/strategy_backtest_report.md (2 years, 14 symbols, modelled option prices): no strategy beats a random-direction yardstick.
SMC update: the vote uses the displacement variant (the structure break behind the setup must be a big one-directional candle); frontend/js/smc.js also has sweepChoch (liquidity sweep then change of character). Both were backtested in reports/strategy_backtest_report.md (sections 2b and 4); neither survives a correction for the number of strategies tried.
Support / resistance (frontend/js/sr.js, ported to backend/strategy_vote.py, parity-tested on every bar): previous day high/low/close and swing levels; breakout, break-and-retest and rejection setups. It is shown in the strategy check and as chart lines but has weight 0 because the backtest found it does not help the vote.
Chart overlays for the smart-money rules (frontend/js/chart-view.js): Order blocks (sky blue = bullish, orange = bearish, unmitigated only), Liquidity sweeps, Displacement candles, Sweep to CHoCH. They use the same functions as the strategy (frontend/js/smc.js), so the chart shows exactly what the vote sees.

## Outcome log (backend/outcomes.py)
Every BUY CE / BUY PE call the scanner makes is stored in `signal_outcomes` (traded or not, with the vote snapshot, ATR, ADX). Once the trading day is over
the resolver scores it on the underlying: +1 ATR before -1 ATR = worked / reversed / neither, plus the 1-hour and to-close moves. For positions the auto-trader
opens, the real option premium path (entry, peak, low, exit) is kept from the SL/TP watcher. The scan loop records calls even when auto-trading is off.
`GET /api/outcomes/summary` and `/recent`; Paper page shows a per-symbol table. Suggestions (alert-only / keep) need 50+ decided calls and are advice only; the app never
changes settings by itself. The Live nav button is hidden (the page and #/live still exist for the broker redirect).
