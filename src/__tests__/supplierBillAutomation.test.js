const fs = require('fs');
const path = require('path');
const {
  canonicalBillSize,
  planSupplierBill,
  qboSupplierBillRequestId,
  supplierBillCoordinationKey,
  supplierBillKey,
} = require('../lib/supplierBillAutomation');
const {
  deterministicQboReview,
  vendorLinkMap,
} = require('../../netlify/functions/_supplierBillProcessor');

const bill = (overrides = {}) => ({
  doc_number: 'INV-100',
  si_doc_number: 'SS-1',
  po_number: 'PO 4321 TEAM',
  supplier: 'S&S Activewear',
  doc_date: '10/17/2026',
  merchandise_total: 20,
  freight: 5,
  si_upcharge: 0,
  doc_total: 25,
  is_credit: false,
  has_usable_lines: true,
  items: [{ sku: 'PC61', color: 'Navy', size: 'M', qty: 2, unit_price: 10, extension: 20 }],
  source: 'ss_orders',
  ...overrides,
});

const candidate = (overrides = {}) => ({
  id: 91,
  so_id: 'SO-100',
  po_id: 'PO 4321 TEAM',
  vendor: 'S&S Activewear',
  sku: 'PC61',
  name: 'Essential Tee',
  color: 'Navy',
  sizes: { M: 4, unit_cost: 10 },
  billed: { M: 1 },
  tracking_numbers: [],
  ...overrides,
});

describe('scheduled supplier bill matching', () => {
  test('builds a conservative exact plan with expected values for the atomic writer', () => {
    const plan = planSupplierBill(bill(), [candidate()]);
    expect(plan.action).toBe('apply');
    expect(plan.soId).toBe('SO-100');
    expect(plan.mappings).toEqual([expect.objectContaining({
      po_line_id: 91,
      size: 'M',
      qty: 2,
      expected_ordered: 4,
      expected_billed: 1,
      expected_unit_cost: 10,
      bill_cost: 20,
    })]);
    expect(plan.bill._server_automated).toBe(true);
  });

  test.each([
    ['ambiguous PO ownership', [candidate(), candidate({ id: 92, so_id: 'SO-200' })], 'ambiguous_po'],
    ['ambiguous line ownership', [candidate(), candidate({ id: 92 })], 'ambiguous_line'],
    ['changed supplier cost', [candidate()], 'price_changed', { items: [{ sku: 'PC61', color: 'Navy', size: 'M', qty: 2, unit_price: 11, extension: 22 }], merchandise_total: 22, doc_total: 27 }],
    ['wrong supplier', [candidate({ vendor: 'SanMar' })], 'vendor_unverified'],
    ['unresolved supplier id', [candidate({ vendor: 'v1777312659133' })], 'vendor_unverified'],
    ['wrong color', [candidate()], 'color_mismatch', { items: [{ sku: 'PC61', color: 'Red', size: 'M', qty: 2, unit_price: 10, extension: 20 }] }],
    ['missing color', [candidate()], 'color_unverified', { items: [{ sku: 'PC61', color: '', size: 'M', qty: 2, unit_price: 10, extension: 20 }] }],
    ['invalid extension', [candidate()], 'extension_mismatch', { items: [{ sku: 'PC61', color: 'Navy', size: 'M', qty: 2, unit_price: 10, extension: 200 }], merchandise_total: 200, doc_total: 205 }],
    ['overbilling', [candidate({ billed: { M: 3 } })], 'over_billed'],
    ['document total mismatch', [candidate()], 'total_mismatch', { doc_total: 26 }],
  ])('holds %s for human review', (_label, candidates, code, overrides = {}) => {
    expect(planSupplierBill(bill(overrides), candidates)).toEqual(expect.objectContaining({ action: 'review', code }));
  });

  test('credits and pre-portal PO numbers never enter the unattended writer', () => {
    expect(planSupplierBill(bill({ is_credit: true }), [candidate()]).code).toBe('credit_requires_review');
    expect(planSupplierBill(bill({ po_number: 'PO4321TEAM' }), [candidate({ po_id: 'PO4321TEAM' })]).code).toBe('outside_portal');
  });

  test('normalizes known size labels without making a fuzzy SKU match', () => {
    expect(canonicalBillSize('OSFM')).toBe('OSFA');
    const plan = planSupplierBill(
      bill({ items: [{ sku: 'CAP1', color: 'Black', size: 'OSFM', qty: 1, unit_price: 20, extension: 20 }] }),
      [candidate({ sku: 'CAP1', color: 'Black', sizes: { OSFA: 1, unit_cost: 20 }, billed: {} })],
    );
    expect(plan.mappings[0].size).toBe('OSFA');
  });

  test('repairs a missing ledger after the complete order write already landed', () => {
    const prior = candidate({
      billed: { M: 3 },
      sizes: { M: 4, unit_cost: 10, _bill_details: [{ doc: 'inv-100', sizes: { M: 2 }, cost: 20 }] },
    });
    const plan = planSupplierBill(bill(), [prior]);
    expect(plan.action).toBe('apply');
    expect(plan.mappings[0]._already_applied).toBe(true);
  });

  test('holds a partial prior write instead of applying the missing remainder', () => {
    const twoLineBill = bill({
      merchandise_total: 30,
      doc_total: 35,
      items: [
        { sku: 'PC61', color: 'Navy', size: 'M', qty: 2, unit_price: 10, extension: 20 },
        { sku: 'PC61', color: 'Navy', size: 'L', qty: 1, unit_price: 10, extension: 10 },
      ],
    });
    const priorM = candidate({
      billed: { M: 3 },
      sizes: { M: 4, unit_cost: 10, _bill_details: [{ doc: 'INV-100', sizes: { M: 2 }, cost: 20 }] },
    });
    const pendingL = candidate({ id: 92, billed: { L: 0 }, sizes: { L: 2, unit_cost: 10 } });
    expect(planSupplierBill(twoLineBill, [priorM, pendingL])).toEqual(expect.objectContaining({ action: 'review', code: 'partial_prior_apply' }));
  });

  test('uses one stable invoice/credit-aware idempotency key', () => {
    expect(supplierBillKey(bill())).toBe('invoice|vendor:s and s activewear|doc:inv-100');
    expect(supplierBillKey(bill({ is_credit: true }))).toBe('credit|vendor:s and s activewear|doc:inv-100');
    expect(supplierBillKey({ si_doc_number: 123 })).toBe('invoice|vendor:unknown-vendor|source:123');
    expect(supplierBillKey(bill({ supplier: 'SanMar' }))).not.toBe(supplierBillKey(bill()));
    expect(supplierBillCoordinationKey(bill({ supplier: 'SanMar' }))).toBe(supplierBillCoordinationKey(bill()));
  });
});

describe('database concurrency boundary', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261017211229_automate_supplier_bill_processing.sql'), 'utf8');
  test('serializes both Portal and QBO claims and atomically records Portal application', () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('supplier-bill:'||p_bill_key,0))");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('supplier-bill-qbo:'||p_bill_key,0))");
    expect(migration).toContain('create or replace function public.apply_claimed_supplier_bill');
    expect(migration).toContain('insert into public.applied_bills');
    expect(migration).toContain("raise exception 'SUPPLIER_BILL_STALE_VALUES'");
    expect(migration).toContain('qb_review_required boolean not null default false');
    expect(migration).toContain("'document_vendor_collision'");
    expect(migration).toContain("v_row.vendor_norm is distinct from");
  });

  test('keeps the scheduled write function service-role-only', () => {
    expect(migration).toContain("if coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain('revoke all on function public.apply_claimed_supplier_bill(uuid,jsonb,text) from public,anon,authenticated');
    expect(migration).toContain('grant execute on function public.apply_claimed_supplier_bill(uuid,jsonb,text) to service_role');
  });
});

describe('scheduled QuickBooks handoff', () => {
  test('keeps deterministic accounting conflicts in review and retries transport failures', () => {
    expect(deterministicQboReview(new Error('Vendor Acme is not uniquely linked in QBO'))).toBe(true);
    expect(deterministicQboReview(new Error('QBO upstream request timed out'))).toBe(false);
  });

  test('uses only active durable vendor links', () => {
    expect(vendorLinkMap([
      { value: JSON.stringify({ map_key: 'vendorQBMap', source_id: 'v1', qbo_id: '44', active: true }) },
      { value: JSON.stringify({ map_key: 'vendorQBMap', source_id: 'v2', qbo_id: '45', active: false }) },
      { value: 'not-json' },
    ])).toEqual({ v1: '44' });
  });

  test('uses a deterministic, QBO-safe request id for create retries', () => {
    const one = qboSupplierBillRequestId('realm-1', bill());
    expect(one).toBe(qboSupplierBillRequestId('realm-1', bill()));
    expect(one).not.toBe(qboSupplierBillRequestId('realm-1', bill({ doc_number: 'INV-101' })));
    expect(one.length).toBeLessThanOrEqual(50);
    const app = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
    const qbApi = fs.readFileSync(path.join(__dirname, '../../netlify/functions/qb-api.js'), 'utf8');
    const worker = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_supplierBillProcessor.js'), 'utf8');
    expect(app).toContain("request_id:qboSupplierBillRequestId(qbConfig.realm_id,bill)");
    expect(app).toContain("_parkBillsForLater([b]);// durable supplier_bill_holds row");
    expect(qbApi).toContain('`?requestid=${encodeURIComponent(String(request_id))}`');
    expect(worker).toContain('qboSupplierBillRequestId(realmId, { ...bill, doc_number: docNumber');
  });

  test('is deployed as a private Netlify schedule, not a callable route', () => {
    const toml = fs.readFileSync(path.join(__dirname, '../../netlify.toml'), 'utf8');
    expect(toml).toContain('[functions."supplier-bill-process-scheduled"]');
    expect(toml).toContain('schedule = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"');
    expect(toml).not.toMatch(/supplier-bill-process-scheduled[\s\S]{0,120}\n\s*path\s*=/);
  });

  test('self-heals applied source rows so stale new rows cannot starve the queue', () => {
    const worker = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_supplierBillProcessor.js'), 'utf8');
    expect(worker).toContain("if (claim?.state === 'applied') {");
    expect(worker).toContain('await markSourceApplied(admin, entry.source, entry.sourceId, bill)');
    expect(worker).toContain(".select('*').eq('status', 'new')");
  });
});
