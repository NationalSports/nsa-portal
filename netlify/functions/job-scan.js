// job-scan — resolve a scanned shop-floor code to a production job and advance
// its stage through the advance_job_stage RPC (migration 00192), source:'scan'.
//
// Auth (two trust levels, like emb-machine-manifest.js but a SEPARATE token so
// this can't weaken the embroidery feed's):
//   * staff phones send a Bearer JWT (verifyUser → active team member);
//   * unattended scan stations present PROD_SCAN_TOKEN (x-machine-token header
//     or ?token=). If neither is set/valid → 401.
// The advance_job_stage RPC is itself guarded (staff-or-service-role), so this
// function calls it with the service key after doing its own gate.
//
// Body: { code, event, actor?, so_id?, job_id?, expected?, payload? }
//   code    — the scanned string (DST filename, DG-####, or BX-#### box plate)
//   event   — one of the advance_job_stage events (release, start_run, decorated, …)
//   so_id   — optional: scope the job index to one SO (faster; disambiguates)
//   job_id  — optional: required when a box scan maps to more than one active job
//   expected — optional prod_status the scanner believes the job is in (optimistic guard)
const { createClient } = require('@supabase/supabase-js');
const { verifyUser } = require('./_shared');
const { resolveScan, isDst, dgCodeOf } = require('./_jobScanResolver');

const VALID_EVENTS = new Set([
  'release', 'start_run', 'decorated', 'packed', 'art_resolved',
  'digitizing_sent', 'digitizing_received', 'goods_received', 'po_evaluated', 'hold',
]);

// prod_status values that count as an "active" job worth indexing for a scan.
const ACTIVE_STATUSES = ['hold', 'ready', 'staging', 'in_process', 'completed'];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-machine-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}
const fileName = (f) => {
  if (f && typeof f === 'object' && f.name) return f.name;
  const s = typeof f === 'string' ? f : (f && f.url) || '';
  if (!s) return '';
  try { return decodeURIComponent(s.split('/').pop().split('?')[0]); }
  catch { return s.split('/').pop().split('?')[0]; }
};

// Build the { jobs, boxes } index the resolver needs, from so_jobs + so_art_files
// (+ boxes for BX plates). Optionally scoped to one SO.
async function buildIndex(db, soId) {
  let jq = db.from('so_jobs')
    .select('id, so_id, art_file_id, _art_ids, art_name, deco_type, prod_status')
    .in('prod_status', ACTIVE_STATUSES);
  if (soId) jq = jq.eq('so_id', soId);
  const { data: jobs, error: jErr } = await jq;
  if (jErr) throw jErr;

  const soIds = [...new Set((jobs || []).map((j) => j.so_id).filter(Boolean))];
  let arts = [];
  if (soIds.length) {
    const { data, error } = await db.from('so_art_files')
      .select('so_id, id, name, files, prod_files')
      .in('so_id', soIds);
    if (error) throw error;
    arts = data || [];
  }
  const artByKey = new Map(arts.map((a) => [a.so_id + '|' + a.id, a]));

  const jobIndex = (jobs || []).map((j) => {
    const artIds = (Array.isArray(j._art_ids) && j._art_ids.length ? j._art_ids : [j.art_file_id]).filter(Boolean);
    const dstNames = new Set();
    const dgCodes = new Set();
    for (const aid of artIds) {
      const art = artByKey.get(j.so_id + '|' + aid);
      if (!art) continue;
      for (const f of [...(art.prod_files || []), ...(art.files || [])]) {
        const name = fileName(f);
        if (isDst(name)) dstNames.add(name);
        const dg = dgCodeOf(name);
        if (dg) dgCodes.add(dg);
      }
      const artDg = dgCodeOf(art.name) || dgCodeOf(j.art_name);
      if (artDg) dgCodes.add(artDg);
    }
    return { so_id: j.so_id, job_id: j.id, art_name: j.art_name || '', dstNames: [...dstNames], dgCodes: [...dgCodes] };
  });

  let boxes = [];
  const boxScope = soIds.length ? soIds : (soId ? [soId] : null);
  try {
    let bq = db.from('boxes').select('id, so_id, contents');
    if (boxScope) bq = bq.in('so_id', boxScope);
    const { data } = await bq;
    boxes = data || [];
  } catch (_) { boxes = []; } // boxes table (00185) may not be applied yet

  return { jobs: jobIndex, boxes };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  // ── Auth: machine token OR staff JWT ──
  let actor = 'scan';
  let authed = false;
  const stationToken = process.env.PROD_SCAN_TOKEN;
  const presented = event.headers?.['x-machine-token'] || event.queryStringParameters?.token;
  if (stationToken && presented && presented === stationToken) {
    authed = true;
    actor = 'station';
  }
  if (!authed) {
    try {
      const v = await verifyUser(event);
      if (v && v.ok) { authed = true; actor = 'staff:' + v.teamMemberId; }
    } catch (_) { /* fall through to 401 */ }
  }
  if (!authed) {
    return { statusCode: 401, headers: cors(), body: JSON.stringify({ ok: false, error: 'Not authorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, error: 'Bad JSON' }) }; }

  const code = String(body.code || '').trim();
  const evt = String(body.event || '').trim();
  if (!code) return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, error: 'code required' }) };
  if (!VALID_EVENTS.has(evt)) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, error: 'invalid event' }) };
  }
  if (body.actor) actor = String(body.actor);

  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ ok: false, error: 'Supabase service credentials missing' }) };
  }
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const index = await buildIndex(db, body.so_id ? String(body.so_id) : null);
    const res = resolveScan(code, index);
    if (!res.ok) {
      // ambiguous / not found — 409 so the scanner can prompt for disambiguation.
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ ok: false, resolution: res }) };
    }

    let soId = res.so_id;
    let jobId = res.job_id;
    if (res.kind === 'box') {
      // A box maps to an SO; pick the job explicitly (body) or a single active job.
      jobId = body.job_id ? String(body.job_id) : null;
      if (!jobId) {
        const onSo = index.jobs.filter((j) => j.so_id === soId);
        if (onSo.length === 1) jobId = onSo[0].job_id;
        else {
          return {
            statusCode: 409, headers: cors(),
            body: JSON.stringify({ ok: false, reason: 'box_needs_job', resolution: res, jobs: onSo.map((j) => ({ so_id: j.so_id, job_id: j.job_id, art_name: j.art_name })) }),
          };
        }
      }
    }
    if (body.job_id) jobId = String(body.job_id); // explicit override always wins
    if (body.so_id) soId = String(body.so_id);

    const payload = { ...(body.payload && typeof body.payload === 'object' ? body.payload : {}), source: 'scan', scanned_code: code };
    const { data, error } = await db.rpc('advance_job_stage', {
      p_so_id: soId,
      p_job_id: jobId,
      p_event: evt,
      p_actor: actor,
      p_expected: body.expected ? String(body.expected) : null,
      p_payload: payload,
    });
    if (error) {
      // Surface NSA_STALE_STATE:* / NSA_NOT_FOUND:* etc. as a 409 the scanner can show.
      const msg = error.message || 'RPC error';
      const status = /NSA_STALE_STATE|NSA_NOT_FOUND|NSA_FORBIDDEN|NSA_BAD_INPUT/.test(msg) ? 409 : 500;
      return { statusCode: status, headers: cors(), body: JSON.stringify({ ok: false, error: msg, resolution: res }) };
    }
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, resolution: res, result: data }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ ok: false, error: e.message || 'Server error' }) };
  }
};
