'use strict';

import { DOM } from './dom-utils.js';
import { State } from './state.js';
import { WL } from './watchlist.js';
import { fetchLiveTickers, fetchGlobalCues, debounceSearch } from './market-data.js';
import { refreshNiftySignal, generateSignal, qs, generateMorningBrief, analyzeFO, loadSectors } from './signals.js';
import { askA, sendChat } from './chat.js';
import {
  toggleStrat, btFetchData, runBacktest, btReset, filterTrades,
  initReplay, rStep, togglePlay, getAIReview, askAIQa,
  saveBacktestResult, loadBacktestHistory, onBtTimeframeChange,
  updateBTSegment, applyBtLotSize
} from './backtest.js';
import { loadLotSizes } from './lot-sizes.js';
import {
  refreshPaperTrading, resetPaperTrading, paperTradingLoop, _fetchDayStats,
  onPTSymSelect, ptSetDir, ptOrderTypeChange, ptPlaceOrder, ptFetchLTP, ptAutoFillSignal,
  executeCurrentSignal, executePaperTrade, squareOffPosition, ptModifyPosition, cancelPTOrder
} from './paper-trading.js';
import { openStockBrowser, closeStockBrowser } from './stock-browser.js';
import { loadOptionChain, runFoAnalysis } from './option-chain.js';
import { initDash, onThemeChange } from './dash.js';
import { initAutoTrade, refreshAutoTrade } from './autotrade.js';

/* ═══════════════════════════════════════════
   MODULE: LOADING
═══════════════════════════════════════════ */
export function showOv(msg = 'LOADING...') {
  DOM.setText('ovMsg', msg);
  document.getElementById('ov')?.classList.add('show');
}

export function hideOv() {
  document.getElementById('ov')?.classList.remove('show');
}

/* ═══════════════════════════════════════════
   MODULE: CLOCK & MARKET STATUS
═══════════════════════════════════════════ */
export function tick() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  const s = String(ist.getSeconds()).padStart(2, '0');
  DOM.setText('clock', `${h}:${m}:${s} IST`);
  const open = ist.getHours() >= 9 && (ist.getHours() < 15 || (ist.getHours() === 15 && ist.getMinutes() <= 30));
  const pulse = document.getElementById('mpulse');
  const statusEl = document.getElementById('mstatus-txt');
  if (pulse) pulse.style.background = open ? 'var(--green)' : 'var(--down)';
  if (statusEl) {
    statusEl.textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
    statusEl.style.color = open ? 'var(--green)' : 'var(--down)';
  }
}
setInterval(tick, 1000);
tick();

/* ═══════════════════════════════════════════
   MODULE: TAB NAVIGATION
═══════════════════════════════════════════ */
const ALL_TABS = ['dash', 'nifty', 'signals', 'morning', 'fo', 'sectors', 'backtest', 'analyst', 'tradelog', 'paper'];
export function switchTab(t) {
  if (!ALL_TABS.includes(t)) return;
  // Update sidebar nav active state
  document.querySelectorAll('.nav-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === t);
  });
  // Switch visible tab pane
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${t}`)?.classList.add('active');
  window.dispatchEvent(new Event('resize'));   // charts size themselves to their pane
  // on the phone the nav is a scrolling bottom bar: keep the active page's button in view
  const nav = document.querySelector('.sb-nav'), btn = nav?.querySelector('.nav-btn.active');
  if (nav && btn && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: btn.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2, behavior: 'auto' });
  // Refresh paper trading data when switching to that tab
  if (t === 'paper') { refreshPaperTrading(); refreshAutoTrade(); }
  if (t === 'nifty') fetchGlobalCues();
}

const BT_TABS = ['bt-setup', 'bt-results', 'bt-trades', 'bt-chart', 'bt-replay', 'bt-accuracy'];
export function switchBTTab(t) {
  document.querySelectorAll('.bt-tab').forEach((el, i) => {
    el.classList.toggle('active', BT_TABS[i] === t);
  });
  BT_TABS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === t ? 'block' : 'none';
  });
  if (t === 'bt-chart' && State.tvChart) State.tvChart.timeScale().fitContent();
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
window.addEventListener('load', async () => {
  // Initialize watchlist
  WL.init();
  initDash();
  initAutoTrade();

  // Initial data fetches
  try { await refreshPaperTrading(); await _fetchDayStats(); } catch { }
  State.pnlInterval = setInterval(paperTradingLoop, 5000);

  fetchLiveTickers();
  setInterval(fetchLiveTickers, 60000);

  fetchGlobalCues();
  setInterval(() => { if (!document.hidden) fetchGlobalCues(); }, 60000);   // used to load once and never again
  refreshNiftySignal();
  loadBacktestHistory();
  loadLotSizes().then(applyBtLotSize); // current lot sizes from the exchange list, not hardcoded

  DOM.setText('nticker', 'Welcome to Ryugan AI — loading live Nifty 50 signal...');
});

/* ═══════════════════════════════════════════
   Expose inline-handler targets on window.
   index.html calls these via onclick/onchange/oninput attributes
   (both static markup and runtime-generated HTML strings).
═══════════════════════════════════════════ */
window.switchTab = switchTab;

/* Theme: dark by default, light on request; the choice is remembered. */
export function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('ryugan_theme', next); } catch { /* private mode */ }
  onThemeChange();
}
window.toggleTheme = toggleTheme;

window.refreshNiftySignal = refreshNiftySignal;
window.executeCurrentSignal = executeCurrentSignal;
window.fetchGlobalCues = fetchGlobalCues;
window.debounceSearch = debounceSearch;
window.generateSignal = generateSignal;
window.qs = qs;
window.generateMorningBrief = generateMorningBrief;
window.analyzeFO = analyzeFO;
window.loadSectors = loadSectors;
window.switchBTTab = switchBTTab;
window.btFetchData = btFetchData;
window.toggleStrat = toggleStrat;
window.runBacktest = runBacktest;
window.btReset = btReset;
window.filterTrades = filterTrades;
window.saveBacktestResult = saveBacktestResult;
window.onBtTimeframeChange = onBtTimeframeChange;
window.updateBTSegment = updateBTSegment;
window.applyBtLotSize = applyBtLotSize;
window.initReplay = initReplay;
window.rStep = rStep;
window.togglePlay = togglePlay;
window.getAIReview = getAIReview;
window.askAIQa = askAIQa;
window.askA = askA;
window.sendChat = sendChat;
window.ptSetDir = ptSetDir;
window.ptOrderTypeChange = ptOrderTypeChange;
window.onPTSymSelect = onPTSymSelect;
window.ptPlaceOrder = ptPlaceOrder;
window.ptFetchLTP = ptFetchLTP;
window.ptAutoFillSignal = ptAutoFillSignal;
window.refreshPaperTrading = refreshPaperTrading;
window.resetPaperTrading = resetPaperTrading;
window.WL = WL;
// Not referenced by static index.html markup, but generated dynamically into
// onclick="..." attributes by renderSigCard() / renderPTPositions() at runtime
// (see signals.js / paper-trading.js) — must stay on window for those clicks to work.
window.executePaperTrade = executePaperTrade;
window.squareOffPosition = squareOffPosition;
window.cancelPTOrder = cancelPTOrder;
window.ptModifyPosition = ptModifyPosition;
window.openStockBrowser = openStockBrowser;
window.closeStockBrowser = closeStockBrowser;
window.loadOptionChain = loadOptionChain;
window.runFoAnalysis = runFoAnalysis;
