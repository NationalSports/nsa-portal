/* QuickBooks token-refresh race regression (netlify/functions/_qb.js getValidAccessToken).
 *
 * Two concurrent calls can both see the same stale row and race the ROTATING
 * refresh token at Intuit — only one exchange wins; the loser's exchange fails
 * even though the winner already persisted a fresh access/refresh pair. The
 * fix re-reads the stored row on REFRESH_FAILED and, if it now differs from
 * what we started with (another caller won), uses that instead of forcing a
 * spurious "reconnect QuickBooks" failure.
 *
 * _qb.js is CommonJS and requires ./_shared for getSupabaseAdmin (only used to
 * re-export it — getValidAccessToken takes `admin` as a parameter), so we mock
 * that module path per the task's guidance even though this suite never calls
 * getSupabaseAdmin directly. The actual network leg (httpsPost, defined INSIDE
 * _qb.js) goes over node's `https` module, so that's what we mock to control
 * the Intuit token-exchange response.
 */

jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));

const https = require('https');
const qb = require('../../netlify/functions/_qb');

// Simulate one https.request(...) call's response: registers cb(res) synchronously
// (matching how httpsPost consumes it — res.on('data'/'end') inside the callback).
function mockExchange(status, dataObj) {
  https.request.mockImplementationOnce((options, cb) => {
    const res = {
      statusCode: status,
      on: (evt, handler) => {
        if (evt === 'data') handler(JSON.stringify(dataObj));
        if (evt === 'end') handler();
      },
    };
    cb(res);
    return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
  });
}

// Fake admin: qb_oauth_tokens.select().order().limit().maybeSingle() — each call
// consumes the next row in `rows` (last one repeats if exhausted), so a test can
// script "first read sees stale, second read (post-conflict) sees the winner".
function fakeAdmin(rows) {
  let i = 0;
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () => {
              const row = i < rows.length ? rows[i] : rows[rows.length - 1];
              i += 1;
              return Promise.resolve({ data: row, error: null });
            },
          }),
        }),
      }),
    }),
  };
}

const ACCESS_TTL_MS = 3300000; // 55 min, mirrors _qb.js
const STALE_TS = Date.now() - (ACCESS_TTL_MS + 5 * 60 * 1000); // comfortably stale
const staleRow = { realm_id: 'realm1', access_token: 'stale_at', refresh_token: 'stale_rt', token_created_at: STALE_TS };
const winnerRow = { realm_id: 'realm1', access_token: 'winner_at', refresh_token: 'winner_rt', token_created_at: Date.now() };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.QB_CLIENT_ID = 'client-id';
  process.env.QB_CLIENT_SECRET = 'client-secret';
});

describe('getValidAccessToken', () => {
  test('NOT_CONNECTED when no row is stored', async () => {
    const admin = fakeAdmin([null]);
    await expect(qb.getValidAccessToken(admin)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('fresh (non-stale) row is returned directly, no refresh attempted', async () => {
    const fresh = { realm_id: 'realm1', access_token: 'fresh_at', refresh_token: 'rt', token_created_at: Date.now() };
    const admin = fakeAdmin([fresh]);
    const result = await qb.getValidAccessToken(admin);
    expect(result).toEqual({ access_token: 'fresh_at', realm_id: 'realm1' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('refresh race: our exchange loses (REFRESH_FAILED) but a concurrent winner already ' +
    'rotated the token — returns the winner\'s fresh tokens instead of throwing', async () => {
    mockExchange(400, { error: 'invalid_grant', error_description: 'refresh token already used' });
    const admin = fakeAdmin([staleRow, winnerRow]); // 1st read: stale; re-read after failure: winner's row
    const result = await qb.getValidAccessToken(admin);
    expect(result).toEqual({ access_token: 'winner_at', realm_id: 'realm1' });
  });

  test('genuine refresh failure: re-read returns the SAME stale row → still throws REFRESH_FAILED', async () => {
    mockExchange(400, { error: 'invalid_grant' });
    const admin = fakeAdmin([staleRow, staleRow]); // no one else refreshed — row never changed
    await expect(qb.getValidAccessToken(admin)).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
  });

  test('genuine refresh failure: re-read also missing access_token → still throws REFRESH_FAILED', async () => {
    mockExchange(500, {});
    const admin = fakeAdmin([staleRow, { ...staleRow, access_token: null }]);
    await expect(qb.getValidAccessToken(admin)).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
  });

  test('re-read finds a DIFFERENT row but it is ALSO stale (not actually a fresher winner) → still throws', async () => {
    mockExchange(400, { error: 'invalid_grant' });
    const alsoStaleDifferent = { realm_id: 'realm1', access_token: 'other_stale_at', refresh_token: 'other_rt', token_created_at: STALE_TS };
    const admin = fakeAdmin([staleRow, alsoStaleDifferent]);
    await expect(qb.getValidAccessToken(admin)).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
  });

  test('successful refresh (no race) persists and returns the new tokens', async () => {
    mockExchange(200, { access_token: 'new_at', refresh_token: 'new_rt', expires_in: 3600 });
    const upserted = [];
    const admin = {
      from: () => ({
        select: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: staleRow, error: null }) }) }) }),
        upsert: (row) => { upserted.push(row); return Promise.resolve({ error: null }); },
      }),
    };
    const result = await qb.getValidAccessToken(admin);
    expect(result).toEqual({ access_token: 'new_at', realm_id: 'realm1' });
    expect(upserted[0]).toMatchObject({ realm_id: 'realm1', access_token: 'new_at', refresh_token: 'new_rt' });
  });
});
