'use strict';

export const State = {
  chatHistory: [],
  btData: [],
  tradeLog: [],
  equityHistory: [],
  allTrades: [],
  recentSignals: [],
  ptPositions: [],
  selStrats: new Set(['ema', 'orb', 'smc']),
  tvChart: null,
  tvSeries: null,
  rpData: [],
  rpIdx: 0,
  rpAuto: false,
  pnlInterval: null,
  reset() {
    this.btData = [];
    this.tradeLog = [];
    this.equityHistory = [];
    this.allTrades = [];
  }
};
