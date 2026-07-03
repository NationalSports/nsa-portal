/* Coach art decision (portal-action.js applyArtDecision + migration 00172).
 *
 * The RPC path (apply_coach_art_decision) is exercised for real against scratch
 * PostgreSQL by scripts/pgtest/art_decision_scenarios.sql; these tests cover the
 * JS layer: error-marker mapping, and the guarded pre-migration fallback's
 * complete write sets (the H1 state guard, M2 prod_files_attached clear, M4
 * self-consistent writes, L1 dual timestamp keys).
 */
const { applyArtDecision } = require('../../netlify/functions/portal-action');

function fakeSb(script) {
  const calls = [];
  const nextResult = (key, call) => {
    const queue = script[key] || [];
    const result = queue.length ? queue.shift() : { data: [], error: null };
    call.result = result;
    return result;
  };
  return {
    calls,
    rpc(fn, args) {
      const call = { table: fn, op: 'rpc', payload: args };
      calls.push(call);
      return Promise.resolve(nextResult('rpc.' + fn, call));
    },
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col, val) => { call.filters.push([col, val]); return chain; },
        in: (col, vals) => { call.filters.push(['in:' + col, vals]); return chain; },
        limit: () => chain,
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}

const RPC_MISSING = { data: null, error: { message: 'Could not find the function public.apply_coach_art_decision(...) in the schema cache' } };
const APPROVE = { so_id: 'SO-1', job_id: 'JOB-1-01', decision: 'approve', art_ids: ['art1', 'art2'], approved_status: 'production_files_needed', seen_mocks: ['https://cdn/x/m1.png'] };
const REJECT = { so_id: 'SO-1', job_id: 'JOB-1-01', decision: 'reject', comment: 'Wrong orange', art_ids: ['art1'] };

describe('RPC path', () => {
  test('success returns ok with no direct table writes', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [{ data: { ok: true, job: { id: 'JOB-1-01' } }, error: null }] });
    const r = await applyArtDecision(sb, APPROVE, '7/3/2026, 2:00:00 PM');
    expect(r.ok).toBe(true);
    const rpc = sb.calls.find((c) => c.op === 'rpc');
    expect(rpc.payload.p_seen_mocks).toEqual(['https://cdn/x/m1.png']);
    expect(rpc.payload.p_touch_updated_at).toBe('7/3/2026, 2:00:00 PM');
    expect(sb.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  test('NSA_STALE_STATE maps to 409 stale_state (H1)', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [{ data: null, error: { message: 'NSA_STALE_STATE:needs_art' } }] });
    const r = await applyArtDecision(sb, APPROVE, null);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe('stale_state');
  });

  test('NSA_MOCKS_CHANGED maps to 409 mocks_changed (H2)', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [{ data: null, error: { message: 'NSA_MOCKS_CHANGED:https://cdn/x/old.png' } }] });
    const r = await applyArtDecision(sb, APPROVE, null);
    expect(r.status).toBe(409);
    expect(r.code).toBe('mocks_changed');
  });
});

describe('pre-00172 fallback', () => {
  test('approve: guarded job update + art files approved + SO touched', async () => {
    const sb = fakeSb({
      'rpc.apply_coach_art_decision': [RPC_MISSING],
      'so_jobs.update': [{ data: [{ id: 'JOB-1-01' }], error: null }],
      'so_art_files.update': [{ data: null, error: null }],
      'sales_orders.update': [{ data: null, error: null }],
    });
    const r = await applyArtDecision(sb, APPROVE, '7/3/2026, 2:00:00 PM');
    expect(r.ok).toBe(true);
    const jobUpd = sb.calls.find((c) => c.table === 'so_jobs' && c.op === 'update');
    // H1 guard: the update must be conditioned on the job still awaiting the coach
    expect(jobUpd.filters).toContainEqual(['art_status', 'waiting_approval']);
    // M4: approve clears coach_rejected in the same write
    expect(jobUpd.payload.coach_rejected).toBe(false);
    expect(jobUpd.payload.art_status).toBe('production_files_needed');
    const artUpd = sb.calls.find((c) => c.table === 'so_art_files' && c.op === 'update');
    expect(artUpd.payload).toEqual({ status: 'approved' });
    expect(sb.calls.find((c) => c.table === 'sales_orders' && c.op === 'update').payload.updated_at).toBe('7/3/2026, 2:00:00 PM');
  });

  test('approve on a recalled job: 0 guarded rows → 409 stale_state, no art writes', async () => {
    const sb = fakeSb({
      'rpc.apply_coach_art_decision': [RPC_MISSING],
      'so_jobs.update': [{ data: [], error: null }], // guard filtered it out
    });
    const r = await applyArtDecision(sb, APPROVE, null);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe('stale_state');
    expect(sb.calls.filter((c) => c.table === 'so_art_files')).toHaveLength(0);
  });

  test('reject: complete write set (M2/M4/L1)', async () => {
    const sb = fakeSb({
      'rpc.apply_coach_art_decision': [RPC_MISSING],
      'so_jobs.select': [{ data: [{ rejections: [{ reason: 'earlier', by: 'Coach' }] }], error: null }],
      'so_jobs.update': [{ data: [{ id: 'JOB-1-01' }], error: null }],
      'so_art_files.select': [{ data: [{ notes: 'orig' }], error: null }],
      'so_art_files.update': [{ data: null, error: null }],
    });
    const r = await applyArtDecision(sb, REJECT, null);
    expect(r.ok).toBe(true);
    const jobUpd = sb.calls.find((c) => c.table === 'so_jobs' && c.op === 'update');
    expect(jobUpd.filters).toContainEqual(['art_status', 'waiting_approval']); // H1
    expect(jobUpd.payload.art_status).toBe('art_requested');
    expect(jobUpd.payload.coach_rejected).toBe(true);
    expect(jobUpd.payload.sent_to_coach_at).toBeNull();                       // M4
    expect(jobUpd.payload.rejections).toHaveLength(2);                        // appended, not replaced
    const rej = jobUpd.payload.rejections[1];
    expect(rej.reason).toBe('Wrong orange');
    expect(rej.at).toBeTruthy();
    expect(rej.rejected_at).toBe(rej.at);                                     // L1: both keys
    const artUpd = sb.calls.find((c) => c.table === 'so_art_files' && c.op === 'update');
    expect(artUpd.payload.status).toBe('waiting_for_art');
    expect(artUpd.payload.prod_files_attached).toBe(false);                   // M2
    expect(artUpd.payload.notes).toBe('orig\nCoach feedback: Wrong orange');
  });

  test('reject without comment → 400', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [RPC_MISSING] });
    const r = await applyArtDecision(sb, { ...REJECT, comment: '  ' }, null);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  test('bad decision verb → 400', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [RPC_MISSING] });
    const r = await applyArtDecision(sb, { ...APPROVE, decision: 'maybe' }, null);
    expect(r.status).toBe(400);
  });

  test('invalid approved_status → 400', async () => {
    const sb = fakeSb({ 'rpc.apply_coach_art_decision': [RPC_MISSING] });
    const r = await applyArtDecision(sb, { ...APPROVE, approved_status: 'shipped' }, null);
    expect(r.status).toBe(400);
  });
});
