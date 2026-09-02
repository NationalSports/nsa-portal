// Staff-authenticated wrapper around the service-only atomic clone RPC.

const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function response(statusCode, body) {
  return { statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'POST only' });
  let auth;
  try { auth = await verifyUser(event); }
  catch (_) { return response(500, { ok: false, error: 'Authentication check failed' }); }
  if (!auth.ok) return response(auth.status, { ok: false, error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { ok: false, error: 'Invalid JSON' }); }
  const sourceId = String(body.source_id || '').trim();
  const cloneName = String(body.clone_name || '').trim();
  const slug = String(body.slug || '').trim();
  if (!UUID_RE.test(sourceId)) return response(400, { ok: false, error: 'Valid source_id required' });
  if (!cloneName || cloneName.length > 200) return response(400, { ok: false, error: 'Clone name must be 1-200 characters' });
  if (!SLUG_RE.test(slug) || slug.length > 160) return response(400, { ok: false, error: 'Valid slug required' });

  let itemIds = null;
  if (body.item_ids != null) {
    if (!Array.isArray(body.item_ids) || body.item_ids.length > 500 || body.item_ids.some((id) => !UUID_RE.test(String(id)))) {
      return response(400, { ok: false, error: 'item_ids must be an array of up to 500 UUIDs' });
    }
    itemIds = [...new Set(body.item_ids.map(String))];
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc('clone_webstore_atomic', {
      p_source_id: sourceId,
      p_clone_name: cloneName,
      p_slug: slug,
      p_as_template: body.as_template === true,
      p_start_from_template: body.start_from_template === true,
      p_rebrand: body.rebrand === true,
      p_item_ids: itemIds,
    });
    if (error) {
      const conflict = error.code === '23505' || /duplicate|unique/i.test(error.message || '');
      console.error('[webstore-clone] failed:', error.message || error);
      return response(conflict ? 409 : 500, { ok: false, error: conflict ? 'That store URL is already in use' : 'Atomic store copy failed' });
    }
    if (!data?.ok || !data?.store?.id) return response(500, { ok: false, error: 'Atomic store copy failed' });
    return response(200, data);
  } catch (error) {
    console.error('[webstore-clone] unexpected failure:', error.message || error);
    return response(500, { ok: false, error: 'Atomic store copy failed' });
  }
};
