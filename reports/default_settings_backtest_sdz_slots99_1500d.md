# Supply and demand zones, with and without the same-day exit

Generated 2026-11-14 by `SET=sdz MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs default-test`. 34 symbols, 2022-10-10 to 2026-11-13, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 20 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Supply / demand zones + SMC agree | 9 | 9 | 984 | 9 | **171** | 1.24 | 56% | -64 / 642 | - | - | - | 5 of 8 | 2.2 |
| VWAP alone (the current default) | 432983 | 35983 | -29 | 45418 | **153** | 1.19 | 53% | 154 / 151 | -59 | 0.000 | 0.00 | 17 of 17 | 1.1 |
| Random direction (yardstick) | 61626 | 24828 | -380 | 31785 | **-31** | 0.96 | 49% | -60 / 13 | -55 | 0.010 | 0.20 | 6 of 17 | 0.4 |
| Supply / demand zones + EMA trend agree | 213 | 212 | -665 | 212 | **-200** | 0.75 | 45% | -150 / -285 | -9 | 0.950 | 1.00 | 6 of 17 | -4.0 |
| Supply / demand zones alone | 633 | 628 | -683 | 630 | **-224** | 0.71 | 45% | -250 / -181 | -56 | 0.993 | 1.00 | 5 of 17 | -5.5 |
| Supply / demand zones alone, entries from 11:30 | 430 | 427 | -724 | 428 | **-226** | 0.69 | 44% | -241 / -206 | -2 | 0.998 | 1.00 | 5 of 17 | -5.2 |
| Supply / demand zones + Structure agree | 258 | 257 | -773 | 257 | **-329** | 0.60 | 41% | -328 / -331 | 20 | 1.000 | 1.00 | 4 of 17 | -6.4 |
| Supply / demand zones + VWAP agree, entries from 11:30 | 90 | 90 | -748 | 90 | **-440** | 0.48 | 34% | -429 / -457 | - | - | - | 3 of 17 | -19.9 |
| Supply / demand zones + VWAP agree | 122 | 122 | -850 | 122 | **-472** | 0.48 | 37% | -459 / -492 | -67 | 0.997 | 1.00 | 6 of 17 | -19.5 |
| Supply / demand zones + RSI agree | 169 | 169 | -884 | 169 | **-513** | 0.46 | 38% | -461 / -595 | 18 | 1.000 | 1.00 | 6 of 17 | -11.2 |

## What the numbers say

- Random direction, same-day exit: **-31 Rs per trade** (hold: -380). This is what a rule without skill costs here.
- The focus rule (Structure + FVG + VWAP, score >= 3): **-224 Rs per trade with the same-day exit** vs -683 when held to stop or target, over 630 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **VWAP alone (the current default)**.
- How much the same-day exit helps every rule on average: 264 Rs per trade.

## The candidate in detail (same-day exit)

### Supply / demand zones alone

- By year: 2022: 46 trades, 107 Rs (win 57%) | 2023: 155 trades, -376 Rs (win 39%) | 2024: 153 trades, -95 Rs (win 50%) | 2025: 153 trades, -279 Rs (win 42%) | 2026: 123 trades, -248 Rs (win 47%)
- Original symbols: 265 trades, -351 Rs (win 41%) | new symbols: 365 trades, -132 Rs (win 48%)
- Calls vs puts: BUY CE 323 trades, -356 Rs (win 41%) | BUY PE 307 trades, -86 Rs (win 50%)
- Indices vs stocks: 41 trades, -945 Rs (win 34%) | 589 trades, -174 Rs (win 46%)
- Time of day: 10:15-11:30 171 trades, -218 Rs (win 48%) | 11:30-13:00 209 trades, -294 Rs (win 44%) | 13:00-14:30 250 trades, -170 Rs (win 45%)
- Time of day, first 60% of the period: 10:15-11:30 119 trades, -242 Rs (win 47%) | 11:30-14:30 276 trades, -253 Rs (win 43%)
- Time of day, last 40% of the period: 10:15-11:30 52 trades, -164 Rs (win 50%) | 11:30-14:30 183 trades, -185 Rs (win 46%)
- Entries from 11:30 by year: 2022: 36 trades, 37 Rs (win 56%) | 2023: 112 trades, -367 Rs (win 38%) | 2024: 98 trades, -75 Rs (win 49%) | 2025: 115 trades, -238 Rs (win 43%) | 2026: 98 trades, -300 Rs (win 45%)

### Supply / demand zones + VWAP agree

- By year: 2022: 10 trades (too few) | 2023: 24 trades, -610 Rs (win 29%) | 2024: 29 trades, -53 Rs (win 41%) | 2025: 34 trades, -750 Rs (win 35%) | 2026: 25 trades, -542 Rs (win 40%)
- Original symbols: 54 trades, -405 Rs (win 35%) | new symbols: 68 trades, -526 Rs (win 38%)
- Calls vs puts: BUY CE 59 trades, -355 Rs (win 41%) | BUY PE 63 trades, -582 Rs (win 33%)
- Indices vs stocks: 7 trades (too few) | 115 trades, -500 Rs (win 36%)
- Time of day: 10:15-11:30 27 trades, -637 Rs (win 41%) | 11:30-13:00 28 trades, -501 Rs (win 43%) | 13:00-14:30 67 trades, -394 Rs (win 33%)
- Time of day, first 60% of the period: 10:15-11:30 16 trades, -651 Rs (win 38%) | 11:30-14:30 57 trades, -405 Rs (win 33%)
- Time of day, last 40% of the period: 10:15-11:30 11 trades (too few) | 11:30-14:30 38 trades, -457 Rs (win 39%)
- Entries from 11:30 by year: 2022: 9 trades (too few) | 2023: 18 trades, -573 Rs (win 28%) | 2024: 23 trades, 20 Rs (win 39%) | 2025: 25 trades, -647 Rs (win 36%) | 2026: 20 trades, -636 Rs (win 35%)

### VWAP alone (the current default)

- By year: 2022: 2326 trades, 159 Rs (win 52%) | 2023: 10431 trades, 127 Rs (win 52%) | 2024: 11990 trades, 195 Rs (win 54%) | 2025: 10402 trades, 82 Rs (win 52%) | 2026: 10269 trades, 200 Rs (win 54%)
- Original symbols: 19700 trades, 176 Rs (win 53%) | new symbols: 25718 trades, 135 Rs (win 53%)
- Calls vs puts: BUY CE 22191 trades, 170 Rs (win 53%) | BUY PE 23227 trades, 136 Rs (win 53%)
- Indices vs stocks: 5471 trades, 303 Rs (win 56%) | 39947 trades, 132 Rs (win 53%)
- Time of day: 10:15-11:30 29210 trades, -17 Rs (win 49%) | 11:30-13:00 6937 trades, 474 Rs (win 58%) | 13:00-14:30 9271 trades, 446 Rs (win 61%)
- Time of day, first 60% of the period: 10:15-11:30 17487 trades, -16 Rs (win 49%) | 11:30-14:30 10246 trades, 444 Rs (win 59%)
- Time of day, last 40% of the period: 10:15-11:30 11723 trades, -18 Rs (win 49%) | 11:30-14:30 5962 trades, 482 Rs (win 60%)
- Entries from 11:30 by year: 2022: 785 trades, 401 Rs (win 57%) | 2023: 3452 trades, 486 Rs (win 60%) | 2024: 4777 trades, 457 Rs (win 60%) | 2025: 3371 trades, 334 Rs (win 57%) | 2026: 3823 trades, 554 Rs (win 61%)
- Symbols with 30+ trades: 34; profitable: 32. Best: ADANIENT 368 (2246), NSEI 347 (2350), BAJFINANCE 309 (1318), ONGC 270 (1328). Worst: SUNPHARMA -41 (1066), CIPLA -34 (1130), DRREDDY 13 (1147).

