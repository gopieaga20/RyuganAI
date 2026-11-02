import { loadUniverse, precompute, runAll } from './bt_lib.mjs';
for (const tf of ['5m', '15m', '30m']) {
  const U = await loadUniverse(tf); for (const u of U) u.pre = precompute(u.candles);
  const f = (n, r) => console.log(`${tf} ${n.padEnd(22)} n=${String(r.all.n).padStart(4)} gross=${r.all.gross.toFixed(2).padStart(6)}bps cost=${r.all.cost.toFixed(2)}bps net=${r.all.exp.toFixed(2).padStart(6)}bps pf=${r.all.pf.toFixed(2)} | train net ${r.train.exp.toFixed(1)} test net ${r.test.exp.toFixed(1)}`);
  f('as built', runAll(U, {}));
  f('INVERTED (contrarian)', runAll(U, { invert: true }));
  f('no stops, hold to EOD', runAll(U, { slAtr: 99, tpAtr: 99 }));
  f('inverted, hold to EOD', runAll(U, { slAtr: 99, tpAtr: 99, invert: true }));
}
