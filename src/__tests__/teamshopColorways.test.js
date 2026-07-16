import {
  groupByStyle, primaryColorToken, familyForVariant, familyForToken, COLOR_FAMILIES,
} from '../teamshop/colorways';

describe('groupByStyle', () => {
  test('groups identical (brand, name) rows into one style, preserving first-seen order', () => {
    const rows = [
      { id: '1', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Navy/White', sku: 'A1' },
      { id: '2', brand: 'Nike', name: 'Dri-FIT Polo', color: 'Black', sku: 'N1' },
      { id: '3', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Power Red/White', sku: 'A2' },
      { id: '4', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Athletic Gold/White', sku: 'A3' },
    ];
    const groups = groupByStyle(rows);
    expect(groups).toHaveLength(2);
    // First-seen order: Adidas style first, Nike second.
    expect(groups[0].brand).toBe('Adidas');
    expect(groups[0].name).toBe('3 Stripe LS 1/4 ZIP');
    expect(groups[0].variants).toHaveLength(3);
    expect(groups[1].brand).toBe('Nike');
    expect(groups[1].variants).toHaveLength(1);
  });

  test('variants within a group are sorted by color name', () => {
    const rows = [
      { id: '1', brand: 'Adidas', name: 'Polo', color: 'White' },
      { id: '2', brand: 'Adidas', name: 'Polo', color: 'Navy' },
      { id: '3', brand: 'Adidas', name: 'Polo', color: 'Black' },
    ];
    const [group] = groupByStyle(rows);
    expect(group.variants.map((v) => v.color)).toEqual(['Black', 'Navy', 'White']);
  });

  test('is case/whitespace-insensitive on brand+name so formatting quirks do not split a style', () => {
    const rows = [
      { id: '1', brand: 'Adidas', name: 'Polo', color: 'Navy' },
      { id: '2', brand: ' adidas ', name: ' POLO ', color: 'Black' },
    ];
    const groups = groupByStyle(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
  });

  test('rows with no color sort last, and empty input yields no groups', () => {
    const rows = [
      { id: '1', brand: 'Adidas', name: 'Polo', color: 'Navy' },
      { id: '2', brand: 'Adidas', name: 'Polo', color: null },
    ];
    const [group] = groupByStyle(rows);
    expect(group.variants.map((v) => v.id)).toEqual(['1', '2']);
    expect(groupByStyle([])).toEqual([]);
  });
});

describe('primaryColorToken', () => {
  test('takes the first, lowercased segment before a slash', () => {
    expect(primaryColorToken('Power Red/White')).toBe('power red');
    expect(primaryColorToken('Navy/White')).toBe('navy');
    expect(primaryColorToken('Black')).toBe('black');
  });

  test('handles missing/empty input', () => {
    expect(primaryColorToken(null)).toBe('');
    expect(primaryColorToken(undefined)).toBe('');
    expect(primaryColorToken('')).toBe('');
  });
});

describe('familyForToken / familyForVariant', () => {
  test('maps known aliases to their canonical family', () => {
    expect(familyForToken('power red')).toBe('red');
    expect(familyForToken('team red')).toBe('red');
    expect(familyForToken('athletic gold')).toBe('gold');
    expect(familyForToken('vegas gold')).toBe('gold');
    expect(familyForToken('team green')).toBe('green');
    expect(familyForToken('dark green')).toBe('green');
    expect(familyForToken('forest')).toBe('green');
    expect(familyForToken('bright orange')).toBe('orange');
    expect(familyForToken('navy')).toBe('navy');
    expect(familyForToken('white')).toBe('white');
  });

  test('maroon is its own family, never folded into red', () => {
    expect(familyForToken('maroon')).toBe('maroon');
  });

  test('unknown tokens fall back to other', () => {
    expect(familyForToken('sparkle unicorn')).toBe('other');
    expect(familyForToken('')).toBe('other');
  });

  test('familyForVariant reads products.color, never color_category', () => {
    // color_category is unreliable in live data (says 'White' for every
    // colorway of a style) — the real signal is products.color.
    const row = { color: 'Power Red/White', color_category: 'White' };
    expect(familyForVariant(row)).toBe('red');

    const row2 = { color: 'Athletic Gold/White', color_category: 'White' };
    expect(familyForVariant(row2)).toBe('gold');

    const row3 = { color: 'team green/White', color_category: 'White' };
    expect(familyForVariant(row3)).toBe('green');

    const row4 = { color: 'Some Weird Custom Color', color_category: 'White' };
    expect(familyForVariant(row4)).toBe('other');
  });

  test('every COLOR_FAMILIES entry has a key, label, and hex', () => {
    COLOR_FAMILIES.forEach((f) => {
      expect(typeof f.key).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(f.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

describe('filter semantics (group kept if any variant matches a selected family)', () => {
  const rows = [
    { id: '1', brand: 'Adidas', name: '1/4 Zip', color: 'Navy/White' },
    { id: '2', brand: 'Adidas', name: '1/4 Zip', color: 'Power Red/White' },
    { id: '3', brand: 'Adidas', name: '1/4 Zip', color: 'Athletic Gold/White' },
    { id: '4', brand: 'Nike', name: 'Polo', color: 'Black' },
  ];
  const groups = groupByStyle(rows);

  const groupHasFamily = (group, families) => (
    !families.length || group.variants.some((v) => families.includes(familyForVariant(v)))
  );

  test('a group is kept if ANY variant matches a selected family', () => {
    expect(groupHasFamily(groups[0], ['red'])).toBe(true); // 1/4 Zip has a red variant
    expect(groupHasFamily(groups[1], ['red'])).toBe(false); // Nike Polo has none
  });

  test('with no families selected, every group is kept', () => {
    expect(groupHasFamily(groups[0], [])).toBe(true);
    expect(groupHasFamily(groups[1], [])).toBe(true);
  });

  test('non-matching variants within a kept group are identifiable for greying out', () => {
    const selected = ['red'];
    // Variants are sorted by color string: 'Athletic Gold/White', 'Navy/White', 'Power Red/White'.
    const matchFlags = groups[0].variants.map((v) => selected.includes(familyForVariant(v)));
    expect(matchFlags).toEqual([false, false, true]);
  });
});
