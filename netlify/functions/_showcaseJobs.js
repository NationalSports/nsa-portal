const QUEUE_START_TIMEOUT_MS = 2 * 60 * 1000;
// Longer than Netlify's 15-minute background execution limit. An abandoned job
// cannot still have an active worker by the time we expose Generate again.
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

function stalledJobMessage(asset, now = Date.now()) {
  const queued = asset.status === 'queued';
  if (!queued && asset.status !== 'generating') return null;
  const since = Date.parse(queued ? asset.updated_at : asset.generation_started_at || asset.updated_at);
  const timeout = queued ? QUEUE_START_TIMEOUT_MS : GENERATION_TIMEOUT_MS;
  if (!Number.isFinite(since) || now - since < timeout) return null;
  return queued
    ? 'Generation did not start. Click Generate to retry.'
    : 'Generation timed out. Click Generate to retry.';
}

async function expireStalledJobs(admin, rows, now = Date.now()) {
  return Promise.all(rows.map(async (asset) => {
    const error_details = stalledJobMessage(asset, now);
    if (!error_details) return asset;
    const { data, error } = await admin.from('webstore_showcase_assets')
      .update({ status: 'failed', error_details, generation_request_id: null, updated_at: new Date(now).toISOString() })
      .eq('id', asset.id).eq('status', asset.status).eq('updated_at', asset.updated_at)
      .select('*').maybeSingle();
    if (error) throw new Error(error.message);
    // Another worker or rep won the race: never overwrite their result.
    return data || asset;
  }));
}

async function dispatchShowcaseJob(baseUrl, asset) {
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Internal worker authorization is not configured');
  const response = await fetch(`${baseUrl}/.netlify/functions/showcase-image-background`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ asset_id: asset.id, generation_request_id: asset.generation_request_id }),
  });
  // A successful HTML fallback/redirect is not a background-job acknowledgement.
  if (response.status !== 202) throw new Error(`worker returned HTTP ${response.status}`);
}

async function recordDispatchFailure(admin, asset, error) {
  const result = await admin.from('webstore_showcase_assets')
    .update({ status: 'failed', generation_request_id: null,
      error_details: `Unable to start background worker: ${error.message}`, updated_at: new Date().toISOString() })
    .eq('id', asset.id).eq('generation_request_id', asset.generation_request_id).eq('status', 'queued');
  if (result.error) throw new Error(result.error.message);
}

module.exports = { stalledJobMessage, expireStalledJobs, dispatchShowcaseJob, recordDispatchFailure };
