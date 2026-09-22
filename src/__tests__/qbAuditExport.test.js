import assert from 'assert';
import { collectQBAudit, AUDIT_REALM, AUDIT_ENTITIES } from '../qbAuditExport';
const dates = { cutoff: '2026-05-31', captureThrough: '2026-09-18' };
function fixture(onQuery = () => ({ QueryResponse: {} })) {
  const calls = [];
  return { calls, read: async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'connection_status') return { connected: true, realm_id: AUDIT_REALM };
    if (action === 'company_info') return { CompanyInfo: { Id: '1', CompanyName: 'National Sports Apparel LLC' } };
    assert.equal(action, 'query'); return onQuery(payload.query);
  } };
}
test('reads all entities, preserves full lines/links, includes later payments and makes no writes', async () => {
  const payment = { Id: '17', TxnDate: '2026-08-01', Line: [{ Amount: 40, LinkedTxn: [{ TxnId: '8539', TxnType: 'VendorCredit' }] }] };
  const f = fixture(q => ({ QueryResponse: q.includes('FROM BillPayment ') ? { BillPayment: [payment] } : {} }));
  const result = await collectQBAudit({ ...dates, read: f.read });
  assert.equal(result.complete, true); assert.deepEqual(result.entities.BillPayment, [payment]);
  assert.deepEqual(Object.keys(result.entities), AUDIT_ENTITIES);
  for (const c of f.calls) {
    assert.ok(['connection_status', 'company_info', 'query'].includes(c.action));
    if (c.action === 'query') {
      assert.match(c.payload.query, /^SELECT \* FROM /);
      assert.match(c.payload.query, /Active IN \(true, false\)|TxnDate <= '2026-09-18'/);
      assert.doesNotMatch(c.payload.query, /TxnDate >=/);
    }
  }
});
test('paginates without discarding a full first page', async () => {
  const f = fixture(q => ({ QueryResponse: q.includes('FROM Bill ') ? { Bill: q.includes('STARTPOSITION 1 ') ? Array.from({ length: 500 }, (_, i) => ({ Id: String(i + 1) })) : [{ Id: '501' }] } : {} }));
  const result = await collectQBAudit({ ...dates, read: f.read });
  assert.equal(result.entities.Bill.length, 501);
});
test('server failure shrinks the same page without losing or duplicating records', async () => {
  const attempts = [];
  const f = fixture(q => {
    if (!q.includes('FROM Invoice ')) return { QueryResponse: {} };
    const [, offset, limit] = q.match(/STARTPOSITION (\d+) MAXRESULTS (\d+)/);
    const start = Number(offset), size = Number(limit); attempts.push([start, size]);
    if (start === 501 && size > 20) throw Object.assign(new Error('server failure'), { status: 500 });
    return { QueryResponse: { Invoice: Array.from({ length: Math.min(size, 525 - start + 1) }, (_, i) => ({ Id: String(start + i) })) } };
  });
  const result = await collectQBAudit({ ...dates, read: f.read });
  assert.equal(result.entities.Invoice.length, 525);
  assert.equal(new Set(result.entities.Invoice.map(r => r.Id)).size, 525);
  assert.deepEqual(attempts, [[1, 500], [501, 500], [501, 100], [501, 20], [521, 20]]);
});
test('retries are bounded and authorization failures never retry', async () => {
  for (const status of [500, 403]) {
    let attempts = 0;
    const f = fixture(() => { attempts++; throw Object.assign(new Error('failed'), { status }); });
    await assert.rejects(collectQBAudit({ ...dates, read: f.read }), /Account, record 1: failed/);
    assert.equal(attempts, status === 500 ? 3 : 1);
  }
});
test('wrong realm stops before querying financial records', async () => {
  let calls = 0;
  await assert.rejects(collectQBAudit({ ...dates, read: async () => { calls++; return { connected: true, realm_id: 'wrong' }; } }), /Wrong/);
  assert.equal(calls, 1);
});
test('QBO faults and missing query envelopes cannot become a successful empty capture', async () => {
  for (const response of [null, {}, { Fault: { Error: [{ Detail: 'Denied' }] } }, { error: 'timeout' }]) {
    await assert.rejects(collectQBAudit({ ...dates, read: fixture(() => response).read }));
  }
});
test('repeated page IDs invalidate capture', async () => {
  const f = fixture(q => ({ QueryResponse: q.includes('FROM Bill ') ? { Bill: Array.from({ length: 500 }, (_, i) => ({ Id: String(i + 1) })) } : {} }));
  await assert.rejects(collectQBAudit({ ...dates, read: f.read }), /repeated ID/);
});
test('invalid dates, abort and a changed ending realm fail closed', async () => {
  for (const cutoff of ['2026-02-30', "2026-05-31'", '2027-01-01']) await assert.rejects(collectQBAudit({ ...dates, cutoff, read: fixture().read }), /valid dates/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectQBAudit({ ...dates, read: fixture().read, signal: controller.signal }), /stopped/);
  const f = fixture(); let checks = 0;
  await assert.rejects(collectQBAudit({ ...dates, read: async (a,p) => a === 'connection_status' && ++checks === 2 ? { connected: true, realm_id: 'other' } : f.read(a,p) }), /changed/);
});
