// Does portfolio-level risk control reduce the damage of days like "five stops in one day"?
// Same data and option model as bt_auto.mjs (2 years of 15-minute candles, 14 symbols, modelled option prices), with the rules the
// auto paper-trader uses today (stop -30%, target +30%, max 5 open, one per underlying, entries 09:30-14:30). Variants add ONE kind of
// portfolio rule at a time. The question is not "is there an edge" (earlier tests say the entry signal has none) but "do these rules
// cut the worst days and the drawdown without just removing winners".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Indicators } from '../frontend/js/indicators.js';
import { istParts } from '../frontend/js/candles.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const INDEX = new Set(['_NSEI', '_NSEBANK']);
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json') && !f.includes('BSESN'));
const U = files.map(f => {
  const sym = f.replace('ANGEL_', '').replace('_15m_730d.json', '');
  return { sym, isIndex: INDEX.has(sym), candles: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), pre: JSON.parse(fs.readFileSync(path.join(dir, 'pre_' + f), 'utf8')) };
});
const NIFTY = U.find(u => u.sym === '_NSEI');
const niftyScore = new Map();                                    // candle ts -> signed vote score of Nifty at that candle
NIFTY.candles.forEach((c, i) => { const r = NIFTY.pre[i]; if (r) niftyScore.set(c.ts, r.votes.reduce((a, v) => a + v.vote * v.weight, 0)); });

const SLP = 0.30, TPP = 0.30, MAXPOS = 5, DELTA = 0.5;
const dayOf = ts => new Date(ts + 19800000).toISOString().slice(0, 10);

function candidates(minScore, o) {
  const out = [];
  for (const u of U) {
    const meta = u.candles.map(c => istParts(c.ts));
    for (let i = 60; i < u.candles.length - 1; i++) {
      const r = u.pre[i]; if (!r || r.adx < (o.minAdx || 20)) continue;
      let sc = 0; for (const v of r.votes) sc += v.vote * v.weight;
      const dir = sc >= minScore ? 1 : sc <= -minScore ? -1 : 0;
      if (!dir) continue;
      const m = meta[i];
      if (m.min < (o.from || 9 * 60 + 30) || m.min > 14 * 60 + 30) continue;
      if (meta[i + 1].day !== m.day) continue;
      if (o.alignNifty && !u.isIndex) {                            // a stock call must not fight the Nifty's own 15-minute vote
        const ns = niftyScore.get(u.candles[i].ts); if (ns === undefined || ns * dir < o.alignNifty) continue;
      }
      out.push({ u, i, dir, ts: u.candles[i + 1].ts, score: Math.abs(sc) });
    }
  }
  return out.sort((a, b) => a.ts - b.ts || b.score - a.score);
}

function runOption(c, P, slp = SLP) {
  const u = c.u, cs = u.candles, e = cs[c.i + 1].o, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem);
  const theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife, entryTs = cs[c.i + 1].ts;
  for (let j = c.i + 1; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - entryTs) / 86400000, decay = theta * days * p0;
    const fav = c.dir > 0 ? b.h - e : e - b.l, adv = c.dir > 0 ? b.l - e : e - b.h;
    if (p0 + DELTA * adv - decay <= p0 * (1 - slp)) return { exitTs: b.ts, ret: -slp, why: 'SL' };
    if (p0 + DELTA * fav - decay >= p0 * (1 + TPP)) return { exitTs: b.ts, ret: TPP, why: 'TP' };
    if (days >= life) { const mv = c.dir > 0 ? b.c - e : e - b.c; return { exitTs: b.ts, ret: Math.max(0, DELTA * mv) / p0 - 1, why: 'EXPIRY' }; }
  }
  const b = cs[cs.length - 1], days = (b.ts - entryTs) / 86400000, mv = c.dir > 0 ? b.c - e : e - b.c;
  return { exitTs: b.ts, ret: Math.max(0, p0 + DELTA * mv - theta * days * p0) / p0 - 1, why: 'END' };
}

function simulate(minScore, P, o = {}) {
  const open = [], trades = [], stopsByDay = new Map();
  for (const c of candidates(minScore, o)) {
    const t = c.ts;
    for (let q = open.length - 1; q >= 0; q--) if (open[q].exitTs <= t) open.splice(q, 1);
    if (open.length >= (o.maxPos || MAXPOS) || open.some(x => x.sym === c.u.sym)) continue;
    if (o.sameDir && open.filter(x => x.dir === c.dir).length >= o.sameDir) continue;       // at most K open positions betting the same way
    if (o.dayStops) {                                                                         // circuit breaker: N stop-outs today -> no new entries today
      const hit = [...stopsByDay.entries()].filter(([d]) => d === dayOf(t))[0]; const n = hit ? hit[1].filter(x => x <= t).length : 0;
      if (n >= o.dayStops) continue;
    }
    if (o.cooldownH && trades.some(x => x.sym === c.u.sym && x.why === 'SL' && t - x.exitTs < o.cooldownH * 3600000)) continue;   // no re-entry soon after a stop
    const r = runOption(c, P, o.slp || SLP);
    open.push({ exitTs: r.exitTs, sym: c.u.sym, dir: c.dir });
    if (r.why === 'SL') { const d = dayOf(r.exitTs); if (!stopsByDay.has(d)) stopsByDay.set(d, []); stopsByDay.get(d).push(r.exitTs); }
    const ent = 10000, ext = ent * (1 + r.ret), chg = Indicators.charges(ent, ext, 1, 'options');
    trades.push({ ts: t, exitTs: r.exitTs, sym: c.u.sym, dir: c.dir, why: r.why, net: ext - ent - chg });
  }
  return trades;
}

function stats(trades) {
  const n = trades.length, net = trades.reduce((a, t) => a + t.net, 0), w = trades.filter(t => t.net > 0);
  const gw = w.reduce((a, t) => a + t.net, 0), gl = Math.abs(trades.filter(t => t.net <= 0).reduce((a, t) => a + t.net, 0));
  const byDay = new Map(); trades.forEach(t => byDay.set(dayOf(t.exitTs), (byDay.get(dayOf(t.exitTs)) || 0) + t.net));
  const days = [...byDay.values()].sort((a, b) => a - b);
  let eq = 0, pk = 0, dd = 0; for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) { eq += t.net; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const cut = trades.length ? trades[Math.floor(trades.length * 0.6)].ts : 0;
  const m = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  return { n, net, avg: n ? net / n : 0, wr: n ? w.length / n * 100 : 0, pf: gl ? gw / gl : 0, dd, worst: days[0] || 0, worst5: days.slice(0, 5).reduce((a, b) => a + b, 0), first: m(trades.filter(t => t.ts < cut)), last: m(trades.filter(t => t.ts >= cut)) };
}

const SCEN = {
  'model A (realistic decay)': { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20 },
  'best case: NO decay': { idxPrem: 0.0055, idxTheta: 0.0, idxLife: 1e9, stkPrem: 0.02, stkTheta: 0.0, stkLife: 1e9 },
};
const VARIANTS = {
  'today: 5 open, one per stock': {},
  'max 2 open the same way': { sameDir: 2 },
  'max 1 open the same way': { sameDir: 1 },
  'stock call must agree with Nifty': { alignNifty: 2 },
  'stop trading after 2 stops a day': { dayStops: 2 },
  'stop trading after 1 stop a day': { dayStops: 1 },
  'no re-entry 24h after a stop': { cooldownH: 24 },
  'no entries before 10:15': { from: 10 * 60 + 15 },
  'min ADX 25': { minAdx: 25 },
  'same-way cap 2 + 2 stops/day': { sameDir: 2, dayStops: 2 },
  'same-way cap 2 + Nifty + 2 stops/day': { sameDir: 2, alignNifty: 2, dayStops: 2 },
  'tighter stop 20%': { slp: 0.20 },
  'WHAT WAS BUILT: cap 2 + Nifty + 2 stops/day + from 10:15': { sameDir: 2, alignNifty: 2, dayStops: 2, from: 10 * 60 + 15 },
};
const f = (x, w) => String(Math.round(x)).padStart(w);
for (const minScore of [7, 6]) {
  for (const [sn, P] of Object.entries(SCEN)) {
    console.log(`\n=== score >= ${minScore} | ${sn} | Rs 10,000 premium per trade, after charges ===`);
    console.log('variant'.padEnd(40), ' trades  avg/trade  total   win%  pf    maxDD   worstDay  worst5days  first60%  last40%');
    for (const [vn, o] of Object.entries(VARIANTS)) {
      const s = stats(simulate(minScore, P, o));
      console.log(vn.padEnd(40), f(s.n, 6), f(s.avg, 9), f(s.net, 8), f(s.wr, 6), s.pf.toFixed(2).padStart(5), f(s.dd, 8), f(s.worst, 9), f(s.worst5, 11), f(s.first, 9), f(s.last, 8));
    }
  }
}
