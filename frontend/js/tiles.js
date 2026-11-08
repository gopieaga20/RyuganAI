/* Tiles: every data table row is drawn as a tile (see the "tiles" block in ui.css). The CSS needs two small facts per cell that the
   markup does not carry: which column it belongs to (its label, shown above the value) and whether the row is in profit or loss
   (the coloured edge of the tile). This module stamps them with a MutationObserver, so rows built by any page's render code are
   covered without touching that code. The pure functions are unit-tested. */

/** Header cells [{text, span}] -> the label of each column index, honouring colspan. */
export function labelsFor(headerCells) {
  const out = [];
  for (const h of headerCells) {
    const span = Math.max(1, Number(h.span) || 1);
    for (let i = 0; i < span; i++) out.push(String(h.text || '').trim());
  }
  return out;
}

/** The label for each cell of a row [{span}], given the column labels. A cell spanning columns takes its first column's label. */
export function rowLabels(labels, cells) {
  const out = [];
  let col = 0;
  for (const c of cells) {
    out.push(labels[col] || '');
    col += Math.max(1, Number(c.span) || 1);
  }
  return out;
}

/** 'up' | 'down' | null from the text of a profit/loss cell ("+1,234.50", "-₹500", "₹-60.00", "0.00"). */
export function tileTone(label, text) {
  if (!/p&l|pnl|profit|unreal|change|chg/i.test(label || '')) return null;
  const t = String(text || '').replace(/[,\s₹]/g, '');
  const m = t.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 'up' : 'down';
}

/** A cell with a long value (an option contract, a reason) is given two columns so it does not run into its neighbour. */
export function isWide(text) {
  const t = String(text || '').trim();
  return t.length > 13 && !t.includes(' ') ? true : t.length > 22;
}

const SELECTOR = 'table.dtbl:not(.keep-table), table.scan-table';

function processTable(table) {
  const head = table.tHead?.rows?.[0];
  const labels = head ? labelsFor([...head.cells].map(h => ({ text: h.textContent, span: h.colSpan }))) : [];
  for (const body of table.tBodies) {
    for (const tr of body.rows) {
      const cells = [...tr.cells];
      const names = rowLabels(labels, cells.map(c => ({ span: c.colSpan })));
      let tone = null;
      cells.forEach((td, i) => {
        if (td.dataset.label !== names[i]) td.dataset.label = names[i];
        const wide = i > 0 && isWide(td.textContent) ? '1' : '';
        if ((td.dataset.wide || '') !== wide) { if (wide) td.dataset.wide = wide; else delete td.dataset.wide; }
        if (!tone) tone = tileTone(names[i], td.textContent);
      });
      if (tone) { if (tr.dataset.tone !== tone) tr.dataset.tone = tone; }
      else if (tr.dataset.tone) delete tr.dataset.tone;
    }
  }
}

export function applyTiles(root = document) {
  root.querySelectorAll(SELECTOR).forEach(processTable);
}

export function initTiles() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const pending = new Set();
  let queued = false;
  const flush = () => {
    queued = false;
    const tables = [...pending]; pending.clear();
    tables.forEach(t => { if (t.isConnected && t.matches(SELECTOR)) processTable(t); });
  };
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const table = el?.closest?.('table');
      if (table && table.matches(SELECTOR)) pending.add(table);
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches?.(SELECTOR)) pending.add(n);
        n.querySelectorAll?.(SELECTOR).forEach(t => pending.add(t));
      });
    }
    if (pending.size && !queued) { queued = true; setTimeout(flush, 16); }      // a timer, not requestAnimationFrame: that pauses in a background tab
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  applyTiles();
}
