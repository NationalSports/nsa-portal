/** @jest-environment node */

const {
  auditWebhookConfiguration,
  balanceTransactionRow,
  inspectPaymentIntentFinancials,
  listPayoutBalanceTransactions,
  reconcilePayoutBatch,
  repairWebhookConfiguration,
  recordPaymentIntentFinancials,
  recordPayoutReconciliation,
} = require('../../netlify/functions/_stripeReconciliation');
const {
  chargeAmountMismatches,
  summarizeSettledOrders,
} = require('../../netlify/functions/stripe-reconciliation');

const bt = (id, { amount = 1000, fee = 59, net = amount - fee, source = null, reportingCategory = 'charge', type = reportingCategory } = {}) => ({
  id,
  amount,
  fee,
  net,
  source,
  currency: 'usd',
  reporting_category: reportingCategory,
  type,
  status: 'available',
  created: 1788451200,
  available_on: 1788624000,
  fee_details: [{ amount: fee, currency: 'usd', type: 'stripe_fee', description: 'Stripe processing fees' }],
});

describe('Stripe catch-up pagination and webhook audit', () => {
  test('returns a resumable payout cursor and preserves per-payout failures', async () => {
    const sb = fakeSb();
    const payouts = [
      { id: 'po_ok', amount: 941, currency: 'usd', status: 'paid', automatic: true, method: 'standard', reconciliation_status: 'completed', created: 1788451200 },
      { id: 'po_bad', amount: 941, currency: 'usd', status: 'paid', automatic: true, method: 'standard', reconciliation_status: 'completed', created: 1788451200 },
    ];
    const client = {
      payouts: { list: jest.fn().mockResolvedValue({ data: payouts, has_more: true }) },
      balanceTransactions: { list: jest.fn()
        .mockResolvedValueOnce({ data: [bt('txn_ok')], has_more: false })
        .mockRejectedValueOnce(new Error('temporary Stripe failure')) },
    };
    const result = await reconcilePayoutBatch({ client, sb, createdGte: 1788000000, startingAfter: 'po_newer', limit: 2 });
    expect(client.payouts.list).toHaveBeenCalledWith({ limit: 2, created: { gte: 1788000000 }, starting_after: 'po_newer' });
    expect(result).toMatchObject({ processed: 2, has_more: true, next_cursor: 'po_bad' });
    expect(result.results).toEqual([expect.objectContaining({ payout_id: 'po_ok', status: 'exact' })]);
    expect(result.errors).toEqual([expect.objectContaining({ payout_id: 'po_bad', error: 'temporary Stripe failure' })]);
  });

  test('confirms only an active portal webhook covering every required event', async () => {
    const client = { webhookEndpoints: { list: jest.fn().mockResolvedValue({
      data: [{ id: 'we_live', url: 'https://connect.nationalsportsapparel.com/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: ['*'] }],
      has_more: false,
    }) } };
    await expect(auditWebhookConfiguration(client)).resolves.toMatchObject({ healthy: true, missing_events: [] });
  });

  test('reports missing refund and dispute coverage', async () => {
    const client = { webhookEndpoints: { list: jest.fn().mockResolvedValue({
      data: [{ id: 'we_partial', url: 'https://nsa-portal.netlify.app/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: ['payment_intent.succeeded', 'payout.paid'] }],
      has_more: false,
    }) } };
    const result = await auditWebhookConfiguration(client);
    expect(result.healthy).toBe(false);
    expect(result.missing_events).toEqual(expect.arrayContaining(['charge.refunded', 'charge.dispute.created']));
  });

  test('adds missing events without removing existing webhook subscriptions', async () => {
    const partial = { id: 'we_partial', url: 'https://nsa-portal.netlify.app/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: ['customer.created', 'payment_intent.succeeded'] };
    const complete = { ...partial, enabled_events: ['*'] };
    const client = { webhookEndpoints: {
      list: jest.fn().mockResolvedValueOnce({ data: [partial], has_more: false }).mockResolvedValueOnce({ data: [complete], has_more: false }),
      update: jest.fn().mockResolvedValue({}),
    } };
    const result = await repairWebhookConfiguration(client);
    expect(client.webhookEndpoints.update).toHaveBeenCalledWith('we_partial', {
      enabled_events: expect.arrayContaining(['customer.created', 'payment_intent.succeeded', 'charge.refunded', 'charge.dispute.created', 'payout.reconciliation_completed']),
    });
    expect(result).toMatchObject({ healthy: true, updated_endpoints: ['we_partial'] });
  });
});

function fakeSb(order = null) {
  const state = { payouts: {}, transactions: {}, orderUpdates: [] };
  return {
    state,
    from(table) {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            limit: async () => ({ data: order ? [order] : [], error: null }),
            in: async () => ({ data: [], error: null }),
          };
          return chain;
        },
        async upsert(row) {
          if (table === 'stripe_payouts') state.payouts[row.stripe_payout_id] = { ...(state.payouts[row.stripe_payout_id] || {}), ...row };
          if (table === 'stripe_balance_transactions') state.transactions[row.stripe_balance_transaction_id] = row;
          return { error: null };
        },
        update(patch) {
          return {
            async eq(column, value) {
              if (table === 'stripe_payouts') state.payouts[value] = { ...(state.payouts[value] || {}), ...patch };
              if (table === 'webstore_orders') state.orderUpdates.push({ column, value, patch });
              return { error: null };
            },
            async in() { return { error: null }; },
          };
        },
      };
    },
  };
}

describe('Stripe balance transaction normalization', () => {
  test('stores integer cents and enforces Stripe amount - fee = net', () => {
    expect(balanceTransactionRow(bt('txn_ok'), { payoutId: 'po_1' })).toMatchObject({
      stripe_balance_transaction_id: 'txn_ok',
      stripe_payout_id: 'po_1',
      amount_cents: 1000,
      fee_cents: 59,
      net_cents: 941,
      reporting_category: 'charge',
    });
    expect(() => balanceTransactionRow(bt('txn_bad', { net: 940 }))).toThrow(/does not reconcile/i);
    expect(() => balanceTransactionRow(bt('txn_float', { amount: 10.5, net: -48.5 }))).toThrow(/integer cents/i);
  });

  test('paginates every balance transaction in an automatic payout', async () => {
    const client = { balanceTransactions: { list: jest.fn()
      .mockResolvedValueOnce({ data: [bt('txn_1')], has_more: true })
      .mockResolvedValueOnce({ data: [bt('txn_2')], has_more: false }) } };
    await expect(listPayoutBalanceTransactions(client, 'po_batch')).resolves.toHaveLength(2);
    expect(client.balanceTransactions.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ payout: 'po_batch', starting_after: 'txn_1', limit: 100 }));
  });
});

describe('Stripe payout persistence', () => {
  test('captures the actual Stripe fee/net on the linked webstore order', async () => {
    const sb = fakeSb({ id: 'order-1', total: 10 });
    const charge = {
      id: 'ch_1', payment_intent: 'pi_1',
      balance_transaction: bt('txn_charge', { source: 'ch_1' }),
    };
    const client = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded', latest_charge: charge }) } };
    await recordPaymentIntentFinancials({ client, sb, paymentIntent: { id: 'pi_1' } });
    expect(sb.state.transactions.txn_charge).toMatchObject({ payment_intent_id: 'pi_1', webstore_order_id: 'order-1' });
    expect(sb.state.orderUpdates[0].patch).toMatchObject({
      stripe_charge_id: 'ch_1', stripe_balance_transaction_id: 'txn_charge',
      stripe_fee_cents: 59, stripe_net_cents: 941, cc_fee: 0.59,
    });
    expect(sb.state.orderUpdates[0].patch).not.toHaveProperty('tax_state');
  });

  test('keeps the Stripe link when the portal order total differs from the amount actually charged', async () => {
    const sb = fakeSb({ id: 'order-edited', total: 12 });
    const charge = {
      id: 'ch_edited', payment_intent: 'pi_edited',
      balance_transaction: bt('txn_edited', { amount: 1000, fee: 59 }),
    };
    const client = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_edited', status: 'succeeded', latest_charge: charge }) } };
    await recordPaymentIntentFinancials({ client, sb, paymentIntent: { id: 'pi_edited' } });
    expect(sb.state.orderUpdates[0].patch).toMatchObject({
      stripe_balance_transaction_id: 'txn_edited', stripe_fee_cents: 59, stripe_net_cents: 941,
    });
  });

  test('distinguishes an incomplete checkout from a missing settled charge', async () => {
    const sb = fakeSb();
    const client = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_incomplete', status: 'requires_payment_method', latest_charge: null }) } };
    await expect(inspectPaymentIntentFinancials({ client, sb, paymentIntent: { id: 'pi_incomplete' } }))
      .resolves.toEqual({ row: null, payment_intent_status: 'requires_payment_method' });
  });

  test('marks a fully paginated automatic payout exact only when activity net equals the bank amount', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn().mockResolvedValue({
      data: [bt('txn_a', { amount: 700, fee: 20 }), bt('txn_b', { amount: 300, fee: 10 })], has_more: false,
    }) } };
    const payout = { id: 'po_exact', amount: 970, currency: 'usd', status: 'paid', automatic: true, method: 'standard', reconciliation_status: 'completed', type: 'bank_account', arrival_date: 1788624000, created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result).toMatchObject({
      balance_transaction_count: 2, activity_amount_cents: 1000, fee_cents: 30,
      net_cents: 970, reconciliation_difference_cents: 0, reconciliation_status: 'exact',
    });
    expect(sb.state.payouts.po_exact.reconciliation_status).toBe('exact');
  });

  test('excludes the negative bank transfer from payout activity and QBO rows', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn().mockResolvedValue({
      data: [
        bt('txn_charge', { amount: 1000, fee: 30, net: 970 }),
        bt('txn_payout', { amount: -970, fee: 0, net: -970, source: 'po_exact_transfer', reportingCategory: 'payout' }),
      ],
      has_more: false,
    }) } };
    const payout = { id: 'po_exact_transfer', amount: 970, currency: 'usd', status: 'paid', automatic: true, method: 'standard', reconciliation_status: 'completed', created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result).toMatchObject({ balance_transaction_count: 1, activity_amount_cents: 1000, fee_cents: 30, net_cents: 970, reconciliation_status: 'exact' });
    expect(sb.state.transactions).not.toHaveProperty('txn_payout');
  });

  test('preserves a mismatch instead of declaring a payout reconciled', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn().mockResolvedValue({ data: [bt('txn_only')], has_more: false }) } };
    const payout = { id: 'po_mismatch', amount: 950, currency: 'usd', status: 'paid', automatic: true, arrival_date: 1788624000, created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result.reconciliation_status).toBe('mismatch');
    expect(result.reconciliation_difference_cents).toBe(9);
  });

  test('marks Instant Payouts unavailable instead of inventing a batch mismatch', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn() } };
    const payout = { id: 'po_instant', amount: 2000000, currency: 'usd', status: 'paid', automatic: true, method: 'instant', reconciliation_status: 'not_applicable', created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result).toMatchObject({ reconciliation_status: 'unavailable', reconciliation_difference_cents: null });
    expect(client.balanceTransactions.list).not.toHaveBeenCalled();
    expect(sb.state.payouts.po_instant).toMatchObject({ reconciliation_status: 'unavailable', activity_amount_cents: null, net_cents: null });
  });
});

describe('Stripe-settled order summaries', () => {
  test('uses the actual Stripe charge amount and identifies portal-total differences', () => {
    const orders = [
      { id: 'order-1', so_id: 'SO-1', total: 12, stripe_balance_transaction_id: 'txn_1' },
      { id: 'order-2', so_id: 'SO-2', total: 20, stripe_balance_transaction_id: null },
    ];
    const chargeByOrder = new Map([
      ['order-1', { amount_cents: 1000 }],
      ['order-2', { amount_cents: 2000 }],
    ]);
    const activityByOrder = new Map([
      ['order-1', 900],
      ['order-2', 2000],
    ]);
    expect(summarizeSettledOrders(orders, chargeByOrder)).toMatchObject({
      order_count: 2, linked_count: 1, unlinked_count: 1,
      total_cents: 3000, portal_total_cents: 3200,
    });
    expect(chargeAmountMismatches(orders, chargeByOrder, activityByOrder)).toEqual([expect.objectContaining({
      order_id: 'order-1', portal_total_cents: 1200, stripe_charge_cents: 1000,
      stripe_activity_cents: 900, difference_cents: -300,
    })]);
  });

  test('treats a linked refund that brings Stripe activity to the current order total as reconciled', () => {
    const orders = [{ id: 'order-refunded', so_id: 'SO-R', total: 9, stripe_balance_transaction_id: 'txn_charge' }];
    const chargeByOrder = new Map([['order-refunded', { amount_cents: 1000 }]]);
    const activityByOrder = new Map([['order-refunded', 900]]);
    expect(chargeAmountMismatches(orders, chargeByOrder, activityByOrder)).toEqual([]);
  });
});
