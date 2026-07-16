/* Coach Crossover (Workstream 1) — Team Shop handoff tests.
 *
 * Function-level (netlify/functions/teamshop-handoff.js): same mocking style
 * as teamshopContext.test.js — _shared and _coachAuth are mocked so no real
 * credentials or network are ever touched. Covers: mint auth gating, the
 * 64-hex one-time code (only its sha256 stored), customer_id passthrough +
 * access check, exchange happy path (token_hash + email, row marked used),
 * replay → 410, expiry → 410, and the per-IP failure rate limit → 429.
 *
 * Client-side: a light TeamShopApp render with ?handoff=<code> asserting the
 * exchange is called, verifyOtp finishes the sign-in, and the param is
 * stripped from the URL (mock fetch + mocked ../lib/supabaseCoach). */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

const crypto = require('crypto');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── Mocks for the netlify function ───────────────────────────────────────────
let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));
const mockVerifyCoach = jest.fn();
const mockAccess = jest.fn();
jest.mock('../../netlify/functions/_coachAuth', () => ({
  verifyCoach: (...a) => mockVerifyCoach(...a),
  coachHasCustomerAccess: (...a) => mockAccess(...a),
}));
const handoff = require('../../netlify/functions/teamshop-handoff');

// ── Mock the coach supabase client for the TeamShopApp render ────────────────
// Plain functions (not jest.fn implementations) everywhere except verifyOtp:
// CRA's default resetMocks:true wipes jest.fn implementations before every
// test, so verifyOtp's behavior is (re)set in beforeEach below.
const mockVerifyOtp = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      verifyOtp: (...a) => mockVerifyOtp(...a),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({}),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => {
      const c = {
        select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c, ilike: () => c,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return c;
    },
  },
}));

// Stateful fake admin client: an in-memory teamshop_handoff_codes "table"
// whose update-claim honors the same WHERE predicates the real UPDATE uses
// (code_hash match, not used, not expired), so replay/expiry behave like the DB.
function makeAdmin(state) {
  return {
    auth: {
      admin: {
        generateLink: jest.fn(async () => (state.generateLinkFails
          ? { data: null, error: { message: 'boom' } }
          : { data: { properties: { hashed_token: 'hashed-token-abc' } }, error: null })),
      },
    },
    from(table) {
      if (table === 'teamshop_handoff_codes') {
        return {
          insert: (row) => { state.inserted.push(row); state.codes.push({ ...row, used_at: null }); return Promise.resolve({ data: null, error: null }); },
          update: (patch) => {
            const f = {};
            const chain = {
              eq: (col, v) => { f[col] = v; return chain; },
              is: () => chain, // used_at IS NULL — checked against the row below
              gt: (_col, v) => { f._now = v; return chain; },
              select: () => {
                const row = state.codes.find((r) => r.code_hash === f.code_hash && !r.used_at && r.expires_at > f._now);
                if (!row) return Promise.resolve({ data: [], error: null });
                row.used_at = patch.used_at;
                return Promise.resolve({ data: [{ coach_id: row.coach_id, customer_id: row.customer_id }], error: null });
              },
            };
            return chain;
          },
        };
      }
      const data = table === 'coach_accounts' ? state.coach : table === 'customers' ? state.customer : null;
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data, error: null }) };
      return chain;
    },
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: null };
const freshState = (over = {}) => ({
  inserted: [], codes: [],
  coach: COACH,
  customer: { alpha_tag: 'CHS', name: 'Central High' },
  ...over,
});

const call = (body, { ip = '1.2.3.4', auth = 'Bearer tok', method = 'POST' } = {}) => handoff.handler({
  httpMethod: method,
  headers: { authorization: auth, 'x-nf-client-connection-ip': ip },
  body: JSON.stringify(body),
});

beforeEach(() => {
  handoff._resetRateLimit();
  mockVerifyCoach.mockReset();
  mockAccess.mockReset();
  mockVerifyOtp.mockReset();
  mockVerifyOtp.mockImplementation(async () => ({ data: {}, error: null }));
});

describe('teamshop-handoff: guards', () => {
  test('rejects non-POST and unknown actions', async () => {
    mockAdmin = makeAdmin(freshState());
    expect((await call({}, { method: 'GET' })).statusCode).toBe(405);
    expect((await call({ action: 'nope' })).statusCode).toBe(400);
  });
});

describe('teamshop-handoff: mint', () => {
  test('requires coach auth', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    mockVerifyCoach.mockResolvedValue({ status: 401, error: 'Missing bearer token' });
    const r = await call({ action: 'mint' });
    expect(r.statusCode).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  test('returns a 64-hex code and stores only its sha256 with a ~60s expiry', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    mockVerifyCoach.mockResolvedValue({ coach: COACH });
    const before = Date.now();
    const r = await call({ action: 'mint' });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.token_hash).toBeUndefined(); // mint NEVER returns a sign-in credential
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row.code_hash).toBe(sha256(body.code));
    expect(row.coach_id).toBe('coach1');
    expect(row.customer_id).toBeNull();
    const ttl = new Date(row.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(55 * 1000);
    expect(ttl).toBeLessThanOrEqual(61 * 1000);
  });

  test('customer_id passes through only after coachHasCustomerAccess allows it', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    mockVerifyCoach.mockResolvedValue({ coach: COACH });
    mockAccess.mockResolvedValue({ ok: true });
    const r = await call({ action: 'mint', customer_id: 'custA' });
    expect(r.statusCode).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(mockAdmin, COACH, 'custA');
    expect(state.inserted[0].customer_id).toBe('custA');
  });

  test('customer_id the coach has no access to → 403, nothing stored', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    mockVerifyCoach.mockResolvedValue({ coach: COACH });
    mockAccess.mockResolvedValue({ ok: false });
    const r = await call({ action: 'mint', customer_id: 'custZ' });
    expect(r.statusCode).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });
});

describe('teamshop-handoff: exchange', () => {
  const seed = (state, code, over = {}) => state.codes.push({
    code_hash: sha256(code), coach_id: 'coach1', customer_id: 'custA',
    expires_at: new Date(Date.now() + 60 * 1000).toISOString(), used_at: null, ...over,
  });
  const CODE = 'ab'.repeat(32);

  test('valid code → token_hash + email + customer context, row marked used', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    seed(state, CODE);
    const r = await call({ action: 'exchange', code: CODE }, { auth: null });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.token_hash).toBe('hashed-token-abc');
    expect(body.email).toBe('coach@team.com');
    expect(body.customer_id).toBe('custA');
    expect(body.alpha_tag).toBe('CHS');
    expect(body.customer_name).toBe('Central High');
    expect(state.codes[0].used_at).toBeTruthy();
  });

  test('replay of a used code → 410 expired', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    seed(state, CODE);
    expect((await call({ action: 'exchange', code: CODE })).statusCode).toBe(200);
    const r2 = await call({ action: 'exchange', code: CODE });
    expect(r2.statusCode).toBe(410);
    expect(JSON.parse(r2.body).error).toBe('expired');
  });

  test('expired code → 410 expired', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    seed(state, CODE, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const r = await call({ action: 'exchange', code: CODE });
    expect(r.statusCode).toBe(410);
    expect(state.codes[0].used_at).toBeNull();
  });

  test('disabled coach at exchange time → same opaque 410', async () => {
    const state = freshState({ coach: { ...COACH, status: 'disabled' } });
    mockAdmin = makeAdmin(state);
    seed(state, CODE);
    expect((await call({ action: 'exchange', code: CODE })).statusCode).toBe(410);
  });

  test('after 5 failed exchanges from one IP within the window → 429', async () => {
    const state = freshState();
    mockAdmin = makeAdmin(state);
    for (let i = 0; i < 5; i++) {
      const r = await call({ action: 'exchange', code: 'ff'.repeat(32) }, { ip: '9.9.9.9' });
      expect(r.statusCode).toBe(410);
    }
    const blocked = await call({ action: 'exchange', code: 'ff'.repeat(32) }, { ip: '9.9.9.9' });
    expect(blocked.statusCode).toBe(429);
    // A different IP is unaffected — and a VALID code still works there.
    seed(state, CODE);
    const other = await call({ action: 'exchange', code: CODE }, { ip: '8.8.8.8' });
    expect(other.statusCode).toBe(200);
  });
});

// ── Client-side arrival ──────────────────────────────────────────────────────
describe('TeamShopApp ?handoff arrival', () => {
  const CODE = 'cd'.repeat(32);
  afterEach(() => { delete global.fetch; window.history.replaceState(null, '', '/'); window.sessionStorage.clear(); window.localStorage.clear(); });

  test('exchanges the code, verifies the OTP, and strips the param', async () => {
    window.history.replaceState(null, '', `/?handoff=${CODE}`);
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token_hash: 'hashed-token-abc', email: 'coach@team.com', customer_id: 'custA', customer_name: 'Central High', alpha_tag: 'CHS' }),
    }));
    const TeamShopApp = require('../teamshop/TeamShopApp').default;
    await act(async () => { render(<TeamShopApp />); });
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalledTimes(1));
    // Exchange carried the code in the POST body, never as a stored credential.
    const [url, opts] = global.fetch.mock.calls.find(([u]) => String(u).includes('teamshop-handoff'));
    expect(url).toBe('/.netlify/functions/teamshop-handoff');
    expect(JSON.parse(opts.body)).toEqual({ action: 'exchange', code: CODE });
    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: 'email', email: 'coach@team.com', token_hash: 'hashed-token-abc' });
    await waitFor(() => expect(window.location.search).not.toContain('handoff'));
    // Team context preselected via the existing nts_customer mechanism.
    expect(JSON.parse(window.localStorage.getItem('nts_customer'))).toEqual({ id: 'custA', name: 'Central High' });
    expect(window.sessionStorage.getItem('nts_connect_return')).toBe('CHS');
  });

  test('failed exchange strips the param and falls through silently', async () => {
    window.history.replaceState(null, '', `/?handoff=${CODE}`);
    global.fetch = jest.fn(async () => ({ ok: false, status: 410, json: async () => ({ error: 'expired' }) }));
    const TeamShopApp = require('../teamshop/TeamShopApp').default;
    await act(async () => { render(<TeamShopApp />); });
    await waitFor(() => expect(window.location.search).not.toContain('handoff'));
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('nts_connect_return')).toBeNull();
  });
});
