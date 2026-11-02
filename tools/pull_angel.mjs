// Pull long 15-minute histories from Angel through the running backend and cache them for the backtests.
// Usage: node tools/pull_angel.mjs [days=730] [interval=15m]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
fs.mkdirSync(dir, { recursive: true });
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const days = +(process.argv[2] || 730), interval = process.argv[3] || '15m';
const SYMS = ['^NSEI', '^NSEBANK', '^BSESN', 'RELIANCE.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 'TCS.NS', 'SBIN.NS', 'TATASTEEL.NS', 'AXISBANK.NS', 'ITC.NS', 'LT.NS', 'BHARTIARTL.NS', 'MARUTI.NS'];

for (const sym of SYMS) {
  const file = path.join(dir, `ANGEL_${sym.replace(/[^A-Za-z0-9]/g, '_')}_${interval}_${days}d.json`);
  if (fs.existsSync(file)) { console.log(sym, 'cached'); continue; }
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/angel/historical?symbol=${encodeURIComponent(sym)}&interval=${interval}&days=${days}`);
    if (!r.ok) { console.log(sym, 'FAILED', r.status, (await r.text()).slice(0, 120)); continue; }
    const { candles } = await r.json();
    const rows = candles.map(c => ({ ts: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
    fs.writeFileSync(file, JSON.stringify(rows));
    const first = new Date(rows[0].ts).toISOString().slice(0, 10), last = new Date(rows[rows.length - 1].ts).toISOString().slice(0, 10);
    console.log(sym, rows.length, 'candles', first, '->', last, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) { console.log(sym, 'ERROR', e.message); }
}
console.log('done');
