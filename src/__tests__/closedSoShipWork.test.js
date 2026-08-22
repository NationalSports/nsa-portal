/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — src/safeHelpers.js: unshippedPulledUnits / soHasOpenShipWork
//
// Ready to Ship is the ONLY place a package — and therefore its shipping cost — gets created.
// buildWarehouseData hides status='complete' orders from the warehouse queues, so a closed order
// that still owes a shipment used to lose its cost entirely. The old carve-out only asked "is any
// job unshipped?", which a blanks/no-deco order can never answer: it has no jobs at all.
// ═══════════════════════════════════════════════
const { unshippedPulledUnits, soHasOpenShipWork } = require('../safeHelpers');

const line = (sku, color, sizes, over = {}) => ({ sku, color, sizes, ...over });
const pulled = (sizes) => ({ status: 'pulled', ...sizes });
const box = (items) => ({ tracking_number: '1Z999', items });

describe('unshippedPulledUnits', () => {
  test('pulled with no shipment record at all — every unit still owes a box', () => {
    const so = { items: [line('A', 'Black', { M: 6 }, { pick_lines: [pulled({ M: 6 })] })] };
    expect(unshippedPulledUnits(so)).toBe(6);
  });

  test('pulled and fully shipped — nothing owed', () => {
    const so = { items: [line('A', 'Black', { M: 6 }, { pick_lines: [pulled({ M: 6 })] })],
      _shipments: [box([{ sku: 'A', color: 'Black', sizes: { M: 6 } }])] };
    expect(unshippedPulledUnits(so)).toBe(0);
  });

  test('partially shipped — only the remainder owes a box', () => {
    const so = { items: [line('A', 'Black', { M: 10 }, { pick_lines: [pulled({ M: 10 })] })],
      _shipments: [box([{ sku: 'A', color: 'Black', sizes: { M: 4 } }])] };
    expect(unshippedPulledUnits(so)).toBe(6);
  });

  test('a drop-ship line is never pulled, so it can never strand a closed order in the queue', () => {
    // The vendor ships direct; nothing passes through our warehouse, so there are no pulled units
    // and no shipment record will ever appear. This is the case that would otherwise sit in Ready
    // to Ship forever.
    const so = { items: [line('DS', 'Red', { L: 20 }, { po_lines: [{ po_id: 'PO-1', drop_ship: true, L: 20 }] })] };
    expect(unshippedPulledUnits(so)).toBe(0);
    expect(soHasOpenShipWork(so)).toBe(false);
  });

  test('two lines sharing sku+color do not each claim the same shipped units', () => {
    const so = { items: [
      line('A', 'Black', { M: 5 }, { pick_lines: [pulled({ M: 5 })] }),
      line('A', 'Black', { M: 5 }, { pick_lines: [pulled({ M: 5 })] }),
    ], _shipments: [box([{ sku: 'A', color: 'Black', sizes: { M: 5 } }])] };
    // One box of 5 covers one line, not both — 5 units still owed, not 0.
    expect(unshippedPulledUnits(so)).toBe(5);
  });

  test('unpulled units are not counted — they are Item Fulfillment work, not shipping work', () => {
    const so = { items: [line('A', 'Black', { M: 8 }, { pick_lines: [{ status: 'pick', M: 8 }] })] };
    expect(unshippedPulledUnits(so)).toBe(0);
  });

  test('null / empty inputs do not throw', () => {
    expect(unshippedPulledUnits(null)).toBe(0);
    expect(unshippedPulledUnits({})).toBe(0);
    expect(soHasOpenShipWork(null)).toBe(false);
  });
});

describe('soHasOpenShipWork — what keeps a closed order visible to the warehouse', () => {
  test('a job that is decorated but not shipped still owes a box', () => {
    const so = { items: [], jobs: [{ id: 'J1', prod_status: 'completed', total_units: 10 }] };
    expect(soHasOpenShipWork(so)).toBe(true);
  });

  test('draft jobs do not count — they never reached the board', () => {
    const so = { items: [], jobs: [{ id: 'J1', prod_status: 'draft', total_units: 10 }] };
    expect(soHasOpenShipWork(so)).toBe(false);
  });

  test('every job shipped and every pulled unit boxed — genuinely done', () => {
    const so = { items: [line('A', 'Black', { M: 4 }, { pick_lines: [pulled({ M: 4 })] })],
      jobs: [{ id: 'J1', prod_status: 'shipped', total_units: 4 }],
      _shipments: [box([{ sku: 'A', color: 'Black', sizes: { M: 4 } }])] };
    expect(soHasOpenShipWork(so)).toBe(false);
  });

  test('THE GAP: blanks order, no jobs, box still on the floor', () => {
    // A no-deco order has no jobs, so the old job-only check said "done" and the order vanished
    // from Ready to Ship — taking its unrecorded shipping cost with it.
    const so = { items: [line('BLANK', 'White', { L: 12 }, { no_deco: true, pick_lines: [pulled({ L: 12 })] })], jobs: [] };
    expect(soHasOpenShipWork(so)).toBe(true);
  });

  test('all jobs shipped but a no-deco line on the same order never went out', () => {
    const so = { items: [
      line('TEE', 'Navy', { M: 10 }, { pick_lines: [pulled({ M: 10 })] }),
      line('SOCK', 'White', { OSFA: 10 }, { no_deco: true, pick_lines: [pulled({ OSFA: 10 })] }),
    ], jobs: [{ id: 'J1', prod_status: 'shipped', total_units: 10 }],
      _shipments: [box([{ sku: 'TEE', color: 'Navy', sizes: { M: 10 } }])] };
    expect(soHasOpenShipWork(so)).toBe(true);
    expect(unshippedPulledUnits(so)).toBe(10);
  });
});
