import test from 'node:test';
import assert from 'node:assert/strict';
import { underlyingOf, sessionChange } from '../js/scan-utils.js';
import { isMarketOpen, istParts, toCandles, vwapIst } from '../js/candles.js';
import { buildStructure, fvgRetest } from '../js/smc-structure.js';

// IST = UTC + 5:30. Monday 2026-11-02.
const ist = (d, h, m) => Date.UTC(2026, 10, d, h - 5, m - 30);

test('market hours are Mon-Fri 09:15-15:30 IST', () => {
  assert.equal(isMarketOpen(ist(2, 9, 14)), false);
  assert.equal(isMarketOpen(ist(2, 9, 15)), true);
  assert.equal(isMarketOpen(ist(2, 15, 29)), true);
  assert.equal(isMarketOpen(ist(2, 15, 30)), false);
  assert.equal(isMarketOpen(ist(7, 11, 0)), false);          // Saturday
});

test('IST day/minute parts', () => {
  const p = istParts(ist(2, 9, 20));
  assert.equal(p.day, '2026-11-02'); assert.equal(p.min, 9 * 60 + 20); assert.equal(p.dow, 1);
});

test('underlying mapping for news and option chain', () => {
  assert.deepEqual(underlyingOf('NIFTY 50'), { news: 'NIFTY', chain: 'NIFTY' });
  assert.deepEqual(underlyingOf('bank nifty'), { news: 'BANKNIFTY', chain: 'BANKNIFTY' });
  assert.equal(underlyingOf('SENSEX').chain, null);
  assert.deepEqual(underlyingOf('HDFCBANK.NS'), { news: 'HDFCBANK', chain: 'HDFCBANK' });
});

test('session change compares the last close with the previous session close', () => {
  const mk = (ts, c) => ({ ts, o: c, h: c, l: c, c, v: 0 });
  const cs = [mk(ist(2, 15, 15), 100), mk(ist(3, 9, 15), 101), mk(ist(3, 9, 30), 102)];
  assert.ok(Math.abs(sessionChange(cs) - 2) < 1e-9);
  assert.equal(sessionChange([mk(ist(3, 9, 15), 100)]), null);
});

test('toCandles drops rows with missing prices', () => {
  const json = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, null], volume: [5, 6, 7] }] } }] } };
  const c = toCandles(json);
  assert.equal(c.length, 1); assert.equal(c[0].v, 5);
  assert.deepEqual(toCandles({}), []);
});

test('VWAP resets each IST day', () => {
  const mk = (ts, c) => ({ ts, o: c, h: c, l: c, c, v: 100 });
  const v = vwapIst([mk(ist(2, 15, 0), 100), mk(ist(3, 9, 15), 200)]);
  assert.equal(v[1], 200);
});

const bar = (h, l, c, o = c) => ({ ts: 0, o, h, l, c, v: 1 });
test('structure: first break is a CHoCH, a later break with the trend is a BOS', () => {
  const px = [[10, 9, 10], [12, 10, 11], [11, 9.5, 10], [10.5, 9, 9.5], [13, 10, 12.5], [14, 12, 13.5], [13, 11, 12], [12.5, 10.5, 11], [15, 12, 14.8]];
  const ev = buildStructure(px.map(p => bar(...p)), 1).events.filter(Boolean);
  assert.equal(ev[0].type, 'CHoCH'); assert.equal(ev[0].dir, 'LONG');
  assert.ok(ev.some(e => e.type === 'BOS' && e.dir === 'LONG'));
});
test('structure: pivots are confirmed k bars late (no look-ahead)', () => {
  const c = [bar(10, 9, 9.5), bar(11, 9.5, 10), bar(15, 10, 14), bar(12, 10, 11), bar(11, 9, 10), bar(16, 10, 15.5)];
  const S = buildStructure(c, 1);
  assert.equal(S.events[2], null); assert.equal(S.events[5].dir, 'LONG');
});
test('fvg retest needs a gap, a dip into it and a bullish rejection close', () => {
  const c = [bar(10, 9, 9.8), bar(12, 9.9, 11.9, 10), bar(14, 11, 13.5, 12), bar(13, 11.5, 12.5), bar(13, 10.4, 12.8, 11)];
  const S = buildStructure(c, 1);
  assert.ok(S.fvgs.length >= 1); assert.ok(fvgRetest(S, c, 4, 'LONG', 12)); assert.equal(fvgRetest(S, c, 4, 'SHORT', 12), null);
});
