'use strict';
/* Backtest page: pick one or more of the app's strategies, one or more symbols and a date range, and run them through the same engine as the
 * 4-year reports (js/bt-engine.js, run in js/bt-worker.js). Candles come from Angel (15-minute, up to 1,500 days back). */
import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { STRATEGIES } from './strategies.js';
import { VOTE_IDS, DEFAULTS } from './bt-engine.js';
import { getDisabled, getCallRule } from './strategy-prefs.js';

const $ = id => document.getElementById(id);
const base = () => CONFIG.PROXY_BASE || '';
const MAX_DAYS = 1500;
export const PRESET_SYMBOLS = [
  ['^NSEI', 'Nifty 50', true], ['^NSEBANK', 'Bank Nifty', true],
  ['RELIANCE.NS', 'Reliance'], ['HDFCBANK.NS', 'HDFC Bank'], ['ICICIBANK.NS', 'ICICI Bank'], ['INFY.NS', 'Infosys'], ['TCS.NS', 'TCS'],
  ['SBIN.NS', 'SBI'], ['AXISBANK.NS', 'Axis Bank'], ['KOTAKBANK.NS', 'Kotak Bank'], ['LT.NS', 'L&T'], ['ITC.NS', 'ITC'], ['BHARTIARTL.NS', 'Bharti Airtel'],
  ['TATASTEEL.NS', 'Tata Steel'], ['MARUTI.NS', 'Maruti'], ['BAJFINANCE.NS', 'Bajaj Finance'],
];
const candleCache = new Map();         // symbol -> {days, candles}
let worker = null, last = null, running = false, tradePage = 1;
const PAGE = 100;

const rupees = v => (v < 0 ? '-₹' : '₹') + Math.abs(Math.round(v)).toLocaleString('en-IN');
const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--');
const cls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = s => { const [h, m] = String(s || '').split(':').map(Number); return h * 60 + (m || 0); };
const isoDay = d => d.toISOString().slice(0, 10);

/** Calendar days to request from Angel so the range starting at `from` is covered (pure, tested). */
export function daysBack(fromIso, today = new Date()) {
  const d = Math.ceil((Date.parse(isoDay(today)) - Date.parse(fromIso)) / 86400000) + 1;
  return Math.min(MAX_DAYS, Math.max(1, d + 10));        // + the 60-candle warm-up before the first day (about 3 sessions), with room
}

/** Validate the form values (pure, tested). Returns an error string or null. */
export function checkForm({ symbols, ids, from, to, fromMin, toMin, today = new Date() }) {
  if (!symbols.length) return 'Pick at least one symbol.';
  if (!ids.length) return 'Pick at least one strategy.';
  if (!from || !to || from > to) return 'Pick a start date on or before the end date.';
  if ((Date.parse(isoDay(today)) - Date.parse(from)) / 86400000 > MAX_DAYS - 15) return `Angel keeps about ${MAX_DAYS} days of 15-minute candles: pick a start date after ${isoDay(new Date(today - (MAX_DAYS - 15) * 86400000))}.`;
  if (!(fromMin < toMin)) return 'The entry window must start before it ends.';
  return null;
}

function stratChips() {
  const box = $('bt-strats'); if (!box) return;
  const off = new Set(getDisabled()), on = VOTE_IDS.filter(id => !off.has(id));
  box.innerHTML = VOTE_IDS.map(id => {
    const s = STRATEGIES.find(x => x.id === id);
    return `<label class="bt-chip"><input type="checkbox" value="${id}"${(on.length ? on.includes(id) : id === 'vwap') && id !== 'sr' ? ' checked' : ''}> ${DOM.esc(s.name)}${s.weight ? '' : ' <i>(weight 0)</i>'}</label>`;
  }).join('');
  const rule = getCallRule();
  if ($('bt-rule')) $('bt-rule').value = rule === 'score' ? 'score' : 'all';
}

function symbolChips() {
  const box = $('bt-syms'); if (!box) return;
  box.innerHTML = PRESET_SYMBOLS.map(([sym, label, idx]) => `<label class="bt-chip"><input type="checkbox" value="${sym}" data-label="${DOM.esc(label)}"${idx ? ' data-index="1" checked' : ''}> ${DOM.esc(label)}</label>`).join('');
}

function addSymbol() {
  const raw = ($('bt-add-sym').value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return;
  const sym = raw.startsWith('^') || raw.endsWith('.NS') ? raw : raw + '.NS';
  if (!document.querySelector(`#bt-syms input[value="${CSS.escape(sym)}"]`)) {
    $('bt-syms').insertAdjacentHTML('beforeend', `<label class="bt-chip"><input type="checkbox" value="${DOM.esc(sym)}" data-label="${DOM.esc(raw.replace(/\.NS$/, ''))}" checked> ${DOM.esc(raw.replace(/\.NS$/, ''))}</label>`);
  }
  $('bt-add-sym').value = '';
}

function setRange(days) {
  const to = new Date(), from = new Date(Date.now() - days * 86400000);
  $('bt-to').value = isoDay(to); $('bt-from').value = isoDay(from);
  for (const b of document.querySelectorAll('#bt-quick [data-days]')) b.classList.toggle('active', +b.dataset.days === days);
}

function readForm() {
  const symbols = [...document.querySelectorAll('#bt-syms input:checked')].map(i => ({ sym: i.value, label: i.dataset.label || i.value, isIndex: i.dataset.index === '1' || i.value.startsWith('^') }));
  const ids = [...document.querySelectorAll('#bt-strats input:checked')].map(i => i.value);
  return {
    symbols, ids, from: $('bt-from').value, to: $('bt-to').value,
    cfg: { ids, rule: $('bt-rule').value, minScore: +$('bt-minscore').value || 3, minAdx: +$('bt-adx').value || 0,
           fromMin: toMin($('bt-entry-from').value), toMin: toMin($('bt-entry-to').value),
           premium: +$('bt-premium').value || 10000, slPct: +$('bt-sl').value || 30, tpPct: +$('bt-tp').value || 30, spreadPct: +$('bt-spread').value || 0 },
  };
}

async function fetchCandles(s, days) {
  const hit = candleCache.get(s.sym);
  if (hit && hit.days >= days && Date.now() - hit.at < 30 * 60 * 1000) return hit.candles;
  const res = await fetch(`${base()}/api/angel/historical?symbol=${encodeURIComponent(s.sym)}&interval=15m&days=${days}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${s.label}: ${body.detail || 'HTTP ' + res.status}`);
  const candles = (body.candles || []).map(c => ({ ts: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 }));
  if (candles.length < 100) throw new Error(`${s.label}: only ${candles.length} candles came back`);
  candleCache.set(s.sym, { days, candles, at: Date.now() });
  return candles;
}

function progress(text, frac) {
  DOM.setText('bt-progress-text', text);
  DOM.setWidth('bt-prog', Math.round((frac || 0) * 100));
}

export async function runStrategyBacktest() {
  if (running) return;
  const f = readForm();
  const err = checkForm({ ...f, fromMin: f.cfg.fromMin, toMin: f.cfg.toMin });
  if (err) { DOM.setText('bt-progress-text', err); return; }
  running = true; $('bt-run').disabled = true;
  try {
    const days = daysBack(f.from), loaded = [];
    for (let k = 0; k < f.symbols.length; k++) {
      const s = f.symbols[k];
      progress(`Loading 15-minute candles: ${s.label} (${k + 1} of ${f.symbols.length})${days > 180 ? ', long ranges take a few seconds each' : ''}`, k / f.symbols.length * 0.3);
      loaded.push({ ...s, candles: await fetchCandles(s, days) });
    }
    const startTs = Date.parse(f.from + 'T00:00:00+05:30'), endTs = Date.parse(f.to + 'T23:59:59+05:30');
    worker ||= new Worker(new URL('./bt-worker.js', import.meta.url), { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') progress(m.text, 0.3 + 0.7 * m.frac);
        else if (m.type === 'done') resolve(m.result);
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = e => reject(new Error(e.message || 'worker failed'));
      worker.postMessage({ type: 'run', symbols: loaded, cfg: { ...f.cfg, startTs, endTs } });
    });
    last = { ...result, form: f };
    tradePage = 1;
    progress(`Done: ${result.stats.n} trades from ${result.signals} signals.`, 1);
    render();
    $('bt-save').disabled = false;
  } catch (e) {
    progress('Backtest failed: ' + e.message, 0);
  } finally {
    running = false; $('bt-run').disabled = false;
  }
}

function render() {
  const r = last; if (!r) return;
  const s = r.stats, f = r.form, names = f.ids.map(id => STRATEGIES.find(x => x.id === id)?.name || id);
  $('bt-out').style.display = '';
  DOM.setText('bt-o-what', `${names.join(' + ')} · ${f.cfg.rule === 'all' ? 'all must agree' : 'weighted score ≥ ' + f.cfg.minScore} · ${f.symbols.map(x => x.label).join(', ')} · ${f.from} to ${f.to} · entries ${hm(f.cfg.fromMin)}-${hm(f.cfg.toMin)}`);
  const card = (l, v, c = '', sub = '') => `<div class="stat-card"><div class="sc-l">${l}</div><div class="sc-v ${c}">${v}</div>${sub ? `<div class="sc-s">${sub}</div>` : ''}</div>`;
  $('bt-o-cards').innerHTML = [
    card('Trades', num(s.n), '', `${num(r.signals)} signals`),
    card('Avg per trade', rupees(s.avg), cls(s.avg), `on ${rupees(f.cfg.premium)} premium`),
    card('Total P&L', rupees(s.net), cls(s.net)),
    card('Win rate', num(s.win, 1) + '%'),
    card('Profit factor', Number.isFinite(s.pf) ? num(s.pf, 2) : '∞'),
    card('Max drawdown', rupees(s.maxDD), 'down'),
    card('Worst day', rupees(s.worstDay), 'down'),
    card('Coin flip, same candles', Number.isFinite(r.coin.avg) ? rupees(r.coin.avg) : '--', cls(r.coin.avg), Number.isFinite(r.coin.p) ? `chance it is luck: ${num(r.coin.p * 100, 1)}%` : 'needs 30+ trades'),
  ].join('');
  const verdict = s.n < 30 ? 'Too few trades to judge.'
    : s.avg <= 0 ? 'Loses money after charges and spread on this data.'
    : !(r.coin.p < 0.05) ? 'Profitable here, but a coin flip on the same candles comes too close: it may be luck.'
    : 'Beats a coin flip on the same candles on this data. Check it on other periods before trusting it.';
  DOM.setText('bt-o-verdict', verdict);
  const tbl = (rows, head) => `<table class="dtbl"><thead><tr><th>${head}</th><th>Trades</th><th>Avg</th><th>Total</th><th>Win</th><th>PF</th></tr></thead><tbody>${rows.map(x =>
    `<tr><td>${DOM.esc(x.key)}</td><td>${num(x.n)}</td><td class="${cls(x.avg)}">${rupees(x.avg)}</td><td class="${cls(x.net)}">${rupees(x.net)}</td><td>${num(x.win, 0)}%</td><td>${Number.isFinite(x.pf) ? num(x.pf, 2) : '∞'}</td></tr>`).join('')}</tbody></table>`;
  $('bt-o-sym').innerHTML = tbl(r.bySymbol, 'Symbol');
  $('bt-o-month').innerHTML = tbl([...r.byMonth].reverse(), 'Month');
  const exitNames = { SL: 'Stop hit', TP: 'Target hit', SQ: 'Squared off 15:15', END: 'End of data' };
  $('bt-o-side').innerHTML = tbl(r.bySide, 'Side') + tbl(r.byExit.map(x => ({ ...x, key: exitNames[x.key] || x.key })), 'Exit');
  drawEquity();
  renderTrades();
}

function drawEquity() {
  const cv = $('bt-equity'); if (!cv || !last) return;
  const tr = [...last.trades].sort((a, b) => a.exitTs - b.exitTs);
  const w = cv.clientWidth || 800, h = 220, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  if (tr.length < 2) return;
  let eq = 0; const pts = [0, ...tr.map(t => (eq += t.net))];
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), y = v => h - 16 - (v - lo) / ((hi - lo) || 1) * (h - 32), x = k => 8 + k / (pts.length - 1) * (w - 16);
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue('--line') || '#555'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(8, y(0)); g.lineTo(w - 8, y(0)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = eq >= 0 ? (css.getPropertyValue('--up') || '#1a9e5c') : (css.getPropertyValue('--down') || '#d64545'); g.lineWidth = 2; g.beginPath();
  pts.forEach((v, k) => (k ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v)))); g.stroke();
  g.fillStyle = css.getPropertyValue('--tx-2') || '#999'; g.font = '11px sans-serif';
  g.fillText(rupees(hi), 10, 12); g.fillText(rupees(lo), 10, h - 4);
}

function renderTrades() {
  const body = $('bt-o-trades'); if (!body || !last) return;
  const tr = [...last.trades].reverse(), pages = Math.max(1, Math.ceil(tr.length / PAGE));
  tradePage = Math.min(Math.max(1, tradePage), pages);
  const fmt = ts => new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const why = { SL: 'Stop', TP: 'Target', SQ: '15:15', END: 'End' };
  body.innerHTML = tr.slice((tradePage - 1) * PAGE, tradePage * PAGE).map(t => `<tr><td>${fmt(t.ts)}</td><td>${DOM.esc(t.label)}</td><td class="${t.dir > 0 ? 'up' : 'down'}">${t.dir > 0 ? 'BUY CE' : 'BUY PE'}</td>
    <td>${num(t.entry, 2)}</td><td>${num(t.exitPx, 2)}</td><td>${fmt(t.exitTs)}</td><td>${num(t.ret * 100, 1)}%</td><td class="${cls(t.net)}">${rupees(t.net)}</td><td>${why[t.why] || t.why}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty-cell">No trades</td></tr>';
  DOM.setText('bt-o-page', `Page ${tradePage} of ${pages} (newest first)`);
}

function downloadCsv() {
  if (!last) return;
  const rows = [['entry_time', 'symbol', 'side', 'underlying_entry', 'underlying_exit', 'exit_time', 'premium_return_pct', 'gross', 'charges', 'net', 'exit']];
  for (const t of last.trades) rows.push([new Date(t.ts).toISOString(), t.label, t.dir > 0 ? 'CE' : 'PE', t.entry.toFixed(2), t.exitPx.toFixed(2), new Date(t.exitTs).toISOString(), (t.ret * 100).toFixed(2), t.gross.toFixed(2), t.charges.toFixed(2), t.net.toFixed(2), t.why]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `backtest_${last.form.from}_${last.form.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

export async function saveBacktestResult() {
  if (!last) return;
  const f = last.form, s = last.stats;
  try {
    const res = await fetch(`${base()}/api/backtest/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      symbol: f.symbols.map(x => x.label).join(',').slice(0, 50), timeframe: '15m',
      params: { strategies: f.ids, rule: f.cfg.rule, minScore: f.cfg.minScore, from: f.from, to: f.to, entry: [hm(f.cfg.fromMin), hm(f.cfg.toMin)], adx: f.cfg.minAdx, premium: f.cfg.premium, sl: f.cfg.slPct, tp: f.cfg.tpPct, spread: f.cfg.spreadPct },
      stats: { trades: s.n, avg: Math.round(s.avg), net: Math.round(s.net), win: +s.win.toFixed(1), pf: Number.isFinite(s.pf) ? +s.pf.toFixed(2) : null, maxDD: Math.round(s.maxDD), coin: Number.isFinite(last.coin.avg) ? Math.round(last.coin.avg) : null } }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DOM.setText('bt-progress-text', 'Result saved.');
    loadBacktestHistory();
  } catch (e) { DOM.setText('bt-progress-text', 'Could not save: ' + e.message); }
}

export async function loadBacktestHistory() {
  const box = $('bt-saved'); if (!box) return;
  try {
    const d = await fetch(`${base()}/api/backtest/history?limit=10`, { cache: 'no-store' }).then(r => r.json());
    const runs = (d.runs || []).filter(r => r.params?.strategies);
    box.innerHTML = runs.length ? `<table class="dtbl"><thead><tr><th>Saved</th><th>Strategies</th><th>Symbols</th><th>Period</th><th>Trades</th><th>Avg</th><th>Total</th><th>Win</th></tr></thead><tbody>${runs.map(r => {
      const p = r.params, s = r.stats;
      return `<tr><td>${new Date(r.created_at).toLocaleDateString('en-IN')}</td><td>${DOM.esc(p.strategies.join(' + '))} (${p.rule})</td><td>${DOM.esc(r.symbol)}</td><td>${p.from} to ${p.to}</td><td>${s.trades}</td><td class="${cls(s.avg)}">${rupees(s.avg)}</td><td class="${cls(s.net)}">${rupees(s.net)}</td><td>${s.win}%</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="sc-s">No saved runs yet.</div>';
  } catch { box.innerHTML = '<div class="sc-s">Saved runs could not be loaded.</div>'; }
}

let wired = false;
export function initBacktest() {
  if (wired) return; wired = true;
  symbolChips(); stratChips(); setRange(365);
  $('bt-entry-from').value = hm(DEFAULTS.fromMin); $('bt-entry-to').value = hm(DEFAULTS.toMin);
  $('bt-add-btn').onclick = addSymbol;
  $('bt-add-sym').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSymbol(); } });
  for (const b of document.querySelectorAll('#bt-quick [data-days]')) b.onclick = () => setRange(+b.dataset.days);
  $('bt-rule').onchange = () => { $('bt-minscore-wrap').style.display = $('bt-rule').value === 'score' ? '' : 'none'; };
  $('bt-rule').onchange();
  $('bt-run').onclick = runStrategyBacktest;
  $('bt-save').onclick = saveBacktestResult;
  $('bt-csv').onclick = downloadCsv;
  $('bt-prev').onclick = () => { tradePage--; renderTrades(); };
  $('bt-next').onclick = () => { tradePage++; renderTrades(); };
  window.addEventListener('resize', () => { if (last && $('tab-backtest')?.classList.contains('active')) drawEquity(); });
  loadBacktestHistory();
}

/** Called when the page is shown: re-read the Profile strategy toggles if nothing was run yet, redraw the curve at the right width. */
export function onBacktestShown() {
  if (!last) stratChips();
  else drawEquity();
}
