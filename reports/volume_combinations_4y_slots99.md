# Volume-confirmed combinations on 4 years of data

Generated 2026-11-14 by `MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs volume-combos`. 35 symbols, 2022-10-10 to 2026-11-13, 15-minute candles. These combinations came out best in the last-100-days watchlist test (reports/watchlist_last100d_backtest.md); this run checks them on data they were NOT picked from (everything before the last 100 days is untouched by that selection, the last 100 days are inside this period). Same-day exit (15:15), stop -30% / target +30%, ATM option scaled by each stock's volatility, 10,000 Rs premium, entries 10:15-14:30 IST, ADX >= 20, **no limit on open positions** (every symbol trades on its own), modelled option prices. The volume strategy needs volume data, so the two indices never trade here. p = against a coin flip on the same entry bars (100+ trades); adjusted p = p x 13 variants.

| Rule | Trades | Net Rs/trade, no spread | **Net, 1% spread** | Net, 2% spread | PF (1%) | Win (1%) | First 60% / last 40% (1%) | Coin flip, same bars (1%) | p | Adjusted p | Quarters profitable (1%) | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VWAP alone (the current default) | 46225 | 153 | **53** | -47 | 1.06 | 51% | 58 / 46 | -161 | 0.000 | 0.00 | 12 of 17 | 1.3 |
| VWAP + Volume push | 16465 | 35 | **-65** | -165 | 0.91 | 46% | -47 / -92 | -143 | 0.000 | 0.00 | 6 of 17 | 3.1 |
| EMA trend + Structure + Volume push | 11440 | 32 | **-68** | -168 | 0.91 | 46% | -52 / -92 | -146 | 0.000 | 0.00 | 4 of 17 | 3.6 |
| Volume push | 19474 | 29 | **-71** | -171 | 0.90 | 46% | -48 / -103 | -145 | 0.000 | 0.00 | 4 of 17 | 2.5 |
| EMA trend + Volume push | 12235 | 25 | **-75** | -175 | 0.89 | 46% | -57 / -102 | -148 | 0.000 | 0.00 | 3 of 17 | 3.2 |
| EMA trend + VWAP + Volume push | 11347 | 25 | **-75** | -175 | 0.89 | 46% | -57 / -103 | -153 | 0.000 | 0.00 | 3 of 17 | 3.5 |
| VWAP + Volume push + Support/resistance | 3734 | 6 | **-94** | -194 | 0.87 | 46% | -102 / -83 | -152 | 0.022 | 0.28 | 4 of 17 | 2.2 |
| EMA trend + VWAP + Volume push, entries from 11:30 | 8420 | 0 | **-100** | -200 | 0.84 | 45% | -84 / -124 | -127 | 0.057 | 0.74 | 4 of 17 | 2.3 |
| EMA trend + RSI + Volume push | 6234 | -2 | **-102** | -202 | 0.85 | 45% | -113 / -87 | -132 | 0.072 | 0.93 | 3 of 17 | 0.9 |
| EMA trend + Volume push, entries from 11:30 | 9097 | -4 | **-104** | -204 | 0.84 | 45% | -86 / -128 | -133 | 0.033 | 0.43 | 4 of 17 | 2.0 |
| EMA trend | 41153 | -10 | **-110** | -210 | 0.88 | 47% | -87 / -147 | -156 | 0.000 | 0.00 | 2 of 17 | 0.1 |
| EMA trend + Volume push + Support/resistance | 3345 | -14 | **-114** | -214 | 0.84 | 45% | -113 / -116 | -149 | 0.121 | 1.00 | 2 of 17 | 0.8 |
| Random direction (yardstick) | 32665 | -34 | **-134** | -234 | 0.83 | 46% | -159 / -97 | -147 | 0.102 | 1.00 | 0 of 17 | 0.4 |

## What the numbers say

- On the last-100-days test the best combination was EMA trend + Volume push + S/R at +241 per trade net. On the 4-year data: **-114** (3345 trades). EMA trend + Volume push: **-75** (12235 trades) with a 1% spread, 25 with none.
- The current default, VWAP alone: 53 net with a 1% spread over 46225 trades (the yardstick, random direction: -134).
- Rules with 100+ trades that are positive after a 1% spread AND in both halves of the period: **VWAP alone (the current default) (46225 trades, 53 Rs)**.
- Combinations that beat VWAP alone on the net average (100+ trades): **none**.

## The top combinations in detail (1% spread)

### VWAP + Volume push

- By year: 2022: 791 trades, 44 Rs (win 47%) | 2023: 3913 trades, -59 Rs (win 46%) | 2024: 3998 trades, -19 Rs (win 48%) | 2025: 4028 trades, -112 Rs (win 44%) | 2026: 3735 trades, -94 Rs (win 47%)
- Original symbols: 5657 trades, -59 Rs (win 47%) | new symbols: 10808 trades, -69 Rs (win 46%)
- Calls vs puts: BUY CE 9029 trades, -54 Rs (win 46%) | BUY PE 7436 trades, -79 Rs (win 47%)
- Time of day: 10:15-11:30 5390 trades, -84 Rs (win 47%) | 11:30-13:00 4270 trades, -25 Rs (win 47%) | 13:00-14:30 6805 trades, -75 Rs (win 45%)
- Symbols traded: 33, profitable: 6. Top five contribute 92% of the profit made by profitable symbols: MAZDOCK 118713 (542), SBIN 19044 (489), BAJFINANCE 19037 (493), BAJAJFINSV 18725 (574), HCLTECH 18509 (465). Total -1075702 Rs.

### EMA trend + Structure + Volume push

- By year: 2022: 523 trades, -89 Rs (win 44%) | 2023: 2753 trades, -51 Rs (win 46%) | 2024: 2881 trades, -31 Rs (win 48%) | 2025: 2766 trades, -103 Rs (win 44%) | 2026: 2517 trades, -85 Rs (win 48%)
- Original symbols: 3981 trades, -73 Rs (win 46%) | new symbols: 7459 trades, -65 Rs (win 46%)
- Calls vs puts: BUY CE 6306 trades, -38 Rs (win 47%) | BUY PE 5134 trades, -104 Rs (win 46%)
- Time of day: 10:15-11:30 3419 trades, -31 Rs (win 48%) | 11:30-13:00 2974 trades, -61 Rs (win 47%) | 13:00-14:30 5047 trades, -97 Rs (win 45%)
- Symbols traded: 33, profitable: 8. Top five contribute 89% of the profit made by profitable symbols: MAZDOCK 75004 (384), WIPRO 20305 (337), TATASTEEL 19715 (338), BAJFINANCE 12966 (355), BAJAJFINSV 10742 (397). Total -778514 Rs.

### Volume push

- By year: 2022: 930 trades, 12 Rs (win 47%) | 2023: 4529 trades, -68 Rs (win 46%) | 2024: 4719 trades, -20 Rs (win 48%) | 2025: 4848 trades, -100 Rs (win 44%) | 2026: 4448 trades, -114 Rs (win 46%)
- Original symbols: 6773 trades, -72 Rs (win 46%) | new symbols: 12701 trades, -71 Rs (win 46%)
- Calls vs puts: BUY CE 10628 trades, -61 Rs (win 46%) | BUY PE 8846 trades, -83 Rs (win 46%)
- Time of day: 10:15-11:30 6432 trades, -91 Rs (win 47%) | 11:30-13:00 4901 trades, -26 Rs (win 47%) | 13:00-14:30 8141 trades, -82 Rs (win 45%)
- Symbols traded: 33, profitable: 9. Top five contribute 94% of the profit made by profitable symbols: MAZDOCK 108571 (599), HINDUNILVR 29952 (598), BAJFINANCE 21913 (558), ASIANPAINT 8929 (612), SBIN 4434 (589). Total -1381681 Rs.

### VWAP alone (the current default)

- By year: 2022: 2377 trades, 76 Rs (win 51%) | 2023: 10412 trades, 36 Rs (win 51%) | 2024: 12301 trades, 89 Rs (win 52%) | 2025: 10652 trades, -19 Rs (win 49%) | 2026: 10483 trades, 97 Rs (win 52%)
- Original symbols: 20300 trades, 87 Rs (win 52%) | new symbols: 25925 trades, 27 Rs (win 51%)
- Calls vs puts: BUY CE 22612 trades, 72 Rs (win 51%) | BUY PE 23613 trades, 35 Rs (win 51%)
- Time of day: 10:15-11:30 29949 trades, -113 Rs (win 48%) | 11:30-13:00 6924 trades, 388 Rs (win 57%) | 13:00-14:30 9352 trades, 338 Rs (win 58%)
- Symbols traded: 35, profitable: 25. Top five contribute 55% of the profit made by profitable symbols: NSEI 581105 (2350), NSEBANK 527086 (3121), MAZDOCK 230362 (1290), RELIANCE 194497 (1206), ONGC 172910 (1207). Total 2457232 Rs.

