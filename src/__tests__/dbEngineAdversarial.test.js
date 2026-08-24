/* Adversarial runs against the stale-save guards (SO-1131 class, 2026-08-19).
 *
 * dbEngineHardening.test.js proves each guard in isolation; this suite attacks the save path
 * the way production does — whole-row clobbers that regress EVERYTHING at once, duplicate echo
 * writes, guard-read failures, malformed statuses, marker retention across failed writes, and
 * multi-save version rebasing — and asserts the combined outcome, not just one column.
 *
 * Same hand-rolled FIFO Supabase mock as dbEngineHardening (responses queued per table).
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [] };
  const DEFAULT = { data: null, error: null, count: 0 };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: (...a) => { method = 'upsert'; builder._args = a; return builder; },
      insert: (...a) => { method = 'insert'; builder._args = a; return builder; },
      update: (...a) => { method = 'update'; builder._args = a; return builder; },
      delete: (...a) => { method = 'delete'; builder._args = a; return builder; },
      select: (...a) => { if (!method) method = 'select'; builder._selectArgs = a; return builder; },
      eq: (...a) => { builder._eqArgs = a; return builder; },
      in: (...a) => { builder._inArgs = a; return builder; },
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args, selectArgs: builder._selectArgs, eqArgs: builder._eqArgs, inArgs: builder._inArgs });
        const q = state.responses[table] || [];
        const resp = q.length ? q.shift() : DEFAULT;
        return Promise.resolve(resp).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const withSupabaseEnv = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://adversarial-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// The DB job row as tab A's approval left it — the state the stale tab must not destroy.
const APPROVED_DB_ROW = (over = {}) => ({
  id: 'JOB-A-01',
  sent_to_coach_at: '2026-08-03T19:17:58Z', coach_approved_at: '2026-08-05T10:00:00Z',
  coach_approval_comment: 'looks great', coach_rejected: false,
  art_status: 'art_complete', _version: 77,
  fulfilled_units: 6, item_status: 'partially_received',
  art_messages: [{ id: 'am1', text: 'pls share art' }, { id: 'am2', text: 'Mockup sent to rep', is_system: true }],
  sent_history: [{ sent_at: '2026-08-03T19:17:58Z', to: 'coach@school.org' }],
  rejections: [{ by: 'Coach', reason: 'wrong navy', at: '2026-07-20T00:00:00Z', rejected_at: '2026-07-20T00:00:00Z' }],
  ...over,
});

const soWith = (jobs, over = {}) => ({
  id: 'SO-ADV-1', memo: 'm',
  items: [{ sku: 'TEE', color: 'Red' }],
  jobs,
  ...over,
});

// One full save's response queue. dbRows feeds both the coach/art guard read and the cleanup read.
const saveResponses = (dbRows, { jobUpsert = { error: null } } = {}) => ({
  sales_orders: [
    { data: { updated_at: 'yesterday', deco_pos: null }, error: null },
    { error: null },
  ],
  so_items: [
    { data: [], error: null },
    { data: [{ id: 'ni-1' }], error: null },
  ],
  so_art_files: [{ data: [], error: null }],
  so_item_po_lines: [
    { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
  ],
  so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
  so_jobs: [
    { data: dbRows, error: null },
    jobUpsert,
    { data: dbRows.map(r => ({ id: r.id })), error: null },
  ],
});

// Append a second save's responses onto an existing queue (sequential _dbSaveSO calls drain FIFO).
// A save's TAIL makes two more sales_orders calls (the final updated_at bump and the own-version
// read-back) — pad those first or the next save's existingSO select drains misaligned responses.
const pushSave = (responses, dbRows, opts) => {
  responses.sales_orders = [...(responses.sales_orders || []), { data: null, error: null }, { data: { _version: 1 }, error: null }];
  const next = saveResponses(dbRows, opts);
  Object.keys(next).forEach(t => { responses[t] = [...(responses[t] || []), ...next[t]]; });
  return responses;
};

const jobUpserts = (calls) => calls.filter(c => c.table === 'so_jobs' && c.method === 'upsert');

describe('adversarial — whole-row stale clobber (the SO-1131 warehouse-tab shape)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('a stale tab regressing EVERY guarded column in one write loses on all of them at once', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses([APPROVED_DB_ROW()]);
    const { _dbSaveSO } = require('../lib/dbEngine');

    // The warehouse tab's copy: loaded before the approval, before receiving, before the coach
    // send, before two artist messages and the coach's earlier rejection existed.
    const staleJob = {
      id: 'JOB-A-01', _version: 60, items: [],
      art_status: 'waiting_approval',
      fulfilled_units: 0, item_status: 'need_to_order',
      sent_to_coach_at: null, coach_approved_at: null, coach_approval_comment: null, coach_rejected: null,
      art_messages: [{ id: 'am1', text: 'pls share art' }],
      sent_history: [],
      rejections: null,
    };
    const result = await _dbSaveSO(soWith([staleJob]));
    expect(result).toBe(true);

    const row = jobUpserts(__mockState.calls)[0].args[0][0];
    expect(row.art_status).toBe('art_complete');                       // approval survives
    expect(row.fulfilled_units).toBe(6);                                // receipts survive
    expect(row.item_status).toBe('partially_received');
    expect(row.sent_to_coach_at).toBe('2026-08-03T19:17:58Z');          // coach cols survive (A9)
    expect(row.coach_approved_at).toBe('2026-08-05T10:00:00Z');
    expect(row.art_messages.map(m => m.id)).toEqual(['am1', 'am2']);    // history survives
    expect(row.sent_history.length).toBe(1);
    expect(row.rejections.length).toBe(1);
  });

  test('two stale tabs clobbering back-to-back both lose — the guard is not one-shot', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    let responses = saveResponses([APPROVED_DB_ROW()]);
    // Second clobber arrives against the (still-approved) DB row at a bumped version.
    responses = pushSave(responses, [APPROVED_DB_ROW({ _version: 78 })]);
    __mockState.responses = responses;
    const { _dbSaveSO } = require('../lib/dbEngine');

    const staleA = { id: 'JOB-A-01', _version: 60, items: [], art_status: 'waiting_approval', fulfilled_units: 0, item_status: 'need_to_order' };
    await _dbSaveSO(soWith([staleA]));
    const staleB = { id: 'JOB-A-01', _version: 62, items: [], art_status: 'art_in_progress', fulfilled_units: 0, item_status: 'need_to_order' };
    await _dbSaveSO(soWith([staleB]));

    const ups = jobUpserts(__mockState.calls);
    expect(ups.length).toBe(2);
    expect(ups[0].args[0][0].art_status).toBe('art_complete');
    expect(ups[1].args[0][0].art_status).toBe('art_complete');
    expect(ups[1].args[0][0].fulfilled_units).toBe(6);
  });

  test('mixed batch: the stale-regressed job is repaired while its fresh sibling writes as-is', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses([
      APPROVED_DB_ROW(),
      APPROVED_DB_ROW({ id: 'JOB-A-02', art_status: 'waiting_approval', _version: 10 }),
    ]);
    const { _dbSaveSO } = require('../lib/dbEngine');
    const jobs = [
      { id: 'JOB-A-01', _version: 60, items: [], art_status: 'needs_art' },                    // stale regression
      { id: 'JOB-A-02', _version: 10, items: [], art_status: 'art_in_progress' },             // current, deliberate backward
    ];
    await _dbSaveSO(soWith(jobs));
    const rows = jobUpserts(__mockState.calls)[0].args[0];
    expect(rows.find(r => r.id === 'JOB-A-01').art_status).toBe('art_complete');
    expect(rows.find(r => r.id === 'JOB-A-02').art_status).toBe('art_in_progress');
  });
});

describe('adversarial — coach-decision echo and history dedupe', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('the coach portal reject echo does not duplicate the rejection the RPC already wrote', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    // apply_coach_art_decision already ran: DB carries the server-stamped rejection and the
    // reverted status; the job row's version moved past the portal tab's copy.
    const serverRec = { by: 'Coach', reason: 'make the S bigger', at: '2026-08-19T20:00:05Z', rejected_at: '2026-08-19T20:00:05Z' };
    __mockState.responses = saveResponses([APPROVED_DB_ROW({
      art_status: 'art_requested', coach_rejected: true, sent_to_coach_at: null, coach_approved_at: null,
      rejections: [serverRec], _version: 80,
    })]);
    const { _dbSaveSO } = require('../lib/dbEngine');
    // The portal's echo save: SAME decision, browser-stamped timestamp, richer items breakdown.
    const clientRec = { by: 'Coach', reason: 'make the S bigger', at: '2026-08-19T20:00:03Z', rejected_at: '2026-08-19T20:00:03Z', items: [{ sku: 'TEE', decision: 'changes' }] };
    const echoJob = {
      id: 'JOB-A-01', _version: 77, items: [],
      art_status: 'art_requested', coach_rejected: true, sent_to_coach_at: null, coach_approved_at: null,
      rejections: [clientRec],
    };
    await _dbSaveSO(soWith([echoJob]));
    const row = jobUpserts(__mockState.calls)[0].args[0][0];
    expect(row.rejections.length).toBe(1);                       // no duplicate
    expect(row.rejections[0].items).toBeDefined();               // the richer client record won
    expect(row.art_status).toBe('art_requested');                // equal rank — reject echo passes
  });

  test('two genuinely distinct rejections both survive the union', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const r1 = { by: 'Coach', reason: 'wrong navy', at: '2026-07-20T00:00:00Z' };
    const r2 = { by: 'Coach', reason: 'now the font', at: '2026-08-19T00:00:00Z' };
    __mockState.responses = saveResponses([APPROVED_DB_ROW({ rejections: [r1, r2], _version: 80 })]);
    const { _dbSaveSO } = require('../lib/dbEngine');
    const staleJob = { id: 'JOB-A-01', _version: 77, items: [], art_status: 'art_complete', rejections: [r1] };
    await _dbSaveSO(soWith([staleJob]));
    const row = jobUpserts(__mockState.calls)[0].args[0][0];
    expect(row.rejections.map(r => r.reason)).toEqual(['wrong navy', 'now the font']);
  });

  test('history entries with no id at all still dedupe by content instead of multiplying', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const bare = { text: 'no id, no ts' };
    __mockState.responses = saveResponses([APPROVED_DB_ROW({ art_messages: [bare], _version: 80 })]);
    const { _dbSaveSO } = require('../lib/dbEngine');
    const staleJob = { id: 'JOB-A-01', _version: 77, items: [], art_status: 'art_complete', art_messages: [{ text: 'no id, no ts' }, { text: 'fresh reply' }] };
    await _dbSaveSO(soWith([staleJob]));
    const row = jobUpserts(__mockState.calls)[0].args[0][0];
    expect(row.art_messages.map(m => m.text)).toEqual(['no id, no ts', 'fresh reply']);
  });
});

describe('adversarial — failure injection and malformed data', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('guard read failure never blocks the save — it degrades to the pre-guard blind write', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const responses = saveResponses([]);
    responses.so_jobs = [
      { data: null, error: { message: 'connection reset' } }, // guard read fails
      { error: null },                                        // upsert still runs
      { data: [{ id: 'JOB-A-01' }], error: null },
    ];
    __mockState.responses = responses;
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-A-01', _version: 60, items: [], art_status: 'waiting_approval' };
    const result = await _dbSaveSO(soWith([job]));
    expect(result).toBe(true);
    expect(jobUpserts(__mockState.calls)[0].args[0][0].art_status).toBe('waiting_approval');
  });

  test('a failed job upsert keeps the one-shot markers and the old version for the retry', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses([APPROVED_DB_ROW()], { jobUpsert: { error: { message: 'boom' } } });
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-A-01', _version: 60, items: [], art_status: 'art_requested', _coach_cleared: true, _art_moved: true };
    const result = await _dbSaveSO(soWith([job]));
    expect(result).toBe(false);
    expect(job._coach_cleared).toBe(true);   // NOT consumed — the retry still needs it
    expect(job._art_moved).toBe(true);
    expect(job._version).toBe(60);           // NOT rebased — nothing was written
  });

  test('unknown art_status strings never beat a known DB status, and never block known client ones', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    let responses = saveResponses([APPROVED_DB_ROW()]);                                      // db art_complete
    responses = pushSave(responses, [APPROVED_DB_ROW({ art_status: 'zz_corrupt', _version: 78 })]); // db garbage
    __mockState.responses = responses;
    const { _dbSaveSO } = require('../lib/dbEngine');
    // Stale client writes garbage over a real status → real status kept.
    await _dbSaveSO(soWith([{ id: 'JOB-A-01', _version: 60, items: [], art_status: 'zz_corrupt' }]));
    // Stale client writes a real status over DB garbage → client passes (never wedged on corrupt data).
    await _dbSaveSO(soWith([{ id: 'JOB-A-01', _version: 60, items: [], art_status: 'needs_art' }]));
    const ups = jobUpserts(__mockState.calls);
    expect(ups[0].args[0][0].art_status).toBe('art_complete');
    expect(ups[1].args[0][0].art_status).toBe('needs_art');
  });

  test('version rebase: the same tab stays current across its own saves and may then move backward', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    let responses = saveResponses([APPROVED_DB_ROW({ art_status: 'waiting_approval', _version: 77 })]);
    responses = pushSave(responses, [APPROVED_DB_ROW({ art_status: 'art_complete', _version: 78 })]);
    __mockState.responses = responses;
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-A-01', _version: 77, items: [], art_status: 'art_complete', fulfilled_units: 6, item_status: 'partially_received',
      art_messages: APPROVED_DB_ROW().art_messages, sent_history: APPROVED_DB_ROW().sent_history, rejections: APPROVED_DB_ROW().rejections };
    await _dbSaveSO(soWith([job]));                       // save 1: forward, from current copy
    expect(job._version).toBe(78);                        // rebased to match the trigger bump
    job.art_status = 'waiting_approval';                  // same tab now moves it backward…
    await _dbSaveSO(soWith([job]));                       // save 2: version 78 == db 78 → current, allowed
    const ups = jobUpserts(__mockState.calls);
    expect(ups[1].args[0][0].art_status).toBe('waiting_approval');
    expect(job._version).toBe(79);
  });
});
