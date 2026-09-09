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
