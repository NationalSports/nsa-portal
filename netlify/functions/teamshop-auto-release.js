// Team Shop / Club — auto-release sweep (automation trio #2).
//
// Scheduled ~every 15 min (netlify.toml [functions."teamshop-auto-release"]).
// Finds so_jobs on teamshop/club SOs sitting at prod_status='hold' whose readiness
// can be PROVEN by a server-side recompute, and releases each through
// advance_job_stage('release', …) — the SAME 00205 gate a staff scan uses. It NEVER
// writes prod_status directly and never weakens the gate: it makes item_status
// TRUE first, then lets the gate re-verify and move the job.
//
// Why a server recompute (do NOT trust item_status): so_jobs.item_status is
// client-computed advisory — no trigger/RPC recomputes it from pick/PO state (00205
// header documents this). This sweep is exactly the "future auto-release sweep" 00205
// pointed at. It re-derives both halves of businessLogic.isJobReady server-side:
//
//   ART GATE — art_status='art_complete' AND every referenced art record that we can
//   find is production-ready (isJobReady's art half: prod_files_attached OR prod_files
//   non-empty OR embroidery .dst among files/prod_files). Missing records are skipped,
//   exactly like isJobReady (`if (!af) continue`). The art record is looked up in a
//   POOL of BOTH so_art_files (staff-attached art for the SO) AND the SO customer's
//   customers.art_files — because trio #1's auto-arted jobs reference customers.art_files
//   and create NO so_art_files row (see 00207). art_status itself is server-persisted
//   (not the advisory field), so trusting it + re-verifying present art records is sound;
//   a false-positive auto-art recalled by staff flips art_status off and is excluded here.
//
//   FULFILLMENT GATE — CONSERVATIVE SUBSET of allocateJobFulfillment. The full client
//   logic apportions receipts within split families (a parent and its split slices
//   partition one line's units). Re-deriving that server-side is intricate, so this
//   sweep instead requires the job's items to be FULLY in hand: for every (item, size)
//   the job covers, pulled(status='pulled') + received >= ordered. Full receipt is
//   strictly SAFE (if the whole line is in hand, every job on it — parent or slice — is
//   covered) and never over-releases; it is only CONSERVATIVE — it may decline a job
//   that a partial-receipt apportionment would have allowed. For freshly-converted
//   teamshop/club jobs (the trio's target) there are no splits, so this coincides with
//   the exact computation; the conservatism only bites the 'all' scope after staff split
//   a job. Documented so a reviewer knows this is a deliberate under-release, not a bug.
//
// For each ready job: UPDATE item_status to the recomputed truth ('items_received'),
// then advance_job_stage('release', actor='auto-release', payload {source:'auto_release'}).
//
// Gated by teamshop_settings (00208): auto_release_enabled (default FALSE) and
// auto_release_scope ('auto_art_only' = only jobs born art_complete via trio #1's
// auto-art, identified by their 'created' event; 'all' = any ready hold job).
//
// NEVER throws: every job is independently try/caught and the handler always returns
// 200 with a summary. Scheduled invocation runs with no auth (same posture as
// teamshop-stuck-sweep.js / other scheduled functions); manual re-run is a
// staff-authenticated POST { action:'run' }.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const SOURCES = ['teamshop', 'club'];
const RELEASE_LIMIT = 200;
const AUTO_ACTOR = 'auto-release';

const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const isMissingRelation = (e) => {
  if (!e) return false;
  const code = e.code || '';
  const msg = (e.message || '') + ' ' + (e.details || '') + ' ' + (e.hint || '');
  return code === '42P01' || code === '42703' || code === '42883' || /does not exist|could not find|schema cache/i.test(msg);
};

// ── Pure readiness recompute (unit-tested directly) ──────────────────────────
function hasDst(files) {
  return (files || []).some((f) => {
    const n = (typeof f === 'string' ? f : (f && (f.name || f.url)) || '').toLowerCase();
    return n.endsWith('.dst');
  });
}

// isJobReady's art half for ONE art record (so_art_files row OR customers.art_files
// entry — same field names on both). Returns true/false; caller skips a null record.
function artRecordProdReady(af) {
  if (!af) return false;
  if (af.prod_files_attached === true) return true;
  if (Array.isArray(af.prod_files) && af.prod_files.length > 0) return true;
  if ((af.deco_type || '') === 'embroidery' && hasDst([...(af.files || []), ...(af.prod_files || [])])) return true;
  return false;
}

// Server-side referenced art ids: the job's stored _art_ids ∪ art_file_id. (Unlike
// the client's jobLiveArtIds, we don't read deco.art_file_id — teamshop/club decos
// carry none; the job's stored ids are the honest server source.)
function jobArtIds(job) {
  const ids = [];
  const push = (id) => { const s = (id == null ? '' : String(id)); if (s && s !== '__tbd' && !ids.includes(s)) ids.push(s); };
  (Array.isArray(job._art_ids) ? job._art_ids : []).forEach(push);
  push(job.art_file_id);
  return ids;
}

// Art gate: art_complete AND every FOUND referenced art record is prod-ready.
// artLookup(id) -> record | null (pools so_art_files for the SO + the SO customer's
// customers.art_files). Unknown ids are skipped (isJobReady parity).
function jobArtReady(job, artLookup) {
  if (job.art_status !== 'art_complete') return false;
  for (const id of jobArtIds(job)) {
    const af = artLookup(id);
    if (!af) continue;
    if (artRecordProdReady(af) !== true) return false;
  }
  return true;
}

// Fulfillment gate (conservative full-receipt). ctx:
//   itemForIndex(itemIdx) -> { id, sizes, est_qty } | null
//   pulledFor(itemId, size) / receivedFor(itemId, size) -> number
// Returns { total, fulfilled, itemStatus, fullyReceived }.
function jobFulfillment(job, ctx) {
  let total = 0;
  let fulfilled = 0;
  let itemsOk = true;
  for (const gi of (job.items || [])) {
    const it = ctx.itemForIndex(gi.item_idx);
    if (!it) { itemsOk = false; continue; }
    const src = (gi.sizes && Object.keys(gi.sizes).length > 0) ? gi.sizes : (it.sizes || {});
    let entries = Object.entries(src).filter(([, v]) => Number(v) > 0);
    if (entries.length === 0 && Number(it.est_qty) > 0) entries = [['QTY', Number(it.est_qty)]];
    for (const [sz, v] of entries) {
      const need = Number(v) || 0;
      total += need;
      const inhand = ctx.pulledFor(it.id, sz) + ctx.receivedFor(it.id, sz);
      fulfilled += Math.min(need, inhand);
    }
  }
  const fullyReceived = itemsOk && total > 0 && fulfilled >= total;
  const itemStatus = fullyReceived ? 'items_received' : fulfilled > 0 ? 'partially_received' : 'need_to_order';
  return { total, fulfilled, itemStatus, fullyReceived: !!fullyReceived };
}

// DTF prints gate (00212): a DTF job is not releasable until its transfer prints
// are physically in hand. so_jobs.dtf_prints_status is the signal
// teamshop-auto-po writes ('needed' → 'ordered' → 'received'); only 'received'
// frees the job. A deco_type='dtf' job ALWAYS needs prints, so it's held even when
// its status is still null — the DTF lane may not have recorded the need yet, and
// auto-release must never release a DTF job before prints are proven in hand
// (closes the window between conversion and the hourly DTF sweep). Non-DTF jobs
// with no status never block. This lives in the sweep, NOT 00205's SQL gate (which
// stays art+garments only) — a staff scan can still release by hand.
function jobDtfReady(job) {
  const st = job && job.dtf_prints_status;
  if (st) return st === 'received';
  return (job && job.deco_type) !== 'dtf';
}

// A job is auto-releasable when the art, DTF-prints, and fulfillment gates all pass.
function jobReleasable(job, artLookup, ctx) {
  if (!jobArtReady(job, artLookup)) return { ready: false, reason: 'art' };
  if (!jobDtfReady(job)) return { ready: false, reason: 'dtf_prints' };
  const ful = jobFulfillment(job, ctx);
  if (!ful.fullyReceived) return { ready: false, reason: 'fulfillment', ful };
  return { ready: true, ful };
}

// ── Data loading ─────────────────────────────────────────────────────────────
async function loadSettings(admin) {
  const res = await admin.from('teamshop_settings').select('*').limit(1);
  if (res.error) {
    if (isMissingRelation(res.error)) return { enabled: false, error: 'auto-release settings (00208) not applied' };
    return { error: res.error.message };
  }
  const row = (res.data && res.data[0]) || {};
  return {
    autoReleaseEnabled: row.auto_release_enabled === true,
    scope: row.auto_release_scope || 'auto_art_only',
  };
}

async function teamshopClubSoIds(admin) {
  const res = await admin.from('webstore_orders')
    .select('so_id, order_source').in('order_source', SOURCES).not('so_id', 'is', null)
    // Exclude terminated orders. Without this gate a refunded/cancelled order's
    // jobs (still hold + art_complete, never cleaned up) get auto-released into
    // production and decorated — money already returned to the buyer (audit HIGH).
    .not('status', 'in', '(refunded,cancelled,void,disputed,deleted,archived)')
    .limit(5000);
  if (res.error) throw res.error;
  const map = {};
  (res.data || []).forEach((r) => { if (r.so_id) map[r.so_id] = r.order_source; });
  return map;
}

// ── Orchestration ────────────────────────────────────────────────────────────
async function runRelease(admin, actor) {
  const summary = { ok: true, enabled: true, scope: null, candidates: 0, released: [], skipped: [], errors: [] };
  const safe = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) { summary.errors.push({ step: label, error: e.message || String(e) }); return fallback; }
  };

  const settings = await loadSettings(admin);
  if (settings.error && settings.enabled === false) { summary.enabled = false; summary.note = settings.error; return summary; }
  if (settings.error) { summary.ok = false; summary.errors.push({ step: 'settings', error: settings.error }); return summary; }
  summary.scope = settings.scope;
  if (!settings.autoReleaseEnabled) { summary.note = 'auto_release_enabled is false'; return summary; }

  const soIdMap = await safe('so_id_map', () => teamshopClubSoIds(admin), {});
  const soIds = Object.keys(soIdMap);
  if (!soIds.length) return summary;

  // SO -> customer (for the customers.art_files half of the art pool).
  const salesRes = await safe('sales_orders', async () => {
    const r = await admin.from('sales_orders').select('id, customer_id').in('id', soIds);
    if (r.error) throw r.error; return r.data || [];
  }, []);
  const custBySo = {};
  salesRes.forEach((s) => { custBySo[s.id] = s.customer_id; });

  // Candidate jobs: hold + art_complete on these SOs.
  const jobsRes = await safe('so_jobs', async () => {
    const r = await admin.from('so_jobs')
      .select('so_id, id, art_status, item_status, prod_status, art_file_id, _art_ids, items, dtf_prints_status, deco_type')
      .in('so_id', soIds).eq('prod_status', 'hold').eq('art_status', 'art_complete').limit(2000);
    if (r.error) throw r.error; return r.data || [];
  }, []);
  let jobs = jobsRes;

  // Scope: auto_art_only -> keep only jobs BORN art_complete (trio #1 auto-art),
  // identified by their 'created' job_stage_event to_state.art_status.
  if (settings.scope === 'auto_art_only') {
    const bornAutoArt = await safe('created_events', async () => {
      const r = await admin.from('job_stage_events')
        .select('so_id, job_id, to_state, payload').in('so_id', soIds).eq('event', 'created').limit(5000);
      if (r.error) throw r.error;
      const set = new Set();
      (r.data || []).forEach((e) => {
        const bornComplete = e.to_state && e.to_state.art_status === 'art_complete';
        const flagged = e.payload && e.payload.auto_art === true;
        if (bornComplete || flagged) set.add(e.so_id + ' ' + e.job_id);
      });
      return set;
    }, null);
    // If we could not read the events, do NOT release anything in this scope (conservative).
    jobs = bornAutoArt ? jobs.filter((j) => bornAutoArt.has(j.so_id + ' ' + j.id)) : [];
  }
  summary.candidates = jobs.length;
  if (!jobs.length) return summary;

  const candidateSoIds = [...new Set(jobs.map((j) => j.so_id))];

  // ── Art pool: so_art_files (per SO) + customers.art_files (per SO customer) ──
  const soArt = await safe('so_art_files', async () => {
    const r = await admin.from('so_art_files')
      .select('so_id, id, prod_files, prod_files_attached, deco_type, files').in('so_id', candidateSoIds);
    if (r.error) throw r.error; return r.data || [];
  }, []);
  const soArtByKey = {};
  soArt.forEach((a) => { soArtByKey[a.so_id + ' ' + String(a.id)] = a; });

  const custIds = [...new Set(candidateSoIds.map((s) => custBySo[s]).filter(Boolean))];
  const custArt = await safe('customers', async () => {
    if (!custIds.length) return [];
    const r = await admin.from('customers').select('id, art_files').in('id', custIds);
    if (r.error) throw r.error; return r.data || [];
  }, []);
  const custArtByCust = {};
  custArt.forEach((c) => {
    const m = {};
    (Array.isArray(c.art_files) ? c.art_files : []).forEach((a) => { if (a && a.id != null) m[String(a.id)] = a; });
    custArtByCust[c.id] = m;
  });
  const makeArtLookup = (soId) => (id) => {
    const key = String(id);
    if (soArtByKey[soId + ' ' + key]) return soArtByKey[soId + ' ' + key];
    const cust = custBySo[soId];
    return (cust && custArtByCust[cust] && custArtByCust[cust][key]) || null;
  };

  // ── Fulfillment context: so_items + pick/po lines ──
  const items = await safe('so_items', async () => {
    const r = await admin.from('so_items')
      .select('id, so_id, item_index, sizes, est_qty').in('so_id', candidateSoIds);
    if (r.error) throw r.error; return r.data || [];
  }, []);
  const itemBySoIdx = {};
  const itemIds = [];
  items.forEach((it) => { itemBySoIdx[it.so_id + ' ' + it.item_index] = it; itemIds.push(it.id); });

  const picks = itemIds.length ? await safe('pick_lines', async () => {
    const r = await admin.from('so_item_pick_lines').select('so_item_id, sizes, status').in('so_item_id', itemIds);
    if (r.error) throw r.error; return r.data || [];
  }, []) : [];
  const pos = itemIds.length ? await safe('po_lines', async () => {
    const r = await admin.from('so_item_po_lines').select('so_item_id, received').in('so_item_id', itemIds);
    if (r.error) throw r.error; return r.data || [];
  }, []) : [];

  const pulledBy = {};   // so_item_id\0size -> qty (status 'pulled')
  picks.forEach((p) => {
    if (p.status !== 'pulled') return;
    Object.entries(p.sizes || {}).forEach(([sz, q]) => {
      pulledBy[p.so_item_id + ' ' + sz] = (pulledBy[p.so_item_id + ' ' + sz] || 0) + (Number(q) || 0);
    });
  });
  const receivedBy = {}; // so_item_id\0size -> qty
  pos.forEach((po) => {
    Object.entries(po.received || {}).forEach(([sz, q]) => {
      receivedBy[po.so_item_id + ' ' + sz] = (receivedBy[po.so_item_id + ' ' + sz] || 0) + (Number(q) || 0);
    });
  });

  // ── Evaluate + release ──
  for (const job of jobs) {
    if (summary.released.length >= RELEASE_LIMIT) { summary.note = 'release limit reached'; break; }
    try {
      const ctx = {
        itemForIndex: (idx) => itemBySoIdx[job.so_id + ' ' + idx] || null,
        pulledFor: (itemId, sz) => pulledBy[itemId + ' ' + sz] || 0,
        receivedFor: (itemId, sz) => receivedBy[itemId + ' ' + sz] || 0,
      };
      const verdict = jobReleasable(job, makeArtLookup(job.so_id), ctx);
      if (!verdict.ready) { summary.skipped.push({ so_id: job.so_id, job_id: job.id, reason: verdict.reason }); continue; }

      // 1) item_status := recomputed truth (items_received). 2) release via the 00205 gate.
      const upd = await admin.from('so_jobs').update({ item_status: verdict.ful.itemStatus })
        .eq('so_id', job.so_id).eq('id', job.id);
      if (upd.error) { summary.errors.push({ so_id: job.so_id, job_id: job.id, step: 'item_status', error: upd.error.message }); continue; }

      const rpc = await admin.rpc('advance_job_stage', {
        p_so_id: job.so_id,
        p_job_id: job.id,
        p_event: 'release',
        p_actor: AUTO_ACTOR,
        p_payload: { source: 'auto_release' },
      });
      if (rpc.error) {
        summary.errors.push({ so_id: job.so_id, job_id: job.id, step: 'release', error: rpc.error.message });
        continue;
      }
      console.log(`[teamshop-auto-release] released ${job.so_id}/${job.id} (scope=${settings.scope}, actor=${actor || AUTO_ACTOR})`);
      summary.released.push({ so_id: job.so_id, job_id: job.id, total: verdict.ful.total, fulfilled: verdict.ful.fulfilled });
    } catch (e) {
      summary.errors.push({ so_id: job.so_id, job_id: job.id, step: 'evaluate', error: e.message || String(e) });
    }
  }

  console.log(`[teamshop-auto-release] scope=${settings.scope} candidates=${summary.candidates} released=${summary.released.length} skipped=${summary.skipped.length} errors=${summary.errors.length}`);
  return summary;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  const isManual = !!(event && event.httpMethod === 'POST');
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) {
    console.error('[teamshop-auto-release] not configured:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Service not configured' }) };
  }

  let actor = 'schedule';
  if (isManual) {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
    if (body.action !== 'run') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action.' }) };
    const staff = await verifyUser(event);
    if (!staff.ok) return { statusCode: staff.status, headers, body: JSON.stringify({ error: staff.error }) };
    actor = staff.teamMemberId || 'staff';
  }

  try {
    const summary = await runRelease(admin, actor);
    return { statusCode: 200, headers, body: JSON.stringify(summary) };
  } catch (e) {
    // NEVER throw to the caller — this is an unattended automation.
    console.error('[teamshop-auto-release] sweep failed:', e.message || e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};

// ── Test surface ─────────────────────────────────────────────────────────────
module.exports.runRelease = runRelease;
module.exports.jobReleasable = jobReleasable;
module.exports.jobArtReady = jobArtReady;
module.exports.jobDtfReady = jobDtfReady;
module.exports.jobFulfillment = jobFulfillment;
module.exports.artRecordProdReady = artRecordProdReady;
module.exports.jobArtIds = jobArtIds;
module.exports.hasDst = hasDst;
