# Every strategy tested separately

Generated 2026-11-14 by `node tools/bt_strategies.mjs each`. Each strategy runs ALONE through the same engine: signal on a bar close, fill at the next bar open, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying, ATM option held to stop (-30%) or target (+30%), 10,000 Rs premium per trade after full option charges. Data: 14 symbols (2 indices, 12 stocks), 2 years of 15-minute candles. **Option prices are a model** (no historical option candles exist): "realistic" includes time decay, "no decay" is a best case no real option achieves. The **underlying 1h move** column needs no option model: the average move of the underlying in the signal direction over the next hour, in basis points.

## Ranking (best average per trade first)

| Rank | Strategy | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | VWAP side | 88173 | 2124 | -228 | 0.86 | 46% | -484855 | -496110 | -18132 | -279 / -171 | 269 | 0.9 | 50% |
| 2 | Bollinger breakout | 6659 | 1887 | -277 | 0.83 | 46% | -522810 | -574536 | -21084 | -341 / -197 | 115 | 1.5 | 50% |
| 3 | Bollinger mid-band side | 88161 | 2111 | -299 | 0.82 | 45% | -630734 | -645810 | -21174 | -309 / -288 | 183 | 0.2 | 49% |
| 4 | FVG retest | 6276 | 1966 | -303 | 0.82 | 45% | -595640 | -632154 | -21174 | -331 / -270 | 73 | 0.6 | 49% |
| 5 | RANDOM direction (yardstick) | 12544 | 2190 | -348 | 0.79 | 44% | -762370 | -804126 | -18252 | -512 / -162 | 62 | -0.2 | 49% |
| 6 | Support / resistance (all three setups) | 8940 | 2084 | -385 | 0.77 | 44% | -802626 | -849588 | -24186 | -465 / -293 | 59 | 0.9 | 50% |
| 7 | Structure BOS / CHoCH | 88173 | 2114 | -391 | 0.77 | 44% | -825584 | -825584 | -30240 | -361 / -423 | 97 | -0.0 | 50% |
| 8 | S/R breakout | 4143 | 1617 | -430 | 0.75 | 43% | -694611 | -715215 | -24216 | -479 / -366 | 52 | 1.5 | 50% |
| 9 | Volume push | 6167 | 1853 | -431 | 0.75 | 43% | -798024 | -832578 | -21084 | -461 / -395 | 37 | 1.5 | 49% |
| 10 | S/R break-and-retest | 1919 | 1089 | -477 | 0.73 | 42% | -519548 | -527532 | -21084 | -453 / -509 | -45 | -0.1 | 51% |
| 11 | EMA trend 9/21/50 | 72454 | 2110 | -485 | 0.72 | 42% | -1023326 | -1026594 | -27228 | -502 / -465 | 46 | -0.8 | 49% |
| 12 | RSI momentum | 52962 | 2083 | -491 | 0.72 | 42% | -1023682 | -1037682 | -27198 | -548 / -426 | 24 | 0.1 | 50% |
| 13 | S/R rejection (reversal) | 2933 | 1523 | -510 | 0.71 | 42% | -777440 | -809016 | -21144 | -619 / -372 | -32 | 0.5 | 49% |
| 14 | SMC part: premium / discount half (LuxAlgo swing range) | 87439 | 2120 | -511 | 0.71 | 42% | -1084195 | -1104546 | -30210 | -647 / -357 | -70 | 0.7 | 50% |
| 15 | Hourly trend (EMA100/200 on 15m) | 61465 | 2114 | -515 | 0.71 | 42% | -1089320 | -1101564 | -39426 | -596 / -424 | 33 | -1.3 | 49% |
| 16 | Bollinger reversal | 6659 | 1899 | -608 | 0.66 | 40% | -1155477 | -1163928 | -39186 | -706 / -492 | -162 | -1.5 | 49% |
| 17 | SMC (LuxAlgo port: internal trend + order block tap + discount/premium) | 218 | 111 | -690 | 0.63 | 39% | -76590 | -79572 | -6024 | -817 / -465 | -176 | 0.4 | 48% |

The random yardstick averages **-348 Rs per trade**. 4 of 16 strategies beat it on the average trade; **0 are profitable** in the realistic model.

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

### SMC (LuxAlgo port: internal trend + order block tap + discount/premium)

*Internal structure up/down, an unmitigated order block tapped by a candle in that direction, price in the discount (long) or premium (short) half of the swing range.*

- **Overall (realistic option model):** 111 trades, -690 Rs per trade, total -76590 Rs, profit factor 0.63, win rate 39%, max drawdown -79572, worst day -6024.
- **Best case, no time decay:** -176 Rs per trade, profit factor 0.89.
- **The underlying itself:** 0.4 bps over the next hour, 48% of signals moved the right way (195 signals).
- **Calls (up) vs puts (down):** BUY CE: 59 trades, -1082 Rs (PF 0.47) | BUY PE: 52 trades, -246 Rs (PF 0.85)
- **Indices vs stocks:** indices: 13 trades (too few) | stocks: 98 trades, -688 Rs (PF 0.63)
- **Time of day:** 10:15-11:30: 23 trades, -1709 Rs (PF 0.28) | 11:30-13:00: 44 trades, -424 Rs (PF 0.75) | 13:00-14:30: 44 trades, -424 Rs (PF 0.75)
- **By year:** 2024: 13 trades (too few) | 2025: 58 trades, -635 Rs (PF 0.65) | 2026: 40 trades, -465 Rs (PF 0.73)

### SMC part: premium / discount half (LuxAlgo swing range)

*Below the midpoint of the swing range is bullish, above is bearish.*

- **Overall (realistic option model):** 2120 trades, -511 Rs per trade, total -1084195 Rs, profit factor 0.71, win rate 42%, max drawdown -1104546, worst day -30210.
- **Best case, no time decay:** -70 Rs per trade, profit factor 0.95.
- **The underlying itself:** 0.7 bps over the next hour, 50% of signals moved the right way (78384 signals).
- **Calls (up) vs puts (down):** BUY CE: 1109 trades, -510 Rs (PF 0.71) | BUY PE: 1011 trades, -513 Rs (PF 0.71)
- **Indices vs stocks:** indices: 10 trades (too few) | stocks: 2110 trades, -514 Rs (PF 0.71)
- **Time of day:** 10:15-11:30: 1323 trades, -473 Rs (PF 0.73) | 11:30-13:00: 351 trades, -416 Rs (PF 0.76) | 13:00-14:30: 446 trades, -700 Rs (PF 0.62)
- **By year:** 2024: 184 trades, -276 Rs (PF 0.83) | 2025: 900 trades, -681 Rs (PF 0.63) | 2026: 1036 trades, -406 Rs (PF 0.76)
- **Best / worst symbols (15+ trades):** best BHARTIARTL NS -366 (377), INFY NS -389 (409), RELIANCE NS -390 (16) | worst MARUTI NS -661 (51), LT NS -644 (81), AXISBANK NS -627 (377)

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
