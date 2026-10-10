import { sha256 } from './logic.js';

const clean = value => String(value == null ? '' : value).trim();
const cents = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const moneyToCents = value => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const scaled = number * 100, rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 1e-7 ? rounded : null;
};
const idOf = ref => clean(typeof ref === 'object' ? ref?.value : ref);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const centsToMoney = value => Number((value / 100).toFixed(2));
const isoDate = value => {
  const raw = clean(value);
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  let year, month, day;
  if (raw.includes('/')) {
    month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
    if (year < 100) year += 2000;
  } else { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
};

function requireAccount(account, expectedId, expectedTypes, label) {
  if (!account || !clean(account.Id) || clean(account.Id) !== clean(expectedId)) {
    fail('stripe_payout_account_changed', `${label} account is missing or does not match the configured QBO account.`);
  }
  if (account.Active === false || !expectedTypes.includes(clean(account.AccountType))) {
    fail('stripe_payout_account_changed', `${label} account is inactive or has an unsupported account type.`);
  }
  return account;
}

function paymentLinks(payment) {
  const links = [];
  for (const line of (Array.isArray(payment.Line) ? payment.Line : [])) {
    for (const link of (Array.isArray(line.LinkedTxn) ? line.LinkedTxn : [])) {
      links.push({ id: clean(link.TxnId), type: clean(link.TxnType), amount: moneyToCents(line.Amount) });
    }
  }
  return links;
}

function verifySourcePayment(transaction, source) {
  const payment = source?.qboPayment;
  const amount = cents(transaction.amount_cents);
  if (!payment || !clean(payment.Id) || !clean(source.portal_payment_id)) {
    fail('stripe_payout_payment_missing', `No verified QBO payment is mapped to Stripe payment ${transaction.payment_intent_id || transaction.source_id || transaction.stripe_balance_transaction_id}.`);
  }
  if (!source.qboInvoiceId || !source.qboCustomerId) {
    fail('stripe_payout_payment_mapping_incomplete', `QBO invoice and customer proof are required for portal payment ${source.portal_payment_id}.`);
  }
  if (amount == null || amount <= 0 || moneyToCents(payment.TotalAmt) !== amount) {
    fail('stripe_payout_payment_amount_mismatch', `QBO payment ${payment.Id} does not equal the Stripe charge amount.`);
  }
  if (idOf(payment.DepositToAccountRef) !== clean(source.undepositedAccountId)) {
    fail('stripe_payout_payment_not_undeposited', `QBO payment ${payment.Id} is not held in the configured Undeposited Funds account.`);
  }
  if (idOf(payment.CustomerRef) !== clean(source.qboCustomerId)) {
    fail('stripe_payout_customer_mismatch', `QBO payment ${payment.Id} customer does not match the verified invoice customer.`);
  }
  // If QBO omits CurrencyRef, the caller must have verified the QBO realm's
  // home currency as USD; the Stripe-side source currency is still required.
  const currency = clean(payment.CurrencyRef?.value || source.currency).toUpperCase();
  if (currency !== 'USD' || (source.currency && clean(source.currency).toUpperCase() !== 'USD')) {
    fail('stripe_payout_payment_currency_mismatch', `QBO payment ${payment.Id} is not a verified USD payment.`);
  }
  const expectedDate = isoDate(source.date || source.payment_date);
  if (!expectedDate || isoDate(payment.TxnDate) !== expectedDate) {
    fail('stripe_payout_payment_date_mismatch', `QBO payment ${payment.Id} date does not match the source invoice payment.`);
  }
  const links = paymentLinks(payment);
  if (links.length !== 1 || links[0].type !== 'Invoice' || links[0].id !== clean(source.qboInvoiceId) || links[0].amount !== amount) {
    fail('stripe_payout_invoice_link_mismatch', `QBO payment ${payment.Id} is not fully applied to its one expected invoice.`);
  }
  if (payment.UnappliedAmt != null && moneyToCents(payment.UnappliedAmt) !== 0) {
    fail('stripe_payout_invoice_link_mismatch', `QBO payment ${payment.Id} has an unapplied balance.`);
  }
  if (!source.qboInvoice || clean(source.qboInvoice.Id) !== clean(source.qboInvoiceId)
      || idOf(source.qboInvoice.CustomerRef) !== clean(source.qboCustomerId)) {
    fail('stripe_payout_customer_mismatch', `QBO invoice ${source.qboInvoiceId} customer does not match the verified payment customer.`);
  }
  if (source.invoiceTotal != null
      && moneyToCents(source.qboInvoice.TotalAmt) !== moneyToCents(source.invoiceTotal)) {
    fail('stripe_payout_invoice_amount_mismatch', `QBO invoice ${source.qboInvoiceId} total does not match the source invoice.`);
  }
  if (source.invoiceTotal != null) {
    const invoiceTotal = moneyToCents(source.invoiceTotal);
    if (invoiceTotal == null || invoiceTotal < amount) {
      fail('stripe_payout_invoice_amount_mismatch', `QBO invoice ${source.qboInvoiceId} is smaller than its linked payment.`);
    }
  }
  return {
    amount, paymentId: String(payment.Id), portalPaymentId: String(source.portal_payment_id), invoiceId: String(source.qboInvoiceId),
    customerId: clean(source.qboCustomerId), date: expectedDate, currency,
    portalAmount: cents(Math.round(Number((source.portalPayment || source.portal_payment)?.amount) * 100)),
    portalRef: clean((source.portalPayment || source.portal_payment)?.ref),
    invoiceTotal: cents(Math.round(Number(source.qboInvoice.TotalAmt) * 100)),
  };
}

/**
 * Build one QBO Deposit for a fully reconciled Stripe automatic payout.
 * `accounts` must be live QBO Account entities: {bankAccount, feeAccount,
 * undepositedAccount}. `settings` supplies stripe_payout_bank_account_id and
 * stripe_payout_fee_account_id. `payments` is one row per portal invoice payment,
 * enriched with the live QBO Payment and verified invoice/customer identifiers.
 */
export async function planStripePayout({ payout, transactions, payments, accounts, settings }) {
  if (!payout || !/^po_[A-Za-z0-9_]+$/.test(clean(payout.stripe_payout_id))) {
    fail('stripe_payout_invalid', 'A valid Stripe payout ID is required.');
  }
  if (payout.status !== 'paid' || payout.automatic !== true || clean(payout.currency).toLowerCase() !== 'usd') {
    fail('stripe_payout_unsupported', 'Only paid automatic USD Stripe payouts can be deposited automatically.');
  }
  if (payout.reconciliation_status !== 'exact') {
    fail('stripe_payout_not_exact', 'Stripe payout must have an exact completed balance reconciliation.');
  }
  const payoutCents = cents(payout.amount_cents);
  const expectedCount = cents(payout.balance_transaction_count);
  if (payoutCents == null || payoutCents <= 0 || expectedCount == null || expectedCount <= 0 || !Array.isArray(transactions) || transactions.length !== expectedCount) {
    fail('stripe_payout_ledger_incomplete', 'The payout amount and complete balance transaction count are required.');
  }
  const bankId = clean(settings?.stripe_payout_bank_account_id);
  const feeId = clean(settings?.stripe_payout_fee_account_id);
  const undepositedId = clean(accounts?.undepositedAccount?.Id);
  const bank = requireAccount(accounts?.bankAccount, bankId, ['Bank'], 'Stripe payout bank');
  const fee = requireAccount(accounts?.feeAccount, feeId, ['Expense'], 'Stripe processing fee');
  const undeposited = requireAccount(accounts?.undepositedAccount, undepositedId, ['Other Current Asset'], 'Undeposited Funds');
  if (!bankId || !feeId || !undepositedId || new Set([bankId, feeId, undepositedId]).size !== 3) {
    fail('stripe_payout_account_conflict', 'Stripe bank, fee, and Undeposited Funds accounts must be configured and distinct.');
  }
  if (undeposited.AccountSubType && clean(undeposited.AccountSubType) !== 'UndepositedFunds') {
    fail('stripe_payout_account_changed', 'The configured clearing account is not the Undeposited Funds account.');
  }
  const date = isoDate(payout.arrival_date);
  if (!date || date !== clean(payout.arrival_date)) {
    fail('stripe_payout_date_invalid', 'The Stripe payout arrival date is missing or invalid.');
  }

  const txIds = new Set();
  const intents = new Set();
  const paymentByIntent = new Map();
  for (const source of (payments || [])) {
    const piId = clean(source?.payment_intent_id);
    if (!piId) continue;
    if (paymentByIntent.has(piId)) fail('stripe_payout_payment_ambiguous', `More than one portal payment maps to ${piId}.`);
    paymentByIntent.set(piId, source);
  }

  let activityCents = 0;
  let feeCents = 0;
  const paymentLines = [];
  const paymentIds = [];
  const sourceRows = [];
  for (const transaction of [...transactions].sort((a, b) => clean(a?.stripe_balance_transaction_id).localeCompare(clean(b?.stripe_balance_transaction_id)))) {
    const transactionId = clean(transaction?.stripe_balance_transaction_id);
    const piId = clean(transaction?.payment_intent_id);
    const sourceId = clean(transaction?.source_id);
    if (!transactionId || txIds.has(transactionId)) fail('stripe_payout_duplicate_transaction', 'The payout contains a missing or duplicate balance transaction ID.');
    txIds.add(transactionId);
    if (!piId || !/^pi_[A-Za-z0-9]+$/.test(piId) || intents.has(piId)) {
      fail('stripe_payout_payment_intent_ambiguous', 'Every payout transaction must map to one unique PaymentIntent.');
    }
    intents.add(piId);
    if (transaction.source_type !== 'charge' || transaction.reporting_category !== 'charge' || transaction.transaction_type !== 'charge' || transaction.status !== 'available') {
      fail('stripe_payout_unsupported_activity', `Balance transaction ${transactionId} is not an available customer charge; refund, dispute, adjustment, and unmatched activity require review.`);
    }
    if (!/^ch_[A-Za-z0-9_]+$/.test(sourceId) || clean(transaction.currency).toLowerCase() !== 'usd') {
      fail('stripe_payout_unsupported_activity', `Balance transaction ${transactionId} has an unsupported source or currency.`);
    }
    if (clean(transaction.stripe_payout_id) !== clean(payout.stripe_payout_id)) {
      fail('stripe_payout_link_mismatch', `Balance transaction ${transactionId} is linked to a different payout.`);
    }
    const amount = cents(transaction.amount_cents), feeAmount = cents(transaction.fee_cents), net = cents(transaction.net_cents);
    if (amount == null || feeAmount == null || net == null || amount <= 0 || feeAmount < 0 || net !== amount - feeAmount) {
      fail('stripe_payout_money_invalid', `Balance transaction ${transactionId} has invalid integer-cent amounts.`);
    }
    const source = paymentByIntent.get(piId);
    if (!source || clean(source.payment_intent_id) !== piId) {
      fail('stripe_payout_payment_missing', `No unique portal/QBO payment maps to Stripe PaymentIntent ${piId}.`);
    }
    const verified = verifySourcePayment(transaction, { ...source, undepositedAccountId: undeposited.Id });
    if (paymentIds.includes(verified.paymentId)) {
      fail('stripe_payout_duplicate_payment', `QBO payment ${verified.paymentId} maps to more than one Stripe transaction.`);
    }
    if (source.stripe_charge_id && sourceId !== clean(source.stripe_charge_id)) {
      fail('stripe_payout_charge_mismatch', `Portal payment ${source.portal_payment_id} does not prove the Stripe charge source.`);
    }
    const portalPayment = source.portalPayment || source.portal_payment;
    if (!portalPayment || String(portalPayment.id || '') !== verified.portalPaymentId
        || clean(portalPayment.ref) !== `Stripe ${piId}`
        || moneyToCents(portalPayment.amount) !== amount) {
      fail('stripe_payout_portal_payment_mismatch', `Portal payment ${verified.portalPaymentId} does not prove the Stripe PaymentIntent amount and reference.`);
    }
    activityCents += amount;
    feeCents += feeAmount;
    paymentIds.push(verified.paymentId);
    paymentLines.push({
      Amount: centsToMoney(amount),
      LinkedTxn: [{ TxnId: verified.paymentId, TxnType: 'Payment', TxnLineId: '0' }],
    });
    sourceRows.push({ transaction_id: transactionId, source_id: sourceId, payment_intent_id: piId,
      portal_payment_id: verified.portalPaymentId, qbo_payment_id: verified.paymentId,
      qbo_invoice_id: verified.invoiceId, qbo_customer_id: verified.customerId,
      payment_date: verified.date, currency: verified.currency, portal_amount_cents: verified.portalAmount,
      portal_ref: verified.portalRef, invoice_total_cents: verified.invoiceTotal,
      amount_cents: amount, fee_cents: feeAmount, net_cents: net });
  }
  if (paymentByIntent.size !== intents.size) {
    fail('stripe_payout_extra_payment_mapping', 'The payout and supplied portal payment mappings do not contain the same PaymentIntents.');
  }
  const netCents = activityCents - feeCents;
  if (cents(payout.activity_amount_cents) !== activityCents
      || cents(payout.fee_cents) !== feeCents
      || cents(payout.net_cents) !== netCents
      || cents(payout.reconciliation_difference_cents) !== 0
      || netCents !== payoutCents) {
    fail('stripe_payout_totals_mismatch', 'Charge amounts and Stripe fees do not exactly reconcile to the bank payout.');
  }
  if (transactions.reduce((sum, row) => sum + Number(row.net_cents), 0) !== payoutCents) {
    fail('stripe_payout_net_mismatch', 'Balance transaction net does not equal the payout amount.');
  }

  const marker = `Stripe payout ${clean(payout.stripe_payout_id)}`;
  const payload = {
    TxnDate: date,
    DepositToAccountRef: { value: String(bank.Id), name: clean(bank.Name) },
    PrivateNote: marker,
    Line: [
      ...paymentLines,
      ...(feeCents ? [{
        Amount: centsToMoney(-feeCents),
        DetailType: 'DepositLineDetail',
        Description: `Stripe processing fees ${clean(payout.stripe_payout_id)}`,
        DepositLineDetail: { AccountRef: { value: String(fee.Id), name: clean(fee.Name) } },
      }] : []),
    ],
  };
  const sourceHash = await sha256({
    payout: { id: payout.stripe_payout_id, amount_cents: payoutCents, fee_cents: feeCents,
      net_cents: netCents, arrival_date: date, balance_transaction_count: expectedCount },
    transactions: sourceRows.sort((a, b) => a.transaction_id.localeCompare(b.transaction_id)),
    accounts: { bank: String(bank.Id), fee: String(fee.Id), undeposited: String(undeposited.Id) },
  });
  return { payload, paymentIds: [...paymentIds].sort(), sourceHash, paymentCount: paymentIds.length,
    amountCents: payoutCents, feeCents, marker };
}

/** Verify the QBO read-back against the exact proposed payout deposit. */
export function verifyStripeDeposit(expected, actual) {
  const failReadback = reason => fail('stripe_payout_deposit_readback_mismatch', `QBO Stripe payout deposit failed read-back: ${reason}.`);
  if (!expected?.payload || !actual?.Id) return failReadback('missing deposit identity');
  const want = expected.payload;
  if (clean(actual.TxnDate).slice(0, 10) !== clean(want.TxnDate)) return failReadback('date differs');
  if (idOf(actual.DepositToAccountRef) !== idOf(want.DepositToAccountRef)) return failReadback('bank account differs');
  if (clean(actual.PrivateNote) !== clean(want.PrivateNote) || clean(actual.PrivateNote) !== clean(expected.marker)) return failReadback('payout marker differs');
  const actualLines = Array.isArray(actual.Line) ? actual.Line : [];
  const expectedPaymentLines = want.Line.filter(line => Array.isArray(line.LinkedTxn));
  const actualPaymentLines = actualLines.filter(line => Array.isArray(line.LinkedTxn) && line.LinkedTxn.length);
  const byPayment = lines => lines.map(line => {
    if (line.LinkedTxn.length !== 1 || clean(line.LinkedTxn[0].TxnType) !== 'Payment') return null;
    return { id: clean(line.LinkedTxn[0].TxnId), amount: moneyToCents(line.Amount) };
  }).sort((a, b) => clean(a?.id).localeCompare(clean(b?.id)));
  const wantedPayments = byPayment(expectedPaymentLines), gotPayments = byPayment(actualPaymentLines);
  if (wantedPayments.some(x => !x) || gotPayments.some(x => !x) || JSON.stringify(gotPayments) !== JSON.stringify(wantedPayments)) {
    return failReadback('linked payment IDs or amounts differ');
  }
  const expectedFeeLines = want.Line.filter(line => line.DetailType === 'DepositLineDetail');
  // QBO may hydrate a payment-linked line with DepositLineDetail metadata.
  // Treat it as a linked Payment first, never as a second fee/account line.
  const actualFeeLines = actualLines.filter(line => line.DetailType === 'DepositLineDetail'
    && !(Array.isArray(line.LinkedTxn) && line.LinkedTxn.length));
  const normalizeFees = lines => lines.map(line => ({
    account: idOf(line.DepositLineDetail?.AccountRef),
    amount: moneyToCents(line.Amount),
  })).sort((a, b) => a.account.localeCompare(b.account) || a.amount - b.amount);
  if (JSON.stringify(normalizeFees(actualFeeLines)) !== JSON.stringify(normalizeFees(expectedFeeLines))) return failReadback('processing fee account or amount differs');
  if (actualLines.length !== expectedPaymentLines.length + expectedFeeLines.length) return failReadback('unexpected or missing deposit lines');
  if (moneyToCents(actual.TotalAmt) !== Number(expected.amountCents)) return failReadback('net deposit total differs');
  return { ok: true, qbo_deposit_id: String(actual.Id), payment_ids: gotPayments.map(row => row.id) };
}
