/* healDuplicateLineIds (src/lib/orderLineIdentity.js).
 *
 * so_items_line_identity rejects a sales-order save that carries the same line_id twice, and the
 * outbox retries that exact payload forever — SO-2456 failed 88 times between 2026-10-02 and
 * 2026-10-08. The repeat came from the save guard's item revive: the rep recolored a line that had
 * a PO (110M White → Charcoal/ White), the guard rebuilt the old White line at the tail under the
 * DB row's line_id, and both lines then held it. These tests use that payload's shape.
 */
import { healDuplicateLineIds } from '../lib/orderLineIdentity';

const po = (po_id, extra = {}) => ({ po_id, status: 'waiting', ...extra });
const dbRows = () => [
  { id: 1, line_id: 'L-black', item_index: 0, sku: '110M', color: 'Black', product_id: null, sizes: { Adjustable: 5 } },
  { id: 2, line_id: 'L-white', item_index: 1, sku: '110M', color: 'White', product_id: null, sizes: { Adjustable: 4 } },
];
const recolored = () => ({ line_id: 'L-white', sku: '110M', color: 'Charcoal/ White', product_id: null, sizes: { Adjustable: 4 }, po_lines: [po('PO 59412', { billed: { Adjustable: 4 } })] });
const reviveCopy = () => ({ line_id: 'L-white', sku: '110M', color: 'White', product_id: null, sizes: { Adjustable: 4 }, po_lines: [po('PO 59412', { billed: { Adjustable: 4 } })], decorations: [] });
const black = () => ({ line_id: 'L-black', sku: '110M', color: 'Black', product_id: null, sizes: { Adjustable: 5 }, po_lines: [po('PO 59412')] });

describe('healDuplicateLineIds', () => {
  test('a payload with unique ids passes through untouched', () => {
    const items = [black(), recolored()];
    const r = healDuplicateLineIds(items, dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.renumbered).toEqual([]);
    expect(r.items[0]).toBe(items[0]);
    expect(r.items[1]).toBe(items[1]);
  });

  test('SO-2456: the tail revive copy of a recolored line is dropped; the recolored line keeps its id and PO', () => {
    const items = [black(), recolored(), reviveCopy()];
    const r = healDuplicateLineIds(items, dbRows());
    expect(r.items).toHaveLength(2);
    expect(r.dropped.map(d => d.index)).toEqual([2]);
    expect(r.renumbered).toEqual([]);
    expect(r.items[1].line_id).toBe('L-white');
    expect(r.items[1].color).toBe('Charcoal/ White');
    expect(r.items[1].po_lines.map(p => p.po_id)).toEqual(['PO 59412']);
  });

  test('a copy the rep edited (sizes differ from the DB line) is kept under a fresh id', () => {
    const edited = { ...reviveCopy(), sizes: { Adjustable: 6 } };
    const r = healDuplicateLineIds([black(), recolored(), edited], dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.renumbered).toEqual([2]);
    expect(r.items).toHaveLength(3);
    expect(r.items[2].line_id).not.toBe('L-white');
    expect(r.items[2].sizes).toEqual({ Adjustable: 6 });
  });

  test('a copy carrying a PO the first holder does not is kept, never dropped with it', () => {
    const extraPo = { ...reviveCopy(), po_lines: [po('PO 59412'), po('PO 70000')] };
    const r = healDuplicateLineIds([black(), recolored(), extraPo], dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.items[2].po_lines.map(p => p.po_id)).toEqual(['PO 59412', 'PO 70000']);
    expect(r.items[2].line_id).not.toBe('L-white');
  });

  test('a copy carrying a pick the first holder does not is kept', () => {
    const withPick = { ...reviveCopy(), pick_lines: [{ pick_id: 'IF-1' }] };
    const r = healDuplicateLineIds([black(), recolored(), withPick], dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.renumbered).toEqual([2]);
  });

  test('a repeat without PO lines is a real line — kept under a fresh id', () => {
    const bare = { ...reviveCopy(), po_lines: [] };
    const r = healDuplicateLineIds([black(), recolored(), bare], dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.renumbered).toEqual([2]);
  });

  test('a copy that is not at the tail is kept (dropping it would shift later lines)', () => {
    const added = { line_id: 'L-new', sku: 'BC3001', color: 'Silver', sizes: { L: 1 } };
    const r = healDuplicateLineIds([black(), recolored(), reviveCopy(), added], dbRows());
    expect(r.dropped).toEqual([]);
    expect(r.renumbered).toEqual([2]);
    expect(r.items.map(i => i.sku)).toEqual(['110M', '110M', '110M', 'BC3001']);
    expect(new Set(r.items.map(i => i.line_id)).size).toBe(4);
  });

  test('several tail copies are all dropped, highest index first', () => {
    const r = healDuplicateLineIds([black(), recolored(), reviveCopy(), reviveCopy()], dbRows());
    expect(r.dropped.map(d => d.index)).toEqual([3, 2]);
    expect(r.items).toHaveLength(2);
  });

  test('the result never repeats a line_id', () => {
    const r = healDuplicateLineIds([recolored(), black(), { ...black(), sizes: { Adjustable: 1 } }, { ...recolored() }], dbRows());
    const ids = r.items.map(i => i.line_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.items[0].line_id).toBe('L-white');
    expect(r.items[1].line_id).toBe('L-black');
  });

  test('lines without a line_id are left for the database to number', () => {
    const r = healDuplicateLineIds([{ sku: 'A' }, { sku: 'A' }], []);
    expect(r.items.map(i => i.line_id)).toEqual([undefined, undefined]);
    expect(r.renumbered).toEqual([]);
  });
});
