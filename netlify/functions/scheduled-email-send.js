// Internal bridge used by the Supabase scheduler. It shares the exact routing
// policy and Gmail credentials used by interactive sends and follow-up reminders.
const { getSupabaseAdmin, safeEqualStr } = require('./_shared');
const { sendPortalEmail } = require('./_emailRouter');
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !safeEqualStr(event.headers?.['x-internal-secret'], secret)) return reply(401, { error: 'Unauthorized' });
  if (Buffer.byteLength(event.body || '') > 6 * 1024 * 1024) return reply(413, { error: 'Email is too large' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  try {
    const { status, ...out } = await sendPortalEmail(getSupabaseAdmin(), payload);
    return reply(status, out);
  } catch (e) { return reply(503, { error: e.message }); }
};
