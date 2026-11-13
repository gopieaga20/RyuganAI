# Every strategy tested separately

Generated 2026-11-13 by `node tools/bt_strategies.mjs each`. Each strategy runs ALONE through the same engine: signal on a bar close, fill at the next bar open, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying, ATM option held to stop (-30%) or target (+30%), 10,000 Rs premium per trade after full option charges. Data: 14 symbols (2 indices, 12 stocks), 2 years of 15-minute candles. **Option prices are a model** (no historical option candles exist): "realistic" includes time decay, "no decay" is a best case no real option achieves. The **underlying 1h move** column needs no option model: the average move of the underlying in the signal direction over the next hour, in basis points.

## Ranking (best average per trade first)

| Rank | Strategy | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | VWAP side | 88173 | 2124 | -228 | 0.86 | 46% | -484855 | -496110 | -18132 | -279 / -171 | 269 | 0.9 | 50% |
| 2 | Bollinger breakout | 6659 | 1887 | -277 | 0.83 | 46% | -522810 | -574536 | -21084 | -341 / -197 | 115 | 1.5 | 50% |
| 3 | Bollinger mid-band side | 88161 | 2111 | -299 | 0.82 | 45% | -630734 | -645810 | -21174 | -309 / -288 | 183 | 0.2 | 49% |
| 4 | FVG retest | 6276 | 1966 | -303 | 0.82 | 45% | -595640 | -632154 | -21174 | -331 / -270 | 73 | 0.6 | 49% |
| 5 | Sweep then CHoCH | 946 | 630 | -329 | 0.80 | 45% | -207252 | -222162 | -15060 | -415 / -215 | 76 | 1.5 | 50% |
| 6 | SMC + displacement candle | 710 | 409 | -330 | 0.80 | 45% | -135006 | -158742 | -9036 | -397 / -232 | 29 | 0.0 | 51% |
| 7 | RANDOM direction (yardstick) | 12544 | 2190 | -348 | 0.79 | 44% | -762370 | -804126 | -18252 | -512 / -162 | 62 | -0.2 | 49% |
| 8 | Sweep then CHoCH: on the CHoCH candle | 402 | 392 | -351 | 0.79 | 44% | -137748 | -149676 | -9036 | -470 / -193 | 46 | 1.8 | 49% |
| 9 | Support / resistance (all three setups) | 8940 | 2084 | -385 | 0.77 | 44% | -802626 | -849588 | -24186 | -465 / -293 | 59 | 0.9 | 50% |
| 10 | SMC (structure + order block / gap / sweep + discount-premium) | 3116 | 1387 | -389 | 0.77 | 44% | -539286 | -559590 | -21084 | -409 / -362 | -17 | -0.6 | 49% |
| 11 | Structure BOS / CHoCH | 88173 | 2114 | -391 | 0.77 | 44% | -825584 | -825584 | -30240 | -361 / -423 | 97 | -0.0 | 50% |
| 12 | Sweep then CHoCH: on the pullback | 544 | 368 | -422 | 0.75 | 43% | -155370 | -172962 | -9036 | -422 / -422 | 10 | 1.3 | 51% |
| 13 | S/R breakout | 4143 | 1617 | -430 | 0.75 | 43% | -694611 | -715215 | -24216 | -479 / -366 | 52 | 1.5 | 50% |
| 14 | Volume push | 6167 | 1853 | -431 | 0.75 | 43% | -798024 | -832578 | -21084 | -461 / -395 | 37 | 1.5 | 49% |
| 15 | S/R break-and-retest | 1919 | 1089 | -477 | 0.73 | 42% | -519548 | -527532 | -21084 | -453 / -509 | -45 | -0.1 | 51% |
| 16 | SMC part: order-block retest | 3009 | 1143 | -484 | 0.72 | 42% | -553608 | -556590 | -21174 | -602 / -322 | -47 | 0.1 | 49% |
| 17 | EMA trend 9/21/50 | 72454 | 2110 | -485 | 0.72 | 42% | -1023326 | -1026594 | -27228 | -502 / -465 | 46 | -0.8 | 49% |
| 18 | SMC part: premium / discount half | 59582 | 2042 | -486 | 0.72 | 42% | -993115 | -1020702 | -27138 | -596 / -360 | -62 | -0.1 | 50% |
| 19 | RSI momentum | 52962 | 2083 | -491 | 0.72 | 42% | -1023682 | -1037682 | -27198 | -548 / -426 | 24 | 0.1 | 50% |
| 20 | SMC part: liquidity sweep | 3064 | 1528 | -509 | 0.71 | 42% | -778164 | -792024 | -18102 | -613 / -385 | -112 | -0.1 | 50% |
| 21 | S/R rejection (reversal) | 2933 | 1523 | -510 | 0.71 | 42% | -777440 | -809016 | -21144 | -619 / -372 | -32 | 0.5 | 49% |
| 22 | Hourly trend (EMA100/200 on 15m) | 61465 | 2114 | -515 | 0.71 | 42% | -1089320 | -1101564 | -39426 | -596 / -424 | 33 | -1.3 | 49% |
| 23 | Sweep then CHoCH with a displacement candle | 244 | 169 | -529 | 0.70 | 41% | -89448 | -98394 | -6024 | -565 / -479 | -86 | -1.8 | 48% |
| 24 | Bollinger reversal | 6659 | 1899 | -608 | 0.66 | 40% | -1155477 | -1163928 | -39186 | -706 / -492 | -162 | -1.5 | 49% |

The random yardstick averages **-348 Rs per trade**. 6 of 23 strategies beat it on the average trade; **0 are profitable** in the realistic model.

## One section per strategy

### RANDOM direction (yardstick)

*A coin flip for the direction, through the same entry gates. This is what "no skill" costs.*

- **Overall (realistic option model):** 2190 trades, -348 Rs per trade, total -762370 Rs, profit factor 0.79, win rate 44%, max drawdown -804126, worst day -18252.
- **Best case, no time decay:** 62 Rs per trade, profit factor 1.04.
- **The underlying itself:** -0.2 bps over the next hour, 49% of signals moved the right way (11251 signals).
- **Calls (up) vs puts (down):** BUY CE: 1076 trades, -362 Rs (PF 0.78) | BUY PE: 1114 trades, -334 Rs (PF 0.80)
- **Indices vs stocks:** indices: 271 trades, 129 Rs (PF 1.09) | stocks: 1919 trades, -415 Rs (PF 0.76)
- **Time of day:** 10:15-11:30: 1306 trades, -402 Rs (PF 0.76) | 11:30-13:00: 418 trades, -230 Rs (PF 0.86) | 13:00-14:30: 466 trades, -303 Rs (PF 0.82)
- **By year:** 2024: 178 trades, 52 Rs (PF 1.04) | 2025: 937 trades, -607 Rs (PF 0.66) | 2026: 1075 trades, -189 Rs (PF 0.88)
- **Best / worst symbols (15+ trades):** best NSEBANK 610 (139), SBIN NS -97 (137), TCS NS -124 (137) | worst ICICIBANK NS -755 (162), HDFCBANK NS -643 (167), ITC NS -605 (127)

### EMA trend 9/21/50

*Bullish when EMA9 > EMA21 > EMA50 and price is above all three; bearish for the mirror.*

- **Overall (realistic option model):** 2110 trades, -485 Rs per trade, total -1023326 Rs, profit factor 0.72, win rate 42%, max drawdown -1026594, worst day -27228.
- **Best case, no time decay:** 46 Rs per trade, profit factor 1.03.
- **The underlying itself:** -0.8 bps over the next hour, 49% of signals moved the right way (64812 signals).
- **Calls (up) vs puts (down):** BUY CE: 1052 trades, -559 Rs (PF 0.69) | BUY PE: 1058 trades, -412 Rs (PF 0.76)
- **Indices vs stocks:** indices: 21 trades, -443 Rs (PF 0.74) | stocks: 2089 trades, -485 Rs (PF 0.72)
- **Time of day:** 10:15-11:30: 1338 trades, -514 Rs (PF 0.71) | 11:30-13:00: 345 trades, -458 Rs (PF 0.74) | 13:00-14:30: 427 trades, -415 Rs (PF 0.76)
- **By year:** 2024: 182 trades, -608 Rs (PF 0.66) | 2025: 909 trades, -506 Rs (PF 0.71) | 2026: 1019 trades, -444 Rs (PF 0.74)
- **Best / worst symbols (15+ trades):** best TATASTEEL NS 235 (48), LT NS -315 (140), RELIANCE NS -378 (66) | worst SBIN NS -1060 (43), MARUTI NS -856 (114), ICICIBANK NS -777 (244)

### RSI momentum

*RSI(14) between 55 and 75 is bullish, between 25 and 45 bearish; overbought / oversold extremes are ignored.*

- **Overall (realistic option model):** 2083 trades, -491 Rs per trade, total -1023682 Rs, profit factor 0.72, win rate 42%, max drawdown -1037682, worst day -27198.
- **Best case, no time decay:** 24 Rs per trade, profit factor 1.02.
- **The underlying itself:** 0.1 bps over the next hour, 50% of signals moved the right way (47345 signals).
- **Calls (up) vs puts (down):** BUY CE: 1014 trades, -559 Rs (PF 0.69) | BUY PE: 1069 trades, -427 Rs (PF 0.75)
- **Indices vs stocks:** indices: 50 trades, 704 Rs (PF 1.62) | stocks: 2033 trades, -521 Rs (PF 0.70)
- **Time of day:** 10:15-11:30: 1314 trades, -517 Rs (PF 0.71) | 11:30-13:00: 347 trades, -559 Rs (PF 0.69) | 13:00-14:30: 422 trades, -356 Rs (PF 0.79)
- **By year:** 2024: 182 trades, -542 Rs (PF 0.69) | 2025: 900 trades, -568 Rs (PF 0.68) | 2026: 1001 trades, -414 Rs (PF 0.76)
- **Best / worst symbols (15+ trades):** best NSEBANK 984 (33), NSEI 161 (17), BHARTIARTL NS -105 (263) | worst ITC NS -1061 (164), MARUTI NS -1000 (143), HDFCBANK NS -733 (242)

### VWAP side

*Price above the day's VWAP is bullish, below is bearish.*

- **Overall (realistic option model):** 2124 trades, -228 Rs per trade, total -484855 Rs, profit factor 0.86, win rate 46%, max drawdown -496110, worst day -18132.
- **Best case, no time decay:** 269 Rs per trade, profit factor 1.20.
- **The underlying itself:** 0.9 bps over the next hour, 50% of signals moved the right way (79037 signals).
- **Calls (up) vs puts (down):** BUY CE: 1063 trades, -255 Rs (PF 0.84) | BUY PE: 1061 trades, -202 Rs (PF 0.87)
- **Indices vs stocks:** indices: 6 trades (too few) | stocks: 2118 trades, -232 Rs (PF 0.86)
- **Time of day:** 10:15-11:30: 1364 trades, -264 Rs (PF 0.84) | 11:30-13:00: 324 trades, -52 Rs (PF 0.97) | 13:00-14:30: 436 trades, -249 Rs (PF 0.85)
- **By year:** 2024: 190 trades, -173 Rs (PF 0.89) | 2025: 899 trades, -338 Rs (PF 0.80) | 2026: 1035 trades, -143 Rs (PF 0.91)
- **Best / worst symbols (15+ trades):** best AXISBANK NS -76 (396), INFY NS -84 (391), HDFCBANK NS -95 (339) | worst MARUTI NS -1125 (54), ICICIBANK NS -739 (298), LT NS -443 (84)

### Structure BOS / CHoCH

*The direction of the latest break of structure (higher-high / lower-low).*

- **Overall (realistic option model):** 2114 trades, -391 Rs per trade, total -825584 Rs, profit factor 0.77, win rate 44%, max drawdown -825584, worst day -30240.
- **Best case, no time decay:** 97 Rs per trade, profit factor 1.07.
- **The underlying itself:** -0.0 bps over the next hour, 50% of signals moved the right way (79037 signals).
- **Calls (up) vs puts (down):** BUY CE: 1071 trades, -390 Rs (PF 0.77) | BUY PE: 1043 trades, -391 Rs (PF 0.77)
- **Indices vs stocks:** indices: 4 trades (too few) | stocks: 2110 trades, -386 Rs (PF 0.77)
- **Time of day:** 10:15-11:30: 1338 trades, -398 Rs (PF 0.77) | 11:30-13:00: 345 trades, -319 Rs (PF 0.81) | 13:00-14:30: 431 trades, -425 Rs (PF 0.75)
- **By year:** 2024: 189 trades, -507 Rs (PF 0.71) | 2025: 894 trades, -337 Rs (PF 0.80) | 2026: 1031 trades, -416 Rs (PF 0.76)
- **Best / worst symbols (15+ trades):** best HDFCBANK NS -299 (327), INFY NS -313 (402), AXISBANK NS -346 (389) | worst ITC NS -571 (167), ICICIBANK NS -568 (287), LT NS -412 (83)

### FVG retest

*Price retests a fresh fair value gap in the direction of the structure and rejects it.*

- **Overall (realistic option model):** 1966 trades, -303 Rs per trade, total -595640 Rs, profit factor 0.82, win rate 45%, max drawdown -632154, worst day -21174.
- **Best case, no time decay:** 73 Rs per trade, profit factor 1.05.
- **The underlying itself:** 0.6 bps over the next hour, 49% of signals moved the right way (5677 signals).
- **Calls (up) vs puts (down):** BUY CE: 976 trades, -386 Rs (PF 0.77) | BUY PE: 990 trades, -221 Rs (PF 0.86)
- **Indices vs stocks:** indices: 297 trades, 298 Rs (PF 1.22) | stocks: 1669 trades, -410 Rs (PF 0.76)
- **Time of day:** 10:15-11:30: 921 trades, -255 Rs (PF 0.84) | 11:30-13:00: 599 trades, -330 Rs (PF 0.80) | 13:00-14:30: 446 trades, -364 Rs (PF 0.78)
- **By year:** 2024: 161 trades, -369 Rs (PF 0.78) | 2025: 858 trades, -378 Rs (PF 0.78) | 2026: 947 trades, -224 Rs (PF 0.86)
- **Best / worst symbols (15+ trades):** best NSEI 651 (144), NSEBANK -35 (153), TATASTEEL NS -58 (138) | worst ICICIBANK NS -703 (135), HDFCBANK NS -688 (147), ITC NS -657 (112)

### Volume push

*A candle on more than 1.5x the average volume, closing in its direction.*

- **Overall (realistic option model):** 1853 trades, -431 Rs per trade, total -798024 Rs, profit factor 0.75, win rate 43%, max drawdown -832578, worst day -21084.
- **Best case, no time decay:** 37 Rs per trade, profit factor 1.02.
- **The underlying itself:** 1.5 bps over the next hour, 49% of signals moved the right way (4258 signals).
- **Calls (up) vs puts (down):** BUY CE: 1004 trades, -475 Rs (PF 0.73) | BUY PE: 849 trades, -379 Rs (PF 0.78)
- **Indices vs stocks:** indices: 0 trades (too few) | stocks: 1853 trades, -431 Rs (PF 0.75)
- **Time of day:** 10:15-11:30: 632 trades, -394 Rs (PF 0.77) | 11:30-13:00: 474 trades, -217 Rs (PF 0.86) | 13:00-14:30: 747 trades, -597 Rs (PF 0.67)
- **By year:** 2024: 144 trades, -15 Rs (PF 0.99) | 2025: 822 trades, -555 Rs (PF 0.69) | 2026: 887 trades, -383 Rs (PF 0.77)
- **Best / worst symbols (15+ trades):** best TCS NS -215 (120), MARUTI NS -228 (183), SBIN NS -298 (148) | worst BHARTIARTL NS -826 (170), ICICIBANK NS -631 (146), RELIANCE NS -535 (121)

### Bollinger reversal

*Close outside the Bollinger band (20, 2): bets on a return to the middle (below the lower band = up).*

- **Overall (realistic option model):** 1899 trades, -608 Rs per trade, total -1155477 Rs, profit factor 0.66, win rate 40%, max drawdown -1163928, worst day -39186.
- **Best case, no time decay:** -162 Rs per trade, profit factor 0.90.
- **The underlying itself:** -1.5 bps over the next hour, 49% of signals moved the right way (5766 signals).
- **Calls (up) vs puts (down):** BUY CE: 926 trades, -727 Rs (PF 0.61) | BUY PE: 973 trades, -496 Rs (PF 0.72)
- **Indices vs stocks:** indices: 196 trades, -382 Rs (PF 0.77) | stocks: 1703 trades, -635 Rs (PF 0.65)
- **Time of day:** 10:15-11:30: 982 trades, -561 Rs (PF 0.68) | 11:30-13:00: 342 trades, -996 Rs (PF 0.50) | 13:00-14:30: 575 trades, -458 Rs (PF 0.74)
- **By year:** 2024: 156 trades, -822 Rs (PF 0.57) | 2025: 827 trades, -671 Rs (PF 0.63) | 2026: 916 trades, -516 Rs (PF 0.71)
- **Best / worst symbols (15+ trades):** best NSEBANK -139 (121), INFY NS -232 (138), BHARTIARTL NS -365 (154) | worst TATASTEEL NS -960 (149), ICICIBANK NS -919 (126), LT NS -843 (134)

### Bollinger breakout

*Close outside the Bollinger band (20, 2): rides the breakout (above the upper band = up).*

- **Overall (realistic option model):** 1887 trades, -277 Rs per trade, total -522810 Rs, profit factor 0.83, win rate 46%, max drawdown -574536, worst day -21084.
- **Best case, no time decay:** 115 Rs per trade, profit factor 1.08.
- **The underlying itself:** 1.5 bps over the next hour, 50% of signals moved the right way (5766 signals).
- **Calls (up) vs puts (down):** BUY CE: 964 trades, -326 Rs (PF 0.80) | BUY PE: 923 trades, -226 Rs (PF 0.86)
- **Indices vs stocks:** indices: 196 trades, 77 Rs (PF 1.05) | stocks: 1691 trades, -318 Rs (PF 0.81)
- **Time of day:** 10:15-11:30: 973 trades, -314 Rs (PF 0.81) | 11:30-13:00: 345 trades, -58 Rs (PF 0.96) | 13:00-14:30: 569 trades, -347 Rs (PF 0.79)
- **By year:** 2024: 157 trades, 119 Rs (PF 1.08) | 2025: 849 trades, -449 Rs (PF 0.74) | 2026: 881 trades, -182 Rs (PF 0.89)
- **Best / worst symbols (15+ trades):** best NSEI 504 (75), TATASTEEL NS 379 (152), AXISBANK NS -141 (167) | worst ICICIBANK NS -770 (123), ITC NS -544 (136), LT NS -469 (132)

### Bollinger mid-band side

*Close above the middle band is bullish, below is bearish.*

- **Overall (realistic option model):** 2111 trades, -299 Rs per trade, total -630734 Rs, profit factor 0.82, win rate 45%, max drawdown -645810, worst day -21174.
- **Best case, no time decay:** 183 Rs per trade, profit factor 1.13.
- **The underlying itself:** 0.2 bps over the next hour, 49% of signals moved the right way (79028 signals).
- **Calls (up) vs puts (down):** BUY CE: 1074 trades, -285 Rs (PF 0.83) | BUY PE: 1037 trades, -313 Rs (PF 0.81)
- **Indices vs stocks:** indices: 5 trades (too few) | stocks: 2106 trades, -298 Rs (PF 0.82)
- **Time of day:** 10:15-11:30: 1341 trades, -354 Rs (PF 0.79) | 11:30-13:00: 337 trades, -220 Rs (PF 0.86) | 13:00-14:30: 433 trades, -188 Rs (PF 0.88)
- **By year:** 2024: 189 trades, -316 Rs (PF 0.81) | 2025: 892 trades, -311 Rs (PF 0.81) | 2026: 1030 trades, -285 Rs (PF 0.83)
- **Best / worst symbols (15+ trades):** best AXISBANK NS -77 (386), HDFCBANK NS -114 (333), MARUTI NS -325 (58) | worst INFY NS -486 (401), LT NS -432 (79), ICICIBANK NS -398 (282)

### Hourly trend (EMA100/200 on 15m)

*Price above EMA100 and EMA100 above EMA200 is bullish; the mirror is bearish.*

- **Overall (realistic option model):** 2114 trades, -515 Rs per trade, total -1089320 Rs, profit factor 0.71, win rate 42%, max drawdown -1101564, worst day -39426.
- **Best case, no time decay:** 33 Rs per trade, profit factor 1.02.
- **The underlying itself:** -1.3 bps over the next hour, 49% of signals moved the right way (54995 signals).
- **Calls (up) vs puts (down):** BUY CE: 982 trades, -573 Rs (PF 0.68) | BUY PE: 1132 trades, -465 Rs (PF 0.73)
- **Indices vs stocks:** indices: 45 trades, -348 Rs (PF 0.79) | stocks: 2069 trades, -519 Rs (PF 0.70)
- **Time of day:** 10:15-11:30: 1337 trades, -557 Rs (PF 0.69) | 11:30-13:00: 331 trades, -531 Rs (PF 0.70) | 13:00-14:30: 446 trades, -378 Rs (PF 0.78)
- **By year:** 2024: 148 trades, -460 Rs (PF 0.73) | 2025: 936 trades, -636 Rs (PF 0.65) | 2026: 1030 trades, -413 Rs (PF 0.76)
- **Best / worst symbols (15+ trades):** best TCS NS -15 (44), NSEI -15 (16), TATASTEEL NS -61 (65) | worst BHARTIARTL NS -731 (259), SBIN NS -720 (68), ITC NS -669 (197)

### SMC (structure + order block / gap / sweep + discount-premium)

*Structure bias, a point of interest (order block, gap or liquidity sweep) in that direction, in the discount (long) or premium (short) half.*

- **Overall (realistic option model):** 1387 trades, -389 Rs per trade, total -539286 Rs, profit factor 0.77, win rate 44%, max drawdown -559590, worst day -21084.
- **Best case, no time decay:** -17 Rs per trade, profit factor 0.99.
- **The underlying itself:** -0.6 bps over the next hour, 49% of signals moved the right way (2815 signals).
- **Calls (up) vs puts (down):** BUY CE: 711 trades, -643 Rs (PF 0.65) | BUY PE: 676 trades, -121 Rs (PF 0.92)
- **Indices vs stocks:** indices: 220 trades, 176 Rs (PF 1.12) | stocks: 1167 trades, -495 Rs (PF 0.72)
- **Time of day:** 10:15-11:30: 450 trades, -375 Rs (PF 0.78) | 11:30-13:00: 486 trades, -311 Rs (PF 0.81) | 13:00-14:30: 451 trades, -487 Rs (PF 0.72)
- **By year:** 2024: 117 trades, -297 Rs (PF 0.82) | 2025: 635 trades, -435 Rs (PF 0.75) | 2026: 635 trades, -360 Rs (PF 0.79)
- **Best / worst symbols (15+ trades):** best NSEI 387 (97), NSEBANK 9 (123), INFY NS -238 (121) | worst RELIANCE NS -932 (98), ITC NS -774 (75), LT NS -741 (95)

### SMC + displacement candle

*The same, but the structure break behind it must have been a big one-directional candle.*

- **Overall (realistic option model):** 409 trades, -330 Rs per trade, total -135006 Rs, profit factor 0.80, win rate 45%, max drawdown -158742, worst day -9036.
- **Best case, no time decay:** 29 Rs per trade, profit factor 1.02.
- **The underlying itself:** 0.0 bps over the next hour, 51% of signals moved the right way (655 signals).
- **Calls (up) vs puts (down):** BUY CE: 225 trades, -534 Rs (PF 0.70) | BUY PE: 184 trades, -80 Rs (PF 0.95)
- **Indices vs stocks:** indices: 53 trades, 42 Rs (PF 1.03) | stocks: 356 trades, -385 Rs (PF 0.77)
- **Time of day:** 10:15-11:30: 115 trades, -458 Rs (PF 0.74) | 11:30-13:00: 164 trades, -88 Rs (PF 0.94) | 13:00-14:30: 130 trades, -522 Rs (PF 0.70)
- **By year:** 2024: 32 trades, -952 Rs (PF 0.52) | 2025: 202 trades, -341 Rs (PF 0.80) | 2026: 175 trades, -203 Rs (PF 0.87)
- **Best / worst symbols (15+ trades):** best NSEI 485 (24), INFY NS 257 (44), ICICIBANK NS 216 (26) | worst LT NS -1168 (26), MARUTI NS -1078 (31), ITC NS -927 (23)

### SMC part: order-block retest

*Price taps an unmitigated order block in the direction of the structure and rejects it.*

- **Overall (realistic option model):** 1143 trades, -484 Rs per trade, total -553608 Rs, profit factor 0.72, win rate 42%, max drawdown -556590, worst day -21174.
- **Best case, no time decay:** -47 Rs per trade, profit factor 0.97.
- **The underlying itself:** 0.1 bps over the next hour, 49% of signals moved the right way (2708 signals).
- **Calls (up) vs puts (down):** BUY CE: 581 trades, -670 Rs (PF 0.63) | BUY PE: 562 trades, -292 Rs (PF 0.82)
- **Indices vs stocks:** indices: 190 trades, 111 Rs (PF 1.08) | stocks: 953 trades, -603 Rs (PF 0.67)
- **Time of day:** 10:15-11:30: 430 trades, -587 Rs (PF 0.67) | 11:30-13:00: 335 trades, -203 Rs (PF 0.87) | 13:00-14:30: 378 trades, -618 Rs (PF 0.66)
- **By year:** 2024: 96 trades, -639 Rs (PF 0.65) | 2025: 543 trades, -661 Rs (PF 0.64) | 2026: 504 trades, -265 Rs (PF 0.84)
- **Best / worst symbols (15+ trades):** best NSEI 131 (82), NSEBANK 96 (108), INFY NS -224 (86) | worst ICICIBANK NS -1014 (72), MARUTI NS -871 (84), ITC NS -764 (72)

### SMC part: liquidity sweep

*A wick takes the last swing low/high and closes back inside.*

- **Overall (realistic option model):** 1528 trades, -509 Rs per trade, total -778164 Rs, profit factor 0.71, win rate 42%, max drawdown -792024, worst day -18102.
- **Best case, no time decay:** -112 Rs per trade, profit factor 0.93.
- **The underlying itself:** -0.1 bps over the next hour, 50% of signals moved the right way (2636 signals).
- **Calls (up) vs puts (down):** BUY CE: 789 trades, -634 Rs (PF 0.65) | BUY PE: 739 trades, -376 Rs (PF 0.78)
- **Indices vs stocks:** indices: 255 trades, -520 Rs (PF 0.70) | stocks: 1273 trades, -507 Rs (PF 0.71)
- **Time of day:** 10:15-11:30: 338 trades, -175 Rs (PF 0.89) | 11:30-13:00: 564 trades, -600 Rs (PF 0.67) | 13:00-14:30: 626 trades, -609 Rs (PF 0.66)
- **By year:** 2024: 113 trades, -360 Rs (PF 0.79) | 2025: 681 trades, -636 Rs (PF 0.65) | 2026: 734 trades, -415 Rs (PF 0.76)
- **Best / worst symbols (15+ trades):** best TCS NS -160 (103), MARUTI NS -180 (91), NSEI -246 (117) | worst ITC NS -950 (93), ICICIBANK NS -810 (98), NSEBANK -753 (138)

### SMC part: premium / discount half

*Below 50% of the last swing range is bullish, above is bearish.*

- **Overall (realistic option model):** 2042 trades, -486 Rs per trade, total -993115 Rs, profit factor 0.72, win rate 42%, max drawdown -1020702, worst day -27138.
- **Best case, no time decay:** -62 Rs per trade, profit factor 0.96.
- **The underlying itself:** -0.1 bps over the next hour, 50% of signals moved the right way (53728 signals).
- **Calls (up) vs puts (down):** BUY CE: 1010 trades, -531 Rs (PF 0.70) | BUY PE: 1032 trades, -442 Rs (PF 0.74)
- **Indices vs stocks:** indices: 38 trades, -646 Rs (PF 0.65) | stocks: 2004 trades, -483 Rs (PF 0.72)
- **Time of day:** 10:15-11:30: 1298 trades, -392 Rs (PF 0.77) | 11:30-13:00: 326 trades, -585 Rs (PF 0.67) | 13:00-14:30: 418 trades, -703 Rs (PF 0.62)
- **By year:** 2024: 174 trades, -325 Rs (PF 0.80) | 2025: 881 trades, -617 Rs (PF 0.66) | 2026: 987 trades, -398 Rs (PF 0.77)
- **Best / worst symbols (15+ trades):** best INFY NS 17 (277), SBIN NS -191 (68), TCS NS -237 (54) | worst ICICIBANK NS -908 (208), MARUTI NS -844 (141), ITC NS -737 (166)

### Sweep then CHoCH

*A liquidity sweep, then a change of character the other way; entered on that candle or the pullback.*

- **Overall (realistic option model):** 630 trades, -329 Rs per trade, total -207252 Rs, profit factor 0.80, win rate 45%, max drawdown -222162, worst day -15060.
- **Best case, no time decay:** 76 Rs per trade, profit factor 1.05.
- **The underlying itself:** 1.5 bps over the next hour, 50% of signals moved the right way (876 signals).
- **Calls (up) vs puts (down):** BUY CE: 325 trades, -467 Rs (PF 0.73) | BUY PE: 305 trades, -182 Rs (PF 0.89)
- **Indices vs stocks:** indices: 97 trades, 448 Rs (PF 1.35) | stocks: 533 trades, -470 Rs (PF 0.73)
- **Time of day:** 10:15-11:30: 287 trades, -527 Rs (PF 0.70) | 11:30-13:00: 171 trades, -243 Rs (PF 0.85) | 13:00-14:30: 172 trades, -85 Rs (PF 0.95)
- **By year:** 2024: 44 trades, -969 Rs (PF 0.51) | 2025: 304 trades, -291 Rs (PF 0.82) | 2026: 282 trades, -270 Rs (PF 0.83)
- **Best / worst symbols (15+ trades):** best NSEI 584 (40), NSEBANK 353 (57), BHARTIARTL NS 143 (38) | worst LT NS -1125 (54), AXISBANK NS -1055 (49), TCS NS -961 (38)

### Sweep then CHoCH: on the CHoCH candle

*The same, entered only on the change-of-character candle.*

- **Overall (realistic option model):** 392 trades, -351 Rs per trade, total -137748 Rs, profit factor 0.79, win rate 44%, max drawdown -149676, worst day -9036.
- **Best case, no time decay:** 46 Rs per trade, profit factor 1.03.
- **The underlying itself:** 1.8 bps over the next hour, 49% of signals moved the right way (359 signals).
- **Calls (up) vs puts (down):** BUY CE: 199 trades, -482 Rs (PF 0.72) | BUY PE: 193 trades, -217 Rs (PF 0.87)
- **Indices vs stocks:** indices: 61 trades, 624 Rs (PF 1.53) | stocks: 331 trades, -531 Rs (PF 0.70)
- **Time of day:** 10:15-11:30: 111 trades, -636 Rs (PF 0.65) | 11:30-13:00: 122 trades, -310 Rs (PF 0.81) | 13:00-14:30: 159 trades, -185 Rs (PF 0.88)
- **By year:** 2024: 31 trades, -1272 Rs (PF 0.41) | 2025: 186 trades, -305 Rs (PF 0.82) | 2026: 175 trades, -238 Rs (PF 0.85)
- **Best / worst symbols (15+ trades):** best NSEI 984 (21), NSEBANK 435 (40), BHARTIARTL NS 413 (28) | worst LT NS -1334 (25), AXISBANK NS -1078 (31), TCS NS -832 (22)

### Sweep then CHoCH: on the pullback

*The same, entered only on the pullback into the order block / gap.*

- **Overall (realistic option model):** 368 trades, -422 Rs per trade, total -155370 Rs, profit factor 0.75, win rate 43%, max drawdown -172962, worst day -9036.
- **Best case, no time decay:** 10 Rs per trade, profit factor 1.01.
- **The underlying itself:** 1.3 bps over the next hour, 51% of signals moved the right way (517 signals).
- **Calls (up) vs puts (down):** BUY CE: 197 trades, -639 Rs (PF 0.65) | BUY PE: 171 trades, -173 Rs (PF 0.89)
- **Indices vs stocks:** indices: 45 trades, 185 Rs (PF 1.13) | stocks: 323 trades, -507 Rs (PF 0.71)
- **Time of day:** 10:15-11:30: 188 trades, -429 Rs (PF 0.75) | 11:30-13:00: 114 trades, -330 Rs (PF 0.80) | 13:00-14:30: 66 trades, -560 Rs (PF 0.69)
- **By year:** 2024: 23 trades, -927 Rs (PF 0.53) | 2025: 175 trades, -340 Rs (PF 0.80) | 2026: 170 trades, -438 Rs (PF 0.75)
- **Best / worst symbols (15+ trades):** best RELIANCE NS 547 (32), NSEI 257 (22), TATASTEEL NS 199 (28) | worst TCS NS -1709 (23), ITC NS -1299 (21), ICICIBANK NS -1014 (21)

### Sweep then CHoCH with a displacement candle

*The same, and the change-of-character candle must be a displacement.*

- **Overall (realistic option model):** 169 trades, -529 Rs per trade, total -89448 Rs, profit factor 0.70, win rate 41%, max drawdown -98394, worst day -6024.
- **Best case, no time decay:** -86 Rs per trade, profit factor 0.94.
- **The underlying itself:** -1.8 bps over the next hour, 48% of signals moved the right way (232 signals).
- **Calls (up) vs puts (down):** BUY CE: 90 trades, -814 Rs (PF 0.57) | BUY PE: 79 trades, -205 Rs (PF 0.87)
- **Indices vs stocks:** indices: 21 trades, -443 Rs (PF 0.74) | stocks: 148 trades, -541 Rs (PF 0.69)
- **Time of day:** 10:15-11:30: 98 trades, -688 Rs (PF 0.63) | 11:30-13:00: 38 trades, -804 Rs (PF 0.58) | 13:00-14:30: 33 trades, 257 Rs (PF 1.19)
- **By year:** 2024: 9 trades (too few) | 2025: 86 trades, -433 Rs (PF 0.75) | 2026: 74 trades, -501 Rs (PF 0.71)

### Support / resistance (all three setups)

*Previous day high/low/close and swing levels: breakout, break-and-retest or rejection.*

- **Overall (realistic option model):** 2084 trades, -385 Rs per trade, total -802626 Rs, profit factor 0.77, win rate 44%, max drawdown -849588, worst day -24186.
- **Best case, no time decay:** 59 Rs per trade, profit factor 1.04.
- **The underlying itself:** 0.9 bps over the next hour, 50% of signals moved the right way (8065 signals).
- **Calls (up) vs puts (down):** BUY CE: 1058 trades, -430 Rs (PF 0.75) | BUY PE: 1026 trades, -339 Rs (PF 0.80)
- **Indices vs stocks:** indices: 295 trades, -188 Rs (PF 0.88) | stocks: 1789 trades, -418 Rs (PF 0.76)
- **Time of day:** 10:15-11:30: 1034 trades, -304 Rs (PF 0.82) | 11:30-13:00: 568 trades, -404 Rs (PF 0.76) | 13:00-14:30: 482 trades, -537 Rs (PF 0.70)
- **By year:** 2024: 175 trades, -477 Rs (PF 0.73) | 2025: 908 trades, -477 Rs (PF 0.73) | 2026: 1001 trades, -286 Rs (PF 0.83)
- **Best / worst symbols (15+ trades):** best AXISBANK NS 2 (179), NSEI -59 (136), INFY NS -243 (158) | worst MARUTI NS -798 (157), RELIANCE NS -607 (157), ICICIBANK NS -596 (129)

### S/R breakout

*A fresh strong close beyond the previous day high or low.*

- **Overall (realistic option model):** 1617 trades, -430 Rs per trade, total -694611 Rs, profit factor 0.75, win rate 43%, max drawdown -715215, worst day -24216.
- **Best case, no time decay:** 52 Rs per trade, profit factor 1.04.
- **The underlying itself:** 1.5 bps over the next hour, 50% of signals moved the right way (3804 signals).
- **Calls (up) vs puts (down):** BUY CE: 806 trades, -501 Rs (PF 0.71) | BUY PE: 811 trades, -359 Rs (PF 0.79)
- **Indices vs stocks:** indices: 244 trades, -408 Rs (PF 0.76) | stocks: 1373 trades, -433 Rs (PF 0.75)
- **Time of day:** 10:15-11:30: 696 trades, -342 Rs (PF 0.80) | 11:30-13:00: 498 trades, -561 Rs (PF 0.68) | 13:00-14:30: 423 trades, -419 Rs (PF 0.75)
- **By year:** 2024: 152 trades, -252 Rs (PF 0.85) | 2025: 736 trades, -544 Rs (PF 0.69) | 2026: 729 trades, -351 Rs (PF 0.79)
- **Best / worst symbols (15+ trades):** best AXISBANK NS -15 (132), BHARTIARTL NS -231 (111), RELIANCE NS -273 (116) | worst LT NS -823 (115), TATASTEEL NS -580 (106), ITC NS -534 (104)

### S/R break-and-retest

*After such a breakout today, price retests the level and holds.*

- **Overall (realistic option model):** 1089 trades, -477 Rs per trade, total -519548 Rs, profit factor 0.73, win rate 42%, max drawdown -527532, worst day -21084.
- **Best case, no time decay:** -45 Rs per trade, profit factor 0.97.
- **The underlying itself:** -0.1 bps over the next hour, 51% of signals moved the right way (1746 signals).
- **Calls (up) vs puts (down):** BUY CE: 538 trades, -767 Rs (PF 0.59) | BUY PE: 551 trades, -194 Rs (PF 0.88)
- **Indices vs stocks:** indices: 167 trades, -428 Rs (PF 0.75) | stocks: 922 trades, -486 Rs (PF 0.72)
- **Time of day:** 10:15-11:30: 364 trades, -385 Rs (PF 0.77) | 11:30-13:00: 364 trades, -361 Rs (PF 0.79) | 13:00-14:30: 361 trades, -687 Rs (PF 0.63)
- **By year:** 2024: 84 trades, -586 Rs (PF 0.67) | 2025: 509 trades, -445 Rs (PF 0.74) | 2026: 496 trades, -492 Rs (PF 0.72)
- **Best / worst symbols (15+ trades):** best ITC NS -15 (64), INFY NS -151 (88), MARUTI NS -229 (84) | worst HDFCBANK NS -1043 (70), LT NS -910 (77), RELIANCE NS -713 (73)

### S/R rejection (reversal)

*A wick through a level that closes back on the original side.*

- **Overall (realistic option model):** 1523 trades, -510 Rs per trade, total -777440 Rs, profit factor 0.71, win rate 42%, max drawdown -809016, worst day -21144.
- **Best case, no time decay:** -32 Rs per trade, profit factor 0.98.
- **The underlying itself:** 0.5 bps over the next hour, 49% of signals moved the right way (2563 signals).
- **Calls (up) vs puts (down):** BUY CE: 784 trades, -581 Rs (PF 0.68) | BUY PE: 739 trades, -436 Rs (PF 0.75)
- **Indices vs stocks:** indices: 244 trades, -433 Rs (PF 0.75) | stocks: 1279 trades, -525 Rs (PF 0.70)
- **Time of day:** 10:15-11:30: 429 trades, -349 Rs (PF 0.79) | 11:30-13:00: 514 trades, -470 Rs (PF 0.73) | 13:00-14:30: 580 trades, -666 Rs (PF 0.64)
- **By year:** 2024: 122 trades, -162 Rs (PF 0.90) | 2025: 702 trades, -690 Rs (PF 0.63) | 2026: 699 trades, -391 Rs (PF 0.77)
- **Best / worst symbols (15+ trades):** best INFY NS 62 (117), TCS NS -97 (109), NSEBANK -332 (123) | worst RELIANCE NS -1119 (114), HDFCBANK NS -935 (101), ICICIBANK NS -787 (97)

## Reading the results

- A strategy has an edge only if it beats RANDOM clearly, in both halves of the period and in most years, and its underlying 1-hour move is clearly positive. Small gaps over a few hundred trades are noise.
- Calls vs puts and time-of-day splits cut the trades into small groups, so differences between them are usually noise too.
- Every strategy here was also combined with others in `strategy_backtest_report.md` and `sr_vwap_combination_report.md`.
