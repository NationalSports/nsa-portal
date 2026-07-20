// Transactional email for the custom-uniform lifecycle. The caller always
// passes a database row; customer-supplied HTML is escaped before rendering.
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const LABELS = {
  submitted: 'Order received',
  rep_review: 'Rep review',
  proof_ready: 'Proof ready',
  changes_requested: 'Changes requested',
  approved: 'Proof approved',
  production: 'In production',
  quality_check: 'Quality check',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function statusUrl(order) {
  const root = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  return `${root}/uniform-builder?order=${encodeURIComponent(order.order_number)}&token=${encodeURIComponent(order.public_token)}`;
}

async function deliver(payload) {
  const key = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!key) return { sent: false, reason: 'not_configured' };
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': key },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Brevo ${response.status}: ${await response.text()}`);
  return { sent: true };
}

function shell(order, heading, body, buttonLabel = 'View order status') {
  const link = statusUrl(order);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#27324a;max-width:600px;margin:0 auto">
    <div style="background:#192853;color:#fff;padding:22px 26px;border-radius:10px 10px 0 0">
      <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;opacity:.78">National Sports Apparel · Custom Uniforms</div>
      <div style="font-size:24px;font-weight:800;margin-top:6px">${esc(heading)}</div>
      <div style="font-size:13px;opacity:.82;margin-top:6px">Order ${esc(order.order_number)} · ${esc(order.team_name)}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:24px 26px">
      ${body}
      <a href="${esc(link)}" style="display:inline-block;margin-top:18px;background:#a62b32;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:800">${esc(buttonLabel)}</a>
      <p style="font-size:12px;color:#8490a5;margin:18px 0 0">Save this email. The button above is your private order-status link.</p>
    </div>
  </div>`;
}

async function sendCustomerEmail(order, kind, context = {}) {
  if (!order.contact_email) return { sent: false, reason: 'no_email' };
  const status = LABELS[order.production_status] || order.production_status || 'Order update';
  const note = context.note ? `<div style="background:#f6f8fb;border-left:3px solid #a62b32;padding:12px 14px;margin:14px 0;font-size:14px;line-height:1.5">${esc(context.note)}</div>` : '';
  const copy = {
    confirmation: `We received your custom uniform order. Your rep will review the design, roster, pricing, and production details before sending a proof for approval.`,
    proof_ready: `Proof version ${order.proof_version} is ready. Please review it carefully, then approve it or request changes from your order-status page.`,
    approved: `Your approval for proof version ${order.approved_proof_version || order.proof_version} is recorded. We will lock the approved specifications before production begins.`,
    changes_requested: `Your change request is recorded. Your rep will revise the proof and send a new version for approval.`,
    production: `Your approved order is now in production. Its design, roster, and pricing are locked to the approved proof.`,
    quality_check: `Production is complete and your uniforms are in final quality check.`,
    shipped: `Your uniforms have shipped${order.tracking_number ? ` via ${esc(order.carrier || 'the carrier')}. Tracking: <strong>${esc(order.tracking_number)}</strong>` : '.'}`,
    delivered: `Your uniform order has been marked delivered. You can use the private order page to create a reorder from the approved specifications.`,
    cancelled: `This order has been cancelled. Please contact your rep if you have questions.`,
    payment: `Your payment status is now <strong>${esc(String(order.payment_status || '').replace(/_/g, ' '))}</strong>.`,
  }[kind] || `Your order moved to <strong>${esc(status)}</strong>.`;
  return deliver({
    sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
    to: [{ email: order.contact_email, name: order.contact_name || '' }],
    replyTo: { email: process.env.UNIFORM_ORDER_EMAIL || 'steve@nationalsportsapparel.com' },
    subject: `${status} · ${order.order_number} · ${order.team_name}`,
    htmlContent: shell(order, status, `<p style="font-size:15px;line-height:1.6;margin:0">${copy}</p>${note}`),
  });
}

async function sendStaffEmail(order, kind, context = {}) {
  const staff = process.env.UNIFORM_ORDER_EMAIL || process.env.CATALOG_ORDER_EMAIL || 'steve@nationalsportsapparel.com';
  const heading = kind === 'confirmation' ? 'New custom uniform order' : `Uniform order update: ${LABELS[order.production_status] || kind}`;
  const note = context.note ? `<p><strong>Note:</strong> ${esc(context.note)}</p>` : '';
  const total = Number(order.total || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  return deliver({
    sender: { name: 'NSA Uniform Builder', email: 'noreply@nationalsportsapparel.com' },
    to: [{ email: staff }],
    replyTo: order.contact_email ? { email: order.contact_email, name: order.contact_name || '' } : undefined,
    subject: `${heading} · ${order.order_number} · ${order.team_name}`,
    htmlContent: shell(order, heading, `<p style="font-size:14px;line-height:1.6;margin:0"><strong>${esc(order.contact_name)}</strong> · ${esc(order.contact_email)}<br>${esc(order.total_qty)} jerseys · ${esc(total)}<br>Payment: ${esc(String(order.payment_status || '').replace(/_/g, ' '))}</p>${note}`, 'Open order'),
  });
}

module.exports = { sendCustomerEmail, sendStaffEmail, statusUrl };
