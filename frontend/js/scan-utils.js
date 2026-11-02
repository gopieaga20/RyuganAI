'use strict';
/* Pure helpers for the scanner (no DOM, no network), unit-tested in frontend/tests. */
import { istParts } from './candles.js';

/** Name the user sees -> underlying used by news and the option chain (null: no chain available). */
export function underlyingOf(sym) {
  const s = sym.toUpperCase().replace(/\.NS$/, '').trim();
  if (s === 'NIFTY 50' || s === 'NIFTY' || s === '^NSEI') return { news: 'NIFTY', chain: 'NIFTY' };
  if (s === 'BANK NIFTY' || s === 'BANKNIFTY' || s === '^NSEBANK') return { news: 'BANKNIFTY', chain: 'BANKNIFTY' };
  if (s === 'SENSEX' || s === '^BSESN') return { news: 'SENSEX', chain: null };   // BSE contracts are not in the NSE master
  return { news: s.replace(/\s+/g, ''), chain: s.replace(/\s+/g, '') };
}

/** % change of the last session's close vs the previous session's close. */
export function sessionChange(candles) {
  if (candles.length < 2) return null;
  const lastDay = istParts(candles[candles.length - 1].ts).day;
  let prevClose = null;
  for (let i = candles.length - 1; i >= 0; i--) if (istParts(candles[i].ts).day !== lastDay) { prevClose = candles[i].c; break; }
  if (prevClose == null) prevClose = candles[0].o;
  return (candles[candles.length - 1].c - prevClose) / prevClose * 100;
}
