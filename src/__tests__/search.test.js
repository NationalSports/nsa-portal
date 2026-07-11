/* src/teamshop/Search.js — the "Search" mock mapped onto the REAL backend:
 * the same search_products RPC + supabaseCoach client Catalog.js already
 * uses (mocked here the same way teamshopCatalogGrouping.test.js mocks it),
 * and the same colorway-grouped CatalogCard grid. This suite covers: the
 * hero/popular pills render, a query calls the RPC with p_query set and
 * renders "Results for ..." with the real CatalogCard grid, category chips
 * use LAUNCH_CATEGORIES with counts and filter results, and the no-results
 * empty state (dashed border, Browse all apparel / Clear search) appears. */
import React from 'react';
import {
  render, screen, fireEvent, waitFor,
} from '@testing-library/react';

const mockRpc = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: { rpc: (...args) => mockRpc(...args) },
}));

// eslint-disable-next-line import/first
import Search from '../teamshop/Search';

const ROWS = [
  {
    id: 'n-polo', sku: 'N-POLO', brand: 'Nike', name: 'Dri-FIT Polo', color: 'Black', category: 'Polos', image_front_url: 'https://cdn/n-polo.png',
  },
  {
    id: 'a-hoodie', sku: 'A-HOOD', brand: 'adidas', name: 'Team Hoodie', color: 'Navy', category: 'Hoods', image_front_url: 'https://cdn/a-hoodie.png',
  },
  {
    id: 'non-launch', sku: 'X-SOCK', brand: 'Nike', name: 'Crew Sock', color: 'White', category: 'Socks', image_front_url: 'https://cdn/x-sock.png',
  },
];

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ROWS, error: null });
});

describe('Search', () => {
  test('renders hero, autofocused input, and Popular suggestion pills', () => {
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={() => {}} />);
    const input = screen.getByPlaceholderText('Search polos, hoodies, brands…');
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('Popular:')).toBeTruthy();
    ['Polos', 'Hoodies', 'Hats', 'adidas', 'Nike'].forEach((term) => {
      expect(screen.getByRole('button', { name: term })).toBeTruthy();
    });
  });

  test('typing a query calls search_products with p_query set, and results render via CatalogCard', async () => {
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={() => {}} />);
    const input = screen.getByPlaceholderText('Search polos, hoodies, brands…');
    fireEvent.change(input, { target: { value: 'polo' } });

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('search_products', expect.objectContaining({ p_query: 'polo' })));
    await waitFor(() => expect(screen.getByText('Results for "polo"')).toBeTruthy());
    // Non-launch category row (Socks) never renders, same client filter as Catalog.js.
    expect(screen.queryByText('Crew Sock')).toBeNull();
    expect(screen.getByText('Dri-FIT Polo')).toBeTruthy();
  });

  test('empty query shows "Browse the catalog" and still calls the RPC with p_query null', async () => {
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={() => {}} />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('search_products', expect.objectContaining({ p_query: null })));
    await waitFor(() => expect(screen.getByText('Browse the catalog')).toBeTruthy());
  });

  test('category chips use the real launch categories with counts, and filter results', async () => {
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={() => {}} />);
    await screen.findByText('Dri-FIT Polo');

    // Real launch-category labels (categories.js), not the mock's 'Caps'/'Uniforms'.
    expect(screen.getByRole('button', { name: /Polos 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hoodies & Fleece 1/ })).toBeTruthy();
    expect(screen.queryByText('Caps')).toBeNull();
    expect(screen.queryByText('Uniforms')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Polos 1/ }));
    expect(screen.getByText('Dri-FIT Polo')).toBeTruthy();
    expect(screen.queryByText('Team Hoodie')).toBeNull();
  });

  test('no results renders the dashed empty state with Browse all apparel and Clear search', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const onBrowseCatalog = jest.fn();
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={onBrowseCatalog} />);
    const input = screen.getByPlaceholderText('Search polos, hoodies, brands…');
    fireEvent.change(input, { target: { value: 'zzzznotarealproduct' } });

    await waitFor(() => expect(screen.getByText('No results')).toBeTruthy());
    fireEvent.click(screen.getByText('Browse all apparel'));
    expect(onBrowseCatalog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Clear search'));
    expect(input.value).toBe('');
  });

  test('a Popular pill sets the query and re-searches', async () => {
    render(<Search onSelectProduct={() => {}} onBrowseCatalog={() => {}} />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    mockRpc.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'adidas' }));
    const input = screen.getByPlaceholderText('Search polos, hoodies, brands…');
    expect(input.value).toBe('adidas');
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('search_products', expect.objectContaining({ p_query: 'adidas' })));
  });
});
