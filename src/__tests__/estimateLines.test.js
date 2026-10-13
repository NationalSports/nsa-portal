/**
 * AI lines → estimate items, shared by the AI inbox and AI Notes ("Start estimate").
 */
import { linesToEstimateItems, noteEstimateLines } from '../estimateLines';

const prod = [
  { id: 'p1', sku: 'ST350', name: 'Sport-Tek PosiCharge Tee', brand: 'Sport-Tek', color: 'Black', nsa_cost: 4, retail_price: 12, available_sizes: ['S', 'M', 'L'], vendor_id: 'v1', pricing_group: null },
  { id: 'p2', sku: '', name: 'Blank-SKU product', brand: 'X', nsa_cost: 9 },
];

describe('linesToEstimateItems', () => {
  test('a matched style is priced at the account markup; an unmatched one keeps the AI guess and is flagged custom', () => {
    const items = linesToEstimateItems({ catalog_markup: 2 }, [
      { sku_guess: 'st350', name: 'tee', sizes: { M: 10, L: 5 }, notes: 'Left chest logo' },
      { sku_guess: 'ABC123', brand: 'Nike', name: 'Polo', color: 'Navy', sizes: {} },
      { name: 'Hoodie', sizes: {} },
    ], prod);
    expect(items[0]).toMatchObject({ product_id: 'p1', sku: 'ST350', name: 'Sport-Tek PosiCharge Tee', unit_sell: 8, nsa_cost: 4, sizes: { M: 10, L: 5 }, available_sizes: ['M', 'L'], is_custom: false, notes: 'Left chest logo' });
    expect(items[1]).toMatchObject({ product_id: null, sku: 'ABC123', brand: 'Nike', color: 'Navy', is_custom: true, available_sizes: ['S', 'M', 'L', 'XL', '2XL'] });
    // No style number at all must not match a catalog row that happens to have a blank SKU.
    expect(items[2]).toMatchObject({ product_id: null, sku: '', name: 'Hoodie', is_custom: true });
  });
});

describe('noteEstimateLines', () => {
  test('uses the approved lines, keeps size breakdowns, and notes decoration and unsized totals', () => {
    const note = { final: { line_items: [
      { name: 'Hoodie', brand: 'Champion', sku_guess: 'S700', color: 'Grey', quantity: 40, sizes: {}, decoration: 'Front screen print' },
      { name: 'Tee', quantity: 30, sizes: { S: 10, M: 20 } },
      { name: '', quantity: 5 },
    ] } };
    expect(noteEstimateLines(note)).toEqual([
      { sku_guess: 'S700', brand: 'Champion', name: 'Hoodie', color: 'Grey', sizes: {}, notes: 'Front screen print · 40 total, sizes to confirm' },
      { sku_guess: '', brand: '', name: 'Tee', color: '', sizes: { S: 10, M: 20 }, notes: '' },
    ]);
  });

  test('falls back to the draft when the approved note has no lines', () => {
    expect(noteEstimateLines({ final: { headline: 'x' }, draft: { line_items: [{ name: 'Cap' }] } })).toHaveLength(1);
    expect(noteEstimateLines({ final: {} })).toEqual([]);
  });
});
