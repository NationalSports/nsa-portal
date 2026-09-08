const { runReview, compareInvoice, reviewStore } = require('../../netlify/functions/_qboServerReview');

const invoice = { id: 'INV-1', total: 100, paid: 20, status: 'partial', qb_invoice_id: '900' };
const qbo = { Id: '900', TotalAmt: 100, Balance: 80 };
function harness(rows = [invoice]) {
  const store = { claim: jest.fn(async () => true), snapshot: jest.fn(async () => rows), finish: jest.fn(async () => {}) };
  const queryInvoices = jest.fn(async () => [qbo]);
  return { store, queryInvoices, realm: '9341456492604246', requestedBy: 'staff' };
}
test('persists exact population and read-only comparison, including exclusions', async () => {
  const run = harness([invoice, { id: 'deleted', deleted_at: '2026-01-01' }, { id: 'unlinked' }]);
  const result = await runReview(run);
  expect(result.status).toBe('complete');
  expect(result.report.counts).toMatchObject({ total: 3, deleted: 1, unlinked: 1, linked: 1, aligned: 1 });
  expect(result.report.population).toHaveLength(3);
  expect(result.report.mode).toBe('read_only');
  expect(run.store.finish).toHaveBeenCalledTimes(1);
});
test('overlapping run does not query invoices', async () => {
  const run = harness(); run.store.claim.mockResolvedValue(false);
  expect(await runReview(run)).toEqual({ status: 'busy' });
  expect(run.queryInvoices).not.toHaveBeenCalled();
  expect(run.store.snapshot).not.toHaveBeenCalled();
});
test('claim storage failure prevents QBO access', async () => {
  const run = harness(); run.store.claim.mockRejectedValue(new Error('db'));
  await expect(runReview(run)).rejects.toThrow();
  expect(run.queryInvoices).not.toHaveBeenCalled();
});
test('changed source snapshot cannot produce a clean result', async () => {
  const run = harness(); run.store.snapshot.mockResolvedValueOnce([invoice]).mockResolvedValueOnce([]);
  const result = await runReview(run);
  expect(result.status).toBe('needs_review');
  expect(result.report.sourceChanged).toBe(true);
});
test('empty population does not pass the gate', async () => {
  expect((await runReview(harness([]))).status).toBe('needs_review');
});
test('duplicate links are held, not counted as aligned', async () => {
  const result = await runReview(harness([invoice, { ...invoice, id: 'INV-2' }]));
  expect(result.status).toBe('needs_review');
  expect(result.report.results.every(r => r.action === 'duplicate_portal_link')).toBe(true);
});
test('queries beyond the first 100 records', async () => {
  const run = harness(Array.from({ length: 201 }, (_, i) => ({ ...invoice, id: 'I' + i, qb_invoice_id: String(i + 1) })));
  run.queryInvoices.mockImplementation(async ids => ids.map(Id => ({ ...qbo, Id })));
  expect((await runReview(run)).report.counts.aligned).toBe(201);
  expect(run.queryInvoices.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 1]);
});
test.each([
  [null, 'missing_qbo_invoice'],
  [{ ...qbo, TotalAmt: null }, 'invalid_amounts'],
  [{ ...qbo, TotalAmt: 101 }, 'total_differs'],
  [{ ...qbo, Balance: -1 }, 'invalid_balance'],
  [{ ...qbo, Balance: 70 }, 'review_payment_pull'],
  [{ ...qbo, Balance: 90 }, 'review_payment_push'],
])('classifies exceptions without mutating source', (record, action) => {
  expect(compareInvoice(Object.freeze(invoice), record).action).toBe(action);
});
test('void verification requires both zero balance and zero total', () => {
  const inv = { ...invoice, status: 'void' };
  expect(compareInvoice(inv, { Id: '900', TotalAmt: 0, Balance: 0 }).action).toBe('void_verified');
  expect(compareInvoice(inv, { ...qbo, Balance: 0 }).action).toBe('void_needs_review');
});
test.each(['fault', 'wrong_id', 'invalid_id', 'deadline'])('%s fails closed and records failure', async mode => {
  const run = harness();
  if (mode === 'fault') run.queryInvoices.mockRejectedValue(new Error('secret upstream payload'));
  if (mode === 'wrong_id') run.queryInvoices.mockResolvedValue([{ ...qbo, Id: '901' }]);
  if (mode === 'invalid_id') run.store.snapshot.mockResolvedValue([{ ...invoice, qb_invoice_id: "1' OR true" }]);
  if (mode === 'deadline') run.now = jest.fn().mockReturnValueOnce(0).mockReturnValue(800000);
  await expect(runReview(run)).rejects.toThrow('QBO review failed');
  expect(run.store.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', error_code: 'review_failed' });
  expect(JSON.stringify(run.store.finish.mock.calls)).not.toContain('secret');
});
test('storage unique conflict is the concurrency gate; other errors are not swallowed', async () => {
  const insert = jest.fn().mockResolvedValueOnce({ error: { code: '23505' } }).mockResolvedValueOnce({ error: { code: '42501' } });
  const store = reviewStore({ from: () => ({ insert }) });
  expect(await store.claim({})).toBe(false);
  await expect(store.claim({})).rejects.toThrow('run_claim_failed');
});
