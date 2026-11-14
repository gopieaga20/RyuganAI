'use strict';
/* Login / register gate and the one fetch wrapper that makes every API call carry the session.

   Imported first by app.js, so the wrapper is in place before any other module fetches. No module needed changing: they all call
   fetch('/api/...') and this adds the cookie and our CSRF header, and shows the login screen when the server answers 401. */

import { CONFIG } from './config.js';

const API = CONFIG.PROXY_BASE;
const realFetch = window.fetch.bind(window);
let lost = false;                     // the session ended: answer API calls locally until the user signs in again
let bootResolve = null;               // set while the page waits for the first login
let status = null;

function isApiUrl(url) {
  try {
    const u = new URL(url, location.href), base = API ? new URL(API) : location;
    return u.origin === base.origin && u.pathname.startsWith('/api');
  } catch { return false; }
}
const isAuthUrl = url => { try { return new URL(url, location.href).pathname.startsWith('/api/auth/'); } catch { return false; } };

export function installFetch() {
  window.fetch = async (input, init = {}) => {
    if (typeof input !== 'string' || !isApiUrl(input)) return realFetch(input, init);
    if (lost && !isAuthUrl(input)) return new Response(JSON.stringify({ detail: 'Sign in required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const headers = new Headers(init.headers || {});
    headers.set('X-Requested-With', 'ryugan');
    const res = await realFetch(input, { ...init, headers, credentials: API ? 'include' : 'same-origin' });
    if (res.status === 401 && !isAuthUrl(input)) showGate({ expired: true });
    return res;
  };
}
installFetch();

const $ = id => document.getElementById(id);
let mode = 'login';

function setMode(m) {
  mode = m;
  const reg = m === 'register';
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('auth-name-wrap').style.display = reg ? '' : 'none';
  $('auth-hint').style.display = reg ? '' : 'none';
  $('auth-password').autocomplete = reg ? 'new-password' : 'current-password';
  $('auth-submit').textContent = reg ? 'Create account' : 'Sign in';
  $('auth-err').textContent = '';
  $('auth-note').textContent = reg
    ? (status && !status.has_owner ? 'First time here: this account becomes the owner of the app.' : 'Create your account.')
    : (status && !status.has_owner ? 'No account exists yet. Create the owner account first.' : '');
}

export function showGate({ expired = false } = {}) {
  lost = true;
  const gate = $('auth-gate'); if (!gate) return;
  gate.style.display = '';
  applyTabs();
  if (expired && !bootResolve) $('auth-note').textContent = 'Your session ended. Please sign in again.';
  setTimeout(() => $('auth-email')?.focus(), 30);
  // the sign-up rules may have changed since the page loaded: ask again, then fix the tabs
  window.fetch(API + '/api/auth/status', { cache: 'no-store' }).then(r => r.json()).then(s => {
    status = s;
    const note = $('auth-note').textContent, keep = expired && !bootResolve;
    applyTabs(); if (keep) $('auth-note').textContent = note;
  }).catch(() => { });
}

function applyTabs() {
  const canRegister = !status || !status.has_owner || status.signups_open;
  $('auth-tab-register').style.display = canRegister ? '' : 'none';
  $('auth-tabs').style.display = canRegister ? '' : 'none';
  setMode(status && !status.has_owner ? 'register' : (canRegister ? mode : 'login'));
}

async function submit(ev) {
  ev.preventDefault();
  const err = $('auth-err'), btn = $('auth-submit');
  err.textContent = ''; btn.disabled = true;
  try {
    const body = { email: $('auth-email').value.trim(), password: $('auth-password').value };
    if (mode === 'register') body.display_name = $('auth-name').value.trim();
    const res = await window.fetch(API + (mode === 'register' ? '/api/auth/register' : '/api/auth/login'),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = Array.isArray(data.detail) ? 'Check the email and password.' : (data.detail || `Could not sign in (HTTP ${res.status})`); return; }
    $('auth-password').value = '';
    lost = false;
    $('auth-gate').style.display = 'none';
    if (bootResolve) { const r = bootResolve; bootResolve = null; r(data.user); }
    else location.reload();                     // the session ended while the app was open: start clean
  } catch (e) { err.textContent = 'Cannot reach the server.'; }
  finally { btn.disabled = false; }
}

/** Resolves with the signed-in user: straight away when a session exists (or login is switched off), otherwise after the login screen. */
export async function requireLogin() {
  try {
    const res = await window.fetch(API + '/api/auth/status', { cache: 'no-store' });
    status = await res.json();
  } catch { status = null; }
  if (status && (!status.auth_required || status.user)) return status.user;
  document.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('auth-form').addEventListener('submit', submit);
  return new Promise(resolve => { bootResolve = resolve; showGate(); });
}

export async function signOut() {
  try { await window.fetch(API + '/api/auth/logout', { method: 'POST' }); } catch { }
  location.reload();
}
