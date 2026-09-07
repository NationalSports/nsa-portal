import { resolvePoDisplayVendor } from '../lib/poVendor';

const vendors = [
  { id: 'sanmar', name: 'SanMar' },
  { id: 'prolook', name: 'Prolook' },
];

test('keeps the PO supplier authoritative when the item source disagrees', () => {
  expect(resolvePoDisplayVendor(
    { vendor_id: 'sanmar', brand: 'Sport-Tek' },
    { po_id: 'PO 59040 GHBSB', vendor: 'Prolook' },
    vendors,
  )).toBe('Prolook');
});

test('uses the item supplier only when the PO has no recorded supplier', () => {
  expect(resolvePoDisplayVendor(
    { vendor_id: 'sanmar', brand: 'Sport-Tek' },
    { po_id: 'PO 58989 GHBSB' },
    vendors,
  )).toBe('SanMar');
});

test('falls back to the vendor recorded on the PO for custom suppliers', () => {
  expect(resolvePoDisplayVendor(
    { brand: 'Custom Brand' },
    { vendor: 'Local Supplier' },
    vendors,
  )).toBe('Local Supplier');
});

test('resolves stored vendor ids to display names', () => {
  expect(resolvePoDisplayVendor({}, { vendor: 'sanmar' }, vendors)).toBe('SanMar');
});

test('keeps decoration POs tied to their decorator', () => {
  expect(resolvePoDisplayVendor(
    { vendor_id: 'sanmar' },
    { po_type: 'outside_deco', deco_vendor: 'Embroidery House', vendor: 'Prolook' },
    vendors,
  )).toBe('Embroidery House');
});
