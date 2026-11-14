'use strict';
/* Smart Money Concepts, a port of "Smart Money Concepts [LuxAlgo]" (TradingView).
 * Original © LuxAlgo, licensed CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/): attribution required, non-commercial
 * use only, and a work built on it must be shared under the same licence. This file is such a derivative work.
 *
 * What is ported (same rules and defaults as the indicator; pure functions, no DOM, nothing looks at a bar that has not closed):
 *   legs / pivots   a pivot is the bar `size` bars back that was higher (lower) than every bar after it; it is registered when the leg flips.
 *                   Sizes: swing 50, internal 5, equal highs/lows 3.
 *   structure       BOS / CHoCH when a bar CLOSES through the latest pivot (internal and swing, each with its own trend).
 *   order blocks    at each break: the bar with the lowest low (bullish) / highest high (bearish) between the broken pivot and the break, after the
 *                   volatility filter (bars at least 2 x ATR(200) tall use their low as the high and the reverse). Mitigated when price trades through
 *                   the far side (low under a bullish block, high over a bearish one). Newest first, 100 kept.
 *   equal H/L       a new pivot within 0.1 x ATR(200) of the previous one of its kind.
 *   fair value gaps three-bar gaps with the indicator's automatic threshold, removed when filled (its own removal rules).
 *   trailing range  the swing range extremes, updated every bar; its midpoint is the equilibrium (premium above, discount below).
 *
 * The indicator draws; it gives no signal. The SMC VOTE below is this app's own rule on top of its outputs:
 *   bullish (BUY CE): internal trend up, swing trend not down, an unmitigated bullish order block tapped by a rising candle, price in discount.
 *   bearish (BUY PE): the mirror. Otherwise 0.
 * Assumption: where the Pine code compares with `na` (before the first swing pivot exists) the comparison is treated as "different". */

const BULL = 1, BEAR = -1;
export const SWING_SIZE = 50, INTERNAL_SIZE = 5, EQUAL_SIZE = 3, EQUAL_THRESHOLD = 0.1, ATR_LENGTH = 200, MAX_BLOCKS = 100;

const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '--');

/** ta.atr(len): Wilder's RMA of the true range, first value after `len` bars (NaN before). */
function atrSeries(candles, len) {
  const n = candles.length, out = new Array(n).fill(NaN);
  let sum = 0, rma = NaN;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
    if (i < len) { sum += tr; if (i === len - 1) { rma = sum / len; out[i] = rma; } }
    else { rma = (rma * (len - 1) + tr) / len; out[i] = rma; }
  }
  return out;
}

const newPivot = () => ({ level: NaN, last: NaN, crossed: false, idx: -1, prevLevel: NaN });
const newLeg = () => ({ leg: 0, prev: 0 });

/** Run the whole indicator over `candles` ([{ts,o,h,l,c,v}] oldest first).
 *  Returns { events, obs, fvgs, eqs, trailTop, trailBottom, swingBias, internalBias, votes, last, atr }:
 *    events  [{i, type:'BOS'|'CHoCH', dir:'LONG'|'SHORT', level, pivotIdx, internal}]       (the break is on bar i's close)
 *    obs     [{bias, top, bottom, idx, formedAt, internal, mitigatedAt|null}]               (every block ever made; mitigatedAt null = still live)
 *    fvgs    [{dir, top, bottom, i, filledAt|null}]
 *    eqs     [{type:'EQH'|'EQL', i, level, a, b}]                                           (a, b: bar indexes of the two pivots)
 *    trailTop / trailBottom   the swing range per bar (NaN until the first swing pivot)
 *    votes   Int8Array of the SMC vote per bar;  last = full reading at the final bar */
export function buildSmc(candles) {
  const n = candles.length;
  const atr = atrSeries(candles, ATR_LENGTH);
  const parsedH = new Array(n), parsedL = new Array(n);
  const events = [], obs = [], fvgs = [], eqs = [];
  const trailTop = new Array(n).fill(NaN), trailBottom = new Array(n).fill(NaN);
  const swingBias = new Int8Array(n), internalBias = new Int8Array(n), votes = new Int8Array(n);

  const swingHigh = newPivot(), swingLow = newPivot(), internalHigh = newPivot(), internalLow = newPivot(), equalHigh = newPivot(), equalLow = newPivot();
  const legSwing = newLeg(), legInternal = newLeg(), legEqual = newLeg();
  const trailing = { top: NaN, bottom: NaN };
  const trend = { swing: 0, internal: 0 };
  const live = { internal: [], swing: [] };                  // unmitigated blocks, newest first
  const liveFvg = [];
  let cumDelta = 0, last = null;

  /** One call of the indicator's getCurrentStructure(size, equalHighLow, internal). */
  function structure(i, size, st, equalHL, internal) {
    if (i >= size) {
      let hi = -Infinity, lo = Infinity;
      for (let q = i - size + 1; q <= i; q++) { if (candles[q].h > hi) hi = candles[q].h; if (candles[q].l < lo) lo = candles[q].l; }
      if (candles[i - size].h > hi) st.leg = 0;
      else if (candles[i - size].l < lo) st.leg = 1;
    }
    const change = i >= 1 ? st.leg - st.prev : 0;
    st.prev = st.leg;
    if (change === 0) return;
    const p = candles[i - size];
    if (change === 1) {                                          // a new bullish leg starts: the pivot is a LOW
      const pv = equalHL ? equalLow : internal ? internalLow : swingLow;
      if (equalHL && Math.abs(pv.level - p.l) < EQUAL_THRESHOLD * atr[i]) eqs.push({ type: 'EQL', i, level: p.l, a: pv.idx, b: i - size });
      pv.last = pv.level; pv.level = p.l; pv.crossed = false; pv.idx = i - size;
      if (!equalHL && !internal) trailing.bottom = pv.level;
    } else {                                                     // a new bearish leg starts: the pivot is a HIGH
      const pv = equalHL ? equalHigh : internal ? internalHigh : swingHigh;
      if (equalHL && Math.abs(pv.level - p.h) < EQUAL_THRESHOLD * atr[i]) eqs.push({ type: 'EQH', i, level: p.h, a: pv.idx, b: i - size });
      pv.last = pv.level; pv.level = p.h; pv.crossed = false; pv.idx = i - size;
      if (!equalHL && !internal) trailing.top = pv.level;
    }
  }

  function storeBlock(i, pv, internal, bias) {
    const arr = bias === BEAR ? parsedH : parsedL;
    let best = pv.idx;
    for (let q = pv.idx; q < i; q++) if (bias === BEAR ? arr[q] > arr[best] : arr[q] < arr[best]) best = q;
    const ob = { bias, top: parsedH[best], bottom: parsedL[best], idx: best, formedAt: i, internal, mitigatedAt: null };
    obs.push(ob);
    const list = internal ? live.internal : live.swing;
    if (list.length >= MAX_BLOCKS) list.pop();
    list.unshift(ob);
  }

  /** The indicator's displayStructure(internal): a close through the latest pivot is a BOS (with the trend) or a CHoCH (against it). */
  function display(i, internal) {
    const c = candles[i], prevClose = i >= 1 ? candles[i - 1].c : NaN;
    const hi = internal ? internalHigh : swingHigh, lo = internal ? internalLow : swingLow;
    const key = internal ? 'internal' : 'swing';
    const up = Number.isFinite(hi.level) && Number.isFinite(hi.prevLevel) && c.c > hi.level && prevClose <= hi.prevLevel;
    if (up && !hi.crossed && (internal ? internalHigh.level !== swingHigh.level : true)) {
      const type = trend[key] === BEAR ? 'CHoCH' : 'BOS';
      hi.crossed = true; trend[key] = BULL;
      events.push({ i, type, dir: 'LONG', level: hi.level, pivotIdx: hi.idx, internal });
      storeBlock(i, hi, internal, BULL);
    }
    const down = Number.isFinite(lo.level) && Number.isFinite(lo.prevLevel) && c.c < lo.level && prevClose >= lo.prevLevel;
    if (down && !lo.crossed && (internal ? internalLow.level !== swingLow.level : true)) {
      const type = trend[key] === BULL ? 'CHoCH' : 'BOS';
      lo.crossed = true; trend[key] = BEAR;
      events.push({ i, type, dir: 'SHORT', level: lo.level, pivotIdx: lo.idx, internal });
      storeBlock(i, lo, internal, BEAR);
    }
  }

  function mitigate(i, list) {
    const c = candles[i];
    for (let k = list.length - 1; k >= 0; k--) {
      const ob = list[k];
      if ((ob.bias === BEAR && c.h > ob.top) || (ob.bias === BULL && c.l < ob.bottom)) { ob.mitigatedAt = i; list.splice(k, 1); }
    }
  }

  /** This app's SMC vote at bar i from the state after bar i was processed. `full` also builds the reading text. */
  function read(i, full) {
    const c = candles[i], bias = trend.internal;
    const zero = reason => ({ vote: 0, reason, bias, swing: trend.swing, ob: null, eq: null, zone: 0 });
    if (!bias) return zero('Structure undecided: no SMC setup');
    const word = bias > 0 ? 'Bullish' : 'Bearish';
    if (trend.swing === -bias) return zero(`${word} internal structure but the swing structure points the other way`);
    let hit = null;
    for (const ob of [...live.internal, ...live.swing].sort((a, b) => b.formedAt - a.formedAt)) {
      if (ob.bias !== bias || ob.formedAt >= i) continue;
      const tapped = bias > 0 ? c.l <= ob.top && c.c > c.o : c.h >= ob.bottom && c.c < c.o;
      if (tapped) { hit = ob; break; }
    }
    const eq = (trailing.top + trailing.bottom) / 2;
    const zone = !Number.isFinite(eq) ? 0 : c.c < eq ? 1 : c.c > eq ? -1 : 0;
    const base = { bias, swing: trend.swing, ob: hit, eq: Number.isFinite(eq) ? eq : null, zone };
    if (!hit) return { ...base, vote: 0, reason: full ? `${word} structure but price is not tapping an order block` : '' };
    if (zone !== bias) return { ...base, vote: 0, reason: full ? `${word} setup at an order block, but price is in the ${zone === 0 ? 'middle' : zone > 0 ? 'discount' : 'premium'} half: wait for ${bias > 0 ? 'discount' : 'premium'}` : '' };
    return { ...base, vote: bias, reason: full ? `${word} structure, ${hit.internal ? 'internal' : 'swing'} order block ${f2(hit.bottom)}-${f2(hit.top)} tapped in the ${bias > 0 ? 'discount' : 'premium'} half` : '' };
  }

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const hv = (c.h - c.l) >= 2 * atr[i];                        // volatile bar: a block must not start from a spike
    parsedH[i] = hv ? c.l : c.h; parsedL[i] = hv ? c.h : c.l;
    trailing.top = Math.max(c.h, trailing.top); trailing.bottom = Math.min(c.l, trailing.bottom);

    for (let k = liveFvg.length - 1; k >= 0; k--) {              // fair value gaps are checked before this bar's own structure work
      const g = liveFvg[k];
      if ((g.dir === 'LONG' && c.l < g.bottom) || (g.dir === 'SHORT' && c.h > g.top)) { g.filledAt = i; liveFvg.splice(k, 1); }
    }

    structure(i, SWING_SIZE, legSwing, false, false);
    structure(i, INTERNAL_SIZE, legInternal, false, true);
    structure(i, EQUAL_SIZE, legEqual, true, false);
    display(i, true);
    display(i, false);
    mitigate(i, live.internal); mitigate(i, live.swing);
    for (const p of [internalHigh, internalLow, swingHigh, swingLow]) p.prevLevel = p.level;

    if (i >= 1) {                                                // fair value gaps (the indicator's "auto threshold")
      const lastClose = candles[i - 1].c, lastOpen = candles[i - 1].o;
      const delta = (lastClose - lastOpen) / (lastOpen * 100);
      cumDelta += Math.abs(delta);
      if (i >= 2) {
        const thr = cumDelta / i * 2, h2 = candles[i - 2].h, l2 = candles[i - 2].l;
        if (c.l > h2 && lastClose > h2 && delta > thr) { const g = { dir: 'LONG', top: c.l, bottom: h2, i, filledAt: null }; fvgs.push(g); liveFvg.push(g); }
        if (c.h < l2 && lastClose < l2 && -delta > thr) { const g = { dir: 'SHORT', top: c.h, bottom: l2, i, filledAt: null }; fvgs.push(g); liveFvg.push(g); }
      }
    }

    trailTop[i] = trailing.top; trailBottom[i] = trailing.bottom;
    swingBias[i] = trend.swing; internalBias[i] = trend.internal;
    const last_ = i === n - 1;
    const r = read(i, last_);
    votes[i] = r.vote;
    if (last_) last = r;
  }
  return { events, obs, fvgs, eqs, trailTop, trailBottom, swingBias, internalBias, votes, last: last || { vote: 0, reason: 'No data', bias: 0, swing: 0, ob: null, eq: null, zone: 0 }, atr };
}

/** The SMC reading at the last candle: {vote, reason, bias, swing, ob, eq, zone}. */
export function smcSignal(candles) {
  return candles.length < 2 ? { vote: 0, reason: 'No data', bias: 0, swing: 0, ob: null, eq: null, zone: 0 } : buildSmc(candles).last;
}
