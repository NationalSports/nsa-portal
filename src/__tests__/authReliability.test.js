/* Auth/session reliability — pins the classification logic that decides whether a failed token
 * refresh signs the user out (PR: auth-reliability-fixes). The behavioral guarantee under test:
 * a transient/network refresh failure must NEVER be classified 'fatal', because 'fatal' is the only
 * path that force-logs-out — that misclassification was the "it randomly logged me out" bug. */
import { _classifyRefresh, _isAuthError, _isLiveSession, _isPermissionDenied, _handleAuthSaveFailure, _permDenialParked, _clearSaveError, _dbSaveFailedIds } from '../lib/dbEngine';

describe('_isLiveSession — expired storage objects never bypass re-auth', () => {
  const now = 2_000_000_000;

  test('accepts only a bearer session whose expiry is in the future', () => {
    expect(_isLiveSession({ access_token: 'fresh', expires_at: now + 60 }, now)).toBe(true);
  });

  test('rejects expired, malformed, and missing sessions', () => {
    expect(_isLiveSession({ access_token: 'expired', expires_at: now - 1 }, now)).toBe(false);
    expect(_isLiveSession({ access_token: 'missing-expiry' }, now)).toBe(false);
    expect(_isLiveSession({ expires_at: now + 60 }, now)).toBe(false);
    expect(_isLiveSession(null, now)).toBe(false);
  });
});

describe('_classifyRefresh — transient failures never force logout', () => {
  test('ok: refresh returned a session with no error', () => {
    expect(_classifyRefresh(null, { access_token: 'x' }, false)).toBe('ok');
  });

  test('transient: a THROWN error (Failed to fetch) is always transient, never fatal', () => {
    expect(_classifyRefresh(new Error('Failed to fetch'), null, true)).toBe('transient');
    // even a scary-looking thrown error is transient — a throw is a transport failure, not a rejection
    expect(_classifyRefresh(new Error('anything'), null, true)).toBe('transient');
  });

  test('transient: a returned network-class error is transient', () => {
    expect(_classifyRefresh({ message: 'Network request failed' }, null, false)).toBe('transient');
    expect(_classifyRefresh({ message: 'load failed' }, null, false)).toBe('transient');
    expect(_classifyRefresh({ error: { message: 'ERR_SSL_PROTOCOL_ERROR' } }, null, false)).toBe('transient');
  });

  test('fatal: an authoritative refresh-token rejection', () => {
    // GoTrue's real rejection messages for a dead/rotated refresh token
    expect(_classifyRefresh({ message: 'Invalid Refresh Token: Already Used' }, null, false)).toBe('fatal');
    expect(_classifyRefresh({ message: 'refresh_token_not_found' }, null, false)).toBe('fatal');
    expect(_classifyRefresh({ status: 400, message: 'invalid_grant' }, null, false)).toBe('fatal');
  });

  test('fatal: no error but no session — the session is genuinely gone', () => {
    expect(_classifyRefresh(null, null, false)).toBe('fatal');
  });
});

describe('_isAuthError classification', () => {
  test('true for expired/degraded-session shapes', () => {
    expect(_isAuthError({ status: 401 })).toBe(true);
    expect(_isAuthError({ code: '401' })).toBe(true);
    expect(_isAuthError({ code: 'PGRST301' })).toBe(true);
    expect(_isAuthError({ code: '42501' })).toBe(true);
    expect(_isAuthError({ message: 'JWT expired' })).toBe(true);
    expect(_isAuthError({ message: 'new row violates row-level security policy' })).toBe(true);
    expect(_isAuthError({ message: 'No API key found in request' })).toBe(true);
  });

  test('false for ordinary DB errors and empty input', () => {
    expect(_isAuthError(null)).toBe(false);
    expect(_isAuthError({ message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(_isAuthError({ code: '23505' })).toBe(false);
  });
});

describe('_isPermissionDenied — terminal RLS denial vs recoverable expiry', () => {
  test('true for a genuine permission denial on a valid session', () => {
    expect(_isPermissionDenied({ code: '42501' })).toBe(true);
    expect(_isPermissionDenied({ message: 'new row violates row-level security policy for table "app_state"' })).toBe(true);
    expect(_isPermissionDenied({ message: 'permission denied for table team_members' })).toBe(true);
  });

  test('false when the same RLS-shaped error carries an expiry marker (recoverable)', () => {
    // an expired token degraded to anon also trips row-level-security — but it IS refreshable, so it
    // must NOT be classified as a terminal permission denial
    expect(_isPermissionDenied({ message: 'JWT expired: row-level security policy violated' })).toBe(false);
    expect(_isPermissionDenied({ message: 'not authenticated' })).toBe(false);
    expect(_isPermissionDenied({ code: 'PGRST301' })).toBe(false);
    expect(_isPermissionDenied(null)).toBe(false);
    expect(_isPermissionDenied({ message: 'duplicate key' })).toBe(false);
  });
});

/* Terminal-denial retry cap (2026-08-03 RLS-storm root cause). A perm=true save failure — the anon/wrong
 * role hitting a staff-only RLS policy — cannot be fixed by a refresh, so the background retry drivers
 * (App.js doRetry / onVis) replayed it every 60s→4min forever: one zombie tab looped the SO-save graph
 * against RLS for 16+ hours. _handleAuthSaveFailure counts consecutive perm denials per id and parks the
 * id after the cap so the drivers stop re-POSTing. The behavioral guarantees:
 *   1. a perm=true streak parks ONLY after the cap (not on the first failure),
 *   2. a recoverable expiry (perm=false) resets the streak — a flapping-then-recovering session can't
 *      accumulate its way to a park,
 *   3. a successful save (_clearSaveError) un-parks so the id can retry again.
 * The edit is never dropped by parking — this suite pins the retry gate only. */
describe('_permDenialParked — bounds the perm-denial retry storm without losing the edit', () => {
  const perm = { code: '42501', message: 'new row violates row-level security policy for table "sales_orders"' };
  const expired = { message: 'JWT expired' };
  const cleanup = (id) => { _clearSaveError(id); _dbSaveFailedIds.delete(id); };

  test('a single perm denial does NOT park — genuine expiries get time to recover', () => {
    const id = 'SO-park-1';
    _handleAuthSaveFailure(id, perm);
    expect(_permDenialParked(id)).toBe(false);
    cleanup(id);
  });

  test('parks only after the cap of consecutive perm denials', () => {
    const id = 'SO-park-2';
    for (let i = 0; i < 4; i++) _handleAuthSaveFailure(id, perm);
    expect(_permDenialParked(id)).toBe(false); // 4 < cap(5)
    _handleAuthSaveFailure(id, perm);
    expect(_permDenialParked(id)).toBe(true);  // 5th trips it
    cleanup(id);
  });

  test('a recoverable expiry resets the streak — no park by accumulation across a flap', () => {
    const id = 'SO-park-3';
    for (let i = 0; i < 4; i++) _handleAuthSaveFailure(id, perm);
    _handleAuthSaveFailure(id, expired); // perm=false → reset
    for (let i = 0; i < 4; i++) _handleAuthSaveFailure(id, perm);
    expect(_permDenialParked(id)).toBe(false); // only 4 since the reset
    cleanup(id);
  });

  test('a successful save (_clearSaveError) un-parks the id', () => {
    const id = 'SO-park-4';
    for (let i = 0; i < 5; i++) _handleAuthSaveFailure(id, perm);
    expect(_permDenialParked(id)).toBe(true);
    _clearSaveError(id); // save succeeded / id removed
    expect(_permDenialParked(id)).toBe(false);
    _dbSaveFailedIds.delete(id);
  });

  test('ids are parked independently', () => {
    const a = 'SO-park-5a', b = 'SO-park-5b';
    for (let i = 0; i < 5; i++) _handleAuthSaveFailure(a, perm);
    _handleAuthSaveFailure(b, perm);
    expect(_permDenialParked(a)).toBe(true);
    expect(_permDenialParked(b)).toBe(false);
    cleanup(a); cleanup(b);
  });
});

/* Dead-login detection gates (2026-07-28 conflict-card storm). _expectsStaffSession decides whether a
 * permission-denied read / missing session may trigger recovery → forced re-login. It must be TRUE for
 * a staff browser (nsa_user cached) and FALSE otherwise — the anonymous coach portal must never be
 * bounced to the staff login screen (that regression broke every portal link once already). */
describe('_expectsStaffSession — staff tabs recover, coach portal is never bounced', () => {
  const { _expectsStaffSession } = require('../lib/dbEngine');
  afterEach(() => localStorage.removeItem('nsa_user'));

  test('false with no cached staff login (coach portal / logged-out visitor)', () => {
    localStorage.removeItem('nsa_user');
    expect(_expectsStaffSession()).toBe(false);
  });

  test('true when a staff login is cached (jsdom host is not a Netlify preview)', () => {
    localStorage.setItem('nsa_user', JSON.stringify({ id: 'u1', name: 'Rep' }));
    expect(_expectsStaffSession()).toBe(true);
  });
});

/* signOut scope pin (root cause of the 2026-07-28 session-death storm): supabase-js defaults
 * signOut to scope:'global', which revokes the user's refresh tokens on EVERY device. With shared
 * warehouse logins plus the 1-hour idle auto-logout, one idle tab killed every sibling station's
 * session. Every signOut call site must pass an explicit scope so the default can never sneak back. */
describe("auth.signOut call sites always pass an explicit scope (never the global default)", () => {
  const fs = require('fs');
  const path = require('path');
  const glob = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) glob(p, out);
      else if (/\.(js|jsx)$/.test(e.name) && !p.includes('__tests__')) out.push(p);
    }
    return out;
  };
  test('every auth.signOut( call in src/ carries a scope option', () => {
    const offenders = [];
    for (const f of glob(path.join(__dirname, '..'))) {
      const src = fs.readFileSync(f, 'utf8');
      const re = /auth\.signOut\(([^)]*)\)/g;
      let m;
      while ((m = re.exec(src))) { if (!/scope/.test(m[1])) offenders.push(f + ': ' + m[0]); }
    }
    expect(offenders).toEqual([]);
  });
});
