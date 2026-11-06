/* Page addresses: every page has its own URL, like https://host/#/paper, so a refresh, a bookmark or the Back button keeps the page.
   Pure functions (no DOM), so they are unit-tested. */
export const PAGES = ['dash', 'live', 'nifty', 'signals', 'morning', 'fo', 'sectors', 'backtest', 'analyst', 'tradelog', 'paper'];

export const TITLES = {
  dash: 'Dashboard', live: 'Live Trading', nifty: 'Nifty', signals: 'Signals', morning: 'Morning Brief', fo: 'Options',
  sectors: 'Sectors', backtest: 'Backtest', analyst: 'AI Analyst', tradelog: 'Trade Log', paper: 'Paper Trading',
};

/** '#/paper' -> 'paper'. Anything unknown, empty or malformed -> 'dash'. Never throws. */
export function parseRoute(hash) {
  try {
    const name = String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0].trim().toLowerCase();
    return PAGES.includes(name) ? name : 'dash';
  } catch { return 'dash'; }
}

export const hashFor = page => '#/' + page;
export const titleFor = page => `${TITLES[page] || 'Dashboard'} · Ryugan Pro`;
