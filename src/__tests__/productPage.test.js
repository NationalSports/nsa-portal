/* src/teamshop/ProductPage.js — the approved "Product Builder" mockup
 * (two-column live preview + config panel) replacing the earlier simpler
 * product detail page. This suite covers: the product fields it renders,
 * that the logo/placement/method controls exist, that "Add to order" (once
 * a logo + placement + a sized quantity are picked) builds a
 * validateSpec-passing decoSpec and calls onAddToOrder with a real cart
 * line, the image fallback placeholder, and that no client-side price is
 * ever rendered (only "Pricing…"/"Pricing unavailable" placeholders absent
 * a mocked fetch — see the price-endpoint tests below for the real number). */
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import ProductPage from '../teamshop/ProductPage';
import { validateSpec } from '../teamshop/decoSpec';

// useCoachSession hits supabaseCoach — stub it so tests control signed-in
// state directly via the `customer` prop instead of a real session.
jest.mock('../teamshop/useCoachSession', () => jest.fn());
const useCoachSession = require('../teamshop/useCoachSession');

// LogoPicker fetches teamshop-art.js on mount; stub it to a simple picker so
// this suite doesn't need a real coach session/network for logo selection.
jest.mock('../teamshop/LogoPicker', () => function MockLogoPicker({ onSelect }) {
  return (
    <button type="button" onClick={() => onSelect({ id: 'logo1', url: 'https://cdn/logo.png', name: 'Team Logo', source: 'art_library' })}>
      Pick Team Logo
    </button>
  );
});

const PRODUCT = {
  id: 'p1',
  brand: 'Sport-Tek',
  name: 'PosiCharge Performance Polo',
  sku: 'ST-POLO-1',
  color: 'Navy',
  available_sizes: ['S', 'M', 'L', 'XL'],
  image_front_url: 'https://cdn/x/polo-front.png',
  image_back_url: 'https://cdn/x/polo-back.png',
};

const CUSTOMER = { id: 'cust1', name: 'Central High' };

beforeEach(() => {
  useCoachSession.mockReturnValue({ loading: false, signedIn: false, email: null, accessToken: null, signOut: () => {} });
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true, lines: [], subtotal: 0 }) }));
});

afterEach(() => { jest.clearAllMocks(); });

describe('ProductPage (product builder)', () => {
  test('renders brand, name, sku, and size-run size labels', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    expect(screen.getByText('Sport-Tek')).toBeTruthy();
    expect(screen.getAllByText('PosiCharge Performance Polo').length).toBeGreaterThan(0);
    expect(screen.getByText('SKU ST-POLO-1')).toBeTruthy();
    for (const s of PRODUCT.available_sizes) {
      expect(screen.getAllByText(s).length).toBeGreaterThan(0);
    }
  });

  test('renders the logo, placement, and decoration method controls', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    expect(screen.getByText(/Add your logo/i)).toBeTruthy();
    expect(screen.getByText(/Size & place it/i)).toBeTruthy();
    expect(screen.getByText('Embroidery')).toBeTruthy();
    expect(screen.getByText('DTF Print')).toBeTruthy();
    expect(screen.getByText('Screen Print')).toBeTruthy();
    // Real zones from decoSpec.zonesForGarment (polo -> placket set) —
    // not the mockup's hardcoded chip labels.
    expect(screen.getByText('Left chest')).toBeTruthy();
  });

  test('falls back to a labeled placeholder when the product has no photo', () => {
    const noPhoto = { name: 'No Photo Polo' };
    render(<ProductPage product={noPhoto} onBack={() => {}} />);
    expect(screen.getByText('Garment Photo — Front')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  test('back button calls onBack', () => {
    const onBack = jest.fn();
    render(<ProductPage product={PRODUCT} onBack={onBack} />);
    fireEvent.click(screen.getByText('← Back to catalog'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('anonymous: "Add to order" gates to sign-in via onCustomize, never adds to a cart', () => {
    const onCustomize = jest.fn();
    const onAddToOrder = jest.fn();
    render(<ProductPage product={PRODUCT} onBack={() => {}} onCustomize={onCustomize} onAddToOrder={onAddToOrder} />);
    fireEvent.click(screen.getByText('Add to order'));
    expect(onCustomize).toHaveBeenCalledWith(PRODUCT);
    expect(onAddToOrder).not.toHaveBeenCalled();
  });

  test('anonymous: logo step is gated behind sign-in (no real LogoPicker rendered)', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} onCustomize={() => {}} />);
    expect(screen.queryByText('Pick Team Logo')).toBeNull();
    expect(screen.getByText(/Sign in to pick a saved logo/i)).toBeTruthy();
  });

  test('signed in: picking a logo, a placement, and a sized quantity builds a validateSpec-passing spec and adds a cart line via onAddToOrder', async () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: () => {} });
    const onAddToOrder = jest.fn();
    render(<ProductPage product={PRODUCT} customer={CUSTOMER} onBack={() => {}} onAddToOrder={onAddToOrder} />);

    // Step 1: pick the (mocked) logo.
    fireEvent.click(screen.getByText('Pick Team Logo'));
    // Step 2: a placement zone is pre-selected by default (Left chest for a polo).
    // Size run: give the first size (S) a quantity.
    const sPill = screen.getAllByText('S')[0];
    const sizeCard = sPill.closest('div');
    fireEvent.click(within(sizeCard).getByLabelText('Increase S'));

    await act(async () => { fireEvent.click(screen.getByText('Add to order')); });

    expect(onAddToOrder).toHaveBeenCalledTimes(1);
    const lines = onAddToOrder.mock.calls[0][0];
    expect(Array.isArray(lines)).toBe(true);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({ product_id: 'p1', sku: 'ST-POLO-1', size: 'S', qty: 1, color: 'Navy' });
    expect(Array.isArray(line.decorations)).toBe(true);
    expect(line.decorations).toHaveLength(1);
    expect(validateSpec(line.decorations[0])).toEqual({ ok: true });
  });

  test('signed in: "Add to order" without a logo/placement shows an error and does not call onAddToOrder', async () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: () => {} });
    const onAddToOrder = jest.fn();
    render(<ProductPage product={PRODUCT} customer={CUSTOMER} onBack={() => {}} onAddToOrder={onAddToOrder} />);
    await act(async () => { fireEvent.click(screen.getByText('Add to order')); });
    expect(onAddToOrder).not.toHaveBeenCalled();
    expect(screen.getByText(/Add a logo and placement first/i)).toBeTruthy();
  });

  test('no client-side price is ever rendered — the header shows a neutral placeholder absent a resolved fetch', () => {
    global.fetch = jest.fn(() => new Promise(() => {})); // never resolves
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    expect(screen.getAllByText('Pricing…').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\$/)).toBeNull();
  });
});
