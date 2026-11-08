/* A subtle 3D feel: tiles and stat cards tilt a few degrees toward the mouse and lift on hover (CSS reads --rx / --ry).
   Only for a real mouse, never on touch screens, and never when the user asked for reduced motion. */
const MAX_DEG = 2.6;
const SELECTOR = 'table.dtbl:not(.keep-table) tbody tr, table.scan-table tbody tr, .stat-card';

/** Tilt angles in degrees for a pointer at (x, y) inside `rect`: the near edge dips, so the tile leans toward the pointer. */
export function tiltFor(rect, x, y, max = MAX_DEG) {
  if (!rect || !rect.width || !rect.height) return { rx: 0, ry: 0 };
  const nx = Math.min(1, Math.max(-1, ((x - rect.left) / rect.width - 0.5) * 2));
  const ny = Math.min(1, Math.max(-1, ((y - rect.top) / rect.height - 0.5) * 2));
  const round = v => Math.round(v * 100) / 100 + 0;                // + 0 turns -0 into 0
  return { rx: round(-ny * max), ry: round(nx * max) };
}

export function initTilt() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let current = null, lastAt = 0;
  const reset = el => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } };
  document.addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lastAt < 24) return;
    lastAt = now;
    const el = e.target.closest?.(SELECTOR) || null;
    if (el !== current) { reset(current); current = el; }
    if (!el) return;
    const { rx, ry } = tiltFor(el.getBoundingClientRect(), e.clientX, e.clientY);
    el.style.setProperty('--rx', rx + 'deg');
    el.style.setProperty('--ry', ry + 'deg');
  }, { passive: true });
  document.addEventListener('pointerleave', () => { reset(current); current = null; }, true);
  window.addEventListener('blur', () => { reset(current); current = null; });
}
