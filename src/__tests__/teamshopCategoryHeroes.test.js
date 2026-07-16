/* categoryHeroes.js (SKU map, pickHeroForCategory, fetchCategoryHeroes
 * caching) + Home.js's category-tile grid wiring: real product photo when a
 * hero row/image was fetched, exact-current gradient tile fallback when not. */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LAUNCH_CATEGORIES } from '../teamshop/categories';
import { CATEGORY_HERO_SKUS, pickHeroForCategory, heroSkusCoverAllCategories } from '../teamshop/categoryHeroes';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

// eslint-disable-next-line import/first
import { fetchCategoryHeroes } from '../teamshop/categoryHeroes';
// eslint-disable-next-line import/first
import Home from '../teamshop/Home';

function makeQuery(result) {
  const q = {
    select: jest.fn(() => q),
    in: jest.fn(() => Promise.resolve(result)),
  };
  return q;
}

const HERO_ROWS = [
  { id: 'p1', sku: 'KB9108', name: 'Royal 3-Stripe LS 1/4 Zip', brand: 'adidas', image_front_url: 'https://cdn/kb9108.png', category: '1/4 Zips' },
  { id: 'p2', sku: 'IW5145', name: 'D4T Lightweight Hoodie', brand: 'adidas', image_front_url: 'https://cdn/iw5145.png', category: 'Hoods' },
  { id: 'p3', sku: 'HS1301', name: 'Classic Polo', brand: 'adidas', image_front_url: 'https://cdn/hs1301.png', category: 'Polos' },
];

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
  window.sessionStorage.clear();
});

describe('CATEGORY_HERO_SKUS', () => {
  test('covers all 9 launch category keys with a non-empty sku', () => {
    expect(heroSkusCoverAllCategories()).toBe(true);
    LAUNCH_CATEGORIES.forEach((cat) => {
      expect(typeof CATEGORY_HERO_SKUS[cat.key]).toBe('string');
      expect(CATEGORY_HERO_SKUS[cat.key].length).toBeGreaterThan(0);
    });
    expect(Object.keys(CATEGORY_HERO_SKUS)).toHaveLength(LAUNCH_CATEGORIES.length);
  });
});

describe('pickHeroForCategory', () => {
  test('matches a row by sku for the given category', () => {
    const cat = LAUNCH_CATEGORIES.find((c) => c.key === 'quarter_zips');
    const hero = pickHeroForCategory(HERO_ROWS, cat);
    expect(hero).toBe(HERO_ROWS[0]);
  });

  test('returns null when no row has that category\'s sku', () => {
    const cat = LAUNCH_CATEGORIES.find((c) => c.key === 'footwear');
    expect(pickHeroForCategory(HERO_ROWS, cat)).toBeNull();
  });

  test('returns null when the matching row has no image', () => {
    const cat = LAUNCH_CATEGORIES.find((c) => c.key === 'polos');
    const rows = [{ ...HERO_ROWS[2], image_front_url: '' }];
    expect(pickHeroForCategory(rows, cat)).toBeNull();
  });

  test('returns null for empty/missing rows', () => {
    const cat = LAUNCH_CATEGORIES.find((c) => c.key === 'polos');
    expect(pickHeroForCategory([], cat)).toBeNull();
    expect(pickHeroForCategory(null, cat)).toBeNull();
  });
});

describe('fetchCategoryHeroes', () => {
  test('fetches products.select(...).in(sku, [...skus]) and returns the rows', async () => {
    const q = makeQuery({ data: HERO_ROWS, error: null });
    mockFrom.mockReturnValue(q);

    const rows = await fetchCategoryHeroes();

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(q.select).toHaveBeenCalledWith('id,sku,name,brand,image_front_url,category');
    expect(q.in).toHaveBeenCalledWith('sku', Object.values(CATEGORY_HERO_SKUS));
    expect(rows).toEqual(HERO_ROWS);
  });

  test('caches the result in sessionStorage and does not refetch within the TTL', async () => {
    const q = makeQuery({ data: HERO_ROWS, error: null });
    mockFrom.mockReturnValue(q);

    await fetchCategoryHeroes();
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('nts_cat_heroes')).toBeTruthy();

    const rows2 = await fetchCategoryHeroes();
    expect(mockFrom).toHaveBeenCalledTimes(1); // still 1 — served from cache
    expect(rows2).toEqual(HERO_ROWS);
  });

  test('refetches once the cached entry is past its TTL', async () => {
    const q = makeQuery({ data: HERO_ROWS, error: null });
    mockFrom.mockReturnValue(q);
    await fetchCategoryHeroes();
    expect(mockFrom).toHaveBeenCalledTimes(1);

    const stale = JSON.parse(window.sessionStorage.getItem('nts_cat_heroes'));
    stale.at -= 61 * 60 * 1000; // 61 minutes ago — past the 1h TTL
    window.sessionStorage.setItem('nts_cat_heroes', JSON.stringify(stale));

    await fetchCategoryHeroes();
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test('returns [] (never throws) on a fetch error', async () => {
    const q = makeQuery({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValue(q);
    const rows = await fetchCategoryHeroes();
    expect(rows).toEqual([]);
  });

  test('returns [] (never throws) when the client has no .from (defensive)', async () => {
    mockFrom.mockImplementation(() => { throw new TypeError('supabaseCoach.from is not a function'); });
    const rows = await fetchCategoryHeroes();
    expect(rows).toEqual([]);
  });
});

describe('Home.js — category tile grid', () => {
  const noop = () => {};

  test('renders a branded tile for every launch category except footwear', async () => {
    const allRows = LAUNCH_CATEGORIES.map((cat) => ({
      id: cat.key,
      sku: CATEGORY_HERO_SKUS[cat.key],
      name: cat.label,
      brand: 'adidas',
      image_front_url: `https://cdn/${cat.key}.png`,
      category: cat.dbValues[0],
    }));
    const q = makeQuery({ data: allRows, error: null });
    mockFrom.mockReturnValue(q);

    render(<Home onStartOrder={noop} onBrowseCatalog={noop} onOpenDecoration={noop} />);

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('products'));

    const tiles = await screen.findAllByRole('button', { name: /^Shop / });
    const categoryTiles = tiles.filter((t) => t.className.includes('nts-category-tile'));
    // Footwear is intentionally excluded from the home grid (Home.js filters
    // cat.key !== 'footwear'); every other launch category renders a committed
    // branded tile image (CATEGORY_TILE_IMG), which takes precedence over the DB
    // hero rows fetched above.
    const gridCategories = LAUNCH_CATEGORIES.filter((c) => c.key !== 'footwear');
    expect(categoryTiles).toHaveLength(gridCategories.length);
    categoryTiles.forEach((tile) => {
      const img = tile.querySelector('img');
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toMatch(/^\/teamshop\/cat-/);
    });
  });

  test('renders the branded static tiles even when no DB hero rows are fetched', async () => {
    const q = makeQuery({ data: [], error: null });
    mockFrom.mockReturnValue(q);

    render(<Home onStartOrder={noop} onBrowseCatalog={noop} onOpenDecoration={noop} />);

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('products'));

    const tiles = await screen.findAllByRole('button', { name: /^Shop / });
    const categoryTiles = tiles.filter((t) => t.className.includes('nts-category-tile'));
    const gridCategories = LAUNCH_CATEGORIES.filter((c) => c.key !== 'footwear');
    expect(categoryTiles).toHaveLength(gridCategories.length);
    // The committed CATEGORY_TILE_IMG images render regardless of DB heroes; the
    // gradient is now only a runtime <img> onError fallback, not a no-img state.
    categoryTiles.forEach((tile) => {
      const img = tile.querySelector('img');
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toMatch(/^\/teamshop\/cat-/);
      expect(tile.textContent).not.toBe('');
    });
    // Sanity: labels still render as visible text.
    expect(screen.getByText('1/4 Zips')).toBeTruthy();
  });
});
