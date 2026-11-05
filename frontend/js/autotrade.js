'use strict';
/* Auto paper-trading panel (Paper Trading page) and the status pill on the dashboard.
 * All the work happens on the server (backend/autotrader.py); this file only shows state and sends the on/off switch. */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';

const $ = id => document.getElementById(id);
const base = () => CONFIG.PROXY_BASE || '';
let timer = null;
let lastLog = [];

const rupees = v => '₹' + Math.round(v).toLocaleString('en-IN');
const when = iso => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

async function api(path, opts) {
  const res = await fetch(base() + path, { cache: 'no-store', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
  return body;
}

function actionChip(a) {
  const cls = a === 'ORDER' ? 'ok' : a === 'WOULD ORDER' ? 'info' : a === 'ERROR' ? 'bad' : 'skip';
  return `<span class="at-chip ${cls}">${DOM.esc(a)}</span>`;
}

function renderLog(rows) {
  const tb = $('at-log-body'); if (!tb) return;
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="5" class="empty-cell">No decisions yet. The server scans every 5 minutes during market hours.</td></tr>'; return; }
  tb.innerHTML = rows.slice(0, 30).map(r => `<tr>
    <td class="mono">${when(r.ts)}</td><td><b>${DOM.esc(r.symbol)}</b></td>
    <td><span class="call-chip ${r.call === 'BUY CE' ? 'call-ce' : r.call === 'BUY PE' ? 'call-pe' : 'call-wait'}">${DOM.esc(r.call)}</span> <span class="muted">${r.confidence}%</span></td>
    <td>${actionChip(r.action)}</td><td class="at-detail">${DOM.esc(r.detail || '')}</td></tr>`).join('');
}

export async function refreshAutoTrade() {
  let s;
  try { s = await api('/api/autotrade/status'); } catch (e) { setStatusText('Auto-trading unavailable: ' + e.message); return; }
  const on = !!s.enabled;
  document.querySelectorAll('.at-toggle').forEach(el => { el.checked = on; });
  const open = s.market_open ? 'market open' : 'market closed';
  const next = s.state?.next_run ? ` · next scan ${when(s.state.next_run * 1000)}` : '';
  setStatusText(`${on ? 'ON' : 'OFF'} · ${open}${on && s.market_open ? next : ''}${s.state?.running ? ' · scanning…' : ''}`, on);
  DOM.setText('at-open', String(s.open_auto_positions));
  DOM.setText('at-closed', String(s.closed_auto_trades));
  const pnl = $('at-pnl'); if (pnl) { pnl.textContent = rupees(s.closed_auto_net_pnl); pnl.style.color = s.closed_auto_net_pnl >= 0 ? 'var(--green)' : 'var(--down)'; }
  const st = s.settings;
  DOM.setText('at-rules', `Buys the ATM option when confidence ≥ ${st.min_confidence}% · max ${st.max_positions} auto positions · one per stock · stop −${Math.round(st.sl_pct * 100)}% / target +${Math.round(st.tp_pct * 100)}% of the premium · entries 09:30–14:30 IST · no end-of-day square-off (stays open until the stop or target is hit)`);
  lastLog = s.log || [];
  renderLog(lastLog);
  document.querySelectorAll('.at-state').forEach(el => { el.textContent = on ? 'ON' : 'OFF'; el.classList.toggle('on', on); });
  window.dispatchEvent(new CustomEvent('autotrade:update'));
}

function setStatusText(t, on) {
  DOM.setText('at-status', t);
  const el = $('at-status'); if (el) el.style.color = on ? 'var(--green)' : 'var(--text3)';
}

async function toggle(on) {
  if (on && !confirm('Turn on auto paper-trading?\n\nThe server will place VIRTUAL option orders from the scanner\'s strongest calls, with the limits shown on this page. No broker is involved.\n\nBacktests of these rules lost money, so treat this as a forward test.')) {
    document.querySelectorAll('.at-toggle').forEach(el => { el.checked = false; }); return;
  }
  try { await api('/api/autotrade/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }) }); }
  catch (e) { alert('Could not change the setting: ' + e.message); }
  refreshAutoTrade();
}

async function preview() {
  const btn = $('at-preview'), out = $('at-preview-out');
  btn.disabled = true; out.innerHTML = '<span class="spinr"></span> Scanning the universe (about 15 seconds)…';
  try {
    const d = await api('/api/autotrade/run?dry=true&as_if_open=true', { method: 'POST' });
    const rows = d.decisions.filter(r => r.call !== 'WAIT');
    out.innerHTML = rows.length
      ? `<div class="muted small" style="margin-bottom:6px">Preview only, nothing was ordered. Shown as if it were 10:00 IST on a trading day.</div><table class="dtbl"><thead><tr><th>Symbol</th><th>Call</th><th>Conf</th><th>Result</th><th>Detail</th></tr></thead><tbody>` +
        rows.map(r => `<tr><td><b>${DOM.esc(r.symbol)}</b></td><td>${DOM.esc(r.call)}</td><td>${r.confidence}%</td><td>${actionChip(r.action)}</td><td class="at-detail">${DOM.esc(r.detail || '')}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="muted">No BUY CE / BUY PE calls right now.</div>';
  } catch (e) { out.textContent = 'Preview failed: ' + e.message; }
  btn.disabled = false;
}

export function initAutoTrade() {
  document.querySelectorAll('.at-toggle').forEach(el => el.addEventListener('change', e => toggle(e.target.checked)));
  $('at-preview')?.addEventListener('click', preview);
  refreshAutoTrade();
  if (!timer) timer = setInterval(() => { if (!document.hidden) refreshAutoTrade(); }, 20000);
}

/** Auto-trader orders for one symbol, as chart markers: [{ts (ms of the signal candle), call}]. */
export function autoOrdersFor(symbol) {
  const key = symbol.toUpperCase();
  return lastLog.filter(r => r.action === 'ORDER' && r.symbol.toUpperCase() === key && r.candle_ts)
    .map(r => ({ ts: Number(r.candle_ts), call: r.call }));
}
