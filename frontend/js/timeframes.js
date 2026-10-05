'use strict';

/* Timeframe configuration shared by the Signal Engine and Backtest.
   `swing` timeframes (daily and above) are treated as continuous series:
   no per-day grouping, no time-of-day filters, no EOD square-off. */

export const SIGNAL_TF = {
  '5min':    { interval: '5m',  range: '5d',  swing: false, label: '5 Min' },
  '15min':   { interval: '15m', range: '5d',  swing: false, label: '15 Min' },
  '30min':   { interval: '30m', range: '1mo', swing: false, label: '30 Min' },
  '1hr':     { interval: '1h',  range: '1mo', swing: false, label: '1 Hour' },
  'daily':   { interval: '1d',  range: '1y',  swing: true,  label: 'Daily' },
  'weekly':  { interval: '1wk', range: '5y',  swing: true,  label: 'Weekly' },
  'monthly': { interval: '1mo', range: '10y', swing: true,  label: 'Monthly' },
  'yearly':  { interval: '1y',  range: 'max', swing: true,  label: 'Yearly' },
};

export const BT_SWING_INTERVALS = new Set(['1d', '1wk', '1mo', '1y']);

// Sensible default lookback when the user switches backtest timeframe.
export const BT_DEFAULT_PERIOD = {
  '5m': '3mo', '15m': '3mo', '30m': '3mo', '1h': '6mo',
  '1d': '1y', '1wk': '5y', '1mo': '10y', '1y': 'max',
};

// Approximate trading bars per period unit, used only for demo-data fallback.
export const BT_PERIOD_DAYS = {
  '1mo': 22, '3mo': 66, '6mo': 132, '1y': 252, '2y': 504, '5y': 1260, '10y': 2520, 'max': 5040,
};
