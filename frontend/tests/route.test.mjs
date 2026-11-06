import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, parseRoute, hashFor, titleFor } from '../js/route.js';

test('every page round-trips through its address', () => {
  for (const p of PAGES) assert.equal(parseRoute(hashFor(p)), p);
});

test('addresses are forgiving', () => {
  assert.equal(parseRoute('#/paper'), 'paper');
  assert.equal(parseRoute('#paper'), 'paper');
  assert.equal(parseRoute('#/Live'), 'live');
  assert.equal(parseRoute('#/backtest/results'), 'backtest');
  assert.equal(parseRoute('#/paper?x=1'), 'paper');
});

test('unknown, empty or odd addresses open the dashboard and never throw', () => {
  for (const h of ['', '#', '#/', '#/nonsense', '#/__proto__', null, undefined, 42, '#//paper']) assert.equal(parseRoute(h), 'dash');
});

test('every page has a title', () => {
  for (const p of PAGES) assert.match(titleFor(p), /· Ryugan Pro$/);
});
