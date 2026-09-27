'use strict';

export const DOM = {
  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? '--');
  },
  setHtml(id, html) {
    /* Only used for trusted, internally-generated HTML */
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  },
  setColor(id, color) {
    const el = document.getElementById(id);
    if (el) el.style.color = color;
  },
  setWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  },
  show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; },
  hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; },
  /** Escape user text for embedding in HTML strings (trusted builders only) */
  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};
