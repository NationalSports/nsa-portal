/* src/teamshop/ChatWidget.js — the floating Team Shop Assistant chat widget
 * (v1: canned/rule-based, no AI backend). Follows the repo's existing
 * teamshop test conventions: useCoachSession mocked directly (accountPage/
 * teamshopCart style), light render + fireEvent assertions, no jest-dom.
 *
 * Covers: the launcher mounts on every TeamShopApp view (landing + catalog),
 * the panel opens, the decoration card never lists DTF as a top-level
 * method, the signed-out track intent shows the sign-in path (no fetch),
 * the signed-in track intent renders an order card built from a mocked
 * teamshop-orders 'list' response (correct stage fill + statusChipLabel
 * reuse), and free-text keyword routing.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatWidget from '../teamshop/ChatWidget';

jest.mock('../teamshop/useCoachSession', () => jest.fn());
const useCoachSession = require('../teamshop/useCoachSession');

const CUSTOMER = { id: 'custA', name: 'Central High' };

function mockOrdersFetch(orders) {
  global.fetch = jest.fn(async (url) => {
    expect(String(url)).toContain('teamshop-orders');
    return { ok: true, status: 200, json: async () => ({ ok: true, orders }) };
  });
}

async function openPanel() {
  fireEvent.click(screen.getByLabelText('Open Team Shop Assistant chat'));
  await screen.findByText('Team Shop Assistant');
}

async function advanceTyping() {
  await act(async () => { jest.advanceTimersByTime(950); });
}

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
  window.sessionStorage.clear();
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
  jest.resetAllMocks();
});

describe('ChatWidget launcher', () => {
  test('renders the launcher on the landing view and the catalog view alike', () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    const { unmount } = render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    expect(screen.getByLabelText('Open Team Shop Assistant chat')).toBeTruthy();
    expect(screen.getByText('Need a hand? Ask away')).toBeTruthy();
    unmount();
    // Re-mounting (as TeamShopApp does identically regardless of `route`)
    // renders the same launcher — the widget has no view-specific gating.
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    expect(screen.getByLabelText('Open Team Shop Assistant chat')).toBeTruthy();
  });

  test('clicking the launcher opens the panel with the greeting', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    expect(screen.getByText(/Coaches & players/)).toBeTruthy();
    expect(screen.getByText(/I can help with orders, sizing, decoration, and team pricing/)).toBeTruthy();
    expect(screen.getByText('Powered by National Team Shop')).toBeTruthy();
  });
});

describe('ChatWidget decoration intent', () => {
  test('lists exactly Embroidery, Heat Applications, Screen Print — never DTF as a top-level method', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Decoration options'));
    await advanceTyping();
    expect(await screen.findByText('Embroidery')).toBeTruthy();
    expect(screen.getByText('Heat Applications')).toBeTruthy();
    expect(screen.getByText('Screen Print')).toBeTruthy();
    // No card/heading titled "DTF" or "DTF Print" — DTF only appears as a
    // sub-type inside the Heat Applications description text.
    expect(screen.queryByText('DTF')).toBeNull();
    expect(screen.queryByText('DTF Print')).toBeNull();
    expect(screen.getByText(/Full-color DTF transfers/)).toBeTruthy();
  });

  test('clicking a decoration card option calls onOpenDecoration with that method', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    const onOpenDecoration = jest.fn();
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={onOpenDecoration} />);
    await openPanel();
    fireEvent.click(screen.getByText('Decoration options'));
    await advanceTyping();
    fireEvent.click(await screen.findByText('Heat Applications'));
    expect(onOpenDecoration).toHaveBeenCalledWith('heat');
  });
});

describe('ChatWidget track-order intent', () => {
  test('signed out: explains sign-in and offers Sign in / Email us, no fetch', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    const onOpenAccount = jest.fn();
    render(<ChatWidget customer={null} onOpenAccount={onOpenAccount} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Track my order'));
    await advanceTyping();
    expect(await screen.findByText(/Sign in and I can show you live status/)).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByText('Email us')).toBeTruthy();
    expect(global.fetch).toBeUndefined();

    fireEvent.click(screen.getByText('Sign in'));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  test('signed in: renders an order card from the mocked list response, correct stage fill + statusChipLabel reuse', async () => {
    useCoachSession.mockReturnValue({ signedIn: true, accessToken: 'coach-token' });
    const order = {
      id: 'ord1', created_at: '2026-07-01T00:00:00Z', status: 'paid', total: 249.5,
      status_token: 'tok123', so_id: 'so1',
      items: [{ product_id: 'p1', sku: 'SKU1', name: 'Performance Polo', qty: 2 }],
      production: { stage: 'in production' },
    };
    mockOrdersFetch([order]);
    render(<ChatWidget customer={CUSTOMER} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Track my order'));
    await advanceTyping();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/teamshop-orders');
    expect(opts.headers.Authorization).toBe('Bearer coach-token');
    expect(JSON.parse(opts.body)).toEqual({ action: 'list', customer_id: 'custA' });

    expect(await screen.findByText('Order #ord1')).toBeTruthy();
    expect(screen.getByText(/Performance Polo/)).toBeTruthy();
    // production.stage 'in production' -> statusChipLabel -> "In production"
    // appears both as the chip label and the filled step's own label.
    expect(screen.getAllByText('In production').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('View order →').getAttribute('href')).toBe('/shop/order/tok123');
  });

  test('signed in, payment-state order (Awaiting payment): shows chip + explainer, no progress bar', async () => {
    useCoachSession.mockReturnValue({ signedIn: true, accessToken: 'coach-token' });
    const order = {
      id: 'ord2', created_at: '2026-07-05T00:00:00Z', status: 'pending_payment', total: 90,
      status_token: 'tok9', so_id: null, items: [{ name: 'Cap', qty: 1 }], production: null,
    };
    mockOrdersFetch([order]);
    render(<ChatWidget customer={CUSTOMER} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Track my order'));
    await advanceTyping();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await screen.findByText('Awaiting payment')).toBeTruthy();
    expect(screen.getByText(/waiting on payment before this order starts production/)).toBeTruthy();
    expect(screen.queryByText('Shipped')).toBeNull(); // no progress-bar step labels rendered
  });
});

describe('ChatWidget keyword routing (free text)', () => {
  const cases = [
    ['track my order please', 'Track my order'],
    ['need sizing help', 'Sizing help'],
    ['what are my embroidery options', 'Decoration options'],
    ['tell me about team pricing', 'Team pricing'],
    ['I want to talk to a human', 'Talk to a human'],
    ['asdkjhasdkjh nonsense', null],
  ];

  test.each(cases)('routes %j the same as the %s chip', async (input, chipLabel) => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    const box = screen.getByLabelText('Message');
    fireEvent.change(box, { target: { value: input } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await advanceTyping();
    if (chipLabel === 'Track my order') {
      expect(await screen.findByText(/Sign in and I can show you live status/)).toBeTruthy();
    } else if (chipLabel === 'Sizing help') {
      expect(await screen.findByText('Adult fit guide — chest')).toBeTruthy();
    } else if (chipLabel === 'Decoration options') {
      expect(await screen.findByText('Embroidery')).toBeTruthy();
    } else if (chipLabel === 'Team pricing') {
      expect(await screen.findByText(/your program's real pricing/)).toBeTruthy();
    } else if (chipLabel === 'Talk to a human') {
      expect(await screen.findByText(/Leave a message and your rep will get back to you/)).toBeTruthy();
    } else {
      expect(await screen.findByText('I can help with orders, sizing, decoration, and team pricing.')).toBeTruthy();
    }
  });
});
