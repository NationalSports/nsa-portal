const {verifyUser, getSupabaseAdmin} = require('./_shared');
const allowed = new Set([
  '00000000-0000-0000-0000-000000000001', '35436542-e7f2-49db-8120-6111cf83b960',
  '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000040',
  '00000000-0000-0000-0000-000000000041',
]);
const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
exports.handler = async event => {
  const reply = (statusCode, body) => ({statusCode, headers, body:JSON.stringify(body)});
  if (event.httpMethod !== 'POST') return reply(405, {error:'POST required'});
  const auth = await verifyUser(event, ["receive_payments"]);
  if (!auth.ok) return reply(auth.status, {error:'Sign in with payment accounting access'});
  if (!allowed.has(auth.teamMemberId)) return reply(403, {error:'Payment accounting access required'});
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, {error:'Invalid request'}); }
  if (!body.invoiceId || !body.paymentRef || !body.payment || body.confirmed !== true
    || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 1000) {
    return reply(400, {error:'Select a payment, enter a reason, and confirm unapplication'});
  }
  try {
    const {data, error} = await getSupabaseAdmin().rpc('unapply_invoice_payment', {
      p_invoice_id:body.invoiceId, p_payment_ref:body.paymentRef,
      p_expected_payment:{amount:body.payment.amount, method:body.payment.method, date:body.payment.date, receipt_id:body.payment.receipt_id || null},
      p_reason:body.reason.trim(), p_actor_id:auth.teamMemberId,
    });
    if (error) return reply(409, {error:error.message});
    if (!data?.invoice || !Array.isArray(data.payments)) return reply(502, {error:'Unapplication was not confirmed. Reload before retrying.'});
    return reply(200, data);
  } catch { return reply(503, {error:'Could not confirm unapplication. Reload the invoice before retrying.'}); }
};
