/** @jest-environment node */
jest.mock('../../netlify/functions/_shared', () => ({ corsHeaders: () => ({}), getSupabaseAdmin: jest.fn(), verifyUser: jest.fn() }));
const { getSupabaseAdmin, verifyUser } = require('../../netlify/functions/_shared');
const { handler, sweepAtOncePicks } = require('../../netlify/functions/at-once-pick-sweep');
function fixture(rows, cursor = null) {
  const query = { then: resolve => resolve({ data: rows, error: null }) };
  for (const name of ['select','in','not','order','limit','gt']) query[name] = jest.fn(() => query);
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const state = { select: jest.fn(() => state), eq: jest.fn(() => state), maybeSingle: jest.fn().mockResolvedValue({ data: { value: cursor } }), upsert };
  const admin = { from: jest.fn(table => table === 'app_state' ? state : query), rpc: jest.fn().mockResolvedValue({ data: { ok: true, created_lines: 1, assigned_units: 2 } }) };
  return { admin, query, upsert };
}
const row = (id, so = id) => ({ id, so_id: so, webstores: { org_type: 'club', source: 'webstore' } });
beforeEach(() => jest.clearAllMocks());
test('anonymous HTTP callers cannot queue work', async () => {
  verifyUser.mockResolvedValue({ ok: false, status: 401 });
  expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(401);
  expect(getSupabaseAdmin).not.toHaveBeenCalled();
});
test('scheduled scan deduplicates SOs, skips OMG, and invokes only the pick task RPC', async () => {
  const { admin, query, upsert } = fixture([row('a','SO-1'),row('b','SO-1'),{ ...row('c'), webstores: { source:'omg' } },row('d','SO-2')]);
  getSupabaseAdmin.mockReturnValue(admin);
  const response = await handler({});
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({ processed:4, created_lines:2, assigned_units:4 });
  expect(admin.rpc.mock.calls).toEqual([
    ['assign_at_once_inventory_picks',{p_so_id:'SO-1'}],['assign_at_once_inventory_picks',{p_so_id:'SO-2'}],
  ]);
  expect(query.in).toHaveBeenCalledWith('webstores.org_type',['club','all_school']);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ value:null }));
});
test('a full page advances the cursor; next pass resumes beyond it', async () => {
  const rows = Array.from({length:100},(_,i)=>row(String(i).padStart(3,'0')));
  const { admin, query, upsert } = fixture(rows,'previous');
  await sweepAtOncePicks(admin);
  expect(query.gt).toHaveBeenCalledWith('id','previous');
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ value:'099' }));
});
test('allocation errors surface but do not starve later orders', async () => {
  const { admin } = fixture([row('a'),row('b')]);
  admin.rpc.mockResolvedValueOnce({ error:{ message:'stock changed' } });
  const result = await sweepAtOncePicks(admin);
  expect(result).toMatchObject({ ok:false, processed:2, assigned_units:2, errors:[{so_id:'a',error:'stock changed'}] });
});
test('runtime budget saves the last processed order, not the end of the page', async () => {
  const { admin, upsert } = fixture([row('a'),row('b')]);
  const now = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(19000);
  expect((await sweepAtOncePicks(admin,{now})).processed).toBe(1);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({value:'a'}));
});
