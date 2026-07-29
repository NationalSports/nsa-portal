// REGRESSION — SanMar Part ID (Unique_Key) resolution: size-label normalization.
//
// The SanMar PO preview resolves each line's Unique_Key by matching the order line's
// color+size against what SanMar's product API returns. Both sides are canonicalized
// through normSzName before comparison (see sanmarResolvePartIds in vendorApis.js:
// _smSizeNorm = _smNorm(normSzName(size))). SanMar returns bare tokens ("OSFA", "4T"),
// so an order line typed as "One Size Fits All" or "4 Toddler" never matched and the
// line stayed WITHOUT a Part ID — the PO stayed blocked ("Looking up Part IDs…" then
// "⚠ missing"). These pin the labels to the tokens SanMar returns.

import { normSzName } from '../pricing';

// Mirror the resolver's size key: strip everything but A-Z0-9 AFTER normSzName.
const smSizeNorm = (s) => String(normSzName(s) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const matches = (orderLabel, sanmarToken) => smSizeNorm(orderLabel) === smSizeNorm(sanmarToken);

describe('normSzName — one-size labels collapse to OSFA (SanMar Part ID match)', () => {
  test.each([
    'One Size Fits All',
    'ONE SIZE FITS ALL',
    'One Size Fits Most',
    'One Size',
    'OneSize',
    'O/S',
    'OSFM',
  ])('%s → OSFA', (label) => {
    expect(normSzName(label)).toBe('OSFA');
    expect(matches(label, 'OSFA')).toBe(true);
  });

  // STC21 (Sport-Tek gaiter, "ONE SIZE FITS ALL") — the exact line that failed.
  test('STC21 "ONE SIZE FITS ALL" matches SanMar OSFA', () => {
    expect(matches('ONE SIZE FITS ALL', 'OSFA')).toBe(true);
  });
});

describe('normSzName — toddler labels collapse to <n>T (SanMar Part ID match)', () => {
  test.each([
    ['2 Toddler', '2T'],
    ['3 Toddler', '3T'],
    ['4 Toddler', '4T'],
    ['5 Toddler', '5T'],
    ['6 Toddler', '6T'],
    ['Toddler 4', '4T'],
  ])('%s → %s', (label, token) => {
    expect(normSzName(label)).toBe(token);
    expect(matches(label, token)).toBe(true);
  });

  // PC450TD (Port & Company Toddler Tee, "4 TODDLER") — the exact line that failed.
  test('PC450TD "4 TODDLER" matches SanMar 4T', () => {
    expect(matches('4 TODDLER', '4T')).toBe(true);
  });
});

describe('normSzName — standard sizes still round-trip unchanged (no regression)', () => {
  test.each(['S', 'M', 'L', 'XL', '2XL', 'OSFA', '4T', 'YS'])('%s is stable', (s) => {
    expect(matches(s, s)).toBe(true);
  });
});
