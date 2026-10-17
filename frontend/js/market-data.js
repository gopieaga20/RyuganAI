'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { callClaude, extractJson } from './ai.js';
import { WL } from './watchlist.js';

export async function yahooFetch(sym, interval = '1d', range = '2d') {
  try {
    const url = `${CONFIG.PROXY_BASE}/api/yahoo-chart/${encodeURIComponent(sym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getPrice(sym) {
  try {
    // Route ALL symbols (options + equities + indices) through the backend proxy.
    // The backend will use Angel One SmartAPI for live prices, with Yahoo Finance fallback.
    const j = await yahooFetch(sym, '1d', '2d');
    if (!j) return null;
    const c = j.chart.result[0];
    const price = c.meta.regularMarketPrice;
    const prev = c.meta.chartPreviousClose || price;
    return { c: price, p: prev, sym, diff: price - prev, pct: ((price - prev) / prev) * 100 };
  } catch {
    return null;
  }
}

let _searchTimeout = null;
let _searchSeq = 0;
export async function debounceSearch(ev, listId) {
  const q = ev.target.value.trim();
  if (q.length < 2) return;
  
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(async () => {
    try {
      const list = document.getElementById(listId);
      if (!list) return;

      const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

      // 1. Real option contracts (from Angel's scrip master) when a strike number is typed.
      //    The browser filters datalist entries by what you typed (matching value OR label),
      //    so the label also carries the typed text — otherwise "NIFTY 23100" would hide
      //    "NIFTY27OCT2623100CE", since neither contains that text as typed.
      const optionsReq = /\d{3,}/.test(q)
        ? fetch(`${CONFIG.PROXY_BASE}/api/options/search?q=${encodeURIComponent(q)}&limit=40`)
            .then(r => (r.ok ? r.json() : { contracts: [] })).catch(() => ({ contracts: [] }))
        : Promise.resolve({ contracts: [] });

      // 2. Equity/Index symbols from Yahoo Finance
      const yahooReq = fetch(`${CONFIG.PROXY_BASE}/api/yahoo/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null);

      const seq = ++_searchSeq;
      const optionOptionsFrom = (d) => (d.contracts || []).map(c =>
        `<option value="${esc(c.symbol)}" label="${esc(c.label)} (${esc(q)})">${esc(c.label)} (Option)</option>`);

      // Show real contracts as soon as they arrive — don't wait for Yahoo's slower autosuggest.
      const optData = await optionsReq;
      if (seq !== _searchSeq) return; // a newer keystroke superseded this search
      const optionOptions = optionOptionsFrom(optData);
      if (optionOptions.length) list.innerHTML = optionOptions.join('');

      const yahooData = await yahooReq;
      if (seq !== _searchSeq) return;

      let yahooOptions = [];
      if (yahooData?.quotes) {
        yahooOptions = yahooData.quotes
          .filter(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.NFO') || q.symbol.endsWith('.BO') || q.symbol.startsWith('^')))
          .map(q => {
            let sym = q.symbol.replace('.NS', '').replace('.BO', '').replace('.NFO', '');
            if (sym.startsWith('^')) sym = q.shortname || sym;
            return `<option value="${esc(sym)}">${esc(q.shortname || q.longname || '')} (${esc(q.typeDisp || 'Equity')})</option>`;
          });
      }

      // Final list: real contracts first, then equities/indices
      list.innerHTML = optionOptions.concat(yahooOptions).join('');
    } catch (e) { console.error('Search failed', e); }
  }, 400); // 400ms debounce
}

export async function fetchGlobalCues() {
  // Mark as loading
  ['gc-sgx','gc-dow','gc-crude','gc-gold','gc-usd','gc-dxy'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.textContent === '--') el.textContent = '…';
  });

  try {
    const base = CONFIG.PROXY_BASE || '';
    const r = await window.fetch(`${base}/api/global-cues`);
    if (!r.ok) throw new Error('API error');
    const d = await r.json();

    function _render(id, item) {
      const el = document.getElementById(id);
      if (!el || !item) return;
      const pct = item.pct ?? 0;
      const sign = pct >= 0 ? '+' : '';
      el.textContent = `${item.val ?? '--'} (${sign}${pct.toFixed(2)}%)`;
      el.style.color = item.up === null ? 'var(--text2)' : item.up ? 'var(--green)' : 'var(--down)';
    }
    function _renderPlain(id, item) {
      const el = document.getElementById(id);
      if (!el || !item) return;
      el.textContent = item.val ?? '--';
      el.style.color = item.up === null ? 'var(--text2)' : item.up ? 'var(--green)' : 'var(--down)';
    }

    _render('gc-sgx',   d.gift_nifty);
    _render('gc-dow',   d.dow);
    _render('gc-crude', d.crude);
    _render('gc-gold',  d.gold);
    _render('gc-dxy',   d.dxy);
    _renderPlain('gc-usd', d.usdinr);

    // Bias banner
    const biasEl = document.getElementById('gc-bias');
    if (biasEl) {
      const b = d.bias ?? 'NEUTRAL';
      biasEl.textContent = b;
      biasEl.style.color = b === 'POSITIVE' ? 'var(--green)' : b === 'NEGATIVE' ? 'var(--down)' : 'var(--warn)';
    }
    // Timestamp
    if (d.timestamp) DOM.setText('gc-ts', `Updated ${d.timestamp}`);
    return d;
  } catch (e) {
    console.error('fetchGlobalCues error:', e);
    // Fallback: ask the AI proxy (degrades to algo fallback server-side if no key configured)
    try {
      const prompt = `Search for current global market data: SGX/GIFT Nifty level, Dow Jones, WTI crude oil, USD/INR, Gold MCX, DXY.
Respond ONLY in JSON: {"sgx":"level","dow":"level change","crude":"price change","usdinr":"rate","gold":"price","dxy":"level change","bias":"positive/negative/neutral"}`;
      const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA);
      const d = extractJson(raw);
      if (!d) return null;
      const isUp = v => v && (String(v).includes('+') || String(v).toLowerCase().includes('up'));
      ['gc-sgx','gc-dow'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = (id === 'gc-sgx' ? d.sgx : d.dow) || '--'; el.style.color = isUp(el.textContent) ? 'var(--green)' : 'var(--down)'; }
      });
      DOM.setText('gc-crude', d.crude || '--');
      DOM.setText('gc-gold',  d.gold  || '--');
      DOM.setText('gc-usd',   d.usdinr|| '--');
      DOM.setText('gc-dxy',   d.dxy   || '--');
      return d;
    } catch (_) {}
    return null;
  }
}

export function updateVIX(v) {
  const n = parseFloat(v);
  DOM.setText('h-vix', v);
  DOM.setText('vix-big', v);
  const zone = n < 12 ? 'CALM' : n < 16 ? 'NORMAL' : n < 20 ? 'ELEVATED' : n < 25 ? 'HIGH' : 'EXTREME';
  const color = n < 12 ? 'var(--green)' : n < 16 ? 'var(--text2)' : n < 20 ? 'var(--warn)' : 'var(--down)';
  DOM.setText('vix-zone', zone); DOM.setColor('vix-zone', color);
  DOM.setText('h-vix-c', zone);
  DOM.setColor('vix-big', color);
  DOM.setText('vix-mood', n < 16 ? 'Calm / Greed' : 'Fear / Volatile');
  DOM.setText('vix-prem', n > 18 ? 'HIGH — Sell premium' : 'NORMAL — Buy directional');
  DOM.setText('vix-strat', n > 20 ? 'Iron Condor / Strangle sell' : n > 15 ? 'Straddle / Vertical spread' : 'Buy calls/puts directionally');
}

export async function fetchLiveTickers() {
  const pairs = [
    { sym: '^NSEI',     valId: 'h-nifty',   chgId: 'h-nifty-c'  },
    { sym: '^NSEBANK',  valId: 'h-bnifty',  chgId: 'h-bnifty-c' },
    { sym: '^INDIAVIX', valId: 'h-vix',     chgId: 'h-vix-c'    },
    { sym: 'USDINR=X',  valId: 'h-usdinr',  chgId: null          },
  ];
  await Promise.all(pairs.map(async t => {
    const d = await getPrice(t.sym);
    if (!d) return;
    const fmt = d.c.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const chg = (d.pct >= 0 ? '+' : '') + d.pct.toFixed(2) + '%';
    const col = d.pct >= 0 ? 'var(--clr-green)' : 'var(--clr-red)';
    DOM.setText(t.valId, fmt);
    if (t.chgId) { DOM.setText(t.chgId, chg); DOM.setColor(t.chgId, col); }
  }));
  // Also refresh watchlist with new prices
  WL.refresh();
}

export const _SYM_MAP = {
  'NIFTY 50': '^NSEI', 'BANK NIFTY': '^NSEBANK', 'SENSEX': '^BSESN',
  'FINNIFTY': '^NSEMDCP50', 'RELIANCE': 'RELIANCE.NS', 'HDFC BANK': 'HDFCBANK.NS',
  'INFOSYS': 'INFY.NS', 'TCS': 'TCS.NS', 'ICICI BANK': 'ICICIBANK.NS',
  'ADANI ENT': 'ADANIENT.NS', 'TATA MOTORS': 'TATAMOTORS.NS',
  'BAJAJ FINANCE': 'BAJFINANCE.NS', 'SBIN': 'SBIN.NS',
  'BHARTIARTL': 'BHARTIARTL.NS', 'ITC': 'ITC.NS', 'LT': 'LT.NS',
  'AXISBANK': 'AXISBANK.NS', 'KOTAKBANK': 'KOTAKBANK.NS',
};

export function _toYahooSym(name) {
  const n = name.toUpperCase();
  if (n.match(/^(NIFTY|BANKNIFTY)\s+(\d{1,2}\s+[A-Z]{3})\s+(\d+)\s+(CE|PE)$/i)) return n;
  // Real contract trading symbol, e.g. NIFTY27OCT2623100CE
  if (/^[A-Z][A-Z0-9&-]*\d{2}[A-Z]{3}\d{2}\d+(CE|PE)$/.test(n)) return n;
  return _SYM_MAP[n] || (n.endsWith('.NS') ? n : n + '.NS');
}
