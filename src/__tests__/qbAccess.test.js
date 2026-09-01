import { canManageQuickBooksRole, storedUserCanManageQuickBooks } from '../qbAccess';

describe('QuickBooks role access', () => {
  test.each(['admin', 'super_admin', 'accounting'])('%s may manage QuickBooks', (role) => {
    expect(canManageQuickBooksRole(role)).toBe(true);
  });

  test.each(['rep', 'csr', 'warehouse', 'production', 'artist', '', null])('%s cannot manage QuickBooks', (role) => {
    expect(canManageQuickBooksRole(role)).toBe(false);
  });

  test('persisted normal reps cannot start background QBO behavior', () => {
    const storage = { getItem: jest.fn(() => JSON.stringify({ id: 'rep-1', role: 'rep' })) };
    expect(storedUserCanManageQuickBooks(storage)).toBe(false);
  });

  test('persisted accounting users can start QBO behavior', () => {
    const storage = { getItem: jest.fn(() => JSON.stringify({ id: 'acct-1', role: 'accounting' })) };
    expect(storedUserCanManageQuickBooks(storage)).toBe(true);
  });
});
