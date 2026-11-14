// Why do high-confidence (85%+) calls so often reverse after entry, and does anything predict it?
//   node tools/bt_reversal.mjs     -> prints and writes reports/reversal_study.md
//
// A "high-confidence call" here is what the app called 85%+ before the SMC vote existed: the six core strategies (EMA trend, RSI, VWAP,
// structure, FVG, volume) voting 7 or more of 8 in one direction with ADX >= 20 (about 89% confidence), read on a 15-minute bar's close, entered at
// the NEXT bar's open, 10:15-14:30 IST, at-the-money option MODEL (delta 0.5, premium a % of spot, time decay), stop -30% / target +30%.
// Each symbol is studied on its own (one position at a time per symbol, no 5-position cap, so the numbers describe the signal, not the portfolio).
//
// "Reversal" = the option hit its -30% stop before its +30% target.
// For every signal we record what the market looked like at the signal (how stretched, how many candles in a row, how close to a level ...)
// and ask which of those predicts a reversal. Filters are then tuned on the FIRST 60% of the period and judged only on the LAST 40%.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Indicators } from '../frontend/js/indicators.js';
import { istParts, vwapIst } from '../frontend/js/candles.js';
import { sessionLevels, avgRange } from '../frontend/js/sr.js';
import { pivots } from '../frontend/js/sr.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools', '.cache');
const INDEX = new Set(['_NSEI', '_NSEBANK']);
const NAME = { _NSEI: 'NIFTY 50', _NSEBANK: 'BANK NIFTY' };
const files = fs.readdirSync(dir).filter(f => f.startsWith('ANGEL_') && f.endsWith('_15m_730d.json') && !f.includes('BSESN'));
const U = files.map(f => {
  const sym = f.replace('ANGEL_', '').replace('_15m_730d.json', '');
  const candles = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const pre = JSON.parse(fs.readFileSync(path.join(dir, 'pre_' + f), 'utf8'));
  const cl = candles.map(c => c.c);
  return { sym, label: NAME[sym] || sym.replace('_NS', ''), isIndex: INDEX.has(sym), candles, pre, meta: candles.map(c => istParts(c.ts)), ema21: Indicators.ema(cl, 21), vwap: vwapIst(candles) };
});

const SLP = 0.30, TPP = 0.30, DELTA = 0.5;
const P = { idxPrem: 0.0055, idxTheta: 0.07, idxLife: 4, stkPrem: 0.02, stkTheta: 0.03, stkLife: 20 };

/** The option, entered at bar `idx` at price `e`, walked forward to its stop, target or expiry. */
function runOption(u, idx, e, dirn) {
  const cs = u.candles, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem), theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife, t0 = cs[idx].ts;
  for (let j = idx; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - t0) / 86400000, decay = theta * days * p0;
    const fav = dirn > 0 ? b.h - e : e - b.l, adv = dirn > 0 ? b.l - e : e - b.h;
    if (p0 + DELTA * adv - decay <= p0 * (1 - SLP)) return { exitTs: b.ts, ret: -SLP, why: 'SL' };
    if (p0 + DELTA * fav - decay >= p0 * (1 + TPP)) return { exitTs: b.ts, ret: TPP, why: 'TP' };
    if (days >= life) { const mv = dirn > 0 ? b.c - e : e - b.c; return { exitTs: b.ts, ret: Math.max(0, DELTA * mv) / p0 - 1, why: 'EXP' }; }
  }
  const b = cs[cs.length - 1], days = (b.ts - t0) / 86400000, mv = dirn > 0 ? b.c - e : e - b.c;
  return { exitTs: b.ts, ret: Math.max(0, p0 + DELTA * mv - theta * days * p0) / p0 - 1, why: 'END' };
}
const net = r => { const ent = 10000, ext = ent * (1 + r.ret); return ext - ent - Indicators.charges(ent, ext, 1, 'options'); };

/** Features describing how the market looked at the signal bar (all signed so that positive = in the trade's direction). */
function features(u, i, d) {
  const cs = u.candles, c = cs[i], atr = avgRange(cs, i);
  if (!(atr > 0)) return null;
  let run = 0; for (let q = i; q >= Math.max(0, i - 20); q--) { if ((cs[q].c - cs[q].o) * d > 0) run++; else break; }
  let dayOpen = c.o; for (let q = i; q >= 0 && u.meta[q].day === u.meta[i].day; q--) dayOpen = cs[q].o;
  const L = sessionLevels(cs, i);
  const win = cs.slice(Math.max(0, i - 249), i + 1), pv = pivots(win, win.length - 1, 3);
  const levels = [];
  if (L) levels.push(L.pdh, L.pdl);
  for (let q = pv.length - 1, n = 0; q >= 0 && n < 4; q--, n++) levels.push(pv[q].price);
  // distance (in ATRs) to the nearest level the trade is heading INTO (above price for a call, below for a put)
  let toLevel = 9;
  for (const lv of levels) { const dd = (lv - c.c) * d / atr; if (dd >= 0 && dd < toLevel) toLevel = dd; }
  const rsi = u.pre[i].rsi, sr = d > 0 ? rsi : 100 - rsi;
  return { ext21: (c.c - u.ema21[i]) * d / atr, extVwap: (c.c - u.vwap[i]) * d / atr, run, move10: (c.c - cs[Math.max(0, i - 10)].c) * d / atr, moveDay: (c.c - dayOpen) * d / atr,
    rsiSigned: sr, adx: u.pre[i].adx, sigRange: (c.h - c.l) / atr, toLevel, min: u.meta[i].min };
}

// ───────────── collect every high-confidence signal, per symbol ─────────────
const sigs = [];
for (const u of U) {
  let busyUntil = 0;
  for (let i = 60; i < u.candles.length - 6; i++) {
    const r = u.pre[i]; if (!r || r.adx < 20) continue;
    const m = u.meta[i];
    if (m.min < 10 * 60 + 15 || m.min > 14 * 60 + 30 || u.meta[i + 1].day !== m.day) continue;
    let sc = 0; for (const v of r.votes) sc += v.vote * v.weight;
    if (Math.abs(sc) < 7) continue;
    const d = sc > 0 ? 1 : -1, ts = u.candles[i + 1].ts;
    if (ts < busyUntil) continue;
    const f = features(u, i, d); if (!f) continue;
    const e = u.candles[i + 1].o, base = runOption(u, i + 1, e, d);
    busyUntil = base.exitTs;
    // the pullback entry: a limit order 0.3 ATR better than the next open, valid for 4 bars, else the signal is skipped
    const atr = avgRange(u.candles, i), lvl = e - d * 0.3 * atr; let pb = null;
    for (let j = i + 1; j <= i + 4 && j < u.candles.length; j++) { if (u.meta[j].day !== m.day) break; if (d > 0 ? u.candles[j].l <= lvl : u.candles[j].h >= lvl) { pb = runOption(u, j, lvl, d); break; } }
    // how far the underlying went for / against the trade over the next 8 bars (in ATRs)
    let mfe = 0, mae = 0; for (let j = i + 1; j <= Math.min(u.candles.length - 1, i + 8); j++) { if (u.meta[j].day !== m.day) break; mfe = Math.max(mfe, (u.candles[j].h - e) * d > 0 && d > 0 ? (u.candles[j].h - e) / atr : 0, d < 0 ? (e - u.candles[j].l) / atr : 0); mae = Math.max(mae, d > 0 ? (e - u.candles[j].l) / atr : (u.candles[j].h - e) / atr); }
    sigs.push({ u, i, ts, d, f, base, net: net(base), pb, pbNet: pb ? net(pb) : null, mfe, mae, htf: 0 });
  }
}
const T0 = Math.min(...sigs.map(s => s.ts)), T1 = Math.max(...sigs.map(s => s.ts)), CUT = T0 + (T1 - T0) * 0.6;
const train = sigs.filter(s => s.ts < CUT), test = sigs.filter(s => s.ts >= CUT);

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pfOf = a => { const gw = a.filter(x => x > 0).reduce((x, y) => x + y, 0), gl = Math.abs(a.filter(x => x <= 0).reduce((x, y) => x + y, 0)); return gl ? gw / gl : 0; };
const sum = (arr, key = 'net') => { const v = arr.map(s => s[key]); return { n: arr.length, avg: mean(v), pf: pfOf(v), sl: arr.length ? arr.filter(s => (key === 'net' ? s.base.why : s.pb?.why) === 'SL').length / arr.length * 100 : 0, tp: arr.length ? arr.filter(s => (key === 'net' ? s.base.why : s.pb?.why) === 'TP').length / arr.length * 100 : 0 }; };
const f0 = x => String(Math.round(x));
const NL = String.fromCharCode(10);
const out = [];
out.push('# Why high-confidence calls reverse, and what could help' + NL);
out.push('Generated ' + new Date().toISOString().slice(0, 10) + ' by `node tools/bt_reversal.mjs`. **Signal**: the six core strategies (EMA trend, RSI, VWAP, structure, FVG, volume) voting 7+ of 8 one way with ADX >= 20 (what the app showed as 85%+ before SMC was added), read at a 15-minute close, entered at the next open, 10:15-14:30 IST. **Option**: at-the-money MODEL (delta 0.5, time decay), stop -30% / target +30%, 10,000 Rs premium per trade after charges. **Reversal** = the stop was hit before the target. Each symbol is run alone (one position at a time). ' + sigs.length + ' signals over ' + new Date(T0).toISOString().slice(0, 10) + ' to ' + new Date(T1).toISOString().slice(0, 10) + '; thresholds below are tuned on the first 60% (' + train.length + ' signals) and judged ONLY on the last 40% (' + test.length + ').' + NL);

// 1. per symbol
out.push('## 1. Each symbol on its own' + NL);
out.push('| Symbol | Signals | Hit the stop first (reversal) | Hit the target first | Avg Rs/trade | PF | Avg move for the trade in the next 2h (ATR) | Avg move against it (ATR) | Avg first 60% / last 40% |' + NL + '|---|---|---|---|---|---|---|---|---|');
const ORDER = ['_NSEI', '_NSEBANK', 'HDFCBANK_NS', 'ICICIBANK_NS', 'SBIN_NS', 'TATASTEEL_NS', 'INFY_NS'];
const bySym = sym => sigs.filter(s => s.u.sym === sym);
const symRows = [...ORDER, ...U.map(u => u.sym).filter(x => !ORDER.includes(x))];
for (const sym of symRows) {
  const a = bySym(sym); if (!a.length) continue;
  const q = sum(a), tr = a.filter(s => s.ts < CUT), te = a.filter(s => s.ts >= CUT);
  out.push('| ' + a[0].u.label + (ORDER.includes(sym) ? '' : ' (other)') + ' | ' + q.n + ' | ' + q.sl.toFixed(0) + '% | ' + q.tp.toFixed(0) + '% | ' + f0(q.avg) + ' | ' + q.pf.toFixed(2) + ' | ' + mean(a.map(s => s.mfe)).toFixed(2) + ' | ' + mean(a.map(s => s.mae)).toFixed(2) + ' | ' + f0(mean(tr.map(s => s.net))) + ' / ' + f0(mean(te.map(s => s.net))) + ' |');
}
const all = sum(sigs);
out.push('| **All symbols** | ' + all.n + ' | ' + all.sl.toFixed(0) + '% | ' + all.tp.toFixed(0) + '% | ' + f0(all.avg) + ' | ' + all.pf.toFixed(2) + ' | ' + mean(sigs.map(s => s.mfe)).toFixed(2) + ' | ' + mean(sigs.map(s => s.mae)).toFixed(2) + ' | ' + f0(mean(train.map(s => s.net))) + ' / ' + f0(mean(test.map(s => s.net))) + ' |');
out.push(NL + 'A symmetric coin flip hits the stop first about as often as the target (stop and target are both 30%), so a reversal rate near 50% plus costs and decay is a loss. A signal that predicts direction would hit the target clearly more often than the stop.' + NL);

// 2. what the market looked like before reversals
out.push('## 2. What the market looks like at the signal, split into fifths' + NL);
out.push('For each measure, the signals are split into five equal groups from lowest to highest. The table shows how often the trade reversed (hit the stop first) in each group, over the whole period and over the first / last halves. A real warning sign would show a reversal rate that rises or falls steadily with the measure AND agrees in both periods.' + NL);
const FE = [
  ['ext21', 'Stretch from the 21-EMA (ATR, in the trade direction)', 'Is the call taken when price is already far from its average?'],
  ['extVwap', 'Stretch from VWAP (ATR)', 'Same, against the day average price.'],
  ['run', 'Candles in a row closing in the trade direction', 'Is it chasing a run?'],
  ['move10', 'Move over the last 10 candles (ATR)', 'Has the market already moved a lot?'],
  ['moveDay', 'Move since the day opened (ATR)', 'Has the day already made its move?'],
  ['rsiSigned', 'RSI, flipped for puts (high = stretched in the trade direction)', 'Is momentum already stretched?'],
  ['adx', 'ADX', 'Trend strength.'],
  ['sigRange', 'Size of the signal candle (ATR)', 'A very large signal candle often marks the end of a burst.'],
  ['toLevel', 'Distance to the nearest level the trade is heading into (ATR)', 'A call just below the previous day high or a swing high.'],
  ['min', 'Time of day (minutes after midnight)', ''],
];
out.push('| Measure | Q1 lowest | Q2 | Q3 | Q4 | Q5 highest | Q5 minus Q1 (first 60% / last 40%) |' + NL + '|---|---|---|---|---|---|---|');
const quint = (arr, key) => { const s = [...arr].sort((a, b) => a.f[key] - b.f[key]), n = s.length, qs = []; for (let k = 0; k < 5; k++) qs.push(s.slice(Math.floor(n * k / 5), Math.floor(n * (k + 1) / 5))); return qs; };
const slRate = a => (a.length ? a.filter(s => s.base.why === 'SL').length / a.length * 100 : 0);
const diffs = [];
for (const [key, label] of FE) {
  const qs = quint(sigs, key);
  const lo = q => q.reduce((m, s) => Math.min(m, s.f[key]), 1e9), hi = q => q.reduce((m, s) => Math.max(m, s.f[key]), -1e9);
  const trQ = quint(train, key), teQ = quint(test, key);
  const dTr = slRate(trQ[4]) - slRate(trQ[0]), dTe = slRate(teQ[4]) - slRate(teQ[0]);
  diffs.push({ key, label, dTr, dTe, all: slRate(qs[4]) - slRate(qs[0]) });
  out.push('| ' + label + ' | ' + qs.map(q => slRate(q).toFixed(0) + '% (' + (+lo(q).toFixed(1)) + ' to ' + (+hi(q).toFixed(1)) + ')').join(' | ') + ' | ' + (dTr >= 0 ? '+' : '') + dTr.toFixed(0) + ' / ' + (dTe >= 0 ? '+' : '') + dTe.toFixed(0) + ' pts |');
}
out.push(NL + 'Reversal rate = share of trades that hit the stop before the target (about ' + all.sl.toFixed(0) + '% overall). With about ' + Math.round(sigs.length / 5) + ' signals per group, differences under roughly 5 points are noise.' + NL);
const consistent = diffs.filter(d => Math.sign(d.dTr) === Math.sign(d.dTe) && Math.abs(d.dTr) >= 5 && Math.abs(d.dTe) >= 5);
out.push('**Measures with the same direction of effect (at least 5 points) in BOTH periods:** ' + (consistent.length ? consistent.map(d => d.label + ' (' + (d.dTr >= 0 ? '+' : '') + d.dTr.toFixed(0) + ' / ' + (d.dTe >= 0 ? '+' : '') + d.dTe.toFixed(0) + ')').join('; ') : 'none') + '.' + NL);

// 3. candidate improvements
out.push('## 3. Candidate improvements, tuned on the first 60%, judged on the last 40%' + NL);
out.push('Each filter skips signals at the stretched / crowded end of one measure (the threshold is chosen on the first 60% from the 50th to 90th percentile to maximise the average Rs per trade). The pullback rule instead waits for a 0.3 ATR better price within 4 bars and skips the signal if it never comes. Only the right-hand columns count.' + NL);
const keep = (arr, key, thr, hiIsBad) => arr.filter(s => (hiIsBad ? s.f[key] < thr : s.f[key] > thr));
const quantile = (arr, key, q) => { const v = arr.map(s => s.f[key]).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * q))]; };
const RULES = [
  ['ext21', true, 'skip when price is stretched from the 21-EMA'], ['extVwap', true, 'skip when price is stretched from VWAP'], ['run', true, 'skip after a long run of candles'],
  ['move10', true, 'skip after a big 10-candle move'], ['moveDay', true, 'skip after a big move since the open'], ['rsiSigned', true, 'skip when RSI is already stretched'],
  ['sigRange', true, 'skip a very large signal candle'], ['toLevel', false, 'skip when a level is very close ahead'],
];
out.push('| Rule | Threshold (from first 60%) | Signals kept (first / last) | Avg Rs/trade first 60% before to after | **Avg Rs/trade last 40% before to after** | Reversal rate last 40% before to after |' + NL + '|---|---|---|---|---|---|');
const beforeTrain = mean(train.map(s => s.net)), beforeTest = mean(test.map(s => s.net));
const chosen = [];
for (const [key, hiIsBad, label] of RULES) {
  let best = null;
  for (const qq of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const thr = hiIsBad ? quantile(train, key, qq) : quantile(train, key, 1 - qq);
    const kept = keep(train, key, thr, hiIsBad); if (kept.length < 80) continue;
    const a = mean(kept.map(s => s.net)); if (!best || a > best.a) best = { thr, a, qq };
  }
  if (!best) continue;
  const kTr = keep(train, key, best.thr, hiIsBad), kTe = keep(test, key, best.thr, hiIsBad);
  chosen.push({ key, hiIsBad, thr: best.thr, label });
  out.push('| ' + label + ' | ' + (hiIsBad ? '< ' : '> ') + (+best.thr.toFixed(2)) + ' | ' + kTr.length + ' / ' + kTe.length + ' | ' + f0(beforeTrain) + ' to ' + f0(mean(kTr.map(s => s.net))) + ' | **' + f0(beforeTest) + ' to ' + f0(mean(kTe.map(s => s.net))) + '** | ' + slRate(test).toFixed(0) + '% to ' + slRate(kTe).toFixed(0) + '% |');
}
// pullback entry
const pbTr = train.filter(s => s.pb), pbTe = test.filter(s => s.pb);
out.push('| wait for a pullback (0.3 ATR, 4 bars) | - | ' + pbTr.length + ' / ' + pbTe.length + ' | ' + f0(beforeTrain) + ' to ' + f0(mean(pbTr.map(s => s.pbNet))) + ' | **' + f0(beforeTest) + ' to ' + f0(mean(pbTe.map(s => s.pbNet))) + '** | ' + slRate(test).toFixed(0) + '% to ' + (pbTe.length ? pbTe.filter(s => s.pb.why === 'SL').length / pbTe.length * 100 : 0).toFixed(0) + '% |');
// combined: every chosen rule at once
const all8 = arr => arr.filter(s => chosen.every(r => (r.hiIsBad ? s.f[r.key] < r.thr : s.f[r.key] > r.thr)));
const cTr = all8(train), cTe = all8(test);
out.push('| **all of the filters above together** | - | ' + cTr.length + ' / ' + cTe.length + ' | ' + f0(beforeTrain) + ' to ' + f0(mean(cTr.map(s => s.net))) + ' | **' + f0(beforeTest) + ' to ' + (cTe.length ? f0(mean(cTe.map(s => s.net))) : 'n/a') + '** | ' + slRate(test).toFixed(0) + '% to ' + (cTe.length ? slRate(cTe).toFixed(0) + '%' : 'n/a') + ' |');
out.push('');
// the same filters, per requested symbol, on the last 40%
out.push('## 4. The combined filters, symbol by symbol (last 40% only)' + NL);
out.push('| Symbol | Signals before | Avg Rs/trade before | Signals after | Avg Rs/trade after |' + NL + '|---|---|---|---|---|');
for (const sym of ORDER) {
  const a = test.filter(s => s.u.sym === sym); if (!a.length) continue;
  const b = all8(a);
  out.push('| ' + a[0].u.label + ' | ' + a.length + ' | ' + f0(mean(a.map(s => s.net))) + ' | ' + b.length + ' | ' + (b.length >= 5 ? f0(mean(b.map(s => s.net))) : 'too few') + ' |');
}
out.push('');

// ───────────── exits: would a different stop / target / time limit survive the reversals better? ─────────────
function runOptionX(u, idx, e, dirn, slp, tpp, maxBars) {
  const cs = u.candles, p0 = e * (u.isIndex ? P.idxPrem : P.stkPrem), theta = u.isIndex ? P.idxTheta : P.stkTheta, life = u.isIndex ? P.idxLife : P.stkLife, t0 = cs[idx].ts;
  const value = (b, days) => p0 + DELTA * (dirn > 0 ? b.c - e : e - b.c) - theta * days * p0;
  for (let j = idx; j < cs.length; j++) {
    const b = cs[j], days = (b.ts - t0) / 86400000, decay = theta * days * p0;
    const fav = dirn > 0 ? b.h - e : e - b.l, adv = dirn > 0 ? b.l - e : e - b.h;
    if (p0 + DELTA * adv - decay <= p0 * (1 - slp)) return { ret: -slp };
    if (p0 + DELTA * fav - decay >= p0 * (1 + tpp)) return { ret: tpp };
    if ((maxBars > 0 && j - idx >= maxBars) || (maxBars < 0 && (u.meta[j].min >= 15 * 60 + 15 || (j + 1 < cs.length && u.meta[j + 1].day !== u.meta[j].day))) || days >= life) return { ret: Math.max(-1, value(b, days) / p0 - 1) };
  }
  const b = cs[cs.length - 1];
  return { ret: Math.max(-1, value(b, (b.ts - t0) / 86400000) / p0 - 1) };
}
out.push('## 6. Different exits on the same signals' + NL);
out.push('The stop (-30%) and target (+30%) are the app settings. Here the same signals are re-run with other stops, targets and a time limit (leave after N candles if neither is hit). Each combination is scored on the first 60%; the best ones by that score are then shown on the last 40%.' + NL);
const grid = [];
for (const slp of [0.15, 0.2, 0.3, 0.4, 0.5]) for (const tpp of [0.2, 0.3, 0.5, 0.8]) for (const maxBars of [0, 8, 16, -1]) {
  const calc = arr => mean(arr.map(sg => net(runOptionX(sg.u, sg.i + 1, sg.u.candles[sg.i + 1].o, sg.d, slp, tpp, maxBars))));
  grid.push({ slp, tpp, maxBars, tr: calc(train), te: calc(test) });
}
grid.sort((a, b) => b.tr - a.tr);
out.push('| Stop | Target | Time limit | Avg Rs/trade first 60% | **Avg Rs/trade last 40%** |' + NL + '|---|---|---|---|---|');
const cur = grid.find(g => g.slp === 0.3 && g.tpp === 0.3 && g.maxBars === 0);
out.push('| 30% (today) | 30% (today) | none (today) | ' + f0(cur.tr) + ' | **' + f0(cur.te) + '** |');
const day = grid.find(g => g.slp === 0.3 && g.tpp === 0.3 && g.maxBars === -1);
out.push('| 30% | 30% | same-day square-off 15:15 (the app INTRADAY setting) | ' + f0(day.tr) + ' | **' + f0(day.te) + '** |');
grid.slice(0, 8).forEach(g => out.push('| ' + (g.slp * 100) + '% | ' + (g.tpp * 100) + '% | ' + (g.maxBars > 0 ? g.maxBars + ' candles' : g.maxBars < 0 ? 'same-day square-off 15:15' : 'none') + ' | ' + f0(g.tr) + ' | **' + f0(g.te) + '** |'));
const posTe = grid.filter(g => g.te > 0).length;
out.push('### The same signals with the same-day square-off (stop 30%, target 30%), symbol by symbol' + NL);
out.push('| Symbol | Signals | Avg Rs/trade today (held until stop/target) | Avg Rs/trade with same-day square-off | First 60% / last 40% (same-day) | Hit the stop first (same-day) |' + NL + '|---|---|---|---|---|---|');
const dayNet = sg => net(runOptionX(sg.u, sg.i + 1, sg.u.candles[sg.i + 1].o, sg.d, 0.3, 0.3, -1));
const dayRet = sg => runOptionX(sg.u, sg.i + 1, sg.u.candles[sg.i + 1].o, sg.d, 0.3, 0.3, -1).ret;
for (const sym of symRows) {
  const a2 = bySym(sym); if (!a2.length) continue;
  const tr2 = a2.filter(x => x.ts < CUT), te2 = a2.filter(x => x.ts >= CUT);
  out.push('| ' + a2[0].u.label + ' | ' + a2.length + ' | ' + f0(mean(a2.map(x => x.net))) + ' | ' + f0(mean(a2.map(dayNet))) + ' | ' + f0(mean(tr2.map(dayNet))) + ' / ' + f0(mean(te2.map(dayNet))) + ' | ' + (a2.filter(x => dayRet(x) <= -0.299).length / a2.length * 100).toFixed(0) + '% |');
}
out.push('| **All symbols** | ' + sigs.length + ' | ' + f0(mean(sigs.map(x => x.net))) + ' | ' + f0(mean(sigs.map(dayNet))) + ' | ' + f0(mean(train.map(dayNet))) + ' / ' + f0(mean(test.map(dayNet))) + ' | ' + (sigs.filter(x => dayRet(x) <= -0.299).length / sigs.length * 100).toFixed(0) + '% |' + NL);
const noDecayNote = true;
out.push(NL + 'Of ' + grid.length + ' exit combinations, **' + posTe + '** were profitable on the last 40%; the best on the first 60% scored ' + f0(grid[0].te) + ' on the last 40%.' + NL);

// verdict
const impTest = chosen.length ? mean(cTe.map(s => s.net)) : beforeTest;
out.push('## 5. What this means' + NL);
out.push('- Before any change, the high-confidence calls average **' + f0(all.avg) + ' Rs per trade** (' + all.sl.toFixed(0) + '% hit the stop first, ' + all.tp.toFixed(0) + '% hit the target first). On the last 40% of the period: ' + f0(beforeTest) + '.');
out.push('- All filters together, on the last 40% (not used to choose them): **' + (cTe.length ? f0(impTest) : 'too few signals') + ' Rs per trade on ' + cTe.length + ' signals**.');
out.push('- A filter helps only if the last-40% number is clearly better than the "before" number AND it still leaves a meaningful number of trades. Everything here was chosen with the same period in mind, so improvements of a few hundred rupees on a few dozen trades should be treated as ideas to watch on paper trading.');
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports', 'reversal_study.md'), out.join(NL) + NL);
console.log(out.join(NL));
