'use strict';
/* The owner's Profile settings that the rest of the app reads: which strategies are switched off, and whether live trading is allowed.
   Loaded once after login (and again whenever Profile saves). Other modules call getDisabled() when they evaluate a vote. */

import { CONFIG } from './config.js';

const state = { disabled: [], liveAllowed: false, loaded: false };

/** [{id, enabled}] from /api/profile/settings -> ids that are switched off. Pure. */
export const disabledFrom = settings => (settings?.strategies || []).filter(s => !s.enabled).map(s => s.id);

export const getDisabled = () => state.disabled.slice();
export const isLiveAllowed = () => state.liveAllowed;
export const prefsLoaded = () => state.loaded;

/** Take new settings from the server and tell the page (dashboard, chart and scanner re-run their votes). */
export function applySettings(settings) {
  if (!settings) return;
  const before = state.disabled.join(',');
  state.disabled = disabledFrom(settings);
  state.liveAllowed = !!settings.live_allowed;
  state.loaded = true;
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('prefs-changed', { detail: { liveAllowed: state.liveAllowed } }));
    if (before !== state.disabled.join(',')) document.dispatchEvent(new CustomEvent('strategies-changed'));
  }
}

export async function loadPrefs() {
  try {
    const r = await fetch(CONFIG.PROXY_BASE + '/api/profile/settings', { cache: 'no-store' });
    if (r.ok) applySettings(await r.json());
  } catch { /* offline: keep the defaults (all strategies on) */ }
}
