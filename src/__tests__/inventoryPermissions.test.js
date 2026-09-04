import { canAdjustInventory } from '../safeHelpers';
import { WAREHOUSE_LEAD_IDS, INVENTORY_ADJUST_IDS } from '../constants';

describe('manual inventory adjustment permission', () => {
  const kellenId = '00000000-0000-0000-0000-000000000050';
  const vicId = 'tm-mpn3xnfieezi';
  const warehouseLeads = [kellenId];
  // What App.js actually passes: warehouse leads + the explicit inventory allow-list.
  const allowed = [...WAREHOUSE_LEAD_IDS, ...INVENTORY_ADJUST_IDS];

  test('allows admins', () => {
    expect(canAdjustInventory({ id: 'steve', role: 'admin' }, warehouseLeads)).toBe(true);
    expect(canAdjustInventory({ id: 'denis', role: 'admin' }, warehouseLeads)).toBe(true);
    expect(canAdjustInventory({ id: 'root', role: 'super_admin' }, warehouseLeads)).toBe(true);
  });

  test('allows Kellen as the designated warehouse lead', () => {
    expect(canAdjustInventory({ id: kellenId, role: 'warehouse' }, warehouseLeads)).toBe(true);
  });

  test('does not grant adjustment permission to every warehouse user', () => {
    expect(canAdjustInventory({ id: 'another-warehouse-user', role: 'warehouse' }, warehouseLeads)).toBe(false);
    expect(canAdjustInventory({ id: 'sales-user', role: 'rep' }, warehouseLeads)).toBe(false);
    expect(canAdjustInventory(null, warehouseLeads)).toBe(false);
  });

  test('grants Vic Damian adjustment access through the explicit inventory allow-list', () => {
    expect(INVENTORY_ADJUST_IDS).toContain(vicId);
    expect(canAdjustInventory({ id: vicId, role: 'csr' }, allowed)).toBe(true);
  });

  test('naming one CSR does not grant the control to every CSR', () => {
    expect(canAdjustInventory({ id: 'other-csr', role: 'csr' }, allowed)).toBe(false);
  });

  test('the inventory allow-list does not grant warehouse task delegation', () => {
    // App.js gates warehouse delegation on WAREHOUSE_LEAD_IDS alone — keep the lists distinct.
    INVENTORY_ADJUST_IDS.forEach(id => expect(WAREHOUSE_LEAD_IDS).not.toContain(id));
  });
});
