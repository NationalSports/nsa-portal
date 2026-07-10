// Automated follow-up sweep — hands-off nudges for estimates, invoices, and art.
//
// Reps opt a document in when they send the initial email (Send modals set
// follow_up_auto + a schedule + a custom follow_up_message). This scheduled
// function then does the sending so nobody has to remember: it scans the three
// tables for follow-ups whose follow_up_at has arrived, emails the recipients
// captured at send time (follow_up_to) with the rep's custom message + a portal
// link, and either re-arms the next send (repeat cadence) or stops.
//
// It STOPS a doc's follow-ups when:
//   • the doc resolves — estimate approved/converted, invoice paid, art
//     approved or rejected (no more nagging once they've responded), or
//   • the safety cap (follow_up_max, default 4) is reached, or
//   • there's no repeat cadence (one-time follow-up).
//
// Scheduled hourly via netlify.toml ([functions."followup-sweep"].schedule).
// Mirrors the onboarding-reminder.js pattern (getSupabaseAdmin + Brevo).

const { getSupabaseAdmin } = require('./_shared');
const { unsubUrl } = require('./_followupShared');

// Matches the client-side default (Send modals seed follow_up_max||4) — the two used to
// disagree (client 4 vs sweep 6), so a row saved without an explicit max got 2 extra nags.
const DEFAULT_MAX = 4;
const PORTAL_BASE = 'https://nationalsportsapparel.com/coach';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function portalLink(alphaTag) {
  return alphaTag ? `${PORTAL_BASE}?portal=${encodeURIComponent(alphaTag)}` : '';
}

// Branded shell — message body (rep's custom text) + an optional portal button + the opt-out
// footer (repeated commercial email must carry a working unsubscribe mechanism).
function buildHtml(messageText, portalUrl, ctaLabel, unsubLink) {
  const bodyHtml = esc(messageText).replace(/\n/g, '<br/>');
  const button = portalUrl
    ? `<div style="margin:22px 0 6px"><a href="${esc(portalUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">${esc(ctaLabel || 'View in your portal')}</a></div>`
    : '';
  const footer = unsubLink
    ? `<div style="margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">Don’t want these reminders? <a href="${esc(unsubLink)}" style="color:#64748b">Unsubscribe</a> — or just reply and we’ll take care of it.</div>`
    : '';
  return `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:8px 4px">
    <div style="text-align:center;padding:6px 0 16px;border-bottom:2px solid #e2e8f0;margin-bottom:18px">
      <span style="font-size:18px;font-weight:800;color:#0b1f3a">National Sports Apparel</span>
    </div>
    ${bodyHtml}
    ${button}
    ${footer}
  </div>`;
}

async function sendEmail({ toList, subject, html, replyTo, unsubLink }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return { ok: false, error: 'BREVO_API_KEY not configured' };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: toList,
      subject,
      htmlContent: html,
      ...(replyTo ? { replyTo } : {}),
      // RFC 8058 one-click unsubscribe — mail clients surface their own opt-out UI from these.
      ...(unsubLink ? { headers: { 'List-Unsubscribe': `<${unsubLink}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    }),
  });
  if (!res.ok) return { ok: false, error: `Brevo ${res.status}` };
  let messageId = null;
  try { messageId = (await res.json()).messageId || null; } catch { /* ignore */ }
  return { ok: true, messageId };
}

function parseRecipients(followUpTo) {
  return String(followUpTo || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
    .map((email) => ({ email }));
}

// Resolve created_by ids -> reply-to email (best effort; reps get replies).
async function repEmailMap(admin, ids) {
  const map = {};
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return map;
  try {
    const { data } = await admin.from('team_members').select('id,email,name').in('id', clean);
    (data || []).forEach((r) => { if (r.email) map[r.id] = { email: r.email, name: r.name || '' }; });
  } catch { /* table optional */ }
  return map;
}

exports.handler = async () => {
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }
  const nowIso = new Date().toISOString();
  const results = { estimate: 0, invoice: 0, art: 0, stopped: 0, errors: 0, deferred: 0 };

  // Time budget: Netlify scheduled functions share the ~10s synchronous limit, and each row costs
  // a Brevo call + 2-3 DB round-trips. Bail before the platform kills us mid-row — anything not
  // reached stays due and the next hourly sweep picks it up. Deferred rows are counted so a
  // chronically over-budget sweep is visible in the function logs, not silent.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 8000;
  const overBudget = () => Date.now() - startedAt > TIME_BUDGET_MS;

  // Claim a row BEFORE sending: compare-and-swap follow_up_at from the value we read to a lease a
  // few hours out. If the update matches 0 rows, another invocation (overlapping run, retry after
  // a timeout) already claimed it — skip, no duplicate email. If we crash after the send, the row
  // wakes at the lease (one late reminder) instead of re-emailing every hour, and finalize below
  // replaces the lease with the real cadence on the happy path.
  const CLAIM_LEASE_MS = 6 * 3600000;
  const claim = async (table, row) => {
    const { data, error } = await admin.from(table)
      .update({ follow_up_at: new Date(Date.now() + CLAIM_LEASE_MS).toISOString() })
      .eq('id', row.id).eq('follow_up_at', row.follow_up_at).eq('follow_up_auto', true)
      .select('id');
    if (error) { results.errors++; console.error(`[followup-sweep] claim ${table}/${row.id}:`, error.message); return false; }
    return (data || []).length > 0;
  };

  // Advance/stop a due row after a (possibly successful) send attempt.
  const finalize = async (table, row, sent, sentEntry) => {
    const count = (row.follow_up_count || 0) + (sent ? 1 : 0);
    const max = row.follow_up_max || DEFAULT_MAX;
    const interval = Number(row.follow_up_interval_days) || 0;
    const repeat = sent && interval > 0 && count < max;
    const upd = {
      follow_up_count: count,
      ...(sent ? { follow_up_last_sent_at: nowIso, sent_history: [...(row.sent_history || []), sentEntry] } : {}),
      ...(repeat
        ? { follow_up_at: new Date(Date.now() + interval * 86400000).toISOString() }
        : { follow_up_at: null, follow_up_auto: false }),
    };
    const { error } = await admin.from(table).update(upd).eq('id', row.id);
    // A failed finalize is not a duplicate-send risk (the claim lease already re-armed the row
    // hours out) but it does lose the count/history bump — log it loudly.
    if (error) { results.errors++; console.error(`[followup-sweep] finalize ${table}/${row.id}:`, error.message); }
  };

  // Turn a resolved/capped row off without sending.
  const stop = async (table, id) => {
    const { error } = await admin.from(table).update({ follow_up_auto: false, follow_up_at: null }).eq('id', id);
    if (error) { results.errors++; console.error(`[followup-sweep] stop ${table}/${id}:`, error.message); return; }
    results.stopped++;
  };

  // Send failed (bad recipient, transient Brevo outage). Back off a few hours instead of
  // hammering every hourly sweep, and count the attempt toward the cap so a permanently
  // rejected recipient can't retry forever — it stops after follow_up_max total attempts.
  // A brief outage costs at most one slot (the 3h backoff usually clears before the next try).
  const FAIL_BACKOFF_MS = 3 * 3600000;
  const backoff = async (table, row) => {
    const count = (row.follow_up_count || 0) + 1;
    const max = row.follow_up_max || DEFAULT_MAX;
    const upd = count >= max
      ? { follow_up_count: count, follow_up_at: null, follow_up_auto: false }
      : { follow_up_count: count, follow_up_at: new Date(Date.now() + FAIL_BACKOFF_MS).toISOString() };
    const { error } = await admin.from(table).update(upd).eq('id', row.id);
    if (error) { results.errors++; console.error(`[followup-sweep] backoff ${table}/${row.id}:`, error.message); }
  };

  const FU_COLS = 'follow_up_at, follow_up_auto, follow_up_interval_days, follow_up_message, follow_up_to, follow_up_count, follow_up_max, follow_up_last_sent_at, sent_history';

  // ── Estimates ─────────────────────────────────────────────────────────────
  try {
    const { data: rows } = await admin
      .from('estimates')
      .select(`id, customer_id, memo, status, approved_at, deleted_at, created_by, ${FU_COLS}`)
      .eq('follow_up_auto', true).lte('follow_up_at', nowIso).limit(500);
    const list = rows || [];
    const custs = await custMap(admin, list.map((r) => r.customer_id));
    const reps = await repEmailMap(admin, list.map((r) => r.created_by));
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (overBudget()) { results.deferred += list.length - i; break; }
      if (r.deleted_at || r.approved_at || ['approved', 'converted'].includes(r.status)) { await stop('estimates', r.id); continue; }
      if ((r.follow_up_count || 0) >= (r.follow_up_max || DEFAULT_MAX)) { await stop('estimates', r.id); continue; }
      const to = parseRecipients(r.follow_up_to);
      if (!to.length) { await stop('estimates', r.id); continue; }
      if (!(await claim('estimates', r))) continue;
      const cust = custs[r.customer_id] || {};
      const link = portalLink(cust.alpha_tag);
      const msg = r.follow_up_message || defaultMessage('estimate', r.memo, link);
      const unsub = unsubUrl('estimates', r.id);
      const out = await sendEmail({ toList: to, subject: `Following up on your estimate${r.memo ? ` — ${r.memo}` : ''}`, html: buildHtml(msg, link, 'View & approve your estimate', unsub), replyTo: reps[r.created_by], unsubLink: unsub });
      if (out.ok) { results.estimate++; await finalize('estimates', r, true, histEntry('estimate', to, r, out.messageId)); }
      else { results.errors++; await backoff('estimates', r); }
    }
  } catch (e) { results.errors++; console.error('[followup-sweep] estimates', e.message); }

  // ── Invoices ──────────────────────────────────────────────────────────────
  try {
    const { data: rows } = await admin
      .from('invoices')
      .select(`id, customer_id, memo, status, deleted_at, created_by, ${FU_COLS}`)
      .eq('follow_up_auto', true).lte('follow_up_at', nowIso).limit(500);
    const list = rows || [];
    const custs = await custMap(admin, list.map((r) => r.customer_id));
    const reps = await repEmailMap(admin, list.map((r) => r.created_by));
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (overBudget()) { results.deferred += list.length - i; break; }
      if (r.deleted_at || r.status === 'paid' || r.status === 'void' || r.status === 'cancelled') { await stop('invoices', r.id); continue; }
      if ((r.follow_up_count || 0) >= (r.follow_up_max || DEFAULT_MAX)) { await stop('invoices', r.id); continue; }
      const to = parseRecipients(r.follow_up_to);
      if (!to.length) { await stop('invoices', r.id); continue; }
      if (!(await claim('invoices', r))) continue;
      const cust = custs[r.customer_id] || {};
      const link = portalLink(cust.alpha_tag);
      const msg = r.follow_up_message || defaultMessage('invoice', r.id, link);
      const unsub = unsubUrl('invoices', r.id);
      const out = await sendEmail({ toList: to, subject: `Following up on invoice ${r.id}`, html: buildHtml(msg, link, 'View & pay your invoice', unsub), replyTo: reps[r.created_by], unsubLink: unsub });
      if (out.ok) { results.invoice++; await finalize('invoices', r, true, histEntry('invoice', to, r, out.messageId)); }
      else { results.errors++; await backoff('invoices', r); }
    }
  } catch (e) { results.errors++; console.error('[followup-sweep] invoices', e.message); }

  // ── Art (so_jobs) ─────────────────────────────────────────────────────────
  try {
    const { data: rows } = await admin
      .from('so_jobs')
      .select(`id, so_id, art_name, art_status, coach_approved_at, coach_rejected, ${FU_COLS}`)
      .eq('follow_up_auto', true).lte('follow_up_at', nowIso).limit(500);
    const list = rows || [];
    // so_id -> sales_order (customer_id, created_by) -> customer.alpha_tag
    const soIds = [...new Set(list.map((r) => r.so_id).filter(Boolean))];
    const soMap = {};
    if (soIds.length) {
      const { data: sos } = await admin.from('sales_orders').select('id, customer_id, created_by').in('id', soIds);
      (sos || []).forEach((s) => { soMap[s.id] = s; });
    }
    const custs = await custMap(admin, Object.values(soMap).map((s) => s.customer_id));
    const reps = await repEmailMap(admin, Object.values(soMap).map((s) => s.created_by));
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (overBudget()) { results.deferred += list.length - i; break; }
      if (r.coach_approved_at || r.coach_rejected || r.art_status !== 'waiting_approval') { await stop('so_jobs', r.id); continue; }
      if ((r.follow_up_count || 0) >= (r.follow_up_max || DEFAULT_MAX)) { await stop('so_jobs', r.id); continue; }
      const to = parseRecipients(r.follow_up_to);
      if (!to.length) { await stop('so_jobs', r.id); continue; }
      if (!(await claim('so_jobs', r))) continue;
      const so = soMap[r.so_id] || {};
      const cust = custs[so.customer_id] || {};
      const link = portalLink(cust.alpha_tag);
      const msg = r.follow_up_message || defaultMessage('art', r.art_name, link);
      const unsub = unsubUrl('so_jobs', r.id);
      const out = await sendEmail({ toList: to, subject: `Reminder: artwork ready for approval${r.art_name ? ` — ${r.art_name}` : ''}`, html: buildHtml(msg, link, 'Review & approve your artwork', unsub), replyTo: reps[so.created_by], unsubLink: unsub });
      if (out.ok) { results.art++; await finalize('so_jobs', r, true, histEntry('art', to, r, out.messageId)); }
      else { results.errors++; await backoff('so_jobs', r); }
    }
  } catch (e) { results.errors++; console.error('[followup-sweep] so_jobs', e.message); }

  return { statusCode: 200, body: JSON.stringify(results) };
};

async function custMap(admin, ids) {
  const map = {};
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return map;
  const { data } = await admin.from('customers').select('id, name, alpha_tag').in('id', clean);
  (data || []).forEach((c) => { map[c.id] = c; });
  return map;
}

function histEntry(kind, to, row, messageId) {
  return {
    sent_at: new Date().toISOString(),
    sent_by: 'auto',
    type: `${kind}_followup`,
    auto: true,
    n: (row.follow_up_count || 0) + 1,
    to: to.map((t) => t.email).join(', '),
    messageId: messageId || null,
  };
}

function defaultMessage(kind, label, link) {
  const l = label ? ` "${label}"` : '';
  const linkLine = link ? `\n\nView it here: ${link}` : '';
  if (kind === 'invoice') return `Hi,\n\nJust following up on invoice${l} from National Sports Apparel. When you have a moment, please review and submit payment.${linkLine}\n\nThank you!\nNational Sports Apparel`;
  if (kind === 'art') return `Hi Coach,\n\nJust a friendly reminder that your artwork${l} is ready for your review and approval. We can't move it into production until it's approved.${linkLine}\n\nThanks!\nNational Sports Apparel`;
  return `Hi,\n\nJust following up on the estimate${l} we sent over. Let us know if you'd like to move forward or have any questions.${linkLine}\n\nThank you!\nNational Sports Apparel`;
}
