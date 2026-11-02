import { loadUniverse, precompute, runAll, dayOf } from './bt_lib.mjs';
// Is any result distinguishable from luck? Sum each calendar day's trades (they are correlated within a day), then t-test the daily totals.
const tstat = trades => {
  const by = {}; for (const t of trades) (by[dayOf(t.ts)] ||= []).push(t.bps);
  const d = Object.values(by).map(a => a.reduce((x, y) => x + y, 0) / a.length);   // average bps per trade, per day
  const m = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1));
  return { days: d.length, mean: m, t: m / (sd / Math.sqrt(d.length)) };
};
for (const tf of ['15m', '30m']) {
  const U = await loadUniverse(tf); for (const u of U) u.pre = precompute(u.candles);
  const show = (name, cfg) => { const r = runAll(U, cfg), t = tstat(r.trades); console.log(`${tf} ${name.padEnd(30)} n=${String(r.all.n).padStart(4)} net=${r.all.exp.toFixed(2).padStart(6)}bps  daily-mean=${t.mean.toFixed(2).padStart(6)}  t=${t.t.toFixed(2).padStart(5)} (|t|>2 needed)  train ${r.train.exp.toFixed(1)} test ${r.test.exp.toFixed(1)}`); };
  show('as built', {});
  show('contrarian, SL1.5/T2', { invert: true });
  show('contrarian, hold to EOD', { invert: true, slAtr: 99, tpAtr: 99 });
  show('contrarian, SL3/T3', { invert: true, slAtr: 3, tpAtr: 3 });
  show('contrarian, hold, score>=4', { invert: true, slAtr: 99, tpAtr: 99, callScore: 4 });
  show('contrarian, hold, adx>=30', { invert: true, slAtr: 99, tpAtr: 99, minAdx: 30 });
}
