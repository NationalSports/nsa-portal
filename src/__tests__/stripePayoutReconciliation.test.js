/** @jest-environment node */

const {
  balanceTransactionRow,
  listPayoutBalanceTransactions,
  recordPaymentIntentFinancials,
  recordPayoutReconciliation,
} = require('../../netlify/functions/_stripeReconciliation');

const bt = (id, { amount = 1000, fee = 59, net = amount - fee, source = null } = {}) => ({
  id,
  amount,
  fee,
  net,
  source,
  currency: 'usd',
  reporting_category: 'charge',
  type: 'charge',
  status: 'available',
  created: 1788451200,
  available_on: 1788624000,
  fee_details: [{ amount: fee, currency: 'usd', type: 'stripe_fee', description: 'Stripe processing fees' }],
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
    const client = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_1', latest_charge: charge }) } };
    await recordPaymentIntentFinancials({ client, sb, paymentIntent: { id: 'pi_1' } });
    expect(sb.state.transactions.txn_charge).toMatchObject({ payment_intent_id: 'pi_1', webstore_order_id: 'order-1' });
    expect(sb.state.orderUpdates[0].patch).toMatchObject({
      stripe_charge_id: 'ch_1', stripe_balance_transaction_id: 'txn_charge',
      stripe_fee_cents: 59, stripe_net_cents: 941, cc_fee: 0.59,
    });
    expect(sb.state.orderUpdates[0].patch).not.toHaveProperty('tax_state');
  });

  test('marks a fully paginated automatic payout exact only when activity net equals the bank amount', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn().mockResolvedValue({
      data: [bt('txn_a', { amount: 700, fee: 20 }), bt('txn_b', { amount: 300, fee: 10 })], has_more: false,
    }) } };
    const payout = { id: 'po_exact', amount: 970, currency: 'usd', status: 'paid', automatic: true, method: 'standard', type: 'bank_account', arrival_date: 1788624000, created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result).toMatchObject({
      balance_transaction_count: 2, activity_amount_cents: 1000, fee_cents: 30,
      net_cents: 970, reconciliation_difference_cents: 0, reconciliation_status: 'exact',
    });
    expect(sb.state.payouts.po_exact.reconciliation_status).toBe('exact');
  });

  test('preserves a mismatch instead of declaring a payout reconciled', async () => {
    const sb = fakeSb();
    const client = { balanceTransactions: { list: jest.fn().mockResolvedValue({ data: [bt('txn_only')], has_more: false }) } };
    const payout = { id: 'po_mismatch', amount: 950, currency: 'usd', status: 'paid', automatic: true, arrival_date: 1788624000, created: 1788451200 };
    const result = await recordPayoutReconciliation({ client, sb, payout });
    expect(result.reconciliation_status).toBe('mismatch');
    expect(result.reconciliation_difference_cents).toBe(9);
  });
});
