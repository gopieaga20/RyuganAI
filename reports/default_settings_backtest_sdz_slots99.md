# Supply and demand zones, with and without the same-day exit

Generated 2026-11-14 by `SET=sdz MAXPOS=99 DATA=730d node tools/bt_strategies.mjs default-test`. 14 symbols, 2024-11-06 to 2026-11-02, 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times 20 tries = adjusted p; above about 0.05 is not evidence of an edge).

| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Supply / demand zones + SMC agree | 3 | 3 | 984 | 3 | **642** | 2.82 | 33% | 1394 / -864 | - | - | - | 1 of 3 | 41.8 |
| VWAP alone (the current default) | 88173 | 7610 | 10 | 9580 | **155** | 1.19 | 53% | 98 / 227 | -49 | 0.000 | 0.00 | 8 of 9 | 0.9 |
| Random direction (yardstick) | 12544 | 5053 | -383 | 6578 | **-57** | 0.93 | 49% | -75 / -33 | -61 | 0.427 | 1.00 | 0 of 9 | -0.2 |
| Supply / demand zones alone | 132 | 131 | -999 | 131 | **-326** | 0.63 | 39% | -389 / -222 | -83 | 0.940 | 1.00 | 3 of 9 | -4.4 |
| Supply / demand zones alone, entries from 11:30 | 94 | 93 | -1014 | 93 | **-327** | 0.61 | 38% | -295 / -377 | - | - | - | 3 of 9 | -2.8 |
| Supply / demand zones + Structure agree | 54 | 54 | -903 | 54 | **-525** | 0.48 | 33% | -609 / -412 | - | - | - | 3 of 9 | -6.8 |
| Supply / demand zones + VWAP agree | 30 | 30 | -1014 | 30 | **-526** | 0.44 | 33% | -540 / -486 | - | - | - | 2 of 8 | -12.2 |
| Supply / demand zones + VWAP agree, entries from 11:30 | 24 | 24 | -764 | 24 | **-528** | 0.42 | 29% | -366 / -1016 | - | - | - | 2 of 7 | -7.0 |
| Supply / demand zones + EMA trend agree | 45 | 45 | -1147 | 45 | **-590** | 0.42 | 33% | -541 / -664 | - | - | - | 2 of 9 | -9.9 |
| Supply / demand zones + RSI agree | 34 | 34 | -896 | 34 | **-621** | 0.40 | 32% | -624 / -616 | - | - | - | 2 of 8 | -9.6 |

## What the numbers say

- Random direction, same-day exit: **-57 Rs per trade** (hold: -383). This is what a rule without skill costs here.
- The focus rule (Structure + FVG + VWAP, score >= 3): **-326 Rs per trade with the same-day exit** vs -999 when held to stop or target, over 131 trades.
- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **VWAP alone (the current default)**.
- How much the same-day exit helps every rule on average: 342 Rs per trade.

## The candidate in detail (same-day exit)

### Supply / demand zones alone

- By year: 2024: 15 trades, -158 Rs (win 33%) | 2025: 63 trades, -457 Rs (win 33%) | 2026: 53 trades, -217 Rs (win 47%)
- Original symbols: 131 trades, -326 Rs (win 39%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 71 trades, -511 Rs (win 31%) | BUY PE 60 trades, -106 Rs (win 48%)
- Indices vs stocks: 17 trades, -368 Rs (win 41%) | 114 trades, -319 Rs (win 39%)
- Time of day: 10:15-11:30 33 trades, -366 Rs (win 42%) | 11:30-13:00 49 trades, -472 Rs (win 35%) | 13:00-14:30 49 trades, -152 Rs (win 41%)
- Time of day, first 60% of the period: 10:15-11:30 22 trades, -527 Rs (win 36%) | 11:30-14:30 59 trades, -338 Rs (win 34%)
- Time of day, last 40% of the period: 10:15-11:30 11 trades (too few) | 11:30-14:30 39 trades, -273 Rs (win 44%)
- Entries from 11:30 by year: 2024: 11 trades (too few) | 2025: 46 trades, -441 Rs (win 33%) | 2026: 41 trades, -292 Rs (win 44%)

### Supply / demand zones + VWAP agree

- By year: 2024: 6 trades (too few) | 2025: 15 trades, -578 Rs (win 27%) | 2026: 9 trades (too few)
- Original symbols: 30 trades, -526 Rs (win 33%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 13 trades (too few) | BUY PE 17 trades, -702 Rs (win 29%)
- Indices vs stocks: 4 trades (too few) | 26 trades, -643 Rs (win 31%)
- Time of day: 10:15-11:30 6 trades (too few) | 11:30-13:00 7 trades (too few) | 13:00-14:30 17 trades, -235 Rs (win 29%)
- Time of day, first 60% of the period: 10:15-11:30 4 trades (too few) | 11:30-14:30 18 trades, -366 Rs (win 28%)
- Time of day, last 40% of the period: 10:15-11:30 2 trades (too few) | 11:30-14:30 6 trades (too few)
- Entries from 11:30 by year: 2024: 5 trades (too few) | 2025: 12 trades (too few) | 2026: 7 trades (too few)

### VWAP alone (the current default)

- By year: 2024: 770 trades, 266 Rs (win 56%) | 2025: 4377 trades, 63 Rs (win 51%) | 2026: 4433 trades, 225 Rs (win 54%)
- Original symbols: 9580 trades, 155 Rs (win 53%) | new symbols: 0 trades (too few)
- Calls vs puts: BUY CE 4735 trades, 141 Rs (win 52%) | BUY PE 4845 trades, 168 Rs (win 54%)
- Indices vs stocks: 2706 trades, 250 Rs (win 55%) | 6874 trades, 117 Rs (win 52%)
- Time of day: 10:15-11:30 5964 trades, -55 Rs (win 49%) | 11:30-13:00 1603 trades, 534 Rs (win 59%) | 13:00-14:30 2013 trades, 473 Rs (win 60%)
- Time of day, first 60% of the period: 10:15-11:30 3463 trades, -64 Rs (win 49%) | 11:30-14:30 1887 trades, 394 Rs (win 58%)
- Time of day, last 40% of the period: 10:15-11:30 2501 trades, -43 Rs (win 49%) | 11:30-14:30 1729 trades, 617 Rs (win 61%)
- Entries from 11:30 by year: 2024: 316 trades, 880 Rs (win 68%) | 2025: 1498 trades, 283 Rs (win 56%) | 2026: 1802 trades, 615 Rs (win 61%)
- Symbols with 30+ trades: 14; profitable: 14. Best: RELIANCE 318 (556), NSEI 287 (1234), NSEBANK 218 (1472), TCS 164 (582). Worst: INFY 43 (608), HDFCBANK 49 (531), ICICIBANK 64 (490).

