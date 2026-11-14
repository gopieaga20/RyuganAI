# Candidate default settings, with and without the same-day exit

Generated 2026-11-14 by `DATA=1500d node tools/bt_strategies.mjs default-test`. 34 symbols, 2022-10-10 to 2026-11-13, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 30 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TODAY'S DEFAULT: Structure + FVG + SMC + VWAP, all four agree | 36 | 33 | 76 | 33 | **119** | 1.27 | 48% | 79 / 171 | - | - | - | 7 of 15 | -4.3 |
| CANDIDATE, entries only from 11:30 (first hour skipped) | 220143 | 4835 | -220 | 6691 | **34** | 1.05 | 50% | -22 / 125 | -53 | 0.000 | 0.00 | 12 of 17 | 1.1 |
| Structure alone | 432984 | 5932 | -200 | 7954 | **27** | 1.03 | 50% | 23 / 34 | -62 | 0.000 | 0.00 | 10 of 17 | 0.2 |
| CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1) | 298471 | 5566 | -156 | 7686 | **23** | 1.03 | 50% | 17 / 32 | -51 | 0.001 | 0.03 | 10 of 17 | 1.0 |
| Structure + VWAP agree | 298471 | 5566 | -156 | 7686 | **23** | 1.03 | 50% | 17 / 32 | -73 | 0.000 | 0.00 | 10 of 17 | 1.0 |
| Structure + VWAP, weighted score >= 3 (weights 2, 1) | 298471 | 5566 | -156 | 7686 | **23** | 1.03 | 50% | 17 / 32 | -59 | 0.000 | 0.01 | 10 of 17 | 1.0 |
| CANDIDATE, entries only from 13:00 | 121292 | 4020 | -288 | 5733 | **17** | 1.03 | 49% | 18 / 15 | -46 | 0.001 | 0.03 | 8 of 17 | 0.8 |
| Structure + FVG + VWAP (score >= 3) + EMA trend agrees | 230961 | 5400 | -248 | 7600 | **-1** | 1.00 | 50% | -2 / 1 | -59 | 0.007 | 0.20 | 5 of 17 | 0.9 |
| Structure + FVG + VWAP (score >= 3) + volume push agrees | 19675 | 4788 | -353 | 6807 | **-2** | 1.00 | 49% | 6 / -15 | -51 | 0.017 | 0.52 | 8 of 17 | 3.0 |
| Random direction (yardstick) | 61626 | 4798 | -404 | 7047 | **-28** | 0.97 | 49% | -34 / -18 | -72 | 0.029 | 0.86 | 6 of 17 | 0.4 |
| Structure + FVG + VWAP, all three agree | 24035 | 4504 | -328 | 6558 | **-32** | 0.96 | 49% | -38 / -23 | -48 | 0.243 | 1.00 | 5 of 17 | 0.8 |
| CANDIDATE, entries only before 11:30 (the mirror check) | 94417 | 4130 | -291 | 5756 | **-53** | 0.94 | 48% | -44 / -67 | -44 | 0.625 | 1.00 | 3 of 17 | 1.1 |
| Structure + FVG + VWAP (score >= 3) + RSI agrees | 167830 | 4990 | -259 | 7183 | **-56** | 0.93 | 49% | -62 / -46 | -84 | 0.109 | 1.00 | 4 of 17 | 0.6 |
| Earlier live vote: six strategies + SMC (weight 2), score >= 7 | 18881 | 4457 | -389 | 6427 | **-57** | 0.93 | 48% | -81 / -20 | -53 | 0.572 | 1.00 | 6 of 17 | 0.2 |
| Structure + FVG retest agree | 29877 | 4534 | -381 | 6667 | **-59** | 0.93 | 48% | -86 / -18 | -68 | 0.357 | 1.00 | 6 of 17 | 0.5 |

## What the numbers say

- Random direction, same-day exit: **-28 Rs per trade** (hold: -404). This is what a rule without skill costs here.
- The candidate default (Structure + FVG + VWAP, score >= 3): **23 Rs per trade with the same-day exit** vs -156 when held to stop or target, over 7686 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1); CANDIDATE, entries only from 13:00; Structure + VWAP agree; Structure + VWAP, weighted score >= 3 (weights 2, 1); Structure alone**.
- How much the same-day exit helps every rule on average: 248 Rs per trade.

## The candidate in detail (same-day exit)

### CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1)

- By year: 2022: 392 trades, -13 Rs (win 49%) | 2023: 1795 trades, -17 Rs (win 49%) | 2024: 2093 trades, 52 Rs (win 50%) | 2025: 1752 trades, -13 Rs (win 49%) | 2026: 1654 trades, 76 Rs (win 52%)
- Original symbols: 2020 trades, 6 Rs (win 50%) | new symbols: 5666 trades, 29 Rs (win 50%)
- Calls vs puts: BUY CE 3827 trades, 14 Rs (win 49%) | BUY PE 3859 trades, 31 Rs (win 51%)
- Indices vs stocks: 3 trades (too few) | 7683 trades, 24 Rs (win 50%)
- Time of day: 10:15-11:30 5462 trades, -66 Rs (win 48%) | 11:30-13:00 946 trades, 173 Rs (win 53%) | 13:00-14:30 1278 trades, 291 Rs (win 55%)
- Time of day, first 60% of the period: 10:15-11:30 3319 trades, -50 Rs (win 48%) | 11:30-14:30 1451 trades, 170 Rs (win 53%)
- Time of day, last 40% of the period: 10:15-11:30 2143 trades, -92 Rs (win 48%) | 11:30-14:30 773 trades, 374 Rs (win 58%)
- Entries from 11:30 by year: 2022: 97 trades, 451 Rs (win 61%) | 2023: 466 trades, 350 Rs (win 56%) | 2024: 716 trades, 11 Rs (win 49%) | 2025: 446 trades, 232 Rs (win 54%) | 2026: 499 trades, 437 Rs (win 60%)
- Symbols with 30+ trades: 19; profitable: 8. Best: ITC 575 (58), ADANIENT 366 (1183), JSWSTEEL 119 (55), BAJFINANCE 109 (682). Worst: LT -397 (35), HINDALCO -281 (245), HCLTECH -244 (318).

### Structure alone

- By year: 2022: 417 trades, -137 Rs (win 48%) | 2023: 1868 trades, 1 Rs (win 49%) | 2024: 2148 trades, 86 Rs (win 51%) | 2025: 1819 trades, 20 Rs (win 50%) | 2026: 1702 trades, 31 Rs (win 50%)
- Original symbols: 1901 trades, -11 Rs (win 49%) | new symbols: 6053 trades, 39 Rs (win 50%)
- Calls vs puts: BUY CE 4022 trades, 30 Rs (win 50%) | BUY PE 3932 trades, 24 Rs (win 51%)
- Indices vs stocks: 4 trades (too few) | 7950 trades, 28 Rs (win 50%)
- Time of day: 10:15-11:30 5504 trades, -41 Rs (win 49%) | 11:30-13:00 1052 trades, 56 Rs (win 51%) | 13:00-14:30 1398 trades, 276 Rs (win 56%)
- Time of day, first 60% of the period: 10:15-11:30 3356 trades, -29 Rs (win 49%) | 11:30-14:30 1587 trades, 133 Rs (win 53%)
- Time of day, last 40% of the period: 10:15-11:30 2148 trades, -60 Rs (win 49%) | 11:30-14:30 863 trades, 271 Rs (win 55%)
- Entries from 11:30 by year: 2022: 127 trades, 403 Rs (win 57%) | 2023: 514 trades, 223 Rs (win 55%) | 2024: 762 trades, 67 Rs (win 53%) | 2025: 488 trades, 208 Rs (win 54%) | 2026: 559 trades, 226 Rs (win 54%)
- Symbols with 30+ trades: 12; profitable: 6. Best: HINDALCO 742 (32), COALINDIA 240 (332), ADANIENT 170 (1662), AXISBANK 47 (1073). Worst: DRREDDY -345 (145), HCLTECH -223 (80), CIPLA -163 (494).

### Structure + VWAP agree

- By year: 2022: 392 trades, -13 Rs (win 49%) | 2023: 1795 trades, -17 Rs (win 49%) | 2024: 2093 trades, 52 Rs (win 50%) | 2025: 1752 trades, -13 Rs (win 49%) | 2026: 1654 trades, 76 Rs (win 52%)
- Original symbols: 2020 trades, 6 Rs (win 50%) | new symbols: 5666 trades, 29 Rs (win 50%)
- Calls vs puts: BUY CE 3827 trades, 14 Rs (win 49%) | BUY PE 3859 trades, 31 Rs (win 51%)
- Indices vs stocks: 3 trades (too few) | 7683 trades, 24 Rs (win 50%)
- Time of day: 10:15-11:30 5462 trades, -66 Rs (win 48%) | 11:30-13:00 946 trades, 173 Rs (win 53%) | 13:00-14:30 1278 trades, 291 Rs (win 55%)
- Time of day, first 60% of the period: 10:15-11:30 3319 trades, -50 Rs (win 48%) | 11:30-14:30 1451 trades, 170 Rs (win 53%)
- Time of day, last 40% of the period: 10:15-11:30 2143 trades, -92 Rs (win 48%) | 11:30-14:30 773 trades, 374 Rs (win 58%)
- Entries from 11:30 by year: 2022: 97 trades, 451 Rs (win 61%) | 2023: 466 trades, 350 Rs (win 56%) | 2024: 716 trades, 11 Rs (win 49%) | 2025: 446 trades, 232 Rs (win 54%) | 2026: 499 trades, 437 Rs (win 60%)
- Symbols with 30+ trades: 19; profitable: 8. Best: ITC 575 (58), ADANIENT 366 (1183), JSWSTEEL 119 (55), BAJFINANCE 109 (682). Worst: LT -397 (35), HINDALCO -281 (245), HCLTECH -244 (318).

### CANDIDATE, entries only from 11:30 (first hour skipped)

- By year: 2022: 354 trades, 28 Rs (win 47%) | 2023: 1587 trades, 21 Rs (win 50%) | 2024: 1767 trades, -62 Rs (win 47%) | 2025: 1547 trades, 17 Rs (win 50%) | 2026: 1436 trades, 187 Rs (win 53%)
- Original symbols: 1840 trades, -17 Rs (win 49%) | new symbols: 4851 trades, 53 Rs (win 50%)
- Calls vs puts: BUY CE 3363 trades, 28 Rs (win 49%) | BUY PE 3328 trades, 39 Rs (win 50%)
- Indices vs stocks: 6 trades (too few) | 6685 trades, 33 Rs (win 50%)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 5584 trades, -16 Rs (win 49%) | 13:00-14:30 1107 trades, 286 Rs (win 55%)
- Time of day, first 60% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 4139 trades, -22 Rs (win 48%)
- Time of day, last 40% of the period: 10:15-11:30 0 trades (too few) | 11:30-14:30 2552 trades, 125 Rs (win 52%)
- Entries from 11:30 by year: 2022: 354 trades, 28 Rs (win 47%) | 2023: 1587 trades, 21 Rs (win 50%) | 2024: 1767 trades, -62 Rs (win 47%) | 2025: 1547 trades, 17 Rs (win 50%) | 2026: 1436 trades, 187 Rs (win 53%)
- Symbols with 30+ trades: 19; profitable: 7. Best: ADANIENT 277 (943), JSWSTEEL 207 (42), BAJFINANCE 127 (634), HDFCBANK 119 (269). Worst: KOTAKBANK -280 (43), INFY -161 (101), HINDALCO -116 (180).

