import test from 'node:test';
import assert from 'node:assert/strict';
import { signalOf, candidates, runOption, simulateSymbol, stats, groupBy, runBacktest, DEFAULTS, rng, dailyVol, REF_STOCK_VOL } from '../js/bt-engine.js';

const IST = 19800000, DAY = 86400000;
// candles of one session at 15-minute steps from 09:15 IST; day 0 = 2026-01-05 (Monday)
const t = (day, min) => Date.UTC(2026, 0, 5) + day * DAY + min * 60000 - IST;
function session(day, closes, start = 9 * 60 + 15) {
  return closes.map((c, k) => ({ ts: t(day, start + 15 * k), o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}
const rec = (v, adx = 25) => ({ v, adx });

test('signal: all-agree rule, weighted score, ADX gate', () => {
  assert.equal(signalOf(rec({ vwap: 1, trend: 1 }), ['vwap', 'trend']), 1);
  assert.equal(signalOf(rec({ vwap: 1, trend: 0 }), ['vwap', 'trend']), 0);
  assert.equal(signalOf(rec({ vwap: -1, trend: 1 }), ['vwap', 'trend']), 0);
  assert.equal(signalOf(rec({ vwap: -1 }), ['vwap']), -1);
  assert.equal(signalOf(rec({ vwap: 1 }, 15), ['vwap']), 0);                    // ADX below 20
  assert.equal(signalOf(rec({ trend: 1, vwap: 1 }), ['trend', 'vwap'], 'score', 3), 1);   // 2 + 1
  assert.equal(signalOf(rec({ trend: 1, vwap: 0 }), ['trend', 'vwap'], 'score', 3), 0);
  assert.equal(signalOf(rec({ sr: 1, vwap: 1 }), ['sr', 'vwap'], 'score', 1), 1);         // sr weighs 0
  assert.equal(signalOf(null, ['vwap']), 0);
  assert.equal(signalOf(rec({ vwap: 1 }), []), 0);
});

function sym(closes, votes, extra = {}) {
  const candles = session(0, closes);
  return { sym: 'X', label: 'X', isIndex: true, candles, votes: candles.map((_, i) => votes[i] ?? null), ...extra };
}

test('candidates respect the entry window, the date range and the last candle of the day', () => {
  const closes = Array.from({ length: 25 }, () => 100);
  const votes = closes.map(() => rec({ vwap: 1 }));
  const s = sym(closes, votes);
  const cfg = { ...DEFAULTS, fromMin: 10 * 60, toMin: 11 * 60 };
  // WARMUP is 60 candles: one session of 25 gives none
  assert.equal(candidates(s, cfg).length, 0);
  const long = { sym: 'Y', isIndex: true, candles: [...session(0, Array(25).fill(100)), ...session(1, Array(25).fill(100)), ...session(2, Array(25).fill(100))] };
  long.votes = long.candles.map(() => rec({ vwap: 1 }));
  const c = candidates(long, { ...DEFAULTS, fromMin: 9 * 60 + 15, toMin: 15 * 60 + 30 });
  assert.ok(c.length > 0 && c.every(x => x.i >= 60));
  assert.ok(c.every(x => long.meta[x.i + 1].day === long.meta[x.i].day));          // never the day's last candle
  const ranged = candidates(long, { ...DEFAULTS, fromMin: 0, toMin: 24 * 60, startTs: t(2, 12 * 60), endTs: t(2, 13 * 60) });
  assert.ok(ranged.length > 0 && ranged.every(x => long.candles[x.i].ts >= t(2, 12 * 60) && long.candles[x.i].ts <= t(2, 13 * 60)));
});

test('option model: target, stop and square-off', () => {
  // index premium = 0.55% of 10,000 = 55; delta 0.5 -> target +30% = 16.5 premium = 33 points; stop -30% = -33 points
  const mk = closes => { const s = { isIndex: true, candles: session(0, closes, 12 * 60) }; s.candles.forEach(c => { c.h = c.c; c.l = c.c; }); s.meta = s.candles.map(c => ({ day: '2026-01-05', min: Math.round(((c.ts + IST) % DAY) / 60000) })); return s; };
  const up = mk([10000, 10000, 10040, 10040]);
  let r = runOption(up, { i: 0, dir: 1 }, DEFAULTS);
  assert.equal(r.why, 'TP'); assert.equal(r.ret, 0.3);
  r = runOption(up, { i: 0, dir: -1 }, DEFAULTS);
  assert.equal(r.why, 'SL'); assert.equal(r.ret, -0.3);
  const flat = mk([10000, 10000, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005, 10005]);   // reaches 15:15
  r = runOption(flat, { i: 0, dir: 1 }, DEFAULTS);
  assert.equal(r.why, 'SQ'); assert.ok(r.ret > 0 && r.ret < 0.1);
});

test('one trade at a time: a signal filled in the same candle the last trade exits is skipped', () => {
  const s = { sym: 'X', label: 'X', isIndex: true, candles: session(0, [10000, 10000, 10040, 10040, 10040, 10040], 12 * 60) };
  s.candles.forEach(c => { c.h = c.c; c.l = c.c; });
  s.meta = s.candles.map(c => ({ day: '2026-01-05', min: Math.round(((c.ts + IST) % DAY) / 60000) }));
  const cands = [{ i: 0, dir: 1, ts: s.candles[1].ts }, { i: 1, dir: 1, ts: s.candles[2].ts }, { i: 2, dir: 1, ts: s.candles[3].ts }];
  const tr = simulateSymbol(s, cands, DEFAULTS);         // first trade exits during candle 2 (TP): the candidate filled at candle 2's open is skipped
  assert.equal(tr.length, 2);
  assert.equal(tr[1].ts, s.candles[3].ts);
  assert.ok(tr[0].charges > DEFAULTS.premium * 0.01);   // spread (1%) plus option charges
});

test('stats and grouping', () => {
  const tr = [{ net: 100, exitTs: t(0, 600), label: 'A' }, { net: -50, exitTs: t(0, 700), label: 'A' }, { net: 30, exitTs: t(1, 600), label: 'B' }];
  const s = stats(tr);
  assert.equal(s.n, 3); assert.equal(s.net, 80); assert.equal(s.win.toFixed(1), '66.7'); assert.equal(s.pf, 130 / 50);
  assert.equal(s.maxDD, -50); assert.equal(s.worstDay, 0); assert.equal(s.days, 2);
  assert.deepEqual(groupBy(tr, x => x.label).map(g => [g.key, g.n, g.net]), [['A', 2, 50], ['B', 1, 30]]);
  assert.equal(stats([]).avg, 0);
});

test('seeded random numbers repeat; volatility helper', () => {
  const a = rng(7), b = rng(7);
  assert.equal(a(), b());
  const flat = session(0, [100, 100]);
  assert.equal(dailyVol(flat), REF_STOCK_VOL);       // not enough days: the reference
});

test('a full run returns the breakdowns', () => {
  const candles = [];
  for (let d = 0; d < 6; d++) candles.push(...session(d, Array.from({ length: 25 }, (_, k) => 10000 + (d % 2 ? -1 : 1) * k * 5)));
  const s = { sym: 'N', label: 'Nifty', isIndex: true, candles, votes: candles.map((c, i) => rec({ vwap: Math.floor(i / 25) % 2 ? -1 : 1 })) };
  const r = runBacktest([s], { ids: ['vwap'], fromMin: 9 * 60 + 30, toMin: 14 * 60 + 30 });
  assert.ok(r.stats.n > 0 && r.signals >= r.stats.n);
  assert.equal(r.bySymbol[0].key, 'Nifty');
  assert.ok(r.bySide.length >= 1 && r.byMonth.length === 1 && r.byExit.length >= 1);
});
