# EMA 9 rejection strategy backtest

Generated 2026-11-15 by `DATA=1500d MAXPOS=99 node tools/bt_strategies.mjs ema9`. 35 symbols (Nifty 50, Bank Nifty and 33 stocks), 15-minute candles, 2022-10-10 to 2026-11-13.

**The rule tested.** CE: a green candle closes entirely above the 9 EMA (its low is above the EMA); within the next 5 candles, with every close staying above the EMA, a candle dips to the EMA (low at or below it) and is rejected (closes back above it, green). Buy the ATM CE at the next candle's open. PE: the mirror (a red candle entirely below the EMA, then a candle pokes up to the EMA and closes back below it, red). Variants: a loose version (the previous close above the EMA is enough), with the EMA sloping the same way, and with VWAP agreeing (the app's current default strategy).

**Engine (same as every earlier report).** Signal on the candle close, filled at the next open; entries 10:15-14:30 IST (or from 11:30 where stated), ADX >= 20; ATM option, 10,000 Rs premium per trade, stop -30% / target +30%, squared off at 15:15 the same day; one position per underlying, no limit on the number open; full option charges; **modelled option prices** (no historical option candles exist): premium scaled by each stock's volatility, plus a round-trip bid-ask spread of 0%, 1% or 2% of the premium. p = chance a coin flip on the SAME entry bars does at least as well (100+ trades); 7 variants were tried, so multiply p by 7 before calling anything an edge. "Move 1h" = the underlying's average move in the signal's direction over the next hour, model-free, in basis points.

| Rule | Spread | Signals | Trades | Avg Rs/trade | PF | Win | First 60% / last 40% | Coin flip | p | Quarters + | Move 1h (bps) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EMA9 rejection (green candle above EMA9, then a rejection) | No spread | 27781 | 17414 | **-27** | 0.96 | 48% | -12 / -49 | -52 | 0.023 | 6 of 17 | 1.0 |
| EMA9 rejection (green candle above EMA9, then a rejection) | 1% spread | 27781 | 17414 | **-127** | 0.82 | 45% | -112 / -149 | -146 | 0.065 | 2 of 17 | 1.0 |
| EMA9 rejection (green candle above EMA9, then a rejection) | 2% spread | 27781 | 17414 | **-227** | 0.71 | 42% | -212 / -249 | -256 | 0.010 | 0 of 17 | 1.0 |
| ... entries from 11:30 (app window) | No spread | 21116 | 14061 | **0** | 1.00 | 49% | 20 / -29 | -37 | 0.002 | 8 of 17 | 1.2 |
| ... entries from 11:30 (app window) | 1% spread | 21116 | 14061 | **-100** | 0.84 | 45% | -80 / -129 | -147 | 0.000 | 1 of 17 | 1.2 |
| ... entries from 11:30 (app window) | 2% spread | 21116 | 14061 | **-200** | 0.71 | 42% | -180 / -229 | -247 | 0.000 | 0 of 17 | 1.2 |
| ... Nifty + Bank Nifty only, from 11:30 | No spread | 1301 | 928 | **-10** | 0.99 | 48% | 62 / -105 | -68 | 0.223 | 8 of 17 | 0.3 |
| ... Nifty + Bank Nifty only, from 11:30 | 1% spread | 1301 | 928 | **-110** | 0.90 | 47% | -38 / -205 | -158 | 0.266 | 6 of 17 | 0.3 |
| ... Nifty + Bank Nifty only, from 11:30 | 2% spread | 1301 | 928 | **-210** | 0.81 | 45% | -138 / -305 | -292 | 0.141 | 6 of 17 | 0.3 |
| EMA9 rejection, loose (previous close above EMA9 is enough) | No spread | 71054 | 28782 | **-9** | 0.99 | 49% | 1 / -23 | -50 | 0.000 | 10 of 17 | 0.7 |
| EMA9 rejection, loose (previous close above EMA9 is enough) | 1% spread | 71054 | 28782 | **-109** | 0.86 | 46% | -99 / -123 | -158 | 0.000 | 2 of 17 | 0.7 |
| EMA9 rejection, loose (previous close above EMA9 is enough) | 2% spread | 71054 | 28782 | **-209** | 0.74 | 43% | -199 / -223 | -250 | 0.000 | 0 of 17 | 0.7 |
| EMA9 rejection + EMA9 sloping the same way | No spread | 27781 | 17414 | **-27** | 0.96 | 48% | -12 / -49 | -58 | 0.006 | 6 of 17 | 1.0 |
| EMA9 rejection + EMA9 sloping the same way | 1% spread | 27781 | 17414 | **-127** | 0.82 | 45% | -112 / -149 | -147 | 0.058 | 2 of 17 | 1.0 |
| EMA9 rejection + EMA9 sloping the same way | 2% spread | 27781 | 17414 | **-227** | 0.71 | 42% | -212 / -249 | -250 | 0.036 | 0 of 17 | 1.0 |
| EMA9 rejection + VWAP agrees | No spread | 25097 | 16209 | **-18** | 0.97 | 48% | -3 / -42 | -40 | 0.044 | 6 of 17 | 1.1 |
| EMA9 rejection + VWAP agrees | 1% spread | 25097 | 16209 | **-118** | 0.83 | 45% | -103 / -142 | -150 | 0.007 | 3 of 17 | 1.1 |
| EMA9 rejection + VWAP agrees | 2% spread | 25097 | 16209 | **-218** | 0.71 | 42% | -203 / -242 | -251 | 0.005 | 0 of 17 | 1.1 |
| EMA9 rejection + VWAP agrees, from 11:30 | No spread | 20212 | 13618 | **2** | 1.00 | 49% | 23 / -28 | -40 | 0.001 | 8 of 17 | 1.4 |
| EMA9 rejection + VWAP agrees, from 11:30 | 1% spread | 20212 | 13618 | **-98** | 0.85 | 45% | -77 / -128 | -136 | 0.002 | 2 of 17 | 1.4 |
| EMA9 rejection + VWAP agrees, from 11:30 | 2% spread | 20212 | 13618 | **-198** | 0.71 | 42% | -177 / -228 | -249 | 0.000 | 0 of 17 | 1.4 |
| Reference: price above/below EMA9 (no rejection) | No spread | 446692 | 46232 | **130** | 1.16 | 52% | 140 / 114 | -58 | 0.000 | 17 of 17 | 0.8 |
| Reference: price above/below EMA9 (no rejection) | 1% spread | 446692 | 46232 | **30** | 1.03 | 50% | 40 / 14 | -151 | 0.000 | 11 of 17 | 0.8 |
| Reference: price above/below EMA9 (no rejection) | 2% spread | 446692 | 46232 | **-70** | 0.92 | 48% | -60 / -86 | -255 | 0.000 | 3 of 17 | 0.8 |
| Reference: VWAP alone from 11:30 (the current default) | No spread | 314465 | 38377 | **139** | 1.20 | 52% | 149 / 123 | -51 | 0.000 | 16 of 17 | 1.5 |
| Reference: VWAP alone from 11:30 (the current default) | 1% spread | 314465 | 38377 | **39** | 1.05 | 50% | 49 / 23 | -152 | 0.000 | 12 of 17 | 1.5 |
| Reference: VWAP alone from 11:30 (the current default) | 2% spread | 314465 | 38377 | **-61** | 0.92 | 48% | -51 / -77 | -245 | 0.000 | 5 of 17 | 1.5 |
| Reference: random direction | No spread | 63575 | 32665 | **-34** | 0.95 | 49% | -59 / 3 | -51 | 0.050 | 4 of 17 | 0.4 |
| Reference: random direction | 1% spread | 63575 | 32665 | **-134** | 0.83 | 46% | -159 / -97 | -152 | 0.045 | 0 of 17 | 0.4 |
| Reference: random direction | 2% spread | 63575 | 32665 | **-234** | 0.73 | 44% | -259 / -197 | -248 | 0.097 | 0 of 17 | 0.4 |

## Detail: the main rule, 1% spread

- Symbols profitable: 2 of 35. Best: NTPC 9982 (478), ULTRACEMCO 4656 (534), AXISBANK -7945 (495), BAJAJFINSV -11117 (469), ONGC -15640 (469). Worst: ^NSEBANK -142696 (601), DRREDDY -133147 (504), CIPLA -126903 (472), INFY -116853 (523), HINDALCO -107531 (487).
- By year: 2022 933 trades, -146 Rs | 2023 4178 trades, -135 Rs | 2024 4313 trades, -91 Rs | 2025 4172 trades, -159 Rs | 2026 3818 trades, -120 Rs
- BUY CE: 8989 trades, -121 Rs | BUY PE: 8425 trades, -133 Rs
- Indices only: 1165 trades, -148 Rs | stocks only: 16249 trades, -126 Rs
- Exits: SL 1646, SQ 13997, TP 1771 (SL = -30% stop, TP = +30% target, SQ = squared off at 15:15)

