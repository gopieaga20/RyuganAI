// A short, fixed list of classic intraday hypotheses, tested once on 2 years of 15-minute Angel candles
// (15 instruments). The list is deliberately small (7 ideas, fixed parameters) so a lucky result is unlikely
// to be mistaken for an edge: with 7 tests a result needs |t| > ~2.7 to count (Bonferroni at 5%).
// One trade per instrument per day. Entry at a bar's open (+slippage), flat at the 15:15 bar's open. Real charges.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Indicators } from '../frontend/js/indicators.js';
import { istParts } from '../frontend/js/candles.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const SLIP = 0.0001;
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json'));

function groupDays(candles) {
  const days = []; let cur = null;
  for (const c of candles) {
    const m = istParts(c.ts);
    if (!cur || cur.day !== m.day) { cur = { day: m.day, bars: [] }; days.push(cur); }
    cur.bars.push({ ...c, min: m.min });
  }
  return days.filter(d => d.bars.length >= 20 && d.bars[0].min <= 9 * 60 + 20);       // full sessions only
}

function trade(dir, entry, exit, segment) {
  const e = dir > 0 ? entry * (1 + SLIP) : entry * (1 - SLIP), x = dir > 0 ? exit * (1 - SLIP) : exit * (1 + SLIP);
  const qty = Math.max(1, Math.round(1e6 / e));
  const gross = (dir > 0 ? x - e : e - x) * qty;
  const chg = Indicators.charges(e, x, qty, segment);
  return { bps: (gross - chg) / qty / e * 1e4, gbps: gross / qty / e * 1e4 };
}
const eodIndex = d => { const i = d.bars.findIndex(b => b.min >= 15 * 60 + 15); return i < 0 ? d.bars.length - 1 : i; };
const eodPx = d => { const i = eodIndex(d); return d.bars[i].min >= 15 * 60 + 15 ? d.bars[i].o : d.bars[i].c; };

const IDEAS = {
  // each returns {dir, entryIdx, exitPx?} or null for the day. `ctx` = {prevClose, dAtr} from earlier days only.
  'long every day (drift)': (d, ctx) => ({ dir: 1, i: 0 }),
  'short every day (drift)': (d, ctx) => ({ dir: -1, i: 0 }),
  'first-30m momentum': (d, ctx) => {
    const mv = d.bars[1].c - d.bars[0].o; if (Math.abs(mv) < 0.25 * ctx.dAtr) return null; return { dir: mv > 0 ? 1 : -1, i: 2 };
  },
  'first-30m fade': (d, ctx) => {
    const mv = d.bars[1].c - d.bars[0].o; if (Math.abs(mv) < 0.25 * ctx.dAtr) return null; return { dir: mv > 0 ? -1 : 1, i: 2 };
  },
  'opening-range breakout': (d, ctx) => {
    const hi = Math.max(d.bars[0].h, d.bars[1].h), lo = Math.min(d.bars[0].l, d.bars[1].l);
    for (let i = 2; i < d.bars.length - 1; i++) {
      if (d.bars[i].min > 13 * 60 + 30) return null;
      if (d.bars[i].c > hi) return { dir: 1, i: i + 1, sl: lo }; if (d.bars[i].c < lo) return { dir: -1, i: i + 1, sl: hi };
    } return null;
  },
  'gap continuation': (d, ctx) => {
    const g = d.bars[0].o - ctx.prevClose; if (Math.abs(g) < 0.4 * ctx.dAtr) return null; return { dir: g > 0 ? 1 : -1, i: 0 };
  },
  'gap fade': (d, ctx) => {
    const g = d.bars[0].o - ctx.prevClose; if (Math.abs(g) < 0.4 * ctx.dAtr) return null; return { dir: g > 0 ? -1 : 1, i: 0 };
  },
};

const results = {}; for (const k of Object.keys(IDEAS)) results[k] = [];
for (const f of files) {
  const sym = f.replace('ANGEL_', '').replace('_15m_730d.json', '');
  const segment = /NSE|BSE/.test(sym) && sym.startsWith('_') ? 'futures' : 'intraday';
  const days = groupDays(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  for (let k = 15; k < days.length; k++) {
    const prev = days.slice(k - 14, k);
    const ctx = { prevClose: days[k - 1].bars.at(-1).c, dAtr: prev.reduce((a, p) => a + (Math.max(...p.bars.map(b => b.h)) - Math.min(...p.bars.map(b => b.l))), 0) / prev.length };
    const d = days[k];
    for (const [name, fn] of Object.entries(IDEAS)) {
      const s = fn(d, ctx); if (!s) continue;
      const entry = d.bars[s.i]?.o; if (!entry) continue;
      let exit = eodPx(d);
      if (s.sl != null) {                                          // protective stop for the breakout idea
        for (let j = s.i; j <= eodIndex(d); j++) {
          const b = d.bars[j];
          if (s.dir > 0 ? b.l <= s.sl : b.h >= s.sl) { exit = s.dir > 0 ? Math.min(b.o, s.sl) : Math.max(b.o, s.sl); break; }
        }
      }
      results[name].push({ day: d.day, sym, ...trade(s.dir, entry, exit, segment) });
    }
  }
}

const tstat = arr => { const by = {}; for (const t of arr) (by[t.day] ||= []).push(t.bps); const v = Object.values(by).map(a => a.reduce((x, y) => x + y, 0) / a.length); const m = v.reduce((x, y) => x + y, 0) / v.length, sd = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / (v.length - 1)); return m / (sd / Math.sqrt(v.length)); };
const mean = (a, k) => a.length ? a.reduce((x, t) => x + t[k], 0) / a.length : 0;
const alldays = [...new Set(Object.values(results).flat().map(t => t.day))].sort(); const cut = alldays[Math.floor(alldays.length * 0.6)];
console.log('idea'.padEnd(26), '  trades   gross   net(bps)  t-stat |  first 60%   last 40%');
for (const [name, tr] of Object.entries(results)) {
  const a = tr.filter(t => t.day < cut), b = tr.filter(t => t.day >= cut);
  console.log(name.padEnd(26), String(tr.length).padStart(7), mean(tr, 'gbps').toFixed(2).padStart(8), mean(tr, 'bps').toFixed(2).padStart(9), tstat(tr).toFixed(2).padStart(8), '|', mean(a, 'bps').toFixed(2).padStart(9), mean(b, 'bps').toFixed(2).padStart(10));
}
