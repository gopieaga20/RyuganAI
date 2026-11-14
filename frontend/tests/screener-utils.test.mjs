import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, filterRows, checklist, setupText, scoreBand, ageText, progressText, num, money } from '../js/screener-utils.js';

const rows = [
  { symbol: 'AAA', industry: 'Auto', score: 80, feed: true, hygiene: { ok: true }, setup: { entry: 100, stop: 95, qty: 10, rr: 2, type: 'BREAKOUT', t1: 110 } },
  { symbol: 'BBB', industry: 'Banks', score: 90, feed: false, hygiene: { ok: true }, setup: null },
  { symbol: 'CCC', industry: 'Auto parts', score: 60, feed: false, hygiene: { ok: false }, setup: { entry: 50, stop: 48, qty: 5, rr: 2.5, type: 'PULLBACK', t1: 55 } },
];

test('sort by score and by a setup column, empty values last', () => {
  assert.deepEqual(sortRows(rows).map(r => r.symbol), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortRows(rows, 'entry').map(r => r.symbol), ['AAA', 'CCC', 'BBB']);
  assert.deepEqual(sortRows(rows, 'entry', true).map(r => r.symbol), ['CCC', 'AAA', 'BBB']);
  assert.deepEqual(sortRows(rows, 'symbol', true).map(r => r.symbol), ['AAA', 'BBB', 'CCC']);
  assert.equal(rows[0].symbol, 'AAA');                       // not mutated
});

test('filters by view, search and hygiene', () => {
  assert.deepEqual(filterRows(rows).map(r => r.symbol), ['AAA']);
  assert.deepEqual(filterRows(rows, { view: 'all' }).map(r => r.symbol), ['AAA', 'BBB']);
  assert.deepEqual(filterRows(rows, { view: 'all', hygieneOnly: false }).map(r => r.symbol), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(filterRows(rows, { view: 'setups', hygieneOnly: false }).map(r => r.symbol), ['AAA', 'CCC']);
  assert.deepEqual(filterRows(rows, { view: 'all', hygieneOnly: false, q: 'auto' }).map(r => r.symbol), ['AAA', 'CCC']);
});

test('checklist mixes gate, fundamentals and hygiene, marking unknown rules n/a', () => {
  const l = checklist({ rs: 91, near_high_pct: 4.2, tech_gate: { checks: { trend: true, slope: true, rs: true, proximity: false } },
    fund_parts: { roe: { label: 'ROE >= 15%', ok: true, value: 19 }, pledge: { label: 'Pledge < 5%', ok: null, value: null } },
    hygiene: { turnover_cr: 120.4, asm: false, gsm: null, ban: true } });
  const by = label => l.find(x => x.label === label);
  assert.equal(by('RS rating above 80').value, 91);
  assert.equal(by('Within 15% of the 52-week high').state, 'fail');
  assert.equal(by('ROE >= 15%').state, 'pass');
  assert.equal(by('Pledge < 5%').state, 'na');
  assert.equal(by('Not in ASM').state, 'pass');
  assert.equal(by('Not in GSM').state, 'na');
  assert.equal(by('Not in the F&O ban list').state, 'fail');
});

test('texts and bands', () => {
  assert.equal(setupText(null), 'No setup today');
  assert.match(setupText(rows[0].setup), /Breakout: risk ₹50 for 10 shares; T1 pays 2.0 times that/);
  assert.equal(scoreBand(80), 'hi'); assert.equal(scoreBand(65), 'mid'); assert.equal(scoreBand(40), 'lo');
  assert.equal(ageText(null), 'no data');
  assert.equal(ageText('2026-11-01', new Date('2026-11-14')), '13 days old');
  assert.equal(ageText('2026-03-31', new Date('2026-11-14')), '8 months old');
  assert.equal(progressText({ running: true, phase: 'daily candles', done: 3, total: 10 }), 'Running: daily candles (3/10)');
  assert.equal(progressText({ fund_running: true, fund_done: 2, fund_total: 9, fund_errors: 1 }), 'Refreshing fundamentals 2/9, 1 skipped');
  assert.equal(progressText({}), '');
  assert.equal(num(null), '--'); assert.equal(money(1234567), '₹12,34,567');
});
