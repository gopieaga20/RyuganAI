# Strategy backtest report

Generated 2026-11-13 by `tools/bt_strategies.mjs`. Data: 14 symbols, 15-minute candles, 2024-11-06 to 2026-11-02.

## How to read this

- Every strategy runs through the **same engine**: signal on a bar close, fill at the next bar open, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying, ATM option held to stop (-30%) or target (+30%).
- **Option prices are a model**, not real data (no historical option candles exist): ATM, delta 0.5, premium a % of spot. "Realistic" includes time decay; "no-decay" is a best case that no real option achieves. Each trade is Rs 10,000 of premium, after full option charges.
- **Underlying move 1h** needs no option model: the average move of the underlying, in the signal's direction, over the next hour (basis points). A strategy with a real edge shows a clearly positive number. Hit rate near 50% means a coin flip.
- The **RANDOM** row is the yardstick: coin-flip direction through the same gates. A strategy only has an edge if it clearly beats it, in BOTH halves of the period.
- "Avg first 60% / last 40%" splits the period in time: an edge that only exists in one half is luck.

## 1. Each strategy on its own

| Strategy | Signals | Trades | Avg Rs/trade | Win | PF | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | No-decay PF | Underlying move 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RANDOM direction (yardstick) | 12544 | 2190 | -348 | 44% | 0.79 | -762370 | -804126 | -18252 | -512 / -162 | 62 | 1.04 | -0.2 | 49% |
| EMA trend 9/21/50 | 72454 | 2110 | -485 | 42% | 0.72 | -1023326 | -1026594 | -27228 | -502 / -465 | 46 | 1.03 | -0.8 | 49% |
| RSI momentum | 52962 | 2083 | -491 | 42% | 0.72 | -1023682 | -1037682 | -27198 | -548 / -426 | 24 | 1.02 | 0.1 | 50% |
| VWAP side | 88173 | 2124 | -228 | 46% | 0.86 | -484855 | -496110 | -18132 | -279 / -171 | 269 | 1.20 | 0.9 | 50% |
| Structure BOS/CHoCH | 88173 | 2114 | -391 | 44% | 0.77 | -825584 | -825584 | -30240 | -361 / -423 | 97 | 1.07 | -0.0 | 50% |
| FVG retest | 6276 | 1966 | -303 | 45% | 0.82 | -595640 | -632154 | -21174 | -331 / -270 | 73 | 1.05 | 0.6 | 49% |
| Volume push | 6167 | 1853 | -431 | 43% | 0.75 | -798024 | -832578 | -21084 | -461 / -395 | 37 | 1.02 | 1.5 | 49% |
| Higher-timeframe trend (EMA100/200 on 15m) | 61465 | 2114 | -515 | 42% | 0.71 | -1089320 | -1101564 | -39426 | -596 / -424 | 33 | 1.02 | -1.3 | 49% |
| SMC (structure + order block / gap / sweep + discount-premium) | 3116 | 1387 | -389 | 44% | 0.77 | -539286 | -559590 | -21084 | -409 / -362 | -17 | 0.99 | -0.6 | 49% |
| SMC part: order-block retest | 3009 | 1143 | -484 | 42% | 0.72 | -553608 | -556590 | -21174 | -602 / -322 | -47 | 0.97 | 0.1 | 49% |
| SMC part: liquidity sweep | 3064 | 1528 | -509 | 42% | 0.71 | -778164 | -792024 | -18102 | -613 / -385 | -112 | 0.93 | -0.1 | 50% |
| SMC part: premium/discount half | 59582 | 2042 | -486 | 42% | 0.72 | -993115 | -1020702 | -27138 | -596 / -360 | -62 | 0.96 | -0.1 | 50% |

## 2. Combinations (all listed strategies must agree, or the weighted vote must reach the score)

| Strategy | Signals | Trades | Avg Rs/trade | Win | PF | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | No-decay PF | Underlying move 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Today's vote (6 strategies, score >= 7) | 3636 | 1590 | -375 | 44% | 0.78 | -596057 | -630156 | -18072 | -476 / -244 | 48 | 1.03 | 0.9 | 49% |
| Today's vote (score >= 6) | 27644 | 2186 | -362 | 44% | 0.78 | -791172 | -805806 | -30150 | -450 / -259 | 62 | 1.04 | -0.1 | 50% |
| Today's vote + SMC (weight 2, score >= 8 of 10) | 566 | 477 | -361 | 44% | 0.79 | -171990 | -189552 | -12048 | -538 / -107 | 155 | 1.11 | -0.3 | 47% |
| Today's vote + SMC (weight 2, score >= 7) | 4179 | 1705 | -366 | 44% | 0.78 | -624188 | -652920 | -21114 | -490 / -207 | 73 | 1.05 | 0.5 | 49% |
| Today's vote + SMC (weight 2, score >= 6) | 28305 | 2192 | -360 | 44% | 0.79 | -788124 | -802884 | -30150 | -419 / -290 | 41 | 1.03 | -0.1 | 50% |
| SMC + EMA trend agree | 1694 | 962 | -451 | 43% | 0.74 | -434010 | -462960 | -21084 | -455 / -445 | -15 | 0.99 | -1.2 | 49% |
| SMC + VWAP agree | 698 | 514 | -365 | 44% | 0.78 | -187530 | -202170 | -12048 | -457 / -215 | 55 | 1.04 | -0.7 | 47% |
| SMC + volume agree | 127 | 113 | -201 | 47% | 0.87 | -22674 | -51474 | -6024 | -328 / -15 | 120 | 1.08 | 0.2 | 50% |
| SMC + RSI agree | 875 | 639 | -479 | 42% | 0.72 | -306288 | -335688 | -15060 | -624 / -275 | -86 | 0.94 | -1.1 | 47% |
| SMC + trend + VWAP agree | 508 | 390 | -338 | 45% | 0.80 | -131724 | -157872 | -12048 | -514 / -15 | 77 | 1.05 | -2.0 | 46% |
| SMC + trend + VWAP + RSI agree | 308 | 259 | -258 | 46% | 0.84 | -66822 | -92850 | -9036 | -417 / 17 | 171 | 1.12 | -2.5 | 44% |
| Structure + FVG agree | 6276 | 1966 | -303 | 45% | 0.82 | -595640 | -632154 | -21174 | -331 / -270 | 73 | 1.05 | 0.6 | 49% |
| Structure + EMA trend + VWAP agree | 47513 | 2137 | -383 | 44% | 0.77 | -818394 | -838068 | -33132 | -422 / -339 | 75 | 1.05 | 0.0 | 50% |
| Order block + sweep agree | 129 | 117 | -758 | 38% | 0.60 | -88668 | -91650 | -6024 | -934 / -443 | -399 | 0.77 | -0.7 | 47% |
| EMA trend + VWAP + RSI agree | 27120 | 2122 | -401 | 44% | 0.76 | -849866 | -867930 | -30180 | -508 / -274 | 0 | 1.00 | -0.3 | 50% |
| SMC + higher-timeframe trend agree | 1579 | 832 | -440 | 43% | 0.74 | -366126 | -406224 | -21084 | -457 / -416 | 7 | 1.00 | -1.4 | 48% |
| SMC + higher-timeframe trend + VWAP agree | 382 | 289 | -191 | 47% | 0.88 | -55284 | -113724 | -12048 | -415 / 177 | 235 | 1.17 | -2.8 | 45% |
| Today's vote + SMC (>= 8 of 10) + higher-timeframe trend agree | 366 | 310 | -324 | 45% | 0.80 | -100554 | -126702 | -12048 | -463 / -147 | 207 | 1.15 | -1.7 | 45% |
| Today's vote (>= 7) + higher-timeframe trend agree | 2294 | 1169 | -332 | 45% | 0.80 | -388015 | -423552 | -15060 | -408 / -232 | 119 | 1.08 | 1.4 | 49% |
| SMC, morning only (10:15-11:30) | 1126 | 720 | -340 | 45% | 0.80 | -244566 | -271254 | -12048 | -326 / -359 | 18 | 1.01 | 0.6 | 49% |
| SMC, afternoon only (13:00-14:30) | 1098 | 698 | -496 | 42% | 0.72 | -346134 | -352098 | -18072 | -540 / -431 | -6 | 1.00 | 0.4 | 51% |
| SMC + FVG retest agree (the two imbalance setups) | 774 | 570 | -572 | 41% | 0.68 | -326232 | -352740 | -18072 | -729 / -348 | -155 | 0.90 | -1.0 | 46% |

## 2b. SMC variants: displacement candle, and liquidity sweep followed by a change of character

Added after the first report. **Displacement**: the structure break must be a big one-directional candle (body >= 1.5x the recent average range, closing in its outer quarter). **Sweep then CHoCH**: a wick takes a swing low/high and closes back inside, then within 12 bars price breaks structure the other way; entered on the CHoCH bar or on the pullback into the order block / gap within 8 bars.

| Strategy | Signals | Trades | Avg Rs/trade | Win | PF | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | No-decay PF | Underlying move 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SMC + displacement candle | 710 | 409 | -330 | 45% | 0.80 | -135006 | -158742 | -9036 | -397 / -232 | 29 | 1.02 | 0.0 | 51% |
| Sweep then CHoCH (CHoCH bar or pullback) | 946 | 630 | -329 | 45% | 0.80 | -207252 | -222162 | -15060 | -415 / -215 | 76 | 1.05 | 1.5 | 50% |
| Sweep then CHoCH: enter on the CHoCH bar | 402 | 392 | -351 | 44% | 0.79 | -137748 | -149676 | -9036 | -470 / -193 | 46 | 1.03 | 1.8 | 49% |
| Sweep then CHoCH: enter on the pullback | 544 | 368 | -422 | 43% | 0.75 | -155370 | -172962 | -9036 | -422 / -422 | 10 | 1.01 | 1.3 | 51% |
| Sweep then CHoCH with a displacement candle | 244 | 169 | -529 | 41% | 0.70 | -89448 | -98394 | -6024 | -565 / -479 | -86 | 0.94 | -1.8 | 48% |
| SMC + displacement + VWAP agree | 152 | 120 | 135 | 53% | 1.09 | 16182 | -24216 | -6024 | 73 / 216 | 435 | 1.34 | 4.1 | 56% |
| SMC + displacement + higher-timeframe trend agree | 384 | 224 | -390 | 44% | 0.77 | -87276 | -110862 | -9036 | -296 / -514 | -2 | 1.00 | -0.9 | 51% |
| SMC + displacement + volume agree | 25 | 25 | 345 | 56% | 1.26 | 8616 | -6084 | -3012 | -15 / 584 | 824 | 1.76 | 17.1 | 71% |
| Sweep->CHoCH + VWAP agree | 827 | 569 | -336 | 45% | 0.80 | -191352 | -206262 | -15060 | -370 / -290 | 101 | 1.07 | 1.8 | 50% |
| Sweep->CHoCH + higher-timeframe trend agree | 338 | 235 | -308 | 45% | 0.81 | -72456 | -84204 | -12048 | -259 / -375 | 190 | 1.14 | -0.7 | 50% |
| Sweep->CHoCH + displacement + VWAP agree | 216 | 153 | -583 | 41% | 0.67 | -89208 | -98154 | -6024 | -627 / -514 | -113 | 0.93 | -2.6 | 47% |
| Sweep->CHoCH + RSI agree | 606 | 442 | -246 | 46% | 0.85 | -108528 | -129042 | -12048 | -310 / -150 | 223 | 1.16 | 3.2 | 52% |
| Sweep->CHoCH (pullback) + VWAP + volume agree | 28 | 26 | 677 | 62% | 1.58 | 17592 | -12078 | -3012 | 584 / 802 | 1368 | 2.69 | 19.7 | 65% |
| Sweep->CHoCH + live vote (>= 6) agree | 286 | 214 | -15 | 50% | 0.99 | -3210 | -34512 | -9036 | 125 / -224 | 349 | 1.26 | 1.8 | 55% |
| Live vote (>= 7) + sweep->CHoCH agree | 152 | 128 | 79 | 52% | 1.05 | 10068 | -30630 | -6024 | 326 / -321 | 519 | 1.42 | 0.7 | 57% |
| Live vote (>= 6) + SMC displacement agree | 98 | 81 | 244 | 54% | 1.18 | 19764 | -24366 | -6024 | 168 / 360 | 614 | 1.52 | 2.6 | 57% |
| Sweep->CHoCH, morning only (10:15-11:30) | 477 | 366 | -359 | 44% | 0.79 | -131364 | -137328 | -12048 | -427 / -266 | 26 | 1.02 | 0.5 | 50% |
| Sweep->CHoCH + displacement + VWAP + higher-timeframe trend agree | 76 | 56 | -550 | 41% | 0.69 | -30810 | -33672 | -6024 | -651 / -406 | -229 | 0.86 | -9.5 | 47% |

## 2c. Support and resistance

Levels: the previous session high / low / close and the last swing highs and lows. **Breakout**: a fresh strong close beyond the previous day high or low. **Break-and-retest**: after such a breakout today, price touches the broken level and closes back away from it. **Rejection**: a wick through a level that closes back on the original side (a reversal). "S/R" is any of the three.

| Strategy | Signals | Trades | Avg Rs/trade | Win | PF | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | No-decay PF | Underlying move 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Support/resistance (all three setups) | 8940 | 2084 | -385 | 44% | 0.77 | -802626 | -849588 | -24186 | -465 / -293 | 59 | 1.04 | 0.9 | 50% |
| S/R breakout of previous day high/low | 4143 | 1617 | -430 | 43% | 0.75 | -694611 | -715215 | -24216 | -479 / -366 | 52 | 1.04 | 1.5 | 50% |
| S/R break-and-retest | 1919 | 1089 | -477 | 42% | 0.73 | -519548 | -527532 | -21084 | -453 / -509 | -45 | 0.97 | -0.1 | 51% |
| S/R rejection (reversal at a level) | 2933 | 1523 | -510 | 42% | 0.71 | -777440 | -809016 | -21144 | -619 / -372 | -32 | 0.98 | 0.5 | 49% |
| S/R + VWAP agree | 5892 | 1861 | -306 | 45% | 0.81 | -568936 | -611592 | -18192 | -358 / -239 | 189 | 1.13 | 1.6 | 51% |
| S/R + higher-timeframe trend agree | 4166 | 1485 | -531 | 41% | 0.70 | -788435 | -791417 | -27108 | -648 / -383 | -21 | 0.99 | 0.2 | 50% |
| S/R + volume agree | 924 | 682 | -432 | 43% | 0.75 | -294296 | -329664 | -18132 | -465 / -387 | 69 | 1.05 | 2.4 | 51% |
| S/R + EMA trend agree | 5550 | 1769 | -404 | 44% | 0.76 | -714634 | -730020 | -24156 | -465 / -328 | 13 | 1.01 | 0.7 | 50% |
| S/R + RSI agree | 4191 | 1585 | -464 | 43% | 0.73 | -735850 | -754368 | -18192 | -528 / -381 | -21 | 0.99 | 1.1 | 51% |
| S/R breakout + VWAP agree | 3767 | 1524 | -378 | 44% | 0.78 | -576518 | -594140 | -24216 | -423 / -319 | 132 | 1.09 | 1.8 | 51% |
| S/R breakout + volume agree | 547 | 431 | -370 | 44% | 0.78 | -159312 | -206364 | -12108 | -375 / -363 | 124 | 1.09 | 4.3 | 51% |
| S/R breakout + higher-timeframe trend agree | 2295 | 1024 | -544 | 41% | 0.69 | -556745 | -559554 | -18132 | -647 / -402 | -94 | 0.94 | 0.4 | 49% |
| S/R break-and-retest + VWAP agree | 1281 | 795 | -433 | 43% | 0.75 | -344592 | -358602 | -21084 | -460 / -396 | -34 | 0.98 | 0.1 | 52% |
| S/R rejection + RSI agree | 296 | 273 | -729 | 38% | 0.61 | -198900 | -231582 | -9066 | -877 / -519 | -136 | 0.91 | 2.3 | 48% |
| S/R rejection + SMC liquidity sweep agree | 1434 | 1028 | -557 | 41% | 0.69 | -572862 | -587052 | -15120 | -658 / -415 | -138 | 0.91 | 1.1 | 49% |
| S/R + SMC (displacement) agree | 139 | 121 | -535 | 41% | 0.70 | -64752 | -70686 | -9036 | -539 / -527 | -15 | 0.99 | -5.1 | 50% |
| Live vote (>= 6) + S/R agree | 3115 | 1327 | -525 | 42% | 0.70 | -696155 | -705948 | -21174 | -569 / -463 | -75 | 0.95 | 0.4 | 50% |
| Live vote (>= 7) + S/R agree | 759 | 581 | -457 | 43% | 0.73 | -265670 | -298584 | -12048 | -497 / -403 | -72 | 0.95 | -0.4 | 47% |
| Live vote + SMC + S/R as votes (S/R weight 2, >= 8 of 12) | 3354 | 1412 | -513 | 42% | 0.71 | -724403 | -734136 | -24126 | -579 / -427 | -104 | 0.93 | 0.6 | 51% |
| S/R + VWAP + volume agree | 710 | 540 | -408 | 44% | 0.76 | -220238 | -255906 | -15060 | -446 / -358 | 87 | 1.06 | 3.8 | 52% |

## 3. All pairs and triples, chosen on the first 60% and judged on the last 40%

Trying many combinations always finds some that look good by luck. To check, they are **ranked on the first 60% of the period only** and the table shows how the top ones did on the **last 40%, which was not used to choose them**.

| Combination (all agree) | Trades first 60% | Avg first 60% (Rs) | Trades last 40% | Avg last 40% (Rs) | Full-period PF | Underlying move 1h (bps) |
|---|---|---|---|---|---|---|
| trend + structure + smcdisp | 156 | 23 | 106 | -411 | 0.90 | 1.1 |
| trend + smc + smcdisp | 156 | 23 | 106 | -411 | 0.90 | 1.1 |
| trend + smcdisp | 156 | 23 | 106 | -411 | 0.90 | 1.1 |
| trend + structure + sc_any | 159 | -34 | 105 | -386 | 0.89 | 2.0 |
| trend + sc_any | 159 | -34 | 105 | -386 | 0.89 | 2.0 |
| vwap + fvg + htf | 710 | -184 | 596 | -290 | 0.86 | 0.0 |
| vwap + fvg + sc_any | 150 | -215 | 112 | -604 | 0.77 | -1.0 |
| rsi + fvg + srbrk | 172 | -224 | 119 | -7 | 0.91 | 1.2 |
| vwap + structure + fvg | 1014 | -240 | 853 | -302 | 0.84 | 0.6 |
| vwap + fvg | 1014 | -240 | 853 | -302 | 0.84 | 0.6 |
| rsi + vwap + sc_any | 244 | -261 | 161 | -183 | 0.86 | 3.3 |
| structure + fvg + sc_any | 169 | -281 | 130 | -430 | 0.79 | -0.0 |

Of the 12 best combinations on the first 60%, **0 were profitable on the last 40%** (realistic model).

## 4. How much to trust the best-looking rows

Roughly **436 strategies and combinations** were tried on this one data set. Looking at that many, a few will always look good by chance. For the rows that looked best:

- **bootstrap p**: how often the SAME NUMBER of random-direction trades averages at least as much (small = unlikely to be luck for ONE test);
- **adjusted p**: that p multiplied by the number of things tried (a fair correction for having searched). Anything above about 0.05 is NOT evidence of an edge;
- **quarters profitable**: an edge should show up in most quarters, not in one lucky stretch.

| Configuration | Trades | Avg Rs/trade | Bootstrap p | Adjusted p | Quarters profitable |
|---|---|---|---|---|---|
| Live vote (>= 6) + SMC displacement agree | 81 | 244 | 0.047 | 1.00 | 5 of 9 |
| SMC + displacement + VWAP agree | 120 | 135 | 0.047 | 1.00 | 5 of 9 |

- Live vote (>= 6) + SMC displacement agree: 2024Q4 4 trades 5934 · 2025Q1 13 trades -3192 · 2025Q2 10 trades -6144 · 2025Q3 9 trades 14850 · 2025Q4 12 trades -180 · 2026Q1 11 trades -15150 · 2026Q2 11 trades 2832 · 2026Q3 8 trades 11868 · 2026Q4 3 trades 8946
- SMC + displacement + VWAP agree: 2024Q4 7 trades 2892 · 2025Q1 17 trades -9246 · 2025Q2 13 trades 2802 · 2025Q3 13 trades 8796 · 2025Q4 16 trades -240 · 2026Q1 19 trades -9276 · 2026Q2 16 trades -240 · 2026Q3 16 trades 11748 · 2026Q4 3 trades 8946

## 5. What the numbers say

- Random-direction yardstick: average -348 Rs per trade (realistic model), profit factor 0.79, underlying move -0.2 bps. This is what "no skill" costs: charges and option decay.
- Best single/combination row on average per trade (realistic): **Sweep->CHoCH (pullback) + VWAP + volume agree** at 677 Rs per trade, profit factor 1.58.
- Rows profitable in the realistic model AND in both halves of the period: **SMC + displacement + VWAP agree; Sweep->CHoCH (pullback) + VWAP + volume agree; Live vote (>= 6) + SMC displacement agree**.
- **Support/resistance**: every S/R row loses in the realistic model (best: S/R + VWAP agree). Forcing S/R into the live vote made results worse (live vote >= 7 + S/R agree: -457 Rs/trade against -375 without it). So the app shows it in the strategy check and on the chart (previous day high / low / close) but gives it weight 0.
- **None of these survives section 4**: after correcting for the number of things tried, no row is distinguishable from luck. Treat rows that look good as ideas to watch on paper trading, not as proven.
- A result only counts if it beats RANDOM in both halves; small differences over a few hundred trades are noise.

