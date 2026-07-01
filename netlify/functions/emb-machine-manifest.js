// emb-machine-manifest — read-only feed of embroidery designs that should be
// loaded on the machine right now. The shop-floor "machine bridge" (a Raspberry
// Pi in USB-gadget mode, see /machine-bridge) polls this, downloads any DST it
// doesn't already have onto its virtual USB drive, and drops designs that are no
// longer here. The DST file name is the source of truth: it's what the
// production-sheet barcode encodes and what the machine's USB search matches.
//
// Auth: a single shared token (EMB_MACHINE_TOKEN) sent as the x-machine-token
// header or ?token=. It's a shop device, not a user — a static token is the
// right trust level. If the env var is unset the endpoint stays closed (503)
// rather than exposing the feed by accident.
const { createClient } = require('@supabase/supabase-js');

// Which prod_status values count as "on or headed to the machine". Defaults to
// the in-line + running columns; override per-request with ?statuses=a,b,c.
const DEFAULT_STATUSES = ['staging', 'in_process'];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-machine-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    // The Pi re-polls frequently; never let a CDN serve it a stale machine list.
    'Cache-Control': 'no-store',
  };
}

// Mirror of dgCodeOf / isDstFile from src/constants.js — duplicated because the
// functions runtime is CommonJS and can't import the ESM constants module.
const dgCodeOf = (name) => {
  const m = String(name || '').match(/DG[-_ ]?(\d{4,})/i);
  return m ? 'DG' + m[1] : null;
};
const fileName = (f) => {
  if (f && typeof f === 'object' && f.name) return f.name;
  const s = typeof f === 'string' ? f : (f && f.url) || '';
  if (!s) return '';
  try { return decodeURIComponent(s.split('/').pop().split('?')[0]); } catch { return s.split('/').pop().split('?')[0]; }
};
const fileUrl = (f) => (typeof f === 'string' ? f : (f && f.url) || '');
const isDst = (f) => fileName(f).toLowerCase().endsWith('.dst');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };

  const token = process.env.EMB_MACHINE_TOKEN;
  if (!token) {
    return { statusCode: 503, headers: cors(), body: JSON.stringify({ error: 'EMB_MACHINE_TOKEN not configured' }) };
  }
  const presented = event.headers?.['x-machine-token'] || event.queryStringParameters?.token;
  if (presented !== token) {
    return { statusCode: 401, headers: cors(), body: JSON.stringify({ error: 'Bad or missing machine token' }) };
  }

  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Supabase service credentials missing' }) };
  }
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const statuses = (event.queryStringParameters?.statuses || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const wantStatuses = statuses.length ? statuses : DEFAULT_STATUSES;
    const machineFilter = event.queryStringParameters?.machine || null;

    // 1. Active embroidery jobs.
    let jq = db.from('so_jobs')
      .select('id, so_id, art_file_id, _art_ids, art_name, deco_type, prod_status, total_units, assigned_machine')
      .eq('deco_type', 'embroidery')
      .in('prod_status', wantStatuses);
    if (machineFilter) jq = jq.eq('assigned_machine', machineFilter);
    const { data: jobs, error: jErr } = await jq;
    if (jErr) throw jErr;

    if (!jobs || jobs.length === 0) {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ generated_at: new Date().toISOString(), count: 0, designs: [] }) };
    }

    // 2. Their art files (art ids are unique only within a sales order, so key by so_id|id).
    const soIds = [...new Set(jobs.map(j => j.so_id).filter(Boolean))];
    const { data: arts, error: aErr } = await db
      .from('so_art_files')
      .select('so_id, id, name, files, prod_files')
      .in('so_id', soIds);
    if (aErr) throw aErr;
    const artByKey = new Map((arts || []).map(a => [a.so_id + '|' + a.id, a]));

    // 3. Pull every DST off each job's art, de-duped by file name (one physical
    //    design = one slot on the machine, even if several jobs reuse it).
    const byName = new Map();
    for (const j of jobs) {
      const artIds = (Array.isArray(j._art_ids) && j._art_ids.length ? j._art_ids : [j.art_file_id]).filter(Boolean);
      for (const aid of artIds) {
        const art = artByKey.get(j.so_id + '|' + aid);
        if (!art) continue;
        for (const f of [...(art.prod_files || []), ...(art.files || [])]) {
          if (!isDst(f)) continue;
          const name = fileName(f);
          const dlUrl = fileUrl(f);
          if (!name || !dlUrl) continue;
          const dedupe = name.toUpperCase();
          if (byName.has(dedupe)) continue;
          byName.set(dedupe, {
            dst_name: name,
            dg: dgCodeOf(name),
            url: dlUrl,
            job_id: j.id,
            so_id: j.so_id,
            art_name: j.art_name || art.name || '',
            prod_status: j.prod_status,
            assigned_machine: j.assigned_machine || null,
          });
        }
      }
    }

    const designs = [...byName.values()];
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ generated_at: new Date().toISOString(), count: designs.length, designs }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: e.message || 'Server error' }) };
  }
};
