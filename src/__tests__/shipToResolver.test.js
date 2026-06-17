jest.mock('html2pdf.js', () => ({}));

import { getAddrs, resolveOrderShipTo, orderShipToSub } from '../components';

const customer = {
  id: 'C-100',
  name: 'Dana Hills Football',
  shipping_address_line1: '33333 Golden Lantern',
  shipping_city: 'Dana Point', shipping_state: 'CA', shipping_zip: '92629',
  alt_billing_addresses: [
    { type: 'billing', label: 'District Office', street: '1 District Way', city: 'Dana Point', state: 'CA', zip: '92629' },
    { type: 'shipping', label: 'Coach House', street: '6 Passaflora Ln', city: 'Mission Viejo', state: 'CA', zip: '92694' },
  ],
};

describe('resolveOrderShipTo', () => {
  test('returns null for default ship-to', () => {
    expect(resolveOrderShipTo({ ship_to_id: 'default' }, customer)).toBeNull();
    expect(resolveOrderShipTo({}, customer)).toBeNull();
    expect(resolveOrderShipTo(null, customer)).toBeNull();
    // "Default" entry in the dropdown carries the customer id
    expect(resolveOrderShipTo({ ship_to_id: 'C-100' }, customer)).toBeNull();
  });

  test('resolves alt shipping address via the same id scheme as getAddrs', () => {
    const altEntry = getAddrs(customer).find(a => a.label.startsWith('Coach House'));
    expect(altEntry).toBeTruthy();
    const sel = resolveOrderShipTo({ ship_to_id: altEntry.id }, customer);
    expect(sel).toEqual({ name: 'Coach House', street: '6 Passaflora Ln', city: 'Mission Viejo', state: 'CA', zip: '92694' });
  });

  test('ignores alt ids that belong to a different customer or are out of range', () => {
    expect(resolveOrderShipTo({ ship_to_id: 'C-999_alt_0' }, customer)).toBeNull();
    expect(resolveOrderShipTo({ ship_to_id: 'C-100_alt_5' }, customer)).toBeNull();
  });

  test('returns custom free-text address', () => {
    const sel = resolveOrderShipTo({ ship_to_id: 'custom', ship_to_custom: '1 Custom St\nSomewhere, CA 90001' }, customer);
    expect(sel).toEqual({ name: 'Dana Hills Football', text: '1 Custom St\nSomewhere, CA 90001' });
  });
});

describe('orderShipToSub', () => {
  test('formats alt address for printed docs', () => {
    const altEntry = getAddrs(customer).find(a => a.label.startsWith('Coach House'));
    expect(orderShipToSub({ ship_to_id: altEntry.id }, customer)).toBe('6 Passaflora Ln<br/>Mission Viejo, CA 92694');
  });

  test('converts custom text newlines to <br/> and returns "" for default', () => {
    expect(orderShipToSub({ ship_to_id: 'custom', ship_to_custom: 'A\nB' }, customer)).toBe('A<br/>B');
    expect(orderShipToSub({ ship_to_id: 'default' }, customer)).toBe('');
  });
});
