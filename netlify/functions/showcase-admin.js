const crypto = require('crypto');
const { corsHeaders, verifyUser, getTrustedSiteBaseUrl } = require('./_shared');
const { PROMPT_VERSION, normalizeMode } = require('./_showcase');
const { markShowcaseBatchPending } = require('./_showcaseEmail');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reply = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(body),
});

function getWorkerBaseUrl(event, env = process.env) {
  return getTrustedSiteBaseUrl(event, env);
}

function publicAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    store_id: row.store_id,
    webstore_product_id: row.webstore_product_id,
    product_id: row.product_id,
    standard_image_url: row.standard_image_url,
    showcase_image_url: row.showcase_image_url,
    approved_showcase_image_url: row.approved_showcase_image_url,
    status: row.status,
    approval_status: row.approval_status,
    fallback_to_standard: row.fallback_to_standard !== false,
    provider: row.provider,
    provider_model: row.provider_model,
    analysis_provider: row.analysis_provider,
    analysis_model: row.analysis_model,
    provider_job_id: row.provider_job_id,
    prompt_version: row.prompt_version,
    qa_result: row.qa_result || {},
    error_details: row.error_details,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    generation_started_at: row.generation_started_at,
    generated_at: row.generated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getStore(admin, storeId) {
  const { data, error } = await admin
    .from('webstores')
    .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getCatalog(admin, storeId) {
  const { data: rows, error } = await admin
    .from('webstore_products')
    .select('id,store_id,product_id,kind,sku,display_name,image_url,decorations,active,sort_order')
    .eq('store_id', storeId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  const productIds = [...new Set((rows || []).map((r) => r.product_id).filter(Boolean))];
  let products = [];
  if (productIds.length) {
    const result = await admin
      .from('products')
      .select('id,sku,name,brand,color,category,description,image_front_url')
      .in('id', productIds);
    if (result.error) throw new Error(result.error.message);
    products = result.data || [];
  }
  const byProduct = Object.fromEntries(products.map((p) => [p.id, p]));
  return (rows || []).map((wp) => {
    const product = byProduct[wp.product_id] || {};
    return {
      webstore_product_id: wp.id,
      product_id: wp.product_id,
      kind: wp.kind,
      sku: wp.sku || product.sku || '',
      name: wp.display_name || product.name || wp.sku || 'Store product',
      brand: product.brand || '',
      color: product.color || '',
      category: product.category || '',
      decorations: wp.decorations || [],
      standard_image_url: wp.image_url || product.image_front_url || null,
      sort_order: wp.sort_order || 0,
    };
  });
}

function buildStateSnapshot(store, catalog, assetRows) {
  const byWp = Object.fromEntries((assetRows || []).map((a) => [a.webstore_product_id, publicAsset(a)]));
  const items = catalog.map((product) => {
    const asset = byWp[product.webstore_product_id];
    return {
      ...product,
      asset: asset || {
        store_id: store.id,
        webstore_product_id: product.webstore_product_id,
        product_id: product.product_id,
        standard_image_url: product.standard_image_url,
        showcase_image_url: null,
        approved_showcase_image_url: null,
        status: 'missing',
        approval_status: 'pending',
        fallback_to_standard: true,
      },
    };
  });
  const counts = { approved: 0, review: 0, missing: 0, generating: 0, failed: 0, queued: 0 };
  items.forEach(({ asset }) => {
    const key = asset.approval_status === 'rejected' && asset.status === 'review' ? 'review' : asset.status;
    if (counts[key] == null) counts[key] = 0;
    counts[key]++;
  });
  return {
    store: {
      ...store,
      presentation_mode: normalizeMode(store.presentation_mode),
      published_presentation_mode: normalizeMode(store.published_presentation_mode),
    },
    items,
    counts,
  };
}

function isGenerateAllEligible(product, asset) {
  if (!product || product.kind === 'bundle' || !product.standard_image_url) return false;
  const status = asset?.status || 'missing';
  if (status === 'queued' || status === 'generating' || status === 'approved') return false;
  if (status === 'review' && asset?.approval_status !== 'rejected') return false;
  return true;
}

function generateAllProducts(catalog, assetRows) {
  const byWp = Object.fromEntries((assetRows || []).map((asset) => [asset.webstore_product_id, asset]));
  return (catalog || []).filter((product) => isGenerateAllEligible(product, byWp[product.webstore_product_id]));
}

async function queueProduct(admin, storeId, product, requestId, now) {
  const { data, error } = await admin
    .from('webstore_showcase_assets')
    .upsert({
      store_id: storeId,
      webstore_product_id: product.webstore_product_id,
      product_id: product.product_id,
      standard_image_url: product.standard_image_url,
      status: 'queued',
      approval_status: 'pending',
      fallback_to_standard: true,
      generation_request_id: requestId,
      prompt_version: PROMPT_VERSION,
      showcase_image_url: null,
      provider: null,
      provider_model: null,
      analysis_provider: null,
      analysis_model: null,
      provider_job_id: null,
      prompt: null,
      analysis: {},
      qa_result: {},
      error_details: null,
      reviewed_by: null,
      reviewed_at: null,
      generation_started_at: null,
      generated_at: null,
      updated_at: now,
    }, { onConflict: 'store_id,webstore_product_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function state(admin, store) {
  const [catalog, assetsResult] = await Promise.all([
    getCatalog(admin, store.id),
    admin.from('webstore_showcase_assets').select('*').eq('store_id', store.id),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  return buildStateSnapshot(store, catalog, assetsResult.data || []);
}

async function updateAsset(admin, storeId, wpId, fields) {
  const { data, error } = await admin
    .from('webstore_showcase_assets')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('store_id', storeId)
    .eq('webstore_product_id', wpId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const auth = await verifyUser(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  const admin = auth.admin;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON body' }); }
  const action = String(body.action || 'state');
  const storeId = String(body.store_id || '');
  if (!UUID_RE.test(storeId)) return reply(400, { error: 'Valid store_id required' });

  try {
    const store = await getStore(admin, storeId);
    if (!store) return reply(404, { error: 'Store not found' });

    if (action === 'state' || action === 'preview') {
      const snapshot = await state(admin, store);
      if (action === 'preview') {
        const mode = normalizeMode(body.mode ?? store.presentation_mode);
        const assets = {};
        snapshot.items.forEach(({ webstore_product_id, asset }) => {
          if (asset.approved_showcase_image_url) {
            assets[webstore_product_id] = asset.approved_showcase_image_url;
          }
        });
        return reply(200, { ok: true, mode, preview: true, assets });
      }
      return reply(200, { ok: true, ...snapshot });
    }

    if (action === 'save_mode') {
      const mode = normalizeMode(body.mode);
      const { data, error } = await admin
        .from('webstores')
        .update({ presentation_mode: mode, updated_at: new Date().toISOString() })
        .eq('id', storeId)
        .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by')
        .single();
      if (error) throw new Error(error.message);
      return reply(200, { ok: true, store: data });
    }

    if (action === 'publish') {
      const mode = normalizeMode(body.mode ?? store.presentation_mode);
      const snapshot = await state(admin, store);
      const fallbackCount = mode === 'showcase'
        ? snapshot.items.filter(({ asset }) => !asset.approved_showcase_image_url).length
        : 0;
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from('webstores')
        .update({
          presentation_mode: mode,
          published_presentation_mode: mode,
          presentation_published_at: now,
          presentation_published_by: auth.teamMemberId,
          updated_at: now,
        })
        .eq('id', storeId)
        .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by')
        .single();
      if (error) throw new Error(error.message);
      return reply(200, { ok: true, store: data, fallback_count: fallbackCount });
    }

    if (action === 'generate_all') {
      const [catalog, assetsResult] = await Promise.all([
        getCatalog(admin, storeId),
        admin.from('webstore_showcase_assets').select('*').eq('store_id', storeId),
      ]);
      if (assetsResult.error) throw new Error(assetsResult.error.message);
      const products = generateAllProducts(catalog, assetsResult.data || []);
      if (!products.length) {
        return reply(200, { ok: true, queued_count: 0, failed_count: 0 });
      }

      const baseUrl = getWorkerBaseUrl(event);
      if (!baseUrl) return reply(500, { error: 'Unable to start Showcase background worker' });

      const requestId = crypto.randomUUID();
      const now = new Date().toISOString();
      // Queue the entire batch before starting any worker. A fast worker can
      // therefore never email the rep while later products are still being added.
      const queuedAssets = await Promise.all(
        products.map((product) => queueProduct(admin, storeId, product, requestId, now)),
      );
      await markShowcaseBatchPending(admin, storeId, requestId);

      const internalSecret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
      const triggerResults = await Promise.all(queuedAssets.map(async (queued) => {
        try {
          const trigger = await fetch(`${baseUrl}/.netlify/functions/showcase-image-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
            body: JSON.stringify({ asset_id: queued.id, generation_request_id: requestId }),
          });
          if (!trigger.ok && trigger.status !== 202) throw new Error(`worker returned HTTP ${trigger.status}`);
          return true;
        } catch (e) {
          await updateAsset(admin, storeId, queued.webstore_product_id, {
            status: 'failed',
            error_details: `Unable to start background worker: ${e.message}`,
          });
          return false;
        }
      }));
      const queuedCount = triggerResults.filter(Boolean).length;
      const failedCount = triggerResults.length - queuedCount;
      if (!queuedCount) return reply(502, { error: 'Unable to start Showcase background workers', queued_count: 0, failed_count: failedCount });
      return reply(202, { ok: true, queued_count: queuedCount, failed_count: failedCount });
    }

    const wpId = String(body.webstore_product_id || '');
    if (!UUID_RE.test(wpId)) return reply(400, { error: 'Valid webstore_product_id required' });

    if (action === 'generate') {
      const catalog = await getCatalog(admin, storeId);
      const product = catalog.find((p) => p.webstore_product_id === wpId);
      if (!product) return reply(404, { error: 'Store product not found' });
      if (product.kind === 'bundle') return reply(400, { error: 'Generate Showcase images for the package components instead' });
      if (!product.standard_image_url) return reply(400, { error: 'A Standard source image is required before generation' });

      const requestId = crypto.randomUUID();
      const queued = await queueProduct(admin, storeId, product, requestId, new Date().toISOString());
      // Publish the notification batch only after the queued asset is visible.
      // This prevents a finishing worker from observing a pending batch with no
      // active asset and emailing the rep before this request actually runs.
      await markShowcaseBatchPending(admin, storeId, requestId);

      // DEPLOY_PRIME_URL is available while Netlify builds a preview, but not
      // inside the deployed Functions runtime. Use the validated request host so
      // a preview invokes the worker from that same immutable deploy.
      const baseUrl = getWorkerBaseUrl(event);
      if (!baseUrl) {
        await updateAsset(admin, storeId, wpId, { status: 'failed', error_details: 'Unable to start background worker: site URL unavailable' });
        return reply(500, { error: 'Unable to start Showcase background worker' });
      }
      const internalSecret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
      try {
        const trigger = await fetch(`${baseUrl}/.netlify/functions/showcase-image-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
          body: JSON.stringify({ asset_id: queued.id, generation_request_id: requestId }),
        });
        if (!trigger.ok && trigger.status !== 202) {
          throw new Error(`worker returned HTTP ${trigger.status}`);
        }
      } catch (e) {
        await updateAsset(admin, storeId, wpId, { status: 'failed', error_details: `Unable to start background worker: ${e.message}` });
        return reply(502, { error: 'Unable to start Showcase background worker' });
      }
      return reply(202, { ok: true, asset: publicAsset(queued) });
    }

    if (action === 'approve') {
      const { data: ready, error: readyError } = await admin
        .from('webstore_showcase_assets')
        .select('*')
        .eq('store_id', storeId)
        .eq('webstore_product_id', wpId)
        .maybeSingle();
      if (readyError) throw new Error(readyError.message);
      if (!ready || ready.status !== 'review' || !ready.showcase_image_url) {
        return reply(409, { error: 'No generated Showcase image is ready to approve' });
      }
      const current = await updateAsset(admin, storeId, wpId, {
        status: 'approved',
        approval_status: 'approved',
        fallback_to_standard: true,
        reviewed_by: auth.teamMemberId,
        reviewed_at: new Date().toISOString(),
        qa_result: {
          ...(ready.qa_result || {}),
          human_review_required: false,
          human_approved: true,
          exact_artwork_verified: true,
          protected_branding_verified: true,
        },
        approved_showcase_image_url: ready.showcase_image_url,
        error_details: null,
      });
      return reply(200, { ok: true, asset: publicAsset(current) });
    }

    if (action === 'reject' || action === 'fallback') {
      const { data: existing, error: existingError } = await admin
        .from('webstore_showcase_assets')
        .select('qa_result')
        .eq('store_id', storeId)
        .eq('webstore_product_id', wpId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return reply(404, { error: 'Showcase asset not found' });
      const current = await updateAsset(admin, storeId, wpId, {
        status: 'review',
        approval_status: 'rejected',
        fallback_to_standard: true,
        reviewed_by: auth.teamMemberId,
        reviewed_at: new Date().toISOString(),
        qa_result: {
          ...(existing.qa_result || {}),
          human_review_required: true,
          human_approved: false,
          exact_artwork_verified: false,
          protected_branding_verified: false,
        },
        ...(action === 'fallback' ? { approved_showcase_image_url: null } : {}),
      });
      return reply(200, { ok: true, asset: publicAsset(current) });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[showcase-admin]', action, e);
    return reply(500, { error: e.message || 'Showcase action failed' });
  }
};

module.exports.publicAsset = publicAsset;
module.exports.getCatalog = getCatalog;
module.exports.buildStateSnapshot = buildStateSnapshot;
module.exports.isGenerateAllEligible = isGenerateAllEligible;
module.exports.generateAllProducts = generateAllProducts;
module.exports.state = state;
module.exports.getWorkerBaseUrl = getWorkerBaseUrl;
