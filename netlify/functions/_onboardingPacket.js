// Shared builder for the new-hire packet PDFs + ZIP. Used by both
// onboarding-admin.js (HR on-demand download) and
// onboarding-finalize-background.js (auto email + Drive on submit), so the
// packet is identical no matter who triggers it.
const { renderDocument, fmtDate, fmtDateTime } = require('./_onboardingPdf');
const { decryptField, maskTail } = require('./_onboardingCrypto');

const HANDBOOK_SECTION_COUNT = 43; // keep in sync with src/onboardingHandbook.js
const yn = (v) => (v ? 'Yes' : 'No');

// Mirror of formatPayComponents in src/onboardingForms.js (kept in sync by hand;
// frontend is ESM, functions are CJS). Pay can stack, so we summarize the set.
const _money = (a) => { const n = Number(String(a).replace(/[^0-9.]/g, '')); return isNaN(n) ? String(a || '') : '$' + n.toLocaleString(); };
function formatPayComponents(components) {
  if (!Array.isArray(components) || !components.length) return '';
  return components.map((c) => {
    if (!c || !c.type) return '';
    if (c.type === 'commission') return `Commission (${c.basis || 'see agreement'})`;
    if (c.type === 'hourly') return `${_money(c.amount)}/hr`;
    if (c.type === 'draw') return `${_money(c.amount)}/${c.period || 'month'} draw${c.recoverable ? ' (recoverable)' : ''}`;
    if (c.type === 'salary') return `Salary ${_money(c.amount)}/${c.period || 'year'}`;
    if (c.type === 'flat_1099') return `1099 ${_money(c.amount)}${c.period ? '/' + c.period : ''}`;
    if (c.type === 'bonus') return `Bonus ${_money(c.amount)}${c.period ? '/' + c.period : ''}`;
    return `${c.type} ${_money(c.amount)}`;
  }).filter(Boolean).join('  +  ');
}

async function buildPacket(invite, sub, handbookCount = HANDBOOK_SECTION_COUNT) {
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

  // 00 — Electronic consent + CPRA notice acknowledgment
  docs.push({
    name: '00_Electronic_Consent_and_Privacy.pdf',
    pdf: await renderDocument({
      title: 'Electronic Records Consent & Privacy Notice',
      blocks: [
        { type: 'heading', text: 'Electronic signature consent (ESIGN Act / CA UETA)' },
        { type: 'para', text: 'I agreed to complete my new-hire paperwork electronically and to use a typed signature as my legal, binding signature on these documents, and acknowledged I may request paper copies.' },
        { type: 'field', label: 'Consent given', value: ack['consent:esign'] ? fmtDateTime(ack['consent:esign'].at) : 'Not recorded' },
        { type: 'rule' },
        { type: 'heading', text: 'California Notice at Collection (CPRA)' },
        { type: 'para', text: 'I received the Notice at Collection describing the categories of personal information collected (identifiers including SSN/DOB, financial account information, and employment information) and the purposes for which it is used.' },
        { type: 'field', label: 'Notice acknowledged', value: ack['consent:privacy'] ? fmtDateTime(ack['consent:privacy'].at) : 'Not recorded' },
      ],
    }),
  });

  // 00b — Wage Theft Prevention Notice (Labor Code 2810.5), filled
  const emp = {
    name: process.env.EMPLOYER_LEGAL_NAME || 'National Sports Apparel, LLC',
    address: process.env.EMPLOYER_ADDRESS || '',
    phone: process.env.EMPLOYER_PHONE || '',
    wc: process.env.WORKERS_COMP_CARRIER || '',
  };
  const payRows = (Array.isArray(invite.pay_components) && invite.pay_components.length)
    ? invite.pay_components.map((c, i) => ({ type: 'field', label: `Rate ${i + 1}`, value: formatPayComponents([c]) }))
    : [{ type: 'field', label: 'Rate', value: invite.pay_rate }];
  docs.push({
    name: '00b_Wage_Theft_Prevention_Notice.pdf',
    pdf: await renderDocument({
      title: 'Notice to Employee', subtitle: 'California Labor Code § 2810.5 (Wage Theft Prevention Act)',
      blocks: [
        { type: 'heading', text: 'Employee' },
        { type: 'field', label: 'Name', value: p.full_name || invite.full_name },
        { type: 'field', label: 'Start Date', value: fmtDate(invite.hire_date) },
        { type: 'heading', text: 'Rate(s) of Pay' },
        ...payRows,
        { type: 'field', label: 'Overtime Rate (if non-exempt)', value: 'Per California law (1.5× / 2× regular rate as applicable)' },
        { type: 'field', label: 'Regular Payday', value: process.env.EMPLOYER_PAYDAY || 'As posted by the employer' },
        { type: 'field', label: 'Allowances claimed against minimum wage', value: 'None' },
        { type: 'heading', text: 'Employer' },
        { type: 'field', label: 'Legal Name', value: emp.name },
        { type: 'field', label: 'Address', value: emp.address },
        { type: 'field', label: 'Phone', value: emp.phone },
        { type: 'heading', text: "Workers' Compensation" },
        { type: 'field', label: 'Insurance Carrier', value: emp.wc },
        { type: 'spacer', h: 10 },
        { type: 'para', text: 'This notice is provided under California Labor Code section 2810.5. The employee acknowledged receipt as part of the California notices step.' },
        { type: 'field', label: 'Acknowledged', value: ack['ca:wage_theft'] ? fmtDateTime(ack['ca:wage_theft'].at) : 'See CA notices acknowledgment' },
      ],
    }),
  });

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
        { type: 'field', label: 'Compensation', value: formatPayComponents(invite.pay_components) || [invite.pay_type, invite.pay_rate].filter(Boolean).join(' — ') },
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

  const fed = tax.federal || {}; const de4 = tax.ca_de4 || {};
  docs.push({
    name: '04_Tax_Withholding_W4_DE4.pdf',
    pdf: await renderDocument({
      title: 'Substitute Form W-4 and Form DE 4', subtitle: 'Employee’s Withholding Certificates — Federal (IRS W-4) and California (EDD DE 4)',
      blocks: [
        { type: 'field', label: 'Employee Name', value: p.full_name || invite.full_name },
        { type: 'field', label: 'Social Security Number', value: ssn ? maskTail(ssn) + '  (full SSN on file, encrypted)' : '—' },
        { type: 'field', label: 'Address', value: [p.street, p.city, p.state, p.zip].filter(Boolean).join(', ') },
        { type: 'rule' },
        { type: 'heading', text: 'Federal — IRS Form W-4 (Employee’s Withholding Certificate)' },
        { type: 'field', label: 'Step 1(c) Filing Status', value: fed.filing_status },
        { type: 'field', label: 'Step 2 Multiple Jobs / Spouse Works', value: yn(fed.multiple_jobs) },
        { type: 'field', label: 'Step 3 Dependents Amount', value: fed.dependents_amount },
        { type: 'field', label: 'Step 4(a) Other Income', value: fed.other_income },
        { type: 'field', label: 'Step 4(b) Deductions', value: fed.deductions },
        { type: 'field', label: 'Step 4(c) Extra Withholding', value: fed.extra_withholding },
        { type: 'field', label: 'Claims Exemption (writes "Exempt")', value: yn(fed.exempt) },
        { type: 'rule' },
        { type: 'heading', text: 'California — EDD Form DE 4 (Employee’s Withholding Allowance Certificate)' },
        { type: 'field', label: 'Filing Status', value: de4.filing_status },
        { type: 'field', label: 'Regular Withholding Allowances', value: de4.allowances },
        { type: 'field', label: 'Additional Amount to Withhold', value: de4.extra },
        { type: 'field', label: 'Claims Exemption', value: yn(de4.exempt) },
        { type: 'spacer', h: 10 },
        { type: 'para', text: 'Certification: Under penalties of perjury, I declare that I have examined this certificate and, to the best of my knowledge and belief, it is true, correct, and complete. I understand these are substitute Form W-4 and Form DE 4 certificates containing the same information requested on the official forms.' },
        sigLine('tax_w4'),
        { type: 'spacer', h: 6 },
        { type: 'para', text: 'Note to payroll: retain alongside the official IRS W-4 / EDD DE 4 if your payroll system requires the original form.' },
      ],
    }),
  });

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

  const hbAcks = Object.keys(ack).filter((k) => k.startsWith('handbook:') && k !== 'handbook:all').length;
  docs.push({
    name: '06_Handbook_Acknowledgment.pdf',
    pdf: await renderDocument({
      title: 'Employee Handbook Acknowledgment', subtitle: 'National Sports Apparel Employee Handbook (2025)',
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

// Build every PDF as { name, bytes:Uint8Array }.
async function buildPacketFiles(invite, sub, events) {
  const docs = await buildPacket(invite, sub);
  const audit = await buildAuditDoc(invite, sub, events || []);
  const files = [];
  for (const d of docs) files.push({ name: d.name, bytes: await d.pdf.save() });
  files.push({ name: '08_Review_Audit_Log.pdf', bytes: await audit.save() });
  return files;
}

function safeName(s) { return String(s || 'new-hire').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, ''); }

async function zipFiles(files) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildPacket, buildAuditDoc, buildPacketFiles, zipFiles, safeName, formatPayComponents, HANDBOOK_SECTION_COUNT };
