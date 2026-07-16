/* Unit tests for the coach-facing Team Shop art function (logo list + upload).
 * Same mocking style as teamshopContext.test.js: a fake supabase admin client,
 * with _shared mocked so getSupabaseAdmin never needs real credentials. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const teamshopArt = require('../../netlify/functions/teamshop-art');

// Minimal chainable supabase stub (teamshopContext.test.js shape, extended with
// insert + a storage mock so the upload path is exercisable). insert() captures
// the row so tests can assert exactly what would be written.
function fakeSb(tables, user, storage) {
  const inserted = {}; // table -> last inserted row
  const sb = {
    _inserted: inserted,
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
    storage: storage || { from: () => ({ upload: async () => ({ data: null, error: { message: 'no storage mock' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain,
        insert: (row) => { inserted[table] = Array.isArray(row) ? row[0] : row; return chain; },
        maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
  return sb;
}

// Storage mock that records the upload and mints a deterministic public URL.
function fakeStorage() {
  const calls = { uploads: [] };
  return {
    calls,
    from: (bucket) => ({
      upload: async (path, buf, opts) => { calls.uploads.push({ bucket, path, size: buf.length, opts }); return { data: { path }, error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: 'custA', auth_user_id: 'auth1' };

// A staff art_files entry carrying internal fields that must NOT reach a coach.
const RAW_ART = {
  id: 'caf1', name: 'Front Crest', deco_type: 'embroidery', stitches: 5200,
  notes: 'INTERNAL: redigitize before next run',
  status: 'approved',
  files: [{ url: 'https://cdn.test/art/front-crest.png', storage_path: 'secret/internal/path.png' }],
  mockup_files: ['https://cdn.test/mock/front.png'],
  prod_files: [{ url: 'https://cdn.test/prod/front.dst' }],
};

const LOGO_ROW = { id: 'tsl1', name: 'Alt Logo', url: 'https://cdn.test/artwork/teamshop/custA/x.png', file_type: 'image/png', width: 300, height: 200, deco_hint: null, created_at: '2026-07-01T00:00:00Z' };

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [], error: null },
  customers: { data: [{ art_files: [RAW_ART] }], error: null },
  teamshop_logos: { data: [LOGO_ROW], error: null },
  ...over,
});

// 1x1 red PNG (67 bytes) — real header so the dimension probe has bytes to read.
const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
  '7753de0000000c4944415408d763f8cfc0000000030001',
  'hex'
).toString('base64');

const call = ({ body = {}, user = { id: 'auth1', email: 'coach@team.com' }, tables = baseTables(), storage, auth = 'Bearer tok', method = 'POST' } = {}) => {
  mockAdmin = fakeSb(tables, user, storage);
  return teamshopArt.handler({ httpMethod: method, headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
};

const listBody = { action: 'list', customer_id: 'custA' };
const uploadBody = { action: 'upload', customer_id: 'custA', name: 'New Logo', file_base64: PNG_1x1, mime: 'image/png' };

describe('method guard', () => {
  test('rejects non-POST', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(405);
  });
});

describe('auth gating', () => {
  test('rejects a missing bearer token', async () => {
    const r = await call({ body: listBody, auth: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const r = await call({ body: listBody, user: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects a signed-in user with no coach account', async () => {
    const r = await call({ body: listBody, tables: baseTables({ coach_accounts: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('rejects an unknown action', async () => {
    const r = await call({ body: { action: 'nuke', customer_id: 'custA' } });
    expect(r.statusCode).toBe(400);
  });
});

describe('customer access gating', () => {
  // Coach whose account points at custA (and no access rows): custB must 403.
  const noAccess = { body: { ...listBody, customer_id: 'custB' } };

  test('list rejects a customer the coach has no access to', async () => {
    const r = await call(noAccess);
    expect(r.statusCode).toBe(403);
  });

  test('upload rejects a customer the coach has no access to', async () => {
    const r = await call({ body: { ...uploadBody, customer_id: 'custB' }, storage: fakeStorage() });
    expect(r.statusCode).toBe(403);
  });
});

describe('list', () => {
  test('unions the staff art library with teamshop uploads, tagged by source', async () => {
    const r = await call({ body: listBody });
    expect(r.statusCode).toBe(200);
    const { logos } = JSON.parse(r.body);
    expect(logos.map((l) => l.source)).toEqual(['art_library', 'teamshop']);
    expect(logos[1]).toEqual({ ...LOGO_ROW, source: 'teamshop' });
  });

  test('art_files entries are stripped to id/name/url/deco_type/stitches only', async () => {
    const r = await call({ body: listBody });
    const lib = JSON.parse(r.body).logos.find((l) => l.source === 'art_library');
    expect(lib).toEqual({
      id: 'caf1', name: 'Front Crest', url: 'https://cdn.test/art/front-crest.png',
      deco_type: 'embroidery', stitches: 5200, source: 'art_library',
    });
    // Internal fields must never leak, on the entry or anywhere in the payload.
    expect(lib.notes).toBeUndefined();
    expect(lib.status).toBeUndefined();
    expect(r.body).not.toContain('INTERNAL');
    expect(r.body).not.toContain('secret/internal/path.png');
  });

  test('library entries with no renderable file are dropped', async () => {
    const tables = baseTables({ customers: { data: [{ art_files: [{ id: 'x', name: 'TBD', files: [], mockup_files: [] }] }], error: null } });
    const r = await call({ body: listBody, tables });
    expect(JSON.parse(r.body).logos.map((l) => l.source)).toEqual(['teamshop']);
  });
});

describe('upload validation', () => {
  test('rejects a disallowed mime type', async () => {
    const r = await call({ body: { ...uploadBody, mime: 'text/html' }, storage: fakeStorage() });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/file type/i);
  });

  test('rejects a decoded payload over 10MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
    const r = await call({ body: { ...uploadBody, file_base64: big }, storage: fakeStorage() });
    expect(r.statusCode).toBe(413);
  });

  test('rejects empty file data', async () => {
    const r = await call({ body: { ...uploadBody, file_base64: '' }, storage: fakeStorage() });
    expect(r.statusCode).toBe(400);
  });
});

describe('upload success path', () => {
  test('writes to the artwork bucket under a server-built teamshop path and inserts the row', async () => {
    const storage = fakeStorage();
    // Insert echo: the handler re-selects the inserted row; canned result stands in for it.
    const tables = baseTables({ teamshop_logos: { data: [{ ...LOGO_ROW, name: 'New Logo' }], error: null } });
    const r = await call({ body: uploadBody, storage, tables });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.logo.source).toBe('teamshop');

    // Storage write: artwork bucket, server-constructed path — never client input.
    expect(storage.calls.uploads).toHaveLength(1);
    const up = storage.calls.uploads[0];
    expect(up.bucket).toBe('artwork');
    expect(up.path).toMatch(/^teamshop\/custA\/[0-9a-f-]{36}\.png$/);
    expect(up.opts).toEqual({ contentType: 'image/png', upsert: false });

    // Inserted row: coach + customer stamped server-side, public URL from the bucket,
    // dimensions probed from the real PNG header (1x1).
    const row = mockAdmin._inserted.teamshop_logos;
    expect(row.customer_id).toBe('custA');
    expect(row.coach_id).toBe('coach1');
    expect(row.name).toBe('New Logo');
    expect(row.storage_path).toBe(up.path);
    expect(row.url).toBe(`https://cdn.test/storage/v1/object/public/artwork/${up.path}`);
    expect(row.file_type).toBe('image/png');
    expect(row.width).toBe(1);
    expect(row.height).toBe(1);
  });

  test('sanitizes the logo name (control chars stripped, capped at 120)', async () => {
    const storage = fakeStorage();
    const r = await call({ body: { ...uploadBody, name: 'Bad\u0000\u0007 Name ' + 'x'.repeat(300) }, storage });
    expect(r.statusCode).toBe(200);
    const row = mockAdmin._inserted.teamshop_logos;
    expect(row.name.startsWith('Bad Name x')).toBe(true);
    expect(row.name.length).toBeLessThanOrEqual(120);
    expect(/[\u0000-\u001f\u007f]/.test(row.name)).toBe(false);
  });
});
