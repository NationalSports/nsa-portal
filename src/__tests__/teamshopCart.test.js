/* Stage 5 tests: src/teamshop/cart.js (localStorage cart, no prices — ever)
 * and src/teamshop/CartPage.js (the live, debounced quote flow against
 * netlify/functions/quickorder-quote.js). CartPage never computes a price —
 * these tests assert it only ever renders what a mocked fetch of that
 * function returned. */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as cart from '../teamshop/cart';
import CartPage from '../teamshop/CartPage';

jest.mock('../teamshop/useCoachSession', () => () => ({
  accessToken: 'coach-token',
  signOut: jest.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('cart.js pure functions', () => {
  test('addLine/getLines round-trip and assign an id', () => {
    const line = cart.addLine('custA', { product_id: 'p1', product_name: 'Tee', sku: 'T1', qty: 2, decorations: [] });
    expect(line.id).toBeTruthy();
    expect(cart.getLines('custA')).toEqual([line]);
  });

  test('updateQty clamps to at least 1', () => {
    const line = cart.addLine('custA', { product_id: 'p1', qty: 3 });
    cart.updateQty('custA', line.id, 0);
    expect(cart.getLines('custA')[0].qty).toBe(1);
    cart.updateQty('custA', line.id, 5);
    expect(cart.getLines('custA')[0].qty).toBe(5);
  });

  test('setSize updates only the matching line', () => {
    const a = cart.addLine('custA', { product_id: 'p1' });
    const b = cart.addLine('custA', { product_id: 'p2' });
    cart.setSize('custA', b.id, 'AL');
    const lines = cart.getLines('custA');
    expect(lines.find((l) => l.id === a.id).size).toBeNull();
    expect(lines.find((l) => l.id === b.id).size).toBe('AL');
  });

  test('removeLine drops exactly that line', () => {
    const a = cart.addLine('custA', { product_id: 'p1' });
    const b = cart.addLine('custA', { product_id: 'p2' });
    cart.removeLine('custA', a.id);
    expect(cart.getLines('custA').map((l) => l.id)).toEqual([b.id]);
  });

  test('clear empties the cart', () => {
    cart.addLine('custA', { product_id: 'p1' });
    cart.clear('custA');
    expect(cart.getLines('custA')).toEqual([]);
  });

  test('carts are isolated per customer id', () => {
    cart.addLine('custA', { product_id: 'p1' });
    cart.addLine('custB', { product_id: 'p2' });
    expect(cart.getLines('custA')).toHaveLength(1);
    expect(cart.getLines('custB')).toHaveLength(1);
    expect(cart.getLines('custA')[0].product_id).toBe('p1');
    expect(cart.getLines('custB')[0].product_id).toBe('p2');
  });

  test('never persists a price field, even if one is passed in', () => {
    const line = cart.addLine('custA', {
      product_id: 'p1', qty: 1, unit_sell: 999, line_total: 999, sell_override: 1,
    });
    expect(line).not.toHaveProperty('unit_sell');
    expect(line).not.toHaveProperty('line_total');
    expect(line).not.toHaveProperty('sell_override');
    const stored = JSON.parse(window.localStorage.getItem('nts_cart_v1:custA'));
    expect(stored[0]).not.toHaveProperty('unit_sell');
    expect(stored[0]).not.toHaveProperty('line_total');
    expect(stored[0]).not.toHaveProperty('sell_override');
  });
});

describe('CartPage quote flow', () => {
  const CUSTOMER = { id: 'custA', name: 'Central High' };

  function mockQuoteResponse(lines, subtotal) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        quote: {
          lines: lines.map((l) => ({ ...l, unit_sell: 10, line_total: 10 * l.qty })),
          subtotal,
          quote_hash: 'hash1',
          hash_version: 'v2',
        },
      }),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('renders server unit prices and subtotal after the debounced quote resolves', async () => {
    cart.addLine('custA', { product_id: 'p1', product_name: 'Tee', sku: 'T1', qty: 2, decorations: [] });
    global.fetch.mockResolvedValue(mockQuoteResponse([{ product_id: 'p1', sku: 'T1', qty: 2 }], 20));

    render(<CartPage customer={CUSTOMER} onKeepShopping={() => {}} />);
    expect(screen.getByText('—')).toBeTruthy(); // no quote requested yet — still debouncing

    await act(async () => { jest.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('$10.00 ea')).toBeTruthy();
    expect(screen.getByText('$20.00')).toBeTruthy();
    expect(screen.getByText(/Quote updates automatically/)).toBeTruthy();
  });

  test('changing qty triggers a fresh debounced re-quote', async () => {
    cart.addLine('custA', { product_id: 'p1', product_name: 'Tee', sku: 'T1', qty: 1, decorations: [] });
    global.fetch
      .mockResolvedValueOnce(mockQuoteResponse([{ product_id: 'p1', sku: 'T1', qty: 1 }], 10))
      .mockResolvedValueOnce(mockQuoteResponse([{ product_id: 'p1', sku: 'T1', qty: 2 }], 20));

    render(<CartPage customer={CUSTOMER} onKeepShopping={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/Increase quantity/));
    await act(async () => { jest.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(secondBody.lines[0].qty).toBe(2);
    expect(screen.getByText('$20.00')).toBeTruthy();
  });

  test('"Also add without decoration" duplicates the line with decorations: []', async () => {
    cart.addLine('custA', {
      product_id: 'p1', product_name: 'Tee', sku: 'T1', qty: 1,
      decorations: [{ type: 'screen_print', placement: 'left_chest', colors: 1 }],
    });
    global.fetch.mockResolvedValue(mockQuoteResponse([{ product_id: 'p1', sku: 'T1', qty: 1 }], 10));

    render(<CartPage customer={CUSTOMER} onKeepShopping={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(screen.getByText('Also add without decoration'));

    const lines = cart.getLines('custA');
    expect(lines).toHaveLength(2);
    expect(lines[1].decorations).toEqual([]);
    expect(lines[1].product_id).toBe('p1');
  });
});
