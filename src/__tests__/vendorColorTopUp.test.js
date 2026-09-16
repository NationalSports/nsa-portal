// The webstore color pickers show every colorway a vendor lists for a style, not just the
// ones somebody happened to import into `products` before. Live bug: SanMar lists 19 colors
// for PC55LS while the catalog carried only Jet Black and Royal, so a rep building a store
// could pick two of the nineteen and had no way to reach the rest.
import { pickVendorStyle, missingVendorColorRows, vendorColorKey, canTopUpFromVendor } from '../vendorCatalogSearch';

// The shape searchVendorCatalogs() folds every vendor payload into.
const smStyle = (colors) => ({
  source: 'sm', vendorId: 'v-sanmar', sku: 'PC55LS', brand: 'Port & Co',
  name: 'Port & Co Long Sleeve Core Blend Tee. PC55LS', image: 'style.jpg',
  colors: colors.map((c) => ({ colorName: c, colorCode: c.replace(/\s/g, ''), sku: 'PC55LS', image: c + '.jpg', cost: 4.5, sizes: ['S', 'M', 'L'], totalQty: 100 })),
});

describe('pickVendorStyle', () => {
  const sm = { source: 'sm', sku: 'PC55LS', colors: [] };
  const ss = { source: 'ss', sku: 'PC55LS', colors: [] };

  test('prefers the vendor that actually sources the product', () => {
    expect(pickVendorStyle([ss, sm], 'PC55LS', 'sanmar')).toBe(sm);
    expect(pickVendorStyle([sm, ss], 'PC55LS', 'ss_activewear')).toBe(ss);
  });

  test('falls back to the first exact match for a legacy row with no source recorded', () => {
    expect(pickVendorStyle([ss, sm], 'PC55LS', undefined)).toBe(ss);
    expect(pickVendorStyle([ss, sm], 'PC55LS', null)).toBe(ss);
  });

  test('matches the style code exactly — a different style is never substituted', () => {
    // PC55LS and PC55LST are different garments (regular vs tall); offering the tall
    // style's colors would put the wrong SKU in the store.
    const tall = { source: 'sm', sku: 'PC55LST', colors: [] };
    expect(pickVendorStyle([tall], 'PC55LS', 'sanmar')).toBeNull();
    expect(pickVendorStyle([], 'PC55LS', 'sanmar')).toBeNull();
    expect(pickVendorStyle([sm], '', 'sanmar')).toBeNull();
  });

  test('matching is case- and whitespace-tolerant on the style code', () => {
    expect(pickVendorStyle([{ source: 'sm', sku: ' pc55ls ' }], 'PC55LS', 'sanmar')).toBeTruthy();
  });

  test('never tops up a product synced from a feed the vendor search cannot speak for', () => {
    // An adidas CLICK product whose style code happens to match a SanMar style must not
    // inherit SanMar's colorways — that would put another brand's SKU in the store.
    for (const src of ['click', 'agron', 'ua', 'nike', 'custom', 'manual']) {
      expect(pickVendorStyle([sm, ss], 'PC55LS', src)).toBeNull();
      expect(canTopUpFromVendor(src)).toBe(false);
    }
  });
});

describe('canTopUpFromVendor', () => {
  test('covers the live-searchable vendors, and legacy rows with no source recorded', () => {
    ['sanmar', 'ss_activewear', 'richardson', 'momentec'].forEach((s) => expect(canTopUpFromVendor(s)).toBe(true));
    expect(canTopUpFromVendor(null)).toBe(true);
    expect(canTopUpFromVendor(undefined)).toBe(true);
    expect(canTopUpFromVendor('')).toBe(true);
  });
});

describe('missingVendorColorRows', () => {
  test('returns the colorways the local catalog does not carry yet', () => {
    const style = smStyle(['Jet Black', 'Royal', 'Dark Green', 'Navy', 'Red']);
    const local = [{ id: 'sm-pc55ls-jet-black', color: 'Jet Black' }, { id: 'sm-pc55ls-royal', color: 'Royal' }];
    const rows = missingVendorColorRows(style, local);
    expect(rows.map((r) => r.color)).toEqual(['Dark Green', 'Navy', 'Red']);
  });

  test('tags each row for import and shapes it as a products row', () => {
    const style = smStyle(['Dark Green']);
    const [row] = missingVendorColorRows(style, []);
    expect(row._vendorStyle).toBe(style);
    expect(row._vendorColor.colorName).toBe('Dark Green');
    expect(row.color).toBe('Dark Green');
    expect(row.inventory_source).toBe('sanmar');
    expect(row.vendor_id).toBe('v-sanmar');
    expect(row.sku).toBe('PC55LS-DARKGREEN');
    expect(row.available_sizes).toEqual(['S', 'M', 'L']);
  });

  test('carries the live per-color stock, since nothing has synced these colors yet', () => {
    // fetchStockMap reads the SYNCED vendor tables and has no rows for a colorway that was
    // never imported — without this the picker would show every new color as "Out of stock"
    // and the in-stock filter would hide all of them.
    const style = smStyle(['Dark Green']);
    style.colors[0].totalQty = 4500;
    const [row] = missingVendorColorRows(style, []);
    expect(row._stock).toEqual({ units: 4500, sizes: ['S', 'M', 'L'], incoming: false });
  });

  test('de-duplicates across the spelling differences SanMar returns between feeds', () => {
    // SanMar returns two-tone colors with inconsistent spacing ("True Royal/ White" vs
    // "True Royal/White"); a plain lowercase compare offers a duplicate of a color the
    // store already has, and adding it would create a second product for one garment.
    const style = smStyle(['True Royal/ White', 'Navy']);
    const rows = missingVendorColorRows(style, [{ id: 'x', color: 'True Royal/White' }]);
    expect(rows.map((r) => r.color)).toEqual(['Navy']);
  });

  test('drops a vendor colorway that repeats within the same style', () => {
    const style = smStyle(['Navy', 'NAVY']);
    expect(missingVendorColorRows(style, [])).toHaveLength(1);
  });

  test('skips unnamed colors and tolerates a style the vendor does not list', () => {
    expect(missingVendorColorRows(null, [])).toEqual([]);
    expect(missingVendorColorRows(smStyle(['']), [])).toEqual([]);
    expect(missingVendorColorRows({ source: 'sm', sku: 'PC55LS' }, [])).toEqual([]);
  });

  test('a local row with no color never masks a real vendor colorway', () => {
    // Caps and sublimated jerseys carry the color in the SKU and leave `color` blank; an
    // empty key must not swallow the vendor's named colors.
    const rows = missingVendorColorRows(smStyle(['Navy']), [{ id: 'x', color: '' }, { id: 'y', color: null }]);
    expect(rows.map((r) => r.color)).toEqual(['Navy']);
  });
});

describe('vendorColorKey', () => {
  test('normalizes case, spacing and punctuation', () => {
    expect(vendorColorKey('True Royal/ White')).toBe(vendorColorKey('true royal/white'));
    expect(vendorColorKey('Dark Green')).toBe('DARKGREEN');
    expect(vendorColorKey(null)).toBe('');
  });
});
