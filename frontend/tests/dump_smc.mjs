// Helper for backend/tests/test_strategy_parity.py: runs the JS LuxAlgo SMC port over the candles on stdin and prints everything it computed,
// so Python can check its port bar by bar (NaN is printed as null).
import fs from 'node:fs';
import { buildSmc } from '../js/smc.js';

const { candles } = JSON.parse(fs.readFileSync(0, 'utf8'));
const r = buildSmc(candles);
const nn = x => (Number.isFinite(x) ? x : null);
process.stdout.write(JSON.stringify({
  events: r.events, obs: r.obs, fvgs: r.fvgs, eqs: r.eqs,
  trailTop: [...r.trailTop].map(nn), trailBottom: [...r.trailBottom].map(nn),
  swingBias: [...r.swingBias], internalBias: [...r.internalBias], votes: [...r.votes],
}));
