const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

// A portal payment can occasionally leave its immutable audit row behind while
// the parent invoice summary is still open. Only auto-retry a very narrow case:
// no parent payment has been applied, no refund exists, and one Stripe payment
// by itself covers the invoice. The server still re-verifies the intent with
// Stripe before changing any financial fields.
export const stripePaymentRepairCandidate = (invoice) => {
  if (!invoice || invoice.status === 'paid' || money(invoice.paid) > 0 || money(invoice.total) <= 0) return null;
  const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
  if (payments.some((payment) => money(payment.amount) < 0)) return null;
  const total = money(invoice.total);
  for (const payment of payments) {
    const match = String(payment.ref || '').trim().match(/^Stripe\s+(pi_[A-Za-z0-9_]+)$/);
    if (match && money(payment.amount) + 0.01 >= total) {
      return { invoiceId: invoice.id, intentId: match[1] };
    }
  }
  return null;
};

// Staff tabs save whole invoice rows. If one loaded before a portal payment,
// preserve the newer server-side financial summary while allowing its unrelated
// edits through. This prevents a stale tab from resurrecting a paid balance.
export const preserveAppliedInvoiceSummary = (localRow, serverRow) => {
  if (!localRow || !serverRow) return localRow;
  const localPaid = money(localRow.paid);
  const serverPaid = money(serverRow.paid);
  if (serverPaid <= localPaid + 0.004) return localRow;
  const total = Math.max(money(localRow.total), money(serverRow.total));
  return {
    ...localRow,
    total,
    paid: serverPaid,
    cc_fee: Math.max(money(localRow.cc_fee), money(serverRow.cc_fee)),
    status: serverRow.status === 'void' ? 'void' : (serverPaid >= total - 0.004 ? 'paid' : 'partial'),
  };
};
