'use strict';

import { DOM } from './dom-utils.js';
import { getPrice, _toYahooSym } from './market-data.js';

/* ═══════════════════════════════════════════
   MODULE: WATCHLIST MANAGER
   Multi-list, sessionStorage-backed watchlist.
═══════════════════════════════════════════ */
export const WL = (() => {
  const SK = 'ryugan_wl';
  const DEFAULTS = {
    'Nifty 50': ['NIFTY 50', 'BANK NIFTY', 'SENSEX'],
    'FnO Stocks': ['RELIANCE', 'HDFC BANK', 'INFOSYS', 'TCS', 'ICICI BANK'],
    'Bank Nifty Options': ['BANK NIFTY', 'HDFC BANK', 'ICICI BANK', 'AXISBANK', 'KOTAKBANK'],
  };
  let state = { lists: {}, active: 'Nifty 50' };

  function load() {
    try {
      const raw = sessionStorage.getItem(SK);
      if (raw) state = JSON.parse(raw);
      if (!state.lists || Object.keys(state.lists).length === 0) state.lists = { ...DEFAULTS };
    } catch { state = { lists: { ...DEFAULTS }, active: 'Nifty 50' }; }
  }
  function save() { sessionStorage.setItem(SK, JSON.stringify(state)); }

  function renderSelect() {
    const sel = document.getElementById('wl-list-select');
    if (!sel) return;
    sel.innerHTML = Object.keys(state.lists).map(name =>
      `<option value="${DOM.esc(name)}" ${name === state.active ? 'selected' : ''}>${DOM.esc(name)}</option>`
    ).join('');
  }

  async function renderItems() {
    const container = document.getElementById('wl-items');
    if (!container) return;
    const syms = state.lists[state.active] || [];
    if (syms.length === 0) {
      container.innerHTML = '<div class="empty-state">No symbols. Add one above.</div>';
      return;
    }
    // Show placeholder rows immediately then fill with prices
    container.innerHTML = syms.map((s, i) =>
      `<div class="witem" id="wl-row-${i}" onclick="qs('${DOM.esc(s)}');generateSignal()">
        <div><div class="wi-sym">${DOM.esc(s)}</div></div>
        <div class="wi-price" id="wl-price-${i}">...</div>
        <div class="wi-chg" id="wl-chg-${i}" style="font-size:10px;min-width:52px;text-align:right">--</div>
        <button class="btn btn-sm btn-ghost" style="padding:3px 8px;font-size:10px;margin-left:6px"
          onclick="event.stopPropagation();WL.removeSymbol('${DOM.esc(s)}')" title="Remove">\u00d7</button>
      </div>`
    ).join('');

    // Fetch prices concurrently
    await Promise.all(syms.map(async (s, i) => {
      const d = await getPrice(_toYahooSym(s));
      const priceEl = document.getElementById(`wl-price-${i}`);
      const chgEl = document.getElementById(`wl-chg-${i}`);
      if (!priceEl) return;
      if (!d) { priceEl.textContent = '--'; return; }
      const fmt = d.c.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const chg = (d.pct >= 0 ? '\u25b2 +' : '\u25bc ') + d.pct.toFixed(2) + '%';
      const col = d.pct >= 0 ? 'var(--clr-green)' : 'var(--clr-red)';
      priceEl.textContent = fmt;
      priceEl.style.color = col;
      if (chgEl) { chgEl.textContent = chg; chgEl.style.color = col; }
    }));
  }

  return {
    init() { load(); renderSelect(); renderItems(); },

    switchList(name) {
      state.active = name;
      save();
      renderItems();
    },

    refresh() { renderItems(); },

    addSymbol() {
      const inp = document.getElementById('wl-add-sym');
      const sym = (inp?.value || '').trim().toUpperCase();
      if (!sym) return;
      if (!state.lists[state.active]) state.lists[state.active] = [];
      if (!state.lists[state.active].includes(sym)) {
        state.lists[state.active].push(sym);
        save();
      }
      if (inp) inp.value = '';
      renderItems();
    },

    removeSymbol(sym) {
      const list = state.lists[state.active];
      if (list) {
        const idx = list.indexOf(sym);
        if (idx > -1) { list.splice(idx, 1); save(); renderItems(); }
      }
    },

    promptNewList() {
      const name = prompt('Enter watchlist name (e.g. "Nifty CE Options"):');
      if (!name?.trim()) return;
      const clean = name.trim();
      if (!state.lists[clean]) { state.lists[clean] = []; save(); }
      state.active = clean;
      renderSelect();
      renderItems();
    },

    deleteList(name) {
      if (Object.keys(state.lists).length <= 1) { alert('Cannot delete the last list.'); return; }
      if (!confirm(`Delete watchlist "${name}"?`)) return;
      delete state.lists[name];
      state.active = Object.keys(state.lists)[0];
      save();
      renderSelect();
      renderItems();
    }
  };
})();
