import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import fs from 'fs';
import path from 'path';
import BatchPoReservationsNotice from '../BatchPoReservationsNotice';
import { itemBatchReservations, checkBatchPoReservations, batchPoReservationMessage, removeQueuedBatchLines } from '../lib/batchPoReservations';

const item = { sku: '5157751', name: 'Backpack', color: 'Grey', sizes: { OSFA: 5 }, po_lines: [] };
const order = { id: 'SO-2850', items: [item] };
const batch = { id: 'BPO-1', so_id: order.id, po_id: 'PO 8000', vendor_name: 'Agron', items: [{ item_idx: 0, sku: item.sku, color: item.color, sizes: { OSFA: 5 } }] };
const query = value => { const q = { select: jest.fn(() => q), eq: jest.fn(() => q), maybeSingle: jest.fn().mockResolvedValue(value) }; return { from: jest.fn(() => q), q }; };

test('reserves queued backpacks when the SO has no corresponding PO line', () => {
  expect(itemBatchReservations(order, item, 0, [batch])).toEqual([{ id: batch.id, poId: batch.po_id, vendorName: 'Agron', sizes: { OSFA: 5 } }]);
  expect(itemBatchReservations(order, item, 0, [{ ...batch, so_id: 'SO-other' }])).toEqual([]);
});

test('a persisted queued PO remains locked before its queue row loads, with no double counting', () => {
  const queued = { ...item, po_lines: [{ po_id: batch.po_id, batch_queue_id: batch.id, status: 'queued', OSFA: 5 }] };
  expect(itemBatchReservations(order, queued, 0, []).length).toBe(1);
  expect(itemBatchReservations(order, queued, 0, [batch])[0].sizes.OSFA).toBe(5);
  expect(itemBatchReservations(order, { ...queued, po_lines: [{ ...queued.po_lines[0], status: 'waiting' }] }, 0, [])).toEqual([]);
  expect(itemBatchReservations(order, { ...queued, po_lines: [{ ...queued.po_lines[0], cancelled: { OSFA: 5 } }] }, 0, [])).toEqual([]);
});

test('stable line identity follows reordered duplicate garments; legacy indexes stay specific', () => {
  const items = [{ ...item, line_id: 'second' }, { ...item, line_id: 'first' }];
  const so = { ...order, items };
  const stable = { ...batch, items: [{ ...batch.items[0], line_id: 'first' }] };
  expect(itemBatchReservations(so, items[0], 0, [stable])).toEqual([]);
  expect(itemBatchReservations(so, items[1], 1, [stable])).toHaveLength(1);
  expect(itemBatchReservations(so, items[1], 1, [batch])).toEqual([]);
});

test('legacy reordered garments are reserved by SKU/color; qty-only rows work', () => {
  const so = { ...order, items: [{ sku: 'other' }, item] };
  expect(itemBatchReservations(so, item, 1, [batch])).toHaveLength(1);
  const quantityOnly = { ...batch, items: [{ ...batch.items[0], sizes: {}, qty: 5 }] };
  expect(itemBatchReservations(order, item, 0, [quantityOnly])[0].sizes).toEqual({ QTY: 5 });
});

test.each([JSON.stringify([batch]), [batch]])('fresh queue check blocks stale-tab ordering for stored value %p', async value => {
  const client = query({ data: { value }, error: null });
  const conflict = await checkBatchPoReservations(client, order, [{ idx: 0, sizes: { OSFA: 5 } }], []);
  expect(batchPoReservationMessage(conflict)).toContain('Remove these items');
  expect(batchPoReservationMessage(conflict)).toContain('PO 8000');
  expect(client.q.eq).toHaveBeenCalledWith('id', 'batch_pos');
});

test('queue read errors and malformed values block rather than approve another PO', async () => {
  for (const result of [{ error: new Error('offline') }, { data: { value: '{bad json' } }, { data: { value: {} } }]) {
    expect((await checkBatchPoReservations(query(result), order, [{ idx: 0, sizes: { OSFA: 5 } }])).batchError).toBe(true);
  }
});

test('removal clears only queued source lines and unlocks the item', async () => {
  const queued = { ...item, po_lines: [{ status: 'queued', batch_queue_id: batch.id, OSFA: 5 }, { status: 'waiting', batch_queue_id: 'submitted', OSFA: 1 }] };
  const items = removeQueuedBatchLines([queued], batch.id);
  expect(items[0].po_lines).toEqual([queued.po_lines[1]]);
  expect(queued.po_lines).toHaveLength(2);
  expect(await checkBatchPoReservations(query({ data: { value: '[]' } }), { ...order, items }, [{ idx: 0, sizes: { OSFA: 4 } }], [])).toBeNull();
});

test('notice names the held item, source PO, quantities and removal action', () => {
  const div = document.createElement('div'); const root = createRoot(div); const manage = jest.fn();
  act(() => root.render(React.createElement(BatchPoReservationsNotice, { items: [{ item: { ...item, _idx: 0 }, reservations: itemBatchReservations(order, item, 0, [batch]) }], onManageBatch: manage })));
  expect(div.textContent).toContain('Already in a batch');
  expect(div.textContent).toContain('5157751'); expect(div.textContent).toContain('OSFA: 5'); expect(div.textContent).toContain('PO 8000');
  act(() => div.querySelector('button').click()); expect(manage).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s excludes batch-held lines from editable quantities and submit', async file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('const openSizesFor=');
  const end = source.indexOf('\n      };', start);
  const code = source.slice(start, end + 9).replace('const openSizesFor=', '').replace(/;$/, '');
  const open = Function('batchReservationsFor', 'safeSizes', 'safePicks', 'safeNum', 'SZ_ORD', 'poCommitted', 'QTY_SZ', 'return (' + code + ')')(
    it => itemBatchReservations(order, it, 0, [batch]), it => it.sizes, () => [], Number, [], () => 0, 'QTY');
  expect(open(item)).toEqual([]);
  expect(source.match(/await _poFreshDupCheck\(_entries\)/g)).toHaveLength(2);
});

test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s keeps a batch queued until removal is saved', async file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('const removeQueuedBatch=') + 'const removeQueuedBatch='.length;
  const end = source.indexOf('\n      };', start) + 8;
  const code = source.slice(start, end);
  for (const saved of [false, true]) {
    const o = { ...order, items: [{ ...item, po_lines: [{ status: 'queued', batch_queue_id: batch.id, OSFA: 5 }] }] };
    const deps = { o, bp: batch, safeItems: so => so.items, removeQueuedBatchLines,
      onSaveNow: jest.fn().mockResolvedValue(saved), onSave: jest.fn(), onBatchPO: jest.fn(), setO: jest.fn(), setEditBatchPO: jest.fn(), nf: jest.fn() };
    const remove = Function(...Object.keys(deps), 'return (' + code + ')')(...Object.values(deps));
    expect(await remove()).toBe(saved);
    if (saved) {
      expect(deps.onBatchPO.mock.calls[0][0]([batch])).toEqual([]);
      expect(deps.setO.mock.calls[0][0].items[0].po_lines).toEqual([]);
    } else {
      expect(deps.onBatchPO).not.toHaveBeenCalled(); expect(deps.setO).not.toHaveBeenCalled();
    }
  }
});

test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s resets the form when queue rows change to avoid reusing another item’s input', file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('    useEffect(()=>{', source.indexOf('const _poQueueSignatureRef')) + '    useEffect('.length;
  const end = source.indexOf(',[_poQueueSignature,showPO]', start);
  const deps = { _poQueueSignatureRef: { current: 'old queue' }, _poQueueSignature: 'new queue', showPO: 'Agron',
    setShowPO: jest.fn(), setPOExcluded: jest.fn(), setPoDecoInline: jest.fn(), setPodLinkId: jest.fn(), nf: jest.fn() };
  Function(...Object.keys(deps), 'return (' + source.slice(start, end) + ')')(...Object.values(deps))();
  expect(deps.setShowPO).toHaveBeenCalledWith('select'); expect(deps.setPOExcluded).toHaveBeenCalledWith({});
});
