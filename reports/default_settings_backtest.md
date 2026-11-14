# Candidate default settings, with and without the same-day exit

Generated 2026-11-14 by `DATA=730d node tools/bt_strategies.mjs default-test`. 14 symbols, 2024-11-06 to 2026-11-02, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 24 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Structure + FVG + VWAP, all three agree | 5170 | 1867 | -268 | 2517 | **28** | 1.04 | 50% | 56 / -9 | -62 | 0.006 | 0.14 | 5 of 9 | 0.6 |
| CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1) | 61633 | 2137 | -302 | 3298 | **11** | 1.01 | 50% | -11 / 41 | -94 | 0.001 | 0.02 | 5 of 9 | 0.6 |
| Structure + VWAP agree | 61633 | 2137 | -302 | 3298 | **11** | 1.01 | 50% | -11 / 41 | -47 | 0.041 | 0.98 | 5 of 9 | 0.6 |
| Structure + VWAP, weighted score >= 3 (weights 2, 1) | 61633 | 2137 | -302 | 3298 | **11** | 1.01 | 50% | -11 / 41 | -56 | 0.022 | 0.52 | 5 of 9 | 0.6 |
| Structure + FVG retest agree | 6276 | 1966 | -303 | 2725 | **7** | 1.01 | 50% | 11 / 1 | -68 | 0.016 | 0.38 | 5 of 9 | 0.6 |
| Structure + FVG + VWAP (score >= 3) + volume push agrees | 3325 | 1546 | -352 | 2032 | **2** | 1.00 | 50% | -26 / 40 | -52 | 0.068 | 1.00 | 5 of 9 | 2.9 |
| Earlier live vote: six strategies + SMC (weight 2), score >= 7 | 3647 | 1591 | -384 | 2096 | **-16** | 0.98 | 48% | -35 / 10 | -60 | 0.118 | 1.00 | 4 of 9 | 0.9 |
| Structure + FVG + VWAP (score >= 3) + EMA trend agrees | 47513 | 2137 | -383 | 3275 | **-42** | 0.95 | 50% | -51 / -31 | -64 | 0.258 | 1.00 | 2 of 9 | 0.0 |
| Structure alone | 88173 | 2114 | -391 | 3254 | **-45** | 0.94 | 50% | -36 / -57 | -63 | 0.290 | 1.00 | 3 of 9 | -0.0 |
| Structure + FVG + VWAP (score >= 3) + RSI agrees | 33940 | 2154 | -343 | 3331 | **-58** | 0.93 | 49% | -73 / -36 | -72 | 0.328 | 1.00 | 2 of 9 | 0.5 |
| Random direction (yardstick) | 12544 | 2190 | -348 | 3268 | **-58** | 0.93 | 48% | -103 / 4 | -70 | 0.364 | 1.00 | 1 of 9 | -0.2 |
| TODAY'S DEFAULT: Structure + FVG + SMC + VWAP, all four agree | 8 | 8 | 734 | 8 | **-158** | 0.66 | 63% | -388 / 225 | - | - | - | 3 of 6 | -24.2 |

## What the numbers say

- Random direction, same-day exit: **-58 Rs per trade** (hold: -348). This is what a rule without skill costs here.
- The candidate default (Structure + FVG + VWAP, score >= 3): **11 Rs per trade with the same-day exit** vs -302 when held to stop or target, over 3298 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **Structure + FVG retest agree**.
- How much the same-day exit helps every rule on average: 220 Rs per trade.

## The candidate in detail (same-day exit)

### CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1)

- By year: 2024: 260 trades, -35 Rs (win 49%) | 2025: 1588 trades, -17 Rs (win 49%) | 2026: 1450 trades, 49 Rs (win 52%)
- Original symbols: 3298 trades, 11 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1617 trades, -23 Rs (win 49%) | BUY PE 1681 trades, 43 Rs (win 52%)
- Indices vs stocks: 103 trades, -123 Rs (win 47%) | 3195 trades, 15 Rs (win 51%)
- Time of day: 10:15-11:30 2500 trades, -48 Rs (win 49%) | 11:30-13:00 350 trades, 211 Rs (win 56%) | 13:00-14:30 448 trades, 181 Rs (win 53%)
- Symbols with 30+ trades: 14; profitable: 7. Best: RELIANCE 316 (208), TCS 270 (102), AXISBANK 112 (372), BHARTIARTL 80 (394). Worst: SBIN -255 (154), NSEI -176 (45), INFY -167 (352).

### Structure alone

- By year: 2024: 263 trades, -89 Rs (win 50%) | 2025: 1565 trades, -37 Rs (win 49%) | 2026: 1426 trades, -45 Rs (win 51%)
- Original symbols: 3254 trades, -45 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1639 trades, -79 Rs (win 49%) | BUY PE 1615 trades, -10 Rs (win 52%)
- Indices vs stocks: 20 trades, -523 Rs (win 45%) | 3234 trades, -42 Rs (win 50%)
- Time of day: 10:15-11:30 2523 trades, -71 Rs (win 50%) | 11:30-13:00 325 trades, -61 Rs (win 49%) | 13:00-14:30 406 trades, 129 Rs (win 54%)
- Symbols with 30+ trades: 11; profitable: 4. Best: TATASTEEL 764 (35), RELIANCE 230 (59), ITC 92 (292), ICICIBANK 34 (442). Worst: LT -226 (192), MARUTI -205 (131), INFY -182 (538).

### Structure + VWAP agree

- By year: 2024: 260 trades, -35 Rs (win 49%) | 2025: 1588 trades, -17 Rs (win 49%) | 2026: 1450 trades, 49 Rs (win 52%)
- Original symbols: 3298 trades, 11 Rs (win 50%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 1617 trades, -23 Rs (win 49%) | BUY PE 1681 trades, 43 Rs (win 52%)
- Indices vs stocks: 103 trades, -123 Rs (win 47%) | 3195 trades, 15 Rs (win 51%)
- Time of day: 10:15-11:30 2500 trades, -48 Rs (win 49%) | 11:30-13:00 350 trades, 211 Rs (win 56%) | 13:00-14:30 448 trades, 181 Rs (win 53%)
- Symbols with 30+ trades: 14; profitable: 7. Best: RELIANCE 316 (208), TCS 270 (102), AXISBANK 112 (372), BHARTIARTL 80 (394). Worst: SBIN -255 (154), NSEI -176 (45), INFY -167 (352).

