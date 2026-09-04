import { canAdjustInventory } from '../safeHelpers';

describe('manual inventory adjustment permission', () => {
  const kellenId = '00000000-0000-0000-0000-000000000050';
  const warehouseLeads = [kellenId];

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
});
