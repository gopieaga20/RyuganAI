import { loadUniverse, precompute, runAll } from './bt_lib.mjs';

const tf = process.argv[2] || '15m';
const U = await loadUniverse(tf);
for (const u of U) u.pre = precompute(u.candles);

const IDS = ['trend', 'rsi', 'vwap', 'structure', 'fvg', 'volume'];
const rows = [];
const add = (name, cfg) => { const r = runAll(U, cfg); rows.push({ name, ...r }); };

add('baseline', {});
for (const id of IDS) add(`drop ${id}`, { disable: [id] });
for (const callScore of [2, 3, 4, 5, 6]) for (const minAdx of [15, 20, 25, 30, 35]) add(`score>=${callScore} adx>=${minAdx}`, { callScore, minAdx });
for (const [sl, tp] of [[1, 1.5], [1, 2], [1.5, 1.5], [1.5, 3], [2, 2], [2, 3], [2, 4], [3, 3], [1.5, 4]]) add(`sl ${sl} tp ${tp}`, { slAtr: sl, tpAtr: tp });
for (const skip of [15, 30, 60]) add(`skip first ${skip}m`, { skipOpenMin: skip });
for (const cut of [11 * 60, 12 * 60 + 30, 13 * 60 + 30]) add(`no entry after ${Math.floor(cut / 60)}:${String(cut % 60).padStart(2, '0')}`, { cutoffMin: cut });
add('long only', { dirFilter: 'LONG' }); add('short only', { dirFilter: 'SHORT' });
add('max 1 trade/day', { maxPerDay: 1 }); add('max 2 trades/day', { maxPerDay: 2 });
add('flip exit', { flipExit: true });

const f = s => `n=${String(s.n).padStart(4)} exp=${s.exp.toFixed(1).padStart(6)} pf=${s.pf.toFixed(2)} wr=${s.wr.toFixed(0).padStart(2)}%`;
const show = list => { for (const r of list) console.log(r.name.padEnd(28), '| all', f(r.all), '| train', f(r.train), '| test', f(r.test)); };
console.log(`tf=${tf}  instruments=${U.length}  (bps of notional per trade, after charges+slippage)`);
console.log('\n-- baseline + single changes');
show(rows.filter(r => !r.name.startsWith('score>=')));
const grid = rows.filter(r => r.name.startsWith('score>=') && r.all.n >= 150);
grid.sort((a, b) => Math.min(b.train.exp, b.test.exp) - Math.min(a.train.exp, a.test.exp));
console.log('\n-- score/ADX grid, best 8 by the worse of train/test (n>=150)');
show(grid.slice(0, 8));
