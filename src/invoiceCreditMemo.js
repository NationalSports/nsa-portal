const cents = value => Math.round((Number(value) || 0) * 100) / 100;

export const creditMemoTotal = memo => cents(memo && memo.amount);

export const creditedTotal = invoice => (invoice && invoice.credit_memos || [])
  .reduce((sum, memo) => sum + creditMemoTotal(memo), 0);

export const creditableBalance = invoice => {
  const total = Math.max(0, Number(invoice && invoice.total) || 0);
  const paid = Math.max(0, Number(invoice && invoice.paid) || 0);
  return Math.max(0, cents(Math.min(total, paid) - creditedTotal(invoice)));
};

export const seedCreditMemoLines = (lines, priorMemos = []) => {
  const creditedByLine = (priorMemos || []).reduce((totals, memo) => {
    (memo.line_items || []).forEach(item => {
      const index = Number(item.line_index);
      if (Number.isInteger(index) && index >= 0) {
        totals[index] = (totals[index] || 0) + Math.max(0, Number(item.qty) || 0);
      }
    });
    return totals;
  }, {});

  return (lines || []).map((line, index) => {
    const invoicedQty = Math.max(0, Number(line.qty) || 0);
    const creditedQty = Math.min(invoicedQty, creditedByLine[index] || 0);
    return {
      index,
      desc: line.desc || line.description || line.name || 'Invoice item',
      sku: line._sku || line.sku || '',
      invoiced_qty: invoicedQty,
      credited_qty: creditedQty,
      max_qty: Math.max(0, invoicedQty - creditedQty),
      qty: 0,
      rate: cents(line.rate != null ? line.rate : line.unit_price),
    };
  });
};

export const setCreditMemoLineQty = (line, value) => ({
  ...line,
  qty: Math.min(line.max_qty, Math.max(0, Number(value) || 0)),
});

export const calculateCreditMemo = ({ invoice, lines, shipping = 0 }) => {
  const selectedLines = (lines || []).filter(line => line.qty > 0).map(line => ({
    line_index: line.index,
    desc: line.desc,
    sku: line.sku,
    qty: Number(line.qty),
    rate: cents(line.rate),
    amount: cents(Number(line.qty) * Number(line.rate)),
  }));
  const subtotal = cents(selectedLines.reduce((sum, line) => sum + line.amount, 0));
  const invoiceSubtotal = Math.max(0, cents(
    (invoice && invoice.line_items || []).reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
  ));
  const tax = invoiceSubtotal > 0
    ? cents((Number(invoice && invoice.tax) || 0) * Math.min(1, subtotal / invoiceSubtotal))
    : 0;
  const shippingCredit = Math.max(0, cents(shipping));
  return {
    line_items: selectedLines,
    subtotal,
    tax,
    shipping: shippingCredit,
    amount: cents(subtotal + tax + shippingCredit),
  };
};

export const validateCreditMemo = ({ invoice, calculation, reason }) => {
  if (!String(reason || '').trim()) return 'Enter a reason for the credit memo';
  if (!calculation || calculation.amount <= 0) return 'Select at least one item quantity to credit';
  if (calculation.amount > creditableBalance(invoice) + 0.005) {
    return 'Credit exceeds the remaining creditable amount on this invoice';
  }
  return null;
};
