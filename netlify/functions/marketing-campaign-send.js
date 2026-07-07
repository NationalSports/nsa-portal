// Queue a marketing campaign for throttled delivery, or send a single test email.
//
//   POST /.netlify/functions/marketing-campaign-send
//   body: { campaign_id, action: 'send' }                — enqueue the campaign
//         { campaign_id, action: 'test', test_to: '..' } — send one rendered test now
//
// Admin-only (verifyAdmin): this is the one place marketing email leaves the
// building, so it carries the compliance machinery:
//   • HARD suppression gate — addresses on marketing_suppressions are never enqueued.
//   • Per-recipient CAN-SPAM footer (postal address from app_state company_info +
//     HMAC unsubscribe link) appended server-side; the composer can't omit it.
//   • Throttled: one scheduled_emails row per recipient with staggered send_at
//     (campaign.send_rate/hour, ≤100), delivered by the existing queue cron. No
//     direct blasting.
//   • Sender safety: refuses to send from the transactional noreply address, and
//     requires an explicit sender_email (MARKETING_SENDER_EMAIL env is the default).
//   • Idempotent: (campaign_id, email) is unique in marketing_sends — re-running
//     a partially-queued campaign only fills in the gaps.

const { verifyAdmin, getSupabaseAdmin, corsHeaders } = require('./_shared');
const { unsubUrl } = require('./_marketingShared');
const { renderTemplate, buildFooterHtml, wrapEmailHtml, throttleSchedule, normEmail } = require('../../src/lib/marketingEmail');

const MAX_RECIPIENTS = 2000;   // per-campaign safety cap for this phase
const HARD_FETCH = 8000;       // fetch ceiling; if a segment's rows reach it we can't guarantee
                               // we saw them all after de-dup, so we refuse rather than truncate silently
const CHUNK = 200;             // DB insert batch size
const BLOCKED_SENDERS = ['noreply@nationalsportsapparel.com']; // transactional identity — never for marketing

const json = (status, body) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) });

async function companyFooterParts(admin) {
  // Postal address for the CAN-SPAM footer: app_state company_info, with the
  // hardcoded company defaults as fallback (same fallback the app UI uses).
  const fallback = { name: 'National Sports Apparel', addr: '2238 N Glassell St Ste E', city: 'Orange', state: 'CA', zip: '92865' };
  let ci = fallback;
  try {
    const { data } = await admin.from('app_state').select('value').eq('id', 'company_info').maybeSingle();
    if (data && data.value) ci = { ...fallback, ...JSON.parse(data.value) };
  } catch (_) { /* fall back */ }
  const addressLine = [ci.addr, ci.city, `${ci.state} ${ci.zip}`].filter(Boolean).join(', ');
  return { companyName: ci.name || fallback.name, addressLine };
}

function resolveSender(campaign) {
  const email = normEmail(campaign.sender_email || process.env.MARKETING_SENDER_EMAIL);
  if (!email) return { error: 'No sender email. Set one on the campaign or configure MARKETING_SENDER_EMAIL.' };
  if (BLOCKED_SENDERS.includes(email)) {
    return { error: `Refusing to send marketing from the transactional address ${email}. Use the dedicated marketing sender.` };
  }
  return { email, name: campaign.sender_name || 'National Sports Apparel' };
}

async function resolveRecipients(admin, segment) {
  let q = admin.from('marketing_contacts').select('*').eq('status', 'active').not('email', 'is', null);
  if (segment && Array.isArray(segment.contact_ids) && segment.contact_ids.length) {
    q = q.in('id', segment.contact_ids.slice(0, MAX_RECIPIENTS));
  } else if (segment) {
    if (segment.section_id != null && segment.section_id !== 'all') q = q.eq('section_id', Number(segment.section_id));
    if (segment.sport && segment.sport !== 'all') q = q.eq('sport', segment.sport);
    if (segment.role && segment.role !== 'all') q = q.eq('role', segment.role);
  }
  const { data, error } = await q.limit(HARD_FETCH);
  if (error) throw new Error(error.message);
  const rows = data || [];
  // De-dupe by address (a coach can hold several roles) — first row wins.
  const byEmail = new Map();
  for (const c of rows) {
    const e = normEmail(c.email);
    if (e && !byEmail.has(e)) byEmail.set(e, { ...c, email: e });
  }
  // If we hit the fetch ceiling, some matching rows went unseen — refusing beats silently
  // dropping recipients (a segment that de-dups under the cap could otherwise mask the overflow).
  if (rows.length >= HARD_FETCH) throw new Error('SEGMENT_TOO_LARGE');
  return Array.from(byEmail.values());
}

function renderFor(campaign, contact, footerParts, campaignId) {
  const footer = buildFooterHtml({ ...footerParts, unsubUrl: unsubUrl(contact.email, campaignId) });
  const body = renderTemplate(campaign.html_body, contact, { html: true }).replace(/\n/g, '<br/>');
  return {
    subject: renderTemplate(campaign.subject, contact, { html: false }),
    html: wrapEmailHtml(body, footer),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const v = await verifyAdmin(event);
  if (!v.ok) return json(v.status, { error: v.error });
  const admin = v.admin || getSupabaseAdmin();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { campaign_id: campaignId, action } = body;
  if (!campaignId) return json(400, { error: 'campaign_id required' });

  const { data: campaign, error: cErr } = await admin.from('marketing_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (cErr) return json(500, { error: cErr.message });
  if (!campaign) return json(404, { error: 'Campaign not found' });

  const sender = resolveSender(campaign);
  if (sender.error) return json(400, { error: sender.error });
  const footerParts = await companyFooterParts(admin);

  // ── Test send: render for a real (or synthetic) contact, deliver immediately. ──
  if (action === 'test') {
    const testTo = normEmail(body.test_to);
    if (!testTo) return json(400, { error: 'test_to must be a valid email' });
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return json(500, { error: 'BREVO_API_KEY not configured' });

    let sample = null;
    try { sample = (await resolveRecipients(admin, campaign.segment))[0] || null; } catch (_) {}
    const contact = sample || { first_name: 'Test', last_name: 'Contact', email: testTo, role: 'Athletic Director', school_name: 'Sample High', school_city: 'Fresno', school_state: 'California', section_name: 'Central Section' };
    const r = renderFor(campaign, contact, footerParts, campaignId);

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: sender.name, email: sender.email },
        to: [{ email: testTo }],
        subject: `[TEST] ${r.subject}`,
        htmlContent: r.html,
        ...(campaign.reply_to ? { replyTo: { email: campaign.reply_to } } : {}),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return json(502, { error: d.message || `Brevo HTTP ${res.status}` });
    return json(200, { ok: true, test: true, messageId: d.messageId, renderedWith: sample ? 'first real recipient' : 'synthetic contact' });
  }

  // ── Real send: suppression gate → throttled enqueue. ──
  if (action !== 'send') return json(400, { error: "action must be 'send' or 'test'" });
  if (campaign.status === 'cancelled') return json(400, { error: 'Campaign is cancelled' });

  let recipients;
  try { recipients = await resolveRecipients(admin, campaign.segment); }
  catch (e) {
    if (e.message === 'SEGMENT_TOO_LARGE') return json(400, { error: `Segment is too large for one campaign in this phase (cap ${MAX_RECIPIENTS}). Narrow it by section, role, or sport.` });
    return json(500, { error: `Segment query failed: ${e.message}` });
  }
  if (recipients.length > MAX_RECIPIENTS) return json(400, { error: `Segment has over ${MAX_RECIPIENTS} recipients — narrow it for this phase.` });
  if (!recipients.length) return json(400, { error: 'Segment matches no active contacts with email' });

  // Hard gate 1: global suppression list.
  const emails = recipients.map((r) => r.email);
  const suppressed = new Set();
  for (let i = 0; i < emails.length; i += CHUNK) {
    const { data, error } = await admin.from('marketing_suppressions').select('email').in('email', emails.slice(i, i + CHUNK));
    if (error) return json(500, { error: `Suppression check failed: ${error.message}` });
    (data || []).forEach((r) => suppressed.add(r.email));
  }
  // Hard gate 2: already sent/queued in THIS campaign (idempotent re-run).
  const already = new Set();
  {
    const { data, error } = await admin.from('marketing_sends').select('email').eq('campaign_id', campaignId);
    if (error) return json(500, { error: error.message });
    (data || []).forEach((r) => already.add(String(r.email).toLowerCase()));
  }

  const toSend = recipients.filter((r) => !suppressed.has(r.email) && !already.has(r.email));
  if (!toSend.length) {
    return json(200, { ok: true, queued: 0, suppressed: suppressed.size, alreadyQueued: already.size, note: 'Nothing new to queue' });
  }

  const sendAts = throttleSchedule(toSend.length, Date.now(), campaign.send_rate);
  let queued = 0;
  for (let i = 0; i < toSend.length; i += CHUNK) {
    const slice = toSend.slice(i, i + CHUNK);
    const schedRows = slice.map((contact, k) => {
      const r = renderFor(campaign, contact, footerParts, campaignId);
      return {
        send_at: sendAts[i + k],
        to_emails: [{ email: contact.email, name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined }],
        subject: r.subject,
        html_content: r.html,
        sender_name: sender.name,
        sender_email: sender.email,
        reply_to: campaign.reply_to ? { email: campaign.reply_to } : null,
        related_type: 'marketing',
        related_id: campaignId,
        created_by: v.userId || 'marketing',
      };
    });
    const { data: inserted, error: insErr } = await admin.from('scheduled_emails').insert(schedRows).select('id');
    if (insErr) return json(500, { error: `Queue insert failed after ${queued} queued: ${insErr.message}` });
    const sendRows = slice.map((contact, k) => ({
      campaign_id: campaignId,
      contact_id: contact.id || null,
      email: contact.email,
      scheduled_email_id: inserted && inserted[k] ? inserted[k].id : null,
      status: 'queued',
    }));
    const { error: msErr } = await admin.from('marketing_sends').upsert(sendRows, { onConflict: 'campaign_id,email', ignoreDuplicates: true });
    if (msErr) {
      // The queue rows are already committed and WOULD send — but with no send-log guard, a retry
      // (which skips only addresses already in marketing_sends) would re-queue them → double-send.
      // Roll the queue insert back so the address stays un-queued and a retry is clean.
      await admin.from('scheduled_emails').delete().in('id', (inserted || []).map((r) => r.id));
      return json(500, { error: `Send-log insert failed (queue rolled back, safe to retry): ${msErr.message}` });
    }
    queued += slice.length;
  }

  const counts = { recipients: recipients.length, suppressed: suppressed.size, alreadyQueued: already.size, queued };
  await admin.from('marketing_campaigns').update({
    status: 'sending',
    send_started_at: new Date().toISOString(),
    counts,
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId);

  const hours = Math.ceil(queued / Math.max(1, Math.min(100, campaign.send_rate || 60)));
  return json(200, { ok: true, ...counts, estimatedHours: hours });
};
