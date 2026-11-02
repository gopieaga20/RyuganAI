// Backtest of the dashboard's strategy vote (frontend/js/strategies.js) on real candles.
//
// The vote is evaluated once per bar on a rolling window (as the live scanner does) and cached, so thresholds, weights,
// stops and filters can then be re-simulated cheaply. Honest-testing rules:
//  - a signal is read at a bar's close and filled at the NEXT bar's open, plus slippage;
//  - stops fill at the stop (or at the open when it gaps through); a bar touching both stop and target counts as a loss;
//  - intraday only: no entry after the cutoff, flat at 15:15 IST, never held overnight;
//  - real Indian charges via Indicators.charges, normalised to a Rs 10 lakh position so results are in bps of notional;
//  - there is no news history, so the news vote is absent here (live calls also use it).
import { load } from './data.mjs';
import { evaluate } from '../frontend/js/strategies.js';
import { Indicators } from '../frontend/js/indicators.js';
import { istParts } from '../frontend/js/candles.js';

const WINDOW = 250;

/** Evaluate the vote on every bar of one symbol. Returns per-bar records (or null while warming up). */
export function precompute(candles, evalOpts = {}) {
  const out = new Array(candles.length).fill(null);
  for (let i = 60; i < candles.length; i++) {
    const win = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const r = evaluate(win, { intraday: true, ...evalOpts });
    if (r.ok) out[i] = { votes: r.votes.map(v => ({ id: v.id, vote: v.vote, weight: v.weight })), adx: r.adx, atr: r.atr, rsi: r.rsi };
  }
  return out;
}

const DEFAULT = {
  callScore: 3, minAdx: 20, weights: null, disable: [], slAtr: 1.5, tpAtr: 2, slipPct: 0.01,
  cutoffMin: 14 * 60 + 45, squareOffMin: 15 * 60 + 15, skipOpenMin: 0, maxPerDay: 99, flipExit: false, segment: 'intraday',
  invert: false,
  dirFilter: null,            // 'LONG' | 'SHORT' | null
};

export function simulate(candles, pre, cfgIn = {}) {
  const cfg = { ...DEFAULT, ...cfgIn };
  const off = new Set(cfg.disable);
  const slip = cfg.slipPct / 100;
  const trades = [];
  let pos = null, pending = null, curDay = '', today = 0;
  const meta = candles.map(c => istParts(c.ts));
  const n = candles.length;

  const close = (px, i, why) => {
    const exit = pos.dir === 'LONG' ? px * (1 - slip) : px * (1 + slip);
    const qty = Math.max(1, Math.round(1e6 / pos.entry));
    const gross = (pos.dir === 'LONG' ? exit - pos.entry : pos.entry - exit) * qty;
    const chg = Indicators.charges(pos.entry, exit, qty, cfg.segment);
    trades.push({ ts: pos.ts, exitTs: candles[i].ts, dir: pos.dir, entry: pos.entry, exit, net: gross - chg, bps: (gross - chg) / qty / pos.entry * 1e4, gbps: gross / qty / pos.entry * 1e4, cbps: chg / qty / pos.entry * 1e4, why });
    pos = null;
  };

  for (let i = 60; i < n; i++) {
    const c = candles[i], m = meta[i];
    if (m.day !== curDay) { curDay = m.day; today = 0; pending = null; }
    // fill
    if (pending && !pos) {
      const px = pending.dir === 'LONG' ? c.o * (1 + slip) : c.o * (1 - slip);
      const sd = pending.atr * cfg.slAtr, td = pending.atr * cfg.tpAtr;
      pos = { dir: pending.dir, entry: px, ts: c.ts, sl: pending.dir === 'LONG' ? px - sd : px + sd, tp: pending.dir === 'LONG' ? px + td : px - td };
      today++;
    }
    pending = null;
    // exits
    if (pos) {
      const long = pos.dir === 'LONG';
      const gapSl = long ? c.o <= pos.sl : c.o >= pos.sl, gapTp = long ? c.o >= pos.tp : c.o <= pos.tp;
      const slHit = long ? c.l <= pos.sl : c.h >= pos.sl, tpHit = long ? c.h >= pos.tp : c.l <= pos.tp;
      if (gapSl) close(c.o, i, 'SL');
      else if (slHit) close(pos.sl, i, 'SL');
      else if (gapTp) close(c.o, i, 'TP');
      else if (tpHit) close(pos.tp, i, 'TP');
      else if (m.min >= cfg.squareOffMin || i === n - 1 || meta[i + 1]?.day !== m.day) close(m.min >= cfg.squareOffMin ? c.o : c.c, i, 'EOD');
    }
    // signal on this close
    const r = pre[i];
    if (!r || i === n - 1) continue;
    let score = 0;
    for (const v of r.votes) if (!off.has(v.id)) score += v.vote * (cfg.weights?.[v.id] ?? v.weight);
    let call = r.adx >= cfg.minAdx ? (score >= cfg.callScore ? 'LONG' : score <= -cfg.callScore ? 'SHORT' : null) : null;
    if (call && cfg.invert) call = call === 'LONG' ? 'SHORT' : 'LONG';
    if (pos && cfg.flipExit && call && call !== pos.dir) close(c.c, i, 'FLIP');
    if (pos || !call) continue;
    if (cfg.dirFilter && call !== cfg.dirFilter) continue;
    if (m.min >= cfg.cutoffMin || m.min < 9 * 60 + 15 + cfg.skipOpenMin || today >= cfg.maxPerDay) continue;
    if (meta[i + 1]?.day !== m.day) continue;
    pending = { dir: call, atr: r.atr };
  }
  return trades;
}

export function stats(trades) {
  const w = trades.filter(t => t.net > 0), l = trades.filter(t => t.net <= 0);
  const gw = w.reduce((a, t) => a + t.bps, 0), gl = Math.abs(l.reduce((a, t) => a + t.bps, 0));
  return {
    n: trades.length, exp: trades.length ? trades.reduce((a, t) => a + t.bps, 0) / trades.length : 0,
    gross: trades.length ? trades.reduce((a, t) => a + t.gbps, 0) / trades.length : 0, cost: trades.length ? trades.reduce((a, t) => a + t.cbps, 0) / trades.length : 0,
    pf: gl ? gw / gl : (gw ? 9.99 : 0), wr: trades.length ? w.length / trades.length * 100 : 0,
    total: trades.reduce((a, t) => a + t.bps, 0),
  };
}

export const IST = 5.5 * 3600e3;
export const dayOf = ts => new Date(ts + IST).toISOString().slice(0, 10);

export async function loadUniverse(interval, range = '60d') {
  const idx = ['^NSEI', '^NSEBANK', '^BSESN'];
  const stocks = ['RELIANCE.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 'TCS.NS', 'SBIN.NS', 'TATASTEEL.NS', 'AXISBANK.NS', 'ITC.NS', 'LT.NS', 'BHARTIARTL.NS', 'MARUTI.NS'];
  const out = [];
  for (const s of [...idx, ...stocks]) {
    try {
      const candles = await load(s, interval, range);
      if (candles.length > 200) out.push({ sym: s, segment: idx.includes(s) ? 'futures' : 'intraday', candles });
    } catch (e) { console.error('skip', s, e.message); }
  }
  return out;
}

/** Run one config over the whole universe; returns trades split by day into train (first 60%) and test (last 40%). */
export function runAll(universe, cfg) {
  const all = [], train = [], test = [], perSym = {};
  for (const u of universe) {
    const days = [...new Set(u.candles.map(c => dayOf(c.ts)))];
    const cut = days[Math.floor(days.length * 0.6)];
    const tr = simulate(u.candles, u.pre, { ...cfg, segment: u.segment });
    for (const t of tr) { all.push(t); (dayOf(t.ts) < cut ? train : test).push(t); }
    perSym[u.sym] = stats(tr);
  }
  return { all: stats(all), train: stats(train), test: stats(test), perSym, trades: all };
}
