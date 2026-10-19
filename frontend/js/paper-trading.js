'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { State } from './state.js';
import { yahooFetch, getPrice, _toYahooSym } from './market-data.js';
import { switchTab } from './app.js';
import { subscribeLivePrices } from './ws-prices.js';
import { loadLotSizes, lotSizeFor, tradedInLots } from './lot-sizes.js';

/* ═══════════════════════════════════════════
   MODULE: PAPER TRADING
═══════════════════════════════════════════ */
export async function refreshPaperTrading() {
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/portfolio', { cache: 'no-store' });
    const data = await res.json();
    DOM.setText('pt-capital', (+data.portfolio.capital).toLocaleString('en-IN'));
    DOM.setText('pt-margin', (+data.portfolio.used_margin).toLocaleString('en-IN'));
    DOM.setText('pt-realized', '₹' + (+data.portfolio.total_pnl).toLocaleString('en-IN'));
    DOM.setColor('pt-realized', data.portfolio.total_pnl >= 0 ? 'var(--green)' : 'var(--down)');

    State.ptPositions = data.positions;
    renderPTPositions();
    if (State.ptPositions.length > 0) paperTradingLoop();
    _subscribeWsForPositions();

    const rHist = await fetch(CONFIG.PROXY_BASE + '/api/paper/history', { cache: 'no-store' });
    const dHist = await rHist.json();
    renderPTHistory(dHist.history);
  } catch (e) { console.error('Paper trading fetch error:', e); }
}

export function renderPTPositions() {
  const tb = document.getElementById('pt-positions-body');
  if (!tb) return;
  if (!State.ptPositions.length) {
    tb.innerHTML = '<tr><td colspan="9" class="empty-cell">No active positions.</td></tr>';
    DOM.setText('pt-unrealized', '₹0');
    return;
  }
  tb.innerHTML = State.ptPositions.map(p => {
    const color = p.type === 'LONG' ? 'var(--green)' : 'var(--down)';
    return `<tr id="pt-row-${p.id}">
      <td style="font-weight:600">${DOM.esc(p.symbol)}</td>
      <td style="color:${color};font-weight:600">${DOM.esc(p.type)}</td>
      <td>${p.qty}</td>
      <td style="font-family:var(--font-mono)">${p.entry_price.toFixed(2)}</td>
      <td style="font-family:var(--font-mono)" id="pt-ltp-${p.id}">--</td>
      <td style="color:var(--down);font-family:var(--font-mono)">${p.sl.toFixed(2)}</td>
      <td style="color:var(--green);font-family:var(--font-mono)">${p.tp.toFixed(2)}</td>
      <td style="font-weight:600;font-family:var(--font-mono)" id="pt-pnl-${p.id}">--</td>
      <td>
        <button class="btn btn-sm btn-ghost" onclick="ptModifyPosition(${p.id}, ${p.sl.toFixed(2)}, ${p.tp.toFixed(2)})" style="margin-right:4px">Modify</button>
        <button class="btn btn-sm btn-danger" onclick="squareOffPosition(${p.id})">Exit</button>
      </td>
    </tr>`;
  }).join('');
}

export function renderPTHistory(hist) {
  const tb = document.getElementById('pt-history-body');
  if (!tb) return;
  if (!hist?.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-cell">No trade history yet.</td></tr>';
    return;
  }
  tb.innerHTML = hist.map(h => {
    const dc = h.type === 'LONG' ? 'var(--green)' : 'var(--down)';
    const pc = h.pnl > 0 ? 'var(--green)' : 'var(--down)';
    return `<tr>
      <td style="font-size:10px;color:var(--text3)">${DOM.esc(h.exit_time)}</td>
      <td style="font-weight:600">${DOM.esc(h.symbol)}</td>
      <td style="color:${dc}">${DOM.esc(h.type)}</td>
      <td>${h.qty}</td>
      <td style="font-family:var(--font-mono)">${h.entry_price.toFixed(2)}</td>
      <td style="font-family:var(--font-mono)">${h.exit_price.toFixed(2)}</td>
      <td style="color:${pc};font-weight:600;font-family:var(--font-mono)">${h.pnl > 0 ? '+' : ''}${h.pnl.toFixed(2)}</td>
      <td style="font-size:10px;color:var(--text3)">${DOM.esc(h.reason)}</td>
    </tr>`;
  }).join('');
}

export async function onPTSymSelect(sym) {
  if (!sym) return;
  // Indices and real option contracts trade in lots: default the quantity to one lot,
  // using the current lot size from the exchange contract list (never a hardcoded number).
  await loadLotSizes();
  const qId = document.getElementById('pt-qty');
  const lot = tradedInLots(sym) ? lotSizeFor(sym) : null;
  if (qId && lot) qId.value = lot;
  ptFetchLTP();
}

export async function executeVirtualTrade(symbol, type, qty, entry, sl, tp) {
  const req = {
    symbol,
    type: (type === 'BUY' || type === 'LONG') ? 'LONG' : 'SHORT',
    qty: parseInt(qty),
    entry_price: parseFloat(entry),
    sl: parseFloat(sl),
    tp: parseFloat(tp),
    price_symbol: _toYahooSym(symbol)
  };
  if (!req.qty || !req.entry_price) { alert('Invalid trade parameters'); return; }

  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (res.ok) { switchTab('paper'); refreshPaperTrading(); }
    else {
      const err = await res.json();
      alert('Paper Trade Failed: ' + (err.detail || 'Unknown error'));
    }
  } catch { alert('API connection failed — is the backend running?'); }
}

export async function executeCurrentSignal() {
  await loadLotSizes();
  const sym = document.getElementById('sh-sym-label')?.textContent || 'NIFTY 50';
  const badge = document.getElementById('nifty-signal-badge');  // other tabs reuse .badge-buy, so don't search the whole page
  const isBuy = !!badge?.querySelector('.badge-buy');
  const isSell = !!badge?.querySelector('.badge-sell');
  if (!isBuy && !isSell) { alert('No active BUY or SELL signal'); return; }
  const sig = isBuy ? 'LONG' : 'SHORT';
  const entry = document.getElementById('nl-entry')?.textContent;
  const sl = document.getElementById('nl-sl')?.textContent;
  const t1 = document.getElementById('nl-t1')?.textContent;
  if (!entry || entry === '--') { alert('Signal is not ready'); return; }
  const lot = tradedInLots(sym) ? lotSizeFor(sym) : null;
  const qty = parseInt(prompt(lot ? `Quantity for ${sym} (1 lot = ${lot}):` : `Quantity for ${sym}:`, String(lot || 1)));
  if (!qty || qty <= 0) return;
  executeVirtualTrade(sym, sig, qty, entry, sl, t1);
}

export async function executePaperTrade(symbol, signal, entry, sl, tp) {
  if (signal === 'HOLD') { alert('Signal is HOLD — cannot execute.'); return; }
  if (!entry || isNaN(entry)) { alert('Invalid entry price.'); return; }
  await loadLotSizes();
  const lot = tradedInLots(symbol) ? lotSizeFor(symbol) : null;
  const qty = parseInt(prompt(lot ? `Quantity for ${symbol} (1 lot = ${lot}):` : `Quantity for ${symbol}:`, String(lot || 100)));
  if (!qty || qty <= 0) return;
  executeVirtualTrade(symbol, signal, qty, entry, sl, tp);
}

const _exiting = new Set();  // the 5s poll and the live feed can both spot the same breach

export async function squareOffPosition(id, explicitPrice = null, reason = 'Manual Square Off') {
  const pos = State.ptPositions.find(p => p.id === id);
  if (!pos || _exiting.has(id)) return;
  _exiting.add(id);
  try {
    let exitPrice = explicitPrice;
    if (exitPrice === null) {
      const el = document.getElementById(`pt-ltp-${id}`);
      exitPrice = (el && el.textContent !== '--') ? parseFloat(el.textContent) : NaN;
      if (isNaN(exitPrice)) exitPrice = (await getPrice(_posToLiveSymbol(pos)))?.c ?? NaN;   // try a fresh price
      if (isNaN(exitPrice)) {
        const msg = `A live price for ${pos.symbol} is not available right now. Exit at the entry price (\u20b9${pos.entry_price.toFixed(2)}, zero profit/loss)?`;
        if (!confirm(msg)) return;
        exitPrice = pos.entry_price;
      }
    }
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/exit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, exit_price: exitPrice, reason })
    });
    if (res.ok) refreshPaperTrading();
  } catch (e) { console.error('Square off failed:', e); }
  finally { _exiting.delete(id); }
}

export async function resetPaperTrading() {
  if (!confirm('WARNING: Reset virtual portfolio? This will wipe all history and reset capital to ₹10,00,000.')) return;
  try {
    await fetch(CONFIG.PROXY_BASE + '/api/paper/reset', { method: 'POST' });
    refreshPaperTrading();
  } catch { alert('Reset failed'); }
}

// The price-feed symbol is decided once, when the order is placed (same resolver as the entry price),
// and saved with the position. Older positions without one are resolved the same way on the fly.
function _posToLiveSymbol(pos) {
  return pos.price_symbol || _toYahooSym(pos.symbol);
}

/** Update one position's LTP/PnL cells for a fresh price, and auto-exit on SL/TP breach.
 * Returns the unrealized PnL for this position (used to roll up the total). */
function _applyLtpToPosition(pos, ltp) {
  const upnl = pos.type === 'LONG' ? (ltp - pos.entry_price) * pos.qty : (pos.entry_price - ltp) * pos.qty;
  _upnlById.set(pos.id, upnl);
  _renderTotalUnrealized();   // keep the card in step with every row, not just at the end of a batch

  DOM.setText(`pt-ltp-${pos.id}`, ltp.toFixed(2));
  const pnlEl = document.getElementById(`pt-pnl-${pos.id}`);
  if (pnlEl) {
    pnlEl.textContent = (upnl > 0 ? '+' : '') + upnl.toFixed(2);
    pnlEl.style.color = upnl > 0 ? 'var(--green)' : upnl < 0 ? 'var(--down)' : 'var(--text)';
  }

  if (pos.type === 'LONG') {
    if (ltp <= pos.sl) squareOffPosition(pos.id, ltp, 'SL Hit');
    else if (ltp >= pos.tp) squareOffPosition(pos.id, ltp, 'Target Hit');
  } else {
    if (ltp >= pos.sl) squareOffPosition(pos.id, ltp, 'SL Hit');
    else if (ltp <= pos.tp) squareOffPosition(pos.id, ltp, 'Target Hit');
  }
  return upnl;
}

// Latest unrealized P&L per open position. Both the 5s poll and the live feed write here, and the total
// is always summed over every open position, so a push that only covers some symbols can't show a partial total.
const _upnlById = new Map();

function _renderTotalUnrealized() {
  const open = new Set(State.ptPositions.map(p => p.id));
  let total = 0;
  for (const [id, v] of _upnlById) {
    if (open.has(id)) total += v; else _upnlById.delete(id);
  }
  const tuEl = document.getElementById('pt-unrealized');
  if (tuEl) {
    tuEl.textContent = '₹' + total.toFixed(2);
    tuEl.style.color = total > 0 ? 'var(--green)' : total < 0 ? 'var(--down)' : 'var(--text)';
  }
}

// Fallback poller (every 5s regardless of the live feed). Prices are fetched in parallel, and a new run
// doesn't start while the previous one is still going, so slow lookups can't pile up.
let _loopRunning = false;
export async function paperTradingLoop() {
  if (!State.ptPositions.length || _loopRunning) return;
  _loopRunning = true;
  try {
    await Promise.all(State.ptPositions.map(async pos => {
      try {
        const j = await yahooFetch(_posToLiveSymbol(pos), '1m', '1d');
        const ltp = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (ltp) _applyLtpToPosition(pos, ltp);
      } catch { /* skip this position this round */ }
    }));
    _renderTotalUnrealized();
  } finally { _loopRunning = false; }
}

// Faster push-based path: subscribes the currently open positions' symbols to
// the /ws/prices socket (see ws-prices.js). Falls back gracefully — if the
// socket never connects, paperTradingLoop's 5s poll above keeps things fresh
// regardless, since this is a pure enhancement, not a replacement.
let _unsubscribeWs = null;
function _subscribeWsForPositions() {
  if (_unsubscribeWs) { _unsubscribeWs(); _unsubscribeWs = null; }
  if (!State.ptPositions.length) return;

  const symbols = [...new Set(State.ptPositions.map(_posToLiveSymbol))];
  _unsubscribeWs = subscribeLivePrices(symbols, (prices) => {
    for (const pos of State.ptPositions) {
      const ltp = prices[_posToLiveSymbol(pos)];
      if (ltp != null) _applyLtpToPosition(pos, ltp);
    }
    _renderTotalUnrealized();
  });
}

/* ═══════════════════════════════════════════
   MODULE: PAPER TRADING — ORDER FORM
   Full order entry panel with Market/Limit/SL.
═══════════════════════════════════════════ */
let _ptDir = 'LONG';

export function ptSetDir(dir) {
  _ptDir = dir;
  document.getElementById('pt-long-btn')?.classList.toggle('active', dir === 'LONG');
  document.getElementById('pt-short-btn')?.classList.toggle('active', dir === 'SHORT');
}

export function ptOrderTypeChange() {
  const ot = document.getElementById('pt-order-type')?.value;
  const priceRow = document.getElementById('pt-price-row');
  const triggerRow = document.getElementById('pt-trigger-row');
  if (ot === 'MARKET' || ot === 'SL-M') {
    if (priceRow) priceRow.style.display = (ot === 'MARKET') ? 'none' : '';
    if (triggerRow) triggerRow.style.display = (ot === 'SL-M') ? '' : 'none';
  } else {
    if (priceRow) priceRow.style.display = '';
    if (triggerRow) triggerRow.style.display = (ot === 'SL') ? '' : 'none';
  }
}

export async function ptFetchLTP() {
  const sym = (document.getElementById('pt-sym')?.value || '').trim();
  if (!sym) { alert('Enter a symbol first.'); return; }
  const status = document.getElementById('pt-order-status');
  if (status) status.textContent = 'Fetching LTP...';
  const d = await getPrice(_toYahooSym(sym));
  if (!d) { if (status) status.textContent = '\u26a0 Could not fetch price'; return; }
  const ltp = d.c.toFixed(2);
  const priceInp = document.getElementById('pt-price');
  if (priceInp) priceInp.value = ltp;
  const label = document.getElementById('pt-ltp-label');
  if (label) label.textContent = `LTP: \u20b9${ltp}`;
  if (status) { status.textContent = `\u2713 LTP: \u20b9${ltp}`; status.style.color = 'var(--clr-green)'; }
}

export function ptAutoFillSignal() {
  // Fill order form from the current Nifty Live signal
  const sym = document.getElementById('sh-sym-label')?.textContent?.replace(' — INTRADAY SIGNAL', '').trim() || 'NIFTY 50';
  const entry = document.getElementById('nl-entry')?.textContent?.replace(/,/g, '');
  const sl = document.getElementById('nl-sl')?.textContent?.replace(/,/g, '');
  const t1 = document.getElementById('nl-t1')?.textContent?.replace(/,/g, '');
  const badge = document.getElementById('nifty-signal-badge');  // other tabs reuse .badge-buy, so don't search the whole page
  const isBuy = !!badge?.querySelector('.badge-buy');
  const isSell = !!badge?.querySelector('.badge-sell');
  if (document.getElementById('pt-sym')) document.getElementById('pt-sym').value = sym;
  if (entry && entry !== '--' && document.getElementById('pt-price')) document.getElementById('pt-price').value = entry;
  if (sl && sl !== '--' && document.getElementById('pt-sl-input')) document.getElementById('pt-sl-input').value = sl;
  if (t1 && t1 !== '--' && document.getElementById('pt-target-input')) document.getElementById('pt-target-input').value = t1;
  if (isBuy || isSell) ptSetDir(isBuy ? 'LONG' : 'SHORT');
  const status = document.getElementById('pt-order-status');
  if (status && (isBuy || isSell)) { status.textContent = '\u2713 Signal loaded'; status.style.color = 'var(--clr-green)'; }
  else if (status) { status.textContent = '\u26a0 No active BUY/SELL signal \u2014 levels loaded, pick the direction yourself'; status.style.color = 'var(--clr-red)'; }
}

export async function ptPlaceOrder() {
  const sym = (document.getElementById('pt-sym')?.value || '').trim().toUpperCase();
  const ot = document.getElementById('pt-order-type')?.value || 'MARKET';
  const product = document.getElementById('pt-product')?.value || 'MIS';
  const qty = parseInt(document.getElementById('pt-qty')?.value || '0');
  const slVal = parseFloat(document.getElementById('pt-sl-input')?.value || '0');
  const tpVal = parseFloat(document.getElementById('pt-target-input')?.value || '0');
  const status = document.getElementById('pt-order-status');

  const setStatus = (msg, color = 'var(--clr-text-3)') => {
    if (status) { status.textContent = msg; status.style.color = color; }
  };

  if (!sym) { setStatus('\u26a0 Enter a symbol', 'var(--clr-red)'); return; }
  if (!qty || qty <= 0) { setStatus('\u26a0 Enter quantity', 'var(--clr-red)'); return; }
  if (!slVal || slVal <= 0) { setStatus('\u26a0 Enter stop loss', 'var(--clr-red)'); return; }
  if (!tpVal || tpVal <= 0) { setStatus('\u26a0 Enter target', 'var(--clr-red)'); return; }

  setStatus('Fetching price...', 'var(--clr-text-3)');
  let entryPrice = parseFloat(document.getElementById('pt-price')?.value || '0');
  if (!entryPrice || ot === 'MARKET') {
    const d = await getPrice(_toYahooSym(sym));
    if (!d) { setStatus('\u26a0 Could not fetch market price', 'var(--clr-red)'); return; }
    entryPrice = d.c;
  }

  const body = {
    symbol: sym, type: _ptDir, qty, entry_price: entryPrice,
    sl: slVal, tp: tpVal, order_type: ot, product,
    price_symbol: _toYahooSym(sym)
  };

  setStatus('Placing order...', 'var(--clr-text-3)');
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      setStatus(`\u2713 Order placed! ID #${data.id} | Margin: \u20b9${data.margin_used?.toLocaleString('en-IN')}`, 'var(--clr-green)');
      refreshPaperTrading();
      // Clear form
      ['pt-sym','pt-price','pt-sl-input','pt-target-input','pt-trigger'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('pt-qty').value = '1';
    } else {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      setStatus('\u26a0 ' + (err.detail || 'Order failed'), 'var(--clr-red)');
    }
  } catch { setStatus('\u26a0 Cannot reach backend — is it running?', 'var(--clr-red)'); }
}

export async function ptModifyPosition(id, currentSl, currentTp) {
  const newSl = parseFloat(prompt('New Stop Loss:', currentSl));
  const newTp = parseFloat(prompt('New Target:', currentTp));
  if (isNaN(newSl) || isNaN(newTp)) return;
  try {
    const res = await fetch(`${CONFIG.PROXY_BASE}/api/paper/position/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sl: newSl, tp: newTp })
    });
    if (res.ok) { refreshPaperTrading(); }
    else { alert('Modify failed'); }
  } catch { alert('Cannot reach backend'); }
}

export async function _fetchDayStats() {
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/paper/stats');
    if (!res.ok) return;
    const s = await res.json();
    const col = (v) => v >= 0 ? 'var(--clr-green)' : 'var(--clr-red)';
    DOM.setText('pt-day-pnl', '\u20b9' + (s.day_pnl >= 0 ? '+' : '') + s.day_pnl.toFixed(2));
    DOM.setColor('pt-day-pnl', col(s.day_pnl));
    DOM.setText('pt-net-day-pnl', '\u20b9' + (s.net_day_pnl >= 0 ? '+' : '') + s.net_day_pnl.toFixed(2));
    DOM.setColor('pt-net-day-pnl', col(s.net_day_pnl));
    DOM.setText('pt-day-trades', s.trades_today);
    DOM.setText('pt-win-rate', s.win_rate + '%');
  } catch { /* stats not critical */ }
}
