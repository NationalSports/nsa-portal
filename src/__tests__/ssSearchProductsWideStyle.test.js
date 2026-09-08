// Unit tests for ssSearchProducts — the order modal's manual "🔍 find SKU" picker.
//
// Real failure this locks in (PO NSA 4643, line 12 — Rabbit Skins 3321 Toddler Fine Jersey
// Tee, Rouge, 5/6): the picker found the right STYLE but its color list stopped in the B's
// (…Blush, Brown Leopard) and never reached Rouge, so the rep had no way to complete the
// line. 3321 carries 105 colors × 5 sizes = 525 product rows and the picker capped the list
// at the first 80 it happened to read — the cap, not the match, decided what the rep saw.
//
// Two guarantees here: (1) a wide style's rows are ranked by the line's own color+size BEFORE
// any cap, so the wanted row can never be the one that got cut; (2) a query that names a
// style exactly doesn't spend the budget on other styles S&S's fuzzy search also returned.

jest.mock('../utils', () => ({ authFetch: jest.fn() }));
jest.mock('../components', () => ({ calcSOStatus: () => ({}), resolveOrderShipTo: () => ({}) }));
jest.mock('../richardsonPrices', () => ({ getRichardsonLevel4Price: () => 0 }));

const { authFetch } = require('../utils');
const { ssSearchProducts } = require('../vendorApis');

const ok = (body) => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

const pathOf = (url) => decodeURIComponent(String(url).split('path=')[1] || '');

// Rabbit Skins 3321, as S&S returns it: alphabetical colorways, five toddler sizes each.
// Rouge sits deep in the R's — row ~400 of 525 — which is exactly why an early cut lost it.
const SIZES = ['2T', '3T', '4T', '5/6', '7'];
const COLORS = [
  'Apple', 'Aqua', 'Arctic', 'Ash', 'Ballerina', 'Bamboo Blackout', 'Basil', 'Bermuda Blackout',
  'Black', 'Black Leopard', 'Black Reptile', 'Blended Black', 'Blended White', 'Blush',
  'Brown Leopard', 'Brown Reptile', 'Butter', 'Canyon', 'Cardinal Blackout', 'Caribbean',
  'Carolina Blue', 'Charcoal', 'Chill', 'Cobalt', 'Coyote Brown', 'Denim', 'Forest', 'Garnet',
  'Gold', 'Granite Heather', 'Green Reptile', 'Heather', 'Honeydew', 'Hot Pink', 'Indigo',
  'Kelly', 'Key Lime', 'Latte', 'Lavender', 'Light Blue', 'Marine Stripe', 'Maroon', 'Mauvelous',
  'Military Green', 'Mustard', 'Natural', 'Navy', 'Oceanside', 'Olive Branch', 'Orange',
  'Orchid', 'Papaya', 'Passionfruit', 'Peachy', 'Pink', 'Porcelain', 'Pro Purple', 'Purple',
  'Raspberry', 'Red', 'Rouge', 'Royal', 'Sage', 'Saltwater', 'Silver', 'Slate', 'Storm Camo',
  'Sunset', 'Texas Orange', 'Titanium', 'Tradewind', 'Turquoise', 'Vintage Denim',
  'Vintage Green', 'Vintage Red', 'White', 'Yellow',
];
const PRODUCTS_3321 = [];
let n = 30000;
for (const color of COLORS) {
  for (const size of SIZES) {
    PRODUCTS_3321.push({ sku: 'B318' + (n += 1), styleName: '3321', brandName: 'Rabbit Skins', colorName: color, sizeName: size, customerPrice: '3.20', qty: 12 });
  }
}

// S&S's /Styles?search=3321 is fuzzy: the real style plus anything else carrying the digits.
const STYLES_3321 = [
  { styleID: 99001, partNumber: '3321JR', styleName: '3321JR', brandName: 'Other Brand' },
  { styleID: 12345, partNumber: '3321', styleName: '3321', brandName: 'Rabbit Skins' },
];

const DECOY_PRODUCTS = COLORS.slice(0, 20).flatMap((color) => SIZES.map((size, i) => (
  { sku: 'DECOY' + color.replace(/\W/g, '') + i, styleName: '3321JR', brandName: 'Other Brand', colorName: color, sizeName: size, customerPrice: '9.99', qty: 1 }
)));

beforeEach(() => { jest.clearAllMocks(); });

const mockSS = ({ styles = STYLES_3321 } = {}) => {
  authFetch.mockImplementation((url) => {
    const p = pathOf(url);
    if (p.startsWith('/Styles?search=')) return ok(styles);
    if (p.startsWith('/Products/?style=')) {
      const ids = p.split('style=')[1].split(',');
      let out = [];
      if (ids.includes('12345')) out = out.concat(PRODUCTS_3321);
      if (ids.includes('99001')) out = out.concat(DECOY_PRODUCTS);
      return ok(out);
    }
    return ok([]);
  });
};

describe('ssSearchProducts — a wide style never loses the ordered colorway', () => {
  test('3321 · Rouge · 5/6 is returned and ranked first', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6' });

    // The exact row the rep needs is present…
    const rouge = rows.filter((r) => r.color === 'Rouge');
    expect(rouge.length).toBe(SIZES.length);
    // …and it leads the list instead of sitting past a cap.
    expect(rows[0].color).toBe('Rouge');
    expect(rows[0].size).toBe('5/6');
    expect(rows[0].sku).toMatch(/^B318/);
  });

  test('the full colorway range comes back, not just the A–B head of the list', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6' });
    const colors = new Set(rows.map((r) => r.color));
    expect(colors.size).toBe(COLORS.length);
    // The colors the old 80-row cut reached, and several it never did.
    for (const c of ['Blush', 'Brown Leopard', 'Navy', 'Rouge', 'Royal', 'White', 'Yellow']) {
      expect(colors.has(c)).toBe(true);
    }
  });

  test('an exact style hit is not diluted by other styles the fuzzy search returned', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6' });
    expect(rows.some((r) => r.style === '3321JR')).toBe(false);
    const fetched = authFetch.mock.calls.map((c) => pathOf(c[0])).filter((p) => p.startsWith('/Products/?style='));
    expect(fetched).toEqual(['/Products/?style=12345']);
  });

  test('with no exact hit it still searches the fuzzy matches', async () => {
    mockSS({ styles: [{ styleID: 99001, partNumber: '3321JR', styleName: '3321JR' }] });
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.style === '3321JR')).toBe(true);
  });

  test('rows are deduped by sku and keep catalog order within a rank band', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6' });
    expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);
    // Other Rouge sizes rank above non-Rouge rows, in S&S's own size order.
    expect(rows.slice(0, SIZES.length).map((r) => r.size)).toEqual(['5/6', '2T', '3T', '4T', '7']);
  });

  test('a size-only line still floats its size to the top', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: '', size: '5/6' });
    expect(rows[0].size).toBe('5/6');
    expect(rows.filter((r) => r.color === 'Rouge').length).toBe(SIZES.length);
  });

  test('a cap, when it bites, cuts the irrelevant tail — never the match', async () => {
    mockSS();
    const rows = await ssSearchProducts('3321', { color: 'Rouge', size: '5/6', limit: 10 });
    expect(rows.length).toBe(10);
    expect(rows[0].color).toBe('Rouge');
    expect(rows[0].size).toBe('5/6');
  });

  test('a query under two characters makes no API call', async () => {
    mockSS();
    expect(await ssSearchProducts('3')).toEqual([]);
    expect(authFetch).not.toHaveBeenCalled();
  });
});
