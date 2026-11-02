'use strict';

/** Yahoo-shaped chart JSON (as served by /api/yahoo-chart) -> [{ts, date, o, h, l, c, v}], bad rows dropped. */
export function toCandles(json) {
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) return [];
  const q = r.indicators?.quote?.[0] || {};
  const out = [];
  r.timestamp.forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (c == null || o == null || h == null || l == null || Number.isNaN(c)) return;
    out.push({ ts: t * 1000, date: new Date(t * 1000), o, h, l, c, v: q.volume?.[i] || 0 });
  });
  return out;
}

const IST_MS = 5.5 * 3600 * 1000;

/** IST wall-clock parts of a timestamp: {day:'YYYY-MM-DD', min: minutes since midnight, dow: 0=Sun..6=Sat}. */
export function istParts(ts) {
  const d = new Date(ts + IST_MS);
  return { day: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}

/** Is the NSE cash/F&O session open at `ts`? (Mon-Fri 09:15-15:30 IST; exchange holidays are not modelled.) */
export function isMarketOpen(ts = Date.now()) {
  const p = istParts(ts);
  return p.dow >= 1 && p.dow <= 5 && p.min >= 9 * 60 + 15 && p.min < 15 * 60 + 30;
}

/** Per-IST-day VWAP; equal weights when the feed has no volume (Yahoo index data). */
export function vwapIst(candles) {
  let tpv = 0, vol = 0, last = '';
  return candles.map(c => {
    const d = istParts(c.ts).day;
    if (d !== last) { tpv = 0; vol = 0; last = d; }
    const w = c.v || 1;
    tpv += (c.h + c.l + c.c) / 3 * w; vol += w;
    return tpv / vol;
  });
}
