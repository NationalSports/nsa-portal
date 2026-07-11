/* Team Shop — Settings tab (src/teamshopqueue/TeamShopQueue.js).
 * Covers the rate card, School-PO eligibility, and shipping fee sub-sections
 * added to the staff-only Team Shop Queue chunk. Mocks the staff `supabase`
 * client the way teamShopQueue.test.js does, extended with a per-table
 * handler function so update/insert calls can be captured and asserted.
 * (No jest-dom in this repo's test setup — assertions use plain
 * truthy/falsy checks, matching teamShopQueue.test.js.) */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../lib/supabase', () => {
  const makeBuilder = (table) => {
    const state = { table, filters: {}, op: 'select', patch: null };
    const builder = {
      select: () => builder,
      insert: (row) => { state.op = 'insert'; state.patch = row; return builder; },
      update: (patch) => { state.op = 'update'; state.patch = patch; return builder; },
      eq: (col, val) => { state.filters[col] = val; return builder; },
      ilike: (col, val) => { state.filters[col + '__ilike'] = val; return builder; },
      in: (col, val) => { state.filters[col] = val; return builder; },
      order: () => builder,
      limit: (n) => { state.limit = n; return builder; },
      maybeSingle: () => { state.single = true; return builder; },
      then: (resolve, reject) => {
        const handler = (global.__mockHandlers || {})[table];
        const result = handler ? handler(state) : { data: [], error: null };
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
      rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
    },
  };
});

const TeamShopQueue = require('../teamshopqueue/TeamShopQueue').default;

const SESSION = { user: { email: 'staff@nsa.test' }, access_token: 'tok' };

const emptyQueueHandlers = () => ({
  webstore_orders: () => ({ data: [], error: null }),
  sales_orders: () => ({ data: [], error: null }),
  so_jobs: () => ({ data: [], error: null }),
  webstore_order_items: () => ({ data: [], error: null }),
});

const RATE_ROW = {
  id: 'r1', family: 'embroidery', type: 'embroidery', option_key: 'standard',
  label: 'Embroidery', price: 8, cost: null, min_qty: 1, sort_order: 0, active: true,
};

const STORE_ROW = { id: 'store-1', flat_shipping: 0 };

const TL_ROW = {
  id: 't1', rule_key: 'source_sanmar_ss', rule_type: 'source',
  inventory_sources: ['sanmar', 'nike', 'ss_activewear'], deco_type: null,
  min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks', sort_order: 10,
  active: true, notes: null,
};

const setMocks = (handlers) => {
  global.__mockSession = SESSION;
  global.__mockHandlers = { ...emptyQueueHandlers(), ...handlers };
};

const openSettings = async () => {
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('Team Shop — Fast Turn Queue')).toBeTruthy());
  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => expect(screen.getByText('Team Shop — Settings')).toBeTruthy());
};

afterEach(() => {
  jest.clearAllMocks();
});

test('renders all three settings sections with mocked data', async () => {
  setMocks({
    teamshop_deco_rates: () => ({ data: [RATE_ROW], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByText('Deco rate card')).toBeTruthy());
  expect(screen.getByText('School PO eligibility')).toBeTruthy();
  expect(screen.getByText('Shipping')).toBeTruthy();
  await waitFor(() => expect(screen.getByDisplayValue('Embroidery')).toBeTruthy());
});

test('editing a rate row issues the expected update', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    teamshop_deco_rates: (state) => (state.op === 'update' ? updateSpy(state) : { data: [RATE_ROW], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByDisplayValue('Embroidery')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('price-r1'), { target: { value: '9.50' } });
  fireEvent.click(screen.getByLabelText('save-rate-r1'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('r1');
  expect(call.patch).toEqual({ label: 'Embroidery', price: 9.5, cost: null, min_qty: 1, active: true });
});

test('Active checkbox alone issues the update (regression: stale-closure skip)', async () => {
  // Toggling Active with no other pending edit must still hit the DB — the
  // original implementation re-read edits state from a stale closure and
  // silently skipped the save, leaving a "deactivated" rate live.
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    teamshop_deco_rates: (state) => (state.op === 'update' ? updateSpy(state) : { data: [RATE_ROW], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('active-r1')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('active-r1'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('r1');
  expect(call.patch).toEqual({ label: 'Embroidery', price: 8, cost: null, min_qty: 1, active: false });
});

test('add-option inserts a new row with the derived family', async () => {
  const insertSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    teamshop_deco_rates: (state) => (state.op === 'insert' ? insertSpy(state) : { data: [], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('new-rate-type')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('new-rate-type'), { target: { value: 'vinyl' } });
  fireEvent.change(screen.getByLabelText('new-rate-label'), { target: { value: 'Sleeve vinyl' } });
  fireEvent.change(screen.getByLabelText('new-rate-price'), { target: { value: '4.25' } });
  fireEvent.click(screen.getByLabelText('add-rate-option-submit'));

  await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1));
  const patch = insertSpy.mock.calls[0][0].patch;
  expect(patch.type).toBe('vinyl');
  expect(patch.family).toBe('heat');
  expect(patch.label).toBe('Sleeve vinyl');
  expect(patch.price).toBe(4.25);
});

test('PO toggle updates the customer row', async () => {
  const CUST = { id: 'cust-1', name: 'Eagles Program', teamshop_po_allowed: false };
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    teamshop_deco_rates: () => ({ data: [], error: null }),
    customers: (state) => {
      if (state.op === 'update') return updateSpy(state);
      if (state.filters['name__ilike']) return { data: [CUST], error: null };
      return { data: [], error: null }; // proactive probe
    },
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByText('School PO eligibility')).toBeTruthy());

  fireEvent.change(screen.getByPlaceholderText('Search customer / program name'), { target: { value: 'Eagles' } });
  await waitFor(() => expect(screen.getByText('Eagles Program')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('po-allowed-cust-1'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('cust-1');
  expect(call.patch).toEqual({ teamshop_po_allowed: true });
});

test('shipping save updates the store row', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks({
    teamshop_deco_rates: () => ({ data: [], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: (state) => (state.op === 'update' ? updateSpy(state) : { data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('flat-shipping')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('flat-shipping'), { target: { value: '12.50' } });
  fireEvent.click(screen.getByText('Save'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('store-1');
  expect(call.patch).toEqual({ flat_shipping: 12.5 });
});

test('pre-migration: missing rate card table shows the 00198 banner', async () => {
  setMocks({
    teamshop_deco_rates: () => ({ data: null, error: { code: '42P01', message: 'relation "teamshop_deco_rates" does not exist' } }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByText(/Rate card migration \(00198\) not applied yet/i)).toBeTruthy());
});

test('pre-migration: missing teamshop_po_allowed column hides the PO section', async () => {
  setMocks({
    teamshop_deco_rates: () => ({ data: [], error: null }),
    customers: () => ({ data: null, error: { code: '42703', message: 'column customers.teamshop_po_allowed does not exist' } }),
    webstores: () => ({ data: STORE_ROW, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByText(/School-PO eligibility migration \(00200\) not applied yet/i)).toBeTruthy());
});

test('pre-migration: missing store row hides shipping', async () => {
  setMocks({
    teamshop_deco_rates: () => ({ data: [], error: null }),
    customers: () => ({ data: [], error: null }),
    webstores: () => ({ data: null, error: null }),
  });
  await openSettings();
  await waitFor(() => expect(screen.getByText(/Team Shop store row .* not found/i)).toBeTruthy());
});

// ── Delivery timelines section (00203) ──────────────────────────────────────
const tlHandlers = (tlHandler) => ({
  teamshop_deco_rates: () => ({ data: [], error: null }),
  customers: () => ({ data: [], error: null }),
  webstores: () => ({ data: STORE_ROW, error: null }),
  teamshop_delivery_timelines: tlHandler,
});

test('renders the Delivery timelines section with the rule description and editable fields', async () => {
  setMocks(tlHandlers(() => ({ data: [TL_ROW], error: null })));
  await openSettings();
  await waitFor(() => expect(screen.getByText('Delivery timelines')).toBeTruthy());
  await waitFor(() => expect(screen.getByDisplayValue('~1.5–2 weeks')).toBeTruthy());
  expect(screen.getByText('Blanks from: sanmar, nike, ss_activewear')).toBeTruthy();
});

test('editing min weeks + Save issues the full explicit update patch', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks(tlHandlers((state) => (state.op === 'update' ? updateSpy(state) : { data: [TL_ROW], error: null })));
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('tl-min-t1')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('tl-min-t1'), { target: { value: '1' } });
  fireEvent.click(screen.getByLabelText('save-tl-t1'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('t1');
  expect(call.patch).toEqual({ label: '~1.5–2 weeks', min_weeks: 1, max_weeks: 2, active: true });
});

test('Active checkbox alone issues the update (explicit patch — no stale-closure skip)', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks(tlHandlers((state) => (state.op === 'update' ? updateSpy(state) : { data: [TL_ROW], error: null })));
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('tl-active-t1')).toBeTruthy());

  fireEvent.click(screen.getByLabelText('tl-active-t1'));

  await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  const call = updateSpy.mock.calls[0][0];
  expect(call.filters.id).toBe('t1');
  expect(call.patch).toEqual({ label: '~1.5–2 weeks', min_weeks: 1.5, max_weeks: 2, active: false });
});

test('max < min is rejected client-side with a toast and no update', async () => {
  const updateSpy = jest.fn(() => ({ data: null, error: null }));
  setMocks(tlHandlers((state) => (state.op === 'update' ? updateSpy(state) : { data: [TL_ROW], error: null })));
  await openSettings();
  await waitFor(() => expect(screen.getByLabelText('tl-max-t1')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('tl-max-t1'), { target: { value: '1' } });
  fireEvent.click(screen.getByLabelText('save-tl-t1'));

  await waitFor(() => expect(screen.getByText(/max weeks must be/i)).toBeTruthy());
  expect(updateSpy).not.toHaveBeenCalled();
});

test('pre-migration: missing timelines table shows the 00203 banner', async () => {
  setMocks(tlHandlers(() => ({ data: null, error: { code: '42P01', message: 'relation "teamshop_delivery_timelines" does not exist' } })));
  await openSettings();
  await waitFor(() => expect(screen.getByText(/Delivery timelines migration \(00203\) not applied yet/i)).toBeTruthy());
});
