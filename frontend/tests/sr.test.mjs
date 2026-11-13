import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionLevels, avgRange, srSignal } from '../js/sr.js';

const T0 = 1767584100000;                      // 2026-01-05 09:15 IST
const DAY = 86400000, BAR = 15 * 60000;
const bar = (d, k, o, h, l, c) => ({ ts: T0 + d * DAY + k * BAR, o, h, l, c, v: 1000 });

/** Day 0: a range 100-110 closing at 105. Day 1: quiet bars inside the range, then whatever the test appends. */
function twoDays(extra = []) {
  const out = [];
  for (let k = 0; k < 25; k++) out.push(bar(0, k, 104.5, k === 7 ? 110 : 106, k === 13 ? 100 : 104, 105));
  for (let k = 0; k < 5; k++) out.push(bar(1, k, 105, 106, 104.4, 105.2));
  extra.forEach((e, j) => out.push(bar(1, 5 + j, ...e)));
  return out;
}

test('previous-session levels come from the session before today, and the first day has none', () => {
  const cs = twoDays([[105.2, 106, 104.5, 105.5]]);
  assert.deepEqual(sessionLevels(cs, cs.length - 1) && { ...sessionLevels(cs, cs.length - 1), start: undefined }, { pdh: 110, pdl: 100, pdc: 105, start: undefined });
  assert.equal(sessionLevels(cs, 10), null);
  assert.ok(Math.abs(avgRange(cs, 29) - 1.6) < 0.5);
});

test('a fresh strong close above the previous day high is a bullish breakout, and it fires only once', () => {
  const cs = twoDays([[106, 112, 105.8, 111.8], [111.8, 113, 111.5, 112.8], [112.8, 114, 112.5, 113.8]]);
  const first = srSignal(cs, 30), second = srSignal(cs, 31), third = srSignal(cs, 32);
  assert.equal(first.vote, 1); assert.equal(first.kind, 'breakout'); assert.equal(first.level, 110);
  assert.equal(second.parts.brk, 1);                                  // still within 3 bars of being inside the range
  assert.equal(srSignal(twoDays([[106, 112, 105.8, 111.8], [111.8, 113, 111.5, 112.8], [112.8, 114, 112.5, 113.8], [113.8, 115, 113.5, 114.8], [114.8, 116, 114.5, 115.8]]), 34).parts.brk, 0);
  assert.ok(third.vote >= 0);
});

test('a weak or marginal close beyond the level is not a breakout', () => {
  assert.equal(srSignal(twoDays([[109.5, 110.4, 109.0, 110.05]]), 30).parts.brk, 0);     // closed only 0.05 above: inside the buffer
  assert.equal(srSignal(twoDays([[111.9, 112.2, 105.0, 111.0]]), 30).parts.brk, 0);      // closed far from its high / bearish candle
});

test('a close below the previous day low is a bearish breakdown', () => {
  const r = srSignal(twoDays([[104, 104.2, 98, 98.2]]), 30);
  assert.equal(r.vote, -1); assert.equal(r.kind, 'breakout'); assert.equal(r.level, 100);
});

test('break and retest: after breaking out, touching the level and closing back up is a bullish continuation', () => {
  const cs = twoDays([[106, 112, 105.8, 111.8], [111.8, 113, 111.5, 112.8], [112.8, 114, 112.5, 113.8], [113.8, 115, 113.5, 114.8], [114.5, 114.6, 110.1, 112.0]]);
  const r = srSignal(cs, 34);
  assert.equal(r.vote, 0);                                                                // the last bar is bearish: no retest long
  const ok = twoDays([[106, 112, 105.8, 111.8], [111.8, 113, 111.5, 112.8], [112.8, 114, 112.5, 113.8], [113.8, 115, 113.5, 114.8], [110.3, 112.5, 110.1, 112.2]]);
  const t = srSignal(ok, 34);
  assert.equal(t.vote, 1); assert.equal(t.kind, 'retest');
});

test('rejection: a wick through the previous day high that closes back below is bearish; the mirror at the low is bullish', () => {
  const up = srSignal(twoDays([[110.2, 111.5, 109.0, 109.2]]), 30);
  assert.equal(up.vote, -1); assert.equal(up.kind, 'rejection'); assert.equal(up.level, 110);
  const down = srSignal(twoDays([[99.8, 101.0, 98.5, 100.8]]), 30);
  assert.equal(down.vote, 1); assert.equal(down.kind, 'rejection');
  assert.equal(srSignal(twoDays([[110.2, 111.5, 109.8, 111.0]]), 30).parts.rev, 0);       // closed above: that is a breakout attempt, not a rejection
});

function walk(n, seed) {
  let x = seed, p = 100; const out = [];
  const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  for (let i = 0; i < n; i++) {
    const d = Math.floor(i / 25), k = i % 25, o = p, c = o + (rnd() - 0.49) * 1.4;
    out.push({ ts: T0 + d * DAY + k * BAR, o, h: Math.max(o, c) + rnd() * 0.5, l: Math.min(o, c) - rnd() * 0.5, c, v: 1000 }); p = c;
  }
  return out;
}

test('the reading never looks into the future and is selective', () => {
  const cs = walk(600, 3); let votes = 0;
  for (let i = 60; i < cs.length; i++) {
    const r = srSignal(cs, i);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 5);
    if (r.vote) votes++;
    if (i % 11 === 0) { const part = srSignal(cs.slice(0, i + 1), i); assert.equal(part.vote, r.vote); assert.equal(part.kind, r.kind); }
  }
  assert.ok(votes > 0 && votes < (cs.length - 60) * 0.25);
});
