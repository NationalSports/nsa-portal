// Netlify function: auto-responder for the hello@nationalsportsapparel.com inbox.
//
// Wire-up (see EMAIL_AUTORESPONDER_SETUP.md): Gmail auto-forwards hello@ mail to a
// Brevo inbound-parse address; Brevo POSTs each parsed email here. We classify it
// (Claude Haiku), and only the team-store lanes ever get an automatic reply:
//
//   status  — "where is my order?"  → order number in subject/body, or sender
//             matches buyer_email → reply with stage, tracking, est. ship date,
//             and the private /shop/order/<token> page. No identifier at all →
//             ask for the order number (their reply re-enters this pipeline).
//             Number given but not in DB → tell them a human will follow up +
//             alert staff (never loop asking again).
//   problem — missing/wrong/damaged/refund/cancel → short human-tone
//             acknowledgment (+ order link when resolvable) + staff alert.
//   other / automated — POs, quotes, applications, spam, bounces: never replied
//             to, only logged. Silence beats a wrong bot reply.
//
// Safety rails: shared-secret query param; skips our own domain (portal alerts CC
// hello@ and live replies BCC it — both must not re-trigger), no-reply senders and
// auto-submitted mail; idempotent per Message-Id; max 2 auto-replies per sender
// per 3 days; kill switch. AUTORESPONDER_MODE=shadow (default) sends every
// would-be reply to staff instead of the customer.
//
// POST /.netlify/functions/hello-inbound?key=<HELLO_INBOUND_KEY>
// Env: SUPABASE_URL/REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      BREVO_API_KEY, HELLO_INBOUND_KEY, ANTHROPIC_API_KEY (optional but recommended),
//      AUTORESPONDER_MODE (shadow|live|off, default shadow),
//      AUTORESPONDER_SHADOW_TO / AUTORESPONDER_ALERT_TO (default steve@),
//      AUTORESPONDER_FROM (default hello@), TEAM_STORE_TURNAROUND_DAYS (default 21),
//      PORTAL_PUBLIC_URL
const { createClient } = require('@supabase/supabase-js');
const { extractOrderNumbers, findOrders, summarizeOrder } = require('./_orderInquiry');

const INTERNAL_DOMAIN = 'nationalsportsapparel.com';
const NO_REPLY_RE = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notification|notifications|alert|alerts)([+.@-]|$)/i;

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const secret = process.env.HELLO_INBOUND_KEY;
  if (!secret || (event.queryStringParameters || {}).key !== secret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Bad key' }) };
  }

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  // Brevo inbound posts { items: [...] }; accept a bare single item too (tests).
  const items = Array.isArray(body.items) ? body.items : [body];

  const results = [];
  for (const item of items) {
    try { results.push(await processEmail(sb, normalizeInbound(item))); }
    catch (e) {
      console.error('[hello-inbound] item failed:', e);
      results.push({ action: 'error', error: e.message });
    }
  }
  // Always 200 so Brevo doesn't retry a permanently-unprocessable email forever.
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, results }) };
};

// Brevo's inbound payload uses Capitalized keys (From.Address, RawTextBody, ...).
// Normalize defensively so a payload-shape drift degrades instead of crashing.
function normalizeInbound(item) {
  const pick = (...vals) => vals.find((v) => v != null && v !== '');
  const from = item.From || item.from || {};
  const hdrs = item.Headers || item.headers || {};
  const hdr = (name) => {
    const k = Object.keys(hdrs).find((h) => h.toLowerCase() === name.toLowerCase());
    const v = k ? hdrs[k] : null;
    return Array.isArray(v) ? v[0] : v;
  };
  const text = pick(item.RawTextBody, item.ExtractedMarkdownMessage, item.rawTextBody, item.text)
    || String(pick(item.RawHtmlBody, item.rawHtmlBody, item.html) || '').replace(/<[^>]+>/g, ' ');
  return {
    messageId: pick(item.MessageId, item.messageId, hdr('message-id')) || null,
    fromEmail: String(pick(from.Address, from.address, from.email, item.fromEmail) || '').trim().toLowerCase(),
    fromName: pick(from.Name, from.name, '') || '',
    subject: String(pick(item.Subject, item.subject) || '').trim(),
    text: String(text || '').trim(),
    autoSubmitted: (hdr('auto-submitted') || '').toLowerCase(),
    precedence: (hdr('precedence') || '').toLowerCase(),
  };
}

async function processEmail(sb, mail) {
  const mode = (process.env.AUTORESPONDER_MODE || 'shadow').toLowerCase();
  const log = async (fields) => {
    await sb.from('email_auto_replies').update({ ...fields, mode }).eq('id', logId);
  };

  // ── Hard skips (never reply, never call the classifier) ──────────────
  const local = mail.fromEmail.split('@')[0] || '';
  const skip =
    !mail.fromEmail ? 'no_sender'
    : mail.fromEmail.endsWith('@' + INTERNAL_DOMAIN) ? 'internal_sender'
    : NO_REPLY_RE.test(local) ? 'noreply_sender'
    : (mail.autoSubmitted && mail.autoSubmitted !== 'no') ? 'auto_submitted'
    : ['bulk', 'junk', 'list'].includes(mail.precedence) ? 'bulk_precedence'
    : mode === 'off' ? 'responder_off'
    : null;

  // Idempotency: one row per inbound message; a webhook retry lands on the
  // unique index and we bail without acting twice.
  const messageId = mail.messageId || `synthetic:${mail.fromEmail}:${mail.subject}:${mail.text.slice(0, 80)}`;
  const { data: ins, error: insErr } = await sb.from('email_auto_replies').insert({
    inbound_message_id: messageId,
    from_email: mail.fromEmail,
    subject: mail.subject.slice(0, 300),
    snippet: mail.text.slice(0, 500),
    action: 'processing',
    mode,
  }).select('id');
  if (insErr) {
    if (insErr.code === '23505') return { action: 'duplicate', messageId };
    throw new Error(insErr.message);
  }
  const logId = ins[0].id;

  if (skip) { await log({ action: 'skipped_' + skip }); return { action: 'skipped_' + skip }; }

  // Rate limit: never auto-reply to the same sender more than twice in 3 days.
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const { count } = await sb.from('email_auto_replies')
    .select('id', { count: 'exact', head: true })
    .eq('from_email', mail.fromEmail)
    .gte('created_at', cutoff)
    .like('action', 'replied%');
  if ((count || 0) >= 2) { await log({ action: 'skipped_rate_limited' }); return { action: 'skipped_rate_limited' }; }

  // ── Classify ─────────────────────────────────────────────────────────
  const regexNumbers = extractOrderNumbers(mail.subject + '\n' + mail.text);
  const cls = await classify(mail, regexNumbers);
  const numbers = [...new Set([...(cls.order_numbers || []), ...regexNumbers])];

  if (cls.lane === 'other' || cls.lane === 'automated') {
    await log({ action: 'ignored_' + cls.lane, lane: cls.lane, order_numbers: numbers });
    return { action: 'ignored_' + cls.lane };
  }

  // ── Resolve orders ───────────────────────────────────────────────────
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  const turnaround = Number(process.env.TEAM_STORE_TURNAROUND_DAYS) || 21;
  const { matches, matchedBy, unmatchedNumbers } = await findOrders(sb, { numbers, email: mail.fromEmail });
  const summaries = matches.map((m) => summarizeOrder(m, { turnaroundDays: turnaround, portalUrl }));

  // ── Decide + send ────────────────────────────────────────────────────
  let action, subject, html;
  const firstName = (mail.fromName || summaries[0]?.buyerName || '').split(' ')[0] || 'there';

  if (cls.lane === 'problem') {
    action = 'replied_problem_ack';
    subject = 'Re: ' + (mail.subject || 'your order');
    html = problemAckHtml({ firstName, summaries });
    await sendStaffAlert(mail, summaries, 'Customer reported a problem with an order');
  } else if (summaries.length) {
    action = 'replied_status';
    subject = 'Re: ' + (mail.subject || 'your order status');
    html = statusHtml({ firstName, summaries, matchedBy });
  } else if (numbers.length) {
    // They gave us a number we can't find — a human needs to look; don't loop.
    action = 'replied_number_not_found';
    subject = 'Re: ' + (mail.subject || 'your order');
    html = notFoundHtml({ firstName, numbers });
    await sendStaffAlert(mail, [], `Order number(s) not found in portal: ${unmatchedNumbers.join(', ')}`);
  } else {
    action = 'replied_asked_for_number';
    subject = 'Re: ' + (mail.subject || 'your order');
    html = askForNumberHtml({ firstName });
  }

  const sent = await sendReply({ mail, subject, html, mode });
  await log({ action: (mode === 'shadow' ? 'shadow_' : '') + action, lane: cls.lane, order_numbers: numbers, matched_order_ids: matches.map((m) => m.order.id), reply_to_email: sent.to, error: sent.error || null });
  return { action, mode, to: sent.to };
}

// ── Classification ──────────────────────────────────────────────────────
// Claude Haiku sorts the email into a lane and confirms order numbers. Falls
// back to keyword heuristics when the key is missing or the call fails.
async function classify(mail, regexNumbers) {
  const fallback = () => {
    const t = (mail.subject + ' ' + mail.text).toLowerCase();
    const problem = /missing|wrong (item|size)|damaged|defect|refund|cancel|exchange|not included|broken/.test(t);
    const statusy = /status|track|where|eta|when|ship|arriv|deliver|receive/.test(t);
    if (problem) return { lane: 'problem', order_numbers: regexNumbers };
    if (statusy || regexNumbers.length) return { lane: 'status', order_numbers: regexNumbers };
    return { lane: 'other', order_numbers: regexNumbers };
  };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback();
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: 'You triage inbound email for National Sports Apparel (custom team apparel; parents buy from team web stores). Classify the email and extract order numbers. Reply with ONLY a JSON object: {"lane":"status|problem|other|automated","order_numbers":["..."]}.\n- status: sender asks where their order is, its ETA, tracking, or whether it shipped.\n- problem: sender reports an issue with an order they placed or received — missing/wrong/damaged items, refunds, cancellations, size exchanges.\n- other: any other human business email (quotes, purchase orders, invoices, partnerships, job applications, general questions).\n- automated: newsletters, system notifications, receipts, bounces, marketing/spam.\norder_numbers: numbers the sender presents as THEIR order number (6-10 digits, from subject or body, no "#"). Exclude phone numbers, zips, PO/reference numbers of other companies, and tracking numbers (12+ digits).',
        messages: [{ role: 'user', content: `From: ${mail.fromName} <${mail.fromEmail}>\nSubject: ${mail.subject}\n\n${mail.text.slice(0, 4000)}` }],
      }),
    });
    if (!resp.ok) return fallback();
    const j = await resp.json();
    const txt = (j.content || []).map((c) => c.text || '').join('');
    const parsed = JSON.parse((txt.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    if (!['status', 'problem', 'other', 'automated'].includes(parsed.lane)) return fallback();
    return { lane: parsed.lane, order_numbers: (parsed.order_numbers || []).map(String).filter((n) => /^\d{6,10}$/.test(n)) };
  } catch (e) {
    console.warn('[hello-inbound] classifier failed, using fallback:', e.message);
    return fallback();
  }
}

// ── Sending ─────────────────────────────────────────────────────────────
async function sendReply({ mail, subject, html, mode }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return { to: null, error: 'BREVO_API_KEY not configured' };
  const fromAddr = process.env.AUTORESPONDER_FROM || 'hello@nationalsportsapparel.com';
  const shadowTo = process.env.AUTORESPONDER_SHADOW_TO || 'steve@nationalsportsapparel.com';
  const shadow = mode !== 'live';
  const to = shadow ? shadowTo : mail.fromEmail;
  const finalHtml = shadow
    ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:13px;font-weight:600">🕶️ SHADOW MODE — this reply was NOT sent. In live mode it would go to <b>${escapeHtml(mail.fromEmail)}</b>. Set AUTORESPONDER_MODE=live to enable.</div>${html}`
    : html;
  const payload = {
    sender: { name: 'National Sports Apparel', email: fromAddr },
    to: [{ email: to }],
    subject: (shadow ? '[SHADOW] ' : '') + subject,
    htmlContent: wrap(finalHtml),
    replyTo: { email: 'hello@nationalsportsapparel.com', name: 'National Sports Apparel' },
  };
  if (!shadow) {
    // Thread the reply under the parent's original message, and BCC hello@ so
    // the auto-reply shows on the thread in the shared inbox (the internal-
    // sender guard keeps the forwarded BCC from re-triggering this function).
    if (mail.messageId && !mail.messageId.startsWith('synthetic:')) payload.headers = { 'In-Reply-To': mail.messageId, References: mail.messageId };
    payload.bcc = [{ email: 'hello@nationalsportsapparel.com' }];
  }
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = j.message || j.code || JSON.stringify(j); } catch { detail = String(resp.status); }
      return { to, error: detail };
    }
    return { to };
  } catch (e) { return { to, error: e.message }; }
}

async function sendStaffAlert(mail, summaries, reason) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  const alertTo = process.env.AUTORESPONDER_ALERT_TO || 'steve@nationalsportsapparel.com';
  if (!brevoKey) return;
  const orderBits = summaries.map((s) => `#${s.displayNumber} (${s.storeName} — ${s.stageLabel})`).join(', ');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937">
    <p><b>${escapeHtml(reason)}</b></p>
    <p>From: ${escapeHtml(mail.fromName)} &lt;${escapeHtml(mail.fromEmail)}&gt;<br>Subject: ${escapeHtml(mail.subject)}${orderBits ? `<br>Orders: ${escapeHtml(orderBits)}` : ''}</p>
    <blockquote style="border-left:3px solid #e5e7eb;margin:8px 0;padding:8px 12px;background:#f9fafb;white-space:pre-wrap">${escapeHtml(mail.text.slice(0, 2000))}</blockquote>
    <p style="color:#6b7280;font-size:12px">Sent by the hello@ auto-responder. The customer ${summaries.length ? 'received an acknowledgment' : 'was told a person will follow up'} — this needs a human reply.</p>
  </div>`;
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Auto-Responder', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: alertTo }],
        subject: `🙋 hello@ needs a human: ${mail.subject || mail.fromEmail}`,
        htmlContent: html,
      }),
    });
  } catch (e) { console.warn('[hello-inbound] staff alert failed:', e.message); }
}

// ── Reply bodies (house style: logo bar + navy header, like _webstoreEmail) ──
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null;

function wrap(inner) {
  const assetBase = (process.env.PORTAL_ASSET_URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  return `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <div style="background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 10px 0 0;padding:14px 24px;text-align:center"><a href="https://nationalsportsapparel.com"><img src="${assetBase}/NEW%20NSA%20Logo%20on%20white.png" alt="National Sports Apparel" height="32" style="height:32px;border:none"></a></div>
    <div style="border:1px solid #eef1f5;border-radius:0 0 10px 10px;padding:22px 24px">${inner}
      <p style="font-size:12px;color:#94a3b8;margin:22px 0 0">National Sports Apparel · hello@nationalsportsapparel.com<br>This is an instant reply from our order-status assistant — a real person reads every email too.</p>
    </div></div>`;
}

function orderCard(s) {
  const est = fmtDate(s.estShipDate);
  const shipRows = s.shipments.map((x) => `<div style="margin:4px 0">📦 ${escapeHtml(x.carrier || 'Carrier')}: <a href="${x.url}" style="color:#0b5fff;font-weight:700">${escapeHtml(x.tracking)}</a>${x.shipDate ? ` <span style="color:#64748b">(shipped ${fmtDate(x.shipDate)})</span>` : ''}</div>`).join('');
  const itemRows = s.items.slice(0, 12).map((i) => `<li style="margin:2px 0">${escapeHtml(i.label)}${i.qty > 1 ? ` ×${i.qty}` : ''} — <span style="color:#475569">${i.stageLabel}${i.missing ? ' · <b style="color:#b45309">1+ delayed</b>' : ''}</span></li>`).join('');
  return `<div style="border:1px solid #eef1f5;border-radius:10px;padding:16px 18px;margin:14px 0">
    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#64748b">${escapeHtml(s.storeName)}${s.displayNumber ? ` · Order #${escapeHtml(s.displayNumber)}` : ''}</div>
    <div style="font-size:19px;font-weight:800;margin:4px 0 8px">${s.stageLabel}</div>
    <p style="margin:0 0 8px">${s.stageText}${s.partialShipment ? ' Part of your order has already shipped — tracking below; the rest follows shortly.' : ''}</p>
    ${shipRows}
    ${s.stage < 4 ? `<p style="margin:8px 0 0">${est ? `<b>Estimated ship date: around ${est}.</b> Team orders are produced together after the store closes, so this is our best estimate — you'll get a tracking email the moment it ships.` : `Your order is in the final stretch — you'll get a tracking email the moment it ships.`}</p>` : ''}
    ${itemRows ? `<ul style="margin:10px 0 0;padding-left:18px;font-size:13px">${itemRows}</ul>` : ''}
    ${s.trackUrl ? `<div style="text-align:center;margin:16px 0 4px"><a href="${s.trackUrl}" style="display:inline-block;background:#e11d2a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:800">Track your order live →</a></div>
    <p style="font-size:12px;color:#94a3b8;margin:6px 0 0;text-align:center">Your private tracking page — bookmark it, and message our team right on that page.</p>` : ''}
  </div>`;
}

function statusHtml({ firstName, summaries, matchedBy }) {
  const intro = matchedBy === 'buyer_email'
    ? `Good news — we found ${summaries.length > 1 ? 'your recent orders' : 'your order'} from your email address, no order number needed.`
    : `Here's where your ${summaries.length > 1 ? 'orders are' : 'order is'} right now:`;
  return `<p style="margin:0 0 6px">Hi ${escapeHtml(firstName)},</p><p style="margin:0 0 6px">${intro}</p>${summaries.map(orderCard).join('')}<p style="margin:10px 0 0">Anything look off? Just reply to this email and a real person will jump in.</p>`;
}

function askForNumberHtml({ firstName }) {
  return `<p style="margin:0 0 6px">Hi ${escapeHtml(firstName)},</p>
    <p>Thanks for reaching out! We'd love to get you an instant status update — we just couldn't spot an order number in your email, and we don't see an order under this email address.</p>
    <p><b>Reply with your order number</b> and we'll send your order's status, tracking, and estimated ship date right back. You'll find it in your order confirmation email — it looks like <b>#1010072</b> (team store) or <b>#186548709</b> (pop-up sale).</p>
    <p style="font-size:13px;color:#64748b">Tip: replying from the email address you used at checkout also works — we can find your order that way, no number needed.</p>`;
}

function notFoundHtml({ firstName, numbers }) {
  return `<p style="margin:0 0 6px">Hi ${escapeHtml(firstName)},</p>
    <p>Thanks for sending your order number${numbers.length > 1 ? 's' : ''} (${numbers.map((n) => '#' + escapeHtml(n)).join(', ')}). We weren't able to pull it up automatically, so a member of our team is looking into it personally and will get back to you shortly — no need to resend anything.</p>`;
}

function problemAckHtml({ firstName, summaries }) {
  const links = summaries.filter((s) => s.trackUrl).map((s) => `<div style="margin:6px 0"><a href="${s.trackUrl}" style="color:#0b5fff;font-weight:700">Order${s.displayNumber ? ' #' + escapeHtml(s.displayNumber) : ''} — ${escapeHtml(s.storeName)}</a></div>`).join('');
  return `<p style="margin:0 0 6px">Hi ${escapeHtml(firstName)},</p>
    <p>We're sorry something's not right with your order — we've flagged your email and <b>a real person on our team will get back to you today</b> to make it right.</p>
    ${links ? `<p style="margin:10px 0 4px">In the meantime, here's your order page:</p>${links}` : ''}`;
}
