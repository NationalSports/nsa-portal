// Stripe settlement ledger helpers.  Balance transactions are Stripe's
// accounting source of truth: amount - fee = net.  Webhook handlers call these
// helpers idempotently, and payout.reconciliation_completed attaches every
// transaction in an automatic payout to its durable payout row.

const unixIso = (seconds) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Stripe timestamp is missing or invalid');
  return new Date(value * 1000).toISOString();
};

const stripeId = (value) => {
  if (!value) return null;
  return typeof value === 'string' ? value : (value.id || null);
};

const sourceTypeForId = (id) => {
  const value = String(id || '');
  if (value.startsWith('ch_')) return 'charge';
  if (value.startsWith('re_')) return 'refund';
  if (value.startsWith('dp_')) return 'dispute';
  if (value.startsWith('tr_')) return 'transfer';
  if (value.startsWith('po_')) return 'payout';
  return value ? 'other' : null;
};

const paymentIntentFromSource = (source) => {
  if (!source || typeof source === 'string') return null;
  return stripeId(source.payment_intent) ||
    stripeId(source.charge && source.charge.payment_intent) || null;
};

const cleanFeeDetails = (details) => (Array.isArray(details) ? details : []).map((detail) => ({
  amount: Number(detail.amount) || 0,
  currency: String(detail.currency || '').toLowerCase(),
  type: detail.type || null,
  application: stripeId(detail.application),
  description: detail.description || null,
}));

async function retrieveSource(client, sourceId) {
  if (!client || !sourceId) return null;
  if (sourceId.startsWith('ch_')) return client.charges.retrieve(sourceId);
  if (sourceId.startsWith('re_')) return client.refunds.retrieve(sourceId);
  if (sourceId.startsWith('dp_')) return client.disputes.retrieve(sourceId);
  return null;
}

async function findWebstoreOrder(sb, paymentIntentId) {
  if (!sb || !paymentIntentId) return null;
  const { data, error } = await sb.from('webstore_orders')
    .select('id,total').eq('stripe_pi_id', paymentIntentId).limit(1);
  if (error) throw new Error('Could not link Stripe transaction to webstore order: ' + error.message);
  return data && data[0] ? data[0] : null;
}

function balanceTransactionRow(bt, {
  payoutId = null,
  source = null,
  paymentIntentId = null,
  webstoreOrderId = null,
} = {}) {
  if (!bt || !bt.id) throw new Error('Stripe balance transaction is missing its ID');
  const amount = Number(bt.amount);
  const fee = Number(bt.fee);
  const net = Number(bt.net);
  if (![amount, fee, net].every(Number.isInteger)) {
    throw new Error('Stripe balance transaction money must be integer cents');
  }
  if (net !== amount - fee) {
    throw new Error('Stripe balance transaction does not reconcile: amount - fee != net');
  }
  const sourceId = stripeId(source) || stripeId(bt.source);
  return {
    stripe_balance_transaction_id: bt.id,
    stripe_payout_id: payoutId || null,
    source_id: sourceId,
    source_type: sourceTypeForId(sourceId),
    payment_intent_id: paymentIntentId || paymentIntentFromSource(source) || null,
    webstore_order_id: webstoreOrderId || null,
    reporting_category: String(bt.reporting_category || bt.type || 'unknown'),
    transaction_type: String(bt.type || 'unknown'),
    status: String(bt.status || 'unknown'),
    currency: String(bt.currency || '').toLowerCase(),
    amount_cents: amount,
    fee_cents: fee,
    net_cents: net,
    fee_details: cleanFeeDetails(bt.fee_details),
    stripe_created_at: unixIso(bt.created),
    available_on: unixIso(bt.available_on || bt.created),
    updated_at: new Date().toISOString(),
  };
}

async function upsertBalanceTransaction({ client, sb, balanceTransaction, payoutId = null, source = null }) {
  let bt = balanceTransaction;
  if (typeof bt === 'string') bt = await client.balanceTransactions.retrieve(bt);
  if (!bt || !bt.id) throw new Error('Stripe balance transaction could not be retrieved');

  const sourceId = stripeId(source) || stripeId(bt.source);
  let sourceObject = source && typeof source === 'object' ? source : null;
  if (!sourceObject && sourceId) {
    try { sourceObject = await retrieveSource(client, sourceId); }
    catch (error) {
      // The money row remains valid even when an uncommon source type cannot be
      // expanded.  It stays unlinked and therefore review_required for QBO.
      console.warn('[stripe-reconciliation] could not expand source', sourceId, error.message);
    }
  }
  const paymentIntentId = paymentIntentFromSource(sourceObject);
  const order = await findWebstoreOrder(sb, paymentIntentId);
  const row = balanceTransactionRow(bt, {
    payoutId,
    source: sourceObject || sourceId,
    paymentIntentId,
    webstoreOrderId: order && order.id,
  });
  // Do not erase a payout/order link if Stripe retries an older webhook after
  // a later reconciliation already populated it. Missing insert fields use
  // their nullable defaults; missing update fields preserve their values.
  const persistedRow = { ...row };
  for (const key of ['stripe_payout_id', 'source_id', 'source_type', 'payment_intent_id', 'webstore_order_id']) {
    if (persistedRow[key] == null) delete persistedRow[key];
  }
  const { error } = await sb.from('stripe_balance_transactions')
    .upsert(persistedRow, { onConflict: 'stripe_balance_transaction_id' });
  if (error) throw new Error('Could not persist Stripe balance transaction: ' + error.message);

  // Denormalize the original charge fee onto the order for existing webstore
  // accounting reports.  Refund/dispute fee adjustments remain separate ledger
  // rows and must not overwrite the original charge fee.
  if (order && row.reporting_category === 'charge' && row.amount_cents === Math.round(Number(order.total || 0) * 100)) {
    const patch = {
      stripe_charge_id: sourceTypeForId(sourceId) === 'charge' ? sourceId : null,
      stripe_balance_transaction_id: row.stripe_balance_transaction_id,
      stripe_fee_cents: row.fee_cents,
      stripe_net_cents: row.net_cents,
      cc_fee: row.fee_cents / 100,
    };
    const { error: orderError } = await sb.from('webstore_orders').update(patch).eq('id', order.id);
    if (orderError) throw new Error('Could not persist actual Stripe fee on webstore order: ' + orderError.message);
  }
  return row;
}

async function recordPaymentIntentFinancials({ client, sb, paymentIntent }) {
  if (!paymentIntent || !paymentIntent.id) return null;
  const pi = await client.paymentIntents.retrieve(paymentIntent.id, {
    expand: ['latest_charge.balance_transaction'],
  });
  if (!pi.latest_charge) return null;
  const charge = typeof pi.latest_charge === 'string'
    ? await client.charges.retrieve(pi.latest_charge, { expand: ['balance_transaction'] })
    : pi.latest_charge;
  if (!charge.balance_transaction) return null;
  return upsertBalanceTransaction({
    client,
    sb,
    balanceTransaction: charge.balance_transaction,
    source: charge,
  });
}

async function recordRefundFinancials({ client, sb, refund }) {
  if (!refund || !refund.id) return null;
  const full = refund.balance_transaction
    ? refund
    : await client.refunds.retrieve(refund.id, { expand: ['balance_transaction'] });
  if (!full.balance_transaction) return null;
  return upsertBalanceTransaction({ client, sb, balanceTransaction: full.balance_transaction, source: full });
}

async function recordDisputeFinancials({ client, sb, dispute }) {
  if (!dispute || !dispute.id) return [];
  const full = Array.isArray(dispute.balance_transactions)
    ? dispute
    : await client.disputes.retrieve(dispute.id);
  const rows = [];
  for (const bt of (full.balance_transactions || [])) {
    rows.push(await upsertBalanceTransaction({ client, sb, balanceTransaction: bt, source: full }));
  }
  return rows;
}

function payoutRow(payout) {
  if (!payout || !payout.id) throw new Error('Stripe payout is missing its ID');
  if (!Number.isInteger(Number(payout.amount))) throw new Error('Stripe payout amount must be integer cents');
  return {
    stripe_payout_id: payout.id,
    amount_cents: Number(payout.amount),
    currency: String(payout.currency || '').toLowerCase(),
    status: String(payout.status || 'unknown'),
    automatic: !!payout.automatic,
    method: payout.method || null,
    destination_type: payout.type || null,
    arrival_date: payout.arrival_date ? unixIso(payout.arrival_date).slice(0, 10) : null,
    stripe_created_at: payout.created ? unixIso(payout.created) : null,
    failure_code: payout.failure_code || null,
    failure_message: payout.failure_message || null,
    updated_at: new Date().toISOString(),
  };
}

async function recordPayoutStatus({ sb, payout }) {
  const row = payoutRow(payout);
  const { error } = await sb.from('stripe_payouts').upsert(row, { onConflict: 'stripe_payout_id' });
  if (error) throw new Error('Could not persist Stripe payout: ' + error.message);
  return row;
}

async function listPayoutBalanceTransactions(client, payoutId, { maxPages = 1000 } = {}) {
  const rows = [];
  let startingAfter;
  for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
    const page = await client.balanceTransactions.list({
      payout: payoutId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data = Array.isArray(page && page.data) ? page.data : [];
    rows.push(...data);
    if (!page || !page.has_more) return rows;
    if (!data.length) throw new Error('Stripe payout pagination returned has_more without rows');
    startingAfter = data[data.length - 1].id;
  }
  throw new Error('Stripe payout exceeded the reconciliation pagination safety limit');
}

async function loadExistingBalanceTransactions(sb, ids) {
  const byId = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const { data, error } = await sb.from('stripe_balance_transactions')
      .select('stripe_balance_transaction_id,source_id,payment_intent_id,webstore_order_id')
      .in('stripe_balance_transaction_id', chunk);
    if (error) throw new Error('Could not read existing Stripe settlement links: ' + error.message);
    for (const row of (data || [])) byId.set(row.stripe_balance_transaction_id, row);
  }
  return byId;
}

async function recordPayoutReconciliation({ client, sb, payout }) {
  await recordPayoutStatus({ sb, payout });
  if (!payout.automatic) {
    const patch = { reconciliation_status: 'unavailable', reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error } = await sb.from('stripe_payouts').update(patch).eq('stripe_payout_id', payout.id);
    if (error) throw new Error('Could not mark manual Stripe payout unreconciled: ' + error.message);
    return { ...patch, stripe_payout_id: payout.id };
  }

  const transactions = await listPayoutBalanceTransactions(client, payout.id);
  const existingById = await loadExistingBalanceTransactions(sb, transactions.map((transaction) => transaction.id));
  const rows = [];
  const knownRows = [];
  for (const transaction of transactions) {
    const existing = existingById.get(transaction.id);
    if (existing) {
      const row = balanceTransactionRow(transaction, {
        payoutId: payout.id,
        source: existing.source_id,
        paymentIntentId: existing.payment_intent_id,
        webstoreOrderId: existing.webstore_order_id,
      });
      knownRows.push(row);
      rows.push(row);
    } else {
      rows.push(await upsertBalanceTransaction({
        client,
        sb,
        balanceTransaction: transaction,
        payoutId: payout.id,
      }));
    }
  }
  // The common path (charge/refund webhooks already ingested the financials)
  // updates the whole payout link in one database request instead of making one
  // serverless round trip per customer charge.
  if (knownRows.length) {
    const { error } = await sb.from('stripe_balance_transactions')
      .upsert(knownRows, { onConflict: 'stripe_balance_transaction_id' });
    if (error) throw new Error('Could not attach Stripe balance transactions to payout: ' + error.message);
  }
  const total = (field) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  const net = total('net_cents');
  const webstoreNet = rows.filter((row) => row.webstore_order_id).reduce((sum, row) => sum + row.net_cents, 0);
  const difference = Number(payout.amount) - net;
  const patch = {
    balance_transaction_count: rows.length,
    activity_amount_cents: total('amount_cents'),
    fee_cents: total('fee_cents'),
    net_cents: net,
    webstore_net_cents: webstoreNet,
    unlinked_net_cents: net - webstoreNet,
    reconciliation_difference_cents: difference,
    reconciliation_status: difference === 0 ? 'exact' : 'mismatch',
    reconciled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('stripe_payouts').update(patch).eq('stripe_payout_id', payout.id);
  if (error) throw new Error('Could not finalize Stripe payout reconciliation: ' + error.message);
  return { ...patch, stripe_payout_id: payout.id };
}

module.exports = {
  balanceTransactionRow,
  loadExistingBalanceTransactions,
  listPayoutBalanceTransactions,
  payoutRow,
  recordDisputeFinancials,
  recordPaymentIntentFinancials,
  recordPayoutReconciliation,
  recordPayoutStatus,
  recordRefundFinancials,
  sourceTypeForId,
  stripeId,
  unixIso,
  upsertBalanceTransaction,
};
