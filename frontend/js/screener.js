'use strict';
/* Screener page: the nightly techno-funda ranking (backend/screener.py). All numbers come from the server; this file shows them. */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { sortRows, filterRows, checklist, setupText, scoreBand, progressText, num, money, ageText } from './screener-utils.js';

const $ = id => document.getElementById(id);
const base = () => CONFIG.PROXY_BASE || '';
const view = { tab: 'feed', q: '', hygieneOnly: true, sort: 'score', asc: false, open: null };
let data = null, timer = null, wired = false;

async function api(path, opts) {
  const res = await fetch(base() + path, { cache: 'no-store', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(body.detail) ? body.detail.map(d => d.msg).join('; ') : (body.detail || `HTTP ${res.status}`));
  return body;
}
const send = (method, path, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

function note(msg, bad = false) { const el = $('scr-msg'); if (el) { el.textContent = msg || ''; el.style.color = bad ? 'var(--down)' : 'var(--tx-2, inherit)'; } }

export async function refreshScreener() {
  try { data = await api('/api/screener/results'); } catch (e) { note('Could not load the screener: ' + e.message, true); return; }
  render();
  fillSettings(data.settings);
  const busy = data.state.running || data.state.fund_running;
  clearTimeout(timer);
  if (busy && $('tab-screener')?.classList.contains('active')) timer = setTimeout(refreshScreener, 4000);
}

function render() {
  const run = data?.run, st = data?.state || {};
  const sum = run?.meta?.summary;
  DOM.setText('scr-s-uni', sum ? sum.universe : '--');
  DOM.setText('scr-s-hyg', sum ? sum.hygiene_ok : '--');
  DOM.setText('scr-s-fund', sum ? sum.with_fundamentals : '--');
  DOM.setText('scr-s-tech', sum ? sum.tech_pass : '--');
  DOM.setText('scr-s-feed', sum ? sum.feed : '--');
  DOM.setText('scr-s-when', run ? new Date(run.ran_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  const flags = [];
  if (run?.meta) {
    if (!run.meta.asm_checked || !run.meta.gsm_checked) flags.push('ASM/GSM lists could not be fetched, so they were not checked');
    if (!run.meta.industry_map) flags.push('sector map missing: every stock was treated as a non-financial company');
    if (!run.meta.bhav_date) flags.push('no NSE delivery file: delivery % not scored');
  }
  DOM.setText('scr-flags', flags.length ? 'Data gaps in this run: ' + flags.join('; ') + '.' : '');
  const prog = progressText(st) || (st.error ? 'Last run failed: ' + st.error : '');
  DOM.setText('scr-progress', prog);
  $('scr-run').disabled = !!st.running; $('scr-fund').disabled = !!st.fund_running;
  renderTable();
}

function renderTable() {
  const body = $('scr-body'); if (!body) return;
  const rows = sortRows(filterRows(data?.run?.rows || [], { view: view.tab, q: view.q, hygieneOnly: view.hygieneOnly }), view.sort, view.asc);
  const min = data?.settings?.min_score ?? 75;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="12" class="empty-cell">${data?.run ? (view.tab === 'feed' ? 'No stock clears every gate and the score threshold today. That is a normal outcome: look at "All screened" to see how close the best ones are.' : 'Nothing matches.') : 'No run yet. Press "Run now" (the first run downloads a year of daily candles and takes about 10 minutes).'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const s = r.setup, open = view.open === r.symbol;
    const cov = r.coverage < 1 ? ` <span class="sc-s" title="Share of the 50 fundamental points that could be checked">${Math.round(r.coverage * 100)}% data</span>` : '';
    let html = `<tr class="scr-row" data-sym="${DOM.esc(r.symbol)}">
      <td><b>${DOM.esc(r.symbol)}</b><div class="sc-s">${DOM.esc(r.industry || r.bucket)}</div></td>
      <td><span class="pill scr-${scoreBand(r.score, min)}">${num(r.score, 0)}</span><div class="sc-s">F ${num(r.fund_score, 0)} · T ${num(r.tech_score, 0)}${cov}</div></td>
      <td>${r.rs ?? '--'}</td><td>${num(r.close)}</td>
      <td>${s ? (s.type === 'BREAKOUT' ? 'Breakout' : 'Pullback') : '--'}</td>
      <td>${s ? num(s.entry) : '--'}</td><td>${s ? num(s.stop) : '--'}</td><td>${s ? num(s.t1) : '--'}</td><td>${s ? num(s.t2) : '--'}</td>
      <td>${s ? num(s.rr, 1) : '--'}</td><td>${s ? s.qty : '--'}</td>
      <td class="scr-actions"><button class="btn btn-ghost btn-sm" data-act="chart" data-sym="${DOM.esc(r.symbol)}">Chart</button>
        ${s && s.qty > 0 ? `<button class="btn btn-primary btn-sm" data-act="trade" data-sym="${DOM.esc(r.symbol)}" title="Queue this setup as a pending delivery paper order">Paper trade</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="open" data-sym="${DOM.esc(r.symbol)}">${open ? 'Hide' : 'Why'}</button></td></tr>`;
    if (open) html += `<tr class="scr-detail"><td colspan="12">${detail(r)}</td></tr>`;
    return html;
  }).join('');
}

function detail(r) {
  const groups = {};
  for (const c of checklist(r)) (groups[c.group] ||= []).push(c);
  const mark = { pass: '✓', fail: '✗', na: '–' };
  const cols = Object.entries(groups).map(([g, items]) => `<div class="scr-col"><div class="sc-l">${g}</div>${items.map(c =>
    `<div class="scr-chk scr-${c.state}"><span>${mark[c.state]}</span> ${DOM.esc(c.label)}${c.value !== null && c.value !== undefined ? ` <i>${DOM.esc(typeof c.value === 'number' ? num(c.value, 1) : c.value)}</i>` : ''}${c.state === 'na' && !/no data source/.test(c.label) ? ' <i>not available</i>' : ''}</div>`).join('')}</div>`).join('');
  const m = r.metrics;
  const asof = m ? `Fundamentals as of ${m.as_of || 'unknown'} (${ageText(m.as_of)})${m.stale ? ' — too old to score' : ''}.` : 'No fundamentals fetched yet for this stock: press "Refresh fundamentals".';
  return `<div class="scr-detail-grid">${cols}</div><div class="sc-s" style="margin-top:8px">${asof} ${r.setup ? DOM.esc(setupText(r.setup)) + '. ' + DOM.esc(r.setup.invalidation) : 'No trade setup today.'}${r.deliv_per != null ? ` Delivery ${num(r.deliv_per, 1)}%.` : ''}</div>`;
}

function fillSettings(s) {
  if (!s || $('scr-settings')?.dataset.dirty === '1') return;
  for (const el of document.querySelectorAll('#scr-settings [data-k]')) {
    const v = s[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
}

async function saveSettings() {
  const patch = {};
  for (const el of document.querySelectorAll('#scr-settings [data-k]')) patch[el.dataset.k] = el.type === 'checkbox' ? el.checked : Number(el.value);
  try { await send('PATCH', '/api/screener/settings', patch); $('scr-settings').dataset.dirty = '0'; note('Settings saved. They apply from the next run.'); await refreshScreener(); }
  catch (e) { note(e.message, true); }
}

function wire() {
  if (wired) return; wired = true;
  $('scr-run').onclick = async () => { try { await send('POST', '/api/screener/run'); note('Run started.'); refreshScreener(); } catch (e) { note(e.message, true); } };
  $('scr-fund').onclick = async () => { try { const r = await send('POST', '/api/screener/fundamentals/refresh'); note(`Refreshing ${r.total} stocks from Yahoo, about 2 seconds each.`); refreshScreener(); } catch (e) { note(e.message, true); } };
  for (const b of document.querySelectorAll('#scr-tabs [data-view]')) b.onclick = () => { view.tab = b.dataset.view; for (const x of document.querySelectorAll('#scr-tabs [data-view]')) x.classList.toggle('active', x === b); renderTable(); };
  $('scr-q').oninput = e => { view.q = e.target.value; renderTable(); };
  $('scr-hyg').onchange = e => { view.hygieneOnly = e.target.checked; renderTable(); };
  for (const th of document.querySelectorAll('#scr-table th[data-sort]')) th.onclick = () => { const k = th.dataset.sort; view.asc = view.sort === k ? !view.asc : (k === 'symbol'); view.sort = k; renderTable(); };
  $('scr-body').onclick = async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const sym = b.dataset.sym;
    if (b.dataset.act === 'trade') {
      try { const o = await send('POST', '/api/screener/paper-trade', { symbol: sym }); note(`${sym}: ${o.order_type === 'SL' ? 'buy-stop' : 'limit'} order for ${o.qty} shares at ${num(o.entry)} queued for the next session. See Paper > Pending orders.`); }
      catch (err) { note(err.message, true); }
    }
    if (b.dataset.act === 'open') { view.open = view.open === sym ? null : sym; renderTable(); }
    if (b.dataset.act === 'chart') { const { selectSymbol } = await import('./dash.js'); window.switchTab('dash'); selectSymbol(sym + '.NS'); }
  };
  $('scr-settings').addEventListener('input', () => { $('scr-settings').dataset.dirty = '1'; });
  $('scr-save').onclick = saveSettings;
  $('scr-restore').onclick = async () => { try { const r = await send('POST', '/api/screener/restore-universe'); note(`Scan list restored (${r.universe.length} symbols). The scanner picks it up within 5 minutes.`); } catch (e) { note(e.message, true); } };
}

export function initScreener() { wire(); }
