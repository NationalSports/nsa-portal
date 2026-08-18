/* Unit tests for the webstore close-out cost window (_webstoreClose.js).
 *
 * A closed store's "process the store" to-do/email waits 6 weeks (COST_WINDOW_MS) after
 * close so late costs — shipping, OMG/CC fees, refunds — land before anyone settles it.
 * This is pure time arithmetic that production only exercises 6 weeks after a close, so
 * the guard's branches are pinned here: the anchor choice (close_at vs updated_at), the
 * skip reasons, and the force bypass.
 */
const { notifyStoreClosed, COST_WINDOW_MS } = require('../../netlify/functions/_webstoreClose');

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

// Minimal chainable stub for the supabase admin client: every method returns the chain,
// awaiting it resolves { data: [], error: null } — enough for buildBreakdown (no orders),
// the todo insert (skipped: no rep_id), and the closed_notified_at stamp.
const stubAdmin = () => {
  const from = () => {
    const c = {};
    ['select', 'eq', 'in', 'update', 'insert'].forEach((m) => { c[m] = () => c; });
    c.then = (resolve) => resolve({ data: [], error: null });
    return c;
  };
  return { from };
};

describe('notifyStoreClosed — 6-week cost window', () => {
  beforeEach(() => { delete process.env.BREVO_API_KEY; delete process.env.REACT_APP_BREVO_API_KEY; });

  test('already-notified store is skipped (idempotency unchanged)', async () => {
    const r = await notifyStoreClosed(null, { id: 's1', closed_notified_at: iso(0) });
    expect(r).toEqual({ skipped: true, reason: 'already-notified' });
  });

  test('rejected store is never prompted for processing', async () => {
    const r = await notifyStoreClosed(null, { id: 's1', approval_status: 'rejected', close_at: iso(60 * DAY) });
    expect(r).toEqual({ skipped: true, reason: 'rejected-store' });
  });

  test('store closed inside the window skips with cost-window + notify_after', async () => {
    const store = { id: 's1', close_at: iso(1 * DAY) };
    const r = await notifyStoreClosed(null, store);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('cost-window');
    const expected = new Date(store.close_at).getTime() + COST_WINDOW_MS;
    expect(Math.abs(new Date(r.notify_after).getTime() - expected)).toBeLessThan(1000);
  });

  test('legacy closed row without close_at anchors on updated_at', async () => {
    const r = await notifyStoreClosed(null, { id: 's1', updated_at: iso(1 * DAY) });
    expect(r).toMatchObject({ skipped: true, reason: 'cost-window' });
  });

  test('a FUTURE close_at (closed early, date not yet reached) falls back to updated_at, not the future date', async () => {
    // Anchoring on a future close_at would make the store notify 6 weeks after a date
    // that never reflected the actual close.
    const r = await notifyStoreClosed(null, { id: 's1', close_at: iso(-10 * DAY), updated_at: iso(1 * DAY) });
    expect(r).toMatchObject({ skipped: true, reason: 'cost-window' });
  });

  test('store closed past the window proceeds to notify', async () => {
    const r = await notifyStoreClosed(stubAdmin(), { id: 's1', name: 'Test Store', close_at: iso(COST_WINDOW_MS + DAY) });
    expect(r.notified).toBe(true);
    expect(r.breakdown).toBeDefined();
  });

  test('opts.force bypasses the window', async () => {
    const r = await notifyStoreClosed(stubAdmin(), { id: 's1', name: 'Test Store', close_at: iso(1 * DAY) }, { force: true });
    expect(r.notified).toBe(true);
  });

  test('COST_WINDOW_MS is 6 weeks', () => {
    expect(COST_WINDOW_MS).toBe(42 * DAY);
  });
});
