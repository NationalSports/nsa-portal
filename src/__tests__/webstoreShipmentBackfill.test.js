/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20260902083000_backfill_unambiguous_webstore_shipments.sql'),
  'utf8',
);

describe('legacy shipment-ledger backfill', () => {
  test('requires complete label evidence, no ledger, and fully shipped quantities', () => {
    for (const field of ['shipstation_shipment_id', 'tracking_number', 'label_data', 'shipped_at']) {
      expect(migration).toMatch(new RegExp(`o\\.${field} is not null`));
    }
    expect(migration).toMatch(/not exists \([\s\S]*public\.webstore_shipments/);
    expect(migration).toMatch(/bool_and\(coalesce\(i\.shipped_qty, 0\) >= coalesce\(i\.qty, 0\)\)/);
  });

  test('preserves line ids in shipment items and suppresses duplicate email', () => {
    expect(migration).toMatch(/'lineItemKey', i\.id::text/);
    expect(migration).toMatch(/items, true, shipped_at, label_cost, shipstation_shipment_id/);
    expect(migration).not.toMatch(/webstore_notification_outbox/);
  });

  test('is idempotent and repairs the stale tracker line status', () => {
    expect(migration).toMatch(/on conflict \(ss_shipment_id\) do nothing/);
    expect(migration).toMatch(/set line_status = 'shipped'/);
    expect(migration).toMatch(/returning order_id[\s\S]*from inserted x[\s\S]*i\.order_id = x\.order_id/);
  });
});
