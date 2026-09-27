'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';

/* ═══════════════════════════════════════════
   MODULE: LIVE OPTION CHAIN
   Real strikes/OI/LTP from /api/fo/option-chain (Angel One), shown alongside
   the AI/algorithmic F&O approximation in analyzeFO(). Degrades to a plain
   message if the Angel session/key isn't available — never fakes data.
═══════════════════════════════════════════ */

let _lastUnderlying = null;

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
    const ce = r.ce, pe = r.pe;
    const ceCls = ce?.change_pct > 0 ? 'up' : ce?.change_pct < 0 ? 'down' : '';
    const peCls = pe?.change_pct > 0 ? 'up' : pe?.change_pct < 0 ? 'down' : '';
    return `<tr${isAtm ? ' style="background:var(--clr-pale-green)"' : ''}>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(ce?.oi)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${fmtNum(ce?.volume)}</td>
      <td class="${ceCls}" style="font-family:var(--font-mono);font-weight:600;">${ce?.ltp ?? '--'}</td>
      <td class="${ceCls}" style="font-size:11px;">${fmtChg(ce?.change_pct)}</td>
      <td style="font-family:var(--font-mono);font-weight:700;text-align:center;background:var(--clr-bg-2);">${r.strike.toLocaleString('en-IN')}</td>
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
