/* Colorway grouping wired into Catalog.js + CatalogCard.js — see
 * src/teamshop/colorways.js for the pure grouping/family logic (covered in
 * teamshopColorways.test.js). This suite covers the UI wiring: the grid
 * collapses same-style colorway rows into one card, the results line reads
 * "X styles · Y colorways", the Color filter pill row appears/filters, and a
 * card's color pills swap the selected variant (and grey out non-matches
 * when a color filter is active). */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';

const mockRpc = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: { rpc: (...args) => mockRpc(...args) },
}));
jest.mock('../lib/storeInventory', () => ({
  fetchStockMap: jest.fn(() => Promise.resolve(new Map())),
}));

// eslint-disable-next-line import/first
import Catalog from '../teamshop/Catalog';
// eslint-disable-next-line import/first
import CatalogCard from '../teamshop/CatalogCard';

// One style with 3 colorways (a red, a navy, a gold) + two unrelated
// single-colorway styles — mirrors the owner's report shape (identical
// name+brand, unique sku/id/image/color per row).
const ROWS = [
  {
    id: 'a-navy', sku: 'A-NAVY', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Navy/White', category: '1/4 Zips', image_front_url: 'https://cdn/a-navy.png',
  },
  {
    id: 'a-red', sku: 'A-RED', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Power Red/White', category: '1/4 Zips', image_front_url: 'https://cdn/a-red.png',
  },
  {
    id: 'a-gold', sku: 'A-GOLD', brand: 'Adidas', name: '3 Stripe LS 1/4 ZIP', color: 'Athletic Gold/White', category: '1/4 Zips', image_front_url: 'https://cdn/a-gold.png',
  },
  {
    id: 'n-polo', sku: 'N-POLO', brand: 'Nike', name: 'Dri-FIT Polo', color: 'Black', category: 'Polos', image_front_url: 'https://cdn/n-polo.png',
  },
  {
    id: 'u-tee', sku: 'U-TEE', brand: 'Under Armour', name: 'Tech Tee', color: 'Navy', category: 'Tees', image_front_url: 'https://cdn/u-tee.png',
  },
];

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ROWS, error: null });
});

describe('Catalog.js — colorway grouping', () => {
  test('collapses same-style colorway rows into one card, and shows "X styles · Y colorways"', async () => {
    render(<Catalog />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    // 3 style cards (Adidas grouped, Nike, Under Armour), 5 total colorways.
    await waitFor(() => expect(screen.getByText('3').closest('span')).toBeTruthy());
    expect(screen.getByText('3 Stripe LS 1/4 ZIP')).toBeTruthy();
    // Only ONE card for the Adidas style, not 3.
    expect(screen.getAllByText('3 Stripe LS 1/4 ZIP')).toHaveLength(1);
    expect(screen.getByText('5')).toBeTruthy(); // colorway count
  });

  test('Color filter pills render for families present in the loaded groups', async () => {
    render(<Catalog />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await screen.findByText('3 Stripe LS 1/4 ZIP');

    expect(screen.getByText('Color')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Red 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Navy 2/ })).toBeTruthy(); // Adidas Navy/White + UA Navy
    expect(screen.getByRole('button', { name: /Gold 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Black 1/ })).toBeTruthy();
  });

  test('selecting a color family keeps only groups with >=1 matching variant', async () => {
    render(<Catalog />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await screen.findByText('3 Stripe LS 1/4 ZIP');

    fireEvent.click(screen.getByRole('button', { name: /Gold 1/ }));

    // Adidas style (has a gold colorway) stays; Nike/UA (no gold) drop out.
    expect(screen.getByText('3 Stripe LS 1/4 ZIP')).toBeTruthy();
    expect(screen.queryByText('Dri-FIT Polo')).toBeNull();
    expect(screen.queryByText('Tech Tee')).toBeNull();
  });
});

describe('CatalogCard.js — style card with color pills', () => {
  const group = {
    key: 'adidas|3 stripe ls 1/4 zip',
    brand: 'Adidas',
    name: '3 Stripe LS 1/4 ZIP',
    variants: [ROWS[2], ROWS[0], ROWS[1]], // Gold, Navy, Red (unsorted on purpose)
  };

  test('defaults to the first variant, image reflects the selected variant', () => {
    render(<CatalogCard group={group} onSelect={() => {}} />);
    const img = document.querySelector('img');
    expect(img.getAttribute('src')).toBe(ROWS[2].image_front_url);
  });

  test('clicking a color pill swaps the selected variant and image', () => {
    render(<CatalogCard group={group} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Power Red/White' }));
    const img = document.querySelector('img');
    expect(img.getAttribute('src')).toBe(ROWS[1].image_front_url);
  });

  test('onSelect receives the exact selected variant row, not a synthetic group object', () => {
    const onSelect = jest.fn();
    render(<CatalogCard group={group} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Navy/White' }));
    fireEvent.click(screen.getByText('Customize'));
    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  test('with an active color filter, default-selects the first matching variant and greys out non-matches', () => {
    render(<CatalogCard group={group} onSelect={() => {}} activeFamilies={['red']} />);
    const img = document.querySelector('img');
    expect(img.getAttribute('src')).toBe(ROWS[1].image_front_url); // Power Red/White

    const goldPill = screen.getByRole('button', { name: 'Athletic Gold/White' });
    const redPill = screen.getByRole('button', { name: 'Power Red/White' });
    expect(Number(goldPill.style.opacity)).toBeLessThan(1);
    expect(Number(redPill.style.opacity)).toBe(1);
  });

  test('a single-variant group renders no color pills', () => {
    const single = { key: 'nike|polo', brand: 'Nike', name: 'Dri-FIT Polo', variants: [ROWS[3]] };
    render(<CatalogCard group={single} onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Black' })).toBeNull();
  });
});
