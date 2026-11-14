# Structure + VWAP + EMA trend, with and without the same-day exit

Generated 2026-11-14 by `SET=trend DATA=1500d node tools/bt_strategies.mjs default-test`. 34 symbols, 2022-10-10 to 2026-11-13, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 28 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VWAP alone | 432983 | 5938 | 2 | 7959 | **166** | 1.21 | 53% | 149 / 194 | -47 | 0.000 | 0.00 | 16 of 17 | 1.1 |
| Structure alone | 432984 | 5932 | -200 | 7954 | **27** | 1.03 | 50% | 23 / 34 | -53 | 0.000 | 0.01 | 10 of 17 | 0.2 |
| Structure + VWAP agree (the previous best) | 298471 | 5566 | -156 | 7686 | **23** | 1.03 | 50% | 17 / 32 | -44 | 0.002 | 0.07 | 10 of 17 | 1.0 |
| Structure + VWAP + EMA trend, weighted score >= 3 (weights 2, 1, 2) | 367051 | 5727 | -201 | 7842 | **20** | 1.02 | 50% | 19 / 23 | -73 | 0.000 | 0.00 | 10 of 17 | 0.3 |
| Structure + VWAP + EMA trend, entries from 11:30 | 172319 | 4717 | -274 | 6596 | **20** | 1.03 | 49% | -2 / 56 | -51 | 0.001 | 0.03 | 9 of 17 | 0.8 |
| VWAP + EMA trend agree | 249920 | 5410 | -253 | 7594 | **11** | 1.01 | 50% | 20 / -3 | -48 | 0.006 | 0.17 | 9 of 17 | 0.8 |
| Structure + VWAP + EMA trend, all three agree | 230961 | 5400 | -248 | 7600 | **-1** | 1.00 | 50% | -2 / 1 | -62 | 0.004 | 0.12 | 5 of 17 | 0.9 |
| Structure + VWAP + EMA trend, weighted score >= 4 | 230962 | 5400 | -248 | 7600 | **-1** | 1.00 | 50% | -2 / 1 | -63 | 0.004 | 0.11 | 5 of 17 | 0.9 |
| Structure + VWAP + EMA trend, weighted score >= 5 (same as all three) | 230961 | 5400 | -248 | 7600 | **-1** | 1.00 | 50% | -2 / 1 | -56 | 0.009 | 0.25 | 5 of 17 | 0.9 |
| EMA trend alone | 355968 | 5693 | -276 | 7727 | **-8** | 0.99 | 49% | 9 / -35 | -72 | 0.003 | 0.09 | 8 of 17 | 0.0 |
| Structure + VWAP + EMA trend, entries from 13:00 | 94962 | 3973 | -359 | 5676 | **-10** | 0.98 | 48% | -8 / -12 | -47 | 0.029 | 0.83 | 8 of 17 | 0.4 |
| Structure + EMA trend agree | 318275 | 5604 | -281 | 7719 | **-15** | 0.98 | 49% | -14 / -16 | -70 | 0.009 | 0.27 | 10 of 17 | 0.1 |
| Random direction (yardstick) | 61626 | 4798 | -404 | 7047 | **-28** | 0.97 | 49% | -34 / -18 | -63 | 0.066 | 1.00 | 6 of 17 | 0.4 |
| Structure + VWAP + EMA trend, entries before 11:30 (mirror check) | 71160 | 4029 | -337 | 5719 | **-53** | 0.94 | 49% | -28 / -91 | -62 | 0.368 | 1.00 | 5 of 17 | 1.3 |

## What the numbers say

- Random direction, same-day exit: **-28 Rs per trade** (hold: -404). This is what a rule without skill costs here.
- The focus rule (Structure + VWAP + EMA trend, all three agree): **-1 Rs per trade with the same-day exit** vs -248 when held to stop or target, over 7600 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **Structure + VWAP + EMA trend, weighted score >= 3 (weights 2, 1, 2); VWAP alone; Structure + VWAP agree (the previous best); Structure alone**.
- How much the same-day exit helps every rule on average: 260 Rs per trade.

## The candidate in detail (same-day exit)

### VWAP alone

- By year: 2022: 414 trades, 212 Rs (win 52%) | 2023: 1875 trades, 179 Rs (win 53%) | 2024: 2147 trades, 137 Rs (win 53%) | 2025: 1822 trades, 65 Rs (win 51%) | 2026: 1701 trades, 287 Rs (win 56%)
- Original symbols: 1897 trades, 74 Rs (win 52%) | new symbols: 6062 trades, 195 Rs (win 53%)
- Calls vs puts: BUY CE 3723 trades, 186 Rs (win 53%) | BUY PE 4236 trades, 149 Rs (win 53%)
- Indices vs stocks: 4 trades (too few) | 7955 trades, 167 Rs (win 53%)
- Time of day: 10:15-11:30 5504 trades, 23 Rs (win 50%) | 11:30-13:00 1054 trades, 488 Rs (win 60%) | 13:00-14:30 1401 trades, 489 Rs (win 60%)
- Time of day, first 60% of the period: 10:15-11:30 3355 trades, 30 Rs (win 50%) | 11:30-14:30 1592 trades, 401 Rs (win 58%)
- Time of day, last 40% of the period: 10:15-11:30 2149 trades, 11 Rs (win 50%) | 11:30-14:30 863 trades, 650 Rs (win 63%)
- Entries from 11:30 by year: 2022: 124 trades, 565 Rs (win 58%) | 2023: 521 trades, 540 Rs (win 61%) | 2024: 762 trades, 302 Rs (win 56%) | 2025: 491 trades, 392 Rs (win 58%) | 2026: 557 trades, 762 Rs (win 66%)
- Symbols with 30+ trades: 12; profitable: 10. Best: ADANIENT 438 (1671), HINDALCO 375 (32), BAJFINANCE 277 (1103), COALINDIA 226 (331). Worst: DRREDDY -246 (145), CIPLA -58 (494), HCLTECH 3 (80).

### Structure + VWAP + EMA trend, all three agree

- By year: 2022: 394 trades, -78 Rs (win 46%) | 2023: 1795 trades, -21 Rs (win 49%) | 2024: 2020 trades, 30 Rs (win 50%) | 2025: 1732 trades, -49 Rs (win 48%) | 2026: 1659 trades, 52 Rs (win 52%)
- Original symbols: 2334 trades, -37 Rs (win 50%) | new symbols: 5266 trades, 15 Rs (win 49%)
- Calls vs puts: BUY CE 3931 trades, -4 Rs (win 49%) | BUY PE 3669 trades, 2 Rs (win 50%)
- Indices vs stocks: 10 trades (too few) | 7590 trades, 3 Rs (win 50%)
- Time of day: 10:15-11:30 5416 trades, -73 Rs (win 48%) | 11:30-13:00 964 trades, 163 Rs (win 52%) | 13:00-14:30 1220 trades, 188 Rs (win 54%)
- Time of day, first 60% of the period: 10:15-11:30 3288 trades, -45 Rs (win 49%) | 11:30-14:30 1408 trades, 99 Rs (win 51%)
- Time of day, last 40% of the period: 10:15-11:30 2128 trades, -115 Rs (win 48%) | 11:30-14:30 776 trades, 318 Rs (win 56%)
- Entries from 11:30 by year: 2022: 99 trades, 413 Rs (win 54%) | 2023: 475 trades, 199 Rs (win 55%) | 2024: 665 trades, -54 Rs (win 48%) | 2025: 437 trades, 169 Rs (win 51%) | 2026: 508 trades, 420 Rs (win 60%)
- Symbols with 30+ trades: 26; profitable: 11. Best: ADANIENT 410 (916), RELIANCE 404 (46), ITC 186 (145), POWERGRID 157 (54). Worst: SBIN -1137 (43), SUNPHARMA -635 (45), LT -405 (106).

### Structure + VWAP agree (the previous best)

- By year: 2022: 392 trades, -13 Rs (win 49%) | 2023: 1795 trades, -17 Rs (win 49%) | 2024: 2093 trades, 52 Rs (win 50%) | 2025: 1752 trades, -13 Rs (win 49%) | 2026: 1654 trades, 76 Rs (win 52%)
- Original symbols: 2020 trades, 6 Rs (win 50%) | new symbols: 5666 trades, 29 Rs (win 50%)
- Calls vs puts: BUY CE 3827 trades, 14 Rs (win 49%) | BUY PE 3859 trades, 31 Rs (win 51%)
- Indices vs stocks: 3 trades (too few) | 7683 trades, 24 Rs (win 50%)
- Time of day: 10:15-11:30 5462 trades, -66 Rs (win 48%) | 11:30-13:00 946 trades, 173 Rs (win 53%) | 13:00-14:30 1278 trades, 291 Rs (win 55%)
- Time of day, first 60% of the period: 10:15-11:30 3319 trades, -50 Rs (win 48%) | 11:30-14:30 1451 trades, 170 Rs (win 53%)
- Time of day, last 40% of the period: 10:15-11:30 2143 trades, -92 Rs (win 48%) | 11:30-14:30 773 trades, 374 Rs (win 58%)
- Entries from 11:30 by year: 2022: 97 trades, 451 Rs (win 61%) | 2023: 466 trades, 350 Rs (win 56%) | 2024: 716 trades, 11 Rs (win 49%) | 2025: 446 trades, 232 Rs (win 54%) | 2026: 499 trades, 437 Rs (win 60%)
- Symbols with 30+ trades: 19; profitable: 8. Best: ITC 575 (58), ADANIENT 366 (1183), JSWSTEEL 119 (55), BAJFINANCE 109 (682). Worst: LT -397 (35), HINDALCO -281 (245), HCLTECH -244 (318).

### Structure + VWAP + EMA trend, entries from 13:00

- By year: 2022: 315 trades, 60 Rs (win 50%) | 2023: 1403 trades, 23 Rs (win 49%) | 2024: 1420 trades, -40 Rs (win 48%) | 2025: 1343 trades, -43 Rs (win 48%) | 2026: 1195 trades, 8 Rs (win 47%)
- Original symbols: 1694 trades, -11 Rs (win 49%) | new symbols: 3982 trades, -9 Rs (win 48%)
- Calls vs puts: BUY CE 2933 trades, 2 Rs (win 48%) | BUY PE 2743 trades, -22 Rs (win 48%)
- Indices vs stocks: 1 trades (too few) | 5675 trades, -10 Rs (win 48%)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 0 trades (too few) | 13:00-14:30 5676 trades, -10 Rs (win 48%)
- Time of day, first 60% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 3480 trades, -8 Rs (win 49%)
- Time of day, last 40% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 2196 trades, -12 Rs (win 48%)
- Entries from 11:30 by year: 2022: 315 trades, 60 Rs (win 50%) | 2023: 1403 trades, 23 Rs (win 49%) | 2024: 1420 trades, -40 Rs (win 48%) | 2025: 1343 trades, -43 Rs (win 48%) | 2026: 1195 trades, 8 Rs (win 47%)
- Symbols with 30+ trades: 23; profitable: 11. Best: POWERGRID 412 (32), ADANIENT 245 (565), LT 59 (72), BAJFINANCE 50 (463). Worst: NTPC -265 (40), HINDUNILVR -210 (197), DRREDDY -159 (352).

