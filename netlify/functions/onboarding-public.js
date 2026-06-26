// Public, token-gated endpoint for the new-hire onboarding wizard. The hire is
// NOT authenticated — they hold a single-use invite token. All DB access here
// uses the service-role key (RLS denies anon entirely on these tables).
//
// Actions (POST { token, action, ... }):
//   load   → invite details + saved progress (never returns sensitive plaintext)
//   save   → upsert form data; SSN/bank are encrypted before storage
//   submit → mark the packet complete
//   track  → append review-audit events (section views, scroll-to-end, acks)
const { getSupabaseAdmin, corsHeaders } = require('./_shared');
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
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          invite: safeInvite,
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

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Unknown action' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
