// Custom-split helpers shared by OrderEditorClassic.js and OrderEditor.js (splitCustom and the
// Split Job modal). One copy on purpose — the two editors used to carry this maths by hand.
//
// A custom split partitions ONE job item's per-size quantities between the job that stays
// (the parent) and the new slice. Receipts live on the shared SO line, so the split also has to
// decide which half the already-received units belong to:
//
//   take = 'open'      (default) The slice is a BACKORDER carved off a producible parent: it
//                      takes the not-yet-received units first and the parent keeps its receipts.
//                      This is what "split off the backorder" means, and it is what a rep expects
//                      when they pick the sizes that are stuck on order (JOB-2130-05: 4 M on
//                      backorder were split off and the slice was handed 4 RECEIVED M instead).
//   take = 'received'  The slice takes the in-hand units first, so it can go to production now
//                      while the parent waits on the balance ("Received only" in the modal).
//
// The caller stamps `split_open` on the slice for 'open' so allocateJobFulfillment (which
// re-apportions the line's receipts on every recalc) keeps the same ordering the seed used — the
// seed alone is not enough, because the next receive/pull recomputes every job's fulSizes.

const safeNum = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);

/**
 * Partition one job item.
 * @param {Object} curSizes  per-size units on the item as the job currently holds them
 * @param {Object} curFul    per-size RECEIVED/pulled units apportioned to this job
 * @param {Object} reqSizes  per-size units the rep asked to move to the new slice
 * @param {'open'|'received'} take  which units the slice claims first (see header)
 */
export function allocateCustomSplit(curSizes, curFul, reqSizes, take = 'open') {
  const splitSizes = {}; const remainSizes = {};
  const splitFulSizes = {}; const remainFulSizes = {};
  let sUnits = 0, rUnits = 0, sFul = 0, rFul = 0;
  Object.entries(curSizes || {}).forEach(([sz, v]) => {
    const total = safeNum(v);
    const want = Math.max(0, Math.min(safeNum((reqSizes || {})[sz]), total));
    if (want > 0) { splitSizes[sz] = want; sUnits += want; }
    const rem = total - want;
    if (rem > 0) { remainSizes[sz] = rem; rUnits += rem; }
    // Received units for this size, capped at what the job actually holds.
    const ful = Math.max(0, Math.min(safeNum((curFul || {})[sz]), total));
    const open = total - ful;
    let sF;
    if (take === 'received') {
      sF = Math.min(ful, want);
    } else {
      // Backorder-first: the slice fills from the open units; it only carries receipts when the
      // rep asked for more units than are still open.
      sF = Math.max(0, want - Math.min(open, want));
    }
    const rF = Math.min(ful - sF, rem);
    if (sF > 0) { splitFulSizes[sz] = sF; sFul += sF; }
    if (rF > 0) { remainFulSizes[sz] = rF; rFul += rF; }
  });
  return { splitSizes, remainSizes, splitFulSizes, remainFulSizes, sUnits, rUnits, sFul, rFul };
}

/** Per-size units NOT yet received on a job item — the natural "backorder" selection. */
export function openSizes(curSizes, curFul) {
  const out = {};
  Object.entries(curSizes || {}).forEach(([sz, v]) => {
    const open = safeNum(v) - Math.max(0, Math.min(safeNum((curFul || {})[sz]), safeNum(v)));
    if (open > 0) out[sz] = open;
  });
  return out;
}

/**
 * First unused split-slice suffix for `parentId` — 'B', 'B2', … (or 'C1', 'C2', … when
 * `alwaysNumbered`). Checks EVERY job id on the order, not just current children: a slice that
 * was merged back no longer counts toward a length-based counter, so "-C" + (count + 1) could
 * re-mint an id a surviving sibling still holds, and the job sync's dedupe-by-id then silently
 * drops one of the two jobs. Returns null only if 99 suffixes are taken (never seen).
 */
export function freeSplitSuffix(jobs, parentId, letter, alwaysNumbered = false) {
  const used = new Set((jobs || []).filter((j) => j && j.id).map((j) => String(j.id)));
  for (let n = 1; n <= 99; n++) {
    const sfx = letter + ((n > 1 || alwaysNumbered) ? n : '');
    if (!used.has(parentId + '-' + sfx)) return sfx;
  }
  return null;
}
