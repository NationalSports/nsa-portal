// Per-document tax exemption. The rule that matters: exempting one estimate / sales order
// must never be the same lever as exempting the customer, and an untaxed document must
// carry the reason it was untaxed.
import {
  TAX_EXEMPT_REASONS, TAX_EXEMPT_OTHER, composeTaxExemptReason, canSaveTaxExempt,
  applyTaxExempt, clearTaxExempt, taxExemptInfo, taxExemptLabel,
} from '../lib/taxExempt';
import { calcOrderTotals } from '../pricing';

describe('composeTaxExemptReason', () => {
  test('a preset alone is the reason', () => {
    expect(composeTaxExemptReason('Resale certificate on file', '')).toBe('Resale certificate on file');
  });

  test('a note is appended to the preset', () => {
    expect(composeTaxExemptReason('School / district purchase order', 'PO 44812'))
      .toBe('School / district purchase order — PO 44812');
  });

  test('"Other" collapses to the note — recording the word "Other" explains nothing', () => {
    expect(composeTaxExemptReason(TAX_EXEMPT_OTHER, 'Interstate sale, ships to TN')).toBe('Interstate sale, ships to TN');
    expect(composeTaxExemptReason(TAX_EXEMPT_OTHER, '   ')).toBe('');
  });

  test('a free-typed note with no preset still counts', () => {
    expect(composeTaxExemptReason('', 'Church group, letter on file')).toBe('Church group, letter on file');
  });

  test('whitespace is not a reason', () => {
    expect(composeTaxExemptReason('  ', '  ')).toBe('');
    expect(canSaveTaxExempt('', '')).toBe(false);
    expect(canSaveTaxExempt(TAX_EXEMPT_OTHER, '')).toBe(false);
    expect(canSaveTaxExempt('501(c)(3) nonprofit', '')).toBe(true);
  });

  test('every offered preset is on its own a saveable reason, except "Other"', () => {
    for (const r of TAX_EXEMPT_REASONS) {
      expect(canSaveTaxExempt(r, '')).toBe(r !== TAX_EXEMPT_OTHER);
    }
  });
});

describe('applyTaxExempt / clearTaxExempt', () => {
  const base = { id: 'SO-1481', customer_id: 'c1', tax_rate: 0.0825 };

  test('stamps the flag, the reason and who/when', () => {
    const out = applyTaxExempt(base, { reason: 'Resale certificate on file', by: 'Steve', at: '2026-09-15T12:00:00.000Z' });
    expect(out.tax_exempt).toBe(true);
    expect(out.tax_exempt_reason).toBe('Resale certificate on file');
    expect(out.tax_exempt_by).toBe('Steve');
    expect(out.tax_exempt_at).toBe('2026-09-15T12:00:00.000Z');
  });

  test('never records an exemption with no justification', () => {
    expect(applyTaxExempt(base, { reason: '   ', by: 'Steve' })).toBe(base);
    expect(applyTaxExempt(base, {}).tax_exempt).toBeUndefined();
  });

  test('does not touch the customer — the whole point of a per-document exemption', () => {
    const out = applyTaxExempt(base, { reason: '501(c)(3) nonprofit', by: 'Steve' });
    expect(out.customer_id).toBe('c1');
    expect(out).not.toHaveProperty('customer_tax_exempt');
    expect(Object.keys(out).filter((k) => k.startsWith('tax_'))).toEqual(
      expect.arrayContaining(['tax_exempt', 'tax_exempt_reason', 'tax_exempt_by', 'tax_exempt_at']));
  });

  test('clearing wipes the whole stamp, not just the flag', () => {
    const on = applyTaxExempt(base, { reason: 'Shipped out of state', by: 'Steve' });
    const off = clearTaxExempt(on);
    expect(off.tax_exempt).toBe(false);
    // A stale reason left behind would read as though the order were still exempt.
    expect(off.tax_exempt_reason).toBeNull();
    expect(off.tax_exempt_by).toBeNull();
    expect(off.tax_exempt_at).toBeNull();
  });

  test('the order keeps its tax_rate, so clearing restores the real tax', () => {
    const off = clearTaxExempt(applyTaxExempt(base, { reason: 'Resale certificate on file', by: 'S' }));
    expect(off.tax_rate).toBe(0.0825);
  });
});

describe('taxExemptInfo', () => {
  const cust = { name: 'Central High', tax_exempt: false };

  test('a taxable document reports not exempt', () => {
    expect(taxExemptInfo({ id: 'SO-1' }, cust)).toMatchObject({ exempt: false, scope: null });
  });

  test('a document exemption reports scope "order" with its reason', () => {
    const o = applyTaxExempt({ id: 'SO-1' }, { reason: 'School / district purchase order', by: 'Steve' });
    expect(taxExemptInfo(o, cust)).toMatchObject({ exempt: true, scope: 'order', reason: 'School / district purchase order', by: 'Steve' });
  });

  test('a customer-record exemption is reported separately from a document one', () => {
    expect(taxExemptInfo({ id: 'SO-1' }, { name: 'X', tax_exempt: true })).toMatchObject({ exempt: true, scope: 'customer' });
  });

  test('an OMG store order is its own case — OMG remits, nobody exempted anything', () => {
    expect(taxExemptInfo({ id: 'SO-1', tax_exempt: true, omg_store_id: 'omg9' }, cust)).toMatchObject({ exempt: true, scope: 'omg' });
  });

  test('a promo-flagged order reads as flagged but unexplained', () => {
    // The promo flow sets tax_exempt with no reason; surfacing that honestly is the point.
    const info = taxExemptInfo({ id: 'SO-1', tax_exempt: true, promo_applied: true }, cust);
    expect(info).toMatchObject({ exempt: true, scope: 'order', reason: '' });
    expect(taxExemptLabel({ id: 'SO-1', tax_exempt: true, promo_applied: true }, cust)).toBe('EXEMPT · no reason recorded');
  });

  test('tolerates a missing order or customer', () => {
    expect(taxExemptInfo(null, null)).toMatchObject({ exempt: false });
    expect(taxExemptInfo({ id: 'E-1' }, null)).toMatchObject({ exempt: false });
  });
});

describe('taxExemptLabel', () => {
  test('names the scope so a rep can tell the three cases apart', () => {
    expect(taxExemptLabel({ tax_exempt: true, tax_exempt_reason: 'Resale certificate on file' }, null)).toBe('EXEMPT · Resale certificate on file');
    expect(taxExemptLabel({ tax_exempt: true, omg_store_id: 'o1' }, null)).toBe('OMG remits');
    expect(taxExemptLabel({}, { tax_exempt: true })).toBe('EXEMPT · customer record');
    expect(taxExemptLabel({}, { tax_exempt: false })).toBe('');
  });
});

describe('the exemption actually zeroes the tax', () => {
  // calcOrderTotals is the shared money path behind the editors, invoices and the QB sync.
  // The feature is only real if flagging the document changes what the customer is charged.
  const order = (extra) => ({
    id: 'SO-1481', tax_rate: 0.1,
    items: [{ id: 'i1', name: 'Tee', unit_sell: 20, sizes: { M: 10 }, decorations: [] }],
    ...extra,
  });

  test('a taxable order is taxed at its rate', () => {
    const t = calcOrderTotals(order(), 0);
    expect(t.rev).toBe(200);
    expect(t.tax).toBeCloseTo(20, 6);
  });

  test('exempting THIS document drops the tax to zero', () => {
    const t = calcOrderTotals(applyTaxExempt(order(), { reason: 'School / district purchase order', by: 'Steve' }), 0);
    expect(t.rev).toBe(200);
    expect(t.tax).toBe(0);
    expect(t.grand).toBe(200);
  });

  test('clearing the exemption brings the tax back', () => {
    const t = calcOrderTotals(clearTaxExempt(applyTaxExempt(order(), { reason: 'Shipped out of state', by: 'S' })), 0);
    expect(t.tax).toBeCloseTo(20, 6);
  });

  test('an exempt document ignores the customer default rate too', () => {
    // custTaxRate is the fallback for a document with no rate of its own (every estimate
    // today). Exempting the document has to beat that fallback, not just its own rate.
    const t = calcOrderTotals(applyTaxExempt({ id: 'EST-1', items: order().items }, { reason: '501(c)(3) nonprofit', by: 'S' }), 0.0825);
    expect(t.tax).toBe(0);
  });

  test('a taxable estimate still picks up the customer rate — exemption is opt-in', () => {
    const t = calcOrderTotals({ id: 'EST-1', items: order().items }, 0.0825);
    expect(t.tax).toBeCloseTo(16.5, 6);
  });
});
