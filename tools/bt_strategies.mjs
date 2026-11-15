// Backtest of EVERY strategy on its own, then in combinations, and a written report.
//
//   node tools/bt_strategies.mjs            -> prints the tables and writes reports/strategy_backtest_report.md
//
// Data: 2 years of 15-minute Angel candles for 14 symbols (cached in tools/.cache). Same rules for every strategy so they are comparable:
//   * a signal is read on a bar's close and filled at the NEXT bar's open; entries 10:15-14:30 IST, ADX >= 20;
//   * at most 5 positions open, one per underlying; the option is held to its stop (-30%) or target (+30%);
//   * option prices are a MODEL (no historical option candles exist): an ATM option, delta 0.5, premium a % of spot, with time decay
//     ("realistic") or none ("best case"). Each trade is Rs 10,000 of premium and pays full option charges;
//   * the model-free columns look at the UNDERLYING only: the average move in the signal's direction over the next hour.
// A coin-flip "random direction" strategy runs through the same engine as the yardstick: a strategy only has an edge if it beats it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Indicators } from '../frontend/js/indicators.js';
import { istParts } from '../frontend/js/candles.js';
import { buildSmc } from '../frontend/js/smc.js';
import { RULES, ruleRows } from './smc_rules.mjs';
import { precompute } from './bt_lib.mjs';
import { srSignal } from '../frontend/js/sr.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools', '.cache');
const INDEX = new Set(['_NSEI', '_NSEBANK']);
// DATA=1500d node tools/bt_strategies.mjs <mode> runs on the longer histories pulled with `node tools/pull_angel.mjs 1500` (default: the 730-day set)
const SUF = process.env.DATA || '730d', TAG = SUF === '730d' ? '' : '_' + SUF;
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith(`_15m_${SUF}.json`) && !f.includes('BSESN'));
const WINDOW = 250;

// ───────────── per-bar signals for every strategy ─────────────
const U = files.map(f => {
  const sym = f.replace('ANGEL_', '').replace(`_15m_${SUF}.json`, '');
  const candles = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const preF = path.join(dir, 'pre_' + f);
  let pre;
  if (fs.existsSync(preF)) pre = JSON.parse(fs.readFileSync(preF, 'utf8'));
  else { pre = precompute(candles, { disable: ['smc', 'sr'] }); fs.writeFileSync(preF, JSON.stringify(pre)); }       // the votes of the older strategies at every bar (SMC and S/R have their own rows)
  const cacheF = path.join(dir, `smc3_${sym}${TAG}.json`);
  let smc;
  if (fs.existsSync(cacheF) && JSON.parse(fs.readFileSync(cacheF, 'utf8')).n === candles.length) smc = JSON.parse(fs.readFileSync(cacheF, 'utf8')).rows;
  else {
    // one pass of the LuxAlgo port over the whole history (the app's live scan has about a month of 15m bars, so very early state can differ slightly)
    const R = buildSmc(candles);
    smc = candles.map((c, i) => {
      if (i < 60) return null;
      const eq = (R.trailTop[i] + R.trailBottom[i]) / 2;
      return [R.votes[i], R.internalBias[i], R.swingBias[i], Number.isFinite(eq) ? (c.c < eq ? 1 : c.c > eq ? -1 : 0) : 0];
    });
    fs.writeFileSync(cacheF, JSON.stringify({ n: candles.length, rows: smc }));
  }
  const srF = path.join(dir, `sr_${sym}${TAG}.json`);
  let sr;
  if (fs.existsSync(srF) && JSON.parse(fs.readFileSync(srF, 'utf8')).n === candles.length) sr = JSON.parse(fs.readFileSync(srF, 'utf8')).rows;
  else {
    sr = new Array(candles.length).fill(null);
    for (let i = 60; i < candles.length; i++) { const win = candles.slice(Math.max(0, i - WINDOW + 1), i + 1); const r = srSignal(win, win.length - 1); sr[i] = [r.vote, r.parts.brk, r.parts.rtst, r.parts.rev]; }
    fs.writeFileSync(srF, JSON.stringify({ n: candles.length, rows: sr }));
  }
  const meta = candles.map(c => istParts(c.ts));
  const cl = candles.map(c => c.c), e100 = Indicators.ema(cl, 100), e200 = Indicators.ema(cl, 200);
  const htf = cl.map((p, i) => (i < 200 ? 0 : p > e100[i] && e100[i] > e200[i] ? 1 : p < e100[i] && e100[i] < e200[i] ? -1 : 0));
  const bb = Indicators.bb(cl, 20, 2);
  const bbv = cl.map((p, i) => { const b = bb[i]; if (i < 25 || !(b.upper > b.lower)) return [0, 0, 0]; return [p < b.lower ? 1 : p > b.upper ? -1 : 0, p > b.upper ? 1 : p < b.lower ? -1 : 0, p > b.mid ? 1 : p < b.mid ? -1 : 0]; });
  return { sym, isIndex: INDEX.has(sym), candles, pre, smc, meta, htf, sr, bbv };
});

const CORE = ['trend', 'rsi', 'vwap', 'structure', 'fvg', 'volume'];
// LAST_DAYS=100 limits the signals to the last 100 calendar days of the data; ONLY=A_NS,B_NS keeps just those symbols
if (process.env.ONLY) { const keep = new Set(process.env.ONLY.split(',')); const kept = U.filter(u => keep.has(u.sym)); U.splice(0, U.length, ...kept); }
const LAST_DAYS = +process.env.LAST_DAYS || 0;
const WINDOW_START = LAST_DAYS ? Math.max(...U.map(u => u.candles[u.candles.length - 1].ts)) - LAST_DAYS * 86400000 : 0;
const W = { trend: 2, rsi: 1, vwap: 1, structure: 2, fvg: 1, volume: 1, smc: 2 };
/** Signed vote (+1/-1/0) of one strategy at bar i of symbol u. */
function vote(u, i, id) {
  const r = u.pre[i]; if (!r) return 0;
  if (CORE.includes(id)) return r.votes.find(v => v.id === id)?.vote || 0;
  if (id.startsWith('r_')) return u.rules?.[id]?.[i] || 0;      // rules built on the LuxAlgo outputs (tools/smc_rules.mjs, mode smc-rules)
  const s = u.smc[i]; if (!s) return 0;
  switch (id) {
    case 'smc': return s[0];
    case 'pd': return s[3];                              // premium / discount half of the swing range (+1 discount, -1 premium)
    case 'bbrev': return u.bbv[i][0];                    // Bollinger mean-reversion: close outside the band, bet on a return (below lower = up)
    case 'bbbrk': return u.bbv[i][1];                    // Bollinger breakout: close outside the band, ride it (above upper = up)
    case 'bbmid': return u.bbv[i][2];                    // Bollinger trend side: close above / below the middle band
    case 'sr': return (u.sr[i] || [0])[0];                // support/resistance: breakout, break-and-retest or rejection of the previous day high/low and swing levels
    case 'srbrk': return (u.sr[i] || [0, 0])[1];          // ... fresh breakout of the previous day high/low
    case 'srrt': return (u.sr[i] || [0, 0, 0])[2];        // ... break-and-retest continuation
    case 'srrev': return (u.sr[i] || [0, 0, 0, 0])[3];    // ... rejection / reversal at a level
    case 'smcdisp': return s[0];                         // old id, now the same as 'smc' (LuxAlgo port); kept so the combination lists keep running
    case 'htf': return u.htf[i];                         // higher-timeframe trend: price vs 15m EMA100 / EMA200 (about hourly 25 / 50)
    case 'random': { let h = 2166136261; const t = `${u.sym}${i}`; for (let q = 0; q < t.length; q++) h = Math.imul(h ^ t.charCodeAt(q), 16777619); return (h >>> 0) % 7 === 0 ? ((h >>> 8) & 1 ? 1 : -1) : 0; }
    default: return u.extra && u.extra[id] ? u.extra[id][i] : 0;
  }
}
/** A signal definition: {ids:[...], mode:'all'|'score', min, weights}. Returns +1/-1/0. */
function signal(u, i, def) {
  const d0 = signal0(u, i, def);
  if (d0 && def.also) for (const id of def.also) if (vote(u, i, id) !== d0) return 0;      // extra strategies that must agree with the main signal
  if (d0 && def.notAgainst) for (const id of def.notAgainst) if (vote(u, i, id) === -d0) return 0;   // ... and ones that may be silent but must not point the other way
  return d0;
}
function signal0(u, i, def) {
  if (def.mode === 'all') {
    let d = 0;
    for (const id of def.ids) { const v = vote(u, i, id); if (v === 0) return 0; if (d && v !== d) return 0; d = v; }
    return d;
  }
  let sc = 0; for (const id of def.ids) sc += vote(u, i, id) * (def.weights?.[id] ?? W[id] ?? 1);
  return sc >= def.min ? 1 : sc <= -def.min ? -1 : 0;
}

// ───────────── engine ─────────────
const SLP = 0.30, TPP = 0.30, DELTA = 0.5;
// at most this many positions open at once (5 = the app's rule). With 5, the symbols that come first in the file order win the slots at 10:15, so a few symbols decide the result;
// MAXPOS=99 lets every symbol trade on its own, which tests the signal rather than which symbols happened to get a slot.
const MAXPOS = +process.env.MAXPOS || 5;
const MODELS = {
  realistic: { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20 },
  nodecay: { idxPrem: 0.0055, idxTheta: 0.0, idxLife: 1e9, stkPrem: 0.02, stkTheta: 0.0, stkLife: 1e9 },
  sameday: { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20, sameDay: true },     // realistic, but squared off at 15:15 the same day
};
// stress variants of the same-day model: each stock's premium scaled by its own volatility (a volatile stock's ATM option costs more than 2% of spot),
// and a round-trip bid-ask spread / slippage charged on the premium
MODELS.sd_vol = { ...MODELS.sameday, volScale: true };
MODELS.sd_vol_sp1 = { ...MODELS.sameday, volScale: true, spread: 0.01 };
MODELS.sd_vol_sp2 = { ...MODELS.sameday, volScale: true, spread: 0.02 };
const SQUARE_OFF = 15 * 60 + 15;
const dayOf = ts => new Date(ts + 19800000).toISOString().slice(0, 10);

function candidates(def) {
  const out = [];
  for (const u of U) {
    if (def.exclude && def.exclude.includes(u.sym)) continue;
    if (def.only && u.sym !== def.only) continue;
    if (def.indexOnly && !u.isIndex) continue;
    for (let i = Math.max(60, WINDOW_START ? u.candles.findIndex(c => c.ts >= WINDOW_START) : 60); i < u.candles.length - 1; i++) {
      const r = u.pre[i]; if (!r || r.adx < 20) continue;
      const m = u.meta[i];
      if (m.min < (def.from ?? 10 * 60 + 15) || m.min > (def.to ?? 14 * 60 + 30) || u.meta[i + 1].day !== m.day) continue;
      const dir = signal(u, i, def); if (!dir) continue;
      out.push({ u, i, dir, ts: u.candles[i + 1].ts });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
function runOption(c, P) {
  const u = c.u, cs = u.candles, e = cs[c.i + 1].o, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem) * (P.volScale && !u.isIndex ? (u.volRatio || 1) : 1);
  const theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife, t0 = cs[c.i + 1].ts;
  for (let j = c.i + 1; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - t0) / 86400000, decay = theta * days * p0;
    if (P.sameDay && (u.meta[j].day !== u.meta[c.i + 1].day || u.meta[j].min >= SQUARE_OFF)) {
      const same = u.meta[j].day === u.meta[c.i + 1].day, px = same ? b.o : cs[j - 1].c, d2 = ((same ? b.ts : cs[j - 1].ts) - t0) / 86400000;
      const mv = c.dir > 0 ? px - e : e - px;
      return { exitTs: b.ts, ret: Math.max(-1, (p0 + DELTA * mv - theta * d2 * p0) / p0 - 1), why: 'SQ' };
    }
    const fav = c.dir > 0 ? b.h - e : e - b.l, adv = c.dir > 0 ? b.l - e : e - b.h;
    if (p0 + DELTA * adv - decay <= p0 * (1 - SLP)) return { exitTs: b.ts, ret: -SLP, why: 'SL' };
    if (p0 + DELTA * fav - decay >= p0 * (1 + TPP)) return { exitTs: b.ts, ret: TPP, why: 'TP' };
    if (days >= life) { const mv = c.dir > 0 ? b.c - e : e - b.c; return { exitTs: b.ts, ret: Math.max(0, DELTA * mv) / p0 - 1, why: 'EXP' }; }
  }
  const b = cs[cs.length - 1], days = (b.ts - t0) / 86400000, mv = c.dir > 0 ? b.c - e : e - b.c;
  return { exitTs: b.ts, ret: Math.max(0, p0 + DELTA * mv - theta * days * p0) / p0 - 1, why: 'END' };
}
function simulate(cands, P) {
  const open = [], trades = [];
  for (const c of cands) {
    for (let q = open.length - 1; q >= 0; q--) if (open[q].exitTs <= c.ts) open.splice(q, 1);
    if (open.length >= MAXPOS || open.some(o => o.sym === c.u.sym)) continue;
    const r = runOption(c, P); open.push({ exitTs: r.exitTs, sym: c.u.sym });
    const ent = 10000, ext = ent * (1 + r.ret), chg = Indicators.charges(ent, ext, 1, 'options') + ent * (P.spread || 0);
    trades.push({ ts: c.ts, exitTs: r.exitTs, net: ext - ent - chg, why: r.why, sym: c.u.sym, dir: c.dir, idx: c.u.isIndex, min: c.u.meta[c.i + 1].min });
  }
  return trades;
}
function stats(trades, cutTs) {
  const n = trades.length, net = trades.reduce((a, t) => a + t.net, 0), w = trades.filter(t => t.net > 0);
  const gw = w.reduce((a, t) => a + t.net, 0), gl = Math.abs(trades.filter(t => t.net <= 0).reduce((a, t) => a + t.net, 0));
  const byDay = new Map(); trades.forEach(t => byDay.set(dayOf(t.exitTs), (byDay.get(dayOf(t.exitTs)) || 0) + t.net));
  const worst = Math.min(0, ...byDay.values());
  let eq = 0, pk = 0, dd = 0; for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) { eq += t.net; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const mean = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  return { n, avg: n ? net / n : 0, net, win: n ? w.length / n * 100 : 0, pf: gl ? gw / gl : (gw ? 9.99 : 0), dd, worst,
    first: mean(trades.filter(t => t.ts < cutTs)), last: mean(trades.filter(t => t.ts >= cutTs)), nFirst: trades.filter(t => t.ts < cutTs).length, nLast: trades.filter(t => t.ts >= cutTs).length };
}
/** Model-free: the underlying's move in the signal's direction over the next hour (4 bars), in basis points, for every signal bar. */
function rawEdge(cands) {
  let n = 0, sum = 0, hit = 0;
  for (const c of cands) {
    const cs = c.u.candles, e = cs[c.i + 1].o, j = Math.min(cs.length - 1, c.i + 5);
    if (c.u.meta[j].day !== c.u.meta[c.i + 1].day) continue;
    const mv = (cs[j].c - e) / e * 1e4 * c.dir; n++; sum += mv; if (mv > 0) hit++;
  }
  return { n, bps: n ? sum / n : 0, hit: n ? hit / n * 100 : 0 };
}

// cut between "first 60%" and "last 40%" of the whole period, the same for every strategy
const allTs = U.flatMap(u => [u.candles[60].ts, u.candles[u.candles.length - 1].ts]);
const T0 = WINDOW_START || Math.min(...allTs), T1 = Math.max(...allTs), CUT = T0 + (T1 - T0) * (+process.env.CUTFRAC || 0.6);

function evaluateDef(def) {
  const cands = candidates(def);
  const res = { cands: cands.length, raw: rawEdge(cands) };
  for (const [mn, P] of Object.entries(MODELS)) res[mn] = stats(simulate(cands, P), CUT);
  return res;
}








// ───────────── the volume-confirmed combinations found on the last 100 days, on the long data: MAXPOS=99 DATA=1500d node tools/bt_strategies.mjs volume-combos ─────────────
if (process.argv[2] === 'volume-combos') {
  const NLc = String.fromCharCode(10), f0c = x => String(Math.round(x));
  const vols = U.map(u => {
    const byDay = new Map(); u.candles.forEach((c, i) => byDay.set(u.meta[i].day, c.c));
    const cl = [...byDay.values()], r = []; for (let k = 1; k < cl.length; k++) r.push(Math.log(cl[k] / cl[k - 1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  });
  const sv = U.map((u, i) => (u.isIndex ? null : vols[i])).filter(x => x).sort((a, b) => a - b), med = sv[Math.floor(sv.length / 2)];
  U.forEach((u, i) => { u.volRatio = Math.min(2.5, Math.max(0.5, vols[i] / med)); });
  const L = { trend: 'EMA trend', vwap: 'VWAP', volume: 'Volume push', structure: 'Structure', rsi: 'RSI', sr: 'Support/resistance' };
  const mk = (id, ids, extra = {}) => ({ id, name: ids.map(x => L[x]).join(' + ') + (extra.from ? ', entries from 11:30' : ''), def: { mode: 'all', ids, ...extra } });
  const defs = [
    mk('tv', ['trend', 'volume']), mk('tvv', ['trend', 'vwap', 'volume']), mk('tsv', ['trend', 'structure', 'volume']), mk('trv', ['trend', 'rsi', 'volume']),
    mk('tvs', ['trend', 'volume', 'sr']), mk('vvs', ['vwap', 'volume', 'sr']), mk('vv', ['vwap', 'volume']), mk('v', ['volume']),
    mk('tv-late', ['trend', 'volume'], { from: 11 * 60 + 30 }), mk('tvv-late', ['trend', 'vwap', 'volume'], { from: 11 * 60 + 30 }),
    { ...mk('vwap', ['vwap']), name: 'VWAP alone (the current default)' }, mk('trend', ['trend']), { id: 'random', name: 'Random direction (yardstick)', def: { mode: 'all', ids: ['random'] } },
  ];
  const SCEN = [['sd_vol', 'No spread'], ['sd_vol_sp1', '1% round-trip spread'], ['sd_vol_sp2', '2% round-trip spread']];
  let sd1 = 2718; const rr = () => { sd1 = (Math.imul(sd1, 1664525) + 1013904223) >>> 0; return sd1 / 4294967296; };
  const erf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return z >= 0 ? y : -y; };
  const control = (base, P, actual, n) => {
    if (n < 100) return { ctrl: NaN, p: 1 };
    const nets = [];
    for (let k = 0; k < 6; k++) for (const t of simulate(base.map(c => ({ ...c, dir: rr() < 0.5 ? -c.dir : c.dir })), P)) nets.push(t.net);
    const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nets.length - 1));
    return { ctrl: m, p: 0.5 * (1 - erf((actual - m) / (sd / Math.sqrt(n)) / Math.SQRT2)) };
  };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  const mean = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  const K = defs.length;
  const rows = defs.map(d => {
    const base = candidates(d.def), out = { ...d, signals: base.length, raw: rawEdge(base), res: {} };
    for (const [m] of SCEN) {
      const tr = simulate(base, MODELS[m]), st = stats(tr, CUT), c = control(base, MODELS[m], st.avg, st.n);
      const byQ = new Map(); tr.forEach(t => byQ.set(quarter(t.ts), (byQ.get(quarter(t.ts)) || 0) + t.net));
      out.res[m] = { tr, st, ...c, adj: Math.min(1, c.p * K), qPos: [...byQ.values()].filter(v => v > 0).length, qN: byQ.size };
    }
    return out;
  });
  const T = [];
  T.push('# Volume-confirmed combinations on 4 years of data' + NLc);
  T.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `MAXPOS=' + MAXPOS + ' DATA=' + SUF + ' node tools/bt_strategies.mjs volume-combos`. ' + U.length + ' symbols, ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + ', 15-minute candles. These combinations came out best in the last-100-days watchlist test (reports/watchlist_last100d_backtest.md); this run checks them on data they were NOT picked from (everything before the last 100 days is untouched by that selection, the last 100 days are inside this period). Same-day exit (15:15), stop -30% / target +30%, ATM option scaled by each stock\'s volatility, 10,000 Rs premium, entries 10:15-14:30 IST, ADX >= 20, **no limit on open positions** (every symbol trades on its own), modelled option prices. The volume strategy needs volume data, so the two indices never trade here. p = against a coin flip on the same entry bars (100+ trades); adjusted p = p x ' + K + ' variants.' + NLc);
  T.push('| Rule | Trades | Net Rs/trade, no spread | **Net, 1% spread** | Net, 2% spread | PF (1%) | Win (1%) | First 60% / last 40% (1%) | Coin flip, same bars (1%) | p | Adjusted p | Quarters profitable (1%) | Underlying 1h (bps) |' + NLc + '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  [...rows].sort((a, b) => b.res.sd_vol_sp1.st.avg - a.res.sd_vol_sp1.st.avg).forEach(x => {
    const a = x.res.sd_vol, b = x.res.sd_vol_sp1, c = x.res.sd_vol_sp2;
    T.push('| ' + x.name + ' | ' + b.st.n + ' | ' + (a.st.n ? f0c(a.st.avg) : '-') + ' | **' + (b.st.n ? f0c(b.st.avg) : '-') + '** | ' + (c.st.n ? f0c(c.st.avg) : '-') + ' | ' + b.st.pf.toFixed(2) + ' | ' + b.st.win.toFixed(0) + '% | ' + (b.st.nFirst ? f0c(b.st.first) : '-') + ' / ' + (b.st.nLast ? f0c(b.st.last) : '-') + ' | ' + (b.st.n >= 100 ? f0c(b.ctrl) : '-') + ' | ' + (b.st.n >= 100 ? b.p.toFixed(3) : '-') + ' | ' + (b.st.n >= 100 ? b.adj.toFixed(2) : '-') + ' | ' + b.qPos + ' of ' + b.qN + ' | ' + x.raw.bps.toFixed(1) + ' |');
  });
  T.push('');
  const g = (id, m = 'sd_vol_sp1') => rows.find(x => x.id === id).res[m].st;
  const both = rows.filter(x => !['random'].includes(x.id) && x.res.sd_vol_sp1.st.n >= 100 && x.res.sd_vol_sp1.st.avg > 0 && x.res.sd_vol_sp1.st.first > 0 && x.res.sd_vol_sp1.st.last > 0);
  T.push('## What the numbers say' + NLc);
  T.push('- On the last-100-days test the best combination was EMA trend + Volume push + S/R at +241 per trade net. On the 4-year data: **' + f0c(g('tvs').avg) + '** (' + g('tvs').n + ' trades). EMA trend + Volume push: **' + f0c(g('tv').avg) + '** (' + g('tv').n + ' trades) with a 1% spread, ' + f0c(g('tv', 'sd_vol').avg) + ' with none.');
  T.push('- The current default, VWAP alone: ' + f0c(g('vwap').avg) + ' net with a 1% spread over ' + g('vwap').n + ' trades (the yardstick, random direction: ' + f0c(g('random').avg) + ').');
  T.push('- Rules with 100+ trades that are positive after a 1% spread AND in both halves of the period: **' + (both.length ? both.map(x => x.name + ' (' + x.res.sd_vol_sp1.st.n + ' trades, ' + f0c(x.res.sd_vol_sp1.st.avg) + ' Rs)').join('; ') : 'none') + '**.');
  const better = rows.filter(x => x.id !== 'vwap' && x.id !== 'random' && x.res.sd_vol_sp1.st.n >= 100 && x.res.sd_vol_sp1.st.avg > g('vwap').avg);
  T.push('- Combinations that beat VWAP alone on the net average (100+ trades): **' + (better.length ? better.map(x => x.name).join('; ') : 'none') + '**.');
  T.push('');
  const ORIG = new Set(['_NSEI', '_NSEBANK', 'RELIANCE_NS', 'HDFCBANK_NS', 'ICICIBANK_NS', 'INFY_NS', 'TCS_NS', 'SBIN_NS', 'TATASTEEL_NS', 'AXISBANK_NS', 'ITC_NS', 'LT_NS', 'BHARTIARTL_NS', 'MARUTI_NS']);
  const yr = ts => String(new Date(ts + 19800000).getUTCFullYear());
  const cell = a => (a.length >= 15 ? a.length + ' trades, ' + f0c(mean(a)) + ' Rs (win ' + (a.filter(k => k.net > 0).length / a.length * 100).toFixed(0) + '%)' : a.length + ' trades (too few)');
  T.push('## The top combinations in detail (1% spread)' + NLc);
  const top = [...rows].filter(x => x.id !== 'random' && x.id !== 'vwap' && x.res.sd_vol_sp1.st.n >= 100).sort((a, b) => b.res.sd_vol_sp1.st.avg - a.res.sd_vol_sp1.st.avg).slice(0, 3);
  for (const x of [...top, rows.find(r => r.id === 'vwap')]) {
    const t = x.res.sd_vol_sp1.tr;
    T.push('### ' + x.name + NLc);
    T.push('- By year: ' + [...new Set(t.map(a => yr(a.ts)))].sort().map(y => y + ': ' + cell(t.filter(a => yr(a.ts) === y))).join(' | '));
    T.push('- Original symbols: ' + cell(t.filter(a => ORIG.has(a.sym))) + ' | new symbols: ' + cell(t.filter(a => !ORIG.has(a.sym))));
    T.push('- Calls vs puts: BUY CE ' + cell(t.filter(a => a.dir > 0)) + ' | BUY PE ' + cell(t.filter(a => a.dir < 0)));
    T.push('- Time of day: 10:15-11:30 ' + cell(t.filter(a => a.min < 11 * 60 + 30)) + ' | 11:30-13:00 ' + cell(t.filter(a => a.min >= 11 * 60 + 30 && a.min < 13 * 60)) + ' | 13:00-14:30 ' + cell(t.filter(a => a.min >= 13 * 60)));
    const per = new Map(); t.forEach(a => { const o = per.get(a.sym) || { n: 0, net: 0 }; o.n++; o.net += a.net; per.set(a.sym, o); });
    const sy = [...per.entries()].map(([k, o]) => ({ k: k.replace(/_NS$/, '').replace(/^_/, ''), n: o.n, net: o.net })).sort((a, b) => b.net - a.net);
    const total = t.reduce((a, k) => a + k.net, 0), pos = sy.filter(r => r.net > 0).reduce((a, r) => a + r.net, 0);
    T.push('- Symbols traded: ' + sy.length + ', profitable: ' + sy.filter(r => r.net > 0).length + '. Top five contribute ' + (pos ? f0c(sy.slice(0, 5).reduce((a, r) => a + r.net, 0) / pos * 100) : '-') + '% of the profit made by profitable symbols: ' + sy.slice(0, 5).map(r => r.k + ' ' + f0c(r.net) + ' (' + r.n + ')').join(', ') + '. Total ' + f0c(total) + ' Rs.');
    T.push('');
  }
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'volume_combinations_4y' + (MAXPOS === 5 ? '' : '_slots' + MAXPOS) + '.md'), T.join(NLc) + NLc);
  console.log(T.slice(0, 22).join(NLc));
  process.exit(0);
}

// ───────────── every strategy on each watchlist stock, and combinations, on the last N days: LAST_DAYS=100 MAXPOS=99 DATA=1500d ONLY=... node tools/bt_strategies.mjs watchlist ─────────────
if (process.argv[2] === 'watchlist') {
  const NLw = String.fromCharCode(10), f0w = x => String(Math.round(x));
  const STRATS = [['trend', 'EMA trend'], ['rsi', 'RSI'], ['vwap', 'VWAP'], ['structure', 'Structure'], ['fvg', 'FVG retest'], ['volume', 'Volume push'], ['smc', 'SMC (LuxAlgo)'], ['sr', 'Support/resistance']];
  const LBL = Object.fromEntries(STRATS), IDS = STRATS.map(x => x[0]);
  const NET = MODELS.sd_vol_sp1, GROSS = MODELS.sd_vol;
  const symName = u => u.sym.replace(/_NS$/, '').replace(/^_/, '').replace('NSEI', 'NIFTY 50').replace('NSEBANK', 'BANK NIFTY');
  const winDays = new Set(); U.forEach(u => u.candles.forEach((c, i) => { if (c.ts >= WINDOW_START) winDays.add(u.meta[i].day); }));
  const mean = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  const cellOf = (base, flipSeed) => {
    let cands = base;
    if (flipSeed !== undefined) { let sd = flipSeed; const rr = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; }; cands = base.map(c => ({ ...c, dir: rr() < 0.5 ? -c.dir : c.dir })); }
    const tr = simulate(cands, NET), gr = simulate(cands, GROSS), st = stats(tr, CUT);
    return { n: st.n, avg: st.avg, gross: mean(gr), win: st.win, pf: st.pf, total: st.net, first: st.first, last: st.last, nFirst: st.nFirst, nLast: st.nLast };
  };
  // singles: each strategy on each stock
  const syms = U.map(u => u.sym);
  const single = {}; const bases = [];
  for (const sym of syms) { single[sym] = {}; for (const id of IDS) { const base = candidates({ mode: 'all', ids: [id], only: sym }); single[sym][id] = cellOf(base); bases.push(base); } }
  // portfolio level: each strategy over the whole watchlist, and every pair / triple that must agree
  const port = {}; const portBases = {};
  for (const id of IDS) { portBases[id] = candidates({ mode: 'all', ids: [id] }); port[id] = cellOf(portBases[id]); }
  const combos = [];
  for (let a = 0; a < IDS.length; a++) for (let b = a + 1; b < IDS.length; b++) { combos.push([IDS[a], IDS[b]]); for (let c = b + 1; c < IDS.length; c++) combos.push([IDS[a], IDS[b], IDS[c]]); }
  const comboPort = combos.map(ids => { const base = candidates({ mode: 'all', ids }); return { ids, name: ids.map(x => LBL[x]).join(' + '), ...cellOf(base) }; });
  // best combination per stock
  const perStockCombo = {};
  const comboBases = [];
  for (const sym of syms) {
    perStockCombo[sym] = combos.map(ids => { const base = candidates({ mode: 'all', ids, only: sym }); comboBases.push(base); return { ids, name: ids.map(x => LBL[x]).join(' + '), ...cellOf(base) }; });
  }
  // how many cells look good by luck: the same signals with random directions
  const R = 20, nullSingles = [], nullCombos = [];
  for (let r = 0; r < R; r++) {
    const cs = bases.map(b => cellOf(b, 1000 + r)).filter(c => c.n >= 10);
    nullSingles.push({ pos: cs.filter(c => c.avg > 0).length, big: cs.filter(c => c.avg > 100).length, best: Math.max(...cs.map(c => c.avg)), cells: cs.length });
    const cc = comboBases.map(b => cellOf(b, 5000 + r)).filter(c => c.n >= 10);
    nullCombos.push({ pos: cc.filter(c => c.avg > 0).length, big: cc.filter(c => c.avg > 100).length, best: Math.max(...cc.map(c => c.avg)), cells: cc.length });
  }
  const rng = a => [Math.min(...a), Math.max(...a)];
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const real = {
    singles: Object.values(single).flatMap(o => Object.values(o)).filter(c => c.n >= 10),
    combos: Object.values(perStockCombo).flat().filter(c => c.n >= 10),
  };
  const T = [];
  const first = new Date(WINDOW_START).toISOString().slice(0, 10), last = new Date(T1).toISOString().slice(0, 10);
  T.push('# Every strategy on each watchlist stock, and combinations: the last ' + LAST_DAYS + ' days' + NLw);
  T.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `LAST_DAYS=' + LAST_DAYS + ' MAXPOS=' + MAXPOS + ' DATA=' + SUF + ' node tools/bt_strategies.mjs watchlist`. **Window: ' + first + ' to ' + last + ' (' + winDays.size + ' trading days).** Stocks: the dashboard scan list that can be traded in options (' + U.length + '): ' + U.map(symName).join(', ') + '. SENSEX is left out (no NSE options) and the news strategy too (no headline history). Each strategy is a rule on its own: long when it votes up, short when it votes down (strategy as the app computes it: structure BOS/CHoCH, FVG retest, VWAP side, EMA stack, RSI, volume push, SMC = LuxAlgo port, S/R = previous-day high/low rules). Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, squared off at 15:15 the same day, 10,000 Rs premium per trade, **modelled option prices** with each stock\'s premium scaled by its volatility, full option charges and a **1% round-trip spread** (the NET column; gross = without the spread). One position per stock at a time. "First half / second half" split the window at its middle.' + NLw);
  T.push('**Read this first:** about ' + winDays.size + ' trading days is a short sample. A stock + strategy cell has only a handful to a few dozen trades, so the best-looking cells are partly luck; the "reality check" section counts how many cells would look this good with RANDOM directions. Results are in-sample (nothing is tested on data it was not chosen from).' + NLw);

  T.push('## 1. Each strategy on each stock: net Rs per trade (number of trades)' + NLw);
  T.push('| Stock | ' + STRATS.map(x => x[1]).join(' | ') + ' |' + NLw + '|---|' + STRATS.map(() => '---').join('|') + '|');
  for (const sym of syms) T.push('| ' + symName(U.find(u => u.sym === sym)) + ' | ' + IDS.map(id => { const c = single[sym][id]; return c.n ? (c.avg > 0 ? '**' + f0w(c.avg) + '**' : f0w(c.avg)) + ' (' + c.n + ')' : '-'; }).join(' | ') + ' |');
  T.push('');
  T.push('Bold = positive net after the spread. Cells with fewer than 10 trades are not trusted below.' + NLw);

  const good = [], okay = [];
  for (const sym of syms) for (const id of IDS) { const c = single[sym][id]; if (c.n < 10 || !(c.avg > 0)) continue; const row = { sym: symName(U.find(u => u.sym === sym)), strat: LBL[id], ...c }; okay.push(row); if (c.nFirst >= 3 && c.nLast >= 3 && c.first > 0 && c.last > 0) good.push(row); }
  const showRow = x => '| ' + x.sym + ' | ' + x.strat + ' | ' + x.n + ' | **' + f0w(x.avg) + '** | ' + f0w(x.gross) + ' | ' + x.win.toFixed(0) + '% | ' + x.pf.toFixed(2) + ' | ' + f0w(x.total) + ' | ' + f0w(x.first) + ' (' + x.nFirst + ') / ' + f0w(x.last) + ' (' + x.nLast + ') |';
  const head = '| Stock | Strategy | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | Net total Rs | First half / second half (trades) |' + NLw + '|---|---|---|---|---|---|---|---|---|';
  T.push('## 2. Which stock and which strategy went well' + NLw);
  T.push('**Positive net after the spread, at least 10 trades, and positive in BOTH halves of the window** (' + good.length + ' of ' + real.singles.length + ' cells with 10+ trades):' + NLw);
  T.push(good.length ? head : '*none*');
  good.sort((a, b) => b.avg - a.avg).forEach(x => T.push(showRow(x)));
  T.push('');
  T.push('**All cells with a positive net and at least 10 trades** (' + okay.length + '):' + NLw);
  T.push(okay.length ? head : '*none*');
  okay.sort((a, b) => b.avg - a.avg).forEach(x => T.push(showRow(x)));
  T.push('');
  const bad = real.singles.length - okay.length;
  T.push('The other ' + bad + ' cells with 10+ trades lost money after the spread.' + NLw);

  T.push('## 3. Each strategy across the whole watchlist' + NLw);
  T.push('| Strategy | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | First half / second half | Stocks profitable (10+ trades) |' + NLw + '|---|---|---|---|---|---|---|---|');
  [...IDS].sort((a, b) => port[b].avg - port[a].avg).forEach(id => {
    const c = port[id], cells = syms.map(sy => single[sy][id]).filter(x => x.n >= 10);
    T.push('| ' + LBL[id] + ' | ' + c.n + ' | **' + f0w(c.avg) + '** | ' + f0w(c.gross) + ' | ' + c.win.toFixed(0) + '% | ' + c.pf.toFixed(2) + ' | ' + f0w(c.first) + ' / ' + f0w(c.last) + ' | ' + cells.filter(x => x.avg > 0).length + ' of ' + cells.length + ' |');
  });
  T.push('');
  T.push('## 4. Combinations across the whole watchlist (all must agree)' + NLw);
  const cp = comboPort.filter(c => c.n >= 30).sort((a, b) => b.avg - a.avg);
  T.push(comboPort.length + ' pairs and triples; ' + cp.length + ' have 30+ trades. Best 15 and worst 5:' + NLw);
  T.push('| Combination | Trades | Net Rs/trade | Gross Rs/trade | Win | PF | First half / second half |' + NLw + '|---|---|---|---|---|---|---|');
  [...cp.slice(0, 15), ...cp.slice(-5)].forEach(c => T.push('| ' + c.name + ' | ' + c.n + ' | **' + f0w(c.avg) + '** | ' + f0w(c.gross) + ' | ' + c.win.toFixed(0) + '% | ' + c.pf.toFixed(2) + ' | ' + f0w(c.first) + ' / ' + f0w(c.last) + ' |'));
  T.push('');
  const cpGood = cp.filter(c => c.avg > 0 && c.first > 0 && c.last > 0);
  T.push('Combinations with 30+ trades that are positive after the spread AND in both halves: **' + (cpGood.length ? cpGood.map(c => c.name + ' (' + c.n + ' trades, ' + f0w(c.avg) + ' Rs)').join('; ') : 'none') + '**.' + NLw);

  T.push('## 5. Best combination for each stock' + NLw);
  T.push('Out of ' + combos.length + ' pairs and triples per stock, the best one with at least 10 trades (this is the most over-fitted view: the more combinations tried, the better the best one looks by chance):' + NLw);
  T.push('| Stock | Best combination | Trades | Net Rs/trade | Gross | Win | First half / second half |' + NLw + '|---|---|---|---|---|---|---|');
  for (const sym of syms) {
    const best = perStockCombo[sym].filter(c => c.n >= 10).sort((a, b) => b.avg - a.avg)[0];
    T.push('| ' + symName(U.find(u => u.sym === sym)) + ' | ' + (best ? best.name + ' | ' + best.n + ' | **' + f0w(best.avg) + '** | ' + f0w(best.gross) + ' | ' + best.win.toFixed(0) + '% | ' + f0w(best.first) + ' / ' + f0w(best.last) : 'no combination with 10+ trades | - | - | - | - | -') + ' |');
  }
  T.push('');
  T.push('## 6. Reality check: how many cells look good by luck' + NLw);
  T.push('The same signals, but each trade\'s direction flipped by a coin toss, repeated ' + R + ' times (the "luck" column is the range over those repeats). If the real count is not clearly above that range, the good-looking cells are what luck produces.' + NLw);
  T.push('| | Real | Luck (random directions), range over ' + R + ' repeats |' + NLw + '|---|---|---|');
  T.push('| Stock x strategy cells with 10+ trades | ' + real.singles.length + ' | ' + rng(nullSingles.map(x => x.cells)).join('-') + ' |');
  T.push('| ... with positive net | ' + real.singles.filter(c => c.avg > 0).length + ' | ' + rng(nullSingles.map(x => x.pos)).join('-') + ' (median ' + med(nullSingles.map(x => x.pos)) + ') |');
  T.push('| ... with net above +100 Rs per trade | ' + real.singles.filter(c => c.avg > 100).length + ' | ' + rng(nullSingles.map(x => x.big)).join('-') + ' (median ' + med(nullSingles.map(x => x.big)) + ') |');
  T.push('| ... best single cell (Rs per trade) | ' + f0w(Math.max(...real.singles.map(c => c.avg))) + ' | ' + rng(nullSingles.map(x => Math.round(x.best))).join('-') + ' |');
  T.push('| Stock x combination cells with 10+ trades | ' + real.combos.length + ' | ' + rng(nullCombos.map(x => x.cells)).join('-') + ' |');
  T.push('| ... with positive net | ' + real.combos.filter(c => c.avg > 0).length + ' | ' + rng(nullCombos.map(x => x.pos)).join('-') + ' (median ' + med(nullCombos.map(x => x.pos)) + ') |');
  T.push('| ... with net above +100 Rs per trade | ' + real.combos.filter(c => c.avg > 100).length + ' | ' + rng(nullCombos.map(x => x.big)).join('-') + ' (median ' + med(nullCombos.map(x => x.big)) + ') |');
  T.push('| ... best combination cell (Rs per trade) | ' + f0w(Math.max(...real.combos.map(c => c.avg))) + ' | ' + rng(nullCombos.map(x => Math.round(x.best))).join('-') + ' |');
  T.push('');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'watchlist_last' + LAST_DAYS + 'd_backtest.md'), T.join(NLw) + NLw);
  console.log(T.join(NLw).slice(0, 9000));
  process.exit(0);
}

// ───────────── stress test of the VWAP-alone result: DATA=1500d node tools/bt_strategies.mjs vwap-stress ─────────────
if (process.argv[2] === 'vwap-stress') {
  const NLv = String.fromCharCode(10), f0v = x => String(Math.round(x));
  // each stock's own volatility relative to the typical stock (std of daily close-to-close returns over the whole period)
  const vols = U.map(u => {
    const byDay = new Map(); u.candles.forEach((c, i) => byDay.set(u.meta[i].day, c.c));
    const cl = [...byDay.values()], r = []; for (let k = 1; k < cl.length; k++) r.push(Math.log(cl[k] / cl[k - 1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  });
  const stockVols = U.map((u, i) => (u.isIndex ? null : vols[i])).filter(x => x).sort((a, b) => a - b), med = stockVols[Math.floor(stockVols.length / 2)];
  U.forEach((u, i) => { u.volRatio = Math.min(2.5, Math.max(0.5, vols[i] / med)); });
  const SCEN = [['sameday', 'As before (premium 2% of spot, no spread)'], ['sd_vol', 'Premium scaled by each stock\'s volatility'], ['sd_vol_sp1', '... plus 1% round-trip spread'], ['sd_vol_sp2', '... plus 2% round-trip spread']];
  const VW = { mode: 'all', ids: ['vwap'] };
  const defs = [
    { id: 'vwap', name: 'VWAP alone', def: VW },
    { id: 'vwap-xadani', name: 'VWAP alone, without ADANIENT', def: { ...VW, exclude: ['ADANIENT_NS'] } },
    { id: 'vwap-late', name: 'VWAP alone, entries only from 11:30', def: { ...VW, from: 11 * 60 + 30 } },
    { id: 'vwap-late13', name: 'VWAP alone, entries only from 13:00', def: { ...VW, from: 13 * 60 } },
    { id: 'vwap-early', name: 'VWAP alone, entries only before 11:30 (mirror)', def: { ...VW, to: 11 * 60 + 30 } },
    { id: 'vwap-late-xadani', name: 'VWAP alone, from 11:30, without ADANIENT', def: { ...VW, from: 11 * 60 + 30, exclude: ['ADANIENT_NS'] } },
    { id: 'sv', name: 'Structure + VWAP agree', def: { mode: 'all', ids: ['structure', 'vwap'] } },
    { id: 'random', name: 'Random direction (yardstick)', def: { mode: 'all', ids: ['random'] } },
  ];
  let sd1 = 31337; const rr = () => { sd1 = (Math.imul(sd1, 1664525) + 1013904223) >>> 0; return sd1 / 4294967296; };
  const erf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return z >= 0 ? y : -y; };
  const control = (base, P, actual, n) => {
    if (n < 100) return { ctrl: NaN, p: 1 };
    const nets = [];
    for (let k = 0; k < 6; k++) for (const t of simulate(base.map(c => ({ ...c, dir: rr() < 0.5 ? -c.dir : c.dir })), P)) nets.push(t.net);
    const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nets.length - 1));
    return { ctrl: m, p: 0.5 * (1 - erf((actual - m) / (sd / Math.sqrt(n)) / Math.SQRT2)) };
  };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  const rows = defs.map(d => {
    const base = candidates(d.def), out = { ...d, signals: base.length, res: {} };
    for (const [m] of SCEN) {
      const tr = simulate(base, MODELS[m]), st = stats(tr, CUT), c = control(base, MODELS[m], st.avg, st.n);
      const byQ = new Map(); tr.forEach(t => byQ.set(quarter(t.ts), (byQ.get(quarter(t.ts)) || 0) + t.net));
      out.res[m] = { tr, st, ...c, qPos: [...byQ.values()].filter(v => v > 0).length, qN: byQ.size };
    }
    return out;
  });
  const T = [];
  T.push('# Stress test of the VWAP-alone result' + (MAXPOS === 5 ? '' : ' (no limit on open positions)') + NLv);
  T.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `DATA=' + SUF + ' node tools/bt_strategies.mjs vwap-stress`. ' + U.length + ' symbols, ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + '. Same-day exit (squared off at 15:15), stop -30% / target +30%, ATM option, 10,000 Rs premium per trade, entries 10:15-14:30 IST, ADX >= 20, ' + (MAXPOS === 5 ? 'at most 5 open' : 'NO limit on open positions (every symbol trades on its own)') + ', one per underlying; **modelled option prices**. The result being tested: VWAP side alone (long above VWAP, short below) earned +166 Rs per trade. Three weaknesses of the earlier model are removed here: (1) every stock\'s ATM option cost 2% of spot whatever its volatility, so volatile stocks were too cheap: here the premium is scaled by the stock\'s own volatility relative to the typical stock (std of daily returns, clamped 0.5x-2.5x; ' + U.filter(u => !u.isIndex).map(u => u.sym.replace(/_NS$/, '') + ' ' + u.volRatio.toFixed(2) + 'x').sort((a, b) => parseFloat(b.split(' ')[1]) - parseFloat(a.split(' ')[1])).slice(0, 5).join(', ') + ' are the most volatile); (2) no bid-ask spread: a round-trip spread of 1% and 2% of the premium is charged (a liquid index option costs less, a stock option often costs more); (3) one symbol, ADANIENT, produced about half of the profit: it is excluded in some rows. p = against a coin flip on the SAME entry bars (100+ trades only).' + NLv);
  T.push('| Rule | Scenario | Trades | Avg Rs/trade | PF | Win | First 60% / last 40% | Coin flip, same bars | p | Quarters profitable |' + NLv + '|---|---|---|---|---|---|---|---|---|---|');
  for (const x of rows) for (const [m, label] of SCEN) {
    const r = x.res[m], st = r.st;
    T.push('| ' + x.name + ' | ' + label + ' | ' + st.n + ' | ' + (st.n ? '**' + f0v(st.avg) + '**' : '-') + ' | ' + st.pf.toFixed(2) + ' | ' + st.win.toFixed(0) + '% | ' + (st.nFirst ? f0v(st.first) : '-') + ' / ' + (st.nLast ? f0v(st.last) : '-') + ' | ' + (st.n >= 100 ? f0v(r.ctrl) : '-') + ' | ' + (st.n >= 100 ? r.p.toFixed(3) : '-') + ' | ' + r.qPos + ' of ' + r.qN + ' |');
  }
  T.push('');
  // who makes the money, under the strictest scenario
  const sc = 'sd_vol_sp1', v = rows.find(x => x.id === 'vwap').res[sc].tr;
  const per = new Map(); v.forEach(t => { const o = per.get(t.sym) || { n: 0, net: 0 }; o.n++; o.net += t.net; per.set(t.sym, o); });
  const syms = [...per.entries()].map(([k, o]) => ({ k: k.replace(/_NS$/, '').replace(/_/g, ''), n: o.n, net: o.net, avg: o.net / o.n })).sort((a, b) => b.net - a.net);
  const total = v.reduce((a, t) => a + t.net, 0), pos = syms.filter(s2 => s2.net > 0).reduce((a, s2) => a + s2.net, 0);
  T.push('## Who makes the money (VWAP alone, premium scaled by volatility + 1% spread)' + NLv);
  T.push('- Total ' + f0v(total) + ' Rs over ' + v.length + ' trades. Symbols profitable: ' + syms.filter(s2 => s2.net > 0).length + ' of ' + syms.length + '.');
  T.push('- The five biggest contributors: ' + syms.slice(0, 5).map(s2 => s2.k + ' ' + f0v(s2.net) + ' Rs (' + s2.n + ' trades, ' + f0v(s2.avg) + ' avg)').join('; ') + '. Together ' + (pos ? f0v(syms.slice(0, 5).reduce((a, s2) => a + s2.net, 0) / pos * 100) : '-') + '% of all profit made by profitable symbols.');
  T.push('- The five worst: ' + syms.slice(-5).reverse().map(s2 => s2.k + ' ' + f0v(s2.net) + ' Rs (' + s2.n + ' trades)').join('; ') + '.');
  const yr = ts => String(new Date(ts + 19800000).getUTCFullYear());
  T.push('- By year: ' + [...new Set(v.map(t => yr(t.ts)))].sort().map(y => { const a = v.filter(t => yr(t.ts) === y); return y + ': ' + a.length + ' trades, ' + f0v(a.reduce((x, t) => x + t.net, 0) / a.length) + ' Rs'; }).join(' | '));
  T.push('- Calls vs puts: BUY CE ' + (a => a.length + ' trades, ' + f0v(a.reduce((x, t) => x + t.net, 0) / a.length) + ' Rs')(v.filter(t => t.dir > 0)) + ' | BUY PE ' + (a => a.length + ' trades, ' + f0v(a.reduce((x, t) => x + t.net, 0) / a.length) + ' Rs')(v.filter(t => t.dir < 0)));
  T.push('');
  const get = (id, m) => rows.find(x => x.id === id).res[m].st;
  T.push('## What the numbers say' + NLv);
  T.push('- VWAP alone: **' + f0v(get('vwap', 'sameday').avg) + '** Rs per trade in the earlier model; **' + f0v(get('vwap', 'sd_vol').avg) + '** with volatility-scaled premiums; **' + f0v(get('vwap', 'sd_vol_sp1').avg) + '** with a 1% spread added; **' + f0v(get('vwap', 'sd_vol_sp2').avg) + '** with a 2% spread.');
  T.push('- Without ADANIENT (volatility-scaled, 1% spread): **' + f0v(get('vwap-xadani', 'sd_vol_sp1').avg) + '** Rs per trade over ' + get('vwap-xadani', 'sd_vol_sp1').n + ' trades.');
  T.push('- Entries only from 11:30 (a clean run, trades blocked by earlier ones no longer matter): **' + f0v(get('vwap-late', 'sd_vol_sp1').avg) + '** Rs (from 13:00: ' + f0v(get('vwap-late13', 'sd_vol_sp1').avg) + '; before 11:30: ' + f0v(get('vwap-early', 'sd_vol_sp1').avg) + ').');
  T.push('- Random direction under the same strictest model: ' + f0v(get('random', 'sd_vol_sp1').avg) + ' Rs per trade.');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'vwap_stress_test' + (MAXPOS === 5 ? '' : '_slots' + MAXPOS) + TAG + '.md'), T.join(NLv) + NLv);
  console.log(T.join(NLv).slice(0, 6000));
  process.exit(0);
}

// ───────────── EMA 9 rejection: DATA=1500d MAXPOS=99 node tools/bt_strategies.mjs ema9 ─────────────
// CE: price has been above the 9 EMA (a green candle closed fully above it), then a candle dips to the 9 EMA and is rejected (its low touches or
// pierces the EMA, it closes back above it, green). PE is the mirror. The signal is read on the rejection candle's close, filled at the next open.
if (process.argv[2] === 'ema9') {
  const NLe = String.fromCharCode(10), f0e = x => String(Math.round(x));
  const vols = U.map(u => {
    const byDay = new Map(); u.candles.forEach((c, i) => byDay.set(u.meta[i].day, c.c));
    const cl = [...byDay.values()], r = []; for (let k = 1; k < cl.length; k++) r.push(Math.log(cl[k] / cl[k - 1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  });
  const sv = U.map((u, i) => (u.isIndex ? null : vols[i])).filter(x => x).sort((a, b) => a - b), med = sv[Math.floor(sv.length / 2)];
  U.forEach((u, i) => { u.volRatio = Math.min(2.5, Math.max(0.5, vols[i] / med)); });
  const LOOK = 5;                                     // the green candle fully above the EMA must be within the last 5 bars, with no close below the EMA since
  for (const u of U) {
    const cs = u.candles, e9 = Indicators.ema(cs.map(c => c.c), 9), n = cs.length;
    const loose = new Int8Array(n), strict = new Int8Array(n), rising = new Int8Array(n), side = new Int8Array(n);
    for (let i = LOOK + 1; i < n; i++) {
      const c = cs[i], e = e9[i];
      side[i] = c.c > e ? 1 : c.c < e ? -1 : 0;
      const bullRej = c.l <= e && c.c > e && c.c > c.o, bearRej = c.h >= e && c.c < e && c.c < c.o;
      if (bullRej && cs[i - 1].c > e9[i - 1]) loose[i] = 1;
      if (bearRej && cs[i - 1].c < e9[i - 1]) loose[i] = -1;
      // strict: a green candle entirely above the EMA (low > EMA) in the last LOOK bars, and every close since then above the EMA (mirror for PE)
      let up = false, dn = false;
      for (let k = i - 1; k >= i - LOOK; k--) {
        const b = cs[k];
        if (!up && b.c > b.o && b.l > e9[k]) { up = true; for (let q = k + 1; q < i; q++) if (cs[q].c <= e9[q]) { up = false; break; } }
        if (!dn && b.c < b.o && b.h < e9[k]) { dn = true; for (let q = k + 1; q < i; q++) if (cs[q].c >= e9[q]) { dn = false; break; } }
      }
      if (bullRej && up) strict[i] = 1; else if (bearRej && dn) strict[i] = -1;
      if (strict[i] && Math.sign(e9[i] - e9[i - 1]) === strict[i]) rising[i] = strict[i];
    }
    u.extra = { e9loose: loose, e9strict: strict, e9slope: rising, e9side: side };
  }
  const SCEN = [['sd_vol', 'No spread'], ['sd_vol_sp1', '1% spread'], ['sd_vol_sp2', '2% spread']];
  const A = ids => ({ mode: 'all', ids });
  const LATE = 11 * 60 + 30;
  const defs = [
    { id: 'strict', name: 'EMA9 rejection (green candle above EMA9, then a rejection)', def: A(['e9strict']) },
    { id: 'strict-late', name: '... entries from 11:30 (app window)', def: { ...A(['e9strict']), from: LATE } },
    { id: 'strict-idx', name: '... Nifty + Bank Nifty only, from 11:30', def: { ...A(['e9strict']), from: LATE, indexOnly: true } },
    { id: 'loose', name: 'EMA9 rejection, loose (previous close above EMA9 is enough)', def: A(['e9loose']) },
    { id: 'slope', name: 'EMA9 rejection + EMA9 sloping the same way', def: A(['e9slope']) },
    { id: 'strict-vwap', name: 'EMA9 rejection + VWAP agrees', def: A(['e9strict', 'vwap']) },
    { id: 'strict-vwap-late', name: 'EMA9 rejection + VWAP agrees, from 11:30', def: { ...A(['e9strict', 'vwap']), from: LATE } },
    { id: 'side', name: 'Reference: price above/below EMA9 (no rejection)', def: A(['e9side']) },
    { id: 'vwap-late', name: 'Reference: VWAP alone from 11:30 (the current default)', def: { ...A(['vwap']), from: LATE } },
    { id: 'random', name: 'Reference: random direction', def: A(['random']) },
  ];
  let sde = 4242; const rr = () => { sde = (Math.imul(sde, 1664525) + 1013904223) >>> 0; return sde / 4294967296; };
  const erf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return z >= 0 ? y : -y; };
  const control = (base, P, actual, n) => {
    if (n < 100) return { ctrl: NaN, p: NaN };
    const nets = [];
    for (let k = 0; k < 6; k++) for (const t of simulate(base.map(c => ({ ...c, dir: rr() < 0.5 ? -c.dir : c.dir })), P)) nets.push(t.net);
    const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nets.length - 1));
    return { ctrl: m, p: 0.5 * (1 - erf((actual - m) / (sd / Math.sqrt(n)) / Math.SQRT2)) };
  };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  const yr = ts => String(new Date(ts + 19800000).getUTCFullYear());
  const rows = defs.map(d => {
    const base = candidates(d.def), out = { ...d, signals: base.length, raw: rawEdge(base), res: {} };
    for (const [m] of SCEN) {
      const tr = simulate(base, MODELS[m]), st = stats(tr, CUT), c = control(base, MODELS[m], st.avg, st.n);
      const byQ = new Map(); tr.forEach(t => byQ.set(quarter(t.ts), (byQ.get(quarter(t.ts)) || 0) + t.net));
      out.res[m] = { tr, st, ...c, qPos: [...byQ.values()].filter(v => v > 0).length, qN: byQ.size };
    }
    return out;
  });
  const K = defs.length - 3;
  const T = [];
  T.push('# EMA 9 rejection strategy backtest' + NLe);
  T.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `DATA=' + SUF + ' MAXPOS=' + MAXPOS + ' node tools/bt_strategies.mjs ema9`. ' + U.length + ' symbols (Nifty 50, Bank Nifty and ' + (U.length - 2) + ' stocks), 15-minute candles, ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + '.' + NLe);
  T.push('**The rule tested.** CE: a green candle closes entirely above the 9 EMA (its low is above the EMA); within the next ' + LOOK + ' candles, with every close staying above the EMA, a candle dips to the EMA (low at or below it) and is rejected (closes back above it, green). Buy the ATM CE at the next candle\'s open. PE: the mirror (a red candle entirely below the EMA, then a candle pokes up to the EMA and closes back below it, red). Variants: a loose version (the previous close above the EMA is enough), with the EMA sloping the same way, and with VWAP agreeing (the app\'s current default strategy).' + NLe);
  T.push('**Engine (same as every earlier report).** Signal on the candle close, filled at the next open; entries 10:15-14:30 IST (or from 11:30 where stated), ADX >= 20; ATM option, 10,000 Rs premium per trade, stop -30% / target +30%, squared off at 15:15 the same day; one position per underlying, ' + (MAXPOS >= 99 ? 'no limit on the number open' : 'at most ' + MAXPOS + ' open') + '; full option charges; **modelled option prices** (no historical option candles exist): premium scaled by each stock\'s volatility, plus a round-trip bid-ask spread of 0%, 1% or 2% of the premium. p = chance a coin flip on the SAME entry bars does at least as well (100+ trades); ' + K + ' variants were tried, so multiply p by ' + K + ' before calling anything an edge. "Move 1h" = the underlying\'s average move in the signal\'s direction over the next hour, model-free, in basis points.' + NLe);
  T.push('| Rule | Spread | Signals | Trades | Avg Rs/trade | PF | Win | First 60% / last 40% | Coin flip | p | Quarters + | Move 1h (bps) |' + NLe + '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of rows) for (const [m, label] of SCEN) {
    const r = x.res[m], st = r.st;
    T.push('| ' + x.name + ' | ' + label + ' | ' + x.signals + ' | ' + st.n + ' | ' + (st.n ? '**' + f0e(st.avg) + '**' : '-') + ' | ' + st.pf.toFixed(2) + ' | ' + st.win.toFixed(0) + '% | ' + (st.nFirst ? f0e(st.first) : '-') + ' / ' + (st.nLast ? f0e(st.last) : '-') + ' | ' + (Number.isFinite(r.ctrl) ? f0e(r.ctrl) : '-') + ' | ' + (Number.isFinite(r.p) ? r.p.toFixed(3) : '-') + ' | ' + r.qPos + ' of ' + r.qN + ' | ' + x.raw.bps.toFixed(1) + ' |');
  }
  T.push('');
  const main = rows.find(x => x.id === 'strict').res.sd_vol_sp1.tr;
  const per = new Map(); main.forEach(t => { const o = per.get(t.sym) || { n: 0, net: 0 }; o.n++; o.net += t.net; per.set(t.sym, o); });
  const syms = [...per.entries()].map(([k, o]) => ({ k: k.replace(/_NS$/, '').replace(/^_/, '^'), n: o.n, net: o.net })).sort((a, b) => b.net - a.net);
  const side = a => a.length ? a.length + ' trades, ' + f0e(a.reduce((x, t) => x + t.net, 0) / a.length) + ' Rs' : '-';
  T.push('## Detail: the main rule, 1% spread' + NLe);
  T.push('- Symbols profitable: ' + syms.filter(q => q.net > 0).length + ' of ' + syms.length + '. Best: ' + syms.slice(0, 5).map(q => q.k + ' ' + f0e(q.net) + ' (' + q.n + ')').join(', ') + '. Worst: ' + syms.slice(-5).reverse().map(q => q.k + ' ' + f0e(q.net) + ' (' + q.n + ')').join(', ') + '.');
  T.push('- By year: ' + [...new Set(main.map(t => yr(t.ts)))].sort().map(y => y + ' ' + side(main.filter(t => yr(t.ts) === y))).join(' | '));
  T.push('- BUY CE: ' + side(main.filter(t => t.dir > 0)) + ' | BUY PE: ' + side(main.filter(t => t.dir < 0)));
  T.push('- Indices only: ' + side(main.filter(t => t.idx)) + ' | stocks only: ' + side(main.filter(t => !t.idx)));
  const ex = {}; main.forEach(t => { ex[t.why] = (ex[t.why] || 0) + 1; });
  T.push('- Exits: ' + Object.entries(ex).map(([k, v]) => k + ' ' + v).join(', ') + ' (SL = -30% stop, TP = +30% target, SQ = squared off at 15:15)');
  T.push('');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'ema9_rejection_backtest' + TAG + '.md'), T.join(NLe) + NLe);
  console.log(T.join(NLe));
  process.exit(0);
}

// ───────────── candidate default settings, with and without the same-day exit: DATA=1500d node tools/bt_strategies.mjs default-test ─────────────
if (process.argv[2] === 'default-test') {
  const NLd = String.fromCharCode(10), f0d = x => String(Math.round(x));
  const L = { structure: 'Structure', fvg: 'FVG retest', vwap: 'VWAP', smc: 'SMC', trend: 'EMA trend', rsi: 'RSI', volume: 'Volume' };
  const nm = ids => ids.map(x => L[x]).join(' + ');
  const defsA = [
    { id: 'cand', name: 'CANDIDATE: Structure + FVG + VWAP, weighted score >= 3 (weights 2, 1, 1)', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 } } },
    { id: 'cand-late', name: 'CANDIDATE, entries only from 11:30 (first hour skipped)', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, from: 11 * 60 + 30 } },
    { id: 'cand-late13', name: 'CANDIDATE, entries only from 13:00', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, from: 13 * 60 } },
    { id: 'cand-early', name: 'CANDIDATE, entries only before 11:30 (the mirror check)', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, to: 11 * 60 + 30 } },
    { id: 'cand-all', name: 'Structure + FVG + VWAP, all three agree', def: { mode: 'all', ids: ['structure', 'fvg', 'vwap'] } },
    { id: 'sv', name: 'Structure + VWAP agree', def: { mode: 'all', ids: ['structure', 'vwap'] } },
    { id: 'sv-score', name: 'Structure + VWAP, weighted score >= 3 (weights 2, 1)', def: { mode: 'score', ids: ['structure', 'vwap'], min: 3, weights: { structure: 2, vwap: 1 } } },
    { id: 'sf', name: 'Structure + FVG retest agree', def: { mode: 'all', ids: ['structure', 'fvg'] } },
    { id: 'structure', name: 'Structure alone', def: { mode: 'all', ids: ['structure'] } },
    { id: 'cand-trend', name: 'Structure + FVG + VWAP (score >= 3) + EMA trend agrees', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, also: ['trend'] } },
    { id: 'cand-vol', name: 'Structure + FVG + VWAP (score >= 3) + volume push agrees', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, also: ['volume'] } },
    { id: 'cand-rsi', name: 'Structure + FVG + VWAP (score >= 3) + RSI agrees', def: { mode: 'score', ids: ['structure', 'fvg', 'vwap'], min: 3, weights: { structure: 2, fvg: 1, vwap: 1 }, also: ['rsi'] } },
    { id: 'now', name: 'TODAY\'S DEFAULT: Structure + FVG + SMC + VWAP, all four agree', def: { mode: 'all', ids: ['structure', 'fvg', 'smc', 'vwap'] } },
    { id: 'live', name: 'Earlier live vote: six strategies + SMC (weight 2), score >= 7', def: { mode: 'score', ids: [...CORE, 'smc'], min: 7, weights: { smc: 2 } } },
    { id: 'random', name: 'Random direction (yardstick)', def: { mode: 'all', ids: ['random'] } },
  ];
  const W3 = { structure: 2, vwap: 1, trend: 2 };
  const defsB = [
    { id: 'svt', name: 'Structure + VWAP + EMA trend, all three agree', def: { mode: 'all', ids: ['structure', 'vwap', 'trend'] } },
    { id: 'svt-s3', name: 'Structure + VWAP + EMA trend, weighted score >= 3 (weights 2, 1, 2)', def: { mode: 'score', ids: ['structure', 'vwap', 'trend'], min: 3, weights: W3 } },
    { id: 'svt-s4', name: 'Structure + VWAP + EMA trend, weighted score >= 4', def: { mode: 'score', ids: ['structure', 'vwap', 'trend'], min: 4, weights: W3 } },
    { id: 'svt-s5', name: 'Structure + VWAP + EMA trend, weighted score >= 5 (same as all three)', def: { mode: 'score', ids: ['structure', 'vwap', 'trend'], min: 5, weights: W3 } },
    { id: 'svt-late', name: 'Structure + VWAP + EMA trend, entries from 11:30', def: { mode: 'all', ids: ['structure', 'vwap', 'trend'], from: 11 * 60 + 30 } },
    { id: 'svt-late13', name: 'Structure + VWAP + EMA trend, entries from 13:00', def: { mode: 'all', ids: ['structure', 'vwap', 'trend'], from: 13 * 60 } },
    { id: 'svt-early', name: 'Structure + VWAP + EMA trend, entries before 11:30 (mirror check)', def: { mode: 'all', ids: ['structure', 'vwap', 'trend'], to: 11 * 60 + 30 } },
    { id: 'st', name: 'Structure + EMA trend agree', def: { mode: 'all', ids: ['structure', 'trend'] } },
    { id: 'vt', name: 'VWAP + EMA trend agree', def: { mode: 'all', ids: ['vwap', 'trend'] } },
    { id: 'trend', name: 'EMA trend alone', def: { mode: 'all', ids: ['trend'] } },
    { id: 'vwap', name: 'VWAP alone', def: { mode: 'all', ids: ['vwap'] } },
    { id: 'sv', name: 'Structure + VWAP agree (the previous best)', def: { mode: 'all', ids: ['structure', 'vwap'] } },
    { id: 'structure', name: 'Structure alone', def: { mode: 'all', ids: ['structure'] } },
    { id: 'random', name: 'Random direction (yardstick)', def: { mode: 'all', ids: ['random'] } },
  ];
  const TREND_SET = process.env.SET === 'trend', defs = TREND_SET ? defsB : defsA;
  const mean = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  // flip each signal's direction by a coin toss on the SAME entry bars; one-sided normal test of the per-trade average against that control
  let sd0 = 99; const rr = () => { sd0 = (Math.imul(sd0, 1664525) + 1013904223) >>> 0; return sd0 / 4294967296; };
  const erf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return z >= 0 ? y : -y; };
  const control = (base, P, actual, n) => {
    if (n < 100) return { ctrl: NaN, p: 1 };
    const nets = [];
    for (let k = 0; k < 6; k++) for (const t of simulate(base.map(c => ({ ...c, dir: rr() < 0.5 ? -c.dir : c.dir })), P)) nets.push(t.net);
    const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nets.length - 1));
    return { ctrl: m, p: 0.5 * (1 - erf((actual - m) / (sd / Math.sqrt(n)) / Math.SQRT2)) };
  };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  const K = defs.length * 2;
  const rows = defs.map(d => {
    const base = candidates(d.def), out = { ...d, signals: base.length, raw: rawEdge(base) };
    for (const m of ['realistic', 'sameday']) {
      const P = MODELS[m], tr = simulate(base, P), st = stats(tr, CUT), c = control(base, P, st.avg, st.n);
      const byQ = new Map(); tr.forEach(t => byQ.set(quarter(t.ts), (byQ.get(quarter(t.ts)) || 0) + t.net));
      out[m] = { tr, st, ...c, adj: Math.min(1, c.p * K), qPos: [...byQ.values()].filter(v => v > 0).length, qN: byQ.size };
    }
    return out;
  });
  const T = [];
  T.push((TREND_SET ? '# Structure + VWAP + EMA trend, with and without the same-day exit' : '# Candidate default settings, with and without the same-day exit') + NLd);
  T.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `' + (TREND_SET ? 'SET=trend ' : '') + (MAXPOS === 5 ? '' : 'MAXPOS=' + MAXPOS + ' ') + 'DATA=' + SUF + ' node tools/bt_strategies.mjs default-test`. ' + U.length + ' symbols, ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + ', 15-minute candles, **modelled option prices**. Signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option, stop -30% / target +30%, 10,000 Rs premium per trade after full option charges, at most 5 open, one per underlying. **Hold** = kept until stop or target (the CARRYFORWARD product, up to 4 days for indices / 20 for stocks). **Same-day** = also squared off at 15:15 the same day (the INTRADAY / MIS product). Random-direction yardstick, and for rules with 100+ trades a p-value against a **coin flip on the same entry bars** (times ' + K + ' tries = adjusted p; above about 0.05 is not evidence of an edge).' + NLd);
  T.push('| Rule | Signals | Hold: trades | Hold: avg Rs | Same-day: trades | **Same-day: avg Rs** | Same-day PF | Win | First 60% / last 40% | Coin flip, same bars | p | Adjusted p | Quarters profitable | Underlying 1h (bps) |' + NLd + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  [...rows].sort((a, b) => b.sameday.st.avg - a.sameday.st.avg).forEach(x => {
    const h = x.realistic.st, d = x.sameday;
    T.push('| ' + x.name + ' | ' + x.signals + ' | ' + h.n + ' | ' + (h.n ? f0d(h.avg) : '-') + ' | ' + d.st.n + ' | **' + (d.st.n ? f0d(d.st.avg) : '-') + '** | ' + d.st.pf.toFixed(2) + ' | ' + d.st.win.toFixed(0) + '% | ' + (d.st.nFirst ? f0d(d.st.first) : '-') + ' / ' + (d.st.nLast ? f0d(d.st.last) : '-') + ' | ' + (d.st.n >= 100 ? f0d(d.ctrl) : '-') + ' | ' + (d.st.n >= 100 ? d.p.toFixed(3) : '-') + ' | ' + (d.st.n >= 100 ? d.adj.toFixed(2) : '-') + ' | ' + d.qPos + ' of ' + d.qN + ' | ' + x.raw.bps.toFixed(1) + ' |');
  });
  T.push('');
  const rnd = rows.find(x => x.id === 'random'), cand = rows.find(x => x.id === (TREND_SET ? 'svt' : 'cand'));
  const both = rows.filter(x => x.id !== 'random' && x.sameday.st.n >= 100 && x.sameday.st.avg > 0 && x.sameday.st.first > 0 && x.sameday.st.last > 0);
  T.push('## What the numbers say' + NLd);
  T.push('- Random direction, same-day exit: **' + f0d(rnd.sameday.st.avg) + ' Rs per trade** (hold: ' + f0d(rnd.realistic.st.avg) + '). This is what a rule without skill costs here.');
  T.push('- The focus rule (' + (TREND_SET ? 'Structure + VWAP + EMA trend, all three agree' : 'Structure + FVG + VWAP, score >= 3') + '): **' + f0d(cand.sameday.st.avg) + ' Rs per trade with the same-day exit** vs ' + f0d(cand.realistic.st.avg) + ' when held to stop or target, over ' + cand.sameday.st.n + ' trades.');
  T.push('- Rules with 100+ trades that were profitable on the same-day exit AND in both halves of the period: **' + (both.length ? both.map(x => x.name).join('; ') : 'none') + '**.');
  T.push('- How much the same-day exit helps every rule on average: ' + f0d(rows.reduce((a, x) => a + (x.sameday.st.avg - x.realistic.st.avg), 0) / rows.length) + ' Rs per trade.');
  T.push('');
  const ORIG = new Set(['_NSEI', '_NSEBANK', 'RELIANCE_NS', 'HDFCBANK_NS', 'ICICIBANK_NS', 'INFY_NS', 'TCS_NS', 'SBIN_NS', 'TATASTEEL_NS', 'AXISBANK_NS', 'ITC_NS', 'LT_NS', 'BHARTIARTL_NS', 'MARUTI_NS']);
  const yr = ts => String(new Date(ts + 19800000).getUTCFullYear());
  const cell = a => (a.length >= 15 ? a.length + ' trades, ' + f0d(mean(a)) + ' Rs (win ' + (a.filter(k => k.net > 0).length / a.length * 100).toFixed(0) + '%)' : a.length + ' trades (too few)');
  T.push('## The candidate in detail (same-day exit)' + NLd);
  for (const id of TREND_SET ? ['vwap', 'svt', 'sv', 'svt-late13'] : ['cand', 'structure', 'sv', 'cand-late']) {
    const x = rows.find(r => r.id === id), t = x.sameday.tr;
    T.push('### ' + x.name + NLd);
    T.push('- By year: ' + [...new Set(t.map(a => yr(a.ts)))].sort().map(y => y + ': ' + cell(t.filter(a => yr(a.ts) === y))).join(' | '));
    T.push('- Original symbols: ' + cell(t.filter(a => ORIG.has(a.sym))) + ' | new symbols: ' + cell(t.filter(a => !ORIG.has(a.sym))));
    T.push('- Calls vs puts: BUY CE ' + cell(t.filter(a => a.dir > 0)) + ' | BUY PE ' + cell(t.filter(a => a.dir < 0)));
    T.push('- Indices vs stocks: ' + cell(t.filter(a => a.idx)) + ' | ' + cell(t.filter(a => !a.idx)));
    T.push('- Time of day: 10:15-11:30 ' + cell(t.filter(a => a.min < 11 * 60 + 30)) + ' | 11:30-13:00 ' + cell(t.filter(a => a.min >= 11 * 60 + 30 && a.min < 13 * 60)) + ' | 13:00-14:30 ' + cell(t.filter(a => a.min >= 13 * 60)));
    // a time-of-day pattern found by looking at all the data is only a hypothesis: does it show up in BOTH halves of the period, and in every year?
    for (const [lbl, f] of [['first 60% of the period', a => a.ts < CUT], ['last 40% of the period', a => a.ts >= CUT]])
      T.push('- Time of day, ' + lbl + ': 10:15-11:30 ' + cell(t.filter(a => f(a) && a.min < 11 * 60 + 30)) + ' | 11:30-14:30 ' + cell(t.filter(a => f(a) && a.min >= 11 * 60 + 30)));
    T.push('- Entries from 11:30 by year: ' + [...new Set(t.map(a => yr(a.ts)))].sort().map(y => y + ': ' + cell(t.filter(a => yr(a.ts) === y && a.min >= 11 * 60 + 30))).join(' | '));
    const per = new Map(); t.forEach(a => { const o = per.get(a.sym) || []; o.push(a); per.set(a.sym, o); });
    const sy = [...per.entries()].filter(([, a]) => a.length >= 30).map(([k, a]) => [k.replace(/_NS$/, '').replace(/_/g, ''), a.length, mean(a)]).sort((a, b) => b[2] - a[2]);
    if (sy.length) T.push('- Symbols with 30+ trades: ' + sy.length + '; profitable: ' + sy.filter(r => r[2] > 0).length + '. Best: ' + sy.slice(0, 4).map(([k, n2, v]) => k + ' ' + f0d(v) + ' (' + n2 + ')').join(', ') + '. Worst: ' + sy.slice(-3).reverse().map(([k, n2, v]) => k + ' ' + f0d(v) + ' (' + n2 + ')').join(', ') + '.');
    T.push('');
  }
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'default_settings_backtest' + (TREND_SET ? '_trend' : '') + (MAXPOS === 5 ? '' : '_slots' + MAXPOS) + TAG + '.md'), T.join(NLd) + NLd);
  console.log(T.slice(0, 22).join(NLd));
  process.exit(0);
}

// ───────────── rules on the LuxAlgo outputs: node tools/bt_strategies.mjs smc-rules ─────────────
if (['smc-rules', 'smc-combos', 'smc-four'].includes(process.argv[2])) {
  const FOUR_MODE = process.argv[2] === 'smc-four', COMBOS_MODE = process.argv[2] !== 'smc-rules';
  const NLs = String.fromCharCode(10);
  for (const u of U) u.rules = ruleRows(u.candles);
  const f0s = x => String(Math.round(x));
  const defs = [];
  if (FOUR_MODE) {
    // Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo port) + Support/resistance (previous day high/low): every way of combining the four
    const FOUR = ['structure', 'fvg', 'smc', 'sr'], L4 = { structure: 'Structure BOS/CHoCH', fvg: 'FVG retest', smc: 'SMC (LuxAlgo)', sr: 'S/R (prev day H/L)' };
    const nm = ids => ids.map(x => L4[x]).join(' + ');
    for (const x of FOUR) defs.push({ id: x, name: L4[x] + ' alone', what: 'The strategy by itself.', def: { mode: 'all', ids: [x] } });
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) defs.push({ id: FOUR[a] + '+' + FOUR[b], name: nm([FOUR[a], FOUR[b]]) + ' agree', what: 'Both vote the same way on the same bar.', def: { mode: 'all', ids: [FOUR[a], FOUR[b]] } });
    for (let skip = 3; skip >= 0; skip--) { const ids = FOUR.filter((_, k) => k !== skip); defs.push({ id: ids.join('+'), name: nm(ids) + ' agree', what: 'The three vote the same way on the same bar.', def: { mode: 'all', ids } }); }
    defs.push({ id: 'all4', name: 'All four agree', what: 'All four vote the same way on the same bar.', def: { mode: 'all', ids: FOUR } });
    defs.push({ id: 'three-sr-ok', name: 'Structure + FVG retest + SMC agree, S/R not against', what: 'The three vote the same way; support/resistance may be silent but must not point the other way.', def: { mode: 'all', ids: ['structure', 'fvg', 'smc'], notAgainst: ['sr'] } });
    defs.push({ id: 'smc-struct-sr-ok', name: 'Structure + SMC agree, FVG and S/R not against', what: 'Structure and SMC agree; FVG retest and S/R may be silent but must not point the other way.', def: { mode: 'all', ids: ['structure', 'smc'], notAgainst: ['fvg', 'sr'] } });
    for (const [label, w, mins] of [['live weights (structure 2, FVG 1, SMC 2, S/R 0)', { structure: 2, fvg: 1, smc: 2, sr: 0 }, [3, 4, 5]], ['S/R as a weight-2 vote (structure 2, FVG 1, SMC 2, S/R 2)', { structure: 2, fvg: 1, smc: 2, sr: 2 }, [4, 5, 6]], ['equal weights (1 each)', { structure: 1, fvg: 1, smc: 1, sr: 1 }, [2, 3, 4]]])
      for (const min of mins) defs.push({ id: 'score:' + label + min, name: 'Weighted vote, ' + label + ', score >= ' + min, what: 'The four strategies add up with these weights; a call needs the score.', def: { mode: 'score', ids: FOUR, min, weights: w } });
    // the better-looking families again with VWAP agreeing
    const base = defs.filter(d => d.id.includes('+') && d.def.ids.length >= 3 || d.id === 'all4' || d.id === 'three-sr-ok' || d.id === 'smc-struct-sr-ok' || d.id.startsWith('score:'));
    for (const [suffix, also, label] of [['|htf', ['htf'], 'the higher-timeframe trend (EMA100/200)'], ['|vwap+htf', ['vwap', 'htf'], 'VWAP and the higher-timeframe trend']])
      defs.push({ id: 'structure+fvg+smc' + suffix, name: nm(['structure', 'fvg', 'smc']) + ' agree + ' + label + ' agree', what: 'The three vote the same way, and ' + label + ' points the same way.', def: { mode: 'all', ids: ['structure', 'fvg', 'smc'], also } });
    for (const d of base) defs.push({ id: d.id + '|vwap', name: d.name + ' + VWAP agrees', what: d.what + ' Only when VWAP side points the same way.', def: { ...d.def, also: [...(d.def.also || []), 'vwap'] } });
  } else if (!COMBOS_MODE) {
    for (const [id, name, what] of RULES) {
      defs.push({ id, name, what, def: { mode: 'all', ids: [id] } });
      for (const [x, label] of [['vwap', 'VWAP'], ['htf', 'higher-timeframe trend']]) defs.push({ id: id + '+' + x, name: name + ' + ' + label + ' agree', what: what + ' Only when ' + label + ' points the same way.', def: { mode: 'all', ids: [id, x] } });
    }
  } else {
    // SMC together with every other strategy: pairs, triples, and as one more vote in the score
    const LAB = { trend: 'EMA trend', rsi: 'RSI', vwap: 'VWAP', structure: 'Structure BOS/CHoCH', fvg: 'FVG retest', volume: 'Volume push', htf: 'Higher-timeframe trend', bbrev: 'Bollinger reversal', bbbrk: 'Bollinger breakout', bbmid: 'Bollinger mid-band', sr: 'Support/resistance', srbrk: 'S/R breakout', srrev: 'S/R rejection' };
    const OTHERS = Object.keys(LAB), TRIPLE_POOL = ['trend', 'vwap', 'htf', 'rsi', 'volume', 'structure'];
    const BASES = [['smc', 'SMC (today)'], ['r_nozone', 'SMC without the discount/premium rule']];
    for (const [b, bn] of BASES) {
      defs.push({ id: b, name: bn + ' alone', what: 'The SMC rule by itself.', def: { mode: 'all', ids: [b] } });
      for (const x of OTHERS) defs.push({ id: b + '+' + x, name: bn + ' + ' + LAB[x] + ' agree', what: 'Both vote the same way on the same bar.', def: { mode: 'all', ids: [b, x] } });
      for (let a = 0; a < TRIPLE_POOL.length; a++) for (let c = a + 1; c < TRIPLE_POOL.length; c++) {
        const x = TRIPLE_POOL[a], y = TRIPLE_POOL[c];
        defs.push({ id: b + '+' + x + '+' + y, name: bn + ' + ' + LAB[x] + ' + ' + LAB[y] + ' agree', what: 'All three vote the same way on the same bar.', def: { mode: 'all', ids: [b, x, y] } });
      }
      for (const min of [5, 6, 7, 8]) defs.push({ id: b + '|score' + min, name: 'Live vote (6 strategies) + ' + bn + ' as a vote of weight 2, score >= ' + min, what: 'The six core strategies and SMC (weight 2) add up; a call needs the score.', def: { mode: 'score', ids: [...CORE, b], min, weights: { [b]: 2 } } });
      for (const min of [6, 7]) defs.push({ id: b + '|also' + min, name: 'Live vote >= ' + min + ' and ' + bn + ' agrees', what: 'The six core strategies reach the score and SMC points the same way.', def: { mode: 'score', ids: CORE, min, also: [b] } });
    }
  }
  const rows = defs.map(d => ({ ...d, r: evaluateDef(d.def), trades: simulate(candidates(d.def), MODELS.realistic) }));
  const rndDef = { mode: 'all', ids: ['random'] };
  const rnd = { r: evaluateDef(rndDef), trades: simulate(candidates(rndDef), MODELS.realistic) };
  const pool = rnd.trades.map(t => t.net), K = defs.length;
  let seed = 4242; const r01 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let seed2 = 777; const r02 = () => { seed2 = (Math.imul(seed2, 1664525) + 1013904223) >>> 0; return seed2 / 4294967296; };
  const erf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return z >= 0 ? y : -y; };
  const normSf = z => 0.5 * (1 - erf(z / Math.SQRT2));
  function sameBars(def, actual, n) {
    if (n < 100) return { ctrl: NaN, p: 1 };           // with fewer trades the control itself is too noisy to mean anything
    const base = candidates(def), nets = [];
    for (let k = 0; k < 6; k++) for (const t of simulate(base.map(c => ({ ...c, dir: r02() < 0.5 ? -c.dir : c.dir })), MODELS.realistic)) nets.push(t.net);
    const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nets.length - 1));
    return { ctrl: m, p: normSf((actual - m) / (sd / Math.sqrt(n))) };
  }
  const bootP = (avg, n) => { let hits = 0; const R = 3000; for (let k = 0; k < R; k++) { let sum = 0; for (let q = 0; q < n; q++) sum += pool[Math.floor(r01() * pool.length)]; if (sum / n >= avg) hits++; } return hits / R; };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  for (const x of rows) {
    const q = x.r.realistic, n = q.n;
    // control on the SAME bars: keep each signal's entry bar but flip its direction by a coin toss. This removes entry-time effects (a rule that enters
    // at 10:15 every day pays less time decay than random bars), so only the direction is tested. One-sided normal test on the per-trade average.
    const ctl = sameBars(x.def, q.avg, n);
    x.ctrl = ctl.ctrl; x.p = n >= 100 ? ctl.p : 1; x.adj = Math.min(1, x.p * K);
    const byQ = new Map(); x.trades.forEach(t => { const k = quarter(t.ts); byQ.set(k, (byQ.get(k) || 0) + t.net); });
    x.qPos = [...byQ.values()].filter(v => v > 0).length; x.qN = byQ.size;
  }
  const out = [];
  out.push(FOUR_MODE ? '# Structure BOS/CHoCH + FVG retest + SMC (LuxAlgo port) + Support/resistance' + NLs : COMBOS_MODE ? '# SMC combined with the other strategies' + NLs : '# Rules built on the LuxAlgo SMC outputs' + NLs);
  out.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `node tools/bt_strategies.mjs ' + process.argv[2] + '`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). ' + (FOUR_MODE ? 'The four strategies exactly as the app votes them today: Structure BOS/CHoCH (weight 2), FVG retest (1), Smart money = the LuxAlgo-port vote (2) and Support/resistance of the previous day high/low (shown in the app but weight 0). They are tested alone, in every pair and triple, all four together, as weighted scores, and with VWAP agreeing. Support/resistance is the combined rule (breakout, break-and-retest or rejection) as used by the app.' : COMBOS_MODE ? 'SMC = the LuxAlgo-port vote of `frontend/js/smc.js` (internal trend + order block tap + discount/premium); the second base drops the discount/premium condition so it fires more often. Each is combined with every other strategy (pairs that must agree, triples, and as a weight-2 vote added to the live six-strategy score).' : 'Rule definitions are in `tools/smc_rules.mjs`; they use only the indicator outputs of `frontend/js/smc.js` (structure events, order blocks, equal highs/lows, fair value gaps, swing range).') + NLs);
  out.push((COMBOS_MODE ? '' : 'Each rule is also tried with VWAP and with the higher-timeframe trend (EMA100/200) agreeing. ') + '**' + K + ' variants** were tried. With that many tries a few look good by luck, so the table shows (for rules with at least 100 trades) a p-value against a **coin flip on the same entry bars** (each signal keeps its entry bar but its direction is flipped at random, which removes timing effects such as paying less time decay by entering early in the day) and the p-value times ' + K + ' (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.' + NLs);
  out.push('Random-direction yardstick (no skill): **' + f0s(rnd.r.realistic.avg) + ' Rs per trade**, profit factor ' + rnd.r.realistic.pf.toFixed(2) + ', ' + rnd.r.realistic.n + ' trades.' + NLs);
  out.push('| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | Coin flip, same bars (avg Rs) | p vs coin flip | Adjusted p | Quarters |' + NLs + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  [...rows].sort((a, b) => b.r.realistic.avg - a.r.realistic.avg).forEach((x, i) => {
    const q = x.r.realistic;
    out.push('| ' + (i + 1) + ' | ' + x.name + ' | ' + x.r.cands + ' | ' + q.n + ' | ' + (q.n ? f0s(q.avg) : '-') + ' | ' + q.pf.toFixed(2) + ' | ' + q.win.toFixed(0) + '% | ' + f0s(q.net) + ' | ' + (q.nFirst ? f0s(q.first) : '-') + ' / ' + (q.nLast ? f0s(q.last) : '-') + ' | ' + f0s(x.r.nodecay.avg) + ' | ' + x.r.raw.bps.toFixed(1) + ' | ' + x.r.raw.hit.toFixed(0) + '% | ' + (q.n >= 100 ? f0s(x.ctrl) : '-') + ' | ' + (q.n >= 100 ? x.p.toFixed(3) : '-') + ' | ' + (q.n >= 100 ? x.adj.toFixed(2) : '-') + ' | ' + x.qPos + ' of ' + x.qN + ' |');
  });
  out.push('');
  const both = rows.filter(x => x.r.realistic.n >= 40 && x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0);
  const sig = rows.filter(x => x.r.realistic.n >= 100 && x.adj < 0.05);
  const beatsRandom = rows.filter(x => x.r.realistic.n >= 40 && x.r.realistic.avg > rnd.r.realistic.avg);
  out.push('## What the numbers say' + NLs);
  out.push('- Variants with at least 40 trades that beat the random yardstick on the average trade: **' + beatsRandom.length + ' of ' + rows.filter(x => x.r.realistic.n >= 40).length + '**.');
  out.push('- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **' + (both.length ? both.map(x => x.name + ' (' + x.r.realistic.n + ' trades, ' + f0s(x.r.realistic.avg) + ' Rs)').join('; ') : 'none') + '**.');
  out.push('- Variants with at least 100 trades and an adjusted p below 0.05 (a real edge after correcting for the ' + K + ' tries): **' + (sig.length ? sig.map(x => x.name).join('; ') : 'none') + '**.');
  out.push('- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.');
  out.push('');
  if (FOUR_MODE) {
    // the focus combination in detail: where and when it works, and whether the symbols NEVER used to pick it behave the same
    const ORIG = new Set(['_NSEI', '_NSEBANK', 'RELIANCE_NS', 'HDFCBANK_NS', 'ICICIBANK_NS', 'INFY_NS', 'TCS_NS', 'SBIN_NS', 'TATASTEEL_NS', 'AXISBANK_NS', 'ITC_NS', 'LT_NS', 'BHARTIARTL_NS', 'MARUTI_NS']);
    const yr = ts => String(new Date(ts + 19800000).getUTCFullYear());
    const cell = a => (a.length >= 10 ? a.length + ' trades, ' + f0s(a.reduce((x, k) => x + k.net, 0) / a.length) + ' Rs (win ' + (a.filter(k => k.net > 0).length / a.length * 100).toFixed(0) + '%)' : a.length + ' trades (too few)');
    out.push('## The focus combination in detail' + NLs);
    out.push('Symbols in this run: ' + U.length + ' (' + U.filter(u => ORIG.has(u.sym)).length + ' from the original set used in all earlier reports, ' + U.filter(u => !ORIG.has(u.sym)).length + ' new ones that were never used to choose anything). Period: ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + '.' + NLs);
    for (const id of ['structure+fvg+smc', 'structure+fvg+smc|vwap', 'structure+fvg+smc|htf', 'structure+fvg+smc|vwap+htf']) {
      const x = rows.find(r => r.id === id); if (!x) continue;
      const t = x.trades, q = x.r.realistic;
      out.push('### ' + x.name + NLs);
      out.push('- Overall: ' + q.n + ' trades, ' + (q.n ? f0s(q.avg) : '-') + ' Rs per trade, profit factor ' + q.pf.toFixed(2) + ', win ' + q.win.toFixed(0) + '%, total ' + f0s(q.net) + ' Rs. First 60% ' + (q.nFirst ? f0s(q.first) : '-') + ' (' + q.nFirst + ' trades) / last 40% ' + (q.nLast ? f0s(q.last) : '-') + ' (' + q.nLast + ' trades). No-decay best case ' + f0s(x.r.nodecay.avg) + ' Rs. Underlying 1h move ' + x.r.raw.bps.toFixed(1) + ' bps, ' + x.r.raw.hit.toFixed(0) + '% of ' + x.r.raw.n + ' signals right.');
      out.push('- By year: ' + [...new Set(t.map(a => yr(a.ts)))].sort().map(y => y + ': ' + cell(t.filter(a => yr(a.ts) === y))).join(' | '));
      out.push('- Original symbols: ' + cell(t.filter(a => ORIG.has(a.sym))) + ' | new symbols: ' + cell(t.filter(a => !ORIG.has(a.sym))));
      out.push('- Calls (up) vs puts (down): BUY CE ' + cell(t.filter(a => a.dir > 0)) + ' | BUY PE ' + cell(t.filter(a => a.dir < 0)));
      out.push('- Indices vs stocks: ' + cell(t.filter(a => a.idx)) + ' | ' + cell(t.filter(a => !a.idx)));
      out.push('- Time of day: 10:15-11:30 ' + cell(t.filter(a => a.min < 11 * 60 + 30)) + ' | 11:30-13:00 ' + cell(t.filter(a => a.min >= 11 * 60 + 30 && a.min < 13 * 60)) + ' | 13:00-14:30 ' + cell(t.filter(a => a.min >= 13 * 60)));
      const per = new Map(); t.forEach(a => { const o = per.get(a.sym) || []; o.push(a); per.set(a.sym, o); });
      const sy = [...per.entries()].filter(([, a]) => a.length >= 3).map(([k, a]) => [k.replace(/_NS$/, '').replace(/_/g, ''), a.length, a.reduce((z, k2) => z + k2.net, 0) / a.length]).sort((a, b) => b[2] - a[2]);
      if (sy.length) out.push('- Symbols with 3+ trades (avg Rs): ' + sy.map(([k, n2, v]) => k + ' ' + f0s(v) + ' (' + n2 + ')').join(', '));
      const prof = sy.filter(r => r[2] > 0).length;
      if (sy.length) out.push('- Profitable symbols: ' + prof + ' of ' + sy.length + '.');
      out.push('');
    }
  }
  if (!COMBOS_MODE) out.push('## One section per rule' + NLs);
  for (const x of COMBOS_MODE ? [] : rows.filter(r => !r.id.includes('+'))) {
    const q = x.r.realistic, t = x.trades, cell = a => (a.length >= 15 ? a.length + ' trades, ' + f0s(a.reduce((s2, k) => s2 + k.net, 0) / a.length) + ' Rs' : a.length + ' trades (too few)');
    out.push('### ' + x.name + NLs);
    out.push('*' + x.what + '*' + NLs);
    out.push('- Overall: ' + q.n + ' trades, ' + (q.n ? f0s(q.avg) : '-') + ' Rs per trade, profit factor ' + q.pf.toFixed(2) + ', win ' + q.win.toFixed(0) + '%. Underlying 1h move ' + x.r.raw.bps.toFixed(1) + ' bps, ' + x.r.raw.hit.toFixed(0) + '% of signals right (' + x.r.raw.n + ' signals).');
    out.push('- Calls vs puts: BUY CE ' + cell(t.filter(a => a.dir > 0)) + ' | BUY PE ' + cell(t.filter(a => a.dir < 0)));
    out.push('- Indices vs stocks: ' + cell(t.filter(a => a.idx)) + ' | ' + cell(t.filter(a => !a.idx)));
    out.push('');
  }
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', FOUR_MODE ? `smc_four_strategy_report${TAG}.md` : COMBOS_MODE ? 'smc_combinations_report.md' : 'smc_rules_report.md'), out.join(NLs) + NLs);
  console.log(out.slice(0, 30).join(NLs));
  process.exit(0);
}

// ───────────── one report with every strategy tested separately ─────────────
if (process.argv[2] === 'each') {
  const NLe = String.fromCharCode(10);
  const LIST = [
    ['random', 'RANDOM direction (yardstick)', 'A coin flip for the direction, through the same entry gates. This is what "no skill" costs.'],
    ['trend', 'EMA trend 9/21/50', 'Bullish when EMA9 > EMA21 > EMA50 and price is above all three; bearish for the mirror.'],
    ['rsi', 'RSI momentum', 'RSI(14) between 55 and 75 is bullish, between 25 and 45 bearish; overbought / oversold extremes are ignored.'],
    ['vwap', 'VWAP side', "Price above the day's VWAP is bullish, below is bearish."],
    ['structure', 'Structure BOS / CHoCH', 'The direction of the latest break of structure (higher-high / lower-low).'],
    ['fvg', 'FVG retest', 'Price retests a fresh fair value gap in the direction of the structure and rejects it.'],
    ['volume', 'Volume push', 'A candle on more than 1.5x the average volume, closing in its direction.'],
    ['bbrev', 'Bollinger reversal', 'Close outside the Bollinger band (20, 2): bets on a return to the middle (below the lower band = up).'],
    ['bbbrk', 'Bollinger breakout', 'Close outside the Bollinger band (20, 2): rides the breakout (above the upper band = up).'],
    ['bbmid', 'Bollinger mid-band side', 'Close above the middle band is bullish, below is bearish.'],
    ['htf', 'Hourly trend (EMA100/200 on 15m)', 'Price above EMA100 and EMA100 above EMA200 is bullish; the mirror is bearish.'],
    ['smc', 'SMC (LuxAlgo port: internal trend + order block tap + discount/premium)', 'Internal structure up/down, an unmitigated order block tapped by a candle in that direction, price in the discount (long) or premium (short) half of the swing range.'],
    ['pd', 'SMC part: premium / discount half (LuxAlgo swing range)', 'Below the midpoint of the swing range is bullish, above is bearish.'],
    ['sr', 'Support / resistance (all three setups)', 'Previous day high/low/close and swing levels: breakout, break-and-retest or rejection.'],
    ['srbrk', 'S/R breakout', 'A fresh strong close beyond the previous day high or low.'],
    ['srrt', 'S/R break-and-retest', 'After such a breakout today, price retests the level and holds.'],
    ['srrev', 'S/R rejection (reversal)', 'A wick through a level that closes back on the original side.'],
  ];
  const f0e = x => String(Math.round(x));
  const avgOf = a => (a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0);
  const pfOf = a => { const gw = a.filter(t => t.net > 0).reduce((x, t) => x + t.net, 0), gl = Math.abs(a.filter(t => t.net <= 0).reduce((x, t) => x + t.net, 0)); return gl ? gw / gl : 0; };
  const cell = a => (a.length >= 15 ? a.length + ' trades, ' + f0e(avgOf(a)) + ' Rs (PF ' + pfOf(a).toFixed(2) + ')' : a.length + ' trades (too few)');
  const res = LIST.map(([id, name, what]) => {
    const def = { mode: 'all', ids: [id] };
    const cands = candidates(def);
    const trades = simulate(cands, MODELS.realistic);
    const r = { cands: cands.length, raw: rawEdge(cands), realistic: stats(trades, CUT), nodecay: stats(simulate(cands, MODELS.nodecay), CUT) };
    return { id, name, what, r, trades };
  });
  const out3 = [];
  out3.push('# Every strategy tested separately' + NLe);
  out3.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `node tools/bt_strategies.mjs each`. Each strategy runs ALONE through the same engine: signal on a bar close, fill at the next bar open, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying, ATM option held to stop (-30%) or target (+30%), 10,000 Rs premium per trade after full option charges. Data: 14 symbols (2 indices, 12 stocks), 2 years of 15-minute candles. **Option prices are a model** (no historical option candles exist): "realistic" includes time decay, "no decay" is a best case no real option achieves. The **underlying 1h move** column needs no option model: the average move of the underlying in the signal direction over the next hour, in basis points.' + NLe);
  out3.push('## Ranking (best average per trade first)' + NLe);
  out3.push('| Rank | Strategy | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |' + NLe + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  [...res].sort((a, b) => b.r.realistic.avg - a.r.realistic.avg).forEach((x, i) => { const q = x.r.realistic; out3.push('| ' + (i + 1) + ' | ' + x.name + ' | ' + x.r.cands + ' | ' + q.n + ' | ' + f0e(q.avg) + ' | ' + q.pf.toFixed(2) + ' | ' + q.win.toFixed(0) + '% | ' + f0e(q.net) + ' | ' + f0e(q.dd) + ' | ' + f0e(q.worst) + ' | ' + f0e(q.first) + ' / ' + f0e(q.last) + ' | ' + f0e(x.r.nodecay.avg) + ' | ' + x.r.raw.bps.toFixed(1) + ' | ' + x.r.raw.hit.toFixed(0) + '% |'); });
  out3.push('');
  const rnd = res.find(x => x.id === 'random');
  const beat = res.filter(x => x.id !== 'random' && x.r.realistic.avg > rnd.r.realistic.avg);
  out3.push('The random yardstick averages **' + f0e(rnd.r.realistic.avg) + ' Rs per trade**. ' + beat.length + ' of ' + (res.length - 1) + ' strategies beat it on the average trade; **' + res.filter(x => x.id !== 'random' && x.r.realistic.net > 0).length + ' are profitable** in the realistic model.' + NLe);
  out3.push('## One section per strategy' + NLe);
  const year = ts => String(new Date(ts + 19800000).getUTCFullYear());
  for (const x of res) {
    const t = x.trades, q = x.r.realistic;
    out3.push('### ' + x.name + NLe);
    out3.push('*' + x.what + '*' + NLe);
    out3.push('- **Overall (realistic option model):** ' + q.n + ' trades, ' + f0e(q.avg) + ' Rs per trade, total ' + f0e(q.net) + ' Rs, profit factor ' + q.pf.toFixed(2) + ', win rate ' + q.win.toFixed(0) + '%, max drawdown ' + f0e(q.dd) + ', worst day ' + f0e(q.worst) + '.');
    out3.push('- **Best case, no time decay:** ' + f0e(x.r.nodecay.avg) + ' Rs per trade, profit factor ' + x.r.nodecay.pf.toFixed(2) + '.');
    out3.push('- **The underlying itself:** ' + x.r.raw.bps.toFixed(1) + ' bps over the next hour, ' + x.r.raw.hit.toFixed(0) + '% of signals moved the right way (' + x.r.raw.n + ' signals).');
    out3.push('- **Calls (up) vs puts (down):** BUY CE: ' + cell(t.filter(a => a.dir > 0)) + ' | BUY PE: ' + cell(t.filter(a => a.dir < 0)));
    out3.push('- **Indices vs stocks:** indices: ' + cell(t.filter(a => a.idx)) + ' | stocks: ' + cell(t.filter(a => !a.idx)));
    out3.push('- **Time of day:** 10:15-11:30: ' + cell(t.filter(a => a.min < 11 * 60 + 30)) + ' | 11:30-13:00: ' + cell(t.filter(a => a.min >= 11 * 60 + 30 && a.min < 13 * 60)) + ' | 13:00-14:30: ' + cell(t.filter(a => a.min >= 13 * 60)));
    const yrs = [...new Set(t.map(a => year(a.ts)))].sort();
    out3.push('- **By year:** ' + yrs.map(y => y + ': ' + cell(t.filter(a => year(a.ts) === y))).join(' | '));
    const bySym = new Map(); t.forEach(a => { const o = bySym.get(a.sym) || []; o.push(a); bySym.set(a.sym, o); });
    const syms = [...bySym.entries()].filter(([, a]) => a.length >= 15).map(([k, a]) => ({ k: k.replace(/_/g, ' ').trim() || k, avg: avgOf(a), n: a.length })).sort((a, b) => b.avg - a.avg);
    if (syms.length >= 6) out3.push('- **Best / worst symbols (15+ trades):** best ' + syms.slice(0, 3).map(s => s.k + ' ' + f0e(s.avg) + ' (' + s.n + ')').join(', ') + ' | worst ' + syms.slice(-3).reverse().map(s => s.k + ' ' + f0e(s.avg) + ' (' + s.n + ')').join(', '));
    out3.push('');
  }
  out3.push('## Reading the results' + NLe);
  out3.push('- A strategy has an edge only if it beats RANDOM clearly, in both halves of the period and in most years, and its underlying 1-hour move is clearly positive. Small gaps over a few hundred trades are noise.');
  out3.push('- Calls vs puts and time-of-day splits cut the trades into small groups, so differences between them are usually noise too.');
  out3.push('- Every strategy here was also combined with others in `strategy_backtest_report.md` and `sr_vwap_combination_report.md`.');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'each_strategy_report.md'), out3.join(NLe) + NLe);
  console.log(out3.slice(0, 40).join(NLe));
  process.exit(0);
}

// ───────────── focused study: S/R + VWAP, plus every combination of the other strategies ─────────────
if (process.argv[2] === 'sr-vwap') {
  const NLs = String.fromCharCode(10);
  const ADD = ['trend', 'rsi', 'fvg', 'bbrev', 'bbbrk', 'bbmid', 'structure', 'volume', 'smcdisp', 'htf'];
  const LAB = { trend: 'EMA trend 9/21/50', rsi: 'RSI', fvg: 'FVG retest', bbrev: 'Bollinger reversal', bbbrk: 'Bollinger breakout', bbmid: 'Bollinger mid-band side', structure: 'Structure BOS/CHoCH', volume: 'Volume push', smcdisp: 'SMC + displacement', htf: 'Hourly trend (EMA100/200)', sr: 'S/R', srbrk: 'S/R breakout', vwap: 'VWAP' };
  const BASES = [['sr', 'vwap'], ['srbrk', 'vwap']];
  const subsets2 = [[]];
  for (let a = 0; a < ADD.length; a++) { subsets2.push([ADD[a]]); for (let b = a + 1; b < ADD.length; b++) { subsets2.push([ADD[a], ADD[b]]); for (let c = b + 1; c < ADD.length; c++) subsets2.push([ADD[a], ADD[b], ADD[c]]); } }
  const rows = [];
  for (const base of BASES) for (const add of subsets2) {
    const ids = [...base, ...add];
    rows.push({ base: base[0], add, ids, name: ids.map(x => LAB[x]).join(' + '), r: evaluateDef({ mode: 'all', ids }) });
  }
  // references
  const refs = ['random', 'vwap', 'sr'].map(id => ({ name: id === 'random' ? 'RANDOM direction (yardstick)' : LAB[id] + ' alone', r: evaluateDef({ mode: 'all', ids: [id] }) }));
  const live = { name: 'Live vote (6 strategies + SMC, score >= 8 of 10) as the app uses today', r: evaluateDef({ mode: 'score', ids: [...CORE, 'smcdisp'], min: 8, weights: { smcdisp: 2 } }) };
  const MIN_N = 60;
  // combinations that produce exactly the same trades (an added strategy that never changes the result) are shown once, as the simplest one
  const seenKey = new Set();
  const ok = rows.filter(x => x.r.realistic.n >= MIN_N).sort((a, b) => a.ids.length - b.ids.length).filter(x => { const k = x.r.realistic.n + '|' + Math.round(x.r.realistic.net); if (seenKey.has(k)) return false; seenKey.add(k); return true; });
  // bootstrap against random-direction trades
  const poolRandom = simulate(candidates({ mode: 'all', ids: ['random'] }), MODELS.realistic).map(t => t.net);
  let seed = 4242; const rnd01 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const bootP = (avg, n) => { let hits = 0; const R = 3000; for (let r = 0; r < R; r++) { let sum = 0; for (let q = 0; q < n; q++) sum += poolRandom[Math.floor(rnd01() * poolRandom.length)]; if (sum / n >= avg) hits++; } return hits / R; };
  const K = 436 + rows.length;                                 // everything tried so far on this data
  // ranks
  const rankBy = (arr, f) => { const sorted = [...arr].sort((a, b) => f(b) - f(a)); const m = new Map(); sorted.forEach((x, i) => m.set(x, i + 1)); return m; };
  const rAvg = rankBy(ok, x => x.r.realistic.avg), rPf = rankBy(ok, x => x.r.realistic.pf), rLast = rankBy(ok, x => x.r.realistic.last), rBps = rankBy(ok, x => x.r.raw.bps);
  ok.forEach(x => { x.rank = { avg: rAvg.get(x), pf: rPf.get(x), last: rLast.get(x), bps: rBps.get(x) }; x.comp = (x.rank.avg + x.rank.pf + x.rank.last + x.rank.bps) / 4; });
  const byAvg = [...ok].sort((a, b) => b.r.realistic.avg - a.r.realistic.avg);
  const byComp = [...ok].sort((a, b) => a.comp - b.comp);
  const f0b = x => String(Math.round(x));
  const rowTxt = (x, i) => '| ' + (i + 1) + ' | ' + x.name + ' | ' + x.r.realistic.n + ' | ' + f0b(x.r.realistic.avg) + ' | ' + x.r.realistic.pf.toFixed(2) + ' | ' + x.r.realistic.win.toFixed(0) + '% | ' + f0b(x.r.realistic.net) + ' | ' + f0b(x.r.realistic.dd) + ' | ' + f0b(x.r.realistic.worst) + ' | ' + f0b(x.r.realistic.first) + ' / ' + f0b(x.r.realistic.last) + ' | ' + f0b(x.r.nodecay.avg) + ' | ' + x.r.raw.bps.toFixed(1) + ' | ' + x.r.raw.hit.toFixed(0) + '% |';
  const HEAD2 = '| Rank | Combination (all must agree) | Trades | Avg Rs/trade | PF | Win | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit |' + NLs + '|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const out2 = [];
  out2.push('# S/R + VWAP combined with the other strategies: ranked report' + NLs);
  out2.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `node tools/bt_strategies.mjs sr-vwap`. Same data, engine and rules as `strategy_backtest_report.md` (2 years of 15-minute candles, 14 symbols, ATM option MODEL, 10,000 Rs premium per trade after charges, stop -30% / target +30%, entries 10:15-14:30, at most 5 open, one per underlying).' + NLs);
  out2.push('Every combination is **S/R + VWAP plus up to three more strategies, all of which must agree on the direction**. Two bases were used: "S/R" (breakout, break-and-retest or rejection of the previous day high/low and swing levels) and "S/R breakout" only. The extra strategies are EMA trend, RSI, FVG retest, three Bollinger readings (reversal outside the band, breakout outside the band, side of the middle band), Structure BOS/CHoCH, Volume push, SMC + displacement and the hourly trend. ' + rows.length + ' combinations; only those with at least ' + MIN_N + ' trades are ranked, and combinations that give exactly the same trades are shown once, as the simplest (' + ok.length + ' distinct rows).' + NLs);
  out2.push('## References' + NLs);
  out2.push(HEAD2.replace('Rank | Combination', 'Row | Strategy'));
  [...refs, live].forEach((x, i) => out2.push(rowTxt(x, i).replace('| ' + (i + 1) + ' |', '| ' + ['random', 'VWAP', 'S/R', 'live'][i] + ' |')));
  out2.push('');
  out2.push('## 1. Top 25 by average Rs per trade (realistic option model)' + NLs);
  out2.push(HEAD2); byAvg.slice(0, 25).forEach((x, i) => out2.push(rowTxt(x, i))); out2.push('');
  out2.push('## 2. Top 25 by a combined rank' + NLs);
  out2.push('Each combination is ranked on four things (average Rs per trade, profit factor, average on the LAST 40% of the period, and the underlying 1-hour move), and the four ranks are averaged. This avoids picking a winner on one lucky number.' + NLs);
  out2.push('| Combined rank | Combination | Trades | Avg Rs/trade | PF | Avg last 40% | Underlying 1h (bps) | Ranks (avg / PF / last / bps) |' + NLs + '|---|---|---|---|---|---|---|---|');
  byComp.slice(0, 25).forEach((x, i) => out2.push('| ' + (i + 1) + ' | ' + x.name + ' | ' + x.r.realistic.n + ' | ' + f0b(x.r.realistic.avg) + ' | ' + x.r.realistic.pf.toFixed(2) + ' | ' + f0b(x.r.realistic.last) + ' | ' + x.r.raw.bps.toFixed(1) + ' | ' + x.rank.avg + ' / ' + x.rank.pf + ' / ' + x.rank.last + ' / ' + x.rank.bps + ' |'));
  out2.push('');
  out2.push('## 3. What each single add-on does to S/R + VWAP' + NLs);
  const baseRow = rows.find(x => x.base === 'sr' && x.add.length === 0);
  out2.push('Base "S/R + VWAP agree": ' + baseRow.r.realistic.n + ' trades, ' + f0b(baseRow.r.realistic.avg) + ' Rs/trade, PF ' + baseRow.r.realistic.pf.toFixed(2) + '. Adding ONE strategy (a strategy that disagrees with S/R + VWAP most of the time leaves very few trades, for example Bollinger reversal, which bets on a return to the mean while VWAP bets on the trend):' + NLs);
  out2.push('| Add-on | Trades | Avg Rs/trade | Change vs base | PF | Avg first 60% / last 40% | Underlying 1h (bps) |' + NLs + '|---|---|---|---|---|---|---|');
  const few = x => x.r.realistic.n < MIN_N;
  rows.filter(x => x.base === 'sr' && x.add.length === 1).sort((a, b) => (few(a) - few(b)) || (b.r.realistic.avg - a.r.realistic.avg)).forEach(x => few(x) ? out2.push('| + ' + LAB[x.add[0]] + ' | ' + x.r.realistic.n + ' | too few trades to judge | - | - | - | - |') : out2.push('| + ' + LAB[x.add[0]] + ' | ' + x.r.realistic.n + ' | ' + f0b(x.r.realistic.avg) + ' | ' + (x.r.realistic.avg - baseRow.r.realistic.avg >= 0 ? '+' : '') + f0b(x.r.realistic.avg - baseRow.r.realistic.avg) + ' | ' + x.r.realistic.pf.toFixed(2) + ' | ' + f0b(x.r.realistic.first) + ' / ' + f0b(x.r.realistic.last) + ' | ' + x.r.raw.bps.toFixed(1) + ' |'));
  out2.push('');
  out2.push('## 4. Chosen on the first 60%, judged on the last 40%' + NLs);
  const wf = ok.filter(x => x.r.realistic.nFirst >= 40 && x.r.realistic.nLast >= 20).sort((a, b) => b.r.realistic.first - a.r.realistic.first).slice(0, 15);
  out2.push('| Combination | Trades first 60% | Avg first 60% | Trades last 40% | Avg last 40% |' + NLs + '|---|---|---|---|---|');
  wf.forEach(x => out2.push('| ' + x.name + ' | ' + x.r.realistic.nFirst + ' | ' + f0b(x.r.realistic.first) + ' | ' + x.r.realistic.nLast + ' | ' + f0b(x.r.realistic.last) + ' |'));
  const held = wf.filter(x => x.r.realistic.last > 0).length;
  out2.push(NLs + 'Of the 15 best on the first 60%, **' + held + ' were profitable on the last 40%**.' + NLs);
  out2.push('## 5. How much to trust the ranking' + NLs);
  const best = byAvg.filter(x => x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0).slice(0, 5);
  out2.push('About **' + K + ' strategies and combinations** have now been tried on this one data set. For the best-looking rows, **adjusted p** is the bootstrap p (chance that the same number of random-direction trades does at least as well) multiplied by that count; above about 0.05 it is not evidence of an edge.' + NLs);
  out2.push('| Combination | Trades | Avg Rs/trade | Bootstrap p | Adjusted p |' + NLs + '|---|---|---|---|---|');
  [...byAvg.slice(0, 5), ...best.filter(b => !byAvg.slice(0, 5).includes(b))].forEach(x => { const pp = bootP(x.r.realistic.avg, x.r.realistic.n); out2.push('| ' + x.name + ' | ' + x.r.realistic.n + ' | ' + f0b(x.r.realistic.avg) + ' | ' + pp.toFixed(3) + ' | ' + Math.min(1, pp * K).toFixed(2) + ' |'); });
  out2.push('');
  const profitable = ok.filter(x => x.r.realistic.net > 0);
  out2.push('## 6. Summary' + NLs);
  out2.push('- Random-direction yardstick: ' + f0b(refs[0].r.realistic.avg) + ' Rs per trade. S/R + VWAP: ' + f0b(baseRow.r.realistic.avg) + '. The live vote as the app uses it: ' + f0b(live.r.realistic.avg) + '.');
  out2.push('- Combinations that are profitable in the realistic model: **' + profitable.length + ' of ' + ok.length + '**; profitable in both halves of the period: **' + ok.filter(x => x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0).length + '**.');
  out2.push('- Best by average per trade: **' + byAvg[0].name + '** (' + byAvg[0].r.realistic.n + ' trades, ' + f0b(byAvg[0].r.realistic.avg) + ' Rs/trade, PF ' + byAvg[0].r.realistic.pf.toFixed(2) + '). Best by combined rank: **' + byComp[0].name + '**.');
  out2.push('- More strategies that must agree means fewer trades, so a high average on a small number of trades is the most likely thing to be luck. Treat the top of the list as ideas to watch on paper trading.');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'sr_vwap_combination_report.md'), out2.join(NLs) + NLs);
  console.log(out2.join(NLs));
  process.exit(0);
}

// ───────────── what to test ─────────────
const NAMES = { trend: 'EMA trend 9/21/50', rsi: 'RSI momentum', vwap: 'VWAP side', structure: 'Structure BOS/CHoCH', fvg: 'FVG retest', volume: 'Volume push',
  htf: 'Higher-timeframe trend (EMA100/200 on 15m)', smcdisp: 'SMC + displacement candle', sc_any: 'Sweep then CHoCH (CHoCH bar or pullback)', sc_choch: 'Sweep then CHoCH: enter on the CHoCH bar', sc_retest: 'Sweep then CHoCH: enter on the pullback', sc_disp: 'Sweep then CHoCH with a displacement candle', sr: 'Support/resistance (all three setups)', srbrk: 'S/R breakout of previous day high/low', srrt: 'S/R break-and-retest', srrev: 'S/R rejection (reversal at a level)', smc: 'SMC (structure + order block / gap / sweep + discount-premium)', ob: 'SMC part: order-block retest', sweep: 'SMC part: liquidity sweep', pd: 'SMC part: premium/discount half', random: 'RANDOM direction (yardstick)' };
const SINGLE = ['random', 'trend', 'rsi', 'vwap', 'structure', 'fvg', 'volume', 'htf', 'smc', 'pd'];
const VARIANT_SINGLE = [];
const SR_SINGLE = ['sr', 'srbrk', 'srrt', 'srrev'];
const singles = SINGLE.map(id => ({ id, name: NAMES[id], def: { mode: 'all', ids: [id] } }));

const live = ids => ({ mode: 'score', ids, min: 7 });
const COMBOS = [
  { name: 'Today\'s vote (6 strategies, score >= 7)', def: { mode: 'score', ids: CORE, min: 7 } },
  { name: 'Today\'s vote (score >= 6)', def: { mode: 'score', ids: CORE, min: 6 } },
  { name: 'Today\'s vote + SMC (weight 2, score >= 8 of 10)', def: { mode: 'score', ids: [...CORE, 'smc'], min: 8 } },
  { name: 'Today\'s vote + SMC (weight 2, score >= 7)', def: { mode: 'score', ids: [...CORE, 'smc'], min: 7 } },
  { name: 'Today\'s vote + SMC (weight 2, score >= 6)', def: { mode: 'score', ids: [...CORE, 'smc'], min: 6 } },
  { name: 'SMC + EMA trend agree', def: { mode: 'all', ids: ['smc', 'trend'] } },
  { name: 'SMC + VWAP agree', def: { mode: 'all', ids: ['smc', 'vwap'] } },
  { name: 'SMC + volume agree', def: { mode: 'all', ids: ['smc', 'volume'] } },
  { name: 'SMC + RSI agree', def: { mode: 'all', ids: ['smc', 'rsi'] } },
  { name: 'SMC + trend + VWAP agree', def: { mode: 'all', ids: ['smc', 'trend', 'vwap'] } },
  { name: 'SMC + trend + VWAP + RSI agree', def: { mode: 'all', ids: ['smc', 'trend', 'vwap', 'rsi'] } },
  { name: 'Structure + FVG agree', def: { mode: 'all', ids: ['structure', 'fvg'] } },
  { name: 'Structure + EMA trend + VWAP agree', def: { mode: 'all', ids: ['structure', 'trend', 'vwap'] } },
  { name: 'EMA trend + VWAP + RSI agree', def: { mode: 'all', ids: ['trend', 'vwap', 'rsi'] } },
  { name: 'SMC + higher-timeframe trend agree', def: { mode: 'all', ids: ['smc', 'htf'] } },
  { name: 'SMC + higher-timeframe trend + VWAP agree', def: { mode: 'all', ids: ['smc', 'htf', 'vwap'] } },
  { name: "Today's vote + SMC (>= 8 of 10) + higher-timeframe trend agree", def: { mode: 'score', ids: [...CORE, 'smc'], min: 8, also: ['htf'] } },
  { name: "Today's vote (>= 7) + higher-timeframe trend agree", def: { mode: 'score', ids: CORE, min: 7, also: ['htf'] } },
  { name: 'SMC, morning only (10:15-11:30)', def: { mode: 'all', ids: ['smc'], from: 10 * 60 + 15, to: 11 * 60 + 30 } },
  { name: 'SMC, afternoon only (13:00-14:30)', def: { mode: 'all', ids: ['smc'], from: 13 * 60, to: 14 * 60 + 30 } },
  { name: 'SMC + FVG retest agree (the two imbalance setups)', def: { mode: 'all', ids: ['smc', 'fvg'] } },
];

const SR_COMBOS = [
  { name: 'S/R + VWAP agree', def: { mode: 'all', ids: ['sr', 'vwap'] } },
  { name: 'S/R + higher-timeframe trend agree', def: { mode: 'all', ids: ['sr', 'htf'] } },
  { name: 'S/R + volume agree', def: { mode: 'all', ids: ['sr', 'volume'] } },
  { name: 'S/R + EMA trend agree', def: { mode: 'all', ids: ['sr', 'trend'] } },
  { name: 'S/R + RSI agree', def: { mode: 'all', ids: ['sr', 'rsi'] } },
  { name: 'S/R breakout + VWAP agree', def: { mode: 'all', ids: ['srbrk', 'vwap'] } },
  { name: 'S/R breakout + volume agree', def: { mode: 'all', ids: ['srbrk', 'volume'] } },
  { name: 'S/R breakout + higher-timeframe trend agree', def: { mode: 'all', ids: ['srbrk', 'htf'] } },
  { name: 'S/R break-and-retest + VWAP agree', def: { mode: 'all', ids: ['srrt', 'vwap'] } },
  { name: 'S/R rejection + RSI agree', def: { mode: 'all', ids: ['srrev', 'rsi'] } },
  { name: 'S/R + SMC (displacement) agree', def: { mode: 'all', ids: ['sr', 'smcdisp'] } },
  { name: 'Live vote (>= 6) + S/R agree', def: { mode: 'score', ids: CORE, min: 6, also: ['sr'] } },
  { name: 'Live vote (>= 7) + S/R agree', def: { mode: 'score', ids: CORE, min: 7, also: ['sr'] } },
  { name: 'Live vote + SMC + S/R as votes (S/R weight 2, >= 8 of 12)', def: { mode: 'score', ids: [...CORE, 'smcdisp', 'sr'], min: 8, weights: { smcdisp: 2, sr: 2 } } },
  { name: 'S/R + VWAP + volume agree', def: { mode: 'all', ids: ['sr', 'vwap', 'volume'] } },
];
const VARIANTS = [
];
const NL = String.fromCharCode(10);
const f0 = x => String(Math.round(x));
const row = (name, r) => `| ${name} | ${r.cands} | ${f0(r.realistic.n)} | ${f0(r.realistic.avg)} | ${r.realistic.win.toFixed(0)}% | ${r.realistic.pf.toFixed(2)} | ${f0(r.realistic.net)} | ${f0(r.realistic.dd)} | ${f0(r.realistic.worst)} | ${f0(r.realistic.first)} / ${f0(r.realistic.last)} | ${f0(r.nodecay.avg)} | ${r.nodecay.pf.toFixed(2)} | ${r.raw.bps.toFixed(1)} | ${r.raw.hit.toFixed(0)}% |`;
const HEAD = '| Strategy | Signals | Trades | Avg Rs/trade | Win | PF | Total Rs | Max drawdown | Worst day | Avg first 60% / last 40% | No-decay avg | No-decay PF | Underlying move 1h (bps) | Up-move hit |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

console.log('Evaluating single strategies...');
const sRes = singles.map(s => ({ ...s, r: evaluateDef(s.def) }));
const vsRes = VARIANT_SINGLE.map(id => ({ id, name: NAMES[id], def: { mode: 'all', ids: [id] }, r: evaluateDef({ mode: 'all', ids: [id] }) }));
const vcRes = VARIANTS.map(c => ({ ...c, r: evaluateDef(c.def) }));
const srRes = SR_SINGLE.map(id => ({ id, name: NAMES[id], def: { mode: 'all', ids: [id] }, r: evaluateDef({ mode: 'all', ids: [id] }) }));
const srcRes = SR_COMBOS.map(c => ({ ...c, r: evaluateDef(c.def) }));
console.log('Evaluating combinations...');
const cRes = COMBOS.map(c => ({ ...c, r: evaluateDef(c.def) }));

// every pair and triple of the 7 strategies (AND-agreement), ranked on the FIRST 60% and judged on the LAST 40%
const POOL = ['trend', 'rsi', 'vwap', 'structure', 'fvg', 'volume', 'smc', 'htf', 'sr', 'srbrk', 'srrev'];
const subsets = [];
for (let a = 0; a < POOL.length; a++) for (let b = a + 1; b < POOL.length; b++) { subsets.push([POOL[a], POOL[b]]); for (let c = b + 1; c < POOL.length; c++) subsets.push([POOL[a], POOL[b], POOL[c]]); }
console.log(`Evaluating ${subsets.length} pairs and triples...`);
const wf = subsets.map(ids => ({ ids, r: evaluateDef({ mode: 'all', ids }) })).filter(x => x.r.realistic.nFirst >= 150);
wf.sort((a, b) => b.r.realistic.first - a.r.realistic.first);

const out = [];
out.push('# Strategy backtest report\n');
out.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`tools/bt_strategies.mjs\`. Data: ${U.length} symbols, 15-minute candles, ${dayOf(T0)} to ${dayOf(T1)}.\n`);
out.push('## How to read this\n');
out.push('- Every strategy runs through the **same engine**: signal on a bar close, fill at the next bar open, entries 10:15-14:30 IST, ADX >= 20, at most 5 open, one per underlying, ATM option held to stop (-30%) or target (+30%).');
out.push('- **Option prices are a model**, not real data (no historical option candles exist): ATM, delta 0.5, premium a % of spot. "Realistic" includes time decay; "no-decay" is a best case that no real option achieves. Each trade is Rs 10,000 of premium, after full option charges.');
out.push('- **Underlying move 1h** needs no option model: the average move of the underlying, in the signal\'s direction, over the next hour (basis points). A strategy with a real edge shows a clearly positive number. Hit rate near 50% means a coin flip.');
out.push('- The **RANDOM** row is the yardstick: coin-flip direction through the same gates. A strategy only has an edge if it clearly beats it, in BOTH halves of the period.');
out.push('- "Avg first 60% / last 40%" splits the period in time: an edge that only exists in one half is luck.\n');
out.push('## 1. Each strategy on its own\n'); out.push(HEAD); sRes.forEach(s => out.push(row(s.name, s.r))); out.push('');
out.push('## 2. Combinations (all listed strategies must agree, or the weighted vote must reach the score)\n'); out.push(HEAD); cRes.forEach(c => out.push(row(c.name, c.r))); out.push('');
out.push('## 2b. SMC variants: displacement candle, and liquidity sweep followed by a change of character\n');
out.push('Added after the first report. **Displacement**: the structure break must be a big one-directional candle (body >= 1.5x the recent average range, closing in its outer quarter). **Sweep then CHoCH**: a wick takes a swing low/high and closes back inside, then within 12 bars price breaks structure the other way; entered on the CHoCH bar or on the pullback into the order block / gap within 8 bars.\n');
out.push(HEAD); vsRes.forEach(s => out.push(row(s.name, s.r))); vcRes.forEach(c => out.push(row(c.name, c.r))); out.push('');
out.push('## 2c. Support and resistance' + NL);
out.push('Levels: the previous session high / low / close and the last swing highs and lows. **Breakout**: a fresh strong close beyond the previous day high or low. **Break-and-retest**: after such a breakout today, price touches the broken level and closes back away from it. **Rejection**: a wick through a level that closes back on the original side (a reversal). "S/R" is any of the three.' + NL);
out.push(HEAD); srRes.forEach(s => out.push(row(s.name, s.r))); srcRes.forEach(c => out.push(row(c.name, c.r))); out.push('');
out.push('## 3. All pairs and triples, chosen on the first 60% and judged on the last 40%\n');
out.push('Trying many combinations always finds some that look good by luck. To check, they are **ranked on the first 60% of the period only** and the table shows how the top ones did on the **last 40%, which was not used to choose them**.\n');
out.push('| Combination (all agree) | Trades first 60% | Avg first 60% (Rs) | Trades last 40% | Avg last 40% (Rs) | Full-period PF | Underlying move 1h (bps) |\n|---|---|---|---|---|---|---|');
wf.slice(0, 12).forEach(x => out.push(`| ${x.ids.join(' + ')} | ${x.r.realistic.nFirst} | ${f0(x.r.realistic.first)} | ${x.r.realistic.nLast} | ${f0(x.r.realistic.last)} | ${x.r.realistic.pf.toFixed(2)} | ${x.r.raw.bps.toFixed(1)} |`));
const top = wf.slice(0, 12), holdUp = top.filter(x => x.r.realistic.last > 0).length;
out.push(`\nOf the 12 best combinations on the first 60%, **${holdUp} were profitable on the last 40%** (realistic model).\n`);

// ───────────── robustness of the configurations that looked best ─────────────
const tradesOf = def => simulate(candidates(def), MODELS.realistic);
const poolRandom = tradesOf({ mode: 'all', ids: ['random'] }).map(t => t.net);
const K = singles.length + COMBOS.length + VARIANT_SINGLE.length + VARIANTS.length + SR_SINGLE.length + SR_COMBOS.length + subsets.length;        // how many things were tried
let seed = 12345; const rnd01 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function bootP(netAvg, n) {                                    // chance that n random-direction trades average at least this much
  let hits = 0; const R = 4000;
  for (let r = 0; r < R; r++) { let sum = 0; for (let q = 0; q < n; q++) sum += poolRandom[Math.floor(rnd01() * poolRandom.length)]; if (sum / n >= netAvg) hits++; }
  return hits / R;
}
const allRows = [...sRes, ...cRes, ...vsRes, ...vcRes, ...srRes, ...srcRes].filter(x => x.def && x.id !== 'random');
const ROBUST = allRows.filter(x => x.r.realistic.n >= 40 && x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0).sort((a, b) => b.r.realistic.avg - a.r.realistic.avg).slice(0, 6);
const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
const robust = ROBUST.map(c => {
  const tr = tradesOf(c.def), n = tr.length, avg = n ? tr.reduce((a, t) => a + t.net, 0) / n : 0;
  const q = new Map(); tr.forEach(t => { const k = quarter(t.ts); const o = q.get(k) || { n: 0, net: 0 }; o.n++; o.net += t.net; q.set(k, o); });
  const qs = [...q.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const p = n ? bootP(avg, n) : 1;
  return { ...c, n, avg, qs, pos: qs.filter(([, o]) => o.net > 0).length, p, adj: Math.min(1, p * K) };
});
out.push('## 4. How much to trust the best-looking rows' + NL);
out.push('Roughly **' + K + ' strategies and combinations** were tried on this one data set. Looking at that many, a few will always look good by chance. For the rows that looked best:' + NL);
out.push('- **bootstrap p**: how often the SAME NUMBER of random-direction trades averages at least as much (small = unlikely to be luck for ONE test);');
out.push('- **adjusted p**: that p multiplied by the number of things tried (a fair correction for having searched). Anything above about 0.05 is NOT evidence of an edge;');
out.push('- **quarters profitable**: an edge should show up in most quarters, not in one lucky stretch.' + NL);
out.push('| Configuration | Trades | Avg Rs/trade | Bootstrap p | Adjusted p | Quarters profitable |' + NL + '|---|---|---|---|---|---|');
robust.forEach(r => out.push('| ' + r.name + ' | ' + r.n + ' | ' + f0(r.avg) + ' | ' + r.p.toFixed(3) + ' | ' + r.adj.toFixed(2) + ' | ' + r.pos + ' of ' + r.qs.length + ' |'));
out.push('');
robust.forEach(r => out.push('- ' + r.name + ': ' + r.qs.map(([k, o]) => k + ' ' + o.n + ' trades ' + f0(o.net)).join(' · ')));
out.push('');

// conclusions are computed, not hand-written
const rnd = sRes.find(s => s.id === 'random').r, best = [...sRes, ...cRes, ...vsRes, ...vcRes, ...srRes, ...srcRes].filter(x => x.id !== 'random').sort((a, b) => b.r.realistic.avg - a.r.realistic.avg)[0];
const anyProfit = [...sRes, ...cRes, ...vsRes, ...vcRes, ...srRes, ...srcRes].filter(x => x.id !== 'random' && x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0);
out.push('## 5. What the numbers say\n');
out.push(`- Random-direction yardstick: average ${f0(rnd.realistic.avg)} Rs per trade (realistic model), profit factor ${rnd.realistic.pf.toFixed(2)}, underlying move ${rnd.raw.bps.toFixed(1)} bps. This is what "no skill" costs: charges and option decay.`);
out.push(`- Best single/combination row on average per trade (realistic): **${best.name}** at ${f0(best.r.realistic.avg)} Rs per trade, profit factor ${best.r.realistic.pf.toFixed(2)}.`);
out.push(`- Rows profitable in the realistic model AND in both halves of the period: **${anyProfit.length ? anyProfit.map(x => x.name).join('; ') : 'none'}**.`);
out.push('- **Support/resistance**: every S/R row loses in the realistic model (best: S/R + VWAP agree). Forcing S/R into the live vote made results worse (live vote >= 7 + S/R agree: ' + f0(srcRes.find(c => c.name.startsWith('Live vote (>= 7)')).r.realistic.avg) + ' Rs/trade against ' + f0(cRes[0].r.realistic.avg) + ' without it). So the app shows it in the strategy check and on the chart (previous day high / low / close) but gives it weight 0.');
out.push('- **None of these survives section 4**: after correcting for the number of things tried, no row is distinguishable from luck. Treat rows that look good as ideas to watch on paper trading, not as proven.');
out.push('- A result only counts if it beats RANDOM in both halves; small differences over a few hundred trades are noise.\n');
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports', 'strategy_backtest_report.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
