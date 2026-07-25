const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

function summarizeAssets(rows) {
  const summary = { total: 0, review: 0, approved: 0, failed: 0 };
  (rows || []).forEach((row) => {
    summary.total++;
    if (row.status === 'review' && row.approval_status !== 'approved') summary.review++;
    if (row.status === 'approved' && row.approval_status === 'approved') summary.approved++;
    if (row.status === 'failed') summary.failed++;
  });
  return summary;
}

function buildShowcaseReviewEmail({ store, rep, summary, reviewUrl }) {
  const hasFailures = summary.failed > 0;
  const subject = hasFailures
    ? `Showcase generation finished with ${summary.failed} issue${summary.failed === 1 ? '' : 's'} — ${store.name}`
    : `Showcase images ready for review — ${store.name}`;
  const reviewLine = summary.review
    ? `<strong>${summary.review}</strong> image${summary.review === 1 ? ' is' : 's are'} ready for review.`
    : 'There are no new images waiting for review.';
  const failureLine = hasFailures
    ? `<p style="margin:8px 0 0;color:#b91c1c"><strong>${summary.failed}</strong> product${summary.failed === 1 ? '' : 's'} failed to generate and may need to be retried.</p>`
    : '';
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;color:#1e293b">
    <div style="background:#0f172a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;opacity:.75">National Sports Apparel</div>
      <div style="font-size:21px;font-weight:800;margin-top:5px">Showcase generation complete</div>
    </div>
    <div style="padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
      <p style="margin:0 0 14px">Hi ${esc(rep.name || 'there')},</p>
      <p style="margin:0 0 8px">Showcase image generation for <strong>${esc(store.name)}</strong> has finished.</p>
      <p style="margin:0">${reviewLine}</p>
      ${failureLine}
      <a href="${esc(reviewUrl)}" style="display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Review Showcase images</a>
      <p style="font-size:12px;color:#64748b;line-height:1.5;margin:18px 0 0">Every image must be approved before it can replace the Standard product image for shoppers.</p>
    </div>
  </div>`;
  return { subject, html };
}

async function markShowcaseBatchPending(admin, storeId, batchId) {
  const { error } = await admin
    .from('webstores')
    .update({
      showcase_generation_batch_id: batchId,
      showcase_review_notification_status: 'pending',
      showcase_review_notified_at: null,
      showcase_review_notified_to: null,
      showcase_review_notification_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storeId);
  if (error) throw new Error(error.message);
}

async function notifyShowcaseReady(admin, storeId, portalBase) {
  const { data: active, error: activeError } = await admin
    .from('webstore_showcase_assets')
    .select('id')
    .eq('store_id', storeId)
    .in('status', ['queued', 'generating'])
    .limit(1);
  if (activeError) throw new Error(activeError.message);
  if (active?.length) return { sent: false, reason: 'active-jobs' };

  const { data: store, error: storeError } = await admin
    .from('webstores')
    .select('id,name,slug,rep_id,showcase_generation_batch_id,showcase_review_notification_status')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError) throw new Error(storeError.message);
  if (!store?.showcase_generation_batch_id || store.showcase_review_notification_status !== 'pending') {
    return { sent: false, reason: 'not-pending' };
  }

  const batchId = store.showcase_generation_batch_id;
  const { data: claimed, error: claimError } = await admin
    .from('webstores')
    .update({
      showcase_review_notification_status: 'sending',
      showcase_review_notification_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storeId)
    .eq('showcase_generation_batch_id', batchId)
    .eq('showcase_review_notification_status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { sent: false, reason: 'already-claimed' };

  try {
    const [{ data: rep, error: repError }, { data: assets, error: assetsError }] = await Promise.all([
      admin.from('team_members').select('id,name,email,is_active').eq('id', store.rep_id).maybeSingle(),
      admin.from('webstore_showcase_assets').select('status,approval_status').eq('store_id', storeId),
    ]);
    if (repError) throw new Error(repError.message);
    if (assetsError) throw new Error(assetsError.message);
    if (!rep || rep.is_active === false || !EMAIL_RE.test(String(rep.email || '').trim())) {
      throw new Error('Assigned store rep does not have an active valid email address');
    }

    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
    if (!brevoKey) throw new Error('BREVO_API_KEY is not configured');

    let base;
    try {
      base = new URL(portalBase || process.env.PORTAL_PUBLIC_URL || process.env.URL);
    } catch (_) {
      throw new Error('Portal review URL is unavailable');
    }
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Portal review URL is invalid');
    const reviewUrl = `${base.origin}/?pg=webstores&store=${encodeURIComponent(store.id)}&tab=appearance`;
    const summary = summarizeAssets(assets);
    const email = buildShowcaseReviewEmail({ store, rep, summary, reviewUrl });
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': brevoKey,
      },
      body: JSON.stringify({
        sender: { name: 'NSA Portal', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: rep.email, name: rep.name || '' }],
        subject: email.subject,
        htmlContent: email.html,
      }),
    });
    if (!response.ok) {
      const providerMessage = await response.text().catch(() => '');
      throw new Error(`Brevo email failed (${response.status})${providerMessage ? `: ${providerMessage.slice(0, 300)}` : ''}`);
    }

    const notifiedAt = new Date().toISOString();
    const { error: sentError } = await admin
      .from('webstores')
      .update({
        showcase_review_notification_status: 'sent',
        showcase_review_notified_at: notifiedAt,
        showcase_review_notified_to: rep.email,
        showcase_review_notification_error: null,
        updated_at: notifiedAt,
      })
      .eq('id', storeId)
      .eq('showcase_generation_batch_id', batchId)
      .eq('showcase_review_notification_status', 'sending');
    if (sentError) throw new Error(sentError.message);
    return { sent: true, to: rep.email, summary };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1200);
    const { error: recordError } = await admin
      .from('webstores')
      .update({
        showcase_review_notification_status: 'failed',
        showcase_review_notification_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId)
      .eq('showcase_generation_batch_id', batchId)
      .eq('showcase_review_notification_status', 'sending');
    if (recordError) console.error('[showcase-email] failed to record delivery error', recordError.message);
    throw error;
  }
}

module.exports = {
  summarizeAssets,
  buildShowcaseReviewEmail,
  markShowcaseBatchPending,
  notifyShowcaseReady,
};
