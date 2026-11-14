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

Login: every `/api/*` call needs a session cookie (see "Login and Profile" below). CORS allows only `ALLOWED_ORIGINS`.

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
- **One owner, one portfolio** — login protects the app, but paper trading, the auto-trader and the broker sessions are still shared/global, not per-user.
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

## Smart money concepts (SMC): a port of "Smart Money Concepts [LuxAlgo]"
`frontend/js/smc.js` is a port of the LuxAlgo TradingView indicator (c) LuxAlgo, licensed **CC BY-NC-SA 4.0**: keep the attribution, non-commercial use only, and share any derivative under the same licence.
`backend/strategy_vote.py` (`build_smc`) is the Python twin; `backend/tests/test_strategy_parity.py` compares events, order blocks, gaps, equal highs/lows, trailing range, both trends and the vote bar by bar (`frontend/tests/dump_smc.mjs`).
- **Ported with the indicator's defaults:** legs/pivots (swing size 50, internal 5, equal H/L 3; a pivot is registered when the leg flips), BOS/CHoCH on a close through the latest pivot (internal and swing trends), order blocks
  (extreme bar between the broken pivot and the break, after the 2 x ATR(200) volatility filter; mitigated when price trades through the far side; 100 kept), equal highs/lows (0.1 x ATR(200)), fair value gaps (auto threshold,
  the indicator's own removal rules), trailing swing range (equilibrium = midpoint). Where Pine compares with `na` it is treated as "different".
- **The vote is this app's rule on top** (the indicator draws, it gives no signal): internal trend up/down, swing trend not opposed, an unmitigated order block of that direction tapped by a candle closing in the direction,
  price in the discount (long) or premium (short) half of the swing range. The old sweep / displacement / sweep-to-CHoCH variants and their chart overlays were removed with the old code (they are in git history).
- **History needed:** ATR(200) and the 50-bar swing size want a few hundred bars, so the auto-trader and scanner now load the 15-minute series for **1 month** (about 520 bars) instead of 5 days.
- **Chart overlays:** SMC structure (swing BOS/CHoCH big, internal small), Order blocks (5 newest internal thin + 5 newest swing thick, only inside the visible price range), Equal highs/lows, Premium / discount (strong/weak high and low and the equilibrium).
  The separate "Structure BOS / CHoCH" and "FVG retest" strategy votes still use the older `smc-structure.js` rules.
- **Backtest of the new vote** (`node tools/bt_strategies.mjs each`, 2 years of 15m, modelled options): 111 trades, -690 Rs per trade, profit factor 0.63, 48% of signals moved the right way. No edge, and too few trades to say more.
- **Other rules on the LuxAlgo outputs** (`node tools/bt_strategies.mjs smc-rules`, rules in `tools/smc_rules.mjs`, report `reports/smc_rules_report.md`): 11 rules x (alone, + VWAP, + higher-timeframe trend) = 33 variants (CHoCH/BOS then order block, swing-only, block + gap, equal highs/lows swept, break-and-retest, discount/premium). None was profitable in both halves of the period and none passed the multiple-testing check, so the live vote is unchanged.
- **SMC combined with the other strategies** (`node tools/bt_strategies.mjs smc-combos`, report `reports/smc_combinations_report.md`): SMC (and a looser version without the discount/premium rule) with each other strategy, with pairs of them, and as a weight-2 vote in the live six-strategy score: 70 variants, none profitable in both halves, none passing the multiple-testing check.
- **Structure + FVG retest + SMC + Support/resistance** (`node tools/bt_strategies.mjs smc-four`, report `reports/smc_four_strategy_report.md`): the four alone, every pair and triple, all four, weighted scores and each with VWAP agreeing: 42 variants, none profitable in both halves; the four never agree on the same bar and the triples fire only 8-13 times in two years.
- **Candidate defaults with and without the same-day exit** (`DATA=1500d node tools/bt_strategies.mjs default-test`, report `reports/default_settings_backtest_1500d.md`; the backtest now models the INTRADAY square-off at 15:15 as the `sameday` model): the same-day exit lifts every rule by about 250 Rs per trade; Structure + VWAP (FVG adds nothing) is +23 Rs per trade over 7,686 trades, profitable in both halves and significant against a same-bars coin flip, but the edge is 0.2% of the premium, smaller than real option bid-ask spreads, which the model ignores.
- **Structure + VWAP + EMA trend** (`SET=trend DATA=1500d node tools/bt_strategies.mjs default-test`, report `reports/default_settings_backtest_trend_1500d.md`): all three agreeing is -1 Rs per trade with the same-day exit; the surprise is VWAP alone at +166 Rs per trade (profit factor 1.21, positive in every year and both halves), but one symbol (ADANIENT) is about half of that profit, the model prices every ATM option at a fixed 2% of spot (too cheap for volatile stocks) and ignores bid-ask spreads, so it is a lead to verify, not a result.
- **VWAP-alone stress test** (`[MAXPOS=99] DATA=1500d node tools/bt_strategies.mjs vwap-stress`, reports `reports/vwap_stress_test_1500d.md` and `..._slots99_1500d.md`): with the app's 5-position limit the symbols first in the file order win the slots at 10:15, so a few symbols (ADANIENT, BAJFINANCE, AXISBANK) decided the result; with every symbol trading on its own (MAXPOS=99) VWAP alone with the same-day exit gives +150 Rs per trade gross (44,935 trades, 17 of 17 quarters, both halves equal, 24 of 34 symbols; Nifty +247, Bank Nifty +169), +50 with a 1% round-trip spread, -50 with 2%. Break-even spread is about 1.5% of the premium. All other reports keep the 5-slot limit, so treat their symbol-level detail with that bias in mind.
- **Last 100 days, every strategy on each scan-list stock and combinations** (`ONLY=... LAST_DAYS=100 CUTFRAC=0.5 MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs watchlist`, `reports/watchlist_last100d_backtest.md`): VWAP the only strategy positive overall (+72 net); volume-confirmed trend combinations looked best (+160 to +241). **They did not hold on 4 years / 34 symbols** (`MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs volume-combos`, `reports/volume_combinations_4y_slots99.md`): every one lost 65-114 Rs per trade after a 1% spread; VWAP alone stayed the only positive rule (+53). A short window picks luck: the best cells were inside the range random directions produce.
  Longer run: `node tools/pull_angel.mjs 1500` (about 4 years, set `SYMS=...` for other symbols) then `DATA=1500d node tools/bt_strategies.mjs smc-four` -> `reports/smc_four_strategy_report_1500d.md` (34 symbols, Oct 2022 - Nov 2026). Significance is tested against a coin flip on the SAME entry bars (rules with 100+ trades only).

Support / resistance (frontend/js/sr.js, ported to backend/strategy_vote.py, parity-tested on every bar): previous day high/low/close and swing levels; breakout, break-and-retest and rejection setups. It is shown in the strategy check and as chart lines but has weight 0 because the backtest found it does not help the vote.


## Outcome log (backend/outcomes.py)
Every BUY CE / BUY PE call the scanner makes is stored in `signal_outcomes` (traded or not, with the vote snapshot, ATR, ADX). Once the trading day is over
the resolver scores it on the underlying: +1 ATR before -1 ATR = worked / reversed / neither, plus the 1-hour and to-close moves. For positions the auto-trader
opens, the real option premium path (entry, peak, low, exit) is kept from the SL/TP watcher. The scan loop records calls even when auto-trading is off.
`GET /api/outcomes/summary` and `/recent`; Paper page shows a per-symbol table. Suggestions (alert-only / keep) need 50+ decided calls and are advice only; the app never
changes settings by itself. The Live nav button is hidden (the page and #/live still exist for the broker redirect).

## Rules from the paper-trade review (13 Nov 2026)
- Sizing: `premium_per_trade` (default Rs 15,000) buys as many whole lots as fit, at least one; a symbol's own lots still win.
- Nifty is INTRADAY like the stocks; `nifty_max_per_day` 3; `sl_cooldown_min` 60 blocks re-entry on an underlying after its stop-loss.
- The paper watcher does nothing outside 09:15-15:30 IST (no stop/target/fill on post-close prices).
- `history.entry_time` is kept; the CSV has entry time and minutes held.
- News vote: the stock's own Google News headlines from the last 24 hours only (`symbol_only=True`), whole-word keyword
  matching shared by `autotrader.news_label` and `frontend/js/news.js` (tests in both). The news label is stored in the outcome log.
- NSE event calendar (`nse_client.get_event_calendar`, cached 6h): no auto entry on a stock's board-meeting / results day.


## Login and Profile (backend/auth.py, account.py, crypto.py, ai_providers.py; frontend js/auth.js, profile.js, strategy-prefs.js)
- **Owner login.** The first account to register becomes the owner; later sign-ups are refused unless the owner opens them (Profile > Account). Passwords: scrypt. Sessions: random token in an
  httpOnly SameSite=Lax cookie (Secure behind https), only its SHA-256 stored, 14-day sliding expiry; logout and a password change revoke sessions. Login is rate-limited (5 bad tries per
  email / 20 per IP per 15 minutes). Lost password: `python auth.py reset-password you@example.com` in `backend/`.
- **Enforcement.** One middleware (`require_login` in main.py) answers 401 for every `/api/*` route except `/api/health`, `/api/auth/status|login|register` and the broker OAuth callback.
  State-changing calls also need the `X-Requested-With: ryugan` header and an Origin of this site (CSRF). `/ws/prices` checks the cookie itself and closes with 1008. A test walks every
  route and fails if a new `/api` route is neither listed public nor protected. `AUTH_REQUIRED=0` switches login off (tests set it in `tests/conftest.py`).
- **Frontend.** `auth.js` is imported first: it wraps `window.fetch` (adds the cookie and header to same-site `/api` calls, shows the login screen on a 401), so no other module changed.
  The app only starts after `requireLogin()` resolves.
- **Profile settings** live in `app_settings` under `profile.*`: `signups_open`, `strategies_enabled`, `live_allowed`, `ai_provider`, `ai_models`. Strategy toggles: `strategy_vote.evaluate(..., disable=ids)` and
  `strategies.js evaluate({disable})` leave those ids out of the vote (parity-tested); the auto-trader reads the list from `Deps.disabled_strategies` on every scan, the dashboard, chart and scanner pass
  `getDisabled()`. The toggle list is refused unless the remaining weights can still reach a call (sum >= 3). `live_allowed` (default off, needs the account password to switch on) is the real
  gate on `/api/live/enable`; the Live page and its menu button appear only when it is on.
- **Defaults (14 Nov 2026, from the backtests above):** only **VWAP** switched on, call rule `all` (with one strategy that is just VWAP; confidence 95%), ADX >= 20, same-day (INTRADAY) exit for every underlying,
  entries from **11:30** to 14:30 IST, **Nifty 50 and Bank Nifty traded automatically, stocks alert-only** (`auto_stocks` false; a per-stock tick in Settings or Auto-trade stocks overrides). The Nifty agreement rule
  for stocks means the same side when few strategies are on (`nifty_need`). `strategy_vote.evaluate(rule=...)` / `strategies.js evaluate({callRule})` are parity-tested; the other rule is `score` (weighted score of +-3).
  Profile > Strategies > Back to default restores the VWAP-only set. Expect many more calls than the earlier four-strategy default, and judge it by the Outcome log, not the backtest.
- **AI keys.** Anthropic, OpenAI or Gemini keys are encrypted with `APP_SECRET_KEY` (Fernet) in `ai_keys`, shown only as the last 4 characters, never returned. `/api/ai/chat` uses the active provider's key
  (Anthropic falls back to `ANTHROPIC_API_KEY` in `.env`). A provider's own 401 is reported as 502 so the browser never mistakes it for a lost login.
- **Env:** `APP_SECRET_KEY` (required to save AI keys), `AUTH_REQUIRED` (default 1), `OWNER_EMAIL` (optional: only this address may create the owner account). In production nginx basic auth still sits in front.

## Supply and demand zones: tried and removed (14 Nov 2026)
A base-then-departure zone strategy (fresh zone, first touch, rejecting candle) was built, parity-tested and charted, then removed: over 4 years and 34 symbols it fired 630 times and averaged -224 Rs per trade with the same-day exit
(random -31), worse than a coin flip on the same bars. The result is kept in `reports/default_settings_backtest_sdz_slots99_1500d.md`. The code was removed before it was ever committed, so it is not in git history; the rules are described above if it is ever worth rebuilding.

## Techno-Funda screener (backend/screener*.py, delivery.py; frontend js/screener.js, screener-utils.js)
Built from `techno_funda_trading_app_stock_selection_blueprint.md`: fundamentals choose what to trade, technicals choose when. Universe = NSE F&O stocks (about 218). A nightly job (`screener_loop`, 18:30 IST weekdays; "Run now" on the page) runs: NSE files and Angel daily candles -> hygiene gate -> fundamental gate/score -> technical gate/score -> 0-100 score -> trade setups -> follow-up. Result stored in `screener_runs` (last 7 kept).

**Modules.** `screener_tech.py` (pure: EMA/ATR/RSI, RS rating by percentile of 3m/6m excess return over the Nifty, technical gate and score, breakout and pullback setups, position sizing, trade lifecycle `advance`, shared with the backtest), `screener_fund.py` (Yahoo statements through yfinance, metrics, gate and score), `screener_data.py` (NSE bhavcopy with delivery %, ASM/GSM, F&O ban list, Nifty-500 industry map; every fetch degrades to "missing"), `screener.py` (tables `daily_candles`, `fundamentals`, `screener_runs`; `build_rows` pipeline; endpoints under `/api/screener`; nightly loop; follow-up), `delivery.py` (delivery paper trades).

**What is and is not scored.** Yahoo has no promoter pledge, bank NPA, capital adequacy or NIM: those rules are shown as "no data source" and left out; the fundamental half (50 points) is scaled over the points that exist and `coverage` says how much could be checked. A stock under 60% coverage, or whose latest annual statement is older than 16 months, cannot enter the feed. Promoter holding is Yahoo's `heldPercentInsiders` (a proxy). ROCE = EBIT / (total assets - current liabilities). Setups whose stop is more than `max_stop_pct` (default 8%) below the entry are dropped (the blueprint's breakout stop can sit 15-20% away after a wide breakout candle; the backtest ran without this cap). The feed needs: hygiene ok (turnover, market cap, not ASM/GSM/ban) AND technical gate AND fundamental gate AND score >= 75.
**Fundamentals refresh.** Weekly per stock: each nightly run re-fetches the 30 stalest rows (about a week's turnover); "Refresh fundamentals" does all, paced 2 s per stock with 10/30/60 s back-off on Yahoo's 429. `yfinance` is unofficial and personal-use only; `fetch_fundamentals` is the single place to swap the source.
**Backtest (`tools/bt_screener.py`, `reports/screener_technical_gate_backtest.md`).** The technical gate alone on 4 years of daily data: +0.09 R per trade net of 0.25% costs, 46% win rate, no statistically distinguishable edge (p about 0.17-0.20 against random and gate-only controls), survivorship bias from today's F&O list. The fundamental half cannot be backtested (no point-in-time data). The page says so.

**Delivery paper trades (`delivery.py`).** "Paper trade" on a row (or optional nightly auto mode, off by default, max 5 positions) queues a pending CNC order: buy-stop for a breakout, limit for a pullback, valid for the next session only. `positions` gained `t1`, `stage` (OPEN, T1_DONE, TRAIL), `setup`; `orders` gained `source`, `t1`, `setup`; `history` gained `product`. CNC margin is the full amount (no leverage). Lifecycle in the paper watcher (only for `source='delivery'`; the options auto-trader's rules are untouched): T1 sells half and moves the stop to the entry; each night the stop is raised to the 20-day EMA, never lowered; T2 or the stop closes the rest. Charges stay the flat Rs 20 per leg (no STT estimate yet); fills use the polled price, so no intraday high/low and no overnight gap model beyond the next poll.
**Intraday feed (off by default).** After each run the auto-trader's scan list becomes Nifty 50 + Bank Nifty + the top N screened stocks (cap 60). The list in use before is saved once under `screener.prev_universe`; "Restore my scan list" puts it back. Screened stocks get calls and alerts; automatic orders stay on the indices unless "Auto-trade stocks" is on.
**Telegram.** Kind `screener`: one nightly message with the count and top five setups.
