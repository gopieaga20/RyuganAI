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
import { srSignal } from '../frontend/js/sr.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools', '.cache');
const INDEX = new Set(['_NSEI', '_NSEBANK']);
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json') && !f.includes('BSESN'));
const WINDOW = 250;

// ───────────── per-bar signals for every strategy ─────────────
const U = files.map(f => {
  const sym = f.replace('ANGEL_', '').replace('_15m_730d.json', '');
  const candles = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const pre = JSON.parse(fs.readFileSync(path.join(dir, 'pre_' + f), 'utf8'));
  const cacheF = path.join(dir, `smc3_${sym}.json`);
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
  const srF = path.join(dir, `sr_${sym}.json`);
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
    default: return 0;
  }
}
/** A signal definition: {ids:[...], mode:'all'|'score', min, weights}. Returns +1/-1/0. */
function signal(u, i, def) {
  const d0 = signal0(u, i, def);
  if (d0 && def.also) for (const id of def.also) if (vote(u, i, id) !== d0) return 0;      // extra strategies that must agree with the main signal
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
const SLP = 0.30, TPP = 0.30, MAXPOS = 5, DELTA = 0.5;
const MODELS = {
  realistic: { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20 },
  nodecay: { idxPrem: 0.0055, idxTheta: 0.0, idxLife: 1e9, stkPrem: 0.02, stkTheta: 0.0, stkLife: 1e9 },
};
const dayOf = ts => new Date(ts + 19800000).toISOString().slice(0, 10);

function candidates(def) {
  const out = [];
  for (const u of U) {
    for (let i = 60; i < u.candles.length - 1; i++) {
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
  const u = c.u, cs = u.candles, e = cs[c.i + 1].o, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem);
  const theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife, t0 = cs[c.i + 1].ts;
  for (let j = c.i + 1; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - t0) / 86400000, decay = theta * days * p0;
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
    const ent = 10000, ext = ent * (1 + r.ret), chg = Indicators.charges(ent, ext, 1, 'options');
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
const T0 = Math.min(...allTs), T1 = Math.max(...allTs), CUT = T0 + (T1 - T0) * 0.6;

function evaluateDef(def) {
  const cands = candidates(def);
  const res = { cands: cands.length, raw: rawEdge(cands) };
  for (const [mn, P] of Object.entries(MODELS)) res[mn] = stats(simulate(cands, P), CUT);
  return res;
}




// ───────────── rules on the LuxAlgo outputs: node tools/bt_strategies.mjs smc-rules ─────────────
if (process.argv[2] === 'smc-rules' || process.argv[2] === 'smc-combos') {
  const COMBOS_MODE = process.argv[2] === 'smc-combos';
  const NLs = String.fromCharCode(10);
  for (const u of U) u.rules = ruleRows(u.candles);
  const f0s = x => String(Math.round(x));
  const defs = [];
  if (!COMBOS_MODE) {
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
  const bootP = (avg, n) => { let hits = 0; const R = 3000; for (let k = 0; k < R; k++) { let sum = 0; for (let q = 0; q < n; q++) sum += pool[Math.floor(r01() * pool.length)]; if (sum / n >= avg) hits++; } return hits / R; };
  const quarter = ts => { const d = new Date(ts + 19800000); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };
  for (const x of rows) {
    const q = x.r.realistic, n = q.n;
    x.p = n >= 20 ? bootP(q.avg, n) : 1; x.adj = Math.min(1, x.p * K);
    const byQ = new Map(); x.trades.forEach(t => { const k = quarter(t.ts); byQ.set(k, (byQ.get(k) || 0) + t.net); });
    x.qPos = [...byQ.values()].filter(v => v > 0).length; x.qN = byQ.size;
  }
  const out = [];
  out.push(COMBOS_MODE ? '# SMC combined with the other strategies' + NLs : '# Rules built on the LuxAlgo SMC outputs' + NLs);
  out.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `node tools/bt_strategies.mjs ' + (COMBOS_MODE ? 'smc-combos' : 'smc-rules') + '`. Same engine as the other reports: signal at a bar close, fill at the next open, entries 10:15-14:30 IST, ADX >= 20, ATM option held to -30% / +30%, 10,000 Rs premium per trade after full option charges, 14 symbols, 2 years of 15-minute candles, **modelled option prices** (no historical option candles exist). ' + (COMBOS_MODE ? 'SMC = the LuxAlgo-port vote of `frontend/js/smc.js` (internal trend + order block tap + discount/premium); the second base drops the discount/premium condition so it fires more often. Each is combined with every other strategy (pairs that must agree, triples, and as a weight-2 vote added to the live six-strategy score).' : 'Rule definitions are in `tools/smc_rules.mjs`; they use only the indicator outputs of `frontend/js/smc.js` (structure events, order blocks, equal highs/lows, fair value gaps, swing range).') + NLs);
  out.push((COMBOS_MODE ? '' : 'Each rule is also tried with VWAP and with the higher-timeframe trend (EMA100/200) agreeing. ') + '**' + K + ' variants** were tried. With that many tries a few look good by luck, so the table shows a bootstrap p-value (how often the same number of random-direction trades does as well) and the p-value times ' + K + ' (**adjusted p**: above about 0.05 is NOT evidence of an edge). `Quarters` = quarters with a profit.' + NLs);
  out.push('Random-direction yardstick (no skill): **' + f0s(rnd.r.realistic.avg) + ' Rs per trade**, profit factor ' + rnd.r.realistic.pf.toFixed(2) + ', ' + rnd.r.realistic.n + ' trades.' + NLs);
  out.push('| Rank | Rule | Signals | Trades | Avg Rs/trade | PF | Win | Total Rs | First 60% / last 40% | No-decay avg | Underlying 1h (bps) | Up-move hit | p | Adjusted p | Quarters |' + NLs + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  [...rows].sort((a, b) => b.r.realistic.avg - a.r.realistic.avg).forEach((x, i) => {
    const q = x.r.realistic;
    out.push('| ' + (i + 1) + ' | ' + x.name + ' | ' + x.r.cands + ' | ' + q.n + ' | ' + (q.n ? f0s(q.avg) : '-') + ' | ' + q.pf.toFixed(2) + ' | ' + q.win.toFixed(0) + '% | ' + f0s(q.net) + ' | ' + (q.nFirst ? f0s(q.first) : '-') + ' / ' + (q.nLast ? f0s(q.last) : '-') + ' | ' + f0s(x.r.nodecay.avg) + ' | ' + x.r.raw.bps.toFixed(1) + ' | ' + x.r.raw.hit.toFixed(0) + '% | ' + (q.n >= 20 ? x.p.toFixed(3) : '-') + ' | ' + (q.n >= 20 ? x.adj.toFixed(2) : '-') + ' | ' + x.qPos + ' of ' + x.qN + ' |');
  });
  out.push('');
  const both = rows.filter(x => x.r.realistic.n >= 40 && x.r.realistic.net > 0 && x.r.realistic.first > 0 && x.r.realistic.last > 0);
  const sig = rows.filter(x => x.r.realistic.n >= 40 && x.adj < 0.05);
  const beatsRandom = rows.filter(x => x.r.realistic.n >= 40 && x.r.realistic.avg > rnd.r.realistic.avg);
  out.push('## What the numbers say' + NLs);
  out.push('- Variants with at least 40 trades that beat the random yardstick on the average trade: **' + beatsRandom.length + ' of ' + rows.filter(x => x.r.realistic.n >= 40).length + '**.');
  out.push('- Variants with at least 40 trades that were profitable overall AND in both halves of the period: **' + (both.length ? both.map(x => x.name + ' (' + x.r.realistic.n + ' trades, ' + f0s(x.r.realistic.avg) + ' Rs)').join('; ') : 'none') + '**.');
  out.push('- Variants with at least 40 trades and an adjusted p below 0.05 (a real edge after correcting for the ' + K + ' tries): **' + (sig.length ? sig.map(x => x.name).join('; ') : 'none') + '**.');
  out.push('- Many rules fire only a few dozen times in two years; a result on that few trades says very little either way.');
  out.push('');
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
  fs.writeFileSync(path.join(root, 'reports', COMBOS_MODE ? 'smc_combinations_report.md' : 'smc_rules_report.md'), out.join(NLs) + NLs);
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
