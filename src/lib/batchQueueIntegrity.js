// ─── Batch queue ⇄ sales order integrity ───
//
// A batch queue entry (app_state batch_pos) is written the moment a rep clicks "Add to
// Batch", independently of the sales-order save that carries its queued PO line. If that
// order save is then rejected (SO-2444, 2026-10-12: a stale tab's save got STALE_SO_WRITE),
// the queue keeps an entry for a garment line that never reached the order. Ordering that
// batch buys real goods for nothing, and the old promotion backstop then pinned the PO onto
// whatever line happened to sit at the same item_idx — potentially a different garment.
//
// Entries created by the current editors carry each garment's line_id, so the link can be
// checked exactly. Legacy entries without line ids keep the old index behaviour.

const linkedLines = so => (Array.isArray(so?.items) ? so.items : []);

// 'ok'           — the order holds this entry's queued PO line, or every referenced line exists
// 'missing_line' — the order is loaded cleanly but a referenced line is not on it (orphan)
// 'unverified'   — the order isn't in this list, didn't load cleanly, or the entry is too new
//                  for its order save to have reached this tab; don't guess
// The grace window covers another rep's order save still in flight (or not yet pushed here):
// treating that entry as an orphan could get it removed just before its PO line lands.
export const ORPHAN_GRACE_MS = 2 * 60 * 1000;
export function batchEntryLinkState(bp, so, { now = Date.now() } = {}) {
  if (!bp || bp.all_school_allocation_id) return 'ok';
  const created = Date.parse(bp.created_at || '');
  const tooNew = Number.isFinite(created) && now - created < ORPHAN_GRACE_MS;
  if (!so || so.id !== bp.so_id || so._itemsHydrated === false) return 'unverified';
  const items = linkedLines(so);
  if (items.some(it => (it?.po_lines || []).some(pl => pl && pl.batch_queue_id === bp.id))) return 'ok';
  const refs = (bp.items || []).filter(it => it && it.line_id);
  if (!refs.length) return 'ok';
  const ids = new Set(items.map(it => it?.line_id).filter(Boolean));
  if (refs.every(it => ids.has(it.line_id))) return 'ok';
  return tooNew ? 'unverified' : 'missing_line';
}

export function orphanedBatchEntries(entries, sos, opts) {
  const byId = new Map((sos || []).map(s => [s.id, s]));
  return (entries || []).filter(bp => batchEntryLinkState(bp, byId.get(bp.so_id), opts) === 'missing_line');
}

// Which order line a batch item belongs to when no queued PO line matched. By line_id when
// the entry has one (never fall back to the index — a missing id means the line is gone);
// legacy entries without ids still use item_idx. -1 = no safe target.
export function resolveBatchItemIndex(items, bpIt) {
  const list = Array.isArray(items) ? items : [];
  if (bpIt?.line_id) return list.findIndex(it => it?.line_id === bpIt.line_id);
  const idx = bpIt?.item_idx;
  return Number.isInteger(idx) && list[idx] ? idx : -1;
}

// Rows from so_item_po_lines (sizes jsonb carries batch_queue_id) → does the DB still link
// this entry to an order line? Used to confirm an orphan before dropping it from the queue.
export function dbRowsLinkEntry(rows, bpId) {
  return (rows || []).some(r => r && r.sizes && r.sizes.batch_queue_id === bpId);
}
