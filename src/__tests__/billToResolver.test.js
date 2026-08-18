jest.mock('html2pdf.js', () => ({}));

import { getBillAddrs, resolveOrderBillTo, orderBillToSub, billToIdFor } from '../components';

const customer = {
  id: 'C-100',
  name: 'Actyve Volleyball Club',
  billing_address_line1: '5348 Thornburn St',
  billing_city: 'Los Angeles', billing_state: 'CA', billing_zip: '90045',
  alt_billing_addresses: [
    { type: 'billing', label: 'District Office', attention: 'Accounts Payable', street: '1 District Way', city: 'Dana Point', state: 'CA', zip: '92629' },
    { type: 'shipping', label: 'Coach House', street: '6 Passaflora Ln', city: 'Mission Viejo', state: 'CA', zip: '92694' },
    { label: 'Legacy Untyped', street: '9 Legacy Rd', city: 'Irvine', state: 'CA', zip: '92602' },
  ],
};

describe('getBillAddrs', () => {
  test('offers the default billing address plus billing-type alts, never shipping ones', () => {
    const opts = getBillAddrs(customer);
    expect(opts.map(o => o.id)).toEqual(['default', 'C-100_bill_0', 'C-100_bill_1']);
    expect(opts[0].label).toBe('Default: 5348 Thornburn St Los Angeles, CA 90045');
    expect(opts[1].label).toBe('District Office: 1 District Way Dana Point, CA 92629');
    // An untyped alt predates the billing/shipping split — the customer editor treats it
    // as billing, so it must be offered here rather than silently dropped.
    expect(opts[2].label).toBe('Legacy Untyped: 9 Legacy Rd Irvine, CA 92602');
    expect(opts.some(o => /Coach House/.test(o.label))).toBe(false);
  });

  test('labels a customer with no billing address on file instead of rendering a bare colon', () => {
    expect(getBillAddrs({ id: 'C-1', name: 'X' })[0].label).toBe('Default (no billing address on file)');
  });

  // Billing rolls up to the parent org, matching the invoice Bill To selector.
  test('takes addresses from the parent customer, and ids carry the parent id', () => {
    const parent = { id: 'P-1', name: 'Parent Org', billing_address_line1: '77 HQ Blvd', billing_city: 'Irvine', billing_state: 'CA', billing_zip: '92618', alt_billing_addresses: [{ type: 'billing', label: 'AP', street: '78 HQ Blvd', city: 'Irvine', state: 'CA', zip: '92618' }] };
    const child = { id: 'C-2', name: 'Child Club', parent_id: 'P-1' };
    const opts = getBillAddrs(child, [parent, child]);
    expect(opts.map(o => o.id)).toEqual(['default', 'P-1_bill_0']);
    expect(opts[0].label).toBe('Default: 77 HQ Blvd Irvine, CA 92618');
  });
});

describe('resolveOrderBillTo', () => {
  test('returns null when the doc bills to the customer default', () => {
    expect(resolveOrderBillTo({ bill_to_id: 'default' }, customer)).toBeNull();
    expect(resolveOrderBillTo({}, customer)).toBeNull();
    expect(resolveOrderBillTo(null, customer)).toBeNull();
  });

  test('resolves an alt billing address via the same id scheme as getBillAddrs', () => {
    const opt = getBillAddrs(customer).find(a => a.label.startsWith('District Office'));
    expect(resolveOrderBillTo({ bill_to_id: opt.id }, customer)).toEqual({
      name: 'District Office', attention: 'Accounts Payable',
      street: '1 District Way', city: 'Dana Point', state: 'CA', zip: '92629',
    });
  });

  test('ignores ids from another customer or out of range', () => {
    expect(resolveOrderBillTo({ bill_to_id: 'C-999_bill_0' }, customer)).toBeNull();
    expect(resolveOrderBillTo({ bill_to_id: 'C-100_bill_9' }, customer)).toBeNull();
  });
});

describe('orderBillToSub', () => {
  test('formats the alt address block for printed docs', () => {
    const opt = getBillAddrs(customer).find(a => a.label.startsWith('District Office'));
    expect(orderBillToSub({ bill_to_id: opt.id }, customer))
      .toBe('Attn: Accounts Payable<br/>1 District Way<br/>Dana Point, CA 92629');
  });

  // The empty string is what keeps every pre-existing doc printing exactly what it did
  // before: the PDF builders fall back to the customer default when this returns ''.
  test('returns "" for the default selection', () => {
    expect(orderBillToSub({ bill_to_id: 'default' }, customer)).toBe('');
    expect(orderBillToSub({}, customer)).toBe('');
  });
});

// The invoice Bill To pickers hand back a raw alt_billing_addresses entry (round-tripped
// through JSON), not an id. billToIdFor is what keeps them on the same id scheme as the
// order-level dropdown instead of each indexing alt_billing_addresses its own way.
describe('billToIdFor', () => {
  test('maps a raw alt entry back to the id getBillAddrs would have given it', () => {
    const alt = customer.alt_billing_addresses[0];
    expect(billToIdFor(customer, null, alt)).toBe('C-100_bill_0');
    expect(getBillAddrs(customer).map(o => o.id)).toContain(billToIdFor(customer, null, alt));
  });

  test('matches by value, so a JSON round-trip still resolves', () => {
    const clone = JSON.parse(JSON.stringify(customer.alt_billing_addresses[0]));
    expect(billToIdFor(customer, null, clone)).toBe('C-100_bill_0');
  });

  test('skips the shipping alts when numbering, so ids stay aligned with getBillAddrs', () => {
    // 'Legacy Untyped' sits at index 2 of alt_billing_addresses but index 1 of the
    // billing-only list — the id must follow the billing-only list.
    const untyped = customer.alt_billing_addresses[2];
    expect(billToIdFor(customer, null, untyped)).toBe('C-100_bill_1');
    expect(resolveOrderBillTo({ bill_to_id: 'C-100_bill_1' }, customer).name).toBe('Legacy Untyped');
  });

  test('falls back to default for an entry that is not a billing address', () => {
    expect(billToIdFor(customer, null, customer.alt_billing_addresses[1])).toBe('default');
    expect(billToIdFor(customer, null, null)).toBe('default');
  });
});
