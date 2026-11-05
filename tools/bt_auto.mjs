// Backtest of the AUTO PAPER-TRADER rules on 2 years of 15-minute Angel candles (14 symbols; Sensex has no NSE options).
//
// Rules simulated (as configured in backend/autotrader.py):
//   * a BUY CE / BUY PE call needs confidence >= 85% -> with no news and no 5-minute data here that is a vote score of
//     7 of 8 (strict) or 6 of 8 (optimistic: assumes the 5-minute chart always agrees, which adds +5 confidence);
//   * ADX >= 20; entries only 09:30-14:30 IST; filled at the next candle's open;
//   * max 5 positions open at once, one per underlying;
//   * the option is bought and held until its stop (-30% of premium) or target (+50%) is hit. There is NO end-of-day exit.
//
// THE OPTION PRICE IS A MODEL, not real data (no historical option candles exist for expired contracts): an ATM option
// with delta 0.5 that loses `theta` of its premium per calendar day, premium = X% of the spot. Results are shown for a few
// settings, including a no-decay best case, so the conclusion does not hang on one guess.
// Each trade is sized to Rs 10,000 of premium and pays the full options charges (brokerage, STT, exchange, GST, stamp).
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

const SLP = 0.30, TPP = 0.50, MAXPOS = 5, DELTA = 0.5;

function candidates(minScore) {
  const out = [];
  for (const u of U) {
    const meta = u.candles.map(c => istParts(c.ts));
    for (let i = 60; i < u.candles.length - 1; i++) {
      const r = u.pre[i]; if (!r || r.adx < 20) continue;
      let sc = 0; for (const v of r.votes) sc += v.vote * v.weight;
      const dir = sc >= minScore ? 1 : sc <= -minScore ? -1 : 0;
      if (!dir) continue;
      const m = meta[i];
      if (m.min < 9 * 60 + 30 || m.min > 14 * 60 + 30) continue;
      if (meta[i + 1].day !== m.day) continue;                    // the next candle must be the same session
      out.push({ u, i, dir, ts: u.candles[i + 1].ts, score: Math.abs(sc) });
    }
  }
  return out.sort((a, b) => a.ts - b.ts || b.score - a.score);
}

/** Walk one option position forward from the entry candle; returns {exitTs, retPct (before charges), why}. */
function runOption(c, k, P) {
  const u = c.u, cs = u.candles, e = cs[c.i + 1].o, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem);
  const theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife;
  const entryTs = cs[c.i + 1].ts;
  for (let j = c.i + 1; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - entryTs) / 86400000, decay = theta * days * p0;
    const fav = c.dir > 0 ? b.h - e : e - b.l, adv = c.dir > 0 ? b.l - e : e - b.h;
    const vAdv = p0 + DELTA * adv - decay, vFav = p0 + DELTA * fav - decay;
    if (vAdv <= p0 * (1 - SLP)) return { exitTs: b.ts, ret: -SLP, why: 'SL' };                 // stop first when both are touched
    if (vFav >= p0 * (1 + TPP)) return { exitTs: b.ts, ret: TPP, why: 'TP' };
    if (days >= life) { const mv = c.dir > 0 ? b.c - e : e - b.c; return { exitTs: b.ts, ret: Math.max(0, DELTA * mv + 0 * p0) / p0 - 1, why: 'EXPIRY' }; }
  }
  const b = cs[cs.length - 1], days = (b.ts - entryTs) / 86400000, mv = c.dir > 0 ? b.c - e : e - b.c;
  return { exitTs: b.ts, ret: Math.max(0, p0 + DELTA * mv - theta * days * p0) / p0 - 1, why: 'END' };
}

function simulate(minScore, P) {
  const open = [];                                   // accepted trades still holding: {entryTs, exitTs, sym}
  const trades = [];
  for (const c of candidates(minScore)) {
    const t = c.ts;
    for (let q = open.length - 1; q >= 0; q--) if (open[q].exitTs <= t) open.splice(q, 1);
    if (open.length >= MAXPOS || open.some(o => o.sym === c.u.sym)) continue;
    const r = runOption(c, 0, P);
    open.push({ exitTs: r.exitTs, sym: c.u.sym });
    const prem = 10000, qty = 1, ent = prem, ext = prem * (1 + r.ret);
    const chg = Indicators.charges(ent, ext, qty, 'options');
    trades.push({ ts: t, sym: c.u.sym, dir: c.dir, why: r.why, hold: (r.exitTs - t) / 86400000, net: ext - ent - chg, ret: r.ret, chg });
  }
  return trades;
}

const IST_DAY = ts => new Date(ts + 19800000).toISOString().slice(0, 10);
function summary(trades) {
  const n = trades.length, net = trades.reduce((a, t) => a + t.net, 0), w = trades.filter(t => t.net > 0);
  const gw = w.reduce((a, t) => a + t.net, 0), gl = Math.abs(trades.filter(t => t.net <= 0).reduce((a, t) => a + t.net, 0));
  let eq = 0, pk = 0, dd = 0; for (const t of [...trades].sort((a, b) => a.ts - b.ts)) { eq += t.net; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const half = trades.length ? trades[Math.floor(trades.length * 0.6)].ts : 0;
  const m = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  const why = {}; trades.forEach(t => { why[t.why] = (why[t.why] || 0) + 1; });
  return { n, net, avg: n ? net / n : 0, wr: n ? w.length / n * 100 : 0, pf: gl ? gw / gl : 0, dd, hold: n ? trades.reduce((a, t) => a + t.hold, 0) / n : 0,
    chg: n ? trades.reduce((a, t) => a + t.chg, 0) / n : 0, first: m(trades.filter(t => t.ts < half)), last: m(trades.filter(t => t.ts >= half)), why };
}

const SCEN = {
  'model A (realistic decay)': { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20 },
  'model B (slower decay)': { idxPrem: 0.0055, idxTheta: 0.04, idxLife: 4, stkPrem: 0.02, stkTheta: 0.02, stkLife: 20 },
  'best case: NO time decay': { idxPrem: 0.0055, idxTheta: 0.0, idxLife: 1e9, stkPrem: 0.02, stkTheta: 0.0, stkLife: 1e9 },
};
const days = new Set(U.flatMap(u => u.candles.map(c => IST_DAY(c.ts))));
console.log(`${U.length} symbols, ${days.size} trading days. Per trade: Rs 10,000 of premium. P&L in Rs per trade, after full option charges.\n`);
for (const minScore of [7, 6]) {
  console.log(`=== calls with vote score >= ${minScore} of 8 (${minScore === 7 ? 'strict: confidence 89%' : 'optimistic: assumes the 5m chart agrees, confidence 89%'}) ===`);
  for (const [name, P] of Object.entries(SCEN)) {
    const s = summary(simulate(minScore, P));
    console.log(`${name.padEnd(28)} trades=${String(s.n).padStart(4)}  avg=${s.avg.toFixed(0).padStart(5)}  total=${Math.round(s.net).toString().padStart(8)}  win=${s.wr.toFixed(0)}%  pf=${s.pf.toFixed(2)}  maxDD=${Math.round(s.dd)}  held=${s.hold.toFixed(1)}d  charges/trade=${s.chg.toFixed(0)}  first60%=${s.first.toFixed(0)} last40%=${s.last.toFixed(0)}  exits=${JSON.stringify(s.why)}`);
  }
  console.log('');
}
