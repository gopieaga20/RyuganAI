import { loadUniverse, precompute, runAll } from './bt_lib.mjs';

const tf = process.argv[2] || '15m';
const t0 = Date.now();
const U = await loadUniverse(tf);
for (const u of U) u.pre = precompute(u.candles);
console.log(`${tf}: ${U.length} instruments, evaluated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const f = s => `n=${String(s.n).padStart(4)} exp=${s.exp.toFixed(1).padStart(6)}bps pf=${s.pf.toFixed(2)} wr=${s.wr.toFixed(0)}%`;
const r = runAll(U, {});
console.log('BASELINE (score>=3, ADX>=20, SL 1.5 ATR, T1 2 ATR)');
console.log('  all  ', f(r.all)); console.log('  train', f(r.train)); console.log('  test ', f(r.test));
console.log('per instrument:'); for (const [s, st] of Object.entries(r.perSym)) console.log('  ', s.padEnd(14), f(st));
