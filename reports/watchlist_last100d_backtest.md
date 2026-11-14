# Every strategy on each watchlist stock, and combinations: the last 100 days

Generated 2026-11-14 by `LAST_DAYS=100 MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs watchlist`. **Window: 2026-08-05 to 2026-11-13 (70 trading days).** Stocks: the dashboard scan list that can be traded in options (15): AXISBANK, BHARTIARTL, HDFCBANK, ICICIBANK, INFY, ITC, LT, MARUTI, MAZDOCK, RELIANCE, SBIN, TATASTEEL, TCS, BANK NIFTY, NIFTY 50. SENSEX is left out (no NSE options) and the news strategy too (no headline history). Each strategy is a rule on its own: long when it votes up, short when it votes down (strategy as the app computes it: structure BOS/CHoCH, FVG retest, VWAP side, EMA stack, RSI, volume push, SMC = LuxAlgo port, S/R = previous-day high/low rules). Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, squared off at 15:15 the same day, 10,000 Rs premium per trade, **modelled option prices** with each stock's premium scaled by its volatility, full option charges and a **1% round-trip spread** (the NET column; gross = without the spread). One position per stock at a time. "First half / second half" split the window at its middle.

**Read this first:** about 70 trading days is a short sample. A stock + strategy cell has only a handful to a few dozen trades, so the best-looking cells are partly luck; the "reality check" section counts how many cells would look this good with RANDOM directions. Results are in-sample (nothing is tested on data it was not chosen from).

## 1. Each strategy on each stock: net Rs per trade (number of trades)

| Stock | EMA trend | RSI | VWAP | Structure | FVG retest | Volume push | SMC (LuxAlgo) | Support/resistance |
|---|---|---|---|---|---|---|---|---|
| AXISBANK | -244 (70) | -613 (68) | -193 (77) | -216 (77) | -647 (37) | -263 (40) | -1820 (2) | -110 (36) |
| BHARTIARTL | **84** (70) | **100** (69) | -16 (73) | **6** (74) | -9 (34) | -37 (44) | -180 (3) | -205 (34) |
| HDFCBANK | **40** (72) | -16 (75) | -84 (84) | -219 (82) | -296 (33) | -88 (37) | -3112 (1) | -257 (38) |
| ICICIBANK | -26 (69) | -76 (59) | **502** (73) | **253** (73) | **70** (33) | -37 (42) | -200 (1) | -289 (37) |
| INFY | -734 (82) | -529 (78) | **68** (93) | -354 (94) | -509 (37) | -131 (42) | - | **75** (37) |
| ITC | **27** (74) | **101** (71) | **127** (80) | -340 (81) | -559 (39) | **43** (55) | - | **209** (42) |
| LT | -156 (66) | -187 (60) | **139** (68) | -352 (68) | -171 (37) | -91 (51) | **2796** (1) | -269 (43) |
| MARUTI | **357** (68) | **169** (63) | **196** (75) | **356** (75) | -28 (31) | **205** (48) | -1305 (1) | -166 (41) |
| MAZDOCK | **222** (103) | **463** (88) | **190** (108) | **325** (107) | **551** (32) | **430** (51) | - | **183** (39) |
| RELIANCE | **241** (71) | -95 (64) | -103 (76) | **295** (76) | **91** (38) | -108 (30) | **1114** (1) | -29 (43) |
| SBIN | -49 (70) | **308** (70) | **148** (78) | **76** (77) | **61** (30) | -133 (36) | - | **99** (36) |
| TATASTEEL | -236 (85) | **6** (78) | **342** (94) | -36 (94) | -422 (30) | -303 (55) | -501 (2) | -30 (32) |
| TCS | -599 (85) | -436 (79) | -191 (95) | -311 (95) | **16** (40) | **160** (33) | -562 (1) | -471 (36) |
| BANK NIFTY | -216 (162) | -468 (142) | -51 (182) | -331 (184) | -844 (46) | - | **2835** (1) | **444** (46) |
| NIFTY 50 | **66** (143) | **30** (133) | **120** (162) | **230** (167) | **52** (45) | - | - | -203 (51) |

Bold = positive net after the spread. Cells with fewer than 10 trades are not trusted below.

## 2. Which stock and which strategy went well

**Positive net after the spread, at least 10 trades, and positive in BOTH halves of the window** (24 of 103 cells with 10+ trades):

| Stock | Strategy | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | Net total Rs | First half / second half (trades) |
|---|---|---|---|---|---|---|---|---|
| MAZDOCK | FVG retest | 32 | **551** | 651 | 69% | 1.92 | 17636 | 768 (13) / 403 (19) |
| ICICIBANK | VWAP | 73 | **502** | 602 | 63% | 2.10 | 36614 | 209 (32) / 730 (41) |
| MAZDOCK | RSI | 88 | **463** | 563 | 59% | 1.61 | 40710 | 483 (35) / 449 (53) |
| MAZDOCK | Volume push | 51 | **430** | 530 | 57% | 1.57 | 21920 | 499 (26) / 358 (25) |
| MARUTI | EMA trend | 68 | **357** | 457 | 56% | 1.56 | 24284 | 566 (27) / 219 (41) |
| MARUTI | Structure | 75 | **356** | 456 | 59% | 1.55 | 26687 | 567 (30) / 215 (45) |
| TATASTEEL | VWAP | 94 | **342** | 442 | 57% | 1.45 | 32179 | 591 (49) / 71 (45) |
| MAZDOCK | Structure | 107 | **325** | 425 | 54% | 1.37 | 34760 | 350 (44) / 307 (63) |
| SBIN | RSI | 70 | **308** | 408 | 60% | 1.46 | 21547 | 512 (35) / 103 (35) |
| RELIANCE | Structure | 76 | **295** | 395 | 57% | 1.47 | 22413 | 80 (37) / 499 (39) |
| ICICIBANK | Structure | 73 | **253** | 353 | 59% | 1.43 | 18459 | 150 (32) / 333 (41) |
| RELIANCE | EMA trend | 71 | **241** | 341 | 55% | 1.40 | 17081 | 2 (35) / 473 (36) |
| MAZDOCK | EMA trend | 103 | **222** | 322 | 51% | 1.24 | 22913 | 492 (42) / 37 (61) |
| ITC | Support/resistance | 42 | **209** | 309 | 57% | 1.40 | 8788 | 345 (19) / 97 (23) |
| MARUTI | Volume push | 48 | **205** | 305 | 50% | 1.30 | 9858 | 16 (21) / 353 (27) |
| MARUTI | VWAP | 75 | **196** | 296 | 55% | 1.27 | 14666 | 379 (30) / 73 (45) |
| MAZDOCK | VWAP | 108 | **190** | 290 | 52% | 1.20 | 20507 | 336 (44) / 89 (64) |
| TCS | Volume push | 33 | **160** | 260 | 48% | 1.21 | 5266 | 89 (18) / 245 (15) |
| SBIN | VWAP | 78 | **148** | 248 | 58% | 1.19 | 11581 | 171 (39) / 126 (39) |
| ITC | VWAP | 80 | **127** | 227 | 59% | 1.17 | 10140 | 198 (36) / 68 (44) |
| ITC | RSI | 71 | **101** | 201 | 55% | 1.14 | 7204 | 93 (34) / 109 (37) |
| SBIN | Support/resistance | 36 | **99** | 199 | 58% | 1.16 | 3559 | 94 (19) / 105 (17) |
| SBIN | Structure | 77 | **76** | 176 | 55% | 1.09 | 5833 | 93 (39) / 58 (38) |
| SBIN | FVG retest | 30 | **61** | 161 | 50% | 1.09 | 1836 | 87 (12) / 44 (18) |

**All cells with a positive net and at least 10 trades** (45):

| Stock | Strategy | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | Net total Rs | First half / second half (trades) |
|---|---|---|---|---|---|---|---|---|
| MAZDOCK | FVG retest | 32 | **551** | 651 | 69% | 1.92 | 17636 | 768 (13) / 403 (19) |
| ICICIBANK | VWAP | 73 | **502** | 602 | 63% | 2.10 | 36614 | 209 (32) / 730 (41) |
| MAZDOCK | RSI | 88 | **463** | 563 | 59% | 1.61 | 40710 | 483 (35) / 449 (53) |
| BANK NIFTY | Support/resistance | 46 | **444** | 544 | 65% | 1.50 | 20422 | -561 (27) / 1873 (19) |
| MAZDOCK | Volume push | 51 | **430** | 530 | 57% | 1.57 | 21920 | 499 (26) / 358 (25) |
| MARUTI | EMA trend | 68 | **357** | 457 | 56% | 1.56 | 24284 | 566 (27) / 219 (41) |
| MARUTI | Structure | 75 | **356** | 456 | 59% | 1.55 | 26687 | 567 (30) / 215 (45) |
| TATASTEEL | VWAP | 94 | **342** | 442 | 57% | 1.45 | 32179 | 591 (49) / 71 (45) |
| MAZDOCK | Structure | 107 | **325** | 425 | 54% | 1.37 | 34760 | 350 (44) / 307 (63) |
| SBIN | RSI | 70 | **308** | 408 | 60% | 1.46 | 21547 | 512 (35) / 103 (35) |
| RELIANCE | Structure | 76 | **295** | 395 | 57% | 1.47 | 22413 | 80 (37) / 499 (39) |
| ICICIBANK | Structure | 73 | **253** | 353 | 59% | 1.43 | 18459 | 150 (32) / 333 (41) |
| RELIANCE | EMA trend | 71 | **241** | 341 | 55% | 1.40 | 17081 | 2 (35) / 473 (36) |
| NIFTY 50 | Structure | 167 | **230** | 330 | 56% | 1.20 | 38334 | -171 (48) / 391 (119) |
| MAZDOCK | EMA trend | 103 | **222** | 322 | 51% | 1.24 | 22913 | 492 (42) / 37 (61) |
| ITC | Support/resistance | 42 | **209** | 309 | 57% | 1.40 | 8788 | 345 (19) / 97 (23) |
| MARUTI | Volume push | 48 | **205** | 305 | 50% | 1.30 | 9858 | 16 (21) / 353 (27) |
| MARUTI | VWAP | 75 | **196** | 296 | 55% | 1.27 | 14666 | 379 (30) / 73 (45) |
| MAZDOCK | VWAP | 108 | **190** | 290 | 52% | 1.20 | 20507 | 336 (44) / 89 (64) |
| MAZDOCK | Support/resistance | 39 | **183** | 283 | 51% | 1.23 | 7152 | 719 (17) / -230 (22) |
| MARUTI | RSI | 63 | **169** | 269 | 59% | 1.24 | 10635 | 421 (28) / -33 (35) |
| TCS | Volume push | 33 | **160** | 260 | 48% | 1.21 | 5266 | 89 (18) / 245 (15) |
| SBIN | VWAP | 78 | **148** | 248 | 58% | 1.19 | 11581 | 171 (39) / 126 (39) |
| LT | VWAP | 68 | **139** | 239 | 51% | 1.21 | 9433 | -229 (34) / 506 (34) |
| ITC | VWAP | 80 | **127** | 227 | 59% | 1.17 | 10140 | 198 (36) / 68 (44) |
| NIFTY 50 | VWAP | 162 | **120** | 220 | 54% | 1.10 | 19404 | -351 (48) / 318 (114) |
| ITC | RSI | 71 | **101** | 201 | 55% | 1.14 | 7204 | 93 (34) / 109 (37) |
| BHARTIARTL | RSI | 69 | **100** | 200 | 57% | 1.12 | 6887 | -103 (33) / 286 (36) |
| SBIN | Support/resistance | 36 | **99** | 199 | 58% | 1.16 | 3559 | 94 (19) / 105 (17) |
| RELIANCE | FVG retest | 38 | **91** | 191 | 50% | 1.15 | 3467 | -193 (19) / 375 (19) |
| BHARTIARTL | EMA trend | 70 | **84** | 184 | 53% | 1.11 | 5881 | -95 (33) / 244 (37) |
| SBIN | Structure | 77 | **76** | 176 | 55% | 1.09 | 5833 | 93 (39) / 58 (38) |
| INFY | Support/resistance | 37 | **75** | 175 | 38% | 1.09 | 2781 | -798 (17) / 817 (20) |
| ICICIBANK | FVG retest | 33 | **70** | 170 | 55% | 1.13 | 2322 | -33 (16) / 168 (17) |
| INFY | VWAP | 93 | **68** | 168 | 55% | 1.08 | 6313 | -190 (35) / 223 (58) |
| NIFTY 50 | EMA trend | 143 | **66** | 166 | 52% | 1.05 | 9427 | -713 (42) / 390 (101) |
| SBIN | FVG retest | 30 | **61** | 161 | 50% | 1.09 | 1836 | 87 (12) / 44 (18) |
| NIFTY 50 | FVG retest | 45 | **52** | 152 | 51% | 1.05 | 2338 | -397 (17) / 325 (28) |
| ITC | Volume push | 55 | **43** | 143 | 51% | 1.07 | 2346 | 102 (26) / -10 (29) |
| HDFCBANK | EMA trend | 72 | **40** | 140 | 51% | 1.05 | 2909 | -63 (33) / 128 (39) |
| NIFTY 50 | RSI | 133 | **30** | 130 | 52% | 1.02 | 3952 | -395 (47) / 262 (86) |
| ITC | EMA trend | 74 | **27** | 127 | 53% | 1.03 | 2009 | -129 (35) / 167 (39) |
| TCS | FVG retest | 40 | **16** | 116 | 48% | 1.02 | 629 | 186 (23) / -215 (17) |
| BHARTIARTL | Structure | 74 | **6** | 106 | 55% | 1.01 | 437 | -290 (34) / 258 (40) |
| TATASTEEL | RSI | 78 | **6** | 106 | 50% | 1.01 | 433 | 483 (42) / -551 (36) |

The other 58 cells with 10+ trades lost money after the spread.

## 3. Each strategy across the whole watchlist

| Strategy | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | First half / second half | Stocks profitable (10+ trades) |
|---|---|---|---|---|---|---|---|
| VWAP | 1418 | **72** | 172 | 53% | 1.08 | 53 / 86 | 9 of 15 |
| Volume push | 564 | **-22** | 78 | 47% | 0.97 | -17 / -26 | 4 of 13 |
| Structure | 1424 | **-47** | 53 | 50% | 0.95 | -97 / -11 | 7 of 15 |
| Support/resistance | 591 | **-62** | 38 | 47% | 0.93 | -295 / 185 | 5 of 15 |
| EMA trend | 1290 | **-89** | 11 | 48% | 0.91 | -183 / -20 | 7 of 15 |
| RSI | 1197 | **-96** | 4 | 50% | 0.90 | -109 / -86 | 7 of 15 |
| FVG retest | 542 | **-194** | -94 | 46% | 0.78 | -260 / -131 | 6 of 15 |
| SMC (LuxAlgo) | 14 | **-258** | -158 | 21% | 0.65 | -2 / -515 | 0 of 0 |

## 4. Combinations across the whole watchlist (all must agree)

84 pairs and triples; 55 have 30+ trades. Best 15 and worst 5:

| Combination | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | First half / second half |
|---|---|---|---|---|---|---|
| EMA trend + Volume push + Support/resistance | 107 | **241** | 341 | 50% | 1.47 | 167 / 355 |
| EMA trend + RSI + Volume push | 207 | **235** | 335 | 55% | 1.47 | 261 / 207 |
| VWAP + Volume push + Support/resistance | 120 | **206** | 306 | 50% | 1.39 | 113 / 356 |
| EMA trend + VWAP + Volume push | 337 | **188** | 288 | 53% | 1.32 | 140 / 237 |
| EMA trend + Structure + Volume push | 345 | **173** | 273 | 53% | 1.28 | 59 / 286 |
| EMA trend + Volume push | 366 | **160** | 260 | 52% | 1.26 | 101 / 219 |
| RSI + Volume push + Support/resistance | 79 | **126** | 226 | 52% | 1.24 | -5 / 308 |
| Structure + Volume push + Support/resistance | 120 | **75** | 175 | 47% | 1.13 | -26 / 231 |
| RSI + Structure + Volume push | 241 | **75** | 175 | 52% | 1.12 | 109 / 36 |
| VWAP + Structure + Volume push | 388 | **69** | 169 | 51% | 1.10 | 74 / 64 |
| Volume push + Support/resistance | 146 | **68** | 168 | 47% | 1.11 | 51 / 94 |
| RSI + VWAP + Volume push | 265 | **67** | 167 | 52% | 1.11 | 148 / -27 |
| Structure + Volume push | 426 | **60** | 160 | 51% | 1.09 | 43 / 78 |
| RSI + Volume push | 283 | **51** | 151 | 52% | 1.08 | 143 / -56 |
| VWAP + Volume push | 472 | **35** | 135 | 50% | 1.05 | 30 / 41 |
| EMA trend + FVG retest | 440 | **-201** | -101 | 47% | 0.77 | -381 / -32 |
| EMA trend + VWAP + FVG retest | 371 | **-231** | -131 | 47% | 0.73 | -398 / -67 |
| VWAP + Structure + FVG retest | 465 | **-259** | -159 | 45% | 0.71 | -324 / -196 |
| VWAP + FVG retest | 465 | **-259** | -159 | 45% | 0.71 | -324 / -196 |
| VWAP + FVG retest + Support/resistance | 91 | **-269** | -169 | 48% | 0.71 | -516 / -37 |

Combinations with 30+ trades that are positive after the spread AND in both halves: **EMA trend + Volume push + Support/resistance (107 trades, 241 Rs); EMA trend + RSI + Volume push (207 trades, 235 Rs); VWAP + Volume push + Support/resistance (120 trades, 206 Rs); EMA trend + VWAP + Volume push (337 trades, 188 Rs); EMA trend + Structure + Volume push (345 trades, 173 Rs); EMA trend + Volume push (366 trades, 160 Rs); RSI + Structure + Volume push (241 trades, 75 Rs); VWAP + Structure + Volume push (388 trades, 69 Rs); Volume push + Support/resistance (146 trades, 68 Rs); Structure + Volume push (426 trades, 60 Rs); VWAP + Volume push (472 trades, 35 Rs)**.

## 5. Best combination for each stock

Out of 84 pairs and triples per stock, the best one with at least 10 trades (this is the most over-fitted view: the more combinations tried, the better the best one looks by chance):

| Stock | Best combination | Trades | Net Rs/trade | Gross | Win | First half / second half |
|---|---|---|---|---|---|---|
| AXISBANK | EMA trend + Structure | 64 | **-204** | -104 | 42% | -114 / -278 |
| BHARTIARTL | EMA trend + RSI + FVG retest | 24 | **267** | 367 | 63% | -250 / 704 |
| HDFCBANK | VWAP + Structure + Volume push | 26 | **452** | 552 | 69% | 387 / 541 |
| ICICIBANK | VWAP + Structure | 67 | **410** | 510 | 64% | 326 / 478 |
| INFY | VWAP + Structure | 78 | **-148** | -48 | 44% | -459 / 68 |
| ITC | EMA trend + Volume push + Support/resistance | 14 | **1012** | 1112 | 79% | 831 / 1112 |
| LT | EMA trend + RSI + Volume push | 22 | **604** | 704 | 73% | 364 / 1024 |
| MARUTI | EMA trend + Structure + Volume push | 30 | **967** | 1067 | 70% | 669 / 1228 |
| MAZDOCK | EMA trend + RSI + Volume push | 10 | **1633** | 1733 | 80% | 1096 / 2170 |
| RELIANCE | EMA trend + VWAP + Volume push | 16 | **561** | 661 | 56% | 12 / 1110 |
| SBIN | EMA trend + RSI + Volume push | 11 | **1224** | 1324 | 82% | 1109 / 1320 |
| TATASTEEL | RSI + VWAP + Support/resistance | 13 | **622** | 722 | 62% | 605 / 650 |
| TCS | VWAP + Structure + Volume push | 23 | **296** | 396 | 52% | 576 / -140 |
| BANK NIFTY | VWAP + Structure + Support/resistance | 23 | **687** | 787 | 70% | -465 / 1944 |
| NIFTY 50 | RSI + VWAP + FVG retest | 26 | **483** | 583 | 62% | -427 / 1052 |

## 6. Reality check: how many cells look good by luck

The same signals, but each trade's direction flipped by a coin toss, repeated 20 times (the "luck" column is the range over those repeats). If the real count is not clearly above that range, the good-looking cells are what luck produces.

| | Real | Luck (random directions), range over 20 repeats |
|---|---|---|
| Stock x strategy cells with 10+ trades | 103 | 103-103 |
| ... with positive net | 45 | 20-36 (median 30) |
| ... with net above +100 Rs per trade | 27 | 10-25 (median 17) |
| ... best single cell (Rs per trade) | 551 | 352-769 |
| Stock x combination cells with 10+ trades | 613 | 613-613 |
| ... with positive net | 272 | 164-212 (median 182) |
| ... with net above +100 Rs per trade | 210 | 109-155 (median 125) |
| ... best combination cell (Rs per trade) | 1633 | 651-1764 |

