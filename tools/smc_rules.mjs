// Candidate trading rules built on the outputs of the LuxAlgo SMC port (frontend/js/smc.js). Research only: nothing here is used by the app.
// ruleRows(candles) returns { ruleId: Int8Array(+1 = BUY CE, -1 = BUY PE, 0 = nothing) } with one value per bar, read at that bar's close.
import { buildSmc } from '../frontend/js/smc.js';

export const RULES = [
  ['r_base', 'Today\'s SMC vote (control)', 'Internal trend + swing not opposed + order block tapped + right half of the swing range.'],
  ['r_nozone', 'Order block tap, no premium/discount rule', 'The same without the half-of-range condition: internal trend, swing not opposed, an unmitigated order block tapped.'],
  ['r_swingonly', 'Swing structure only', 'Swing trend (size 50) + a SWING order block tapped + right half of the range.'],
  ['r_choch_ob', 'CHoCH then order block', 'A change of character (internal or swing) in the last 12 bars, then the order block it created is tapped. A reversal setup.'],
  ['r_swing_choch_ob', 'Swing CHoCH then order block', 'A SWING change of character in the last 40 bars, then the order block it created is tapped.'],
  ['r_bos_ob', 'BOS then order block', 'An internal break of structure WITH the trend in the last 12 bars (swing trend agreeing), then the order block it created is tapped. A continuation setup.'],
  ['r_fvg_ob', 'Order block + fair value gap', 'An order block tap whose candle also trades inside a live LuxAlgo fair value gap of the same direction.'],
  ['r_eq_sweep', 'Equal highs/lows swept', 'Equal lows formed in the last 40 bars, a candle wicks under them and closes back above (mirror for equal highs).'],
  ['r_eq_sweep_bias', 'Equal highs/lows swept, with the trend', 'The same, only when the internal trend points the way of the reversal.'],
  ['r_retest', 'Break-and-retest of the structure level', 'After an internal break in the last 12 bars, price returns to the broken level and closes back in the break direction.'],
  ['r_pd_trend', 'Discount/premium + internal trend', 'Internal trend with price in the discount (up) or premium (down) half of the swing range. No order block needed.'],
];

export function ruleRows(candles) {
  const R = buildSmc(candles), n = candles.length;
  const rows = Object.fromEntries(RULES.map(([id]) => [id, new Int8Array(n)]));
  const byBar = new Map(); for (const ev of R.events) { if (!byBar.has(ev.i)) byBar.set(ev.i, []); byBar.get(ev.i).push(ev); }
  const obAt = new Map(); for (const ob of R.obs) { if (!obAt.has(ob.formedAt)) obAt.set(ob.formedAt, []); obAt.get(ob.formedAt).push(ob); }
  const fvgAt = new Map(); for (const g of R.fvgs) { if (!fvgAt.has(g.i)) fvgAt.set(g.i, []); fvgAt.get(g.i).push(g); }
  let alive = [], liveFvg = [];
  const recentEv = [];                                          // events in time order, trimmed
  const eqRecent = [];
  let eqIdx = 0;
  const tap = (ob, c, d, i) => ob.formedAt < i && (d > 0 ? c.l <= ob.top && c.c > c.o : c.h >= ob.bottom && c.c < c.o);

  for (let i = 0; i < n; i++) {
    for (const ob of obAt.get(i) || []) alive.push(ob);
    alive = alive.filter(ob => ob.mitigatedAt === null || ob.mitigatedAt > i);
    for (const g of fvgAt.get(i) || []) liveFvg.push(g);
    liveFvg = liveFvg.filter(g => g.filledAt === null || g.filledAt > i);
    for (const ev of byBar.get(i) || []) recentEv.push(ev);
    while (recentEv.length && recentEv[0].i < i - 40) recentEv.shift();
    while (eqIdx < R.eqs.length && R.eqs[eqIdx].i <= i) eqRecent.push(R.eqs[eqIdx++]);
    while (eqRecent.length && eqRecent[0].i < i - 40) eqRecent.shift();
    if (i < 60) continue;
    const c = candles[i], bi = R.internalBias[i], bs = R.swingBias[i];
    const eq = (R.trailTop[i] + R.trailBottom[i]) / 2, zone = Number.isFinite(eq) ? (c.c < eq ? 1 : c.c > eq ? -1 : 0) : 0;
    rows.r_base[i] = R.votes[i];

    if (bi && bs !== -bi) {
      const hit = alive.filter(ob => ob.bias === bi && tap(ob, c, bi, i));
      if (hit.length) {
        rows.r_nozone[i] = bi;
        if (zone === bi) rows.r_base[i] = bi;
        if (hit.some(ob => !ob.internal) && bs === bi && zone === bi) rows.r_swingonly[i] = bi;
        const gaps = liveFvg.filter(g => (g.dir === 'LONG' ? 1 : -1) === bi && g.i < i && c.l <= Math.max(g.top, g.bottom) && c.h >= Math.min(g.top, g.bottom));
        if (gaps.length) rows.r_fvg_ob[i] = bi;
      }
      if (zone === bi) rows.r_pd_trend[i] = bi;
    }
    // reversal / continuation setups tied to a specific structure event and the block that event created
    for (let k = recentEv.length - 1; k >= 0; k--) {
      const ev = recentEv[k], d = ev.dir === 'LONG' ? 1 : -1, age = i - ev.i;
      if (age < 1) continue;
      const mine = alive.filter(ob => ob.formedAt === ev.i && ob.internal === ev.internal && ob.bias === d);
      const touched = mine.some(ob => tap(ob, c, d, i));
      if (ev.type === 'CHoCH' && age <= 12 && touched && !rows.r_choch_ob[i]) rows.r_choch_ob[i] = d;
      if (ev.type === 'CHoCH' && !ev.internal && age <= 40 && touched && !rows.r_swing_choch_ob[i]) rows.r_swing_choch_ob[i] = d;
      if (ev.type === 'BOS' && ev.internal && age <= 12 && bs === d && touched && !rows.r_bos_ob[i]) rows.r_bos_ob[i] = d;
      if (ev.internal && age <= 12 && !rows.r_retest[i]) {
        const back = d > 0 ? c.l <= ev.level && c.c > ev.level && c.c > c.o : c.h >= ev.level && c.c < ev.level && c.c < c.o;
        if (back && (d > 0 ? candles.slice(ev.i + 1, i).every(x => x.c > ev.level) : candles.slice(ev.i + 1, i).every(x => x.c < ev.level))) rows.r_retest[i] = d;
      }
    }
    for (const q of eqRecent) {
      if (q.type === 'EQL' && c.l < q.level && c.c > q.level && c.c > c.o) { rows.r_eq_sweep[i] = 1; if (bi > 0) rows.r_eq_sweep_bias[i] = 1; }
      if (q.type === 'EQH' && c.h > q.level && c.c < q.level && c.c < c.o) { rows.r_eq_sweep[i] = -1; if (bi < 0) rows.r_eq_sweep_bias[i] = -1; }
    }
  }
  return rows;
}
