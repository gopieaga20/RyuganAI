'use strict';

import { CONFIG } from './config.js';

/* ═══════════════════════════════════════════
   MODULE: LIVE PRICE WEBSOCKET
   Thin client for /ws/prices. Pushes LTP updates every few seconds
   for a set of symbols. Callers that already poll (fetchLiveTickers,
   paperTradingLoop) keep their existing timers as a fallback — this
   module only makes updates arrive faster when the socket is up.
═══════════════════════════════════════════ */

let _ws = null;
let _connected = false;
let _symbols = new Set();
let _listeners = new Set();
let _reconnectTimer = null;
let _reconnectDelay = 3000;

function _wsUrl() {
  const base = CONFIG.PROXY_BASE || window.location.origin;
  return base.replace(/^http/, 'ws') + '/ws/prices';
}

function _resendSymbols() {
  if (_ws && _ws.readyState === WebSocket.OPEN && _symbols.size > 0) {
    _ws.send(JSON.stringify({ symbols: Array.from(_symbols) }));
  }
}

function _connect() {
  clearTimeout(_reconnectTimer);
  if (_symbols.size === 0) return;
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    _resendSymbols();
    return;
  }

  try {
    _ws = new WebSocket(_wsUrl());
  } catch {
    _connected = false;
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    _reconnectDelay = 3000;
    _resendSymbols();
  };

  _ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && data.prices) {
        _listeners.forEach(fn => { try { fn(data.prices); } catch { /* listener error, ignore */ } });
      }
    } catch { /* malformed frame, ignore */ }
  };

  _ws.onclose = () => {
    _connected = false;
    // Exponential backoff up to 30s; callers' own polling covers the gap meanwhile.
    _reconnectTimer = setTimeout(_connect, _reconnectDelay);
    _reconnectDelay = Math.min(_reconnectDelay * 2, 30000);
  };

  _ws.onerror = () => {
    _connected = false;
  };
}

/**
 * Subscribe to live price pushes for the given symbols.
 * onUpdate(pricesMap) is called whenever a push arrives (pricesMap may be
 * a partial set — only symbols the backend could resolve this tick).
 * Returns an unsubscribe function.
 */
export function subscribeLivePrices(symbols, onUpdate) {
  symbols.forEach(s => _symbols.add(s));
  _listeners.add(onUpdate);
  _connect();
  return () => {
    _listeners.delete(onUpdate);
  };
}

export function isLiveConnected() {
  return _connected;
}
