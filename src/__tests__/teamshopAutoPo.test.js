/* Team Shop auto-purchase-order engine (Phase 3) —
 * netlify/functions/teamshop-auto-po.js + migration 00202 + the Auto POs tab.
 *
 * Money path. Coverage targets the load-bearing claims:
 *   * stock-subtraction math (NSA warehouse on-hand subtracts ONCE per
 *     product+size across items — never double-counted);
 *   * per-vendor grouping via products.inventory_source → settings mapping,
 *     unmapped sources recorded (never silently dropped);
 *   * integer-cents costs from size_costs falling back to nsa_cost;
 *   * IDEMPOTENCY: the same converted order evaluated twice creates no second
 *     PO (needs-row marker short-circuit; client_ref is the DB-level belt);
 *   * zero-need orders create NO purchase orders (but do record evaluation);
 *   * mark_submitted is a compare-and-set from 'draft' recording who/when;
 *   * the staff Auto POs tab renders and degrades pre-migration
 *     (enabled:false banner), same posture as the PO review tab.
 *
 * Function tests use a scripted fake supabase (teamshopCheckout.test.js
 * style); UI tests mock ../lib/supabase + global.fetch (teamShopQueue.test.js
 * style — no jest-dom, plain truthy checks). */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../lib/supabase', () => {
  const makeBuilder = (result) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: global.__mockSession } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table) => makeBuilder((global.__mockTables || {})[table] || { data: [], error: null }),
      rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
    },
  };
});

const fs = require('fs');
const path = require('path');
const autoPo = require('../../netlify/functions/teamshop-auto-po');
const TeamShopQueue = require('../teamshopqueue/TeamShopQueue').default;

// ── Fixtures ─────────────────────────────────────────────────────────
const SETTINGS = [
  { vendor: 'SanMar', inventory_sources: ['sanmar', 'nike'], auto_submit_enabled: false, supplier_account: 'NSA-SM', min_order_cents: null },
  { vendor: 'S&S Activewear', inventory_sources: ['ss_activewear'], auto_submit_enabled: false, supplier_account: null, min_order_cents: 20000 },
  // adidas/UA inventory feeds sync from S&S, but purchasing goes through the
  // brands' own channels — separate PO vendors (owner: ~3-week lead).
  { vendor: 'adidas CLICK', inventory_sources: ['click'], auto_submit_enabled: false, supplier_account: null, min_order_cents: null },
  { vendor: 'UA ArmourHouse', inventory_sources: ['ua'], auto_submit_enabled: false, supplier_account: null, min_order_cents: null },
  { vendor: 'Momentec', inventory_sources: ['momentec'], auto_submit_enabled: false, supplier_account: null, min_order_cents: null },
];

const PRODUCTS = [
  { id: 'p-sm', sku: 'PC61', inventory_source: 'sanmar', nsa_cost: 4.36, size_costs: { S: 4.36, M: 4.36, '2XL': 5.36 } },
  { id: 'p-ss', sku: 'B15453', inventory_source: 'ss_activewear', nsa_cost: 7.5, size_costs: null },
  { id: 'p-mt', sku: 'MT-100', inventory_source: 'momentec', nsa_cost: 12.0, size_costs: null },
  { id: 'p-ag', sku: 'AG-9', inventory_source: 'agron', nsa_cost: 3.0, size_costs: null },
  { id: 'p-ad', sku: 'IW5145', inventory_source: 'click', nsa_cost: 22.0, size_costs: null },
  { id: 'p-ua', sku: 'UA-77', inventory_source: 'ua', nsa_cost: 18.0, size_costs: null },
];

// ── computeNeeds (pure) ──────────────────────────────────────────────
describe('computeNeeds', () => {
  test('subtracts warehouse on-hand per size and prices in integer cents from size_costs / nsa_cost', () => {
    const { needs, vendorGroups } = autoPo.computeNeeds({
      soItems: [{ id: 1, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 10, '2XL': 2 } }],
      products: PRODUCTS,
      inventory: [{ product_id: 'p-sm', size: 'S', quantity: 4 }],
      settings: SETTINGS,
      vendorStock: [{ sku: 'PC61', size: 'S', stock_qty: 999, last_synced: '2026-07-10T00:00:00Z', source: 'sanmar' }],
    });
    const s = needs.find((n) => n.size === 'S');
    expect(s.qty_ordered).toBe(10);
    expect(s.qty_on_hand).toBe(4);
    expect(s.qty_needed).toBe(6);
    expect(s.unit_cost_cents).toBe(436);
    expect(s.vendor_stock_qty).toBe(999); // informational snapshot, not subtracted
    const xxl = needs.find((n) => n.size === '2XL');
    expect(xxl.qty_needed).toBe(2);
    expect(xxl.unit_cost_cents).toBe(536); // per-size upcharge from size_costs
    const g = vendorGroups.SanMar;
    expect(g.lines.length).toBe(2);
    expect(g.totals_cents).toBe(6 * 436 + 2 * 536);
  });

  test('shared on-hand stock is allocated once across items, never double-counted', () => {
    const { needs } = autoPo.computeNeeds({
      soItems: [
        { id: 1, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { M: 5 } },
        { id: 2, item_index: 1, product_id: 'p-sm', sku: 'PC61', sizes: { M: 5 } },
      ],
      products: PRODUCTS,
      inventory: [{ product_id: 'p-sm', size: 'M', quantity: 6 }],
      settings: SETTINGS,
      vendorStock: [],
    });
    const [first, second] = needs;
    expect(first.qty_on_hand).toBe(5); // item 1 claims 5 of the 6
    expect(first.qty_needed).toBe(0);
    expect(second.qty_on_hand).toBe(1); // item 2 gets only the remaining 1
    expect(second.qty_needed).toBe(4);
    // Total needed = 10 ordered - 6 on hand, not 10 - 12.
    expect(needs.reduce((a, n) => a + n.qty_needed, 0)).toBe(4);
  });

  test('groups per vendor by inventory_source and records unmapped sources instead of dropping them', () => {
    const { needs, vendorGroups } = autoPo.computeNeeds({
      soItems: [
        { id: 1, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 1 } },
        { id: 2, item_index: 1, product_id: 'p-ss', sku: 'B15453', sizes: { L: 2 } },
        { id: 3, item_index: 2, product_id: 'p-mt', sku: 'MT-100', sizes: { OS: 3 } },
        { id: 4, item_index: 3, product_id: 'p-ag', sku: 'AG-9', sizes: { OS: 1 } }, // agron: unmapped
        { id: 5, item_index: 4, product_id: null, sku: null, sizes: { M: 2 }, is_custom: true },
      ],
      products: PRODUCTS,
      inventory: [],
      settings: SETTINGS,
      vendorStock: [],
    });
    expect(Object.keys(vendorGroups).sort()).toEqual(['Momentec', 'S&S Activewear', 'SanMar']);
    expect(vendorGroups['S&S Activewear'].lines[0].qty).toBe(2);
    expect(vendorGroups['S&S Activewear'].min_order_cents).toBe(20000);
    const unmapped = needs.filter((n) => n.skip_reason === 'no_vendor_mapping');
    expect(unmapped.length).toBe(2); // agron + custom item
    expect(unmapped.every((n) => n.qty_needed > 0)).toBe(true);
  });

  test('adidas CLICK and UA ArmourHouse route to their own PO vendors, not S&S (purchasing channel != inventory feed)', () => {
    const { vendorGroups } = autoPo.computeNeeds({
      soItems: [
        { id: 1, item_index: 0, product_id: 'p-ad', sku: 'IW5145', sizes: { M: 2 } },
        { id: 2, item_index: 1, product_id: 'p-ua', sku: 'UA-77', sizes: { L: 1 } },
        { id: 3, item_index: 2, product_id: 'p-ss', sku: 'B15453', sizes: { S: 1 } },
      ],
      products: PRODUCTS,
      inventory: [],
      settings: SETTINGS,
      vendorStock: [],
    });
    expect(Object.keys(vendorGroups).sort()).toEqual(['S&S Activewear', 'UA ArmourHouse', 'adidas CLICK']);
    expect(vendorGroups['adidas CLICK'].lines[0].qty).toBe(2);
    expect(vendorGroups['UA ArmourHouse'].lines[0].qty).toBe(1);
  });

  test('fully in-stock order yields zero vendor groups and in_stock rows', () => {
    const { needs, vendorGroups } = autoPo.computeNeeds({
      soItems: [{ id: 1, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 3 } }],
      products: PRODUCTS,
      inventory: [{ product_id: 'p-sm', size: 'S', quantity: 50 }],
      settings: SETTINGS,
      vendorStock: [],
    });
    expect(Object.keys(vendorGroups)).toEqual([]);
    expect(needs[0].skip_reason).toBe('in_stock');
    expect(needs[0].qty_needed).toBe(0);
  });
});

// ── Scripted fake supabase (teamshopCheckout.test.js style) ──────────
// Results consumed in order per "table.op" / "rpc.<fn>" key; every call is
// recorded so tests can assert what was (not) written.
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
      const builder = {
        select() { return builder; },
        eq(col, val) { call.filters.push(['eq', col, val]); return builder; },
        in(col, vals) { call.filters.push(['in', col, vals]); return builder; },
        not(col, op, val) { call.filters.push(['not', col, op, val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        update(payload) { call.op = 'update'; call.payload = payload; return builder; },
        upsert(payload, opts) { call.op = 'upsert'; call.payload = payload; call.opts = opts; return builder; },
        then(resolve, reject) {
          return Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const SO_ID = 'SO-2001';
const freshScript = (overrides = {}) => ({
  'teamshop_auto_po_needs.select': [{ data: [], error: null }],
  'webstore_orders.select': [{ data: [{ id: 'ord-1', order_source: 'teamshop' }], error: null }],
  'so_items.select': [{
    data: [
      { id: 11, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 10 }, is_custom: false },
      { id: 12, item_index: 1, product_id: 'p-mt', sku: 'MT-100', sizes: { OS: 3 }, is_custom: false },
    ],
    error: null,
  }],
  'teamshop_auto_po_settings.select': [{ data: SETTINGS, error: null }],
  'products.select': [{ data: PRODUCTS, error: null }],
  'product_inventory.select': [{ data: [{ product_id: 'p-sm', size: 'S', quantity: 4 }], error: null }],
  'inventory_unified.select': [{ data: [], error: null }],
  'rpc.create_purchase_order': [
    { data: { ok: true, replayed: false, purchase_order: { id: 'po-sm', po_number: 'NSA 501' } }, error: null },
    { data: { ok: true, replayed: false, purchase_order: { id: 'po-mt', po_number: 'NSA 502' } }, error: null },
  ],
  'teamshop_auto_po_needs.upsert': [{ data: null, error: null }],
  ...overrides,
});

describe('generateForSo', () => {
  test('creates one draft PO per vendor via the 00193 RPC with (so_id, vendor) client_refs, then records needs', async () => {
    const sb = fakeSb(freshScript());
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(false);

    const rpcCalls = sb.calls.filter((c) => c.op === 'rpc' && c.table === 'create_purchase_order');
    expect(rpcCalls.length).toBe(2);
    const refs = rpcCalls.map((c) => c.payload.p_client_ref).sort();
    expect(refs).toEqual(['tsauto:SO-2001:Momentec', 'tsauto:SO-2001:SanMar']);
    const sanmar = rpcCalls.find((c) => c.payload.p_client_ref.endsWith('SanMar'));
    expect(sanmar.payload.p_po.status).toBe('draft');
    expect(sanmar.payload.p_po.origin).toBe('auto');
    expect(sanmar.payload.p_po.totals_cents).toBe(6 * 436); // 10 ordered - 4 on hand
    expect(sanmar.payload.p_lines).toEqual([
      expect.objectContaining({ so_id: SO_ID, sku: 'PC61', size: 'S', qty: 6, unit_cost_cents: 436 }),
    ]);

    const upsert = sb.calls.find((c) => c.op === 'upsert' && c.table === 'teamshop_auto_po_needs');
    expect(upsert.opts).toEqual({ onConflict: 'so_id,so_item_id,size', ignoreDuplicates: true });
    expect(upsert.payload.length).toBe(2);
    expect(upsert.payload.find((n) => n.sku === 'PC61').po_id).toBe('po-sm');
  });

  test('IDEMPOTENT: an already-evaluated order replays and creates nothing', async () => {
    const sb = fakeSb({
      'teamshop_auto_po_needs.select': [{ data: [{ id: 1, po_id: 'po-sm' }, { id: 2, po_id: null }], error: null }],
    });
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(true);
    expect(r.po_ids).toEqual(['po-sm']);
    expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(0);
    expect(sb.calls.filter((c) => c.op === 'upsert').length).toBe(0);
  });

  test('zero-need order creates NO purchase orders but records the evaluation', async () => {
    const sb = fakeSb(freshScript({
      'so_items.select': [{ data: [{ id: 11, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 2 }, is_custom: false }], error: null }],
      'product_inventory.select': [{ data: [{ product_id: 'p-sm', size: 'S', quantity: 10 }], error: null }],
    }));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(true);
    expect(r.pos).toEqual([]);
    expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(0);
    const upsert = sb.calls.find((c) => c.op === 'upsert');
    expect(upsert.payload[0].skip_reason).toBe('in_stock');
  });

  test('non-teamshop SO is refused', async () => {
    const sb = fakeSb({
      'teamshop_auto_po_needs.select': [{ data: [], error: null }],
      'webstore_orders.select': [{ data: [], error: null }],
    });
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(false);
    expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(0);
  });

  test('unreadable warehouse stock fails safe: everything needs ordering, and the result says so', async () => {
    const sb = fakeSb(freshScript({
      'product_inventory.select': [{ data: null, error: { message: 'permission denied' } }],
    }));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/needs-ordering/);
    const sanmar = sb.calls.find((c) => c.op === 'rpc' && c.payload.p_client_ref.endsWith('SanMar'));
    expect(sanmar.payload.p_lines[0].qty).toBe(10); // full ordered qty, no subtraction
  });

  test('pre-migration (00202 table missing) degrades to enabled:false', async () => {
    const sb = fakeSb({
      'teamshop_auto_po_needs.select': [{ data: null, error: { code: '42P01', message: 'relation "teamshop_auto_po_needs" does not exist' } }],
    });
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.enabled).toBe(false);
    expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(0);
  });
});

describe('markSubmitted', () => {
  test('compare-and-set from draft, recording who and when', async () => {
    const sb = fakeSb({
      'purchase_orders.update': [{ data: [{ id: 'po-sm', status: 'created', submitted_at: 'now', submitted_by: 'tm-1' }], error: null }],
    });
    const res = await autoPo.markSubmitted(sb, { po_id: 'po-sm' }, { teamMemberId: 'tm-1' });
    expect(res.statusCode).toBe(200);
    const upd = sb.calls.find((c) => c.op === 'update' && c.table === 'purchase_orders');
    expect(upd.payload.status).toBe('created');
    expect(upd.payload.submitted_by).toBe('tm-1');
    expect(upd.payload.submitted_at).toBeTruthy();
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 'po-sm'], ['eq', 'status', 'draft']]));
  });

  test('already-marked PO returns 409, not a second stamp', async () => {
    const sb = fakeSb({ 'purchase_orders.update': [{ data: [], error: null }] });
    const res = await autoPo.markSubmitted(sb, { po_id: 'po-sm' }, { teamMemberId: 'tm-1' });
    expect(res.statusCode).toBe(409);
  });
});

// ── Auto-submit (Phase 3b) ───────────────────────────────────────────
describe('auto-submit', () => {
  const SANMAR_ON = (extra) => [{
    vendor: 'SanMar', inventory_sources: ['sanmar', 'nike'], auto_submit_enabled: true,
    supplier_account: 'NSA-SM', min_order_cents: null, contact_email: 'sanmar@vendor.test', ...extra,
  }];
  const autoScript = (settings, over = {}) => ({
    'teamshop_auto_po_needs.select': [{ data: [], error: null }],
    'webstore_orders.select': [{ data: [{ id: 'ord-1', order_source: 'teamshop' }], error: null }],
    'so_items.select': [{ data: [{ id: 11, item_index: 0, product_id: 'p-sm', sku: 'PC61', sizes: { S: 10 }, is_custom: false }], error: null }],
    'teamshop_auto_po_settings.select': [{ data: settings, error: null }],
    'products.select': [{ data: PRODUCTS, error: null }],
    'product_inventory.select': [{ data: [], error: null }],
    'inventory_unified.select': [{ data: [], error: null }],
    'rpc.create_purchase_order': [{ data: { ok: true, replayed: false, purchase_order: { id: 'po-sm', po_number: 'NSA 501', status: 'draft' } }, error: null }],
    'teamshop_auto_po_needs.upsert': [{ data: null, error: null }],
    'purchase_orders.update': [{ data: [{ id: 'po-sm', status: 'created', submitted_by: 'auto' }], error: null }],
    ...over,
  });

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-brevo';
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' }));
  });
  afterEach(() => { delete process.env.BREVO_API_KEY; });

  test('enabled vendor: emails the PO then marks it submitted (submitted_by=auto) on a fresh draft', async () => {
    const sb = fakeSb(autoScript(SANMAR_ON()));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.ok).toBe(true);
    expect(r.auto_submitted).toBe(1);

    // PO email sent to the vendor's contact_email via Brevo
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    const payload = JSON.parse(opts.body);
    expect(payload.to).toEqual([{ email: 'sanmar@vendor.test' }]);
    expect(payload.htmlContent).toContain('NSA 501');
    expect(payload.htmlContent).toContain('PC61');

    // marked submitted like mark_submitted, but submitted_by 'auto'
    const upd = sb.calls.find((c) => c.op === 'update' && c.table === 'purchase_orders');
    expect(upd.payload.status).toBe('created');
    expect(upd.payload.submitted_by).toBe('auto');
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 'po-sm'], ['eq', 'status', 'draft']]));
  });

  test('below the vendor min_order_cents: left draft, no email, no submit', async () => {
    const sb = fakeSb(autoScript(SANMAR_ON({ min_order_cents: 99999999 })));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.auto_submits[0].reason).toBe('below_min');
    expect(r.auto_submitted).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sb.calls.some((c) => c.op === 'update' && c.table === 'purchase_orders')).toBe(false);
  });

  test('missing contact_email: left draft, no email (surfaced by the stuck sweep)', async () => {
    const sb = fakeSb(autoScript(SANMAR_ON({ contact_email: null })));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.auto_submits[0].reason).toBe('no_vendor_email');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sb.calls.some((c) => c.op === 'update' && c.table === 'purchase_orders')).toBe(false);
  });

  test('auto_submit_enabled=false (default): never emails or marks', async () => {
    const sb = fakeSb(autoScript(SANMAR_ON({ auto_submit_enabled: false })));
    const r = await autoPo.generateForSo(sb, SO_ID, 'tm-1');
    expect(r.auto_submitted).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('autoSubmitPo unit: a racing already-submitted PO returns not_draft, never a second stamp', async () => {
    const sb = fakeSb({ 'purchase_orders.update': [{ data: [], error: null }] });
    const res = await autoPo.autoSubmitPo(sb, {
      po: { id: 'po-sm', po_number: 'NSA 501' }, vendor: 'SanMar',
      setting: { auto_submit_enabled: true, contact_email: 'x@y.test', min_order_cents: null },
      group: { totals_cents: 2616, lines: [{ sku: 'PC61', size: 'S', qty: 6, unit_cost_cents: 436 }] },
    });
    expect(res.submitted).toBe(false);
    expect(res.reason).toBe('not_draft');
  });
});

// ── Migration 00202 static characterization ──────────────────────────
describe('migration 00202', () => {
  const SQL = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/00202_teamshop_auto_po.sql'), 'utf8');

  test('auto-submit is OFF by default and every table has RLS + a rollback footer', () => {
    expect(SQL).toMatch(/auto_submit_enabled\s+boolean not null default false/);
    expect(SQL).toMatch(/alter table public\.teamshop_auto_po_settings enable row level security/);
    expect(SQL).toMatch(/alter table public\.teamshop_auto_po_needs enable row level security/);
    expect(SQL).toMatch(/unique \(so_id, so_item_id, size\)/);
    expect(SQL).toMatch(/Rollback/);
    // Needs table is service-write only: no insert/update policy for it.
    expect(SQL).not.toMatch(/on public\.teamshop_auto_po_needs\s+for (insert|update)/);
  });

  test('seeds the five purchasing channels, replay-safe', () => {
    expect(SQL).toMatch(/'SanMar',\s*'\{sanmar,nike\}'/);
    expect(SQL).toMatch(/'S&S Activewear',\s*'\{ss_activewear\}'/);
    // adidas/UA inventory syncs from S&S, but POs go to the brands' own
    // channels — must never collapse back into the S&S vendor row.
    expect(SQL).toMatch(/'adidas CLICK',\s*'\{click\}'/);
    expect(SQL).toMatch(/'UA ArmourHouse',\s*'\{ua\}'/);
    expect(SQL).toMatch(/'Momentec',\s*'\{momentec\}'/);
    expect(SQL).toMatch(/on conflict \(vendor\) do nothing/);
  });

  test('PO creation stays inside the 00193 RPC — the function never inserts purchase_orders directly', () => {
    const fn = fs.readFileSync(path.join(__dirname, '../../netlify/functions/teamshop-auto-po.js'), 'utf8');
    expect(fn).toMatch(/rpc\('create_purchase_order'/);
    expect(fn).not.toMatch(/from\('purchase_orders'\)\s*\.\s*insert/);
    expect(SQL).not.toMatch(/create or replace function/i); // schema-only migration
  });
});

// ── Auto POs tab (staff UI) ──────────────────────────────────────────
const SESSION = { user: { email: 'staff@nsa.test' }, access_token: 'tok' };
const baseTables = () => ({
  webstore_orders: { data: [], error: null },
  sales_orders: { data: [], error: null },
  so_jobs: { data: [], error: null },
  webstore_order_items: { data: [], error: null },
});

const DRAFT_PO = {
  id: 'po-sm', po_number: 'NSA 501', vendor: 'SanMar', status: 'draft', origin: 'auto',
  totals_cents: 2616, created_at: new Date().toISOString(), submitted_at: null, submitted_by: null,
  lines: [{ id: 'l1', so_id: 'SO-2001', sku: 'PC61', size: 'S', qty: 6, unit_cost_cents: 436 }],
};

const mockFetch = (impl) => {
  global.fetch = jest.fn(async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    const json = await impl(body);
    return { status: 200, json: async () => json };
  });
};

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

async function openAutoPoTab() {
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Auto POs')).toBeTruthy());
  fireEvent.click(screen.getByText('Auto POs'));
}

test('Auto POs tab renders draft POs with lines, server-cents totals, and mark-as-submitted', async () => {
  global.__mockSession = SESSION;
  global.__mockTables = baseTables();
  const posted = [];
  mockFetch(async (body) => {
    posted.push(body);
    if (body.action === 'list') return { ok: true, enabled: true, pos: [DRAFT_PO], unmapped: [{ so_id: 'SO-2001', sku: 'AG-9', size: 'OS', qty_needed: 1 }] };
    if (body.action === 'mark_submitted') return { ok: true, purchase_order: { ...DRAFT_PO, status: 'created' } };
    return {};
  });
  await openAutoPoTab();
  await waitFor(() => expect(screen.getByText('NSA 501')).toBeTruthy());
  expect(screen.getByText('SanMar')).toBeTruthy();
  expect(screen.getByText('$26.16')).toBeTruthy(); // formatted from server-stored cents
  expect(screen.getByText('PC61')).toBeTruthy();
  expect(screen.getByText(/Needs manual ordering/)).toBeTruthy();

  fireEvent.click(screen.getByLabelText('mark-submitted-po-sm'));
  await waitFor(() => expect(posted.some((p) => p.action === 'mark_submitted' && p.po_id === 'po-sm')).toBe(true));
});

test('Auto POs tab degrades pre-migration with a banner, never a blank page', async () => {
  global.__mockSession = SESSION;
  global.__mockTables = baseTables();
  mockFetch(async (body) => (body.action === 'list' ? { ok: true, enabled: false, pos: [], unmapped: [] } : {}));
  await openAutoPoTab();
  await waitFor(() => expect(screen.getByText(/Auto-PO migration \(00202\) not applied yet/)).toBeTruthy());
});
