'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { State } from './state.js';
import { Indicators } from './indicators.js';
import { callClaude } from './ai.js';
import { yahooFetch, getPrice } from './market-data.js';
import { switchBTTab, showOv, hideOv } from './app.js';
import { BT_SWING_INTERVALS, BT_DEFAULT_PERIOD, BT_PERIOD_DAYS } from './timeframes.js';
import { loadLotSizes, lotSizeFor } from './lot-sizes.js';

export function onBtTimeframeChange() {
  const tf = document.getElementById('bt-tf')?.value;
  const period = document.getElementById('bt-period');
  if (period && BT_DEFAULT_PERIOD[tf]) period.value = BT_DEFAULT_PERIOD[tf];
}

/* ═══════════════════════════════════════════
   MODULE: BACKTEST ENGINE
═══════════════════════════════════════════ */
export function toggleStrat(s) {
  const el = document.getElementById('sc-' + s);
  if (!el) return;
  if (State.selStrats.has(s)) {
    State.selStrats.delete(s);
    el.classList.remove('active');
  } else {
    State.selStrats.add(s);
    el.classList.add('active');
  }
}

// Segment control: show the lot-size row for F&O segments and fill it from the contract list.
export async function applyBtLotSize() {
  await loadLotSizes();
  const lot = lotSizeFor(document.getElementById('bt-sym')?.value);
  const input = document.getElementById('bt-lotsize');
  if (input && lot) input.value = lot;
}

export async function updateBTSegment() {
  const seg = document.getElementById('bt-segment')?.value || 'intraday';
  const isFO = seg.startsWith('fo_');
  const lotRow = document.getElementById('fo-lot-row');
  if (lotRow) lotRow.style.display = isFO ? '' : 'none';
  const optRow = document.getElementById('fo-options-row');
  if (optRow) optRow.style.display = seg === 'fo_options' ? '' : 'none';
  if (isFO) await applyBtLotSize();
}

export async function btFetchData() {
  const sym = document.getElementById('bt-sym')?.value;
  const tf = document.getElementById('bt-tf')?.value;
  const period = document.getElementById('bt-period')?.value;

  DOM.setWidth('bt-prog', 20);
  DOM.setHtml('bt-data-status', '<span class="spinr"></span> Connecting to Yahoo Finance...');

  try {
    const j = await yahooFetch(sym, tf, period);
    if (!j) throw new Error('fetch failed');
    const result = j.chart?.result?.[0];
    if (!result) throw new Error('no data');

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    State.btData = ts.map((t, i) => ({
      ts: t * 1000, date: new Date(t * 1000),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i]
    })).filter(d => d.c != null && !isNaN(d.c));

    DOM.setWidth('bt-prog', 100);
    DOM.setHtml('bt-data-status', `<span style="color:var(--green)">✓ Loaded <strong>${State.btData.length}</strong> candles — Yahoo Finance</span>`);
    document.getElementById('bt-run-btn').disabled = false;

    const dates = [...new Set(State.btData.map(d => d.date.toISOString().slice(0, 10)))];
    const rdp = document.getElementById('rp-date');
    if (rdp && dates.length) {
      rdp.min = dates[0];
      rdp.max = dates[dates.length - 1];
      rdp.value = dates[Math.floor(dates.length / 2)];
    }
  } catch {
    State.btData = genDemoData(document.getElementById('bt-tf')?.value, document.getElementById('bt-period')?.value);
    DOM.setWidth('bt-prog', 100);
    DOM.setHtml('bt-data-status', `<span style="color:var(--warn)">⚡ Demo data (${State.btData.length} candles) — Live data unavailable</span>`);
    document.getElementById('bt-run-btn').disabled = false;
  }
}

export function genDemoData(tf, period) {
  const days = BT_PERIOD_DAYS[period] || 66;
  const data = []; let price = 22000 + Math.random() * 1200;
  const now = new Date();

  if (BT_SWING_INTERVALS.has(tf)) {
    // One candle per daily/weekly/monthly/yearly step, random walk with mild drift.
    const stepDays = { '1d': 1, '1wk': 7, '1mo': 30, '1y': 365 }[tf];
    const count = Math.max(20, Math.floor((days * 1.45) / stepDays));
    const volScale = { '1d': 0.012, '1wk': 0.03, '1mo': 0.06, '1y': 0.18 }[tf];
    for (let n = count; n >= 0; n--) {
      const ts = new Date(now); ts.setDate(ts.getDate() - n * stepDays); ts.setHours(9, 15, 0, 0);
      const o = price;
      const c = o * (1 + (Math.random() - 0.46) * volScale);
      const h = Math.max(o, c) * (1 + Math.random() * volScale * 0.4);
      const l = Math.min(o, c) * (1 - Math.random() * volScale * 0.4);
      data.push({ ts: ts.getTime(), date: ts, o, h, l, c: parseFloat(c.toFixed(2)), v: Math.floor(1e6 + Math.random() * 5e6) });
      price = c;
    }
    return data;
  }

  const bars = { '5m': 78, '15m': 26, '30m': 13, '1h': 6 }[tf] || 26;
  for (let d = days; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    let dp = price;
    const dt = (Math.random() - 0.47) * 0.02;
    for (let b = 0; b < bars; b++) {
      const hr = 9 + Math.floor(b * (6.5 / bars));
      const mn = Math.floor((b * (6.5 / bars) * 60) % 60);
      const ts = new Date(day); ts.setHours(hr, mn, 0, 0);
      const vol = dp * 0.003 * (0.5 + Math.random());
      const tr = dt + (Math.random() - 0.5) * 0.005;
      const o = dp, c = o + tr * o + (Math.random() - 0.5) * vol;
      const h = Math.max(o, c) + Math.random() * vol * 0.5;
      const l = Math.min(o, c) - Math.random() * vol * 0.5;
      data.push({ ts: ts.getTime(), date: ts, o, h, l, c: parseFloat(c.toFixed(2)), v: Math.floor(50000 + Math.random() * 200000) });
      dp = c;
    }
    price = dp;
  }
  return data;
}

const TRAIL_FACTOR = 1.0;
export function applyTrailingStop(pos, candle, atr) {
  if (!pos.trailActive) {
    const t1Hit = pos.dir === 'LONG' ? candle.h >= pos.aTP : candle.l <= pos.aTP;
    if (t1Hit) {
      pos.trailActive = true;
      pos.trailBest = pos.dir === 'LONG' ? candle.h : candle.l;
      pos.trailSL = pos.dir === 'LONG' ? pos.trailBest - TRAIL_FACTOR * atr : pos.trailBest + TRAIL_FACTOR * atr;
    }
    return null;
  }
  if (pos.dir === 'LONG') {
    if (candle.h > pos.trailBest) { pos.trailBest = candle.h; pos.trailSL = pos.trailBest - TRAIL_FACTOR * atr; }
    if (candle.l <= pos.trailSL) return { price: pos.trailSL, reason: 'Trail Stop' };
  } else {
    if (candle.l < pos.trailBest) { pos.trailBest = candle.l; pos.trailSL = pos.trailBest + TRAIL_FACTOR * atr; }
    if (candle.h >= pos.trailSL) return { price: pos.trailSL, reason: 'Trail Stop' };
  }
  return null;
}

export function runBacktest() {
  // Daily/weekly/monthly/yearly candles run as one continuous series (no per-day
  // grouping, no time-of-day filter, no EOD square-off, no opening-range strategy).
  const isSwing = BT_SWING_INTERVALS.has(document.getElementById('bt-tf')?.value);
  if (State.btData.length < (isSwing ? 15 : 50)) { alert('Fetch data first (not enough candles for this timeframe)'); return; }
  const warmup = isSwing ? Math.min(30, Math.max(10, Math.floor(State.btData.length / 4))) : 30;
  showOv('RUNNING BACKTEST ENGINE...');
  State.tradeLog = [];
  // The dropdown values are fo_futures / fo_options; the charges model knows futures / options.
  const rawSegment = document.getElementById('bt-segment')?.value || 'intraday';
  const segment = { fo_futures: 'futures', fo_options: 'options' }[rawSegment] || rawSegment;
  const lotSize = parseInt(document.getElementById('bt-lotsize')?.value || '1') || 1;

  setTimeout(() => {
    const closes = State.btData.map(d => d.c);
    const vols = State.btData.map(d => d.v);
    const rsiV = Indicators.rsi(closes, 14);
    const efArr = Indicators.ema(closes, +(document.getElementById('ema-f')?.value || 9));
    const esArr = Indicators.ema(closes, +(document.getElementById('ema-s')?.value || 21));
    const e50 = Indicators.ema(closes, 50);
    const bbV = Indicators.bb(closes, 20, 2);
    const vwapV = Indicators.vwap(State.btData);
    const atrV = Indicators.atr(State.btData, 14);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const cap = +(document.getElementById('bt-capital')?.value || 50000);

    const gp = s => ({
      sl: +(document.getElementById(`${s}-sl`)?.value || 1.5),
      tp: +(document.getElementById(`${s}-tp`)?.value || 2.5)
    });

    // Group by trading day (intraday) or treat the whole series as one run (swing)
    const days = {};
    State.btData.forEach((c, i) => {
      const k = isSwing ? 'all' : c.date.toISOString().slice(0, 10);
      if (!days[k]) days[k] = [];
      days[k].push(i);
    });

    Object.values(days).forEach(idxs => {
      const pos = {};
      let openHigh = -Infinity, openLow = Infinity;

      idxs.forEach(i => {
        const hr = State.btData[i].date.getHours();
        const mn = State.btData[i].date.getMinutes();
        if (hr === 9 && mn <= 30) {
          openHigh = Math.max(openHigh, State.btData[i].h);
          openLow = Math.min(openLow, State.btData[i].l);
        }
        if (i < warmup) return;

        const c = State.btData[i];
        const price = c.c;
        const atr = atrV[i] || 1;
        const isLast = idxs[idxs.length - 1] === i;

        // Exit logic
        Object.keys(pos).forEach(st => {
          const p = pos[st]; if (!p) return;
          let xp = null, xr = '';

          const trail = applyTrailingStop(p, c, atr);
          if (trail) { xp = trail.price; xr = trail.reason; }

          if (!xp) {
            if (p.dir === 'LONG') {
              if (c.l <= p.aSL) { xp = p.aSL; xr = 'SL Hit'; }
            } else {
              if (c.h >= p.aSL) { xp = p.aSL; xr = 'SL Hit'; }
            }
          }
          if (!xp && st === 'ema') {
            if (p.dir === 'LONG' && efArr[i - 1] >= esArr[i - 1] && efArr[i] < esArr[i]) { xp = price; xr = 'Opposing Cross'; }
            if (p.dir === 'SHORT' && efArr[i - 1] <= esArr[i - 1] && efArr[i] > esArr[i]) { xp = price; xr = 'Opposing Cross'; }
          }
          if (isLast && !xp) { xp = price; xr = isSwing ? 'End of Data' : 'EOD 3:15'; }

          if (xp) {
            const qty = p.qty;
            const pnl = p.dir === 'LONG' ? (xp - p.entry) * qty : (p.entry - xp) * qty;
            const chg = Indicators.charges(p.entry, xp, qty, segment);
            const net = Math.round(pnl - chg);
            const lots = segment !== 'intraday' ? Math.round(qty / lotSize) : null;

            State.tradeLog.push({
              id: State.tradeLog.length + 1,
              entryTs: p.entryDate.getTime(),
              date: p.entryDate.toLocaleDateString('en-IN') + ' ' + String(p.entryDate.getHours()).padStart(2, '0') + ':' + String(p.entryDate.getMinutes()).padStart(2, '0'),
              strat: st, dir: p.dir, segment, lots,
              entry: p.entry, exit: xp, qty,
              grossPnl: Math.round(pnl), charges: chg, netPnl: net,
              reason: xr, win: net > 0
            });
            delete pos[st];
          }
        });

        // Entry logic for all active strategies
        const activeStrats = ['ema', 'smc', 'orb',
          ...(State.selStrats.has('straddle') ? ['straddle'] : []),
          ...(State.selStrats.has('bull_spread') ? ['bull_spread'] : []),
          ...(State.selStrats.has('bear_spread') ? ['bear_spread'] : [])
        ];

        activeStrats.forEach(st => {
          if (!State.selStrats.has(st) || pos[st] || isLast) return;
          if (!isSwing && (hr > 13 || (hr === 13 && mn > 45))) return;
          let sig = null;

          if (st === 'ema') {
            const rsiTick = rsiV[i] > 55, rsiSell = rsiV[i] < 45;
            const strongCandle = Math.abs(c.c - c.o) > ((c.h - c.l) * 0.5);
            if (efArr[i - 1] <= esArr[i - 1] && efArr[i] > esArr[i] && price > e50[i] && price > vwapV[i] && rsiTick && strongCandle) sig = 'LONG';
            else if (efArr[i - 1] >= esArr[i - 1] && efArr[i] < esArr[i] && price < e50[i] && price < vwapV[i] && rsiSell && strongCandle) sig = 'SHORT';
          }
          else if (st === 'orb') {
            if (isSwing || (hr === 9 && mn <= 30)) return;
            const volOk = c.v > avgVol * +(document.getElementById('orb-v')?.value || 1.5);
            if (c.c > openHigh && State.btData[i - 1].c <= openHigh && volOk && c.c > vwapV[i]) sig = 'LONG';
            else if (c.c < openLow && State.btData[i - 1].c >= openLow && volOk && c.c < vwapV[i]) sig = 'SHORT';
          }
          else if (st === 'smc') {
            let bullFVG = null, bearFVG = null;
            for (let k = i - 1; k >= Math.max(2, i - 15); k--) {
              if (State.btData[k - 2].h < State.btData[k].l && State.btData[k - 1].c > State.btData[k - 2].h) {
                const body = Math.abs(State.btData[k - 1].c - State.btData[k - 1].o);
                const rng = Math.abs(State.btData[k - 1].h - State.btData[k - 1].l);
                if (body / (rng || 1) < 0.5) continue;
                let tapped = false;
                for (let m = k + 1; m < i; m++) if (State.btData[m].l <= State.btData[k].l) tapped = true;
                if (!tapped) { bullFVG = { top: State.btData[k].l, bottom: State.btData[k - 2].h }; break; }
              }
              if (State.btData[k - 2].l > State.btData[k].h && State.btData[k - 1].c < State.btData[k - 2].l) {
                const body = Math.abs(State.btData[k - 1].c - State.btData[k - 1].o);
                const rng = Math.abs(State.btData[k - 1].h - State.btData[k - 1].l);
                if (body / (rng || 1) < 0.5) continue;
                let tapped = false;
                for (let m = k + 1; m < i; m++) if (State.btData[m].h >= State.btData[k].h) tapped = true;
                if (!tapped) { bearFVG = { bottom: State.btData[k].h, top: State.btData[k - 2].l }; break; }
              }
            }
            if (bullFVG && c.l <= bullFVG.top && price > bullFVG.top && efArr[i] > esArr[i] && price > e50[i]) sig = 'LONG';
            else if (bearFVG && c.h >= bearFVG.bottom && price < bearFVG.bottom && efArr[i] < esArr[i] && price < e50[i]) sig = 'SHORT';
          }
          // F&O Strategies
          else if (st === 'straddle') {
            // Short Straddle: Enter when VIX is elevated AND we're in expiry week (Thursday-ish candles)
            const bbWidth = bbV[i]?.width || 0;
            const isLowVol = bbWidth < 1.5; // tight range = good straddle entry
            if (isLowVol && rsiV[i] > 45 && rsiV[i] < 55) sig = 'LONG'; // represents net premium collected
          }
          else if (st === 'bull_spread') {
            // Bull Call Spread: Enter on bullish signals
            if (efArr[i] > esArr[i] && price > vwapV[i] && rsiV[i] > 55) sig = 'LONG';
          }
          else if (st === 'bear_spread') {
            // Bear Put Spread: Enter on bearish signals
            if (efArr[i] < esArr[i] && price < vwapV[i] && rsiV[i] < 45) sig = 'SHORT';
          }

          if (sig) {
            const p = gp(st === 'straddle' ? 'str' : st === 'bull_spread' ? 'bcs' : st === 'bear_spread' ? 'bps' : st);
            let aSL, aTP;
            const baseQty = segment !== 'intraday'
              ? lotSize * (Math.floor((cap * 5) / (price * lotSize)) || 1)
              : (Math.floor((cap * 5) / price) || 1);

            if (st === 'smc') {
              aSL = sig === 'LONG' ? price * (1 - p.sl / 100) : price * (1 + p.sl / 100);
              aTP = sig === 'LONG' ? price * (1 + p.tp / 100) : price * (1 - p.tp / 100);
            } else if (st === 'straddle' || st === 'bull_spread' || st === 'bear_spread') {
              const slPct = +(document.getElementById('str-sl')?.value || 50) / 100;
              const tpPct = +(document.getElementById('str-tp')?.value || 30) / 100;
              aSL = sig === 'LONG' ? price * (1 - slPct) : price * (1 + slPct);
              aTP = sig === 'LONG' ? price * (1 + tpPct) : price * (1 - tpPct);
            } else {
              aSL = sig === 'LONG' ? price - p.sl * atrV[i] : price + p.sl * atrV[i];
              aTP = sig === 'LONG' ? price + p.tp * atrV[i] : price - p.tp * atrV[i];
            }

            pos[st] = { dir: sig, entry: price, aSL, aTP, entryDate: c.date, qty: baseQty };
          }
        });
      });
    });

    State.equityHistory = [];
    let running = 0;
    State.tradeLog.forEach(t => { running += t.netPnl; State.equityHistory.push(running); });

    renderBTResults();
    renderTradeLog(State.tradeLog);
    renderAccuracy();
    renderTVChart(State.btData, State.tradeLog, 'all');

    document.getElementById('bt-run-btn').disabled = false;
    DOM.setHtml('bt-status', `<span style="color:var(--green)">✓ ${State.tradeLog.length} trades</span>`);
    document.getElementById('ai-review-btn').disabled = false;
    const saveBtn = document.getElementById('bt-save-btn');
    if (saveBtn) saveBtn.disabled = State.tradeLog.length === 0;
    updatePerfSummary();
    switchBTTab('bt-results');
    hideOv();
  }, 80);
}

export function calcMaxDD() {
  let pk = 0, dd = 0, running = 0;
  State.tradeLog.forEach(t => {
    running += t.netPnl;
    if (running > pk) pk = running;
    dd = Math.min(dd, running - pk);
  });
  return dd;
}

export function calcSharpe() {
  if (State.equityHistory.length < 2) return 0;
  const rets = State.equityHistory.map((v, i) => i > 0 ? v - State.equityHistory[i - 1] : 0).slice(1);
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - avg) ** 2, 0) / rets.length) || 1;
  return (avg / std * Math.sqrt(252)).toFixed(2);
}

export function renderBTResults() {
  const wins = State.tradeLog.filter(t => t.win);
  const losses = State.tradeLog.filter(t => !t.win);
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wr = State.tradeLog.length ? (wins.length / State.tradeLog.length * 100).toFixed(1) : 0;
  const avgW = wins.length ? wins.reduce((a, t) => a + t.netPnl, 0) / wins.length : 0;
  const avgL = losses.length ? Math.abs(losses.reduce((a, t) => a + t.netPnl, 0) / losses.length) : 1;
  const pf = losses.length ? (wins.reduce((a, t) => a + t.netPnl, 0) / Math.abs(losses.reduce((a, t) => a + t.netPnl, 0))).toFixed(2) : '∞';
  const mdd = calcMaxDD();
  const sh = calcSharpe();
  const exp = State.tradeLog.length ? (net / State.tradeLog.length).toFixed(0) : 0;
  const nc = net >= 0 ? 'var(--green)' : 'var(--down)';
  const stratNames = { ema: 'EMA Cross V2', orb: 'ORB 9:30', smc: 'SMC FVG', straddle: 'Short Straddle', bull_spread: 'Bull Call Spread', bear_spread: 'Bear Put Spread' };

  DOM.setHtml('bt-results-content', `
  <div class="results-grid mb16">
    <div class="stat-card"><div class="stat-label">Net P&L</div><div class="stat-val" style="color:${nc};font-size:20px">₹${net.toLocaleString('en-IN')}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Gross: ₹${State.tradeLog.reduce((a, t) => a + t.grossPnl, 0).toLocaleString('en-IN')}</div></div>
    <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-val" style="color:${+wr >= 55 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)'}">${wr}%</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${wins.length}W / ${losses.length}L / ${State.tradeLog.length} total</div></div>
    <div class="stat-card"><div class="stat-label">Profit Factor</div><div class="stat-val" style="color:${+pf >= 1.5 ? 'var(--green)' : +pf >= 1 ? 'var(--warn)' : 'var(--down)'}">${pf}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">AvgW ₹${Math.round(avgW)} / AvgL ₹${Math.round(avgL)}</div></div>
    <div class="stat-card"><div class="stat-label">Max Drawdown</div><div class="stat-val down">₹${Math.abs(mdd).toLocaleString('en-IN')}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Peak-to-trough</div></div>
    <div class="stat-card"><div class="stat-label">Sharpe Ratio</div><div class="stat-val" style="color:${sh >= 1 ? 'var(--green)' : sh >= 0 ? 'var(--warn)' : 'var(--down)'}">${sh}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">Expect. ₹${exp}/trade</div></div>
  </div>
  <div class="two-col mb16">
    <div class="card"><div class="card-header">Equity Curve</div><canvas id="eq-canvas" style="width:100%;height:200px;display:block;"></canvas></div>
    <div class="card"><div class="card-header">Strategy Breakdown</div>
      ${Object.keys(stratNames).map(s => {
    const st = State.tradeLog.filter(t => t.strat === s);
    if (!st.length) return '';
    const sw = st.filter(t => t.win);
    const snet = st.reduce((a, t) => a + t.netPnl, 0);
    const swr = (sw.length / st.length * 100).toFixed(0);
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span style="font-family:var(--font-display);font-size:10px;font-weight:700;color:var(--blue)">${stratNames[s]}</span>
            <span style="font-family:var(--font-mono);font-size:13px;color:${snet >= 0 ? 'var(--green)' : 'var(--down)'}">₹${snet.toLocaleString('en-IN')}</span>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-bottom:5px;">${st.length} trades · WR ${swr}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${swr}%;background:${+swr >= 55 ? 'var(--green)' : +swr >= 45 ? 'var(--warn)' : 'var(--down)'}"></div></div>
        </div>`;
  }).join('')}
    </div>
  </div>
  <div class="card"><div class="card-header">Quick Stats</div>
    <div class="stats-grid four-col">
      <div class="stat-card"><div class="stat-label">TOTAL CHARGES</div><div class="stat-val down" style="font-size:16px">₹${State.tradeLog.reduce((a, t) => a + t.charges, 0).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">BEST TRADE</div><div class="stat-val up" style="font-size:16px">₹${Math.max(...State.tradeLog.map(t => t.netPnl)).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">WORST TRADE</div><div class="stat-val down" style="font-size:16px">₹${Math.min(...State.tradeLog.map(t => t.netPnl)).toLocaleString('en-IN')}</div></div>
      <div class="stat-card"><div class="stat-label">CAPITAL / TRADE</div><div class="stat-val" style="font-size:16px">₹${(+(document.getElementById('bt-capital')?.value || 50000)).toLocaleString('en-IN')}</div></div>
    </div>
  </div>`);

  setTimeout(drawEquityCurve, 80);
}

/* ═══════════════════════════════════════════
   MODULE: SAVED BACKTEST RUNS (persisted server-side)
═══════════════════════════════════════════ */
function _currentStatsSummary() {
  const wins = State.tradeLog.filter(t => t.win);
  const losses = State.tradeLog.filter(t => !t.win);
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wr = State.tradeLog.length ? +(wins.length / State.tradeLog.length * 100).toFixed(1) : 0;
  return {
    net_pnl: net,
    win_rate: wr,
    total_trades: State.tradeLog.length,
    wins: wins.length,
    losses: losses.length,
    profit_factor: losses.length ? +(wins.reduce((a, t) => a + t.netPnl, 0) / Math.abs(losses.reduce((a, t) => a + t.netPnl, 0))).toFixed(2) : null,
    max_drawdown: calcMaxDD(),
    sharpe: +calcSharpe(),
    total_charges: State.tradeLog.reduce((a, t) => a + t.charges, 0)
  };
}

export async function saveBacktestResult() {
  if (!State.tradeLog.length) { alert('Run a backtest first'); return; }
  const symbol = document.getElementById('bt-sym')?.value || 'UNKNOWN';
  const timeframe = document.getElementById('bt-tf')?.value || 'unknown';
  const params = {
    period: document.getElementById('bt-period')?.value,
    segment: document.getElementById('bt-segment')?.value,
    capital: document.getElementById('bt-capital')?.value,
    strategies: [...State.selStrats]
  };
  const stats = _currentStatsSummary();

  const btn = document.getElementById('bt-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/backtest/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe, params, stats })
    });
    if (res.ok) {
      await loadBacktestHistory();
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Save failed: ' + (err.detail || res.status));
    }
  } catch (e) {
    alert('Save failed: cannot reach backend.');
  }
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save Result'; }
}

export async function loadBacktestHistory() {
  const container = document.getElementById('bt-saved-runs');
  if (!container) return;
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/backtest/history?limit=10');
    if (!res.ok) return;
    const data = await res.json();
    renderSavedRuns(data.runs || []);
  } catch { /* saved-runs history is non-critical */ }
}

export function renderSavedRuns(runs) {
  const container = document.getElementById('bt-saved-runs');
  if (!container) return;
  if (!runs.length) {
    container.innerHTML = '<div class="empty-state">No saved runs yet.</div>';
    return;
  }
  container.innerHTML = runs.map(r => {
    const s = r.stats || {};
    const nc = (s.net_pnl || 0) >= 0 ? 'var(--green)' : 'var(--down)';
    const when = new Date(r.created_at).toLocaleString('en-IN');
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-family:var(--font-display);font-size:11px;font-weight:700;">${DOM.esc(r.symbol)} <span style="color:var(--text3);font-weight:400">· ${DOM.esc(r.timeframe)}</span></div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${DOM.esc(when)} · ${s.total_trades ?? '?'} trades · WR ${s.win_rate ?? '?'}%</div>
      </div>
      <div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:${nc}">₹${(s.net_pnl || 0).toLocaleString('en-IN')}</div>
    </div>`;
  }).join('');
}

export function drawEquityCurve() {
  const c = document.getElementById('eq-canvas');
  if (!c || !State.equityHistory.length) return;
  const ctx = c.getContext('2d');
  c.width = c.offsetWidth * window.devicePixelRatio || 600;
  c.height = 200 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = c.offsetWidth || 600, H = 200;
  ctx.clearRect(0, 0, W, H);

  const mn = Math.min(...State.equityHistory, 0);
  const mx = Math.max(...State.equityHistory, 1);
  const rng = mx - mn || 1;
  const ty = v => 10 + (mx - v) / rng * (H - 20);
  const tx = i => 10 + i / ((State.equityHistory.length - 1) || 1) * (W - 20);

  // Zero line
  ctx.strokeStyle = 'rgba(41,128,185,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(10, ty(0)); ctx.lineTo(W - 10, ty(0)); ctx.stroke();
  ctx.setLineDash([]);

  // Fill
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(106,176,76,0.18)');
  g.addColorStop(1, 'rgba(106,176,76,0)');
  ctx.beginPath();
  State.equityHistory.forEach((v, i) => i === 0 ? ctx.moveTo(tx(0), ty(v)) : ctx.lineTo(tx(i), ty(v)));
  ctx.lineTo(tx(State.equityHistory.length - 1), ty(0));
  ctx.lineTo(10, ty(0));
  ctx.fillStyle = g; ctx.fill();

  // Line
  ctx.strokeStyle = 'var(--green, #6AB04C)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  State.equityHistory.forEach((v, i) => i === 0 ? ctx.moveTo(tx(0), ty(v)) : ctx.lineTo(tx(i), ty(v)));
  ctx.stroke();
}

export function renderTradeLog(trades) {
  State.allTrades = [...trades];
  filterTrades('all');
}

export function filterTrades(f) {
  let fl = State.allTrades;
  if (f === 'win') fl = State.allTrades.filter(t => t.win);
  else if (f === 'loss') fl = State.allTrades.filter(t => !t.win);
  else if (['ema', 'orb', 'smc', 'straddle', 'bull_spread', 'bear_spread'].includes(f)) fl = State.allTrades.filter(t => t.strat === f);

  const sn = { ema: 'EMA', orb: 'ORB', smc: 'SMC', straddle: 'STRADDLE', bull_spread: 'BULL SPR', bear_spread: 'BEAR SPR' };

  DOM.setHtml('trade-body', fl.length ? fl.map(t => `<tr>
    <td style="color:var(--text3)">${t.id}</td>
    <td style="font-size:11px">${DOM.esc(t.date)}</td>
    <td><span style="font-size:9px;padding:2px 6px;background:var(--pale-blue);border-radius:3px;color:var(--blue)">${sn[t.strat] || t.strat}</span></td>
    <td><span style="font-size:9px;color:var(--text3)">${DOM.esc(t.segment || 'equity')}</span></td>
    <td><span style="color:${t.dir === 'LONG' ? 'var(--green)' : 'var(--down)'}">${t.dir==='LONG'?'▲ BUY':'▼ SELL'}</span></td>
    <td style="font-family:var(--font-mono)">${t.entry.toFixed(2)}</td>
    <td style="font-family:var(--font-mono)">${t.exit.toFixed(2)}</td>
    <td>${t.lots ? `${t.lots} lots` : t.qty}</td>
    <td class="${t.grossPnl>=0?'up':'down'}" style="font-family:var(--font-mono)">₹${t.grossPnl.toLocaleString('en-IN')}</td>
    <td style="color:var(--text3);font-family:var(--font-mono)">₹${t.charges}</td>
    <td class="${t.netPnl>=0?'up':'down'}" style="font-weight:600;font-family:var(--font-mono)">₹${t.netPnl.toLocaleString('en-IN')}</td>
    <td style="font-size:10px;color:${t.reason.includes('Target')?'var(--green)':t.reason.includes('SL')?'var(--down)':'var(--text3)'}">${DOM.esc(t.reason)}</td>
  </tr > `).join('') : '<tr><td colspan="12" class="empty-cell">No trades match filter</td></tr>');

  const net  = fl.reduce((a,t)=>a+t.netPnl,0);
  const wins = fl.filter(t=>t.win).length;
  DOM.setHtml('trade-summary', `
    <span style="color:var(--text3)">${fl.length} trades</span>
    <span class="up">Wins: ${wins}</span>
    <span class="down">Losses: ${fl.length-wins}</span>
    <span style="font-family:var(--font-mono);color:${net>=0?'var(--green)':'var(--down)'}">Net: ₹${net.toLocaleString('en-IN')}</span>`);

  renderTVChart(State.btData, State.tradeLog, f);
}

export function renderTVChart(data, logs, filterStrat = 'all') {
  try {
    if (typeof LightweightCharts === 'undefined') return;
    const cDiv = document.getElementById('tv-chart');
    if (!cDiv || !data.length) return;

    const prnt     = document.getElementById('bt-chart');
    const wasHidden = prnt.style.display === 'none';
    if (wasHidden) prnt.style.display = 'block';

    if (State.tvChart) { State.tvChart.remove(); State.tvChart = null; }

    State.tvChart = LightweightCharts.createChart(cDiv, {
      width:  cDiv.clientWidth || 800,
      height: 520,
      layout: { background: { type: 'solid', color: '#FFFFFF' }, textColor: '#3A5260' },
      grid: {
        vertLines: { color: 'rgba(212,233,238,0.5)' },
        horzLines: { color: 'rgba(212,233,238,0.5)' }
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(212,233,238,0.8)' },
      timeScale: { borderColor: 'rgba(212,233,238,0.8)', timeVisible: true }
    });

    State.tvSeries = State.tvChart.addCandlestickSeries({
      upColor:       '#6AB04C',
      downColor:     '#E74C3C',
      borderVisible: false,
      wickUpColor:   '#6AB04C',
      wickDownColor: '#E74C3C'
    });

    State.tvSeries.setData(data.map(d => ({ time: d.ts / 1000, open: d.o, high: d.h, low: d.l, close: d.c })));

    let fl = logs;
    if (filterStrat === 'win')  fl = logs.filter(t => t.win);
    else if (filterStrat === 'loss') fl = logs.filter(t => !t.win);
    else if (['ema','orb','smc','straddle','bull_spread','bear_spread'].includes(filterStrat)) fl = logs.filter(t => t.strat === filterStrat);

    const markers = [];
    const seen    = new Set();
    fl.sort((a,b) => a.entryTs - b.entryTs).forEach(t => {
      const ts = t.entryTs / 1000;
      if (!seen.has(ts)) {
        seen.add(ts);
        markers.push({
          time:     ts,
          position: t.dir === 'LONG' ? 'belowBar' : 'aboveBar',
          color:    t.dir === 'LONG' ? '#6AB04C' : '#E74C3C',
          shape:    t.dir === 'LONG' ? 'arrowUp' : 'arrowDown',
          text:     (t.dir === 'LONG' ? 'B ' : 'S ') + (t.strat || '').toUpperCase()
        });
      }
    });
    if (markers.length) State.tvSeries.setMarkers(markers);
    State.tvChart.timeScale().fitContent();

    if (wasHidden) prnt.style.display = 'none';
  } catch (e) { console.error('TV Chart error:', e); }
}

export function renderAccuracy() {
  const stratNames = { ema:'EMA Cross V2', orb:'ORB 9:30', smc:'SMC FVG', straddle:'Short Straddle', bull_spread:'Bull Call Spread', bear_spread:'Bear Put Spread' };
  DOM.setHtml('bt-acc-content', Object.keys(stratNames).map(s => {
    const st  = State.tradeLog.filter(t => t.strat === s);
    if (!st.length) return '';
    const sw  = st.filter(t => t.win);
    const wr  = (sw.length / st.length * 100).toFixed(1);
    const net = st.reduce((a,t)=>a+t.netPnl,0);
    const tg  = st.filter(t=>t.reason.includes('Target'));
    const sl  = st.filter(t=>t.reason.includes('SL'));
    const c   = +wr >= 60 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)';

    return `< div class="card mb16" >
      <div class="card-header">${stratNames[s]}</div>
      <div class="stats-grid four-col mb12">
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-val" style="color:${c}">${wr}%</div></div>
        <div class="stat-card"><div class="stat-label">Trades</div><div class="stat-val">${st.length}</div></div>
        <div class="stat-card"><div class="stat-label">Net P&L</div><div class="stat-val" style="color:${net>=0?'var(--green)':'var(--down)'}">₹${net.toLocaleString('en-IN')}</div></div>
        <div class="stat-card"><div class="stat-label">Target Hits</div><div class="stat-val up">${tg.length}<span style="font-size:10px;color:var(--text3)"> / SL ${sl.length}</span></div></div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${st.slice(-30).map(t => `<div title="${DOM.esc(t.date)} ${t.dir} ₹${t.netPnl}" style="width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;cursor:help;background:${t.win?'var(--pale-green)':'rgba(231,76,60,0.1)'};border:1px solid ${t.win?'rgba(106,176,76,0.4)':'rgba(231,76,60,0.3)'};color:${t.win?'var(--green)':'var(--down)'};">${t.win?'W':'L'}</div>`).join('')}
        ${st.length > 30 ? `<span style="font-size:10px;color:var(--text3);align-self:center">+${st.length-30} more</span>` : ''}
      </div>
    </div > `;
  }).join('') || '<div class="empty-state">No strategy trades found</div>');
}

/* ═══════════════════════════════════════════
   MODULE: REPLAY
═══════════════════════════════════════════ */
export function initReplay() {
  const date = document.getElementById('rp-date')?.value;
  if (!date) { alert('Select a date'); return; }
  if (!State.btData.length) { alert('Fetch data first'); return; }
  State.rpData = State.btData.filter(d => d.date.toISOString().slice(0, 10) === date);
  if (!State.rpData.length) { alert('No data for this date.'); return; }
  State.rpIdx = 0;
  drawReplay();
}

export function rStep(n) {
  if (!State.rpData.length) { alert('Load a day first'); return; }
  State.rpIdx = Math.max(0, Math.min(State.rpData.length - 1, State.rpIdx + n));
  drawReplay();
}

export function togglePlay() {
  if (!State.rpData.length) { alert('Load a day first'); return; }
  State.rpAuto = !State.rpAuto;
  DOM.setText('rp-play', State.rpAuto ? '⏸ PAUSE' : '▶ PLAY');
  if (State.rpAuto) stepAuto();
}

export function stepAuto() {
  if (!State.rpAuto) return;
  if (State.rpIdx >= State.rpData.length - 1) {
    State.rpAuto = false;
    DOM.setText('rp-play', '▶ PLAY');
    return;
  }
  State.rpIdx++;
  drawReplay();
  setTimeout(stepAuto, +(document.getElementById('rp-speed')?.value || 500));
}

export function drawReplay() {
  const canvas = document.getElementById('rp-canvas');
  if (!canvas || !State.rpData.length) return;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.offsetWidth || 800;
  const H      = 300;
  canvas.width  = W;
  canvas.height = H;
  ctx.fillStyle = '#FAFCFD';
  ctx.fillRect(0, 0, W, H);

  const slice  = State.rpData.slice(0, State.rpIdx + 1);
  const prices = State.rpData.flatMap(c => [c.h, c.l]);
  const mn     = Math.min(...prices);
  const mx     = Math.max(...prices);
  const rng    = mx - mn || 1;
  const bw     = Math.max(2, (W - 20) / State.rpData.length - 1);
  const ty     = v => 10 + (mx - v) / rng * (H - 40);
  const tx     = i => 10 + i * (W - 20) / State.rpData.length + bw / 2;

  // Future candles (ghosted)
  State.rpData.forEach((c, i) => {
    if (i > State.rpIdx) {
      ctx.fillStyle = 'rgba(212,233,238,0.3)';
      ctx.fillRect(tx(i) - bw/2, ty(c.h), bw, ty(c.l) - ty(c.h) || 1);
    }
  });

  // EMA lines
  const cls  = slice.map(c => c.c);
  const e9r  = Indicators.ema(cls, 9);
  const e21r = Indicators.ema(cls, 21);
  [[e9r, '#2980B9'], [e21r, '#6AB04C']].forEach(([ema, col]) => {
    ctx.strokeStyle = col + '99';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ema.forEach((v, i) => i === 0 ? ctx.moveTo(tx(i), ty(v)) : ctx.lineTo(tx(i), ty(v)));
    ctx.stroke();
  });

  // Candles
  slice.forEach((c, i) => {
    const up = c.c >= c.o;
    ctx.fillStyle   = up ? '#6AB04C' : '#E74C3C';
    ctx.strokeStyle = up ? '#4e8a38' : '#c0392b';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(tx(i), ty(c.h)); ctx.lineTo(tx(i), ty(c.l)); ctx.stroke();
    const bt = ty(Math.max(c.o, c.c));
    const bh = Math.abs(ty(c.o) - ty(c.c)) || 1;
    ctx.fillRect(tx(i) - bw/2 + 1, bt, bw - 2, bh);
  });

  // Current price line
  if (slice.length) {
    const last = slice[slice.length - 1];
    ctx.strokeStyle = '#2980B9';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, ty(last.c)); ctx.lineTo(W, ty(last.c)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2980B9';
    ctx.font      = '10px DM Mono, monospace';
    ctx.fillText(last.c.toFixed(2), W - 64, ty(last.c) - 3);
  }

  const cur  = State.rpData[State.rpIdx];
  const rsi2 = Indicators.rsi(State.rpData.slice(0, State.rpIdx + 1).map(c => c.c));
  const rv   = rsi2[rsi2.length - 1] || 50;

  DOM.setText('rp-t',   cur.date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  DOM.setText('rp-o',   cur.o.toFixed(2));
  DOM.setText('rp-h',   cur.h.toFixed(2));
  DOM.setText('rp-l',   cur.l.toFixed(2));
  DOM.setText('rp-c',   cur.c.toFixed(2));
  DOM.setColor('rp-c',  cur.c >= cur.o ? 'var(--green)' : 'var(--down)');
  DOM.setText('rp-rsi', rv.toFixed(1));
  DOM.setColor('rp-rsi', rv < 30 ? 'var(--green)' : rv > 70 ? 'var(--down)' : 'var(--text)');
  DOM.setText('rp-sig', rv < 30 ? '▲ RSI BUY' : rv > 70 ? '▼ RSI SELL' : '— NEUTRAL');
  DOM.setText('rp-idx', `${ State.rpIdx + 1 }/${State.rpData.length}`);

const dp = State.tradeLog
  .filter(t => t.date.startsWith(cur.date.toLocaleDateString('en-IN')))
  .reduce((a, t) => a + t.netPnl, 0);
DOM.setText('rp-pnl', `₹${dp.toLocaleString('en-IN')}`);
DOM.setColor('rp-pnl', dp >= 0 ? 'var(--green)' : 'var(--down)');
}

export function btReset() {
  State.reset();
  DOM.setWidth('bt-prog', 0);
  DOM.setText('bt-data-status', '⚠ Click FETCH DATA to load from Yahoo Finance');
  if (document.getElementById('bt-run-btn')) document.getElementById('bt-run-btn').disabled = true;
  if (document.getElementById('ai-review-btn')) document.getElementById('ai-review-btn').disabled = true;
  DOM.setText('bt-status', '');
  DOM.setHtml('trade-body', '<tr><td colspan="12" class="empty-cell">Run backtest first</td></tr>');
  switchBTTab('bt-setup');
}

/* ═══════════════════════════════════════════
   MODULE: TRADE LOG / AI REVIEW
═══════════════════════════════════════════ */
export function updatePerfSummary() {
  if (!State.tradeLog.length) return;
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wins = State.tradeLog.filter(t => t.win).length;
  const wr = (wins / State.tradeLog.length * 100).toFixed(1);
  DOM.setText('ps-trades', State.tradeLog.length);
  DOM.setText('ps-wr', wr + '%');
  DOM.setColor('ps-wr', +wr >= 55 ? 'var(--green)' : +wr >= 45 ? 'var(--warn)' : 'var(--down)');
  DOM.setText('ps-pnl', '₹' + net.toLocaleString('en-IN'));
  DOM.setColor('ps-pnl', net >= 0 ? 'var(--green)' : 'var(--down)');
  DOM.setText('ps-sharpe', calcSharpe());
}

export async function getAIReview() {
  if (!State.tradeLog.length) { alert('Run backtest first'); return; }
  DOM.setHtml('ai-review-area', '<span class="spinr"></span> Analyzing with veteran perspective...');

  const wins = State.tradeLog.filter(t => t.win).length;
  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const wr = (wins / State.tradeLog.length * 100).toFixed(1);
  const mdd = calcMaxDD();
  const sh = calcSharpe();
  const stList = ['ema', 'orb', 'smc', 'straddle', 'bull_spread', 'bear_spread'].map(s => {
    const st = State.tradeLog.filter(t => t.strat === s);
    const sw = st.filter(t => t.win);
    return st.length ? `${s.toUpperCase()}: ${st.length} trades, ${sw.length} wins (${st.length ? (sw.length / st.length * 100).toFixed(0) : 0}% WR), net ₹${st.reduce((a, t) => a + t.netPnl, 0).toLocaleString('en-IN')}` : null;
  }).filter(Boolean).join('\n');

  const prompt = `You are a veteran Indian stock market analyst. Review this backtest result honestly:
Symbol: ${document.getElementById('bt-sym')?.options[document.getElementById('bt-sym')?.selectedIndex]?.text}
Segment: ${document.getElementById('bt-segment')?.value}
Timeframe: ${document.getElementById('bt-tf')?.value} | Period: ${document.getElementById('bt-period')?.value}
Capital/trade: ₹${(+(document.getElementById('bt-capital')?.value || 50000)).toLocaleString('en-IN')}
Total Trades: ${State.tradeLog.length} | Win Rate: ${wr}% | Net P&L: ₹${net.toLocaleString('en-IN')} | Max DD: ₹${Math.abs(mdd).toLocaleString('en-IN')} | Sharpe: ${sh}
Strategy Breakdown:\n${stList}
Give a direct 5-6 sentence analysis: overall verdict, best strategy and why, biggest weakness, improvement suggestions, risk management advice. Be tough and honest — no sugarcoating.`;

  try {
    const raw = await callClaude(prompt, CONFIG.ANALYST_PERSONA, false);
    DOM.setHtml('ai-review-area', raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--blue)">$1</strong>'));
  } catch { DOM.setText('ai-review-area', 'Error. Please add your API key and retry.'); }
}

export async function askAIQa() {
  const q = (document.getElementById('ai-qa-input')?.value || '').trim();
  if (!q) return;
  DOM.setText('ai-qa-input', '');

  const area = document.getElementById('ai-review-area');
  const qDiv = document.createElement('div');
  qDiv.style.cssText = 'color:var(--blue);margin:10px 0 4px;font-size:12px;';
  qDiv.textContent = '▶ ' + q;
  area.appendChild(qDiv);

  const ansDiv = document.createElement('div');
  ansDiv.innerHTML = '<span class="spinr"></span>';
  area.appendChild(ansDiv);
  area.scrollTop = 99999;

  const net = State.tradeLog.reduce((a, t) => a + t.netPnl, 0);
  const ctx = `Backtest: ${State.tradeLog.length} trades, ${State.tradeLog.length ? (State.tradeLog.filter(t => t.win).length / State.tradeLog.length * 100).toFixed(1) : 0}% WR, ₹${net} net, Sharpe: ${calcSharpe()}. Q: ${q}`;

  try {
    const raw = await callClaude(ctx, CONFIG.ANALYST_PERSONA, false);
    ansDiv.innerHTML = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  } catch { ansDiv.textContent = 'Error. Please retry.'; }
  area.scrollTop = 99999;
}
