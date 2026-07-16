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
    expect(screen.getByText('A storefront for your program — up in days.')).toBeTruthy();
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
    // Example store centerpiece — theme switcher + demo store, no fake screenshots.
    expect(screen.getByText('This is what your families see')).toBeTruthy();
    expect(screen.getByText('See it in your colors')).toBeTruthy();
    expect(screen.getAllByText(/Oak Grove Football/)[0]).toBeTruthy();
    // No illustrative dollar prices on the example store's product cards —
    // just name, stock badge, and the "View" affordance. (The design mock's
    // product prices were $17/$10/$8/$24; none of those render anywhere.
    // The hero's "$0 upfront cost" stat is a real, non-illustrative claim
    // and is exempt.)
    // Appears twice by design: the demo-store product grid AND the hero card's
    // compact mini product strip (which reuses the same STORE_PRODUCTS).
    expect(screen.getAllByText('PosiCharge Hooded Pullover').length).toBeGreaterThanOrEqual(2);
    ['$17', '$10', '$8', '$24'].forEach((price) => expect(screen.queryByText(price)).toBeNull());
    // How it works + CTA band.
    expect(screen.getByText('Open it, share it, cash the check')).toBeTruthy();
    expect(screen.getByText('We build your store')).toBeTruthy();
    expect(screen.getByText('Every order funds the season')).toBeTruthy();
    expect(screen.getByText('Launch your team store')).toBeTruthy();
  });

  test('search filters the store list and links open stores to /shop/<slug>', async () => {
    render(<TeamStoresPage />);
    fireEvent.change(searchBox(), { target: { value: 'oak grove' } });

    // Both Oak Grove stores match; Central HS does not. (The example-store
    // centerpiece above also renders "Oak Grove Football" text, so scope to
    // the search-result link.)
    await screen.findByText('Oak Grove Volleyball');
    const results = screen.getAllByText('Oak Grove Football').map((el) => el.closest('a')).filter(Boolean);
    expect(results.length).toBe(1);
    const [link] = results;
    expect(screen.queryByText('Central HS Track')).toBeNull();

    // Open store: linked to the same real storefront URL the /team-stores
    // directory uses, with the shared close-date label.
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

describe('TeamStoresPage — one-click builder', () => {
  test('sport, gender, color, and logo picks are live and drive the preview', () => {
    const { container } = render(<TeamStoresPage />);

    // Default state: Men's items in the preview.
    expect(screen.getByText('Hooded Pullover')).toBeTruthy();
    expect(screen.queryByText('Fitted Hoodie')).toBeNull();

    // Sport chip selection toggles aria-pressed.
    const basketball = screen.getByRole('button', { name: /Basketball/ });
    expect(basketball.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(basketball);
    expect(basketball.getAttribute('aria-pressed')).toBe('true');

    // Gender toggle swaps the live preview's item set.
    fireEvent.click(screen.getByText("Women's"));
    expect(screen.getByText('Fitted Hoodie')).toBeTruthy();
    expect(screen.queryByText('Hooded Pullover')).toBeNull();

    // Logo chip selection updates the preview header badge letter.
    fireEvent.click(screen.getByText('Valley Wildcats').closest('button'));
    const preview = container.querySelector('[data-testid="nts-builder-preview"]');
    expect(within(preview).getByText('W')).toBeTruthy();

    // Picking a primary/secondary swatch recolors the preview via CSS vars —
    // the same --tp/--tp2/--ta custom properties Garment reads.
    expect(preview.style.getPropertyValue('--tp')).toBe('#0E2A6B'); // default: Navy
    fireEvent.click(screen.getByRole('button', { name: 'Royal' }));
    expect(preview.style.getPropertyValue('--tp')).toBe('#123a8f');
    expect(preview.style.getPropertyValue('--tp2')).toBe('#2350b0');

    expect(preview.style.getPropertyValue('--ta')).toBe('#F5B429'); // default: Gold
    fireEvent.click(screen.getByRole('button', { name: 'Scarlet' }));
    expect(preview.style.getPropertyValue('--ta')).toBe('#C8102E');
  });

  test('launch is an illustrative confirmation, not a store-creation call, and links to the same rep contact as the hero', () => {
    render(<TeamStoresPage />);

    const launch = screen.getByText('Launch store — one click');
    expect(screen.queryByText('Finish setup in your coach portal →')).toBeNull();

    fireEvent.click(launch);

    expect(screen.getByText('Your store is live')).toBeTruthy();
    const coachLink = screen.getByText('Finish setup in your coach portal →');
    expect(coachLink.getAttribute('href')).toMatch(/^mailto:info@nationalsportsapparel\.com/);
    expect(coachLink.getAttribute('href')).toBe(screen.getAllByText('Talk to your rep about a store')[0].getAttribute('href'));
  });
});

describe('TeamShopApp — Team Stores nav/footer wiring', () => {
  test('header nav "Team Stores" routes to the view', () => {
    render(<TeamShopApp />);
    expect(screen.queryByText('A storefront for your program — up in days.')).toBeNull();

    const nav = screen.getAllByRole('button', { name: 'Team Stores' });
    fireEvent.click(nav[0]);

    expect(screen.getByText('A storefront for your program — up in days.')).toBeTruthy();
    expect(searchBox()).toBeTruthy();
  });

  test('footer "Team Stores" link (Help column) routes to the view', () => {
    render(<TeamShopApp />);
    const buttons = screen.getAllByRole('button', { name: 'Team Stores' });
    expect(buttons.length).toBe(2); // header nav + footer Help column
    fireEvent.click(buttons[1]);

    expect(screen.getByText('A storefront for your program — up in days.')).toBeTruthy();
  });
});
