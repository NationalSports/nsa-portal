// Team Shop / Club — stuck-order sweep (Team Shop backend hardening #2).
//
// Scheduled hourly (see netlify.toml [functions."teamshop-stuck-sweep"]). Scans
// for orders/jobs stuck at the seams between checkout, conversion, and
// production that nothing else currently surfaces to staff, and emails ONE
// alert (never one per stuck row) to STUCK_SWEEP_ALERT_EMAIL when anything is
// found. A clean sweep sends no email — same posture as so-health-alert.js.
//
// Checks (order_source in ('teamshop','club') throughout — this never touches
// plain 'webstore' storefront orders):
//   (a) paid, so_id still null, older than 2h — the conversion RPC
//       (create_teamshop_sales_order / create_club_sales_order) never landed:
//       neither webstore-checkout's own call, stripe-webhook's fallback, nor
//       (for teamshop PO orders) teamshop-po-review's approve leg succeeded.
//   (b) pending_payment, older than 24h — a card/ACH intent that never
//       resolved (succeeded or failed) through stripe-webhook. ACH failures
//       are already auto-cancelled by stripe-webhook's payment_intent.
//       payment_failed handler; this catches the ones Stripe never told us
//       about at all.
//   (c) so_jobs on a teamshop/club SO stuck in art_status 'needs_art' or
//       'upload_emb_files' for 5+ business days.
//   (d) a converted SO (sales_orders.source='webstore', born from a teamshop/
//       club webstore_orders row) with NO purchase_order_lines row at all
//       (so the auto-PO engine, 00202, never fired or found nothing to buy)
//       AND at least one so_jobs row still item_status='need_to_order',
//       24h+ old — production is waiting on stock nobody ordered.
//   (f) auto-PO drafts BLOCKED from auto-submit by a missing vendor email — a
//       vendor with teamshop_auto_po_settings.auto_submit_enabled=true but no
//       contact_email will never dispatch its drafts (teamshop-auto-po.js
//       leaves them 'draft'); surface them so staff add the email or send the
//       PO by hand.
//   (e) SKIPPED — sales_orders in a shipped state with no webstore email log.
//       There is no email-send-log table for webstore order shipment notices
//       (traced: webstore_orders/so_jobs carry no "shipment email sent"
//       column, and _webstoreEmail.js's sendOrderConfirmation only logs via
//       webstore_orders.confirmation_sent, which is the ORDER confirmation,
//       not a shipping notice). Detecting this cheaply would need a new
//       column/table this migration bundle doesn't add — out of scope here,
//       flagged in the response as skipped rather than silently omitted.
//
// so_jobs.created_at CAVEAT (checks c/d): so_jobs.created_at is a plain
// 'M/D/YYYY' TEXT column (see 00196's v_today_txt := to_char(now(),
// 'FMMM/FMDD/YYYY')) — no time-of-day, no timezone. "5 business days" / "24h"
// against this field is therefore DATE-granularity, not true elapsed-hours —
// a job created at 11:59pm reads as only-just-created the next morning. This
// is the data we have; treat the thresholds below as "at least N days/business
// days ago by calendar date," not a precise SLA clock.
//
// Auth: the scheduled invocation runs with no auth (same posture as every
// other scheduled function in this repo — so-health-alert.js, webstore-close-
// sweep.js — Netlify does not sign scheduled invocations in this stack).
// Manual re-run from the Team Shop queue UI is a staff-authenticated POST
// { action: 'run' }, verified the same way as teamshop-po-review.js (bearer
// staff session JWT via _shared.verifyUser).
//
// NEVER throws to the caller: every check is independently try/caught so one
// failing query doesn't hide the others, and the top-level handler always
// returns 200 with a summary (even on total failure) — this is a monitoring
// job, not a workflow gate; nothing anywhere depends on its response shape.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const ALERT_EMAIL = process.env.STUCK_SWEEP_ALERT_EMAIL || 'stores@nationalsportsapparel.com';
const SOURCES = ['teamshop', 'club'];
const ROW_LIMIT = 200;

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ── Time helpers ────────────────────────────────────────────────────────
const hoursAgoIso = (h) => new Date(Date.now() - h * 3600000).toISOString();

// N business days back from today, at midnight (date-only — see the
// so_jobs.created_at caveat above for why this can't be sub-day precise).
function businessDaysAgoDateOnly(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

// N plain calendar days back, at midnight (date-only, no weekend skip — used
// for the "24h" so_jobs checks, which can't be sub-day precise either; see caveat).
function daysAgoDateOnly(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// so_jobs.created_at is 'M/D/YYYY' (no leading zeros, per to_char 'FMMM/FMDD/YYYY').
function parseSoJobDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const [, mo, da, yr] = m;
  const d = new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(da)));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Checks ───────────────────────────────────────────────────────────────
async function checkPaidNoSo(admin) {
  const { data, error } = await admin.from('webstore_orders')
    .select('id, order_number, order_source, buyer_name, buyer_email, total, created_at')
    .in('order_source', SOURCES).eq('status', 'paid').is('so_id', null)
    .lte('created_at', hoursAgoIso(2))
    .order('created_at', { ascending: true }).limit(ROW_LIMIT);
  if (error) throw error;
  return data || [];
}

async function checkStalePendingPayment(admin) {
  const { data, error } = await admin.from('webstore_orders')
    .select('id, order_number, order_source, buyer_name, buyer_email, total, created_at')
    .in('order_source', SOURCES).eq('status', 'pending_payment')
    .lte('created_at', hoursAgoIso(24))
    .order('created_at', { ascending: true }).limit(ROW_LIMIT);
  if (error) throw error;
  return data || [];
}

// SO ids born from a teamshop/club webstore order — shared by checks (c)/(d).
async function teamshopClubSoIds(admin) {
  const { data, error } = await admin.from('webstore_orders')
    .select('so_id, order_source').in('order_source', SOURCES).not('so_id', 'is', null)
    .limit(5000);
  if (error) throw error;
  const bySoId = {};
  (data || []).forEach((r) => { if (r.so_id) bySoId[r.so_id] = r.order_source; });
  return bySoId;
}

async function checkStuckArt(admin, soIdMap) {
  const soIds = Object.keys(soIdMap);
  if (!soIds.length) return [];
  const cutoff = businessDaysAgoDateOnly(5);
  const { data, error } = await admin.from('so_jobs')
    .select('so_id, id, art_name, art_status, created_at')
    .in('so_id', soIds).in('art_status', ['needs_art', 'upload_emb_files'])
    .limit(2000);
  if (error) throw error;
  return (data || [])
    .map((j) => ({ ...j, _created: parseSoJobDate(j.created_at) }))
    .filter((j) => j._created && j._created <= cutoff);
}

async function checkNoPoNeedOrder(admin, soIdMap) {
  const soIds = Object.keys(soIdMap);
  if (!soIds.length) return [];
  // Defensive cross-check: only SOs the conversion RPCs actually stamped
  // source='webstore' on (00196/00199/00204) — matches every id in soIdMap in
  // practice, but confirms we're not chasing a dangling/renamed so_id.
  const { data: sales, error: sErr } = await admin.from('sales_orders').select('id, source').in('id', soIds);
  if (sErr) throw sErr;
  const validSoIds = (sales || []).filter((s) => s.source === 'webstore').map((s) => s.id);
  if (!validSoIds.length) return [];

  const { data: lines, error: lErr } = await admin.from('purchase_order_lines').select('so_id').in('so_id', validSoIds);
  if (lErr) throw lErr;
  const withPo = new Set((lines || []).map((l) => l.so_id));
  const withoutPo = validSoIds.filter((id) => !withPo.has(id));
  if (!withoutPo.length) return [];

  const cutoff = daysAgoDateOnly(1); // date-only "24h ago" — see caveat above
  const { data: jobs, error: jErr } = await admin.from('so_jobs')
    .select('so_id, id, item_status, created_at')
    .in('so_id', withoutPo).eq('item_status', 'need_to_order')
    .limit(2000);
  if (jErr) throw jErr;
  return (jobs || [])
    .map((j) => ({ ...j, _created: parseSoJobDate(j.created_at) }))
    .filter((j) => j._created && j._created <= cutoff);
}

// Auto-PO drafts for vendors that CAN'T auto-submit — auto_submit_enabled=true but
// no contact_email — so teamshop-auto-po.js left them as drafts. (f)
async function checkAutoSubmitBlocked(admin) {
  const { data: settings, error } = await admin.from('teamshop_auto_po_settings')
    .select('vendor, auto_submit_enabled, contact_email').eq('auto_submit_enabled', true);
  if (error) throw error;
  const blocked = (settings || []).filter((s) => !String(s.contact_email || '').trim()).map((s) => s.vendor);
  if (!blocked.length) return [];
  const { data: pos, error: pErr } = await admin.from('purchase_orders')
    .select('id, po_number, vendor, totals_cents, created_at')
    .eq('origin', 'auto').eq('status', 'draft').in('vendor', blocked)
    .order('created_at', { ascending: true }).limit(ROW_LIMIT);
  if (pErr) throw pErr;
  return pos || [];
}

// ── Orchestration ────────────────────────────────────────────────────────
async function runChecks(admin) {
  const out = { paid_no_so: [], stale_pending_payment: [], stuck_art: [], no_po_need_order: [], auto_submit_blocked: [], errors: [], skipped: [] };

  out.skipped.push({
    check: 'shipped_no_email_log',
    reason: 'No email-send-log table exists for webstore shipment notices — not cheaply detectable (see file header).',
  });

  const safe = async (label, fn) => {
    try { return await fn(); } catch (e) { out.errors.push({ check: label, error: e.message || String(e) }); return []; }
  };

  out.paid_no_so = await safe('paid_no_so', () => checkPaidNoSo(admin));
  out.stale_pending_payment = await safe('stale_pending_payment', () => checkStalePendingPayment(admin));

  const soIdMap = await safe('so_id_map', () => teamshopClubSoIds(admin));
  const soIdMapObj = Array.isArray(soIdMap) ? {} : soIdMap; // safe() returns [] on failure
  out.stuck_art = await safe('stuck_art', () => checkStuckArt(admin, soIdMapObj));
  out.no_po_need_order = await safe('no_po_need_order', () => checkNoPoNeedOrder(admin, soIdMapObj));
  out.auto_submit_blocked = await safe('auto_submit_blocked', () => checkAutoSubmitBlocked(admin));

  return out;
}

function totalStuck(summary) {
  return summary.paid_no_so.length + summary.stale_pending_payment.length
    + summary.stuck_art.length + summary.no_po_need_order.length
    + summary.auto_submit_blocked.length;
}

// ── Email ────────────────────────────────────────────────────────────────
function buildEmailHtml(summary, portalUrl) {
  const soLink = (id) => (portalUrl && id)
    ? `<a href="${portalUrl}/?so=${encodeURIComponent(id)}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${esc(id)}</a>`
    : esc(id || '');
  const section = (title, rows, render) => rows.length
    ? `<h3 style="margin-top:22px;color:#991b1b">${esc(title)}: ${rows.length}</h3><ul style="font-size:13px;line-height:1.6">${rows.map(render).join('')}</ul>`
    : '';
  const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const paidNoSoHtml = section('Paid, never converted to a Sales Order (2h+)', summary.paid_no_so,
    (o) => `<li>${esc(o.order_number || o.id)} — ${esc(o.order_source)} — ${esc(o.buyer_name || o.buyer_email || '')} — ${money(o.total)} — ${esc(o.created_at)}</li>`);
  const pendingHtml = section('Stuck in pending_payment (24h+)', summary.stale_pending_payment,
    (o) => `<li>${esc(o.order_number || o.id)} — ${esc(o.order_source)} — ${esc(o.buyer_name || o.buyer_email || '')} — ${money(o.total)} — ${esc(o.created_at)}</li>`);
  const artHtml = section('Jobs stuck in art (needs_art / upload_emb_files, 5+ business days)', summary.stuck_art,
    (j) => `<li>${soLink(j.so_id)} / ${esc(j.id)} — ${esc(j.art_name || 'unassigned art')} — ${esc(j.art_status)} — created ${esc(j.created_at)}</li>`);
  const poHtml = section('No purchase order and still need_to_order (24h+)', summary.no_po_need_order,
    (j) => `<li>${soLink(j.so_id)} / ${esc(j.id)} — created ${esc(j.created_at)}</li>`);
  const autoSubmitHtml = section('Auto-PO drafts blocked — vendor has no contact_email', summary.auto_submit_blocked,
    (p) => `<li>${esc(p.po_number || p.id)} — ${esc(p.vendor)} — ${money((Number(p.totals_cents) || 0) / 100)} — created ${esc(p.created_at)}</li>`);

  const errorsHtml = summary.errors.length
    ? `<p style="margin-top:22px;font-size:12px;color:#92400e">Some checks failed and were skipped this run: ${summary.errors.map((e) => esc(e.check) + ' (' + esc(e.error) + ')').join('; ')}</p>`
    : '';
  const skippedHtml = summary.skipped.length
    ? `<p style="margin-top:8px;font-size:11px;color:#94a3b8">Not checked: ${summary.skipped.map((s) => esc(s.check) + ' — ' + esc(s.reason)).join('; ')}</p>`
    : '';

  return `<div style="font-family:sans-serif;max-width:680px">
    <h2 style="color:#dc2626;margin-bottom:4px">Team Shop / Club — stuck order sweep</h2>
    <p style="color:#64748b;margin-top:0">Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
    ${paidNoSoHtml}${pendingHtml}${artHtml}${poHtml}${autoSubmitHtml}${errorsHtml}${skippedHtml}
    <hr style="margin-top:28px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">Sent by teamshop-stuck-sweep. so_jobs age is date-only (no time-of-day in the source column) — see the function's header comment.</p>
  </div>`;
}

async function sendAlert(summary) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) { console.error('[teamshop-stuck-sweep] BREVO_API_KEY missing — cannot send alert'); return false; }
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const n = totalStuck(summary);
  const subject = `Team Shop stuck-order sweep — ${n} item${n === 1 ? '' : 's'} need attention`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Team Shop', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: ALERT_EMAIL }],
      subject,
      htmlContent: buildEmailHtml(summary, portalUrl),
    }),
  });
  if (!res.ok) { console.error('[teamshop-stuck-sweep] Brevo send failed:', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

// ── Entry point ──────────────────────────────────────────────────────────
async function runSweep(admin) {
  const summary = await runChecks(admin);
  const n = totalStuck(summary);
  let emailed = false;
  if (n > 0) {
    try { emailed = await sendAlert(summary); }
    catch (e) { console.error('[teamshop-stuck-sweep] alert send error:', e.message || e); }
  }
  console.log(`[teamshop-stuck-sweep] paid_no_so=${summary.paid_no_so.length} stale_pending=${summary.stale_pending_payment.length} stuck_art=${summary.stuck_art.length} no_po=${summary.no_po_need_order.length} auto_submit_blocked=${summary.auto_submit_blocked.length} emailed=${emailed}`);
  return {
    ok: true,
    total_stuck: n,
    emailed,
    counts: {
      paid_no_so: summary.paid_no_so.length,
      stale_pending_payment: summary.stale_pending_payment.length,
      stuck_art: summary.stuck_art.length,
      no_po_need_order: summary.no_po_need_order.length,
      auto_submit_blocked: summary.auto_submit_blocked.length,
    },
    errors: summary.errors,
    skipped: summary.skipped,
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  const isManual = !!(event && event.httpMethod === 'POST');
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) {
    console.error('[teamshop-stuck-sweep] not configured:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Service not configured' }) };
  }

  if (isManual) {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
    if (body.action !== 'run') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action.' }) };
    const staff = await verifyUser(event);
    if (!staff.ok) return { statusCode: staff.status, headers, body: JSON.stringify({ error: staff.error }) };
  }

  try {
    const summary = await runSweep(admin);
    return { statusCode: 200, headers, body: JSON.stringify(summary) };
  } catch (e) {
    // NEVER throw to the caller — this is a monitoring job.
    console.error('[teamshop-stuck-sweep] sweep failed:', e.message || e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};

// ── Test surface ─────────────────────────────────────────────────────────
module.exports.runSweep = runSweep;
module.exports.runChecks = runChecks;
module.exports.checkAutoSubmitBlocked = checkAutoSubmitBlocked;
module.exports.businessDaysAgoDateOnly = businessDaysAgoDateOnly;
module.exports.daysAgoDateOnly = daysAgoDateOnly;
module.exports.parseSoJobDate = parseSoJobDate;
module.exports.buildEmailHtml = buildEmailHtml;
