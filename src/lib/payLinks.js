// Customer pay links for an invoice, shared by the desktop Invoices page and the
// phone. The full-balance link is just the coach-portal invoice page. A partial
// link adds an invoice_pay_requests row whose amount the server enforces
// (stripe-payment / _shared.js); its id is the unguessable token in the URL.

export const coachInvoiceUrl = (alphaTag, invId, token) =>
  'https://nationalsportsapparel.com/coach?portal=' + encodeURIComponent(alphaTag) + '&inv=' + encodeURIComponent(invId) + (token ? '&payreq=' + encodeURIComponent(token) : '');

export function newPayRequestToken() {
  const bytes = new Uint8Array(18);
  window.crypto.getRandomValues(bytes);
  return 'PR' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns { link, amount } or { error } (a message for the rep). Nothing is written on error.
export async function createPartialPayLink(supabase, { inv, balance, amount, note, customer, createdBy }) {
  if (!supabase) return { error: 'Supabase not configured' };
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(amt >= 0.5)) return { error: 'Enter an amount of at least $0.50' };
  if (amt > balance + 0.005) return { error: 'That is more than the $' + balance.toFixed(2) + ' open balance' };
  if (!customer?.alpha_tag) return { error: 'This customer has no portal tag, so a pay link can’t be built' };
  const token = newPayRequestToken();
  const { error } = await supabase.from('invoice_pay_requests').insert({ id: token, invoice_id: inv.id, amount: amt, note: String(note || '').trim() || null, created_by: createdBy || '' });
  if (error) return { error: 'Pay link NOT created — ' + error.message };
  return { link: coachInvoiceUrl(customer.alpha_tag, inv.id, token), amount: amt };
}
