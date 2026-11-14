# Rules built on the LuxAlgo SMC outputs

Generated 2026-11-14 by `node tools/bt_strategies.mjs smc-rules`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). Rule definitions are in `tools/smc_rules.mjs`; they use only the indicator outputs of `frontend/js/smc.js` (structure events, order blocks, equal highs/lows, fair value gaps, swing range).

Each rule is also tried with VWAP and with the higher-timeframe trend (EMA100/200) agreeing, so **33 variants** were tried. With that many tries a few look good by luck, so the table shows a bootstrap p-value (how often the same number of random-direction trades does as well) and the p-value times 33 (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.

Random-direction yardstick (no skill): **-348 Rs per trade**, profit factor 0.79, 2190 trades.

| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | p | Adjusted p | Quarters |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Swing structure only + VWAP agree | 1 | 1 | 2982 | 9.99 | 100% | 2982 | - / 2982 | 2982 | -35.0 | 0% | - | - | 1 of 1 |
| 2 | Swing structure only + higher-timeframe trend agree | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | 0 of 0 |
| 3 | Swing CHoCH then order block + VWAP agree | 6 | 4 | -15 | 0.99 | 50% | -60 | -15 / -15 | 1484 | -21.4 | 33% | - | - | 1 of 3 |
| 4 | BOS then order block + VWAP agree | 248 | 161 | -220 | 0.86 | 47% | -35382 | -219 / -220 | 247 | -5.9 | 45% | 0.313 | 1.00 | 5 of 9 |
| 5 | Equal highs/lows swept | 971 | 519 | -321 | 0.81 | 45% | -166626 | -565 / 59 | 186 | 4.4 | 51% | 0.428 | 1.00 | 3 of 9 |
| 6 | Equal highs/lows swept, with the trend + VWAP agree | 154 | 112 | -336 | 0.80 | 45% | -37644 | -443 / -198 | 360 | 9.2 | 52% | 0.508 | 1.00 | 3 of 9 |
| 7 | Equal highs/lows swept + VWAP agree | 525 | 314 | -340 | 0.80 | 45% | -106608 | -690 / 204 | 299 | 6.7 | 55% | 0.501 | 1.00 | 3 of 9 |
| 8 | BOS then order block | 425 | 246 | -356 | 0.79 | 44% | -87606 | -279 / -451 | 58 | -5.7 | 43% | 0.544 | 1.00 | 3 of 9 |
| 9 | Discount/premium + internal trend + VWAP agree | 1893 | 365 | -398 | 0.77 | 44% | -145227 | -609 / -77 | 18 | -0.2 | 47% | 0.604 | 1.00 | 2 of 9 |
| 10 | Discount/premium + internal trend | 4200 | 629 | -437 | 0.75 | 43% | -275061 | -634 / -136 | 37 | 0.1 | 49% | 0.750 | 1.00 | 2 of 9 |
| 11 | Equal highs/lows swept, with the trend | 259 | 184 | -438 | 0.74 | 43% | -80682 | -614 / -177 | 152 | 3.2 | 48% | 0.672 | 1.00 | 1 of 9 |
| 12 | Order block tap, no premium/discount rule + VWAP agree | 414 | 266 | -466 | 0.73 | 42% | -123870 | -551 / -354 | -60 | -5.7 | 43% | 0.751 | 1.00 | 2 of 9 |
| 13 | BOS then order block + higher-timeframe trend agree | 366 | 203 | -473 | 0.73 | 42% | -95952 | -547 / -390 | -74 | -7.1 | 41% | 0.744 | 1.00 | 3 of 9 |
| 14 | CHoCH then order block | 543 | 311 | -506 | 0.71 | 42% | -157512 | -485 / -538 | -44 | -2.3 | 46% | 0.839 | 1.00 | 2 of 9 |
| 15 | Break-and-retest of the structure level | 1163 | 856 | -509 | 0.71 | 42% | -435307 | -612 / -369 | 79 | -1.9 | 48% | 0.931 | 1.00 | 0 of 9 |
| 16 | Order block tap, no premium/discount rule | 1089 | 522 | -532 | 0.70 | 41% | -277560 | -679 / -336 | -72 | -3.3 | 45% | 0.922 | 1.00 | 1 of 9 |
| 17 | Break-and-retest of the structure level + VWAP agree | 1058 | 793 | -544 | 0.69 | 41% | -431365 | -675 / -368 | 49 | -2.2 | 48% | 0.971 | 1.00 | 0 of 9 |
| 18 | Discount/premium + internal trend + higher-timeframe trend agree | 1078 | 217 | -581 | 0.68 | 41% | -126132 | -645 / -504 | 13 | 2.0 | 51% | 0.891 | 1.00 | 1 of 9 |
| 19 | Swing structure only | 21 | 10 | -614 | 0.66 | 40% | -6144 | -1014 / -15 | 1184 | -2.5 | 42% | - | - | 3 of 8 |
| 20 | Order block + fair value gap + higher-timeframe trend agree | 46 | 30 | -614 | 0.66 | 40% | -18432 | -390 / -871 | -15 | 2.6 | 56% | 0.755 | 1.00 | 2 of 9 |
| 21 | Break-and-retest of the structure level + higher-timeframe trend agree | 549 | 435 | -635 | 0.65 | 40% | -276145 | -991 / -84 | -111 | -4.0 | 47% | 0.983 | 1.00 | 1 of 9 |
| 22 | Order block tap, no premium/discount rule + higher-timeframe trend agree | 735 | 356 | -655 | 0.64 | 39% | -233112 | -925 / -305 | -216 | -5.3 | 44% | 0.976 | 1.00 | 1 of 9 |
| 23 | Swing CHoCH then order block | 40 | 18 | -681 | 0.63 | 39% | -12258 | -707 / -614 | -348 | 3.1 | 54% | - | - | 0 of 7 |
| 24 | Today's SMC vote (control) | 218 | 111 | -690 | 0.63 | 39% | -76590 | -817 / -465 | -176 | 0.4 | 48% | 0.894 | 1.00 | 1 of 9 |
| 25 | Equal highs/lows swept + higher-timeframe trend agree | 286 | 180 | -781 | 0.59 | 37% | -140562 | -1219 / -138 | -269 | -0.1 | 49% | 0.976 | 1.00 | 1 of 9 |
| 26 | CHoCH then order block + VWAP agree | 269 | 173 | -795 | 0.58 | 37% | -137460 | -651 / -987 | -256 | -3.3 | 47% | 0.985 | 1.00 | 0 of 9 |
| 27 | Equal highs/lows swept, with the trend + higher-timeframe trend agree | 100 | 78 | -860 | 0.55 | 36% | -67104 | -1339 / -272 | -215 | -8.3 | 45% | 0.948 | 1.00 | 1 of 9 |
| 28 | Order block + fair value gap | 73 | 46 | -927 | 0.53 | 35% | -42648 | -560 / -1264 | -536 | 2.2 | 53% | 0.922 | 1.00 | 2 of 9 |
| 29 | CHoCH then order block + higher-timeframe trend agree | 134 | 74 | -987 | 0.51 | 34% | -73038 | -1404 / -469 | -663 | -4.7 | 45% | 0.972 | 1.00 | 1 of 9 |
| 30 | Today's SMC vote (control) + VWAP agree | 51 | 38 | -1119 | 0.46 | 32% | -42528 | -854 / -1629 | -804 | -3.0 | 43% | 0.963 | 1.00 | 1 of 9 |
| 31 | Today's SMC vote (control) + higher-timeframe trend agree | 32 | 22 | -1377 | 0.37 | 27% | -30300 | -2090 / -348 | -560 | -0.1 | 48% | 0.967 | 1.00 | 2 of 8 |
| 32 | Order block + fair value gap + VWAP agree | 25 | 15 | -1813 | 0.25 | 20% | -27198 | -2013 / -1680 | -614 | 2.7 | 57% | - | - | 0 of 5 |
| 33 | Swing CHoCH then order block + higher-timeframe trend agree | 3 | 1 | -3012 | 0.00 | 0% | -3012 | -3012 / - | -3012 | -32.3 | 0% | - | - | 0 of 1 |

## What the numbers say

- Variants with at least 40 trades that beat the random yardstick on the average trade: **4 of 23**.
- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **none**.
- Variants with at least 40 trades and an adjusted p below 0.05 (a real edge after correcting for the 33 tries): **none**.
- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.

## One section per rule

### Today's SMC vote (control)

*Internal trend + swing not opposed + order block tapped + right half of the swing range.*

- Overall: 111 trades, -690 Rs per trade, profit factor 0.63, win 39%. Underlying 1h move 0.4 bps, 48% of signals right (195 signals).
- Calls vs puts: BUY CE 59 trades, -1082 Rs | BUY PE 52 trades, -246 Rs
- Indices vs stocks: 13 trades (too few) | 98 trades, -688 Rs

### Order block tap, no premium/discount rule

*The same without the half-of-range condition: internal trend, swing not opposed, an unmitigated order block tapped.*

- Overall: 522 trades, -532 Rs per trade, profit factor 0.70, win 41%. Underlying 1h move -3.3 bps, 45% of signals right (960 signals).
- Calls vs puts: BUY CE 280 trades, -914 Rs | BUY PE 242 trades, -89 Rs
- Indices vs stocks: 82 trades, -161 Rs | 440 trades, -601 Rs

### Swing structure only

*Swing trend (size 50) + a SWING order block tapped + right half of the range.*

- Overall: 10 trades, -614 Rs per trade, profit factor 0.66, win 40%. Underlying 1h move -2.5 bps, 42% of signals right (19 signals).
- Calls vs puts: BUY CE 6 trades (too few) | BUY PE 4 trades (too few)
- Indices vs stocks: 2 trades (too few) | 8 trades (too few)

### CHoCH then order block

*A change of character (internal or swing) in the last 12 bars, then the order block it created is tapped. A reversal setup.*

- Overall: 311 trades, -506 Rs per trade, profit factor 0.71, win 42%. Underlying 1h move -2.3 bps, 46% of signals right (474 signals).
- Calls vs puts: BUY CE 164 trades, -1075 Rs | BUY PE 147 trades, 128 Rs
- Indices vs stocks: 37 trades, -258 Rs | 274 trades, -540 Rs

### Swing CHoCH then order block

*A SWING change of character in the last 40 bars, then the order block it created is tapped.*

- Overall: 18 trades, -681 Rs per trade, profit factor 0.63, win 39%. Underlying 1h move 3.1 bps, 54% of signals right (39 signals).
- Calls vs puts: BUY CE 14 trades (too few) | BUY PE 4 trades (too few)
- Indices vs stocks: 6 trades (too few) | 12 trades (too few)

### BOS then order block

*An internal break of structure WITH the trend in the last 12 bars (swing trend agreeing), then the order block it created is tapped. A continuation setup.*

- Overall: 246 trades, -356 Rs per trade, profit factor 0.79, win 44%. Underlying 1h move -5.7 bps, 43% of signals right (364 signals).
- Calls vs puts: BUY CE 143 trades, -497 Rs | BUY PE 103 trades, -160 Rs
- Indices vs stocks: 44 trades, -15 Rs | 202 trades, -430 Rs

### Order block + fair value gap

*An order block tap whose candle also trades inside a live LuxAlgo fair value gap of the same direction.*

- Overall: 46 trades, -927 Rs per trade, profit factor 0.53, win 35%. Underlying 1h move 2.2 bps, 53% of signals right (66 signals).
- Calls vs puts: BUY CE 46 trades, -927 Rs | BUY PE 0 trades (too few)
- Indices vs stocks: 5 trades (too few) | 41 trades, -819 Rs

### Equal highs/lows swept

*Equal lows formed in the last 40 bars, a candle wicks under them and closes back above (mirror for equal highs).*

- Overall: 519 trades, -321 Rs per trade, profit factor 0.81, win 45%. Underlying 1h move 4.4 bps, 51% of signals right (838 signals).
- Calls vs puts: BUY CE 242 trades, -510 Rs | BUY PE 277 trades, -156 Rs
- Indices vs stocks: 73 trades, 26 Rs | 446 trades, -378 Rs

### Equal highs/lows swept, with the trend

*The same, only when the internal trend points the way of the reversal.*

- Overall: 184 trades, -438 Rs per trade, profit factor 0.74, win 43%. Underlying 1h move 3.2 bps, 48% of signals right (226 signals).
- Calls vs puts: BUY CE 84 trades, -372 Rs | BUY PE 100 trades, -495 Rs
- Indices vs stocks: 21 trades, 699 Rs | 163 trades, -585 Rs

### Break-and-retest of the structure level

*After an internal break in the last 12 bars, price returns to the broken level and closes back in the break direction.*

- Overall: 856 trades, -509 Rs per trade, profit factor 0.71, win 42%. Underlying 1h move -1.9 bps, 48% of signals right (1013 signals).
- Calls vs puts: BUY CE 410 trades, -621 Rs | BUY PE 446 trades, -405 Rs
- Indices vs stocks: 129 trades, -596 Rs | 727 trades, -493 Rs

### Discount/premium + internal trend

*Internal trend with price in the discount (up) or premium (down) half of the swing range. No order block needed.*

- Overall: 629 trades, -437 Rs per trade, profit factor 0.75, win 43%. Underlying 1h move 0.1 bps, 49% of signals right (3752 signals).
- Calls vs puts: BUY CE 276 trades, -688 Rs | BUY PE 353 trades, -241 Rs
- Indices vs stocks: 159 trades, -215 Rs | 470 trades, -512 Rs

