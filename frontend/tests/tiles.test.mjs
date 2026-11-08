import test from 'node:test';
import assert from 'node:assert/strict';
import { labelsFor, rowLabels, tileTone, isWide } from '../js/tiles.js';

test('labels follow the header cells, honouring colspan', () => {
  assert.deepEqual(labelsFor([{ text: 'Symbol', span: 1 }, { text: ' Price ', span: 1 }, { text: 'Range', span: 2 }]), ['Symbol', 'Price', 'Range', 'Range']);
  assert.deepEqual(labelsFor([]), []);
  assert.deepEqual(labelsFor([{ text: '', span: 1 }, { text: null }]), ['', '']);
});

test('a cell spanning columns takes the label of its first column; extra cells get no label', () => {
  const labels = ['Symbol', 'Qty', 'P&L'];
  assert.deepEqual(rowLabels(labels, [{ span: 1 }, { span: 2 }]), ['Symbol', 'Qty']);
  assert.deepEqual(rowLabels(labels, [{ span: 3 }]), ['Symbol']);
  assert.deepEqual(rowLabels(labels, [{}, {}, {}, {}]), ['Symbol', 'Qty', 'P&L', '']);
});

test('profit and loss cells give the tile its tone; other cells never do', () => {
  assert.equal(tileTone('P&L', '+1,234.50'), 'up');
  assert.equal(tileTone('Unreal P&L', '₹-60.00'), 'down');
  assert.equal(tileTone('PNL', '-₹500'), 'down');
  assert.equal(tileTone('Chg', '0.00'), null);
  assert.equal(tileTone('P&L', '--'), null);
  assert.equal(tileTone('P&L', ''), null);
  assert.equal(tileTone('Price', '-5'), null);
  assert.equal(tileTone('Qty', '+5'), null);
  assert.equal(tileTone(undefined, '+5'), null);
});

test('long values get two columns, short ones one', () => {
  assert.equal(isWide('TATASTEEL23NOV26180CE'), true);
  assert.equal(isWide('NIFTY'), false);
  assert.equal(isWide('Auto square-off 15:15'), false);
  assert.equal(isWide('confidence 75% is below 85% for entry'), true);
  assert.equal(isWide(''), false);
  assert.equal(isWide(null), false);
});
