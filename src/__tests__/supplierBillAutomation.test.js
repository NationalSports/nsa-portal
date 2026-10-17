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
  pageFiltered,
  runSupplierBillBacklog,
  vendorLinkMap,
} = require('../../netlify/functions/_supplierBillProcessor');
const supplierBillBackground = require('../../netlify/functions/_background-workers/supplier-bill-process-background');

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

  test('runs once daily around 6 AM Pacific and starts a protected background worker', async () => {
    const toml = fs.readFileSync(path.join(__dirname, '../../netlify.toml'), 'utf8');
    const scheduled = fs.readFileSync(path.join(__dirname, '../../netlify/functions/supplier-bill-process-scheduled.js'), 'utf8');
    const background = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_background-workers/supplier-bill-process-background.js'), 'utf8');
    const backgroundWrapper = fs.readFileSync(path.join(__dirname, '../../netlify/functions/supplier-bill-process-background.mjs'), 'utf8');
    expect(toml).toContain('[functions."supplier-bill-process-scheduled"]');
    expect(toml).toContain('schedule = "0 14 * * *"');
    expect(toml).toContain('6:00 AM Pacific');
    expect(toml).toContain('7:00 AM during daylight time');
    expect(toml).not.toMatch(/supplier-bill-process-scheduled[\s\S]{0,120}\n\s*path\s*=/);
    expect(scheduled).toContain("'x-internal-secret': secret");
    expect(scheduled).toContain('/supplier-bill-process-background');
    expect(background).toContain('safeEqualStr(provided, expected)');
    expect(backgroundWrapper).toContain('export const config = { background: true }');
    expect((await supplierBillBackground.handler({ httpMethod: 'GET', headers: {} })).statusCode).toBe(405);
    expect((await supplierBillBackground.handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'wrong' } })).statusCode).toBe(401);
  });

  test('self-heals applied source rows so stale new rows cannot starve the queue', () => {
    const worker = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_supplierBillProcessor.js'), 'utf8');
    expect(worker).toContain("if (claim?.state === 'applied') {");
    expect(worker).toContain('await markSourceApplied(admin, entry.source, entry.sourceId, bill, signal)');
    expect(worker).toContain(".select('*').eq('status', 'new')");
  });

  test('daily background run drains Portal and QBO batches while skipping rows already attempted', async () => {
    const portalCalls = [];
    const qboCalls = [];
    const portalRows = [
      { scanned: 2, applied: 1, review: 0, busy: 0, failed: 1, sourceKeys: ['ss|1', 'ss|2'] },
      { scanned: 1, applied: 1, review: 0, busy: 0, failed: 0, sourceKeys: ['si|3'] },
      { scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, sourceKeys: [] },
    ];
    const qboRows = [
      { enabled: true, scanned: 2, applied: 1, review: 1, busy: 0, failed: 0, ledgerIds: ['1', '2'] },
      { enabled: true, scanned: 1, applied: 1, review: 0, busy: 0, failed: 0, ledgerIds: ['3'] },
      { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, ledgerIds: [] },
    ];
    const result = await runSupplierBillBacklog({
      admin: {},
      timeBudgetMs: 1000,
      clock: () => 0,
      portalProcessor: async (_admin, _limit, owner, options) => {
        portalCalls.push({ owner, skipped: new Set(options.skipSourceKeys) });
        return portalRows.shift();
      },
      qboProcessor: async (_admin, _limit, owner, options) => {
        qboCalls.push({ owner, skipped: new Set(options.skipLedgerIds) });
        return qboRows.shift();
      },
    });
    expect(result.portal).toEqual(expect.objectContaining({ batches: 3, scanned: 3, applied: 2, failed: 1 }));
    expect(result.quickbooks).toEqual(expect.objectContaining({ batches: 3, scanned: 3, applied: 2, review: 1 }));
    expect(portalCalls[1].skipped).toEqual(new Set(['ss|1', 'ss|2']));
    expect(qboCalls[1].skipped).toEqual(new Set(['1', '2']));
    expect(new Set([...portalCalls, ...qboCalls].map(call => call.owner)).size).toBe(1);
  });

  test('Portal time allocation cannot consume the QBO portion of the daily window', async () => {
    let now = 0;
    let qboCalled = false;
    const result = await runSupplierBillBacklog({
      admin: {},
      timeBudgetMs: 900,
      clock: () => now,
      portalProcessor: async () => {
        now = 301;
        return { scanned: 1, applied: 1, review: 0, busy: 0, failed: 0, sourceKeys: ['ss|1'] };
      },
      qboProcessor: async () => {
        qboCalled = true;
        return { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, ledgerIds: [] };
      },
    });
    expect(qboCalled).toBe(true);
    expect(result.portal.timeBudgetReached).toBe(true);
    expect(result.quickbooks.batches).toBe(1);
  });

  test('database paging reaches safe rows beyond the first 1,000 skipped records', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const ranges = [];
    const rows = await pageFiltered(
      () => ({
        range: async (from, to) => {
          ranges.push([from, to]);
          return { data: from === 0 ? firstPage : [{ id: 1000 }], error: null };
        },
      }),
      row => row.id === 1000,
      1,
      'test page',
      null,
    );
    expect(rows).toEqual([{ id: 1000 }]);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  test('busy leases are retried during the same background window', async () => {
    let now = 0;
    let portalCall = 0;
    const skipped = [];
    const result = await runSupplierBillBacklog({
      admin: {},
      timeBudgetMs: 900,
      clock: () => now,
      sleep: async () => { now += 1; },
      portalProcessor: async (_admin, _limit, _owner, options) => {
        portalCall += 1;
        skipped.push(new Set(options.skipSourceKeys));
        return portalCall === 1
          ? { scanned: 1, applied: 0, review: 0, busy: 1, failed: 0, sourceKeys: ['ss|busy'], busySourceKeys: ['ss|busy'] }
          : { scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, sourceKeys: [] };
      },
      qboProcessor: async () => ({ enabled: false, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, ledgerIds: [] }),
    });
    expect(portalCall).toBe(2);
    expect(skipped[1]).not.toContain('ss|busy');
    expect(result.portal.busy).toBe(1);
  });
});
