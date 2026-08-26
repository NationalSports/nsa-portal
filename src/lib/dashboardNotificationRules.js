import { buildInvoicedQtyMap, safeItems, safeNum, safeSizes, soLineKey } from '../safeHelpers';

const IN_LINE_OR_LATER = new Set(['staging', 'in_process', 'completed', 'shipped']);

export const isInLineOrLater = (status) => IN_LINE_OR_LATER.has(status);

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
