// The SQL snapshot establishes store provenance. Never infer it from order numbers.
export const AT_ONCE_ACCOUNT = '40010';
export const AT_ONCE_ITEM = 'At-Once / 24/7 Revenue';
export const AT_ONCE_CUSTOMER = '24/7 Store Customers';
const cents = value => Math.round(Number(value) * 100);
export function atOnceRoute(invoice, snapshot) {
  const orders = snapshot.at_once_sources?.[invoice.so_id];
  if (!orders) return { atOnce: false };
  const hold = reason => ({ atOnce: true, reason });
  if (orders.length !== 1) return hold('at_once_ambiguous_checkout');
  const order = orders[0];
  if (String(order.customer_id || '') !== String(invoice.customer_id || '') || !order.customer_id)
    return hold('at_once_customer_mismatch');
  if (!['paid','batched','fulfilled','shipped','complete','completed'].includes(order.status)
      || !String(order.stripe_pi_id || '').startsWith('pi_') || Number(order.refunded_amt || 0) !== 0)
    return hold('at_once_payment_or_refund_review');
  if (!(Number(order.total) > 0) || cents(order.total) !== cents(invoice.total)
      || cents(invoice.paid) !== cents(order.total)
      || cents(order.tax || 0) !== cents(invoice.tax || 0)
      || cents(order.shipping || 0) !== cents(invoice.shipping || 0))
    return hold('at_once_checkout_amount_mismatch');
  const payments = (snapshot.payments || []).filter(p => String(p.invoice_id) === String(invoice.id));
  if (payments.length !== 1 || payments[0].ref !== `Stripe ${order.stripe_pi_id}`
      || cents(payments[0].amount) !== cents(order.total)) return hold('at_once_payment_evidence_mismatch');
  return { atOnce: true, orderNumber: String(order.order_number), orderId: order.id };
}
