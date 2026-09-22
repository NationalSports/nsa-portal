// Automatic coach shipping notices — the sweep that turns "tracking exists"
// into "the coach knows".
//
// Scheduled every 15 min (netlify.toml [functions."so-shipment-notify-sweep"]).
// It does NOT hook the warehouse ship modal: tracking reaches a sales order from
// several places (the Ready-to-Ship flow, + Add Shipment, the Edit-tracking
// prompt on the Tracking tab), and a sweep over the saved records catches all of
// them with ONE implementation instead of a copy per button. The send itself is
// so-shipment-notify's sendShipmentNotice — the same path the rep's button uses,
// so an automatic notice and a manual one are the same email with the same
// recipient rules and the same already-sent guard.
//
// What it will announce (every condition, in order):
//   1. The order is live (not soft-deleted, not closed out) and has customer
//      boxes — decorator transfers are never announced.
//   2. EVERY customer box on the order has a tracking number. One box still
//      waiting on a label holds the whole order back rather than emailing a
//      coach a half-list; the rep's button covers the rest (a rep drop-off that
//      will never have tracking, say). Orders held this way are counted in the
//      run summary so they don't go unnoticed.
//   3. The newest box has been sitting for MIN_AGE (default 15 min) — a grace
//      window so a mistyped tracking number can be fixed before it goes out.
//   4. The newest box is younger than MAX_AGE (default 2 days). This is what
//      stops the first run after deploy from emailing coaches about every
//      historical shipment; an older box is never auto-announced.
//   5. That exact set of boxes hasn't been announced already (sendShipmentNotice's
//      shipment_sig guard, re-checked here so a skip is cheap).
//
// DEFAULT OFF: with SO_SHIPMENT_AUTONOTIFY unset the sweep runs as a DRY RUN —
// it logs and reports what it would have sent and emails nobody. Set
// SO_SHIPMENT_AUTONOTIFY=on in Netlify to arm it.
//
// Staff can POST { action:'run' } with a bearer token to force a pass, and
// { dryRun:true } to see the decisions without sending. It NEVER throws:
// scheduled runs always return 200 with a summary.

const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { sendShipmentNotice, isCustomerShipment } = require('./so-shipment-notify');

const MIN_AGE_MS = Math.max(0, Number(process.env.SO_SHIPMENT_AUTONOTIFY_MIN_AGE_MIN || 15)) * 60000;
const MAX_AGE_MS = Math.max(1, Number(process.env.SO_SHIPMENT_AUTONOTIFY_MAX_AGE_DAYS || 2)) * 86400000;
const SCAN_LIMIT = 500;
// A closed-out order is done being announced; a box added after it closes is the
// rep's to send. Keeping 'complete' out of the scan is also what keeps this a
// small query instead of a walk over every order NSA has ever shipped.
const CLOSED_STATUSES = ['complete'];

const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

// Shipment timestamps are locale strings ('9/21/2026, 2:30:00 PM') because
// sales_orders carries its dates as TEXT. Date can read them; anything it can't
// read counts as NO timestamp, which holds the notice back rather than sending
// on an unknown age.
function shipmentTime(shipment) {
  for (const raw of [shipment && shipment.created_at, shipment && shipment.ship_date]) {
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Decide what, if anything, this order should announce right now. Pure — the
 * whole rule set in one testable place.
 *
 * Returns { action: 'send' | 'skip', reason, shipmentIds }.
 */
function shipmentNoticePlan(so, { now = Date.now(), minAgeMs = MIN_AGE_MS, maxAgeMs = MAX_AGE_MS } = {}) {
  const boxes = (Array.isArray(so && so._shipments) ? so._shipments : []).filter(isCustomerShipment);
  if (!boxes.length) return { action: 'skip', reason: 'no_customer_boxes', shipmentIds: [] };

  const shipmentIds = boxes.map((b) => String(b.id)).sort();
  const untracked = boxes.filter((b) => !String(b.tracking_number || '').trim()).length;
  if (untracked) return { action: 'skip', reason: 'waiting_on_tracking', untracked, shipmentIds };

  const sig = shipmentIds.join(',');
  const history = Array.isArray(so && so.sent_history) ? so.sent_history : [];
  if (history.some((h) => h && h.type === 'shipment' && h.shipment_sig === sig)) {
    return { action: 'skip', reason: 'already_sent', shipmentIds };
  }

  const times = boxes.map(shipmentTime);
  if (times.some((t) => t === null)) return { action: 'skip', reason: 'undated_box', shipmentIds };
  const newest = Math.max(...times);
  if (now - newest < minAgeMs) return { action: 'skip', reason: 'inside_grace_window', shipmentIds };
  if (now - newest > maxAgeMs) return { action: 'skip', reason: 'older_than_max_age', shipmentIds };

  return { action: 'send', reason: 'ready', shipmentIds };
}

async function runSweep(admin, { dryRun }) {
  const { data: orders, error } = await admin.from('sales_orders')
    .select('id,status,_shipments,sent_history,deleted_at')
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

  const summary = { scanned, sent: 0, failed: 0, dryRun: !!dryRun, skipped: {}, sends: [], failures: [], waitingOnTracking: [] };
  const now = Date.now();

  for (const so of orders || []) {
    const plan = shipmentNoticePlan(so, { now });
    if (plan.action === 'skip') {
      summary.skipped[plan.reason] = (summary.skipped[plan.reason] || 0) + 1;
      // Visible, not silent: an order stuck waiting on one label is a rep's
      // cue to add the tracking or send the notice by hand.
      if (plan.reason === 'waiting_on_tracking') summary.waitingOnTracking.push({ so: so.id, boxes: plan.untracked });
      continue;
    }
    if (dryRun) { summary.sends.push({ so: so.id, boxes: plan.shipmentIds.length, dryRun: true }); continue; }

    try {
      const { status, payload } = await sendShipmentNotice(admin, {
        soId: so.id,
        shipmentIds: plan.shipmentIds,
        requireTracking: true,
        sentBy: 'shipment-sweep',
      });
      if (status === 200 && payload && payload.ok) {
        summary.sent += 1;
        summary.sends.push({ so: so.id, to: payload.to, boxes: payload.boxes });
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

  // Armed only when the env var says so — merging this must not start emailing
  // coaches on its own.
  const armed = String(process.env.SO_SHIPMENT_AUTONOTIFY || '').trim().toLowerCase() === 'on';
  let dryRun = !armed;

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
    const summary = await runSweep(admin, { dryRun });
    if (dryRun && summary.sends.length) {
      console.log('[so-shipment-notify-sweep] DRY RUN — would notify:', JSON.stringify(summary.sends));
    }
    return ok({ ok: true, armed, ...summary });
  } catch (e) {
    console.error('[so-shipment-notify-sweep] failed:', e.message);
    return ok({ ok: false, armed, error: e.message });
  }
};

module.exports.shipmentNoticePlan = shipmentNoticePlan;
module.exports.runSweep = runSweep;
