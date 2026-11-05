// Does restricting to the strongest calls (what the auto-trader does: confidence >= 85%) change the result?
// Confidence = 50 + 45*|score|/8 (no news history here): score 7 -> 89, score 6 -> 84 (+5 when the 5m chart agrees -> 89).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll, dayOf } from './bt_lib.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json'));
const U = files.map(f => ({ sym: f, segment: 'intraday', candles: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map(c => ({ ...c, date: new Date(c.ts) })), pre: JSON.parse(fs.readFileSync(path.join(dir, 'pre_' + f), 'utf8')) }));
const tstat = trades => { const by = {}; for (const t of trades) (by[dayOf(t.ts)] ||= []).push(t.bps); const d = Object.values(by).map(a => a.reduce((x, y) => x + y, 0) / a.length); const m = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1)); return m / (sd / Math.sqrt(d.length)); };
for (const [name, cfg] of [['all calls (score>=3)', {}], ['score >= 6', { callScore: 6 }], ['score >= 7', { callScore: 7 }], ['score >= 6, SL1.5/T2, one trade a day', { callScore: 6, maxPerDay: 1 }]]) {
  const r = runAll(U, cfg);
  console.log(name.padEnd(40), `n=${String(r.all.n).padStart(5)} net=${r.all.exp.toFixed(2).padStart(6)}bps gross=${r.all.gross.toFixed(2).padStart(6)} pf=${r.all.pf.toFixed(2)} wr=${r.all.wr.toFixed(0)}% t=${tstat(r.trades).toFixed(2)} | train ${r.train.exp.toFixed(1)} test ${r.test.exp.toFixed(1)}`);
}
