import { buildNetSuiteInvoices, parseNetSuiteCommissionDate } from './netsuiteCommissions';

const line = overrides => ({
  'Internal ID': '901', 'SO #': 'SO-1101', 'Company Name': 'Example School', 'Invoice #': 'Invoice #INV-501',
  'Invoice Status': 'Paid In Full', 'Invoice Date': '05/29/2026', 'Date of Full Payment': '09/04/2026',
  'Item Fulfillment': 'IF-1', 'Purchase Order': 'PO-77', Status: 'Closed', 'Sales Rep': 'Alex Rep',
  Item: 'Shirt', Quantity: '10', 'SO Amount': '3599.70', 'Invoice Amount': '2000.25', 'PO Amount': '1500.00',
  ...overrides,
});

describe('buildNetSuiteInvoices', () => {
  test('groups line totals into an invoice, computes payment-age rate, and preserves item detail', () => {
    const rows = [
      line({ 'Invoice Amount': '2000.25', 'PO Amount': '1500', Item: 'Jersey', Quantity: '10' }),
      line({ 'Internal ID': '902', 'Invoice #': 'INV-501', 'Invoice Amount': '1599.45', 'PO Amount': '1179', Item: 'Shorts', Quantity: '5' }),
    ];
    const { invoices, errors } = buildNetSuiteInvoices(rows);
    expect(errors).toEqual([]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      id: 'INV-501', soNumber: 'SO-1101', customer: 'Example School', repName: 'Alex Rep',
      invoiceDate: '2026-05-29', paidDate: '2026-09-04', month: '2026-09',
      revenue: 3599.7, cost: 2679, gp: 920.7, marginPct: 920.7 / 3599.7 * 100,
      daysToPay: 98, rate: 0.15, commission: 138.11,
    });
    expect(invoices[0].items).toEqual([
      { item: 'Jersey', quantity: 10, revenue: 2000.25, cost: 1500, poNumber: 'PO-77' },
      { item: 'Shorts', quantity: 5, revenue: 1599.45, cost: 1179, poNumber: 'PO-77' },
    ]);
  });

  test('uses 30 percent at exactly 90 days and 15 percent at 91 days', () => {
    const at90 = buildNetSuiteInvoices([line({ 'Invoice #': '90', 'Invoice Date': '2026-01-01', 'Date of Full Payment': '2026-04-01', 'Invoice Amount': '440', 'PO Amount': '255' })]).invoices[0];
    const at91 = buildNetSuiteInvoices([line({ 'Invoice #': '91', 'Invoice Date': '2026-01-01', 'Date of Full Payment': '2026-04-02', 'Invoice Amount': '440', 'PO Amount': '255' })]).invoices[0];
    expect([at90.daysToPay, at90.rate, at90.commission]).toEqual([90, 0.3, 55.5]);
    expect([at91.daysToPay, at91.rate, at91.commission]).toEqual([91, 0.15, 27.75]);
  });

  test('handles the long-payment sample with negative GP retained', () => {
    const invoice = buildNetSuiteInvoices([line({
      'Invoice #': 'INV-LATE', 'SO #': 'SO-2', 'Invoice Date': '08/28/2025', 'Date of Full Payment': '09/29/2026',
      'Invoice Amount': '440', 'PO Amount': '455',
    })]).invoices[0];
    expect(invoice).toMatchObject({ daysToPay: 397, rate: 0.15, gp: -15, commission: -2.25 });
  });

  test('invalidates an entire invoice on duplicate rows and rejects partially valid groups', () => {
    const duplicate = line();
    const result = buildNetSuiteInvoices([duplicate, { ...duplicate }]);
    expect(result.invoices).toEqual([]);
    expect(result.errors.join(' ')).toMatch(/duplicate source row/i);

    const invalidPart = line({ 'Internal ID': '902', 'Invoice Amount': '' });
    const mixed = buildNetSuiteInvoices([line(), invalidPart]);
    expect(mixed.invoices).toEqual([]);
    expect(mixed.errors.join(' ')).toMatch(/missing or invalid Invoice Amount/i);
  });

  test('rejects inconsistent invoice identity, non-paid status, and missing PO cost', () => {
    expect(buildNetSuiteInvoices([line(), line({ 'Internal ID': '902', 'Sales Rep': 'Other Rep' })]).invoices).toEqual([]);
    expect(buildNetSuiteInvoices([line({ 'Invoice Status': 'Open' })]).invoices).toEqual([]);
    expect(buildNetSuiteInvoices([line({ 'PO Amount': '' })]).invoices).toEqual([]);
    expect(buildNetSuiteInvoices([line({ 'PO Amount': '0' })]).invoices[0].cost).toBe(0);
  });

  test('rejects missing required values, malformed dates, and bad numeric fields', () => {
    const cases = [
      line({ 'Company Name': '' }), line({ 'Invoice Date': '02/30/2026' }),
      line({ 'Date of Full Payment': 'not a date' }), line({ Quantity: 'many' }),
      line({ 'Invoice Amount': '12 USD' }), line({ 'SO #': '' }),
    ];
    for (const row of cases) {
      const result = buildNetSuiteInvoices([row]);
      expect(result.invoices).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('returns null margin when revenue is zero and uses UTC day for Date and ISO timestamps', () => {
    const result = buildNetSuiteInvoices([line({ 'Invoice Date': new Date('2026-01-01T23:00:00-08:00'), 'Date of Full Payment': '2026-01-03T01:00:00+10:00', 'Invoice Amount': '0', 'PO Amount': '0' })]);
    expect(result.invoices[0]).toMatchObject({ invoiceDate: '2026-01-02', paidDate: '2026-01-02', daysToPay: 0, marginPct: null });
    expect(parseNetSuiteCommissionDate(46300)).toBe('2026-10-05');
  });
});
