// Nightly Stripe accounting safety net. Webhooks remain the fast path; this
// sweep replays recent charges and payouts from Stripe's API so a missed event
// cannot leave the portal permanently incomplete.
//
// Findings are durable. The sweep records what Stripe said about each unlinked
// order, syncs incidents, and drains at most one claimed alert from an outbox,
// so a Netlify retry after a timeout cannot re-send an email that already went
// out. It never links a charge that did not succeed, never promotes an order to
// paid, and never creates a QuickBooks transaction.

const stripe = require('stripe');
const { getSupabaseAdmin } = require('./_shared');
const { escapeHtml, sendBrevoEmail } = require('./_webstoreNotifications');
const {
  auditWebhookConfiguration,
  inspectPaymentIntentFinancials,
  reconcilePayoutBatch,
} = require('./_stripeReconciliation');

const HEADERS = { 'Content-Type': 'application/json' };

// The scheduled function times out at 26s (netlify.toml). Catch-up and payout
// reconciliation are bounded well inside that so the incident sync and the
// alert drain always get to run -- an invocation killed mid-flight is what
// produces the duplicate-delivery risk in the first place.
const WORK_BUDGET_MS = Number(process.env.STRIPE_SWEEP_WORK_BUDGET_MS) || 15000;
const CATCH_UP_SHARE = 0.6;

// The batch is split into two lanes rather than ordered one way. Newest-first
// alone lets 25 abandoned checkouts push a genuine old exception out of every
// nightly batch forever; oldest-first alone lets a permanently stuck order
// delay tonight's missed webhook.
const ACTIONABLE_LANE = 15;
const RECENT_LANE = 10;

function alertRecipients() {
  const raw = process.env.STRIPE_RECONCILIATION_ALERT_EMAIL
    || process.env.SYSTEM_HEALTH_ALERT_EMAIL
    || 'steve@nationalsportsapparel.com';
  const seen = new Set();
  return String(raw).split(/[;,]/).map((email) => email.trim().toLowerCase())
    .filter((email) => email && email.includes('@') && !seen.has(email) && seen.add(email))
    .map((email) => ({ email }));
}

function isScheduled(event) {
  if (String(event && event.headers && event.headers['x-nf-event'] || '').toLowerCase() === 'schedule') return true;
  try { return Boolean(JSON.parse((event && event.body) || '{}').next_run); } catch (_) { return false; }
}

// Stripe returns resource_missing for an ID that never existed, was created on
// a different account, or belongs to a deleted test object. That is a distinct
// operator question from a transport failure, so it gets its own disposition.
function isMissingStripeResource(error) {
  if (!error) return false;
  if (String(error.code || '') === 'resource_missing') return true;
  return Number(error.statusCode || error.status || 0) === 404;
}

function safeStripeError(error) {
  const code = error && (error.code || error.type);
  const message = String((error && error.message) || error || 'Unknown Stripe error');
  return String(code ? `${code}: ${message}` : message).slice(0, 500);
}

function maskPaymentIntent(value) {
  const id = String(value == null ? '' : value);
  if (id.length <= 17) return id;
  return `${id.slice(0, 14)}…`;
}

async function selectCatchUpOrders(admin, { actionableLimit = ACTIONABLE_LANE, recentLimit = RECENT_LANE } = {}) {
  const base = () => admin.from('webstore_orders')
    .select('id,so_id,status,total,stripe_pi_id,created_at')
    .eq('payment_mode', 'paid')
    .not('stripe_pi_id', 'is', null)
    .is('stripe_balance_transaction_id', null);

  const [actionable, recent] = await Promise.all([
    // Oldest first, incomplete checkouts excluded: a long-standing exception
    // is guaranteed an attempt on every run.
    base().neq('status', 'pending_payment').order('created_at', { ascending: true }).limit(actionableLimit),
    // Newest first: a webhook missed tonight is still applied tonight.
    base().order('created_at', { ascending: false }).limit(recentLimit),
  ]);
  if (actionable.error) throw actionable.error;
  if (recent.error) throw recent.error;

  const byId = new Map();
  for (const order of [...(actionable.data || []), ...(recent.data || [])]) {
    if (!byId.has(order.id)) byId.set(order.id, order);
  }
  return [...byId.values()];
}

// Read-only classification. inspectPaymentIntentFinancials persists a ledger
// row only for a succeeded PaymentIntent that carries a charge balance
// transaction, so no branch here can manufacture a payment.
async function classifyOrder({ client, admin, order }) {
  try {
    const financials = await inspectPaymentIntentFinancials({
      client, sb: admin, paymentIntent: { id: order.stripe_pi_id },
    });
    const status = (financials && financials.payment_intent_status) || 'unknown';
    if (financials && financials.row) {
      return { disposition: 'linked', payment_intent_status: status };
    }
    return { disposition: 'not_succeeded', payment_intent_status: status };
  } catch (error) {
    if (isMissingStripeResource(error)) {
      return { disposition: 'missing_in_stripe', payment_intent_status: 'unavailable', last_error: safeStripeError(error) };
    }
    return { disposition: 'error', payment_intent_status: 'unknown', last_error: safeStripeError(error) };
  }
}

async function catchUpUnlinkedOrders(admin, client, options = {}) {
  const { deadlineAt = null, now = () => Date.now() } = options;
  const orders = await selectCatchUpOrders(admin, options);
  const linked = [];
  const skipped = [];
  const errors = [];
  const checks = [];
  let attempted = 0;

  for (const order of orders) {
    if (deadlineAt && now() >= deadlineAt) break;
    attempted += 1;
    const result = await classifyOrder({ client, admin, order });
    checks.push({
      order_id: order.id,
      payment_intent_id: order.stripe_pi_id || null,
      payment_intent_status: result.payment_intent_status || null,
      portal_status: order.status || null,
      disposition: result.disposition,
      last_error: result.last_error || null,
    });
    if (result.disposition === 'linked') {
      linked.push(order.id);
    } else if (result.disposition === 'error') {
      errors.push({ order_id: order.id, error: result.last_error });
    } else {
      skipped.push({
        order_id: order.id,
        portal_status: order.status || null,
        payment_intent_status: result.payment_intent_status,
        disposition: result.disposition,
      });
    }
  }

  return {
    selected: orders.length,
    attempted,
    remaining: Math.max(0, orders.length - attempted),
    linked,
    skipped,
    errors,
    checks,
  };
}

async function recordOrderChecks(admin, checks) {
  if (!checks || !checks.length) return 0;
  const { data, error } = await admin.rpc('record_stripe_reconciliation_order_checks', { p_checks: checks });
  if (error) throw new Error(`Could not record Stripe order checks: ${error.message}`);
  return Number(data) || 0;
}

// Findings the database cannot see for itself: the live Stripe webhook
// subscription and per-payout catch-up failures.
function runtimeFindings({ webhook, payoutSweep }) {
  const findings = [];
  if (webhook && !webhook.healthy) {
    findings.push({
      incident_key: 'stripe:webhook-coverage',
      category: 'stripe_webhook_coverage',
      severity: 'critical',
      summary: 'The portal Stripe webhook endpoint is missing required events.',
      record_type: 'stripe_webhook',
      record_id: 'portal',
      details: {
        missing_events: webhook.missing_events || [],
        endpoint_count: (webhook.endpoints || []).length,
      },
    });
  }
  for (const failure of ((payoutSweep && payoutSweep.errors) || [])) {
    findings.push({
      incident_key: `payout:catchup-error:${failure.payout_id}`,
      category: 'payout_catch_up_error',
      severity: 'critical',
      summary: 'A payout could not be reconciled against Stripe during the nightly sweep.',
      record_type: 'stripe_payout',
      record_id: failure.payout_id,
      details: { error: String(failure.error || '').slice(0, 500) },
    });
  }
  return findings;
}

const RECOMMENDED_ACTION = {
  settled_order_unlinked: 'Stripe settled this charge. Re-run the order backfill from QuickBooks → Stripe Payouts to attach the ledger row.',
  portal_payment_status_review: 'Stripe holds no successful payment for this order. Review the portal status. Do not link or mark it paid.',
  stripe_payment_intent_missing: 'Stripe will not return this PaymentIntent. Confirm the account and inspect it in the Stripe dashboard.',
  order_link_not_attempted: 'The nightly catch-up has not reached this order yet. It is queued for the next run.',
  order_link_error: 'The catch-up attempt failed. Investigate the error below, then re-run the sweep.',
  order_amount_mismatch: 'Net Stripe customer activity differs from the portal total. Reconcile the refund/dispute history against the order.',
  payout_not_reconciled: 'Open the payout in QuickBooks → Stripe Payouts and re-run its reconciliation.',
  payout_failed: 'The bank rejected this payout. Confirm the payout account in Stripe.',
  payout_catch_up_error: 'The sweep could not reconcile this payout. Re-run it from QuickBooks → Stripe Payouts.',
  stripe_webhook_coverage: 'Repair the webhook event list from QuickBooks → Stripe Payouts so live events resume.',
};

function detailLines(incident) {
  const details = incident.details || {};
  const lines = [];
  const push = (label, value) => {
    if (value == null || value === '') return;
    lines.push(`${escapeHtml(label)}: ${escapeHtml(value)}`);
  };
  if (incident.record_type === 'webstore_order') {
    push('Order', incident.record_id);
    push('Sales order', details.so_id || 'none');
    push('Portal status', details.portal_status);
    if (details.portal_total_cents != null) push('Portal total', `$${(Number(details.portal_total_cents) / 100).toFixed(2)}`);
    push('Created', details.created_at);
    if (details.payment_intent_id) push('PaymentIntent', maskPaymentIntent(details.payment_intent_id));
    push('Stripe status', details.payment_intent_status || 'not checked');
    push('Catch-up disposition', details.disposition || 'not attempted');
    push('Checked', details.checked_at);
    if (details.stripe_activity_cents != null) push('Stripe net activity', `$${(Number(details.stripe_activity_cents) / 100).toFixed(2)}`);
    if (details.stripe_charge_cents != null) push('Original charge', `$${(Number(details.stripe_charge_cents) / 100).toFixed(2)}`);
    push('Error', details.last_error);
  } else if (incident.record_type === 'stripe_payout') {
    push('Payout', incident.record_id);
    if (details.amount_cents != null) push('Amount', `$${(Number(details.amount_cents) / 100).toFixed(2)}`);
    push('Status', details.status || details.reconciliation_status);
    if (details.difference_cents != null) push('Difference', `${Number(details.difference_cents)}¢`);
    push('Arrival date', details.arrival_date);
    push('Failure', details.failure_message || details.failure_code);
    push('Error', details.error);
  } else {
    push('Missing events', Array.isArray(details.missing_events) ? details.missing_events.join(', ') : details.missing_events);
    push('Endpoints found', details.endpoint_count);
  }
  return lines;
}

function buildAlertEmail(incidents) {
  const rows = (incidents || []).map((incident) => {
    const critical = incident.severity === 'critical';
    const color = critical ? '#991b1b' : '#92400e';
    const bg = critical ? '#fee2e2' : '#fef3c7';
    const label = critical ? 'CRITICAL' : 'REVIEW';
    const action = RECOMMENDED_ACTION[incident.category] || '';
    return `<li style="margin:0 0 16px">
      <span style="display:inline-block;padding:2px 7px;border-radius:10px;background:${bg};color:${color};font-size:10px;font-weight:800">${label}</span>
      <strong style="margin-left:6px">${escapeHtml(incident.summary)}</strong>
      <div style="font-size:12px;color:#475569;margin-top:3px">${escapeHtml(incident.category)}</div>
      <div style="font-size:12px;color:#334155;margin-top:5px;line-height:1.6">${detailLines(incident).join('<br>')}</div>
      ${action ? `<div style="font-size:12px;color:#0f172a;margin-top:6px"><em>${escapeHtml(action)}</em></div>` : ''}
    </li>`;
  }).join('');
  const criticalCount = (incidents || []).filter((incident) => incident.severity === 'critical').length;
  const portal = String(process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  return {
    sender: { name: 'NSA Stripe Reconciliation', email: 'noreply@nationalsportsapparel.com' },
    to: alertRecipients(),
    subject: `Stripe reconciliation alert — ${incidents.length} open item${incidents.length === 1 ? '' : 's'} (${criticalCount} critical)`,
    htmlContent: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;color:#1e293b">
      <h2 style="margin-bottom:4px;color:#991b1b">Stripe reconciliation needs attention</h2>
      <p style="margin-top:0;color:#64748b">The nightly safety sweep found ${incidents.length} item${incidents.length === 1 ? '' : 's'} it could not prove automatically.</p>
      <ul style="padding-left:20px">${rows}</ul>
      <p><a href="${escapeHtml(`${portal}/?qb=1`)}" style="display:inline-block;background:#0b1f3a;color:white;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:700">Open QuickBooks → Stripe Payouts</a></p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:24px">
      <p style="font-size:11px;color:#94a3b8">No QuickBooks transaction is posted automatically. Open incidents remind at most once every 24 hours; healed incidents resolve on their own.</p>
    </div>`,
  };
}

async function claimAndSendAlert(admin) {
  const { data: claimed, error: claimError } = await admin.rpc('claim_stripe_reconciliation_alert');
  if (claimError) throw new Error(`Could not claim Stripe reconciliation alert: ${claimError.message}`);
  const alert = claimed && claimed[0];
  if (!alert) return { claimed: false, sent: false };

  try {
    const { data: incidents, error: incidentsError } = await admin.from('stripe_reconciliation_incidents')
      .select('incident_key,category,severity,summary,record_type,record_id,details')
      .in('incident_key', alert.incident_keys || []);
    if (incidentsError) throw new Error(`Could not load Stripe reconciliation incidents: ${incidentsError.message}`);
    if (!incidents || !incidents.length) throw new Error('Claimed Stripe reconciliation alert has no incident rows');
    // The outbox UUID is Brevo's idempotency key, so a retry after a lost
    // response does not deliver the same email twice. Provider success followed
    // by a failed completion update is still possible and is retried, which is
    // at-least-once delivery, not exactly-once.
    const providerMessageId = await sendBrevoEmail(buildAlertEmail(incidents), alert.id);
    const { error: completeError } = await admin.rpc('complete_stripe_reconciliation_alert', {
      p_id: alert.id,
      p_provider_message_id: providerMessageId,
    });
    if (completeError) throw new Error(`Could not complete Stripe reconciliation alert: ${completeError.message}`);
    return { claimed: true, sent: true, id: alert.id, incident_count: incidents.length };
  } catch (error) {
    const { error: failError } = await admin.rpc('fail_stripe_reconciliation_alert', {
      p_id: alert.id,
      p_error: error.message || String(error),
    });
    if (failError) console.error('[stripe-reconciliation-sweep] could not requeue alert:', failError.message);
    throw error;
  }
}

async function runSweep(admin, client, options = {}) {
  const now = options.now || (() => Date.now());
  const startedAt = now();
  const workBudgetMs = Number(options.workBudgetMs) || WORK_BUDGET_MS;
  const catchUpDeadline = startedAt + Math.floor(workBudgetMs * CATCH_UP_SHARE);
  const payoutDeadline = startedAt + workBudgetMs;
  const timings = {};

  const catchUp = await catchUpUnlinkedOrders(admin, client, { ...options, now, deadlineAt: catchUpDeadline });
  timings.catch_up_ms = now() - startedAt;

  const checksAt = now();
  const checksRecorded = await recordOrderChecks(admin, catchUp.checks);
  timings.record_checks_ms = now() - checksAt;

  const payoutAt = now();
  const createdGte = Math.floor((now() - 21 * 24 * 60 * 60 * 1000) / 1000);
  const payoutSweep = await reconcilePayoutBatch({
    client, sb: admin, createdGte, limit: 25, deadlineAt: payoutDeadline, now,
  });
  timings.payout_ms = now() - payoutAt;

  const webhookAt = now();
  const webhook = await auditWebhookConfiguration(client);
  timings.webhook_ms = now() - webhookAt;

  const scanAt = now();
  const { data: scan, error: scanError } = await admin.rpc('sync_stripe_reconciliation_incidents', {
    p_runtime_findings: runtimeFindings({ webhook, payoutSweep }),
  });
  if (scanError) throw new Error(`Stripe reconciliation scan failed: ${scanError.message}`);
  timings.scan_ms = now() - scanAt;

  const alertAt = now();
  const delivery = await claimAndSendAlert(admin);
  timings.alert_ms = now() - alertAt;
  timings.total_ms = now() - startedAt;

  return {
    ok: Number(scan && scan.open_incident_count) === 0,
    finding_count: Number(scan && scan.finding_count) || 0,
    open_incident_count: Number(scan && scan.open_incident_count) || 0,
    resolved_count: Number(scan && scan.resolved_count) || 0,
    alert_created: Boolean(scan && scan.alert_created),
    alert_claimed: delivery.claimed,
    alert_sent: delivery.sent,
    checks_recorded: checksRecorded,
    webhook,
    catch_up: catchUp,
    payout_sweep: payoutSweep,
    timings,
  };
}

exports.handler = async (event) => {
  if (!isScheduled(event)) {
    const expected = process.env.INTERNAL_FUNCTION_SECRET || '';
    const supplied = String(event && event.headers && event.headers['x-internal-secret'] || '');
    if (!expected || supplied !== expected) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw new Error('STRIPE_SECRET_KEY is not configured');
    const result = await runSweep(getSupabaseAdmin(), stripe(secret));
    console.log('[stripe-reconciliation-sweep]', JSON.stringify({
      ok: result.ok,
      linked: result.catch_up.linked.length,
      attempted: result.catch_up.attempted,
      catch_up_remaining: result.catch_up.remaining,
      payouts: result.payout_sweep.processed,
      payouts_remaining: result.payout_sweep.remaining || 0,
      findings: result.finding_count,
      open_incidents: result.open_incident_count,
      resolved: result.resolved_count,
      alert_sent: result.alert_sent,
      webhook_healthy: result.webhook.healthy,
      timings: result.timings,
    }));
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[stripe-reconciliation-sweep] failed:', error.message || error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};

module.exports.alertRecipients = alertRecipients;
module.exports.buildAlertEmail = buildAlertEmail;
module.exports.catchUpUnlinkedOrders = catchUpUnlinkedOrders;
module.exports.claimAndSendAlert = claimAndSendAlert;
module.exports.isScheduled = isScheduled;
module.exports.maskPaymentIntent = maskPaymentIntent;
module.exports.recordOrderChecks = recordOrderChecks;
module.exports.runSweep = runSweep;
module.exports.runtimeFindings = runtimeFindings;
module.exports.selectCatchUpOrders = selectCatchUpOrders;
