/* Unit tests for the webstore close-out notify guards (_webstoreClose.js).
 *
 * The "process the store" to-do/email fires at close (fulfillment: batch the orders and
 * get product moving). These pin the guards in front of it: idempotency via
 * closed_notified_at, and the rejected-store skip (store-approval.js closes a rejected
 * store, but its captured orders are for refunding — never a process prompt).
 * Fund settlement is prompted separately when the SO's final job finishes (App.js).
 */
const { notifyStoreClosed } = require('../../netlify/functions/_webstoreClose');

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

describe('notifyStoreClosed — close-out notify guards', () => {
  beforeEach(() => { delete process.env.BREVO_API_KEY; delete process.env.REACT_APP_BREVO_API_KEY; });

  test('already-notified store is skipped (idempotency)', async () => {
    const r = await notifyStoreClosed(null, { id: 's1', closed_notified_at: new Date().toISOString() });
    expect(r).toEqual({ skipped: true, reason: 'already-notified' });
  });

  test('rejected store is never prompted for processing', async () => {
    const r = await notifyStoreClosed(null, { id: 's1', approval_status: 'rejected', close_at: new Date().toISOString() });
    expect(r).toEqual({ skipped: true, reason: 'rejected-store' });
  });

  test('a just-closed store notifies immediately', async () => {
    const r = await notifyStoreClosed(stubAdmin(), { id: 's1', name: 'Test Store', close_at: new Date().toISOString() });
    expect(r.notified).toBe(true);
    expect(r.breakdown).toBeDefined();
  });
});
