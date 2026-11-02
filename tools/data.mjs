// Candle loader for headless backtests: pulls from the local server's Yahoo proxy and caches to tools/.cache.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const BASE = process.env.BASE || 'http://127.0.0.1:8000';

export async function load(sym, interval, range) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${sym.replace(/[^A-Za-z0-9]/g, '_')}_${interval}_${range}.json`);
  let rows;
  if (fs.existsSync(f)) rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    const r = await fetch(`${BASE}/api/yahoo-chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`);
    if (!r.ok) throw new Error(`${sym} ${interval}: HTTP ${r.status}`);
    const res = (await r.json()).chart?.result?.[0];
    if (!res) throw new Error(`${sym} ${interval}: no data`);
    const q = res.indicators.quote[0];
    rows = res.timestamp.map((t, i) => ({ ts: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }))
      .filter(d => d.c != null && d.o != null && d.h != null && d.l != null);
    fs.writeFileSync(f, JSON.stringify(rows));
  }
  return rows.map(d => ({ ...d, date: new Date(d.ts) }));
}
