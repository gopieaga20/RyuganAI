import test from 'node:test';
import assert from 'node:assert/strict';
import { pivots, orderBlockOf, orderBlockRetest, liquiditySweep, premiumDiscount, smcSignal, isDisplacement, sweepChoch, smcWithDisplacement } from '../js/smc.js';
import { buildStructure } from '../js/smc-structure.js';

const C = (o, h, l, c, i = 0) => ({ ts: i * 900000, o, h, l, c, v: 1000 });

test('a pivot is only used k bars after it forms', () => {
  const cs = [10, 11, 12, 15, 12, 11, 10, 9, 8].map((h, i) => C(h - 1, h, h - 2, h - 1, i));      // peak at index 3
  assert.equal(pivots(cs, 5, 3).length, 0);                                                          // not confirmed yet (needs bar 6)
  const p = pivots(cs, 6, 3);
  assert.deepEqual(p.filter(x => x.type === 'H').map(x => [x.idx, x.price]), [[3, 15]]);
});

test('liquidity sweep: a wick below the last swing low that closes back above is bullish, the mirror is bearish', () => {
  const pv = [{ idx: 5, price: 100, type: 'L' }, { idx: 8, price: 120, type: 'H' }];
  const cs = [];
  cs[20] = C(100.5, 101.5, 98, 101);          // took 100, closed back above, long lower wick
  assert.equal(liquiditySweep(cs, pv, 20), 1);
  cs[21] = C(100.5, 101.5, 98, 99.5);         // closed below the swing low: that is a breakdown, not a sweep
  assert.equal(liquiditySweep(cs, pv, 21), 0);
  cs[22] = C(119.5, 122, 118.5, 119);         // took 120, closed back below, long upper wick
  assert.equal(liquiditySweep(cs, pv, 22), -1);
  cs[23] = C(110, 111, 109, 110.5);           // nothing taken
  assert.equal(liquiditySweep(cs, pv, 23), 0);
});

test('premium / discount splits the last swing range at 50% and is silent outside it', () => {
  const pv = [{ idx: 1, price: 100, type: 'L' }, { idx: 4, price: 120, type: 'H' }];
  const at = p => premiumDiscount([C(p, p, p, p)], pv, 0).zone;
  assert.equal(at(105), 1);       // discount
  assert.equal(at(115), -1);      // premium
  assert.equal(at(110), 0);       // equilibrium
  assert.equal(at(130), 0);       // outside the range
  assert.equal(premiumDiscount([C(1, 1, 1, 1)], [], 0).zone, 0);
});

test('order block: the last bearish candle at the origin of an up-move that broke structure', () => {
  const cs = [C(10, 10.5, 9.5, 10, 0), C(10, 10.2, 9.0, 9.2, 1) /* bearish origin */, C(9.2, 10.5, 9.1, 10.4, 2), C(10.4, 11.5, 10.3, 11.4, 3), C(11.4, 12.5, 11.3, 12.4, 4)];
  const ob = orderBlockOf(cs, 4, 'LONG');
  assert.ok(ob && ob.idx === 1 && ob.bottom === 9.0 && ob.top === 10.2);
  assert.equal(orderBlockOf([C(10, 11, 9, 10.8, 0), C(10.8, 12, 10.5, 11.9, 1)], 1, 'LONG'), null);   // no bearish candle to use
});

test('order block retest needs an unmitigated block and a rejection candle', () => {
  const base = [C(10, 10.5, 9.5, 10, 0), C(10, 10.2, 9.0, 9.2, 1), C(9.2, 10.5, 9.1, 10.4, 2), C(10.4, 11.5, 10.3, 11.4, 3), C(11.4, 12.5, 11.3, 12.4, 4)];
  const S = { events: [null, null, null, null, { type: 'BOS', dir: 'LONG', level: 11 }, null, null], trend: [], fvgs: [] };
  const tap = [...base, C(12.4, 12.6, 11, 11.8, 5), C(10.0, 11, 9.8, 10.9, 6)];     // dips into 9.0-10.2 and closes back up as a bullish candle
  assert.ok(orderBlockRetest(tap, S, 6, 'LONG'));
  const broke = [...base, C(12, 12, 8, 8.5, 5), C(8.5, 10.4, 8.4, 10.3, 6)];        // a close below 9.0 mitigated the block
  assert.equal(orderBlockRetest(broke, S, 6, 'LONG'), null);
  const noReject = [...base, C(12.4, 12.6, 12.0, 12.3, 5), C(12.3, 12.4, 12.0, 12.2, 6)];   // never came back to the block
  assert.equal(orderBlockRetest(noReject, S, 6, 'LONG'), null);
});

function walk(n, seed = 7) {
  let x = seed, p = 100; const out = [];
  const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  for (let i = 0; i < n; i++) { const o = p, d = (rnd() - 0.48) * 1.2, c = o + d; out.push({ ts: i * 900000, o, h: Math.max(o, c) + rnd() * 0.4, l: Math.min(o, c) - rnd() * 0.4, c, v: 1000 }); p = c; }
  return out;
}

test('the SMC reading never looks into the future', () => {
  const cs = walk(400);
  for (const i of [120, 200, 301, 399]) {
    const full = smcSignal(cs, buildStructure(cs, 3), i);
    const cut = cs.slice(0, i + 1), part = smcSignal(cut, buildStructure(cut, 3), i);
    assert.deepEqual(full.parts, part.parts);
    assert.equal(full.vote, part.vote);
  }
});

test('a vote needs bias, a point of interest AND the right half of the range; the reason always explains', () => {
  const cs = walk(600, 11); let votes = 0, bull = 0, bear = 0;
  const S = buildStructure(cs, 3);
  for (let i = 60; i < cs.length; i++) {
    const r = smcSignal(cs, S, i);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 5);
    if (r.vote) {
      votes++; r.vote > 0 ? bull++ : bear++;
      assert.equal(r.vote, r.parts.bias);                         // always with the structure
      assert.equal(r.parts.pd, r.vote);                           // longs in discount, shorts in premium
      assert.ok(r.parts.ob === r.vote || r.parts.fvg === r.vote || r.parts.sweep === r.vote);
    }
  }
  assert.ok(votes < (cs.length - 60) * 0.5, 'SMC should be selective');
});


test('a displacement candle is a big one-directional body that closes near its extreme', () => {
  const quiet = Array.from({ length: 14 }, (_, i) => C(100, 100.5, 99.5, 100.1, i));          // average range 1.0
  const big = [...quiet, C(100, 102.4, 99.9, 102.3, 14)];                                      // body 2.3 closes near the high
  assert.equal(isDisplacement(big, 14, 'LONG'), true);
  assert.equal(isDisplacement(big, 14, 'SHORT'), false);
  assert.equal(isDisplacement([...quiet, C(100, 102.4, 99.9, 100.6, 14)], 14, 'LONG'), false);  // small body
  assert.equal(isDisplacement([...quiet, C(100, 103.5, 99.9, 101.9, 14)], 14, 'LONG'), false);  // closed off the high: not displacement
  assert.equal(isDisplacement([...quiet, C(100, 100.2, 97.6, 97.7, 14)], 14, 'SHORT'), true);
});

test('sweep then change of character: selective, consistent and never looks ahead', () => {
  const cs = walk(900, 5), S = buildStructure(cs, 3); let seen = 0;
  for (let i = 80; i < cs.length; i += 1) {
    const r = sweepChoch(cs, S, i);
    if (!r.vote) continue;
    seen++;
    assert.ok(r.stage === 'choch' ? r.ageBars === 0 : r.ageBars > 0 && r.ageBars <= 8);
    assert.ok(S.events.slice(Math.max(1, i - 8), i + 1).some(ev => ev && ev.type === 'CHoCH' && (ev.dir === 'LONG') === (r.vote > 0)));
    if (i % 7 === 0) {
      const cut = cs.slice(0, i + 1), part = sweepChoch(cut, buildStructure(cut, 3), i);
      assert.equal(part.vote, r.vote);
      assert.equal(part.stage, r.stage);
    }
  }
  assert.ok(seen < 900 * 0.1, 'rare setup');
});

test('the displacement filter can only remove SMC votes, never add or flip them', () => {
  const cs = walk(900, 9), S = buildStructure(cs, 3);
  for (let i = 80; i < cs.length; i++) {
    const a = smcSignal(cs, S, i), b = smcWithDisplacement(cs, S, i);
    assert.ok(b.vote === 0 || b.vote === a.vote);
    if (b.vote) assert.equal(b.displaced, true);
  }
});
