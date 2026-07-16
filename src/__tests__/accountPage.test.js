/* src/teamshop/AccountPage.js — the "Account" mockup (the last page in the
 * approved design set) translated to React. Follows teamshopCart.test.js's
 * mocking style: useCoachSession mocked directly, global.fetch mocked for
 * the real endpoints TeamPicker/LogoPicker/teamshop-orders call underneath.
 * This suite covers: the signed-out sign-in gate renders, and once signed in
 * with a team the real sections render (saved logos count from LogoPicker,
 * real order rows + status chips from teamshop-orders.js — Stage 8 — and the
 * still-honest "coming soon" placeholder for the roster section, which has
 * no backing feature yet). */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AccountPage from '../teamshop/AccountPage';

jest.mock('../teamshop/useCoachSession', () => jest.fn());
const useCoachSession = require('../teamshop/useCoachSession');

const CUSTOMER = { id: 'custA', name: 'Central High' };

const ORDER_1 = {
  id: 'ord1', created_at: '2026-07-01T00:00:00Z', status: 'paid', total: 120, buyer_name: 'Coach A',
  status_token: 'tok1', so_id: null,
  items: [{ product_id: 'p1', sku: 'SKU1', name: 'Performance Polo', qty: 2, size: 'M', image_url: null }],
  production: null,
};

function mockFetchByUrl(map) {
  global.fetch = jest.fn((url) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    const body = key ? map[key] : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
}

afterEach(() => {
  delete global.fetch;
  window.localStorage.clear();
  jest.resetAllMocks();
});

describe('AccountPage', () => {
  test('signed out: renders the sign-in gate, not any account section', () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: false, email: null, accessToken: null, signOut: jest.fn() });
    render(<AccountPage section={null} customer={null} onCustomerSelect={() => {}} />);

    expect(screen.getByText('Coach sign-in')).toBeTruthy();
    expect(screen.queryByText('Saved logos')).toBeNull();
    expect(screen.queryByText('Recent orders')).toBeNull();
  });

  test('signed in with a team: renders saved logos (real count), real order rows + status chip, and reorder', async () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: jest.fn() });
    mockFetchByUrl({
      'teamshop-context': { ok: true, coach: { id: 'c1', email: 'coach@team.com', name: 'Coach Rivera' }, customers: [CUSTOMER] },
      'teamshop-art': { ok: true, logos: [{ id: 'l1', source: 'uploaded', name: 'Eagles Crest' }, { id: 'l2', source: 'art_library', name: 'Wildcats' }] },
      'teamshop-orders': { ok: true, orders: [ORDER_1] },
    });
    const onReorder = jest.fn();

    render(<AccountPage section={null} customer={CUSTOMER} onCustomerSelect={() => {}} onReorder={onReorder} />);

    // Signed in as … + sign out come from CoachGate itself, reused as-is.
    expect(screen.getByText(/Signed in as/)).toBeTruthy();

    // Saved logos section: real LogoPicker data, no forked fetch logic.
    await waitFor(() => expect(screen.getByText('Eagles Crest')).toBeTruthy());
    expect(screen.getByText('Wildcats')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // hero stat count from the real list

    // Recent orders: real row from teamshop-orders.js, with a friendly status
    // chip (order.status 'paid', no so_id yet -> "Processing") and a Track link.
    await waitFor(() => expect(screen.getByText(/Performance Polo/)).toBeTruthy());
    expect(screen.getByText('Processing')).toBeTruthy();
    expect(screen.getByText('Track').getAttribute('href')).toBe('/shop/order/tok1');

    // Reorder invokes the onReorder prop with the first item's product_id —
    // TeamShopApp owns turning that into a ProductPage preview.
    screen.getByText('Reorder').click();
    expect(onReorder).toHaveBeenCalledWith('p1');

    // Roster has no backing feature yet — still an honest placeholder.
    expect(screen.getByText(/TODO\(account-roster\)/)).toBeTruthy();
    expect(screen.getAllByText(/Coming soon/).length).toBeGreaterThan(0);

    // Let TeamPicker's own (harmless, single-team) auto-select fetch settle
    // so React doesn't warn about an update after the test body returns.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  test('signed in, no orders yet: shows the empty state, not a fabricated row', async () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: jest.fn() });
    mockFetchByUrl({
      'teamshop-context': { ok: true, coach: { id: 'c1', email: 'coach@team.com' }, customers: [CUSTOMER] },
      'teamshop-art': { ok: true, logos: [] },
      'teamshop-orders': { ok: true, orders: [] },
    });

    render(<AccountPage section={null} customer={CUSTOMER} onCustomerSelect={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No orders yet/)).toBeTruthy());
  });

  test('signed in, no team resolved yet: logos section shows a hint instead of fetching', () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: jest.fn() });
    mockFetchByUrl({ 'teamshop-context': { ok: true, coach: { id: 'c1', email: 'coach@team.com' }, customers: [] } });

    render(<AccountPage section={null} customer={null} onCustomerSelect={() => {}} />);

    expect(screen.getByText(/Pick a team above to see its saved logos/)).toBeTruthy();
  });
});
