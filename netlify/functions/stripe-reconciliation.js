// Staff accounting endpoint for the durable Stripe payout ledger.  It exposes
// service-role-only reconciliation rows to authorized QBO users and can replay
// a historical automatic payout from Stripe without creating any QBO record.

const stripe = require('stripe');
const { corsHeaders, getSupabaseAdmin, verifyQBOUser } = require('./_shared');
const {
  auditWebhookConfiguration,
  inspectPaymentIntentFinancials,
  reconcilePayoutBatch,
  recordPayoutReconciliation,
  repairWebhookConfiguration,
} = require('./_stripeReconciliation');

const response = (statusCode, origin, payload) => ({
  statusCode,
  headers: corsHeaders(origin),
  body: JSON.stringify(payload),
});

const validPayoutId = (value) => /^po_[A-Za-z0-9_]+$/.test(String(value || ''));

function summarizeOrders(rows) {
  return (rows || []).reduce((summary, row) => {
    const cents = Math.round(Number(row.total || 0) * 100);
    const linked = Boolean(row.stripe_balance_transaction_id);
    summary.order_count += 1;
    summary.total_cents += cents;
    summary[linked ? 'linked_count' : 'unlinked_count'] += 1;
    summary[linked ? 'linked_cents' : 'unlinked_cents'] += cents;
    return summary;
  }, { order_count: 0, linked_count: 0, unlinked_count: 0, total_cents: 0, linked_cents: 0, unlinked_cents: 0 });
}

function summarizeSettledOrders(rows, chargeByOrder) {
  return (rows || []).reduce((summary, row) => {
    const charge = chargeByOrder.get(row.id);
    if (!charge) return summary;
    const cents = Number(charge.amount_cents) || 0;
    const linked = Boolean(row.stripe_balance_transaction_id);
    summary.order_count += 1;
    summary.total_cents += cents;
    summary.portal_total_cents += Math.round(Number(row.total || 0) * 100);
    summary[linked ? 'linked_count' : 'unlinked_count'] += 1;
    summary[linked ? 'linked_cents' : 'unlinked_cents'] += cents;
    return summary;
  }, { order_count: 0, linked_count: 0, unlinked_count: 0, total_cents: 0, portal_total_cents: 0, linked_cents: 0, unlinked_cents: 0 });
}

function chargeAmountMismatches(orders, chargeByOrder) {
  return (orders || []).flatMap((order) => {
    const charge = chargeByOrder.get(order.id);
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
    }];
  });
}

async function oldestCardOrderUnix(admin) {
  const { data, error } = await admin.from('webstore_orders')
    .select('created_at')
    .eq('payment_mode', 'paid')
    .not('stripe_pi_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  const timestamp = data && data[0] && Date.parse(data[0].created_at);
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor((timestamp - (7 * 24 * 60 * 60 * 1000)) / 1000);
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  if (event.httpMethod === 'OPTIONS') return response(200, origin, {});
  if (event.httpMethod !== 'POST') return response(405, origin, { error: 'POST only' });

  const verified = await verifyQBOUser(event);
  if (!verified.ok) return response(verified.status, origin, { error: verified.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, origin, { error: 'Invalid JSON' }); }

  const admin = getSupabaseAdmin();
  const action = body.action || 'list_payouts';
  try {
    if (action === 'list_payouts') {
      const limit = Math.max(1, Math.min(250, Number(body.limit) || 100));
      const { data, error } = await admin.from('stripe_payouts')
        .select('*').order('stripe_created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return response(200, origin, { payouts: data || [] });
    }

    if (action === 'payout_detail') {
      if (!validPayoutId(body.payout_id)) return response(400, origin, { error: 'Valid payout_id required' });
      const payoutId = String(body.payout_id);
      const [payoutResult, transactionResult, entryResult] = await Promise.all([
        admin.from('stripe_payouts').select('*').eq('stripe_payout_id', payoutId).maybeSingle(),
        admin.from('stripe_balance_transactions').select('*').eq('stripe_payout_id', payoutId)
          .order('stripe_created_at', { ascending: true }),
        admin.from('stripe_payout_qbo_entries').select('*').eq('stripe_payout_id', payoutId),
      ]);
      const error = payoutResult.error || transactionResult.error || entryResult.error;
      if (error) throw error;
      if (!payoutResult.data) return response(404, origin, { error: 'Payout not found' });
      const entries = entryResult.data || [];
      return response(200, origin, {
        payout: payoutResult.data,
        transactions: transactionResult.data || [],
        qbo_entries: entries,
        qbo_ready: payoutResult.data.reconciliation_status === 'exact' &&
          entries.length > 0 && entries.every((entry) => entry.qbo_ready),
      });
    }

    if (action === 'reconcile_payout') {
      if (!validPayoutId(body.payout_id)) return response(400, origin, { error: 'Valid payout_id required' });
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return response(500, origin, { error: 'Stripe is not configured' });
      const client = stripe(secret);
      const payout = await client.payouts.retrieve(String(body.payout_id));
      const result = await recordPayoutReconciliation({ client, sb: admin, payout });
      return response(200, origin, { ok: true, reconciliation: result });
    }

    if (action === 'backfill_orders') {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return response(500, origin, { error: 'Stripe is not configured' });
      const limit = Math.max(1, Math.min(25, Number(body.limit) || 10));
      let query = admin.from('webstore_orders')
        .select('id,so_id,total,status,stripe_pi_id,created_at')
        .eq('payment_mode', 'paid')
        .not('stripe_pi_id', 'is', null)
        .is('stripe_balance_transaction_id', null)
        .order('id', { ascending: true })
        .limit(limit);
      if (body.starting_after) query = query.gt('id', String(body.starting_after));
      const { data: orders, error } = await query;
      if (error) throw error;
      const client = stripe(secret);
      const results = [];
      const skipped = [];
      const errors = [];
      for (const order of (orders || [])) {
        try {
          const financials = await inspectPaymentIntentFinancials({
            client,
            sb: admin,
            paymentIntent: { id: order.stripe_pi_id },
          });
          const row = financials && financials.row;
          if (!row) {
            skipped.push({ order_id: order.id, so_id: order.so_id || null, portal_status: order.status || null, payment_intent_status: financials?.payment_intent_status || 'unknown' });
            continue;
          }
          const portalTotalCents = Math.round(Number(order.total || 0) * 100);
          results.push({
            order_id: order.id,
            so_id: order.so_id || null,
            balance_transaction_id: row.stripe_balance_transaction_id,
            portal_total_cents: portalTotalCents,
            stripe_amount_cents: row.amount_cents,
            amount_matches: portalTotalCents === row.amount_cents,
          });
        } catch (orderError) {
          errors.push({ order_id: order.id, error: orderError.message });
        }
      }
      const last = orders && orders.length ? orders[orders.length - 1] : null;
      return response(200, origin, {
        processed: (orders || []).length,
        linked: results.length,
        results,
        skipped,
        errors,
        has_more: (orders || []).length === limit,
        next_cursor: last ? last.id : null,
      });
    }

    if (action === 'backfill_payouts') {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return response(500, origin, { error: 'Stripe is not configured' });
      const createdGte = Number(body.created_gte) || await oldestCardOrderUnix(admin);
      const result = await reconcilePayoutBatch({
        client: stripe(secret),
        sb: admin,
        createdGte,
        startingAfter: body.starting_after || null,
        limit: body.limit || 3,
      });
      return response(200, origin, { ...result, created_gte: createdGte });
    }

    if (action === 'webhook_status') {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return response(500, origin, { error: 'Stripe is not configured' });
      return response(200, origin, await auditWebhookConfiguration(stripe(secret)));
    }

    if (action === 'repair_webhook_events') {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return response(500, origin, { error: 'Stripe is not configured' });
      return response(200, origin, await repairWebhookConfiguration(stripe(secret)));
    }

    if (action === 'reconciliation_status') {
      const [ordersResult, payoutsResult, chargesResult] = await Promise.all([
        admin.from('webstore_orders').select('id,so_id,total,status,stripe_balance_transaction_id')
          .eq('payment_mode', 'paid').not('stripe_pi_id', 'is', null),
        admin.from('stripe_payouts').select('stripe_payout_id,automatic,method,status,reconciliation_status'),
        admin.from('stripe_balance_transactions')
          .select('stripe_balance_transaction_id,webstore_order_id,amount_cents')
          .eq('reporting_category', 'charge').not('webstore_order_id', 'is', null),
      ]);
      if (ordersResult.error || payoutsResult.error || chargesResult.error) {
        throw ordersResult.error || payoutsResult.error || chargesResult.error;
      }
      const orders = ordersResult.data || [];
      const payouts = payoutsResult.data || [];
      const chargeByOrder = new Map((chargesResult.data || []).map((row) => [row.webstore_order_id, row]));
      const cardOrders = summarizeOrders(orders);
      const incompleteAttempts = summarizeOrders(orders.filter((row) =>
        !chargeByOrder.has(row.id) && row.status === 'pending_payment'));
      const portalPaymentReview = orders.filter((row) =>
        !chargeByOrder.has(row.id) && row.status !== 'pending_payment');
      const settledOrders = summarizeSettledOrders(orders, chargeByOrder);
      const settledUnlinkedOrders = orders.filter((row) =>
        chargeByOrder.has(row.id) && !row.stripe_balance_transaction_id);
      const amountMismatches = chargeAmountMismatches(orders, chargeByOrder);
      const so2313 = summarizeOrders(orders.filter((row) => {
        const soId = String(row.so_id || '').trim().toUpperCase();
        return soId === 'SO-2313' || soId === '2313';
      }));
      const actionablePayouts = payouts.filter((row) => row.automatic &&
        ['pending', 'mismatch', 'failed'].includes(String(row.reconciliation_status || 'pending')));
      const unavailablePayouts = payouts.filter((row) => row.reconciliation_status === 'unavailable');
      return response(200, origin, {
        unlinked_card_orders: settledUnlinkedOrders.length,
        portal_payment_review_count: portalPaymentReview.length,
        portal_payment_review: portalPaymentReview.map((row) => ({
          order_id: row.id,
          so_id: row.so_id || null,
          portal_status: row.status || null,
          portal_total_cents: Math.round(Number(row.total || 0) * 100),
        })),
        charge_amount_mismatch_count: amountMismatches.length,
        charge_amount_mismatches: amountMismatches,
        non_exact_automatic_payouts: actionablePayouts.length,
        actionable_automatic_payouts: actionablePayouts.length,
        unavailable_payouts: unavailablePayouts.length,
        card_orders: cardOrders,
        settled_card_orders: settledOrders,
        incomplete_card_attempts: incompleteAttempts,
        so_2313: so2313,
      });
    }

    return response(400, origin, { error: 'Unknown action: ' + action });
  } catch (error) {
    console.error('[stripe-reconciliation]', action, error.message);
    return response(500, origin, { error: 'Stripe reconciliation failed: ' + error.message });
  }
};

module.exports.validPayoutId = validPayoutId;
module.exports.oldestCardOrderUnix = oldestCardOrderUnix;
module.exports.summarizeOrders = summarizeOrders;
module.exports.summarizeSettledOrders = summarizeSettledOrders;
module.exports.chargeAmountMismatches = chargeAmountMismatches;
