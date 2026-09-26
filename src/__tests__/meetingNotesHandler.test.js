/**
 * meeting-notes endpoint rules: consent is required for Meeting mode, a rep can
 * only act on their own notes, approval is guarded by status and safe to repeat,
 * and approved notes cannot be discarded by the rep.
 */
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({}),
  getTrustedSiteBaseUrl: () => 'https://example.test',
  verifyUser: jest.fn(),
}));
jest.mock('../../netlify/functions/_meetingPipeline', () => ({
  purgeAudio: jest.fn(async () => 0),
  folderOf: (m) => `${m.team_member_id}/${m.id}`,
  normalizeFinal: jest.requireActual('../../netlify/functions/_meetingPipeline').normalizeFinal,
  writeApproval: jest.fn(async () => ({ todo_ids: ['t0'], contacts_added: [] })),
}));
const shared = require('../../netlify/functions/_shared');
const pipeline = require('../../netlify/functions/_meetingPipeline');
const { handler } = require('../../netlify/functions/meeting-notes');

const ID = '44444444-4444-4444-8444-444444444444';
function fakeAdmin(meetings) {
  const db = { meetings, customers: [{ id: 'C1' }], meeting_transcripts: [] };
  const from = (table) => {
    const q = { f: [], op: 'select', p: null };
    const rows = () => db[table].filter((r) => q.f.every((fn) => fn(r)));
    const run = () => {
      if (q.op === 'insert') { const r = { id: ID, created_at: 'now', ...q.p }; db[table].push(r); return [r]; }
      if (q.op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, q.p)); return hit; }
      if (q.op === 'delete') { db[table] = db[table].filter((r) => !rows().includes(r)); return []; }
      return rows();
    };
    const api = {
      select: () => api, insert: (p) => { q.op = 'insert'; q.p = p; return api; }, update: (p) => { q.op = 'update'; q.p = p; return api; }, delete: () => { q.op = 'delete'; return api; },
      eq: (c, v) => { q.f.push((r) => r[c] === v); return api; }, neq: (c, v) => { q.f.push((r) => r[c] !== v); return api; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }), single: async () => ({ data: run()[0] || null, error: null }),
      then: (a, b) => Promise.resolve({ data: run(), error: null }).then(a, b),
    };
    return api;
  };
  return { from, db };
}
const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 202 }));
  process.env.INTERNAL_FUNCTION_SECRET = 's';
  pipeline.writeApproval.mockClear();
});

test('Meeting mode needs the consent confirmation; voice memo does not', async () => {
  const admin = fakeAdmin([]);
  shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm1', admin });
  expect((await call({ action: 'create', mode: 'recorded' })).statusCode).toBe(400);
  const ok = await call({ action: 'create', mode: 'recorded', consent: true, customer_id: 'C1' });
  expect(ok.statusCode).toBe(200);
  expect(admin.db.meetings[0].consent_confirmed_at).toBeTruthy();
  expect((await call({ action: 'create', mode: 'dictated', customer_id: 'nope' })).statusCode).toBe(400);
});

test("another rep's note is not found", async () => {
  const admin = fakeAdmin([{ id: ID, team_member_id: 'tm2', status: 'ready', draft: {} }]);
  shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm1', admin });
  expect((await call({ action: 'discard', id: ID })).statusCode).toBe(404);
  expect((await call({ action: 'approve', id: ID, customer_id: 'C1', final: { headline: 'x' } })).statusCode).toBe(404);
});

test('approve requires an account, then re-approving only re-runs the idempotent writes', async () => {
  const admin = fakeAdmin([{ id: ID, team_member_id: 'tm1', status: 'ready', customer_id: null }]);
  shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm1', admin });
  expect((await call({ action: 'approve', id: ID, final: { headline: 'H' } })).statusCode).toBe(400);
  const first = await call({ action: 'approve', id: ID, customer_id: 'C1', final: { headline: 'H', summary: 'S', action_items: [{ text: 'Do it', owner: 'A' }] }, speaker_map: { A: 'Coach Lee', bad: 'x' } });
  expect(first.statusCode).toBe(200);
  const m = admin.db.meetings[0];
  expect(m).toMatchObject({ status: 'approved', customer_id: 'C1', title: 'H', speaker_map: { A: 'Coach Lee' } });
  expect(m.final.action_items[0].owner).toBe('Coach Lee');
  const again = await call({ action: 'approve', id: ID, customer_id: 'C1', final: { headline: 'Changed' } });
  expect(JSON.parse(again.body).already).toBe(true);
  expect(m.final.headline).toBe('H');
  expect(pipeline.writeApproval).toHaveBeenCalledTimes(2);
  expect((await call({ action: 'discard', id: ID })).statusCode).toBe(409);
});

test('finalize starts background processing once', async () => {
  const admin = fakeAdmin([{ id: ID, team_member_id: 'tm1', status: 'recording' }]);
  shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm1', admin });
  expect((await call({ action: 'finalize', id: ID, duration_sec: 75 })).statusCode).toBe(200);
  expect(admin.db.meetings[0]).toMatchObject({ status: 'processing', duration_sec: 75 });
  expect(global.fetch).toHaveBeenCalledWith('https://example.test/.netlify/functions/meeting-process-background', expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-secret': 's' }) }));
  expect((await call({ action: 'finalize', id: ID })).statusCode).toBe(409);
});
