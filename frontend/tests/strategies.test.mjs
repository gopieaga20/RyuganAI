import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, combine, MIN_ADX } from '../js/strategies.js';

const T0 = Date.UTC(2026, 0, 5, 3, 45);
// deterministic pseudo-random so the fixtures never change
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A trend with pullbacks (a sine wave on top of a drift), like real swings; a perfectly straight line has no pivots.
function series(n, drift, amp = 2.2, noise = 0.6, step = 5) {
  const out = []; let base = 100, prev = 100;
  for (let i = 0; i < n; i++) {
    base += drift;
    const c = base + amp * Math.sin(i / 6) + (rnd() - 0.5) * noise, o = prev;
    const h = Math.max(o, c) + rnd() * noise * 0.4, l = Math.min(o, c) - rnd() * noise * 0.4;
    const ts = T0 + i * step * 60000;
    out.push({ ts, date: new Date(ts), o, h, l, c, v: 1000 + Math.floor(rnd() * 500) });
    prev = c;
  }
  return out;
}

test('too few candles gives a clear WAIT, not a crash', () => {
  const r = evaluate(series(30, 0.1));
  assert.equal(r.call, 'WAIT');
  assert.match(r.reason, /at least 60/);
});

test('a strong steady uptrend votes bullish and calls BUY CE', () => {
  seed = 7;
  const r = evaluate(series(160, 0.25), { intraday: false });
  assert.ok(r.adx >= MIN_ADX, `adx ${r.adx}`);
  assert.equal(r.call, 'BUY CE');
  assert.ok(r.levels.sl < r.price && r.levels.t1 > r.price);
  assert.ok(r.votes.find(v => v.id === 'trend').vote === 1);
});

test('a strong steady downtrend calls BUY PE with levels flipped', () => {
  seed = 7;
  const r = evaluate(series(160, -0.25), { intraday: false });
  assert.equal(r.call, 'BUY PE');
  assert.ok(r.levels.sl > r.price && r.levels.t1 < r.price);
});

test('a sideways market does not produce a call', () => {
  seed = 7;
  assert.equal(evaluate(series(160, 0), { intraday: false }).call, 'WAIT');
});

test('bearish news adds a bearish vote', () => {
  seed = 7;
  const bad = evaluate(series(160, 0.25), { intraday: false, news: { label: 'BEARISH' } });
  assert.equal(bad.votes.find(v => v.id === 'news').vote, -1);
});

test('combine: faster timeframe disagreeing cancels the call; agreeing adds confidence', () => {
  const ce = { ok: true, call: 'BUY CE', confidence: 70 }, pe = { ok: true, call: 'BUY PE', confidence: 70 };
  assert.equal(combine(ce, pe).call, 'WAIT');
  const both = combine(ce, { ok: true, call: 'BUY CE', confidence: 60 });
  assert.equal(both.call, 'BUY CE');
  assert.equal(both.confidence, 75);
  assert.equal(combine(ce, { ok: true, call: 'WAIT' }).call, 'BUY CE');
});
