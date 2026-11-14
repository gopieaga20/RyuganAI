'use strict';
/* Pure helpers for the Screener page (no DOM): formatting, filtering, sorting, plain-language texts. Unit-tested in tests/screener-utils.test.mjs. */

export const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(Number(v))) ? '--' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = v => (v === null || v === undefined || Number.isNaN(Number(v))) ? '--' : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

/** Sort rows by a column key; text columns A-Z, numbers high to low unless `asc`. Rows without a value always go last. Never mutates. */
export function sortRows(rows, key = 'score', asc = false) {
  const val = r => key === 'entry' || key === 'stop' || key === 't1' || key === 't2' || key === 'qty' || key === 'rr' ? r.setup?.[key] : r[key];
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const nx = x === null || x === undefined, ny = y === null || y === undefined;
    if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
    if (typeof x === 'string') return asc ? x.localeCompare(y) : y.localeCompare(x);
    return asc ? x - y : y - x;
  });
}

/** Filter by tab ('feed' | 'setups' | 'all'), a symbol/industry search and the "hygiene ok only" switch. */
export function filterRows(rows, { view = 'feed', q = '', hygieneOnly = true } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter(r => {
    if (hygieneOnly && !r.hygiene?.ok) return false;
    if (view === 'feed' && !r.feed) return false;
    if (view === 'setups' && !r.setup) return false;
    return !needle || r.symbol.toLowerCase().includes(needle) || (r.industry || '').toLowerCase().includes(needle);
  });
}

/** One row's rule list for the expand panel: [{label, state: 'pass'|'fail'|'na', value}] from the server's gate and score parts. */
export function checklist(r) {
  const out = [];
  const tg = r.tech_gate?.checks || {};
  const T = { trend: 'Price > 50-EMA > 200-EMA', slope: '200-EMA rising over 20 sessions', rs: 'RS rating above 80', proximity: 'Within 15% of the 52-week high' };
  for (const k of Object.keys(T)) if (k in tg) out.push({ group: 'Technical gate', label: T[k], state: tg[k] ? 'pass' : 'fail', value: k === 'rs' ? r.rs : k === 'proximity' ? `${num(r.near_high_pct, 1)}% below` : null });
  for (const [k, p] of Object.entries(r.fund_parts || {})) out.push({ group: 'Fundamentals', label: p.label, state: p.ok === null ? 'na' : p.ok ? 'pass' : 'fail', value: p.value });
  const h = r.hygiene || {};
  out.push({ group: 'Hygiene', label: 'Average daily turnover', state: 'pass', value: h.turnover_cr !== undefined ? `₹${num(h.turnover_cr, 0)} cr` : null });
  for (const [k, label] of [['asm', 'Not in ASM'], ['gsm', 'Not in GSM'], ['ban', 'Not in the F&O ban list']]) out.push({ group: 'Hygiene', label, state: h[k] === null || h[k] === undefined ? 'na' : h[k] ? 'fail' : 'pass', value: null });
  return out;
}

/** The risk figures for a setup in words, e.g. "Risk ₹12,000 for 100 shares; T1 gives 2.0 times that". */
export function setupText(s) {
  if (!s) return 'No setup today';
  const risk = (s.entry - s.stop) * s.qty;
  return `${s.type === 'BREAKOUT' ? 'Breakout' : 'Pullback'}: risk ${money(risk)} for ${s.qty} shares; T1 pays ${num(s.rr, 1)} times that`;
}

/** A score band for colouring: 'hi' (>= min), 'mid' (>= min - 15), 'lo'. */
export const scoreBand = (score, min = 75) => score >= min ? 'hi' : score >= min - 15 ? 'mid' : 'lo';

/** "3 of 4 quarters old" style age text for a fundamentals as-of date. */
export function ageText(iso, today = new Date()) {
  if (!iso) return 'no data';
  const d = Math.floor((today - new Date(iso)) / 86400000);
  if (!(d >= 0)) return iso;
  return d < 45 ? `${d} days old` : `${Math.round(d / 30)} months old`;
}

/** Progress text while a run or refresh is going. */
export function progressText(st) {
  if (st?.running) return `Running: ${st.phase || 'starting'}${st.total ? ` (${st.done}/${st.total})` : ''}`;
  if (st?.fund_running) return `Refreshing fundamentals ${st.fund_done}/${st.fund_total}${st.fund_errors ? `, ${st.fund_errors} skipped` : ''}`;
  return '';
}
