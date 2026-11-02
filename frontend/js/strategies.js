'use strict';
/* Multi-strategy vote that turns candles (+ news) into a BUY CE / BUY PE / WAIT call.
 * Pure functions, no DOM: unit-tested in frontend/tests/strategies.test.mjs.
 *
 * Everything is evaluated on the LAST fully-formed candle only, using data up to and including it.
 * These are classic rules; backtests of them have NOT shown a proven edge, so the UI labels calls as unproven. */
import { Indicators } from './indicators.js';
import { buildStructure, fvgRetest } from './smc-structure.js';
import { vwapIst } from './candles.js';

export const STRATEGIES = [
  { id: 'trend',     name: 'EMA trend 9/21/50',    weight: 2 },
  { id: 'rsi',       name: 'RSI momentum',         weight: 1 },
  { id: 'vwap',      name: 'VWAP side',            weight: 1 },
  { id: 'structure', name: 'Structure BOS / CHoCH', weight: 2 },
  { id: 'fvg',       name: 'FVG retest',           weight: 1 },
  { id: 'volume',    name: 'Volume push',          weight: 1 },
  { id: 'news',      name: 'News sentiment',       weight: 1 },
];

export const MIN_ADX = 20;       // below this the market is treated as range-bound: no call
export const CALL_SCORE = 3;     // weighted vote needed for a BUY CE / BUY PE

const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '--');

/** @param candles [{ts,o,h,l,c,v}] oldest first, needs ~60+ bars
 *  @param opts {intraday:boolean, news:{label}|null, swingK:number,
 *              minAdx, callScore, weights:{id:number}, disable:[id]}  (the last four exist for backtesting/tuning) */
export function evaluate(candles, opts = {}) {
  const n = candles.length;
  if (n < 60) return { ok: false, reason: `Need at least 60 candles (have ${n})`, votes: [], call: 'WAIT', confidence: 0, score: 0, maxScore: 0 };
  const intraday = opts.intraday !== false;
  const i = n - 1, c = candles[i], price = c.c;
  const closes = candles.map(x => x.c);
  const ef = Indicators.ema(closes, 9), es = Indicators.ema(closes, 21), e50 = Indicators.ema(closes, 50);
  const rsi = Indicators.rsi(closes, 14)[i];
  const atr = Indicators.atr(candles, 14)[i] || (c.h - c.l) || 1;
  const adx = Indicators.adx(candles, 14)[i];
  const vw = intraday ? vwapIst(candles)[i] : null;
  const S = buildStructure(candles, opts.swingK || 3);

  const votes = [];
  const off = new Set(opts.disable || []);
  const add = (id, vote, reason) => {
    if (off.has(id)) return;
    const s = STRATEGIES.find(x => x.id === id);
    votes.push({ id, name: s.name, weight: opts.weights?.[id] ?? s.weight, vote, reason });
  };

  // 1. trend stack
  if (ef[i] > es[i] && es[i] > e50[i] && price > e50[i]) add('trend', 1, `EMA9 ${f2(ef[i])} > EMA21 ${f2(es[i])} > EMA50 ${f2(e50[i])}, price above all`);
  else if (ef[i] < es[i] && es[i] < e50[i] && price < e50[i]) add('trend', -1, `EMA9 ${f2(ef[i])} < EMA21 ${f2(es[i])} < EMA50 ${f2(e50[i])}, price below all`);
  else add('trend', 0, 'EMAs are tangled, no clean trend stack');

  // 2. RSI momentum (no chasing extremes)
  if (rsi >= 75) add('rsi', 0, `RSI ${rsi.toFixed(0)} is overbought, not chasing`);
  else if (rsi > 55) add('rsi', 1, `RSI ${rsi.toFixed(0)} shows bullish momentum`);
  else if (rsi <= 25) add('rsi', 0, `RSI ${rsi.toFixed(0)} is oversold, not chasing`);
  else if (rsi < 45) add('rsi', -1, `RSI ${rsi.toFixed(0)} shows bearish momentum`);
  else add('rsi', 0, `RSI ${rsi.toFixed(0)} is neutral`);

  // 3. VWAP (intraday only; meaningless on daily+ candles)
  if (intraday) {
    if (price > vw) add('vwap', 1, `Price ${f2(price)} is above VWAP ${f2(vw)}`);
    else if (price < vw) add('vwap', -1, `Price ${f2(price)} is below VWAP ${f2(vw)}`);
    else add('vwap', 0, 'Price is at VWAP');
  }

  // 4. market structure
  const bias = S.trend[i];
  let lastEv = null, evAge = 0;
  for (let q = i; q >= Math.max(0, i - 30); q--) if (S.events[q]) { lastEv = S.events[q]; evAge = i - q; break; }
  const evTxt = lastEv ? `last ${lastEv.type} ${lastEv.dir === 'LONG' ? 'up' : 'down'} ${evAge} bar${evAge === 1 ? '' : 's'} ago` : 'no recent break';
  if (bias === 1) add('structure', 1, `Higher-high structure, ${evTxt}`);
  else if (bias === -1) add('structure', -1, `Lower-low structure, ${evTxt}`);
  else add('structure', 0, 'Structure undecided');

  // 5. FVG retest in the direction of the structure
  const dirT = bias === 1 ? 'LONG' : bias === -1 ? 'SHORT' : null;
  const z = dirT ? fvgRetest(S, candles, i, dirT, 12) : null;
  if (z) add('fvg', dirT === 'LONG' ? 1 : -1, `Retest of a ${dirT === 'LONG' ? 'bullish' : 'bearish'} gap ${f2(z.bottom)}-${f2(z.top)} held`);
  else add('fvg', 0, 'No fresh gap being retested');

  // 6. volume push (skipped when the feed has no volume)
  let vSum = 0, vK = 0;
  for (let q = Math.max(0, i - 20); q < i; q++) { vSum += candles[q].v || 0; vK++; }
  const vAvg = vK ? vSum / vK : 0;
  if (!(c.v > 0) || !(vAvg > 0)) add('volume', 0, 'No volume data for this symbol');
  else if (c.v > 1.5 * vAvg && c.c > c.o) add('volume', 1, `Up candle on ${(c.v / vAvg).toFixed(1)}x average volume`);
  else if (c.v > 1.5 * vAvg && c.c < c.o) add('volume', -1, `Down candle on ${(c.v / vAvg).toFixed(1)}x average volume`);
  else add('volume', 0, 'Volume is ordinary');

  // 7. news
  if (opts.news) {
    const l = opts.news.label;
    add('news', l === 'BULLISH' ? 1 : l === 'BEARISH' ? -1 : 0, `Headlines are ${String(l).toLowerCase()}`);
  }

  const score = votes.reduce((a, v) => a + v.vote * v.weight, 0);
  const maxScore = votes.reduce((a, v) => a + v.weight, 0);
  const minAdx = opts.minAdx ?? MIN_ADX, callScore = opts.callScore ?? CALL_SCORE;
  let call = 'WAIT', why = '';
  if (adx < minAdx) why = `ADX ${adx.toFixed(0)} is below ${minAdx}: range-bound, no call`;
  else if (score >= callScore) call = 'BUY CE';
  else if (score <= -callScore) call = 'BUY PE';
  else why = `Votes are mixed (score ${score > 0 ? '+' : ''}${score} of ±${maxScore})`;
  const confidence = call === 'WAIT' ? Math.round(30 + 20 * Math.abs(score) / maxScore) : Math.min(95, Math.round(50 + 45 * Math.abs(score) / maxScore));

  const dir = call === 'BUY CE' ? 1 : call === 'BUY PE' ? -1 : (score >= 0 ? 1 : -1);
  const levels = { entry: price, sl: price - dir * 1.5 * atr, t1: price + dir * 2 * atr, t2: price + dir * 3.5 * atr, atr };
  return { ok: true, call, confidence, score, maxScore, adx, rsi, price, atr, votes, levels, reason: why, ts: c.ts };
}

/** Primary timeframe decides; the faster timeframe must not disagree. */
export function combine(primary, confirm) {
  if (!primary?.ok) return { ...(primary || {}), call: 'WAIT', confidence: 0, note: primary?.reason || 'No data' };
  const out = { ...primary, note: primary.reason || '' };
  if (!confirm?.ok || primary.call === 'WAIT') return out;
  const opposite = (primary.call === 'BUY CE' && confirm.call === 'BUY PE') || (primary.call === 'BUY PE' && confirm.call === 'BUY CE');
  if (opposite) return { ...out, call: 'WAIT', confidence: 40, note: `${primary.call} on the slower chart is contradicted by ${confirm.call} on the faster chart` };
  if (confirm.call === primary.call) return { ...out, confidence: Math.min(97, primary.confidence + 5), note: 'Both timeframes agree' };
  return out;
}
