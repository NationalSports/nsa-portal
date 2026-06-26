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
const { decryptField, maskTail } = require('./_onboardingCrypto');
const { renderDocument, fmtDate, fmtDateTime } = require('./_onboardingPdf');

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function portalUrl() {
  return (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
}

async function sendInviteEmail(invite) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return { emailed: false, error: 'Email not configured' };
  const link = `${portalUrl()}/onboarding?token=${encodeURIComponent(invite.token)}`;
  const hello = invite.full_name ? `Hi ${esc(invite.full_name.split(' ')[0])},` : 'Hello,';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: invite.personal_email, name: invite.full_name || invite.personal_email }],
      subject: 'Welcome to National Sports Apparel — complete your new-hire paperwork',
      htmlContent: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#191919;color:white;padding:20px 22px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;font-size:18px">Welcome to the team 🎉</h2>
          </div>
          <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">${hello}</p>
            <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">
              We're excited to have you joining National Sports Apparel${invite.position_title ? ` as our <strong>${esc(invite.position_title)}</strong>` : ''}.
              Before your first day, please complete your new-hire paperwork online — your personal info, direct deposit,
              emergency contacts, tax forms, the employee handbook, and a few required California notices. It takes about 15–20 minutes.
            </p>
            <a href="${esc(link)}" style="display:inline-block;background:#191919;color:#fff;border-radius:8px;padding:12px 26px;font-weight:700;text-decoration:none;font-size:15px">Start my paperwork</a>
            <p style="font-size:12.5px;color:#64748b;line-height:1.6;margin:18px 0 0">
              This secure link is just for you (<strong>${esc(invite.personal_email)}</strong>) and expires in 30 days.
              You can save and come back anytime.
            </p>
            <p style="font-size:11.5px;color:#94a3b8;margin-top:16px">Questions? Just reply to this email.</p>
          </div>
        </div>`,
    }),
  });
  if (!res.ok) { return { emailed: false, error: `Send failed (${res.status})` }; }
  return { emailed: true };
}

// ── Packet builders ──────────────────────────────────────────────────────
const yn = (v) => (v ? 'Yes' : 'No');

async function buildPacket(invite, sub, handbookCount) {
  const data = (sub && sub.data) || {};
  const sig = (sub && sub.signatures) || {};
  const ack = (sub && sub.acknowledgments) || {};
  const sens = (sub && sub.sensitive) || {};
  const p = data.personal || {};
  const dd = data.direct_deposit || {};
  const em = data.emergency || {};
  const tax = data.tax || {};

  let ssn = '', acct = '', routing = '';
  try { ssn = decryptField(sens.ssn); } catch {}
  try { acct = decryptField(sens.bank_account); } catch {}
  try { routing = decryptField(sens.bank_routing); } catch {}

  const sigLine = (key, fallbackName) => {
    const s = sig[key] || {};
    return { type: 'sig', name: s.name || fallbackName || invite.full_name, date: fmtDate(s.signed_at) };
  };

  const docs = [];

  // 1 — Job Hire Form
  docs.push({
    name: '01_Job_Hire_Form.pdf',
    pdf: await renderDocument({
      title: 'Job Hire Form', subtitle: 'Employee / Position Overview',
      blocks: [
        { type: 'heading', text: 'Position' },
        { type: 'field', label: 'Position Title', value: invite.position_title },
        { type: 'field', label: 'Supervisor', value: invite.supervisor },
        { type: 'field', label: 'Hire Date', value: fmtDate(invite.hire_date) },
        { type: 'field', label: 'Employment Type', value: invite.employment_type === 'contractor_1099' ? 'Contracted 1099' : 'W-2 Employee' },
        { type: 'field', label: 'Pay', value: [invite.pay_type, invite.pay_rate].filter(Boolean).join(' — ') },
        { type: 'field', label: 'Commission Eligible', value: yn(invite.commission_eligible) },
        { type: 'rule' },
        { type: 'heading', text: 'Employee Information' },
        { type: 'field', label: 'Full Legal Name', value: p.full_name || invite.full_name },
        { type: 'field', label: 'Street Address', value: [p.street, p.city, p.state, p.zip].filter(Boolean).join(', ') },
        { type: 'field', label: 'Date of Birth', value: fmtDate(p.dob) },
        { type: 'field', label: 'Gender', value: p.gender },
        { type: 'field', label: 'Social Security Number', value: ssn ? maskTail(ssn) + '  (full SSN on file, encrypted)' : '—' },
        { type: 'field', label: 'Email', value: invite.personal_email },
        { type: 'field', label: 'NSA Email', value: invite.nsa_email },
        { type: 'field', label: 'Phone', value: p.phone },
        { type: 'spacer', h: 16 },
        sigLine('job_hire_form'),
      ],
    }),
  });

  // 2 — Direct Deposit
  docs.push({
    name: '02_Direct_Deposit_Authorization.pdf',
    pdf: await renderDocument({
      title: 'Direct Deposit Authorization', subtitle: 'Voluntary — you may opt out and receive a paper check',
      blocks: dd.opt_out ? [
        { type: 'para', text: 'The employee elected NOT to enroll in direct deposit and will receive pay by paper check.' },
        { type: 'spacer', h: 16 }, sigLine('direct_deposit'),
      ] : [
        { type: 'para', text: 'I authorize National Sports Apparel, LLC, directly or through its payroll provider, to deposit my net pay to the account below, and to reverse any amount deposited in error. This authorization remains in effect until I revoke it in writing.' },
        { type: 'heading', text: 'Account' },
        { type: 'field', label: 'Bank Name', value: dd.bank_name },
        { type: 'field', label: 'Account Type', value: dd.account_type },
        { type: 'field', label: 'Routing Number', value: routing ? maskTail(routing, 4) : '—' },
        { type: 'field', label: 'Account Number', value: acct ? maskTail(acct, 4) : '—' },
        { type: 'field', label: 'Deposit', value: dd.deposit_type === 'partial' ? `$${dd.amount || ''}` : 'Entire net amount' },
        { type: 'para', text: 'Full routing/account numbers are stored encrypted and available to payroll only.' },
        { type: 'spacer', h: 14 }, sigLine('direct_deposit'),
      ],
    }),
  });

  // 3 — Emergency Contact
  docs.push({
    name: '03_Emergency_Contact.pdf',
    pdf: await renderDocument({
      title: 'Emergency Contact Form',
      blocks: [
        { type: 'field', label: 'Medical Notes / Restrictions', value: em.medical_notes },
        { type: 'heading', text: 'Primary Contact' },
        { type: 'field', label: 'Name', value: (em.primary || {}).name },
        { type: 'field', label: 'Relationship', value: (em.primary || {}).relationship },
        { type: 'field', label: 'Phone', value: (em.primary || {}).phone },
        { type: 'field', label: 'Alternate Phone', value: (em.primary || {}).alt_phone },
        { type: 'field', label: 'Address', value: (em.primary || {}).address },
        { type: 'heading', text: 'Secondary Contact' },
        { type: 'field', label: 'Name', value: (em.secondary || {}).name },
        { type: 'field', label: 'Relationship', value: (em.secondary || {}).relationship },
        { type: 'field', label: 'Phone', value: (em.secondary || {}).phone },
        { type: 'heading', text: 'Physician' },
        { type: 'field', label: 'Name', value: (em.physician || {}).name },
        { type: 'field', label: 'Phone', value: (em.physician || {}).phone },
        { type: 'spacer', h: 14 },
        { type: 'para', text: 'I have voluntarily provided the above contact information and authorize the Company to contact these individuals on my behalf in an emergency.' },
        sigLine('emergency'),
      ],
    }),
  });

  // 4 — Tax (W-4 + CA DE 4 elections)
  const fed = tax.federal || {}; const de4 = tax.ca_de4 || {};
  docs.push({
    name: '04_Tax_Withholding_W4_DE4.pdf',
    pdf: await renderDocument({
      title: 'Tax Withholding Elections', subtitle: 'Federal Form W-4 and California Form DE 4 elections',
      blocks: [
        { type: 'heading', text: 'Federal (W-4)' },
        { type: 'field', label: 'Filing Status', value: fed.filing_status },
        { type: 'field', label: 'Multiple Jobs / Spouse Works', value: yn(fed.multiple_jobs) },
        { type: 'field', label: 'Dependents Amount', value: fed.dependents_amount },
        { type: 'field', label: 'Other Income', value: fed.other_income },
        { type: 'field', label: 'Deductions', value: fed.deductions },
        { type: 'field', label: 'Extra Withholding', value: fed.extra_withholding },
        { type: 'field', label: 'Claims Exempt', value: yn(fed.exempt) },
        { type: 'rule' },
        { type: 'heading', text: 'California (DE 4)' },
        { type: 'field', label: 'Filing Status', value: de4.filing_status },
        { type: 'field', label: 'Allowances', value: de4.allowances },
        { type: 'field', label: 'Additional Amount', value: de4.extra },
        { type: 'field', label: 'Claims Exempt', value: yn(de4.exempt) },
        { type: 'spacer', h: 14 },
        { type: 'para', text: 'Under penalties of perjury, I declare these withholding elections are true and correct.' },
        sigLine('tax_w4'),
      ],
    }),
  });

  // 5 — Commission Agreement (only if commission-eligible)
  if (invite.commission_eligible) {
    docs.push({
      name: '05_Commission_Agreement.pdf',
      pdf: await renderDocument({
        title: 'Commission Pay Agreement', subtitle: 'California Labor Code § 2751',
        blocks: [
          { type: 'para', text: 'This agreement sets out the method by which commissions are computed and paid, as required by California Labor Code section 2751.' },
          { type: 'field', label: 'Base Draw', value: invite.pay_rate },
          { type: 'field', label: 'Commission Basis', value: data.commission && data.commission.basis },
          { type: 'para', text: data.commission && data.commission.terms ? String(data.commission.terms) : 'Commission terms as described in the offer and discussed with your supervisor. (Attach the full commission schedule before signing.)' },
          { type: 'para', text: 'By signing, I acknowledge I received and agree to the commission terms above.' },
          sigLine('commission_agreement'),
        ],
      }),
    });
  }

  // 6 — Handbook acknowledgment
  const hbAcks = Object.keys(ack).filter((k) => k.startsWith('handbook:') && k !== 'handbook:all').length;
  docs.push({
    name: '06_Handbook_Acknowledgment.pdf',
    pdf: await renderDocument({
      title: 'Employee Handbook Acknowledgment', subtitle: `National Sports Apparel Employee Handbook (2025)`,
      blocks: [
        { type: 'para', text: 'I acknowledge that I have received, read, and understand the National Sports Apparel, LLC Employee Handbook (2025 edition). I understand my employment is at-will and that the handbook is not a contract of employment.' },
        { type: 'field', label: 'Sections opened & read', value: `${hbAcks} of ${handbookCount}` },
        { type: 'field', label: 'Acknowledged all sections', value: ack['handbook:all'] ? fmtDateTime(ack['handbook:all'].at) : 'No' },
        { type: 'field', label: 'At-will acknowledgment', value: ack['policy:at_will'] ? fmtDateTime(ack['policy:at_will'].at) : 'No' },
        { type: 'spacer', h: 14 },
        sigLine('handbook'),
      ],
    }),
  });

  // 7 — California notices acknowledgment
  const caItems = [
    ['ca:wage_theft', 'Wage Theft Prevention Notice (Labor Code 2810.5)'],
    ['ca:workers_comp', 'Workers’ Compensation rights & treating physician'],
    ['ca:sdi', 'State Disability Insurance (DE 2515)'],
    ['ca:pfl', 'Paid Family Leave (DE 2511)'],
    ['ca:harassment', 'Sexual Harassment pamphlet (DFEH/CRD-185)'],
    ['ca:sick_leave', 'Paid Sick Leave notice'],
    ['ca:de35', 'Notice to Employee (DE 35)'],
    ['ca:dv_rights', 'Victims’ rights / domestic violence notice'],
    ['ca:workplace_violence', 'Workplace Violence Prevention Plan (SB 553)'],
    ['ca:calsavers', 'CalSavers retirement savings notice'],
  ];
  docs.push({
    name: '07_California_Notices_Acknowledgment.pdf',
    pdf: await renderDocument({
      title: 'California Required Notices', subtitle: 'Acknowledgment of receipt — each item time-stamped',
      blocks: [
        { type: 'para', text: 'I acknowledge that I received and reviewed each of the following California new-hire notices and pamphlets:' },
        ...caItems.map(([k, label]) => ({ type: 'field', label, value: ack[k] ? `Reviewed ${fmtDateTime(ack[k].at)}` : 'Not acknowledged' })),
        { type: 'spacer', h: 12 },
        sigLine('ca_notices'),
      ],
    }),
  });

  return docs;
}

// 8 — Review audit log (proof they looked at everything)
async function buildAuditDoc(invite, sub, events) {
  const blocks = [
    { type: 'para', text: `This log records every documented interaction ${invite.full_name} had with the onboarding packet — section views, scroll-to-end completions, acknowledgments, signatures, saves, and the final submission — as captured by the portal.` },
    { type: 'field', label: 'Hire', value: `${invite.full_name} <${invite.personal_email}>` },
    { type: 'field', label: 'Role', value: invite.role },
    { type: 'field', label: 'Invited', value: fmtDateTime(invite.invited_at) },
    { type: 'field', label: 'Completed', value: invite.completed_at ? fmtDateTime(invite.completed_at) : 'Not yet' },
    { type: 'rule' },
    { type: 'heading', text: `Event trail (${events.length})` },
  ];
  for (const ev of events) {
    blocks.push({ type: 'bullet', text: `${fmtDateTime(ev.created_at)} — ${ev.kind}${ev.ref ? ` · ${ev.ref}` : ''}${ev.meta && ev.meta.scroll_pct != null ? ` · scrolled ${ev.meta.scroll_pct}%` : ''}` });
  }
  return renderDocument({ title: 'Onboarding Review Audit Log', subtitle: 'Confidential — retain with the employee record', footer: 'National Sports Apparel, LLC — Onboarding Audit Trail', blocks });
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
        pay_type: body.pay_type || null, pay_rate: body.pay_rate || null,
        commission_eligible: !!body.commission_eligible, work_state: body.work_state || 'CA',
        created_by: auth.teamMemberId ? String(body.created_by_name || '') : null, created_by_id: String(auth.teamMemberId || ''),
      };
      const { data: inserted, error } = await admin.from('onboarding_invites').insert(row).select().maybeSingle();
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
      const mail = await sendInviteEmail(inserted);
      const link = `${portalUrl()}/onboarding?token=${encodeURIComponent(inserted.token)}`;
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
      const link = `${portalUrl()}/onboarding?token=${encodeURIComponent(inv.token)}`;
      // Never return decrypted SSN/bank here; the detail view shows progress only.
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, invite: { ...inv, token: undefined }, link, submission: sub || null, events: events || [] }) };
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
      const JSZip = require('jszip');
      // Keep in sync with src/onboardingHandbook.js (HANDBOOK_SECTION_COUNT); used
      // only for the "N of M sections read" label, so an exact match isn't critical.
      const HANDBOOK_SECTION_COUNT = 43;
      const id = String(body.id || '');
      const { data: inv } = await admin.from('onboarding_invites').select('*').eq('id', id).maybeSingle();
      if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'Not found' }) };
      const { data: sub } = await admin.from('onboarding_submissions').select('*').eq('invite_id', id).maybeSingle();
      const { data: events } = await admin.from('onboarding_events').select('kind, ref, meta, created_at').eq('invite_id', id).order('created_at', { ascending: true }).limit(5000);

      const docs = await buildPacket(inv, sub, HANDBOOK_SECTION_COUNT || 43);
      const auditPdf = await buildAuditDoc(inv, sub, events || []);

      const zip = new JSZip();
      for (const d of docs) zip.file(d.name, await d.pdf.save());
      zip.file('08_Review_Audit_Log.pdf', await auditPdf.save());
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      const safeName = (inv.full_name || 'new-hire').replace(/[^a-z0-9]+/gi, '_');

      await admin.from('onboarding_events').insert([{ invite_id: id, kind: 'download', ref: 'packet_zip', meta: { by: auth.teamMemberId } }]);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, filename: `${safeName}_NSA_New_Hire_Packet.zip`, zip_base64: buf.toString('base64') }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Unknown action' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
