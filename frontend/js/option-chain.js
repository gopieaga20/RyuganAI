'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { analyzeFO } from './signals.js';

/* ═══════════════════════════════════════════
   MODULE: LIVE OPTION CHAIN
   Real strikes/OI/LTP from /api/fo/option-chain (Angel One), shown alongside
   the AI/algorithmic F&O approximation in analyzeFO(). Degrades to a plain
   message if the Angel session/key isn't available — never fakes data.
═══════════════════════════════════════════ */

let _lastUnderlying = null;
let _highlight = null; // { strike, type } of a contract the user picked, if any

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/** Split a real contract symbol like NIFTY27OCT2623100CE into its parts, or null if it isn't one. */
export function parseOptionSymbol(raw) {
  const m = String(raw || '').trim().toUpperCase().match(/^([A-Z0-9][A-Z0-9&-]*?)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$/);
  if (!m || !MONTHS[m[3]]) return null;
  return { underlying: m[1], expiry: `${m[2]}${m[3]}20${m[4]}`, strike: Number(m[5]), type: m[6] };
}

/** ANALYZE F&O: accepts an underlying (NIFTY) or a contract (NIFTY27OCT2623100CE).
 *  A contract is resolved to its underlying + expiry, and its strike is highlighted in the chain. */
export function runFoAnalysis() {
  const input = document.getElementById('fo-sym');
  const raw = (input?.value || '').trim();
  const contract = parseOptionSymbol(raw);
  let underlying = raw.toUpperCase() || 'NIFTY';
  let expiry = null;
  _highlight = null;
  if (contract) {
    underlying = contract.underlying;
    expiry = contract.expiry;
    _highlight = { strike: contract.strike, type: contract.type };
    if (input) input.value = underlying; // the approximation cards need the underlying, not the contract
  }
  analyzeFO();
  loadOptionChain(underlying, expiry);
}

export async function loadOptionChain(underlying, expiry = null) {
  const sym = (underlying || _lastUnderlying ||
    document.getElementById('fo-sym')?.value?.trim().toUpperCase() || 'NIFTY');
  _lastUnderlying = sym;

  const area = document.getElementById('oc-area');
  const expirySelect = document.getElementById('oc-expiry-select');
  if (area) area.innerHTML = '<div class="empty-state"><span class="spinr"></span> Loading live option chain…</div>';

  try {
    let url = `${CONFIG.PROXY_BASE}/api/fo/option-chain?underlying=${encodeURIComponent(sym)}&strikes=10`;
    if (expiry) url += `&expiry=${encodeURIComponent(expiry)}`;
    if (_highlight) url += `&center=${_highlight.strike}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (area) area.innerHTML = `<div class="empty-state">${DOM.esc(err.detail || `Live option chain unavailable (${res.status}).`)}</div>`;
      if (expirySelect) expirySelect.style.display = 'none';
      return;
    }
    const data = await res.json();
    _renderOptionChain(data);
  } catch (e) {
    if (area) area.innerHTML = '<div class="empty-state">Could not reach backend for the option chain.</div>';
  }
}

function _renderOptionChain(data) {
  const area = document.getElementById('oc-area');
  const badge = document.getElementById('oc-spot-badge');
  const expirySelect = document.getElementById('oc-expiry-select');
  if (!area) return;

  if (badge) badge.textContent = data.spot ? `· Spot ${data.spot.toLocaleString('en-IN')}` : '';

  if (expirySelect && data.expiries?.length) {
    expirySelect.style.display = '';
    expirySelect.innerHTML = data.expiries.map(e =>
      `<option value="${e}"${e === data.expiry ? ' selected' : ''}>${e}</option>`
    ).join('');
  }

  if (!data.rows?.length) {
    area.innerHTML = '<div class="empty-state">No strikes returned.</div>';
    return;
  }

  const fmtNum = (v) => (v == null ? '--' : Math.round(v).toLocaleString('en-IN'));
  const fmtChg = (v) => (v == null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  const step = data.rows.length > 1 ? Math.abs(data.rows[1].strike - data.rows[0].strike) : 50;

  const rowsHtml = data.rows.map(r => {
    const isAtm = data.spot != null && Math.abs(r.strike - data.spot) < step / 2;
    const isPicked = _highlight && r.strike === _highlight.strike;
    const ce = r.ce, pe = r.pe;
    const ceCls = ce?.change_pct > 0 ? 'up' : ce?.change_pct < 0 ? 'down' : '';
    const peCls = pe?.change_pct > 0 ? 'up' : pe?.change_pct < 0 ? 'down' : '';
    const rowStyle = [isAtm ? 'background:var(--clr-pale-green)' : '', isPicked ? 'outline:2px solid var(--clr-blue);outline-offset:-2px' : '']
      .filter(Boolean).join(';');
    return `<tr${rowStyle ? ` style="${rowStyle}"` : ''}>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(ce?.oi)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(ce?.volume)}</td>
      <td class="${ceCls}" style="font-family:var(--font-mono);font-weight:600;">${ce?.ltp ?? '--'}</td>
      <td class="${ceCls}" style="font-size:11px;">${fmtChg(ce?.change_pct)}</td>
      <td style="font-family:var(--font-mono);font-weight:700;text-align:center;background:var(--clr-bg-2);">${r.strike.toLocaleString('en-IN')}${isPicked ? ` <span style="color:var(--clr-blue)">◀ ${_highlight.type}</span>` : ''}</td>
      <td class="${peCls}" style="font-size:11px;">${fmtChg(pe?.change_pct)}</td>
      <td class="${peCls}" style="font-family:var(--font-mono);font-weight:600;">${pe?.ltp ?? '--'}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(pe?.volume)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(pe?.oi)}</td>
    </tr>`;
  }).join('');

  area.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="dtbl" style="min-width:640px;">
      <thead>
        <tr>
          <th colspan="4" style="text-align:center;color:var(--clr-green-dk);">CALLS</th>
          <th>Strike</th>
          <th colspan="4" style="text-align:center;color:var(--clr-red);">PUTS</th>
        </tr>
        <tr>
          <th>OI</th><th>Vol</th><th>LTP</th><th>Chg%</th>
          <th></th>
          <th>Chg%</th><th>LTP</th><th>Vol</th><th>OI</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    </div>`;
}
