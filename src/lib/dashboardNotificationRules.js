const IN_LINE_OR_LATER = new Set(['staging', 'in_process', 'completed', 'shipped']);

export const isInLineOrLater = (status) => IN_LINE_OR_LATER.has(status);

export const hasInvoiceForOrder = (invoices, soId) => (invoices || []).some((inv) => (
  inv && inv.so_id === soId && inv.status !== 'void' && !inv.deleted_at
));

// A completed-job notice is a two-step handoff: ship the finished work, then make sure
// the SO was invoiced. It clears only after both are true. Promo-funded orders do not
// require a customer invoice, so shipping is terminal for them.
export const shouldShowCompletedJobNotice = (job, so, invoices) => {
  if (!job || !so) return false;
  if (job.prod_status === 'completed') return true;
  if (job.prod_status !== 'shipped') return false;
  return !so.promo_applied && !hasInvoiceForOrder(invoices, so.id);
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

export const pickSkuChanged = (item, picks) => (picks || []).some((pick) => (
  pick && pick._sku && item?.sku && pick._sku !== item.sku
));

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
