/* Unit tests for the Top Star digitizing vendor portal function
 * (netlify/functions/vendor-digitizing.js). Same mocking style as
 * teamshopArt.test.js: a fake supabase admin client, with _shared mocked so
 * getSupabaseAdmin never needs real credentials. The fake chain records every
 * select/eq/in/not call so the queue predicate can be asserted directly, and
 * every update/rpc call so the auto-complete flip and the digitizing_received
 * RPC shape can be asserted too. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const vendorDigitizing = require('../../netlify/functions/vendor-digitizing');

const TOKEN = 'topstar-secret-token';

// Minimal chainable supabase stub. Every from(table) call gets its own recorder
// (pushed to admin._queries) so a test can assert exactly which filters a query
// used — the queue predicate in particular. update() calls resolve separately
// and are recorded in admin._updates so the auto-complete write path is
// assertable without a real database.
function fakeAdmin(tables = {}, rpcResult) {
  const updates = [];
  const rpcCalls = [];
  const queries = [];
  const admin = {
    _updates: updates,
    _rpcCalls: rpcCalls,
    _queries: queries,
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const calls = [];
      queries.push({ table, calls });
      let isUpdate = false;
      let updatePatch = null;
      const rec = (method, args) => calls.push({ method, args });
      const chain = {
        select: (...a) => { rec('select', a); return chain; },
        eq: (...a) => { rec('eq', a); return chain; },
        in: (...a) => { rec('in', a); return chain; },
        not: (...a) => { rec('not', a); return chain; },
        order: (...a) => { rec('order', a); return chain; },
        limit: (...a) => { rec('limit', a); return chain; },
        update: (patch) => { isUpdate = true; updatePatch = patch; rec('update', [patch]); return chain; },
        maybeSingle: () => {
          rec('maybeSingle', []);
          return Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null });
        },
        then: (resolve, reject) => {
          if (isUpdate) {
            updates.push({ table, patch: updatePatch });
            const upRes = result.updateError ? { error: result.updateError } : { error: null };
            return Promise.resolve(upRes).then(resolve, reject);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve(rpcResult || { data: { ok: true, event: 'digitizing_received' }, error: null });
    },
  };
  return admin;
}

const call = ({ body = {}, token = TOKEN, method = 'POST', tables = {}, rpcResult, viaQuery = false } = {}) => {
  mockAdmin = fakeAdmin(tables, rpcResult);
  const headers = token && !viaQuery ? { 'x-vendor-token': token } : {};
  const queryStringParameters = token && viaQuery ? { token } : {};
  return vendorDigitizing.handler({ httpMethod: method, headers, queryStringParameters, body: JSON.stringify(body) });
};

const withEnvToken = (fn) => {
  const prev = process.env.VENDOR_DIGITIZING_TOKEN;
  process.env.VENDOR_DIGITIZING_TOKEN = TOKEN;
  try { return fn(); } finally { process.env.VENDOR_DIGITIZING_TOKEN = prev; }
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
const QUEUE_JOB = {
  id: 'JOB-1001-01', so_id: 'SO-1001', art_file_id: 'af1', _art_ids: ['af1'],
  art_name: 'Front Crest', positions: 'Left Chest', total_units: 24,
  digitizing_due_at: '2026-07-20T00:00:00Z',
  items: [{ item_idx: 0, sku: 'PC61', name: 'Tee', color: 'Navy', units: 24 }],
  // Full queue predicate — handleUpload/handleComplete re-derive this from the row
  // (handleList's own DB query already filtered on it for the list tests above).
  deco_type: 'embroidery', art_status: 'upload_emb_files',
  digitizing_vendor: 'topstar', digitizing_sent_at: '2026-07-10T00:00:00Z',
};
// Extra fields on the art/item rows that must NEVER reach the vendor.
const ART_ROW = {
  so_id: 'SO-1001', id: 'af1', deco_type: 'embroidery', status: 'approved',
  files: [{ url: 'https://cdn.test/art/front.ai', name: 'front.ai' }],
  prod_files: [], prod_files_attached: false,
  notes: 'INTERNAL: vendor pays $18/1k stitches',
};
const ITEM_ROW = {
  so_id: 'SO-1001', item_index: 0, sku: 'PC61', name: 'Tee', color: 'Navy',
  sizes: { M: 12, L: 12 }, nsa_cost: 4.75, retail_price: 15.99,
};

describe('method guard', () => {
  test('rejects non-POST', async () => {
    const r = await withEnvToken(() => call({ method: 'GET' }));
    expect(r.statusCode).toBe(405);
  });
});

describe('auth gating', () => {
  test('503 when VENDOR_DIGITIZING_TOKEN is unset', async () => {
    const prev = process.env.VENDOR_DIGITIZING_TOKEN;
    delete process.env.VENDOR_DIGITIZING_TOKEN;
    try {
      const r = await call({ body: { action: 'list' } });
      expect(r.statusCode).toBe(503);
    } finally { process.env.VENDOR_DIGITIZING_TOKEN = prev; }
  });

  test('401 on a missing token', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, token: null }));
    expect(r.statusCode).toBe(401);
  });

  test('401 on a wrong token', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, token: 'wrong' }));
    expect(r.statusCode).toBe(401);
  });

  test('accepts the token via the x-vendor-token header', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' } }));
    expect(r.statusCode).toBe(200);
  });

  test('accepts the token via ?token=', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, viaQuery: true }));
    expect(r.statusCode).toBe(200);
  });

  test('rejects an unknown action', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'nuke' } }));
    expect(r.statusCode).toBe(400);
  });
});

describe('list — queue predicate', () => {
  test('queries so_jobs with the full digitizing-queue predicate', async () => {
    await withEnvToken(() => call({ body: { action: 'list' }, tables: { so_jobs: { data: [], error: null } } }));
    const jobsQuery = mockAdmin._queries.find((q) => q.table === 'so_jobs');
    const eqArgs = jobsQuery.calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqArgs).toContainEqual(['deco_type', 'embroidery']);
    expect(eqArgs).toContainEqual(['art_status', 'upload_emb_files']);
    expect(eqArgs).toContainEqual(['digitizing_vendor', 'topstar']);
    const notArgs = jobsQuery.calls.filter((c) => c.method === 'not').map((c) => c.args);
    expect(notArgs).toContainEqual(['digitizing_sent_at', 'is', null]);
  });

  test('empty queue returns an empty list without querying art/items', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, tables: { so_jobs: { data: [], error: null } } }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, jobs: [] });
  });
});

describe('list — sanitization', () => {
  const tables = {
    so_jobs: { data: [QUEUE_JOB], error: null },
    so_art_files: { data: [ART_ROW], error: null },
    so_items: { data: [ITEM_ROW], error: null },
  };

  test('response never leaks cost/customer fields', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, tables }));
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toMatch(/nsa_cost|retail_price|INTERNAL/);
  });

  test('garment entries are exactly sku/name/color/sizes', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, tables }));
    const { jobs } = JSON.parse(r.body);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].garment).toEqual([{ sku: 'PC61', name: 'Tee', color: 'Navy', sizes: { M: 12, L: 12 } }]);
  });

  test('art_files entries are pre-production art (files, not prod_files), name+url only', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, tables }));
    const { jobs } = JSON.parse(r.body);
    expect(jobs[0].art_files).toEqual([{ name: 'front.ai', url: 'https://cdn.test/art/front.ai' }]);
  });

  test('job envelope carries only the documented fields', async () => {
    const r = await withEnvToken(() => call({ body: { action: 'list' }, tables }));
    const { jobs } = JSON.parse(r.body);
    expect(Object.keys(jobs[0]).sort()).toEqual(
      ['art_files', 'art_name', 'digitizing_due_at', 'garment', 'job_id', 'positions', 'so_id', 'total_units'].sort()
    );
  });
});

describe('upload', () => {
  const baseTables = (over = {}) => ({
    so_jobs: { data: [QUEUE_JOB], error: null },
    so_art_files: { data: [ART_ROW], error: null },
    ...over,
  });
  const uploadBody = { action: 'upload', so_id: 'SO-1001', job_id: 'JOB-1001-01', file_url: 'https://cdn.test/dst/DG648617.dst', file_name: 'DG648617.dst' };

  test('rejects a non-https file_url', async () => {
    const r = await withEnvToken(() => call({ body: { ...uploadBody, file_url: 'http://insecure.test/x.dst' }, tables: baseTables() }));
    expect(r.statusCode).toBe(400);
  });

  test('re-validates the queue predicate — 409 once art_status has moved on', async () => {
    const movedOn = { ...QUEUE_JOB, art_status: 'art_complete' };
    const r = await withEnvToken(() => call({ body: uploadBody, tables: baseTables({ so_jobs: { data: [movedOn], error: null } }) }));
    expect(r.statusCode).toBe(409);
  });

  test('404 when the job does not exist', async () => {
    const r = await withEnvToken(() => call({ body: uploadBody, tables: baseTables({ so_jobs: { data: [], error: null } }) }));
    expect(r.statusCode).toBe(404);
  });

  test('single-design job: uploading the DST appends prod_files and auto-completes art_status', async () => {
    const r = await withEnvToken(() => call({ body: uploadBody, tables: baseTables() }));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.auto_completed).toBe(true);
    expect(body.flip_error).toBeUndefined(); // no error on the happy path — key is omitted, not null

    const artUpdate = mockAdmin._updates.find((u) => u.table === 'so_art_files');
    expect(artUpdate.patch.prod_files).toEqual([{ url: 'https://cdn.test/dst/DG648617.dst', name: 'DG648617.dst' }]);
    expect(artUpdate.patch.prod_files_attached).toBe(true); // approved embroidery art, now confirmed

    const jobUpdate = mockAdmin._updates.find((u) => u.table === 'so_jobs');
    expect(jobUpdate.patch).toEqual({ art_status: 'art_complete' });
  });

  test('auto-complete flip failure is logged and surfaced as flip_error, never silently swallowed (hardening #4)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await withEnvToken(() => call({
      body: uploadBody,
      tables: baseTables({ so_jobs: { data: [QUEUE_JOB], error: null, updateError: { message: 'could not serialize access due to concurrent update' } } }),
    }));
    // The DST upload itself already succeeded (so_art_files write) — only the
    // art_status flip failed, so this still 200s with the upload recorded.
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.uploaded).toBe(true);
    expect(body.auto_completed).toBe(false);
    expect(body.flip_error).toBe('could not serialize access due to concurrent update');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[vendor-digitizing] auto-complete art_status flip failed:',
      expect.stringContaining('could not serialize access due to concurrent update'),
    );
    consoleSpy.mockRestore();
  });

  test('multi-design job: one DST uploaded, the other design still pending — no auto-complete', async () => {
    const twoArtJob = { ...QUEUE_JOB, _art_ids: ['af1', 'af2'], items: [] };
    const art1 = { ...ART_ROW, files: [], prod_files: [] }; // af1: no DST yet
    const art2 = { ...ART_ROW, id: 'af2', files: [], prod_files: [] }; // af2: no DST yet either
    const r = await withEnvToken(() => call({
      body: uploadBody,
      tables: baseTables({ so_jobs: { data: [twoArtJob], error: null }, so_art_files: { data: [art1, art2], error: null } }),
    }));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.auto_completed).toBe(false);
    expect(mockAdmin._updates.find((u) => u.table === 'so_jobs')).toBeUndefined();
    // The DST lands on the first design that still needs one (af1); af2 stays pending, so
    // the job can't auto-complete yet.
    const artUpdate = mockAdmin._updates.find((u) => u.table === 'so_art_files');
    expect(artUpdate.patch.prod_files).toEqual([{ url: 'https://cdn.test/dst/DG648617.dst', name: 'DG648617.dst' }]);
  });
});

describe('complete', () => {
  const completeBody = { action: 'complete', so_id: 'SO-1001', job_id: 'JOB-1001-01' };

  test('403 when the job is not assigned to this vendor', async () => {
    const notTopstar = { ...QUEUE_JOB, digitizing_vendor: 'other_house' };
    const r = await withEnvToken(() => call({ body: completeBody, tables: { so_jobs: { data: [notTopstar], error: null } } }));
    expect(r.statusCode).toBe(403);
  });

  test('409 when no DST has been uploaded yet', async () => {
    const noDst = { ...ART_ROW, files: [{ url: 'https://cdn.test/art/front.ai', name: 'front.ai' }], prod_files: [] };
    const r = await withEnvToken(() => call({
      body: completeBody,
      tables: { so_jobs: { data: [QUEUE_JOB], error: null }, so_art_files: { data: [noDst], error: null } },
    }));
    expect(r.statusCode).toBe(409);
  });

  test('calls advance_job_stage with digitizing_received once a DST is present', async () => {
    const withDst = { ...ART_ROW, prod_files: [{ url: 'https://cdn.test/dst/DG648617.dst', name: 'DG648617.dst' }] };
    const r = await withEnvToken(() => call({
      body: completeBody,
      tables: { so_jobs: { data: [QUEUE_JOB], error: null }, so_art_files: { data: [withDst], error: null } },
    }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).completed).toBe(true);
    expect(mockAdmin._rpcCalls).toHaveLength(1);
    expect(mockAdmin._rpcCalls[0]).toEqual({
      name: 'advance_job_stage',
      params: { p_so_id: 'SO-1001', p_job_id: 'JOB-1001-01', p_event: 'digitizing_received', p_actor: 'vendor:topstar', p_expected: null, p_payload: {} },
    });
  });

  test('works even after art_status has already auto-completed (normal upload-then-complete order)', async () => {
    const alreadyDone = { ...QUEUE_JOB, art_status: 'art_complete' };
    const withDst = { ...ART_ROW, prod_files_attached: true, prod_files: [{ url: 'https://cdn.test/dst/DG648617.dst', name: 'DG648617.dst' }] };
    const r = await withEnvToken(() => call({
      body: completeBody,
      tables: { so_jobs: { data: [alreadyDone], error: null }, so_art_files: { data: [withDst], error: null } },
    }));
    expect(r.statusCode).toBe(200);
  });
});

describe('exported helpers', () => {
  const { jobArtIds, checkAuth } = vendorDigitizing;

  test('jobArtIds prefers _art_ids, drops falsy and __tbd', () => {
    expect(jobArtIds({ _art_ids: ['a', null, '__tbd', 'b'], art_file_id: 'x' })).toEqual(['a', 'b']);
  });

  test('jobArtIds falls back to art_file_id when _art_ids is empty', () => {
    expect(jobArtIds({ _art_ids: [], art_file_id: 'solo' })).toEqual(['solo']);
    expect(jobArtIds({ _art_ids: [], art_file_id: null })).toEqual([]);
  });

  test('checkAuth reports 503/401/ok', () => {
    const prev = process.env.VENDOR_DIGITIZING_TOKEN;
    delete process.env.VENDOR_DIGITIZING_TOKEN;
    expect(checkAuth({ headers: {} })).toEqual({ ok: false, status: 503, error: expect.any(String) });
    process.env.VENDOR_DIGITIZING_TOKEN = TOKEN;
    expect(checkAuth({ headers: { 'x-vendor-token': 'wrong' } })).toEqual({ ok: false, status: 401, error: expect.any(String) });
    expect(checkAuth({ headers: { 'x-vendor-token': TOKEN } })).toEqual({ ok: true });
    process.env.VENDOR_DIGITIZING_TOKEN = prev;
  });
});
