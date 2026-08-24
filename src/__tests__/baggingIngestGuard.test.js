/* Bagging Station ingest guard (BAGGING_STATION_PLAN.md step 2).
 *
 * A packing-slip re-ingest runs syncOrderItems, which deletes "leftover" rows —
 * lines present in the DB but absent from the re-parsed slip. A line that is
 * physically in a bag (bagged_qty > 0) or carries an unresolved packer short
 * (short_status = 'open') must never be deleted by a re-parse, and the bagging
 * columns must never be overwritten by the content patch (they are not in
 * ITEM_CONTENT_KEYS, asserted here so a future key addition can't silently
 * start clobbering them).
 */

const { syncOrderItems } = require('../../netlify/functions/_shared');

// The content keys omg-packing-slip-ingest passes (its ITEM_CONTENT_KEYS).
const CONTENT_KEYS = ['name', 'color', 'qty', 'unit_price', 'player_name', 'image_url'];

// Minimal scripted supabase fake covering exactly the call shapes syncOrderItems
// makes: select().eq(), update().eq(), insert(), delete().in().
function fakeSb(existingItems) {
  const calls = { updates: [], inserts: [], deletedIds: null };
  const sb = {
    from(table) {
      if (table !== 'webstore_order_items') throw new Error('unexpected table ' + table);
      return {
        select() { return { eq: async () => ({ data: existingItems, error: null }) }; },
        update(patch) {
          return { eq: async (_col, id) => { calls.updates.push({ id, patch }); return { error: null }; } };
        },
        insert: async (rows) => { calls.inserts.push(...rows); return { error: null }; },
        delete() {
          return { in: async (_col, ids) => { calls.deletedIds = ids; return { error: null }; } };
        },
      };
    },
  };
  return { sb, calls };
}

test('re-ingest never deletes a line that is bagged or has an open short', async () => {
  const existing = [
    // in a bag — slip no longer lists it (e.g. mis-parse) → must survive
    { id: 'bagged-1', sku: 'A1', size: 'M', shipped_qty: 0, missing_qty: 0, line_status: 'pending', bagged_qty: 1, short_status: null },
    // open packer short → must survive
    { id: 'short-1', sku: 'B2', size: 'L', shipped_qty: 0, missing_qty: 0, line_status: 'pending', bagged_qty: 0, short_status: 'open' },
    // no progress at all → the one legitimate delete
    { id: 'stale-1', sku: 'C3', size: 'S', shipped_qty: 0, missing_qty: 0, line_status: 'pending', bagged_qty: 0, short_status: null },
  ];
  const { sb, calls } = fakeSb(existing);
  const res = await syncOrderItems(sb, 'order-1', [], CONTENT_KEYS);
  expect(res.removed).toBe(1);
  expect(calls.deletedIds).toEqual(['stale-1']);
});

test('content patch on a matched line cannot touch bagging columns', async () => {
  const existing = [
    { id: 'row-1', sku: 'A1', size: 'M', shipped_qty: 0, missing_qty: 0, line_status: 'bagging', bagged_qty: 2, short_status: 'open' },
  ];
  const { sb, calls } = fakeSb(existing);
  const incoming = [{ sku: 'A1', size: 'M', name: 'Renamed Jersey', color: 'Navy', qty: 3, unit_price: 0, player_name: 'Jimmy', image_url: null }];
  await syncOrderItems(sb, 'order-1', incoming, CONTENT_KEYS);
  expect(calls.updates).toHaveLength(1);
  const patched = Object.keys(calls.updates[0].patch);
  ['bagged_qty', 'short_qty', 'short_status', 'short_note', 'backorder_of_item'].forEach((k) => {
    expect(patched).not.toContain(k);
  });
  expect(patched.sort()).toEqual([...CONTENT_KEYS].sort());
});
