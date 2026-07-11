/* src/teamshop/TeamStoresPage.js — the "Team Stores" mock translated to
 * React, with the "Find your store" search wired to the REAL data path: the
 * same webstores_public query the portal's /team-stores finder uses, now
 * shared via src/lib/publicTeamStores.js (extracted, not duplicated). This
 * suite covers: the page renders the hero + find-your-store section, typing
 * a search queries webstores_public and renders the matching stores (open
 * ones linked to their real /shop/<slug> storefront, with a close-date
 * label), closed stores render marked Closed and unlinked, the no-match
 * empty state appears, and the TeamShopApp header nav + footer "Team
 * Stores" links both route to the view. */
import React from 'react';
import {
  render, screen, fireEvent, within,
} from '@testing-library/react';

// ── Mock the anon supabase client (what publicTeamStores.js queries) ────────
// Chainable builder, plain functions per CRA's resetMocks:true. The or()
// ilike filter is honored against the in-memory rows so tests exercise the
// same "server filters by name/slug" behavior the real view provides.
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      global.__lastTable = table;
      const state = { statuses: null, term: '' };
      const c = {
        select: () => c,
        in: (col, vals) => { if (col === 'status') state.statuses = vals; return c; },
        eq: () => c,
        or: (expr) => {
          const m = /name\.ilike\.\*(.*?)\*/.exec(expr || '');
          state.term = (m ? m[1] : '').toLowerCase();
          return c;
        },
        order: () => c,
        limit: () => c,
        then: (resolve, reject) => {
          const rows = (global.__stores || []).filter((s) => (
            (!state.statuses || state.statuses.includes(s.status))
            && (`${s.name} ${s.slug}`.toLowerCase().includes(state.term))
          ));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return c;
    },
  },
}));

// ── Mocks so TeamShopApp itself can render for the nav/footer test ───────────
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({}),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => {
      const c = {
        select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c, ilike: () => c,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return c;
    },
  },
}));

// eslint-disable-next-line import/first
import TeamStoresPage from '../teamshop/TeamStoresPage';
// eslint-disable-next-line import/first
import TeamShopApp from '../teamshop/TeamShopApp';

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

const STORES = [
  {
    slug: 'oak-grove-football', name: 'Oak Grove Football', status: 'open', close_at: FUTURE, logo_url: null, primary_color: '#0E2A6B', accent_color: '#F5B429', banner_url: null,
  },
  {
    slug: 'oak-grove-volleyball', name: 'Oak Grove Volleyball', status: 'closed', close_at: null, logo_url: null, primary_color: null, accent_color: null, banner_url: null,
  },
  {
    slug: 'central-hs-track', name: 'Central HS Track', status: 'open', close_at: null, logo_url: null, primary_color: null, accent_color: null, banner_url: null,
  },
];

beforeEach(() => {
  global.__stores = STORES;
});

afterEach(() => {
  delete global.__stores;
  window.localStorage.clear();
});

const searchBox = () => screen.getByPlaceholderText('Search by school, team, or organization name…');

describe('TeamStoresPage', () => {
  test('renders hero, pitches, find-your-store, showcase, steps, and CTA band', () => {
    render(<TeamStoresPage />);
    expect(screen.getByText('A storefront for your program.')).toBeTruthy();
    expect(screen.getByText('Online Team Stores')).toBeTruthy();
    // Rep CTA — mailto, never a self-service builder.
    const ctas = screen.getAllByText('Talk to your rep about a store');
    expect(ctas.length).toBeGreaterThanOrEqual(2);
    ctas.forEach((a) => expect(a.getAttribute('href')).toMatch(/^mailto:info@nationalsportsapparel\.com/));
    // Pitches (fundraising is real — it stays).
    expect(screen.getByText('Built-in fundraising')).toBeTruthy();
    expect(screen.getByText('Direct-ship to families')).toBeTruthy();
    // Find-your-store search.
    expect(screen.getByText('Find your store', { selector: 'h2' })).toBeTruthy();
    expect(searchBox()).toBeTruthy();
    // Example showcase uses labeled placeholders, not fake screenshots.
    expect(screen.getByText('Photo — Store hero in your team colors')).toBeTruthy();
    // How it works + CTA band.
    expect(screen.getByText('How it works for coaches')).toBeTruthy();
    expect(screen.getByText('We build your store')).toBeTruthy();
    expect(screen.getByText('Launch your team store')).toBeTruthy();
  });

  test('search filters the store list and links open stores to /shop/<slug>', async () => {
    render(<TeamStoresPage />);
    fireEvent.change(searchBox(), { target: { value: 'oak grove' } });

    // Both Oak Grove stores match; Central HS does not.
    const football = await screen.findByText('Oak Grove Football');
    expect(screen.getByText('Oak Grove Volleyball')).toBeTruthy();
    expect(screen.queryByText('Central HS Track')).toBeNull();

    // Open store: linked to the same real storefront URL the /team-stores
    // directory uses, with the shared close-date label.
    const link = football.closest('a');
    expect(link.getAttribute('href')).toBe('/shop/oak-grove-football');
    expect(within(link).getByText('Open')).toBeTruthy();
    expect(within(link).getByText(/Open until/)).toBeTruthy();
  });

  test('closed stores are marked Closed and not linked', async () => {
    render(<TeamStoresPage />);
    fireEvent.change(searchBox(), { target: { value: 'volleyball' } });

    const closed = await screen.findByText('Oak Grove Volleyball');
    expect(closed.closest('a')).toBeNull();
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  test('no match renders the empty state with the rep contact link', async () => {
    render(<TeamStoresPage />);
    fireEvent.change(searchBox(), { target: { value: 'zzznomatchzzz' } });

    expect(await screen.findByText(/No store matches/)).toBeTruthy();
    expect(screen.getByText('Talk to your rep about opening one.').getAttribute('href')).toMatch(/^mailto:/);
  });
});

describe('TeamShopApp — Team Stores nav/footer wiring', () => {
  test('header nav "Team Stores" routes to the view', () => {
    render(<TeamShopApp />);
    expect(screen.queryByText('A storefront for your program.')).toBeNull();

    const nav = screen.getAllByRole('button', { name: 'Team Stores' });
    fireEvent.click(nav[0]);

    expect(screen.getByText('A storefront for your program.')).toBeTruthy();
    expect(searchBox()).toBeTruthy();
  });

  test('footer "Team Stores" link (Help column) routes to the view', () => {
    render(<TeamShopApp />);
    const buttons = screen.getAllByRole('button', { name: 'Team Stores' });
    expect(buttons.length).toBe(2); // header nav + footer Help column
    fireEvent.click(buttons[1]);

    expect(screen.getByText('A storefront for your program.')).toBeTruthy();
  });
});
