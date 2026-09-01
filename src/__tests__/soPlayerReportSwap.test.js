import { mapLinesToSoItems, materializeMappedLine } from '../lib/soPlayerReport';

// Store lines as they sit in webstore_order_items — one per player, qty 1.
const storeLines = (n, over) => Array.from({ length: n }, (_, i) => ({ order_id: 'o' + i, player_name: 'P' + i, qty: 1, ...over }));
const black = (n, size) => storeLines(n, { product_id: 'mt-1203-080', sku: '1203.080', color: 'Black', size });
const white = (n, size) => storeLines(n, { product_id: 'mt-1203-005', sku: '1203.005', color: 'White', size });

const GIRLS_WHITE = { product_id: 'mt-1203-005', sku: '1203.005', name: 'Girls Poly/Spandex Solid Racerback Tank', color: 'White', sizes: { S: 6, M: 1 } };

describe('mapLinesToSoItems — item swapped by zeroing the old line', () => {
  // Live case, St. Francis Tennis SO-2035: the girls tank was swapped for the ladies
  // cut. The rep zeroed 1203.080's S and M and added a 1202 line for the 36 S + 12 M,
  // leaving 1203.080 on the SO at L:1. The report kept printing 1203.080 because the
  // sku still matched, so Silver Screen would have been sent the wrong garment.
  const soItems = [
    { product_id: 'mt-1203-080', sku: '1203.080', name: 'Girls Poly/Spandex Solid Racerback Tank', color: 'Black', sizes: { L: 1, M: 0, S: 0 } },
    { product_id: null, sku: '1202', name: 'Momentec Ladies Poly/Spandex Solid Racerback Tank', color: 'Black', sizes: { S: 36, M: 12 } },
    GIRLS_WHITE,
  ];
  const { lines, substitutions, unmatched } = mapLinesToSoItems([...black(36, 'S'), ...black(12, 'M'), ...white(6, 'S'), ...white(1, 'M')], soItems);

  test('the black tanks print the replacement, marked with what it replaced', () => {
    const blacks = lines.filter((l) => l.sku === '1203.080');
    expect(blacks).toHaveLength(48);
    blacks.forEach((l) => {
      expect(l._sku).toBe('1202');
      expect(l._name).toBe('Momentec Ladies Poly/Spandex Solid Racerback Tank');
      expect(l._color).toBe('Black');
      expect(l._wasSku).toBe('1203.080');
      expect(l._verify).toBe(false);
      expect(l._unmatched).toBeFalsy();
    });
    expect(substitutions).toEqual([{ from: '1203.080', to: '1202 Black', verify: false }]);
    expect(unmatched).toEqual([]);
  });

  test('the white tanks, untouched on the SO, still print as themselves', () => {
    lines.filter((l) => l.sku === '1203.005').forEach((l) => {
      expect(l._sku).toBe('1203.005');
      expect(l._wasSku).toBe('');
    });
  });
});

describe('mapLinesToSoItems — matches that must not move', () => {
  test('an SO line that still covers the ordered sizes stays a plain match', () => {
    const soItems = [
      { product_id: 'mt-1203-080', sku: '1203.080', name: 'Girls Tank', color: 'Black', sizes: { S: 36, M: 12 } },
      { product_id: null, sku: '1202', name: 'Ladies Tank', color: 'Black', sizes: { S: 4 } }, // extras, nobody ordered them
    ];
    const { lines, substitutions } = mapLinesToSoItems([...black(36, 'S'), ...black(12, 'M')], soItems);
    lines.forEach((l) => { expect(l._sku).toBe('1203.080'); expect(l._wasSku).toBe(''); });
    expect(substitutions).toEqual([]);
  });

  test('a size label the SO writes differently keeps its sku instead of guessing', () => {
    // Store says OSFA, the SO line says OS: no shared sizes, so the match is released
    // — but the only orphan on the SO barely overlaps, so the sku match is taken back.
    const soItems = [
      { product_id: 'p-159', sku: '5161257', name: "Adidas Men's Superlite 3 Team Visor", color: 'Black/White', sizes: { OS: 27 } },
      { product_id: 'p-155', sku: '5160078', name: "Adidas Men's Superlite 4 Team Hat", color: 'Black/White', sizes: { OSFA: 2 } },
    ];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(storeLines(27, { product_id: 'p-159', sku: '5161257', color: 'Black/White', size: 'OSFA' }), soItems);
    lines.forEach((l) => { expect(l._sku).toBe('5161257'); expect(l._wasSku).toBe(''); expect(l._unmatched).toBeFalsy(); });
    expect(substitutions).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  test('a product dropped from the SO entirely is still flagged, not silently swapped', () => {
    const visorOnly = { product_id: 'p-159', sku: '5161257', name: 'Visor', color: 'Black/White', sizes: { OSFA: 27 } };
    const { lines, unmatched } = mapLinesToSoItems(black(3, 'S'), [visorOnly]);
    lines.forEach((l) => { expect(l._unmatched).toBe(true); });
    expect(unmatched).toEqual(['1203.080']);
  });
});

describe('mapLinesToSoItems — the SO is the source of truth for sizes and new lines', () => {
  test('treats OSFA and Adjustable as the same one-size replacement', () => {
    const source = storeLines(2, { product_id: 'visor-old', sku: '5161257', name: 'Old Visor', color: 'Black/White', size: 'OSFA' });
    const soItems = [{ sku: 'AH604', name: 'Replacement Visor', color: 'Black/White', sizes: { Adjustable: 2 } }];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(source, soItems);
    lines.forEach((line) => {
      const current = materializeMappedLine(line);
      expect(current).toMatchObject({ sku: 'AH604', size: 'Adjustable', _wasSku: '5161257', _verify: false });
    });
    expect(substitutions).toEqual([{ from: '5161257', to: 'AH604 Black/White', verify: false }]);
    expect(unmatched).toEqual([]);
  });

  test('maps only a direct product deficit to its unique exact replacement', () => {
    const source = [
      ...storeLines(1, { sku: 'GL9698', name: 'Old Tee', color: 'Navy', size: 'L' }),
      ...storeLines(5, { sku: 'GL9698', name: 'Old Tee', color: 'Navy', size: 'M' }),
      ...storeLines(20, { sku: 'GL9698', name: 'Old Tee', color: 'Navy', size: 'S' }),
      ...storeLines(1, { sku: 'GL9698', name: 'Old Tee', color: 'Navy', size: 'XL' }),
    ];
    const soItems = [
      { sku: 'GL9698', name: 'Old Tee', color: 'Navy', sizes: { L: 1, M: 4, S: 15, XL: 1, XS: 2 } },
      { sku: 'AT301', name: 'Replacement Tee', color: 'Navy', sizes: { M: 1, S: 5 } },
    ];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(source, soItems);
    const current = lines.map(materializeMappedLine);
    expect(current.reduce((n, line) => n + line.qty, 0)).toBe(27);
    expect(current.filter((line) => line.sku === 'GL9698').reduce((n, line) => n + line.qty, 0)).toBe(21);
    expect(current.filter((line) => line.sku === 'AT301').reduce((n, line) => n + line.qty, 0)).toBe(6);
    expect(current.every((line) => !line._verify)).toBe(true);
    expect(substitutions).toEqual([{ from: 'GL9698', to: 'AT301 Navy', verify: false }]);
    expect(unmatched).toEqual([]);
  });

  test('accepts a unique equal-total replacement with a partially changed size curve', () => {
    const source = [
      ...storeLines(2, { sku: 'JL5410', name: 'Old Shorts', color: 'Navy', size: 'S' }),
      ...storeLines(1, { sku: 'JL5410', name: 'Old Shorts', color: 'Navy', size: 'S 4"' }),
    ];
    const soItems = [{ sku: 'AT310', name: 'Replacement Shorts', color: 'Navy', sizes: { S: 2, M: 1 } }];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(source, soItems);
    const current = lines.map(materializeMappedLine);
    expect(current.filter((line) => line.size === 'S').reduce((n, line) => n + line.qty, 0)).toBe(2);
    expect(current.filter((line) => line.size === 'M').reduce((n, line) => n + line.qty, 0)).toBe(1);
    expect(current.every((line) => !line._verify)).toBe(true);
    expect(substitutions).toEqual([{ from: 'JL5410', to: 'AT310 Navy', verify: false }]);
    expect(unmatched).toEqual([]);
  });

  test('same-SKU size change follows the SO (SO-2021: HI0704 XS → S)', () => {
    const source = [{ id: 'hi-1', order_id: 'o1', sku: 'HI0704', name: 'Adidas W. Team Issue Pants', color: 'Black', size: 'XS', qty: 1 }];
    const soItems = [{ sku: 'HI0704', name: 'Adidas W. Team Issue Pants', color: 'Black', sizes: { XS: 0, S: 1 } }];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(source, soItems);
    const current = materializeMappedLine(lines[0]);
    expect(current.sku).toBe('HI0704');
    expect(current.size).toBe('S');
    expect(current._wasSize).toBe('XS');
    expect(current._verify).toBe(false);
    expect(substitutions).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  test('deleted old SKU plus a newly-added replacement line follows the new SKU', () => {
    const source = [{ id: 'hi-1', order_id: 'o1', sku: 'HI0704', name: 'Old Pant', color: 'Black', size: 'XS', qty: 1 }];
    const soItems = [{ sku: 'HI0706', name: 'Replacement Pant', color: 'Black', sizes: { XS: 1 } }];
    const { lines, substitutions, unmatched } = mapLinesToSoItems(source, soItems);
    const current = materializeMappedLine(lines[0]);
    expect(current.sku).toBe('HI0706');
    expect(current.name).toBe('Replacement Pant');
    expect(current.size).toBe('XS');
    expect(current._wasSku).toBe('HI0704');
    expect(current._verify).toBe(false);
    expect(substitutions).toEqual([{ from: 'HI0704', to: 'HI0706 Black', verify: false }]);
    expect(unmatched).toEqual([]);
  });

  test('a unique new line that also changes size is caught and flagged for review', () => {
    const source = [{ id: 'hi-1', order_id: 'o1', sku: 'HI0704', name: 'Old Pant', color: 'Black', size: 'XS', qty: 1 }];
    const soItems = [{ sku: 'HI0706', name: 'Replacement Pant', color: 'Black', sizes: { S: 1 } }];
    const { lines } = mapLinesToSoItems(source, soItems);
    const current = materializeMappedLine(lines[0]);
    expect(current.sku).toBe('HI0706');
    expect(current.size).toBe('S');
    expect(current._wasSku).toBe('HI0704');
    expect(current._wasSize).toBe('XS');
    expect(current._verify).toBe(true);
  });

  test('equally plausible replacement lines are never presented as certain', () => {
    const source = [
      { id: 'a1', order_id: 'o1', sku: 'OLD-A', name: 'Old A', size: 'XS', qty: 1 },
      { id: 'b1', order_id: 'o2', sku: 'OLD-B', name: 'Old B', size: 'XS', qty: 1 },
    ];
    const soItems = [
      { sku: 'NEW-A', name: 'New A', sizes: { XS: 1 } },
      { sku: 'NEW-B', name: 'New B', sizes: { XS: 1 } },
    ];
    const { lines, unmatched } = mapLinesToSoItems(source, soItems);
    expect(unmatched).toEqual([]);
    expect(lines).toHaveLength(2);
    lines.forEach((l) => { expect(l._wasSku).toMatch(/^OLD-/); expect(l._verify).toBe(true); });
  });
});

// The whole store, exactly as SO-2035 and its 42 live orders stand today: 13 store
// products against the SO's 14 lines. Sizes/quantities are the live totals.
describe('mapLinesToSoItems — SO-2035 end to end', () => {
  const STORE = [
    ['mt-1203-005', '1203.005', 'White', { S: 6, M: 1 }],
    ['mt-1203-080', '1203.080', 'Black', { S: 36, M: 12 }],
    ['mt-223322-005', '223322.005', 'White', { XS: 4, S: 2, M: 1 }],
    ['mt-223322-080', '223322.080', 'Black', { S: 3 }],
    ['p-1777323171052-155', '5160078', 'Black/White', { OSFA: 2 }],
    ['p-1777323171052-159', '5161257', 'Black/White', { OSFA: 27 }],
    ['p-1777323171053-160', '5161258', 'White/Black', { OSFA: 6 }],
    ['ssa-A432-00', 'A432-00', 'White', { L: 1 }],
    ['ssa-AT101-00', 'AT101-00', 'White/ Black', { S: 6, M: 2 }],
    ['ssa-AT101-50', 'AT101-50', 'Black/ White', { S: 6, M: 1 }],
    ['ssa-AT101-70', 'AT101-70', 'Team Power Red/ White', { S: 1, M: 1 }],
    ['ssb-IC49MR-00', 'IC49MR-00', 'White', { S: 6, M: 17, L: 2 }],
    ['p-1774969249147-1339', 'KA4117', 'Black', { '2XS': 8, XS: 7, S: 19, M: 7 }],
  ];
  const SO = [
    [null, '1202', 'Momentec Ladies Poly/Spandex Solid Racerback Tank', 'Black', { S: 36, M: 12 }],
    ['mt-1203-005', '1203.005', 'Girls Poly/Spandex Solid Racerback Tank', 'White', { S: 6, M: 1 }],
    ['mt-1203-080', '1203.080', 'Girls Poly/Spandex Solid Racerback Tank', 'Black', { L: 1, M: 0, S: 0 }],
    ['mt-223322-005', '223322.005', 'LADIES COURT SKORT', 'White', { XS: 4, S: 2, M: 1 }],
    ['mt-223322-080', '223322.080', 'LADIES COURT SKORT', 'Black', { S: 3 }],
    ['p-1777323171052-155', '5160078', "Adidas Men's Superlite 4 Team Hat", 'Black/White', { OSFA: 2 }],
    ['p-1777323171052-159', '5161257', "Adidas Men's Superlite 3 Team Visor", 'Black/White', { OSFA: 27 }],
    ['p-1777323171053-160', '5161258', "Adidas Men's Superlite 3 Team Visor", 'White/Black', { OSFA: 6 }],
    ['ssa-A432-00', 'A432-00', 'Adidas Unisex Fleece Hooded Sweatshirt (A432)', 'White', { L: 1 }],
    ['ssa-AT101-00', 'AT101-00', "Adidas Men's Pregame T-Shirt (AT101)", 'White/ Black', { S: 6, M: 2 }],
    ['ssa-AT101-50', 'AT101-50', "Adidas Men's Pregame T-Shirt (AT101)", 'Black/ White', { S: 6, M: 1 }],
    ['ssa-AT101-70', 'AT101-70', "Adidas Men's Pregame T-Shirt (AT101)", 'Team Power Red/ White', { S: 1, M: 1 }],
    ['ssb-IC49MR-00', 'IC49MR-00', 'Gildan Unisex Ultimate CVC Hooded Sweatshirt', 'White', { S: 6, M: 17, L: 2 }],
    ['p-1774969249147-1339', 'KA4117', 'Adidas MATCH SKIRT', 'Black', { '2XS': 8, XS: 7, S: 19, M: 7 }],
  ];
  const storeLines2 = [];
  STORE.forEach(([product_id, sku, color, sizes]) => Object.entries(sizes).forEach(([size, q]) => {
    for (let i = 0; i < q; i++) storeLines2.push({ order_id: sku + size + i, player_name: sku + size + i, product_id, sku, color, size, qty: 1 });
  }));
  const soItems = SO.map(([product_id, sku, name, color, sizes]) => ({ product_id, sku, name, color, sizes }));

  test('only the swapped tank moves; the other twelve products print unchanged', () => {
    const { lines, substitutions, unmatched } = mapLinesToSoItems(storeLines2, soItems);
    expect(lines).toHaveLength(184); // the 184 items the report counts
    expect(substitutions).toEqual([{ from: '1203.080', to: '1202 Black', verify: false }]);
    expect(unmatched).toEqual([]);
    lines.forEach((l) => {
      if (l.sku === '1203.080') { expect(l._sku).toBe('1202'); expect(l._wasSku).toBe('1203.080'); }
      else { expect(l._sku).toBe(l.sku); expect(l._wasSku).toBe(''); }
      expect(l._unmatched).toBeFalsy();
    });
  });
});
