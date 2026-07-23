// Locks the fix for Denis's "sizes not appearing" report (SO-1535): sizes carrying
// vendor labels like "Womens X-Large", "Unisex Large" or "Mens 2X-Large" were dropped
// from the Sales Order PDF, Production Sheet and Invoice printouts because the renderers
// iterated `SZ_ORD.filter(...)`, which only keeps sizes present in the canonical SZ_ORD
// list. The line total (summed from every size) stayed correct, so a 12-unit line printed
// only its 9 standard units — exactly what SO-1535 showed. The shared helpers below keep
// every ordered size, standard sizes first (in SZ_ORD order) and custom labels appended.
import { orderedSizeKeys, sizeBreakdownStr } from '../constants';

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
