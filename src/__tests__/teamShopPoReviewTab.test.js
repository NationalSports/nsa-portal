/* Team Shop — staff PO review tab (src/teamshopqueue/TeamShopQueue.js).
 * Mocks the staff `supabase` client the way teamShopSettings.test.js does,
 * plus global.fetch for the teamshop-po-review function the tab calls
 * (list/approve/reject all go through the function — the PDF bucket is
 * private, so the browser never reads it directly). */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../lib/supabase', () => {
  const makeBuilder = (table) => {
    const builder = {
      select: () => builder,
      eq: () => builder, in: () => builder, order: () => builder,
      limit: () => builder, ilike: () => builder, maybeSingle: () => builder,
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
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

const SESSION = { user: { email: 'staff@nsa.test' }, access_token: 'staff-tok' };

const PENDING = {
  id: 'ordpo1', order_number: 1010002, created_at: new Date().toISOString(),
  total: 250.5, customer_name: 'Central High', coach_name: 'Pat Jones',
  buyer_email: 'jones@example.com', po_number: 'PO-2026-0042',
  pdf_url: 'https://signed.example/po.pdf',
};

// Routes calls to /.netlify/functions/teamshop-po-review by action.
const mockFetch = (handlers) => {
  global.fetch = jest.fn(async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    const handler = handlers[body.action] || (() => ({ ok: true, enabled: true, orders: [] }));
    return { ok: true, status: 200, json: async () => handler(body, opts) };
  });
};

const openPoTab = async () => {
  global.__mockSession = SESSION;
  render(<TeamShopQueue />);
  await waitFor(() => expect(screen.getByText('PO review')).toBeTruthy());
  fireEvent.click(screen.getByText('PO review'));
  await waitFor(() => expect(screen.getByText('Team Shop — PO review')).toBeTruthy());
};

afterEach(() => { jest.clearAllMocks(); });

test('renders pending PO orders with customer, PO number, and the signed View PDF link', async () => {
  mockFetch({ list: () => ({ ok: true, enabled: true, orders: [PENDING] }) });
  await openPoTab();
  await waitFor(() => expect(screen.getByText('PO-2026-0042')).toBeTruthy());
  expect(screen.getByText('Central High')).toBeTruthy();
  expect(screen.getByText('Pat Jones')).toBeTruthy();
  expect(screen.getByText('$250.50')).toBeTruthy();
  const link = screen.getByText('View PDF');
  expect(link.getAttribute('href')).toBe('https://signed.example/po.pdf');
  // the list call carried the staff bearer token
  const [, opts] = global.fetch.mock.calls[0];
  expect(opts.headers.Authorization).toBe('Bearer staff-tok');
});

test('Approve posts the approve action for the order', async () => {
  const seen = [];
  mockFetch({
    list: () => ({ ok: true, enabled: true, orders: [PENDING] }),
    approve: (body) => { seen.push(body); return { ok: true, so_id: 'SO-1002' }; },
  });
  await openPoTab();
  await waitFor(() => expect(screen.getByLabelText('approve-po-ordpo1')).toBeTruthy());
  fireEvent.click(screen.getByLabelText('approve-po-ordpo1'));
  await waitFor(() => expect(seen).toHaveLength(1));
  expect(seen[0]).toMatchObject({ action: 'approve', order_id: 'ordpo1' });
  await waitFor(() => expect(screen.getByText(/PO approved — production order SO-1002/)).toBeTruthy());
});

test('Reject requires a reason, then posts the reject action with it', async () => {
  const seen = [];
  mockFetch({
    list: () => ({ ok: true, enabled: true, orders: [PENDING] }),
    reject: (body) => { seen.push(body); return { ok: true, emailed: true }; },
  });
  await openPoTab();
  await waitFor(() => expect(screen.getByLabelText('reject-po-ordpo1')).toBeTruthy());
  fireEvent.click(screen.getByLabelText('reject-po-ordpo1'));

  const confirm = screen.getByLabelText('confirm-reject-po-ordpo1');
  expect(confirm.disabled).toBe(true); // no reason yet
  fireEvent.change(screen.getByLabelText('reject-reason-ordpo1'), { target: { value: 'District has no such PO' } });
  fireEvent.click(screen.getByLabelText('confirm-reject-po-ordpo1'));

  await waitFor(() => expect(seen).toHaveLength(1));
  expect(seen[0]).toMatchObject({ action: 'reject', order_id: 'ordpo1', reason: 'District has no such PO' });
  await waitFor(() => expect(screen.getByText(/PO rejected — coach emailed/)).toBeTruthy());
});

test('pre-migration (enabled:false) shows the 00201 banner, never a blank page', async () => {
  mockFetch({ list: () => ({ ok: true, enabled: false, orders: [] }) });
  await openPoTab();
  await waitFor(() => expect(screen.getByText(/School-PO checkout migration \(00201\) not applied yet/)).toBeTruthy());
});

test('list failure shows an error banner', async () => {
  mockFetch({ list: () => ({ error: 'nope' }) });
  await openPoTab();
  await waitFor(() => expect(screen.getByText(/Failed to load: nope/)).toBeTruthy());
});
