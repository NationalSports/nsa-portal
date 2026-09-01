import { activeWebstoreLines, resolveWebstoreReportLines } from '../lib/soPlayerReport';

describe('active webstore report quantities', () => {
  const orders = {
    live: { id: 'live', status: 'paid' },
    cancelled: { id: 'cancelled', status: 'cancelled' },
    refunded: { id: 'refunded', status: 'refunded' },
  };

  test('drops dead orders and cancelled lines, and subtracts refunded/backordered shorts', () => {
    const lines = [
      { id: 'ok', order_id: 'live', sku: 'A', qty: 2 },
      { id: 'line-cancel', order_id: 'live', sku: 'B', qty: 5, line_status: 'cancelled' },
      { id: 'short-refund', order_id: 'live', sku: 'C', qty: 3, short_qty: 1, short_status: 'refunded' },
      { id: 'short-backorder', order_id: 'live', sku: 'D', qty: 2, short_qty: 1, short_status: 'backordered' },
      { id: 'short-open', order_id: 'live', sku: 'E', qty: 2, short_qty: 1, short_status: 'open' },
      { id: 'dead-cancelled', order_id: 'cancelled', sku: 'F', qty: 4 },
      { id: 'dead-refunded', order_id: 'refunded', sku: 'G', qty: 4 },
    ];
    const active = activeWebstoreLines(lines, orders);
    expect(active.map((l) => [l.id, l.qty])).toEqual([
      ['ok', 2], ['short-refund', 2], ['short-backorder', 1], ['short-open', 2],
    ]);
  });
});

describe('whole-store report reconciliation', () => {
  test('uses current SO SKU/size for batched lines and leaves unbatched lines as ordered', () => {
    const orders = [
      { id: 'o1', status: 'paid', so_id: 'SO-1' },
      { id: 'o2', status: 'paid', so_id: null },
    ];
    const lines = [
      { id: 'i1', order_id: 'o1', sku: 'HI0704', name: 'Old pant', size: 'XS', qty: 1 },
      { id: 'i2', order_id: 'o2', sku: 'TEE', name: 'Tee', size: 'M', qty: 1 },
    ];
    const soItemsBySo = { 'SO-1': [{ sku: 'HI0706', name: 'New pant', sizes: { S: 1 } }] };
    const resolved = resolveWebstoreReportLines({ orders, lines, soItemsBySo });
    const changed = resolved.lines.find((l) => l.id === 'i1');
    const unbatched = resolved.lines.find((l) => l.id === 'i2');
    expect(changed).toMatchObject({ sku: 'HI0706', _effSku: 'HI0706', size: 'S', _wasSku: 'HI0704', _wasSize: 'XS', _verify: true });
    expect(unbatched).toMatchObject({ sku: 'TEE', _effSku: 'TEE', size: 'M' });
    expect(resolved.audit.substitutions).toEqual([{ from: 'HI0704', to: 'HI0706', verify: true, soId: 'SO-1' }]);
    expect(resolved.audit.sizeChanges).toEqual([{ soId: 'SO-1', sku: 'HI0706', from: 'XS', to: 'S', verify: false }]);
    expect(resolved.audit.unitMismatches).toEqual([]);
  });

  test('does not block customer fulfillment for an unassigned extra SO unit', () => {
    const orders = [{ id: 'o1', status: 'paid', so_id: 'SO-2' }];
    const lines = [{ id: 'i1', order_id: 'o1', sku: 'A', size: 'M', qty: 2 }];
    const soItemsBySo = { 'SO-2': [{ sku: 'A', name: 'A', sizes: { M: 3 } }] };
    const { audit } = resolveWebstoreReportLines({ orders, lines, soItemsBySo });
    expect(audit.unitMismatches).toEqual([]);
  });

  test('still blocks when active customer units exceed the SO', () => {
    const orders = [{ id: 'o1', status: 'paid', so_id: 'SO-SHORT' }];
    const lines = [{ id: 'i1', order_id: 'o1', sku: 'A', size: 'M', qty: 3 }];
    const soItemsBySo = { 'SO-SHORT': [{ sku: 'A', name: 'A', sizes: { M: 2 } }] };
    const { audit } = resolveWebstoreReportLines({ orders, lines, soItemsBySo });
    expect(audit.unitMismatches).toEqual([{
      soId: 'SO-SHORT', sourceUnits: 3, soUnits: 2, delta: -1, targetLabel: 'sales-order units',
    }]);
  });

  test('audits against the submitted Silver Screen job and surfaces incomplete jobs', () => {
    const orders = [{ id: 'o1', store_id: 'STORE-A', status: 'paid', so_id: 'SO-SS' }];
    const lines = [{ id: 'i1', order_id: 'o1', sku: 'A', size: 'M', qty: 3 }];
    const soItemsBySo = { 'SO-SS': [{ sku: 'A', name: 'A', sizes: { M: 4 } }] };
    const soMetaBySo = { 'SO-SS': {
      id: 'SO-SS', webstore_id: 'STORE-A', deco_pos: [{
        vendor: 'Silver Screen', qty: 2, _silverscreen_job_id: 58505,
        _silverscreen_todo: 'Job #58505 created, but finish it on the Silver Screen portal — check product lines — only 12 of 13 were added. [forms: untrusted details]',
      }],
    } };
    const { audit } = resolveWebstoreReportLines({ orders, lines, soItemsBySo, soMetaBySo });
    expect(audit.unitMismatches).toEqual([{
      soId: 'SO-SS', sourceUnits: 3, soUnits: 2, delta: -1, targetLabel: 'Silver Screen job units',
    }]);
    expect(audit.externalIssues).toEqual([
      'SO-SS: Silver Screen job #58505 is incomplete — Job #58505 created, but finish it on the Silver Screen portal — check product lines — only 12 of 13 were added.',
    ]);
  });

  test('rejects an order linked to an SO owned by another store', () => {
    const orders = [{ id: 'o1', store_id: 'STORE-A', status: 'paid', so_id: 'SO-WRONG' }];
    const lines = [{ id: 'i1', order_id: 'o1', sku: 'A', size: 'M', qty: 1 }];
    const soItemsBySo = { 'SO-WRONG': [{ sku: 'A', sizes: { M: 1 } }] };
    const soMetaBySo = { 'SO-WRONG': { id: 'SO-WRONG', webstore_id: 'STORE-B' } };
    const { lines: resolved, audit } = resolveWebstoreReportLines({ orders, lines, soItemsBySo, soMetaBySo });
    expect(resolved[0]._unmatched).toBe(true);
    expect(audit.wrongStoreLinks).toEqual([{ soId: 'SO-WRONG', storeId: 'STORE-A' }]);
    expect(audit.substitutions).toEqual([]);
  });

  test('a backorder child inherits its parent SO without double-counting the parent short', () => {
    const orders = [
      { id: 'parent', store_id: 'STORE-A', status: 'paid', so_id: 'SO-1' },
      { id: 'child', store_id: 'STORE-A', status: 'paid', so_id: null, backorder_of: 'parent' },
    ];
    const lines = [
      { id: 'p-line', order_id: 'parent', sku: 'OLD', size: 'M', qty: 2, short_status: 'backordered', short_qty: 1 },
      { id: 'c-line', order_id: 'child', sku: 'OLD', size: 'M', qty: 1 },
    ];
    const soItemsBySo = { 'SO-1': [{ sku: 'NEW', name: 'Replacement', sizes: { M: 2 } }] };
    const soMetaBySo = { 'SO-1': { id: 'SO-1', webstore_id: 'STORE-A' } };
    const { lines: resolved, audit } = resolveWebstoreReportLines({ orders, lines, soItemsBySo, soMetaBySo });
    expect(resolved.reduce((n, l) => n + l.qty, 0)).toBe(2);
    resolved.forEach((l) => { expect(l.sku).toBe('NEW'); expect(l._sourceSoId).toBe('SO-1'); });
    expect(audit.unitMismatches).toEqual([]);
  });
});
