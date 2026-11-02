'use strict';
/* Auto-scanner: every 5 minutes (market hours) re-checks each symbol in the universe on the 15m chart
 * (confirmed by the 5m chart), adds news sentiment, and produces BUY CE / BUY PE / WAIT with an ATM option.
 * Runs in the browser, so it works while the page is open. */
import { CONFIG } from './config.js';
import { yahooFetch, _toYahooSym } from './market-data.js';
import { NewsFilter } from './news.js';
import { toCandles, isMarketOpen } from './candles.js';
import { underlyingOf, sessionChange } from './scan-utils.js';

export { underlyingOf, sessionChange };
import { evaluate, combine } from './strategies.js';

export const DEFAULT_UNIVERSE = ['NIFTY 50', 'BANK NIFTY', 'SENSEX', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS',
  'SBIN', 'TATASTEEL', 'AXISBANK', 'ITC', 'LT', 'BHARTIARTL', 'MARUTI'];

const KEY = 'ryugan_scan_universe', SND = 'ryugan_scan_sound';
const SCAN_MS = 5 * 60 * 1000, SETTLE_MS = 8000, CONCURRENCY = 4;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: keep in memory only */ } },
};

export const Scanner = (() => {
  let universe = null, running = false, timer = null, tick = null;
  let nextAt = 0, lastScan = null;
  const results = new Map();
  const listeners = new Set();
  const emit = e => listeners.forEach(fn => { try { fn(e); } catch (err) { console.error(err); } });

  function getUniverse() {
    if (universe) return universe;
    try { const v = JSON.parse(store.get(KEY) || 'null'); if (Array.isArray(v) && v.length) universe = v; } catch { /* use defaults */ }
    return (universe ||= [...DEFAULT_UNIVERSE]);
  }
  function setUniverse(list) { universe = [...new Set(list.map(s => s.trim().toUpperCase()).filter(Boolean))]; store.set(KEY, JSON.stringify(universe)); emit({ type: 'universe' }); }
  const addSymbol = s => setUniverse([...getUniverse(), s]);
  const removeSymbol = s => { setUniverse(getUniverse().filter(x => x !== s.toUpperCase())); results.delete(s.toUpperCase()); emit({ type: 'done' }); };

  async function fetchCandles(sym, interval, range) {
    return toCandles(await yahooFetch(_toYahooSym(sym), interval, range));
  }

  async function optionFor(sym, call, spot) {
    const u = underlyingOf(sym).chain;
    if (!u) return { error: 'No option chain for this index' };
    try {
      const res = await fetch(`${CONFIG.PROXY_BASE || ''}/api/fo/option-chain?underlying=${encodeURIComponent(u)}&strikes=2`);
      if (!res.ok) return { error: res.status === 503 ? 'Option data not ready (Angel session / contract list loading)' : `Option chain error ${res.status}` };
      const d = await res.json();
      const rows = d.rows || [];
      if (!rows.length) return { error: 'No strikes returned' };
      const row = rows.reduce((a, b) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a));
      const leg = call === 'BUY CE' ? row.ce : row.pe;
      if (!leg) return { error: 'ATM contract missing' };
      return { symbol: leg.symbol, strike: row.strike, type: call === 'BUY CE' ? 'CE' : 'PE', ltp: leg.ltp, expiry: d.expiry };
    } catch (e) { return { error: 'Option chain unavailable' }; }
  }

  async function scanOne(sym) {
    const key = sym.toUpperCase();
    try {
      const [c15, c5, news] = await Promise.all([
        fetchCandles(sym, '15m', '5d'), fetchCandles(sym, '5m', '5d'), NewsFilter.fetch(underlyingOf(sym).news).catch(() => null),
      ]);
      if (c15.length < 60) throw new Error(`only ${c15.length} candles of 15m data`);
      const nw = news && news.headlines?.length ? news.sentiment : null;
      const r15 = evaluate(c15, { intraday: true, news: nw });
      const r5 = c5.length >= 60 ? evaluate(c5, { intraday: true }) : null;
      const fin = combine(r15, r5);
      const out = {
        sym: key, ok: true, price: c15[c15.length - 1].c, changePct: sessionChange(c15),
        call: fin.call, confidence: fin.confidence, score: fin.score, maxScore: fin.maxScore, adx: fin.adx,
        votes: fin.votes, levels: fin.levels, note: fin.note, newsLabel: nw ? nw.label : 'NONE',
        headlines: news?.headlines || [], at: Date.now(), candleTs: c15[c15.length - 1].ts, option: null,
      };
      if (out.call !== 'WAIT') out.option = await optionFor(sym, out.call, out.price);
      return out;
    } catch (e) {
      return { sym: key, ok: false, error: String(e.message || e), call: 'WAIT', confidence: 0, at: Date.now() };
    }
  }

  async function run(reason = 'manual') {
    if (running) return;
    running = true;
    const list = [...getUniverse()];
    emit({ type: 'start', total: list.length, reason });
    let done = 0, idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const sym = list[idx++];
        const prev = results.get(sym.toUpperCase());
        const r = await scanOne(sym);
        results.set(sym.toUpperCase(), r);
        done++;
        emit({ type: 'progress', done, total: list.length, result: r });
        if (r.ok && r.call !== 'WAIT' && (!prev || prev.call !== r.call)) { emit({ type: 'signal', result: r }); beep(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    lastScan = Date.now(); running = false;
    emit({ type: 'done', lastScan });
  }

  function beep() {
    if (store.get(SND) !== '1') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch { /* audio blocked until the user interacts with the page */ }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const now = Date.now();
    nextAt = Math.ceil(now / SCAN_MS) * SCAN_MS + SETTLE_MS;     // just after the next 5-minute candle closes
    timer = setTimeout(async () => {
      if (isMarketOpen()) await run('auto');
      scheduleNext();
    }, nextAt - now);
  }

  function start() {
    if (tick) return;
    scheduleNext();
    tick = setInterval(() => emit({ type: 'tick', nextAt, open: isMarketOpen(), running }), 1000);
    run('startup');                                                // fill the table straight away, even off-hours
  }

  return {
    start, run, getUniverse, setUniverse, addSymbol, removeSymbol,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get results() { return results; },
    get lastScan() { return lastScan; },
    get running() { return running; },
    soundOn: () => store.get(SND) === '1',
    setSound: on => store.set(SND, on ? '1' : '0'),
  };
})();
