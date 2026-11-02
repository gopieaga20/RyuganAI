// Backtest the dashboard's vote on the long Angel 15-minute history (tools/pull_angel.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { precompute, runAll, dayOf, stats } from './bt_lib.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json'));
const U = [];
for (const f of files) {
  const sym = f.replace('ANGEL_', '').replace('_15m_730d.json', '');
  const candles = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map(c => ({ ...c, date: new Date(c.ts) }));
  const pf = path.join(dir, 'pre_' + f);
  let pre;
  if (fs.existsSync(pf) && fs.statSync(pf).mtimeMs > fs.statSync(path.join(dir, f)).mtimeMs) pre = JSON.parse(fs.readFileSync(pf, 'utf8'));
  else { pre = precompute(candles); fs.writeFileSync(pf, JSON.stringify(pre)); }
  U.push({ sym, segment: sym.startsWith('_NSE') ? 'futures' : 'intraday', candles, pre });
}
const days = new Set(U.flatMap(u => u.candles.map(c => dayOf(c.ts))));
console.log(`${U.length} instruments, ${days.size} trading days (${[...days].sort()[0]} -> ${[...days].sort().pop()}), ${U.reduce((a, u) => a + u.candles.length, 0)} candles`);

const tstat = trades => {
  const by = {}; for (const t of trades) (by[dayOf(t.ts)] ||= []).push(t.bps);
  const d = Object.values(by).map(a => a.reduce((x, y) => x + y, 0) / a.length);
  const m = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1));
  return m / (sd / Math.sqrt(d.length));
};
const f = s => `n=${String(s.n).padStart(5)} net=${s.exp.toFixed(2).padStart(6)}bps gross=${s.gross.toFixed(2).padStart(6)} pf=${s.pf.toFixed(2)} wr=${s.wr.toFixed(0)}%`;
const CFG = [['as built (follow)', {}], ['contrarian (fade)', { invert: true }], ['follow, hold to EOD', { slAtr: 99, tpAtr: 99 }], ['fade, hold to EOD', { invert: true, slAtr: 99, tpAtr: 99 }],
  ['follow, score>=4 adx>=25', { callScore: 4, minAdx: 25 }], ['fade, score>=4 adx>=25', { invert: true, callScore: 4, minAdx: 25 }], ['follow SL1/T2', { slAtr: 1, tpAtr: 2 }], ['follow SL2/T3', { slAtr: 2, tpAtr: 3 }]];
for (const [name, cfg] of CFG) {
  const r = runAll(U, cfg);
  console.log(name.padEnd(26), f(r.all), `t=${tstat(r.trades).toFixed(2)}`, `| train ${r.train.exp.toFixed(1)} test ${r.test.exp.toFixed(1)}`);
}
// calendar-quarter breakdown, to see whether results are stable or regime-dependent
const q = ts => { const d = new Date(ts + 19800000); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const A = runAll(U, {}).trades, B = runAll(U, { invert: true }).trades;
const quarters = [...new Set(A.map(t => q(t.ts)))].sort();
console.log('\nper calendar quarter (net bps/trade):  quarter   follow   fade');
for (const k of quarters) console.log('  ', k, `n=${String(A.filter(t => q(t.ts) === k).length).padStart(4)}`, stats(A.filter(t => q(t.ts) === k)).exp.toFixed(1).padStart(7), stats(B.filter(t => q(t.ts) === k)).exp.toFixed(1).padStart(7));
