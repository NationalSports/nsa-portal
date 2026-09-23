// Automatic coach shipping notices — the sweep that turns "the label exists"
// into "the coach knows".
//
// Scheduled every 15 min (netlify.toml [functions."so-shipment-notify-sweep"]).
// It does NOT hook the warehouse ship modal: a tracking number reaches a sales
// order from several places — the Ready-to-Pull/Ship flows (label bought in the
// modal), the Awaiting Pickup tab (box confirmed first, label bought later,
// sometimes days later), a typed number on that tab, and the Tracking tab's
// Edit prompt — and a sweep over the saved records catches all of them with ONE
// implementation. The send itself is so-shipment-notify's sendShipmentNotice,
// the same path the rep's button uses: same recipient rules, same ledger, so an
// automatic notice and a manual one can never double up.
//
// Which boxes count (src/App.js writes these shapes; see classifyBoxes):
//   • announceable — a customer box with a tracking number: goes in the email.
//   • blocking     — a customer box the warehouse still owes a label for (has
//                    items, a real carrier or none chosen yet, not cleared): holds
//                    the order so the coach gets one email, not a half-list.
//   • ignored      — decorator transfers, boxes "cleared" by memo (rep pickup,
//                    customer pickup), rep-delivery/courier records, cost-only
//                    manual records. They never get tracking and must not hold
//                    the order back. The rep's button can still include them.
//
// When an order is announced (every condition, in order):
//   1. Live order (not soft-deleted, not `complete`) with ≥1 announceable box
//      created on/after the GO-LIVE DATE and no blocking box.
//   2. The ledger (so_shipment_notices) has no sent row for that box set.
//   3. Grace: the FIRST time the sweep sees the set fully tracked it writes a
//      ledger row (first_tracked_at) and stops; it sends on a later pass once
//      MIN_AGE (default 15 min) has passed. The clock starts when tracking
//      appears — not when the box was confirmed — because the label can come
//      days later. The window is the room to fix a mistyped number.
//   4. Safety cap: a box older than MAX_AGE (default 30 days) is left to the rep.
//
// GO-LIVE DATE, not an on/off switch: SO_SHIPMENT_AUTONOTIFY holds a date
// (YYYY-MM-DD). Boxes created before it are never auto-announced, which is what
// keeps the first armed run from emailing every coach whose order shipped last
// month. Unset or unparseable = DRY RUN: the sweep reports what it would do and
// writes nothing, emails nobody.
//
// Staff can POST { action:'run' } with a bearer token to force a pass, and
// { dryRun:true } to see the decisions without writing or sending. It NEVER
// throws: scheduled runs always return 200 with a summary.

const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { sendShipmentNotice, isCustomerShipment, isMissingRelation } = require('./so-shipment-notify');

const MIN_AGE_MS = Math.max(0, Number(process.env.SO_SHIPMENT_AUTONOTIFY_MIN_AGE_MIN || 15)) * 60000;
const MAX_AGE_MS = Math.max(1, Number(process.env.SO_SHIPMENT_AUTONOTIFY_MAX_AGE_DAYS || 30)) * 86400000;
const SCAN_LIMIT = 500;
// A closed-out order is done being announced; a box added after it closes is the
// rep's to send. Keeping 'complete' out of the scan is also what keeps this a
// small query instead of a walk over every order NSA has ever shipped.
const CLOSED_STATUSES = ['complete'];
// Carriers that never produce a tracking number.
const NO_LABEL_CARRIERS = new Set(['rep_delivery', 'courier']);

const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

// The go-live floor: a Date from SO_SHIPMENT_AUTONOTIFY, or null (dry run).
function goLiveDate(raw = process.env.SO_SHIPMENT_AUTONOTIFY) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

// Shipment timestamps are locale strings ('9/21/2026, 2:30:00 PM') because
// sales_orders carries its dates as TEXT. Date can read them; anything it can't
// read counts as NO timestamp.
function shipmentTime(shipment) {
  for (const raw of [shipment && shipment.created_at, shipment && shipment.ship_date]) {
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

const unitsIn = (items) => (items || []).reduce((a, it) => a
  + Object.values((it && it.sizes) || {}).reduce((b, q) => b + (Number(q) || 0), 0), 0);

/** Sort every box on an order into announceable / blocking / ignored. Pure. */
function classifyBoxes(shipments) {
  const out = { announceable: [], blocking: [], ignored: [] };
  (Array.isArray(shipments) ? shipments : []).forEach((s) => {
    if (!isCustomerShipment(s)) { out.ignored.push(s); return; }
    const tracked = !!String(s.tracking_number || '').trim();
    if (tracked) { out.announceable.push(s); return; }
    const carrier = String(s.carrier || '').toLowerCase();
    const willNeverHaveTracking = s.cleared === true || s.carrier_picked_up === true || NO_LABEL_CARRIERS.has(carrier);
    if (willNeverHaveTracking || unitsIn(s.items) === 0) { out.ignored.push(s); return; }
    out.blocking.push(s);
  });
  return out;
}

/**
 * Decide what this order should do right now. Pure — the whole rule set in one
 * testable place.
 *
 *   ledgerRows: so_shipment_notices rows for this order.
 *   sinceMs:    go-live floor (ms epoch); boxes created before it are ignored.
 *
 * Returns { action: 'skip' | 'start_grace' | 'send', reason, shipmentIds, … }.
 */
function shipmentNoticePlan(so, { now = Date.now(), minAgeMs = MIN_AGE_MS, maxAgeMs = MAX_AGE_MS, sinceMs = 0, ledgerRows = [] } = {}) {
  const { announceable, blocking } = classifyBoxes(so && so._shipments);

  // The go-live floor and the safety cap both read the box's own date; an
  // undated box can't be placed and is left to the rep.
  const eligible = [];
  let beforeGoLive = 0; let tooOld = 0; let undated = 0;
  announceable.forEach((s) => {
    const t = shipmentTime(s);
    if (t === null) { undated += 1; return; }
    if (t < sinceMs) { beforeGoLive += 1; return; }
    if (now - t > maxAgeMs) { tooOld += 1; return; }
    eligible.push(s);
  });
  if (!eligible.length) {
    const reason = announceable.length === 0 ? (blocking.length ? 'waiting_on_tracking' : 'no_customer_boxes')
      : beforeGoLive ? 'before_go_live' : tooOld ? 'older_than_max_age' : 'undated_box';
    return { action: 'skip', reason, untracked: blocking.length, shipmentIds: [] };
  }
  if (blocking.length) return { action: 'skip', reason: 'waiting_on_tracking', untracked: blocking.length, shipmentIds: eligible.map((s) => String(s.id)).sort() };

  const shipmentIds = eligible.map((s) => String(s.id)).sort();
  const sig = shipmentIds.join(',');
  const row = (ledgerRows || []).find((r) => r && r.shipment_sig === sig);
  if (row && row.sent_at) return { action: 'skip', reason: 'already_sent', shipmentIds };
  if (!row) return { action: 'start_grace', reason: 'first_seen_tracked', shipmentIds };
  const firstTracked = new Date(row.first_tracked_at).getTime();
  if (!Number.isFinite(firstTracked)) return { action: 'skip', reason: 'bad_ledger_row', shipmentIds };
  if (now - firstTracked < minAgeMs) return { action: 'skip', reason: 'inside_grace_window', shipmentIds };
  return { action: 'send', reason: 'ready', shipmentIds };
}

async function runSweep(admin, { dryRun, since, now = Date.now() }) {
  const { data: orders, error } = await admin.from('sales_orders')
    .select('id,status,_shipments,deleted_at')
    .is('deleted_at', null)
    .not('_shipments', 'is', null)
    .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
    .order('id', { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) throw new Error(`Could not scan sales orders: ${error.message}`);

  const scanned = (orders || []).length;
  if (scanned === SCAN_LIMIT) {
    console.warn('[so-shipment-notify-sweep] scan hit the row cap — some orders were not examined this pass');
  }

  const summary = { scanned, sent: 0, failed: 0, graceStarted: 0, dryRun: !!dryRun, skipped: {}, sends: [], failures: [], waitingOnTracking: [], noContact: [] };
  const sinceMs = since instanceof Date ? since.getTime() : 0;

  // One ledger read for the whole pass.
  const ledgerBySo = {};
  let ledgerAvailable = true;
  const ids = (orders || []).map((o) => o.id);
  if (ids.length) {
    const { data: rows, error: ledgerErr } = await admin.from('so_shipment_notices')
      .select('so_id,shipment_sig,first_tracked_at,sent_at').in('so_id', ids);
    if (ledgerErr && isMissingRelation(ledgerErr)) {
      ledgerAvailable = false;
      summary.note = 'so_shipment_notices is not deployed (migration 20260922210000) — nothing can be sent until it is';
    } else if (ledgerErr) {
      throw new Error(`Could not read the notice ledger: ${ledgerErr.message}`);
    } else {
      (rows || []).forEach((r) => { (ledgerBySo[r.so_id] = ledgerBySo[r.so_id] || []).push(r); });
    }
  }

  for (const so of orders || []) {
    const plan = shipmentNoticePlan(so, { now, sinceMs, ledgerRows: ledgerBySo[so.id] || [] });
    if (plan.action === 'skip') {
      summary.skipped[plan.reason] = (summary.skipped[plan.reason] || 0) + 1;
      // Visible, not silent: an order stuck waiting on one label is a rep's
      // cue to add the tracking or send the notice by hand.
      if (plan.reason === 'waiting_on_tracking') summary.waitingOnTracking.push({ so: so.id, boxes: plan.untracked });
      continue;
    }
    if (dryRun || !ledgerAvailable) {
      summary.sends.push({ so: so.id, boxes: plan.shipmentIds.length, would: plan.action, dryRun: true });
      continue;
    }
    if (plan.action === 'start_grace') {
      const { error: startErr } = await admin.from('so_shipment_notices').upsert({
        so_id: so.id, shipment_sig: plan.shipmentIds.join(','), box_count: plan.shipmentIds.length,
        first_tracked_at: new Date(now).toISOString(), source: 'sweep',
      }, { onConflict: 'so_id,shipment_sig', ignoreDuplicates: true });
      if (startErr) { summary.failed += 1; summary.failures.push({ so: so.id, error: startErr.message }); } else summary.graceStarted += 1;
      continue;
    }

    try {
      const { status, payload } = await sendShipmentNotice(admin, {
        soId: so.id,
        shipmentIds: plan.shipmentIds,
        requireTracking: true,
        requireLedger: true,
        sentBy: 'shipment-sweep',
        source: 'sweep',
      });
      if (status === 200 && payload && payload.ok) {
        summary.sent += 1;
        summary.sends.push({ so: so.id, to: payload.to, boxes: payload.boxes, repCopy: payload.repCopy });
      } else if (status === 409 && payload && payload.noContact) {
        // No customer email on file — the rep was emailed instead (once), and the
        // notice goes to the coach on its own as soon as a contact is added.
        summary.noContact.push({ so: so.id, repAlerted: !!payload.repAlerted, rep: payload.repEmail || '' });
      } else if (status === 409) {
        // A race with the rep's own button, or a contact removed since the scan.
        summary.skipped[`refused_${status}`] = (summary.skipped[`refused_${status}`] || 0) + 1;
      } else {
        summary.failed += 1;
        summary.failures.push({ so: so.id, status, error: (payload && payload.error) || 'unknown' });
      }
    } catch (e) {
      // One bad order must not stop the pass.
      summary.failed += 1;
      summary.failures.push({ so: so.id, error: e.message });
      console.error('[so-shipment-notify-sweep]', so.id, e.message);
    }
  }
  return summary;
}

exports.handler = async (event) => {
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };

  // Armed only when the env var holds a go-live date — merging this must not
  // start emailing coaches on its own.
  const since = goLiveDate();
  let dryRun = !since;

  // A scheduled run has no caller; a staff POST does and may force a dry run.
  if (event && event.httpMethod === 'POST' && (event.headers || {}).authorization) {
    const auth = await verifyUser(event);
    if (!auth.ok) return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: auth.error }) };
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    if (body.dryRun === true) dryRun = true;
  }

  try {
    const admin = getSupabaseAdmin();
    const summary = await runSweep(admin, { dryRun, since });
    if (dryRun && summary.sends.length) {
      console.log('[so-shipment-notify-sweep] DRY RUN — would act on:', JSON.stringify(summary.sends));
    }
    return ok({ ok: true, armed: !!since, goLive: since ? since.toISOString().slice(0, 10) : null, ...summary });
  } catch (e) {
    console.error('[so-shipment-notify-sweep] failed:', e.message);
    return ok({ ok: false, armed: !!since, error: e.message });
  }
};

module.exports.shipmentNoticePlan = shipmentNoticePlan;
module.exports.classifyBoxes = classifyBoxes;
module.exports.goLiveDate = goLiveDate;
module.exports.runSweep = runSweep;
