// Read-only Stripe evidence for the accounting team. Never settles or posts invoices.
const stripe = require('stripe');
const { corsHeaders, verifyQBOUser, getSupabaseAdmin } = require('./_shared');
const { selectAllRows } = require('./_stripeReconciliation');

// Integer cents, so float drift never decides whether money is applied.
// Callers MUST select `paid` — a row selected as `id` alone reads as $0 paid and would turn the
// applied-payment check below into a false alarm on every invoice, so both call sites share
// INVOICE_SETTLEMENT_COLS and a test pins every invoice select in both files.
const INVOICE_SETTLEMENT_COLS = 'id,paid';
const centsOf = (value) => Math.round((Number(value) || 0) * 100);

function verifyPayment(pi, payments, invoices) {
  const ids = [...new Set(String(pi.metadata?.invoice_id || '').split(/[\s,]+/).filter(Boolean))];
  const rows = payments.filter(r => r.ref === `Stripe ${pi.id}`);
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const reasons = [];
  if (!pi.livemode) reasons.push('Test payment');
  if (pi.status !== 'succeeded') reasons.push(`Stripe status: ${pi.status}`);
  if (!ids.length) reasons.push('No portal invoice reference; review in payout reconciliation');
  if (pi.currency !== 'usd') reasons.push('Portal invoice currency comparison only supports USD');
  if (!charge) reasons.push('Charge evidence unavailable');
  if (charge?.amount_refunded > 0) reasons.push('Refund requires review');
  if (charge?.disputed) reasons.push('Dispute requires review');
  ids.forEach(id => {
    const invoice = invoices.find(r => r.id === id);
    if (!invoice) reasons.push(`Invoice ${id} not found`);
    const matches = rows.filter(r => r.invoice_id === id);
    if (matches.length !== 1) reasons.push(`${id}: ${matches.length ? 'duplicate' : 'missing'} payment record`);
    else if (!Number.isFinite(Number(matches[0].amount)) || Number(matches[0].amount) <= 0) reasons.push(`${id}: invalid payment amount`);
    // The payment row is NOT the settlement. A staff tab that loaded before the card payment can
    // save the invoice summary back to paid=0/status=open while this immutable row survives
    // (dbEngine's payment-restore keeps it on purpose), leaving a fully paid invoice in AR and on
    // the customer's statement. INV-63359 and INV-63664 both sat in exactly that state — a
    // correct, correctly-valued payment row on an invoice reading "open" — and verifying only the
    // row's existence reported both as healthy, so nothing ever raised an incident.
    //
    // The invariant is that `paid` accounts for at least what this intent recorded against the
    // invoice — NOT that the invoice has a zero balance. Staff legitimately raise `total` on an
    // already-paid invoice (Edit Invoice rewrites total and leaves paid/status alone), and a
    // balance test would flag that as an unapplied payment forever: a finding only clears when
    // verifyPayment passes, so a false positive is permanent and costs a paymentIntents.retrieve
    // on every later scan, inside the monitor's 7-second deadline.
    //
    // Deliberately no 'void' exemption: voiding keeps the payment rows and issues no refund, so a
    // void sitting at paid=0 is money captured against nothing — exactly a state worth reviewing.
    // A void that kept its applied payment has paid >= recorded and never trips this.
    const recordedCents = matches.reduce((sum, r) => sum + centsOf(r.amount), 0);
    if (invoice && centsOf(invoice.paid) + 1 < recordedCents) {
      reasons.push(`${id}: captured payment is not applied — invoice shows $${(centsOf(invoice.paid) / 100).toFixed(2)} paid against $${(recordedCents / 100).toFixed(2)} recorded`);
    }
  });
  if (rows.some(r => !ids.includes(r.invoice_id))) reasons.push('Payment reference recorded on another invoice');
  const recorded = rows.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0);
  if (ids.length && recorded !== pi.amount_received) reasons.push('Recorded payment total differs from Stripe captured amount');
  return { id: pi.id, created: pi.created, status: pi.status, currency: pi.currency,
    captured_cents: pi.amount_received, recorded_cents: Number.isFinite(recorded) ? recorded : null,
    invoice_ids: ids, verified: reasons.length === 0, reasons };
}

exports.handler = async event => {
  const headers = { ...corsHeaders(event.headers?.origin), 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST required' });
  const auth = await verifyQBOUser(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON' }); }
  if (!body || !['connection', 'payments'].includes(body.action)) return reply(400, { error: 'Unknown action' });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return reply(503, { error: 'Stripe server connection is not configured' });
  try {
    const client = stripe(key);
    if (body.action === 'connection') {
      const [account, balance] = await Promise.all([client.accounts.retrieve(), client.balance.retrieve()]);
      const amounts = rows => (rows || []).map(({amount, currency}) => ({ amount, currency }));
      return reply(200, { account_id: account.id, name: account.business_profile?.name || account.settings?.dashboard?.display_name || account.id,
        livemode: balance.livemode, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled,
        available: amounts(balance.available), pending: amounts(balance.pending), checked_at: new Date().toISOString() });
    }
    const parseDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value ? Date.parse(`${value}T00:00:00Z`) / 1000 : NaN;
    let start, end;
    try { start = parseDate(body.from); end = parseDate(body.to); } catch (_) { /* invalid calendar date */ }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return reply(400, { error: 'Valid from/to dates required' });
    if (body.starting_after && !/^pi_[A-Za-z0-9]+$/.test(body.starting_after)) return reply(400, { error: 'Invalid payment cursor' });
    const page = await client.paymentIntents.list({ limit: 25, created: { gte: start, lt: end + 86400 },
      ...(body.starting_after ? {starting_after: body.starting_after} : {}), expand: ['data.latest_charge'] });
    const refs = page.data.map(pi => `Stripe ${pi.id}`);
    const ids = [...new Set(page.data.flatMap(pi => String(pi.metadata?.invoice_id || '').split(/[\s,]+/).filter(Boolean)))];
    const sb = getSupabaseAdmin();
    const [payments, invoices] = await Promise.all([
      refs.length ? selectAllRows(() => sb.from('invoice_payments').select('id,invoice_id,amount,ref', {count:'exact'}).in('ref', refs).order('id'), {label:'invoice payment evidence'}) : [],
      ids.length ? selectAllRows(() => sb.from('invoices').select(INVOICE_SETTLEMENT_COLS, {count:'exact'}).in('id', ids).order('id'), {label:'invoice evidence'}) : [],
    ]);
    return reply(200, { payments: page.data.map(pi => verifyPayment(pi, payments, invoices)), has_more: page.has_more,
      next_cursor: page.has_more ? page.data[page.data.length - 1]?.id : null, checked_at: new Date().toISOString() });
  } catch (err) {
    console.error('[stripe-verification]', err.type || 'verification_failed');
    return reply(502, { error: 'Verification could not finish. Check server Stripe permissions and database availability, then retry.' });
  }
};
exports.verifyPayment = verifyPayment;
exports.INVOICE_SETTLEMENT_COLS = INVOICE_SETTLEMENT_COLS;
