// Pure helpers for the marketing send pipeline (Phase 2 of the CIFCS → Brevo
// module). No network, no crypto, no Date.now — the Netlify functions supply
// those — so this stays unit-testable and importable anywhere.
//
// The pieces here are the compliance-critical ones: merge-field rendering with
// HTML escaping, the CAN-SPAM footer (postal address + unsubscribe link), the
// branded wrapper, and the throttle schedule that staggers send_at timestamps
// so a campaign drips through the scheduled_emails queue instead of blasting.

// Merge fields available in subject + body. Keys are marketing_contacts columns.
const MERGE_FIELDS = [
  'first_name', 'last_name', 'email', 'role', 'sport',
  'school_name', 'school_city', 'school_state', 'section_name',
];

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Replace {{field}} tokens with the contact's values. Unknown fields render ''.
// `html` controls escaping: true for the body, false for the subject line.
function renderTemplate(template, contact, { html = true } = {}) {
  const c = contact || {};
  return String(template == null ? '' : template).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name) => {
    const key = name.toLowerCase();
    if (!MERGE_FIELDS.includes(key)) return '';
    const v = c[key] == null ? '' : String(c[key]);
    return html ? escapeHtml(v) : v;
  });
}

// CAN-SPAM footer: identifies the sender, shows a real postal address, and
// carries a working one-click unsubscribe. Every marketing email gets this
// appended server-side — the composer cannot omit it.
function buildFooterHtml({ companyName, addressLine, unsubUrl }) {
  return (
    '<div style="margin-top:32px;padding-top:14px;border-top:1px solid #E7DFD0;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#6B6256;">' +
    `<div>${escapeHtml(companyName)} &middot; ${escapeHtml(addressLine)}</div>` +
    '<div>You are receiving this because your contact info is listed in the public CIFCS school directory. ' +
    `<a href="${unsubUrl}" style="color:#6B6256;text-decoration:underline;">Unsubscribe</a> ` +
    'and we will never email you again.</div>' +
    '</div>'
  );
}

// Minimal branded shell (email palette: navy #16223F / gold #B6985A, matching
// the rep digests). Body HTML goes inside; footer is appended by the caller.
function wrapEmailHtml(bodyHtml, footerHtml) {
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF6EF;">' +
    '<div style="max-width:640px;margin:0 auto;padding:24px 16px;">' +
    '<div style="background:#16223F;border-radius:8px 8px 0 0;padding:14px 20px;">' +
    '<span style="font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:16px;color:#ffffff;letter-spacing:1px;">NATIONAL SPORTS APPAREL</span>' +
    '<span style="display:block;height:3px;background:#B6985A;margin-top:10px;"></span>' +
    '</div>' +
    '<div style="background:#ffffff;border:1px solid #E7DFD0;border-top:none;border-radius:0 0 8px 8px;padding:24px 20px;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#2A2F3E;">' +
    bodyHtml +
    footerHtml +
    '</div></div></body></html>'
  );
}

// Stagger `count` send_at timestamps starting at startMs, at ratePerHour.
// The first goes out immediately; the queue cron (25 per 15 min) is the outer
// ceiling, this is the campaign's own pace. Returns ISO strings.
function throttleSchedule(count, startMs, ratePerHour) {
  const rate = Math.max(1, Math.min(100, Number(ratePerHour) || 60));
  const stepMs = Math.ceil(3600000 / rate);
  const out = [];
  for (let i = 0; i < count; i++) out.push(new Date(startMs + i * stepMs).toISOString());
  return out;
}

function normEmail(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

module.exports = { MERGE_FIELDS, escapeHtml, renderTemplate, buildFooterHtml, wrapEmailHtml, throttleSchedule, normEmail };
