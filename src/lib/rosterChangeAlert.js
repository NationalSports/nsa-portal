// Numbers / names changed after a job hit the floor.
//
// The production sheet is printed when a job is lined up (Staging). If the rep edits the SO's
// numbers or names after that, the paper on the press is wrong and nobody is told — SO-2506: the
// M jersey went from #3 to #27 on the SO the morning it was pressed, and it went out as #3.
//
// detectFloorRosterChanges compares the order before and after a save and returns, for every job
// already In Line or In Process, the personalization slots that changed on the lines it runs.
// The save path stamps those onto the job (job.roster_change) and tells production; the job card
// shows a "reprint the sheet" banner until someone marks it reprinted.

import { safeArr, safeDecos, safeJobs, safeItems, safeObj } from '../safeHelpers';

export const FLOOR_STATUSES = ['staging', 'in_process'];
const KINDS = { numbers: 'roster', names: 'names' };
const clean = (v) => String(v == null ? '' : v).trim();
const disOf = (gi) => (Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length ? gi.deco_idxs
  : gi?.deco_idx != null ? [gi.deco_idx] : null);

// The previous version of a line: same line_id when both carry one, else same position + SKU.
const prevItemFor = (prevItems, item, idx) => {
  if (item?.line_id) {
    const byLine = prevItems.find((p) => p?.line_id === item.line_id);
    if (byLine) return byLine;
  }
  const same = prevItems[idx];
  return same && same.sku === item?.sku ? same : null;
};

// The previous version of a decoration: same slot when it is still the same kind, else the
// first one of that kind at the same position.
const prevDecoFor = (prevItem, deco, di) => {
  const decos = safeDecos(prevItem);
  if (decos[di]?.kind === deco.kind) return decos[di];
  return decos.find((d) => d?.kind === deco.kind && clean(d.position) === clean(deco.position)) || null;
};

const slotChanges = (before, after, sizes) => {
  const out = [];
  sizes.forEach((sz) => {
    const a = safeArr(safeObj(before)[sz]).map(clean);
    const b = safeArr(safeObj(after)[sz]).map(clean);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if ((a[i] || '') !== (b[i] || '')) out.push({ size: sz, from: a[i] || '', to: b[i] || '' });
    }
  });
  return out;
};

/**
 * @returns {Array<{jobId:string, status:string, changes:Array<{kind,sku,color,size,from,to}>}>}
 */
export function detectFloorRosterChanges(prevOrder, nextOrder) {
  if (!prevOrder || !nextOrder) return [];
  // A partially loaded copy would read as "every number changed" — only compare loaded data.
  if (prevOrder._decosHydrated === false || nextOrder._decosHydrated === false) return [];
  const prevItems = safeItems(prevOrder);
  const nextItems = safeItems(nextOrder);
  const out = [];
  safeJobs(nextOrder).forEach((job) => {
    if (!FLOOR_STATUSES.includes(job?.prod_status)) return;
    const changes = [];
    const seen = new Set();
    safeArr(job.items).forEach((gi) => {
      const item = nextItems[gi?.item_idx];
      if (!item) return;
      const prevItem = prevItemFor(prevItems, item, gi.item_idx);
      if (!prevItem) return;
      const dis = disOf(gi);
      const rowSizes = Object.keys(safeObj(gi.sizes && Object.keys(gi.sizes).length ? gi.sizes : item.sizes));
      safeDecos(item).forEach((d, di) => {
        const field = KINDS[d?.kind];
        if (!field || (dis && !dis.includes(di))) return;
        const key = gi.item_idx + ':' + di;
        if (seen.has(key)) return;
        seen.add(key);
        const pd = prevDecoFor(prevItem, d, di);
        if (!pd) return;
        const sizes = rowSizes.length ? rowSizes
          : [...new Set([...Object.keys(safeObj(pd[field])), ...Object.keys(safeObj(d[field]))])];
        slotChanges(pd[field], d[field], sizes).forEach((c) => changes.push({
          kind: d.kind, sku: item.sku || '', color: item.color || '', ...c,
        }));
      });
    });
    if (changes.length) out.push({ jobId: job.id, status: job.prod_status, changes });
  });
  return out;
}

// One line per change, e.g. "H44532 Black/White M #3 → #27".
export const describeRosterChange = (c) => {
  const v = (x) => (x ? (c.kind === 'numbers' ? '#' + x : x) : '(blank)');
  return [c.sku, c.color, c.size].filter(Boolean).join(' ') + ' ' + v(c.from) + ' → ' + v(c.to);
};

// Stamp the detected changes onto the order's jobs, keeping any earlier unacknowledged ones.
export function stampRosterChanges(order, found, { by = '', at = new Date().toISOString() } = {}) {
  if (!found.length) return order;
  const byJob = new Map(found.map((f) => [f.jobId, f]));
  return {
    ...order,
    jobs: safeJobs(order).map((j) => {
      const f = byJob.get(j.id);
      if (!f) return j;
      const earlier = safeArr(j.roster_change?.changes);
      return { ...j, roster_change: { at, by, status: f.status, changes: [...earlier, ...f.changes].slice(-50) } };
    }),
  };
}
