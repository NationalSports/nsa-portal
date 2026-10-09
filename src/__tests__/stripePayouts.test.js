import { planStripePayout, verifyStripeDeposit } from '../../supabase/functions/qbo-sales-background/stripePayouts';

if (!global.crypto?.subtle) global.crypto = require('crypto').webcrypto;
if (!global.TextEncoder) global.TextEncoder = require('util').TextEncoder;

const accounts = {
  bankAccount: { Id: 'bank-10100', Name: 'Operating Bank', Active: true, AccountType: 'Bank' },
  feeAccount: { Id: 'fee-71400', Name: 'Bank Charges', Active: true, AccountType: 'Expense' },
  undepositedAccount: { Id: 'undeposited-11010', Name: 'Undeposited Funds', Active: true, AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds' },
};
const settings = { stripe_payout_bank_account_id: 'bank-10100', stripe_payout_fee_account_id: 'fee-71400' };
const payout = {
  stripe_payout_id: 'po_123', status: 'paid', automatic: true, currency: 'usd', reconciliation_status: 'exact',
  amount_cents: 16840, activity_amount_cents: 17425, fee_cents: 585, net_cents: 16840, reconciliation_difference_cents: 0, balance_transaction_count: 2, arrival_date: '2026-10-08',
};
const transactions = [
  { stripe_balance_transaction_id: 'txn_A', stripe_payout_id: 'po_123', source_id: 'ch_A', source_type: 'charge', payment_intent_id: 'pi_A', reporting_category: 'charge', transaction_type: 'charge', status: 'available', currency: 'usd', amount_cents: 12425, fee_cents: 450, net_cents: 11975 },
  { stripe_balance_transaction_id: 'txn_B', stripe_payout_id: 'po_123', source_id: 'ch_B', source_type: 'charge', payment_intent_id: 'pi_B', reporting_category: 'charge', transaction_type: 'charge', status: 'available', currency: 'usd', amount_cents: 5000, fee_cents: 135, net_cents: 4865 },
];
const payments = [
  { payment_intent_id: 'pi_A', portal_payment_id: 'pay_A', stripe_charge_id: 'ch_A', date: '10/08/2026', currency: 'USD', qboCustomerId: 'customer-A', qboInvoiceId: 'invoice-A', invoiceTotal: 200,
    portalPayment: { id: 'pay_A', ref: 'Stripe pi_A', amount: 124.25 }, qboInvoice: { Id: 'invoice-A', TotalAmt: 200, CustomerRef: { value: 'customer-A' } },
    qboPayment: { Id: 'qbo-payment-A', TotalAmt: 124.25, TxnDate: '2026-10-08', CurrencyRef: { value: 'USD' }, DepositToAccountRef: { value: 'undeposited-11010' }, CustomerRef: { value: 'customer-A' }, Line: [{ Amount: 124.25, LinkedTxn: [{ TxnId: 'invoice-A', TxnType: 'Invoice' }] }] } },
  { payment_intent_id: 'pi_B', portal_payment_id: 'pay_B', stripe_charge_id: 'ch_B', date: '10/08/2026', currency: 'USD', qboCustomerId: 'customer-B', qboInvoiceId: 'invoice-B', invoiceTotal: 50,
    portalPayment: { id: 'pay_B', ref: 'Stripe pi_B', amount: 50 }, qboInvoice: { Id: 'invoice-B', TotalAmt: 50, CustomerRef: { value: 'customer-B' } },
    qboPayment: { Id: 'qbo-payment-B', TotalAmt: 50, TxnDate: '2026-10-08', CurrencyRef: { value: 'USD' }, DepositToAccountRef: { value: 'undeposited-11010' }, CustomerRef: { value: 'customer-B' }, Line: [{ Amount: 50, LinkedTxn: [{ TxnId: 'invoice-B', TxnType: 'Invoice' }] }] } },
];

const plan = (overrides = {}) => planStripePayout({ payout, transactions, payments, accounts, settings, ...overrides });

describe('Stripe payout deposit planner', () => {
  test('builds the exact net deposit from two linked payments and actual Stripe fees', async () => {
    const result = await plan();
    expect(result.paymentIds).toEqual(['qbo-payment-A', 'qbo-payment-B']);
    expect(result.amountCents).toBe(16840);
    expect(result.feeCents).toBe(585);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.marker).toBe('Stripe payout po_123');
    expect(result.payload).toEqual({
      TxnDate: '2026-10-08', DepositToAccountRef: { value: 'bank-10100', name: 'Operating Bank' }, PrivateNote: 'Stripe payout po_123',
      Line: [
        { Amount: 124.25, LinkedTxn: [{ TxnId: 'qbo-payment-A', TxnType: 'Payment', TxnLineId: '0' }] },
        { Amount: 50, LinkedTxn: [{ TxnId: 'qbo-payment-B', TxnType: 'Payment', TxnLineId: '0' }] },
        { Amount: -5.85, DetailType: 'DepositLineDetail', Description: 'Stripe processing fees po_123', DepositLineDetail: { AccountRef: { value: 'fee-71400', name: 'Bank Charges' } } },
      ],
    });
    expect(verifyStripeDeposit(result, { ...result.payload, Id: 'deposit-9', TotalAmt: 168.4 })).toEqual({ ok: true, qbo_deposit_id: 'deposit-9', payment_ids: ['qbo-payment-A', 'qbo-payment-B'] });
  });

  test('is deterministic when input order changes', async () => {
    const first = await plan();
    const second = await plan({ transactions: [...transactions].reverse(), payments: [...payments].reverse() });
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.paymentIds).toEqual(first.paymentIds);
    expect(second.payload.Line).toEqual(first.payload.Line);
  });

  test.each([
    ['incomplete transaction count', { transactions: [transactions[0]] }, 'stripe_payout_ledger_incomplete'],
    ['duplicate transaction ID', { transactions: [transactions[0], { ...transactions[1], stripe_balance_transaction_id: 'txn_A' }] }, 'stripe_payout_duplicate_transaction'],
    ['missing PI mapping', { payments: [payments[0]] }, 'stripe_payout_payment_missing'],
    ['wrong PI mapping', { payments: [{ ...payments[0], payment_intent_id: 'pi_wrong' }, payments[1]] }, 'stripe_payout_payment_missing'],
    ['duplicate PI mappings', { payments: [payments[0], { ...payments[1], payment_intent_id: 'pi_A' }] }, 'stripe_payout_payment_ambiguous'],
    ['payment already deposited elsewhere', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, DepositToAccountRef: { value: 'bank-10100' } } }, payments[1]] }, 'stripe_payout_payment_not_undeposited'],
    ['payment amount differs by a fraction of a cent', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, TotalAmt: 124.251 } }, payments[1]] }, 'stripe_payout_payment_amount_mismatch'],
    ['wrong invoice application', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, Line: [{ Amount: 124.25, LinkedTxn: [{ TxnId: 'wrong-invoice', TxnType: 'Invoice' }] }] } }, payments[1]] }, 'stripe_payout_invoice_link_mismatch'],
    ['ambiguous multi-invoice application', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, Line: [{ Amount: 100, LinkedTxn: [{ TxnId: 'invoice-A', TxnType: 'Invoice' }] }, { Amount: 24.25, LinkedTxn: [{ TxnId: 'invoice-other', TxnType: 'Invoice' }] }] } }, payments[1]] }, 'stripe_payout_invoice_link_mismatch'],
    ['wrong customer', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, CustomerRef: { value: 'wrong-customer' } } }, payments[1]] }, 'stripe_payout_customer_mismatch'],
    ['invoice customer does not prove payment customer', { payments: [{ ...payments[0], qboInvoice: { ...payments[0].qboInvoice, CustomerRef: { value: 'other-customer' } } }, payments[1]] }, 'stripe_payout_customer_mismatch'],
    ['QBO invoice does not match source invoice total', { payments: [{ ...payments[0], qboInvoice: { ...payments[0].qboInvoice, TotalAmt: 199.99 } }, payments[1]] }, 'stripe_payout_invoice_amount_mismatch'],
    ['wrong payment date', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, TxnDate: '2026-10-07' } }, payments[1]] }, 'stripe_payout_payment_date_mismatch'],
    ['wrong payment currency', { payments: [{ ...payments[0], qboPayment: { ...payments[0].qboPayment, CurrencyRef: { value: 'CAD' } } }, payments[1]] }, 'stripe_payout_payment_currency_mismatch'],
    ['unsupported fee account type', { accounts: { ...accounts, feeAccount: { ...accounts.feeAccount, AccountType: 'Other Current Asset' } } }, 'stripe_payout_account_changed'],
    ['mismatched fee total', { payout: { ...payout, fee_cents: 584 } }, 'stripe_payout_totals_mismatch'],
    ['mismatched gross activity total', { payout: { ...payout, activity_amount_cents: 17424 } }, 'stripe_payout_totals_mismatch'],
    ['nonzero reconciliation difference', { payout: { ...payout, reconciliation_difference_cents: 1 } }, 'stripe_payout_totals_mismatch'],
    ['refund activity', { transactions: [{ ...transactions[0], reporting_category: 'refund', transaction_type: 'refund' }, transactions[1]] }, 'stripe_payout_unsupported_activity'],
    ['instant payout', { payout: { ...payout, automatic: false } }, 'stripe_payout_unsupported'],
    ['non-USD payout', { payout: { ...payout, currency: 'eur' } }, 'stripe_payout_unsupported'],
    ['invalid calendar date', { payout: { ...payout, arrival_date: '2026-02-30' } }, 'stripe_payout_date_invalid'],
    ['wrong undeposited subtype', { accounts: { ...accounts, undepositedAccount: { ...accounts.undepositedAccount, AccountSubType: 'OtherCurrentAssets' } } }, 'stripe_payout_account_changed'],
    ['portal amount/ref does not prove the charge', { payments: [{ ...payments[0], portalPayment: { ...payments[0].portalPayment, ref: 'Stripe pi_wrong' } }, payments[1]] }, 'stripe_payout_portal_payment_mismatch'],
    ['portal amount does not prove the charge', { payments: [{ ...payments[0], portalPayment: { ...payments[0].portalPayment, amount: 124.24 } }, payments[1]] }, 'stripe_payout_portal_payment_mismatch'],
  ])('holds %s', async (_name, overrides, code) => {
    await expect(plan(overrides)).rejects.toMatchObject({ code });
  });

  test('rejects read-back with changed marker, missing payment, different fee, or wrong total', async () => {
    const result = await plan();
    const actual = { ...result.payload, Id: 'deposit-9', TotalAmt: 168.4 };
    const expectReadbackError = value => expect(() => verifyStripeDeposit(result, value)).toThrow(expect.objectContaining({ code: 'stripe_payout_deposit_readback_mismatch' }));
    expectReadbackError({ ...actual, PrivateNote: 'Stripe payout po_old' });
    expectReadbackError({ ...actual, TotalAmt: 168.39 });
    expectReadbackError({ ...actual, Line: actual.Line.slice(1) });
    expectReadbackError({ ...actual, Line: [...actual.Line.slice(0, 2), { ...actual.Line[2], Amount: -5.84 }] });
    expectReadbackError({ ...actual, Line: [...actual.Line, { Amount: 1, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }] });
  });

  test('does not count QBO-enriched payment lines as separate fee lines', async () => {
    const result = await plan();
    const actual = { ...result.payload, Id: 'deposit-9', TotalAmt: 168.4, Line: result.payload.Line.map((line, index) => index < 2
      ? { ...line, DetailType: 'DepositLineDetail', DepositLineDetail: { AccountRef: { value: 'undeposited-11010' } } }
      : line) };
    expect(verifyStripeDeposit(result, actual).ok).toBe(true);
  });
});
