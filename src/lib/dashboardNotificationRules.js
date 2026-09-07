import { buildInvoicedQtyMap, itemMockFiles, safeItems, safeNum, safeSizes, soLineKey } from '../safeHelpers';

const IN_LINE_OR_LATER = new Set(['staging', 'in_process', 'completed', 'shipped']);

export const isInLineOrLater = (status) => IN_LINE_OR_LATER.has(status);

const fileTime = (file) => {
  const direct = file && typeof file === 'object'
    ? (file.uploaded_at || file.created_at || file.ts)
    : null;
  if (direct) {
    const parsed = new Date(direct).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  // Cloudinary puts the upload epoch in /v<seconds>/ even when a legacy file
  // object has no uploaded_at field.
  const url = typeof file === 'string' ? file : (file?.url || '');
  const match = url.match(/\/v(\d{10,13})\//);
  if (!match) return null;
  const raw = Number(match[1]);
  return match[1].length === 10 ? raw * 1000 : raw;
};

const jobArtIds = (job) => [...new Set(
  ((Array.isArray(job?._art_ids) && job._art_ids.length) ? job._art_ids : [job?.art_file_id])
    .filter((id) => id && id !== '__tbd'),
)];

const latestArtRequestTime = (job) => (job?.art_requests || []).reduce((latest, request) => {
  const parsed = new Date(request?.created_at || request?.at || 0).getTime();
  return Number.isNaN(parsed) ? latest : Math.max(latest, parsed);
}, 0);

// An old garment mock must not masquerade as the response to a newer art request.
// This is the SO-2106 shape: the job had already been approved, was reopened only
// to ask for separations/underbase, and "Send to Rep" reused the August mock while
// claiming a new September proof was ready. Unknown legacy timestamps stay
// permissive so non-Cloudinary proofs are not accidentally hidden.
export const hasFreshMockForLatestArtRequest = (job, so) => {
  const requestedAt = latestArtRequestTime(job);
  if (!requestedAt) return true;
  const ids = new Set(jobArtIds(job));
  const artFiles = (so?.art_files || []).filter((art) => ids.has(art?.id));
  const scoped = [];
  (job?.items || []).forEach((jobItem) => {
    const line = safeItems(so)[jobItem?.item_idx] || jobItem;
    artFiles.forEach((art) => scoped.push(...itemMockFiles(art?.item_mockups || {}, line)));
  });
  if (!scoped.length) artFiles.forEach((art) => scoped.push(...(art?.mockup_files || art?.files || [])));
  return scoped.some((file) => {
    const uploadedAt = fileTime(file);
    return uploadedAt == null || uploadedAt >= requestedAt;
  });
};

export const shouldShowMockupReviewNotice = (job, so) => {
  if (!job || job.art_status !== 'waiting_approval' || job.sent_to_coach_at || job.coach_approved_at) return false;
  if (isInLineOrLater(job.prod_status)) return false;
  if (hasFreshMockForLatestArtRequest(job, so)) return true;
  const ids = new Set(jobArtIds(job));
  const ownedArt = (so?.art_files || []).filter((art) => ids.has(art?.id));
  // If the design remains approved and the latest request returned no new mock,
  // the previous approval is the durable truth; do not resurrect Review Mockup.
  return !ownedArt.length || ownedArt.some((art) => art.status !== 'approved' && art.status !== 'art_complete');
};

export const invoicesForOrder = (invoices, soId) => (invoices || []).filter((inv) => (
  inv && inv.so_id === soId && inv.status !== 'void' && !inv.deleted_at
));

// Use the same per-line quantity reconciliation as the order editor and the
// fully-invoiced auto-closer. The presence of an invoice is not enough: deposits
// and partial invoices must leave the production notification visible.
export const isOrderFullyInvoiced = (so, invoices) => {
  if (!so) return false;
  const applicable = invoicesForOrder(invoices, so.id);
  if (!applicable.length) return false;
  const invoiced = buildInvoicedQtyMap(so, applicable);
  return safeItems(so).every((item, idx) => {
    const sizedQty = Object.values(safeSizes(item)).reduce((sum, qty) => sum + safeNum(qty), 0);
    const orderedQty = sizedQty > 0 ? sizedQty : safeNum(item.est_qty);
    return orderedQty - (invoiced.get(soLineKey(item, idx)) || 0) <= 0;
  });
};

export const getOrderInvoiceCoverage = (so, invoices) => {
  const items = safeItems(so);
  const applicable = invoicesForOrder(invoices, so?.id);
  const invoiced = buildInvoicedQtyMap(so, applicable);
  return items.reduce((coverage, item, idx) => {
    const sizedQty = Object.values(safeSizes(item)).reduce((sum, qty) => sum + safeNum(qty), 0);
    const orderedQty = sizedQty > 0 ? sizedQty : safeNum(item.est_qty);
    const invoicedQty = Math.max(0, safeNum(invoiced.get(soLineKey(item, idx))));
    coverage.ordered += orderedQty;
    coverage.invoiced += Math.min(orderedQty, invoicedQty);
    coverage.remaining += Math.max(0, orderedQty - invoicedQty);
    return coverage;
  }, { ordered: 0, invoiced: 0, remaining: 0 });
};

const formatUnits = (qty) => Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');

export const completedJobInvoiceExplanation = (so, invoices) => {
  if (so?.promo_applied) return 'Promo order — remains until shipped';
  const { ordered, invoiced, remaining } = getOrderInvoiceCoverage(so, invoices);
  if (remaining <= 0 && ordered > 0) return 'Fully invoiced — notification will be removed';
  if (invoiced <= 0) return `Not invoiced: ${formatUnits(ordered)} units`;
  return `Partially invoiced: ${formatUnits(invoiced)} of ${formatUnits(ordered)} units`;
};

// A completed/shipped job remains actionable only while the order still needs billing.
// Fully invoiced orders clear immediately, even if a job is still marked completed.
// Promo-funded orders do not invoice, so their notice remains until shipment.
export const shouldShowCompletedJobNotice = (job, so, invoices) => {
  if (!job || !so) return false;
  if (job.prod_status !== 'completed' && job.prod_status !== 'shipped') return false;
  if (so.promo_applied) return job.prod_status === 'completed';
  return !isOrderFullyInvoiced(so, invoices);
};

// IF notifications are grouped across line items. Keep the grouped notice until every
// production job that consumes those lines has actually moved into the production queue.
export const pulledItemsHaveMovedInLine = (jobs, itemIndexes) => {
  const indexes = itemIndexes instanceof Set ? itemIndexes : new Set(itemIndexes || []);
  if (!indexes.size) return false;
  const related = (jobs || []).filter((job) => job && job.prod_status !== 'draft'
    && (job.items || []).some((item) => indexes.has(item.item_idx)));
  return related.length > 0 && related.every((job) => isInLineOrLater(job.prod_status));
};

// A line can have several historical IFs. Once its SKU changes, ignore the old
// SKU's picks; if a new IF is later pulled for the replacement SKU, that new pull
// must still be eligible to raise its own shortage.
export const picksForCurrentSku = (item, picks) => (picks || []).filter((pick) => (
  pick && (!pick._sku || !item?.sku || pick._sku === item.sku)
));

export const pickSkuChanged = (item, picks) => (picks || []).length > 0
  && picksForCurrentSku(item, picks).length === 0;

const localDay = (date) => {
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
};

// Initial order POs should not suppress a later stock shortage. A PO resolves the alert only
// when it was created on/after the day the completed IF reported the shortage.
export const hasResponsePoForPull = (picks, poLines) => {
  const pullDays = (picks || []).map((pick) => localDay(pick?.pulled_at)).filter((day) => day != null);
  const eligible = (poLines || []).filter((po) => po?.po_id && po.status !== 'cancelled');
  if (!pullDays.length) return eligible.length > 0;
  const shortDay = Math.max(...pullDays);
  return eligible.some((po) => {
    const poDay = localDay(po.created_at);
    return poDay != null && poDay >= shortDay;
  });
};

export const isFreshNotificationDate = (date, now = new Date(), days = 7) => {
  const at = date instanceof Date ? date : new Date(date);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime()) || Number.isNaN(current.getTime())) return false;
  const age = current.getTime() - at.getTime();
  return age >= 0 && age < days * 86400000;
};
