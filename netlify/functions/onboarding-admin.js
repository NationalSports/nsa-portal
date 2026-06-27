// Staff-only onboarding endpoint. All actions require an admin / super_admin
// team member (verifyAdmin). The new-hire side lives in onboarding-public.js.
//
// Actions (POST { action, ... } with Authorization: Bearer <supabase jwt>):
//   create_invite → create an invite row + email the hire a tokenized link
//   list          → all invites with progress + completion summary
//   detail        → one invite: full progress, signatures, acks, audit events
//   resend        → re-send the invite email
//   void          → cancel an invite
//   generate_zip  → decrypt + render the packet PDFs, return a base64 ZIP
const crypto = require('crypto');
const { getSupabaseAdmin, corsHeaders, verifyAdmin } = require('./_shared');
const { buildPacketFiles, zipFiles, safeName, formatPayComponents } = require('./_onboardingPacket');
const { decryptField } = require('./_onboardingCrypto');
const { brandedEmail } = require('./_onboardingEmail');

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function portalUrl() {
  return (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
}

// The hire-facing link. Defaults to the marketing site's /welcome page (which
// wraps the wizard in the NSA header/footer); falls back to the portal route.
function inviteLink(token) {
  const base = (process.env.ONBOARDING_WELCOME_URL || 'https://www.nationalsportsapparel.com/welcome').replace(/\/+$/, '');
  return `${base}?token=${encodeURIComponent(token)}`;
}

async function sendInviteEmail(invite) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return { emailed: false, error: 'Email not configured' };
  const link = inviteLink(invite.token);
  const hello = invite.full_name ? `Hi ${esc(invite.full_name.split(' ')[0])},` : 'Hello,';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: invite.personal_email, name: invite.full_name || invite.personal_email }],
      subject: 'Welcome to National Sports Apparel — complete your new-hire paperwork',
      htmlContent: brandedEmail({
        preheader: 'Complete your new-hire paperwork online — about 15–20 minutes.',
        heading: 'Welcome to the Team',
        bodyHtml:
          `<p style="margin:0 0 14px;">${hello}</p>` +
          `<p style="margin:0 0 8px;">We're excited to have you joining National Sports Apparel${invite.position_title ? ` as our <strong>${esc(invite.position_title)}</strong>` : ''}.</p>` +
          `<p style="margin:0;">Before your first day, please complete your new-hire paperwork online — your personal info, direct deposit, emergency contacts, tax forms, the employee handbook, and a few required California notices. It takes about 15–20 minutes.</p>`,
        ctaText: 'Start My Paperwork',
        ctaUrl: esc(link),
        note: `This secure link is just for you (<strong>${esc(invite.personal_email)}</strong>) and expires in 30 days. You can save and come back anytime. Questions? Just reply to this email.`,
      }),
    }),
  });
  if (!res.ok) { return { emailed: false, error: `Send failed (${res.status})` }; }
  return { emailed: true };
}


exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  const auth = await verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ ok: false, error: auth.error }) };
  const admin = auth.admin;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Bad JSON' }) }; }
  const action = String(body.action || '');

  try {
    if (action === 'create_invite') {
      const email = String(body.personal_email || '').trim();
      const name = String(body.full_name || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Valid personal email required' }) };
      if (!name) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Full name required' }) };
      const token = crypto.randomBytes(24).toString('base64url');
      const row = {
        token, full_name: name, personal_email: email,
        nsa_email: body.nsa_email || null, role: body.role || null,
        position_title: body.position_title || null, supervisor: body.supervisor || null,
        hire_date: body.hire_date || null, employment_type: body.employment_type || 'w2_employee',
        pay_components: Array.isArray(body.pay_components) ? body.pay_components : [],
        pay_type: body.pay_type || null, pay_rate: body.pay_rate || formatPayComponents(body.pay_components) || null,
        commission_eligible: !!body.commission_eligible || (Array.isArray(body.pay_components) && body.pay_components.some((c) => c && c.type === 'commission')),
        work_state: body.work_state || 'CA',
        created_by: auth.teamMemberId ? String(body.created_by_name || '') : null, created_by_id: String(auth.teamMemberId || ''),
      };
      const { data: inserted, error } = await admin.from('onboarding_invites').insert(row).select().maybeSingle();
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      const mail = await sendInviteEmail(inserted);
      const link = inviteLink(inserted.token);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, invite: { id: inserted.id, ...row, token: undefined }, link, emailed: mail.emailed, emailError: mail.error || null }) };
    }

    if (action === 'list') {
      const { data: invites, error } = await admin.from('onboarding_invites').select('*').order('created_at', { ascending: false });
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      const ids = (invites || []).map((i) => i.id);
      let subs = [];
      if (ids.length) {
        const { data } = await admin.from('onboarding_submissions').select('invite_id, completed_steps, submitted, submitted_at, updated_at, acknowledgments').in('invite_id', ids);
        subs = data || [];
      }
      const subByInvite = Object.fromEntries(subs.map((s) => [s.invite_id, s]));
      const out = (invites || []).map((i) => {
        const s = subByInvite[i.id];
        return {
          id: i.id, full_name: i.full_name, personal_email: i.personal_email, nsa_email: i.nsa_email,
          role: i.role, position_title: i.position_title, status: i.status,
          invited_at: i.invited_at, completed_at: i.completed_at, expires_at: i.expires_at,
          i9_status: i.i9_status || 'pending',
          steps_done: s ? (s.completed_steps || []).length : 0,
          submitted: s ? !!s.submitted : false,
          last_activity: s ? s.updated_at : i.created_at,
        };
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, invites: out }) };
    }

    if (action === 'detail') {
      const id = String(body.id || '');
      const { data: inv } = await admin.from('onboarding_invites').select('*').eq('id', id).maybeSingle();
      if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      const { data: sub } = await admin.from('onboarding_submissions').select('invite_id, data, signatures, acknowledgments, completed_steps, submitted, submitted_at, updated_at').eq('invite_id', id).maybeSingle();
      const { data: events } = await admin.from('onboarding_events').select('kind, ref, meta, created_at').eq('invite_id', id).order('created_at', { ascending: true }).limit(2000);
      const { data: documents } = await admin.from('onboarding_documents').select('id, kind, filename, content_type, size_bytes, uploaded_at').eq('invite_id', id).order('uploaded_at', { ascending: true });
      const link = inviteLink(inv.token);
      // Never return decrypted SSN/bank here; the detail view shows progress only.
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, invite: { ...inv, token: undefined }, link, submission: sub || null, events: events || [], documents: documents || [] }) };
    }

    if (action === 'set_i9') {
      const id = String(body.id || '');
      const status = body.i9_status === 'completed' ? 'completed' : (body.i9_status === 'na' ? 'na' : 'pending');
      const patch = { i9_status: status, i9_completed_at: status === 'completed' ? new Date().toISOString() : null, i9_verified_by: status === 'completed' ? String(body.verified_by || auth.teamMemberId || '') : null };
      const { error } = await admin.from('onboarding_invites').update(patch).eq('id', id);
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      await admin.from('onboarding_events').insert([{ invite_id: id, kind: 'i9_status', ref: status, meta: { by: auth.teamMemberId } }]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...patch }) };
    }

    if (action === 'doc_url') {
      const docId = String(body.document_id || '');
      const { data: doc } = await admin.from('onboarding_documents').select('storage_path, filename').eq('id', docId).maybeSingle();
      if (!doc) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      const { data: signed, error } = await admin.storage.from('onboarding-docs').createSignedUrl(doc.storage_path, 300, { download: doc.filename });
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, url: signed.signedUrl }) };
    }

    if (action === 'resend') {
      const { data: inv } = await admin.from('onboarding_invites').select('*').eq('id', String(body.id || '')).maybeSingle();
      if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      const mail = await sendInviteEmail(inv);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: mail.emailed, emailed: mail.emailed, error: mail.error || null }) };
    }

    if (action === 'void') {
      const { error } = await admin.from('onboarding_invites').update({ status: 'void' }).eq('id', String(body.id || ''));
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'generate_zip') {
      const id = String(body.id || '');
      const { data: inv } = await admin.from('onboarding_invites').select('*').eq('id', id).maybeSingle();
      if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      const { data: sub } = await admin.from('onboarding_submissions').select('*').eq('invite_id', id).maybeSingle();
      const { data: events } = await admin.from('onboarding_events').select('kind, ref, meta, created_at').eq('invite_id', id).order('created_at', { ascending: true }).limit(5000);

      const files = await buildPacketFiles(inv, sub, events || []);
      // Append the hire's uploaded documents under an Uploads/ folder.
      const { data: docs } = await admin.from('onboarding_documents').select('kind, filename, storage_path').eq('invite_id', id);
      for (const d of (docs || [])) {
        try {
          const dl = await admin.storage.from('onboarding-docs').download(d.storage_path);
          if (dl.data) {
            const ab = await dl.data.arrayBuffer();
            files.push({ name: `Uploads/${d.kind}_${d.filename}`, bytes: Buffer.from(ab) });
          }
        } catch {}
      }
      const buf = await zipFiles(files);

      await admin.from('onboarding_events').insert([{ invite_id: id, kind: 'download', ref: 'packet_zip', meta: { by: auth.teamMemberId } }]);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, filename: `${safeName(inv.full_name)}_NSA_New_Hire_Packet.zip`, zip_base64: buf.toString('base64') }),
      };
    }

    if (action === 'reveal_sensitive') {
      // Audited, admin-only retrieval of full SSN/bank for payroll. Keeps full
      // numbers out of emailed files — they are shown once, on demand, and the
      // access is logged to the audit trail.
      const id = String(body.id || '');
      const { data: sub } = await admin.from('onboarding_submissions').select('invite_id, sensitive').eq('invite_id', id).maybeSingle();
      if (!sub) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'No submission' }) };
      const s = sub.sensitive || {};
      let ssn = '', acct = '', routing = '', ein = '';
      try { ssn = decryptField(s.ssn); } catch {}
      try { acct = decryptField(s.bank_account); } catch {}
      try { routing = decryptField(s.bank_routing); } catch {}
      try { ein = decryptField(s.ein); } catch {}
      await admin.from('onboarding_events').insert([{ invite_id: id, kind: 'sensitive_revealed', ref: String(body.reason || 'payroll'), meta: { by: auth.teamMemberId } }]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ssn, bank_account: acct, bank_routing: routing, ein }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Unknown action' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
