/** @jest-environment node */
/* Unit tests for the webstore close-out notify guards (_webstoreClose.js).
 *
 * The "process the store" to-do/email fires at close (fulfillment: batch the orders and
 * get product moving). These pin the guards in front of it: idempotency via
 * closed_notified_at, and the rejected-store skip (store-approval.js closes a rejected
 * store, but its captured orders are for refunding — never a process prompt).
 * Fund settlement is prompted separately when the SO's final job finishes (App.js).
 */
const { notifyStoreClosed, closeTodoId, closeEmailKey } = require('../../netlify/functions/_webstoreClose');

// Minimal chainable stub for the supabase admin client: every method returns the chain,
// awaiting it resolves { data: [], error: null } — enough for buildBreakdown (no orders),
// the todo insert (skipped: no rep_id), and the closed_notified_at stamp.
const stubAdmin = (events = []) => {
  const from = (table) => {
    const c = {};
    ['select', 'eq', 'in'].forEach((m) => { c[m] = () => c; });
    c.update = () => { events.push(`update:${table}`); return c; };
    c.insert = () => { events.push(`insert:${table}`); return c; };
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
    const sent = [];
    const r = await notifyStoreClosed(stubAdmin(), { id: 's1', name: 'Test Store', close_at: '2026-09-01T20:00:00.000Z' }, {
      sendEmail: async (payload, key) => { sent.push({ payload, key }); },
    });
    expect(r.notified).toBe(true);
    expect(r.breakdown).toBeDefined();
    expect(r.emailed).toContain('stores@nationalsportsapparel.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('stable close identities make to-do creation and email delivery retry-safe', () => {
    const store = { id: 's1', close_at: '2026-09-01T20:00:00.000Z' };
    expect(closeTodoId(store)).toBe(closeTodoId({ ...store }));
    expect(closeEmailKey(store)).toBe(closeEmailKey({ ...store }));
    expect(closeEmailKey(store)).not.toBe(closeEmailKey({ ...store, close_at: '2026-09-08T20:00:00.000Z' }));
  });

  test('an email failure leaves closed_notified_at unstamped for the hourly retry', async () => {
    const events = [];
    await expect(notifyStoreClosed(stubAdmin(events), { id: 's1', name: 'Test Store', close_at: '2026-09-01T20:00:00.000Z' }, {
      sendEmail: async () => { events.push('email'); throw new Error('provider unavailable'); },
    })).rejects.toThrow(/provider unavailable/);
    expect(events).toEqual(['email']);
  });

  test('completion is stamped only after the close email succeeds', async () => {
    const events = [];
    await notifyStoreClosed(stubAdmin(events), { id: 's1', name: 'Test Store', close_at: '2026-09-01T20:00:00.000Z' }, {
      sendEmail: async () => { events.push('email'); },
    });
    expect(events).toEqual(['email', 'update:webstores']);
  });
});
