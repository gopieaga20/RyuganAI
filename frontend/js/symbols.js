'use strict';

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/** Split a real contract symbol like NIFTY27OCT2623100CE into its parts, or null if it isn't one. */
export function parseOptionSymbol(raw) {
  const m = String(raw || '').trim().toUpperCase().match(/^([A-Z0-9][A-Z0-9&-]*?)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$/);
  if (!m || !MONTHS[m[3]]) return null;
  return { underlying: m[1], expiry: `${m[2]}${m[3]}20${m[4]}`, strike: Number(m[5]), type: m[6] };
}
