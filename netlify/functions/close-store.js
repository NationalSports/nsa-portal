const {verifyUser, getSupabaseAdmin} = require('./_shared');
const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
exports.handler = async event => {
  const reply = (statusCode, body) => ({statusCode, headers, body:JSON.stringify(body)});
  if (event.httpMethod !== 'POST') return reply(405, {error:'POST required'});
  let auth;
  try { auth = await verifyUser(event); }
  catch { return reply(503, {error:'Staff session could not be verified. Please retry.'}); }
  if (!auth.ok) return reply(auth.status, {error:'Active staff session required'});
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, {error:'Invalid request'}); }
  if (!body || typeof body.soId !== 'string' || !body.soId.trim() || body.costsRecorded !== true || body.shipped !== true || !Number.isSafeInteger(body.version)) {
    return reply(400, {error:'Review the saved order and confirm all costs and shipments'});
  }
  try {
    const {data,error} = await getSupabaseAdmin().rpc('close_store', {
      p_so_id:body.soId, p_expected_version:body.version, p_actor_id:auth.teamMemberId,
      p_costs_recorded:true, p_shipped:true, p_invoice:body.invoice || null,
    });
    if (error) return reply(409, {error:error.message});
    if (!data?.ok || !data.sales_order?.store_closed_at || !data.invoice || !Array.isArray(data.payments)) {
      return reply(502, {error:'Closeout was not confirmed. Reload before retrying.'});
    }
    return reply(200, data);
  } catch { return reply(503, {error:'Closeout could not be confirmed. Reload before retrying.'}); }
};
