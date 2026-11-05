'use strict';
/* Dashboard page: scanner table + candlestick chart + strategy check / news / option-chain side panel. */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { ChartView, CHART_OVERLAYS } from './chart-view.js';
import { CHART_TF } from './timeframes.js';
import { Scanner, underlyingOf } from './scanner.js';
import { evaluate } from './strategies.js';
import { NewsFilter } from './news.js';
import { computeChainStats } from './option-chain.js';
import { executePaperTrade } from './paper-trading.js';
import { isMarketOpen } from './candles.js';
import { sessionChange } from './scan-utils.js';
import { autoOrdersFor } from './autotrade.js';

const $ = id => document.getElementById(id);
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '--' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let sel = { sym: 'NIFTY 50', tf: '15m', candles: [], news: null };
let chainExpiry = null;

/* ───────────── helpers ───────────── */
/** The current call for the shown symbol, next to the price: the scanner's 15m+5m call when there is one, else this chart's. */
function showCall(call, confidence, source) {
  const el = $('ch-call'); if (!el) return;
  if (!call) { el.innerHTML = ''; return; }
  el.innerHTML = `${callChip(call)} <span class="ch-call-conf">${confidence}%</span><span class="ch-call-src">${DOM.esc(source)}</span>`;
}

function showChange(candles) {
  const el = $('ch-chg'); if (!el) return;
  const pct = sessionChange(candles);
  el.textContent = pct == null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  el.className = 'ch-chg ' + (pct >= 0 ? 'up' : 'down');
}
const callChip = (call, big = false) => {
  const cls = call === 'BUY CE' ? 'call-ce' : call === 'BUY PE' ? 'call-pe' : 'call-wait';
  return `<span class="call-chip ${cls}${big ? ' big' : ''}">${DOM.esc(call)}</span>`;
};
const voteIcon = v => (v > 0 ? '<span class="v-up">▲</span>' : v < 0 ? '<span class="v-dn">▼</span>' : '<span class="v-nt">●</span>');

/* ───────────── scanner table ───────────── */
function renderScanTable() {
  const body = $('scan-body'); if (!body) return;
  const rows = Scanner.getUniverse().map(s => Scanner.results.get(s.toUpperCase()) || { sym: s.toUpperCase(), pending: true });
  // calls first (highest confidence), then WAIT, then failed / pending
  const rank = r => (r.pending ? 3 : !r.ok ? 2 : r.call === 'WAIT' ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || (b.confidence || 0) - (a.confidence || 0));
  body.innerHTML = rows.map(r => {
    const active = r.sym === sel.sym.toUpperCase() ? ' active' : '';
    if (r.pending) return `<tr class="scan-row${active}" data-sym="${DOM.esc(r.sym)}"><td class="sym">${DOM.esc(r.sym)}</td><td colspan="3" class="muted">waiting for first scan…</td><td></td></tr>`;
    if (!r.ok) return `<tr class="scan-row${active}" data-sym="${DOM.esc(r.sym)}"><td class="sym">${DOM.esc(r.sym)}</td><td colspan="3" class="muted" title="${DOM.esc(r.error)}">no data</td><td><button class="x" data-rm="${DOM.esc(r.sym)}" title="Remove">×</button></td></tr>`;
    const chg = r.changePct;
    const opt = r.option && !r.option.error ? `<div class="opt-line">${DOM.esc(r.option.symbol)} @ ${fmt(r.option.ltp)}</div>` : '';
    return `<tr class="scan-row${active}" data-sym="${DOM.esc(r.sym)}">
      <td class="sym">${DOM.esc(r.sym)}</td>
      <td class="num">${fmt(r.price)}</td>
      <td class="num ${chg >= 0 ? 'up' : 'down'}">${chg == null ? '--' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}</td>
      <td>${callChip(r.call)}${opt}</td>
      <td class="conf"><div class="conf-track"><div class="conf-fill ${r.call === 'BUY CE' ? 'ce' : r.call === 'BUY PE' ? 'pe' : 'wt'}" style="width:${r.confidence || 0}%"></div></div><span>${r.confidence || 0}</span><button class="x" data-rm="${DOM.esc(r.sym)}" title="Remove">×</button></td>
    </tr>`;
  }).join('');
}

function setScanStatus(e) {
  const el = $('scan-status'), top = $('top-scan');
  let text;
  if (Scanner.running) text = `Scanning… ${e?.done ?? 0}/${e?.total ?? Scanner.getUniverse().length}`;
  else {
    const last = Scanner.lastScan ? new Date(Scanner.lastScan).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '—';
    if (isMarketOpen()) {
      const s = Math.max(0, Math.round(((e?.nextAt || 0) - Date.now()) / 1000));
      text = `Next scan in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · last ${last}`;
    } else text = `Market closed · last scan ${last} · auto-scan resumes 09:20 IST (Mon–Fri)`;
  }
  if (el) el.textContent = text;
  if (top) top.textContent = Scanner.running ? 'Scanning…' : isMarketOpen() ? text.split(' · ')[0] : 'Market closed';
  const bar = $('scan-bar');
  if (bar) bar.style.width = Scanner.running && e?.total ? `${(e.done / e.total) * 100}%` : '0%';
}

/* ───────────── strategy check pane ───────────── */
function renderStrategyPane() {
  const el = $('side-sc'); if (!el) return;
  const tf = CHART_TF.find(x => x.key === sel.tf) || CHART_TF[2];
  const scan = Scanner.results.get(sel.sym.toUpperCase());
  const vis = ChartView.visible();                         // in replay mode: only the candles shown so far
  const chart = vis.length >= 60 ? evaluate(vis, { intraday: tf.intraday, news: sel.news?.headlines?.length ? sel.news.sentiment : null }) : null;
  ChartView.setLevels(chart?.ok && chart.call !== 'WAIT' ? chart.levels : null);
  if (scan?.ok && !ChartView.replaying) showCall(scan.call, scan.confidence, '15m + 5m');
  else if (chart?.ok) showCall(chart.call, chart.confidence, tf.label + (ChartView.replaying ? ' · replay' : ''));
  else showCall(null);
  ChartView.setAutoMarks(autoOrdersFor(sel.sym));

  let html = `<div class="sc-head"><div class="sc-sym">${DOM.esc(sel.sym)}</div></div>`;
  if (scan?.ok && !ChartView.replaying) {       // the scanner call is about NOW; hide it while replaying the past
    html += `<div class="sc-block"><div class="sc-label">Scanner call · 15m confirmed by 5m</div>
      <div class="sc-callrow">${callChip(scan.call, true)}<span class="sc-conf">${scan.confidence}% confidence</span></div>
      <div class="sc-note">${DOM.esc(scan.note || '')}</div>`;
    if (scan.option) html += scan.option.error
      ? `<div class="sc-opt warn">Option: ${DOM.esc(scan.option.error)}</div>`
      : `<div class="sc-opt"><b>${DOM.esc(scan.option.symbol)}</b><span>ATM ${scan.option.type} · strike ${fmt(scan.option.strike, 0)} · LTP ${fmt(scan.option.ltp)}</span></div>`;
    html += '</div>';
  }
  if (chart?.ok) {
    html += `<div class="sc-block"><div class="sc-label">This chart · ${tf.label}</div>
      <div class="sc-callrow">${callChip(chart.call, true)}<span class="sc-conf">${chart.confidence}% · score ${chart.score > 0 ? '+' : ''}${chart.score} of ±${chart.maxScore} · ADX ${chart.adx.toFixed(0)}</span></div>
      ${chart.reason ? `<div class="sc-note">${DOM.esc(chart.reason)}</div>` : ''}
      <table class="vote-table"><thead><tr><th></th><th>Strategy</th><th>Why</th></tr></thead><tbody>
      ${chart.votes.map(v => `<tr><td>${voteIcon(v.vote)}</td><td class="nm">${DOM.esc(v.name)}<small>×${v.weight}</small></td><td class="why">${DOM.esc(v.reason)}</td></tr>`).join('')}
      </tbody></table>
      <div class="lvl-strip">
        <div><span>Entry</span><b>${fmt(chart.levels.entry)}</b></div>
        <div><span>Stop</span><b class="down">${fmt(chart.levels.sl)}</b></div>
        <div><span>Target 1</span><b class="up">${fmt(chart.levels.t1)}</b></div>
        <div><span>Target 2</span><b class="up">${fmt(chart.levels.t2)}</b></div>
      </div>
      ${chart.call !== 'WAIT' ? `<button class="btn btn-primary btn-sm full" id="sc-paper">Paper trade the underlying (${chart.call === 'BUY CE' ? 'LONG' : 'SHORT'})</button>` : ''}
      </div>`;
  } else if (!scan?.ok) {
    html += `<div class="empty-state">${chart === null ? 'Loading candles…' : DOM.esc(chart.reason || 'Not enough data')}</div>`;
  }
  if (ChartView.replaying) html = `<div class="rp-note">Replay mode: this check uses only the candles up to the replay bar.</div>` + html;
  html += '<div class="unproven">Calls come from standard indicator rules. Backtest of these exact rules on 15 symbols over 2 years of 15-minute data (about 14,000 trades, costs and slippage included): average -5.6 bps per trade, profit factor 0.79, i.e. they lost money, in every quarter. Use them as a checklist, not as buy/sell advice, and test in Paper Trading first.</div>';
  el.innerHTML = html;
  $('sc-paper')?.addEventListener('click', () => {
    executePaperTrade(sel.sym, chart.call === 'BUY CE' ? 'LONG' : 'SHORT', chart.levels.entry.toFixed(2), chart.levels.sl.toFixed(2), chart.levels.t1.toFixed(2));
  });
}

/* ───────────── news pane ───────────── */
async function loadNews() {
  const el = $('side-news'); if (!el) return;
  el.innerHTML = '<div class="empty-state"><span class="spinr"></span> Loading headlines…</div>';
  const key = underlyingOf(sel.sym).news;
  const entry = await NewsFilter.fetch(key);
  if (underlyingOf(sel.sym).news !== key) return;      // user moved on
  sel.news = entry;
  el.innerHTML = `<div class="news-panel-head">${NewsFilter.sentimentBadgeHtml(entry.sentiment)}<span class="muted">${entry.sentiment.bull} bullish · ${entry.sentiment.bear} bearish of ${entry.sentiment.total} headlines</span></div><div id="dash-news-feed" class="news-feed-block"></div>`;
  NewsFilter.renderFeed(entry.headlines, entry.sentiment, 'dash-news-feed');
  renderStrategyPane();                                  // news is one of the votes
}

/* ───────────── option chain pane ───────────── */
async function loadChain() {
  const el = $('side-oc'); if (!el) return;
  const u = underlyingOf(sel.sym).chain;
  if (!u) { el.innerHTML = `<div class="empty-state">No NSE option chain for ${DOM.esc(sel.sym)} (Sensex options trade on BSE).</div>`; return; }
  el.innerHTML = '<div class="empty-state"><span class="spinr"></span> Loading option chain…</div>';
  try {
    let url = `${CONFIG.PROXY_BASE || ''}/api/fo/option-chain?underlying=${encodeURIComponent(u)}&strikes=8`;
    if (chainExpiry) url += `&expiry=${encodeURIComponent(chainExpiry)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      el.innerHTML = `<div class="empty-state">${DOM.esc(err.detail || `Option chain unavailable (${res.status})`)}</div>`; return;
    }
    renderChain(el, await res.json());
  } catch { el.innerHTML = '<div class="empty-state">Could not reach the backend for the option chain.</div>'; }
}

function renderChain(el, d) {
  const rows = d.rows || [];
  if (!rows.length) { el.innerHTML = '<div class="empty-state">No strikes returned.</div>'; return; }
  const st = computeChainStats(rows);
  const maxOi = Math.max(1, ...rows.flatMap(r => [r.ce?.oi || 0, r.pe?.oi || 0]));
  const step = rows.length > 1 ? Math.abs(rows[1].strike - rows[0].strike) : 50;
  const sug = Scanner.results.get(sel.sym.toUpperCase())?.option;
  const pcrView = !st ? '' : st.pcr > 1.2 ? 'puts heavy: bullish lean' : st.pcr < 0.8 ? 'calls heavy: bearish lean' : 'balanced';
  const oi = (leg, cls) => `<td class="oi ${cls}"><i style="width:${Math.round(((leg?.oi || 0) / maxOi) * 100)}%"></i><span>${leg?.oi ? Math.round(leg.oi / 1000).toLocaleString('en-IN') + 'k' : '--'}</span></td>`;
  el.innerHTML = `
    <div class="oc-head">
      <div><b>${DOM.esc(d.underlying)}</b> <span class="muted">spot ${fmt(d.spot)}</span></div>
      <select id="oc-exp" class="mini-select">${(d.expiries || [d.expiry]).map(e => `<option${e === d.expiry ? ' selected' : ''}>${e}</option>`).join('')}</select>
    </div>
    ${st ? `<div class="oc-stats"><div><span>PCR</span><b>${st.pcr.toFixed(2)}</b></div><div><span>Max pain</span><b>${fmt(st.maxPain, 0)}</b></div><div class="grow"><span>Read</span><b>${pcrView}</b></div></div>` : ''}
    <table class="oc-table"><thead><tr><th colspan="2" class="ce-h">CALLS</th><th></th><th colspan="2" class="pe-h">PUTS</th></tr>
    <tr><th>OI</th><th>LTP</th><th>Strike</th><th>LTP</th><th>OI</th></tr></thead><tbody>
    ${rows.map(r => {
      const atm = d.spot != null && Math.abs(r.strike - d.spot) < step / 2;
      const ceItm = d.spot != null && r.strike < d.spot, peItm = d.spot != null && r.strike > d.spot;
      const pickCe = sug && !sug.error && sug.type === 'CE' && sug.strike === r.strike, pickPe = sug && !sug.error && sug.type === 'PE' && sug.strike === r.strike;
      return `<tr class="${atm ? 'atm' : ''}">${oi(r.ce, 'ce')}
        <td class="ltp ${ceItm ? 'itm' : ''} ${pickCe ? 'pick' : ''}">${r.ce?.ltp ?? '--'}</td>
        <td class="strike">${fmt(r.strike, 0)}</td>
        <td class="ltp ${peItm ? 'itm' : ''} ${pickPe ? 'pick' : ''}">${r.pe?.ltp ?? '--'}</td>${oi(r.pe, 'pe')}</tr>`;
    }).join('')}
    </tbody></table>
    <div class="muted small">Shaded LTP = in the money · outlined = the scanner's suggested contract · bars = open interest</div>`;
  $('oc-exp')?.addEventListener('change', e => { chainExpiry = e.target.value; loadChain(); });
}

/* ───────────── selection / wiring ───────────── */
export async function selectSymbol(sym, tf) {
  sel.sym = (sym || 'NIFTY 50').trim();
  if (tf) sel.tf = tf;
  sel.candles = []; sel.news = null; chainExpiry = null;
  ChartView.reset(sel.sym);                      // clear the old symbol's chart, levels and gap lines straight away
  DOM.setText('ch-price', '--'); DOM.setText('ch-chg', ''); DOM.setText('ch-sub', 'Loading…');
  DOM.setText('ch-title', sel.sym.toUpperCase());
  document.querySelectorAll('#ch-tf button').forEach(b => b.classList.toggle('active', b.dataset.tf === sel.tf));
  renderScanTable(); renderStrategyPane();
  loadNews();
  loadChain();
  const n = await ChartView.load(sel.sym, sel.tf);
  if (n === 0) DOM.setText('ch-sub', 'No candles for this symbol / timeframe');
}

export function initDash() {
  if (!$('tab-dash')) return;
  // timeframe buttons
  $('ch-tf').innerHTML = CHART_TF.map(t => `<button data-tf="${t.key}" class="${t.key === sel.tf ? 'active' : ''}">${t.label}</button>`).join('');
  $('ch-tf').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectSymbol(sel.sym, b.dataset.tf); });
  // overlay toggles
  const saved = (() => { try { return JSON.parse(store.get('ryugan_overlays') || '{}'); } catch { return {}; } })();
  $('ch-ovl').innerHTML = CHART_OVERLAYS.map(o => {
    const on = saved[o.id] ?? o.on;
    return `<label class="chip-toggle"><input type="checkbox" data-ov="${o.id}"${on ? ' checked' : ''}><span>${o.label}</span></label>`;
  }).join('');
  const ok = ChartView.init($('ch-main'), $('ch-rsi'), (candles, tf, sym) => {
    sel.candles = candles;
    const last = candles[candles.length - 1];
    DOM.setText('ch-sub', last ? `${candles.length} candles · ${tf.label}` : '');
    if (last) DOM.setText('ch-price', fmt(last.c));
    showChange(candles);
    renderStrategyPane();
  });
  // replay controls
  const rp = id => $(id);
  const fmtTime = c => c ? new Date(c.ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  ChartView.onReplay(r => {
    rp('rp-bar').style.display = r.on ? '' : 'none';
    rp('rp-toggle').classList.toggle('active', r.on);
    rp('rp-toggle').textContent = r.on ? '⏹ Stop replay' : '⏵ Replay';
    if (r.on) {
      rp('rp-slider').min = 60; rp('rp-slider').max = Math.max(60, r.total - 1); rp('rp-slider').value = r.idx;
      rp('rp-play').textContent = r.playing ? '⏸' : '▶';
      rp('rp-label').textContent = `bar ${r.idx + 1}/${r.total} · ${fmtTime(r.candle)} IST`;
      if (r.candle) DOM.setText('ch-price', fmt(r.candle.c));
    } else {
      const last = sel.candles[sel.candles.length - 1];
      if (last) DOM.setText('ch-price', fmt(last.c));
    }
    renderStrategyPane();
  });
  const toggleReplay = () => {
    if (ChartView.replaying) ChartView.stopReplay();
    else if (!ChartView.startReplay()) DOM.setText('ch-sub', 'Not enough candles to replay (need 60+). Pick a longer timeframe or range.');
  };
  rp('rp-toggle').addEventListener('click', toggleReplay);
  rp('rp-exit').addEventListener('click', () => ChartView.stopReplay());
  rp('rp-play').addEventListener('click', () => ChartView.playReplay(rp('rp-play').textContent !== '⏸'));
  rp('rp-fwd').addEventListener('click', () => { ChartView.playReplay(false); ChartView.stepReplay(1); });
  rp('rp-back').addEventListener('click', () => { ChartView.playReplay(false); ChartView.stepReplay(-1); });
  rp('rp-speed').addEventListener('change', e => ChartView.setReplaySpeed(+e.target.value));
  rp('rp-slider').addEventListener('input', e => { const i = +e.target.value; ChartView.playReplay(false); ChartView.setReplayIdx(i); });   // read first: pausing re-syncs the slider
  document.addEventListener('keydown', e => {
    if (!ChartView.replaying || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range') return;
    if (e.key === 'ArrowRight') { ChartView.playReplay(false); ChartView.stepReplay(1); }
    else if (e.key === 'ArrowLeft') { ChartView.playReplay(false); ChartView.stepReplay(-1); }
    else if (e.key === ' ') { e.preventDefault(); rp('rp-play').click(); }
  });
  CHART_OVERLAYS.forEach(o => ChartView.setOverlay && ok && (saved[o.id] !== undefined) && ChartView.setOverlay(o.id, saved[o.id]));
  $('ch-ovl').addEventListener('change', e => {
    const id = e.target.dataset.ov; if (!id) return;
    saved[id] = e.target.checked; store.set('ryugan_overlays', JSON.stringify(saved));
    ChartView.setOverlay(id, e.target.checked);
  });
  $('ch-fit').addEventListener('click', () => ChartView.fit());
  // chart full view (Esc exits)
  const panel = $('dash-chart'), fullBtn = $('ch-full');
  const setFull = on => {
    panel.classList.toggle('full', on); document.body.classList.toggle('chart-full-open', on);
    fullBtn.textContent = on ? '✕ Exit full view' : '⛶ Full view';
    for (const ms of [0, 80, 300]) setTimeout(() => ChartView.resize(), ms);   // refit once the new layout has settled
  };
  fullBtn.addEventListener('click', () => setFull(!panel.classList.contains('full')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('full')) setFull(false); });
  // scanner table
  $('scan-body').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); Scanner.removeSymbol(rm.dataset.rm); return; }
    const tr = e.target.closest('tr[data-sym]'); if (tr) selectSymbol(tr.dataset.sym);
  });
  $('scan-now').addEventListener('click', () => Scanner.run('manual'));
  $('scan-add').addEventListener('submit', e => { e.preventDefault(); const i = $('scan-add-input'); if (i.value.trim()) { Scanner.addSymbol(i.value); i.value = ''; Scanner.run('manual'); } });
  const snd = $('scan-sound'); snd.checked = Scanner.soundOn(); snd.addEventListener('change', () => Scanner.setSound(snd.checked));
  // topbar symbol search
  const search = $('top-search');
  search?.addEventListener('keydown', e => { if (e.key === 'Enter' && search.value.trim()) { window.switchTab('dash'); selectSymbol(search.value); search.blur(); } });
  search?.addEventListener('change', () => { if (search.value.trim()) { window.switchTab('dash'); selectSymbol(search.value); } });

  Scanner.on(e => {
    if (e.type === 'tick') setScanStatus(e);
    else if (e.type === 'start' || e.type === 'progress') { setScanStatus(e); if (e.type === 'progress') renderScanTable(); }
    else if (e.type === 'done') {
      setScanStatus(); renderScanTable(); renderStrategyPane();
      loadChain();
    } else if (e.type === 'universe') renderScanTable();
    else if (e.type === 'signal') {
      const r = e.result, el = $('toast');
      if (el) { el.innerHTML = `${callChip(r.call)} <b>${DOM.esc(r.sym)}</b> · ${r.confidence}% confidence`; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 6000); }
    }
  });
  window.addEventListener('autotrade:update', () => ChartView.setAutoMarks(autoOrdersFor(sel.sym)));
  renderScanTable();
  selectSymbol(sel.sym);
  Scanner.start();
}

export function onThemeChange() { ChartView.applyTheme(); }
