import { canManageQuickBooksRole, storedUserCanManageQuickBooks } from '../qbAccess';

describe('QuickBooks UI role access', () => {
  test.each(['admin', 'super_admin', 'accounting'])('%s may see QuickBooks', (role) => {
    expect(canManageQuickBooksRole(role)).toBe(true);
  });

  test.each(['rep', 'csr', 'warehouse', 'production', 'artist', '', null])('%s cannot see QuickBooks', (role) => {
    expect(canManageQuickBooksRole(role)).toBe(false);
  });

  test('normal reps cannot start background QBO behavior', () => {
    const storage = { getItem: jest.fn(() => JSON.stringify({ role: 'rep' })) };
    expect(storedUserCanManageQuickBooks(storage)).toBe(false);
  });
});
