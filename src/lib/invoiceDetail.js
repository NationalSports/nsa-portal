import { safeNum } from '../safeHelpers';
import { historicalInvoiceAr } from './historicalInvoiceAr';

export const normalizeInvoiceForDetail = (invoice) => {
  const source = invoice || {};
  const historicalAr = source._hist ? historicalInvoiceAr(source) : null;
  return {
    ...source,
    total: safeNum(source.total),
    paid: historicalAr ? historicalAr.paid : safeNum(source.paid),
    shipping: safeNum(source.shipping),
    tax: safeNum(source.tax),
    payments: Array.isArray(source.payments)
      ? source.payments.map(payment => ({
        ...payment,
        amount: safeNum(payment?.amount),
        cc_fee: safeNum(payment?.cc_fee),
      }))
      : [],
  };
};

export const invoiceDetailBalance = (invoice) => invoice?._hist
  ? historicalInvoiceAr(invoice).balance
  : safeNum(invoice?.total) - safeNum(invoice?.paid);

// `status` on a portal invoice is a fact written at payment time, so anything that moves the
// total has to re-settle it. An edit that drops the total to what the customer already paid
// (trimming shipping, a removed line) used to leave the row at 'partial' with a $0 balance —
// and a stale 'partial' still prints Overdue, still counts as open A/R, and still goes out on
// the past-due email blast. The half-cent tolerance matches the settlement SQL
// (`v_applied >= v_inv_total - 0.005`) so a rounding cent can never re-open a paid invoice.
// 'void' is a decision about the document, not a balance — never derive over it.
export const invoicePaymentStatus = (total, paid, currentStatus) => {
  if (String(currentStatus || '').trim().toLowerCase() === 'void') return currentStatus;
  const owed = safeNum(total);
  const settled = safeNum(paid);
  if (settled >= owed - 0.005) return 'paid';
  return settled > 0 ? 'partial' : 'open';
};
