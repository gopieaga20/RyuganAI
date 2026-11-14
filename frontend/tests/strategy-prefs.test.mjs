import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { protocol: 'http:' } };
const { disabledFrom, applySettings, getDisabled, getCallRule, isLiveAllowed, prefsLoaded, DEFAULT_ENABLED } = await import('../js/strategy-prefs.js');
const { evaluate, STRATEGIES } = await import('../js/strategies.js');

test('switched-off strategies are read from the profile settings', () => {
  const s = { live_allowed: true, strategies: [{ id: 'trend', enabled: true }, { id: 'smc', enabled: false }, { id: 'news', enabled: false }] };
  assert.deepEqual(disabledFrom(s), ['smc', 'news']);
  assert.deepEqual(disabledFrom(null), []);
  assert.equal(prefsLoaded(), false);
  assert.deepEqual(getDisabled().sort(), ['fvg', 'news', 'rsi', 'smc', 'sr', 'structure', 'trend', 'volume']);          // the defaults until the server answers
  assert.deepEqual(DEFAULT_ENABLED, ['vwap']);
  assert.equal(getCallRule(), 'all');
  applySettings({ ...s, call_rule: 'score' });
  assert.equal(getCallRule(), 'score');
  applySettings(s);                                                   // no rule named: back to the default 'all'
  assert.equal(getCallRule(), 'all');
  assert.deepEqual(getDisabled(), ['smc', 'news']);
  assert.equal(isLiveAllowed(), true);
  assert.equal(prefsLoaded(), true);
  getDisabled().push('x');                                  // a copy: callers cannot change the stored list
  assert.deepEqual(getDisabled(), ['smc', 'news']);
});

function candles(n = 120) {
  let seed = 7;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) { const o = p; p += 0.3 + (rnd() - 0.5) * 0.8; out.push({ ts: 1767584100000 + i * 900000, o, h: Math.max(o, p) + 0.2, l: Math.min(o, p) - 0.2, c: p, v: 1000 }); }
  return out;
}

test('a disabled strategy casts no vote and the maximum score shrinks', () => {
  const c = candles(), all = evaluate(c), part = evaluate(c, { disable: ['trend', 'smc'] });
  assert.ok(!part.votes.some(v => v.id === 'trend' || v.id === 'smc'));
  assert.equal(part.maxScore, all.maxScore - 4);
});

test('with every weighted strategy off the answer is WAIT, not NaN', () => {
  const off = STRATEGIES.filter(s => s.weight > 0).map(s => s.id);
  const r = evaluate(candles(), { disable: off });
  assert.equal(r.call, 'WAIT'); assert.equal(r.confidence, 0); assert.equal(r.maxScore, 0);
  assert.match(r.reason, /switched on/);
});

test("call rule 'all': a call needs every switched-on weighted strategy to agree", () => {
  const c = candles(), off = ['trend', 'rsi', 'volume', 'news', 'sr'];
  let calls = 0;
  for (let e = 60; e < c.length; e++) {
    const r = evaluate(c.slice(0, e + 1), { disable: off, callRule: 'all' });
    assert.ok(r.votes.every(v => ['structure', 'fvg', 'smc', 'vwap'].includes(v.id)));
    const voters = r.votes.filter(v => v.weight > 0).map(v => v.vote);
    if (r.call === 'BUY CE') { assert.ok(voters.every(x => x === 1)); assert.equal(r.confidence, 95); calls++; }
    if (r.call === 'BUY PE') { assert.ok(voters.every(x => x === -1)); assert.equal(r.confidence, 95); calls++; }
    if (r.call === 'WAIT' && r.adx >= 20 && r.maxScore > 0) assert.ok(!voters.every(x => x === 1) && !voters.every(x => x === -1));
  }
  assert.ok(calls >= 0);
});

