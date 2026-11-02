import { loadUniverse, precompute, runAll, dayOf, stats } from './bt_lib.mjs';
// Regime switch: each day, trade whichever of {follow the vote, fade the vote} did better over the previous N days
// (all instruments pooled). Only past days are used to choose, so there is no look-ahead.
const tstat = a => { const m = a.reduce((x, y) => x + y, 0) / a.length, sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); return m / (sd / Math.sqrt(a.length)); };
for (const tf of ['15m', '30m']) {
  const U = await loadUniverse(tf); for (const u of U) u.pre = precompute(u.candles);
  for (const [label, cfg] of [['SL1.5/T2', {}], ['hold to EOD', { slAtr: 99, tpAtr: 99 }]]) {
    const A = runAll(U, cfg).trades, B = runAll(U, { ...cfg, invert: true }).trades;
    const days = [...new Set([...A, ...B].map(t => dayOf(t.ts)))].sort();
    const perDay = (T, d) => { const x = T.filter(t => dayOf(t.ts) === d); return x.length ? x.reduce((s, t) => s + t.bps, 0) / x.length : 0; };
    for (const N of [3, 5, 10]) {
      const picked = [], dayRet = [];
      days.forEach((d, k) => {
        if (k < N) return;
        const prev = days.slice(k - N, k);
        const a = prev.reduce((s, p) => s + perDay(A, p), 0), b = prev.reduce((s, p) => s + perDay(B, p), 0);
        const T = (b > a ? B : A).filter(t => dayOf(t.ts) === d);
        picked.push(...T); if (T.length) dayRet.push(T.reduce((s, t) => s + t.bps, 0) / T.length);
      });
      const half = Math.floor(dayRet.length * 0.6), s = stats(picked);
      const m = x => (x.reduce((p, q) => p + q, 0) / x.length).toFixed(1);
      console.log(`${tf} ${label.padEnd(11)} lookback ${String(N).padStart(2)}d: n=${String(s.n).padStart(4)} net=${s.exp.toFixed(2).padStart(6)}bps pf=${s.pf.toFixed(2)} t=${tstat(dayRet).toFixed(2).padStart(5)}  first-60% days ${m(dayRet.slice(0, half))}  last-40% ${m(dayRet.slice(half))}`);
    }
    console.log(`${tf} ${label.padEnd(11)} (reference, always follow: ${stats(A).exp.toFixed(1)}; always fade: ${stats(B).exp.toFixed(1)})`);
  }
}
