/* The staff login screen's roster (src/lib/auth.js sbGetTeam).
 * team_members is staff-only after migration 20261013120000, so a signed-out visitor reads the
 * login_roster() function; the table read remains as the fallback until the migration is applied. */
const mockClient = { rpcResult: null, tableResult: null, calls: [] };
jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name) => { mockClient.calls.push('rpc:' + name); return Promise.resolve(mockClient.rpcResult); },
    from: (t) => ({ select: () => ({ order: () => { mockClient.calls.push('table:' + t); return Promise.resolve(mockClient.tableResult); } }) }),
  },
}));
const { sbGetTeam } = require('../lib/auth');

beforeEach(() => { mockClient.calls = []; });

test('reads the roster through login_roster() without touching the table', async () => {
  mockClient.rpcResult = { data: [{ id: 'r1', name: 'Rep', role: 'rep', email: 'r@nsa.test', is_active: true }], error: null };
  expect((await sbGetTeam()).map((r) => r.id)).toEqual(['r1']);
  expect(mockClient.calls).toEqual(['rpc:login_roster']);
});

test('falls back to the table while the function does not exist yet', async () => {
  mockClient.rpcResult = { data: null, error: { message: 'Could not find the function public.login_roster' } };
  mockClient.tableResult = { data: [{ id: 'r2' }], error: null };
  expect((await sbGetTeam()).map((r) => r.id)).toEqual(['r2']);
  expect(mockClient.calls).toEqual(['rpc:login_roster', 'table:team_members']);
});

test('returns an empty roster when neither is readable (the gate keeps its cached roster)', async () => {
  mockClient.rpcResult = { data: null, error: { message: 'network' } };
  mockClient.tableResult = { data: null, error: { code: '42501', message: 'permission denied for table team_members' } };
  expect(await sbGetTeam()).toEqual([]);
});
