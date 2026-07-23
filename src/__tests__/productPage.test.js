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
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
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

  test('renders the logo, placement, and the three method FAMILY tiles', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    expect(screen.getByText(/Add your logo/i)).toBeTruthy();
    expect(screen.getByText(/Size & place it/i)).toBeTruthy();
    // Owner-approved taxonomy: family tiles, not flat methods — DTF is now a
    // KIND inside Heat Applications, never a top-level tile.
    expect(screen.getByText('Embroidery')).toBeTruthy();
    expect(screen.getByText('Heat Applications')).toBeTruthy();
    expect(screen.getByText('Screen Print')).toBeTruthy();
    expect(screen.queryByText('DTF Print')).toBeNull();
    // Real zones from decoSpec.zonesForGarment (polo -> placket set) —
    // not the mockup's hardcoded chip labels.
    expect(screen.getByText('Left chest')).toBeTruthy();
  });

  test('Heat Applications expands a kind selector (DTF / Vinyl / Silicone patch); vinyl shows its option chips', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    // Kinds are hidden until the Heat family is selected.
    expect(screen.queryByText('DTF Transfer')).toBeNull();
    fireEvent.click(screen.getByText('Heat Applications'));
    expect(screen.getByText('Heat application type')).toBeTruthy();
    // 'DTF Transfer' appears twice once Heat is selected: the kind chip AND
    // the preview's method pill (dtf is the default heat kind).
    expect(screen.getAllByText('DTF Transfer').length).toBeGreaterThan(0);
    expect(screen.getByText('Vinyl')).toBeTruthy();
    expect(screen.getByText('Silicone Patch')).toBeTruthy();
    // Vinyl kind → its rate-card option chips appear.
    expect(screen.queryByText('Vinyl option')).toBeNull();
    fireEvent.click(screen.getByText('Vinyl'));
    expect(screen.getByText('Vinyl option')).toBeTruthy();
    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText('Player number')).toBeTruthy();
    expect(screen.getByText('Name + number')).toBeTruthy();
  });

  test('Screen Print tile is disabled with the 24+ hint under the minimum and auto-enables at 24 pieces', () => {
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    const tile = screen.getByText('Screen Print').closest('button');
    expect(tile.disabled).toBe(true);
    expect(screen.getByText('Requires 24+ pieces')).toBeTruthy();
    // 24 pieces in the size run → the tile unlocks (and its color chips show once selected).
    const plusS = screen.getByLabelText('Increase S');
    for (let i = 0; i < 24; i++) fireEvent.click(plusS);
    expect(tile.disabled).toBe(false);
    fireEvent.click(tile);
    expect(screen.getByText('Number of colors')).toBeTruthy();
    expect(screen.getByLabelText('3 colors')).toBeTruthy();
  });

  test('signed in: a Heat kind carries the CONCRETE production type into the cart-line spec (vinyl + option)', async () => {
    useCoachSession.mockReturnValue({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'tok', signOut: () => {} });
    const onAddToOrder = jest.fn();
    render(<ProductPage product={PRODUCT} customer={CUSTOMER} onBack={() => {}} onAddToOrder={onAddToOrder} />);
    fireEvent.click(screen.getByText('Pick Team Logo'));
    fireEvent.click(screen.getByText('Heat Applications'));
    fireEvent.click(screen.getByText('Vinyl'));
    fireEvent.click(screen.getByText('Player number'));
    fireEvent.click(screen.getByLabelText('Increase S'));
    await act(async () => { fireEvent.click(screen.getByText('Add to order')); });
    expect(onAddToOrder).toHaveBeenCalledTimes(1);
    const spec = onAddToOrder.mock.calls[0][0][0].decorations[0];
    expect(spec).toMatchObject({ type: 'vinyl', family: 'heat', option: 'number' });
    expect(validateSpec(spec)).toEqual({ ok: true });
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

  test('delivery-estimate chip renders when the server sends a timeline, verbatim', async () => {
    const TL = { min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        lines: [{ unit_garment: 10, unit_deco: 0, unit_total: 10, line_total: 10, timeline: TL }],
        subtotal: 10,
        timeline: TL,
      }),
    }));
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    // Chip + the footer line both show the server band once the debounced
    // quote resolves (never a client-computed estimate).
    await waitFor(() => expect(screen.getAllByText(/Ships in ~1\.5–2 weeks/).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryByText(/Ships in 5–7 days/)).toBeNull();
  });

  test('no timeline from the server → no chip, generic footer only', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ ok: true, lines: [{ unit_garment: 10, unit_deco: 0, unit_total: 10, line_total: 10, timeline: null }], subtotal: 10, timeline: null }),
    }));
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText(/\$10\.00/).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryByText(/Ships in ~/)).toBeNull();
    expect(screen.getByText(/Ships in 5–7 days/)).toBeTruthy();
  });

  test('no client-side price is ever rendered — the header shows a neutral placeholder absent a resolved fetch', () => {
    global.fetch = jest.fn(() => new Promise(() => {})); // never resolves
    render(<ProductPage product={PRODUCT} onBack={() => {}} />);
    expect(screen.getAllByText('Pricing…').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\$/)).toBeNull();
  });
});
