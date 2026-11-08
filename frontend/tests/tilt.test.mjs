import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltFor } from '../js/tilt.js';

const rect = { left: 100, top: 100, width: 200, height: 100 };

test('the centre of a tile does not tilt', () => {
  assert.deepEqual(tiltFor(rect, 200, 150), { rx: 0, ry: 0 });
});

test('the tile leans toward the pointer, within the limit', () => {
  const right = tiltFor(rect, 300, 150);
  assert.ok(right.ry > 0 && right.ry <= 2.6 && right.rx === 0);
  const top = tiltFor(rect, 200, 100);
  assert.ok(top.rx > 0 && top.rx <= 2.6);
  const bottomLeft = tiltFor(rect, 100, 200);
  assert.ok(bottomLeft.rx < 0 && bottomLeft.ry < 0);
});

test('a pointer outside the tile or an empty tile never exceeds the limit or breaks', () => {
  const far = tiltFor(rect, 9999, -9999);
  assert.ok(Math.abs(far.rx) <= 2.6 && Math.abs(far.ry) <= 2.6);
  assert.deepEqual(tiltFor({ left: 0, top: 0, width: 0, height: 0 }, 5, 5), { rx: 0, ry: 0 });
  assert.deepEqual(tiltFor(null, 5, 5), { rx: 0, ry: 0 });
});
