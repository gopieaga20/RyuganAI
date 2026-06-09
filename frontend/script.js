/**
 * ════════════════════════════════════════════════════════
 *  RYUGAN AI — Trading Command Center
 *  Rewritten for security, modularity, and F&O support
 * ════════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════════
   MODULE: CONFIG
═══════════════════════════════════════════ */
const CONFIG = Object.freeze({
  API_URL: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-3-5-sonnet-20241022',
  MAX_TOKENS: 1200,
  PROXY_BASE: (() => window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '')(),
  ANALYST_PERSONA: `You are a veteran Indian stock market analyst with 20+ years on NSE/BSE.
Expert in Nifty 50, Bank Nifty, intraday trading, F&O, RSI/MACD/BB/VWAP/EMA, PCR, Max Pain,
sectoral rotation, FII/DII flows, RBI policy, USD/INR, crude oil effects on Indian markets.
Speak like a seasoned trader — direct, confident, specific levels. Search current data before answering.`
});

/* ═══════════════════════════════════════════
   MODULE: SECURITY — API KEY MANAGEMENT
   Stored in sessionStorage so it persists across
   refreshes but clears automatically when browser
   tab/window is closed. Never put in localStorage.
═══════════════════════════════════════════ */
const _SK_KEY = 'ryugan_ak';
const ApiKeyStore = {
  set(key) {
    if (typeof key !== 'string' || !key.startsWith('sk-ant-')) return false;
    sessionStorage.setItem(_SK_KEY, key.trim());
    return true;
  },
  get() { return sessionStorage.getItem(_SK_KEY); },
  clear() { sessionStorage.removeItem(_SK_KEY); },
  has() {
    const k = sessionStorage.getItem(_SK_KEY);
    return k !== null && k.length > 10;
  }
};

function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const val = (input?.value || '').trim();
  const status = document.getElementById('api-key-status');

  if (!val) {
    ApiKeyStore.clear();
    status.textContent = 'Key cleared.';
    status.style.color = 'var(--text3)';
    return;
  }
  if (!val.startsWith('sk-ant-')) {
    status.textContent = '✗ Invalid key format';
    status.style.color = 'var(--down)';
    return;
  }
  ApiKeyStore.set(val);
  input.value = '';
  status.textContent = '✓ Key saved (session only)';
  status.style.color = 'var(--green)';
}

/* ═══════════════════════════════════════════
   MODULE: SECURE DOM HELPERS
   All user/API content uses textContent, never innerHTML
   except in fully controlled, whitelist-validated paths.
═══════════════════════════════════════════ */
const DOM = {
  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? '--');
  },
  setHtml(id, html) {
    /* Only used for trusted, internally-generated HTML */
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  },
  setColor(id, color) {
    const el = document.getElementById(id);
    if (el) el.style.color = color;
  },
  setWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  },
  show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; },
  hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; },
  /** Escape user text for embedding in HTML strings (trusted builders only) */
  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

/* ═══════════════════════════════════════════
   MODULE: STATE
═══════════════════════════════════════════ */
const State = {
  chatHistory: [],
  btData: [],
  tradeLog: [],
  equityHistory: [],
  allTrades: [],
  recentSignals: [],
  ptPositions: [],
  selStrats: new Set(['ema', 'orb', 'smc']),
  tvChart: null,
  tvSeries: null,
  rpData: [],
  rpIdx: 0,
  rpAuto: false,
  pnlInterval: null,
  reset() {
    this.btData = [];
    this.tradeLog = [];
    this.equityHistory = [];
    this.allTrades = [];
  }
};

/* ═══════════════════════════════════════════
   MODULE: LOADING
═══════════════════════════════════════════ */
function showOv(msg = 'LOADING...') {
  DOM.setText('ovMsg', msg);
  document.getElementById('ov')?.classList.add('show');
}
function hideOv() {
  document.getElementById('ov')?.classList.remove('show');
}

/* ═══════════════════════════════════════════
   MODULE: CLOCK & MARKET STATUS
═══════════════════════════════════════════ */
function tick() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  const s = String(ist.getSeconds()).padStart(2, '0');
  DOM.setText('clock', `${h}:${m}:${s} IST`);
  const open = ist.getHours() >= 9 && (ist.getHours() < 15 || (ist.getHours() === 15 && ist.getMinutes() <= 30));
  const pulse = document.getElementById('mpulse');
  const statusEl = document.getElementById('mstatus-txt');
  if (pulse) pulse.style.background = open ? 'var(--green)' : 'var(--down)';
  if (statusEl) {
    statusEl.textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
    statusEl.style.color = open ? 'var(--green)' : 'var(--down)';
  }
}
setInterval(tick, 1000);
tick();

/* ═══════════════════════════════════════════
   MODULE: TAB NAVIGATION
═══════════════════════════════════════════ */
const ALL_TABS = ['nifty', 'signals', 'morning', 'fo', 'sectors', 'backtest', 'analyst', 'tradelog', 'paper'];
function switchTab(t) {
  if (!ALL_TABS.includes(t)) return;
  // Update sidebar nav active state
  document.querySelectorAll('.nav-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === t);
  });
  // Switch visible tab pane
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${t}`)?.classList.add('active');
  // Refresh paper trading data when switching to that tab
  if (t === 'paper') refreshPaperTrading();
}

const BT_TABS = ['bt-setup', 'bt-results', 'bt-trades', 'bt-chart', 'bt-replay', 'bt-accuracy'];
function switchBTTab(t) {
  document.querySelectorAll('.sub-tab').forEach((el, i) => {
    el.classList.toggle('active', BT_TABS[i] === t);
  });
  BT_TABS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === t ? 'block' : 'none';
  });
  if (t === 'bt-chart' && State.tvChart) State.tvChart.timeScale().fitContent();
}

/* ═══════════════════════════════════════════
   MODULE: API — SECURE CALL
   All calls go through this function.
   Never exposes key in DOM/localStorage.
═══════════════════════════════════════════ */
async function callClaude(userPrompt, systemPrompt, useSearch = true) {
  if (!ApiKeyStore.has()) {
    return algoFallback(userPrompt);
  }

  const body = {
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };

  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      cache: 'no-store', // Added cache: 'no-store'
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ApiKeyStore.get(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 401 || res.status === 403) {
      ApiKeyStore.clear();
      DOM.setText('api-key-status', '✗ Key rejected (401/403)');
      DOM.setColor('api-key-status', 'var(--down)');
      window.alert('The Anthropic API key you provided was rejected by Anthropic (Error 401/403). It is either invalid, revoked, or your account has no credits. Falling back to mathematical signals.');
      return algoFallback(userPrompt);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    return (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

  } catch (err) {
    console.error('Claude API error:', err);
    return algoFallback(userPrompt);
  }
}

/* Extract JSON safely from any response string */
function extractJson(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   MODULE: YAHOO FINANCE PROXY
═══════════════════════════════════════════ */
async function yahooFetch(sym, interval = '1d', range = '2d') {
  try {
    const url = `${CONFIG.PROXY_BASE}/api/yahoo-chart/${encodeURIComponent(sym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getPrice(sym) {
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
async function debounceSearch(ev, listId) {
  const q = ev.target.value.trim();
  if (q.length < 2) return;
  
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(async () => {
    try {
      const list = document.getElementById(listId);
      if (!list) return;

      // 1. Generate Synthetic Options if a strike price (number) is typed
      const match = q.match(/(\d{4,5})/);
      let synthOptions = [];
      if (match) {
        const strike = match[1];
        const d = new Date();
        const qUp = q.toUpperCase();
        
        // Loop for current expiry + next 2 expiries
        for (let i = 0; i < 3; i++) {
          // Tuesday (NIFTY)
          const nD = new Date(d);
          nD.setDate(d.getDate() + ((2 + 7 - d.getDay()) % 7) + (i * 7));
          const nExp = nD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
          
          // Wednesday (BANKNIFTY)
          const bD = new Date(d);
          bD.setDate(d.getDate() + ((3 + 7 - d.getDay()) % 7) + (i * 7));
          const bExp = bD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();

          if (qUp.includes('BANK') || !qUp.includes('NIFTY')) {
            synthOptions.push(`<option value="BANKNIFTY ${bExp} ${strike} CE">BANKNIFTY ${bExp} ${strike} CE (Option)</option>`);
            synthOptions.push(`<option value="BANKNIFTY ${bExp} ${strike} PE">BANKNIFTY ${bExp} ${strike} PE (Option)</option>`);
          }
          if (!qUp.includes('BANK')) {
            synthOptions.push(`<option value="NIFTY ${nExp} ${strike} CE">NIFTY ${nExp} ${strike} CE (Option)</option>`);
            synthOptions.push(`<option value="NIFTY ${nExp} ${strike} PE">NIFTY ${nExp} ${strike} PE (Option)</option>`);
          }
        }
      }

      // 2. Fetch Equity/Index symbols from Yahoo Finance
      const res = await fetch(`${CONFIG.PROXY_BASE}/api/yahoo/search?q=${encodeURIComponent(q)}`);
      let yahooOptions = [];
      if (res.ok) {
        const data = await res.json();
        if (data.quotes) {
          yahooOptions = data.quotes
            .filter(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.NFO') || q.symbol.endsWith('.BO') || q.symbol.startsWith('^')))
            .map(q => {
               let sym = q.symbol.replace('.NS', '').replace('.BO', '').replace('.NFO', '');
               if (sym.startsWith('^')) sym = q.shortname || sym;
               return `<option value="${sym}">${q.shortname || q.longname || ''} (${q.typeDisp || 'Equity'})</option>`;
            });
        }
      }
      
      // 3. Combine and render
      const allOps = synthOptions.concat(yahooOptions);
      if (allOps.length > 0) {
        list.innerHTML = allOps.join('');
      } else {
        list.innerHTML = ''; // Clear if no matches
      }
    } catch (e) { console.error('Search failed', e); }
  }, 400); // 400ms debounce
}

/* ═══════════════════════════════════════════
   MODULE: ALGORITHMIC ENGINE (no API key needed)
   Computes real signals from Yahoo Finance data
═══════════════════════════════════════════ */
async function algoFallback(prompt) {
  const p = prompt.toLowerCase();

  if (p.includes('morning brief')) return await algoMorningBrief();
  if (p.includes('f&o options')) return await algoFO(prompt);
  if (p.includes('sectoral index')) return await algoSectors();
  if (p.includes('global market data')) return await algoGlobal();
  if (p.includes('intraday trading') || p.includes('search for current')) return await algoSignal(prompt);
  if (p.includes('review this backtest result')) return 'Add your API key for a detailed AI review of backtest results.';
  if (p.includes('backtest:')) return 'Add your API key for detailed bactest Q&A analysis.';
  return 'Add your Anthropic API key (Settings panel) to unlock full AI analysis. Algorithmic engine is active for price data.';
}

async function algoMorningBrief() {
  // Fetch real global cues first
  let globalCues = {};
  try {
    const base = CONFIG.PROXY_BASE || '';
    const r = await window.fetch(`${base}/api/global-cues`);
    if (r.ok) globalCues = await r.json();
  } catch (_) {}

  const [nf, bnf, vix, crude, usdinr] = await Promise.all([
    getPrice('^NSEI'), getPrice('^NSEBANK'), getPrice('^INDIAVIX'),
    getPrice('CL=F'), getPrice('INR=X')
  ]);
  const nfC = nf?.c || 23000;
  const bnfC = bnf?.c || 53000;
  const giftVal = globalCues.gift_nifty?.val ?? (nf ? nf.c.toFixed(0) : 'N/A');
  const giftPct = globalCues.gift_nifty?.pct ?? 0;
  const giftBias = giftPct >= 0 ? 'positive gap-up' : 'negative gap-down';

  return JSON.stringify({
    date: new Date().toLocaleDateString('en-IN'),
    nifty: nfC.toFixed(2), bnifty: bnfC.toFixed(2),
    vix: (vix?.c || 15).toFixed(2),
    gift_nifty: `${giftVal} (${giftPct >= 0 ? '+' : ''}${giftPct.toFixed(2)}%)`,
    global_bias: globalCues.bias ?? ((nf?.diff >= 0) ? 'POSITIVE' : 'NEGATIVE'),
    dow: globalCues.dow?.val ?? 'N/A',
    crude: globalCues.crude?.val ?? `$${(crude?.c || 78).toFixed(2)}`,
    usdinr: globalCues.usdinr?.val ?? (usdinr?.c || 83).toFixed(2),
    gold: globalCues.gold?.val ?? 'N/A',
    overall_bias: (nf?.diff >= 0 && giftPct >= 0) ? 'BULLISH' : (nf?.diff < 0 && giftPct < 0) ? 'BEARISH' : 'NEUTRAL',
    nifty_support: (nfC * 0.99).toFixed(0), nifty_resist: (nfC * 1.01).toFixed(0),
    bnf_support: (bnfC * 0.99).toFixed(0), bnf_resist: (bnfC * 1.01).toFixed(0),
    fii_buy: 'N/A', fii_sell: 'N/A', fii_net: 'N/A',
    dii_buy: 'N/A', dii_sell: 'N/A', dii_net: 'N/A',
    sgx: giftVal,
    top_sectors: ['Live sector scan active'],
    avoid: ['Check VIX levels'],
    key_news: [`GIFT Nifty: ${giftVal} ${giftBias}`, `VIX: ${(vix?.c || 15).toFixed(2)}`, `Global bias: ${globalCues.bias ?? 'N/A'}`],
    analyst_brief: `Real-time data: GIFT Nifty at ${giftVal} signals ${giftBias}. Add API key for full AI analysis.`,
    strategy: (nf?.diff >= 0) ? 'Buy on dips with tight SL near support.' : 'Sell on rallies at VWAP rejection.'
  });
}

async function algoFO(prompt) {
  const nf = await getPrice('^NSEI');
  const spot = nf?.c || 23000;
  const atm = Math.round(spot / 50) * 50;
  return JSON.stringify({
    pcr: 'N/A', pcr_signal: (nf?.diff >= 0) ? 'bullish' : 'bearish',
    max_pain: atm.toString(), max_pain_note: 'ATM Strike (live calc)',
    iv: 'Live', iv_state: 'normal', iv_strategy: (nf?.diff >= 0) ? 'Bull Spreads' : 'Bear Spreads',
    oi_interpretation: 'Add API key for full OI analysis. Showing ATM approximations.',
    greeks: [
      { strike: atm.toString(), type: 'CE', delta: '0.50', gamma: '0.02', theta: '-10', vega: '8', oi_chg: '+2%' },
      { strike: atm.toString(), type: 'PE', delta: '-0.50', gamma: '0.02', theta: '-10', vega: '8', oi_chg: '+2%' }
    ],
    oi_levels: [
      { strike: (atm + 200).toString(), type: 'CE', oi: 'Highest CE', note: 'Resistance' },
      { strike: (atm - 200).toString(), type: 'PE', oi: 'Highest PE', note: 'Support' }
    ],
    recommendation: (nf?.diff >= 0) ? `Bullish setup, spot ${spot.toFixed(2)}` : `Bearish setup, spot ${spot.toFixed(2)}`
  });
}

async function algoSectors() {
  const syms = [
    { n: 'BANKING', s: '^NSEBANK' }, { n: 'IT', s: '^CNXIT' },
    { n: 'PHARMA', s: '^CNXPHARMA' }, { n: 'AUTO', s: '^CNXAUTO' },
    { n: 'FMCG', s: '^CNXFMCG' }, { n: 'METAL', s: '^CNXMETAL' },
    { n: 'ENERGY', s: '^CNXENERGY' }
  ];
  const results = await Promise.all(syms.map(async x => {
    const d = await getPrice(x.s);
    return { name: x.n, change: d ? `${d.diff > 0 ? '+' : ''}${d.pct.toFixed(2)}%` : '0.00%', val: d?.pct || 0 };
  }));
  const sorted = [...results].sort((a, b) => b.val - a.val);
  return JSON.stringify({
    sectors: results.map(x => ({ name: x.name, change: x.change })),
    rotation_signal: 'Live sector indices from Yahoo Finance proxy.',
    top_picks: [
      { sector: sorted[0]?.name || 'N/A', stock: 'Sector Leader', reason: 'Momentum' },
      { sector: sorted[1]?.name || 'N/A', stock: 'Runner Up', reason: 'Strength' }
    ],
    avoid: [sorted[sorted.length - 1]?.name || 'N/A']
  });
}

async function algoGlobal() {
  try {
    const base = CONFIG.PROXY_BASE || '';
    const r = await window.fetch(`${base}/api/global-cues`);
    if (r.ok) {
      const d = await r.json();
      return JSON.stringify({
        sgx:    d.gift_nifty?.val ?? 'N/A',
        gift_pct: d.gift_nifty?.pct ?? 0,
        dow:    d.dow?.val    ?? 'N/A',
        crude:  d.crude?.val  ?? 'N/A',
        usdinr: d.usdinr?.val ?? 'N/A',
        gold:   d.gold?.val   ?? 'N/A',
        dxy:    d.dxy?.val    ?? 'N/A',
        bias:   d.bias        ?? 'NEUTRAL',
        timestamp: d.timestamp
      });
    }
  } catch (_) {}
  // Fallback to Yahoo
  const [dj, crude, dxy, inr] = await Promise.all([
    getPrice('^DJI'), getPrice('CL=F'), getPrice('DX-Y.NYB'), getPrice('INR=X')
  ]);
  return JSON.stringify({
    sgx: 'N/A',
    dow: dj ? `${dj.c.toFixed(0)} (${dj.pct > 0 ? '+' : ''}${dj.pct.toFixed(2)}%)` : 'N/A',
    crude: crude ? `$${crude.c.toFixed(2)} (${crude.pct > 0 ? '+' : ''}${crude.pct.toFixed(2)}%)` : 'N/A',
    usdinr: inr ? `${inr.c.toFixed(2)}` : 'N/A',
    gold: 'MCX Live',
    dxy: dxy ? `${dxy.c.toFixed(2)} (${dxy.pct > 0 ? '+' : ''}${dxy.pct.toFixed(2)}%)` : 'N/A',
    bias: (dj?.diff >= 0) ? 'positive' : 'negative'
  });
}

async function algoSignal(prompt) {
  let sym = 'NIFTY 50';
  const m1 = prompt.match(/Analyze\s+([\w\s]+?)\s+for\s+intraday/i);
  const m2 = prompt.match(/Search for current\s+([\w\s]+?)\s+price/i);
  if (m1) sym = m1[1].trim();
  else if (m2) sym = m2[1].trim();

  let ys = sym;
  // Use the shared symbol map first (handles HDFC BANK → HDFCBANK.NS etc.)
  if (typeof _SYM_MAP !== 'undefined' && _SYM_MAP[sym.toUpperCase()]) {
    ys = _SYM_MAP[sym.toUpperCase()];
  } else if (sym.includes('NIFTY 50') || sym === 'NIFTY') ys = '^NSEI';
  else if (sym.includes('BANK NIFTY')) ys = '^NSEBANK';
  else if (sym.includes('SENSEX')) ys = '^BSESN';
  else if (!ys.includes('^') && !ys.includes('=')) {
    // Check if it's an option string like "NIFTY 24 MAR 22500 CE"
    if (sym.match(/(CE|PE)$/i)) {
      ys = sym; // Keep it as-is for the backend
    } else {
      // Remove spaces and add .NS suffix (e.g. "HDFC BANK" → "HDFCBANK.NS")
      ys = sym.replace(/\s+/g, '') + '.NS';
    }
  }

  try {
    const js = await yahooFetch(ys, '15m', '5d');
    if (!js) throw new Error('No data');
    const r = js.chart.result[0];
    const q = r.indicators.quote[0];
    const candles = r.timestamp
      .map((t, i) => ({ date: new Date(t * 1000), h: q.high[i], l: q.low[i], c: q.close[i], o: q.open[i], v: q.volume[i] }))
      .filter(d => d.c != null && !isNaN(d.c));

    if (candles.length < 2) throw new Error('Insufficient data');

    const closes = candles.map(x => x.c);
    const rsiArr = Indicators.rsi(closes, 14);
    const ema9 = Indicators.ema(closes, 9);
    const ema21 = Indicators.ema(closes, 21);
    const bbArr = Indicators.bb(closes, 20, 2);
    const vwArr = Indicators.vwap(candles);
    const atrArr = Indicators.atr(candles, 14);
    const ema50 = Indicators.ema(closes, 50);

    const cur = candles[candles.length - 1];
    const prev = r.meta.chartPreviousClose || closes[0];
    const diff = cur.c - prev;
    const pct = (diff / prev) * 100;
    const rsi = rsiArr[rsiArr.length - 1] || 50;
    const e9 = ema9[ema9.length - 1] || cur.c;
    const e21 = ema21[ema21.length - 1] || cur.c;
    const vw = vwArr[vwArr.length - 1] || cur.c;
    const bb = bbArr[bbArr.length - 1] || { mid: cur.c };
    const atr = atrArr[atrArr.length - 1] || (cur.c * 0.005);
    const e50 = ema50[ema50.length - 1] || cur.c;

    let buyScore = 0, sellScore = 0;
    if (cur.c > vw) buyScore += 20; else sellScore += 20;
    if (e9 > e21) buyScore += 20; else sellScore += 20;
    if (cur.c > e50) buyScore += 15; else sellScore += 15;
    if (rsi > 52) buyScore += 10;
    if (rsi > 60) buyScore += 10;
    if (rsi < 48) sellScore += 10;
    if (rsi < 40) sellScore += 10;
    if (cur.c > bb.mid) buyScore += 10; else sellScore += 10;
    if (cur.c > (bb.upper || cur.c)) buyScore += 10;
    if (cur.c < (bb.lower || cur.c)) sellScore += 10;

    const avgVol = candles.slice(-10).reduce((a, b) => a + (b.v || 0), 0) / 10;
    if (cur.v > avgVol * 1.1) {
      if (cur.c > cur.o) buyScore += 10; else sellScore += 10;
    }

    const isBullish = buyScore >= sellScore;
    const rawConf = isBullish ? buyScore : sellScore;
    const conf = Math.min(98, Math.max(62, Math.floor(rawConf * 0.88 + 10)));
    const sl = isBullish ? cur.c - atr * 1.5 : cur.c + atr * 1.5;
    const t1 = isBullish ? cur.c + atr * 2 : cur.c - atr * 2;
    const t2 = isBullish ? cur.c + atr * 3.5 : cur.c - atr * 3.5;
    const rtp = isBullish ? ((t1 - cur.c) / (cur.c - sl)) : ((cur.c - t1) / (sl - cur.c));
    const ltp = r.meta.regularMarketPrice || cur.c;

    // Fetch news and apply sentiment filter
    const newsEntry = await NewsFilter.fetch(sym);
    let sigData = {
      signal: isBullish ? 'BUY' : 'SELL',
      symbol: (r.meta.symbol || sym).replace('.NS', ''),
      price: ltp.toFixed(2),
      change: diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      changePct: diff > 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`,
      entry: cur.c.toFixed(2), sl: sl.toFixed(2), t1: t1.toFixed(2), t2: t2.toFixed(2),
      confidence: conf,
      rr: `1:${rtp.toFixed(1)}`,
      basis: 'Algorithmic TA — RSI/EMA/VWAP/BB',
      rsi: rsi.toFixed(1) + (rsi > 60 ? ' Bullish' : rsi < 40 ? ' Bearish' : ' Neutral'),
      macd: e9 > e21 ? 'Bullish (9EMA > 21EMA)' : 'Bearish (9EMA < 21EMA)',
      bb: cur.c > bb.mid ? 'Above Mid Band' : 'Below Mid Band',
      vwap: cur.c > vw ? 'Above VWAP' : 'Below VWAP',
      ema: cur.c > e21 ? 'Above 21 EMA' : 'Below 21 EMA',
      volume: `Vol: ${(cur.v || 0).toLocaleString()}`,
      analyst_note: `Algorithmic signal for ${r.meta.symbol || sym}. Currently ${isBullish ? 'above' : 'below'} VWAP. RSI at ${rsi.toFixed(1)} indicates ${rsi > 60 ? 'bullish' : rsi < 40 ? 'bearish' : 'neutral'} momentum. Add API key for AI narrative.`,
      news_impact: newsEntry.headlines.length > 0
        ? newsEntry.headlines.slice(0, 2).map(h => h.title).join(' | ')
        : 'Live algo evaluation from Yahoo Finance proxy.',
      vix: ''
    };
    sigData = applyNewsSentiment(sigData, newsEntry);
    return JSON.stringify(sigData);
  } catch (e) {
    console.error('Algo signal failed:', e);
    return JSON.stringify({
      signal: 'HOLD', symbol: sym, price: 'N/A', change: '0', changePct: '0%',
      entry: '-', sl: '-', t1: '-', t2: '-', confidence: '50', rr: '1:1',
      basis: 'Data fetch failed — check proxy', rsi: 'N/A', macd: 'N/A',
      bb: 'N/A', vwap: 'N/A', ema: 'N/A', volume: 'N/A',
      analyst_note: 'Could not fetch Yahoo Finance data. Ensure the backend proxy is running.',
      news_impact: ''
    });
  }
}

/* ═══════════════════════════════════════════
   MODULE: NEWS FILTER
   Fetches market news from /api/news every 15 min.
   Scores sentiment and adjusts signal confidence.
═══════════════════════════════════════════ */
let _niftyLastNewsSym = 'NIFTY';
const NewsFilter = (() => {
  const _cache = {};   // { sym → { headlines, sentiment, fetchedAt } }
  const TTL = 15 * 60 * 1000; // 15 min

  const _BEARISH_KW = ['crash', 'fall', 'drop', 'decline', 'sell-off', 'selloff',
    'weak', 'loss', 'ban', 'penalty', 'raid', 'inflation', 'rate hike', 'recession',
    'downgrade', 'slump', 'plunge', 'tanking', 'bloodbath', 'warning', 'default',
    'fear', 'concern', 'risk', 'uncertainty', 'profit booking'];
  const _BULLISH_KW = ['rally', 'rise', 'gain', 'surge', 'strong', 'buy', 'profit',
    'upgrade', 'record', 'beat', 'growth', 'positive', 'expansion', 'bullish',
    'outperform', 'breakout', 'momentum', 'inflow', 'rebound', 'recovery', 'optimism'];

  function _score(headlines) {
    let bull = 0, bear = 0;
    for (const h of headlines) {
      const t = (h.title || '').toLowerCase();
      for (const kw of _BULLISH_KW) if (t.includes(kw)) { bull++; break; }
      for (const kw of _BEARISH_KW) if (t.includes(kw)) { bear++; break; }
    }
    const total = Math.max(bull + bear, 1);
    const score = (bull - bear) / total;
    const label = score > 0.2 ? 'BULLISH' : score < -0.2 ? 'BEARISH' : 'NEUTRAL';
    return { score, label, bull, bear, total: headlines.length };
  }

  async function fetch(sym) {
    const key = (sym || 'NIFTY').toUpperCase();
    const now = Date.now();
    if (_cache[key] && now - _cache[key].fetchedAt < TTL) return _cache[key];
    try {
      const base = CONFIG.PROXY_BASE || '';
      const res = await window.fetch(`${base}/api/news?q=${encodeURIComponent(key)}&limit=8`);
      const json = await res.json();
      const headlines = json.headlines || [];
      const sentiment = _score(headlines);
      const entry = { headlines, sentiment, fetchedAt: now };
      _cache[key] = entry;
      return entry;
    } catch (_) {
      return { headlines: [], sentiment: { score: 0, label: 'NEUTRAL', bull: 0, bear: 0, total: 0 }, fetchedAt: now };
    }
  }

  function _timeAgo(pubStr) {
    if (!pubStr) return '';
    const d = new Date(pubStr);
    if (isNaN(d)) return pubStr.slice(0, 16);
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  function renderFeed(headlines, sentiment, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!headlines || headlines.length === 0) {
      el.innerHTML = '<div class="news-feed-empty">No headlines available</div>';
      return;
    }
    const sentClass = (sentiment?.label || 'NEUTRAL').toLowerCase();
    const sentLabel = sentiment?.label || 'NEUTRAL';
    const sentIcon = sentLabel === 'BULLISH' ? '▲' : sentLabel === 'BEARISH' ? '▼' : '—';
    let html = `<div class="news-feed-header"><span>📰 LIVE NEWS</span><span class="nf-sentiment ${sentClass}">${sentIcon} ${sentLabel}</span></div>`;
    for (const h of headlines.slice(0, 5)) {
      const t = (h.title || '').toLowerCase();
      const isBull = _BULLISH_KW.some(k => t.includes(k));
      const isBear = _BEARISH_KW.some(k => t.includes(k));
      const dotCls = isBull ? 'nf-bull' : isBear ? 'nf-bear' : 'nf-neut';
      const safeTitle = (h.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const href = h.link ? ` href="${h.link}" target="_blank" rel="noopener"` : '';
      html += `<div class="news-feed-item"><div class="nf-dot ${dotCls}"></div><div class="nf-content"><div class="nf-title"><a${href}>${safeTitle}</a></div><div class="nf-time">${_timeAgo(h.published)}</div></div></div>`;
    }
    el.innerHTML = html;
  }

  function sentimentBadgeHtml(sentiment) {
    if (!sentiment) return '';
    const label = sentiment.label || 'NEUTRAL';
    const cls = label.toLowerCase();
    const icon = label === 'BULLISH' ? '▲' : label === 'BEARISH' ? '▼' : '—';
    return `<div class="news-sent-badge ${cls}">${icon} NEWS: ${label}</div>`;
  }

  // Auto-refresh every 15 min for the Nifty tab
  setInterval(async () => {
    const sym = _niftyLastNewsSym || 'NIFTY';
    const entry = await fetch(sym);
    renderFeed(entry.headlines, entry.sentiment, 'nifty-news-feed');
  }, TTL);

  return { fetch, renderFeed, sentimentBadgeHtml };
})();

/* ═══════════════════════════════════════════
   HELPER: Apply news sentiment to signal data
   Adjusts confidence up/down based on news vs signal.
   Suppresses to HOLD if confidence < 48.
═══════════════════════════════════════════ */
function applyNewsSentiment(data, newsEntry) {
  if (!newsEntry || !newsEntry.sentiment || !newsEntry.headlines.length) return data;
  const sig = (data.signal || 'HOLD').toUpperCase();
  const sentiment = newsEntry.sentiment;
  const lbl = sentiment.label; // BULLISH | BEARISH | NEUTRAL
  let conf = parseInt(data.confidence) || 60;
  let note = '';

  if (sig === 'BUY' && lbl === 'BEARISH') {
    const cut = Math.min(25, Math.round(Math.abs(sentiment.score) * 30));
    conf -= cut;
    note = `⚠ News BEARISH — confidence reduced by ${cut}pt. Top: ${newsEntry.headlines.slice(0, 2).map(h => h.title).join(' | ')}`;
  } else if (sig === 'SELL' && lbl === 'BULLISH') {
    const cut = Math.min(20, Math.round(Math.abs(sentiment.score) * 25));
    conf -= cut;
    note = `⚠ News BULLISH — confidence reduced by ${cut}pt. Top: ${newsEntry.headlines.slice(0, 2).map(h => h.title).join(' | ')}`;
  } else if (sig === 'BUY' && lbl === 'BULLISH') {
    conf = Math.min(98, conf + 5);
    note = `✓ News confirms BULLISH signal.`;
  } else if (sig === 'SELL' && lbl === 'BEARISH') {
    conf = Math.min(98, conf + 5);
    note = `✓ News confirms BEARISH signal.`;
  }

  const out = { ...data, confidence: conf, _newsNote: note, _newsSentiment: sentiment };
  // Suppress to HOLD if confidence collapsed
  if (conf < 48 && sig !== 'HOLD') {
    out.signal = 'HOLD';
    out._newsNote = `🚫 Signal suppressed to HOLD — news contradicts technicals (conf: ${conf}%). ` + note;
  }
  // Populate news_impact field with top headlines
  if (newsEntry.headlines.length > 0) {
    out.news_impact = newsEntry.headlines.slice(0, 2).map(h => h.title).join(' | ');
  }
  return out;
}

/* ═══════════════════════════════════════════
   MODULE: TECHNICAL INDICATORS
═══════════════════════════════════════════ */
const Indicators = {
  ema(arr, period) {
    const k = 2 / (period + 1);
    let e = arr[0];
    return arr.map((v, i) => {
      if (i === 0) { e = v; return e; }
      e = v * k + e * (1 - k);
      return e;
    });
  },

  rsi(closes, period = 14) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period) { result.push(50); continue; }
      let gain = 0, loss = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - closes[j - 1];
        if (d > 0) gain += d; else loss -= d;
      }
      const rs = (gain / period) / ((loss / period) || 0.0001);
      result.push(100 - 100 / (1 + rs));
    }
    return result;
  },

  bb(closes, period = 20, stdDev = 2) {
    return closes.map((_, i) => {
      if (i < period) return { mid: closes[i], upper: closes[i], lower: closes[i], width: 0 };
      const slice = closes.slice(i - period + 1, i + 1);
      const mid = slice.reduce((a, b) => a + b) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
      return { mid, upper: mid + stdDev * std, lower: mid - stdDev * std, width: (stdDev * 2 * std) / mid * 100 };
    });
  },

  vwap(candles) {
    const result = [];
    let cumTPV = 0, cumVol = 0, lastDate = '';
    candles.forEach(c => {
      const d = c.date.toISOString().slice(0, 10);
      if (d !== lastDate) { cumTPV = 0; cumVol = 0; lastDate = d; }
      const tp = (c.h + c.l + c.c) / 3;
      cumTPV += tp * (c.v || 1);
      cumVol += (c.v || 1);
      result.push(cumVol > 0 ? cumTPV / cumVol : c.c);
    });
    return result;
  },

  atr(candles, period = 14) {
    const atr = [0];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].h - candles[i].l,
        Math.abs(candles[i].h - candles[i - 1].c),
        Math.abs(candles[i].l - candles[i - 1].c)
      );
      if (i < period) atr.push(tr);
      else if (i === period) atr.push((atr.reduce((a, b) => a + b, 0) + tr) / period);
      else atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
    return atr;
  },

  /** Indian market transaction charges */
  charges(entryPrice, exitPrice, qty, segment = 'intraday') {
    const bv = entryPrice * qty;
    const sv = exitPrice * qty;
    const brokerage = Math.min(20, bv * 0.0003) + Math.min(20, sv * 0.0003);
    let stt = 0, exchg = 0;

    if (segment === 'intraday') {
      stt = sv * 0.00025;
      exchg = (bv + sv) * 0.0000325;
    } else if (segment === 'futures') {
      stt = sv * 0.000125;
      exchg = (bv + sv) * 0.0000195;
    } else if (segment === 'options') {
      stt = sv * 0.000625;
      exchg = (bv + sv) * 0.0000500;
    }
    const gst = (brokerage + exchg) * 0.18;
    const stamp = bv * 0.00003;
    return Math.round(brokerage + stt + exchg + gst + stamp);
  }
};


/* ═══════════════════════════════════════════
   MODULE: TAB 1 — NIFTY LIVE SIGNAL
═══════════════════════════════════════════ */
async function refreshNiftySignal(sym = 'NIFTY 50') {

  const btn = document.getElementById('niftyRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  DOM.setText('sh-sym-label', sym);
  DOM.setHtml('nifty-signal-badge', '<div class="signal-badge badge-hold"><span class="spinr"></span> ANALYZING...</div>');

  // Fetch news + global cues in parallel with the signal (shares 15-min cache)
  _niftyLastNewsSym = sym;

  try {
    // Get global cues for premarket context
    let globalCtx = '';
    try {
      const base = CONFIG.PROXY_BASE || '';
      const gcR = await window.fetch(`${base}/api/global-cues`);
      if (gcR.ok) {
        const gc = await gcR.json();
        const giftVal = gc.gift_nifty?.val ?? 'N/A';
        const giftPct = gc.gift_nifty?.pct ?? 0;
        globalCtx = `\nPre-market context: GIFT Nifty = ${giftVal} (${giftPct >= 0 ? '+' : ''}${giftPct.toFixed(2)}%), Dow = ${gc.dow?.val ?? 'N/A'}, Crude = ${gc.crude?.val ?? 'N/A'}, USD/INR = ${gc.usdinr?.val ?? 'N/A'}, Gold = ${gc.gold?.val ?? 'N/A'}, Global Bias = ${gc.bias ?? 'N/A'}. Adjust your signal confidence based on gap direction.`;
        // Also update the global cues panel live
        fetchGlobalCues();
      }
    } catch (_) {}

    const prompt = `Search for current ${sym} price, recent movement, and technical analysis for intraday trading today.${globalCtx}
Respond ONLY in this JSON (no other text):
{"signal":"BUY or SELL or HOLD","price":"current level","change":"+/- points","changePct":"+/-x.xx%","entry":"price","sl":"price","t1":"price","t2":"price","confidence":75,"rr":"1:2","rsi":"value bullish/bearish/neutral","macd":"bullish/bearish/neutral","bb":"upper/middle/lower","vwap":"above/below","ema":"above/below key EMAs","volume":"high/average/low","analyst_note":"4 sentences veteran analysis","news_impact":"brief news note","vix":"current India VIX if known","premarket_note":"1 sentence on gap based on GIFT Nifty"}`;

    const [raw, newsEntry] = await Promise.all([
      callClaude(prompt, CONFIG.ANALYST_PERSONA),
      NewsFilter.fetch(sym)
    ]);
    let data = extractJson(raw);
    if (!data) throw new Error('parse fail');

    // Apply news sentiment filter
    data = applyNewsSentiment(data, newsEntry);

    const sig = (data.signal || 'HOLD').toUpperCase();
    const cls = sig === 'BUY' ? 'badge-buy' : sig === 'SELL' ? 'badge-sell' : 'badge-hold';
    const icon = sig === 'BUY' ? '▲' : sig === 'SELL' ? '▼' : '—';
    const priceUp = data.change && !data.change.startsWith('-');

    DOM.setText('n-price', data.price || '--');
    DOM.setColor('n-price', priceUp ? 'var(--green)' : 'var(--down)');
    DOM.setText('n-change', `${data.change || '--'} (${data.changePct || '--'}) · ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
    DOM.setColor('n-change', priceUp ? 'var(--green)' : 'var(--down)');
    DOM.setHtml('nifty-signal-badge', `<div class="signal-badge ${cls}">${icon} ${DOM.esc(sig)}</div>`);
    DOM.setText('nl-entry', data.entry || '--');
    DOM.setText('nl-sl', data.sl || '--');
    DOM.setText('nl-t1', data.t1 || '--');
    DOM.setText('nl-t2', data.t2 || '--');
    DOM.setText('nl-rr', data.rr || '--');
    DOM.setText('nl-conf', (data.confidence || '--') + '%');
    DOM.setColor('nl-conf', (data.confidence || 0) >= 75 ? 'var(--green)' : (data.confidence || 0) >= 55 ? 'var(--warn)' : 'var(--down)');
    DOM.setText('n-anote', data.analyst_note || '');
    // Show news note + news_impact
    const nNewsEl = document.getElementById('n-news-impact');
    if (nNewsEl) {
      nNewsEl.textContent = data._newsNote ? data._newsNote : (data.news_impact ? `📰 ${data.news_impact}` : '');
      nNewsEl.style.color = data._newsSentiment
        ? (data._newsSentiment.label === 'BEARISH' ? 'var(--down)' : data._newsSentiment.label === 'BULLISH' ? 'var(--green)' : 'var(--text3)')
        : '';
    }

    // Render inline news feed
    NewsFilter.renderFeed(newsEntry.headlines, newsEntry.sentiment, 'nifty-news-feed');

    setIndTile('ni-rsi', data.rsi || '--');
    setIndTile('ni-macd', data.macd || '--');
    setIndTile('ni-bb', data.bb || '--');
    setIndTile('ni-vwap', data.vwap || '--');
    setIndTile('ni-ema', data.ema || '--');
    setIndTile('ni-vol', data.volume || '--');

    if (data.vix) updateVIX(data.vix);
    updateTicker(`${sym}: ${sig} @ ${data.entry || '--'} | SL: ${data.sl || '--'} | T1: ${data.t1 || '--'} | ${(data.analyst_note || '').substring(0, 80)}...`);

  } catch (e) {
    DOM.setHtml('nifty-signal-badge', '<div class="signal-badge badge-hold">⚠ RETRY</div>');
    DOM.setText('n-anote', 'Error fetching signal. Please retry.');
  }
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Signal'; }
}

function setIndTile(id, val) {
  const v = String(val || '').toLowerCase();
  const isB = v.includes('bull') || v.includes('above') || v.includes('high') || v.includes('over');
  const isBr = v.includes('bear') || v.includes('below') || v.includes('low') || v.includes('under');
  const color = isB ? 'var(--green)' : isBr ? 'var(--down)' : 'var(--warn)';
  const sig = isB ? 'BULLISH' : isBr ? 'BEARISH' : 'NEUTRAL';
  const pct = isB ? 80 : isBr ? 20 : 50;

  DOM.setText(id, val);
  DOM.setColor(id, color);
  DOM.setText(id + '-s', sig);
  DOM.setColor(id + '-s', color);
  const bar = document.getElementById(id + '-b');
  if (bar) { bar.style.width = pct + '%'; bar.style.background = color; }
}

function updateTicker(text) {
  DOM.setText('nticker', text);
}

/* ═══════════════════════════════════════════
   MODULE: TAB 2 — SIGNAL ENGINE
═══════════════════════════════════════════ */
function qs(s) {
  const el = document.getElementById('sym-input');
  if (el) el.value = s;
}

async function generateSignal() {
  const sym = (document.getElementById('sym-input')?.value || '').trim();
  const seg = document.getElementById('seg-select')?.value || 'equity';
  const tf = document.getElementById('tf-select')?.value || '15min';
  if (!sym) { alert('Enter a symbol'); return; }

  showOv(`SCANNING ${sym.toUpperCase()}...`);
  try {
    const prompt = `Analyze ${sym} for intraday trading on NSE/BSE Indian markets (${seg}, ${tf} timeframe).
Search for current price, news, and technical setup for ${sym}.
Respond ONLY in JSON:
{"signal":"BUY/SELL/HOLD","symbol":"${sym.toUpperCase()}","entry":"price","sl":"price","t1":"price","t2":"price","confidence":72,"rr":"1:2.2","basis":"20 word basis","rsi":"value direction","macd":"direction","bb":"position","vwap":"above/below","ema":"above/below","volume":"level","analyst_note":"3-4 sentence veteran commentary","news_impact":"brief note"}`;

    const [raw, newsEntry] = await Promise.all([
      callClaude(prompt, CONFIG.ANALYST_PERSONA),
      NewsFilter.fetch(sym)
    ]);
    let data = extractJson(raw) || parseFallback(raw, sym);
    // Apply news sentiment filter
    data = applyNewsSentiment(data, newsEntry);
    renderSigCard(data, newsEntry);
    addRecentSignal(data);
  } catch (e) {
    DOM.setHtml('sig-output', '<div class="card" style="color:var(--down);text-align:center;padding:20px;">Error. Try again.</div>');
  }
  hideOv();
}

function parseFallback(txt, sym) {
  const up = txt.toLowerCase().includes('buy') || txt.toLowerCase().includes('bullish');
  const dn = txt.toLowerCase().includes('sell') || txt.toLowerCase().includes('bearish');
  return {
    signal: up ? 'BUY' : dn ? 'SELL' : 'HOLD',
    symbol: sym.toUpperCase(), entry: '--', sl: '--', t1: '--', t2: '--',
    confidence: 50, rr: '1:2', basis: 'Fallback analysis',
    rsi: 'N/A', macd: 'N/A', bb: 'N/A', vwap: 'N/A', ema: 'N/A', volume: 'N/A',
    analyst_note: txt.substring(0, 300), news_impact: ''
  };
}

function renderSigCard(d, newsEntry) {
  const sig = (d.signal || 'HOLD').toUpperCase();
  const cls = sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : 'hold';
  const icon = sig === 'BUY' ? '▲' : sig === 'SELL' ? '▼' : '—';
  const cc = (d.confidence || 0) >= 75 ? 'var(--green)' : (d.confidence || 0) >= 55 ? 'var(--warn)' : 'var(--down)';
  const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const rsiC = (d.rsi || '').toLowerCase().includes('bull') ? 'bullish' : (d.rsi || '').toLowerCase().includes('bear') ? 'bearish' : 'neutral';
  const macdC = (d.macd || '').toLowerCase().includes('bull') ? 'bullish' : (d.macd || '').toLowerCase().includes('bear') ? 'bearish' : 'neutral';
  const vwapC = (d.vwap || '').toLowerCase().includes('above') ? 'bullish' : 'bearish';
  const emaC = (d.ema || '').toLowerCase().includes('above') ? 'bullish' : 'bearish';

  const sym = DOM.esc(d.symbol || '--');
  const entryEsc = DOM.esc(d.entry || '0');
  const slEsc = DOM.esc(d.sl || '0');
  const t1Esc = DOM.esc(d.t1 || '0');

  // News sentiment badge (shown next to confidence)
  const sentiment = d._newsSentiment || (newsEntry && newsEntry.sentiment) || null;
  const newsBadgeHtml = sentiment ? NewsFilter.sentimentBadgeHtml(sentiment) : '';

  // News note line
  const newsNoteHtml = d._newsNote
    ? `<div class="sig-news-note" style="color:${sentiment && sentiment.label === 'BEARISH' ? 'var(--down)' : sentiment && sentiment.label === 'BULLISH' ? 'var(--green)' : 'var(--text3)'};font-size:11px;margin:8px 0 0;line-height:1.5;">${DOM.esc(d._newsNote)}</div>`
    : '';

  DOM.setHtml('sig-output', `
  <div class="sig-card ${cls}">
    <div class="sig-hdr">
      <div><div class="sig-sym">${sym}</div><div class="sig-time">Generated: ${DOM.esc(now)} IST</div></div>
      <div class="sig-badge ${cls}">${icon} ${DOM.esc(sig)}</div>
    </div>
    <div class="sig-levels">
      <div class="lvl-item"><div class="ll">Entry</div><div class="lv lv-e">${DOM.esc(d.entry || '--')}</div></div>
      <div class="lvl-item"><div class="ll">Stop Loss</div><div class="lv lv-sl">${DOM.esc(d.sl || '--')}</div></div>
      <div class="lvl-item"><div class="ll">Target 1</div><div class="lv lv-t">${DOM.esc(d.t1 || '--')}</div></div>
      <div class="lvl-item"><div class="ll">Target 2</div><div class="lv lv-t">${DOM.esc(d.t2 || '--')}</div></div>
    </div>
    <button class="btn btn-green" style="width:100%;margin-bottom:12px;font-size:11px"
      onclick="executePaperTrade('${sym}','${DOM.esc(sig)}',${parseFloat(d.entry) || 0},${parseFloat(d.sl) || 0},${parseFloat(d.t1) || 0})">
      ⚡ Execute Paper Trade
    </button>
    <div class="sig-meta">
      <div class="sm-item"><div class="sml">Confidence</div><div class="smv" style="color:${cc}">${DOM.esc(String(d.confidence || '--'))}%</div></div>
      <div class="sm-item"><div class="sml">Risk:Reward</div><div class="smv">${DOM.esc(d.rr || '--')}</div></div>
      <div class="sm-item"><div class="sml">Basis</div><div class="smv">${DOM.esc(d.basis || '--')}</div></div>
    </div>
    ${newsBadgeHtml}
    <div class="conf-bar"><div class="conf-fill" style="width:${d.confidence || 0}%;background:${cc}"></div></div>
    <div class="ind-grid">
      <div class="ind-box"><span class="in">RSI</span><span class="iv ${rsiC}">${DOM.esc(d.rsi || '--')}</span></div>
      <div class="ind-box"><span class="in">MACD</span><span class="iv ${macdC}">${DOM.esc(d.macd || '--')}</span></div>
      <div class="ind-box"><span class="in">BB</span><span class="iv neutral">${DOM.esc(d.bb || '--')}</span></div>
      <div class="ind-box"><span class="in">VWAP</span><span class="iv ${vwapC}">${DOM.esc(d.vwap || '--')}</span></div>
      <div class="ind-box"><span class="in">EMA</span><span class="iv ${emaC}">${DOM.esc(d.ema || '--')}</span></div>
      <div class="ind-box"><span class="in">VOLUME</span><span class="iv neutral">${DOM.esc(d.volume || '--')}</span></div>
    </div>
    <div class="anote">◉ <strong>Analyst:</strong> ${DOM.esc(d.analyst_note || '')}${d.news_impact ? `<br><br>📰 <strong>News:</strong> ${DOM.esc(d.news_impact)}` : ''}</div>
    ${newsNoteHtml}
    <div id="sig-news-feed" class="news-feed-block"></div>
  </div>`);

  // Render live news feed in the card (after card is in DOM)
  if (newsEntry) {
    NewsFilter.renderFeed(newsEntry.headlines, newsEntry.sentiment, 'sig-news-feed');
  }
}

function addRecentSignal(d) {
  State.recentSignals.unshift(d);
  if (State.recentSignals.length > 8) State.recentSignals.pop();
  DOM.setHtml('recent-signals', State.recentSignals.map(s => {
    const sg = (s.signal || 'HOLD').toUpperCase();
    const cls = sg === 'BUY' ? 'badge-buy' : sg === 'SELL' ? 'badge-sell' : 'badge-wait';
    return `<div class="wl-item">
      <div><div class="wl-sym">${DOM.esc(s.symbol || '--')}</div><div class="wl-sub">${DOM.esc(s.basis || '')}</div></div>
      <div class="badge ${cls}">${DOM.esc(sg)}</div>
    </div>`;
  }).join(''));
}

/* ═══════════════════════════════════════════
   MODULE: TAB 3 — MORNING BRIEF
═══════════════════════════════════════════ */
async function generateMorningBrief() {
  showOv('GENERATING MORNING INTELLIGENCE...');
  try {
    // Fetch real-time global cues and news in parallel first
    const base = CONFIG.PROXY_BASE || '';
    const [gcRes, newsEntry] = await Promise.all([
      window.fetch(`${base}/api/global-cues`).then(r => r.ok ? r.json() : null).catch(() => null),
      NewsFilter.fetch('NIFTY')
    ]);

    const giftVal   = gcRes?.gift_nifty?.val ?? 'N/A';
    const giftPct   = gcRes?.gift_nifty?.pct ?? 0;
    const giftDir   = giftPct >= 0 ? 'gap-up' : 'gap-down';
    const globalBias = gcRes?.bias ?? 'NEUTRAL';
    const topNews   = (newsEntry?.headlines ?? []).slice(0, 4).map(h => h.title).join('; ');
    const sentimentLabel = newsEntry?.sentiment?.label ?? 'NEUTRAL';

    const contextBlock = `
Real-time data (do NOT override these values):
- GIFT Nifty: ${giftVal} (${giftPct >= 0 ? '+' : ''}${giftPct.toFixed(2)}%) — indicating ${giftDir} for Indian markets
- Dow Jones: ${gcRes?.dow?.val ?? 'N/A'}
- WTI Crude: ${gcRes?.crude?.val ?? 'N/A'}
- USD/INR: ${gcRes?.usdinr?.val ?? 'N/A'}
- Gold: ${gcRes?.gold?.val ?? 'N/A'}
- DXY: ${gcRes?.dxy?.val ?? 'N/A'}
- Overall Global Bias: ${globalBias}
- Live News Sentiment: ${sentimentLabel}
- Top Headlines: ${topNews || 'fetch from news sources'}

Our intraday strategy framework:
• BUY signals: VWAP support + RSI > 55 + EMA 9 > EMA 21 + positive global cues
• SELL signals: VWAP rejection + RSI < 45 + EMA 9 < EMA 21 + negative global cues
• HOLD: conflicting signals, VIX > 20, high-impact news pending
• Preferred setups: 15m breakout after 9:30 AM, Bank Nifty leading
• Risk: max 1% capital per trade, 1:2 RR minimum
`;

    const prompt = `Generate a comprehensive Indian stock market morning brief for intraday traders today.
${contextBlock}
Incorporate the real-time data above into your analysis. Also search for: Nifty 50 levels, Bank Nifty levels, India VIX, FII/DII data, any major corporate news.
Respond ONLY in JSON:
{"date":"today","nifty":"level","bnifty":"level","vix":"level","overall_bias":"BULLISH/BEARISH/NEUTRAL","nifty_support":"level","nifty_resist":"level","bnf_support":"level","bnf_resist":"level","fii_buy":"cr","fii_sell":"cr","fii_net":"cr","dii_buy":"cr","dii_sell":"cr","dii_net":"cr","crude":"price","usdinr":"rate","gold":"price","sgx":"GIFT Nifty level","top_sectors":["s1","s2","s3"],"avoid":["s1"],"key_news":["n1","n2","n3","n4"],"analyst_brief":"3-4 sentence morning brief integrating global cues and news","strategy":"specific intraday strategy for today based on gap direction and our framework","premarket_note":"1 sentence on what the ${giftDir} in GIFT Nifty means for today's open"}`;

    const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA);
    const d = extractJson(raw);
    if (!d) throw new Error('parse fail');

    // Inject real GIFT Nifty value always
    if (gcRes?.gift_nifty) d.sgx = giftVal;

    const bc = d.overall_bias === 'BULLISH' ? 'var(--green)' : d.overall_bias === 'BEARISH' ? 'var(--down)' : 'var(--warn)';
    DOM.setHtml('morning-content', `
      <div class="bias-header" style="color:${bc}">${DOM.esc(d.overall_bias || 'NEUTRAL')}</div>
      <p style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:14px;">${DOM.esc(d.analyst_brief || '')}</p>
      <div class="cue-row"><span class="cue-label">Nifty Support</span><span class="cue-val down">${DOM.esc(d.nifty_support || '--')}</span></div>
      <div class="cue-row"><span class="cue-label">Nifty Resistance</span><span class="cue-val up">${DOM.esc(d.nifty_resist || '--')}</span></div>
      <div class="cue-row"><span class="cue-label">BNF Support</span><span class="cue-val down">${DOM.esc(d.bnf_support || '--')}</span></div>
      <div class="cue-row"><span class="cue-label">BNF Resistance</span><span class="cue-val up">${DOM.esc(d.bnf_resist || '--')}</span></div>
      <div style="margin-top:12px;font-size:13px;color:var(--blue);font-style:italic;">${DOM.esc(d.strategy || '')}</div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">${(d.top_sectors || []).map(s => `<span class="tag">${DOM.esc(s)}</span>`).join('')}</div>`);

    const fn = parseFloat((d.fii_net || '0').replace(/[₹,]/g, '')) || 0;
    const dn = parseFloat((d.dii_net || '0').replace(/[₹,]/g, '')) || 0;
    DOM.setHtml('fii-table', `
      <tr>
        <td style="font-weight:700;color:var(--blue)">FII / FPI</td>
        <td class="up">${DOM.esc(d.fii_buy || '--')}</td>
        <td class="down">${DOM.esc(d.fii_sell || '--')}</td>
        <td class="${fn >= 0 ? 'up' : 'down'}">${DOM.esc(d.fii_net || '--')}</td>
        <td><div style="height:4px;background:${fn >= 0 ? 'var(--green)' : 'var(--down)'};border-radius:2px;width:60%;"></div></td>
        <td><span class="badge ${fn >= 0 ? 'badge-buy' : 'badge-sell'}">${fn >= 0 ? 'BUYING' : 'SELLING'}</span></td>
      </tr>
      <tr>
        <td style="font-weight:700;color:var(--blue)">DII</td>
        <td class="up">${DOM.esc(d.dii_buy || '--')}</td>
        <td class="down">${DOM.esc(d.dii_sell || '--')}</td>
        <td class="${dn >= 0 ? 'up' : 'down'}">${DOM.esc(d.dii_net || '--')}</td>
        <td><div style="height:4px;background:${dn >= 0 ? 'var(--green)' : 'var(--down)'};border-radius:2px;width:60%;"></div></td>
        <td><span class="badge ${dn >= 0 ? 'badge-buy' : 'badge-sell'}">${dn >= 0 ? 'BUYING' : 'SELLING'}</span></td>
      </tr>`);

    DOM.setHtml('news-area', (d.key_news || []).map(n =>
      `<div class="news-item">${DOM.esc(n)}</div>`
    ).join(''));
    updateTicker((d.key_news || []).join(' ⚡ '));

    if (d.crude) DOM.setText('gc-crude', d.crude);
    if (d.gold) DOM.setText('gc-gold', d.gold);
    if (d.sgx) DOM.setText('gc-sgx', d.sgx);
  } catch (e) { console.error(e); }
  hideOv();
}

/* ═══════════════════════════════════════════
   MODULE: TAB 4 — F&O
═══════════════════════════════════════════ */
async function analyzeFO() {
  const sym = (document.getElementById('fo-sym')?.value || '').trim() || 'NIFTY';
  showOv(`F&O SCAN: ${sym}...`);
  try {
    const prompt = `Analyze F&O options data for ${sym} on NSE India.
Search for current PCR, max pain strike, implied volatility for ${sym}.
Respond ONLY in JSON:
{"pcr":"value","pcr_signal":"bullish/bearish/neutral","max_pain":"strike","max_pain_note":"brief","iv":"xx%","iv_state":"low/normal/high","iv_strategy":"brief","oi_interpretation":"2 sentence OI analysis","greeks":[{"strike":"ATM","type":"CE","delta":"0.50","gamma":"0.003","theta":"-45","vega":"120","oi_chg":"+12%"},{"strike":"ATM-100","type":"PE","delta":"-0.45","gamma":"0.003","theta":"-42","vega":"115","oi_chg":"+18%"}],"oi_levels":[{"strike":"highest CE","type":"CE","oi":"value","note":"resistance"},{"strike":"highest PE","type":"PE","oi":"value","note":"support"}],"recommendation":"specific trade"}`;

    const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA);
    const d = extractJson(raw);
    if (!d) throw new Error('parse');

    const pc = d.pcr_signal === 'bullish' ? 'var(--green)' : d.pcr_signal === 'bearish' ? 'var(--down)' : 'var(--warn)';
    DOM.setText('pcr-val', d.pcr || '--');
    DOM.setColor('pcr-val', pc);
    DOM.setText('pcr-int', ((d.pcr_signal || '').toUpperCase()) + ' — ' + (parseFloat(d.pcr || 0) > 1 ? 'Puts heavy, bullish' : 'Calls heavy, bearish'));
    DOM.setText('mp-val', d.max_pain || '--');
    DOM.setText('mp-note', d.max_pain_note || '');
    DOM.setText('iv-val', d.iv || '--%');
    DOM.setText('iv-note', ((d.iv_state || '').toUpperCase()) + ' — ' + (d.iv_strategy || ''));

    DOM.setHtml('greeks-tbl', (d.greeks || []).map(g =>
      `<tr>
        <td style="font-weight:600">${DOM.esc(g.strike)}</td>
        <td>${DOM.esc(g.type)}</td>
        <td style="color:var(--blue)">${DOM.esc(g.delta)}</td>
        <td>${DOM.esc(g.gamma)}</td>
        <td style="color:var(--down)">${DOM.esc(g.theta)}</td>
        <td style="color:var(--warn)">${DOM.esc(g.vega)}</td>
        <td class="${(g.oi_chg || '').includes('+') ? 'up' : 'down'}">${DOM.esc(g.oi_chg)}</td>
      </tr>`
    ).join(''));

    DOM.setHtml('oi-area', `
      <p style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:12px;">${DOM.esc(d.oi_interpretation || '')}</p>
      ${(d.oi_levels || []).map(l =>
      `<div class="wl-item">
          <div><div class="wl-sym">${DOM.esc(l.strike)}</div><div class="wl-sub">${DOM.esc(l.type)} — ${DOM.esc(l.note)}</div></div>
          <div class="badge ${l.type === 'PE' ? 'badge-buy' : 'badge-sell'}">${l.type === 'PE' ? 'SUPPORT' : 'RESIST'}</div>
        </div>`
    ).join('')}
      <div class="anote" style="margin-top:10px;">◉ ${DOM.esc(d.recommendation || '')}</div>`);

  } catch (e) { console.error(e); }
  hideOv();
}

/* ═══════════════════════════════════════════
   MODULE: TAB 5 — SECTORS
═══════════════════════════════════════════ */
async function loadSectors() {
  showOv('SCANNING SECTORS...');
  try {
    const prompt = `Fetch current NSE sectoral index performance today: Nifty Bank, IT, Pharma, Auto, FMCG, Metal, Energy, Realty.
Respond ONLY in JSON:
{"sectors":[{"name":"BANKING","change":"+1.2%"}],"rotation_signal":"2-3 sentence rotation analysis","top_picks":[{"sector":"Banking","stock":"HDFC BANK","reason":"brief"}],"avoid":["sector1"]}`;

    const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA);
    const d = extractJson(raw);
    if (!d?.sectors) throw new Error('parse');

    DOM.setHtml('sector-grid', d.sectors.map(s => {
      const p = parseFloat((s.change || '0').replace('%', ''));
      const c = p > 1.5 ? 's-su' : p > 0.3 ? 'su' : p > -0.3 ? 'sn' : p > -1.5 ? 'sd' : 's-sd';
      return `<div class="sector-box ${c}" onclick="qs('${DOM.esc(s.name)}');switchTab('signals');generateSignal()">
        <div class="sec-name">${DOM.esc(s.name)}</div>
        <div class="sec-chg">${DOM.esc(s.change || '--')}</div>
      </div>`;
    }).join(''));

    DOM.setHtml('rotation-area', `
      <p style="font-size:13px;color:var(--text2);line-height:1.7;">${DOM.esc(d.rotation_signal || '')}</p>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">${(d.avoid || []).map(s => `<span class="tag" style="color:var(--down);border-color:rgba(231,76,60,0.3)">AVOID: ${DOM.esc(s)}</span>`).join('')}</div>`);

    DOM.setHtml('sector-picks', (d.top_picks || []).map(p =>
      `<div class="wl-item" onclick="qs('${DOM.esc(p.stock)}');switchTab('signals');generateSignal()">
        <div><div class="wl-sym">${DOM.esc(p.stock)}</div><div class="wl-sub">${DOM.esc(p.sector)}</div></div>
        <div style="font-size:10px;color:var(--text3);max-width:130px;text-align:right;">${DOM.esc(p.reason || '')}</div>
        <div class="badge badge-buy">PICK</div>
      </div>`
    ).join(''));
  } catch (e) { console.error(e); }
  hideOv();
}

/* ═══════════════════════════════════════════
   MODULE: GLOBAL CUES — Real-time refresh
═══════════════════════════════════════════ */
async function fetchGlobalCues() {
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
    // Fallback: try Claude if API key is set
    if (ApiKeyStore.has()) {
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
    }
    return null;
  }
}

/* ═══════════════════════════════════════════
   MODULE: VIX
═══════════════════════════════════════════ */
function updateVIX(v) {
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

/* ═══════════════════════════════════════════
   MODULE: TAB 7 — AI ANALYST CHAT
═══════════════════════════════════════════ */
function askA(q) {
  switchTab('analyst');
  const inp = document.getElementById('chat-input');
  if (inp) { inp.value = q; }
  sendChat();
}

async function sendChat() {
  const inp = document.getElementById('chat-input');
  const q = (inp?.value || '').trim();
  if (!q) return;
  if (inp) inp.value = '';

  addMsg('user', q);
  State.chatHistory.push({ role: 'user', content: q });
  if (State.chatHistory.length > 20) State.chatHistory.splice(0, 2);

  const thinking = addMsg('ai', '<span class="spinr"></span> Fetching live market data...');

  try {
    if (!ApiKeyStore.has()) {
      thinking.querySelector('.msg-bubble').textContent =
        'Please add your Anthropic API key in the sidebar Settings panel to enable the AI Analyst chat.';
      return;
    }

    const body = {
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      system: CONFIG.ANALYST_PERSONA,
      messages: State.chatHistory
    };

    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ApiKeyStore.get(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 401 || res.status === 403) {
      ApiKeyStore.clear();
      DOM.setText('api-key-status', '✗ Key rejected (401/403)');
      DOM.setColor('api-key-status', 'var(--down)');
      thinking.querySelector('.msg-bubble').textContent =
        'Your Anthropic API key was rejected (Error ' + res.status + '). Please re-enter a valid key.';
      return;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      thinking.querySelector('.msg-bubble').textContent =
        'Anthropic API error ' + res.status + (errText ? ': ' + errText.slice(0, 120) : '') + '.';
      return;
    }

    const data = await res.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n') || 'No text response returned. The model may need a different prompt.';

    // Safe render: textContent for user content, but format markdown-style bold safely
    const bubble = thinking.querySelector('.msg-bubble');
    if (bubble) {
      bubble.innerHTML = reply
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }
    State.chatHistory.push({ role: 'assistant', content: reply });
  } catch (e) {
    const bubble = thinking.querySelector('.msg-bubble');
    if (bubble) bubble.textContent = 'Network error: ' + (e.message || 'Unknown error. Check your internet connection.');
  }
  const ca = document.getElementById('chat-area');
  if (ca) ca.scrollTop = 99999;
}

function addMsg(role, htmlContent) {
  const area = document.getElementById('chat-area');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  const sender = role === 'user' ? 'YOU' : '◉ RYUGAN ANALYST · 20+ YRS';
  el.innerHTML = `<div class="msg-sender">${DOM.esc(sender)}</div><div class="msg-bubble">${htmlContent}</div>`;
  area?.appendChild(el);
  if (area) area.scrollTop = 99999;
  return el;
}

/* ═══════════════════════════════════════════
   MODULE: LIVE TICKERS
═══════════════════════════════════════════ */
async function fetchLiveTickers() {
  const tickers = [
    { sym: '^NSEI', id: 'h-nifty', cid: 'h-nifty-c' },
    { sym: '^NSEBANK', id: 'h-bnifty', cid: 'h-bnifty-c' },
    { sym: '^INDIAVIX', id: 'h-vix', cid: 'h-vix-c' },
    { sym: 'INR=X', id: 'h-usdinr', cid: null }
  ];
  for (const t of tickers) {
    try {
      const j = await yahooFetch(t.sym, '1d', '5d');
      if (!j) continue;
      const result = j.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || price;
      if (!price) continue;

      const diff = price - prev;
      const pct = (diff / prev) * 100;
      const isUp = diff >= 0;
      const sign = isUp ? '+' : '';

      DOM.setText(t.id, price.toFixed(2));
      if (t.sym !== '^INDIAVIX' && t.sym !== 'INR=X') {
        DOM.setColor(t.id, isUp ? 'var(--green)' : 'var(--down)');
      }
      if (t.cid) {
        DOM.setText(t.cid, `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`);
        if (t.sym !== '^INDIAVIX') DOM.setColor(t.cid, isUp ? 'var(--green)' : 'var(--down)');
        if (t.sym === '^INDIAVIX') updateVIX(price.toFixed(2));
      }

      if (t.sym === '^NSEI') DOM.setText('wl-n', price.toFixed(2));
      if (t.sym === '^NSEBANK') DOM.setText('wl-bn', price.toFixed(2));
    } catch { /* skip individual failures */ }
  }
}

/* ═══════════════════════════════════════════
   MODULE: BACKTEST ENGINE
═══════════════════════════════════════════ */
function toggleStrat(s) {
  const el = document.getElementById('sc-' + s);
  if (!el) return;
  if (State.selStrats.has(s)) {
    State.selStrats.delete(s);
    el.classList.remove('active');
  } else {
    State.selStrats.add(s);
    el.classList.add('active');
  }
}

// Show/hide F&O-only strategies based on segment selection
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bt-segment')?.addEventListener('change', function () {
    const isFO = this.value === 'futures' || this.value === 'options';
    document.querySelectorAll('.fo-only').forEach(el => el.style.display = isFO ? '' : 'none');
    document.getElementById('fo-cost-note').style.display = isFO ? '' : 'none';
    document.getElementById('bt-lot-wrap').style.display = isFO ? '' : 'none';
    if (isFO) {
      State.selStrats.add('straddle');
      State.selStrats.add('bull_spread');
      State.selStrats.add('bear_spread');
      ['sc-straddle', 'sc-bull-spread', 'sc-bear-spread'].forEach(id => document.getElementById(id)?.classList.add('active'));
    } else {
      ['straddle', 'bull_spread', 'bear_spread'].forEach(s => State.selStrats.delete(s));
    }
  });
});

async function btFetchData() {
  const sym = document.getElementById('bt-sym')?.value;
  const tf = document.getElementById('bt-tf')?.value;
  const period = document.getElementById('bt-period')?.value;

  DOM.setWidth('bt-prog', 20);
  DOM.setHtml('bt-data-status', '<span class="spinr"></span> Connecting to Yahoo Finance...');

  try {
    const j = await yahooFetch(sym, tf, period);
    if (!j) throw new Error('fetch failed');
    const result = j.chart?.result?.[0];
    if (!result) throw new Error('no data');

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    State.btData = ts.map((t, i) => ({
      ts: t * 1000, date: new Date(t * 1000),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i]
    })).filter(d => d.c != null && !isNaN(d.c));

    DOM.setWidth('bt-prog', 100);
    DOM.setHtml('bt-data-status', `<span style="color:var(--green)">✓ Loaded <strong>${State.btData.length}</strong> candles — Yahoo Finance</span>`);
    document.getElementById('bt-run-btn').disabled = false;

    const dates = [...new Set(State.btData.map(d => d.date.toISOString().slice(0, 10)))];
    const rdp = document.getElementById('rp-date');
    if (rdp && dates.length) {
      rdp.min = dates[0];
      rdp.max = dates[dates.length - 1];
      rdp.value = dates[Math.floor(dates.length / 2)];
    }
  } catch {
    State.btData = genDemoData(document.getElementById('bt-tf')?.value, document.getElementById('bt-period')?.value);
    DOM.setWidth('bt-prog', 100);
    DOM.setHtml('bt-data-status', `<span style="color:var(--warn)">⚡ Demo data (${State.btData.length} candles) — Live data unavailable</span>`);
    document.getElementById('bt-run-btn').disabled = false;
  }
}

function genDemoData(tf, period) {
  const bars = { '5m': 78, '15m': 26, '30m': 13, '1h': 6, '1d': 1 }[tf] || 26;
  const days = { '1mo': 22, '3mo': 66, '6mo': 132, '1y': 252 }[period] || 66;
  const data = []; let price = 22000 + Math.random() * 1200;
  const now = new Date();
  for (let d = days; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    let dp = price;
    const dt = (Math.random() - 0.47) * 0.02;
    for (let b = 0; b < bars; b++) {
      const hr = 9 + Math.floor(b * (6.5 / bars));
      const mn = Math.floor((b * (6.5 / bars) * 60) % 60);
      const ts = new Date(day); ts.setHours(hr, mn, 0, 0);
      const vol = dp * 0.003 * (0.5 + Math.random());
      const tr = dt + (Math.random() - 0.5) * 0.005;
      const o = dp, c = o + tr * o + (Math.random() - 0.5) * vol;
      const h = Math.max(o, c) + Math.random() * vol * 0.5;
      const l = Math.min(o, c) - Math.random() * vol * 0.5;
      data.push({ ts: ts.getTime(), date: ts, o, h, l, c: parseFloat(c.toFixed(2)), v: Math.floor(50000 + Math.random() * 200000) });
      dp = c;
    }
    price = dp;
  }
  return data;
}

const TRAIL_FACTOR = 1.0;
function applyTrailingStop(pos, candle, atr) {
  if (!pos.trailActive) {
    const t1Hit = pos.dir === 'LONG' ? candle.h >= pos.aTP : candle.l <= pos.aTP;
    if (t1Hit) {
      pos.trailActive = true;
      pos.trailBest = pos.dir === 'LONG' ? candle.h : candle.l;
      pos.trailSL = pos.dir === 'LONG' ? pos.trailBest - TRAIL_FACTOR * atr : pos.trailBest + TRAIL_FACTOR * atr;
    }
    return null;
  }
  if (pos.dir === 'LONG') {
    if (candle.h > pos.trailBest) { pos.trailBest = candle.h; pos.trailSL = pos.trailBest - TRAIL_FACTOR * atr; }
    if (candle.l <= pos.trailSL) return { price: pos.trailSL, reason: 'Trail Stop' };
  } else {
    if (candle.l < pos.trailBest) { pos.trailBest = candle.l; pos.trailSL = pos.trailBest + TRAIL_FACTOR * atr; }
    if (candle.h >= pos.trailSL) return { price: pos.trailSL, reason: 'Trail Stop' };
  }
  return null;
}

function runBacktest() {
  if (State.btData.length < 50) { alert('Fetch data first'); return; }
  showOv('RUNNING BACKTEST ENGINE...');
  State.tradeLog = [];
  const segment = document.getElementById('bt-segment')?.value || 'intraday';
  const lotSize = parseInt(document.getElementById('bt-lotsize')?.value || '1') || 1;

  setTimeout(() => {
    const closes = State.btData.map(d => d.c);
    const vols = State.btData.map(d => d.v);
    const rsiV = Indicators.rsi(closes, 14);
    const efArr = Indicators.ema(closes, +(document.getElementById('ema-f')?.value || 9));
    const esArr = Indicators.ema(closes, +(document.getElementById('ema-s')?.value || 21));
    const e50 = Indicators.ema(closes, 50);
    const bbV = Indicators.bb(closes, 20, 2);
    const vwapV = Indicators.vwap(State.btData);
    const atrV = Indicators.atr(State.btData, 14);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const cap = +(document.getElementById('bt-capital')?.value || 50000);

    const gp = s => ({
      sl: +(document.getElementById(`${s}-sl`)?.value || 1.5),
      tp: +(document.getElementById(`${s}-tp`)?.value || 2.5)
    });

    // Group by trading day
    const days = {};
    State.btData.forEach((c, i) => {
      const k = c.date.toISOString().slice(0, 10);
      if (!days[k]) days[k] = [];
      days[k].push(i);
    });

    Object.values(days).forEach(idxs => {
      const pos = {};
      let openHigh = -Infinity, openLow = Infinity;

      idxs.forEach(i => {
        const hr = State.btData[i].date.getHours();
        const mn = State.btData[i].date.getMinutes();
        if (hr === 9 && mn <= 30) {
          openHigh = Math.max(openHigh, State.btData[i].h);
          openLow = Math.min(openLow, State.btData[i].l);
        }
        if (i < 30) return;

        const c = State.btData[i];
        const price = c.c;
        const atr = atrV[i] || 1;
        const isLast = idxs[idxs.length - 1] === i;

        // Exit logic
        Object.keys(pos).forEach(st => {
          const p = pos[st]; if (!p) return;
          let xp = null, xr = '';

          const trail = applyTrailingStop(p, c, atr);
          if (trail) { xp = trail.price; xr = trail.reason; }

          if (!xp) {
            if (p.dir === 'LONG') {
              if (c.l <= p.aSL) { xp = p.aSL; xr = 'SL Hit'; }
            } else {
              if (c.h >= p.aSL) { xp = p.aSL; xr = 'SL Hit'; }
            }
          }
          if (!xp && st === 'ema') {
            if (p.dir === 'LONG' && efArr[i - 1] >= esArr[i - 1] && efArr[i] < esArr[i]) { xp = price; xr = 'Opposing Cross'; }
            if (p.dir === 'SHORT' && efArr[i - 1] <= esArr[i - 1] && efArr[i] > esArr[i]) { xp = price; xr = 'Opposing Cross'; }
          }
          if (isLast && !xp) { xp = price; xr = 'EOD 3:15'; }

          if (xp) {
            const qty = p.qty;
            const pnl = p.dir === 'LONG' ? (xp - p.entry) * qty : (p.entry - xp) * qty;
            const chg = Indicators.charges(p.entry, xp, qty, segment);
            const net = Math.round(pnl - chg);
            const lots = segment !== 'intraday' ? Math.round(qty / lotSize) : null;

            State.tradeLog.push({
              id: State.tradeLog.length + 1,
              entryTs: p.entryDate.getTime(),
              date: p.entryDate.toLocaleDateString('en-IN') + ' ' + String(p.entryDate.getHours()).padStart(2, '0') + ':' + String(p.entryDate.getMinutes()).padStart(2, '0'),
              strat: st, dir: p.dir, segment, lots,
              entry: p.entry, exit: xp, qty,
              grossPnl: Math.round(pnl), charges: chg, netPnl: net,
              reason: xr, win: net > 0
            });
            delete pos[st];
          }
        });

        // Entry logic for all active strategies
        const activeStrats = ['ema', 'smc', 'orb',
          ...(State.selStrats.has('straddle') ? ['straddle'] : []),
          ...(State.selStrats.has('bull_spread') ? ['bull_spread'] : []),
          ...(State.selStrats.has('bear_spread') ? ['bear_spread'] : [])
        ];

        activeStrats.forEach(st => {
          if (!State.selStrats.has(st) || pos[st] || isLast) return;
          if (hr > 13 || (hr === 13 && mn > 45)) return;
          let sig = null;

          if (st === 'ema') {
            const rsiTick = rsiV[i] > 55, rsiSell = rsiV[i] < 45;
            const strongCandle = Math.abs(c.c - c.o) > ((c.h - c.l) * 0.5);
            if (efArr[i - 1] <= esArr[i - 1] && efArr[i] > esArr[i] && price > e50[i] && price > vwapV[i] && rsiTick && strongCandle) sig = 'LONG';
            else if (efArr[i - 1] >= esArr[i - 1] && efArr[i] < esArr[i] && price < e50[i] && price < vwapV[i] && rsiSell && strongCandle) sig = 'SHORT';
          }
          else if (st === 'orb') {
            if (hr === 9 && mn <= 30) return;
            const volOk = c.v > avgVol * +(document.getElementById('orb-v')?.value || 1.5);
            if (c.c > openHigh && State.btData[i - 1].c <= openHigh && volOk && c.c > vwapV[i]) sig = 'LONG';
            else if (c.c < openLow && State.btData[i - 1].c >= openLow && volOk && c.c < vwapV[i]) sig = 'SHORT';
          }
          else if (st === 'smc') {
            let bullFVG = null, bearFVG = null;
            for (let k = i - 1; k >= Math.max(2, i - 15); k--) {
              if (State.btData[k - 2].h < State.btData[k].l && State.btData[k - 1].c > State.btData[k - 2].h) {
                const body = Math.abs(State.btData[k - 1].c - State.btData[k - 1].o);
                const rng = Math.abs(State.btData[k - 1].h - State.btData[k - 1].l);
                if (body / (rng || 1) < 0.5) continue;
                let tapped = false;
                for (let m = k + 1; m < i; m++) if (State.btData[m].l <= State.btData[k].l) tapped = true;
                if (!tapped) { bullFVG = { top: State.btData[k].l, bottom: State.btData[k - 2].h }; break; }
              }
              if (State.btData[k - 2].l > State.btData[k].h && State.btData[k - 1].c < State.btData[k - 2].l) {
                const body = Math.abs(State.btData[k - 1].c - State.btData[k - 1].o);
                const rng = Math.abs(State.btData[k - 1].h - State.btData[k - 1].l);
                if (body / (rng || 1) < 0.5) continue;
                let tapped = false;
                for (let m = k + 1; m < i; m++) if (State.btData[m].h >= State.btData[k].h) tapped = true;
                if (!tapped) { bearFVG = { bottom: State.btData[k].h, top: State.btData[k - 2].l }; break; }
              }
            }
            if (bullFVG && c.l <= bullFVG.top && price > bullFVG.top && efArr[i] > esArr[i] && price > e50[i]) sig = 'LONG';
            else if (bearFVG && c.h >= bearFVG.bottom && price < bearFVG.bottom && efArr[i] < esArr[i] && price < e50[i]) sig = 'SHORT';
          }
          // F&O Strategies
          else if (st === 'straddle') {
            // Short Straddle: Enter when VIX is elevated AND we're in expiry week (Thursday-ish candles)
            const bbWidth = bbV[i]?.width || 0;
            const isLowVol = bbWidth < 1.5; // tight range = good straddle entry
            if (isLowVol && rsiV[i] > 45 && rsiV[i] < 55) sig = 'LONG'; // represents net premium collected
          }
          else if (st === 'bull_spread') {
            // Bull Call Spread: Enter on bullish signals
            if (efArr[i] > esArr[i] && price > vwapV[i] && rsiV[i] > 55) sig = 'LONG';
          }
          else if (st === 'bear_spread') {
            // Bear Put Spread: Enter on bearish signals
            if (efArr[i] < esArr[i] && price < vwapV[i] && rsiV[i] < 45) sig = 'SHORT';
          }

          if (sig) {
            const p = gp(st === 'straddle' ? 'str' : st === 'bull_spread' ? 'bcs' : st === 'bear_spread' ? 'bps' : st);
            let aSL, aTP;
            const baseQty = segment !== 'intraday'
              ? lotSize * (Math.floor((cap * 5) / (price * lotSize)) || 1)
              : (Math.floor((cap * 5) / price) || 1);

            if (st === 'smc') {
              aSL = sig === 'LONG' ? price * (1 - p.sl / 100) : price * (1 + p.sl / 100);
              aTP = sig === 'LONG' ? price * (1 + p.tp / 100) : price * (1 - p.tp / 100);
            } else if (st === 'straddle' || st === 'bull_spread' || st === 'bear_spread') {
              const slPct = +(document.getElementById('str-sl')?.value || 50) / 100;
              const tpPct = +(document.getElementById('str-tp')?.value || 30) / 100;
              aSL = sig === 'LONG' ? price * (1 - slPct) : price * (1 + slPct);
              aTP = sig === 'LONG' ? price * (1 + tpPct) : price * (1 - tpPct);
            } else {
              aSL = sig === 'LONG' ? price - p.sl * atrV[i] : price + p.sl * atrV[i];
              aTP = sig === 'LONG' ? price + p.tp * atrV[i] : price - p.tp * atrV[i];
            }

            pos[st] = { dir: sig, entry: price, aSL, aTP, entryDate: c.date, qty: baseQty };
          }
        });
      });
    });

    State.equityHistory = [];
    let running = 0;
    State.tradeLog.forEach(t => { running += t.netPnl; State.equityHistory.push(running); });

    renderBTResults();
    renderTradeLog(State.tradeLog);
    renderAccuracy();
    renderTVChart(State.btData, State.tradeLog, 'all');

    document.getElementById('bt-run-btn').disabled = false;
    DOM.setHtml('bt-status', `<span style="color:var(--green)">✓ ${State.tradeLog.length} trades</span>`);
    document.getElementById('ai-review-btn').disabled = false;
    updatePerfSummary();
    switchBTTab('bt-results');
    hideOv();
  }, 80);
}

function calcMaxDD() {
  let pk = 0, dd = 0, running = 0;
  State.tradeLog.forEach(t => {
    running += t.netPnl;
    if (running > pk) pk = running;
    dd = Math.min(dd, running - pk);
  });
  return dd;
}

function calcSharpe() {
  if (State.equityHistory.length < 2) return 0;
  const rets = State.equityHistory.map((v, i) => i > 0 ? v - State.equityHistory[i - 1] : 0).slice(1);
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - avg) ** 2, 0) / rets.length) || 1;
  return (avg / std * Math.sqrt(252)).toFixed(2);
}

function renderBTResults() {
  const wins = State.tradeLog.filter(t => t.win);
  const losses = State.tradeLog.filter(t => !t.win);
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wr = State.tradeLog.length ? (wins.length / State.tradeLog.length * 100).toFixed(1) : 0;
  const avgW = wins.length ? wins.reduce((a, t) => a + t.netPnl, 0) / wins.length : 0;
  const avgL = losses.length ? Math.abs(losses.reduce((a, t) => a + t.netPnl, 0) / losses.length) : 1;
  const pf = losses.length ? (wins.reduce((a, t) => a + t.netPnl, 0) / Math.abs(losses.reduce((a, t) => a + t.netPnl, 0))).toFixed(2) : '∞';
  const mdd = calcMaxDD();
  const sh = calcSharpe();
  const exp = State.tradeLog.length ? (net / State.tradeLog.length).toFixed(0) : 0;
  const nc = net >= 0 ? 'var(--green)' : 'var(--down)';
  const stratNames = { ema: 'EMA Cross V2', orb: 'ORB 9:30', smc: 'SMC FVG', straddle: 'Short Straddle', bull_spread: 'Bull Call Spread', bear_spread: 'Bear Put Spread' };

  DOM.setHtml('bt-results-content', `
  <div class="results-grid mb16">
    <div class="stat-card"><div class="stat-label">Net P&L</div><div class="stat-val" style="color:${nc};font-size:20px">₹${net.toLocaleString('en-IN')}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Gross: ₹${State.tradeLog.reduce((a, t) => a + t.grossPnl, 0).toLocaleString('en-IN')}</div></div>
    <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-val" style="color:${+wr >= 55 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)'}">${wr}%</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${wins.length}W / ${losses.length}L / ${State.tradeLog.length} total</div></div>
    <div class="stat-card"><div class="stat-label">Profit Factor</div><div class="stat-val" style="color:${+pf >= 1.5 ? 'var(--green)' : +pf >= 1 ? 'var(--warn)' : 'var(--down)'}">${pf}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">AvgW ₹${Math.round(avgW)} / AvgL ₹${Math.round(avgL)}</div></div>
    <div class="stat-card"><div class="stat-label">Max Drawdown</div><div class="stat-val down">₹${Math.abs(mdd).toLocaleString('en-IN')}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Peak-to-trough</div></div>
    <div class="stat-card"><div class="stat-label">Sharpe Ratio</div><div class="stat-val" style="color:${sh >= 1 ? 'var(--green)' : sh >= 0 ? 'var(--warn)' : 'var(--down)'}">${sh}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Expect. ₹${exp}/trade</div></div>
  </div>
  <div class="two-col mb16">
    <div class="card"><div class="card-header">Equity Curve</div><canvas id="eq-canvas" style="width:100%;height:200px;display:block;"></canvas></div>
    <div class="card"><div class="card-header">Strategy Breakdown</div>
      ${Object.keys(stratNames).map(s => {
    const st = State.tradeLog.filter(t => t.strat === s);
    if (!st.length) return '';
    const sw = st.filter(t => t.win);
    const snet = st.reduce((a, t) => a + t.netPnl, 0);
    const swr = (sw.length / st.length * 100).toFixed(0);
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span style="font-family:var(--font-display);font-size:10px;font-weight:700;color:var(--blue)">${stratNames[s]}</span>
            <span style="font-family:var(--font-mono);font-size:13px;color:${snet >= 0 ? 'var(--green)' : 'var(--down)'}">₹${snet.toLocaleString('en-IN')}</span>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-bottom:5px;">${st.length} trades · WR ${swr}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${swr}%;background:${+swr >= 55 ? 'var(--green)' : +swr >= 45 ? 'var(--warn)' : 'var(--down)'}"></div></div>
        </div>`;
  }).join('')}
    </div>
  </div>
  <div class="card"><div class="card-header">Quick Stats</div>
    <div class="stats-grid four-col">
      <div class="stat-card"><div class="stat-label">TOTAL CHARGES</div><div class="stat-val down" style="font-size:16px">₹${State.tradeLog.reduce((a, t) => a + t.charges, 0).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">BEST TRADE</div><div class="stat-val up" style="font-size:16px">₹${Math.max(...State.tradeLog.map(t => t.netPnl)).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">WORST TRADE</div><div class="stat-val down" style="font-size:16px">₹${Math.min(...State.tradeLog.map(t => t.netPnl)).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">CAPITAL / TRADE</div><div class="stat-val" style="font-size:16px">₹${(+(document.getElementById('bt-capital')?.value || 50000)).toLocaleString('en-IN')}</div></div>
    </div>
  </div>`);

  setTimeout(drawEquityCurve, 80);
}

function drawEquityCurve() {
  const c = document.getElementById('eq-canvas');
  if (!c || !State.equityHistory.length) return;
  const ctx = c.getContext('2d');
  c.width = c.offsetWidth * window.devicePixelRatio || 600;
  c.height = 200 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = c.offsetWidth || 600, H = 200;
  ctx.clearRect(0, 0, W, H);

  const mn = Math.min(...State.equityHistory, 0);
  const mx = Math.max(...State.equityHistory, 1);
  const rng = mx - mn || 1;
  const ty = v => 10 + (mx - v) / rng * (H - 20);
  const tx = i => 10 + i / ((State.equityHistory.length - 1) || 1) * (W - 20);

  // Zero line
  ctx.strokeStyle = 'rgba(41,128,185,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(10, ty(0)); ctx.lineTo(W - 10, ty(0)); ctx.stroke();
  ctx.setLineDash([]);

  // Fill
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(106,176,76,0.18)');
  g.addColorStop(1, 'rgba(106,176,76,0)');
  ctx.beginPath();
  State.equityHistory.forEach((v, i) => i === 0 ? ctx.moveTo(tx(0), ty(v)) : ctx.lineTo(tx(i), ty(v)));
  ctx.lineTo(tx(State.equityHistory.length - 1), ty(0));
  ctx.lineTo(10, ty(0));
  ctx.fillStyle = g; ctx.fill();

  // Line
  ctx.strokeStyle = 'var(--green, #6AB04C)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  State.equityHistory.forEach((v, i) => i === 0 ? ctx.moveTo(tx(0), ty(v)) : ctx.lineTo(tx(i), ty(v)));
  ctx.stroke();
}

function renderTradeLog(trades) {
  State.allTrades = [...trades];
  filterTrades('all');
}

function filterTrades(f) {
  let fl = State.allTrades;
  if (f === 'win') fl = State.allTrades.filter(t => t.win);
  else if (f === 'loss') fl = State.allTrades.filter(t => !t.win);
  else if (['ema', 'orb', 'smc', 'straddle', 'bull_spread', 'bear_spread'].includes(f)) fl = State.allTrades.filter(t => t.strat === f);

  const sn = { ema: 'EMA', orb: 'ORB', smc: 'SMC', straddle: 'STRADDLE', bull_spread: 'BULL SPR', bear_spread: 'BEAR SPR' };

  DOM.setHtml('trade-body', fl.length ? fl.map(t => `<tr>
    <td style="color:var(--text3)">${t.id}</td>
    <td style="font-size:11px">${DOM.esc(t.date)}</td>
    <td><span style="font-size:9px;padding:2px 6px;background:var(--pale-blue);border-radius:3px;color:var(--blue)">${sn[t.strat] || t.strat}</span></td>
    <td><span style="font-size:9px;color:var(--text3)">${DOM.esc(t.segment || 'equity')}</span></td>
    <td><span style="color:${t.dir === 'LONG' ? 'var(--green)' : 'var(--down)'}">${t.dir==='LONG'?'▲ BUY':'▼ SELL'}</span></td>
    <td style="font-family:var(--font-mono)">${t.entry.toFixed(2)}</td>
    <td style="font-family:var(--font-mono)">${t.exit.toFixed(2)}</td>
    <td>${t.lots ? `${t.lots} lots` : t.qty}</td>
    <td class="${t.grossPnl>=0?'up':'down'}" style="font-family:var(--font-mono)">₹${t.grossPnl.toLocaleString('en-IN')}</td>
    <td style="color:var(--text3);font-family:var(--font-mono)">₹${t.charges}</td>
    <td class="${t.netPnl>=0?'up':'down'}" style="font-weight:600;font-family:var(--font-mono)">₹${t.netPnl.toLocaleString('en-IN')}</td>
    <td style="font-size:10px;color:${t.reason.includes('Target')?'var(--green)':t.reason.includes('SL')?'var(--down)':'var(--text3)'}">${DOM.esc(t.reason)}</td>
  </tr > `).join('') : '<tr><td colspan="12" class="empty-cell">No trades match filter</td></tr>');

  const net  = fl.reduce((a,t)=>a+t.netPnl,0);
  const wins = fl.filter(t=>t.win).length;
  DOM.setHtml('trade-summary', `
    <span style="color:var(--text3)">${fl.length} trades</span>
    <span class="up">Wins: ${wins}</span>
    <span class="down">Losses: ${fl.length-wins}</span>
    <span style="font-family:var(--font-mono);color:${net>=0?'var(--green)':'var(--down)'}">Net: ₹${net.toLocaleString('en-IN')}</span>`);

  renderTVChart(State.btData, State.tradeLog, f);
}

function renderTVChart(data, logs, filterStrat = 'all') {
  try {
    if (typeof LightweightCharts === 'undefined') return;
    const cDiv = document.getElementById('tv-chart');
    if (!cDiv || !data.length) return;

    const prnt     = document.getElementById('bt-chart');
    const wasHidden = prnt.style.display === 'none';
    if (wasHidden) prnt.style.display = 'block';

    if (State.tvChart) { State.tvChart.remove(); State.tvChart = null; }

    State.tvChart = LightweightCharts.createChart(cDiv, {
      width:  cDiv.clientWidth || 800,
      height: 520,
      layout: { background: { type: 'solid', color: '#FFFFFF' }, textColor: '#3A5260' },
      grid: {
        vertLines: { color: 'rgba(212,233,238,0.5)' },
        horzLines: { color: 'rgba(212,233,238,0.5)' }
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(212,233,238,0.8)' },
      timeScale: { borderColor: 'rgba(212,233,238,0.8)', timeVisible: true }
    });

    State.tvSeries = State.tvChart.addCandlestickSeries({
      upColor:       '#6AB04C',
      downColor:     '#E74C3C',
      borderVisible: false,
      wickUpColor:   '#6AB04C',
      wickDownColor: '#E74C3C'
    });

    State.tvSeries.setData(data.map(d => ({ time: d.ts / 1000, open: d.o, high: d.h, low: d.l, close: d.c })));

    let fl = logs;
    if (filterStrat === 'win')  fl = logs.filter(t => t.win);
    else if (filterStrat === 'loss') fl = logs.filter(t => !t.win);
    else if (['ema','orb','smc','straddle','bull_spread','bear_spread'].includes(filterStrat)) fl = logs.filter(t => t.strat === filterStrat);

    const markers = [];
    const seen    = new Set();
    fl.sort((a,b) => a.entryTs - b.entryTs).forEach(t => {
      const ts = t.entryTs / 1000;
      if (!seen.has(ts)) {
        seen.add(ts);
        markers.push({
          time:     ts,
          position: t.dir === 'LONG' ? 'belowBar' : 'aboveBar',
          color:    t.dir === 'LONG' ? '#6AB04C' : '#E74C3C',
          shape:    t.dir === 'LONG' ? 'arrowUp' : 'arrowDown',
          text:     (t.dir === 'LONG' ? 'B ' : 'S ') + (t.strat || '').toUpperCase()
        });
      }
    });
    if (markers.length) State.tvSeries.setMarkers(markers);
    State.tvChart.timeScale().fitContent();

    if (wasHidden) prnt.style.display = 'none';
  } catch (e) { console.error('TV Chart error:', e); }
}

function renderAccuracy() {
  const stratNames = { ema:'EMA Cross V2', orb:'ORB 9:30', smc:'SMC FVG', straddle:'Short Straddle', bull_spread:'Bull Call Spread', bear_spread:'Bear Put Spread' };
  DOM.setHtml('bt-acc-content', Object.keys(stratNames).map(s => {
    const st  = State.tradeLog.filter(t => t.strat === s);
    if (!st.length) return '';
    const sw  = st.filter(t => t.win);
    const wr  = (sw.length / st.length * 100).toFixed(1);
    const net = st.reduce((a,t)=>a+t.netPnl,0);
    const tg  = st.filter(t=>t.reason.includes('Target'));
    const sl  = st.filter(t=>t.reason.includes('SL'));
    const c   = +wr >= 60 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)';

    return `< div class="card mb16" >
      <div class="card-header">${stratNames[s]}</div>
      <div class="stats-grid four-col mb12">
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-val" style="color:${c}">${wr}%</div></div>
        <div class="stat-card"><div class="stat-label">Trades</div><div class="stat-val">${st.length}</div></div>
        <div class="stat-card"><div class="stat-label">Net P&L</div><div class="stat-val" style="color:${net>=0?'var(--green)':'var(--down)'}">₹${net.toLocaleString('en-IN')}</div></div>
        <div class="stat-card"><div class="stat-label">Target Hits</div><div class="stat-val up">${tg.length}<span style="font-size:10px;color:var(--text3)"> / SL ${sl.length}</span></div></div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${st.slice(-30).map(t => `<div title="${DOM.esc(t.date)} ${t.dir} ₹${t.netPnl}" style="width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;cursor:help;background:${t.win?'var(--pale-green)':'rgba(231,76,60,0.1)'};border:1px solid ${t.win?'rgba(106,176,76,0.4)':'rgba(231,76,60,0.3)'};color:${t.win?'var(--green)':'var(--down)'};">${t.win?'W':'L'}</div>`).join('')}
        ${st.length > 30 ? `<span style="font-size:10px;color:var(--text3);align-self:center">+${st.length-30} more</span>` : ''}
      </div>
    </div > `;
  }).join('') || '<div class="empty-state">No strategy trades found</div>');
}

/* ═══════════════════════════════════════════
   MODULE: REPLAY
═══════════════════════════════════════════ */
function initReplay() {
  const date = document.getElementById('rp-date')?.value;
  if (!date) { alert('Select a date'); return; }
  if (!State.btData.length) { alert('Fetch data first'); return; }
  State.rpData = State.btData.filter(d => d.date.toISOString().slice(0, 10) === date);
  if (!State.rpData.length) { alert('No data for this date.'); return; }
  State.rpIdx = 0;
  drawReplay();
}
function rStep(n) {
  if (!State.rpData.length) { alert('Load a day first'); return; }
  State.rpIdx = Math.max(0, Math.min(State.rpData.length - 1, State.rpIdx + n));
  drawReplay();
}
function togglePlay() {
  if (!State.rpData.length) { alert('Load a day first'); return; }
  State.rpAuto = !State.rpAuto;
  DOM.setText('rp-play', State.rpAuto ? '⏸ PAUSE' : '▶ PLAY');
  if (State.rpAuto) stepAuto();
}
function stepAuto() {
  if (!State.rpAuto) return;
  if (State.rpIdx >= State.rpData.length - 1) {
    State.rpAuto = false;
    DOM.setText('rp-play', '▶ PLAY');
    return;
  }
  State.rpIdx++;
  drawReplay();
  setTimeout(stepAuto, +(document.getElementById('rp-speed')?.value || 500));
}
function drawReplay() {
  const canvas = document.getElementById('rp-canvas');
  if (!canvas || !State.rpData.length) return;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.offsetWidth || 800;
  const H      = 300;
  canvas.width  = W;
  canvas.height = H;
  ctx.fillStyle = '#FAFCFD';
  ctx.fillRect(0, 0, W, H);

  const slice  = State.rpData.slice(0, State.rpIdx + 1);
  const prices = State.rpData.flatMap(c => [c.h, c.l]);
  const mn     = Math.min(...prices);
  const mx     = Math.max(...prices);
  const rng    = mx - mn || 1;
  const bw     = Math.max(2, (W - 20) / State.rpData.length - 1);
  const ty     = v => 10 + (mx - v) / rng * (H - 40);
  const tx     = i => 10 + i * (W - 20) / State.rpData.length + bw / 2;

  // Future candles (ghosted)
  State.rpData.forEach((c, i) => {
    if (i > State.rpIdx) {
      ctx.fillStyle = 'rgba(212,233,238,0.3)';
      ctx.fillRect(tx(i) - bw/2, ty(c.h), bw, ty(c.l) - ty(c.h) || 1);
    }
  });

  // EMA lines
  const cls  = slice.map(c => c.c);
  const e9r  = Indicators.ema(cls, 9);
  const e21r = Indicators.ema(cls, 21);
  [[e9r, '#2980B9'], [e21r, '#6AB04C']].forEach(([ema, col]) => {
    ctx.strokeStyle = col + '99';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ema.forEach((v, i) => i === 0 ? ctx.moveTo(tx(i), ty(v)) : ctx.lineTo(tx(i), ty(v)));
    ctx.stroke();
  });

  // Candles
  slice.forEach((c, i) => {
    const up = c.c >= c.o;
    ctx.fillStyle   = up ? '#6AB04C' : '#E74C3C';
    ctx.strokeStyle = up ? '#4e8a38' : '#c0392b';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(tx(i), ty(c.h)); ctx.lineTo(tx(i), ty(c.l)); ctx.stroke();
    const bt = ty(Math.max(c.o, c.c));
    const bh = Math.abs(ty(c.o) - ty(c.c)) || 1;
    ctx.fillRect(tx(i) - bw/2 + 1, bt, bw - 2, bh);
  });

  // Current price line
  if (slice.length) {
    const last = slice[slice.length - 1];
    ctx.strokeStyle = '#2980B9';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, ty(last.c)); ctx.lineTo(W, ty(last.c)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2980B9';
    ctx.font      = '10px DM Mono, monospace';
    ctx.fillText(last.c.toFixed(2), W - 64, ty(last.c) - 3);
  }

  const cur  = State.rpData[State.rpIdx];
  const rsi2 = Indicators.rsi(State.rpData.slice(0, State.rpIdx + 1).map(c => c.c));
  const rv   = rsi2[rsi2.length - 1] || 50;

  DOM.setText('rp-t',   cur.date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  DOM.setText('rp-o',   cur.o.toFixed(2));
  DOM.setText('rp-h',   cur.h.toFixed(2));
  DOM.setText('rp-l',   cur.l.toFixed(2));
  DOM.setText('rp-c',   cur.c.toFixed(2));
  DOM.setColor('rp-c',  cur.c >= cur.o ? 'var(--green)' : 'var(--down)');
  DOM.setText('rp-rsi', rv.toFixed(1));
  DOM.setColor('rp-rsi', rv < 30 ? 'var(--green)' : rv > 70 ? 'var(--down)' : 'var(--text)');
  DOM.setText('rp-sig', rv < 30 ? '▲ RSI BUY' : rv > 70 ? '▼ RSI SELL' : '— NEUTRAL');
  DOM.setText('rp-idx', `${ State.rpIdx + 1 }/${State.rpData.length}`);

const dp = State.tradeLog
  .filter(t => t.date.startsWith(cur.date.toLocaleDateString('en-IN')))
  .reduce((a, t) => a + t.netPnl, 0);
DOM.setText('rp-pnl', `₹${dp.toLocaleString('en-IN')}`);
DOM.setColor('rp-pnl', dp >= 0 ? 'var(--green)' : 'var(--down)');
}

function btReset() {
  State.reset();
  DOM.setWidth('bt-prog', 0);
  DOM.setText('bt-data-status', '⚠ Click FETCH DATA to load from Yahoo Finance');
  if (document.getElementById('bt-run-btn')) document.getElementById('bt-run-btn').disabled = true;
  if (document.getElementById('ai-review-btn')) document.getElementById('ai-review-btn').disabled = true;
  DOM.setText('bt-status', '');
  DOM.setHtml('trade-body', '<tr><td colspan="12" class="empty-cell">Run backtest first</td></tr>');
  switchBTTab('bt-setup');
}

/* ═══════════════════════════════════════════
   MODULE: TRADE LOG / AI REVIEW
═══════════════════════════════════════════ */
function updatePerfSummary() {
  if (!State.tradeLog.length) return;
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wins = State.tradeLog.filter(t => t.win).length;
  const wr = (wins / State.tradeLog.length * 100).toFixed(1);
  DOM.setText('ps-trades', State.tradeLog.length);
  DOM.setText('ps-wr', wr + '%');
  DOM.setColor('ps-wr', +wr >= 55 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)');
  DOM.setText('ps-pnl', '₹' + net.toLocaleString('en-IN'));
  DOM.setColor('ps-pnl', net >= 0 ? 'var(--green)' : 'var(--down)');
  DOM.setText('ps-sharpe', calcSharpe());
}

async function getAIReview() {
  if (!State.tradeLog.length) { alert('Run backtest first'); return; }
  DOM.setHtml('ai-review-area', '<span class="spinr"></span> Analyzing with veteran perspective...');

  const wins = State.tradeLog.filter(t => t.win).length;
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wr = (wins / State.tradeLog.length * 100).toFixed(1);
  const mdd = calcMaxDD();
  const sh = calcSharpe();
  const stList = ['ema', 'orb', 'smc', 'straddle', 'bull_spread', 'bear_spread'].map(s => {
    const st = State.tradeLog.filter(t => t.strat === s);
    const sw = st.filter(t => t.win);
    return st.length ? `${s.toUpperCase()}: ${st.length} trades, ${sw.length} wins (${st.length ? (sw.length / st.length * 100).toFixed(0) : 0}% WR), net ₹${st.reduce((a, t) => a + t.netPnl, 0).toLocaleString('en-IN')}` : null;
  }).filter(Boolean).join('\n');

  const prompt = `You are a veteran Indian stock market analyst. Review this backtest result honestly:
Symbol: ${document.getElementById('bt-sym')?.options[document.getElementById('bt-sym')?.selectedIndex]?.text}
Segment: ${document.getElementById('bt-segment')?.value}
Timeframe: ${document.getElementById('bt-tf')?.value} | Period: ${document.getElementById('bt-period')?.value}
Capital/trade: ₹${(+(document.getElementById('bt-capital')?.value || 50000)).toLocaleString('en-IN')}
Total Trades: ${State.tradeLog.length} | Win Rate: ${wr}% | Net P&L: ₹${net.toLocaleString('en-IN')} | Max DD: ₹${Math.abs(mdd).toLocaleString('en-IN')} | Sharpe: ${sh}
Strategy Breakdown:\n${stList}
Give a direct 5-6 sentence analysis: overall verdict, best strategy and why, biggest weakness, improvement suggestions, risk management advice. Be tough and honest — no sugarcoating.`;

  try {
    const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA, false);
    DOM.setHtml('ai-review-area', raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--blue)">$1</strong>'));
  } catch { DOM.setText('ai-review-area', 'Error. Please add your API key and retry.'); }
}

async function askAIQa() {
  const q = (document.getElementById('ai-qa-input')?.value || '').trim();
  if (!q) return;
  DOM.setText('ai-qa-input', '');

  const area = document.getElementById('ai-review-area');
  const qDiv = document.createElement('div');
  qDiv.style.cssText = 'color:var(--blue);margin:10px 0 4px;font-size:12px;';
  qDiv.textContent = '▶ ' + q;
  area.appendChild(qDiv);

  const ansDiv = document.createElement('div');
  ansDiv.innerHTML = '<span class="spinr"></span>';
  area.appendChild(ansDiv);
  area.scrollTop = 99999;

  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const ctx = `Backtest: ${State.tradeLog.length} trades, ${State.tradeLog.length ? (State.tradeLog.filter(t => t.win).length / State.tradeLog.length * 100).toFixed(1) : 0}% WR, ₹${net} net, Sharpe: ${calcSharpe()}. Q: ${q}`;

  try {
    const raw = await callClaude(ctx, CONFIG.ANALYST_PERSONA, false);
    ansDiv.innerHTML = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  } catch { ansDiv.textContent = 'Error. Please retry.'; }
  area.scrollTop = 99999;
}

/* ═══════════════════════════════════════════
   MODULE: PAPER TRADING
═══════════════════════════════════════════ */
async function refreshPaperTrading() {
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/portfolio', { cache: 'no-store' });
    const data = await res.json();
    DOM.setText('pt-capital', (+data.portfolio.capital).toLocaleString('en-IN'));
    DOM.setText('pt-margin', (+data.portfolio.used_margin).toLocaleString('en-IN'));
    DOM.setText('pt-realized', '₹' + (+data.portfolio.total_pnl).toLocaleString('en-IN'));
    DOM.setColor('pt-realized', data.portfolio.total_pnl >= 0 ? 'var(--green)' : 'var(--down)');

    State.ptPositions = data.positions;
    renderPTPositions();
    if (State.ptPositions.length > 0) paperTradingLoop();

    const rHist = await fetch(CONFIG.PROXY_BASE + '/api/paper/history', { cache: 'no-store' });
    const dHist = await rHist.json();
    renderPTHistory(dHist.history);
  } catch (e) { console.error('Paper trading fetch error:', e); }
}

function renderPTPositions() {
  const tb = document.getElementById('pt-positions-body');
  if (!tb) return;
  if (!State.ptPositions.length) {
    tb.innerHTML = '<tr><td colspan="9" class="empty-cell">No active positions.</td></tr>';
    DOM.setText('pt-unrealized', '₹0');
    return;
  }
  tb.innerHTML = State.ptPositions.map(p => {
    const color = p.type === 'LONG' ? 'var(--green)' : 'var(--down)';
    return `<tr id="pt-row-${p.id}">
      <td style="font-weight:600">${DOM.esc(p.symbol)}</td>
      <td style="color:${color};font-weight:600">${DOM.esc(p.type)}</td>
      <td>${p.qty}</td>
      <td style="font-family:var(--font-mono)">${p.entry_price.toFixed(2)}</td>
      <td style="font-family:var(--font-mono)" id="pt-ltp-${p.id}">--</td>
      <td style="color:var(--down);font-family:var(--font-mono)">${p.sl.toFixed(2)}</td>
      <td style="color:var(--green);font-family:var(--font-mono)">${p.tp.toFixed(2)}</td>
      <td style="font-weight:600;font-family:var(--font-mono)" id="pt-pnl-${p.id}">--</td>
      <td>
        <button class="btn btn-sm btn-ghost" onclick="ptModifyPosition(${p.id}, ${p.sl.toFixed(2)}, ${p.tp.toFixed(2)})" style="margin-right:4px">Modify</button>
        <button class="btn btn-sm btn-danger" onclick="squareOffPosition(${p.id})">Exit</button>
      </td>
    </tr>`;
  }).join('');
}

function renderPTHistory(hist) {
  const tb = document.getElementById('pt-history-body');
  if (!tb) return;
  if (!hist?.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-cell">No trade history yet.</td></tr>';
    return;
  }
  tb.innerHTML = hist.map(h => {
    const dc = h.type === 'LONG' ? 'var(--green)' : 'var(--down)';
    const pc = h.pnl > 0 ? 'var(--green)' : 'var(--down)';
    return `<tr>
      <td style="font-size:10px;color:var(--text3)">${DOM.esc(h.exit_time)}</td>
      <td style="font-weight:600">${DOM.esc(h.symbol)}</td>
      <td style="color:${dc}">${DOM.esc(h.type)}</td>
      <td>${h.qty}</td>
      <td style="font-family:var(--font-mono)">${h.entry_price.toFixed(2)}</td>
      <td style="font-family:var(--font-mono)">${h.exit_price.toFixed(2)}</td>
      <td style="color:${pc};font-weight:600;font-family:var(--font-mono)">${h.pnl > 0 ? '+' : ''}${h.pnl.toFixed(2)}</td>
      <td style="font-size:10px;color:var(--text3)">${DOM.esc(h.reason)}</td>
    </tr>`;
  }).join('');
}

function onPTSymSelect(sym) {
  if (!sym) return;
  const qId = document.getElementById('pt-qty');
  if (qId) {
    const s = sym.toUpperCase();
    if (s.includes('BANKNIFTY') || s.includes('BANK NIFTY')) qId.value = 15;
    else if (s.includes('FINNIFTY')) qId.value = 25;
    else if (s.includes('MIDCPNIFTY')) qId.value = 50;
    else if (s.includes('SENSEX')) qId.value = 10;
    else if (s.includes('NIFTY')) qId.value = 65;
  }
  ptFetchLTP();
}

async function executeVirtualTrade(symbol, type, qty, entry, sl, tp) {
  const req = {
    symbol,
    type: (type === 'BUY' || type === 'LONG') ? 'LONG' : 'SHORT',
    qty: parseInt(qty),
    entry_price: parseFloat(entry),
    sl: parseFloat(sl),
    tp: parseFloat(tp)
  };
  if (!req.qty || !req.entry_price) { alert('Invalid trade parameters'); return; }

  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (res.ok) { switchTab('paper'); refreshPaperTrading(); }
    else {
      const err = await res.json();
      alert('Paper Trade Failed: ' + (err.detail || 'Unknown error'));
    }
  } catch { alert('API connection failed — is the backend running?'); }
}

function executeCurrentSignal() {
  const sym = document.getElementById('sh-sym-label')?.textContent || 'NIFTY 50';
  const isBuy = !!document.querySelector('.badge-buy');
  const isSell = !!document.querySelector('.badge-sell');
  if (!isBuy && !isSell) { alert('No active BUY or SELL signal'); return; }
  const sig = isBuy ? 'LONG' : 'SHORT';
  const entry = document.getElementById('nl-entry')?.textContent;
  const sl = document.getElementById('nl-sl')?.textContent;
  const t1 = document.getElementById('nl-t1')?.textContent;
  if (!entry || entry === '--') { alert('Signal is not ready'); return; }
  const qty = parseInt(prompt(`Quantity for ${sym} (Default: 50 lots = 1 Nifty lot):`, '50'));
  if (!qty || qty <= 0) return;
  executeVirtualTrade(sym, sig, qty, entry, sl, t1);
}

function executePaperTrade(symbol, signal, entry, sl, tp) {
  if (signal === 'HOLD') { alert('Signal is HOLD — cannot execute.'); return; }
  if (!entry || isNaN(entry)) { alert('Invalid entry price.'); return; }
  const qty = parseInt(prompt(`Quantity for ${symbol}:`, '100'));
  if (!qty || qty <= 0) return;
  executeVirtualTrade(symbol, signal, qty, entry, sl, tp);
}

async function squareOffPosition(id, explicitPrice = null, reason = 'Manual Square Off') {
  const pos = State.ptPositions.find(p => p.id === id);
  if (!pos) return;
  let exitPrice = explicitPrice;
  if (exitPrice === null) {
    const el = document.getElementById(`pt-ltp-${id}`);
    exitPrice = (el && el.textContent !== '--') ? parseFloat(el.textContent) : pos.entry_price;
  }
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/exit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, exit_price: exitPrice, reason })
    });
    if (res.ok) refreshPaperTrading();
  } catch (e) { console.error('Square off failed:', e); }
}

async function resetPaperTrading() {
  if (!confirm('WARNING: Reset virtual portfolio? This will wipe all history and reset capital to ₹10,00,000.')) return;
  try {
    await fetch(CONFIG.PROXY_BASE + '/api/paper/reset', { method: 'POST' });
    refreshPaperTrading();
  } catch { alert('Reset failed'); }
}

async function paperTradingLoop() {
  if (!State.ptPositions.length) return;
  let totalUnrealized = 0;
  for (const pos of State.ptPositions) {
    let sym = pos.symbol;
    if (sym === 'NIFTY 50') sym = '^NSEI';
    if (sym === 'BANK NIFTY') sym = '^NSEBANK';
    if (sym === 'SENSEX') sym = '^BSESN';
    if (!sym.includes('^')) sym += '.NS';

    try {
      const j = await yahooFetch(sym, '1m', '1d');
      if (!j) continue;
      const ltp = j.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (!ltp) continue;

      const upnl = pos.type === 'LONG' ? (ltp - pos.entry_price) * pos.qty : (pos.entry_price - ltp) * pos.qty;
      totalUnrealized += upnl;

      DOM.setText(`pt-ltp-${pos.id}`, ltp.toFixed(2));
      const pnlEl = document.getElementById(`pt-pnl-${pos.id}`);
      if (pnlEl) {
        pnlEl.textContent = (upnl > 0 ? '+' : '') + upnl.toFixed(2);
        pnlEl.style.color = upnl > 0 ? 'var(--green)' : upnl < 0 ? 'var(--down)' : 'var(--text)';
      }

      if (pos.type === 'LONG') {
        if (ltp <= pos.sl) squareOffPosition(pos.id, ltp, 'SL Hit');
        if (ltp >= pos.tp) squareOffPosition(pos.id, ltp, 'Target Hit');
      } else {
        if (ltp >= pos.sl) squareOffPosition(pos.id, ltp, 'SL Hit');
        if (ltp <= pos.tp) squareOffPosition(pos.id, ltp, 'Target Hit');
      }
    } catch { /* skip */ }
  }
  const tuEl = document.getElementById('pt-unrealized');
  if (tuEl) {
    tuEl.textContent = '₹' + totalUnrealized.toFixed(2);
    tuEl.style.color = totalUnrealized > 0 ? 'var(--green)' : totalUnrealized < 0 ? 'var(--down)' : 'var(--text)';
  }
}

/* ═══════════════════════════════════════════
   MODULE: LIVE TICKERS (Sidebar + Watchlist)
   Populates the sidebar market price tiles.
═══════════════════════════════════════════ */
async function fetchLiveTickers() {
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

/* ═══════════════════════════════════════════
   MODULE: WATCHLIST MANAGER
   Multi-list, sessionStorage-backed watchlist.
═══════════════════════════════════════════ */
const _SYM_MAP = {
  'NIFTY 50': '^NSEI', 'BANK NIFTY': '^NSEBANK', 'SENSEX': '^BSESN',
  'FINNIFTY': '^NSEMDCP50', 'RELIANCE': 'RELIANCE.NS', 'HDFC BANK': 'HDFCBANK.NS',
  'INFOSYS': 'INFY.NS', 'TCS': 'TCS.NS', 'ICICI BANK': 'ICICIBANK.NS',
  'ADANI ENT': 'ADANIENT.NS', 'TATA MOTORS': 'TATAMOTORS.NS',
  'BAJAJ FINANCE': 'BAJFINANCE.NS', 'SBIN': 'SBIN.NS',
  'BHARTIARTL': 'BHARTIARTL.NS', 'ITC': 'ITC.NS', 'LT': 'LT.NS',
  'AXISBANK': 'AXISBANK.NS', 'KOTAKBANK': 'KOTAKBANK.NS',
};
function _toYahooSym(name) {
  const n = name.toUpperCase();
  if (n.match(/^(NIFTY|BANKNIFTY)\s+(\d{1,2}\s+[A-Z]{3})\s+(\d+)\s+(CE|PE)$/i)) return n;
  return _SYM_MAP[n] || (n.endsWith('.NS') ? n : n + '.NS');
}

const WL = (() => {
  const SK = 'ryugan_wl';
  const DEFAULTS = {
    'Nifty 50': ['NIFTY 50', 'BANK NIFTY', 'SENSEX'],
    'FnO Stocks': ['RELIANCE', 'HDFC BANK', 'INFOSYS', 'TCS', 'ICICI BANK'],
    'Bank Nifty Options': ['BANK NIFTY', 'HDFC BANK', 'ICICI BANK', 'AXISBANK', 'KOTAKBANK'],
  };
  let state = { lists: {}, active: 'Nifty 50' };

  function load() {
    try {
      const raw = sessionStorage.getItem(SK);
      if (raw) state = JSON.parse(raw);
      if (!state.lists || Object.keys(state.lists).length === 0) state.lists = { ...DEFAULTS };
    } catch { state = { lists: { ...DEFAULTS }, active: 'Nifty 50' }; }
  }
  function save() { sessionStorage.setItem(SK, JSON.stringify(state)); }

  function renderSelect() {
    const sel = document.getElementById('wl-list-select');
    if (!sel) return;
    sel.innerHTML = Object.keys(state.lists).map(name =>
      `<option value="${DOM.esc(name)}" ${name === state.active ? 'selected' : ''}>${DOM.esc(name)}</option>`
    ).join('');
  }

  async function renderItems() {
    const container = document.getElementById('wl-items');
    if (!container) return;
    const syms = state.lists[state.active] || [];
    if (syms.length === 0) {
      container.innerHTML = '<div class="empty-state">No symbols. Add one above.</div>';
      return;
    }
    // Show placeholder rows immediately then fill with prices
    container.innerHTML = syms.map((s, i) =>
      `<div class="witem" id="wl-row-${i}" onclick="qs('${DOM.esc(s)}');generateSignal()">
        <div><div class="wi-sym">${DOM.esc(s)}</div></div>
        <div class="wi-price" id="wl-price-${i}">...</div>
        <div class="wi-chg" id="wl-chg-${i}" style="font-size:10px;min-width:52px;text-align:right">--</div>
        <button class="btn btn-sm btn-ghost" style="padding:3px 8px;font-size:10px;margin-left:6px"
          onclick="event.stopPropagation();WL.removeSymbol('${DOM.esc(s)}')" title="Remove">\u00d7</button>
      </div>`
    ).join('');

    // Fetch prices concurrently
    await Promise.all(syms.map(async (s, i) => {
      const d = await getPrice(_toYahooSym(s));
      const priceEl = document.getElementById(`wl-price-${i}`);
      const chgEl = document.getElementById(`wl-chg-${i}`);
      if (!priceEl) return;
      if (!d) { priceEl.textContent = '--'; return; }
      const fmt = d.c.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const chg = (d.pct >= 0 ? '\u25b2 +' : '\u25bc ') + d.pct.toFixed(2) + '%';
      const col = d.pct >= 0 ? 'var(--clr-green)' : 'var(--clr-red)';
      priceEl.textContent = fmt;
      priceEl.style.color = col;
      if (chgEl) { chgEl.textContent = chg; chgEl.style.color = col; }
    }));
  }

  return {
    init() { load(); renderSelect(); renderItems(); },

    switchList(name) {
      state.active = name;
      save();
      renderItems();
    },

    refresh() { renderItems(); },

    addSymbol() {
      const inp = document.getElementById('wl-add-sym');
      const sym = (inp?.value || '').trim().toUpperCase();
      if (!sym) return;
      if (!state.lists[state.active]) state.lists[state.active] = [];
      if (!state.lists[state.active].includes(sym)) {
        state.lists[state.active].push(sym);
        save();
      }
      if (inp) inp.value = '';
      renderItems();
    },

    removeSymbol(sym) {
      const list = state.lists[state.active];
      if (list) {
        const idx = list.indexOf(sym);
        if (idx > -1) { list.splice(idx, 1); save(); renderItems(); }
      }
    },

    promptNewList() {
      const name = prompt('Enter watchlist name (e.g. "Nifty CE Options"):');
      if (!name?.trim()) return;
      const clean = name.trim();
      if (!state.lists[clean]) { state.lists[clean] = []; save(); }
      state.active = clean;
      renderSelect();
      renderItems();
    },

    deleteList(name) {
      if (Object.keys(state.lists).length <= 1) { alert('Cannot delete the last list.'); return; }
      if (!confirm(`Delete watchlist "${name}"?`)) return;
      delete state.lists[name];
      state.active = Object.keys(state.lists)[0];
      save();
      renderSelect();
      renderItems();
    }
  };
})();

/* ═══════════════════════════════════════════
   MODULE: PAPER TRADING — ORDER FORM
   Full order entry panel with Market/Limit/SL.
═══════════════════════════════════════════ */
let _ptDir = 'LONG';

function ptSetDir(dir) {
  _ptDir = dir;
  document.getElementById('pt-long-btn')?.classList.toggle('active', dir === 'LONG');
  document.getElementById('pt-short-btn')?.classList.toggle('active', dir === 'SHORT');
}

function ptOrderTypeChange() {
  const ot = document.getElementById('pt-order-type')?.value;
  const priceRow = document.getElementById('pt-price-row');
  const triggerRow = document.getElementById('pt-trigger-row');
  if (ot === 'MARKET' || ot === 'SL-M') {
    if (priceRow) priceRow.style.display = (ot === 'MARKET') ? 'none' : '';
    if (triggerRow) triggerRow.style.display = (ot === 'SL-M') ? '' : 'none';
  } else {
    if (priceRow) priceRow.style.display = '';
    if (triggerRow) triggerRow.style.display = (ot === 'SL') ? '' : 'none';
  }
}

async function ptFetchLTP() {
  const sym = (document.getElementById('pt-sym')?.value || '').trim();
  if (!sym) { alert('Enter a symbol first.'); return; }
  const status = document.getElementById('pt-order-status');
  if (status) status.textContent = 'Fetching LTP...';
  const d = await getPrice(_toYahooSym(sym));
  if (!d) { if (status) status.textContent = '\u26a0 Could not fetch price'; return; }
  const ltp = d.c.toFixed(2);
  const priceInp = document.getElementById('pt-price');
  if (priceInp) priceInp.value = ltp;
  const label = document.getElementById('pt-ltp-label');
  if (label) label.textContent = `LTP: \u20b9${ltp}`;
  if (status) { status.textContent = `\u2713 LTP: \u20b9${ltp}`; status.style.color = 'var(--clr-green)'; }
}

function ptAutoFillSignal() {
  // Fill order form from the current Nifty Live signal
  const sym = document.getElementById('sh-sym-label')?.textContent?.replace(' — INTRADAY SIGNAL', '').trim() || 'NIFTY 50';
  const entry = document.getElementById('nl-entry')?.textContent?.replace(/,/g, '');
  const sl = document.getElementById('nl-sl')?.textContent?.replace(/,/g, '');
  const t1 = document.getElementById('nl-t1')?.textContent?.replace(/,/g, '');
  const isBuy = !!document.querySelector('.badge-buy') || !!document.querySelector('.sp-buy');
  if (document.getElementById('pt-sym')) document.getElementById('pt-sym').value = sym;
  if (entry && entry !== '--' && document.getElementById('pt-price')) document.getElementById('pt-price').value = entry;
  if (sl && sl !== '--' && document.getElementById('pt-sl-input')) document.getElementById('pt-sl-input').value = sl;
  if (t1 && t1 !== '--' && document.getElementById('pt-target-input')) document.getElementById('pt-target-input').value = t1;
  ptSetDir(isBuy ? 'LONG' : 'SHORT');
  const status = document.getElementById('pt-order-status');
  if (status) { status.textContent = '\u2713 Signal loaded'; status.style.color = 'var(--clr-green)'; }
}

async function ptPlaceOrder() {
  const sym = (document.getElementById('pt-sym')?.value || '').trim().toUpperCase();
  const ot = document.getElementById('pt-order-type')?.value || 'MARKET';
  const product = document.getElementById('pt-product')?.value || 'MIS';
  const qty = parseInt(document.getElementById('pt-qty')?.value || '0');
  const slVal = parseFloat(document.getElementById('pt-sl-input')?.value || '0');
  const tpVal = parseFloat(document.getElementById('pt-target-input')?.value || '0');
  const status = document.getElementById('pt-order-status');

  const setStatus = (msg, color = 'var(--clr-text-3)') => {
    if (status) { status.textContent = msg; status.style.color = color; }
  };

  if (!sym) { setStatus('\u26a0 Enter a symbol', 'var(--clr-red)'); return; }
  if (!qty || qty <= 0) { setStatus('\u26a0 Enter quantity', 'var(--clr-red)'); return; }
  if (!slVal || slVal <= 0) { setStatus('\u26a0 Enter stop loss', 'var(--clr-red)'); return; }
  if (!tpVal || tpVal <= 0) { setStatus('\u26a0 Enter target', 'var(--clr-red)'); return; }

  setStatus('Fetching price...', 'var(--clr-text-3)');
  let entryPrice = parseFloat(document.getElementById('pt-price')?.value || '0');
  if (!entryPrice || ot === 'MARKET') {
    const d = await getPrice(_toYahooSym(sym));
    if (!d) { setStatus('\u26a0 Could not fetch market price', 'var(--clr-red)'); return; }
    entryPrice = d.c;
  }

  const body = {
    symbol: sym, type: _ptDir, qty, entry_price: entryPrice,
    sl: slVal, tp: tpVal, order_type: ot, product
  };

  setStatus('Placing order...', 'var(--clr-text-3)');
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      setStatus(`\u2713 Order placed! ID #${data.id} | Margin: \u20b9${data.margin_used?.toLocaleString('en-IN')}`, 'var(--clr-green)');
      refreshPaperTrading();
      // Clear form
      ['pt-sym','pt-price','pt-sl-input','pt-target-input','pt-trigger'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('pt-qty').value = '1';
    } else {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      setStatus('\u26a0 ' + (err.detail || 'Order failed'), 'var(--clr-red)');
    }
  } catch { setStatus('\u26a0 Cannot reach backend — is it running?', 'var(--clr-red)'); }
}

async function ptModifyPosition(id, currentSl, currentTp) {
  const newSl = parseFloat(prompt('New Stop Loss:', currentSl));
  const newTp = parseFloat(prompt('New Target:', currentTp));
  if (isNaN(newSl) || isNaN(newTp)) return;
  try {
    const res = await fetch(`${CONFIG.PROXY_BASE}/api/paper/position/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sl: newSl, tp: newTp })
    });
    if (res.ok) { refreshPaperTrading(); }
    else { alert('Modify failed'); }
  } catch { alert('Cannot reach backend'); }
}

async function _fetchDayStats() {
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/stats');
    if (!res.ok) return;
    const s = await res.json();
    const col = (v) => v >= 0 ? 'var(--clr-green)' : 'var(--clr-red)';
    DOM.setText('pt-day-pnl', '\u20b9' + (s.day_pnl >= 0 ? '+' : '') + s.day_pnl.toFixed(2));
    DOM.setColor('pt-day-pnl', col(s.day_pnl));
    DOM.setText('pt-net-day-pnl', '\u20b9' + (s.net_day_pnl >= 0 ? '+' : '') + s.net_day_pnl.toFixed(2));
    DOM.setColor('pt-net-day-pnl', col(s.net_day_pnl));
    DOM.setText('pt-day-trades', s.trades_today);
    DOM.setText('pt-win-rate', s.win_rate + '%');
  } catch { /* stats not critical */ }
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
window.addEventListener('load', async () => {
  // Restore API key indicator if key already in sessionStorage
  if (ApiKeyStore.has()) {
    const st = document.getElementById('api-key-status');
    if (st) { st.textContent = '\u2713 Key active (session)'; st.style.color = 'var(--clr-green)'; }
  }

  // Initialize watchlist
  WL.init();

  // Initial data fetches
  try { await refreshPaperTrading(); await _fetchDayStats(); } catch { }
  State.pnlInterval = setInterval(paperTradingLoop, 5000);

  fetchLiveTickers();
  setInterval(fetchLiveTickers, 60000);

  fetchGlobalCues();
  refreshNiftySignal();

  DOM.setText('nticker', 'Welcome to Ryugan AI — loading live Nifty 50 signal...');
});

