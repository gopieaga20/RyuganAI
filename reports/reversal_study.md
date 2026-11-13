# Why high-confidence calls reverse, and what could help

Generated 2026-11-13 by `node tools/bt_reversal.mjs`. **Signal**: the six core strategies (EMA trend, RSI, VWAP, structure, FVG, volume) voting 7+ of 8 one way with ADX >= 20 (what the app showed as 85%+ before SMC was added), read at a 15-minute close, entered at the next open, 10:15-14:30 IST. **Option**: at-the-money MODEL (delta 0.5, time decay), stop -30% / target +30%, 10,000 Rs premium per trade after charges. **Reversal** = the stop was hit before the target. Each symbol is run alone (one position at a time). 2011 signals over 2024-11-06 to 2026-11-02; thresholds below are tuned on the first 60% (1172 signals) and judged ONLY on the last 40% (839).

## 1. Each symbol on its own

| Symbol | Signals | Hit the stop first (reversal) | Hit the target first | Avg Rs/trade | PF | Avg move for the trade in the next 2h (ATR) | Avg move against it (ATR) | Avg first 60% / last 40% |
|---|---|---|---|---|---|---|---|---|
| NIFTY 50 | 150 | 42% | 57% | 406 | 1.31 | 1.41 | 1.13 | 346 / 502 |
| BANK NIFTY | 147 | 52% | 48% | -117 | 0.92 | 1.13 | 1.12 | 107 / -565 |
| HDFCBANK | 130 | 61% | 39% | -661 | 0.64 | 1.07 | 1.03 | -1066 / -72 |
| ICICIBANK | 135 | 60% | 40% | -614 | 0.66 | 1.10 | 1.35 | -707 / -488 |
| SBIN | 136 | 63% | 37% | -808 | 0.58 | 1.05 | 1.23 | -539 / -1192 |
| TATASTEEL | 156 | 48% | 52% | 100 | 1.07 | 1.45 | 0.94 | 153 / 30 |
| INFY | 140 | 60% | 40% | -614 | 0.66 | 1.07 | 1.23 | -746 / -428 |
| AXISBANK (other) | 151 | 57% | 43% | -432 | 0.75 | 1.00 | 1.29 | -560 / -253 |
| BHARTIARTL (other) | 150 | 58% | 41% | -513 | 0.71 | 1.31 | 1.14 | -644 / -359 |
| ITC (other) | 144 | 59% | 41% | -556 | 0.69 | 1.25 | 1.16 | -630 / -469 |
| LT (other) | 152 | 60% | 40% | -607 | 0.66 | 1.33 | 1.16 | -821 / -269 |
| MARUTI (other) | 162 | 59% | 41% | -533 | 0.70 | 1.15 | 1.20 | -764 / -258 |
| RELIANCE (other) | 138 | 54% | 46% | -232 | 0.86 | 1.19 | 1.16 | -246 / -215 |
| TCS (other) | 120 | 53% | 47% | -207 | 0.87 | 1.10 | 0.93 | -443 / 123 |
| **All symbols** | 2011 | 56% | 44% | -379 | 0.78 | 1.19 | 1.15 | -452 / -278 |

A symmetric coin flip hits the stop first about as often as the target (stop and target are both 30%), so a reversal rate near 50% plus costs and decay is a loss. A signal that predicts direction would hit the target clearly more often than the stop.

## 2. What the market looks like at the signal, split into fifths

For each measure, the signals are split into five equal groups from lowest to highest. The table shows how often the trade reversed (hit the stop first) in each group, over the whole period and over the first / last halves. A real warning sign would show a reversal rate that rises or falls steadily with the measure AND agrees in both periods.

| Measure | Q1 lowest | Q2 | Q3 | Q4 | Q5 highest | Q5 minus Q1 (first 60% / last 40%) |
|---|---|---|---|---|---|---|
| Stretch from the 21-EMA (ATR, in the trade direction) | 55% (0 to 1.1) | 50% (1.1 to 1.4) | 60% (1.4 to 1.8) | 59% (1.8 to 2.3) | 55% (2.3 to 6.1) | -1 / -2 pts |
| Stretch from VWAP (ATR) | 59% (0 to 0.3) | 50% (0.3 to 0.7) | 52% (0.7 to 1.2) | 58% (1.2 to 1.8) | 60% (1.8 to 5.5) | +9 / -13 pts |
| Candles in a row closing in the trade direction | 56% (1 to 1) | 55% (1 to 1) | 52% (1 to 1) | 58% (1 to 2) | 58% (2 to 10) | -1 / +6 pts |
| Move over the last 10 candles (ATR) | 55% (-2.2 to 0.7) | 56% (0.7 to 1.6) | 55% (1.6 to 2.3) | 58% (2.3 to 3.1) | 55% (3.1 to 8.2) | +1 / -2 pts |
| Move since the day opened (ATR) | 58% (-9.4 to 1) | 52% (1 to 2) | 58% (2 to 3) | 55% (3 to 4.4) | 58% (4.4 to 14.6) | +5 / -5 pts |
| RSI, flipped for puts (high = stretched in the trade direction) | 56% (46.1 to 61.7) | 52% (61.7 to 66.1) | 56% (66.1 to 69.5) | 57% (69.5 to 72.6) | 59% (72.6 to 94.4) | +4 / +3 pts |
| ADX | 54% (20 to 23.5) | 57% (23.5 to 27.7) | 56% (27.8 to 33.2) | 56% (33.3 to 41.1) | 56% (41.1 to 79.5) | -7 / +13 pts |
| Size of the signal candle (ATR) | 58% (0.2 to 0.7) | 53% (0.7 to 0.9) | 57% (0.9 to 1.1) | 57% (1.1 to 1.4) | 54% (1.4 to 7.5) | +1 / -10 pts |
| Distance to the nearest level the trade is heading into (ATR) | 57% (0 to 0.4) | 53% (0.4 to 0.9) | 55% (0.9 to 1.5) | 55% (1.5 to 9) | 59% (9 to 9) | +4 / +2 pts |
| Time of day (minutes after midnight) | 56% (615 to 660) | 56% (660 to 705) | 56% (705 to 765) | 53% (765 to 840) | 58% (840 to 870) | +7 / -6 pts |

Reversal rate = share of trades that hit the stop before the target (about 56% overall). With about 402 signals per group, differences under roughly 5 points are noise.

**Measures with the same direction of effect (at least 5 points) in BOTH periods:** none.

## 3. Candidate improvements, tuned on the first 60%, judged on the last 40%

Each filter skips signals at the stretched / crowded end of one measure (the threshold is chosen on the first 60% from the 50th to 90th percentile to maximise the average Rs per trade). The pullback rule instead waits for a 0.3 ATR better price within 4 bars and skips the signal if it never comes. Only the right-hand columns count.

| Rule | Threshold (from first 60%) | Signals kept (first / last) | Avg Rs/trade first 60% before to after | **Avg Rs/trade last 40% before to after** | Reversal rate last 40% before to after |
|---|---|---|---|---|---|
| skip when price is stretched from the 21-EMA | < 1.57 | 586 / 376 | -452 to -281 | **-278 to -198** | 54% to 53% |
| skip when price is stretched from VWAP | < 0.96 | 586 / 434 | -452 to -148 | **-278 to -344** | 54% to 55% |
| skip after a long run of candles | < 2 | 813 / 555 | -452 to -328 | **-278 to -112** | 54% to 52% |
| skip after a big 10-candle move | < 2.6 | 820 / 551 | -452 to -424 | **-278 to -243** | 54% to 54% |
| skip after a big move since the open | < 2.98 | 703 / 486 | -452 to -318 | **-278 to -438** | 54% to 57% |
| skip when RSI is already stretched | < 68.04 | 586 / 440 | -452 to -353 | **-278 to -103** | 54% to 51% |
| skip a very large signal candle | < 0.97 | 586 / 404 | -452 to -398 | **-278 to -393** | 54% to 56% |
| skip when a level is very close ahead | > 0.43 | 937 / 683 | -452 to -443 | **-278 to -273** | 54% to 54% |
| wait for a pullback (0.3 ATR, 4 bars) | - | 906 / 656 | -452 to -577 | **-278 to -253** | 54% to 54% |
| **all of the filters above together** | - | 69 / 53 | -452 to -58 | **-278 to 42** | 54% to 49% |

## 4. The combined filters, symbol by symbol (last 40% only)

| Symbol | Signals before | Avg Rs/trade before | Signals after | Avg Rs/trade after |
|---|---|---|---|---|
| NIFTY 50 | 58 | 502 | 3 | too few |
| BANK NIFTY | 49 | -565 | 4 | too few |
| HDFCBANK | 53 | -72 | 5 | 1783 |
| ICICIBANK | 57 | -488 | 4 | too few |
| SBIN | 56 | -1192 | 2 | too few |
| TATASTEEL | 67 | 30 | 5 | 1783 |
| INFY | 58 | -428 | 4 | too few |

## 6. Different exits on the same signals

The stop (-30%) and target (+30%) are the app settings. Here the same signals are re-run with other stops, targets and a time limit (leave after N candles if neither is hit). Each combination is scored on the first 60%; the best ones by that score are then shown on the last 40%.

| Stop | Target | Time limit | Avg Rs/trade first 60% | **Avg Rs/trade last 40%** |
|---|---|---|---|---|
| 30% (today) | 30% (today) | none (today) | -446 | **-278** |
| 30% | 30% | same-day square-off 15:15 (the app INTRADAY setting) | -66 | **-37** |
| 20% | 80% | 8 candles | -54 | **-44** |
| 20% | 50% | 8 candles | -58 | **-66** |
| 30% | 80% | 8 candles | -62 | **-31** |
| 30% | 20% | same-day square-off 15:15 | -63 | **-40** |
| 15% | 80% | 8 candles | -66 | **-5** |
| 30% | 30% | same-day square-off 15:15 | -66 | **-37** |
| 15% | 50% | 8 candles | -68 | **-21** |
| 30% | 50% | 8 candles | -69 | **-43** |
### The same signals with the same-day square-off (stop 30%, target 30%), symbol by symbol

| Symbol | Signals | Avg Rs/trade today (held until stop/target) | Avg Rs/trade with same-day square-off | First 60% / last 40% (same-day) | Hit the stop first (same-day) |
|---|---|---|---|---|---|
| NIFTY 50 | 150 | 406 | 286 | 210 / 405 | 22% |
| BANK NIFTY | 147 | -117 | -58 | 127 / -428 | 31% |
| HDFCBANK | 130 | -661 | -115 | -184 / -15 | 7% |
| ICICIBANK | 135 | -614 | -241 | -171 / -336 | 8% |
| SBIN | 136 | -808 | -284 | -231 / -359 | 11% |
| TATASTEEL | 156 | 100 | 371 | 484 / 221 | 9% |
| INFY | 140 | -614 | -277 | -377 / -134 | 8% |
| AXISBANK | 151 | -432 | -345 | -410 / -255 | 9% |
| BHARTIARTL | 150 | -513 | -8 | -83 / 80 | 6% |
| ITC | 144 | -556 | -20 | -2 / -42 | 6% |
| LT | 152 | -607 | -102 | -189 / 36 | 10% |
| MARUTI | 162 | -533 | -72 | -229 / 115 | 10% |
| RELIANCE | 138 | -232 | 90 | 46 / 146 | 5% |
| TCS | 120 | -207 | -41 | 26 / -135 | 5% |
| **All symbols** | 2011 | -379 | -54 | -66 / -37 | 11% |


Of 80 exit combinations, **0** were profitable on the last 40%; the best on the first 60% scored -44 on the last 40%.

## 5. What this means

- Before any change, the high-confidence calls average **-379 Rs per trade** (56% hit the stop first, 44% hit the target first). On the last 40% of the period: -278.
- All filters together, on the last 40% (not used to choose them): **42 Rs per trade on 53 signals**.
- A filter helps only if the last-40% number is clearly better than the "before" number AND it still leaves a meaningful number of trades. Everything here was chosen with the same period in mind, so improvements of a few hundred rupees on a few dozen trades should be treated as ideas to watch on paper trading.
