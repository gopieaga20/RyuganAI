# Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo port) + Support/resistance

Generated 2026-11-14 by `node tools/bt_strategies.mjs smc-four`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). The four strategies exactly as the app votes them today: Structure BOS/CHoCH (weight 2), FVG retest (1), Smart money = the LuxAlgo-port vote (2) and Support/resistance of the previous day high/low (shown in the app but weight 0). They are tested alone, in every pair and triple, all four together, as weighted scores, and with VWAP agreeing. Support/resistance is the combined rule (breakout, break-and-retest or rejection) as used by the app.

**44 variants** were tried. With that many tries a few look good by luck, so the table shows (for rules with at least 100 trades) a p-value against a **coin flip on the same entry bars** (each signal keeps its entry bar but its direction is flipped at random, which removes timing effects such as paying less time decay by entering early in the day) and the p-value times 44 (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.

Random-direction yardstick (no skill): **-404 Rs per trade**, profit factor 0.76, 4798 trades.

| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | Coin flip, same bars (avg Rs) | p vs coin flip | Adjusted p | Quarters |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP agrees | 36 | 33 | 76 | 1.05 | 52% | 2502 | -1119 / 1698 | 76 | -4.3 | 40% | - | - | - | 5 of 15 |
| 2 | Structure + FVG retest + SMC agree, S/R not against + VWAP agrees | 36 | 33 | 76 | 1.05 | 52% | 2502 | -1119 / 1698 | 76 | -4.3 | 40% | - | - | - | 5 of 15 |
| 3 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 5 + VWAP agrees | 36 | 33 | 76 | 1.05 | 52% | 2502 | -1119 / 1698 | 76 | -4.3 | 40% | - | - | - | 5 of 15 |
| 4 | Structure BOS/CHoCH alone | 432984 | 5932 | -200 | 0.87 | 47% | -1186240 | -195 / -209 | 138 | 0.2 | 50% | -345 | 0.000 | 0.00 | 1 of 17 |
| 5 | Weighted vote, equal weights (1 each), score >= 2 + VWAP agrees | 45507 | 4747 | -310 | 0.81 | 45% | -1473298 | -296 / -333 | 87 | 0.7 | 49% | -420 | 0.006 | 0.24 | 2 of 17 |
| 6 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 3 + VWAP agrees | 24193 | 4497 | -321 | 0.81 | 45% | -1442603 | -268 / -403 | 65 | 0.8 | 49% | -420 | 0.013 | 0.57 | 1 of 17 |
| 7 | FVG retest + SMC (LuxAlgo) agree | 65 | 56 | -336 | 0.80 | 45% | -18822 | -896 / 530 | -229 | -1.2 | 49% | - | - | - | 6 of 16 |
| 8 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree | 65 | 56 | -336 | 0.80 | 45% | -18822 | -896 / 530 | -229 | -1.2 | 49% | - | - | - | 6 of 16 |
| 9 | Structure + FVG retest + SMC agree, S/R not against | 65 | 56 | -336 | 0.80 | 45% | -18822 | -896 / 530 | -229 | -1.2 | 49% | - | - | - | 6 of 16 |
| 10 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 5 | 65 | 56 | -336 | 0.80 | 45% | -18822 | -896 / 530 | -229 | -1.2 | 49% | - | - | - | 6 of 16 |
| 11 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 4 + VWAP agrees | 25109 | 4569 | -352 | 0.79 | 44% | -1609568 | -351 / -354 | 50 | 0.5 | 49% | -452 | 0.012 | 0.51 | 0 of 17 |
| 12 | S/R (prev day H/L) alone | 44368 | 4733 | -356 | 0.79 | 44% | -1684138 | -372 / -330 | 23 | -0.1 | 49% | -439 | 0.026 | 1.00 | 1 of 17 |
| 13 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 3 | 30487 | 4536 | -381 | 0.77 | 44% | -1729309 | -390 / -368 | 13 | 0.4 | 49% | -424 | 0.165 | 1.00 | 1 of 17 |
| 14 | FVG retest alone | 29877 | 4534 | -381 | 0.77 | 44% | -1729279 | -388 / -371 | 15 | 0.5 | 49% | -429 | 0.138 | 1.00 | 2 of 17 |
| 15 | Structure BOS/CHoCH + FVG retest agree | 29877 | 4534 | -381 | 0.77 | 44% | -1729279 | -388 / -371 | 15 | 0.5 | 49% | -442 | 0.085 | 1.00 | 2 of 17 |
| 16 | Structure BOS/CHoCH + S/R (prev day H/L) agree | 31111 | 4627 | -391 | 0.77 | 44% | -1810910 | -392 / -390 | -19 | 0.0 | 49% | -434 | 0.163 | 1.00 | 1 of 17 |
| 17 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 4 | 31730 | 4619 | -404 | 0.76 | 44% | -1864736 | -420 / -378 | -14 | 0.0 | 49% | -440 | 0.205 | 1.00 | 1 of 17 |
| 18 | Weighted vote, equal weights (1 each), score >= 2 | 56974 | 4761 | -412 | 0.76 | 43% | -1961740 | -440 / -367 | 72 | 0.3 | 49% | -458 | 0.143 | 1.00 | 0 of 17 |
| 19 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP and the higher-timeframe trend agree | 7 | 7 | -443 | 0.74 | 43% | -3102 | -1014 / 2982 | -443 | -7.1 | 33% | - | - | - | 1 of 5 |
| 20 | SMC (LuxAlgo) + S/R (prev day H/L) agree | 99 | 87 | -463 | 0.73 | 43% | -40266 | -707 / -101 | -118 | -7.8 | 45% | - | - | - | 4 of 17 |
| 21 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 5 + VWAP agrees | 3645 | 2425 | -535 | 0.70 | 41% | -1297734 | -580 / -468 | -107 | -0.0 | 48% | -549 | 0.409 | 1.00 | 0 of 17 |
| 22 | Weighted vote, equal weights (1 each), score >= 3 + VWAP agrees | 3645 | 2425 | -535 | 0.70 | 41% | -1297734 | -580 / -468 | -107 | -0.0 | 48% | -511 | 0.659 | 1.00 | 0 of 17 |
| 23 | Structure BOS/CHoCH + FVG retest + S/R (prev day H/L) agree + VWAP agrees | 3604 | 2403 | -540 | 0.69 | 41% | -1297404 | -573 / -490 | -111 | 0.0 | 48% | -534 | 0.536 | 1.00 | 0 of 17 |
| 24 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 5 | 4683 | 2832 | -568 | 0.68 | 41% | -1607865 | -614 / -501 | -169 | -0.1 | 48% | -472 | 0.957 | 1.00 | 3 of 17 |
| 25 | Weighted vote, equal weights (1 each), score >= 3 | 4683 | 2832 | -568 | 0.68 | 41% | -1607865 | -614 / -501 | -169 | -0.1 | 48% | -463 | 0.969 | 1.00 | 3 of 17 |
| 26 | FVG retest + S/R (prev day H/L) agree | 4574 | 2785 | -576 | 0.68 | 41% | -1604163 | -627 / -501 | -168 | 0.1 | 48% | -477 | 0.961 | 1.00 | 2 of 17 |
| 27 | Structure BOS/CHoCH + FVG retest + S/R (prev day H/L) agree | 4574 | 2785 | -576 | 0.68 | 41% | -1604163 | -627 / -501 | -168 | 0.1 | 48% | -488 | 0.943 | 1.00 | 2 of 17 |
| 28 | SMC (LuxAlgo) alone | 1093 | 565 | -614 | 0.66 | 40% | -347136 | -588 / -649 | -168 | -0.9 | 48% | -562 | 0.663 | 1.00 | 3 of 17 |
| 29 | Structure + SMC agree, FVG and S/R not against + VWAP agrees | 194 | 142 | -648 | 0.64 | 39% | -92040 | -689 / -595 | -329 | -4.1 | 41% | -397 | 0.843 | 1.00 | 3 of 17 |
| 30 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 4 + VWAP agrees | 194 | 142 | -648 | 0.64 | 39% | -92040 | -689 / -595 | -329 | -4.1 | 41% | -345 | 0.887 | 1.00 | 3 of 17 |
| 31 | Structure BOS/CHoCH + SMC (LuxAlgo) + S/R (prev day H/L) agree | 56 | 51 | -779 | 0.59 | 37% | -39726 | -764 / -804 | -544 | -15.0 | 37% | - | - | - | 3 of 14 |
| 32 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 6 | 56 | 51 | -779 | 0.59 | 37% | -39726 | -764 / -804 | -544 | -15.0 | 37% | - | - | - | 3 of 14 |
| 33 | Structure BOS/CHoCH + SMC (LuxAlgo) agree | 675 | 356 | -806 | 0.58 | 37% | -287058 | -851 / -744 | -316 | -0.8 | 48% | -453 | 0.988 | 1.00 | 1 of 17 |
| 34 | Structure + SMC agree, FVG and S/R not against | 675 | 356 | -806 | 0.58 | 37% | -287058 | -851 / -744 | -316 | -0.8 | 48% | -470 | 0.984 | 1.00 | 1 of 17 |
| 35 | Weighted vote, live weights (structure 2, FVG 1, SMC 2, S/R 0), score >= 4 | 675 | 356 | -806 | 0.58 | 37% | -287058 | -851 / -744 | -316 | -0.8 | 48% | -509 | 0.971 | 1.00 | 1 of 17 |
| 36 | FVG retest + SMC (LuxAlgo) + S/R (prev day H/L) agree | 6 | 6 | -1014 | 0.50 | 33% | -6084 | -614 / -3012 | -1014 | -22.9 | 20% | - | - | - | 1 of 3 |
| 37 | All four agree | 6 | 6 | -1014 | 0.50 | 33% | -6084 | -614 / -3012 | -1014 | -22.9 | 20% | - | - | - | 1 of 3 |
| 38 | Weighted vote, equal weights (1 each), score >= 4 | 6 | 6 | -1014 | 0.50 | 33% | -6084 | -614 / -3012 | -1014 | -22.9 | 20% | - | - | - | 1 of 3 |
| 39 | Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + the higher-timeframe trend (EMA100/200) agree | 13 | 12 | -1014 | 0.50 | 33% | -12168 | -1014 / -1014 | -1014 | -12.6 | 42% | - | - | - | 2 of 9 |
| 40 | FVG retest + SMC (LuxAlgo) + S/R (prev day H/L) agree + VWAP agrees | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -15 / -3012 | -1014 | -31.6 | 0% | - | - | - | 0 of 2 |
| 41 | All four agree + VWAP agrees | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -15 / -3012 | -1014 | -31.6 | 0% | - | - | - | 0 of 2 |
| 42 | Weighted vote, equal weights (1 each), score >= 4 + VWAP agrees | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -15 / -3012 | -1014 | -31.6 | 0% | - | - | - | 0 of 2 |
| 43 | Structure BOS/CHoCH + SMC (LuxAlgo) + S/R (prev day H/L) agree + VWAP agrees | 11 | 10 | -1813 | 0.25 | 20% | -18132 | -2013 / -1513 | -1813 | -14.8 | 18% | - | - | - | 0 of 7 |
| 44 | Weighted vote, S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2), score >= 6 + VWAP agrees | 11 | 10 | -1813 | 0.25 | 20% | -18132 | -2013 / -1513 | -1813 | -14.8 | 18% | - | - | - | 0 of 7 |

## What the numbers say

- Variants with at least 40 trades that beat the random yardstick on the average trade: **14 of 31**.
- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **none**.
- Variants with at least 100 trades and an adjusted p below 0.05 (a real edge after correcting for the 44 tries): **Structure BOS/CHoCH alone**.
- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.

## The focus combination in detail

Symbols in this run: 34 (14 from the original set used in all earlier reports, 20 new ones that were never used to choose anything). Period: 2022-10-10 to 2026-11-13.

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree

- Overall: 56 trades, -336 Rs per trade, profit factor 0.80, win 45%, total -18822 Rs. First 60% -896 (34 trades) / last 40% 530 (22 trades). No-decay best case -229 Rs. Underlying 1h move -1.2 bps, 49% of 57 signals right.
- By year: 2022: 1 trades (too few) | 2023: 15 trades, -1414 Rs (win 27%) | 2024: 15 trades, -614 Rs (win 40%) | 2025: 13 trades, 677 Rs (win 62%) | 2026: 12 trades, -15 Rs (win 50%)
- Original symbols: 28 trades, -871 Rs (win 36%) | new symbols: 28 trades, 199 Rs (win 54%)
- Calls (up) vs puts (down): BUY CE 36 trades, -514 Rs (win 42%) | BUY PE 20 trades, -15 Rs (win 50%)
- Indices vs stocks: 2 trades (too few) | 54 trades, -348 Rs (win 44%)
- Time of day: 10:15-11:30 12 trades, -1014 Rs (win 33%) | 11:30-13:00 14 trades, 413 Rs (win 57%) | 13:00-14:30 30 trades, -415 Rs (win 43%)
- Symbols with 3+ trades (avg Rs): SUNPHARMA 2982 (3), ADANIENT 984 (3), ITC -15 (4), RELIANCE -15 (4), ICICIBANK -1014 (3), KOTAKBANK -1014 (3), BAJAJFINSV -1513 (4), TATASTEEL -1513 (4), AXISBANK -3012 (4)
- Profitable symbols: 2 of 9.

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP agrees

- Overall: 33 trades, 76 Rs per trade, profit factor 1.05, win 52%, total 2502 Rs. First 60% -1119 (19 trades) / last 40% 1698 (14 trades). No-decay best case 76 Rs. Underlying 1h move -4.3 bps, 40% of 30 signals right.
- By year: 2023: 11 trades, -832 Rs (win 36%) | 2024: 7 trades (too few) | 2025: 8 trades (too few) | 2026: 7 trades (too few)
- Original symbols: 16 trades, -390 Rs (win 44%) | new symbols: 17 trades, 514 Rs (win 59%)
- Calls (up) vs puts (down): BUY CE 17 trades, 161 Rs (win 53%) | BUY PE 16 trades, -15 Rs (win 50%)
- Indices vs stocks: 2 trades (too few) | 31 trades, 82 Rs (win 52%)
- Time of day: 10:15-11:30 1 trades (too few) | 11:30-13:00 6 trades (too few) | 13:00-14:30 26 trades, -246 Rs (win 46%)
- Symbols with 3+ trades (avg Rs): AXISBANK -3012 (3)
- Profitable symbols: 0 of 1.

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + the higher-timeframe trend (EMA100/200) agree

- Overall: 12 trades, -1014 Rs per trade, profit factor 0.50, win 33%, total -12168 Rs. First 60% -1014 (9 trades) / last 40% -1014 (3 trades). No-decay best case -1014 Rs. Underlying 1h move -12.6 bps, 42% of 12 signals right.
- By year: 2023: 5 trades (too few) | 2024: 3 trades (too few) | 2025: 2 trades (too few) | 2026: 2 trades (too few)
- Original symbols: 3 trades (too few) | new symbols: 9 trades (too few)
- Calls (up) vs puts (down): BUY CE 9 trades (too few) | BUY PE 3 trades (too few)
- Indices vs stocks: 0 trades (too few) | 12 trades, -1014 Rs (win 33%)
- Time of day: 10:15-11:30 3 trades (too few) | 11:30-13:00 4 trades (too few) | 13:00-14:30 5 trades (too few)

### Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo) agree + VWAP and the higher-timeframe trend agree

- Overall: 7 trades, -443 Rs per trade, profit factor 0.74, win 43%, total -3102 Rs. First 60% -1014 (6 trades) / last 40% 2982 (1 trades). No-decay best case -443 Rs. Underlying 1h move -7.1 bps, 33% of 6 signals right.
- By year: 2023: 5 trades (too few) | 2024: 1 trades (too few) | 2026: 1 trades (too few)
- Original symbols: 2 trades (too few) | new symbols: 5 trades (too few)
- Calls (up) vs puts (down): BUY CE 4 trades (too few) | BUY PE 3 trades (too few)
- Indices vs stocks: 0 trades (too few) | 7 trades (too few)
- Time of day: 10:15-11:30 1 trades (too few) | 11:30-13:00 2 trades (too few) | 13:00-14:30 4 trades (too few)

