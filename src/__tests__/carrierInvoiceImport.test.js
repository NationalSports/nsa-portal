/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — scripts/import-carrier-invoice.js
//
// Carrier invoices are the only place a dim-weight rebill is visible: the cost
// recorded at label time is a quote, and the re-measure lands on the invoice
// weeks later. Every failure here is silent — a mis-parsed amount, a dropped
// line, or a date Postgres guesses at all produce a plausible-looking number.
// ═══════════════════════════════════════════════
const { resolveHeaders, buildRows, money, isoDate, reasonOf } =
  require('../../scripts/import-carrier-invoice.js');

describe('money parsing', () => {
  test('carrier formatting: currency symbols, thousands separators', () => {
    expect(money('$1,234.56')).toBe(1234.56);
    expect(money(' $52.80 ')).toBe(52.8);
    expect(money('39.14')).toBe(39.14);
  });

  test('parenthesised amounts are credits, not positive charges', () => {
    // A credit read as a positive charge overstates what the carrier billed,
    // which is the wrong direction to be wrong in for a margin figure.
    expect(money('(4.20)')).toBe(-4.2);
    expect(money('($1,000.00)')).toBe(-1000);
  });

  test('a zero-dollar line is a real line; blank and junk are not', () => {
    expect(money('$0.00')).toBe(0);
    expect(money('')).toBeNull();
    expect(money(null)).toBeNull();
    expect(money('n/a')).toBeNull();
  });
});

describe('date parsing', () => {
  test('accepts the formats carriers actually emit', () => {
    expect(isoDate('08/22/2026')).toBe('2026-08-22');
    expect(isoDate('8/2/2026')).toBe('2026-08-02');
    expect(isoDate('2026-08-22')).toBe('2026-08-22');
    expect(isoDate('20260822')).toBe('2026-08-22');
  });

  test('returns null rather than handing Postgres something to guess at', () => {
    expect(isoDate('')).toBeNull();
    expect(isoDate('Aug 22')).toBeNull();
    expect(isoDate(null)).toBeNull();
  });
});

describe('adjustment reason', () => {
  test('classifies the charges that change what we would do about them', () => {
    expect(reasonOf('Dimensional Weight Adjustment')).toBe('dim_weight');
    expect(reasonOf('DIM WT')).toBe('dim_weight');
    expect(reasonOf('Address Correction')).toBe('address_correction');
    expect(reasonOf('Residential Surcharge')).toBe('residential');
    expect(reasonOf('Additional Handling')).toBe('additional_handling');
  });

  test('leaves anything else unclassified rather than guessing', () => {
    expect(reasonOf('Ground Commercial')).toBeNull();
    expect(reasonOf('')).toBeNull();
  });
});

describe('header resolution', () => {
  const headers = ['Invoice Number', 'Invoice Date', 'Tracking Number', 'Charge Description', 'Billed Weight', 'Net Amount'];

  test('matches ignoring case, spaces and punctuation', () => {
    const cols = resolveHeaders(headers, {});
    expect(cols.tracking_number).toBe('Tracking Number');
    expect(cols.billed_amount).toBe('Net Amount');
    expect(cols.billed_weight_lb).toBe('Billed Weight');
  });

  test('an explicit --map override wins over the alias list', () => {
    const cols = resolveHeaders(['Tracking Number', 'Net Amount', 'Total Charge'], { billed_amount: 'Total Charge' });
    expect(cols.billed_amount).toBe('Total Charge');
  });

  test('an unmatched column is reported as missing, not silently guessed', () => {
    const cols = resolveHeaders(['Some Unrelated Column'], {});
    expect(cols.tracking_number).toBeUndefined();
    expect(cols.billed_amount).toBeUndefined();
  });
});

describe('row building', () => {
  const cols = { tracking_number: 'Tracking Number', invoice_number: 'Invoice Number',
    invoice_date: 'Invoice Date', billed_amount: 'Net Amount',
    billed_weight_lb: 'Billed Weight', charge_description: 'Charge Description' };

  test('unusable lines are counted, not silently dropped', () => {
    const { rows, skipped } = buildRows([
      { 'Tracking Number': '1Z111', 'Net Amount': '$52.80', 'Charge Description': 'Dimensional Weight', 'Invoice Number': 'I1', 'Invoice Date': '08/22/2026', 'Billed Weight': '30.2' },
      { 'Tracking Number': '',      'Net Amount': '$4.10',  'Charge Description': 'Fuel', 'Invoice Number': 'I1', 'Invoice Date': '08/22/2026', 'Billed Weight': '' },
      { 'Tracking Number': '1Z444', 'Net Amount': '',       'Charge Description': 'Ground', 'Invoice Number': 'I1', 'Invoice Date': '08/22/2026', 'Billed Weight': '7' },
    ], cols, {});
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual({ no_tracking: 1, no_amount: 1 });
    expect(rows[0]).toMatchObject({
      carrier: 'ups', tracking_number: '1Z111', billed_amount: 52.8,
      billed_weight_lb: 30.2, adjustment_reason: 'dim_weight', invoice_date: '2026-08-22',
    });
  });

  test('an explicit --invoice-number overrides the column', () => {
    const { rows } = buildRows(
      [{ 'Tracking Number': '1Z1', 'Net Amount': '1.00', 'Invoice Number': 'FROM-FILE', 'Invoice Date': '08/22/2026' }],
      cols, { invoiceNumber: 'OVERRIDE', carrier: 'FedEx' });
    expect(rows[0].invoice_number).toBe('OVERRIDE');
    expect(rows[0].carrier).toBe('fedex');
  });
});
