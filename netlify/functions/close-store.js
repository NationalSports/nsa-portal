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
  const action=body?.action || 'close';
  if (!body || typeof body.soId !== 'string' || !body.soId.trim() || !['inspect','follow_up','close'].includes(action)) {
    return reply(400, {error:'Select a store and a valid closeout action'});
  }
  if (action!=='inspect' && (!Number.isSafeInteger(body.version) || !body.review || typeof body.review.token!=='string')) {
    return reply(400, {error:'Reload the closeout review before continuing'});
  }
  try {
    const {data,error} = await getSupabaseAdmin().rpc('review_store_closeout', {
      p_so_id:body.soId, p_expected_version:body.version ?? null, p_actor_id:auth.teamMemberId,
      p_action:action,p_review:body.review || {},p_invoice:body.invoice || null,
    });
    if (error) return reply(409, {error:error.message});
    if (data?.follow_up_saved) return reply(data.ok?200:409,data);
    if (action==='inspect') return data?.review_status ? reply(200,data) : reply(502,{error:'Review could not be loaded'});
    if (!data?.ok || !data.sales_order?.store_closed_at || !data.invoice || !Array.isArray(data.payments)) {
      return reply(502, {error:'Closeout was not confirmed. Reload before retrying.'});
    }
    return reply(200, data);
  } catch { return reply(503, {error:'Closeout could not be confirmed. Reload before retrying.'}); }
};
