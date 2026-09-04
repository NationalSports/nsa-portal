const cents = value => Math.round(Number(value || 0) * 100);

export function prepareUnpaidInvoiceSplit(invoice, indices, newId, memo = '') {
  if (!invoice?._version) throw new Error('Reload this invoice before splitting it.');
  if (cents(invoice.paid) !== 0 || invoice.payments?.length || cents(invoice.cc_fee)
    || cents(invoice.credit_amount) || cents(invoice.deposit_applied) || invoice.type === 'deposit'
    || invoice.inv_type === 'deposit' || ['paid', 'void', 'cancelled'].includes(invoice.status)) {
    throw new Error('Invoices with payments, credits, or deposits require an accounting adjustment before they can be split.');
  }
  const lines = invoice.line_items || [];
  const selected = new Set(indices);
  if (!selected.size || selected.size >= lines.length || [...selected].some(i => !Number.isInteger(i) || i < 0 || i >= lines.length)) {
    throw new Error('Select some, but not all, invoice items.');
  }
  const a = lines.filter((_, i) => selected.has(i));
  const b = lines.filter((_, i) => !selected.has(i));
  const sum = list => list.reduce((total, item) => total + cents(item.amount), 0);
  const subA = sum(a), subB = sum(b), subtotal = subA + subB;
  if (subtotal <= 0 || subtotal + cents(invoice.shipping) + cents(invoice.tax) !== cents(invoice.total)) {
    throw new Error('Invoice line totals need reconciliation before splitting.');
  }
  const shippingA = Math.round(cents(invoice.shipping) * subA / subtotal);
  const taxA = Math.round(cents(invoice.tax) * subA / subtotal);
  const totalA = subA + shippingA + taxA;
  const common = { ...invoice, paid: 0, payments: [], cc_fee: 0, status: 'open', updated_at: new Date().toISOString() };
  const original = { ...common, line_items: a, total: totalA / 100, shipping: shippingA / 100,
    tax: taxA / 100, memo: (memo || invoice.memo || '') + ' (Split 1/2)' };
  const split = { ...common, id: newId, _version: undefined, client_create_id: undefined, idempotency_key: null,
    line_items: b, total: (cents(invoice.total) - totalA) / 100,
    shipping: (cents(invoice.shipping) - shippingA) / 100, tax: (cents(invoice.tax) - taxA) / 100,
    memo: (memo || invoice.memo || '') + ' (Split 2/2)', created_at: new Date().toISOString() };
  return { original, split };
}
