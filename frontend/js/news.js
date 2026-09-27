'use strict';

import { CONFIG } from './config.js';

export let _niftyLastNewsSym = 'NIFTY';
export function setNiftyLastNewsSym(s) { _niftyLastNewsSym = s; }

export const NewsFilter = (() => {
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
export function applyNewsSentiment(data, newsEntry) {
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
