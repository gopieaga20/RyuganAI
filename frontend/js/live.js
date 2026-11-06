'use strict';
/* Live (real-money) manual trading page. The server does all the checking and sending (backend/live_rules.py,
 * live_broker.py); this file shows state, collects the order, previews it, and sends only a previewed order after a
 * second, explicit confirmation. */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { loadLotSizes, lotSizeFor } from './lot-sizes.js';

const $ = id => document.getElementById(id);
const base = () => CONFIG.PROXY_BASE || '';
let timer = null, side = 'BUY', current = null, status = null;

const inr = v => (v == null || !Number.isFinite(+v) ? '--' : '₹' + (+v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const timeOnly = t => (t ? String(t).slice(-8) : '');

async function api(path, body) {
  const res = await fetch(base() + path, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : (data.detail || `HTTP ${res.status}`));
  return data;
}

const underlyingOf = sym => (sym.toUpperCase().match(/^(.+?)\d{2}[A-Z]{3}\d{2}\d+(CE|PE)$/) || [])[1] || null;

/* ───────────── status banner, funds, limits ───────────── */
async function refreshStatus() {
  try { status = await api('/api/live/status'); } catch (e) { DOM.setText('lv-sub', 'Could not reach the server: ' + e.message); return; }
  const on = status.enabled;
  $('lv-banner').className = 'lv-banner ' + (on ? 'on' : 'off');
  DOM.setText('lv-title', on ? 'LIVE TRADING IS ON: orders go to your Angel One account' : 'LIVE TRADING IS OFF');
  DOM.setText('lv-sub', on ? 'Every order still needs a check and a final confirmation. It switches itself off if the server restarts.'
    : 'Real orders are blocked. Nothing here reaches your broker until you switch live mode on.');
  const t = $('lv-toggle'); t.textContent = on ? 'Switch live OFF' : 'Switch live ON'; t.className = 'btn ' + (on ? 'btn-ghost' : 'lv-btn-on');
  const pill = $('tb-live'); if (pill) pill.style.display = on ? '' : 'none';

  const f = status.funds;
  $('lv-funds').innerHTML = !f ? '<span class="muted">Funds unavailable (no Angel session).</span>' : f.error ? `<span class="muted">Funds unavailable: ${DOM.esc(f.error)}</span>`
    : `<div><span>Available cash</span><b>${inr(f.available_cash)}</b></div><div><span>Net</span><b>${inr(f.net)}</b></div><div><span>Orders sent today</span><b>${status.orders_today}</b></div>`;
  const L = status.limits || {};
  // fill a box from the server only if you have not touched it: the page refreshes every few seconds and must not erase what you are typing
  [['lv-lim-value', L.max_order_value], ['lv-lim-lots', L.max_lots], ['lv-lim-loss', L.max_daily_loss]].forEach(([id, v]) => {
    const el = $(id);
    if (document.activeElement !== el && !el.dataset.dirty) el.value = v ?? '';
  });
  const note = $('lv-limits-note');
  note.textContent = status.limits_ready ? '' : 'Set the three limits below before any live order can be accepted.';
  note.style.display = status.limits_ready ? 'none' : '';
  updateQtyNote();
}

async function toggleLive() {
  if (status?.enabled) { await api('/api/live/disable', {}); return refreshAll(); }
  const phrase = prompt(`This switches on REAL-MONEY trading through your Angel One account.\n\nType ${status?.phrase || 'ENABLE LIVE'} to continue:`);
  if (phrase == null) return;
  try { await api('/api/live/enable', { phrase }); } catch (e) { alert(e.message); }
  refreshAll();
}

async function kill() {
  if (!confirm('KILL SWITCH\n\nThis switches live trading off and cancels every open order.\nYour open positions are NOT closed.\n\nContinue?')) return;
  try {
    const r = await api('/api/live/kill', {});
    alert(`Live trading is off. Cancelled ${r.cancelled.length} order(s)` + (r.failed.length ? `; could not cancel ${r.failed.join(', ')}. Check your broker app.` : '.') + (r.error ? `\n\n${r.error}` : ''));
  } catch (e) { alert('Kill switch failed: ' + e.message + '\n\nUse your broker app to cancel orders.'); }
  refreshAll();
}

async function saveLimits() {
  const msg = $('lv-lim-msg'); msg.style.color = 'var(--text3)'; msg.textContent = 'Saving…';
  try {
    await api('/api/live/limits', { max_order_value: +$('lv-lim-value').value, max_lots: +$('lv-lim-lots').value, max_daily_loss: +$('lv-lim-loss').value });
    msg.style.color = 'var(--green)'; msg.textContent = 'Saved.';
    ['lv-lim-value', 'lv-lim-lots', 'lv-lim-loss'].forEach(id => delete $(id).dataset.dirty);
  } catch (e) { msg.style.color = 'var(--down)'; msg.textContent = 'Not saved: ' + e.message; }
  refreshStatus();
}

/* ───────────── order form ───────────── */
function setSide(s) {
  side = s;
  $('lv-buy').classList.toggle('active', s === 'BUY'); $('lv-sell').classList.toggle('active', s === 'SELL');
  document.querySelectorAll('.lv-exit-f').forEach(el => { el.style.display = s === 'BUY' ? '' : 'none'; });
  $('lv-exit-note').style.display = s === 'BUY' ? '' : 'none';
  clearPreview();
}

function onTypeChange() {
  const t = $('lv-otype').value;
  $('lv-price-wrap').style.display = (t === 'MARKET' || t === 'STOPLOSS_MARKET') ? 'none' : '';
  $('lv-trigger-wrap').style.display = t.startsWith('STOPLOSS') ? '' : 'none';
  clearPreview();
}

async function updateQtyNote() {
  const sym = $('lv-sym').value.trim().toUpperCase(), und = underlyingOf(sym), el = $('lv-qty-note');
  if (!und) { el.textContent = sym ? 'Pick a full option contract from the list (for example NIFTY10NOV2623950CE).' : ''; return; }
  await loadLotSizes();
  const lot = lotSizeFor(und), lots = Math.max(1, parseInt($('lv-lots').value) || 1);
  el.textContent = lot ? `${lots} lot${lots > 1 ? 's' : ''} × ${lot} = ${lots * lot} units` : 'Lot size unknown for this contract.';
}

function readOrder() {
  const sym = $('lv-sym').value.trim().toUpperCase(), und = underlyingOf(sym), lot = und ? lotSizeFor(und) : null, lots = Math.max(1, parseInt($('lv-lots').value) || 1);
  if (!und) throw new Error('Pick a full option contract (for example NIFTY10NOV2623950CE) from the suggestion list.');
  if (!lot) throw new Error('The lot size of this contract is not known yet. Try again in a moment.');
  const t = $('lv-otype').value, num = id => parseFloat($(id).value) || 0;
  const o = { symbol: sym, side, qty: lots * lot, order_type: t, product: $('lv-product').value,
    price: (t === 'MARKET' || t === 'STOPLOSS_MARKET') ? 0 : num('lv-price'), trigger_price: t.startsWith('STOPLOSS') ? num('lv-trigger') : 0 };
  if (side === 'BUY') { o.sl_pct = num('lv-sl'); o.tp_pct = num('lv-tp'); o.trail_pct = num('lv-trail'); }
  return o;
}

const ruleText = r => [r.sl_pct > 0 && `stop-loss ${+r.sl_pct}%`, r.tp_pct > 0 && `target ${+r.tp_pct}%`, r.trail_pct > 0 && `trailing stop ${+r.trail_pct}%`].filter(Boolean).join(' · ') || 'none';

function clearPreview() { current = null; $('lv-preview').innerHTML = ''; }

function showPreview(p, source = 'check') {
  current = p.ok ? p : null;
  const o = p.order, e = p.est;
  const list = (items, cls) => items.length ? `<ul class="lv-list ${cls}">${items.map(x => `<li>${DOM.esc(x)}</li>`).join('')}</ul>` : '';
  $('lv-preview').innerHTML = `
    <div class="lv-pv ${p.ok ? 'ok' : 'bad'}">
      <div class="lv-pv-head">${p.ok ? 'Order passes every check' : 'Order refused by the checks'}</div>
      <div class="lv-pv-line"><b>${DOM.esc(o.side)} ${o.qty}</b> ${DOM.esc(o.symbol)} · ${DOM.esc(o.order_type.replace('_', ' '))} · ${o.product === 'INTRADAY' ? 'Intraday' : 'Carry-forward'}</div>
      <div class="lv-pv-line muted">Last price ${inr(p.ltp)} · est. price ${inr(e.price)} · est. value <b>${inr(e.value)}</b> · est. charges ${inr(e.charges)} · ${e.lots} lot(s)</div>
      ${o.sl_pct || o.tp_pct || o.trail_pct ? `<div class="lv-pv-line">Exit rules after it fills: ${ruleText(o)}</div>` : ''}
      ${list(p.errors, 'err')}${list(p.warnings, 'warn')}
      ${p.ok ? `<div class="at-set-actions" style="margin-top:10px"><button class="btn lv-btn-send" id="lv-place" ${status?.enabled ? '' : 'disabled'}>Place LIVE order…</button>
        ${status?.enabled ? '' : '<span class="small" style="color:var(--down)">Live mode is OFF: switch it on first.</span>'}
        <span class="small muted">Valid for ${p.expires_in} seconds.</span></div>` : ''}
    </div>`;
  $('lv-place')?.addEventListener('click', openModal);
}

async function check() {
  let o;
  try { o = readOrder(); } catch (e) { $('lv-preview').innerHTML = `<div class="lv-pv bad"><div class="lv-pv-head">${DOM.esc(e.message)}</div></div>`; return; }
  $('lv-preview').innerHTML = '<span class="spinr"></span> Checking…';
  try { showPreview(await api('/api/live/preview', o)); } catch (e) { $('lv-preview').innerHTML = `<div class="lv-pv bad"><div class="lv-pv-head">${DOM.esc(e.message)}</div></div>`; }
}

function openModal() {
  if (!current) return;
  const o = current.order, e = current.est;
  $('lv-modal-body').innerHTML = `
    <div class="lv-modal-big ${o.side === 'BUY' ? 'buy' : 'sell'}">${DOM.esc(o.side)} ${o.qty} × ${DOM.esc(o.symbol)}</div>
    <table class="lv-modal-table">
      <tr><td>Order type</td><td>${DOM.esc(o.order_type.replace('_', ' '))}${o.price ? ' @ ' + inr(o.price) : ''}${o.trigger_price ? ' (trigger ' + inr(o.trigger_price) + ')' : ''}</td></tr>
      <tr><td>Product</td><td>${o.product === 'INTRADAY' ? 'Intraday (MIS)' : 'Carry-forward (NRML)'}</td></tr>
      ${o.sl_pct || o.tp_pct || o.trail_pct ? `<tr><td>Exit rules</td><td>${DOM.esc(ruleText(o))}<br><span class="muted">sold at market by this server</span></td></tr>` : ''}
      <tr><td>Estimated value</td><td><b>${inr(e.value)}</b></td></tr>
      <tr><td>Estimated charges</td><td>${inr(e.charges)}</td></tr>
    </table>
    <div class="lv-modal-warn">This sends a REAL order to your Angel One account and uses real money. Orders cannot be undone once filled.</div>`;
  $('lv-modal').style.display = '';
}

async function send() {
  if (!current) return;
  const btn = $('lv-modal-send'); btn.disabled = true; btn.textContent = 'Sending…';
  const id = current.preview_id;
  try {
    const r = await api('/api/live/order', { preview_id: id });
    $('lv-modal').style.display = 'none';
    const tone = r.state === 'PLACED' ? 'ok' : 'bad';
    $('lv-preview').innerHTML = `<div class="lv-pv ${tone}"><div class="lv-pv-head">${r.state === 'PLACED' ? `Order sent. Broker order id ${DOM.esc(r.order_id)}` : r.state === 'UNKNOWN' ? 'OUTCOME UNKNOWN: check your broker app and the order list before doing anything else' : `Not placed: ${DOM.esc(r.message || r.state)}`}</div>
      <div class="lv-pv-line muted">${DOM.esc(r.message || '')}</div></div>`;
    current = null;
  } catch (e) {
    $('lv-modal').style.display = 'none';
    $('lv-preview').innerHTML = `<div class="lv-pv bad"><div class="lv-pv-head">Not sent: ${DOM.esc(e.message)}</div></div>`;
    current = null;
  }
  btn.disabled = false; btn.textContent = 'Send order to broker';
  refreshAll();
}

/* ───────────── positions, orders, ledger ───────────── */
async function refreshTables() {
  try {
    const { positions } = await api('/api/live/positions');
    $('lv-pos').innerHTML = positions.length ? positions.map(p => {
      const long = p.net_qty > 0;
      return `<tr><td><b>${DOM.esc(p.symbol)}</b></td><td>${p.product === 'INTRADAY' ? 'MIS' : 'NRML'}</td><td>${p.net_qty}</td><td class="mono">${p.buy_avg ?? '--'}</td><td class="mono">${p.ltp ?? '--'}</td>
        <td class="mono" style="color:${(p.pnl || 0) >= 0 ? 'var(--green)' : 'var(--down)'}">${inr(p.pnl)}</td>
        <td>${long ? `<button class="btn btn-sm btn-ghost" data-protect="${DOM.esc(p.symbol)}" data-product="${DOM.esc(p.product)}">Stop/target</button> <button class="btn btn-sm btn-danger" data-exit="${DOM.esc(p.symbol)}" data-product="${DOM.esc(p.product)}">Exit…</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-cell">No open positions.</td></tr>';
  } catch (e) { $('lv-pos').innerHTML = `<tr><td colspan="7" class="empty-cell">Positions unavailable: ${DOM.esc(e.message)}</td></tr>`; }
  try {
    const d = await api('/api/live/orders');
    $('lv-orders').innerHTML = d.orders.length ? d.orders.map(o => `<tr><td class="mono">${DOM.esc(timeOnly(o.time))}</td><td><b>${DOM.esc(o.symbol)}</b></td>
      <td style="color:${o.side === 'BUY' ? 'var(--green)' : 'var(--down)'}">${DOM.esc(o.side)}</td><td>${DOM.esc((o.order_type || '').replace('_', ' '))}</td><td>${o.filled}/${o.qty}</td>
      <td class="mono">${o.price ?? '--'}${o.trigger ? ' / ' + o.trigger : ''}</td><td><span class="at-chip ${o.status === 'complete' ? 'ok' : o.status === 'rejected' ? 'bad' : 'skip'}">${DOM.esc(o.status)}</span></td>
      <td class="at-detail">${DOM.esc(o.text)}</td><td>${o.open ? `<button class="btn btn-sm btn-ghost" data-cancel="${DOM.esc(o.order_id)}" data-variety="${DOM.esc(o.variety)}">Cancel</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="empty-cell">No orders today.</td></tr>';
    $('lv-ledger').innerHTML = d.ledger.length ? d.ledger.map(r => `<tr><td class="mono">${new Date(r.ts).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</td>
      <td><b>${DOM.esc(r.symbol)}</b></td><td>${DOM.esc(r.side)}</td><td>${r.qty}</td><td>${DOM.esc(r.order_type)}</td>
      <td><span class="at-chip ${r.state === 'PLACED' ? 'ok' : r.state === 'UNKNOWN' || r.state === 'SENDING' ? 'bad' : 'skip'}">${DOM.esc(r.state)}</span></td>
      <td class="mono">${DOM.esc(r.broker_order_id || '')}</td><td class="at-detail">${DOM.esc(r.message || '')}</td></tr>`).join('')
      : '<tr><td colspan="8" class="empty-cell">Nothing sent yet.</td></tr>';
  } catch (e) { $('lv-orders').innerHTML = `<tr><td colspan="9" class="empty-cell">Orders unavailable: ${DOM.esc(e.message)}</td></tr>`; }
}

async function exitPosition(symbol, product) {
  $('lv-preview').innerHTML = '<span class="spinr"></span> Preparing the exit order…';
  $('lv-preview').scrollIntoView({ block: 'center' });
  try { showPreview(await api('/api/live/exit-preview', { symbol, product })); }
  catch (e) { $('lv-preview').innerHTML = `<div class="lv-pv bad"><div class="lv-pv-head">${DOM.esc(e.message)}</div></div>`; }
}

async function cancelOrder(order_id, variety) {
  if (!confirm(`Cancel order ${order_id}?`)) return;
  try { await api('/api/live/cancel', { order_id, variety }); } catch (e) { alert('Not cancelled: ' + e.message); }
  refreshAll();
}

/* ───────────── stop-loss / target / trailing rules ───────────── */
let exitDefaultsApplied = false;
const EXIT_LABEL = { WAITING: 'Waiting for the buy to fill', ARMED: 'Watching', TRIGGERED: 'Sending exit…', EXIT_SENT: 'Exit order sent', UNKNOWN: 'OUTCOME UNKNOWN: check your broker app',
  EXIT_FAILED: 'Exit failed', DONE: 'Position closed', CANCELLED: 'Cancelled', EXPIRED: 'Buy never filled' };

async function refreshExits() {
  try {
    const d = await api('/api/live/exits');
    if (!exitDefaultsApplied) {
      exitDefaultsApplied = true;
      const f = d.defaults || {};
      [['lv-sl', 'sl_pct'], ['lv-tp', 'tp_pct'], ['lv-trail', 'trail_pct']].forEach(([id, k]) => { if (f[k] && !$(id).value) $(id).value = f[k]; });
    }
    const active = d.exits.some(e => e.state === 'WAITING' || e.state === 'ARMED');
    const warn = $('lv-exit-warn');
    warn.style.display = active && !d.watching ? '' : 'none';
    warn.textContent = 'Live mode is OFF, so these rules are NOT being watched and nothing will be sold automatically. Switch live mode on to watch them.';
    $('lv-exits').innerHTML = d.exits.length ? d.exits.map(e => {
      const live = e.state === 'WAITING' || e.state === 'ARMED';
      return `<tr><td><b>${DOM.esc(e.symbol)}</b><div class="muted small">${e.product === 'INTRADAY' ? 'MIS' : 'NRML'} · ${e.qty} units</div></td><td>${DOM.esc(ruleText(e))}</td>
        <td class="mono">${e.entry ?? '--'}</td><td class="mono">${e.peak ?? '--'}</td><td class="mono">${e.stop ?? '--'}</td><td class="mono">${e.target ?? '--'}</td>
        <td><span class="at-chip ${e.state === 'ARMED' ? 'ok' : ['UNKNOWN', 'EXIT_FAILED'].includes(e.state) ? 'bad' : 'skip'}">${DOM.esc(EXIT_LABEL[e.state] || e.state)}</span>${e.reason && !live ? `<div class="muted small">${DOM.esc(e.reason)}</div>` : ''}${e.message ? `<div class="muted small">${DOM.esc(e.message)}</div>` : ''}</td>
        <td>${live ? `<button class="btn btn-sm btn-ghost" data-exit-cancel="${e.id}">Remove</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty-cell">No rules yet. Add them to a buy order, or press "Stop/target" on a position.</td></tr>';
  } catch (e) { $('lv-exits').innerHTML = `<tr><td colspan="8" class="empty-cell">Rules unavailable: ${DOM.esc(e.message)}</td></tr>`; }
}

function openProtect(symbol, product) {
  $('lv-exit-set').style.display = '';
  $('lv-exit-for').textContent = `${symbol} (${product === 'INTRADAY' ? 'MIS' : 'NRML'})`;
  $('lv-exit-set').dataset.symbol = symbol; $('lv-exit-set').dataset.product = product;
  ['lv-es-sl', 'lv-es-tp', 'lv-es-trail'].forEach((id, i) => { $(id).value = $(['lv-sl', 'lv-tp', 'lv-trail'][i]).value; });
  $('lv-es-msg').textContent = '';
  $('lv-exit-set').scrollIntoView({ block: 'center' });
}

async function saveProtect() {
  const box = $('lv-exit-set'), num = id => parseFloat($(id).value) || 0;
  try {
    await api('/api/live/exits/set', { symbol: box.dataset.symbol, product: box.dataset.product, sl_pct: num('lv-es-sl'), tp_pct: num('lv-es-tp'), trail_pct: num('lv-es-trail') });
    box.style.display = 'none';
  } catch (e) { $('lv-es-msg').textContent = e.message; return; }
  refreshExits();
}

async function saveExitDefaults() {
  const num = id => parseFloat($(id).value) || 0;
  try { await api('/api/live/exit-defaults', { sl_pct: num('lv-sl'), tp_pct: num('lv-tp'), trail_pct: num('lv-trail') }); $('lv-exit-defaults').textContent = 'Saved'; setTimeout(() => { $('lv-exit-defaults').textContent = 'Save these as my defaults'; }, 2000); }
  catch (e) { alert(e.message); }
}

export function refreshAll() { return Promise.all([refreshStatus(), refreshTables(), refreshExits()]); }

export function initLive() {
  if (!$('tab-live')) return;
  $('lv-toggle').addEventListener('click', toggleLive);
  $('lv-kill').addEventListener('click', kill);
  $('lv-lim-save').addEventListener('click', saveLimits);
  ['lv-lim-value', 'lv-lim-lots', 'lv-lim-loss'].forEach(id => $(id).addEventListener('input', () => { $(id).dataset.dirty = '1'; }));
  $('lv-buy').addEventListener('click', () => setSide('BUY'));
  $('lv-sell').addEventListener('click', () => setSide('SELL'));
  $('lv-otype').addEventListener('change', onTypeChange);
  ['lv-sym', 'lv-lots'].forEach(id => $(id).addEventListener('input', () => { updateQtyNote(); clearPreview(); }));
  ['lv-price', 'lv-trigger', 'lv-product'].forEach(id => $(id).addEventListener('input', clearPreview));
  $('lv-check').addEventListener('click', check);
  $('lv-refresh').addEventListener('click', refreshAll);
  $('lv-modal-cancel').addEventListener('click', () => { $('lv-modal').style.display = 'none'; });
  $('lv-modal-send').addEventListener('click', send);
  $('lv-pos').addEventListener('click', e => {
    const b = e.target.closest('[data-exit]'); if (b) exitPosition(b.dataset.exit, b.dataset.product);
    const q = e.target.closest('[data-protect]'); if (q) openProtect(q.dataset.protect, q.dataset.product);
  });
  $('lv-exits').addEventListener('click', async e => {
    const b = e.target.closest('[data-exit-cancel]');
    if (!b || !confirm('Stop watching this position? It will no longer be sold automatically.')) return;
    try { await api('/api/live/exits/cancel', { id: +b.dataset.exitCancel }); } catch (err) { alert(err.message); }
    refreshExits();
  });
  $('lv-es-save').addEventListener('click', saveProtect);
  $('lv-es-close').addEventListener('click', () => { $('lv-exit-set').style.display = 'none'; });
  $('lv-exit-defaults').addEventListener('click', saveExitDefaults);
  ['lv-sl', 'lv-tp', 'lv-trail'].forEach(id => $(id).addEventListener('input', clearPreview));
  $('lv-orders').addEventListener('click', e => { const b = e.target.closest('[data-cancel]'); if (b) cancelOrder(b.dataset.cancel, b.dataset.variety); });
  onTypeChange();
  setSide('BUY');
  refreshStatus();                                          // for the top-bar LIVE pill
  if (!timer) timer = setInterval(() => { if (!document.hidden) { if ($('tab-live').classList.contains('active')) refreshAll(); else refreshStatus(); } }, 6000);
}
