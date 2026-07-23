/* src/teamshop/ChatWidget.js — v2 AI behavior. Free text goes to
 * netlify/functions/teamshop-assistant; the AI reply renders as bot bubbles
 * and its order-card hints render through the SAME OrderCard component v1
 * uses. If the endpoint returns { fallback: true } or errors, the v1
 * rule-based keyword flow answers instead (v1 is the offline mode, never
 * deleted). Also covers the new signed-out family lookup UI (order number +
 * email inputs) that routes through the AI endpoint. Same conventions as
 * teamshopChatWidget.test.js: useCoachSession mocked, fake timers, light
 * render + fireEvent, no jest-dom. */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatWidget from '../teamshop/ChatWidget';

jest.mock('../teamshop/useCoachSession', () => jest.fn());
const useCoachSession = require('../teamshop/useCoachSession');

const CUSTOMER = { id: 'custA', name: 'Central High' };

function mockAssistantFetch(payload) {
  global.fetch = jest.fn(async (url) => {
    expect(String(url)).toContain('teamshop-assistant');
    return { ok: true, status: 200, json: async () => payload };
  });
}

async function openPanel() {
  fireEvent.click(screen.getByLabelText('Open Team Shop Assistant chat'));
  await screen.findByText('Team Shop Assistant');
}

async function sendText(text) {
  const box = screen.getByLabelText('Message');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
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

describe('ChatWidget AI replies', () => {
  test('free text renders the AI answer as a bot bubble, plus its order card via the existing card component', async () => {
    useCoachSession.mockReturnValue({ signedIn: true, accessToken: 'coach-token' });
    mockAssistantFetch({
      ok: true,
      text: 'Your most recent order is in production — here it is.',
      cards: [{
        type: 'order',
        order: {
          id: '1010042', order_number: 1010042, status: 'paid', total: 249.5,
          created_at: '2026-07-01T00:00:00Z',
          items: [{ name: 'Performance Polo', sku: 'SKU1', qty: 2, size: 'M' }],
          production: { stage: 'in production' }, status_token: 'tokC',
        },
      }],
    });
    render(<ChatWidget customer={CUSTOMER} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    await sendText('when will my polos ship?');

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/teamshop-assistant');
    expect(opts.headers.Authorization).toBe('Bearer coach-token');
    const body = JSON.parse(opts.body);
    expect(body.customer_id).toBe('custA');
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', text: 'when will my polos ship?' });

    expect(await screen.findByText('Your most recent order is in production — here it is.')).toBeTruthy();
    // The AI card renders through the same OrderCard the v1 track intent uses.
    expect(await screen.findByText('Order #1010042')).toBeTruthy();
    expect(screen.getByText(/Performance Polo/)).toBeTruthy();
    expect(screen.getByText('View order →').getAttribute('href')).toBe('/shop/order/tokC');
  });

  test('anonymous free text sends no Authorization header', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    mockAssistantFetch({ ok: true, text: 'Happy to help!', cards: [] });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    await sendText('what decoration do you offer?');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
    expect(await screen.findByText('Happy to help!')).toBeTruthy();
  });
});

describe('ChatWidget v1 fallback (offline mode kept)', () => {
  test('endpoint returning { fallback: true } routes through the v1 keyword flow', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    mockAssistantFetch({ fallback: true });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    await sendText('need sizing help');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // v1 sizing card, exactly as before the AI upgrade.
    expect(await screen.findByText('Adult fit guide — chest')).toBeTruthy();
  });

  test('a network failure keeps the v1 flow too', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    await sendText('what are my embroidery options');
    expect(await screen.findByText('Embroidery')).toBeTruthy(); // v1 decoration card
  });

  test('chips stay canned — clicking Sizing help never calls the AI endpoint', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    global.fetch = jest.fn();
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Sizing help'));
    await act(async () => { jest.advanceTimersByTime(950); });
    expect(await screen.findByText('Adult fit guide — chest')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('ChatWidget family lookup UI', () => {
  test('signed-out track offers the lookup, whose two inputs submit through the AI endpoint', async () => {
    useCoachSession.mockReturnValue({ signedIn: false, accessToken: null });
    mockAssistantFetch({
      ok: true,
      text: 'Found it — order 1010099 is in production.',
      cards: [{
        type: 'order',
        order: {
          id: '1010099', order_number: 1010099, status: 'paid', total: null, created_at: null,
          items: [], production: { stage: 'in production' }, status_token: 'tokF',
        },
      }],
    });
    render(<ChatWidget customer={null} onOpenAccount={() => {}} onOpenDecoration={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByText('Track my order'));
    await act(async () => { jest.advanceTimersByTime(950); });

    // The signed-out response now offers the family path alongside Sign in.
    fireEvent.click(await screen.findByText('Look up with order # + email'));
    const numBox = await screen.findByLabelText('Order number');
    const emailBox = screen.getByLabelText('Email used at checkout');

    // Button disabled until both fields are filled.
    const button = screen.getByText('Look up order');
    fireEvent.click(button);
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.change(numBox, { target: { value: '1010099' } });
    fireEvent.change(emailBox, { target: { value: 'family@example.com' } });
    fireEvent.click(button);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.text).toContain('1010099');
    expect(last.text).toContain('family@example.com');

    expect(await screen.findByText('Found it — order 1010099 is in production.')).toBeTruthy();
    expect(await screen.findByText('Order #1010099')).toBeTruthy();
    expect(screen.getByText('View order →').getAttribute('href')).toBe('/shop/order/tokF');
  });
});
