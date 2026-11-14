# Stress test of the VWAP-alone result (no limit on open positions)

Generated 2026-11-14 by `DATA=1500d node tools/bt_strategies.mjs vwap-stress`. 34 symbols, 2022-10-10 to 2026-11-13. Same-day exit (squared off at 15:15), stop -30% / target +30%, ATM option, 10,000 Rs premium per trade, entries 10:15-14:30 IST, ADX >= 20, NO limit on open positions (every symbol trades on its own), one per underlying; **modelled option prices**. The result being tested: VWAP side alone (long above VWAP, short below) earned +166 Rs per trade. Three weaknesses of the earlier model are removed here: (1) every stock's ATM option cost 2% of spot whatever its volatility, so volatile stocks were too cheap: here the premium is scaled by the stock's own volatility relative to the typical stock (std of daily returns, clamped 0.5x-2.5x; ADANIENT 2.19x, HINDALCO 1.26x, ONGC 1.15x, TATASTEEL 1.15x, BAJFINANCE 1.13x are the most volatile); (2) no bid-ask spread: a round-trip spread of 1% and 2% of the premium is charged (a liquid index option costs less, a stock option often costs more); (3) one symbol, ADANIENT, produced about half of the profit: it is excluded in some rows. p = against a coin flip on the SAME entry bars (100+ trades only).

| Rule | Scenario | Trades | Avg Rs/trade | PF | Win | First 60% / last 40% | Coin flip, same bars | p | Quarters profitable |
|---|---|---|---|---|---|---|---|---|---|
| VWAP alone | As before (premium 2% of spot, no spread) | 45418 | **153** | 1.19 | 53% | 154 / 151 | -56 | 0.000 | 17 of 17 |
| VWAP alone | Premium scaled by each stock's volatility | 44935 | **150** | 1.19 | 53% | 150 / 148 | -52 | 0.000 | 17 of 17 |
| VWAP alone | ... plus 1% round-trip spread | 44935 | **50** | 1.06 | 51% | 50 / 48 | -156 | 0.000 | 12 of 17 |
| VWAP alone | ... plus 2% round-trip spread | 44935 | **-50** | 0.94 | 49% | -50 / -52 | -252 | 0.000 | 4 of 17 |
| VWAP alone, without ADANIENT | As before (premium 2% of spot, no spread) | 43172 | **142** | 1.18 | 53% | 145 / 137 | -55 | 0.000 | 17 of 17 |
| VWAP alone, without ADANIENT | Premium scaled by each stock's volatility | 43704 | **147** | 1.18 | 53% | 147 / 148 | -59 | 0.000 | 17 of 17 |
| VWAP alone, without ADANIENT | ... plus 1% round-trip spread | 43704 | **47** | 1.06 | 51% | 47 / 48 | -157 | 0.000 | 11 of 17 |
| VWAP alone, without ADANIENT | ... plus 2% round-trip spread | 43704 | **-53** | 0.94 | 49% | -53 / -52 | -259 | 0.000 | 4 of 17 |
| VWAP alone, entries only from 11:30 | As before (premium 2% of spot, no spread) | 37504 | **137** | 1.19 | 52% | 142 / 128 | -56 | 0.000 | 17 of 17 |
| VWAP alone, entries only from 11:30 | Premium scaled by each stock's volatility | 37266 | **134** | 1.19 | 52% | 140 / 124 | -51 | 0.000 | 15 of 17 |
| VWAP alone, entries only from 11:30 | ... plus 1% round-trip spread | 37266 | **34** | 1.05 | 50% | 40 / 24 | -148 | 0.000 | 11 of 17 |
| VWAP alone, entries only from 11:30 | ... plus 2% round-trip spread | 37266 | **-66** | 0.92 | 48% | -60 / -76 | -252 | 0.000 | 5 of 17 |
| VWAP alone, entries only from 13:00 | As before (premium 2% of spot, no spread) | 29339 | **57** | 1.10 | 50% | 68 / 39 | -37 | 0.000 | 10 of 17 |
| VWAP alone, entries only from 13:00 | Premium scaled by each stock's volatility | 29168 | **52** | 1.09 | 50% | 65 / 32 | -35 | 0.000 | 10 of 17 |
| VWAP alone, entries only from 13:00 | ... plus 1% round-trip spread | 29168 | **-48** | 0.93 | 47% | -35 / -68 | -133 | 0.000 | 7 of 17 |
| VWAP alone, entries only from 13:00 | ... plus 2% round-trip spread | 29168 | **-148** | 0.79 | 44% | -135 / -168 | -239 | 0.000 | 0 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | As before (premium 2% of spot, no spread) | 31502 | **18** | 1.02 | 50% | 21 / 14 | -70 | 0.000 | 8 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | Premium scaled by each stock's volatility | 31294 | **18** | 1.02 | 50% | 16 / 21 | -58 | 0.000 | 9 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | ... plus 1% round-trip spread | 31294 | **-82** | 0.91 | 48% | -84 / -79 | -161 | 0.000 | 2 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | ... plus 2% round-trip spread | 31294 | **-182** | 0.82 | 46% | -184 / -179 | -265 | 0.000 | 0 of 17 |
| VWAP alone, from 11:30, without ADANIENT | As before (premium 2% of spot, no spread) | 35847 | **130** | 1.19 | 52% | 141 / 114 | -50 | 0.000 | 16 of 17 |
| VWAP alone, from 11:30, without ADANIENT | Premium scaled by each stock's volatility | 36237 | **133** | 1.19 | 52% | 140 / 123 | -54 | 0.000 | 16 of 17 |
| VWAP alone, from 11:30, without ADANIENT | ... plus 1% round-trip spread | 36237 | **33** | 1.04 | 50% | 40 / 23 | -150 | 0.000 | 11 of 17 |
| VWAP alone, from 11:30, without ADANIENT | ... plus 2% round-trip spread | 36237 | **-67** | 0.92 | 48% | -60 / -77 | -247 | 0.000 | 5 of 17 |
| Structure + VWAP agree | As before (premium 2% of spot, no spread) | 39400 | **76** | 1.09 | 51% | 79 / 71 | -52 | 0.000 | 15 of 17 |
| Structure + VWAP agree | Premium scaled by each stock's volatility | 38989 | **72** | 1.09 | 51% | 73 / 70 | -64 | 0.000 | 14 of 17 |
| Structure + VWAP agree | ... plus 1% round-trip spread | 38989 | **-28** | 0.97 | 49% | -27 / -30 | -163 | 0.000 | 5 of 17 |
| Structure + VWAP agree | ... plus 2% round-trip spread | 38989 | **-128** | 0.86 | 47% | -127 / -130 | -251 | 0.000 | 3 of 17 |
| Random direction (yardstick) | As before (premium 2% of spot, no spread) | 31785 | **-31** | 0.96 | 49% | -60 / 13 | -48 | 0.045 | 6 of 17 |
| Random direction (yardstick) | Premium scaled by each stock's volatility | 31714 | **-34** | 0.95 | 49% | -62 / 6 | -53 | 0.033 | 5 of 17 |
| Random direction (yardstick) | ... plus 1% round-trip spread | 31714 | **-134** | 0.83 | 46% | -162 / -94 | -152 | 0.040 | 0 of 17 |
| Random direction (yardstick) | ... plus 2% round-trip spread | 31714 | **-234** | 0.73 | 44% | -262 / -194 | -251 | 0.052 | 0 of 17 |

## Who makes the money (VWAP alone, premium scaled by volatility + 1% spread)

- Total 2226870 Rs over 44935 trades. Symbols profitable: 24 of 34.
- The five biggest contributors: NSEI 581105 Rs (2350 trades, 247 avg); NSEBANK 527086 Rs (3121 trades, 169 avg); RELIANCE 194497 Rs (1206 trades, 161 avg); ONGC 172910 Rs (1207 trades, 143 avg); BAJFINANCE 167350 Rs (1206 trades, 139 avg). Together 57% of all profit made by profitable symbols.
- The five worst: HINDALCO -139075 Rs (1154 trades); CIPLA -117958 Rs (1170 trades); INFY -84556 Rs (1119 trades); DRREDDY -82372 Rs (1242 trades); KOTAKBANK -79385 Rs (1211 trades).
- By year: 2022: 2288 trades, 57 Rs | 2023: 10092 trades, 29 Rs | 2024: 11942 trades, 83 Rs | 2025: 10347 trades, -23 Rs | 2026: 10266 trades, 102 Rs
- Calls vs puts: BUY CE 21996 trades, 67 Rs | BUY PE 22939 trades, 33 Rs

## What the numbers say

- VWAP alone: **153** Rs per trade in the earlier model; **150** with volatility-scaled premiums; **50** with a 1% spread added; **-50** with a 2% spread.
- Without ADANIENT (volatility-scaled, 1% spread): **47** Rs per trade over 43704 trades.
- Entries only from 11:30 (a clean run, trades blocked by earlier ones no longer matter): **34** Rs (from 13:00: -48; before 11:30: -82).
- Random direction under the same strictest model: -134 Rs per trade.
