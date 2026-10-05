'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { State } from './state.js';
import { getPrice, yahooFetch, fetchGlobalCues, updateVIX, _SYM_MAP } from './market-data.js';
import { Indicators } from './indicators.js';
import { NewsFilter, applyNewsSentiment, setNiftyLastNewsSym } from './news.js';
import { callClaude, extractJson } from './ai.js';
import { showOv, hideOv } from './app.js';
import { SIGNAL_TF } from './timeframes.js';

/* ═══════════════════════════════════════════
   MODULE: ALGORITHMIC ENGINE (no API key needed)
   Computes real signals from Yahoo Finance data
═══════════════════════════════════════════ */
export async function algoFallback(prompt) {
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

export async function algoMorningBrief() {
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

// F&O indices with a directly usable Yahoo Finance spot ticker.
const _FO_INDEX_YAHOO = {
  NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', SENSEX: '^BSESN',
};
// Indices that exist in NSE's F&O universe but have no reliable free Yahoo
// spot ticker — flagged explicitly rather than silently approximated with
// the wrong index's price, which would be misleading in a trading tool.
const _FO_INDEX_NO_SPOT = new Set(['FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'BANKEX', 'SENSEX50', 'NIFTYFPI']);

function _resolveFOSpotSymbol(name) {
  const key = (name || '').replace(/\s+/g, '').toUpperCase();
  if (_FO_INDEX_YAHOO[key]) return _FO_INDEX_YAHOO[key];
  if (_FO_INDEX_NO_SPOT.has(key)) return null;
  if (_SYM_MAP[name?.toUpperCase()]) return _SYM_MAP[name.toUpperCase()];
  // Treat anything else as an F&O stock underlying (bare NSE symbol, e.g. "RELIANCE").
  return key + '.NS';
}

function _foStrikeStep(name, spot) {
  const key = (name || '').replace(/\s+/g, '').toUpperCase();
  const known = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };
  if (known[key]) return known[key];
  if (spot > 5000) return 100;
  if (spot > 2000) return 50;
  if (spot > 500) return 20;
  if (spot > 100) return 10;
  return 5;
}

export async function algoFO(prompt) {
  const m = prompt.match(/Analyze F&O options data for\s+(.+?)\s+on NSE/i);
  const rawSym = (m ? m[1] : 'NIFTY').trim();
  const ySym = _resolveFOSpotSymbol(rawSym);
  const nf = ySym ? await getPrice(ySym) : null;

  if (!nf?.c) {
    return JSON.stringify({
      pcr: 'N/A', pcr_signal: 'neutral',
      max_pain: 'N/A', max_pain_note: `Spot price unavailable for ${rawSym}.`,
      iv: 'N/A', iv_state: 'normal', iv_strategy: 'N/A',
      oi_interpretation: `Could not fetch a live spot price for "${rawSym}" via the free data feed. Try a major index (NIFTY, BANKNIFTY, SENSEX) or an F&O stock by its NSE symbol (e.g. RELIANCE, TCS, HDFCBANK).`,
      greeks: [], oi_levels: [],
      recommendation: `No data available for ${rawSym}.`
    });
  }

  const spot = nf.c;
  const step = _foStrikeStep(rawSym, spot);
  const atm = Math.round(spot / step) * step;
  return JSON.stringify({
    pcr: 'N/A', pcr_signal: (nf.diff >= 0) ? 'bullish' : 'bearish',
    max_pain: atm.toString(), max_pain_note: `ATM Strike (live calc) — ${rawSym}`,
    iv: 'Live', iv_state: 'normal', iv_strategy: (nf.diff >= 0) ? 'Bull Spreads' : 'Bear Spreads',
    oi_interpretation: `Add API key for full OI analysis. Showing ATM approximation for ${rawSym}.`,
    greeks: [
      { strike: atm.toString(), type: 'CE', delta: '0.50', gamma: '0.02', theta: '-10', vega: '8', oi_chg: '+2%' },
      { strike: atm.toString(), type: 'PE', delta: '-0.50', gamma: '0.02', theta: '-10', vega: '8', oi_chg: '+2%' }
    ],
    oi_levels: [
      { strike: (atm + step * 4).toString(), type: 'CE', oi: 'Highest CE', note: 'Resistance' },
      { strike: (atm - step * 4).toString(), type: 'PE', oi: 'Highest PE', note: 'Support' }
    ],
    recommendation: (nf.diff >= 0) ? `Bullish setup, ${rawSym} spot ${spot.toFixed(2)}` : `Bearish setup, ${rawSym} spot ${spot.toFixed(2)}`
  });
}

export async function algoSectors() {
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

export async function algoGlobal() {
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

export async function algoSignal(prompt) {
  let sym = 'NIFTY 50';
  const m1 = prompt.match(/Analyze\s+([\w\s]+?)\s+for\s+(?:intraday|swing)/i);
  const m2 = prompt.match(/Search for current\s+([\w\s]+?)\s+price/i);
  if (m1) sym = m1[1].trim();
  else if (m2) sym = m2[1].trim();

  // Timeframe is encoded in the prompt as "(<segment>, <tf> timeframe)"; default 15min.
  const tfMatch = prompt.match(/\(\w+,\s*(\w+)\s+timeframe\)/i);
  const tfCfg = SIGNAL_TF[tfMatch?.[1]?.toLowerCase()] || SIGNAL_TF['15min'];

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
    const js = await yahooFetch(ys, tfCfg.interval, tfCfg.range);
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
    // Swing timeframes report change vs the previous candle (week/month/year), not vs range start.
    const prev = (tfCfg.swing && closes.length > 1)
      ? closes[closes.length - 2]
      : (r.meta.chartPreviousClose || closes[0]);
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
      basis: `Algorithmic TA (${tfCfg.label}) — RSI/EMA/VWAP/BB`,
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
   MODULE: TAB 1 — NIFTY LIVE SIGNAL
═══════════════════════════════════════════ */
export async function refreshNiftySignal(sym = 'NIFTY 50') {

  const btn = document.getElementById('niftyRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  DOM.setText('sh-sym-label', sym);
  DOM.setHtml('nifty-signal-badge', '<div class="signal-badge badge-hold"><span class="spinr"></span> ANALYZING...</div>');

  // Fetch news + global cues in parallel with the signal (shares 15-min cache)
  setNiftyLastNewsSym(sym);

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

export function setIndTile(id, val) {
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

export function updateTicker(text) {
  DOM.setText('nticker', text);
}

/* ═══════════════════════════════════════════
   MODULE: TAB 2 — SIGNAL ENGINE
═══════════════════════════════════════════ */
export function qs(s) {
  const el = document.getElementById('sym-input');
  if (el) el.value = s;
}

export async function generateSignal() {
  const sym = (document.getElementById('sym-input')?.value || '').trim();
  const seg = document.getElementById('seg-select')?.value || 'equity';
  const tf = document.getElementById('tf-select')?.value || '15min';
  if (!sym) { alert('Enter a symbol'); return; }

  showOv(`SCANNING ${sym.toUpperCase()}...`);
  try {
    const style = SIGNAL_TF[tf]?.swing ? 'swing' : 'intraday';
    const prompt = `Analyze ${sym} for ${style} trading on NSE/BSE Indian markets (${seg}, ${tf} timeframe).
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

export function parseFallback(txt, sym) {
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

export function renderSigCard(d, newsEntry) {
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

export function addRecentSignal(d) {
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
export async function generateMorningBrief() {
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
export async function analyzeFO() {
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
export async function loadSectors() {
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
