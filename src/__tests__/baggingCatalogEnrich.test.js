/** @jest-environment node */

/* What the packer sees on a bag line (netlify/functions/bagging-api.js).
 *
 * Two kinds of store feed the station and neither gives a line everything:
 * OMG imports arrive with name and image_url NULL and a sku that is the style
 * and color mashed together; native team stores never composite a mockup photo
 * at all, they store the artwork and where it goes. These pin how a line's
 * picture is resolved — and above all that a shared stock catalog photo is
 * never passed off as this line's mockup, because the same garment in two
 * logos shares exactly one catalog photo. */
const { enrichItems, pickDecoration } = require('../../netlify/functions/bagging-api');

// Supabase stub over several tables; .in(col, values) filters the named table.
function fakeSb(tables) {
  return {
    from(table) {
      let col = null; let vals = [];
      const chain = {
        select: () => chain,
        in: (c, v) => { col = c; vals = v; return chain; },
        then: (resolve, reject) => Promise.resolve({
          data: (tables[table] || []).filter((r) => vals.includes(r[col])), error: null,
        }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const ACADEMY = {
  side: 'front', placement: 'left_chest', color_label: 'Full Color PREFERRED   Academy',
  art_url: 'https://art/academy-dark.png',
  cw_by_color: { 'true navy': { url: 'https://art/academy-navy.png' } },
};
const COUGAR_HEAD = { side: 'front', placement: 'full_front', color_label: 'Cougar Head', art_url: 'https://art/cougar-head.png' };
const COUGARS_FB = { side: 'front', placement: 'full_front', color_label: 'Cougars Football', art_url: 'https://art/cougars-fb.png' };

const TABLES = {
  products: [
    { id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', name: 'New Era Tee. NEA200', color: 'True Navy', image_front_url: 'https://catalog/nea200-navy.jpg' },
    { id: 'smb-ST485-Black', sku: 'ST485', name: 'Sport-Tek Repeat Short', color: 'Black', image_front_url: 'https://catalog/st485-black.jpg' },
    { id: 'smb-ST485-IronGrey', sku: 'ST485', name: 'Sport-Tek Repeat Short', color: 'Iron Grey', image_front_url: 'https://catalog/st485-grey.jpg' },
  ],
  webstore_products: [
    { store_id: 'st1', product_id: 'smb-NEA200-TrueNavy', display_name: null, image_url: null, decorations: [ACADEMY] },
    { store_id: 'st1', product_id: 'smb-HOOD-A', display_name: 'Fleece Hood', image_url: null, decorations: [COUGAR_HEAD] },
    { store_id: 'st1', product_id: 'smb-HOOD-B', display_name: 'Fleece Hood', image_url: null, decorations: [COUGARS_FB] },
  ],
};

const order = (items, storeId = 'st1') => [{ store_id: storeId, webstore_order_items: items }];

describe('pickDecoration', () => {
  test('takes the front artwork and the colorway matching the garment color', () => {
    expect(pickDecoration([ACADEMY], 'True Navy')).toMatchObject({
      art: 'https://art/academy-navy.png', label: 'Full Color PREFERRED Academy', placement: 'left_chest',
    });
    // no colorway for this color — the decoration's own artwork stands
    expect(pickDecoration([ACADEMY], 'White').art).toBe('https://art/academy-dark.png');
  });

  test('prefers a front decoration over a back one, and reports how many there are', () => {
    const back = { side: 'back', color_label: 'Back print', art_url: 'https://art/back.png' };
    expect(pickDecoration([back, COUGAR_HEAD], 'Black')).toMatchObject({ art: 'https://art/cougar-head.png', count: 2 });
  });

  test('nothing to show is null, not an empty shell', () => {
    expect(pickDecoration(null, 'Black')).toBeNull();
    expect(pickDecoration([], 'Black')).toBeNull();
    expect(pickDecoration([{ side: 'front' }], 'Black')).toBeNull();
  });
});

describe('image precedence', () => {
  test('the line’s own picture is the mockup and is never replaced', async () => {
    const i = { product_id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', color: 'True Navy', name: 'Tee', image_url: 'https://omg/mockup.png' };
    await enrichItems(fakeSb(TABLES), order([i]));
    expect(i.image_url).toBe('https://omg/mockup.png');
    expect(i._image_kind).toBe('mockup');
  });

  test('a native store with no mockup falls back to its logo artwork, not a blank photo', async () => {
    const i = { product_id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', color: 'True Navy', name: null, image_url: null };
    await enrichItems(fakeSb(TABLES), order([i]));
    expect(i.image_url).toBe('https://art/academy-navy.png');
    expect(i._image_kind).toBe('logo');
    expect(i._logo).toMatchObject({ label: 'Full Color PREFERRED Academy', placement: 'left_chest' });
    expect(i.name).toBe('New Era Tee. NEA200'); // still named from the catalog
  });

  test('a stock catalog photo is used only as a last resort AND says so', async () => {
    // no store product for this line, so nothing store-specific exists
    const i = { product_id: 'smb-ST485-IronGrey', sku: 'ST485', color: 'Iron Grey', name: null, image_url: null };
    await enrichItems(fakeSb(TABLES), order([i]));
    expect(i.image_url).toBe('https://catalog/st485-grey.jpg');
    expect(i._image_kind).toBe('stock'); // the screen dims it and labels it
  });

  test('an ambiguous sku fills the name but never guesses a colorway photo', async () => {
    const i = { product_id: null, sku: 'ST485', color: null, name: null, image_url: null };
    await enrichItems(fakeSb(TABLES), order([i]));
    expect(i.name).toBe('Sport-Tek Repeat Short');
    expect(i.color).toBeNull();
    expect(i.image_url).toBeNull();
    expect(i._image_kind).toBeUndefined();
  });
});

test('the same garment in two logos gets two different pictures and two logo names', async () => {
  const head = { product_id: 'smb-HOOD-A', sku: 'HR8473', color: 'Black', name: null, image_url: null };
  const foot = { product_id: 'smb-HOOD-B', sku: 'HR8473', color: 'Black', name: null, image_url: null };
  await enrichItems(fakeSb(TABLES), order([head, foot]));
  expect(head.image_url).not.toBe(foot.image_url);
  expect(head._logo.label).toBe('Cougar Head');
  expect(foot._logo.label).toBe('Cougars Football');
});

test('an unknown product is left exactly as it was', async () => {
  const i = { product_id: 'smb-NOPE', sku: 'NOPE', color: null, name: null, image_url: null };
  await enrichItems(fakeSb(TABLES), order([i]));
  expect(i.name).toBeNull();
  expect(i.image_url).toBeNull();
});

test('lines with nothing missing make no catalog call at all', async () => {
  const sb = { from() { throw new Error('should not query'); } };
  const i = { product_id: 'x', sku: 'y', color: 'Black', name: 'Tee', image_url: 'https://img/x.jpg' };
  await expect(enrichItems(sb, order([i]))).resolves.toBeTruthy();
  expect(i._image_kind).toBe('mockup');
});

test('the store id is never leaked onto the order line', async () => {
  const i = { product_id: 'smb-NEA200-TrueNavy', sku: 'NEA200-TrueNavy', color: 'True Navy', name: null, image_url: null };
  await enrichItems(fakeSb(TABLES), order([i]));
  expect(i._store_id).toBeUndefined();
});
