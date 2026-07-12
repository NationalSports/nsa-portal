/* Tests for netlify/functions/teamshop-auto-release.js (automation trio #2).
 * Two layers (stuckSweep.test.js style):
 *   1. Pure readiness recompute — artRecordProdReady / jobArtReady /
 *      jobFulfillment / jobReleasable. These are the load-bearing money-path
 *      claims (release only when art done AND garments fully in hand).
 *   2. runRelease against a chainable fake admin — verifies the default-OFF gate,
 *      the auto_art_only scope filter, that a ready job is released THROUGH
 *      advance_job_stage (never a direct prod_status write) after item_status is
 *      set to the recomputed truth, and that a not-fully-received job is skipped.
 */
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => global.__fakeAdmin,
  verifyUser: (...args) => global.__verifyUserMock(...args),
}));

const rel = require('../../netlify/functions/teamshop-auto-release');
const {
  artRecordProdReady, jobArtReady, jobFulfillment, jobReleasable, jobArtIds, hasDst, runRelease, jobDtfReady,
} = rel;

// ── Pure: art readiness ─────────────────────────────────────────────────────
describe('artRecordProdReady (isJobReady art half)', () => {
  test('prod_files_attached=true is ready', () => {
    expect(artRecordProdReady({ prod_files_attached: true })).toBe(true);
  });
  test('non-empty prod_files is ready', () => {
    expect(artRecordProdReady({ prod_files: ['seps.pdf'] })).toBe(true);
  });
  test('embroidery with a .dst among files/prod_files is ready; non-emb .dst is NOT', () => {
    expect(artRecordProdReady({ deco_type: 'embroidery', files: ['logo.dst'] })).toBe(true);
    expect(artRecordProdReady({ deco_type: 'embroidery', prod_files: [{ name: 'L.DST' }] })).toBe(true);
    expect(artRecordProdReady({ deco_type: 'screen_print', files: ['logo.dst'] })).toBe(false);
  });
  test('approved but no production files is NOT ready; null is NOT ready', () => {
    expect(artRecordProdReady({ status: 'approved' })).toBe(false);
    expect(artRecordProdReady(null)).toBe(false);
  });
});

describe('jobArtReady / jobArtIds', () => {
  test('jobArtIds unions _art_ids and art_file_id, drops blanks/__tbd/dupes', () => {
    expect(jobArtIds({ _art_ids: ['a', 'a', '__tbd'], art_file_id: 'b' })).toEqual(['a', 'b']);
    expect(jobArtIds({ _art_ids: [], art_file_id: null })).toEqual([]);
  });
  test('requires art_status art_complete', () => {
    expect(jobArtReady({ art_status: 'needs_art', _art_ids: ['a'] }, () => ({ prod_files_attached: true }))).toBe(false);
  });
  test('present-but-not-ready art fails; missing art is skipped (isJobReady parity)', () => {
    const job = { art_status: 'art_complete', _art_ids: ['a'] };
    expect(jobArtReady(job, () => ({ status: 'approved' }))).toBe(false); // present, not prod-ready
    expect(jobArtReady(job, () => null)).toBe(true); // missing -> skipped -> passes
  });
});

// ── Pure: fulfillment (conservative full-receipt) ───────────────────────────
describe('jobFulfillment', () => {
  const ctxFrom = (item, pulled, received) => ({
    itemForIndex: (idx) => (idx === 0 ? item : null),
    pulledFor: (id, sz) => (pulled[sz] || 0),
    receivedFor: (id, sz) => (received[sz] || 0),
  });
  test('fully received across sizes -> items_received', () => {
    const job = { items: [{ item_idx: 0, sizes: { S: 2, M: 3 } }] };
    const f = jobFulfillment(job, ctxFrom({ id: 1, sizes: { S: 2, M: 3 } }, { S: 2, M: 1 }, { M: 2 }));
    expect(f.total).toBe(5);
    expect(f.fulfilled).toBe(5);
    expect(f.fullyReceived).toBe(true);
    expect(f.itemStatus).toBe('items_received');
  });
  test('partial receipt -> not fully received, partially_received', () => {
    const job = { items: [{ item_idx: 0, sizes: { S: 2 } }] };
    const f = jobFulfillment(job, ctxFrom({ id: 1, sizes: { S: 2 } }, { S: 1 }, {}));
    expect(f.fullyReceived).toBe(false);
    expect(f.itemStatus).toBe('partially_received');
  });
  test('a missing item blocks readiness (itemsOk=false)', () => {
    const job = { items: [{ item_idx: 5, sizes: { S: 2 } }] };
    const f = jobFulfillment(job, ctxFrom({ id: 1, sizes: { S: 2 } }, { S: 9 }, {}));
    expect(f.fullyReceived).toBe(false);
  });
  test('qty_only item falls back to est_qty under the QTY key', () => {
    const job = { items: [{ item_idx: 0 }] };
    const f = jobFulfillment(job, ctxFrom({ id: 1, sizes: {}, est_qty: 4 }, { QTY: 4 }, {}));
    expect(f.total).toBe(4);
    expect(f.fullyReceived).toBe(true);
  });
});

test('jobReleasable requires BOTH gates', () => {
  const job = { art_status: 'art_complete', _art_ids: ['a'], items: [{ item_idx: 0, sizes: { S: 2 } }] };
  const artOk = () => ({ prod_files_attached: true });
  const ctxFull = { itemForIndex: () => ({ id: 1, sizes: { S: 2 } }), pulledFor: () => 2, receivedFor: () => 0 };
  const ctxShort = { itemForIndex: () => ({ id: 1, sizes: { S: 2 } }), pulledFor: () => 1, receivedFor: () => 0 };
  expect(jobReleasable(job, artOk, ctxFull).ready).toBe(true);
  expect(jobReleasable(job, artOk, ctxShort).ready).toBe(false);
  expect(jobReleasable(job, () => ({ status: 'approved' }), ctxFull).ready).toBe(false); // art not prod-ready
});

// ── DTF prints gate (00212) ──────────────────────────────────────────────────
describe('jobDtfReady / DTF prints release gate', () => {
  test('non-DTF jobs never block; only received frees a tracked need', () => {
    expect(jobDtfReady({})).toBe(true);
    expect(jobDtfReady({ deco_type: 'embroidery' })).toBe(true);
    expect(jobDtfReady({ dtf_prints_status: 'received' })).toBe(true);
    expect(jobDtfReady({ dtf_prints_status: 'needed' })).toBe(false);
    expect(jobDtfReady({ dtf_prints_status: 'ordered' })).toBe(false);
  });

  test('a DTF-deco job is held even with a null status (before the lane records the need)', () => {
    expect(jobDtfReady({ deco_type: 'dtf' })).toBe(false);
    expect(jobDtfReady({ deco_type: 'dtf', dtf_prints_status: null })).toBe(false);
    expect(jobDtfReady({ deco_type: 'dtf', dtf_prints_status: 'received' })).toBe(true);
  });

  test('jobReleasable holds a DTF job whose prints are needed/ordered, frees it when received', () => {
    const base = { art_status: 'art_complete', _art_ids: ['a'], items: [{ item_idx: 0, sizes: { S: 2 } }] };
    const artOk = () => ({ prod_files_attached: true });
    const ctxFull = { itemForIndex: () => ({ id: 1, sizes: { S: 2 } }), pulledFor: () => 2, receivedFor: () => 0 };
    // garments + art ready, but prints on order → held with reason dtf_prints
    expect(jobReleasable({ ...base, dtf_prints_status: 'ordered' }, artOk, ctxFull)).toMatchObject({ ready: false, reason: 'dtf_prints' });
    expect(jobReleasable({ ...base, dtf_prints_status: 'needed' }, artOk, ctxFull)).toMatchObject({ ready: false, reason: 'dtf_prints' });
    // prints received → releasable
    expect(jobReleasable({ ...base, dtf_prints_status: 'received' }, artOk, ctxFull).ready).toBe(true);
  });
});

// ── runRelease against a fake admin ─────────────────────────────────────────
function makeAdmin(tables) {
  const updates = [];
  const rpcs = [];
  const admin = {
    updates, rpcs,
    from(table) {
      const op = { table, op: 'select', filters: [], payload: null };
      const chain = {
        select() { return chain; },
        eq(c, v) { op.filters.push(['eq', c, v]); return chain; },
        in(c, v) { op.filters.push(['in', c, v]); return chain; },
        not(c, k, v) { op.filters.push(['not', c, k, v]); return chain; },
        limit() { return chain; },
        update(payload) { op.op = 'update'; op.payload = payload; return chain; },
        then(resolve, reject) {
          if (op.op === 'update') { updates.push(op); return Promise.resolve({ data: null, error: null }).then(resolve, reject); }
          const fn = tables[table];
          const res = (typeof fn === 'function' ? fn(op) : fn) || { data: [], error: null };
          return Promise.resolve(res).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc(fn, args) { const call = { fn, args }; rpcs.push(call); return Promise.resolve({ data: { ok: true }, error: null }); },
  };
  return admin;
}

const CUSTOMER = { id: 'CUST-1', art_files: [{ id: 'art-1', status: 'approved', prod_files_attached: true }] };
const SO_ITEM = { id: 11, so_id: 'SO-1', item_index: 0, sizes: { S: 2 } };
const AUTO_JOB = { so_id: 'SO-1', id: 'JOB-1', art_status: 'art_complete', item_status: 'need_to_order', prod_status: 'hold', art_file_id: 'art-1', _art_ids: ['art-1'], items: [{ item_idx: 0, sizes: { S: 2 } }] };
const STAFF_JOB = { so_id: 'SO-1', id: 'JOB-2', art_status: 'art_complete', item_status: 'need_to_order', prod_status: 'hold', art_file_id: 'art-2', _art_ids: ['art-2'], items: [{ item_idx: 0, sizes: { S: 2 } }] };

// created events: JOB-1 born art_complete (auto-art), JOB-2 born needs_art (staff completed later).
const CREATED_EVENTS = [
  { so_id: 'SO-1', job_id: 'JOB-1', to_state: { art_status: 'art_complete' }, payload: { auto_art: true } },
  { so_id: 'SO-1', job_id: 'JOB-2', to_state: { art_status: 'needs_art' }, payload: { auto_art: false } },
];

function baseTables(overrides = {}) {
  return {
    teamshop_settings: { data: [{ auto_release_enabled: true, auto_release_scope: 'auto_art_only' }], error: null },
    webstore_orders: { data: [{ so_id: 'SO-1', order_source: 'teamshop' }], error: null },
    sales_orders: { data: [{ id: 'SO-1', customer_id: 'CUST-1' }], error: null },
    so_jobs: { data: [AUTO_JOB, STAFF_JOB], error: null },
    job_stage_events: { data: CREATED_EVENTS, error: null },
    so_art_files: { data: [], error: null },
    customers: { data: [CUSTOMER], error: null },
    so_items: { data: [SO_ITEM], error: null },
    so_item_pick_lines: { data: [{ so_item_id: 11, sizes: { S: 2 }, status: 'pulled' }], error: null },
    so_item_po_lines: { data: [], error: null },
    ...overrides,
  };
}

describe('runRelease', () => {
  test('disabled setting releases nothing (default-OFF)', async () => {
    const admin = makeAdmin(baseTables({ teamshop_settings: { data: [{ auto_release_enabled: false, auto_release_scope: 'auto_art_only' }], error: null } }));
    const s = await runRelease(admin, 'schedule');
    expect(s.released).toEqual([]);
    expect(admin.rpcs.length).toBe(0);
    expect(admin.updates.length).toBe(0);
    expect(s.note).toMatch(/false/);
  });

  test('auto_art_only: releases the born-art_complete job THROUGH advance_job_stage after setting item_status truth; excludes the staff job', async () => {
    const admin = makeAdmin(baseTables());
    const s = await runRelease(admin, 'schedule');
    expect(s.candidates).toBe(1); // scope filter dropped JOB-2
    expect(s.released.map((r) => r.job_id)).toEqual(['JOB-1']);

    // item_status set to the recomputed truth FIRST
    const upd = admin.updates.find((u) => u.table === 'so_jobs');
    expect(upd.payload).toEqual({ item_status: 'items_received' });
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'so_id', 'SO-1'], ['eq', 'id', 'JOB-1']]));

    // released THROUGH the gate, never a direct prod_status write
    expect(admin.rpcs.length).toBe(1);
    const call = admin.rpcs[0];
    expect(call.fn).toBe('advance_job_stage');
    expect(call.args).toEqual(expect.objectContaining({ p_so_id: 'SO-1', p_job_id: 'JOB-1', p_event: 'release', p_actor: 'auto-release', p_payload: { source: 'auto_release' } }));
    expect(admin.updates.some((u) => 'prod_status' in (u.payload || {}))).toBe(false);
  });

  test('a not-fully-received job is skipped (reason fulfillment), not released', async () => {
    const admin = makeAdmin(baseTables({ so_item_pick_lines: { data: [{ so_item_id: 11, sizes: { S: 1 }, status: 'pulled' }], error: null } }));
    const s = await runRelease(admin, 'schedule');
    expect(s.released).toEqual([]);
    expect(s.skipped).toEqual([{ so_id: 'SO-1', job_id: 'JOB-1', reason: 'fulfillment' }]);
    expect(admin.rpcs.length).toBe(0);
  });

  test('a DTF job whose prints are still on order is skipped (reason dtf_prints), not released', async () => {
    const admin = makeAdmin(baseTables({
      so_jobs: { data: [{ ...AUTO_JOB, dtf_prints_status: 'ordered' }, STAFF_JOB], error: null },
    }));
    const s = await runRelease(admin, 'schedule');
    expect(s.released).toEqual([]);
    expect(s.skipped).toEqual([{ so_id: 'SO-1', job_id: 'JOB-1', reason: 'dtf_prints' }]);
    expect(admin.rpcs.length).toBe(0);
  });

  test('the same DTF job releases once its prints are received', async () => {
    const admin = makeAdmin(baseTables({
      so_jobs: { data: [{ ...AUTO_JOB, dtf_prints_status: 'received' }, STAFF_JOB], error: null },
    }));
    const s = await runRelease(admin, 'schedule');
    expect(s.released.map((r) => r.job_id)).toEqual(['JOB-1']);
    expect(admin.rpcs.length).toBe(1);
  });

  test("scope 'all' also releases a staff-finished art_complete job", async () => {
    const admin = makeAdmin(baseTables({
      teamshop_settings: { data: [{ auto_release_enabled: true, auto_release_scope: 'all' }], error: null },
      so_art_files: { data: [{ so_id: 'SO-1', id: 'art-2', prod_files: ['seps.pdf'], deco_type: 'screen_print' }], error: null },
    }));
    const s = await runRelease(admin, 'schedule');
    expect(s.candidates).toBe(2);
    expect(s.released.map((r) => r.job_id).sort()).toEqual(['JOB-1', 'JOB-2']);
    expect(admin.rpcs.length).toBe(2);
  });

  test('pre-migration (teamshop_settings missing) degrades to enabled:false, no releases', async () => {
    const admin = makeAdmin(baseTables({ teamshop_settings: { data: null, error: { code: '42P01', message: 'relation "teamshop_settings" does not exist' } } }));
    const s = await runRelease(admin, 'schedule');
    expect(s.enabled).toBe(false);
    expect(admin.rpcs.length).toBe(0);
  });
});

// ── Handler: manual trigger auth ─────────────────────────────────────────────
describe('handler — manual run action', () => {
  test('manual run without a valid staff session is rejected, not run', async () => {
    global.__fakeAdmin = makeAdmin(baseTables());
    global.__verifyUserMock = jest.fn(async () => ({ ok: false, status: 401, error: 'Missing bearer token' }));
    const res = await rel.handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'run' }), headers: {} });
    expect(res.statusCode).toBe(401);
    expect(global.__fakeAdmin.rpcs.length).toBe(0);
  });

  test('the scheduled (no-event-method) invocation runs with no auth check', async () => {
    global.__fakeAdmin = makeAdmin(baseTables({ teamshop_settings: { data: [{ auto_release_enabled: false, auto_release_scope: 'auto_art_only' }], error: null } }));
    global.__verifyUserMock = jest.fn();
    const res = await rel.handler(undefined);
    expect(res.statusCode).toBe(200);
    expect(global.__verifyUserMock).not.toHaveBeenCalled();
  });
});
