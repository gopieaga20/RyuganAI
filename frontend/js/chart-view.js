'use strict';
/* Candlestick chart with timeframe buttons and strategy/indicator overlays (lightweight-charts v4). */
import { yahooFetch, _toYahooSym } from './market-data.js';
import { subscribeLivePrices } from './ws-prices.js';
import { Indicators } from './indicators.js';
import { buildStructure } from './smc-structure.js';
import { evaluate } from './strategies.js';
import { toCandles, vwapIst } from './candles.js';
import { CHART_TF } from './timeframes.js';

const IST_SHIFT = 19800;   // lightweight-charts draws UTC; shift so the axis reads IST

export const CHART_OVERLAYS = [
  { id: 'ema',     label: 'EMA 9/21/50', on: true },
  { id: 'vwap',    label: 'VWAP',        on: true },
  { id: 'bb',      label: 'Bollinger',   on: false },
  { id: 'vol',     label: 'Volume',      on: true },
  { id: 'rsi',     label: 'RSI',         on: true },
  { id: 'struct',  label: 'BOS / CHoCH', on: true },
  { id: 'fvg',     label: 'FVG zones',   on: true },
  { id: 'signals', label: 'Signals',     on: false },
];

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const ChartView = (() => {
  let main = null, rsiChart = null, el = null, rsiEl = null;
  let candleS = null, volS = null, rsiS = null, rsiHi = null, rsiLo = null;
  let lines = {};                 // id -> line series (ema9, ema21, ema50, vwap, bbU, bbM, bbL)
  let fvgLines = [], priceLines = [];
  let state = { sym: null, tf: CHART_TF[2], candles: [], overlays: Object.fromEntries(CHART_OVERLAYS.map(o => [o.id, o.on])), levels: null };
  let unsub = null, loadSeq = 0, onData = null, syncing = false;
  // bar replay: the chart shows candles [0..idx] only, as if the market were at that moment
  const replay = { on: false, idx: 0, playing: false, speed: 1, timer: null, cb: null };
  const cur = () => (replay.on ? state.candles.slice(0, replay.idx + 1) : state.candles);

  function chartOptions(height) {
    const bg = css('--chart-bg', '#0b0f14'), tx = css('--chart-text', '#9aa7b4'), gr = css('--chart-grid', 'rgba(255,255,255,.05)');
    return {
      height,
      layout: { background: { type: 'solid', color: bg }, textColor: tx, fontFamily: 'DM Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: gr }, horzLines: { color: gr } },
      rightPriceScale: { borderColor: gr, minimumWidth: 78, scaleMargins: { top: 0.06, bottom: 0.2 } },
      timeScale: { borderColor: gr, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: 0 },
    };
  }

  function init(chartEl, rsiElement, dataCb) {
    if (!window.LightweightCharts) { chartEl.innerHTML = '<div class="empty-cell">Chart library failed to load (check your internet connection).</div>'; return false; }
    el = chartEl; rsiEl = rsiElement; onData = dataCb || null;
    main = LightweightCharts.createChart(el, { ...chartOptions(el.clientHeight || 420), width: el.clientWidth });
    rsiChart = LightweightCharts.createChart(rsiEl, { ...chartOptions(rsiEl.clientHeight || 110), width: rsiEl.clientWidth });
    rsiChart.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });
    buildSeries();
    // keep the two time axes together
    main.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && !syncing) { syncing = true; rsiChart.timeScale().setVisibleLogicalRange(r); syncing = false; } });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && !syncing) { syncing = true; main.timeScale().setVisibleLogicalRange(r); syncing = false; } });
    main.subscribeClick(param => {
      if (!replay.on || param.time == null) return;
      const i = state.candles.findIndex(c => t(c) === param.time);
      if (i >= 30) { playReplay(false); setReplayIdx(i); }
    });
    new ResizeObserver(resize).observe(el);
    window.addEventListener('resize', resize);
    return true;
  }

  /** Fit both charts to their containers (also called explicitly after layout changes such as full view). */
  function resize() {
    if (!main || !el) return;
    main.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    rsiChart.applyOptions({ width: rsiEl.clientWidth, height: rsiEl.clientHeight });
  }

  function buildSeries() {
    const up = css('--up', '#26a69a'), down = css('--down', '#ef5350');
    candleS = main.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    volS = main.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ln = (color, width = 1, style = 0) => main.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    lines = {
      ema9: ln('#f5c542', 1), ema21: ln('#4aa3ff', 1), ema50: ln('#c58bff', 2), vwap: ln('#ff8a3d', 2),
      bbU: ln('rgba(150,170,190,.7)', 1, 2), bbM: ln('rgba(150,170,190,.4)', 1, 2), bbL: ln('rgba(150,170,190,.7)', 1, 2),
    };
    rsiS = rsiChart.addLineSeries({ color: css('--accent', '#2fc66a'), lineWidth: 1, priceLineVisible: false });
    rsiHi = rsiS.createPriceLine({ price: 70, color: 'rgba(239,83,80,.6)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiLo = rsiS.createPriceLine({ price: 30, color: 'rgba(38,166,154,.6)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
  }

  const t = c => c.ts / 1000 + IST_SHIFT;
  const series = (candles, vals, from = 0) => candles.map((c, i) => (i >= from && Number.isFinite(vals[i]) ? { time: t(c), value: vals[i] } : null)).filter(Boolean);

  function render() {
    const cs = cur(), o = state.overlays;
    if (!cs.length) { candleS.setData([]); return; }
    candleS.setData(cs.map(c => ({ time: t(c), open: c.o, high: c.h, low: c.l, close: c.c })));
    const upC = css('--up-soft', 'rgba(38,166,154,.45)'), dnC = css('--down-soft', 'rgba(239,83,80,.45)');
    volS.setData(o.vol ? cs.map(c => ({ time: t(c), value: c.v || 0, color: c.c >= c.o ? upC : dnC })) : []);
    const closes = cs.map(c => c.c);
    const intraday = state.tf.intraday;
    lines.ema9.setData(o.ema ? series(cs, Indicators.ema(closes, 9), 9) : []);
    lines.ema21.setData(o.ema ? series(cs, Indicators.ema(closes, 21), 21) : []);
    lines.ema50.setData(o.ema ? series(cs, Indicators.ema(closes, 50), 50) : []);
    lines.vwap.setData(o.vwap && intraday ? series(cs, vwapIst(cs), 1) : []);
    const bb = Indicators.bb(closes, 20, 2);
    lines.bbU.setData(o.bb ? series(cs, bb.map(b => b.upper), 20) : []);
    lines.bbM.setData(o.bb ? series(cs, bb.map(b => b.mid), 20) : []);
    lines.bbL.setData(o.bb ? series(cs, bb.map(b => b.lower), 20) : []);
    const rsiVals = Indicators.rsi(closes, 14);
    rsiS.setData(cs.map((c, i) => (i >= 15 && Number.isFinite(rsiVals[i]) ? { time: t(c), value: rsiVals[i] } : { time: t(c) })));
    rsiEl.style.display = o.rsi ? '' : 'none';
    main.applyOptions({ height: el.clientHeight });
    if (o.rsi) rsiChart.applyOptions({ height: rsiEl.clientHeight, width: rsiEl.clientWidth });

    drawMarkers();
    drawFvg();
    drawLevels();
  }

  function drawMarkers() {
    const cs = cur(), o = state.overlays, marks = [];
    if (o.struct && cs.length > 20) {
      const S = buildStructure(cs, 3);
      cs.forEach((c, i) => {
        const ev = S.events[i]; if (!ev) return;
        const long = ev.dir === 'LONG';
        marks.push({ time: t(c), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: ev.type === 'CHoCH' ? '#ffb020' : (long ? '#26a69a' : '#ef5350'), text: ev.type });
      });
    }
    if (o.signals && cs.length > 80) {
      // replay the vote over the most recent bars; mark where a CE/PE call first appears
      let prev = 'WAIT';
      for (let k = Math.max(60, cs.length - 90); k < cs.length; k++) {
        const r = evaluate(cs.slice(0, k + 1), { intraday: state.tf.intraday });
        if (r.ok && r.call !== 'WAIT' && prev !== r.call) {
          const ce = r.call === 'BUY CE';
          marks.push({ time: t(cs[k]), position: ce ? 'belowBar' : 'aboveBar', shape: ce ? 'arrowUp' : 'arrowDown', color: ce ? '#3ddc97' : '#ff6b6b', text: r.call, size: 2 });
        }
        prev = r.ok ? r.call : 'WAIT';
      }
    }
    marks.sort((a, b) => a.time - b.time);
    candleS.setMarkers(marks.slice(-80));
  }

  function drawFvg() {
    for (const s of fvgLines) main.removeSeries(s);
    fvgLines = [];
    const cs = cur();
    if (!state.overlays.fvg || cs.length < 20) return;
    const S = buildStructure(cs, 3), last = cs.length - 1;
    const live = [];
    for (let q = S.fvgs.length - 1; q >= 0 && live.length < 4; q--) {
      const z = S.fvgs[q]; let dead = false;
      for (let m = z.i + 1; m <= last; m++) if (z.dir === 'LONG' ? cs[m].c < z.bottom : cs[m].c > z.top) { dead = true; break; }
      if (!dead && last - z.i < 120) live.push(z);
    }
    for (const z of live) {
      const col = z.dir === 'LONG' ? 'rgba(38,166,154,.8)' : 'rgba(239,83,80,.8)';
      for (const p of [z.top, z.bottom]) {
        const s = main.addLineSeries({ color: col, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData([{ time: t(cs[z.i]), value: p }, { time: t(cs[last]), value: p }]);
        fvgLines.push(s);
      }
    }
  }

  function drawLevels() {
    for (const pl of priceLines) candleS.removePriceLine(pl);
    priceLines = [];
    const L = state.levels; if (!L) return;
    const add = (price, color, title) => priceLines.push(candleS.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
    add(L.sl, '#ef5350', 'SL'); add(L.t1, '#26a69a', 'T1'); add(L.t2, '#26a69a', 'T2');
  }

  async function load(sym, tfKey) {
    if (!main) return;
    state.sym = sym;
    if (tfKey) state.tf = CHART_TF.find(x => x.key === tfKey) || state.tf;
    const seq = ++loadSeq;
    stopReplay(false);
    const j = await yahooFetch(_toYahooSym(sym), state.tf.interval, state.tf.range);
    if (seq !== loadSeq) return;                       // a newer request replaced this one
    state.candles = toCandles(j);
    render();
    main.timeScale().fitContent();
    if (onData) onData(state.candles, state.tf, state.sym);
    startLive();
    return state.candles.length;
  }

  function startLive() {
    if (unsub) { unsub(); unsub = null; }
    if (!state.sym || !state.tf.intraday) return;
    const key = _toYahooSym(state.sym);
    unsub = subscribeLivePrices([key], prices => {
      const p = prices[key]; const cs = state.candles;
      if (replay.on || p == null || !cs.length) return;
      const last = cs[cs.length - 1];
      last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p);
      candleS.update({ time: t(last), open: last.o, high: last.h, low: last.l, close: last.c });
    });
  }

  /* ───────────── bar replay ───────────── */
  const MIN_REPLAY = 60;                       // the strategies need ~60 candles of history
  function emitReplay() {
    if (replay.cb) replay.cb({ on: replay.on, idx: replay.idx, total: state.candles.length, playing: replay.playing, speed: replay.speed, candle: state.candles[replay.idx] || null });
  }
  function startReplay(from) {
    const n = state.candles.length;
    if (n <= MIN_REPLAY + 1) return false;
    replay.on = true; replay.playing = false;
    replay.idx = Math.min(n - 2, Math.max(MIN_REPLAY, from ?? n - 80));
    render(); main.timeScale().scrollToRealTime(); emitReplay();
    return true;
  }
  function stopReplay(redraw = true) {
    if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
    const was = replay.on;
    replay.on = false; replay.playing = false;
    if (was) { if (redraw) { render(); main.timeScale().fitContent(); } emitReplay(); }
  }
  function setReplayIdx(i) {
    if (!replay.on) return;
    replay.idx = Math.max(MIN_REPLAY, Math.min(state.candles.length - 1, Math.round(i)));
    render(); emitReplay();
  }
  function stepReplay(d = 1) {
    if (!replay.on) return;
    const next = replay.idx + d;
    if (next >= state.candles.length) { playReplay(false); return; }
    setReplayIdx(next);
  }
  function playReplay(on) {
    if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
    replay.playing = !!on && replay.on;
    if (replay.playing) {
      if (replay.idx >= state.candles.length - 1) replay.idx = MIN_REPLAY;     // restart from the beginning at the end
      replay.timer = setInterval(() => stepReplay(1), Math.max(60, 1000 / replay.speed));
    }
    emitReplay();
  }
  function setReplaySpeed(x) { replay.speed = x; if (replay.playing) playReplay(true); else emitReplay(); }

  function setOverlay(id, on) { state.overlays[id] = on; render(); }
  function setLevels(levels) { state.levels = levels; if (main) drawLevels(); }
  function applyTheme() {
    if (!main) return;
    main.applyOptions(chartOptions(el.clientHeight)); rsiChart.applyOptions(chartOptions(rsiEl.clientHeight));
    const up = css('--up', '#26a69a'), down = css('--down', '#ef5350');
    rsiChart.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });
    rsiS.applyOptions({ color: css('--accent', '#2fc66a') });
    candleS.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    render();
  }

  return {
    init, load, setOverlay, setLevels, applyTheme, resize,
    startReplay, stopReplay, setReplayIdx, stepReplay, playReplay, setReplaySpeed,
    onReplay(cb) { replay.cb = cb; },
    visible: cur,
    get replaying() { return replay.on; },
    get state() { return state; }, get ready() { return !!main; },
  };
})();
