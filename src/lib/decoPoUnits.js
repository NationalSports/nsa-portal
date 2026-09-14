// What a decoration PO *currently* covers, versus the quantity it was saved with.
//
// A deco PO's `qty` is deliberately a snapshot of what was committed to the vendor —
// it does not follow the sales order, because it drives cost and because somebody
// should confirm a change rather than have it happen silently. That makes "what do
// the covered items add up to right now" a real question with one right answer, and
// this is it. Extracted so the deco PO page's own Sync button and the fulfillment
// reconciliation panel can never disagree about the number they would write.
// safeNum, not Number(): the app's helper deliberately treats a string as 0, and a
// local parse that disagreed would make this total differ from the PO page's by
// exactly the cells someone typed as text.
import { safeSizes, safeNum as num } from '../safeHelpers';

export function decoPoRows(dp, soItems = []) {
  const base = num(dp && dp.unit_cost);
  return ((dp && dp.item_idxs) || []).map((ii) => {
    const it = (soItems || [])[ii];
    if (!it) return null;
    // Mirrors the PO page row-for-row: only positive size cells count, and a
    // per-item rate override beats the PO's unit cost.
    const qty = Object.values(safeSizes(it)).reduce((a, v) => a + (num(v) > 0 ? num(v) : 0), 0);
    const rate = dp.item_costs && dp.item_costs[ii] != null ? num(dp.item_costs[ii]) : base;
    return { idx: ii, qty, rate, lineTotal: Math.round(qty * rate * 100) / 100 };
  }).filter(Boolean);
}

export function decoPoTotals(dp, soItems = []) {
  const rows = decoPoRows(dp, soItems);
  return {
    rows,
    liveQty: rows.reduce((a, r) => a + r.qty, 0),
    liveExpected: Math.round(rows.reduce((a, r) => a + r.lineTotal, 0) * 100) / 100,
  };
}

// The pending change, or null when the PO already matches what it covers.
export function decoPoDrift(dp, soItems = []) {
  const { rows, liveQty, liveExpected } = decoPoTotals(dp, soItems);
  if (!rows.length) return null;
  const from = num(dp && dp.qty);
  if (liveQty === from) return null;
  return { poId: (dp && dp.po_id) || '', from, to: liveQty, expected: liveExpected };
}
