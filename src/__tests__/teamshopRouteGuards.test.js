/* TeamShopApp's route-keyed guard effect and the `inOrderShell` value that
 * replaces the old standalone `enteredShop` useState (see the routing plan's
 * §4/§6). These need a mounted TeamShopApp (the guards live in its effect,
 * and `inOrderShell` is derived from `route`, not exported standalone), so
 * this is a lighter jsdom/RTL integration suite — the DOM-free parse/build
 * coverage lives in teamshopRoute.test.js.
 *
 * Mocking follows the same pattern src/__tests__/teamStoresPage.test.js and
 * teamshopHandoff.test.js already use for a bare TeamShopApp render: a
 * signed-out supabaseCoach client (auth.getSession resolves null — no coach
 * session), and a chainable `from()` builder that resolves empty by default
 * so getProductBySku's cold fetch returns "not found" unless a test
 * overrides it. No jest-dom in this repo's test setup (see e.g.
 * teamShopQueue.test.js) — assertions use plain truthy/role checks, not
 * toHaveTextContent. */
import React from 'react';
import {
  render, screen, waitFor, act,
} from '@testing-library/react';

let mockFromImpl = null; // per-test override for supabaseCoach.from(...)
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({}),
    },
    rpc: async () => ({ data: [], error: null }),
    from: (table) => (mockFromImpl ? mockFromImpl(table) : {
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// eslint-disable-next-line import/first
import TeamShopApp from '../teamshop/TeamShopApp';

const goTo = (path) => { window.history.replaceState({}, '', path); };
const startWithLogoHeading = () => screen.queryByRole('heading', { name: 'Upload once. Reorder forever.' });
const coachSignInHeading = () => screen.queryByRole('heading', { name: 'Coach sign-in' });

beforeEach(() => {
  mockFromImpl = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  goTo('/teamshop');
});
afterEach(() => { goTo('/teamshop'); });

describe('product route guard — unknown/cold sku', () => {
  test('cold /teamshop/product/:sku with no matching row replaces to /teamshop/catalog behind the skeleton', async () => {
    goTo('/teamshop/product/DOES-NOT-EXIST');
    render(<TeamShopApp />);

    // The skeleton (not a hollow ProductPage) shows first.
    expect(screen.getByRole('status').textContent).toBe('Loading product…');

    await waitFor(() => expect(window.location.pathname).toBe('/teamshop/catalog'));
  });

  test('cold /teamshop/product/:sku with a matching row renders it (no redirect)', async () => {
    mockFromImpl = (table) => {
      expect(table).toBe('products');
      return {
        select: () => ({
          eq: (col, val) => ({
            limit: () => Promise.resolve({
              data: [{ id: 'p1', sku: val, name: 'Performance Polo', brand: 'adidas', available_sizes: ['S', 'M'] }],
              error: null,
            }),
          }),
        }),
      };
    };
    goTo('/teamshop/product/REAL-SKU');
    render(<TeamShopApp />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Performance Polo' })).toBeTruthy());
    expect(window.location.pathname).toBe('/teamshop/product/REAL-SKU');
  });
});

describe('order-funnel guards — cold/forward entry with no in-memory draft', () => {
  test('/order/placement with no selected product+logo replaces to /order/logos', async () => {
    goTo('/teamshop/order/placement');
    render(<TeamShopApp />);
    await waitFor(() => expect(window.location.pathname).toBe('/teamshop/order/logos'));
  });

  test('/order/checkout with no quote replaces to /cart (never shows a stale/absent quote)', async () => {
    goTo('/teamshop/order/checkout');
    render(<TeamShopApp />);
    await waitFor(() => expect(window.location.pathname).toBe('/teamshop/cart'));
  });

  test('/order/confirmed with no confirmed line replaces to /cart', async () => {
    goTo('/teamshop/order/confirmed');
    render(<TeamShopApp />);
    await waitFor(() => expect(window.location.pathname).toBe('/teamshop/cart'));
  });
});

describe('derived inOrderShell (replaces the old standalone `enteredShop` state)', () => {
  test('bare /order renders StartWithLogo\'s entry chrome, not the CoachGate shell', async () => {
    goTo('/teamshop/order');
    render(<TeamShopApp />);
    // useCoachSession resolves async even when mocked (getSession is a
    // promise) — StartWithLogo/CoachGate both render null while `loading`.
    await waitFor(() => expect(startWithLogoHeading()).toBeTruthy());
    expect(coachSignInHeading()).toBeNull();
  });

  test('/order/catalog renders the CoachGate shell directly, not StartWithLogo\'s entry chrome', async () => {
    goTo('/teamshop/order/catalog');
    render(<TeamShopApp />);
    await waitFor(() => expect(coachSignInHeading()).toBeTruthy());
    expect(startWithLogoHeading()).toBeNull();
  });

  test('top-level /cart also renders the CoachGate shell (inOrderShell is true for cart too)', async () => {
    goTo('/teamshop/cart');
    render(<TeamShopApp />);
    await waitFor(() => expect(coachSignInHeading()).toBeTruthy());
  });

  // C2-F1 regression guard: Back from the in-shop catalog must land on
  // StartWithLogo again, not a dead/stuck screen — because `inOrderShell` is
  // derived from the URL on every popstate, not a one-way flag a listener
  // never touched.
  test('popstate Back from /order/catalog to bare /order re-shows StartWithLogo (derived, not a stuck one-way flag)', async () => {
    goTo('/teamshop/order');
    render(<TeamShopApp />);
    await waitFor(() => expect(startWithLogoHeading()).toBeTruthy());

    act(() => {
      window.history.pushState({}, '', '/teamshop/order/catalog');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(coachSignInHeading()).toBeTruthy());
    expect(startWithLogoHeading()).toBeNull();

    // Real Back (not a fresh navTo push) — same popstate event the browser fires.
    act(() => {
      window.history.pushState({}, '', '/teamshop/order'); // simulates the entry the browser had recorded
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(startWithLogoHeading()).toBeTruthy());
    expect(coachSignInHeading()).toBeNull();
  });
});
