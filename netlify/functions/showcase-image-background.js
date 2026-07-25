const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin, safeEqualStr, getTrustedSiteBaseUrl } = require('./_shared');
const {
  PROMPT_VERSION,
  fetchRemoteImage,
  analyzeWithKimi,
  generateWithOpenAI,
  artworkUrls,
} = require('./_showcase');
const { notifyShowcaseReady } = require('./_showcaseEmail');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reply = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(body),
});

async function loadJob(admin, assetId, requestId) {
  const { data: asset, error } = await admin
    .from('webstore_showcase_assets')
    .select('*')
    .eq('id', assetId)
    .eq('generation_request_id', requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!asset) return null;

  const [{ data: store, error: storeError }, { data: wp, error: wpError }] = await Promise.all([
    admin.from('webstores').select('id,name,slug,store_art').eq('id', asset.store_id).maybeSingle(),
    admin.from('webstore_products')
      .select('id,store_id,product_id,sku,display_name,image_url,decorations,category,kind')
      .eq('id', asset.webstore_product_id)
      .eq('store_id', asset.store_id)
      .maybeSingle(),
  ]);
  if (storeError) throw new Error(storeError.message);
  if (wpError) throw new Error(wpError.message);
  if (!store || !wp) throw new Error('Store product no longer exists');

  let product = {};
  if (wp.product_id) {
    const result = await admin
      .from('products')
      .select('id,sku,name,brand,color,category,description,image_front_url')
      .eq('id', wp.product_id)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    product = result.data || {};
  }
  return {
    asset,
    store,
    wp,
    product: {
      ...product,
      sku: wp.sku || product.sku,
      display_name: wp.display_name,
      name: wp.display_name || product.name || wp.sku,
      category: wp.category || product.category,
    },
  };
}

async function conditionalUpdate(admin, assetId, requestId, fields) {
  const { data, error } = await admin
    .from('webstore_showcase_assets')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('generation_request_id', requestId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const provided = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
  const expected = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || !safeEqualStr(provided, expected)) return reply(401, { error: 'Internal authorization required' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON body' }); }
  const assetId = String(body.asset_id || '');
  const requestId = String(body.generation_request_id || '');
  if (!UUID_RE.test(assetId) || !UUID_RE.test(requestId)) return reply(400, { error: 'Valid job identifiers required' });

  const admin = getSupabaseAdmin();
  let job;
  try {
    job = await loadJob(admin, assetId, requestId);
    if (!job) return reply(202, { ok: true, stale: true });
    if (job.asset.status !== 'queued') return reply(202, { ok: true, skipped: true });

    const started = await conditionalUpdate(admin, assetId, requestId, {
      status: 'generating',
      approval_status: 'pending',
      generation_started_at: new Date().toISOString(),
      error_details: null,
    });
    if (!started) return reply(202, { ok: true, stale: true });

    const sourceUrl = job.wp.image_url || job.product.image_front_url || job.asset.standard_image_url;
    if (!sourceUrl) throw new Error('A Standard source image is required before generation');
    const referenceUrls = artworkUrls(job.wp.decorations, job.store.store_art);
    const images = await Promise.all([sourceUrl, ...referenceUrls].map((url) => fetchRemoteImage(url)));

    const kimi = await analyzeWithKimi({
      product: job.product,
      decorations: job.wp.decorations,
      images,
    });
    const generated = await generateWithOpenAI({
      product: job.product,
      decorations: job.wp.decorations,
      images,
      analysis: kimi.analysis,
    });

    const objectPath = [
      job.asset.store_id,
      job.asset.webstore_product_id,
      `${Date.now()}-${crypto.randomUUID()}.png`,
    ].join('/');
    const upload = await admin.storage
      .from('showcase-images')
      .upload(objectPath, generated.bytes, {
        contentType: generated.contentType,
        cacheControl: '31536000',
        upsert: false,
      });
    if (upload.error) throw new Error(`Permanent image upload failed: ${upload.error.message}`);
    const { data: publicData } = admin.storage.from('showcase-images').getPublicUrl(objectPath);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) throw new Error('Permanent image URL was not created');

    const saved = await conditionalUpdate(admin, assetId, requestId, {
      status: 'review',
      approval_status: 'pending',
      fallback_to_standard: true,
      standard_image_url: sourceUrl,
      showcase_image_url: publicUrl,
      provider: 'openai',
      provider_model: generated.model,
      analysis_provider: 'moonshot',
      analysis_model: kimi.model,
      provider_job_id: generated.providerJobId || kimi.providerJobId,
      prompt_version: PROMPT_VERSION,
      prompt: generated.prompt,
      analysis: kimi.analysis,
      qa_result: {
        human_review_required: true,
        exact_artwork_verified: false,
        protected_branding_verified: false,
        checklist: kimi.analysis?.qa_checklist || [],
      },
      error_details: null,
      generated_at: new Date().toISOString(),
    });
    if (!saved) return reply(202, { ok: true, stale: true });
    try {
      await notifyShowcaseReady(admin, job.asset.store_id, getTrustedSiteBaseUrl(event));
    } catch (emailError) {
      console.error('[showcase-image-background] review email failed', emailError);
    }
    return reply(200, { ok: true, status: 'review' });
  } catch (e) {
    console.error('[showcase-image-background]', assetId, e);
    try {
      await conditionalUpdate(admin, assetId, requestId, {
        status: 'failed',
        approval_status: 'pending',
        error_details: String(e.message || e).slice(0, 1200),
      });
    } catch (updateError) {
      console.error('[showcase-image-background] failed to record error', updateError);
    }
    try {
      if (job?.asset?.store_id) {
        await notifyShowcaseReady(admin, job.asset.store_id, getTrustedSiteBaseUrl(event));
      }
    } catch (emailError) {
      console.error('[showcase-image-background] review email failed after generation error', emailError);
    }
    return reply(500, { error: 'Showcase image generation failed' });
  }
};

module.exports.loadJob = loadJob;
module.exports.conditionalUpdate = conditionalUpdate;
