'use strict';
/* Support and resistance, pure functions, no DOM. Read on the LAST candle using data up to and including it.
 *
 * Levels: the previous session's high (PDH), low (PDL) and close (PDC), plus the last swing highs and lows (pivots confirmed k bars after they formed).
 *
 *   breakout   a fresh CLOSE beyond PDH (bullish) or PDL (bearish) by a small buffer, with a strong candle: price has left the previous day's range
 *   retest     after such a breakout today, price comes back to touch the broken level from the new side and closes away from it: break-and-retest continuation
 *   rejection  a wick pokes through a level and the candle closes back on the original side (a failed breakout / stop run): a reversal at resistance or support
 *
 * Votes: +1 bullish (BUY CE at the money), -1 bearish (BUY PE at the money), 0 nothing. Conflicting readings on the same bar cancel out. */
import { istParts } from './candles.js';

/** Confirmed classic swing pivots up to bar i (a bar higher / lower than the k bars on each side): [{idx, price, type:'H'|'L'}]. Used for swing support/resistance. */
export function pivots(candles, i, k = 3) {
  const out = [];
  for (let j = k; j <= i - k; j++) {
    let isH = true, isL = true;
    for (let q = j - k; q <= j + k; q++) {
      if (q === j) continue;
      if (candles[q].h >= candles[j].h) isH = false;
      if (candles[q].l <= candles[j].l) isL = false;
    }
    if (isH) out.push({ idx: j, price: candles[j].h, type: 'H' });
    if (isL) out.push({ idx: j, price: candles[j].l, type: 'L' });
  }
  return out;
}

const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '--');

/** Previous session high / low / close and where today's session starts. Null when the window has no earlier session. */
export function sessionLevels(candles, i) {
  const day = istParts(candles[i].ts).day;
  let start = i;
  while (start > 0 && istParts(candles[start - 1].ts).day === day) start--;
  if (start === 0) return null;
  const prevDay = istParts(candles[start - 1].ts).day;
  let hi = -Infinity, lo = Infinity, q = start - 1;
  while (q >= 0 && istParts(candles[q].ts).day === prevDay) { hi = Math.max(hi, candles[q].h); lo = Math.min(lo, candles[q].l); q--; }
  return { pdh: hi, pdl: lo, pdc: candles[start - 1].c, start };
}

/** Average candle range of the 14 bars before bar i (the module's own ATR, so the Python port is exact). */
export function avgRange(candles, i, n = 14) {
  let s = 0, k = 0;
  for (let q = Math.max(0, i - n); q < i; q++) { s += candles[q].h - candles[q].l; k++; }
  return k ? s / k : 0;
}

/** The SR reading at bar i. Returns {vote, kind, level, parts:{brk, rtst, rev}, levels, reason}. */
export function srSignal(candles, i = candles.length - 1, k = 3) {
  const none = { vote: 0, kind: null, level: null, parts: { brk: 0, rtst: 0, rev: 0 }, levels: null, reason: 'No previous session to take levels from' };
  const L = sessionLevels(candles, i);
  if (!L) return none;
  const c = candles[i], rng = c.h - c.l, atr = avgRange(candles, i), buf = 0.1 * atr;
  const levels = { pdh: L.pdh, pdl: L.pdl, pdc: L.pdc };
  const out = { ...none, levels, reason: `Inside the previous day's range ${f2(L.pdl)}-${f2(L.pdh)}, no level event` };
  if (!(rng > 0) || !(atr > 0)) return out;

  // 1. breakout: a fresh close beyond the previous day's extreme, on a strong candle, that was inside the range within the last 3 bars
  let brk = 0;
  const strong = dir => (dir > 0 ? c.c > c.o && (c.c - c.l) / rng >= 0.6 : c.c < c.o && (c.h - c.c) / rng >= 0.6);
  if (c.c > L.pdh + buf && strong(1)) {
    for (let q = Math.max(0, i - 3); q < i; q++) if (candles[q].c <= L.pdh) { brk = 1; break; }
  } else if (c.c < L.pdl - buf && strong(-1)) {
    for (let q = Math.max(0, i - 3); q < i; q++) if (candles[q].c >= L.pdl) { brk = -1; break; }
  }

  // 2. retest: broke out earlier TODAY (a close beyond the level + buffer), now touches the level from the new side and closes back away from it
  let rtst = 0;
  if (!brk) {
    const from = Math.max(L.start, i - 24);
    let upBroke = false, downBroke = false;
    for (let q = from; q < i; q++) { if (candles[q].c > L.pdh + buf) upBroke = true; if (candles[q].c < L.pdl - buf) downBroke = true; }
    if (upBroke && !downBroke && c.l <= L.pdh + 0.15 * atr && c.c > L.pdh && c.c > c.o) rtst = 1;
    else if (downBroke && !upBroke && c.h >= L.pdl - 0.15 * atr && c.c < L.pdl && c.c < c.o) rtst = -1;
  }

  // 3. rejection: a wick through a level that closes back on the original side with a long wick (failed breakout / stop run)
  let rev = 0, revLevel = null;
  const pv = pivots(candles, i, k);
  const res = [L.pdh], sup = [L.pdl];
  for (let q = pv.length - 1, nh = 0, nl = 0; q >= 0 && (nh < 2 || nl < 2); q--) {
    if (pv[q].type === 'H' && nh < 2) { res.push(pv[q].price); nh++; }
    if (pv[q].type === 'L' && nl < 2) { sup.push(pv[q].price); nl++; }
  }
  const upperWick = (c.h - Math.max(c.o, c.c)) / rng, lowerWick = (Math.min(c.o, c.c) - c.l) / rng;
  for (const lv of res) if (c.h > lv && c.c < lv && c.c < c.o && upperWick >= 0.4) { rev = -1; revLevel = lv; break; }
  if (!rev) for (const lv of sup) if (c.l < lv && c.c > lv && c.c > c.o && lowerWick >= 0.4) { rev = 1; revLevel = lv; break; }

  const parts = { brk, rtst, rev };
  const signs = [brk, rtst, rev].filter(Boolean);
  if (!signs.length) return { ...out, parts };
  if (signs.some(s => s !== signs[0])) return { ...out, parts, reason: 'Level signals conflict on this bar, no call' };
  const vote = signs[0];
  const kind = brk ? 'breakout' : rtst ? 'retest' : 'rejection';
  const level = brk || rtst ? (vote > 0 ? L.pdh : L.pdl) : revLevel;
  const reason = brk ? `Fresh ${vote > 0 ? 'breakout above the previous day high' : 'breakdown below the previous day low'} ${f2(level)}`
    : rtst ? `Break-and-retest: ${vote > 0 ? 'previous day high' : 'previous day low'} ${f2(level)} held as ${vote > 0 ? 'support' : 'resistance'}`
      : `Rejection at ${vote > 0 ? 'support' : 'resistance'} ${f2(level)}: a wick took it and price closed back ${vote > 0 ? 'above' : 'below'}`;
  return { vote, kind, level, parts, levels, reason };
}
