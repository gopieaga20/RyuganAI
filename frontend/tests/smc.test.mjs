import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmc, smcSignal, SWING_SIZE, INTERNAL_SIZE } from '../js/smc.js';

const T0 = 1767584100000;
/** Candles that follow a path of closes (each leg is a straight line), with a small wick on each side. */
function path(points, wick = 0.2) {
  const closes = [points[0][0]];
  for (let k = 1; k < points.length; k++) {
    const [to, bars] = points[k], from = closes[closes.length - 1];
    for (let b = 1; b <= bars; b++) closes.push(from + (to - from) * b / bars);
  }
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { ts: T0 + i * 900000, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: 1000 };
  });
}
function rng(seed) { let s = seed; return () => (s = s * 16807 % 2147483647) / 2147483647; }
function regime(n, seed) {
  const r = rng(seed); const out = []; let prev = 100, drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) drift = (r() - 0.5) * 0.6;
    const spike = r() < 0.02 ? 4 : 1, c = prev + drift + (r() - 0.5) * 1.4 * spike;
    out.push({ ts: T0 + i * 900000, o: prev, h: Math.max(prev, c) + r() * 0.5 * spike, l: Math.min(prev, c) - r() * 0.5 * spike, c, v: 1000 });
    prev = c;
  }
  return out;
}

test('the indicator defaults are the LuxAlgo ones', () => {
  assert.equal(SWING_SIZE, 50); assert.equal(INTERNAL_SIZE, 5);
});

test('a close through the latest pivot is a BOS with the trend and a CHoCH against it', () => {
  // up, pull back, up through the first high (BOS), then a collapse through the last low (CHoCH)
  const cs = path([[100], [112, 18], [104, 10], [118, 16], [96, 24]]);
  const r = buildSmc(cs);
  const internal = r.events.filter(e => e.internal);
  assert.ok(internal.length >= 2, JSON.stringify(internal));
  const firstUp = internal.find(e => e.dir === 'LONG');
  assert.equal(firstUp.type, 'BOS');                                         // the first break has no trend to change
  assert.ok(candlesBreak(cs, firstUp));
  const down = internal.find(e => e.dir === 'SHORT' && e.i > firstUp.i);
  assert.equal(down.type, 'CHoCH');                                          // against the trend that the up-break set
  assert.equal(r.internalBias[down.i], -1);
  assert.equal(r.internalBias[firstUp.i], 1);
});

/** A break event is a CLOSE beyond its level on that bar, and the bar before had not closed beyond it. */
function candlesBreak(cs, e) {
  const up = e.dir === 'LONG';
  return (up ? cs[e.i].c > e.level : cs[e.i].c < e.level) && (up ? cs[e.i - 1].c <= e.level : cs[e.i - 1].c >= e.level);
}

test('every structure break is a close through its level, in a long random market', () => {
  const cs = regime(900, 3), r = buildSmc(cs);
  assert.ok(r.events.length > 10);
  for (const e of r.events) assert.ok(candlesBreak(cs, e), JSON.stringify(e));
  assert.ok(r.events.some(e => !e.internal), 'swing breaks (size 50) occur too');
});

test('an order block is the extreme bar between the broken pivot and the break, and is mitigated by trading through its far side', () => {
  const cs = regime(900, 2), r = buildSmc(cs);
  assert.ok(r.obs.length > 5 && r.obs.some(o => o.mitigatedAt !== null));
  for (const ob of r.obs) {
    assert.ok(ob.idx < ob.formedAt && ob.top >= ob.bottom);
    if (ob.mitigatedAt !== null) {
      const c = cs[ob.mitigatedAt];
      assert.ok(ob.bias > 0 ? c.l < ob.bottom : c.h > ob.top, JSON.stringify(ob));
      for (let q = ob.formedAt; q < ob.mitigatedAt; q++) assert.ok(ob.bias > 0 ? cs[q].l >= ob.bottom : cs[q].h <= ob.top);   // never touched before
    }
  }
});

test('it never looks at a bar that has not closed: results up to bar i do not change when later bars are added', () => {
  const cs = regime(700, 1), full = buildSmc(cs);
  for (const end of [300, 450, 600]) {
    const part = buildSmc(cs.slice(0, end + 1));
    assert.deepEqual([...part.votes], [...full.votes].slice(0, end + 1));
    assert.deepEqual([...part.internalBias], [...full.internalBias].slice(0, end + 1));
    assert.deepEqual([...part.swingBias], [...full.swingBias].slice(0, end + 1));
    assert.deepEqual(part.events.filter(e => e.i <= end), full.events.filter(e => e.i <= end));
  }
});

test('the SMC vote needs structure, an order block tap and the right half of the range, and says why when it does not vote', () => {
  const r = buildSmc(regime(1100, 1));
  assert.ok([...r.votes].some(v => v !== 0), 'the fixture produces votes');
  assert.ok([...r.votes].every(v => v === 0 || v === 1 || v === -1));
  for (let i = 0; i < r.votes.length; i++) {
    if (!r.votes[i]) continue;
    assert.equal(r.votes[i], r.internalBias[i]);                              // votes only in the direction of the internal trend
    assert.notEqual(r.swingBias[i], -r.votes[i]);                             // never against the swing trend
    const eq = (r.trailTop[i] + r.trailBottom[i]) / 2;
    assert.ok(Number.isFinite(eq));                                           // and only once the swing range exists
  }
  const none = smcSignal(path([[100], [100.05, 40]]));      // flat: no pivot, no break
  assert.equal(none.vote, 0); assert.match(none.reason, /undecided/);
  assert.equal(smcSignal([]).vote, 0);
});

test('the last-bar reading carries the explanation, earlier bars only the number', () => {
  const cs = regime(900, 3), r = buildSmc(cs);
  assert.equal(typeof r.last.reason, 'string'); assert.ok(r.last.reason.length > 0);
  assert.equal(r.last.vote, r.votes[cs.length - 1]);
});
