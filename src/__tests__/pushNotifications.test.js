/**
 * Web push (NSA Connect): the sender drops dead devices and never notifies the
 * same event twice; the subscribe endpoint only accepts real push services and
 * only lets a message's author notify the people it tags.
 */
jest.mock('../../netlify/functions/_shared', () => ({ corsHeaders: () => ({}), verifyUser: jest.fn() }));
const shared = require('../../netlify/functions/_shared');
const { pushToMembers, safePush, repForCustomer } = require('../../netlify/functions/_push');
const { handler } = require('../../netlify/functions/push-subscribe');

function fakeAdmin(init) {
  const db = { push_subscriptions: [], push_sent: [], messages: [], team_members: [], customers: [], ...init };
  const from = (table) => {
    const q = { f: [], op: 'select', p: null, opts: {} };
    const rows = () => db[table].filter((r) => q.f.every((fn) => fn(r)));
    const run = () => {
      if (q.op === 'insert') {
        if (table === 'push_sent' && db.push_sent.some((r) => r.key === q.p.key)) return { data: null, error: { code: '23505' } };
        db[table].push({ ...q.p }); return { data: null, error: null };
      }
      if (q.op === 'upsert') { const i = db[table].findIndex((r) => r.endpoint === q.p.endpoint); if (i >= 0) db[table][i] = { ...db[table][i], ...q.p }; else db[table].push({ id: 's' + db[table].length, ...q.p }); return { data: null, error: null }; }
      if (q.op === 'update') { rows().forEach((r) => Object.assign(r, q.p)); return { data: null, error: null }; }
      if (q.op === 'delete') { const hit = rows(); db[table] = db[table].filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      return { data: rows(), error: null };
    };
    const api = {
      select: () => api, insert: (p) => { q.op = 'insert'; q.p = p; return api; }, upsert: (p) => { q.op = 'upsert'; q.p = p; return api; },
      update: (p) => { q.op = 'update'; q.p = p; return api; }, delete: () => { q.op = 'delete'; return api; },
      eq: (c, v) => { q.f.push((r) => String(r[c]) === String(v)); return api; }, in: (c, vs) => { q.f.push((r) => vs.map(String).includes(String(r[c]))); return api; },
      maybeSingle: async () => ({ data: run().data?.[0] || null, error: null }),
      then: (a, b) => Promise.resolve(run()).then(a, b),
    };
    return api;
  };
  return { from, db };
}
const sub = (id, member, endpoint) => ({ id, team_member_id: member, endpoint, p256dh: 'BPkey_abcdefgh', auth: 'authkey123', failures: 0 });

describe('_push sender', () => {
  test('sends to every device of the members, drops a device the push service says is gone', async () => {
    const admin = fakeAdmin({ push_subscriptions: [sub('a', 'r1', 'https://fcm.googleapis.com/fcm/send/A'), sub('b', 'r1', 'https://web.push.apple.com/B'), sub('c', 'r2', 'https://fcm.googleapis.com/fcm/send/C')] });
    const sent = [];
    const sender = { sendNotification: async (s, body) => { sent.push([s.endpoint, JSON.parse(body)]); if (s.endpoint.endsWith('/B')) { const e = new Error('gone'); e.statusCode = 410; throw e; } } };
    const r = await pushToMembers(admin, ['r1', 'r1'], { title: 'Hi', body: 'x'.repeat(400), url: 'https://evil.example/' }, { sender });
    expect(r).toEqual({ sent: 1, removed: 1 });
    expect(sent.map((s) => s[0])).toEqual(['https://fcm.googleapis.com/fcm/send/A', 'https://web.push.apple.com/B']);
    expect(sent[0][1].url).toBe('/');// only same-site paths
    expect(sent[0][1].body.length).toBeLessThanOrEqual(240);
    expect(admin.db.push_subscriptions.map((s) => s.id)).toEqual(['a', 'c']);
  });

  test('an event key notifies once; without keys configured nothing is sent', async () => {
    const admin = fakeAdmin({ push_subscriptions: [sub('a', 'r1', 'https://fcm.googleapis.com/fcm/send/A')] });
    let n = 0;
    const sender = { sendNotification: async () => { n += 1; } };
    await safePush(admin, ['r1'], { title: 'Paid' }, { sender, onceKey: 'paid:pi_1' });
    await safePush(admin, ['r1'], { title: 'Paid' }, { sender, onceKey: 'paid:pi_1' });
    expect(n).toBe(1);
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    expect(await safePush(admin, ['r1'], { title: 'x' })).toMatchObject({ sent: 0, skipped: 'push not configured' });
    expect(admin.db.push_sent).toHaveLength(1);
  });

  test('a customer without its own rep uses its school’s rep', async () => {
    const admin = fakeAdmin({ customers: [{ id: 'C2', primary_rep_id: null, parent_id: 'C1' }, { id: 'C1', primary_rep_id: 'r9' }] });
    expect(await repForCustomer(admin, 'C2', 'creator')).toBe('r9');
    expect(await repForCustomer(admin, null, 'creator')).toBe('creator');
  });
});

describe('push-subscribe', () => {
  const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  let admin;
  beforeEach(() => {
    admin = fakeAdmin({
      messages: [{ id: 'm1', author_id: 'r1', text: 'Can you check the hoodie sizes?', so_id: 'SO-9', tagged_members: ['r1', 'r2'] }],
      team_members: [{ id: 'r1', name: 'Steve Peterson' }],
    });
    shared.verifyUser.mockResolvedValue({ ok: true, admin, teamMemberId: 'r1' });
  });

  test('stores a real push subscription, refuses any other host', async () => {
    const good = { endpoint: 'https://web.push.apple.com/QGx', keys: { p256dh: 'BPkey_abcdefgh', auth: 'authkey123' } };
    expect((await call({ action: 'subscribe', subscription: good, platform: 'ios' })).statusCode).toBe(200);
    expect(admin.db.push_subscriptions).toEqual([expect.objectContaining({ team_member_id: 'r1', endpoint: good.endpoint, platform: 'ios' })]);
    const bad = await call({ action: 'subscribe', subscription: { ...good, endpoint: 'https://169.254.169.254/latest' } });
    expect(bad.statusCode).toBe(400);
    expect(admin.db.push_subscriptions).toHaveLength(1);
  });

  test('only a message’s author can notify, and the author is not notified', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
    const push = jest.spyOn(require('../../netlify/functions/_push'), 'safePush');
    shared.verifyUser.mockResolvedValueOnce({ ok: true, admin, teamMemberId: 'r2' });
    expect((await call({ action: 'mention', message_id: 'm1' })).statusCode).toBe(403);
    const r = await call({ action: 'mention', message_id: 'm1' });
    expect(r.statusCode).toBe(200);
    expect(admin.db.push_sent).toEqual([expect.objectContaining({ key: 'mention:m1' })]);
    push.mockRestore();
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  });
});
