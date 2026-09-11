/* buildProductIndex (src/lib/productIndex.js).
 *
 * Both order editors resolved an item's catalog row with
 *   products.find(p => p.id === x.product_id || p.sku === x.sku)
 * once per SIZE CELL of every line, a linear scan of the ~10.6k-row client catalog each time
 * (~11ms per render on a 10-line order, ~41ms at 40 lines). The index does it in ~0.1ms.
 *
 * The index is only safe if it is a FAITHFUL stand-in for Array.prototype.find, which returns the
 * first element matching EITHER key. The subtle case is an item whose product_id and sku resolve
 * to DIFFERENT rows: find() returns whichever comes first in the array, so this is deliberately
 * NOT "look up by id, else by sku". These tests pin that against the real find().
 */
const { buildProductIndex } = require('../lib/productIndex');

// The exact expression the editors used before the change.
const realFind = (products, x) => products.find((p) => p.id === x.product_id || p.sku === x.sku);

describe('buildProductIndex', () => {
  test('matches Array.find for plain id and sku hits', () => {
    const products = [{ id: 'p1', sku: 'A' }, { id: 'p2', sku: 'B' }, { id: 'p3', sku: 'C' }];
    const find = buildProductIndex(products);
    for (const x of [{ product_id: 'p2' }, { sku: 'C' }, { product_id: 'p1', sku: 'A' }]) {
      expect(find(x)).toBe(realFind(products, x));
    }
  });

  test('when id and sku hit DIFFERENT rows, the earlier row wins (as find does)', () => {
    // sku 'X' is at index 0, id 'p9' at index 2 — find() returns index 0, not the id match.
    const products = [{ id: 'p1', sku: 'X' }, { id: 'p2', sku: 'B' }, { id: 'p9', sku: 'C' }];
    const x = { product_id: 'p9', sku: 'X' };
    expect(realFind(products, x)).toBe(products[0]); // guards the premise itself
    expect(find_(products)(x)).toBe(products[0]);
    // ...and the reverse order, where the id match comes first.
    const flipped = [{ id: 'p9', sku: 'C' }, { id: 'p2', sku: 'B' }, { id: 'p1', sku: 'X' }];
    expect(find_(flipped)({ product_id: 'p9', sku: 'X' })).toBe(realFind(flipped, { product_id: 'p9', sku: 'X' }));
  });

  test('duplicate ids/skus resolve to the FIRST occurrence, as find does', () => {
    const products = [{ id: 'p1', sku: 'DUP' }, { id: 'p2', sku: 'DUP' }, { id: 'p1', sku: 'Z' }];
    const find = buildProductIndex(products);
    expect(find({ sku: 'DUP' })).toBe(products[0]);
    expect(find({ product_id: 'p1' })).toBe(products[0]);
  });

  test('a miss returns undefined, and nullish keys never match a nullish catalog row', () => {
    const products = [{ id: 'p1', sku: 'A' }, { id: null, sku: null }];
    const find = buildProductIndex(products);
    expect(find({ product_id: 'nope', sku: 'nope' })).toBeUndefined();
    // find() would have matched the {id:null,sku:null} row here; treating that as a hit would put a
    // junk catalog row behind a real line, so the index deliberately does not.
    expect(find({})).toBeUndefined();
    expect(find(null)).toBeUndefined();
  });

  test('tolerates an absent/!array catalog and holes', () => {
    expect(buildProductIndex(undefined)({ sku: 'A' })).toBeUndefined();
    expect(buildProductIndex(null)({ sku: 'A' })).toBeUndefined();
    const find = buildProductIndex([null, { id: 'p1', sku: 'A' }, undefined]);
    expect(find({ sku: 'A' })).toEqual({ id: 'p1', sku: 'A' });
  });

  test('agrees with Array.find across a randomised catalog', () => {
    const products = [];
    for (let i = 0; i < 400; i++) products.push({ id: 'p' + (i % 250), sku: 'S' + (i % 175) });
    const find = buildProductIndex(products);
    for (let i = 0; i < 600; i++) {
      const x = { product_id: 'p' + (i % 300), sku: 'S' + ((i * 7) % 220) };
      expect(find(x)).toBe(realFind(products, x));
    }
  });
});

// Small helper so the "different rows" test can build an index per catalog inline.
function find_(products) { return buildProductIndex(products); }
