// Read-only Stripe evidence for the accounting team. Never settles or posts invoices.
const stripe = require('stripe');
const { corsHeaders, verifyQBOUser, getSupabaseAdmin } = require('./_shared');
const { selectAllRows } = require('./_stripeReconciliation');

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
    if (!invoices.some(r => r.id === id)) reasons.push(`Invoice ${id} not found`);
    const matches = rows.filter(r => r.invoice_id === id);
    if (matches.length !== 1) reasons.push(`${id}: ${matches.length ? 'duplicate' : 'missing'} payment record`);
    else if (!Number.isFinite(Number(matches[0].amount)) || Number(matches[0].amount) <= 0) reasons.push(`${id}: invalid payment amount`);
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
      ids.length ? selectAllRows(() => sb.from('invoices').select('id', {count:'exact'}).in('id', ids).order('id'), {label:'invoice evidence'}) : [],
    ]);
    return reply(200, { payments: page.data.map(pi => verifyPayment(pi, payments, invoices)), has_more: page.has_more,
      next_cursor: page.has_more ? page.data[page.data.length - 1]?.id : null, checked_at: new Date().toISOString() });
  } catch (err) {
    console.error('[stripe-verification]', err.type || 'verification_failed');
    return reply(502, { error: 'Verification could not finish. Check server Stripe permissions and database availability, then retry.' });
  }
};
exports.verifyPayment = verifyPayment;
