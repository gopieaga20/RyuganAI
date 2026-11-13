# S/R + VWAP combined with the other strategies: ranked report

Generated 2026-11-13 by `node tools/bt_strategies.mjs sr-vwap`. Same data, engine and rules as `strategy_backtest_report.md` (2 years of 15-minute candles, 14 symbols, ATM option MODEL, 10,000 Rs premium per trade after charges, stop -30% / target +30%, entries 10:15-14:30, at most 5 open, one per underlying).

Every combination is **S/R + VWAP plus up to three more strategies, all of which must agree on the direction**. Two bases were used: "S/R" (breakout, break-and-retest or rejection of the previous day high/low and swing levels) and "S/R breakout" only. The extra strategies are EMA trend, RSI, FVG retest, three Bollinger readings (reversal outside the band, breakout outside the band, side of the middle band), Structure BOS/CHoCH, Volume push, SMC + displacement and the hourly trend. 352 combinations; only those with at least 60 trades are ranked, and combinations that give exactly the same trades are shown once, as the simplest (129 distinct rows).

## References

| Row | Strategy (all must agree) | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| random | RANDOM direction (yardstick) | 2190 | -348 | 0.79 | 44% | -762370 | -804126 | -18252 | -512 / -162 | 62 | -0.2 | 49% |
| VWAP | VWAP alone | 2124 | -228 | 0.86 | 46% | -484855 | -496110 | -18132 | -279 / -171 | 269 | 0.9 | 50% |
| S/R | S/R alone | 2084 | -385 | 0.77 | 44% | -802626 | -849588 | -24186 | -465 / -293 | 59 | 0.9 | 50% |
| live | Live vote (6 strategies + SMC, score >= 8 of 10) as the app uses today | 267 | -318 | 0.81 | 45% | -84924 | -119808 | -12048 | -449 / -162 | 186 | 4.2 | 53% |

## 1. Top 25 by average Rs per trade (realistic option model)

| Rank | Combination (all must agree) | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | S/R + VWAP + RSI + FVG retest + Volume push | 64 | -109 | 0.93 | 48% | -6954 | -39726 | -6024 | 76 / -305 | 453 | 2.0 | 47% |
| 2 | S/R breakout + VWAP + RSI + FVG retest + Hourly trend (EMA100/200) | 131 | -146 | 0.91 | 47% | -19160 | -57768 | -8264 | -409 / 217 | 167 | 2.7 | 45% |
| 3 | S/R + VWAP + FVG retest + Bollinger breakout | 67 | -149 | 0.91 | 48% | -9996 | -24906 | -6024 | -265 / 143 | 388 | 0.9 | 55% |
| 4 | S/R breakout + VWAP + RSI + FVG retest | 249 | -180 | 0.89 | 47% | -44906 | -70536 | -9036 | -230 / -100 | 214 | 1.7 | 47% |
| 5 | S/R + VWAP + Bollinger breakout + Structure BOS/CHoCH | 994 | -241 | 0.85 | 46% | -239540 | -294258 | -15060 | -259 / -213 | 269 | 3.7 | 52% |
| 6 | S/R + VWAP + Bollinger breakout | 1012 | -243 | 0.85 | 46% | -245804 | -297510 | -15060 | -259 / -218 | 271 | 3.8 | 52% |
| 7 | S/R breakout + VWAP + Bollinger breakout + Structure BOS/CHoCH | 963 | -245 | 0.85 | 46% | -236078 | -285552 | -15060 | -246 / -245 | 220 | 3.7 | 52% |
| 8 | S/R + VWAP + FVG retest + Volume push | 78 | -246 | 0.85 | 46% | -19152 | -42888 | -6024 | -85 / -443 | 326 | 1.4 | 44% |
| 9 | S/R breakout + VWAP + Bollinger breakout | 981 | -247 | 0.85 | 46% | -242342 | -288804 | -15060 | -246 / -249 | 220 | 3.8 | 52% |
| 10 | S/R breakout + VWAP + EMA trend 9/21/50 + RSI + FVG retest | 204 | -261 | 0.84 | 46% | -53222 | -77250 | -9036 | -327 / -157 | 103 | 2.5 | 47% |
| 11 | S/R + VWAP + EMA trend 9/21/50 + FVG retest + Volume push | 66 | -287 | 0.83 | 45% | -18972 | -42738 | -6024 | 66 / -738 | 388 | 1.3 | 44% |
| 12 | S/R breakout + VWAP + RSI + Volume push | 261 | -302 | 0.82 | 45% | -78840 | -132036 | -9066 | -443 / -99 | 78 | -0.7 | 46% |
| 13 | S/R breakout + VWAP + RSI + Bollinger breakout | 714 | -304 | 0.82 | 45% | -217358 | -240024 | -18102 | -345 / -233 | 165 | 1.7 | 50% |
| 14 | S/R + VWAP | 1861 | -306 | 0.81 | 45% | -568936 | -611592 | -18192 | -358 / -239 | 189 | 1.6 | 51% |
| 15 | S/R + VWAP + RSI + FVG retest | 452 | -312 | 0.81 | 45% | -140858 | -148934 | -12048 | -298 / -331 | 45 | 0.7 | 48% |
| 16 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 494 | -312 | 0.81 | 45% | -154118 | -171660 | -12078 | -287 / -353 | 123 | 4.3 | 52% |
| 17 | S/R + VWAP + RSI + Bollinger breakout | 745 | -312 | 0.81 | 45% | -232808 | -261438 | -18102 | -341 / -264 | 199 | 2.0 | 51% |
| 18 | S/R breakout + VWAP + Volume push | 418 | -316 | 0.81 | 45% | -132144 | -185190 | -12108 | -359 / -256 | 166 | 4.8 | 51% |
| 19 | S/R breakout + VWAP + RSI + Bollinger breakout + Structure BOS/CHoCH | 700 | -319 | 0.81 | 45% | -223142 | -248820 | -18102 | -372 / -226 | 160 | 1.5 | 50% |
| 20 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout | 796 | -320 | 0.81 | 45% | -254552 | -280440 | -12078 | -359 / -260 | 142 | 4.1 | 53% |
| 21 | S/R breakout + VWAP + RSI + Volume push + Hourly trend (EMA100/200) | 156 | -322 | 0.81 | 45% | -50292 | -97854 | -6024 | -443 / -153 | 43 | 0.7 | 50% |
| 22 | S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 512 | -325 | 0.80 | 45% | -166376 | -183918 | -12078 | -348 / -288 | 124 | 4.5 | 52% |
| 23 | S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout | 820 | -325 | 0.80 | 45% | -266900 | -295770 | -12078 | -382 / -242 | 163 | 4.2 | 53% |
| 24 | S/R breakout + VWAP + Bollinger mid-band side + Volume push | 415 | -326 | 0.80 | 45% | -135096 | -188142 | -12108 | -362 / -275 | 160 | 4.8 | 52% |
| 25 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout + Structure BOS/CHoCH | 780 | -326 | 0.80 | 45% | -254312 | -283212 | -12078 | -368 / -263 | 130 | 4.0 | 52% |

## 2. Top 25 by a combined rank

Each combination is ranked on four things (average Rs per trade, profit factor, average on the LAST 40% of the period, and the underlying 1-hour move), and the four ranks are averaged. This avoids picking a winner on one lucky number.

| Combined rank | Combination | Trades | Avg Rs/trade | PF | Avg last 40% | Underlying 1h (bps) | Ranks (avg / PF / last / bps) |
|---|---|---|---|---|---|---|---|
| 1 | S/R breakout + VWAP + RSI + FVG retest + Hourly trend (EMA100/200) | 131 | -146 | 0.91 | 217 | 2.7 | 2 / 2 / 1 / 45 |
| 2 | S/R + VWAP + Bollinger breakout + Structure BOS/CHoCH | 994 | -241 | 0.85 | -213 | 3.7 | 5 / 5 / 17 / 33 |
| 3 | S/R + VWAP + Bollinger breakout | 1012 | -243 | 0.85 | -218 | 3.8 | 6 / 6 / 19 / 30 |
| 4 | S/R breakout + VWAP + RSI + FVG retest | 249 | -180 | 0.89 | -100 | 1.7 | 4 / 4 / 5 / 56 |
| 5 | S/R breakout + VWAP + Bollinger breakout + Structure BOS/CHoCH | 963 | -245 | 0.85 | -245 | 3.7 | 7 / 7 / 26 / 32 |
| 6 | S/R breakout + VWAP + Bollinger breakout | 981 | -247 | 0.85 | -249 | 3.8 | 9 / 9 / 27 / 28 |
| 7 | S/R breakout + VWAP + EMA trend 9/21/50 + RSI + FVG retest | 204 | -261 | 0.84 | -157 | 2.5 | 10 / 10 / 12 / 46 |
| 8 | S/R breakout + VWAP + Volume push | 418 | -316 | 0.81 | -256 | 4.8 | 18 / 18 / 28 / 15 |
| 9 | S/R + VWAP + RSI + FVG retest + Volume push | 64 | -109 | 0.93 | -305 | 2.0 | 1 / 1 / 37 / 47 |
| 10 | S/R + VWAP + FVG retest + Bollinger breakout | 67 | -149 | 0.91 | 143 | 0.9 | 3 / 3 / 2 / 82 |
| 11 | S/R breakout + VWAP + Bollinger mid-band side + Volume push | 415 | -326 | 0.80 | -275 | 4.8 | 24 / 22 / 33 / 14 |
| 12 | S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout | 820 | -325 | 0.80 | -242 | 4.2 | 23 / 24 / 24 / 23 |
| 13 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout | 796 | -320 | 0.81 | -260 | 4.1 | 20 / 20 / 30 / 25 |
| 14 | S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 512 | -325 | 0.80 | -288 | 4.5 | 22 / 23 / 36 / 19 |
| 15 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 494 | -312 | 0.81 | -353 | 4.3 | 16 / 16 / 50 / 20 |
| 16 | S/R breakout + VWAP + RSI + Bollinger breakout | 714 | -304 | 0.82 | -233 | 1.7 | 13 / 13 / 22 / 55 |
| 17 | S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout + Structure BOS/CHoCH | 804 | -332 | 0.80 | -244 | 4.1 | 28 / 28 / 25 / 24 |
| 18 | S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout + Structure BOS/CHoCH | 780 | -326 | 0.80 | -263 | 4.0 | 25 / 25 / 31 / 26 |
| 19 | S/R + VWAP | 1861 | -306 | 0.81 | -239 | 1.6 | 14 / 14 / 23 / 60 |
| 20 | S/R + VWAP + RSI + Bollinger breakout | 745 | -312 | 0.81 | -264 | 2.0 | 17 / 17 / 32 / 48 |
| 21 | S/R breakout + VWAP + RSI + Bollinger breakout + Structure BOS/CHoCH | 700 | -319 | 0.81 | -226 | 1.5 | 19 / 19 / 20 / 61 |
| 22 | S/R + VWAP + RSI + Bollinger breakout + Volume push | 195 | -368 | 0.78 | -54 | 1.7 | 34 / 34 / 3 / 58 |
| 23 | S/R + VWAP + RSI + Bollinger breakout + Structure BOS/CHoCH | 731 | -326 | 0.80 | -258 | 1.8 | 26 / 26 / 29 / 52 |
| 24 | S/R + VWAP + Bollinger mid-band side | 1788 | -328 | 0.80 | -228 | 1.6 | 27 / 27 / 21 / 59 |
| 25 | S/R breakout + VWAP + Structure BOS/CHoCH + Volume push | 404 | -371 | 0.78 | -336 | 5.1 | 38 / 38 / 48 / 11 |

## 3. What each single add-on does to S/R + VWAP

Base "S/R + VWAP agree": 1861 trades, -306 Rs/trade, PF 0.81. Adding ONE strategy (a strategy that disagrees with S/R + VWAP most of the time leaves very few trades, for example Bollinger reversal, which bets on a return to the mean while VWAP bets on the trend):

| Add-on | Trades | Avg Rs/trade | Change vs base | PF | Avg first 60% / last 40% | Underlying 1h (bps) |
|---|---|---|---|---|---|---|
| + Bollinger breakout | 1012 | -243 | +63 | 0.85 | -259 / -218 | 3.8 |
| + Bollinger mid-band side | 1788 | -328 | -22 | 0.80 | -406 / -228 | 1.6 |
| + Structure BOS/CHoCH | 1709 | -383 | -77 | 0.77 | -427 / -325 | 1.5 |
| + Volume push | 540 | -408 | -102 | 0.76 | -446 / -358 | 3.8 |
| + RSI | 1458 | -411 | -105 | 0.76 | -474 / -326 | 1.1 |
| + FVG retest | 557 | -423 | -117 | 0.75 | -391 / -468 | -0.1 |
| + EMA trend 9/21/50 | 1565 | -424 | -119 | 0.75 | -469 / -365 | 0.9 |
| + Hourly trend (EMA100/200) | 1170 | -524 | -218 | 0.70 | -609 / -407 | -0.1 |
| + SMC + displacement | 28 | too few trades to judge | - | - | - | - |
| + Bollinger reversal | 0 | too few trades to judge | - | - | - | - |

## 4. Chosen on the first 60%, judged on the last 40%

| Combination | Trades first 60% | Avg first 60% | Trades last 40% | Avg last 40% |
|---|---|---|---|---|
| S/R + VWAP + FVG retest + Volume push | 43 | -85 | 35 | -443 |
| S/R breakout + VWAP + RSI + FVG retest | 153 | -230 | 96 | -100 |
| S/R breakout + VWAP + Bollinger breakout | 598 | -246 | 383 | -249 |
| S/R breakout + VWAP + Bollinger breakout + Structure BOS/CHoCH | 585 | -246 | 378 | -245 |
| S/R + VWAP + Bollinger breakout | 614 | -259 | 398 | -218 |
| S/R + VWAP + Bollinger breakout + Structure BOS/CHoCH | 601 | -259 | 393 | -213 |
| S/R breakout + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 308 | -287 | 186 | -353 |
| S/R + VWAP + RSI + FVG retest | 265 | -298 | 187 | -331 |
| S/R breakout + VWAP + Bollinger breakout + Volume push + Hourly trend (EMA100/200) | 107 | -323 | 60 | -714 |
| S/R breakout + VWAP + EMA trend 9/21/50 + RSI + FVG retest | 125 | -327 | 79 | -157 |
| S/R + VWAP + RSI + Bollinger breakout | 469 | -341 | 276 | -264 |
| S/R breakout + VWAP + Bollinger breakout + Hourly trend (EMA100/200) | 339 | -342 | 197 | -379 |
| S/R breakout + VWAP + RSI + Bollinger breakout | 454 | -345 | 260 | -233 |
| S/R + VWAP + EMA trend 9/21/50 + Bollinger breakout + Hourly trend (EMA100/200) | 315 | -348 | 197 | -288 |
| S/R + VWAP | 1039 | -358 | 822 | -239 |

Of the 15 best on the first 60%, **0 were profitable on the last 40%**.

## 5. How much to trust the ranking

About **788 strategies and combinations** have now been tried on this one data set. For the best-looking rows, **adjusted p** is the bootstrap p (chance that the same number of random-direction trades does at least as well) multiplied by that count; above about 0.05 it is not evidence of an edge.

| Combination | Trades | Avg Rs/trade | Bootstrap p | Adjusted p |
|---|---|---|---|---|
| S/R + VWAP + RSI + FVG retest + Volume push | 64 | -109 | 0.298 | 1.00 |
| S/R breakout + VWAP + RSI + FVG retest + Hourly trend (EMA100/200) | 131 | -146 | 0.230 | 1.00 |
| S/R + VWAP + FVG retest + Bollinger breakout | 67 | -149 | 0.327 | 1.00 |
| S/R breakout + VWAP + RSI + FVG retest | 249 | -180 | 0.201 | 1.00 |
| S/R + VWAP + Bollinger breakout + Structure BOS/CHoCH | 994 | -241 | 0.123 | 1.00 |

## 6. Summary

- Random-direction yardstick: -348 Rs per trade. S/R + VWAP: -306. The live vote as the app uses it: -318.
- Combinations that are profitable in the realistic model: **0 of 129**; profitable in both halves of the period: **0**.
- Best by average per trade: **S/R + VWAP + RSI + FVG retest + Volume push** (64 trades, -109 Rs/trade, PF 0.93). Best by combined rank: **S/R breakout + VWAP + RSI + FVG retest + Hourly trend (EMA100/200)**.
- More strategies that must agree means fewer trades, so a high average on a small number of trades is the most likely thing to be luck. Treat the top of the list as ideas to watch on paper trading.
