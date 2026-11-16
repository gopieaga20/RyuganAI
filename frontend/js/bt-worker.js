'use strict';
/* Web worker for the Backtest page: computes every strategy's vote on every candle (the slow part) and runs the backtest, off the page's thread.
 * Votes are cached per symbol and candle count, so changing strategies, rule or period and running again is instant. */
import { computeVotes, dailyVol, runBacktest, REF_STOCK_VOL } from './bt-engine.js';

const cache = new Map();          // sym -> {n, lastTs, votes}

self.onmessage = e => {
  const { type, symbols, cfg } = e.data || {};
  if (type !== 'run') return;
  try {
    const prepared = [];
    symbols.forEach((s, k) => {
      const key = s.sym, hit = cache.get(key), last = s.candles[s.candles.length - 1]?.ts;
      let votes;
      if (hit && hit.n === s.candles.length && hit.lastTs === last) votes = hit.votes;
      else {
        votes = computeVotes(s.candles, f => self.postMessage({ type: 'progress', text: `Reading strategies on ${s.label}`, frac: (k + f) / symbols.length }));
        cache.set(key, { n: s.candles.length, lastTs: last, votes });
      }
      const volRatio = s.isIndex ? 1 : Math.min(2.5, Math.max(0.5, dailyVol(s.candles) / REF_STOCK_VOL));
      prepared.push({ ...s, votes, volRatio });
    });
    self.postMessage({ type: 'progress', text: 'Simulating trades', frac: 1 });
    const res = runBacktest(prepared, cfg);
    self.postMessage({ type: 'done', result: { ...res, volRatios: Object.fromEntries(prepared.map(p => [p.label, p.volRatio])) } });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
