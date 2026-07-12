// Top Star digitizing vendor portal — action-routed feed + upload/complete for the
// ONE outside digitizing house (Top Star) that turns approved embroidery art into a
// production-ready .DST. Mirrors teamshop-art.js's action-routing shape.
//
// Auth: a single static token (VENDOR_DIGITIZING_TOKEN), sent as the x-vendor-token
// header or ?token= — same trust level as EMB_MACHINE_TOKEN (emb-machine-manifest.js)
// and PROD_SCAN_TOKEN (job-scan.js): a shop device / outside vendor, not a user, so a
// shared token is the right level. 503 if the env var is unset (endpoint stays closed
// rather than exposing the feed by accident), 401 on a mismatch.
//
// The vendor NEVER touches Supabase directly — every response is hand-curated here,
// server-side, and is money-free / customer-PII-free (same philosophy as job-scan.js's
// fetchJobDetail): so_id/job_id/art_name/positions/units/garment sku+name+color+sizes
// and pre-production art file links only. nsa_cost / retail_price / unit_sell /
// customer name/address never leave this function.
//
// POST { action: 'list' | 'upload' | 'complete', ... }
//
// list — no body beyond action. Queue predicate: so_jobs where
//   deco_type='embroidery' AND art_status='upload_emb_files' AND
//   digitizing_vendor='topstar' AND digitizing_sent_at IS NOT NULL.
//   Joins so_art_files (pre-production `files` — the art to download, never
//   `prod_files`) and so_items (sku/name/color/sizes ONLY — no cost columns).
//
// upload { so_id, job_id, file_url, file_name } — the vendor has already uploaded the
//   DST to Cloudinary client-side (unsigned preset, same as OrderEditor's dstUploadModal)
//   and hands us the resulting secure_url. Re-validates the job is STILL in the queue
//   predicate (art_status may have moved since the vendor's queue was fetched), appends
//   {url,name} to the target art id's so_art_files.prod_files, then re-implements
//   OrderEditor's _autoCompleteEmbAfterUpload (~L2429) server-side: once every live art
//   id on the job carries a DST, so_jobs.art_status flips to 'art_complete'.
//
// complete { so_id, job_id } — requires at least one DST already present on the job's
//   art, then calls advance_job_stage with event 'digitizing_received' (an
//   annotation-only event per migration 00192 — it does NOT touch prod_status). Actor
//   is the fixed string 'vendor:topstar'.
const { corsHeaders, getSupabaseAdmin } = require('./_shared');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error }) });
const ok = (data) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, ...data }) });

// Mirror of fileName/fileUrl/isDstFile from src/constants.js — duplicated because the
// functions runtime is CommonJS and can't import the ESM constants module (same
// duplication note as emb-machine-manifest.js).
const fileName = (f) => {
  if (f && typeof f === 'object' && f.name) return f.name;
  const s = typeof f === 'string' ? f : (f && f.url) || '';
  if (!s) return '';
  try { return decodeURIComponent(s.split('/').pop().split('?')[0]); }
  catch { return s.split('/').pop().split('?')[0]; }
};
const fileUrl = (f) => (typeof f === 'string' ? f : (f && f.url) || '');
const isDst = (f) => fileName(f).toLowerCase().endsWith('.dst');

function checkAuth(event) {
  const token = process.env.VENDOR_DIGITIZING_TOKEN;
  if (!token) return { ok: false, status: 503, error: 'VENDOR_DIGITIZING_TOKEN not configured' };
  const presented = event.headers?.['x-vendor-token'] || event.queryStringParameters?.token;
  if (presented !== token) return { ok: false, status: 401, error: 'Bad or missing vendor token' };
  return { ok: true };
}

// Live art ids for a job — mirrors jobLiveArtIds' fallback shape (_art_ids, else the
// single art_file_id), filtered of the unassigned '__tbd' sentinel.
function jobArtIds(job) {
  const ids = Array.isArray(job._art_ids) && job._art_ids.length ? job._art_ids : [job.art_file_id];
  return ids.filter((id) => id && id !== '__tbd');
}

// Load one job plus both queue-predicate readings: `inQueue` is the FULL predicate
// (still exactly what the vendor's list shows); `isTopstarJob` drops the art_status
// leg so 'complete' still works after an upload has already auto-flipped art_status
// to 'art_complete' (the normal, expected order of events).
async function fetchJobForVendor(admin, soId, jobId) {
  const { data: job, error } = await admin.from('so_jobs')
    .select('id, so_id, art_file_id, _art_ids, art_name, deco_type, art_status, digitizing_vendor, digitizing_sent_at, positions, total_units, digitizing_due_at, items')
    .eq('so_id', soId).eq('id', jobId).maybeSingle();
  if (error) throw error;
  if (!job) return { job: null, isTopstarJob: false, inQueue: false };
  const isTopstarJob = job.deco_type === 'embroidery' && job.digitizing_vendor === 'topstar' && !!job.digitizing_sent_at;
  const inQueue = isTopstarJob && job.art_status === 'upload_emb_files';
  return { job, isTopstarJob, inQueue };
}

async function fetchQueueJobs(admin) {
  const { data, error } = await admin.from('so_jobs')
    .select('id, so_id, art_file_id, _art_ids, art_name, positions, total_units, digitizing_due_at, items')
    .eq('deco_type', 'embroidery')
    .eq('art_status', 'upload_emb_files')
    .eq('digitizing_vendor', 'topstar')
    .not('digitizing_sent_at', 'is', null);
  if (error) throw error;
  return data || [];
}

async function handleList(admin) {
  const jobs = await fetchQueueJobs(admin);
  if (!jobs.length) return ok({ jobs: [] });

  const soIds = [...new Set(jobs.map((j) => j.so_id).filter(Boolean))];
  const [{ data: arts, error: aErr }, { data: items, error: iErr }] = await Promise.all([
    admin.from('so_art_files').select('so_id, id, files').in('so_id', soIds),
    admin.from('so_items').select('so_id, item_index, sku, name, color, sizes').in('so_id', soIds),
  ]);
  if (aErr) throw aErr;
  if (iErr) throw iErr;
  const artByKey = new Map((arts || []).map((a) => [a.so_id + '|' + a.id, a]));
  const itemsBySo = new Map();
  (items || []).forEach((it) => {
    if (!itemsBySo.has(it.so_id)) itemsBySo.set(it.so_id, []);
    itemsBySo.get(it.so_id).push(it);
  });

  const result = jobs.map((j) => {
    const artIds = jobArtIds(j);
    const artFiles = [];
    const seen = new Set();
    for (const aid of artIds) {
      const art = artByKey.get(j.so_id + '|' + aid);
      if (!art) continue;
      for (const f of (art.files || [])) {
        const url = fileUrl(f);
        const name = fileName(f);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        artFiles.push({ name, url });
      }
    }
    const itemIdxs = new Set((Array.isArray(j.items) ? j.items : []).map((it) => it.item_idx));
    const garment = (itemsBySo.get(j.so_id) || [])
      .filter((it) => itemIdxs.has(it.item_index))
      .map((it) => ({ sku: it.sku || '', name: it.name || '', color: it.color || '', sizes: it.sizes || {} }));

    // Deliberately no money/customer fields — vendor-facing.
    return {
      so_id: j.so_id,
      job_id: j.id,
      art_name: j.art_name || '',
      positions: j.positions || null,
      total_units: j.total_units || 0,
      digitizing_due_at: j.digitizing_due_at || null,
      garment,
      art_files: artFiles,
    };
  });
  return ok({ jobs: result });
}

async function handleUpload(admin, body) {
  const soId = String(body.so_id || '').trim();
  const jobId = String(body.job_id || '').trim();
  const uploadedUrl = String(body.file_url || '').trim();
  if (!soId || !jobId) return bad(400, 'so_id and job_id required');
  if (!uploadedUrl) return bad(400, 'file_url required');
  if (!/^https:\/\//i.test(uploadedUrl)) return bad(400, 'file_url must be an https URL');
  const uploadedName = String(body.file_name || '').trim() || fileName(uploadedUrl);

  const { job, inQueue } = await fetchJobForVendor(admin, soId, jobId);
  if (!job) return bad(404, 'Job not found');
  if (!inQueue) return bad(409, 'Job is no longer in the digitizing queue');

  const artIds = jobArtIds(job);
  if (!artIds.length) return bad(409, 'Job has no art to attach to');

  const { data: arts, error: aErr } = await admin.from('so_art_files')
    .select('id, deco_type, status, files, prod_files, prod_files_attached')
    .eq('so_id', soId).in('id', artIds);
  if (aErr) return bad(500, aErr.message);
  const artByKey = new Map((arts || []).map((a) => [a.id, a]));

  const hasDst = (a) => [...(a.files || []), ...(a.prod_files || [])].some(isDst);

  // "The matching art id" — the first live art id that doesn't already carry a DST
  // (falls back to the first art id if every one already has one, so a re-upload
  // still lands somewhere sane).
  const targetId = artIds.find((id) => { const a = artByKey.get(id); return a && !hasDst(a); }) || artIds[0];
  const target = artByKey.get(targetId);
  if (!target) return bad(409, 'Art file not found for this job');

  const patch = { prod_files: [...(target.prod_files || []), { url: uploadedUrl, name: uploadedName }] };
  // Mirror OrderEditor's _autoCompleteEmbAfterUpload: an approved embroidery design
  // that now carries a DST is confirmed, same as the rep-side upload flow.
  if ((target.deco_type || '') === 'embroidery' && target.status === 'approved' && target.prod_files_attached !== true) {
    patch.prod_files_attached = true;
  }
  const { error: uErr } = await admin.from('so_art_files').update(patch).eq('so_id', soId).eq('id', targetId);
  if (uErr) return bad(500, uErr.message);

  // Recompute this job's completion from the just-written snapshot — once every live
  // art id is confirmed, flip art_status to 'art_complete' (drops it out of the queue).
  const updatedArts = new Map(artByKey);
  updatedArts.set(targetId, { ...target, ...patch });
  const allReady = artIds.every((id) => {
    const a = updatedArts.get(id);
    if (!a) return false;
    if (a.prod_files_attached === true) return true;
    if ((a.deco_type || '') !== 'embroidery') return false;
    return hasDst(a);
  });
  let autoCompleted = false;
  if (allReady) {
    const { error: jErr } = await admin.from('so_jobs')
      .update({ art_status: 'art_complete' }).eq('so_id', soId).eq('id', jobId).eq('art_status', 'upload_emb_files');
    if (!jErr) autoCompleted = true;
  }
  return ok({ uploaded: true, auto_completed: autoCompleted });
}

async function handleComplete(admin, body) {
  const soId = String(body.so_id || '').trim();
  const jobId = String(body.job_id || '').trim();
  if (!soId || !jobId) return bad(400, 'so_id and job_id required');

  const { job, isTopstarJob } = await fetchJobForVendor(admin, soId, jobId);
  if (!job) return bad(404, 'Job not found');
  if (!isTopstarJob) return bad(403, 'Job is not assigned to this vendor');

  const artIds = jobArtIds(job);
  if (!artIds.length) return bad(409, 'Job has no art files');
  const { data: arts, error: aErr } = await admin.from('so_art_files')
    .select('id, files, prod_files').eq('so_id', soId).in('id', artIds);
  if (aErr) return bad(500, aErr.message);
  const hasAnyDst = (arts || []).some((a) => [...(a.files || []), ...(a.prod_files || [])].some(isDst));
  if (!hasAnyDst) return bad(409, 'No DST uploaded yet — upload the digitized file before marking complete');

  const { data, error } = await admin.rpc('advance_job_stage', {
    p_so_id: soId,
    p_job_id: jobId,
    p_event: 'digitizing_received',
    p_actor: 'vendor:topstar',
    p_expected: null,
    p_payload: {},
  });
  if (error) return bad(500, error.message);
  return ok({ completed: true, result: data });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  const auth = checkAuth(event);
  if (!auth.ok) return bad(auth.status, auth.error);

  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return bad(400, 'Invalid JSON'); }

  try {
    if (body.action === 'list') return await handleList(admin);
    if (body.action === 'upload') return await handleUpload(admin, body);
    if (body.action === 'complete') return await handleComplete(admin, body);
    return bad(400, 'Unknown action');
  } catch (e) {
    return bad(500, e.message || 'Server error');
  }
};

// Exported for tests (src/__tests__/vendorDigitizing.test.js).
module.exports.jobArtIds = jobArtIds;
module.exports.checkAuth = checkAuth;
