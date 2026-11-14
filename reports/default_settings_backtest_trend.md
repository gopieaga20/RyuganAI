# Structure + VWAP + EMA trend, with and without the same-day exit

Generated 2026-11-14 by `SET=trend DATA=730d node tools/bt_strategies.mjs default-test`. 14 symbols, 2024-11-06 to 2026-11-02, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 28 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VWAP alone | 88173 | 2124 | -228 | 3253 | **36** | 1.05 | 50% | -32 / 132 | -63 | 0.001 | 0.03 | 4 of 9 | 0.9 |
| Structure + VWAP agree (the previous best) | 61633 | 2137 | -302 | 3298 | **11** | 1.01 | 50% | -11 / 41 | -49 | 0.036 | 1.00 | 5 of 9 | 0.6 |
| Structure + VWAP + EMA trend, entries from 11:30 | 35154 | 1910 | -434 | 2915 | **-35** | 0.95 | 49% | -39 / -28 | -39 | 0.444 | 1.00 | 4 of 9 | 0.0 |
| Structure + VWAP + EMA trend, all three agree | 47513 | 2137 | -383 | 3275 | **-42** | 0.95 | 50% | -51 / -31 | -60 | 0.299 | 1.00 | 2 of 9 | 0.0 |
| Structure + VWAP + EMA trend, weighted score >= 4 | 47513 | 2137 | -383 | 3275 | **-42** | 0.95 | 50% | -51 / -31 | -59 | 0.306 | 1.00 | 2 of 9 | 0.0 |
| Structure + VWAP + EMA trend, weighted score >= 5 (same as all three) | 47513 | 2137 | -383 | 3275 | **-42** | 0.95 | 50% | -51 / -31 | -57 | 0.333 | 1.00 | 2 of 9 | 0.0 |
| Structure alone | 88173 | 2114 | -391 | 3254 | **-45** | 0.94 | 50% | -36 / -57 | -68 | 0.241 | 1.00 | 3 of 9 | -0.0 |
| Random direction (yardstick) | 12544 | 2190 | -348 | 3268 | **-58** | 0.93 | 48% | -103 / 4 | -78 | 0.274 | 1.00 | 1 of 9 | -0.2 |
| Structure + VWAP + EMA trend, entries before 11:30 (mirror check) | 14939 | 1715 | -379 | 2512 | **-60** | 0.93 | 50% | -57 / -65 | -74 | 0.360 | 1.00 | 2 of 9 | -0.1 |
| Structure + VWAP + EMA trend, weighted score >= 3 (weights 2, 1, 2) | 74998 | 2091 | -385 | 3262 | **-61** | 0.92 | 49% | -49 / -78 | -83 | 0.254 | 1.00 | 2 of 9 | -0.2 |
| VWAP + EMA trend agree | 51141 | 2154 | -405 | 3278 | **-64** | 0.92 | 50% | -77 / -46 | -71 | 0.416 | 1.00 | 1 of 9 | -0.0 |
| Structure + VWAP + EMA trend, entries from 13:00 | 19292 | 1654 | -521 | 2517 | **-76** | 0.86 | 46% | -93 / -51 | -34 | 0.937 | 1.00 | 3 of 9 | -0.6 |
| EMA trend alone | 72454 | 2110 | -485 | 3233 | **-101** | 0.88 | 49% | -91 / -116 | -66 | 0.855 | 1.00 | 0 of 9 | -0.8 |
| Structure + EMA trend agree | 64852 | 2145 | -507 | 3278 | **-108** | 0.87 | 49% | -79 / -148 | -37 | 0.984 | 1.00 | 1 of 9 | -0.6 |

## What the numbers say

- Random direction, same-day exit: **-58 Rs per trade** (hold: -348). This is what a rule without skill costs here.
- The focus rule (Structure + VWAP + EMA trend, all three agree): **-42 Rs per trade with the same-day exit** vs -383 when held to stop or target, over 3275 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **none**.
- How much the same-day exit helps every rule on average: 346 Rs per trade.

## The candidate in detail (same-day exit)

### VWAP alone

- By year: 2024: 261 trades, -49 Rs (win 48%) | 2025: 1567 trades, -41 Rs (win 48%) | 2026: 1425 trades, 137 Rs (win 53%)
- Original symbols: 3253 trades, 36 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1602 trades, 11 Rs (win 49%) | BUY PE 1651 trades, 61 Rs (win 51%)
- Indices vs stocks: 20 trades, -1012 Rs (win 30%) | 3233 trades, 43 Rs (win 50%)
- Time of day: 10:15-11:30 2522 trades, -70 Rs (win 48%) | 11:30-13:00 324 trades, 472 Rs (win 59%) | 13:00-14:30 407 trades, 349 Rs (win 57%)
- Time of day, first 60% of the period: 10:15-11:30 1515 trades, -122 Rs (win 46%) | 11:30-14:30 377 trades, 329 Rs (win 56%)
- Time of day, last 40% of the period: 10:15-11:30 1007 trades, 8 Rs (win 51%) | 11:30-14:30 354 trades, 483 Rs (win 60%)
- Entries from 11:30 by year: 2024: 71 trades, 583 Rs (win 66%) | 2025: 297 trades, 265 Rs (win 54%) | 2026: 363 trades, 482 Rs (win 60%)
- Symbols with 30+ trades: 11; profitable: 7. Best: BHARTIARTL 159 (517), TATASTEEL 134 (35), AXISBANK 92 (503), ICICIBANK 73 (441). Worst: SBIN -152 (33), LT -107 (194), RELIANCE -69 (59).

### Structure + VWAP + EMA trend, all three agree

- By year: 2024: 253 trades, -180 Rs (win 47%) | 2025: 1570 trades, -49 Rs (win 48%) | 2026: 1452 trades, -11 Rs (win 52%)
- Original symbols: 3275 trades, -42 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1608 trades, -121 Rs (win 47%) | BUY PE 1667 trades, 34 Rs (win 52%)
- Indices vs stocks: 235 trades, -261 Rs (win 46%) | 3040 trades, -25 Rs (win 50%)
- Time of day: 10:15-11:30 2343 trades, -68 Rs (win 50%) | 11:30-13:00 459 trades, 56 Rs (win 52%) | 13:00-14:30 473 trades, -9 Rs (win 49%)
- Time of day, first 60% of the period: 10:15-11:30 1390 trades, -64 Rs (win 48%) | 11:30-14:30 502 trades, -14 Rs (win 48%)
- Time of day, last 40% of the period: 10:15-11:30 953 trades, -75 Rs (win 51%) | 11:30-14:30 430 trades, 67 Rs (win 53%)
- Entries from 11:30 by year: 2024: 89 trades, 36 Rs (win 51%) | 2025: 399 trades, -40 Rs (win 48%) | 2026: 444 trades, 77 Rs (win 53%)
- Symbols with 30+ trades: 14; profitable: 6. Best: RELIANCE 289 (223), NSEI 87 (105), BHARTIARTL 58 (336), ITC 42 (252). Worst: NSEBANK -541 (130), SBIN -268 (186), TATASTEEL -152 (181).

### Structure + VWAP agree (the previous best)

- By year: 2024: 260 trades, -35 Rs (win 49%) | 2025: 1588 trades, -17 Rs (win 49%) | 2026: 1450 trades, 49 Rs (win 52%)
- Original symbols: 3298 trades, 11 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1617 trades, -23 Rs (win 49%) | BUY PE 1681 trades, 43 Rs (win 52%)
- Indices vs stocks: 103 trades, -123 Rs (win 47%) | 3195 trades, 15 Rs (win 51%)
- Time of day: 10:15-11:30 2500 trades, -48 Rs (win 49%) | 11:30-13:00 350 trades, 211 Rs (win 56%) | 13:00-14:30 448 trades, 181 Rs (win 53%)
- Time of day, first 60% of the period: 10:15-11:30 1497 trades, -47 Rs (win 48%) | 11:30-14:30 421 trades, 114 Rs (win 52%)
- Time of day, last 40% of the period: 10:15-11:30 1003 trades, -50 Rs (win 51%) | 11:30-14:30 377 trades, 284 Rs (win 57%)
- Entries from 11:30 by year: 2024: 77 trades, 164 Rs (win 53%) | 2025: 329 trades, 105 Rs (win 52%) | 2026: 392 trades, 275 Rs (win 57%)
- Symbols with 30+ trades: 14; profitable: 7. Best: RELIANCE 316 (208), TCS 270 (102), AXISBANK 112 (372), BHARTIARTL 80 (394). Worst: SBIN -255 (154), NSEI -176 (45), INFY -167 (352).

### Structure + VWAP + EMA trend, entries from 13:00

- By year: 2024: 194 trades, 33 Rs (win 47%) | 2025: 1249 trades, -121 Rs (win 44%) | 2026: 1074 trades, -43 Rs (win 49%)
- Original symbols: 2517 trades, -76 Rs (win 46%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1243 trades, -98 Rs (win 45%) | BUY PE 1274 trades, -55 Rs (win 48%)
- Indices vs stocks: 155 trades, -264 Rs (win 46%) | 2362 trades, -64 Rs (win 46%)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 0 trades (too few) | 13:00-14:30 2517 trades, -76 Rs (win 46%)
- Time of day, first 60% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 1498 trades, -93 Rs (win 45%)
- Time of day, last 40% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 1019 trades, -51 Rs (win 49%)
- Entries from 11:30 by year: 2024: 194 trades, 33 Rs (win 47%) | 2025: 1249 trades, -121 Rs (win 44%) | 2026: 1074 trades, -43 Rs (win 49%)
- Symbols with 30+ trades: 14; profitable: 2. Best: RELIANCE 136 (182), HDFCBANK 29 (238), LT -35 (214), AXISBANK -36 (223). Worst: NSEBANK -421 (81), INFY -286 (239), TATASTEEL -156 (135).

