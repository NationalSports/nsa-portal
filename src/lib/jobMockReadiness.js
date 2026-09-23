// Artwork approval and garment mock coverage are separate. Reused approved art
// can keep its approval while this order still needs a garment mock (SO-2102).
import { isJobReady as baseIsJobReady } from '../businessLogic';
import { safeArr, safeItems, skusMissingMockups, garmentsNeedingMockCheck, jobHasUnresolvedArt } from '../safeHelpers';

export const missingJobMocks = (job, so) => skusMissingMockups(job, so);
export const isJobReady = (job, so) => {
  if (so?._artHydrated === false || so?._decosHydrated === false || so?._itemsHydrated === false) return false;
  return !jobHasUnresolvedArt(job, so) && missingJobMocks(job, so).length === 0 && baseIsJobReady(job, so);
};

// Prior mocks are optional suggestions, never the predicate for whether a mock
// is missing. Keep an actionable entry even when there is nothing to reuse.
export const jobMockChecks = (job, so, priorMocks = {}) => {
  const checks = garmentsNeedingMockCheck(job, so, priorMocks);
  safeArr(job?.items).forEach(gi => {
    const item = safeItems(so)[gi.item_idx];
    if (!item || !missingJobMocks({ ...job, items: [gi] }, so).length) return;
    if (checks.some(c => c.sku === item.sku && c.color === (item.color || ''))) return;
    checks.push({ sku: item.sku, color: item.color || '', name: item.name || '', artFiles: [] });
  });
  return checks;
};

// A stale saved "ready" must not bypass the live gate. Do not rewrite actual
// production progress or approval data when presenting the queue.
export const mockAwareProductionStatus = (job, so) =>
  job?.prod_status === 'ready' && missingJobMocks(job, so).length ? 'hold' : job?.prod_status;
