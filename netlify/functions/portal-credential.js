const { corsHeaders, verifyUser, verifyAdmin } = require('./_shared');
const { issuePortalCredential } = require('./_portalCredentials');

exports.handler = async (event) => {
  const headers = { ...corsHeaders(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return reply(400, { ok: false, error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { ok: false, error: 'Invalid request' });
  const { action, customer_id: customerId } = body;
  if (!['issue', 'list', 'revoke', 'revoke_legacy'].includes(action)
    || typeof customerId !== 'string' || !customerId.trim() || customerId.length > 200) {
    return reply(400, { ok: false, error: 'Valid action and customer_id required' });
  }
  try {
    const verification = await (action === 'revoke' || action === 'revoke_legacy' ? verifyAdmin : verifyUser)(event);
    if (!verification.ok) return reply(verification.status, { ok: false, error: verification.error });
    const admin = verification.admin;
    if (action === 'issue') {
      const result = await issuePortalCredential(admin, customerId, { label: body.label || 'Staff portal link' });
      return reply(200, { ok: true, ...result });
    }
    if (action === 'list') {
      const { data, error } = await admin.from('portal_access_credentials')
        .select('id,credential_kind,label,created_at,expires_at,disabled_at')
        .eq('customer_id', customerId).order('created_at', { ascending: false });
      if (error) throw error;
      return reply(200, { ok: true, credentials: data });
    }
    if (action === 'revoke' && (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id))) {
      return reply(400, { ok: false, error: 'Credential id required' });
    }
    let query = admin.from('portal_access_credentials')
      .update({ disabled_at: new Date().toISOString() }).eq('customer_id', customerId);
    query = action === 'revoke_legacy' ? query.eq('credential_kind', 'legacy_alpha_tag') : query.eq('id', body.id);
    const { data, error } = await query.select('id');
    if (error) throw error;
    return reply(200, { ok: true, revoked: (data || []).map(row => row.id) });
  } catch (_) {
    return reply(500, { ok: false, error: 'Portal credential operation failed' });
  }
};
