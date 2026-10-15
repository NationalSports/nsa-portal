const { corsHeaders, verifyAdmin } = require('./_shared');

const REQUEST_SELECT = 'id,created_by,customer_id,request_text,attachment_urls,selected_items,selected_art,start_from_type,start_from_id,start_from_url,created_at,status';
const WEBHOOK_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reply = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(body),
});

async function notifyWebhook(request, env = process.env, fetchImpl = fetch) {
  const url = String(env.STORE_REQUEST_WEBHOOK_URL || '').trim();
  const key = String(env.STORE_REQUEST_WEBHOOK_KEY || '').trim();
  if (!url || !key) throw new Error('Store request webhook is not configured');

  const payload = {
    request_id: request.id,
    created_by: request.created_by,
    customer_id: request.customer_id,
    request_text: request.request_text,
    attachment_urls: request.attachment_urls || [],
    selected_items: request.selected_items || [],
    selected_art: request.selected_art || [],
    start_from_type: request.start_from_type || 'blank',
    start_from_id: request.start_from_id || null,
    start_from_url: request.start_from_url || null,
    created_at: request.created_at,
  };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Store request webhook returned ${response.status}`);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const auth = await verifyAdmin(event);
  if (!auth.ok) return reply(auth.status || 403, { error: auth.error || 'Not authorized' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return reply(400, { error: 'Invalid JSON body' });
  }
  const requestId = String(body.request_id || '').trim();
  if (!UUID_RE.test(requestId)) return reply(400, { error: 'Valid request_id required' });

  const { data: request, error } = await auth.admin
    .from('webstore_build_requests')
    .select(REQUEST_SELECT)
    .eq('id', requestId)
    .maybeSingle();
  if (error) {
    console.error('[notify-store-request] request lookup failed', requestId, error);
    return reply(500, { error: 'Could not load store request', notified: false });
  }
  if (!request) return reply(404, { error: 'Store request not found', notified: false });
  if (request.status !== 'queued') {
    return reply(409, { error: 'Store request is no longer queued', notified: false });
  }

  try {
    await notifyWebhook(request);
    return reply(200, { ok: true, notified: true });
  } catch (error_) {
    console.error('[notify-store-request] assistant notification failed', requestId, error_);
    return reply(502, {
      ok: false,
      notified: false,
      error: 'Store request was queued, but the assistant was not notified',
    });
  }
};

module.exports.notifyWebhook = notifyWebhook;
module.exports.WEBHOOK_TIMEOUT_MS = WEBHOOK_TIMEOUT_MS;
