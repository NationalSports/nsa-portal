// Public, token-gated endpoint for the new-hire onboarding wizard. The hire is
// NOT authenticated — they hold a single-use invite token. All DB access here
// uses the service-role key (RLS denies anon entirely on these tables).
//
// Actions (POST { token, action, ... }):
//   load   → invite details + saved progress (never returns sensitive plaintext)
//   save   → upsert form data; SSN/bank are encrypted before storage
//   submit → mark the packet complete
//   track  → append review-audit events (section views, scroll-to-end, acks)
const { getSupabaseAdmin, corsHeaders, getSiteUrl } = require('./_shared');
const { encryptField } = require('./_onboardingCrypto');

const SENSITIVE_KEYS = ['ssn', 'bank_account', 'bank_routing'];

function clientIp(event) {
  const h = event.headers || {};
  return (h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
}

async function loadInvite(admin, token) {
  const { data: inv, error } = await admin
    .from('onboarding_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'void') return { error: 'void' };
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { error: 'expired' };
  return { invite: inv };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Bad JSON' }) }; }

  const token = String(body.token || '').trim();
  const action = String(body.action || 'load');
  if (!token) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing token' }) };

  try {
    const found = await loadInvite(admin, token);
    if (found.error) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: found.error }) };
    const invite = found.invite;

    // Public-safe view of the invite (no internal ids beyond what the wizard needs).
    const safeInvite = {
      full_name: invite.full_name,
      personal_email: invite.personal_email,
      nsa_email: invite.nsa_email,
      role: invite.role,
      position_title: invite.position_title,
      supervisor: invite.supervisor,
      hire_date: invite.hire_date,
      employment_type: invite.employment_type,
      pay_type: invite.pay_type,
      pay_rate: invite.pay_rate,
      pay_components: invite.pay_components || [],
      commission_eligible: invite.commission_eligible,
      work_state: invite.work_state || 'CA',
      status: invite.status,
    };

    // Fetch (or lazily prepare) the submission row.
    const { data: subRow } = await admin
      .from('onboarding_submissions')
      .select('*')
      .eq('invite_id', invite.id)
      .maybeSingle();

    if (action === 'load') {
      const sensitiveSet = {};
      for (const k of SENSITIVE_KEYS) sensitiveSet[k] = !!(subRow && subRow.sensitive && subRow.sensitive[k]);
      const { data: docs } = await admin
        .from('onboarding_documents')
        .select('id, kind, filename, content_type, size_bytes, uploaded_at')
        .eq('invite_id', invite.id).order('uploaded_at', { ascending: true });
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          invite: safeInvite,
          documents: docs || [],
          submission: subRow ? {
            data: subRow.data || {},
            signatures: subRow.signatures || {},
            acknowledgments: subRow.acknowledgments || {},
            completed_steps: subRow.completed_steps || [],
            current_step: subRow.current_step || null,
            submitted: !!subRow.submitted,
            sensitive_set: sensitiveSet,
          } : null,
        }),
      };
    }

    // ── Document upload / delete (token-gated, before submit) ──
    if (action === 'upload') {
      const kind = String(body.kind || 'other').slice(0, 40);
      const filename = String(body.filename || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
      const contentType = String(body.content_type || 'application/octet-stream').slice(0, 100);
      const b64 = String(body.data_base64 || '');
      if (!b64) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'No file data' }) };
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 4.5 * 1024 * 1024) return { statusCode: 413, headers, body: JSON.stringify({ ok: false, error: 'File too large (max ~4 MB)' }) };
      const path = `${invite.id}/${kind}_${Date.now()}_${filename}`;
      const up = await admin.storage.from('onboarding-docs').upload(path, buf, { contentType, upsert: false });
      if (up.error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: up.error.message }) };
      const { data: row, error: insErr } = await admin.from('onboarding_documents')
        .insert({ invite_id: invite.id, kind, filename, storage_path: path, content_type: contentType, size_bytes: buf.length })
        .select('id, kind, filename, content_type, size_bytes, uploaded_at').maybeSingle();
      if (insErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: insErr.message }) };
      await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: 'doc_upload', ref: kind, meta: { filename } }]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, document: row }) };
    }

    if (action === 'delete_doc') {
      const docId = String(body.document_id || '');
      const { data: doc } = await admin.from('onboarding_documents').select('id, storage_path').eq('id', docId).eq('invite_id', invite.id).maybeSingle();
      if (!doc) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      await admin.storage.from('onboarding-docs').remove([doc.storage_path]);
      await admin.from('onboarding_documents').delete().eq('id', docId);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (invite.status === 'completed' || (subRow && subRow.submitted)) {
      if (action !== 'track') {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'already_submitted' }) };
      }
    }

    if (action === 'track') {
      const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
      if (events.length) {
        const ua = (event.headers || {})['user-agent'] || '';
        const ip = clientIp(event);
        const rows = events.map((ev) => ({
          invite_id: invite.id,
          kind: String(ev.kind || 'event').slice(0, 40),
          ref: ev.ref ? String(ev.ref).slice(0, 200) : null,
          meta: { ...(ev.meta || {}), ua, ip },
        }));
        await admin.from('onboarding_events').insert(rows);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'save' || action === 'submit') {
      // Encrypt any incoming sensitive plaintext, merge onto existing blob.
      const existingSensitive = (subRow && subRow.sensitive) || {};
      const sensitiveIn = body.sensitive || {};
      const mergedSensitive = { ...existingSensitive };
      for (const k of SENSITIVE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(sensitiveIn, k)) {
          const v = sensitiveIn[k];
          mergedSensitive[k] = (v === '' || v == null) ? undefined : encryptField(v);
          if (mergedSensitive[k] === undefined) delete mergedSensitive[k];
        }
      }

      const mergedData = { ...((subRow && subRow.data) || {}), ...(body.data || {}) };
      const mergedSig = { ...((subRow && subRow.signatures) || {}), ...(body.signatures || {}) };
      const mergedAck = { ...((subRow && subRow.acknowledgments) || {}), ...(body.acknowledgments || {}) };
      const completedSteps = Array.isArray(body.completed_steps)
        ? body.completed_steps
        : ((subRow && subRow.completed_steps) || []);

      const payload = {
        invite_id: invite.id,
        data: mergedData,
        sensitive: mergedSensitive,
        signatures: mergedSig,
        acknowledgments: mergedAck,
        current_step: body.current_step || (subRow && subRow.current_step) || null,
        completed_steps: completedSteps,
      };
      if (action === 'submit') {
        payload.submitted = true;
        payload.submitted_at = new Date().toISOString();
      }

      const { error: upErr } = await admin
        .from('onboarding_submissions')
        .upsert(payload, { onConflict: 'invite_id' });
      if (upErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: upErr.message }) };

      // Advance invite lifecycle.
      const inviteUpdate = action === 'submit'
        ? { status: 'completed', completed_at: new Date().toISOString() }
        : (invite.status === 'invited' ? { status: 'in_progress' } : {});
      if (Object.keys(inviteUpdate).length) {
        await admin.from('onboarding_invites').update(inviteUpdate).eq('id', invite.id);
      }
      // Audit the milestone.
      await admin.from('onboarding_events').insert([{
        invite_id: invite.id,
        kind: action === 'submit' ? 'submit' : 'save',
        ref: body.current_step || null,
        meta: { ip: clientIp(event), ua: (event.headers || {})['user-agent'] || '' },
      }]);

      // On final submit, kick the background finalize (build packet → email HR →
      // copy to the Employee Forms Drive). Fire-and-forget; the hire's request
      // returns immediately and the background function (15-min budget) does the work.
      if (action === 'submit') {
        try {
          const site = getSiteUrl(event);
          if (site) {
            await fetch(`${site}/.netlify/functions/onboarding-finalize-background`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.SUPABASE_SERVICE_ROLE_KEY || '' },
              body: JSON.stringify({ token }),
            });
          }
        } catch (e) { /* non-fatal: HR can still download from the portal */ }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Unknown action' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
