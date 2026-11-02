'use strict';
/* Market-structure primitives for Smart-Money-Concept strategies (pure, no DOM).
 *
 * Swing pivots are confirmed only `k` bars after they form, so nothing here looks into the future.
 *  - BOS   (break of structure): close beyond the last swing in the DIRECTION of the current trend -> continuation.
 *  - CHoCH (change of character): close beyond the last swing AGAINST the current trend -> first sign of reversal.
 *  - FVG   (fair value gap): three-candle imbalance, candle[i-2].high < candle[i].low (bullish) or the mirror.
 */
export function buildStructure(candles, k = 3) {
  const n = candles.length;
  const events = new Array(n).fill(null);      // structure event confirmed on bar i's close
  const trend = new Array(n).fill(0);          // +1 up, -1 down, 0 unknown, as of bar i's close
  const fvgs = [];                             // every gap, in formation order
  let lastH = null, lastL = null, t = 0;

  for (let i = 0; i < n; i++) {
    const j = i - k;                           // pivot candidate becomes confirmed now
    if (j >= k) {
      let isH = true, isL = true;
      for (let q = j - k; q <= j + k; q++) {
        if (q === j) continue;
        if (candles[q].h >= candles[j].h) isH = false;
        if (candles[q].l <= candles[j].l) isL = false;
      }
      if (isH) lastH = { price: candles[j].h, idx: j, broken: false };
      if (isL) lastL = { price: candles[j].l, idx: j, broken: false };
    }
    const c = candles[i].c;
    if (lastH && !lastH.broken && c > lastH.price) {
      events[i] = { type: t === 1 ? 'BOS' : 'CHoCH', dir: 'LONG', level: lastH.price, protect: lastL ? lastL.price : null };
      lastH.broken = true; t = 1;
    } else if (lastL && !lastL.broken && c < lastL.price) {
      events[i] = { type: t === -1 ? 'BOS' : 'CHoCH', dir: 'SHORT', level: lastL.price, protect: lastH ? lastH.price : null };
      lastL.broken = true; t = -1;
    }
    trend[i] = t;
    if (i >= 2) {
      if (candles[i - 2].h < candles[i].l) fvgs.push({ dir: 'LONG', top: candles[i].l, bottom: candles[i - 2].h, i, used: false });
      else if (candles[i - 2].l > candles[i].h) fvgs.push({ dir: 'SHORT', top: candles[i - 2].l, bottom: candles[i].h, i, used: false });
    }
  }
  return { events, trend, fvgs };
}

/** Most recent unfilled gap of direction `dir` (formed 2..maxAge bars ago) that bar i is retesting.
 *  LONG: the bar dips into the gap (low <= top) but closes back above it, a bullish rejection candle.
 *  The gap is invalid once any close since formation went through the far side. */
export function fvgRetest(S, candles, i, dir, maxAge = 12) {
  for (let q = S.fvgs.length - 1; q >= 0; q--) {
    const z = S.fvgs[q];
    if (z.i >= i) continue;
    if (i - z.i > maxAge) break;
    if (z.dir !== dir || z.used || i - z.i < 2) continue;
    let dead = false;
    for (let m = z.i + 1; m < i; m++) {
      if (dir === 'LONG' ? candles[m].c < z.bottom : candles[m].c > z.top) { dead = true; break; }
    }
    if (dead) continue;
    const c = candles[i];
    if (dir === 'LONG' && c.l <= z.top && c.c > z.top && c.c > c.o) return z;
    if (dir === 'SHORT' && c.h >= z.bottom && c.c < z.bottom && c.c < c.o) return z;
  }
  return null;
}
