// Nightly Stripe accounting safety net. Webhooks remain the fast path; this
// sweep replays recent charges and payouts from Stripe's API so a missed event
// cannot leave the portal permanently incomplete. It emails only when there is
// an actionable old/unlinked order, payout mismatch/failure, webhook gap, or
// catch-up error.

const stripe = require('stripe');
const { getSupabaseAdmin } = require('./_shared');
const {
  auditWebhookConfiguration,
  inspectPaymentIntentFinancials,
  reconcilePayoutBatch,
} = require('./_stripeReconciliation');

const HEADERS = { 'Content-Type': 'application/json' };
const ALERT_EMAIL = process.env.STRIPE_RECONCILIATION_ALERT_EMAIL ||
  process.env.SYSTEM_HEALTH_ALERT_EMAIL || 'steve@nationalsportsapparel.com';

function isScheduled(event) {
  if (String(event && event.headers && event.headers['x-nf-event'] || '').toLowerCase() === 'schedule') return true;
  try { return Boolean(JSON.parse((event && event.body) || '{}').next_run); } catch (_) { return false; }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function catchUpUnlinkedOrders(admin, client, limit = 25) {
  const { data, error } = await admin.from('webstore_orders')
    .select('id,stripe_pi_id')
    .eq('payment_mode', 'paid')
    .not('stripe_pi_id', 'is', null)
    .is('stripe_balance_transaction_id', null)
    // Prioritize newly missed webhooks. Persistent legacy exceptions therefore
    // cannot consume the whole nightly batch and starve current orders.
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const linked = [];
  const skipped = [];
  const errors = [];
  for (const order of (data || [])) {
    try {
      const financials = await inspectPaymentIntentFinancials({ client, sb: admin, paymentIntent: { id: order.stripe_pi_id } });
      const row = financials && financials.row;
      if (!row) {
        skipped.push({ order_id: order.id, payment_intent_status: financials?.payment_intent_status || 'unknown' });
        continue;
      }
      linked.push(order.id);
    } catch (orderError) {
      errors.push({ order_id: order.id, error: orderError.message });
    }
  }
  return { attempted: (data || []).length, linked, skipped, errors };
}

async function loadFindings(admin, graceDays = 7) {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();
  const failureCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [unlinked, mismatches, failures, linkedOrders, linkedCharges] = await Promise.all([
    admin.from('webstore_orders')
      .select('id,so_id,total,created_at', { count: 'exact' })
      .eq('payment_mode', 'paid').not('stripe_pi_id', 'is', null)
      .is('stripe_balance_transaction_id', null).lt('created_at', cutoff)
      .neq('status', 'pending_payment')
      .order('created_at', { ascending: true }).limit(25),
    admin.from('stripe_payouts')
      .select('stripe_payout_id,amount_cents,reconciliation_difference_cents,reconciliation_status,arrival_date')
      .eq('automatic', true).eq('status', 'paid')
      .in('reconciliation_status', ['pending', 'mismatch', 'failed'])
      .order('stripe_created_at', { ascending: false }).limit(25),
    admin.from('stripe_payouts')
      .select('stripe_payout_id,amount_cents,status,failure_code,failure_message,arrival_date')
      .eq('automatic', true).in('status', ['failed', 'canceled'])
      .gte('stripe_created_at', failureCutoff)
      .order('stripe_created_at', { ascending: false }).limit(25),
    admin.from('webstore_orders')
      .select('id,so_id,total,stripe_balance_transaction_id,created_at')
      .eq('payment_mode', 'paid').not('stripe_balance_transaction_id', 'is', null),
    admin.from('stripe_balance_transactions')
      .select('stripe_balance_transaction_id,amount_cents')
      .eq('reporting_category', 'charge'),
  ]);
  const error = unlinked.error || mismatches.error || failures.error || linkedOrders.error || linkedCharges.error;
  if (error) throw error;
  const chargeById = new Map((linkedCharges.data || []).map((row) => [row.stripe_balance_transaction_id, row]));
  const amountMismatches = (linkedOrders.data || []).flatMap((order) => {
    const charge = chargeById.get(order.stripe_balance_transaction_id);
    if (!charge) return [];
    const portalCents = Math.round(Number(order.total || 0) * 100);
    const stripeCents = Number(charge.amount_cents) || 0;
    if (portalCents === stripeCents) return [];
    return [{
      order_id: order.id,
      so_id: order.so_id || null,
      portal_total_cents: portalCents,
      stripe_amount_cents: stripeCents,
      difference_cents: stripeCents - portalCents,
      created_at: order.created_at,
    }];
  });
  return {
    unlinked: unlinked.data || [],
    unlinked_count: unlinked.count || 0,
    mismatches: mismatches.data || [],
    failures: failures.data || [],
    amount_mismatches: amountMismatches,
    cutoff,
  };
}

async function sendAlert({ webhook, catchUp, payoutSweep, findings }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) throw new Error('BREVO_API_KEY is not configured');
  const orderRows = findings.unlinked.map((row) =>
    `<li><strong>${escapeHtml(row.id)}</strong> · ${escapeHtml(row.so_id || 'no SO')} · $${Number(row.total || 0).toFixed(2)} · ${escapeHtml(row.created_at)}</li>`).join('');
  const mismatchRows = findings.mismatches.map((row) =>
    `<li><strong>${escapeHtml(row.stripe_payout_id)}</strong> · ${escapeHtml(row.reconciliation_status || 'not reconciled')} · difference ${Number(row.reconciliation_difference_cents || 0)}¢</li>`).join('');
  const failureRows = findings.failures.map((row) =>
    `<li><strong>${escapeHtml(row.stripe_payout_id)}</strong> · ${escapeHtml(row.failure_code || 'failed')} · ${escapeHtml(row.failure_message || '')}</li>`).join('');
  const amountRows = findings.amount_mismatches.map((row) =>
    `<li><strong>${escapeHtml(row.so_id || row.order_id)}</strong> · Stripe $${(Number(row.stripe_amount_cents || 0) / 100).toFixed(2)} vs portal $${(Number(row.portal_total_cents || 0) / 100).toFixed(2)}</li>`).join('');
  const catchUpRows = [...catchUp.errors, ...payoutSweep.errors].map((row) =>
    `<li><strong>${escapeHtml(row.order_id || row.payout_id || 'Stripe item')}</strong> · ${escapeHtml(row.error)}</li>`).join('');
  const htmlContent = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px">
    <h2 style="color:#b91c1c">Stripe reconciliation needs attention</h2>
    <p>The nightly safety sweep found an accounting item that could not be proven automatically.</p>
    ${!webhook.healthy ? `<h3>Webhook subscription</h3><p>Missing events: ${escapeHtml(webhook.missing_events.join(', ') || 'no active portal webhook endpoint')}</p>` : ''}
    ${findings.unlinked_count ? `<h3>Old card orders without a balance-transaction link (${findings.unlinked_count})</h3><ul>${orderRows}</ul>` : ''}
    ${findings.mismatches.length ? `<h3>Actionable paid payouts (${findings.mismatches.length})</h3><ul>${mismatchRows}</ul>` : ''}
    ${findings.failures.length ? `<h3>Failed payouts (${findings.failures.length})</h3><ul>${failureRows}</ul>` : ''}
    ${findings.amount_mismatches.length ? `<h3>Charged amount differs from portal order (${findings.amount_mismatches.length})</h3><ul>${amountRows}</ul>` : ''}
    ${catchUpRows ? `<h3>Catch-up errors</h3><ul>${catchUpRows}</ul>` : ''}
    <p style="font-size:12px;color:#64748b">Open QuickBooks → Stripe Payouts in the NSA portal to retry or inspect the ledger. No QuickBooks transaction is posted automatically.</p>
  </div>`;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Stripe Reconciliation', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: ALERT_EMAIL }],
      subject: `Stripe reconciliation alert — ${findings.unlinked_count} unlinked · ${findings.amount_mismatches.length} amount review · ${findings.mismatches.length} payout mismatch · ${findings.failures.length} failed`,
      htmlContent,
    }),
  });
  if (!response.ok) throw new Error(`Brevo ${response.status}: ${await response.text()}`);
}

async function runSweep(admin, client) {
  const catchUp = await catchUpUnlinkedOrders(admin, client);
  const createdGte = Math.floor((Date.now() - 21 * 24 * 60 * 60 * 1000) / 1000);
  const payoutSweep = await reconcilePayoutBatch({ client, sb: admin, createdGte, limit: 25 });
  const [webhook, findings] = await Promise.all([
    auditWebhookConfiguration(client),
    loadFindings(admin),
  ]);
  const actionable = !webhook.healthy || catchUp.errors.length > 0 || payoutSweep.errors.length > 0 ||
    findings.unlinked_count > 0 || findings.amount_mismatches.length > 0 || findings.mismatches.length > 0 || findings.failures.length > 0;
  if (actionable) await sendAlert({ webhook, catchUp, payoutSweep, findings });
  return { ok: !actionable, alerted: actionable, webhook, catch_up: catchUp, payout_sweep: payoutSweep, findings };
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
      payouts: result.payout_sweep.processed,
      unlinked: result.findings.unlinked_count,
      mismatches: result.findings.mismatches.length,
      amount_mismatches: result.findings.amount_mismatches.length,
      failed: result.findings.failures.length,
      webhook_healthy: result.webhook.healthy,
    }));
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[stripe-reconciliation-sweep] failed:', error.message || error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};

module.exports.catchUpUnlinkedOrders = catchUpUnlinkedOrders;
module.exports.isScheduled = isScheduled;
module.exports.loadFindings = loadFindings;
module.exports.runSweep = runSweep;
