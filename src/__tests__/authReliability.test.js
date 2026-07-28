/* Auth/session reliability — pins the classification logic that decides whether a failed token
 * refresh signs the user out (PR: auth-reliability-fixes). The behavioral guarantee under test:
 * a transient/network refresh failure must NEVER be classified 'fatal', because 'fatal' is the only
 * path that force-logs-out — that misclassification was the "it randomly logged me out" bug. */
import { _classifyRefresh, _isAuthError, _isPermissionDenied } from '../lib/dbEngine';

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
