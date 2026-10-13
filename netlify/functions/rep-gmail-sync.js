// Public, authenticated endpoint for My Email's Check now button.
// Do not attach a Netlify schedule: scheduled functions reject HTTP requests.
const { corsHeaders, verifyUser } = require('./_shared');
const { syncLink } = require('./_repGmailSync');
const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  const deadline = Date.now() + 20000;
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const { data: link, error } = await auth.admin.from('rep_google_links').select('*').eq('team_member_id', auth.teamMemberId).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!link) return json(400, { error: 'Connect Google first' });
  const result = await syncLink(auth.admin, link, deadline, event);
  return json(result.error ? 500 : 200, { ok: !result.error, ...result });
};
