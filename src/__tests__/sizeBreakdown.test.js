// Locks the fix for Denis's "sizes not appearing" report (SO-1535): sizes carrying
// vendor labels like "Womens X-Large", "Unisex Large" or "Mens 2X-Large" were dropped
// from the Sales Order PDF, Production Sheet and Invoice printouts because the renderers
// iterated `SZ_ORD.filter(...)`, which only keeps sizes present in the canonical SZ_ORD
// list. The line total (summed from every size) stayed correct, so a 12-unit line printed
// only its 9 standard units — exactly what SO-1535 showed. The shared helpers below keep
// every ordered size, standard sizes first (in SZ_ORD order) and custom labels appended.
import { normalizeFootwearSize, normalizeFootwearSizeList, normalizeFootwearSizeQtyMap, orderedSizeKeys, sizeBreakdownStr } from '../constants';

describe('sizeBreakdownStr — keeps custom vendor size labels', () => {
  test('SO-1535 DT6105: custom Womens sizes are NOT dropped', () => {
    // Exact stored shape from so_items for SO-1535 / DT6105.
    const sizes = { L: 3, M: 5, S: 1, 'Womens X-Large': 2, 'Womens 2X-Large': 1 };
    expect(sizeBreakdownStr(sizes, false))
      .toBe('1 S, 5 M, 3 L, 2 Womens X-Large, 1 Womens 2X-Large');
  });

  test('standard-only lines render exactly as before (SZ_ORD order)', () => {
    expect(sizeBreakdownStr({ '2XL': 2, S: 1, XL: 4, M: 5 }, false))
      .toBe('1 S, 5 M, 4 XL, 2 2XL');
  });

  test('Mens / Unisex labels are kept and ordered after standards', () => {
    expect(sizeBreakdownStr({ 'Unisex Large': 3, S: 1, 'Mens 2X-Large': 2 }, false))
      .toBe('1 S, 3 Unisex Large, 2 Mens 2X-Large');
  });

  test('footwear renders qty/size', () => {
    expect(sizeBreakdownStr({ '10.5': 2, '9': 1 }, true)).toBe('1/9, 2/10.5');
  });

  test('zero and missing sizes are skipped; empty map → empty string', () => {
    expect(sizeBreakdownStr({ S: 0, M: 3 }, false)).toBe('3 M');
    expect(sizeBreakdownStr({}, false)).toBe('');
    expect(sizeBreakdownStr(null, false)).toBe('');
  });
});

describe('footwear size normalization — one decimal half-size column', () => {
  test('converts Adidas dash and fraction aliases to .5', () => {
    expect(normalizeFootwearSize('10-')).toBe('10.5');
    expect(normalizeFootwearSize('10½')).toBe('10.5');
    expect(normalizeFootwearSize('10.5')).toBe('10.5');
  });

  test('dedupes a mixed Adidas/catalog run and keeps numeric order', () => {
    expect(normalizeFootwearSizeList(['11', '10-', '10.5', '9', '9-', '9.5', '10']))
      .toEqual(['9', '9.5', '10', '10.5', '11']);
  });

  test('combines quantities stored under both spellings', () => {
    expect(normalizeFootwearSizeQtyMap({ '9-': 2, '9.5': 3, '10': 1 }))
      .toEqual({ '9.5': 5, '10': 1 });
    expect(sizeBreakdownStr({ '9-': 2, '9.5': 3, '10': 1 }, true))
      .toBe('5/9.5, 1/10');
  });
});

describe('orderedSizeKeys — production sheet / job-grid columns', () => {
  test('custom labels appear as columns, after the standard run', () => {
    // Flattened keys across a job's item size maps.
    const keys = ['L', 'M', 'S', 'Womens X-Large', 'Womens 2X-Large'];
    expect(orderedSizeKeys(keys)).toEqual(['S', 'M', 'L', 'Womens X-Large', 'Womens 2X-Large']);
  });

  test('dedupes labels shared across items and preserves SZ_ORD order', () => {
    const keys = ['M', 'S', 'M', 'XL', 'S', 'Unisex Large'];
    expect(orderedSizeKeys(keys)).toEqual(['S', 'M', 'XL', 'Unisex Large']);
  });
});

// Adidas B2B footwear labels the half size with a trailing dash ("10-" = 10.5) and runs past 17
// (18, 19). Neither form is in SZ_ORD, so every one of them tied at the unknown-label rank and
// piled up at the end of the size grid — KI6713 rendered 4,7,8,…,12,4-,5-,…,14-,18,19 instead of
// in numeric order. szRank ranks those numerically inside the footwear block.
describe('szRank — Adidas footwear half sizes and 18/19', () => {
  test('KI6713 grid ordering: half sizes sit next to their whole size', () => {
    const grid = ['4', '7', '8', '9', '10', '11', '12', '4-', '5-', '6-', '7-', '8-', '9-',
      '10-', '11-', '12-', '13-', '14-', '18', '19'];
    expect(orderedSizeKeys(grid)).toEqual(['4', '4-', '5-', '6-', '7', '7-', '8', '8-', '9', '9-',
      '10', '10-', '11', '11-', '12', '12-', '13-', '14-', '18', '19']);
  });

  test('a full Adidas run orders 4 … 19 by number', () => {
    const run = ['9', '9-', '10', '10-', '17', '18', '19', '4', '4-'];
    expect(orderedSizeKeys(run)).toEqual(['4', '4-', '9', '9-', '10', '10-', '17', '18', '19']);
  });

  test('dash and decimal halves of the same size both land between 10 and 11', () => {
    // "10-" and "10.5" are the same size, so they tie and keep input order relative to each other.
    const out = orderedSizeKeys(['11', '10-', '10.5', '10']);
    expect(out[0]).toBe('10');
    expect(out.slice(1, 3).sort()).toEqual(['10-', '10.5']);
    expect(out[3]).toBe('11');
  });

  test('apparel and custom labels are unaffected', () => {
    expect(orderedSizeKeys(['2XL', 'S', 'Womens X-Large', 'M', 'OSFA']))
      .toEqual(['S', 'M', '2XL', 'OSFA', 'Womens X-Large']);
  });
});
