const crypto = require('crypto');
const {getCatalog} = require('./_showcaseCatalog');
const { corsHeaders, verifyUser, getTrustedSiteBaseUrl } = require('./_shared');
const { PROMPT_VERSION, normalizeMode } = require('./_showcase');
const { DECORATION_FINISHES, normalizeShowcaseSettings, showcaseSettingsChanged } = require('../../src/lib/showcaseSettings');

const { expireStalledJobs } = require('./_showcaseJobs');

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
    status: row.status === 'canceled' && !row.generation_request_id && !row.showcase_image_url && !row.approved_showcase_image_url ? 'missing' : row.status,
    approval_status: row.approval_status,
    fallback_to_standard: row.fallback_to_standard !== false,
    provider: row.provider,
    provider_model: row.provider_model,
    analysis_provider: row.analysis_provider,
    analysis_model: row.analysis_model,
    provider_job_id: row.provider_job_id,
    prompt_version: row.prompt_version,
    qa_result: row.qa_result || {},
    family_version: row.analysis?.family?.version || null,
    family_key: row.analysis?.family?.key || null,
    showcase_settings: normalizeShowcaseSettings(row.analysis?.showcase_settings),
    needs_regeneration: showcaseSettingsChanged(row.analysis),
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
    .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by,store_art')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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
  const counts = { approved: 0, review: 0, missing: 0, generating: 0, failed: 0, canceled: 0, queued: 0 };
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
  if (status === 'queued' || status === 'generating') return false;
  if (asset && (asset.prompt_version !== PROMPT_VERSION || showcaseSettingsChanged(asset.analysis))) return true;
  if (status === 'approved') return false;
  if (status === 'review' && asset?.approval_status !== 'rejected') return false;
  return true;
}

function generateAllProducts(catalog, assetRows) {
  const byWp = Object.fromEntries((assetRows || []).map((asset) => [asset.webstore_product_id, asset]));
  return (catalog || []).filter((product) => isGenerateAllEligible(product, byWp[product.webstore_product_id]));
}

async function queueProduct(admin, storeId, product, requestId, now, settings) {
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
      analysis: { showcase_settings: normalizeShowcaseSettings(settings) },
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
    getCatalog(admin, store.id, store.store_art),
    admin.from('webstore_showcase_assets').select('*').eq('store_id', store.id),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  const assets = await expireStalledJobs(admin, assetsResult.data || []);
  return buildStateSnapshot(store, catalog, assets);
}

async function updateAsset(admin, storeId, wpId, fields, expectedUpdatedAt) {
  let query = admin
    .from('webstore_showcase_assets')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('store_id', storeId)
    .eq('webstore_product_id', wpId);
  if (expectedUpdatedAt) query = query.eq('updated_at',expectedUpdatedAt);
  const {data,error} = await query.select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (expectedUpdatedAt && !data) throw new Error('This image changed. Refresh before reviewing it.');
  return data;
}

async function clearNotificationBatchIfInactive(admin, storeId) {
  const { data: active, error: activeError } = await admin
    .from('webstore_showcase_assets')
    .select('id')
    .eq('store_id', storeId)
    .in('status', ['queued', 'generating'])
    .limit(1);
  if (activeError) throw new Error(activeError.message);
  if (active?.length) return false;
  const { error } = await admin
    .from('webstores')
    .update({
      showcase_review_notification_status: 'idle',
      showcase_review_notification_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storeId)
    .eq('showcase_review_notification_status', 'pending');
  if (error) throw new Error(error.message);
  return true;
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
        .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by,store_art')
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
        .select('id,slug,name,status,presentation_mode,published_presentation_mode,presentation_published_at,presentation_published_by,store_art')
        .single();
      if (error) throw new Error(error.message);
      return reply(200, { ok: true, store: data, fallback_count: fallbackCount });
    }

    if (['generate_family', 'generate_all_families', 'cancel_family'].includes(action)) {
      const { queueFamilies, transition } = require('./_showcaseFamily');
      const catalog = await getCatalog(admin, storeId, store.store_art);
      const { data, error } = await admin.from('webstore_showcase_assets').select('*').eq('store_id', storeId);
      if (error) throw new Error(error.message);
      const assets = await expireStalledJobs(admin, data || []);
      if (action === 'cancel_family') {
        const {groupShowcaseItems} = require('../../src/lib/showcaseFamilies');
        const group = groupShowcaseItems(catalog).find((g)=>g.key===body.family_key);
        if (!group) return reply(404,{error:'Base item not found'});
        const ids = new Set(group.items.map((m)=>m.webstore_product_id));
        const active = assets.filter((a)=>ids.has(a.webstore_product_id) && ['queued','generating'].includes(a.status));
        const handled = new Set();
        for (const asset of active) {
          if (asset.analysis?.family?.key) {
            if (!handled.has(asset.generation_request_id)) await transition(admin,storeId,asset.analysis.family.key,asset.generation_request_id,'cancel');
            handled.add(asset.generation_request_id);
          } else {
            const result = await admin.from('webstore_showcase_assets').update({status:'canceled',updated_at:new Date().toISOString()})
              .eq('id',asset.id).eq('updated_at',asset.updated_at).in('status',['queued','generating']);
            if (result.error) throw new Error(result.error.message);
          }
        }
        await clearNotificationBatchIfInactive(admin,storeId);
        return reply(200,{ok:true});
      }
      if (body.showcase_settings && !DECORATION_FINISHES.some(([key]) => key === body.showcase_settings.decoration_type)) return reply(400,{error:'Invalid decoration finish'});
      const result = await queueFamilies({admin,store,catalog,assets,key:String(body.family_key || ''),all:action==='generate_all_families',
        settings:body.showcase_settings,newMaster:body.new_master===true,baseUrl:getWorkerBaseUrl(event)});
      return reply(result.failed_count && !result.queued_count ? 502 : 202,{ok:!result.failed_count,...result});
    }

    // Old browser bundles must refresh instead of quietly restarting one paid
    // generation per color/logo and undoing the shared-base workflow.
    if (action === 'generate_all' || action === 'generate') {
      return reply(409,{error:'Refresh Store Appearance to generate by base item.'});
    }

    if (action === 'cancel_all') {
      const cancelRequestId = crypto.randomUUID();
      const { data: canceled, error } = await admin
        .from('webstore_showcase_assets')
        .update({
          status: 'canceled',
          generation_request_id: cancelRequestId,
          error_details: null,
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', storeId)
        .in('status', ['queued', 'generating'])
        .select('id');
      if (error) throw new Error(error.message);
      await clearNotificationBatchIfInactive(admin, storeId);
      return reply(200, { ok: true, canceled_count: canceled?.length || 0 });
    }

    const wpId = String(body.webstore_product_id || '');
    if (!UUID_RE.test(wpId)) return reply(400, { error: 'Valid webstore_product_id required' });

    if (body.showcase_settings !== undefined) {
      const settings = body.showcase_settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)
        || !DECORATION_FINISHES.some(([key]) => key === settings.decoration_type)
        || (settings.revision_notes !== undefined && (typeof settings.revision_notes !== 'string' || settings.revision_notes.length > 1000))) {
        return reply(400, { error: 'Choose a valid decoration finish and keep review notes under 1,000 characters' });
      }
    }

    if (action === 'save_settings') {
      if (!body.showcase_settings) return reply(400, { error: 'Showcase settings required' });
      const catalog = await getCatalog(admin, storeId, store.store_art);
      const product = catalog.find((item) => item.webstore_product_id === wpId);
      if (!product) return reply(404, { error: 'Store product not found' });
      if (product.kind === 'bundle') return reply(400, { error: 'Choose finishes for the package components instead' });
      const { data: existing, error: existingError } = await admin.from('webstore_showcase_assets')
        .select('*').eq('store_id', storeId).eq('webstore_product_id', wpId).maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (['queued', 'generating'].includes(existing?.status)) return reply(409, { error: 'Cancel the active image job before changing its finish' });
      const analysis = { ...(existing?.analysis || {}), showcase_settings: normalizeShowcaseSettings(body.showcase_settings) };
      let saved;
      if (existing) {
        // Scope to the version read above so a worker or another rep cannot be overwritten.
        const result = await admin.from('webstore_showcase_assets')
          .update({ analysis, updated_at: new Date().toISOString() })
          .eq('id', existing.id).eq('updated_at', existing.updated_at).select('*').maybeSingle();
        if (result.error) throw new Error(result.error.message);
        if (!result.data) return reply(409, { error: 'This image changed. Refresh before saving the finish.' });
        saved = result.data;
      } else {
        const result = await admin.from('webstore_showcase_assets').insert({
          store_id: storeId, webstore_product_id: wpId, product_id: product.product_id,
          standard_image_url: product.standard_image_url, status: 'canceled', analysis,
        }).select('*').single();
        if (result.error) throw new Error(result.error.message);
        saved = result.data;
      }
      return reply(200, { ok: true, asset: publicAsset(saved) });
    }

    if (action === 'cancel') {
      const { data: active, error: activeError } = await admin
        .from('webstore_showcase_assets')
        .select('*')
        .eq('store_id', storeId)
        .eq('webstore_product_id', wpId)
        .maybeSingle();
      if (activeError) throw new Error(activeError.message);
      if (!active || !['queued', 'generating'].includes(active.status)) {
        return reply(409, { error: 'This Showcase image is not currently running' });
      }
      const current = await updateAsset(admin, storeId, wpId, {
        status: 'canceled',
        generation_request_id: crypto.randomUUID(),
        error_details: null,
      });
      await clearNotificationBatchIfInactive(admin, storeId);
      return reply(200, { ok: true, asset: publicAsset(current) });
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
      if (showcaseSettingsChanged(ready.analysis)) return reply(409, { error: 'Generate a new image to apply the selected decoration finish before approving' });
      if (ready.analysis?.family?.key) {
        const {data:family,error:familyError} = await admin.from('webstore_showcase_families').select('inputs,request_id')
          .eq('store_id',storeId).eq('family_key',ready.analysis.family.key).maybeSingle();
        if (familyError) throw new Error(familyError.message);
        const {groupShowcaseItems} = require('../../src/lib/showcaseFamilies');
        const {catalogSignature} = require('./_showcaseFamily');
        const group = groupShowcaseItems(await getCatalog(admin,storeId,store.store_art)).find((g)=>g.key===ready.analysis.family.key);
        if (!family || family.request_id!==ready.generation_request_id || !group || catalogSignature(group.items)!==family.inputs.catalog_signature)
          return reply(409,{error:'The catalog or artwork changed. Generate the item again before approving.'});
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
      }, ready.updated_at);
      return reply(200, { ok: true, asset: publicAsset(current) });
    }

    if (action === 'reject' || action === 'fallback') {
      const { data: existing, error: existingError } = await admin
        .from('webstore_showcase_assets')
        .select('*')
        .eq('store_id', storeId)
        .eq('webstore_product_id', wpId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return reply(404, { error: 'Showcase asset not found' });
      if (['queued','generating'].includes(existing.status)) return reply(409,{error:'Cancel generation before changing the review decision'});
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
      },existing.updated_at);
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
module.exports.clearNotificationBatchIfInactive = clearNotificationBatchIfInactive;

module.exports.queueProduct = queueProduct;
