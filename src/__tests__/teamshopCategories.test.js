/* Team Shop launch categories: src/teamshop/categories.js (the taxonomy +
 * pure matching helpers), Catalog.js's category chip row (server refetch
 * with p_category), and Home.js's category tiles (onBrowseCatalog(key)).
 *
 * See categories.js for the taxonomy source: LAUNCH_CATEGORIES maps launch
 * keys to real products.category db values, verified against the live
 * table. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  LAUNCH_CATEGORIES, categoryByKey, categoryForProduct, inLaunchCategories,
} from '../teamshop/categories';

describe('categories.js — taxonomy', () => {
  test('has exactly the 8 launch categories', () => {
    expect(LAUNCH_CATEGORIES.map((c) => c.key)).toEqual([
      'quarter_zips', 'hoodies', 'polos', 'outerwear', 'hats', 'tees', 'bags', 'shorts',
    ]);
  });

  test('categoryByKey looks up a category by key', () => {
    expect(categoryByKey('polos').label).toBe('Polos');
    expect(categoryByKey('nope')).toBeUndefined();
  });
});

describe('categories.js — categoryForProduct / inLaunchCategories', () => {
  test.each([
    ['1/4 Zips', 'quarter_zips'],
    ['Hoods', 'hoodies'],
    ['Hood', 'hoodies'], // legacy singular spelling
    ['Polos', 'polos'],
    ['Outerwear', 'outerwear'],
    ['Hats', 'hats'],
    ['Beanies', 'hats'], // conceptually hats
    ['Tees', 'tees'],
    ['Bags', 'bags'],
    ['Shorts', 'shorts'],
  ])('maps products.category %s -> launch key %s', (dbValue, expectedKey) => {
    const product = { id: 'p1', category: dbValue };
    expect(categoryForProduct(product).key).toBe(expectedKey);
    expect(inLaunchCategories(product)).toBe(true);
  });

  test.each([
    ['Socks'],
    ['Jersey'],
    ['Pants'],
    ['Crew'],
    ['Footwear'],
    ['(none)'],
    [null],
    [undefined],
  ])('non-launch category %s maps to null / excluded', (dbValue) => {
    const product = { id: 'p1', category: dbValue };
    expect(categoryForProduct(product)).toBeNull();
    expect(inLaunchCategories(product)).toBe(false);
  });

  test('a product with no category field at all is excluded', () => {
    expect(categoryForProduct({ id: 'p1' })).toBeNull();
    expect(inLaunchCategories({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catalog.js — category chip drives the server query (p_category) and the
// 'All' view client-filters out non-launch categories.
// ---------------------------------------------------------------------------
const mockRpc = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: { rpc: (...args) => mockRpc(...args) },
}));
jest.mock('../lib/storeInventory', () => ({
  fetchStockMap: jest.fn(() => Promise.resolve(new Map())),
}));

// eslint-disable-next-line import/first
import Catalog from '../teamshop/Catalog';

// Rows resolve empty here deliberately — these tests exercise the category
// state -> server query wiring (chip click -> refetch -> p_category arg),
// which is fully observable from the mocked rpc call args alone. The
// separate client-side filtering behavior (non-launch categories excluded
// from 'All') is covered directly against the pure inLaunchCategories/
// categoryForProduct helpers above, which is the same filter Catalog.js
// calls on the fetched rows.
beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe('Catalog.js — category chips', () => {
  test('initial "All" fetch passes p_category: null', async () => {
    render(<Catalog />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc.mock.calls[0][1].p_category).toBeNull();
  });

  test('clicking a category chip refetches with that category\'s primary p_category value', async () => {
    render(<Catalog />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Polos' }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    expect(mockRpc.mock.calls[1][1].p_category).toBe('Polos');
  });

  test('initialCategory prop pre-selects a category and fetches it server-side', async () => {
    render(<Catalog initialCategory="hoodies" />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc.mock.calls[0][1].p_category).toBe('Hoods');
    expect(screen.getByRole('button', { name: 'Hoodies & Fleece' }).getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Home.js — category tiles call onBrowseCatalog(key)
// ---------------------------------------------------------------------------
// eslint-disable-next-line import/first
import Home from '../teamshop/Home';

describe('Home.js — category tiles', () => {
  test('a category tile calls onBrowseCatalog with its launch-category key', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null }); // featured-products fetch
    const onBrowseCatalog = jest.fn();
    render(<Home onStartOrder={() => {}} onBrowseCatalog={onBrowseCatalog} />);

    fireEvent.click(screen.getByRole('button', { name: 'Polos' }));
    expect(onBrowseCatalog).toHaveBeenCalledWith('polos');

    fireEvent.click(screen.getByRole('button', { name: 'Hoodies & Fleece' }));
    expect(onBrowseCatalog).toHaveBeenCalledWith('hoodies');
  });

  test('"Shop all products" calls onBrowseCatalog with no category', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const onBrowseCatalog = jest.fn();
    render(<Home onStartOrder={() => {}} onBrowseCatalog={onBrowseCatalog} />);

    fireEvent.click(screen.getByText('Shop all products →'));
    expect(onBrowseCatalog).toHaveBeenCalledWith();
  });
});
