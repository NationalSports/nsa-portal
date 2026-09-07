import { AI_INBOX_OWNER_ID, canViewAiInbox, resolveAccessUser } from '../lib/pageAccess';

describe('page-access hydration', () => {
  test('uses the authoritative team permissions as soon as they load', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'invoices'] };
    const resolved = resolveAccessUser(cached, [
      { id: 'acct-1', role: 'accounting', access: ['dashboard', 'orders', 'invoices', 'customers'] },
    ]);
    expect(resolved.access).toContain('orders');
    expect(resolved.access).toContain('customers');
  });

  test('keeps cached permissions while the team load is still pending', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'orders'] };
    expect(resolveAccessUser(cached, [], false)).toBe(cached);
  });

  test('does not substitute another team member permissions', () => {
    const cached = { id: 'acct-1', role: 'accounting', access: ['dashboard', 'invoices'] };
    expect(resolveAccessUser(cached, [{ id: 'rep-1', role: 'rep', access: ['orders'] }])).toBe(cached);
  });
});

describe('AI Inbox access', () => {
  test('allows Steve by stable team-member identity', () => {
    expect(canViewAiInbox({ id: AI_INBOX_OWNER_ID, role: 'admin' })).toBe(true);
  });

  test('does not grant access to another admin or through page access', () => {
    expect(canViewAiInbox({
      id: '00000000-0000-0000-0000-000000000010',
      role: 'admin',
      access: ['ai_inbox'],
    })).toBe(false);
  });
});
