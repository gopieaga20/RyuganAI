'use strict';
/* Strategy backtest engine for the Backtest page. Pure functions (no DOM), unit-tested in tests/bt-engine.test.mjs.
 *
 * The same rules as the 4-year reports (tools/bt_strategies.mjs), so the page reproduces them:
 *  - the app's strategy vote (strategies.js evaluate) on a rolling 250-candle window, read on a candle's close, filled at the NEXT candle's open;
 *  - a call when the selected strategies agree (rule 'all') or their weighted score reaches the threshold (rule 'score'), and ADX >= minimum;
 *  - entries only inside the time window and never on the day's last candle; one open trade per symbol;
 *  - the trade is an ATM option: a MODELLED premium (no historical option prices exist), delta 0.5, time decay, stop -X% / target +Y% of premium,
 *    squared off at 15:15 the same day; Rs premium per trade, full option charges and a round-trip bid-ask spread.
 */
import { evaluate, STRATEGIES } from './strategies.js';
import { Indicators } from './indicators.js';
import { istParts } from './candles.js';

export const WINDOW = 250;
export const WARMUP = 60;
export const VOTE_IDS = ['trend', 'rsi', 'vwap', 'structure', 'fvg', 'volume', 'smc', 'sr'];
export const REF_STOCK_VOL = 0.0148;          // median daily volatility of 33 large F&O stocks, 2022-2026: a stock this volatile has a 2%-of-spot ATM premium
export const DEFAULTS = {
  ids: ['vwap'], rule: 'all', minScore: 3, minAdx: 20, fromMin: 11 * 60 + 30, toMin: 14 * 60 + 30, squareOffMin: 15 * 60 + 15,
  premium: 10000, slPct: 30, tpPct: 30, spreadPct: 1, delta: 0.5,
  idxPrem: 0.0055, idxTheta: 0.07, stkPrem: 0.02, stkTheta: 0.03,
};

/** Every strategy's vote on every candle: [{v: {id: -1|0|1}, adx} | null]. The slow part (about 0.5 ms a candle); cache it per symbol. */
export function computeVotes(candles, onProgress) {
  const out = new Array(candles.length).fill(null);
  for (let i = WARMUP; i < candles.length; i++) {
    const r = evaluate(candles.slice(Math.max(0, i - WINDOW + 1), i + 1), { intraday: true });
    if (r.ok) {
      const v = {};
      for (const x of r.votes) v[x.id] = x.vote;
      out[i] = { v, adx: r.adx };
    }
    if (onProgress && i % 500 === 0) onProgress(i / candles.length);
  }
  return out;
}

/** Daily close-to-close volatility (std of log returns) of a symbol's candles. */
export function dailyVol(candles) {
  const byDay = new Map();
  for (const c of candles) byDay.set(istParts(c.ts).day, c.c);
  const cl = [...byDay.values()], r = [];
  for (let k = 1; k < cl.length; k++) if (cl[k] > 0 && cl[k - 1] > 0) r.push(Math.log(cl[k] / cl[k - 1]));
  if (r.length < 2) return REF_STOCK_VOL;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
}

/** +1 (CE) / -1 (PE) / 0 from one candle's votes. Rule 'all': every selected strategy votes the same non-zero way. Rule 'score': weighted sum >= minScore. */
export function signalOf(rec, ids, rule = 'all', minScore = 3, minAdx = 20) {
  if (!rec || !(rec.adx >= minAdx) || !ids.length) return 0;
  if (rule === 'all') {
    let d = 0;
    for (const id of ids) { const x = rec.v[id] || 0; if (!x || (d && x !== d)) return 0; d = x; }
    return d;
  }
  let s = 0;
  for (const id of ids) s += (rec.v[id] || 0) * (STRATEGIES.find(q => q.id === id)?.weight ?? 1);
  return s >= minScore ? 1 : s <= -minScore ? -1 : 0;
}

/** Signal candles of one symbol inside [startTs, endTs]: [{i, dir, ts (fill time)}]. */
export function candidates(sym, cfg) {
  const out = [], cs = sym.candles, meta = sym.meta || (sym.meta = cs.map(c => istParts(c.ts)));
  for (let i = WARMUP; i < cs.length - 1; i++) {
    if (cs[i].ts < (cfg.startTs ?? -Infinity) || cs[i].ts > (cfg.endTs ?? Infinity)) continue;
    const m = meta[i];
    if (m.min < cfg.fromMin || m.min > cfg.toMin || meta[i + 1].day !== m.day) continue;
    const dir = signalOf(sym.votes[i], cfg.ids, cfg.rule, cfg.minScore, cfg.minAdx);
    if (dir) out.push({ i, dir, ts: cs[i + 1].ts });
  }
  return out;
}

/** One modelled option trade from candidate c. Returns {exitTs, exitIdx, ret (premium return), why: 'SL'|'TP'|'SQ'|'END', entry (underlying)}. */
export function runOption(sym, c, cfg) {
  const cs = sym.candles, meta = sym.meta, e = cs[c.i + 1].o;
  const p0 = e * (sym.isIndex ? cfg.idxPrem : cfg.stkPrem * (sym.volRatio || 1));
  const theta = sym.isIndex ? cfg.idxTheta : cfg.stkTheta, t0 = cs[c.i + 1].ts, D = cfg.delta, day = meta[c.i + 1].day;
  const sl = cfg.slPct / 100, tp = cfg.tpPct / 100;
  for (let j = c.i + 1; j < cs.length; j++) {
    const b = cs[j];
    if (meta[j].day !== day || meta[j].min >= cfg.squareOffMin) {
      const same = meta[j].day === day, px = same ? b.o : cs[j - 1].c, k = same ? j : j - 1, d2 = (cs[k].ts - t0) / 86400000;
      const mv = c.dir > 0 ? px - e : e - px;
      return { exitTs: cs[k].ts, exitIdx: k, ret: Math.max(-1, (p0 + D * mv - theta * d2 * p0) / p0 - 1), why: 'SQ', entry: e, exitPx: px };
    }
    const days = (b.ts - t0) / 86400000, decay = theta * days * p0;
    const fav = c.dir > 0 ? b.h - e : e - b.l, adv = c.dir > 0 ? b.l - e : e - b.h;
    if (p0 + D * adv - decay <= p0 * (1 - sl)) return { exitTs: b.ts, exitIdx: j, ret: -sl, why: 'SL', entry: e, exitPx: c.dir > 0 ? b.l : b.h };
    if (p0 + D * fav - decay >= p0 * (1 + tp)) return { exitTs: b.ts, exitIdx: j, ret: tp, why: 'TP', entry: e, exitPx: c.dir > 0 ? b.h : b.l };
  }
  const k = cs.length - 1, mv = c.dir > 0 ? cs[k].c - e : e - cs[k].c, d2 = (cs[k].ts - t0) / 86400000;
  return { exitTs: cs[k].ts, exitIdx: k, ret: Math.max(-1, (p0 + D * mv - theta * d2 * p0) / p0 - 1), why: 'END', entry: e, exitPx: cs[k].c };
}

/** Trades of one symbol: one open trade at a time (a signal while a trade is open is skipped). */
export function simulateSymbol(sym, cands, cfg) {
  const trades = [];
  let busyUntil = -Infinity;
  for (const c of cands) {
    if (c.ts < busyUntil) continue;
    const r = runOption(sym, c, cfg);
    busyUntil = r.exitTs + (cfg.reenterSameBar ? 0 : 1);
    const ent = cfg.premium, ext = ent * (1 + r.ret);
    const chg = Indicators.charges(ent, ext, 1, 'options') + ent * (cfg.spreadPct / 100);
    trades.push({ sym: sym.sym, label: sym.label || sym.sym, idx: !!sym.isIndex, dir: c.dir, ts: c.ts, exitTs: r.exitTs, entry: r.entry, exitPx: r.exitPx,
                  ret: r.ret, gross: ext - ent, charges: chg, net: ext - ent - chg, why: r.why });
  }
  return trades;
}

/** Summary of a list of trades. */
export function stats(trades) {
  const n = trades.length, net = trades.reduce((a, t) => a + t.net, 0), wins = trades.filter(t => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0), gl = Math.abs(trades.filter(t => t.net <= 0).reduce((a, t) => a + t.net, 0));
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) { eq += t.net; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const byDay = new Map();
  for (const t of trades) { const d = istParts(t.exitTs).day; byDay.set(d, (byDay.get(d) || 0) + t.net); }
  return { n, net, avg: n ? net / n : 0, win: n ? wins.length / n * 100 : 0, pf: gl ? gw / gl : (gw ? Infinity : 0), maxDD: dd,
           worstDay: byDay.size ? Math.min(0, ...byDay.values()) : 0, bestDay: byDay.size ? Math.max(0, ...byDay.values()) : 0, days: byDay.size };
}

/** Seeded random numbers (same result every run). */
export function rng(seed = 12345) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Coin-flip yardstick: the same entry candles with a random direction, 5 times. Returns {avg, p} where p = chance the coin does at least as well as `actualAvg`. */
export function coinFlip(symbols, candsBySym, cfg, actualAvg, n) {
  if (n < 30) return { avg: NaN, p: NaN };
  const r = rng(4242), nets = [];
  for (let k = 0; k < 5; k++) for (const s of symbols) {
    const flipped = candsBySym.get(s.sym).map(c => ({ ...c, dir: r() < 0.5 ? -c.dir : c.dir }));
    for (const t of simulateSymbol(s, flipped, cfg)) nets.push(t.net);
  }
  if (nets.length < 2) return { avg: NaN, p: NaN };
  const m = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / (nets.length - 1));
  const z = (actualAvg - m) / (sd / Math.sqrt(n));
  return { avg: m, p: 0.5 * (1 - erf(z / Math.SQRT2)) };
}

export function erf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return z >= 0 ? y : -y;
}

/** Group trades by a key function into [{key, ...stats}], sorted by key. */
export function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, ts]) => ({ key, ...stats(ts) }));
}

/** The whole run over prepared symbols ({sym, label, isIndex, candles, votes, volRatio}). */
export function runBacktest(symbols, cfgIn) {
  const cfg = { ...DEFAULTS, ...cfgIn };
  const candsBySym = new Map(), trades = [];
  for (const s of symbols) {
    const c = candidates(s, cfg);
    candsBySym.set(s.sym, c);
    trades.push(...simulateSymbol(s, c, cfg));
  }
  trades.sort((a, b) => a.ts - b.ts);
  const st = stats(trades);
  const month = t => istParts(t.ts).day.slice(0, 7);
  return {
    cfg, trades, stats: st,
    signals: [...candsBySym.values()].reduce((a, c) => a + c.length, 0),
    coin: coinFlip(symbols, candsBySym, cfg, st.avg, st.n),
    bySymbol: groupBy(trades, t => t.label),
    byMonth: groupBy(trades, month),
    bySide: groupBy(trades, t => (t.dir > 0 ? 'BUY CE' : 'BUY PE')),
    byExit: groupBy(trades, t => t.why),
  };
}
