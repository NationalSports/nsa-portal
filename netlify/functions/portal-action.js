// Coach-portal write endpoint.
//
// The coach portal is a public link (?portal=<alpha_tag>) and runs as the
// Supabase `anon` role, which RLS only grants SELECT on sales_orders / so_jobs /
// so_art_files / estimates. So coach approvals, change-requests, and the emails
// they trigger never persisted — the browser write was silently rejected (401).
//
// This function performs those writes with the service-role key (bypassing RLS,
// same pattern as create-quote-request.js) and forwards the rep notification to
// Brevo using the server-side key so it isn't exposed to the browser.

const { createClient } = require('@supabase/supabase-js');
const { resolveSender } = require('./_emailSender');

// Only these columns may be written from the portal — defends against a crafted
// payload setting arbitrary columns. Target rows are additionally verified to
// belong to the requesting portal's alpha_tag customer family (see below).
const JOB_COLS = new Set(['art_status', 'coach_approved_at', 'coach_approval_comment', 'coach_rejected', 'rejections', 'art_messages', 'art_requests', 'sent_to_coach_at']);
const ART_COLS = new Set(['status', 'notes', 'prod_files_attached']);
const EST_COLS = new Set(['status', 'approved_by', 'approved_at', 'update_requests', 'updated_at', 'email_status', 'email_viewed_at']);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const pick = (obj, allowed) => {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (allowed.has(k)) out[k] = obj[k]; });
  return out;
};

const ART_DECISION_STATUSES = new Set(['production_files_needed', 'order_dtf_transfers', 'upload_emb_files', 'art_complete']);
const STALE_MSG = 'This artwork was updated since this page loaded — please refresh and try again.';

// ── Coach art decision — ONE guarded transaction (migration 00172) ──
// apply_coach_art_decision locks the job, verifies it is still waiting_approval
// (a tab opened before a rep recall must not resurrect the job), verifies the
// mocks the coach saw still exist (an artist re-upload means they'd approve a
// different image than the records), and applies the complete write set over
// so_jobs + so_art_files atomically. Falls back to guarded sequential updates
// until the migration is applied — same guards, just not atomic.
async function applyArtDecision(admin, d, touchTs) {
  if (!d || !d.so_id || !d.job_id) return { ok: false, status: 400, error: 'so_id and job_id required' };
  const artIds = Array.isArray(d.art_ids) ? d.art_ids.filter(Boolean) : [];
  const comment = String(d.comment || '').trim();
  const { data, error } = await admin.rpc('apply_coach_art_decision', {
    p_so_id: d.so_id, p_job_id: d.job_id, p_decision: d.decision,
    p_comment: comment || null, p_art_ids: artIds,
    p_approved_status: d.approved_status || null,
    p_seen_mocks: Array.isArray(d.seen_mocks) && d.seen_mocks.length ? d.seen_mocks : null,
    p_touch_updated_at: touchTs || null,
  });
  if (!error) {
    // M4: a reject also clears the stale approval timestamp. The 00172 RPC predates
    // this clear, so it runs as a follow-up write — guarded on the state the RPC
    // just committed so it can never clobber a subsequent transition.
    if (d.decision === 'reject') {
      await admin.from('so_jobs').update({ coach_approved_at: null })
        .eq('so_id', d.so_id).eq('id', d.job_id).eq('art_status', 'art_requested');
    }
    return { ok: true, job: data && data.job };
  }
  const msg = error.message || '';
  if (/NSA_STALE_STATE/.test(msg)) return { ok: false, status: 409, code: 'stale_state', error: STALE_MSG };
  if (/NSA_MOCKS_CHANGED/.test(msg)) return { ok: false, status: 409, code: 'mocks_changed', error: 'The artwork changed while you were reviewing it — please refresh to see the latest version.' };
  if (/NSA_NOT_FOUND/.test(msg)) return { ok: false, status: 404, code: 'not_found', error: 'This artwork could not be found — please refresh the page.' };
  if (/NSA_BAD_INPUT/.test(msg)) return { ok: false, status: 400, code: 'bad_input', error: msg };
  const missingFn = /apply_coach_art_decision/.test(msg) && /(function|schema cache)/i.test(msg);
  if (!missingFn) return { ok: false, status: 500, error: msg };

  // ── Pre-00172 fallback: guarded, complete write sets, sequential ──
  if (d.decision === 'approve') {
    if (!ART_DECISION_STATUSES.has(d.approved_status)) return { ok: false, status: 400, error: 'invalid approved_status' };
    const { data: rows, error: jErr } = await admin.from('so_jobs')
      .update({ art_status: d.approved_status, coach_approved_at: new Date().toISOString(), coach_approval_comment: comment || null, coach_rejected: false })
      .eq('so_id', d.so_id).eq('id', d.job_id).eq('art_status', 'waiting_approval').select('id');
    if (jErr) return { ok: false, status: 500, error: jErr.message };
    if (!rows || !rows.length) return { ok: false, status: 409, code: 'stale_state', error: STALE_MSG };
    if (artIds.length) {
      const { error: aErr } = await admin.from('so_art_files').update({ status: 'approved' }).eq('so_id', d.so_id).in('id', artIds);
      if (aErr) return { ok: false, status: 500, error: aErr.message };
    }
  } else if (d.decision === 'reject') {
    if (!comment) return { ok: false, status: 400, error: 'A note describing the changes is required.' };
    const now = new Date().toISOString();
    const { data: jrows, error: rErr } = await admin.from('so_jobs').select('rejections').eq('so_id', d.so_id).eq('id', d.job_id).limit(1);
    if (rErr) return { ok: false, status: 500, error: rErr.message };
    const prevRej = ((jrows || [])[0] || {}).rejections || [];
    const { data: rows, error: jErr } = await admin.from('so_jobs')
      .update({ art_status: 'art_requested', coach_rejected: true, sent_to_coach_at: null, coach_approved_at: null, rejections: [...prevRej, { reason: comment, by: 'Coach', at: now, rejected_at: now }] })
      .eq('so_id', d.so_id).eq('id', d.job_id).eq('art_status', 'waiting_approval').select('id');
    if (jErr) return { ok: false, status: 500, error: jErr.message };
    if (!rows || !rows.length) return { ok: false, status: 409, code: 'stale_state', error: STALE_MSG };
    for (const aid of artIds) {
      const { data: arows } = await admin.from('so_art_files').select('notes').eq('so_id', d.so_id).eq('id', aid).limit(1);
      const notes = (((arows || [])[0] || {}).notes) || '';
      const { error: aErr } = await admin.from('so_art_files')
        .update({ status: 'waiting_for_art', prod_files_attached: false, notes: (notes ? notes + '\n' : '') + 'Coach feedback: ' + comment })
        .eq('so_id', d.so_id).eq('id', aid);
      if (aErr) return { ok: false, status: 500, error: aErr.message };
    }
  } else {
    return { ok: false, status: 400, error: 'decision must be approve or reject' };
  }
  if (touchTs) await admin.from('sales_orders').update({ updated_at: touchTs }).eq('id', d.so_id);
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sbUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Supabase service credentials missing' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { jobs = [], artFiles = [], estimates = [], touchSO, email, alphaTag, artDecision } = body;
  const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const errors = [];

  // Ownership scoping: the portal link carries the customer's alpha_tag, so every
  // targeted SO/estimate must belong to that customer (or a sub-customer). Without
  // this, any caller could approve any estimate or patch any SO's allowlisted columns.
  if (!alphaTag || typeof alphaTag !== 'string' || !alphaTag.trim()) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'alphaTag required' }) };
  }
  let allowedSO = new Set(), allowedEst = new Set();
  try {
    const { data: parents, error: custErr } = await admin.from('customers').select('id').eq('alpha_tag', alphaTag.trim());
    if (custErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: custErr.message }) };
    if (!parents || !parents.length) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Unknown portal tag' }) };
    const parentIds = parents.map(p => p.id);
    const { data: kids, error: kidErr } = await admin.from('customers').select('id').in('parent_id', parentIds);
    if (kidErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: kidErr.message }) };
    const famIds = new Set([...parentIds, ...(kids || []).map(k => k.id)]);

    const soIds = [...new Set([...jobs, ...artFiles].map(r => r?.so_id).concat(touchSO ? [touchSO] : []).concat(artDecision?.so_id ? [artDecision.so_id] : []).filter(Boolean))];
    if (soIds.length) {
      const { data: sos, error: soErr } = await admin.from('sales_orders').select('id,customer_id').in('id', soIds);
      if (soErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: soErr.message }) };
      (sos || []).forEach(s => { if (famIds.has(s.customer_id)) allowedSO.add(s.id); });
    }
    const estIds = [...new Set(estimates.map(r => r?.id).filter(Boolean))];
    if (estIds.length) {
      const { data: ests, error: estErr } = await admin.from('estimates').select('id,customer_id').in('id', estIds);
      if (estErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: estErr.message }) };
      (ests || []).forEach(e => { if (famIds.has(e.customer_id)) allowedEst.add(e.id); });
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  // ── Coach art decision (approve / request changes) — the guarded transition
  // path. Ownership-scoped like everything else; a failed decision returns its
  // own status/code so the portal can tell "stale link" from a real error.
  if (artDecision) {
    if (!allowedSO.has(artDecision.so_id)) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Order not in this portal' }) };
    }
    const decided = await applyArtDecision(admin, artDecision, new Date().toLocaleString());
    if (!decided.ok) {
      return { statusCode: decided.status || 500, headers: CORS, body: JSON.stringify({ error: decided.error, code: decided.code }) };
    }
  }

  try {
    for (const row of jobs) {
      if (!row?.so_id || !row?.id) continue;
      if (!allowedSO.has(row.so_id)) { errors.push('so_jobs ' + row.id + ': order not in this portal'); continue; }
      const patch = pick(row, JOB_COLS);
      if (!Object.keys(patch).length) continue;
      // A patch that moves art_status is a coach decision from an OLD portal tab
      // (new tabs use artDecision above). Gate it on the job still awaiting the
      // coach, so a link opened before a rep recall can't resurrect the job (H1).
      if (Object.prototype.hasOwnProperty.call(patch, 'art_status')) {
        const { data: rows, error } = await admin.from('so_jobs').update(patch)
          .eq('so_id', row.so_id).eq('id', row.id).eq('art_status', 'waiting_approval').select('id');
        if (error) errors.push('so_jobs ' + row.id + ': ' + error.message);
        else if (!rows || !rows.length) errors.push('so_jobs ' + row.id + ': ' + STALE_MSG);
        continue;
      }
      const { error } = await admin.from('so_jobs').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_jobs ' + row.id + ': ' + error.message);
    }

    for (const row of artFiles) {
      if (!row?.so_id || !row?.id) continue;
      if (!allowedSO.has(row.so_id)) { errors.push('so_art_files ' + row.id + ': order not in this portal'); continue; }
      const patch = pick(row, ART_COLS);
      // M2: the portal may only CLEAR the seps confirmation (a reject round-trip) —
      // never set it. Confirming production files is a shop-side action.
      if ('prod_files_attached' in patch && patch.prod_files_attached !== false) delete patch.prod_files_attached;
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('so_art_files').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_art_files ' + row.id + ': ' + error.message);
    }

    for (const row of estimates) {
      if (!row?.id) continue;
      if (!allowedEst.has(row.id)) { errors.push('estimates ' + row.id + ': not in this portal'); continue; }
      const patch = pick(row, EST_COLS);
      if (!Object.keys(patch).length) continue;
      // The estimate cousin of the H1 guard: a coach approval only lands on an
      // estimate still awaiting one — never re-clobbers approved/converted.
      if (patch.status === 'approved') {
        const { data: rows, error } = await admin.from('estimates').update(patch)
          .eq('id', row.id).in('status', ['sent', 'draft', 'open']).select('id');
        if (error) errors.push('estimates ' + row.id + ': ' + error.message);
        else if (!rows || !rows.length) errors.push('estimates ' + row.id + ': This estimate was updated since this page loaded — please refresh and try again.');
        continue;
      }
      const { error } = await admin.from('estimates').update(patch).eq('id', row.id);
      if (error) errors.push('estimates ' + row.id + ': ' + error.message);
    }

    if (touchSO) {
      if (!allowedSO.has(touchSO)) { errors.push('sales_orders ' + touchSO + ': order not in this portal'); }
      else {
        const { error } = await admin.from('sales_orders').update({ updated_at: new Date().toLocaleString() }).eq('id', touchSO);
        if (error) errors.push('sales_orders ' + touchSO + ': ' + error.message);
      }
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  if (errors.length) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: errors.join('; ') }) };

  // Notify the rep. Failure here must not fail the approval — the write already succeeded.
  let emailSent = false, emailError = null;
  if (email && email.to) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      emailError = 'BREVO_API_KEY not configured';
    } else {
      try {
        const payload = {
          sender: resolveSender({
            name: email.senderName || 'National Sports Apparel',
            email: email.senderEmail,
            replyTo: email.replyTo,
          }),
          to: Array.isArray(email.to) ? email.to : [{ email: email.to }],
          subject: email.subject,
          htmlContent: email.htmlContent || undefined,
        };
        if (email.replyTo) payload.replyTo = email.replyTo;
        if (email.cc) {
          const toSet = new Set(payload.to.map(t => (t.email || '').toLowerCase()));
          const cc = (Array.isArray(email.cc) ? email.cc : [email.cc]).filter(c => c && c.email && !toSet.has(c.email.toLowerCase()));
          if (cc.length) payload.cc = cc;
        }
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
          body: JSON.stringify(payload),
        });
        if (r.ok) emailSent = true;
        else { const d = await r.text(); emailError = 'Brevo ' + r.status + ': ' + d; }
      } catch (e) { emailError = e.message; }
    }
    if (emailError) console.error('[portal-action] email failed:', emailError);
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, emailSent, emailError }) };
};

// Test surface — Netlify invokes `handler`; this export is inert in prod.
module.exports.applyArtDecision = applyArtDecision;
