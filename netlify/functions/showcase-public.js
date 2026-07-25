const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { normalizeMode } = require('./_showcase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    ...corsHeaders(),
    'Cache-Control': statusCode === 200 ? 'public, max-age=30, s-maxage=30' : 'no-store',
  },
  body: JSON.stringify(body),
});

function approvedAssetMap(rows) {
  const assets = {};
  (rows || []).forEach((row) => {
    if (
      row.webstore_product_id
      && row.approved_showcase_image_url
    ) assets[row.webstore_product_id] = row.approved_showcase_image_url;
  });
  return assets;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });
  const storeId = String(event.queryStringParameters?.store_id || '');
  if (!UUID_RE.test(storeId)) return reply(400, { error: 'Valid store_id required' });

  try {
    const admin = getSupabaseAdmin();
    const { data: store, error: storeError } = await admin
      .from('webstores')
      .select('id,status,published_presentation_mode')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError) throw new Error(storeError.message);
    if (!store || store.status === 'archived') return reply(404, { error: 'Store not found' });

    const mode = normalizeMode(store.published_presentation_mode);
    if (mode !== 'showcase') return reply(200, { ok: true, mode: 'standard', assets: {} });

    const { data: rows, error } = await admin
      .from('webstore_showcase_assets')
      .select('webstore_product_id,approved_showcase_image_url,status,approval_status')
      .eq('store_id', storeId)
      .not('approved_showcase_image_url', 'is', null);
    if (error) throw new Error(error.message);
    // An approved image remains published while a regeneration job is queued,
    // generating, or awaiting review. Only approving the new draft replaces it;
    // "Use Standard" clears the approved URL.
    const assets = approvedAssetMap(rows || []);
    return reply(200, { ok: true, mode, assets });
  } catch (e) {
    console.error('[showcase-public]', e);
    return reply(500, { error: 'Unable to load Showcase presentation' });
  }
};

module.exports.approvedAssetMap = approvedAssetMap;
