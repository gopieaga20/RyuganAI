'use strict';

import { CONFIG } from './config.js';
import { parseOptionSymbol } from './symbols.js';

/* ═══════════════════════════════════════════
   MODULE: LOT SIZES
   Lot sizes change over time, so they are never hardcoded: they come from the
   backend (/api/lot-sizes), which reads the exchange contract list.
═══════════════════════════════════════════ */

let _sizes = {};
let _loading = null;

// Index names as they appear around the app -> the F&O underlying name.
const INDEX_ALIASES = {
  '^NSEI': 'NIFTY', 'NIFTY 50': 'NIFTY', 'NIFTY': 'NIFTY',
  '^NSEBANK': 'BANKNIFTY', 'BANK NIFTY': 'BANKNIFTY', 'BANKNIFTY': 'BANKNIFTY',
  'FINNIFTY': 'FINNIFTY', 'MIDCPNIFTY': 'MIDCPNIFTY', 'NIFTYNXT50': 'NIFTYNXT50',
  '^BSESN': 'SENSEX', 'SENSEX': 'SENSEX', 'BANKEX': 'BANKEX',
};

/** Fetch the lot-size table once (cached). Always resolves; on failure the table stays empty. */
export function loadLotSizes() {
  if (!_loading) {
    _loading = fetch(`${CONFIG.PROXY_BASE}/api/lot-sizes`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { _sizes = d?.lot_sizes || {}; if (!Object.keys(_sizes).length) _loading = null; return _sizes; })
      .catch(() => { _loading = null; return _sizes; });
  }
  return _loading;
}

function underlyingOf(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return null;
  const contract = parseOptionSymbol(s);
  if (contract) return { name: contract.underlying, inLots: true };
  if (INDEX_ALIASES[s]) return { name: INDEX_ALIASES[s], inLots: true };
  // Legacy spaced option names such as "NIFTY 24 MAR 23100 CE" / "BANK NIFTY 50000 PE"
  const legacy = s.match(/^(BANK NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTY(?: 50)?)\b.*\b(?:CE|PE)$/);
  if (legacy) return { name: INDEX_ALIASES[legacy[1]], inLots: true };
  return { name: s.replace(/\.NS$/, '').replace(/-EQ$/, ''), inLots: false };
}

/** Lot size for an index, stock or contract symbol, or null if unknown / not loaded yet. */
export function lotSizeFor(symbol) {
  const u = underlyingOf(symbol);
  return (u && _sizes[u.name]) || null;
}

/** True for indices and real option contracts, which are normally traded in lots. */
export function tradedInLots(symbol) {
  return !!underlyingOf(symbol)?.inLots;
}
