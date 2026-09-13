// Turning a blocked fulfillment report into edits a rep can actually make.
//
// The reconciliation view started out read-only: it named the row that was off and
// then left the rep to go find that item and retype the number themselves. These
// helpers produce the concrete sales-order edits that would clear each difference,
// and apply them to the editor's draft.
//
// Nothing here touches the database. Every change lands in the unsaved order the
// rep is already looking at, so it shows up in the grid, flips the Unsaved badge,
// and is theirs to review — or discard by not saving.

import { reportItemKey } from './soPlayerReport';

// Same normalisation the report and the extras builder use, borrowed from the one
// definition rather than copied: a second copy that drifted would put the panel's
// suggestion on a different row than the mismatch it claims to fix.
const itemKeyOf = (sku, name, color) => reportItemKey(sku, name, color, '').split('|').slice(0, 2).join('|');
const normSize = (s) => String(s == null || s === '' ? 'OS' : s).trim().toUpperCase();
const BOOKKEEPING = /^(drop_ship|unit_cost|_)/i;

const itemLabel = (it) => [it && (it.name || it.custom_desc || it.sku), it && it.color].filter(Boolean).join(' · ');

// The SO line's own spelling of a size ("XL" vs "X-Large"), so applying a fix edits
// the cell the rep can see instead of adding a second one beside it.
function existingSizeLabel(item, size) {
  return Object.keys((item && item.sizes) || {})
    .filter((k) => !BOOKKEEPING.test(k))
    .find((k) => normSize(k) === normSize(size));
}

export function indexSoItems(soItems = []) {
  const byKey = new Map(); const ambiguous = new Set();
  (soItems || []).forEach((it, i) => {
    if (!it) return;
    const key = itemKeyOf(it.sku, it.name || it.custom_desc, it.color);
    if (byKey.has(key)) ambiguous.add(key); else byKey.set(key, i);
  });
  return { byKey, ambiguous };
}

// One suggested sales-order edit per differing row. `delta` is report-minus-SO, so
// a positive delta means customers bought more than the order covers.
export function suggestSoFixes({ matchup, soItems = [] } = {}) {
  const { byKey, ambiguous } = indexSoItems(soItems);
  return (matchup?.diffRows || []).map((row) => {
    const key = itemKeyOf(row.sku, row.name, row.color);
    const base = { row, size: row.size, delta: row.delta, label: itemLabel(row) };
    // Two SO lines for the same item and colour: editing either could be the wrong
    // one, and guessing here would silently move units between lines.
    if (ambiguous.has(key)) {
      return { ...base, kind: 'ambiguous', itemIndex: null,
        note: `Two sales-order lines carry ${itemLabel(row) || 'this item'} — fix the size on the right one by hand.` };
    }
    if (!byKey.has(key)) {
      return { ...base, kind: 'missing_line', itemIndex: null,
        note: `The sales order has no ${itemLabel(row) || 'matching'} line. Add the item to the order, or re-match these units to a line it does have.` };
    }
    const itemIndex = byKey.get(key);
    const item = soItems[itemIndex];
    const sizeLabel = existingSizeLabel(item, row.size) || row.size;
    const from = Math.max(0, Number((item.sizes || {})[sizeLabel]) || 0);
    const to = Math.max(0, from + row.delta);
    return {
      // `key`, not `itemIndex`, is what applying actually uses. The index is a
      // snapshot of the order as it was when the report ran; a background reload or
      // any edit made meanwhile would slide it onto a different garment.
      ...base, kind: row.delta > 0 ? 'add' : 'reduce', itemIndex, key, size: sizeLabel, from, to,
      note: row.delta > 0
        ? `Add ${row.delta} × ${sizeLabel} (${from} → ${to})`
        : `Remove ${Math.abs(row.delta)} × ${sizeLabel} (${from} → ${to}) — these units have nobody's name on them, so check they are not intentional extras before removing.`,
    };
  });
}

// Only additions are safe to apply in bulk: a surplus on the sales order can be a
// deliberate unassigned extra (coaches' shirts, spares), and removing those in one
// click would quietly cancel units somebody meant to buy.
export const isBulkSafe = (fix) => !!fix && fix.kind === 'add';

// Applies against the order AS IT IS NOW, re-finding each line by its item/colour
// identity rather than by the row number it had when the report ran. A fix whose
// line has since vanished, or become one of two identical lines, is reported back
// as skipped instead of being written to whatever now sits at that index.
export function applySoFixes(items, fixes = []) {
  const list = items || [];
  const targets = (fixes || []).filter((f) => f && f.key && Number.isFinite(f.to));
  if (!targets.length) return { items: list, applied: [], skipped: (fixes || []).filter(Boolean) };
  const { byKey, ambiguous } = indexSoItems(list);
  const applied = []; const skipped = [];
  const next = list.map((it) => (it ? { ...it, sizes: { ...(it.sizes || {}) } } : it));
  targets.forEach((f) => {
    const i = byKey.get(f.key);
    if (i == null || ambiguous.has(f.key) || !next[i]) { skipped.push(f); return; }
    next[i].sizes[f.size] = f.to;
    applied.push(f);
  });
  (fixes || []).filter((f) => f && !targets.includes(f)).forEach((f) => skipped.push(f));
  return { items: applied.length ? next : list, applied, skipped };
}

export const pinnedSkus = (item) => (Array.isArray(item && item._matchSkus) ? item._matchSkus : []);

// Pin the customer-side SKU to one sales-order line, addressed by the same
// item/colour identity `suggestSoFixes` uses — never by row number. The line list
// is captured when the report runs and several awaited round-trips happen before
// the rep clicks, so an index can slide onto a different garment in between; a
// mispinned line changes no visible number in the grid, so it would save unnoticed.
// A source SKU belongs to exactly one line, so pinning here releases it elsewhere.
export function pinSourceSku(items, itemKey, sourceSku) {
  const sku = String(sourceSku == null ? '' : sourceSku).trim();
  const list = items || [];
  if (!sku || !itemKey) return list;
  const { byKey, ambiguous } = indexSoItems(list);
  const target = ambiguous.has(itemKey) ? null : byKey.get(itemKey);
  if (target == null) return list;
  const lower = sku.toLowerCase();
  return list.map((it, i) => {
    if (!it) return it;
    const had = pinnedSkus(it);
    const without = had.filter((s) => String(s).trim().toLowerCase() !== lower);
    if (i === target) return { ...it, _matchSkus: [...without, sku] };
    return without.length === had.length ? it : { ...it, _matchSkus: without };
  });
}

export function unpinSourceSku(items, sourceSku) {
  const lower = String(sourceSku == null ? '' : sourceSku).trim().toLowerCase();
  if (!lower) return items || [];
  return (items || []).map((it) => {
    if (!it) return it;
    const had = pinnedSkus(it);
    const without = had.filter((s) => String(s).trim().toLowerCase() !== lower);
    return without.length === had.length ? it : { ...it, _matchSkus: without };
  });
}

// Every sales-order line a rep could re-match a set of units to, newest pin first
// so the current choice is obvious in a picker.
export function rematchOptions(soItems = [], sourceSku = '') {
  const lower = String(sourceSku == null ? '' : sourceSku).trim().toLowerCase();
  const { ambiguous } = indexSoItems(soItems || []);
  return (soItems || []).map((it, i) => ({
    itemIndex: i,
    key: itemKeyOf(it && it.sku, it && (it.name || it.custom_desc), it && it.color),
    // Two identical lines cannot be told apart by identity, so neither is offerable.
    ambiguous: ambiguous.has(itemKeyOf(it && it.sku, it && (it.name || it.custom_desc), it && it.color)),
    label: itemLabel(it) || `Line ${i + 1}`,
    sku: (it && it.sku) || '',
    sizes: Object.entries((it && it.sizes) || {}).filter(([k, v]) => !BOOKKEEPING.test(k) && (Number(v) || 0) > 0)
      .map(([k, v]) => `${k}×${v}`).join(' '),
    pinned: pinnedSkus(it).some((s) => String(s).trim().toLowerCase() === lower),
  })).filter((o) => o.label && !o.ambiguous);
}
