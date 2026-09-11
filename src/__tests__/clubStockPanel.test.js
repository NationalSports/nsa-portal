import { buildStockSections, stripClubPrefix } from '../ClubStockPanel';
import { scaleOfSizes, columnsFor, ONE_SIZE } from '../lib/sizeScales';

// A slice of the real Encinitas pool: the two size scales plus a one-size item,
// including the two sizes that are carried but out of stock.
const PRODUCTS = [
  { id: 'p1', sku: 'JD7371-EXP-N', name: 'Encinitas Express — Adult Jersey', color: 'Navy', category: 'Jersey', available_sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'p2', sku: 'KB4037-EXP', name: 'Encinitas Express — Womens Jacket', color: 'Navy', category: 'Outerwear', available_sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'p3', sku: 'JD7373-EXP-N', name: 'Encinitas Express — Youth Jersey', color: 'Navy', category: 'Jersey', available_sizes: ['YXS', 'YS', 'YM', 'YL', 'YXL'] },
  { id: 'p4', sku: 'HT6546-EXP', name: 'Encinitas Express — Team Sleeve Sock', color: 'Navy', category: 'Sport Accessories', available_sizes: ['OSFA'] },
];
const INV = {
  p1: { S: 34, M: 17, L: 6, XL: 4 },
  p2: { S: 7, M: 9, L: 0, XL: 2 },       // L carried but out
  p3: { YXS: 2, YS: 20, YM: 6, YL: 24, YXL: 25 },
  p4: { OSFA: 158 },
};

describe('size scales', () => {
  it('routes each product to the right grid', () => {
    expect(scaleOfSizes(['S', 'M', 'L'])).toBe('adult');
    expect(scaleOfSizes(['YXS', 'YS'])).toBe('youth');
    expect(scaleOfSizes(['OSFA'])).toBe('one');
    expect(scaleOfSizes([])).toBe('adult');
  });

  it('keeps one-size labels off the adult grid columns', () => {
    ONE_SIZE.forEach((s) => expect(columnsFor('adult', ['S', s])).not.toContain(s));
  });

  it('orders columns by the scale, not by first appearance', () => {
    expect(columnsFor('adult', ['XL', 'S', 'M'])).toEqual(['S', 'M', 'XL']);
    expect(columnsFor('youth', ['YXL', 'YXS'])).toEqual(['YXS', 'YXL']);
  });

  it('still shows a size the master list has never heard of', () => {
    expect(columnsFor('adult', ['S', 'WEIRD'])).toEqual(['S', 'WEIRD']);
  });
});

describe('stripClubPrefix', () => {
  it('drops the club name so the panel is not a wall of repetition', () => {
    expect(stripClubPrefix('Encinitas Express — Adult Jersey', 'Encinitas Express')).toBe('Adult Jersey');
  });
  // Caught on the real data: the customer record is "Encinitas Express Soccer"
  // while every product is named "Encinitas Express — …", so an exact-match strip
  // left the prefix on all 33 rows.
  it('strips when the account name carries extra trailing words', () => {
    expect(stripClubPrefix('Encinitas Express — Adult Jersey', 'Encinitas Express Soccer')).toBe('Adult Jersey');
  });
  it('strips when the product name carries the extra words instead', () => {
    expect(stripClubPrefix('Encinitas Express Soccer — Adult Jersey', 'Encinitas Express')).toBe('Adult Jersey');
  });
  it('leaves other names alone', () => {
    expect(stripClubPrefix('Adidas Tiro Pant', 'Encinitas Express')).toBe('Adidas Tiro Pant');
  });
  it('does not strip a different club that merely shares a first word', () => {
    expect(stripClubPrefix('Encinitas Rovers — Shorts', 'Encinitas Express')).toBe('Encinitas Rovers — Shorts');
  });
  it('leaves a hyphenated product name that is not a club prefix intact', () => {
    expect(stripClubPrefix('Dri-Fit Tee', 'Encinitas Express')).toBe('Dri-Fit Tee');
  });
  it('never returns an empty label', () => {
    expect(stripClubPrefix('Encinitas Express', 'Encinitas Express')).toBe('Encinitas Express');
  });
  it('survives a club name with regex characters in it', () => {
    expect(stripClubPrefix('A+B (West) — Shorts', 'A+B (West)')).toBe('Shorts');
  });
});

describe('buildStockSections', () => {
  const sections = buildStockSections(PRODUCTS, INV, 'Encinitas Express');
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));

  it('splits the two size scales and the one-size items apart', () => {
    expect(sections.map((s) => s.key)).toEqual(['adult', 'youth', 'one']);
    expect(byKey.adult.rows).toHaveLength(2);
    expect(byKey.youth.rows).toHaveLength(1);
    expect(byKey.one.rows).toHaveLength(1);
  });

  it('totals each row from its inventory', () => {
    const jersey = byKey.adult.rows.find((r) => r.sku === 'JD7371-EXP-N');
    expect(jersey.total).toBe(61);
    expect(byKey.youth.rows[0].total).toBe(77);
    expect(byKey.one.rows[0].total).toBe(158);
  });

  it('gives the one-size grid no size columns', () => {
    expect(byKey.one.cols).toEqual([]);
  });

  it('keeps a carried-but-empty size as a real 0, not a missing column', () => {
    const jacket = byKey.adult.rows.find((r) => r.sku === 'KB4037-EXP');
    expect(byKey.adult.cols).toContain('L');
    expect(jacket.sizes).toContain('L');
    expect(jacket.inv.L).toBe(0);
  });

  it('falls back to the inventory keys when a product declares no scale', () => {
    const [only] = buildStockSections(
      [{ id: 'x', sku: 'X', name: 'X', category: 'Jersey', available_sizes: [] }],
      { x: { M: 3 } }, 'Club');
    expect(only.rows[0].sizes).toEqual(['M']);
    expect(only.rows[0].total).toBe(3);
  });

  it('drops empty sections rather than rendering an empty grid', () => {
    const s = buildStockSections([PRODUCTS[3]], { p4: INV.p4 }, 'Encinitas Express');
    expect(s.map((x) => x.key)).toEqual(['one']);
  });

  it('handles a product with no inventory rows at all', () => {
    const s = buildStockSections([PRODUCTS[0]], {}, 'Encinitas Express');
    expect(s[0].rows[0].total).toBe(0);
  });
});
