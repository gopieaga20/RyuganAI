# Stress test of the VWAP-alone result

Generated 2026-11-14 by `DATA=1500d node tools/bt_strategies.mjs vwap-stress`. 34 symbols, 2022-10-10 to 2026-11-13. Same-day exit (squared off at 15:15), stop -30% / target +30%, ATM option, 10,000 Rs premium per trade, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying; **modelled option prices**. The result being tested: VWAP side alone (long above VWAP, short below) earned +166 Rs per trade. Three weaknesses of the earlier model are removed here: (1) every stock's ATM option cost 2% of spot whatever its volatility, so volatile stocks were too cheap: here the premium is scaled by the stock's own volatility relative to the typical stock (std of daily returns, clamped 0.5x-2.5x; ADANIENT 2.19x, HINDALCO 1.26x, ONGC 1.15x, TATASTEEL 1.15x, BAJFINANCE 1.13x are the most volatile); (2) no bid-ask spread: a round-trip spread of 1% and 2% of the premium is charged (a liquid index option costs less, a stock option often costs more); (3) one symbol, ADANIENT, produced about half of the profit: it is excluded in some rows. p = against a coin flip on the SAME entry bars (100+ trades only).

| Rule | Scenario | Trades | Avg Rs/trade | PF | Win | First 60% / last 40% | Coin flip, same bars | p | Quarters profitable |
|---|---|---|---|---|---|---|---|---|---|
| VWAP alone | As before (premium 2% of spot, no spread) | 7959 | **166** | 1.21 | 53% | 149 / 194 | -70 | 0.000 | 16 of 17 |
| VWAP alone | Premium scaled by each stock's volatility | 7386 | **138** | 1.18 | 53% | 149 / 118 | -61 | 0.000 | 15 of 17 |
| VWAP alone | ... plus 1% round-trip spread | 7386 | **38** | 1.05 | 50% | 49 / 18 | -162 | 0.000 | 8 of 17 |
| VWAP alone | ... plus 2% round-trip spread | 7386 | **-62** | 0.93 | 48% | -51 / -82 | -253 | 0.000 | 5 of 17 |
| VWAP alone, without ADANIENT | As before (premium 2% of spot, no spread) | 7322 | **101** | 1.13 | 52% | 103 / 97 | -67 | 0.000 | 14 of 17 |
| VWAP alone, without ADANIENT | Premium scaled by each stock's volatility | 7505 | **105** | 1.13 | 52% | 111 / 95 | -66 | 0.000 | 13 of 17 |
| VWAP alone, without ADANIENT | ... plus 1% round-trip spread | 7505 | **5** | 1.01 | 50% | 11 / -5 | -142 | 0.000 | 6 of 17 |
| VWAP alone, without ADANIENT | ... plus 2% round-trip spread | 7505 | **-95** | 0.89 | 48% | -89 / -105 | -261 | 0.000 | 4 of 17 |
| VWAP alone, entries only from 11:30 | As before (premium 2% of spot, no spread) | 6829 | **135** | 1.19 | 52% | 115 / 169 | -67 | 0.000 | 15 of 17 |
| VWAP alone, entries only from 11:30 | Premium scaled by each stock's volatility | 6458 | **118** | 1.18 | 52% | 126 / 106 | -60 | 0.000 | 13 of 17 |
| VWAP alone, entries only from 11:30 | ... plus 1% round-trip spread | 6458 | **18** | 1.03 | 49% | 26 / 6 | -169 | 0.000 | 9 of 17 |
| VWAP alone, entries only from 11:30 | ... plus 2% round-trip spread | 6458 | **-82** | 0.89 | 47% | -74 / -94 | -266 | 0.000 | 4 of 17 |
| VWAP alone, entries only from 13:00 | As before (premium 2% of spot, no spread) | 5799 | **67** | 1.12 | 50% | 74 / 54 | -53 | 0.000 | 13 of 17 |
| VWAP alone, entries only from 13:00 | Premium scaled by each stock's volatility | 5588 | **43** | 1.08 | 49% | 61 / 15 | -32 | 0.000 | 11 of 17 |
| VWAP alone, entries only from 13:00 | ... plus 1% round-trip spread | 5588 | **-57** | 0.90 | 46% | -39 / -85 | -143 | 0.000 | 4 of 17 |
| VWAP alone, entries only from 13:00 | ... plus 2% round-trip spread | 5588 | **-157** | 0.75 | 42% | -139 / -185 | -235 | 0.000 | 0 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | As before (premium 2% of spot, no spread) | 5825 | **46** | 1.05 | 51% | 48 / 44 | -81 | 0.000 | 11 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | Premium scaled by each stock's volatility | 5619 | **40** | 1.05 | 50% | 48 / 28 | -56 | 0.000 | 10 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | ... plus 1% round-trip spread | 5619 | **-60** | 0.93 | 48% | -52 / -72 | -163 | 0.000 | 3 of 17 |
| VWAP alone, entries only before 11:30 (mirror) | ... plus 2% round-trip spread | 5619 | **-160** | 0.83 | 46% | -152 / -172 | -281 | 0.000 | 2 of 17 |
| VWAP alone, from 11:30, without ADANIENT | As before (premium 2% of spot, no spread) | 6381 | **82** | 1.12 | 51% | 83 / 81 | -63 | 0.000 | 11 of 17 |
| VWAP alone, from 11:30, without ADANIENT | Premium scaled by each stock's volatility | 6514 | **87** | 1.13 | 51% | 86 / 88 | -56 | 0.000 | 12 of 17 |
| VWAP alone, from 11:30, without ADANIENT | ... plus 1% round-trip spread | 6514 | **-13** | 0.98 | 49% | -14 / -12 | -156 | 0.000 | 8 of 17 |
| VWAP alone, from 11:30, without ADANIENT | ... plus 2% round-trip spread | 6514 | **-113** | 0.86 | 46% | -114 / -112 | -249 | 0.000 | 4 of 17 |
| Structure + VWAP agree | As before (premium 2% of spot, no spread) | 7686 | **23** | 1.03 | 50% | 17 / 32 | -44 | 0.002 | 10 of 17 |
| Structure + VWAP agree | Premium scaled by each stock's volatility | 7248 | **-6** | 0.99 | 49% | 10 / -33 | -53 | 0.022 | 6 of 17 |
| Structure + VWAP agree | ... plus 1% round-trip spread | 7248 | **-106** | 0.88 | 47% | -90 / -133 | -156 | 0.017 | 2 of 17 |
| Structure + VWAP agree | ... plus 2% round-trip spread | 7248 | **-206** | 0.78 | 45% | -190 / -233 | -266 | 0.005 | 1 of 17 |
| Random direction (yardstick) | As before (premium 2% of spot, no spread) | 7047 | **-28** | 0.97 | 49% | -34 / -18 | -57 | 0.111 | 6 of 17 |
| Random direction (yardstick) | Premium scaled by each stock's volatility | 6968 | **-28** | 0.96 | 49% | -18 / -46 | -65 | 0.059 | 6 of 17 |
| Random direction (yardstick) | ... plus 1% round-trip spread | 6968 | **-128** | 0.85 | 47% | -118 / -146 | -160 | 0.085 | 3 of 17 |
| Random direction (yardstick) | ... plus 2% round-trip spread | 6968 | **-228** | 0.75 | 45% | -218 / -246 | -259 | 0.094 | 0 of 17 |

## Who makes the money (VWAP alone, premium scaled by volatility + 1% spread)

- Total 277146 Rs over 7386 trades. Symbols profitable: 13 of 34.
- The five biggest contributors: ADANIENT 176330 Rs (1097 trades, 161 avg); BAJFINANCE 112804 Rs (1026 trades, 110 avg); AXISBANK 53782 Rs (1119 trades, 48 avg); COALINDIA 37473 Rs (302 trades, 124 avg); ASIANPAINT 10273 Rs (1137 trades, 9 avg). Together 93% of all profit made by profitable symbols.
- The five worst: DRREDDY -42333 Rs (139 trades); CIPLA -30976 Rs (472 trades); RELIANCE -9336 Rs (3 trades); HDFCBANK -8983 Rs (54 trades); ICICIBANK -6912 Rs (11 trades).
- By year: 2022: 383 trades, 81 Rs | 2023: 1741 trades, 92 Rs | 2024: 2005 trades, 20 Rs | 2025: 1693 trades, -72 Rs | 2026: 1564 trades, 108 Rs
- Calls vs puts: BUY CE 3485 trades, 68 Rs | BUY PE 3901 trades, 10 Rs

## What the numbers say

- VWAP alone: **166** Rs per trade in the earlier model; **138** with volatility-scaled premiums; **38** with a 1% spread added; **-62** with a 2% spread.
- Without ADANIENT (volatility-scaled, 1% spread): **5** Rs per trade over 7505 trades.
- Entries only from 11:30 (a clean run, trades blocked by earlier ones no longer matter): **18** Rs (from 13:00: -57; before 11:30: -60).
- Random direction under the same strictest model: -128 Rs per trade.
