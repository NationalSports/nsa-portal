const { createHash, randomUUID } = require('crypto');

const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const cents = n => n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? null : Math.round(Number(n) * 100);

function compareInvoice(inv, qbo, duplicate) {
  let action;
  const total = cents(qbo?.TotalAmt), balance = cents(qbo?.Balance);
  const portalTotal = cents(inv.total), portalPaid = cents(inv.paid);
  if (duplicate) action = 'duplicate_portal_link';
  else if (!qbo) action = 'missing_qbo_invoice';
  else if ([total, balance, portalTotal, portalPaid].includes(null)) action = 'invalid_amounts';
  else if (String(inv.status).toLowerCase() === 'void') action = total === 0 && balance === 0 ? 'void_verified' : 'void_needs_review';
  else if (total !== portalTotal) action = 'total_differs';
  else if (balance < 0 || balance > total || portalPaid < 0 || portalPaid > portalTotal) action = 'invalid_balance';
  else if (total - balance > portalPaid) action = 'review_payment_pull';
  else if (total - balance < portalPaid) action = 'review_payment_push';
  else action = 'aligned';
  return { invoiceId: inv.id, qboId: inv.qb_invoice_id, action,
    portalTotalCents: portalTotal, portalPaidCents: portalPaid,
    qboTotalCents: total, qboPaidCents: total === null || balance === null ? null : total - balance };
}

// Dependencies intentionally expose a query-only function, not the QBO proxy.
async function runReview({ store, queryInvoices, realm, requestedBy, now = Date.now }) {
  if (!/^\d+$/.test(String(realm || ''))) throw new Error('invalid_realm');
  const id = randomUUID();
  if (!await store.claim({ id, realm_id: realm, company_key: 'national', status: 'running', requested_by: requestedBy }))
    return { status: 'busy' };
  const deadline = now() + 12 * 60 * 1000;
  let report;
  try {
    const before = await store.snapshot();
    if (!Array.isArray(before) || before.length > 20000) throw new Error('snapshot_limit');
    const active = before.filter(i => !i.deleted_at);
    const linked = active.filter(i => i.qb_invoice_id);
    const ids = linked.map(i => String(i.qb_invoice_id));
    if (ids.some(x => !/^\d+$/.test(x))) throw new Error('invalid_qbo_link');
    const counts = new Map();
    ids.forEach(x => counts.set(x, (counts.get(x) || 0) + 1));
    const records = new Map();
    const unique = [...counts.keys()];
    for (let start = 0; start < unique.length; start += 100) {
      if (now() >= deadline) throw new Error('deadline_exceeded');
      const batch = unique.slice(start, start + 100);
      const rows = await queryInvoices(batch);
      if (!Array.isArray(rows)) throw new Error('invalid_qbo_response');
      for (const row of rows) {
        const key = String(row.Id);
        if (!batch.includes(key) || records.has(key)) throw new Error('unexpected_qbo_id');
        records.set(key, row);
      }
    }
    const results = linked.map(inv => compareInvoice(inv, records.get(String(inv.qb_invoice_id)), counts.get(String(inv.qb_invoice_id)) > 1));
    const sourceHash = fingerprint(before);
    const sourceChanged = sourceHash !== fingerprint(await store.snapshot());
    report = { mode: 'read_only', source: 'database_invoice_rows', sourceHash, sourceChanged,
      population: before.map(i => ({ id: i.id, qboId: i.qb_invoice_id, exclusion: i.deleted_at ? 'deleted' : !i.qb_invoice_id ? 'unlinked' : null })),
      counts: { total: before.length, deleted: before.length - active.length, unlinked: active.length - linked.length,
        linked: linked.length, aligned: results.filter(r => r.action === 'aligned').length,
        voidVerified: results.filter(r => r.action === 'void_verified').length }, results };
    const clean = !sourceChanged && linked.length > 0 && results.every(r => ['aligned','void_verified'].includes(r.action));
    const status = clean ? 'complete' : 'needs_review';
    await store.finish(id, { status, report, finished_at: new Date(now()).toISOString() });
    return { id, status, report };
  } catch (error) {
    // No raw upstream messages/tokens are persisted. A failed finish leaves the
    // unique running row in place, preventing a silent retry after uncertain state.
    await store.finish(id, { status: 'failed', finished_at: new Date(now()).toISOString(), error_code: 'review_failed' });
    throw new Error('QBO review failed; inspect run ' + id);
  }
}

function reviewStore(admin) {
  return {
    async claim(row) {
      const { error } = await admin.from('qbo_review_runs').insert(row);
      if (error?.code === '23505') return false;
      if (error) throw new Error('run_claim_failed');
      return true;
    },
    async snapshot() {
      const { data, error } = await admin.rpc('qbo_review_invoice_snapshot');
      if (error) throw new Error('snapshot_failed');
      return data;
    },
    async finish(id, row) {
      const { data, error } = await admin.from('qbo_review_runs').update(row).eq('id', id).eq('status','running').select('id');
      if (error || data?.length !== 1) throw new Error('run_finish_failed');
    },
  };
}
module.exports = { runReview, reviewStore, compareInvoice, fingerprint };
