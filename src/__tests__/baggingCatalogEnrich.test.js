/** @jest-environment node */

/* Catalog backfill for bag lines (netlify/functions/bagging-api.js).
 *
 * OMG store orders import with name and image_url NULL and a sku that is the
 * style and color mashed together, so the Bagging Station could only show
 * "NEA200-TrueNavy" and the packer had to cross-reference a printed player
 * order report. These pin the backfill — and, more importantly, pin that it
 * refuses to guess: a bare sku spanning several colorways must never put
 * another color's mockup on the packer's screen. */
const { enrichItems } = require('../../netlify/functions/bagging-api');

// Minimal supabase stub: one table ('products'), .in(col, values) filters it.
function fakeSb(products) {
  return {
    from() {
      let col = null; let vals = [];
      const chain = {
        select: () => chain,
        in: (c, v) => { col = c; vals = v; return chain; },
        then: (resolve, reject) => Promise.resolve({
          data: products.filter((p) => vals.includes(p[col])), error: null,
        }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const CATALOG = [
  { id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', name: 'New Era Tee. NEA200', color: 'True Navy', image_front_url: 'https://img/navy.jpg' },
  { id: 'smb-ST485-Black', sku: 'ST485', name: 'Sport-Tek Repeat Short', color: 'Black', image_front_url: 'https://img/st485-black.jpg' },
  { id: 'smb-ST485-IronGrey', sku: 'ST485', name: 'Sport-Tek Repeat Short', color: 'Iron Grey', image_front_url: 'https://img/st485-grey.jpg' },
];

const order = (items) => [{ webstore_order_items: items }];

test('fills the garment name and mockup from the line’s own catalog product', async () => {
  const item = { product_id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', color: null, name: null, image_url: null };
  await enrichItems(fakeSb(CATALOG), order([item]));
  expect(item.name).toBe('New Era Tee. NEA200');
  expect(item.color).toBe('True Navy');
  expect(item.image_url).toBe('https://img/navy.jpg');
});

test('a bare sku picks the colorway that matches the line, not the first row', async () => {
  const item = { product_id: null, sku: 'ST485', color: 'Iron Grey', name: null, image_url: null };
  await enrichItems(fakeSb(CATALOG), order([item]));
  expect(item.name).toBe('Sport-Tek Repeat Short');
  expect(item.image_url).toBe('https://img/st485-grey.jpg');
});

test('an ambiguous sku fills the name but never guesses a color or a photo', async () => {
  const item = { product_id: null, sku: 'ST485', color: null, name: null, image_url: null };
  await enrichItems(fakeSb(CATALOG), order([item]));
  expect(item.name).toBe('Sport-Tek Repeat Short'); // every colorway shares it
  expect(item.color).toBeNull();
  expect(item.image_url).toBeNull();
});

test('never overwrites what the order line already recorded', async () => {
  const item = { product_id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', color: 'Navy (custom)', name: 'Coach’s Tee', image_url: null };
  await enrichItems(fakeSb(CATALOG), order([item]));
  expect(item.name).toBe('Coach’s Tee');
  expect(item.color).toBe('Navy (custom)');
  expect(item.image_url).toBe('https://img/navy.jpg'); // only the gap is filled
});

test('lines with nothing missing make no catalog call at all', async () => {
  const sb = { from() { throw new Error('should not query'); } };
  const item = { product_id: 'x', sku: 'y', color: 'Black', name: 'Tee', image_url: 'https://img/x.jpg' };
  await expect(enrichItems(sb, order([item]))).resolves.toBeTruthy();
});

test('an unknown product is left exactly as it was', async () => {
  const item = { product_id: 'smb-NOPE', sku: 'NOPE', color: null, name: null, image_url: null };
  await enrichItems(fakeSb(CATALOG), order([item]));
  expect(item.name).toBeNull();
  expect(item.image_url).toBeNull();
});
