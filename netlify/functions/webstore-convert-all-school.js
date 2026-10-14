const { corsHeaders, getSupabaseAdmin, verifyAdmin } = require('./_shared');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['keep_active', 'map_dtf', 'deactivate', 'keep_hidden']);

function response(statusCode, body) {
  return { statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'POST only' });
  let auth;
  try { auth = await verifyAdmin(event); }
  catch (_) { return response(500, { ok: false, error: 'Authentication check failed' }); }
  if (!auth.ok) return response(auth.status, { ok: false, error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { ok: false, error: 'Invalid JSON' }); }
  const storeId = String(body.store_id || '');
  const settings = body.settings;
  const actions = body.actions;
  if (!UUID_RE.test(storeId)) return response(400, { ok: false, error: 'Valid store_id required' });
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return response(400, { ok: false, error: 'Settings review required' });
  if (!Array.isArray(actions) || actions.length > 1000 || actions.some((action) => !UUID_RE.test(String(action?.id || '')) || !ACTIONS.has(action?.action))) {
    return response(400, { ok: false, error: 'A valid reviewed action is required for every product' });
  }
  if (actions.some((action) => action.action === 'map_dtf' && (!Array.isArray(action.decorations) || !Array.isArray(action.transfer_codes)))) {
    return response(400, { ok: false, error: 'DTF mappings require decorations and transfer codes' });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc('convert_team_store_to_all_school', {
      p_store_id: storeId,
      p_settings: settings,
      p_actions: actions,
    });
    if (error) {
      const stale = error.code === '40001' || /STALE_REVIEW/.test(error.message || '');
      const pendingOrders = /PENDING_ORDERS/.test(error.message || '');
      console.error('[webstore-convert-all-school] failed:', error.message || error);
      return response(stale || pendingOrders ? 409 : 500, { ok: false, error: stale ? 'The catalog changed. Close this review and open it again.' : pendingOrders ? 'Batch existing team orders before conversion.' : 'Atomic conversion failed; the team store was not changed.' });
    }
    if (!data?.ok || !data?.store?.id) return response(500, { ok: false, error: 'Atomic conversion failed; the team store was not changed.' });
    return response(200, data);
  } catch (error) {
    console.error('[webstore-convert-all-school] unexpected failure:', error.message || error);
    return response(500, { ok: false, error: 'Atomic conversion failed; the team store was not changed.' });
  }
};
