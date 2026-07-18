// Supplier-bill server ledger helpers (Spec 1) — row shaping, pre-migration
// fallback detection, and the Bill History local∪server union.
import {
  buildAppliedBillRows,
  legacyAppliedBillRows,
  LEGACY_APPLIED_BILL_COLS,
  isMissingLedgerColumnError,
  mergeServerBills,
} from '../appliedBillsLedger';

describe('buildAppliedBillRows', () => {
  const bill = (p, extra) => ({ parsed: p, ...extra });

  it('shapes a full post-00184 row and normalizes the dedup key', () => {
    const rows = buildAppliedBillRows([bill({
      doc_number: '  INV-1001 ', si_doc_number: 55123, is_credit: false,
      vendor: 'Sports Inc', po_number: 'PO 3517', doc_total: 412.5, source: 'sportsinc',
      matchedPO: { so_id: 'SO-1396' }, rawText: 'HUGE', _wizard: { open: true },
    }, { portalStatus: 'success' })], 'Sam');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.doc_norm).toBe('inv-1001');
    expect(r.doc_number).toBe('INV-1001');       // original casing kept for display
    expect(r.si_doc_number).toBe('55123');
    expect(r.status).toBe('pushed');
    expect(r.portal_status).toBe('success');
    expect(r.applied_by).toBe('Sam');
    expect(r.applied_so_ids).toEqual(['SO-1396']);
    expect(r.raw_meta.rawText).toBeUndefined();  // stripped, same as holds
    expect(r.raw_meta._wizard).toBeUndefined();
    expect(r.raw_meta.vendor).toBe('Sports Inc');
    expect(typeof r.updated_at).toBe('string');
  });

  it('skips unkeyable bills and bills without parsed', () => {
    expect(buildAppliedBillRows([bill({ vendor: 'X' }), { notParsed: true }, null], 'u')).toEqual([]);
  });

  it('keys on the SI order # alone when there is no doc #', () => {
    const rows = buildAppliedBillRows([bill({ si_doc_number: ' 991 ' })], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].doc_norm).toBeNull();
    expect(rows[0].si_doc_number).toBe('991');
  });

  it('carries the credit flag (credit note coexists with its invoice)', () => {
    const rows = buildAppliedBillRows([bill({ doc_number: 'D1', is_credit: true })], 'u');
    expect(rows[0].is_credit).toBe(true);
  });
});

describe('legacyAppliedBillRows (pre-00184 fallback payload)', () => {
  it('strips to exactly the 00178 column set', () => {
    const [full] = buildAppliedBillRows([{ parsed: { doc_number: 'D2', vendor: 'V' } }], 'u');
    const [legacy] = legacyAppliedBillRows([full]);
    expect(Object.keys(legacy).sort()).toEqual([...LEGACY_APPLIED_BILL_COLS].sort());
    expect(legacy.doc_norm).toBe('d2');
    expect(legacy.status).toBeUndefined();
    expect(legacy.raw_meta).toBeUndefined();
  });
});

describe('isMissingLedgerColumnError', () => {
  it('matches Postgres 42703 and PostgREST schema-cache misses', () => {
    expect(isMissingLedgerColumnError({ code: '42703' })).toBe(true);
    expect(isMissingLedgerColumnError({ code: 'PGRST204', message: "Could not find the 'status' column of 'applied_bills' in the schema cache" })).toBe(true);
    expect(isMissingLedgerColumnError({ message: 'column "raw_meta" does not exist' })).toBe(true);
  });
  it('does not match unrelated errors', () => {
    expect(isMissingLedgerColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingLedgerColumnError(null)).toBe(false);
    expect(isMissingLedgerColumnError({ message: 'relation "applied_bills" does not exist' })).toBe(false);
  });
});

describe('mergeServerBills (Bill History union)', () => {
  const srv = (o) => ({ id: 7, doc_norm: 'inv-9', doc_number: 'INV-9', is_credit: false, vendor: 'V', doc_total: 10, portal_status: 'success', applied_at: '2026-07-01T10:00:00Z', ...o });

  it('returns local list untouched when the server adds nothing new', () => {
    const local = [{ id: 'a', parsed: { doc_number: 'INV-9' }, uploadedTs: 5 }];
    expect(mergeServerBills(local, [srv()])).toBe(local);
  });

  it('adds server-only rows as read-only pushed entries (survives cleared localStorage)', () => {
    const merged = mergeServerBills([], [srv()]);
    expect(merged).toHaveLength(1);
    expect(merged[0]._serverLedger).toBe(true);
    expect(merged[0].portalStatus).toBe('success');
    expect(merged[0].parsed.doc_number).toBe('INV-9');
    expect(merged[0].uploadedTs).toBe(Date.parse('2026-07-01T10:00:00Z'));
  });

  it('prefers raw_meta as the parsed payload when present', () => {
    const merged = mergeServerBills([], [srv({ raw_meta: { doc_number: 'INV-9', items: [{ sku: 'A', qty: 2 }], freight: 3 } })]);
    expect(merged[0].parsed.items).toHaveLength(1);
    expect(merged[0].parsed.freight).toBe(3);
  });

  it('an invoice does not suppress its credit note (shared doc #)', () => {
    const local = [{ id: 'a', parsed: { doc_number: 'INV-9', is_credit: false }, uploadedTs: 5 }];
    const merged = mergeServerBills(local, [srv({ is_credit: true })]);
    expect(merged).toHaveLength(2);
  });

  it('dedups by SI order # too, and sorts merged history newest-first', () => {
    const local = [{ id: 'a', parsed: { si_doc_number: '55123' }, uploadedTs: Date.parse('2026-07-05T00:00:00Z') }];
    const merged = mergeServerBills(local, [
      srv({ id: 1, doc_norm: null, doc_number: null, si_doc_number: '55123' }), // dup of local by SI #
      srv({ id: 2, doc_norm: 'x-1', doc_number: 'X-1', applied_at: '2026-07-06T00:00:00Z' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('srv-2'); // newest first
    expect(merged[1].id).toBe('a');
  });
});

// ── Adversarial-input regressions (2026-07-18 sweep) ──
describe('numeric-string doc_total coercion', () => {
  it('buildAppliedBillRows keeps a doc_total that round-tripped as a numeric string', () => {
    // Regression: safeNum is number-typed only — "412.50" used to become null.
    const rows = buildAppliedBillRows([{ parsed: { doc_number: 'INV-1', doc_total: '412.50' } }], 'Sam');
    expect(rows[0].doc_total).toBe(412.5);
  });
  it('buildAppliedBillRows maps garbage and empty doc_total to null, not NaN', () => {
    expect(buildAppliedBillRows([{ parsed: { doc_number: 'INV-1', doc_total: 'abc' } }], 'S')[0].doc_total).toBeNull();
    expect(buildAppliedBillRows([{ parsed: { doc_number: 'INV-1', doc_total: '' } }], 'S')[0].doc_total).toBeNull();
    expect(buildAppliedBillRows([{ parsed: { doc_number: 'INV-1' } }], 'S')[0].doc_total).toBeNull();
  });
  it('mergeServerBills fallback row keeps a string doc_total from the server', () => {
    const merged = mergeServerBills([], [{ id: 3, doc_norm: 'inv-3', doc_number: 'INV-3', doc_total: '99.95', raw_meta: null, applied_at: '2026-07-01T10:00:00Z' }]);
    expect(merged[0].parsed.doc_total).toBe(99.95);
  });
  it('mergeServerBills tolerates an unparseable applied_at (sorts last, blank uploadedAt, no crash)', () => {
    const merged = mergeServerBills([], [
      { id: 1, doc_norm: 'inv-a', doc_number: 'INV-A', applied_at: 'not-a-date' },
      { id: 2, doc_norm: 'inv-b', doc_number: 'INV-B', applied_at: '2026-07-06T00:00:00Z' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('srv-2');
    expect(merged[1].id).toBe('srv-1');
    expect(merged[1].uploadedAt).toBe('');
    expect(merged[1].uploadedTs).toBe(0);
  });
  it('buildAppliedBillRows is not idempotent — same bill twice yields two identical-key rows (caller/DB dedups)', () => {
    const b = { parsed: { doc_number: 'INV-1', doc_total: 10 } };
    const rows = buildAppliedBillRows([b, b], 'S');
    expect(rows).toHaveLength(2);
    expect(rows[0].doc_norm).toBe(rows[1].doc_norm);
  });
});
