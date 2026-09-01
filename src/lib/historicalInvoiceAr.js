const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizedStatus = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '_');

const OPEN_STATUSES = new Set(['open', 'partial', 'partially_paid']);

// NetSuite history is also sales history, so not every imported transaction is
// collectible A/R. Only an explicitly open status can carry a balance, and an
// exported Amount Remaining/open_balance always wins over the original total.
export function historicalInvoiceAr(invoice) {
  const total = num(invoice?.total);
  const sourceStatus = normalizedStatus(invoice?.status);
  const isOpenStatus = OPEN_STATUSES.has(sourceStatus);
  const hasExplicitBalance = invoice?.open_balance !== null
    && invoice?.open_balance !== undefined
    && invoice?.open_balance !== ''
    && Number.isFinite(Number(invoice.open_balance));
  // The invoice page can send collection email and accept payments, so it must
  // not promote a status-only history row into collectible debt. Rows without
  // Amount Remaining stay visible as history but out of Open/Past Due until a
  // balance-bearing NetSuite export refreshes them.
  const balance = isOpenStatus && hasExplicitBalance
    ? Math.max(0, num(invoice.open_balance))
    : 0;
  const paid = hasExplicitBalance
    ? Math.max(0, total - balance)
    : sourceStatus === 'paid' ? total : 0;

  let status = sourceStatus || 'closed';
  if (isOpenStatus) {
    if (!hasExplicitBalance) status = 'unverified';
    else if (balance <= 0.005) status = 'paid';
    else if (balance < total - 0.005) status = 'partial';
    else status = 'open';
  }

  return {
    balance,
    paid,
    status,
    sourceStatus,
    collectible: isOpenStatus && hasExplicitBalance && balance > 0.005,
    balanceBasis: hasExplicitBalance ? 'explicit' : 'missing_authoritative',
  };
}

export function applyHistoricalInvoicePayment(invoice, amount) {
  const ar = historicalInvoiceAr(invoice);
  const applied = Math.max(0, Math.min(ar.balance, num(amount)));
  const openBalance = Math.max(0, Math.round((ar.balance - applied) * 100) / 100);
  const total = num(invoice?.total);
  return {
    open_balance: openBalance,
    status: openBalance <= 0.005 ? 'paid' : openBalance < total - 0.005 ? 'partial' : 'open',
    applied,
  };
}
