'use strict';

import { CONFIG } from './config.js';

/* ═══════════════════════════════════════════
   MODULE: STOCK / F&O UNDERLYING BROWSER
   Shared searchable modal fed by the backend's full symbol lists
   (/api/stocks — ~2700 NSE equities, /api/fo/underlyings — all F&O names).
═══════════════════════════════════════════ */

const _cache = {}; // { 'stocks' | 'fo' -> [{symbol, name}] }
let _onSelect = null;
let _currentItems = [];

async function _loadItems(kind) {
  if (_cache[kind]) return _cache[kind];
  const url = kind === 'fo'
    ? CONFIG.PROXY_BASE + '/api/fo/underlyings'
    : CONFIG.PROXY_BASE + '/api/stocks';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${kind} list (${res.status})`);
  const data = await res.json();
  const items = kind === 'fo' ? (data.underlyings || []) : (data.stocks || []);
  _cache[kind] = items;
  return items;
}

function _renderList(items) {
  const list = document.getElementById('sb-modal-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="sb-modal-empty">No matches.</div>';
    return;
  }
  const top = items.slice(0, 200); // cap DOM size; search narrows it down
  list.innerHTML = top.map(it => `
    <div class="sb-modal-item" data-sym="${it.symbol.replace(/"/g, '&quot;')}">
      <span class="sb-sym">${it.symbol}</span>
      <span class="sb-name">${(it.name || '').replace(/</g, '&lt;')}</span>
    </div>`).join('');
  list.querySelectorAll('.sb-modal-item').forEach(el => {
    el.addEventListener('click', () => {
      const sym = el.getAttribute('data-sym');
      const cb = _onSelect; // capture before closeStockBrowser() clears it
      closeStockBrowser();
      if (cb) cb(sym);
    });
  });
}

export async function openStockBrowser(kind, onSelect) {
  _onSelect = onSelect;
  const backdrop = document.getElementById('sb-modal-backdrop');
  const title = document.getElementById('sb-modal-title');
  const search = document.getElementById('sb-modal-search');
  if (!backdrop) return;

  title.textContent = kind === 'fo' ? 'Browse F&O Underlyings' : 'Browse All NSE Stocks';
  search.value = '';
  document.getElementById('sb-modal-list').innerHTML = '<div class="sb-modal-empty">Loading…</div>';
  backdrop.style.display = 'flex';
  search.focus();

  try {
    _currentItems = await _loadItems(kind);
    _renderList(_currentItems);
  } catch (e) {
    document.getElementById('sb-modal-list').innerHTML =
      `<div class="sb-modal-empty">Could not load list: ${e.message}</div>`;
  }
}

export function closeStockBrowser() {
  const backdrop = document.getElementById('sb-modal-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  _onSelect = null;
}

document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('sb-modal-search');
  const backdrop = document.getElementById('sb-modal-backdrop');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toUpperCase();
      const filtered = q
        ? _currentItems.filter(it => it.symbol.includes(q) || (it.name || '').toUpperCase().includes(q))
        : _currentItems;
      _renderList(filtered);
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) closeStockBrowser();
    });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeStockBrowser();
  });
});
