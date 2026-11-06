'use strict';
/* Auto paper-trading panel (Paper Trading page) and the on/off switches on the dashboard and top bar.
 * All the work happens on the server (backend/autotrader.py); this file shows state, sends the switch and edits Settings. */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';

const $ = id => document.getElementById(id);
const base = () => CONFIG.PROXY_BASE || '';
let timer = null;
let lastOrders = [];
let settingsRows = [];          // rows shown in the Settings table, as sent by the server (plus local edits)
let settingsLoaded = false;

const rupees = v => '₹' + Math.round(v).toLocaleString('en-IN');
const clock = ms => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
const pct = v => Math.round(v * 100);

async function api(path, opts) {
  const res = await fetch(base() + path, { cache: 'no-store', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(body.detail) ? body.detail.map(d => d.msg).join('; ') : (body.detail || `HTTP ${res.status}`));
  return body;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function actionChip(a) {
  const cls = a === 'ORDER' ? 'ok' : a === 'WOULD ORDER' ? 'info' : a === 'ERROR' ? 'bad' : 'skip';
  return `<span class="at-chip ${cls}">${DOM.esc(a)}</span>`;
}
const callChip = c => `<span class="call-chip ${c === 'BUY CE' ? 'call-ce' : c === 'BUY PE' ? 'call-pe' : 'call-wait'}">${DOM.esc(c)}</span>`;

/** The latest scan only: one row per symbol the server looked at, strongest calls first. */
function renderScan(scan) {
  const tb = $('at-log-body'); if (!tb) return;
  DOM.setText('at-scan-time', scan?.at ? `Scanned ${clock(scan.at * 1000)} IST · ${scan.rows.length} symbols` : 'No scan yet');
  if (!scan?.rows?.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-cell">No scan yet. The server scans every 5 minutes while the market is open.</td></tr>'; return; }
  const rows = [...scan.rows].sort((a, b) => (a.call === 'WAIT') - (b.call === 'WAIT') || (b.confidence || 0) - (a.confidence || 0));
  tb.innerHTML = rows.map(r => `<tr>
    <td><b>${DOM.esc(r.symbol)}</b></td>
    <td>${callChip(r.call)} <span class="muted">${r.confidence ?? 0}%</span></td>
    <td class="mono muted">${r.score == null ? '' : `${r.score > 0 ? '+' : ''}${r.score}/${r.max_score}`}${r.adx == null ? '' : ` · ADX ${Math.round(r.adx)}`}</td>
    <td>${actionChip(r.action)}</td><td class="at-detail">${DOM.esc(r.detail || '')}</td></tr>`).join('');
}

export async function refreshAutoTrade() {
  let s;
  try { s = await api('/api/autotrade/status'); } catch (e) { setStatusText('Auto-trading unavailable: ' + e.message); return; }
  const on = !!s.enabled;
  document.querySelectorAll('.at-toggle').forEach(el => { el.checked = on; });
  const open = s.market_open ? 'market open' : 'market closed';
  const next = s.state?.next_run ? ` · next scan ${clock(s.state.next_run * 1000)}` : '';
  setStatusText(`${on ? 'ON' : 'OFF'} · ${open}${on && s.market_open ? next : ''}${s.state?.running ? ' · scanning…' : ''}`, on);
  DOM.setText('at-open', String(s.open_auto_positions));
  DOM.setText('at-closed', String(s.closed_auto_trades));
  const pnl = $('at-pnl'); if (pnl) { pnl.textContent = rupees(s.closed_auto_net_pnl); pnl.style.color = s.closed_auto_net_pnl >= 0 ? 'var(--green)' : 'var(--down)'; }
  const st = s.settings;
  const custom = Object.keys(st.symbols || {}).length;
  DOM.setText('at-rules', `Buys the ATM option when confidence ≥ ${st.min_confidence}% · max ${st.max_trades_per_day} new trades a day · max ${st.max_positions} open · one per stock · ` +
    `default stop −${pct(st.sl_pct)}% / target +${pct(st.tp_pct)}% of the premium · Nifty ${st.nifty_qty} units · ${custom ? `${custom} stock${custom > 1 ? 's' : ''} with their own settings · ` : ''}` +
    `entries 09:30–14:30 IST · no end-of-day square-off (a trade stays open until its stop or target is hit)`);
  DOM.setText('at-today', `${s.orders_today} / ${st.max_trades_per_day}`);
  lastOrders = s.orders || [];
  renderScan(s.last_scan);
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
  try { await post('/api/autotrade/enable', { enabled: on }); }
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

/* ───────────── Settings: global limits + stop-loss / target / lots for each stock ───────────── */
const num = (id, d) => { const v = parseFloat($(id)?.value); return Number.isFinite(v) ? v : d; };

function renderSettingsRows() {
  const tb = $('as-rows'); if (!tb) return;
  tb.innerHTML = settingsRows.map((r, i) => {
    const v = r.value, off = !r.tradable;
    return `<tr data-i="${i}" class="${v.enabled ? '' : 'as-off'}">
      <td><input type="checkbox" class="as-en" ${v.enabled && !off ? 'checked' : ''} ${off ? 'disabled' : ''} title="Auto-trade this stock"></td>
      <td><b>${DOM.esc(r.symbol)}</b>${off ? '<div class="muted small">no NSE options</div>' : ''}</td>
      <td><input type="number" class="as-sl" min="5" max="90" step="1" value="${pct(v.sl_pct)}" ${off ? 'disabled' : ''}></td>
      <td><input type="number" class="as-tp" min="5" max="300" step="1" value="${pct(v.tp_pct)}" ${off ? 'disabled' : ''}></td>
      <td><input type="number" class="as-lots" min="1" max="100" step="1" value="${v.lots}" ${off ? 'disabled' : ''}></td>
      <td><input type="number" class="as-day" min="1" max="50" step="1" value="${v.max_per_day}" ${off ? 'disabled' : ''} title="${r.underlying === 'NIFTY' ? 'Nifty: one position at a time' : 'Orders per day for this stock'}"></td>
      <td><select class="as-prod" ${off ? 'disabled' : ''}><option value="CARRYFORWARD" ${v.product === 'CARRYFORWARD' ? 'selected' : ''}>NRML</option><option value="INTRADAY" ${v.product === 'INTRADAY' ? 'selected' : ''}>MIS</option></select></td>
      <td class="mono muted as-units">${r.lot_size ? `${v.lots * r.lot_size} units (lot ${r.lot_size})` : ''}</td>
      <td><button type="button" class="x as-del" title="Remove from the auto-trade list">×</button></td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-cell">No stocks. Add one below.</td></tr>';
}

function readRows() {
  document.querySelectorAll('#as-rows tr[data-i]').forEach(tr => {
    const r = settingsRows[+tr.dataset.i]; if (!r) return;
    r.value = {
      enabled: tr.querySelector('.as-en').checked,
      sl_pct: (parseFloat(tr.querySelector('.as-sl').value) || pct(r.value.sl_pct)) / 100,
      tp_pct: (parseFloat(tr.querySelector('.as-tp').value) || pct(r.value.tp_pct)) / 100,
      lots: Math.max(1, parseInt(tr.querySelector('.as-lots').value) || r.value.lots),
      max_per_day: Math.max(1, parseInt(tr.querySelector('.as-day').value) || r.value.max_per_day),
      product: tr.querySelector('.as-prod').value,
    };
  });
}

function applySettingsView(d) {
  const s = d.settings;
  $('as-conf').value = s.min_confidence; $('as-maxpos').value = s.max_positions; $('as-maxday').value = s.max_trades_per_day;
  $('as-sl').value = pct(s.sl_pct); $('as-tp').value = pct(s.tp_pct); $('as-lots').value = s.lots;
  $('as-nifty-day').value = s.nifty_max_per_day; $('as-stock-day').value = s.stock_max_per_day; $('as-product').value = s.product;
  settingsRows = d.symbols.map(r => ({ ...r, value: { ...r.value } }));
  renderSettingsRows();
}

async function openSettings() {
  const panel = $('at-settings'); if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  $('at-settings-btn').textContent = show ? '⚙ Hide settings' : '⚙ Settings';
  if (show && !settingsLoaded) {
    try { applySettingsView(await api('/api/autotrade/settings')); settingsLoaded = true; }
    catch (e) { $('as-msg').textContent = 'Could not load settings: ' + e.message; }
  }
}

async function saveSettings() {
  readRows();
  const msg = $('as-msg'); msg.style.color = 'var(--text3)'; msg.textContent = 'Saving…';
  const g = { sl: num('as-sl', 30) / 100, tp: num('as-tp', 30) / 100, lots: Math.max(1, Math.round(num('as-lots', 1))),
    nifty: Math.max(1, Math.round(num('as-nifty-day', 10))), stock: Math.max(1, Math.round(num('as-stock-day', 1))), product: $('as-product').value };
  // send a symbol override only where it differs from what that symbol would get anyway
  const symbols = {};
  for (const r of settingsRows) {
    if (!r.underlying) continue;
    const ov = {}, v = r.value;
    if (Math.abs(v.sl_pct - g.sl) > 1e-9) ov.sl_pct = v.sl_pct;
    if (Math.abs(v.tp_pct - g.tp) > 1e-9) ov.tp_pct = v.tp_pct;
    const defLots = r.underlying === 'NIFTY' ? r.default.lots : g.lots;
    if (v.lots !== defLots) ov.lots = v.lots;
    if (v.max_per_day !== (r.underlying === 'NIFTY' ? g.nifty : g.stock)) ov.max_per_day = v.max_per_day;
    if (v.product !== g.product) ov.product = v.product;
    if (!v.enabled) ov.enabled = false;
    if (Object.keys(ov).length) symbols[r.underlying] = ov;
  }
  try {
    const d = await post('/api/autotrade/settings', {
      min_confidence: Math.round(num('as-conf', 85)), max_positions: Math.round(num('as-maxpos', 5)), max_trades_per_day: Math.round(num('as-maxday', 5)),
      sl_pct: g.sl, tp_pct: g.tp, lots: g.lots, nifty_max_per_day: g.nifty, stock_max_per_day: g.stock, product: g.product,
      universe: settingsRows.map(r => r.symbol), symbols,
    });
    applySettingsView(d);
    msg.style.color = 'var(--green)'; msg.textContent = 'Saved. New orders use these settings; open positions keep the levels they were opened with.';
    refreshAutoTrade();
  } catch (e) { msg.style.color = 'var(--down)'; msg.textContent = 'Not saved: ' + e.message; }
}

async function resetSettings() {
  if (!confirm('Reset every auto-trade setting (limits, stop-loss, target, lots and the per-stock changes) to the defaults?\nThe stock list is kept.')) return;
  readRows();
  try {
    applySettingsView(await post('/api/autotrade/settings', {
      min_confidence: 85, max_positions: 5, max_trades_per_day: 5, sl_pct: 0.3, tp_pct: 0.3, lots: 1, nifty_max_per_day: 10, stock_max_per_day: 1,
      product: 'CARRYFORWARD', symbols: {}, universe: settingsRows.map(r => r.symbol),
    }));
    $('as-msg').style.color = 'var(--green)'; $('as-msg').textContent = 'Reset to defaults.';
    refreshAutoTrade();
  } catch (e) { $('as-msg').textContent = 'Reset failed: ' + e.message; }
}

function addSymbol() {
  const input = $('as-add'), sym = input.value.trim().toUpperCase();
  if (!sym) return;
  if (settingsRows.some(r => r.symbol.toUpperCase() === sym)) { $('as-msg').textContent = `${sym} is already in the list.`; return; }
  readRows();
  const g = { sl: num('as-sl', 30) / 100, tp: num('as-tp', 30) / 100, lots: Math.max(1, Math.round(num('as-lots', 1))) };
  const day = Math.max(1, Math.round(num('as-stock-day', 1))), product = $('as-product').value;
  settingsRows.push({ symbol: sym, underlying: sym.replace(/\s+/g, ''), lot_size: null, tradable: true,
    default: { sl_pct: g.sl, tp_pct: g.tp, lots: g.lots, max_per_day: day, product }, value: { sl_pct: g.sl, tp_pct: g.tp, lots: g.lots, enabled: true, max_per_day: day, product } });
  input.value = ''; renderSettingsRows();
  $('as-msg').style.color = 'var(--text3)'; $('as-msg').textContent = `${sym} added. Press Save to apply.`;
}

/* ───────────── Telegram alerts ───────────── */
const NF_KINDS = ['enabled', 'live_orders', 'live_exits', 'paper', 'positions', 'calls'];

async function loadAlerts() {
  try {
    const c = await api('/api/notify/settings');
    NF_KINDS.forEach(k => { const el = $('nf-' + k); if (el) el.checked = !!c[k]; });
    $('nf-conf').value = c.call_min_confidence; $('nf-loss').value = c.loss_alert_pct; $('nf-near').value = c.near_pct;
    $('nf-warn').style.display = c.configured ? 'none' : '';
  } catch (e) { DOM.setText('nf-msg', 'Could not load: ' + e.message); }
}

async function saveAlerts() {
  const body = { call_min_confidence: parseFloat($('nf-conf').value) || 80, loss_alert_pct: parseFloat($('nf-loss').value) || 5, near_pct: parseFloat($('nf-near').value) || 80 };
  NF_KINDS.forEach(k => { body[k] = $('nf-' + k).checked; });
  try { await post('/api/notify/settings', body); DOM.setText('nf-msg', 'Saved.'); }
  catch (e) { DOM.setText('nf-msg', e.message); }
}

async function testAlert() {
  DOM.setText('nf-msg', 'Sending…');
  try { const r = await post('/api/notify/test', {}); DOM.setText('nf-msg', r.detail); }
  catch (e) { DOM.setText('nf-msg', e.message); }
}

function wireSettings() {
  $('nf-save')?.addEventListener('click', saveAlerts);
  $('nf-test')?.addEventListener('click', testAlert);
  $('at-settings-btn')?.addEventListener('click', loadAlerts);
  $('at-settings-btn')?.addEventListener('click', openSettings);
  $('as-save')?.addEventListener('click', saveSettings);
  $('as-reset')?.addEventListener('click', resetSettings);
  $('as-add-btn')?.addEventListener('click', addSymbol);
  $('as-add')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSymbol(); } });
  const rows = $('as-rows');
  rows?.addEventListener('click', e => {
    const del = e.target.closest('.as-del'); if (!del) return;
    readRows(); settingsRows.splice(+del.closest('tr').dataset.i, 1); renderSettingsRows();
  });
  rows?.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.classList.contains('as-lots')) return;
    const r = settingsRows[+tr.dataset.i], lots = Math.max(1, parseInt(e.target.value) || 1);
    tr.querySelector('.as-units').textContent = r.lot_size ? `${lots * r.lot_size} units (lot ${r.lot_size})` : '';
  });
  rows?.addEventListener('change', e => { if (e.target.classList.contains('as-en')) e.target.closest('tr').classList.toggle('as-off', !e.target.checked); });
}

export function initAutoTrade() {
  document.querySelectorAll('.at-toggle').forEach(el => el.addEventListener('change', e => toggle(e.target.checked)));
  $('at-preview')?.addEventListener('click', preview);
  wireSettings();
  refreshAutoTrade();
  if (!timer) timer = setInterval(() => { if (!document.hidden) refreshAutoTrade(); }, 20000);
}

/** Auto-trader orders for one symbol, as chart markers: [{ts (ms of the signal candle), call}]. */
export function autoOrdersFor(symbol) {
  const key = symbol.toUpperCase();
  return lastOrders.filter(r => r.action === 'ORDER' && r.symbol.toUpperCase() === key && r.candle_ts)
    .map(r => ({ ts: Number(r.candle_ts), call: r.call }));
}
