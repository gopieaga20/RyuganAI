'use strict';
/* Smart Money Concepts (SMC), pure functions, no DOM. Everything is read on the LAST candle using data up to and including it:
 * pivots are only used k bars after they form, zones only from the bar that confirmed them, so nothing looks into the future.
 *
 * Building blocks
 *   structure   BOS / CHoCH and the current trend (buildStructure in smc-structure.js)
 *   order block the last opposite-coloured candle before the move that broke structure; price returning into it (unmitigated) is a point of interest
 *   FVG         a three-candle imbalance retested from the right side (fvgRetest in smc-structure.js)
 *   sweep       a wick that takes the last swing high/low (liquidity) and closes back inside: stops were run, price is rejected
 *   zone        premium / discount of the last swing range: longs belong in discount (below 50%), shorts in premium (above 50%)
 *
 * The SMC call needs: a clear structure bias, a point of interest in that direction (order block, FVG or sweep), and the right half
 * of the range. It then votes +1 (bullish: BUY CE at the money) or -1 (bearish: BUY PE at the money), otherwise 0. */
import { fvgRetest } from './smc-structure.js';

const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '--');

/** Confirmed swing pivots up to bar i: [{idx, price, type:'H'|'L'}] in order of confirmation. */
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

/** The order block of the structure break at bar b (dir 'LONG' | 'SHORT'): the last opposite candle at the origin of the move. */
export function orderBlockOf(candles, b, dir, lookback = 10) {
  const from = Math.max(0, b - lookback);
  let origin = from;
  for (let q = from; q < b; q++) {
    if (dir === 'LONG' ? candles[q].l <= candles[origin].l : candles[q].h >= candles[origin].h) origin = q;
  }
  for (let q = origin; q >= Math.max(0, origin - 3); q--) {
    const c = candles[q];
    if (dir === 'LONG' ? c.c < c.o : c.c > c.o) return { dir, top: c.h, bottom: c.l, idx: q, formedAt: b };
  }
  return null;
}

/** The most recent unmitigated order block aligned with `dir` that the last candle is tapping and rejecting. */
export function orderBlockRetest(candles, S, i, dir, maxAge = 40) {
  for (let b = i - 1; b >= Math.max(1, i - maxAge); b--) {
    const ev = S.events[b];
    if (!ev || ev.dir !== dir) continue;
    const ob = orderBlockOf(candles, b, dir);
    if (!ob) continue;
    let dead = false;
    for (let m = b + 1; m < i; m++) {                       // mitigated once any close went through the far side
      if (dir === 'LONG' ? candles[m].c < ob.bottom : candles[m].c > ob.top) { dead = true; break; }
    }
    if (dead) continue;
    const c = candles[i];
    if (dir === 'LONG' && c.l <= ob.top && c.c >= ob.bottom && c.c > c.o) return ob;
    if (dir === 'SHORT' && c.h >= ob.bottom && c.c <= ob.top && c.c < c.o) return ob;
    return null;                                             // only the freshest block counts
  }
  return null;
}

/** +1: the last candle swept the last swing LOW and closed back above it (sell-side liquidity taken); -1: mirror at the last swing HIGH. */
export function liquiditySweep(candles, pv, i) {
  const c = candles[i], range = c.h - c.l;
  if (!(range > 0)) return 0;
  let lastL = null, lastH = null;
  for (let q = pv.length - 1; q >= 0 && !(lastL && lastH); q--) {
    if (pv[q].type === 'L' && !lastL) lastL = pv[q];
    if (pv[q].type === 'H' && !lastH) lastH = pv[q];
  }
  if (lastL && c.l < lastL.price && c.c > lastL.price && (Math.min(c.o, c.c) - c.l) / range >= 0.4) return 1;
  if (lastH && c.h > lastH.price && c.c < lastH.price && (c.h - Math.max(c.o, c.c)) / range >= 0.4) return -1;
  return 0;
}

/** +1 when price is in the DISCOUNT half of the last swing range, -1 in the PREMIUM half, 0 when there is no range or price is outside it. */
export function premiumDiscount(candles, pv, i) {
  let lastL = null, lastH = null;
  for (let q = pv.length - 1; q >= 0 && !(lastL && lastH); q--) {
    if (pv[q].type === 'L' && !lastL) lastL = pv[q];
    if (pv[q].type === 'H' && !lastH) lastH = pv[q];
  }
  if (!lastL || !lastH || !(lastH.price > lastL.price)) return { zone: 0, eq: null };
  const p = candles[i].c, eq = (lastH.price + lastL.price) / 2;
  if (p < lastL.price || p > lastH.price) return { zone: 0, eq };
  return { zone: p < eq ? 1 : p > eq ? -1 : 0, eq, high: lastH.price, low: lastL.price };
}

/** The SMC reading at bar i. `S` is buildStructure(candles, k). Returns {vote, parts, reason, zones}. */
export function smcSignal(candles, S, i = candles.length - 1, k = 3) {
  const bias = S.trend[i];
  const pv = pivots(candles, i, k);
  const dirT = bias === 1 ? 'LONG' : bias === -1 ? 'SHORT' : null;
  const ob = dirT ? orderBlockRetest(candles, S, i, dirT) : null;
  const gap = dirT ? fvgRetest(S, candles, i, dirT, 12) : null;
  const sweep = liquiditySweep(candles, pv, i);
  const pd = premiumDiscount(candles, pv, i);
  const parts = { bias, ob: ob ? bias : 0, fvg: gap ? bias : 0, sweep, pd: pd.zone };

  const poi = parts.ob !== 0 || parts.fvg !== 0 || (parts.sweep !== 0 && parts.sweep === bias);
  let vote = 0, reason;
  if (!bias) reason = 'Structure undecided: no SMC setup';
  else if (!poi) reason = `${bias > 0 ? 'Bullish' : 'Bearish'} structure but price is not at an order block, gap or liquidity sweep`;
  else if (pd.zone !== bias) reason = `${bias > 0 ? 'Bullish' : 'Bearish'} setup, but price is in the ${pd.zone === 0 ? 'middle' : pd.zone > 0 ? 'discount' : 'premium'} half: wait for ${bias > 0 ? 'discount' : 'premium'}`;
  else {
    vote = bias;
    const what = [ob && `order block ${f2(ob.bottom)}-${f2(ob.top)}`, gap && `gap ${f2(gap.bottom)}-${f2(gap.top)}`, parts.sweep === bias && 'liquidity sweep'].filter(Boolean).join(' + ');
    reason = `${bias > 0 ? 'Bullish' : 'Bearish'} structure, ${what} tapped in the ${bias > 0 ? 'discount' : 'premium'} half`;
  }
  return { vote, parts, reason, zones: { ob, gap, eq: pd.eq ?? null } };
}

/* ───────────── variants: displacement, and the sweep -> change-of-character reversal ───────────── */

/** A displacement candle: a big, one-directional body (>= 1.5x the recent average range) that closes in the outer quarter of its range. */
export function isDisplacement(candles, b, dir, lookback = 14) {
  const c = candles[b], range = c.h - c.l;
  if (!(range > 0) || b < 2) return false;
  let sum = 0, k = 0;
  for (let q = Math.max(0, b - lookback); q < b; q++) { sum += candles[q].h - candles[q].l; k++; }
  const avg = k ? sum / k : 0;
  if (!(avg > 0) || Math.abs(c.c - c.o) < 1.5 * avg) return false;
  return dir === 'LONG' ? c.c > c.o && (c.h - c.c) / range <= 0.25 : c.c < c.o && (c.c - c.l) / range <= 0.25;
}

/** The sweep at bar s judged with the pivots that were already confirmed then (idx <= s - k). */
function sweepAt(candles, pv, s, k) {
  const known = [];
  for (const p of pv) if (p.idx <= s - k) known.push(p);
  return known.length ? liquiditySweep(candles, known, s) : 0;
}

/** Sweep followed by a change of character, read at bar i.
 *  Bullish: a sell-side sweep (wick under a swing low, close back above) in the 12 bars before a CHoCH up that is at most `maxAge` bars old.
 *  `stage`: 'choch' on the CHoCH bar itself, 'retest' on a later bar that pulls back into the order block or gap left by the move and closes up.
 *  Returns {vote, stage, ageBars, displaced, reason} (vote 0 when there is no setup). */
export function sweepChoch(candles, S, i, k = 3, maxAge = 8) {
  const none = { vote: 0, stage: null, ageBars: null, displaced: false, reason: 'No sweep followed by a change of character' };
  let e = -1;
  for (let q = i; q >= Math.max(1, i - maxAge); q--) if (S.events[q] && S.events[q].type === 'CHoCH') { e = q; break; }
  if (e < 0) return none;
  const dir = S.events[e].dir, sign = dir === 'LONG' ? 1 : -1;
  const pv = pivots(candles, e, k);
  let swept = -1;
  for (let s = e; s >= Math.max(1, e - 12); s--) if (sweepAt(candles, pv, s, k) === sign) { swept = s; break; }
  if (swept < 0) return none;
  const displaced = isDisplacement(candles, e, dir);
  const word = sign > 0 ? 'bullish' : 'bearish';
  if (i === e) return { vote: sign, stage: 'choch', ageBars: 0, displaced, reason: `Liquidity swept ${e - swept} bars ago, then a ${word} change of character${displaced ? ' with a displacement candle' : ''}` };
  const ob = orderBlockOf(candles, e, dir);
  let touch = null;
  const c = candles[i];
  const tapsOb = ob && (dir === 'LONG' ? c.l <= ob.top && c.c >= ob.bottom && c.c > c.o : c.h >= ob.bottom && c.c <= ob.top && c.c < c.o);
  if (tapsOb) touch = 'order block';
  else {
    const gap = fvgRetest(S, candles, i, dir, 12);
    if (gap && gap.i >= swept) touch = 'gap';
  }
  if (!touch) return none;
  for (let m = e + 1; m < i; m++) if (dir === 'LONG' ? candles[m].c < candles[swept].l : candles[m].c > candles[swept].h) return none;     // the sweep extreme was lost: setup failed
  return { vote: sign, stage: 'retest', ageBars: i - e, displaced, reason: `Pullback into the ${touch} after liquidity was swept and character changed ${word}${displaced ? ' (displacement)' : ''}` };
}

/** The SMC vote with the displacement requirement: the latest same-direction structure break (<= 40 bars old) must have been a displacement candle. */
export function smcWithDisplacement(candles, S, i, k = 3) {
  const base = smcSignal(candles, S, i, k);
  if (!base.vote) return { ...base, displaced: false };
  const dir = base.vote > 0 ? 'LONG' : 'SHORT';
  for (let q = i; q >= Math.max(0, i - 40); q--) {
    if (S.events[q] && S.events[q].dir === dir) {
      const d = isDisplacement(candles, q, dir);
      return d ? { ...base, displaced: true } : { ...base, vote: 0, displaced: false, reason: base.reason + ' - but the break was not a displacement candle' };
    }
  }
  return { ...base, vote: 0, displaced: false };
}
