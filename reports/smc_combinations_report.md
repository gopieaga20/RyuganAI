# SMC combined with the other strategies

Generated 2026-11-14 by `node tools/bt_strategies.mjs smc-combos`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). SMC = the LuxAlgo-port vote of `frontend/js/smc.js` (internal trend + order block tap + discount/premium); the second base drops the discount/premium condition so it fires more often. Each is combined with every other strategy (pairs that must agree, triples, and as a weight-2 vote added to the live six-strategy score).

**70 variants** were tried. With that many tries a few look good by luck, so the table shows a bootstrap p-value (how often the same number of random-direction trades does as well) and the p-value times 70 (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.

Random-direction yardstick (no skill): **-348 Rs per trade**, profit factor 0.79, 2190 trades.

| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | p | Adjusted p | Quarters |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SMC (today) + FVG retest agree | 13 | 13 | 216 | 1.16 | 54% | 2802 | 734 / -614 | 216 | -4.7 | 50% | - | - | 3 of 7 |
| 2 | SMC (today) + Bollinger breakout agree | 0 | 0 | - | 0.00 | 0% | 0 | - / - | 0 | 0.0 | 0% | - | - | 0 of 0 |
| 3 | SMC (today) + S/R rejection agree | 17 | 14 | -15 | 0.99 | 50% | -210 | -1813 / 984 | 413 | -12.2 | 47% | - | - | 3 of 8 |
| 4 | SMC without the discount/premium rule + RSI + Structure BOS/CHoCH agree | 292 | 204 | -191 | 0.88 | 47% | -39024 | -233 / -143 | 118 | -1.1 | 48% | 0.264 | 1.00 | 3 of 9 |
| 5 | SMC (today) + RSI + Structure BOS/CHoCH agree | 37 | 32 | -202 | 0.87 | 47% | -6474 | 128 / -832 | -202 | -7.4 | 34% | 0.450 | 1.00 | 4 of 9 |
| 6 | SMC (today) + Support/resistance agree | 19 | 15 | -215 | 0.87 | 47% | -3222 | -2013 / 984 | 185 | -12.6 | 42% | - | - | 2 of 8 |
| 7 | SMC without the discount/premium rule + RSI agree | 313 | 220 | -233 | 0.86 | 46% | -51252 | -337 / -106 | 81 | -0.9 | 48% | 0.305 | 1.00 | 4 of 9 |
| 8 | SMC without the discount/premium rule + EMA trend + VWAP agree | 310 | 200 | -255 | 0.84 | 46% | -50952 | -420 / -49 | 121 | -5.1 | 46% | 0.363 | 1.00 | 2 of 9 |
| 9 | Live vote >= 6 and SMC without the discount/premium rule agrees | 213 | 144 | -265 | 0.84 | 46% | -38124 | -375 / -145 | 132 | -5.5 | 43% | 0.404 | 1.00 | 3 of 9 |
| 10 | SMC without the discount/premium rule + VWAP + RSI agree | 240 | 169 | -281 | 0.83 | 46% | -47490 | -348 / -205 | 75 | -2.4 | 46% | 0.405 | 1.00 | 4 of 9 |
| 11 | SMC without the discount/premium rule + EMA trend + RSI agree | 243 | 166 | -304 | 0.82 | 45% | -50442 | -453 / -132 | -15 | -1.2 | 49% | 0.434 | 1.00 | 3 of 9 |
| 12 | Live vote (6 strategies) + SMC without the discount/premium rule as a vote of weight 2, score >= 5 | 47918 | 2159 | -332 | 0.80 | 45% | -716826 | -363 / -297 | 74 | 0.0 | 50% | 0.395 | 1.00 | 0 of 9 |
| 13 | Live vote (6 strategies) + SMC (today) as a vote of weight 2, score >= 5 | 47735 | 2168 | -332 | 0.80 | 45% | -719958 | -355 / -306 | 84 | 0.1 | 50% | 0.409 | 1.00 | 0 of 9 |
| 14 | SMC (today) + RSI agree | 41 | 36 | -348 | 0.79 | 44% | -12528 | -265 / -514 | -348 | -7.2 | 34% | 0.554 | 1.00 | 4 of 9 |
| 15 | Live vote (6 strategies) + SMC (today) as a vote of weight 2, score >= 6 | 27639 | 2185 | -361 | 0.79 | 44% | -788160 | -450 / -256 | 61 | -0.1 | 50% | 0.572 | 1.00 | 0 of 9 |
| 16 | Live vote (6 strategies) + SMC without the discount/premium rule as a vote of weight 2, score >= 7 | 3897 | 1624 | -367 | 0.78 | 44% | -596567 | -449 / -261 | 46 | 0.4 | 49% | 0.590 | 1.00 | 1 of 9 |
| 17 | Live vote (6 strategies) + SMC without the discount/premium rule as a vote of weight 2, score >= 6 | 27779 | 2174 | -373 | 0.78 | 44% | -811830 | -458 / -273 | 80 | -0.1 | 50% | 0.674 | 1.00 | 0 of 9 |
| 18 | Live vote (6 strategies) + SMC (today) as a vote of weight 2, score >= 7 | 3647 | 1591 | -384 | 0.77 | 44% | -611057 | -482 / -257 | 44 | 0.9 | 49% | 0.688 | 1.00 | 1 of 9 |
| 19 | SMC without the discount/premium rule + Higher-timeframe trend + RSI agree | 235 | 156 | -399 | 0.77 | 44% | -62280 | -707 / -92 | -92 | -2.4 | 46% | 0.611 | 1.00 | 2 of 9 |
| 20 | SMC without the discount/premium rule + Bollinger mid-band agree | 468 | 292 | -405 | 0.76 | 43% | -118266 | -473 / -310 | -15 | -4.7 | 44% | 0.659 | 1.00 | 0 of 9 |
| 21 | SMC without the discount/premium rule + VWAP + Structure BOS/CHoCH agree | 375 | 240 | -415 | 0.76 | 43% | -99504 | -500 / -303 | -40 | -7.1 | 43% | 0.658 | 1.00 | 4 of 9 |
| 22 | SMC without the discount/premium rule + EMA trend agree | 585 | 312 | -418 | 0.76 | 43% | -130554 | -467 / -353 | -15 | -3.5 | 47% | 0.704 | 1.00 | 1 of 9 |
| 23 | Live vote (6 strategies) + SMC without the discount/premium rule as a vote of weight 2, score >= 8 | 408 | 325 | -430 | 0.75 | 43% | -139740 | -622 / -225 | 50 | -0.9 | 47% | 0.695 | 1.00 | 2 of 9 |
| 24 | SMC without the discount/premium rule + EMA trend + Structure BOS/CHoCH agree | 539 | 289 | -440 | 0.74 | 43% | -127212 | -494 / -365 | -56 | -4.3 | 47% | 0.713 | 1.00 | 1 of 9 |
| 25 | SMC without the discount/premium rule + Structure BOS/CHoCH agree | 846 | 416 | -447 | 0.74 | 43% | -186060 | -554 / -303 | -58 | -4.8 | 44% | 0.765 | 1.00 | 1 of 9 |
| 26 | SMC without the discount/premium rule + EMA trend + Volume push agree | 45 | 40 | -465 | 0.73 | 43% | -18582 | -476 / -443 | 285 | -8.6 | 35% | 0.654 | 1.00 | 3 of 9 |
| 27 | SMC without the discount/premium rule + VWAP agree | 414 | 266 | -466 | 0.73 | 42% | -123870 | -551 / -354 | -60 | -5.7 | 43% | 0.760 | 1.00 | 2 of 9 |
| 28 | SMC without the discount/premium rule + Volume push + Structure BOS/CHoCH agree | 63 | 55 | -505 | 0.71 | 42% | -27798 | -681 / -173 | -69 | -3.2 | 42% | 0.695 | 1.00 | 2 of 8 |
| 29 | SMC without the discount/premium rule + Volume push agree | 81 | 72 | -514 | 0.71 | 42% | -37044 | -614 / -348 | -15 | -0.6 | 44% | 0.722 | 1.00 | 2 of 9 |
| 30 | SMC without the discount/premium rule + EMA trend + Higher-timeframe trend agree | 518 | 272 | -522 | 0.70 | 42% | -141942 | -685 / -315 | -81 | -4.4 | 46% | 0.852 | 1.00 | 1 of 9 |
| 31 | SMC without the discount/premium rule alone | 1089 | 522 | -532 | 0.70 | 41% | -277560 | -679 / -336 | -72 | -3.3 | 45% | 0.923 | 1.00 | 1 of 9 |
| 32 | SMC without the discount/premium rule + FVG retest agree | 79 | 69 | -580 | 0.68 | 41% | -39996 | -952 / -258 | -145 | -3.0 | 38% | 0.766 | 1.00 | 1 of 9 |
| 33 | SMC (today) + Structure BOS/CHoCH agree | 138 | 72 | -598 | 0.67 | 40% | -43038 | -536 / -707 | -265 | -3.6 | 44% | 0.779 | 1.00 | 0 of 9 |
| 34 | SMC (today) + Higher-timeframe trend + RSI agree | 6 | 5 | -614 | 0.66 | 40% | -3072 | -1014 / -15 | -614 | 0.2 | 20% | - | - | 0 of 2 |
| 35 | Live vote (6 strategies) + SMC (today) as a vote of weight 2, score >= 8 | 206 | 200 | -614 | 0.66 | 40% | -122880 | -822 / -390 | -75 | 4.3 | 49% | 0.904 | 1.00 | 1 of 9 |
| 36 | SMC without the discount/premium rule + VWAP + Higher-timeframe trend agree | 313 | 198 | -620 | 0.66 | 40% | -122850 | -995 / -180 | -243 | -7.5 | 42% | 0.909 | 1.00 | 1 of 9 |
| 37 | SMC without the discount/premium rule + Higher-timeframe trend + Volume push agree | 46 | 43 | -642 | 0.65 | 40% | -27618 | -532 / -871 | -85 | -0.3 | 42% | 0.799 | 1.00 | 2 of 9 |
| 38 | SMC without the discount/premium rule + VWAP + Volume push agree | 41 | 38 | -646 | 0.65 | 39% | -24546 | -707 / -514 | -15 | -6.1 | 38% | 0.783 | 1.00 | 2 of 8 |
| 39 | SMC without the discount/premium rule + Higher-timeframe trend agree | 735 | 356 | -655 | 0.64 | 39% | -233112 | -925 / -305 | -216 | -5.3 | 44% | 0.977 | 1.00 | 1 of 9 |
| 40 | SMC without the discount/premium rule + Higher-timeframe trend + Structure BOS/CHoCH agree | 619 | 301 | -662 | 0.64 | 39% | -199320 | -930 / -328 | -273 | -6.1 | 43% | 0.974 | 1.00 | 1 of 9 |
| 41 | SMC without the discount/premium rule + RSI + Volume push agree | 23 | 23 | -667 | 0.64 | 39% | -15330 | -896 / -15 | -667 | 3.2 | 56% | 0.767 | 1.00 | 3 of 8 |
| 42 | SMC (today) alone | 218 | 111 | -690 | 0.63 | 39% | -76590 | -817 / -465 | -176 | 0.4 | 48% | 0.894 | 1.00 | 1 of 9 |
| 43 | Live vote >= 7 and SMC without the discount/premium rule agrees | 51 | 48 | -764 | 0.59 | 38% | -36684 | -1398 / -15 | -390 | 0.4 | 43% | 0.869 | 1.00 | 3 of 9 |
| 44 | SMC (today) + VWAP + RSI agree | 23 | 19 | -804 | 0.58 | 37% | -15270 | -514 / -1299 | -804 | -8.0 | 33% | - | - | 2 of 9 |
| 45 | SMC (today) + Bollinger mid-band agree | 54 | 41 | -819 | 0.57 | 37% | -33582 | -476 / -1414 | -527 | -5.2 | 40% | 0.880 | 1.00 | 2 of 9 |
| 46 | SMC (today) + VWAP + Structure BOS/CHoCH agree | 41 | 32 | -952 | 0.52 | 34% | -30450 | -729 / -1377 | -764 | -11.0 | 35% | 0.912 | 1.00 | 1 of 9 |
| 47 | SMC (today) + Volume push agree | 21 | 18 | -1014 | 0.50 | 33% | -18252 | -1813 / -15 | -1014 | -5.4 | 41% | - | - | 1 of 7 |
| 48 | SMC (today) + Bollinger reversal agree | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -3012 / 2982 | 984 | 23.3 | 67% | - | - | 1 of 3 |
| 49 | SMC (today) + Volume push + Structure BOS/CHoCH agree | 12 | 9 | -1014 | 0.50 | 33% | -9126 | -2013 / 984 | -1014 | -6.1 | 45% | - | - | 1 of 5 |
| 50 | Live vote >= 7 and SMC (today) agrees | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -1014 / - | -1014 | -20.8 | 0% | - | - | 0 of 2 |
| 51 | SMC without the discount/premium rule + Bollinger reversal agree | 3 | 3 | -1014 | 0.50 | 33% | -3042 | -3012 / 2982 | 984 | 23.3 | 67% | - | - | 1 of 3 |
| 52 | SMC without the discount/premium rule + Bollinger breakout agree | 23 | 21 | -1014 | 0.50 | 33% | -21294 | -2013 / 318 | -614 | -5.5 | 43% | 0.887 | 1.00 | 2 of 9 |
| 53 | SMC without the discount/premium rule + Support/resistance agree | 150 | 119 | -1048 | 0.48 | 33% | -124662 | -1337 / -661 | -523 | -5.8 | 41% | 0.996 | 1.00 | 0 of 9 |
| 54 | SMC without the discount/premium rule + S/R rejection agree | 79 | 69 | -1101 | 0.46 | 32% | -75960 | -1696 / -229 | -544 | -4.6 | 51% | 0.988 | 1.00 | 1 of 9 |
| 55 | SMC (today) + VWAP agree | 51 | 38 | -1119 | 0.46 | 32% | -42528 | -854 / -1629 | -804 | -3.0 | 43% | 0.964 | 1.00 | 1 of 9 |
| 56 | SMC without the discount/premium rule + S/R breakout agree | 48 | 39 | -1168 | 0.44 | 31% | -45540 | -1299 / -1014 | -707 | -6.9 | 29% | 0.971 | 1.00 | 1 of 9 |
| 57 | SMC (today) + Higher-timeframe trend + Structure BOS/CHoCH agree | 21 | 14 | -1299 | 0.40 | 29% | -18192 | -2263 / -15 | -871 | -6.6 | 40% | - | - | 2 of 7 |
| 58 | SMC (today) + Higher-timeframe trend agree | 32 | 22 | -1377 | 0.37 | 27% | -30300 | -2090 / -348 | -560 | -0.1 | 48% | 0.974 | 1.00 | 2 of 8 |
| 59 | SMC (today) + EMA trend + RSI agree | 12 | 9 | -1680 | 0.28 | 22% | -15120 | -1014 / -3012 | -1680 | -15.0 | 25% | - | - | 1 of 5 |
| 60 | SMC (today) + EMA trend agree | 26 | 14 | -1728 | 0.27 | 21% | -24186 | -1680 / -1813 | -1299 | 4.1 | 55% | - | - | 0 of 7 |
| 61 | SMC (today) + EMA trend + Higher-timeframe trend agree | 8 | 5 | -1813 | 0.25 | 20% | -9066 | -3012 / -15 | -614 | 9.9 | 57% | - | - | 1 of 4 |
| 62 | SMC (today) + VWAP + Volume push agree | 5 | 5 | -1813 | 0.25 | 20% | -9066 | -3012 / -15 | -1813 | -30.0 | 0% | - | - | 1 of 3 |
| 63 | SMC (today) + EMA trend + Structure BOS/CHoCH agree | 24 | 13 | -2090 | 0.18 | 15% | -27168 | -1680 / -3012 | -1629 | 0.1 | 50% | - | - | 0 of 7 |
| 64 | Live vote >= 6 and SMC (today) agrees | 9 | 7 | -2156 | 0.17 | 14% | -15090 | -1513 / -3012 | -2156 | -20.9 | 20% | - | - | 0 of 5 |
| 65 | SMC (today) + EMA trend + VWAP agree | 12 | 9 | -2346 | 0.12 | 11% | -21114 | -1813 / -3012 | -2346 | -7.8 | 38% | - | - | 0 of 6 |
| 66 | SMC (today) + VWAP + Higher-timeframe trend agree | 14 | 11 | -2467 | 0.10 | 9% | -27138 | -2156 / -3012 | -1922 | -7.8 | 31% | - | - | 0 of 4 |
| 67 | SMC (today) + S/R breakout agree | 2 | 1 | -3012 | 0.00 | 0% | -3012 | -3012 / - | -3012 | -16.0 | 0% | - | - | 0 of 1 |
| 68 | SMC (today) + EMA trend + Volume push agree | 3 | 2 | -3012 | 0.00 | 0% | -6024 | -3012 / - | -3012 | -21.2 | 0% | - | - | 0 of 2 |
| 69 | SMC (today) + Higher-timeframe trend + Volume push agree | 2 | 2 | -3012 | 0.00 | 0% | -6024 | -3012 / - | -3012 | -34.8 | 0% | - | - | 0 of 1 |
| 70 | SMC (today) + RSI + Volume push agree | 2 | 2 | -3012 | 0.00 | 0% | -6024 | -3012 / -3012 | -3012 | 12.0 | 100% | - | - | 0 of 2 |

## What the numbers say

- Variants with at least 40 trades that beat the random yardstick on the average trade: **8 of 37**.
- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **none**.
- Variants with at least 40 trades and an adjusted p below 0.05 (a real edge after correcting for the 70 tries): **none**.
- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.

