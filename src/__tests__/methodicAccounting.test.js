/* eslint-disable */
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  verifyUser: jest.fn(),
}));
jest.mock('../../netlify/functions/_qb', () => ({
  getStoredTokens: jest.fn(), getValidAccessToken: jest.fn(), qbRequest: jest.fn(),
}));

const { _test } = require('../../netlify/functions/methodic-accounting');

const config = {
  methodic_customer_qb_id: 'M-CUST-NATIONAL',
  methodic_income_item_qb_id: 'M-ITEM-UNIFORMS',
  methodic_tax_code_qb_id: 'M-TAX-RESALE',
  methodic_deposit_account_qb_id: 'M-BANK',
  national_vendor_qb_id: 'N-VENDOR-METHODIC',
  national_expense_account_qb_id: 'N-COGS-METHODIC',
  national_payment_account_qb_id: 'N-BANK',
};
const request = {
  id: 'request-1', request_number: 'MTH-01001', sales_order_id: 'SO-2100',
  title: 'Falcons uniforms', quantity: 22, quoted_unit_cost_cents: 2500,
  quoted_setup_cost_cents: 5000, billing_amount_cents: 60000,
  billing_invoice_date: '2026-08-30', billing_due_date: '2026-09-29',
  methodic_invoice_number: 'MTH-01001', methodic_qb_transaction_id: 'M-INV-1',
  national_qb_transaction_id: 'N-BILL-1',
};

describe('Methodic intercompany accounting builders', () => {
  test('calculates the proposed intercompany total from quote cost and setup', () => {
    expect(_test.quoteTotalCents(request)).toBe(60000);
  });

  test('builds equal Methodic A/R and National A/P documents with explicit mappings', () => {
    const invoice = _test.buildMethodicInvoice(request, config);
    const bill = _test.buildNationalBill(request, config);
    expect(invoice).toMatchObject({
      CustomerRef: { value: 'M-CUST-NATIONAL' }, DocNumber: 'MTH-01001',
      Line: [{ Amount: 600, SalesItemLineDetail: { ItemRef: { value: 'M-ITEM-UNIFORMS' }, TaxCodeRef: { value: 'M-TAX-RESALE' } } }],
    });
    expect(bill).toMatchObject({
      VendorRef: { value: 'N-VENDOR-METHODIC' }, DocNumber: 'MTH-01001',
      Line: [{ Amount: 600, AccountBasedExpenseLineDetail: { AccountRef: { value: 'N-COGS-METHODIC' } } }],
    });
    expect(invoice.Line[0].Amount).toBe(bill.Line[0].Amount);
  });

  test('links paired payment records to the National bill and Methodic invoice', () => {
    const payment = { payment_number: 'MTP-01001', amount_cents: 25000, payment_date: '2026-09-10' };
    const billPayment = _test.buildNationalBillPayment(request, payment, config);
    const invoicePayment = _test.buildMethodicPayment(request, payment, config);
    expect(billPayment).toMatchObject({
      DocNumber: 'MTP-01001', TotalAmt: 250, CheckPayment: { BankAccountRef: { value: 'N-BANK' } },
      Line: [{ LinkedTxn: [{ TxnId: 'N-BILL-1', TxnType: 'Bill' }] }],
    });
    expect(invoicePayment).toMatchObject({
      PaymentRefNum: 'MTP-01001', TotalAmt: 250, DepositToAccountRef: { value: 'M-BANK' },
      Line: [{ LinkedTxn: [{ TxnId: 'M-INV-1', TxnType: 'Invoice' }] }],
    });
  });

  test('fails closed when a QuickBooks document number is duplicated', async () => {
    const client = { query: jest.fn().mockResolvedValue({ Invoice: [{ Id: '1' }, { Id: '2' }] }) };
    await expect(_test.findOne(client, 'Invoice', 'DocNumber', 'MTH-01001')).rejects.toThrow(/multiple invoice/i);
  });
});
