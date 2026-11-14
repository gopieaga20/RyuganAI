# Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo port) + Support/resistance

Generated 2026-11-14 by `node tools/bt_strategies.mjs smc-four`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). The four strategies exactly as the app votes them today: Structure BOS/CHoCH (weight 2), FVG retest (1), Smart money = the LuxAlgo-port vote (2) and Support/resistance of the previous day high/low (shown in the app but weight 0). They are tested alone, in every pair and triple, all four together, as weighted scores, and with VWAP agreeing. Support/resistance is the combined rule (breakout, break-and-retest or rejection) as used by the app.

**44 variants** were tried. With that many tries a few look good by luck, so the table shows (for rules with at least 100 trades) a p-value against a **coin flip on the same entry bars** (each signal keeps its entry bar but its direction is flipped at random, which removes timing effects such as paying less time decay by entering early in the day) and the p-value times 44 (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.

Random-direction yardstick (no skill): **-348 Rs per trade**, profit factor 0.79, 2190 trades.

| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | Coin flip, same bars (avg Rs) | p vs coin flip | Adjusted p | Quarters |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP agrees | 8 | 8 | 734 | 1.65 | 63% | 5874 | 584 / 984 | 734 | -24.2 | 20% | - | - | - | 3 of 6 |
| 2 | Structure + FVG retest + SMC agree, S/R not against + VWAP agrees | 8 | 8 | 734 | 1.65 | 63% | 5874 | 584 / 984 | 734 | -24.2 | 20% | - | - | - | 3 of 6 |
| 3 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 5 + VWAP agrees | 8 | 8 | 734 | 1.65 | 63% | 5874 | 584 / 984 | 734 | -24.2 | 20% | - | - | - | 3 of 6 |
| 4 | FVG retest + SMC (LuxAlgo) agree | 13 | 13 | 216 | 1.16 | 54% | 2802 | 734 / -614 | 216 | -4.7 | 50% | - | - | - | 3 of 7 |
| 5 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree | 13 | 13 | 216 | 1.16 | 54% | 2802 | 734 / -614 | 216 | -4.7 | 50% | - | - | - | 3 of 7 |
| 6 | Structure + FVG retest + SMC agree, S/R not against | 13 | 13 | 216 | 1.16 | 54% | 2802 | 734 / -614 | 216 | -4.7 | 50% | - | - | - | 3 of 7 |
| 7 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 5 | 13 | 13 | 216 | 1.16 | 54% | 2802 | 734 / -614 | 216 | -4.7 | 50% | - | - | - | 3 of 7 |
| 8 | FVG retest + SMC (LuxAlgo) + S/R (prev day H/L) agree | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 9 | All four agree | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 10 | Weighted vote, equal weights (1 each), score >= 4 | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 11 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP and the higher-timeframe trend agree | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 12 | FVG retest + SMC (LuxAlgo) + S/R (prev day H/L) agree + VWAP agrees | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 13 | All four agree + VWAP agrees | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 14 | Weighted vote, equal weights (1 each), score >= 4 + VWAP agrees | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | - | 0 of 0 |
| 15 | SMC (LuxAlgo) + S/R (prev day H/L) agree | 19 | 15 | -215 | 0.87 | 47% | -3222 | -2013 / 984 | 185 | -12.6 | 42% | - | - | - | 2 of 8 |
| 16 | Weighted vote, equal weights (1 each), score >= 2 + VWAP agrees | 9476 | 2142 | -263 | 0.84 | 46% | -562454 | -299 / -218 | 140 | 1.1 | 50% | -437 | 0.003 | 0.14 | 1 of 9 |
| 17 | Weighted vote, equal weights (1 each), score >= 2 | 11730 | 2176 | -281 | 0.83 | 46% | -610916 | -270 / -294 | 37 | 0.9 | 50% | -398 | 0.033 | 1.00 | 1 of 9 |
| 18 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 3 + VWAP agrees | 5203 | 1865 | -281 | 0.83 | 46% | -524690 | -257 / -310 | 135 | 0.6 | 49% | -453 | 0.006 | 0.27 | 1 of 9 |
| 19 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 3 | 6401 | 1973 | -291 | 0.82 | 45% | -574766 | -313 / -266 | 56 | 0.5 | 49% | -375 | 0.107 | 1.00 | 1 of 9 |
| 20 | FVG retest alone | 6276 | 1966 | -303 | 0.82 | 45% | -595640 | -331 / -270 | 73 | 0.6 | 49% | -423 | 0.036 | 1.00 | 1 of 9 |
| 21 | Structure BOS/CHoCH + FVG retest agree | 6276 | 1966 | -303 | 0.82 | 45% | -595640 | -331 / -270 | 73 | 0.6 | 49% | -378 | 0.131 | 1.00 | 1 of 9 |
| 22 | Structure BOS/CHoCH + S/R (prev day H/L) agree | 6263 | 1873 | -373 | 0.78 | 44% | -698212 | -440 / -288 | 45 | 1.2 | 50% | -495 | 0.037 | 1.00 | 0 of 9 |
| 23 | S/R (prev day H/L) alone | 8940 | 2084 | -385 | 0.77 | 44% | -802626 | -465 / -293 | 59 | 0.9 | 50% | -434 | 0.224 | 1.00 | 0 of 9 |
| 24 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 4 + VWAP agrees | 5051 | 1715 | -389 | 0.77 | 44% | -666296 | -439 / -323 | 75 | 1.4 | 51% | -476 | 0.110 | 1.00 | 0 of 9 |
| 25 | Structure BOS/CHoCH alone | 88173 | 2114 | -391 | 0.77 | 44% | -825584 | -361 / -423 | 97 | -0.0 | 50% | -484 | 0.073 | 1.00 | 0 of 9 |
| 26 | FVG retest + S/R (prev day H/L) agree | 925 | 668 | -395 | 0.77 | 44% | -263554 | -419 / -361 | -83 | 0.3 | 47% | -444 | 0.332 | 1.00 | 1 of 9 |
| 27 | Structure BOS/CHoCH + FVG retest + S/R (prev day H/L) agree | 925 | 668 | -395 | 0.77 | 44% | -263554 | -419 / -361 | -83 | 0.3 | 47% | -426 | 0.393 | 1.00 | 1 of 9 |
| 28 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 5 | 947 | 680 | -397 | 0.77 | 44% | -269728 | -421 / -363 | -95 | -0.1 | 47% | -449 | 0.321 | 1.00 | 2 of 9 |
| 29 | Weighted vote, equal weights (1 each), score >= 3 | 947 | 680 | -397 | 0.77 | 44% | -269728 | -421 / -363 | -95 | -0.1 | 47% | -395 | 0.504 | 1.00 | 2 of 9 |
| 30 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 4 | 6392 | 1882 | -405 | 0.76 | 44% | -761284 | -449 / -349 | 29 | 1.1 | 50% | -474 | 0.155 | 1.00 | 0 of 9 |
| 31 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 5 + VWAP agrees | 749 | 563 | -418 | 0.75 | 43% | -235430 | -404 / -438 | -96 | -0.3 | 47% | -416 | 0.507 | 1.00 | 1 of 9 |
| 32 | Weighted vote, equal weights (1 each), score >= 3 + VWAP agrees | 749 | 563 | -418 | 0.75 | 43% | -235430 | -404 / -438 | -96 | -0.3 | 47% | -313 | 0.798 | 1.00 | 1 of 9 |
| 33 | Structure BOS/CHoCH + FVG retest + S/R (prev day H/L) agree + VWAP agrees | 737 | 557 | -423 | 0.75 | 43% | -235340 | -391 / -468 | -97 | -0.1 | 47% | -479 | 0.327 | 1.00 | 1 of 9 |
| 34 | Structure BOS/CHoCH + SMC (LuxAlgo) agree | 138 | 72 | -598 | 0.67 | 40% | -43038 | -536 / -707 | -265 | -3.6 | 44% | - | - | - | 0 of 9 |
| 35 | Structure + SMC agree, FVG and S/R not against | 138 | 72 | -598 | 0.67 | 40% | -43038 | -536 / -707 | -265 | -3.6 | 44% | - | - | - | 0 of 9 |
| 36 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 4 | 138 | 72 | -598 | 0.67 | 40% | -43038 | -536 / -707 | -265 | -3.6 | 44% | - | - | - | 0 of 9 |
| 37 | SMC (LuxAlgo) alone | 218 | 111 | -690 | 0.63 | 39% | -76590 | -817 / -465 | -176 | 0.4 | 48% | -706 | 0.477 | 1.00 | 1 of 9 |
| 38 | Structure + SMC agree, FVG and S/R not against + VWAP agrees | 41 | 32 | -952 | 0.52 | 34% | -30450 | -729 / -1377 | -764 | -11.0 | 35% | - | - | - | 1 of 9 |
| 39 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 4 + VWAP agrees | 41 | 32 | -952 | 0.52 | 34% | -30450 | -729 / -1377 | -764 | -11.0 | 35% | - | - | - | 1 of 9 |
| 40 | Structure BOS/CHoCH + SMC (LuxAlgo) + S/R (prev day H/L) agree + VWAP agrees | 4 | 3 | -1014 | 0.50 | 33% | -3042 | -1014 / - | -1014 | -7.0 | 25% | - | - | - | 0 of 2 |
| 41 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 6 + VWAP agrees | 4 | 3 | -1014 | 0.50 | 33% | -3042 | -1014 / - | -1014 | -7.0 | 25% | - | - | - | 0 of 2 |
| 42 | Structure BOS/CHoCH + SMC (LuxAlgo) + S/R (prev day H/L) agree | 9 | 7 | -1299 | 0.40 | 29% | -9096 | -1513 / -1014 | -1299 | -30.5 | 33% | - | - | - | 0 of 4 |
| 43 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 6 | 9 | 7 | -1299 | 0.40 | 29% | -9096 | -1513 / -1014 | -1299 | -30.5 | 33% | - | - | - | 0 of 4 |
| 44 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + the higher-timeframe trend (EMA100/200) agree | 1 | 1 | -3012 | 0.00 | 0% | -3012 | -3012 / - | -3012 | 65.5 | 100% | - | - | - | 0 of 1 |

## What the numbers say

- Variants with at least 40 trades that beat the random yardstick on the average trade: **6 of 22**.
- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **none**.
- Variants with at least 100 trades and an adjusted p below 0.05 (a real edge after correcting for the 44 tries): **none**.
- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.

## The focus combination in detail

Symbols in this run: 14 (14 from the original set used in all earlier reports, 0 new ones that were never used to choose anything). Period: 2024-11-06 to 2026-11-02.

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree

- Overall: 13 trades, 216 Rs per trade, profit factor 1.16, win 54%, total 2802 Rs. First 60% 734 (8 trades) / last 40% -614 (5 trades). No-decay best case 216 Rs. Underlying 1h move -4.7 bps, 50% of 10 signals right.
- By year: 2024: 1 trades (too few) | 2025: 7 trades (too few) | 2026: 5 trades (too few)
- Original symbols: 13 trades, 216 Rs (win 54%) | new symbols: 0 trades (too few)
- Calls (up) vs puts (down): BUY CE 9 trades (too few) | BUY PE 4 trades (too few)
- Indices vs stocks: 1 trades (too few) | 12 trades, 485 Rs (win 58%)
- Time of day: 10:15-11:30 2 trades (too few) | 11:30-13:00 3 trades (too few) | 13:00-14:30 8 trades (too few)
- Symbols with 3+ trades (avg Rs): RELIANCE 984 (3)
- Profitable symbols: 1 of 1.

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP agrees

- Overall: 8 trades, 734 Rs per trade, profit factor 1.65, win 63%, total 5874 Rs. First 60% 584 (5 trades) / last 40% 984 (3 trades). No-decay best case 734 Rs. Underlying 1h move -24.2 bps, 20% of 5 signals right.
- By year: 2024: 1 trades (too few) | 2025: 4 trades (too few) | 2026: 3 trades (too few)
- Original symbols: 8 trades (too few) | new symbols: 0 trades (too few)
- Calls (up) vs puts (down): BUY CE 4 trades (too few) | BUY PE 4 trades (too few)
- Indices vs stocks: 1 trades (too few) | 7 trades (too few)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 1 trades (too few) | 13:00-14:30 7 trades (too few)

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + the higher-timeframe trend (EMA100/200) agree

- Overall: 1 trades, -3012 Rs per trade, profit factor 0.00, win 0%, total -3012 Rs. First 60% -3012 (1 trades) / last 40% - (0 trades). No-decay best case -3012 Rs. Underlying 1h move 65.5 bps, 100% of 1 signals right.
- By year: 2025: 1 trades (too few)
- Original symbols: 1 trades (too few) | new symbols: 0 trades (too few)
- Calls (up) vs puts (down): BUY CE 1 trades (too few) | BUY PE 0 trades (too few)
- Indices vs stocks: 0 trades (too few) | 1 trades (too few)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 0 trades (too few) | 13:00-14:30 1 trades (too few)

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP and the higher-timeframe trend agree

- Overall: 0 trades, - Rs per trade, profit factor 0.00, win 0%, total 0 Rs. First 60% - (0 trades) / last 40% - (0 trades). No-decay best case 0 Rs. Underlying 1h move 0.0 bps, 0% of 0 signals right.
- By year: 
- Original symbols: 0 trades (too few) | new symbols: 0 trades (too few)
- Calls (up) vs puts (down): BUY CE 0 trades (too few) | BUY PE 0 trades (too few)
- Indices vs stocks: 0 trades (too few) | 0 trades (too few)
- Time of day: 10:15-11:30 0 trades (too few) | 11:30-13:00 0 trades (too few) | 13:00-14:30 0 trades (too few)

