/* job-scan: pure scan-code → job resolution (netlify/functions/_jobScanResolver.js)
 * plus the job-scan handler's auth gate (machine token / staff JWT / neither).
 *
 * The plpgsql advance_job_stage transitions themselves need a Supabase branch to
 * verify (see the report's SQL-assertion list); jest covers the JS resolver + auth. */

const { classifyScan, resolveScan } = require('../../netlify/functions/_jobScanResolver');

describe('classifyScan', () => {
  test('BX plate — with and without dash — normalizes to BX-####', () => {
    expect(classifyScan('BX-2001')).toEqual({ type: 'box', value: 'BX-2001' });
    expect(classifyScan('bx2001')).toEqual({ type: 'box', value: 'BX-2001' });
  });
  test('DST filename (bare or full URL) → dst', () => {
    expect(classifyScan('EAGLES_LC_DG12345.dst')).toEqual({ type: 'dst', value: 'EAGLES_LC_DG12345.dst' });
    const c = classifyScan('https://cdn/artwork/EAGLES%20LC.DST?token=x');
    expect(c.type).toBe('dst');
    expect(c.value).toBe('EAGLES LC.DST');
  });
  test('DG code without a .dst extension → dg', () => {
    expect(classifyScan('DG-12345')).toEqual({ type: 'dg', value: 'DG12345' });
    expect(classifyScan('DG 987654')).toEqual({ type: 'dg', value: 'DG987654' });
  });
  test('garbage / empty → unknown', () => {
    expect(classifyScan('   ').type).toBe('unknown');
    expect(classifyScan('hello world').type).toBe('unknown');
  });
});

describe('resolveScan', () => {
  const index = {
    jobs: [
      { so_id: 'SO-100', job_id: 'j1', art_name: 'Eagles LC', dstNames: ['EAGLES_LC.dst'], dgCodes: ['DG12345'] },
      { so_id: 'SO-100', job_id: 'j2', art_name: 'Eagles FB', dstNames: ['EAGLES_FB.dst'], dgCodes: ['DG55555'] },
      { so_id: 'SO-200', job_id: 'j3', art_name: 'Shared', dstNames: ['SHARED.dst'], dgCodes: ['DG99999'] },
    ],
    boxes: [{ id: 'BX-2001', so_id: 'SO-100', contents: [{ sku: 'X' }] }],
  };

  test('DST filename → the single owning job (case-insensitive)', () => {
    expect(resolveScan('eagles_lc.DST', index)).toMatchObject({ ok: true, kind: 'job', so_id: 'SO-100', job_id: 'j1' });
  });
  test('DG code → the owning job', () => {
    expect(resolveScan('DG-55555', index)).toMatchObject({ ok: true, kind: 'job', job_id: 'j2' });
  });
  test('BX plate → box + SO', () => {
    expect(resolveScan('BX-2001', index)).toMatchObject({ ok: true, kind: 'box', box_id: 'BX-2001', so_id: 'SO-100' });
  });
  test('unknown box plate → box_not_found', () => {
    expect(resolveScan('BX-9999', index)).toMatchObject({ ok: false, reason: 'box_not_found' });
  });
  test('no matching job → no_job_for_code', () => {
    expect(resolveScan('NOPE_DG0000.dst', index)).toMatchObject({ ok: false, reason: 'no_job_for_code' });
  });
  test('same DST on two jobs → ambiguous with candidates', () => {
    const dup = { jobs: [
      { so_id: 'SO-1', job_id: 'a', dstNames: ['DUP.dst'], dgCodes: [] },
      { so_id: 'SO-2', job_id: 'b', dstNames: ['DUP.dst'], dgCodes: [] },
    ], boxes: [] };
    const r = resolveScan('DUP.dst', dup);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ambiguous');
    expect(r.matches).toHaveLength(2);
  });
  test('unrecognized code → unrecognized_code', () => {
    expect(resolveScan('nonsense', index)).toMatchObject({ ok: false, reason: 'unrecognized_code' });
  });
});

// ── Handler auth gate ──────────────────────────────────────────────────────
// Mock @supabase/supabase-js so no network is touched; mock _shared.verifyUser.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [], error: null }), then: (res) => Promise.resolve({ data: [], error: null }).then(res) }) }) }),
    rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
  }),
}));
jest.mock('../../netlify/functions/_shared', () => ({ verifyUser: jest.fn() }));
const { verifyUser } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/job-scan');

const makeEvent = (over = {}) => ({
  httpMethod: 'POST',
  headers: over.headers || {},
  queryStringParameters: over.query || {},
  body: JSON.stringify(over.body || { code: 'BX-2001', event: 'release' }),
});

describe('job-scan handler auth', () => {
  const OLD = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD, PROD_SCAN_TOKEN: 'station-secret', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    verifyUser.mockReset();
  });
  afterAll(() => { process.env = OLD; });

  test('no token and no bearer → 401', async () => {
    verifyUser.mockResolvedValue({ ok: false });
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(401);
  });

  test('wrong machine token, no staff → 401', async () => {
    verifyUser.mockResolvedValue({ ok: false });
    const r = await handler(makeEvent({ headers: { 'x-machine-token': 'nope' } }));
    expect(r.statusCode).toBe(401);
  });

  test('valid machine token → passes the gate (not 401)', async () => {
    const r = await handler(makeEvent({ headers: { 'x-machine-token': 'station-secret' } }));
    expect(r.statusCode).not.toBe(401);
  });

  test('staff JWT accepted → passes the gate (not 401)', async () => {
    verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm-1' });
    const r = await handler(makeEvent({ headers: { authorization: 'Bearer good' } }));
    expect(r.statusCode).not.toBe(401);
  });

  test('rejects an unknown event with 400', async () => {
    const r = await handler(makeEvent({ headers: { 'x-machine-token': 'station-secret' }, body: { code: 'BX-2001', event: 'teleport' } }));
    expect(r.statusCode).toBe(400);
  });
});
