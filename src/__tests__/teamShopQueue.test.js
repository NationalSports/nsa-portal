/* Team Shop — Fast Turn Queue (src/teamshopqueue/TeamShopQueue.js).
 * Light coverage: signed-out gate, signed-in board render, stage button RPC
 * args, and the NSA_STALE_STATE refetch path. Mocks the staff `supabase`
 * client the way jobScanResolver.test.js mocks it for netlify functions.
 * (No jest-dom in this repo's test setup — assertions use plain
 * truthy/falsy checks on query results, matching reportsRedesign.smoke.test.js.) */

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
      from: (table) => makeBuilder(global.__mockTables[table] || { data: [], error: null }),
      rpc: (...args) => global.__rpcMock(...args),
    },
  };
});

const TeamShopQueue = require('../teamshopqueue/TeamShopQueue').default;

const setMocks = ({ session = null, tables = {}, rpc } = {}) => {
  global.__mockSession = session;
  global.__mockTables = tables;
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
