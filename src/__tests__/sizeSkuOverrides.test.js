import { normalizeSizeSkuOverride, resolveSizeSkuSource, sizeSkuCode } from '../lib/sizeSkuOverrides';

const ssA1005White = { id: 'a1005-ss-white', sku: 'A1005', vendor_id: 'ss', brand: 'Adidas', color: 'White', name: 'Ottoman Polo' };
const ssA1005Navy = { id: 'a1005-ss-navy', sku: 'A1005', vendor_id: 'ss', brand: 'Adidas', color: 'Collegiate Navy', name: 'Ottoman Polo' };
const adidasLH0083 = { id: 'lh-adidas', sku: 'LH0083', vendor_id: 'adidas', brand: 'Adidas Golf', color: 'White', name: 'Ottoman Polo' };
const ssLH0083 = { id: 'lh-ss', sku: 'LH0083', vendor_id: 'ss', brand: 'Unrelated', color: 'White', name: 'Wrong duplicate' };

test('reads legacy string overrides and normalizes their SKU', () => {
  expect(normalizeSizeSkuOverride(' lh0083 ', 'adidas')).toEqual({ sku: 'LH0083', vendor_id: 'adidas', product_id: null, color: '' });
  expect(sizeSkuCode({ sku: ' lh0083 ', vendor_id: 'adidas' })).toBe('LH0083');
});

test('legacy override prefers matching brand and color over the base supplier', () => {
  expect(resolveSizeSkuSource({ raw: 'LH0083', lineSku: 'A1005', baseProduct: ssA1005White, candidates: [ssLH0083, adidasLH0083] }))
    .toMatchObject({ sku: 'LH0083', product_id: 'lh-adidas', vendor_id: 'adidas', isOverride: true });
});

test('explicit override supplier wins over duplicate SKU rows', () => {
  expect(resolveSizeSkuSource({ raw: { sku: 'LH0083', vendor_id: 'ss', color: 'White' }, baseProduct: ssA1005White, candidates: [adidasLH0083, ssLH0083] }))
    .toMatchObject({ product_id: 'lh-ss', vendor_id: 'ss' });
});

test('a White fill-in never applies to the Navy colorway', () => {
  expect(resolveSizeSkuSource({ raw: { sku: 'LH0083', vendor_id: 'adidas', color: 'White' }, lineSku: 'A1005', baseProduct: ssA1005Navy, candidates: [adidasLH0083] }))
    .toMatchObject({ sku: 'A1005', product_id: 'a1005-ss-navy', vendor_id: 'ss', isOverride: false });
});

test('legacy White substitute is also rejected for Navy from candidate color', () => {
  expect(resolveSizeSkuSource({ raw: 'LH0083', lineSku: 'A1005', baseProduct: ssA1005Navy, candidates: [ssLH0083, adidasLH0083] }))
    .toMatchObject({ sku: 'A1005', product_id: 'a1005-ss-navy', isOverride: false });
});

test('unmatched overrides never retain a mismatched base product id', () => {
  expect(resolveSizeSkuSource({ raw: { sku: 'LH0083', vendor_id: 'adidas', color: 'White' }, baseProduct: ssA1005White, candidates: [] }))
    .toMatchObject({ sku: 'LH0083', product_id: null, vendor_id: 'adidas' });
});

test('a line without an override keeps its original product identity', () => {
  expect(resolveSizeSkuSource({ raw: null, lineSku: 'A1005', baseProduct: ssA1005White, candidates: [] }))
    .toMatchObject({ sku: 'A1005', product_id: 'a1005-ss-white', vendor_id: 'ss', isOverride: false });
});
