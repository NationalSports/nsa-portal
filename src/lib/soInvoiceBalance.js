// Compare billed dollars, not payments: paying an invoice never makes an SO billable again.
const money = value => Math.round((Number(value) || 0) * 100) / 100;
export const liveSoInvoices = (invoices, soId) => (invoices || []).filter(i => i && i.so_id === soId && i.status !== 'void' && !i.deleted_at);
export function soInvoiceBalance({ subtotal, shipping, tax, invoices = [] }) {
  const billed = invoices.reduce((a, i) => ({
    total: a.total + money(i.total), shipping: a.shipping + money(i.shipping), tax: a.tax + money(i.tax),
  }), { total: 0, shipping: 0, tax: 0 });
  const remainingShipping = money(money(shipping) - billed.shipping);
  const remainingTax = money(money(tax) - billed.tax);
  const remainingSubtotal = money(money(subtotal) - (billed.total - billed.shipping - billed.tax));
  return { subtotal: remainingSubtotal, shipping: remainingShipping, tax: remainingTax,
    total: money(remainingSubtotal + remainingShipping + remainingTax), billed: money(billed.total) };
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const invoiceBalanceSnapshot = invoices => JSON.stringify(invoices.map(i => ({
  id: i.id, total: i.total, shipping: i.shipping, tax: i.tax, inv_type: i.inv_type,
  line_items: canonical(i.line_items),
})).sort((a, b) => String(a.id).localeCompare(String(b.id))));
