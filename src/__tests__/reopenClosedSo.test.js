/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — the "Reopen Sales Order" action in the order editor's Actions menu.
//
// status='complete' is the one MANUAL pin on an otherwise auto-calculated ladder, and it is
// easy to set by accident: a Final invoice where a Partial was meant closes the SO, and the
// closed SO hides "Create Invoice" behind a "✓ Sales Order Closed" badge (SO-1519, Aug 2026).
// Reopening drops the pin and lets the order settle back on calcSOStatus's auto answer, so the
// whole action rests on what calcSOStatus(so,{ignoreOverride:true}) returns. These pin that
// contract — including the one case where reopening is refused because the auto answer is
// itself 'complete' and the order would recompute straight back.
// ═══════════════════════════════════════════════
const { calcSOStatus } = require('../components');

// SO-1519's shape: 9 lines, one job shipped and one still on hold, closed by a Final invoice.
const heldJobSO = (over = {}) => ({
  id: 'SO-1519', status: 'complete', ship_preference: 'ship_as_ready', order_type: 'at_once',
  items: [{ sku: 'A', color: 'Black', sizes: { M: 10 }, decorations: [{ kind: 'art', art_file_id: 'af1' }],
            po_lines: [{ M: 10, received: { M: 10 } }] }],
  jobs: [{ id: 'J1', prod_status: 'shipped', total_units: 10 }, { id: 'J2', prod_status: 'hold', total_units: 10 }],
  ...over,
});

// Everything produced, shipped and out the door — genuinely finished.
const shippedSO = (over = {}) => ({
  id: 'SO-2000', status: 'complete', ship_preference: 'ship_as_ready', order_type: 'at_once',
  items: [{ sku: 'A', color: 'Black', sizes: { M: 10 }, decorations: [{ kind: 'art', art_file_id: 'af1' }],
            po_lines: [{ M: 10, received: { M: 10 } }] }],
  jobs: [{ id: 'J1', prod_status: 'shipped', total_units: 10 }],
  _shipments: [{ items: [{ sizes: { M: 10 } }] }],
  ...over,
});

describe('Reopen gate — calcSOStatus with ignoreOverride', () => {
  test('a closed SO whose production is unfinished has a real status to reopen to', () => {
    const so = heldJobSO();
    // Without ignoreOverride the pin wins — that is what makes 'complete' sticky everywhere.
    expect(calcSOStatus(so)).toBe('complete');
    // With it, the order reveals where it actually stands, and that is where Reopen lands it.
    const auto = calcSOStatus({ ...so, status: null }, { ignoreOverride: true });
    expect(auto).not.toBe('complete');
  });

  test('reopening is refused on a fully shipped order — the auto status is complete too', () => {
    // Nothing to un-pin: the action shows an explanation instead of a silent no-op.
    expect(calcSOStatus({ ...shippedSO(), status: null }, { ignoreOverride: true })).toBe('complete');
  });

  test('a closed no-deco order reopens to ready_to_invoice — ignoreOverride alone is not enough', () => {
    // calcSOStatus's no-deco branch reads ord.status ITSELF, outside the ignoreOverride guard, so
    // a closed blanks order keeps answering 'complete' and Reopen would wrongly refuse it. That is
    // why the action nulls the status before recomputing rather than relying on the flag.
    const closed = { id: 'SO-3000', status: 'complete',
      items: [{ sku: 'A', color: 'Black', sizes: { M: 6 }, no_deco: true, po_lines: [{ M: 6, received: { M: 6 } }] }], jobs: [] };
    expect(calcSOStatus(closed, { ignoreOverride: true })).toBe('complete');       // the trap
    expect(calcSOStatus({ ...closed, status: null }, { ignoreOverride: true })).toBe('ready_to_invoice');
  });

  test('a closed promo order reopens too — its complete short-circuit also reads ord.status', () => {
    const closed = { id: 'SO-4000', status: 'complete', promo_applied: true,
      items: [{ sku: 'A', color: 'Black', sizes: { M: 4 }, decorations: [{ kind: 'art', art_file_id: 'af1' }] }],
      jobs: [{ id: 'J1', prod_status: 'staging', total_units: 4 }] };
    expect(calcSOStatus(closed, { ignoreOverride: true })).toBe('complete');       // the trap
    expect(calcSOStatus({ ...closed, status: null }, { ignoreOverride: true })).toBe('in_production');
  });
});
