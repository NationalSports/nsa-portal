/* Ingest/action-endpoint hardening (WS-scoped audit).
 *
 * Covers 5 of the listed endpoints: omg-store-ingest, omg-packing-slip-ingest,
 * capture-so-save, followup-unsubscribe, onboarding-public. Skipped (one-line
 * reasons):
 *   - omg-player-report-ingest: same verifyUser + shadow-store pattern as
 *     omg-packing-slip-ingest, already covered; would be duplicate coverage.
 *   - job-scan: dual-auth (verifyUser OR PROD_SCAN_TOKEN) is a variant of the
 *     verifyUser gate already exercised three times below.
 *   - portal-action: gate is ownership-scoping (alphaTag family), not a
 *     credential check — covered qualitatively as "no missing/wrong credential
 *     to test" below; onboarding-public's token-gate gives equivalent coverage
 *     of a capability-token pattern.
 *   - quote-portal: same token-in-body pattern as onboarding-public, would be
 *     duplicate coverage.
 *
 * Auth verdicts (see describe blocks for evidence):
 *   omg-store-ingest        : verifyUser (staff JWT via Supabase Auth) — gate holds.
 *   omg-packing-slip-ingest : verifyUser — gate holds.
 *   capture-so-save         : verifyUser — gate holds.
 *   followup-unsubscribe    : per-document HMAC token (by design, no login) — gate holds.
 *   onboarding-public       : single-use DB-stored invite token (by design, no login) — gate holds.
 * None of the 5 covered functions write to the DB with NO auth gate at all.
 *
 * ONE CRASH FOUND (headlined in the final report): omg-store-ingest throws an
 * UNCAUGHT TypeError (rejected promise, not a clean 4xx) when reportUrl is a
 * non-string — `reportUrl.match(...)` at omg-store-ingest.js:41 runs OUTSIDE
 * the JSON.parse try/catch. See the FIXME test in that describe block.
 * (omg-packing-slip-ingest has a similar-looking unguarded `o.orderNumber`
 * access, but it sits inside the handler's outer try/catch, so a null order
 * entry is caught and returns a clean 500 — verified below, not a bug.)
 */

process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ONBOARDING_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.FOLLOWUP_UNSUB_SECRET = 'test-unsub-secret';

// Single mock for the whole file: override verifyUser/getSupabaseAdmin, keep
// every other _shared export real (corsHeaders, getSiteUrl, syncOrderItems, …)
// so functions that lean on those still behave normally on the paths we don't
// short-circuit.
jest.mock('../../netlify/functions/_shared', () => {
  const actual = jest.requireActual('../../netlify/functions/_shared');
  return { ...actual, verifyUser: jest.fn(), getSupabaseAdmin: jest.fn() };
});
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const shared = require('../../netlify/functions/_shared');
const { createClient } = require('@supabase/supabase-js');

// Scripted fake supabase client (same style as teamshopCheckout.test.js's fakeSb):
// results are consumed in order per "table.op" key; every call is recorded so
// tests can assert what was (not) written.
function fakeSb(script) {
  const calls = [];
  const nextResult = (key, call) => {
    const queue = script[key] || [];
    const result = queue.length ? queue.shift() : { data: null, error: null };
    call.result = result;
    return result;
  };
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          upload: (path, buf, opts) => {
            const call = { table: 'storage.' + bucket, op: 'upload', payload: { path, bytes: buf && buf.length, opts } };
            calls.push(call);
            return Promise.resolve(nextResult('storage.' + bucket + '.upload', call));
          },
          remove: (paths) => {
            const call = { table: 'storage.' + bucket, op: 'remove', payload: { paths } };
            calls.push(call);
            return Promise.resolve(nextResult('storage.' + bucket + '.remove', call));
          },
        };
      },
    },
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col, val) => { call.filters.push([col, val]); return chain; },
        neq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain, not: () => chain,
        single: () => Promise.resolve(nextResult(table + '.' + call.op, call)),
        maybeSingle: () => Promise.resolve(nextResult(table + '.' + call.op, call)),
        insert: (payload) => { call.op = 'insert'; call.payload = payload; return chain; },
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        upsert: (payload) => { call.op = 'upsert'; call.payload = payload; return chain; },
        delete: () => { call.op = 'delete'; return chain; },
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}
const writesOf = (sb) => sb.calls.filter((c) => c.op === 'insert' || c.op === 'update' || c.op === 'upsert' || c.op === 'delete' || c.op === 'upload');

const post = (body, headers, query) => ({
  httpMethod: 'POST',
  headers: headers || {},
  queryStringParameters: query || {},
  body: typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body),
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── omg-store-ingest.js ──────────────────────────────────────────────────
// Auth: verifyUser (staff Bearer JWT via Supabase Auth). Writes go through
// RAW fetch() to the Supabase REST API (no supabase-js client), so we spy on
// global.fetch instead of a mocked admin client — the write channel here.
describe('omg-store-ingest — auth gate + body hardening', () => {
  const { handler } = require('../../netlify/functions/omg-store-ingest');
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' });
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  test('missing/wrong credential → rejected BEFORE any fetch (no DB write)', async () => {
    shared.verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await handler(post({ reportUrl: 'https://report.ordermygear.com/48ff450f-0000-0000-0000-000000000000' }));
    expect(res.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('malformed JSON body → clean 400, not a throw', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const res = await handler(post('{not valid json'));
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // FIXME (found bug, NOT fixed here — reported instead): reportUrl.match() at
  // netlify/functions/omg-store-ingest.js:41 runs OUTSIDE the JSON.parse try/catch.
  // A non-string reportUrl (e.g. a number) makes body.reportUrl truthy, so the `|| ''`
  // fallback never kicks in, and `reportUrl.match` throws a TypeError that is never
  // caught anywhere in the handler — an UNCAUGHT crash (rejected promise), not the
  // clean 4xx every other bad-input path returns.
  test('reportUrl of the wrong type returns a clean 400, not an uncaught TypeError (regression)', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const res = await handler(post({ reportUrl: 12345 }));
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── omg-packing-slip-ingest.js ───────────────────────────────────────────
// Auth: verifyUser. Writes via a supabase-js client built with createClient
// AFTER the auth check — so if auth fails, createClient itself is never
// invoked, which we assert directly.
describe('omg-packing-slip-ingest — auth gate + body hardening', () => {
  const { handler } = require('../../netlify/functions/omg-packing-slip-ingest');

  test('missing/wrong credential → rejected BEFORE the admin client is even created', async () => {
    shared.verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await handler(post({ saleCode: 'WVD87', orders: [{ orderNumber: '1' }] }));
    expect(res.statusCode).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  test('malformed JSON body → clean 400, not a throw', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    createClient.mockReturnValue(fakeSb({}));
    const res = await handler(post('{not valid json'));
    expect(res.statusCode).toBe(400);
  });

  test('missing required fields (no saleCode / no orders) → clean 400, no write', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const sb = fakeSb({});
    createClient.mockReturnValue(sb);
    const res1 = await handler(post({ orders: [{ orderNumber: '1' }] })); // no saleCode
    expect(res1.statusCode).toBe(400);
    const res2 = await handler(post({ saleCode: 'WVD87', orders: [] })); // no orders
    expect(res2.statusCode).toBe(400);
    expect(writesOf(sb)).toHaveLength(0);
  });

  // Adversarial: an unknown/null order entry. `o.orderNumber` on netlify/functions/
  // omg-packing-slip-ingest.js:97 has no null-guard on `o` itself, but the whole loop
  // runs inside the handler's outer try/catch, so this is safely caught and turned
  // into a 500 rather than an uncaught crash — confirms the guard, not a bug.
  test('adversarial payload: an unknown/null order entry is caught cleanly, not a crash', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const sb = fakeSb({
      'webstores.select': [{ data: { id: 'st1', omg_sale_code: 'WVD87' }, error: null }],
      'omg_store_products.select': [{ data: [], error: null }],
    });
    createClient.mockReturnValue(sb);
    const res = await handler(post({ saleCode: 'WVD87', orders: [null] }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/orderNumber/);
    expect(writesOf(sb)).toHaveLength(0);
  });
});

// ── capture-so-save.js ───────────────────────────────────────────────────
// Auth: verifyUser. Writes via getSupabaseAdmin() from _shared, called AFTER
// the auth + body checks — asserted directly (mock not invoked on 401).
describe('capture-so-save — auth gate + body hardening', () => {
  const { handler } = require('../../netlify/functions/capture-so-save');

  test('missing/wrong credential → rejected BEFORE the admin client is touched', async () => {
    shared.verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await handler(post({ so_id: 'so1', payload: {} }));
    expect(res.statusCode).toBe(401);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('malformed JSON body → clean 400, not a throw', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const res = await handler(post('{not valid json'));
    expect(res.statusCode).toBe(400);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('missing so_id/payload → clean 400, no write', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const sb = fakeSb({});
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post({ so_id: 'so1' })); // payload missing
    expect(res.statusCode).toBe(400);
  });

  // Adversarial: wrong-typed so_id (object instead of a string/uuid). The function
  // does no type validation and hands it straight to .eq(); it must not crash —
  // it should just fail to match anything downstream and return cleanly.
  test('adversarial payload: wrong-typed so_id does not crash the handler', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, userId: 'u1' });
    const sb = fakeSb({
      'so_items.select': [{ data: [], error: null }],
      'sales_orders.select': [{ data: null, error: null }],
      'so_save_audit.insert': [{ data: null, error: null }],
    });
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post({ so_id: { $ne: null }, payload: { oversized: 'x'.repeat(5000) } }));
    expect(res.statusCode).toBe(200);
    const insertCall = sb.calls.find((c) => c.op === 'insert');
    expect(insertCall.table).toBe('so_save_audit');
  });
});

// ── followup-unsubscribe.js ──────────────────────────────────────────────
// Auth: per-document HMAC token (t/id/sig query params) — by design, no login
// (the recipient is a customer, not a staff/portal user; worst case for a
// leaked link is a reminder being silenced). getSupabaseAdmin() is only
// reached once the signature checks out.
describe('followup-unsubscribe — token gate + query-param hardening', () => {
  const { handler } = require('../../netlify/functions/followup-unsubscribe');
  const { unsubToken } = require('../../netlify/functions/_followupShared');
  const get = (query) => ({ httpMethod: 'GET', queryStringParameters: query || {} });

  test('missing/wrong signature → rejected BEFORE the admin client is touched', async () => {
    const res = await handler(get({ t: 'estimates', id: 'e1', sig: 'not-the-real-sig' }));
    expect(res.statusCode).toBe(400);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('missing query params → clean 400 (this endpoint has no JSON body — the query string IS the request)', async () => {
    const res = await handler(get({}));
    expect(res.statusCode).toBe(400);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('table not in the allowlist, even with a validly-shaped sig, is rejected before any write', async () => {
    const sig = unsubToken('team_members', 'tm1'); // correctly computed for a DISALLOWED table
    const res = await handler(get({ t: 'team_members', id: 'tm1', sig }));
    expect(res.statusCode).toBe(400);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  // Adversarial: a valid signature but a long/garbage id — must not crash, and the
  // write must use exactly the id from the query string (no injection/broadening).
  test('adversarial payload: garbage/oversized id with a valid sig updates only that exact id, no crash', async () => {
    const weirdId = "1' OR '1'='1--" + 'x'.repeat(500);
    const sig = unsubToken('estimates', weirdId);
    const sb = fakeSb({ 'estimates.update': [{ data: null, error: null }] });
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(get({ t: 'estimates', id: weirdId, sig }));
    expect(res.statusCode).toBe(200);
    const updateCall = sb.calls.find((c) => c.op === 'update');
    expect(updateCall.filters).toEqual([['id', weirdId]]);
    expect(updateCall.payload).toEqual({ follow_up_auto: false, follow_up_at: null });
  });
});

// ── onboarding-public.js ─────────────────────────────────────────────────
// Auth: single-use DB-stored invite token (not a JWT — the hire isn't a
// logged-in user). getSupabaseAdmin() is unconditionally created (it's how
// the token itself gets looked up), but the token check is the first DB call
// and every WRITE happens strictly after it resolves to a valid invite.
describe('onboarding-public — token gate + body hardening', () => {
  const { handler } = require('../../netlify/functions/onboarding-public');
  const INVITE = { id: 'inv1', status: 'invited', full_name: 'A B', personal_email: 'a@b.com' };

  test('unknown/wrong token → clean ok:false BEFORE any write (only the lookup read happens)', async () => {
    const sb = fakeSb({ 'onboarding_invites.select': [{ data: null, error: null }] });
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post({ token: 'bogus-token', action: 'save', data: { x: 1 } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'not_found' });
    expect(writesOf(sb)).toHaveLength(0);
  });

  test('malformed JSON body → clean 400, not a throw', async () => {
    const sb = fakeSb({});
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post('{not valid json'));
    expect(res.statusCode).toBe(400);
    expect(writesOf(sb)).toHaveLength(0);
  });

  test('missing token → clean 400, no lookup, no write', async () => {
    const sb = fakeSb({});
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post({ action: 'load' }));
    expect(res.statusCode).toBe(400);
    expect(sb.calls).toHaveLength(0);
  });

  // Adversarial: an oversized file upload — the size guard must reject it BEFORE
  // touching storage or the documents table, and must not crash on the huge payload.
  test('adversarial payload: oversized upload is rejected (413) before storage/DB write', async () => {
    const bigB64 = Buffer.alloc(5 * 1024 * 1024).toString('base64'); // > 4.5MB cap
    const sb = fakeSb({
      'onboarding_invites.select': [{ data: INVITE, error: null }],
      'onboarding_submissions.select': [{ data: null, error: null }],
    });
    shared.getSupabaseAdmin.mockReturnValue(sb);
    const res = await handler(post({ token: 'good-token', action: 'upload', kind: 'id_front', filename: 'x.jpg', content_type: 'image/jpeg', data_base64: bigB64 }));
    expect(res.statusCode).toBe(413);
    expect(writesOf(sb)).toHaveLength(0);
  });
});
