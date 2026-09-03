// Staff accounting endpoint for the durable Stripe payout ledger.  It exposes
// service-role-only reconciliation rows to authorized QBO users and can replay
// a historical automatic payout from Stripe without creating any QBO record.

const stripe = require('stripe');
const { corsHeaders, getSupabaseAdmin, verifyQBOUser } = require('./_shared');
const { recordPayoutReconciliation } = require('./_stripeReconciliation');

const response = (statusCode, origin, payload) => ({
  statusCode,
  headers: corsHeaders(origin),
  body: JSON.stringify(payload),
});

const validPayoutId = (value) => /^po_[A-Za-z0-9_]+$/.test(String(value || ''));

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

    return response(400, origin, { error: 'Unknown action: ' + action });
  } catch (error) {
    console.error('[stripe-reconciliation]', action, error.message);
    return response(500, origin, { error: 'Stripe reconciliation failed: ' + error.message });
  }
};

module.exports.validPayoutId = validPayoutId;
