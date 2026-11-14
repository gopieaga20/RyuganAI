'use strict';
/* Profile menu and page: Account, Strategies, Live trading permission, AI API keys.
   The server is the authority for every setting here (owner-only changes, the live gate, key encryption); this file is only the form. */

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { STRATEGIES, CALL_SCORE } from './strategies.js';
import { applySettings, loadPrefs, isLiveAllowed } from './strategy-prefs.js';
import { signOut } from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => DOM.esc(String(s ?? ''));
let me = null;
let settings = null;                                   // last /api/profile/settings

async function api(path, method = 'GET', body) {
  const res = await fetch(CONFIG.PROXY_BASE + path, {
    method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : (data.detail || `HTTP ${res.status}`));
  return data;
}

function say(id, text, ok = true) {
  const el = $(id); if (!el) return;
  el.style.color = ok ? 'var(--green)' : 'var(--down)';
  el.textContent = text;
}

const WHAT = {
  trend: 'Three moving averages stacked in order, price above (or below) all of them',
  rsi: 'RSI 55-75 bullish, 25-45 bearish; the extremes are ignored',
  vwap: "Price above or below the day's VWAP",
  structure: 'Direction of the latest higher-high / lower-low break',
  fvg: 'Price retests a fresh fair value gap and holds it',
  volume: 'A candle on 1.5x average volume closing up or down',
  smc: 'LuxAlgo SMC: internal trend, an unmitigated order block tapped, price in discount (long) or premium (short)',
  sr: "Previous day's high / low and swing levels (shown, carries no weight)",
  news: "The stock's own headlines from the last 24 hours",
};

/* ───────────── menu and tabs ───────────── */
function closeMenu() { $('profile-menu').style.display = 'none'; $('profile-btn').setAttribute('aria-expanded', 'false'); }

export function openProfile(tab = 'account') {
  closeMenu();
  window.switchTab?.('profile');
  showTab(tab);
}

function showTab(name) {
  document.querySelectorAll('.pf-tab').forEach(b => b.classList.toggle('active', b.dataset.pfTab === name));
  document.querySelectorAll('.pf-panel').forEach(p => { p.style.display = p.id === 'pf-' + name ? '' : 'none'; });
  if (name === 'ai') loadAi();
  if (name === 'live') renderLive();
}

function fillMenu() {
  const name = me?.display_name || me?.email || '?';
  $('profile-btn').textContent = name.trim().charAt(0) || '?';
  $('pf-menu-name').textContent = name;
  $('pf-menu-email').textContent = me?.email || '';
}

/* ───────────── account ───────────── */
function fillAccount() {
  $('pf-name').value = me?.display_name || '';
  $('pf-email').value = me?.email || '';
  $('pf-owner-card').style.display = me?.is_owner ? '' : 'none';
  if (settings) $('pf-signups').checked = !!settings.signups_open;
}

async function saveAccount() {
  const email = $('pf-email').value.trim(), changed = email.toLowerCase() !== (me?.email || '').toLowerCase();
  $('pf-email-pw-wrap').style.display = changed ? '' : 'none';
  if (changed && !$('pf-email-pw').value) { say('pf-account-msg', 'Enter your current password to change the email.', false); return; }
  try {
    const d = await api('/api/profile', 'PATCH', { display_name: $('pf-name').value.trim(), email: changed ? email : undefined, password: changed ? $('pf-email-pw').value : undefined });
    me = d.user; $('pf-email-pw').value = ''; $('pf-email-pw-wrap').style.display = 'none';
    fillMenu(); fillAccount(); say('pf-account-msg', 'Saved.');
  } catch (e) { say('pf-account-msg', e.message, false); }
}

async function savePassword() {
  const cur = $('pf-pw-cur').value, nw = $('pf-pw-new').value;
  if (nw !== $('pf-pw-new2').value) { say('pf-pw-msg', 'The two new passwords differ.', false); return; }
  try {
    const d = await api('/api/auth/password', 'POST', { current_password: cur, new_password: nw });
    ['pf-pw-cur', 'pf-pw-new', 'pf-pw-new2'].forEach(i => { $(i).value = ''; });
    say('pf-pw-msg', d.message || 'Password changed.');
  } catch (e) { say('pf-pw-msg', e.message, false); }
}

async function toggleSignups() {
  try { settings = await api('/api/profile/settings', 'PATCH', { signups_open: $('pf-signups').checked }); say('pf-signups-msg', settings.signups_open ? 'Sign-ups are OPEN. Switch off after the invited person has registered.' : 'Sign-ups are closed.', !settings.signups_open || true); }
  catch (e) { $('pf-signups').checked = !$('pf-signups').checked; say('pf-signups-msg', e.message, false); }
}

/* ───────────── strategies ───────────── */
function weightOf(id) { return (settings?.strategies || []).find(s => s.id === id)?.weight ?? STRATEGIES.find(s => s.id === id)?.weight ?? 0; }

function renderStrategies() {
  const body = $('pf-strat-body'); if (!body || !settings) return;
  body.innerHTML = STRATEGIES.map(s => {
    const on = (settings.strategies.find(x => x.id === s.id)?.enabled) !== false;
    return `<tr class="${on ? '' : 'off'}" data-id="${s.id}"><td><label class="at-switch-wrap sm"><input type="checkbox" class="pf-strat-on" ${on ? 'checked' : ''}><span class="at-slider"></span></label></td>
      <td><b>${esc(s.name)}</b></td><td>${weightOf(s.id) || '0 (shown only)'}</td><td class="muted small">${esc(WHAT[s.id] || '')}</td></tr>`;
  }).join('');
  stratSummary();
}

function chosen() { return [...document.querySelectorAll('#pf-strat-body tr')].filter(tr => tr.querySelector('.pf-strat-on').checked).map(tr => tr.dataset.id); }

function stratSummary() {
  const ids = chosen(), total = ids.reduce((a, i) => a + weightOf(i), 0), el = $('pf-strat-sum');
  document.querySelectorAll('#pf-strat-body tr').forEach(tr => tr.classList.toggle('off', !tr.querySelector('.pf-strat-on').checked));
  const ok = total >= CALL_SCORE;
  el.classList.toggle('bad', !ok);
  el.textContent = ok ? `${ids.length} of ${STRATEGIES.length} on. Maximum score ${total}; a call needs ±${CALL_SCORE}.`
    : `Maximum score would be ${total}: a call needs ±${CALL_SCORE}, so no call could ever appear. Switch more strategies on.`;
  $('pf-save-strat').disabled = !ok;
}

async function saveStrategies() {
  try {
    settings = await api('/api/profile/settings', 'PATCH', { strategies_enabled: chosen() });
    applySettings(settings); renderStrategies();
    say('pf-strat-msg', 'Saved. The dashboard updates now; the auto-scanner uses it from its next scan.');
  } catch (e) { say('pf-strat-msg', e.message, false); }
}

/* ───────────── live permission ───────────── */
export function applyLiveVisibility() {
  const nav = document.querySelector('.nav-btn[data-tab="live"]'); if (!nav) return;
  const allowed = isLiveAllowed();
  nav.hidden = !allowed; nav.style.display = allowed ? '' : 'none';
}

function renderLive() {
  const allowed = isLiveAllowed();
  $('pf-live-allowed').checked = allowed;
  $('pf-live-status').textContent = allowed ? 'ALLOWED: the Live page is available. Live mode is still off until you switch it on there.' : 'NOT ALLOWED: real-money orders are blocked by the server.';
  $('pf-live-status').style.color = allowed ? 'var(--amber, #f5a524)' : 'var(--tx-2)';
  $('pf-live-open').style.display = allowed ? '' : 'none';
  if (!me?.is_owner) { $('pf-live-allowed').disabled = true; say('pf-live-msg', 'Only the owner can change this.', false); }
}

async function setLive(on, password) {
  settings = await api('/api/profile/settings', 'PATCH', { live_allowed: on, password });
  applySettings(settings); applyLiveVisibility(); renderLive();
}

function wireLive() {
  $('pf-live-allowed').addEventListener('change', async e => {
    if (e.target.checked) { e.target.checked = false; $('pf-live-confirm').style.display = ''; $('pf-live-pw').focus(); return; }      // asking for the password first
    try { await setLive(false); say('pf-live-msg', 'Live trading is no longer allowed. Any running live mode was switched off.'); }
    catch (err) { e.target.checked = true; say('pf-live-msg', err.message, false); }
  });
  $('pf-live-ok').addEventListener('click', async () => {
    try { await setLive(true, $('pf-live-pw').value); $('pf-live-pw').value = ''; $('pf-live-confirm').style.display = 'none'; say('pf-live-msg', 'Allowed. Open the Live page to connect a broker.'); }
    catch (err) { say('pf-live-msg', err.message, false); }
  });
  $('pf-live-cancel').addEventListener('click', () => { $('pf-live-confirm').style.display = 'none'; $('pf-live-pw').value = ''; });
  $('pf-live-open').addEventListener('click', () => window.switchTab?.('live'));
}

/* ───────────── AI keys ───────────── */
async function loadAi() {
  const box = $('pf-ai-rows');
  try { renderAi(await api('/api/profile/ai-keys')); }
  catch (e) { box.innerHTML = `<div class="at-warn">Could not load: ${esc(e.message)}</div>`; }
}

function renderAi(d) {
  const warn = $('pf-ai-warn');
  warn.style.display = d.secret_ready ? 'none' : '';
  warn.textContent = d.secret_ready ? '' : 'The server has no APP_SECRET_KEY, so keys cannot be stored yet. Add APP_SECRET_KEY (a long random string) to backend/.env and restart.';
  $('pf-ai-rows').innerHTML = d.providers.map(p => `
    <div class="pf-ai-row" data-p="${p.provider}">
      <div class="pf-ai-head">
        <label class="at-check"><input type="radio" name="pf-ai-active" value="${p.provider}" ${d.active === p.provider ? 'checked' : ''}> Active</label>
        <b>${esc(p.label)}</b>
        <span class="at-chip ${p.set ? 'ok' : 'skip'}">${p.set ? 'Key saved ' + esc(p.masked) : (p.env_fallback ? 'Using the server key' : 'No key')}</span>
        ${p.problem ? `<span class="at-chip bad">${esc(p.problem)}</span>` : ''}
      </div>
      <div class="pf-ai-grid">
        <label>${p.set ? 'Replace key' : 'API key'}<input type="password" class="pf-ai-key" autocomplete="off" placeholder="${esc(p.key_hint)}"></label>
        <label>Model<input type="text" class="pf-ai-model" value="${esc(p.model)}" placeholder="${esc(p.default_model)}"></label>
      </div>
      <div class="pf-ai-actions">
        <button type="button" class="btn btn-primary btn-sm pf-ai-save">Save</button>
        <button type="button" class="btn btn-ghost btn-sm pf-ai-test" ${p.set || p.env_fallback ? '' : 'disabled'}>Test</button>
        <button type="button" class="btn btn-ghost btn-sm pf-ai-del" ${p.set ? '' : 'disabled'}>Remove key</button>
        <span class="small pf-ai-msg"></span>
      </div>
    </div>`).join('');
}

function wireAi() {
  const rows = $('pf-ai-rows');
  rows.addEventListener('click', async e => {
    const row = e.target.closest('.pf-ai-row'); if (!row) return;
    const p = row.dataset.p, msg = row.querySelector('.pf-ai-msg'), say2 = (t, ok = true) => { msg.style.color = ok ? 'var(--green)' : 'var(--down)'; msg.textContent = t; };
    try {
      if (e.target.closest('.pf-ai-save')) {
        const key = row.querySelector('.pf-ai-key').value.trim(), model = row.querySelector('.pf-ai-model').value.trim();
        await api(`/api/profile/ai-keys/${p}`, 'PUT', { key: key || undefined, model });
        await loadAi();
      } else if (e.target.closest('.pf-ai-del')) {
        if (!confirm('Remove the saved key for this provider?')) return;
        await api(`/api/profile/ai-keys/${p}`, 'DELETE'); await loadAi();
      } else if (e.target.closest('.pf-ai-test')) {
        say2('Testing…'); const r = await api(`/api/profile/ai-keys/${p}/test`, 'POST');
        say2(r.ok ? 'Works: ' + (r.reply || 'ok') : (r.error || 'Failed'), !!r.ok);
      }
    } catch (err) { say2(err.message, false); }
  });
  rows.addEventListener('change', async e => {
    if (e.target.name !== 'pf-ai-active') return;
    try { await api('/api/profile/ai-active', 'PUT', { provider: e.target.value }); } catch (err) { alert(err.message); loadAi(); }
  });
}

/* ───────────── boot ───────────── */
export async function initProfile(user) {
  me = user;
  fillMenu();
  $('profile-btn').addEventListener('click', e => {
    e.stopPropagation();
    const m = $('profile-menu'), open = m.style.display === 'none';
    m.style.display = open ? '' : 'none'; $('profile-btn').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.pf-wrap')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  $('profile-menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-pf]'); if (!b) return;
    if (b.dataset.pf === 'signout') { signOut(); return; }
    openProfile(b.dataset.pf);
  });
  document.querySelectorAll('.pf-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.pfTab)));
  $('pf-save-account').addEventListener('click', saveAccount);
  $('pf-email').addEventListener('input', () => { $('pf-email-pw-wrap').style.display = $('pf-email').value.trim().toLowerCase() !== (me?.email || '').toLowerCase() ? '' : 'none'; });
  $('pf-save-pw').addEventListener('click', savePassword);
  $('pf-signups').addEventListener('change', toggleSignups);
  $('pf-signout').addEventListener('click', signOut);
  $('pf-save-strat').addEventListener('click', saveStrategies);
  $('pf-all-strat').addEventListener('click', () => { document.querySelectorAll('.pf-strat-on').forEach(c => { c.checked = true; }); stratSummary(); });
  $('pf-strat-body').addEventListener('change', stratSummary);
  wireLive(); wireAi();
  document.addEventListener('prefs-changed', applyLiveVisibility);
  await loadPrefs();
  try { settings = await api('/api/profile/settings'); } catch { settings = null; }
  fillAccount(); renderStrategies(); applyLiveVisibility(); renderLive();
}
