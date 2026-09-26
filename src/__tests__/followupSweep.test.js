/* Tests for the automated follow-up sweep's send-safety machinery.
 *
 * The sweep emails customers, so the properties under test are the ones that
 * prevent duplicate/runaway email: a row must be CLAIMED (CAS on follow_up_at)
 * before any send, a lost claim must mean no send, resolved docs stop without
 * sending, and every message carries a working unsubscribe link + header. */

jest.mock('../../netlify/functions/_shared', () => ({
  getSupabaseAdmin: () => global.__fakeAdmin,
}));

// Gmail route for districts that block Brevo — mocked so no real mail is sent.
jest.mock('../../netlify/functions/_gmailSend', () => ({
  sendViaGmail: jest.fn(async () => ({ status: 200, messageId: 'gmail:abc', via: 'sales' })),
}));
const { sendViaGmail } = require('../../netlify/functions/_gmailSend');

const sweep = require('../../netlify/functions/followup-sweep');

// Chainable fake: records every operation; a router decides each op's result.
function makeAdmin(route) {
  const ops = [];
  const admin = {
    ops,
    from(table) {
      const op = { table, kind: 'select', values: null, filters: [] };
      const chain = {
        select() { return chain; },
        update(vals) { op.kind = 'update'; op.values = vals; return chain; },
        eq(col, val) { op.filters.push([col, val]); return chain; },
        lte(col, val) { op.filters.push(['lte:' + col, val]); return chain; },
        in(col, val) { op.filters.push(['in:' + col, val]); return chain; },
        limit() { return chain; },
        not() { return chain; },
        order() { return chain; },
        range() { op.registry = true; return chain; },
        then(resolve, reject) {
          ops.push(op);
          return Promise.resolve(route(op) || { data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return admin;
}

const dueEstimate = (over = {}) => ({
  id: 'EST-1001', customer_id: 'c1', memo: 'Spring jerseys', status: 'sent',
  approved_at: null, deleted_at: null, created_by: 'rep1',
  follow_up_at: '2026-07-01T00:00:00+00:00', follow_up_auto: true,
  follow_up_interval_days: 3, follow_up_message: 'Just checking in!',
  follow_up_to: 'coach@example.com', follow_up_count: 0, follow_up_max: 4,
  follow_up_last_sent_at: null, sent_history: [], ...over,
});

function brevoFetchMock() {
  return jest.fn(async () => ({ ok: true, json: async () => ({ messageId: 'm-1' }) }));
}

async function runSweep(route) {
  global.__fakeAdmin = makeAdmin(route);
  const res = await sweep.handler();
  return { admin: global.__fakeAdmin, body: JSON.parse(res.body) };
}

describe('followup-sweep send safety', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';
    process.env.BREVO_API_KEY = 'test-brevo';
    process.env.URL = 'https://portal.test';
    global.fetch = brevoFetchMock();
  });

  test('claims before sending, then finalizes with the repeat cadence', async () => {
    const { admin, body } = await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate()] };
      if (op.kind === 'update' && op.table === 'estimates') return { data: [{ id: 'EST-1001' }], error: null };
      return { data: [] };
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body.estimate).toBe(1);
    const updates = admin.ops.filter((o) => o.kind === 'update' && o.table === 'estimates');
    // First update is the claim: CAS on the exact follow_up_at we read, gated on auto still on.
    expect(updates[0].filters).toEqual(expect.arrayContaining([
      ['id', 'EST-1001'],
      ['follow_up_at', '2026-07-01T00:00:00+00:00'],
      ['follow_up_auto', true],
    ]));
    // The claim itself must happen before the Brevo call ever fires — verified by the
    // second update (finalize) carrying the post-send bookkeeping.
    const fin = updates[1];
    expect(fin.values.follow_up_count).toBe(1);
    expect(fin.values.follow_up_last_sent_at).toBeTruthy();
    expect(new Date(fin.values.follow_up_at).getTime()).toBeGreaterThan(Date.now() + 2.5 * 86400000);
  });

  test('a district that blocked Brevo before gets the reminder through Gmail', async () => {
    sendViaGmail.mockImplementation(async () => ({ status: 200, messageId: 'gmail:abc', via: 'sales' }));
    const blocked = [{ sent_at: '2026-06-20', delivery: 'failed', delivery_event: 'hardBounces', delivery_to: 'other@district.k12.ca.us', delivery_reason: '550 permanent failure (other@district.k12.ca.us:blocked)' }];
    const { admin } = await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate({ follow_up_to: 'coach@district.k12.ca.us', sent_history: blocked })] };
      if (op.kind === 'update') return { data: [{ id: 'EST-1001' }], error: null };
      return { data: [] };
    });
    expect(global.fetch).not.toHaveBeenCalled(); // Brevo never called
    expect(sendViaGmail).toHaveBeenCalledTimes(1);
    expect(sendViaGmail.mock.calls[0][1].to).toEqual([{ email: 'coach@district.k12.ca.us' }]);
    const fin = admin.ops.filter((o) => o.kind === 'update' && o.table === 'estimates')[1];
    expect(fin.values.follow_up_count).toBe(1);
  });

  test('a mailbox that does not exist is not emailed again', async () => {
    const dead = [{ sent_at: '2026-06-20', delivery: 'failed', delivery_to: 'coach@example.com', delivery_reason: '550-5.1.1 The email account that you tried to reach does not exist.' }];
    await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate({ sent_history: dead })] };
      if (op.kind === 'update') return { data: [{ id: 'EST-1001' }], error: null };
      return { data: [] };
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sendViaGmail).not.toHaveBeenCalled();
  });

  test('lost claim (another invocation got the row) sends nothing', async () => {
    await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate()] };
      if (op.kind === 'update') return { data: [], error: null }; // CAS matched 0 rows
      return { data: [] };
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('resolved estimate is stopped without emailing', async () => {
    const { admin } = await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate({ status: 'approved' })] };
      if (op.kind === 'update') return { data: [{ id: 'EST-1001' }], error: null };
      return { data: [] };
    });
    expect(global.fetch).not.toHaveBeenCalled();
    const upd = admin.ops.find((o) => o.kind === 'update' && o.table === 'estimates');
    expect(upd.values).toEqual({ follow_up_auto: false, follow_up_at: null });
  });

  test('every email carries the unsubscribe footer link and one-click header', async () => {
    await runSweep((op) => {
      if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate()] };
      if (op.kind === 'update') return { data: [{ id: 'EST-1001' }], error: null };
      return { data: [] };
    });
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.htmlContent).toContain('followup-unsubscribe?t=estimates&amp;id=EST-1001&amp;sig=');
    expect(payload.headers['List-Unsubscribe']).toContain('followup-unsubscribe');
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('unsubscribe endpoint only accepts a valid signature and flips auto off', async () => {
    const { unsubToken } = require('../../netlify/functions/_followupShared');
    const unsub = require('../../netlify/functions/followup-unsubscribe');
    global.__fakeAdmin = makeAdmin(() => ({ data: [], error: null }));
    const bad = await unsub.handler({ queryStringParameters: { t: 'estimates', id: 'EST-1001', sig: 'wrong' } });
    expect(bad.statusCode).toBe(400);
    const evil = await unsub.handler({ queryStringParameters: { t: 'customers', id: 'c1', sig: unsubToken('customers', 'c1') } });
    expect(evil.statusCode).toBe(400); // table not in the follow-up allowlist
    const ok = await unsub.handler({ queryStringParameters: { t: 'estimates', id: 'EST-1001', sig: unsubToken('estimates', 'EST-1001') } });
    expect(ok.statusCode).toBe(200);
    const upd = global.__fakeAdmin.ops.find((o) => o.kind === 'update');
    expect(upd.table).toBe('estimates');
    expect(upd.values).toEqual({ follow_up_auto: false, follow_up_at: null });
    expect(upd.filters).toEqual([['id', 'EST-1001']]);
  });
});

test('reminders share district history from other documents and preserve Gmail unsubscribe headers', async () => {
  process.env.BREVO_API_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';
  global.fetch = brevoFetchMock();
  sendViaGmail.mockResolvedValue({ status: 200, messageId: 'gmail:abc' });
  await runSweep((op) => {
    if (op.registry && op.table === 'invoices') return { data: [{ id: 'old', sent_history: [{ delivery: 'failed', delivery_to: 'old@district.edu', delivery_reason: 'sender blocked' }] }] };
    if (op.registry) return { data: [] };
    if (op.kind === 'select' && op.table === 'estimates') return { data: [dueEstimate({ follow_up_to: 'new@district.edu' })] };
    if (op.kind === 'update') return { data: [{ id: 'EST-1001' }] };
    return { data: [] };
  });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(sendViaGmail.mock.calls[0][1].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
});
