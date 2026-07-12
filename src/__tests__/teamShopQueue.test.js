/* Team Shop — Fast Turn Queue (src/teamshopqueue/TeamShopQueue.js).
 * Light coverage: signed-out gate, signed-in board render, stage button RPC
 * args, and the NSA_STALE_STATE refetch path. Mocks the staff `supabase`
 * client the way jobScanResolver.test.js mocks it for netlify functions.
 * (No jest-dom in this repo's test setup — assertions use plain
 * truthy/falsy checks on query results, matching reportsRedesign.smoke.test.js.) */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../lib/supabase', () => {
  // Table-agnostic builder like before (global.__mockTables[table], fixed
  // per-table result) PLUS an opt-in per-table handler function
  // (global.__mockHandlers[table](state)) for tests that need to capture
  // insert/update payloads — same shape teamShopSettings.test.js uses. A
  // table with no handler falls back to the flat map exactly as before, so
  // every pre-existing test in this file is unaffected.
  const makeBuilder = (table) => {
    const state = { table, filters: {}, op: 'select', patch: null };
    const builder = {
      select: () => builder,
      insert: (row) => { state.op = 'insert'; state.patch = row; return builder; },
      update: (patch) => { state.op = 'update'; state.patch = patch; return builder; },
      eq: (col, val) => { state.filters[col] = val; return builder; },
      in: (col, val) => { state.filters[col] = val; return builder; },
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => { state.single = true; return builder; },
      then: (resolve, reject) => {
        const handler = (global.__mockHandlers || {})[table];
        const result = handler ? handler(state) : ((global.__mockTables || {})[table] || { data: [], error: null });
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  };
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: global.__mockSession } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table) => makeBuilder(table),
      rpc: (...args) => global.__rpcMock(...args),
    },
  };
});

const TeamShopQueue = require('../teamshopqueue/TeamShopQueue').default;

const setMocks = ({ session = null, tables = {}, handlers = {}, rpc } = {}) => {
  global.__mockSession = session;
  global.__mockTables = tables;
  global.__mockHandlers = handlers;
  global.__rpcMock = rpc || jest.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
};

const SESSION = { user: { email: 'staff@nsa.test' }, access_token: 'tok' };

const ORDER = {
  id: 'ord-1', order_source: 'teamshop', status: 'batched', so_id: 'SO-1001',
  buyer_name: 'Coach Jones', buyer_email: 'jones@example.com', total: 250.5,
  created_at: new Date().toISOString(),
};

const SO = { id: 'SO-1001' };

const JOB_HOLD = {
  so_id: 'SO-1001', id: 'JOB-1001-01', art_name: 'Eagles LC', deco_type: 'embroidery',
  positions: 'Left Chest', total_units: 24, prod_status: 'hold', art_status: 'needs_art',
  digitizing_needed: true, created_at: '7/1/2026',
};

const baseTables = () => ({
  webstore_orders: { data: [ORDER], error: null },
  sales_orders: { data: [SO], error: null },
  so_jobs: { data: [JOB_HOLD], error: null },
  webstore_order_items: { data: [], error: null },
});

afterEach(() => {
  jest.clearAllMocks();
});

test('signed-out visitor sees the plain gate, not a login form', async () => {
  setMocks({ session: null, tables: baseTables() });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText(/Sign in to Connect first/i)).toBeTruthy());
  expect(screen.queryByRole('textbox', { name: /email/i })).toBeFalsy();
  const link = screen.getByText(/Go to sign in/i);
  expect(link.getAttribute('href')).toBe('/');
});

test('signed-in staff sees the board with columns and the job card', async () => {
  setMocks({ session: SESSION, tables: baseTables() });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Team Shop — Fast Turn Queue')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('Eagles LC')).toBeTruthy());
  expect(screen.getByText(/Hold \(1\)/)).toBeTruthy();
  expect(screen.getByText(/Staging \(0\)/)).toBeTruthy();
  expect(screen.getByText(/In Process \(0\)/)).toBeTruthy();
  expect(screen.getByText(/Completed \(0\)/)).toBeTruthy();
  expect(screen.getByText('Needs digitizing')).toBeTruthy();
  expect(screen.getByText('Coach Jones')).toBeTruthy();
});

test('stage button calls advance_job_stage with the expected args', async () => {
  const rpc = jest.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
  setMocks({ session: SESSION, tables: baseTables(), rpc });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Eagles LC')).toBeTruthy());

  fireEvent.click(screen.getByText('Release →'));

  await waitFor(() => expect(rpc).toHaveBeenCalledWith('advance_job_stage', {
    p_so_id: 'SO-1001',
    p_job_id: 'JOB-1001-01',
    p_event: 'release',
    p_actor: 'staff@nsa.test',
    p_expected: 'hold',
  }));
});

test('NSA_STALE_STATE error shows the refresh toast and refetches', async () => {
  const rpc = jest.fn(() => Promise.resolve({ data: null, error: { message: 'NSA_STALE_STATE:staging' } }));
  setMocks({ session: SESSION, tables: baseTables(), rpc });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Eagles LC')).toBeTruthy());

  fireEvent.click(screen.getByText('Release →'));

  await waitFor(() => expect(screen.getByText(/Job moved by someone else — refreshed/i)).toBeTruthy());
  expect(rpc).toHaveBeenCalledTimes(1);
});

const UNCONVERTED_ORDER = {
  id: 'ord-2', order_source: 'teamshop', status: 'paid', so_id: null,
  buyer_name: 'Coach Adams', buyer_email: 'adams@example.com', total: 99.99,
  created_at: new Date().toISOString(),
};

test('Retry button on an awaiting-conversion order calls teamshop-retry-convert and shows success inline', async () => {
  setMocks({ session: SESSION, tables: { ...baseTables(), webstore_orders: { data: [ORDER, UNCONVERTED_ORDER], error: null } } });
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ ok: true, so_id: 'SO-2002' }),
  }));
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Awaiting conversion (1)')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('retry-convert-ord-2'));

  await waitFor(() => expect(screen.getByText('Converted — SO-2002')).toBeTruthy());
  expect(global.fetch).toHaveBeenCalledWith('/.netlify/functions/teamshop-retry-convert', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ order_id: 'ord-2' }),
  }));
  const [, opts] = global.fetch.mock.calls[0];
  expect(opts.headers.Authorization).toBe('Bearer tok');
});

test('Retry button shows the real error message inline on failure', async () => {
  setMocks({ session: SESSION, tables: { ...baseTables(), webstore_orders: { data: [UNCONVERTED_ORDER], error: null } } });
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ error: 'Duplicate key value violates unique constraint' }),
  }));
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Awaiting conversion (1)')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('retry-convert-ord-2'));

  await waitFor(() => expect(screen.getByText('Duplicate key value violates unique constraint')).toBeTruthy());
});

test('missing RPC function disables stage buttons with a note', async () => {
  const rpc = jest.fn(() => Promise.resolve({
    data: null,
    error: { message: 'Could not find the function public.advance_job_stage in the schema cache' },
  }));
  setMocks({ session: SESSION, tables: baseTables(), rpc });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Eagles LC')).toBeTruthy());

  fireEvent.click(screen.getByText('Release →'));

  // Both the toast and the persistent banner say this, so match must expect >= 1.
  await waitFor(() => expect(screen.getAllByText(/State machine migration not applied yet/i).length).toBeGreaterThan(0));
});

// ── Production HQ reorg (this pass): 3 top-level tabs, override dialog,
// Auto-PO vendor CRUD, Automation toggle ──────────────────────────────────
const fetchStub = (extra) => jest.fn(() => Promise.resolve({
  json: () => Promise.resolve({ ok: true, enabled: true, orders: [], pos: [], unmapped: [], ...extra }),
}));

test('Production HQ renders 3 tabs; Production & Pull (the original board) is the default', async () => {
  setMocks({ session: SESSION, tables: baseTables() });
  global.fetch = fetchStub();
  render(<TeamShopQueue />);

  await waitFor(() => expect(screen.getByText('Production HQ')).toBeTruthy());
  expect(screen.getByText('Pipeline')).toBeTruthy();
  expect(screen.getByText('Production & Pull')).toBeTruthy();
  expect(screen.getByText('Settings')).toBeTruthy();
  // Default tab is the unchanged Kanban board.
  await waitFor(() => expect(screen.getByText('Team Shop — Fast Turn Queue')).toBeTruthy());

  fireEvent.click(screen.getByText('Pipeline'));
  await waitFor(() => expect(screen.getByText('Order pipeline')).toBeTruthy());
  expect(screen.getByLabelText('run-stuck-sweep')).toBeTruthy();
  // PO review + Auto POs are folded in here as Actions (moved off their own
  // top-level tabs this pass — see teamShopPoReviewTab.test.js / teamshopAutoPo.test.js).
  await waitFor(() => expect(screen.getByText('Team Shop — PO review')).toBeTruthy());
  expect(screen.getByText('Team Shop — Auto POs')).toBeTruthy();

  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => expect(screen.getByText('Team Shop — Settings')).toBeTruthy());
  expect(screen.getByText('Auto-PO vendors')).toBeTruthy();
  expect(screen.getByText('Automation')).toBeTruthy();
});

test('NSA_NOT_READY release opens the override dialog; confirming re-calls advance_job_stage with p_override + p_reason', async () => {
  const rpc = jest.fn()
    .mockResolvedValueOnce({ data: null, error: { message: 'NSA_NOT_READY:art=needs_art,item=need_to_order' } })
    .mockResolvedValueOnce({ data: { ok: true }, error: null });
  setMocks({ session: SESSION, tables: baseTables(), rpc });
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Eagles LC')).toBeTruthy());

  fireEvent.click(screen.getByText('Release →'));
  await waitFor(() => expect(screen.getByText("Job isn't release-ready")).toBeTruthy());

  const confirmBtn = screen.getByLabelText('confirm-override-release');
  expect(confirmBtn.disabled).toBe(true); // no reason yet

  fireEvent.change(screen.getByLabelText('override-reason'), { target: { value: 'Confirmed stock by hand' } });
  fireEvent.click(screen.getByLabelText('confirm-override-release'));

  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc).toHaveBeenNthCalledWith(2, 'advance_job_stage', {
    p_so_id: 'SO-1001',
    p_job_id: 'JOB-1001-01',
    p_event: 'release',
    p_actor: 'staff@nsa.test',
    p_expected: 'hold',
    p_override: true,
    p_reason: 'Confirmed stock by hand',
  });
  await waitFor(() => expect(screen.getByText('Released with override')).toBeTruthy());
});

const VENDOR_ROW = { vendor: 'SanMar', inventory_sources: ['sanmar', 'nike'], contact_email: '', auto_submit_enabled: false, min_order_cents: null };

test('Settings — Auto-PO vendors: editing the contact email and saving issues the expected update', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    session: SESSION,
    tables: baseTables(),
    handlers: {
      teamshop_auto_po_settings: (state) => (state.op === 'update' ? updateSpy(state) : { data: [VENDOR_ROW], error: null }),
    },
  });
  global.fetch = fetchStub();
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => expect(screen.getByLabelText('vendor-email-SanMar')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('vendor-email-SanMar'), { target: { value: 'orders@sanmar.test' } });
  fireEvent.click(screen.getByLabelText('save-vendor-SanMar'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.vendor).toBe('SanMar');
  expect(call.patch).toEqual({
    inventory_sources: ['sanmar', 'nike'],
    contact_email: 'orders@sanmar.test',
    auto_submit_enabled: false,
    min_order_cents: null,
  });
});

test('Settings — Auto-PO vendors: Add vendor inserts a new row', async () => {
  const insertSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    session: SESSION,
    tables: baseTables(),
    handlers: {
      teamshop_auto_po_settings: (state) => (state.op === 'insert' ? insertSpy(state) : { data: [], error: null }),
    },
  });
  global.fetch = fetchStub();
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => expect(screen.getByLabelText('new-vendor-name')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('new-vendor-name'), { target: { value: 'New Vendor Co' } });
  fireEvent.change(screen.getByLabelText('new-vendor-sources'), { target: { value: 'sanmar, nike' } });
  fireEvent.click(screen.getByLabelText('add-vendor-submit'));

  await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1));
  const patch = insertSpy.mock.calls[0][0].patch;
  expect(patch.vendor).toBe('New Vendor Co');
  expect(patch.inventory_sources).toEqual(['sanmar', 'nike']);
});

test('Settings — Automation: toggling auto-release + scope and saving issues the expected update', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    session: SESSION,
    tables: baseTables(),
    handlers: {
      teamshop_settings: (state) => (state.op === 'update'
        ? updateSpy(state)
        : { data: { id: 'global', auto_release_enabled: false, auto_release_scope: 'auto_art_only' }, error: null }),
    },
  });
  global.fetch = fetchStub();
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => expect(screen.getByLabelText('auto-release-enabled')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('auto-release-enabled'));
  fireEvent.change(screen.getByLabelText('auto-release-scope'), { target: { value: 'all' } });
  fireEvent.click(screen.getByLabelText('save-automation-settings'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('global');
  expect(call.patch).toEqual({ auto_release_enabled: true, auto_release_scope: 'all' });
});
