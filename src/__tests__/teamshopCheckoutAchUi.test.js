/* Team Shop consumer checkout — Bank transfer (ACH) option (src/teamshop/CheckoutPage.js).
 *
 * The ACH option is offered to every signed-in coach (unlike School PO, which
 * is rep-gated). Pins the settle-then-produce client contract:
 *   * choosing ACH sends action 'place_order_ach' (never 'place_order');
 *   * after Stripe confirms and the intent is 'processing', the coach sees the
 *     "bank payment processing / production starts once it clears" screen, and
 *     the client calls NEITHER webstore-checkout finalize NOR convert_order —
 *     settlement (and conversion) belong to the stripe-webhook alone;
 *   * the coach-facing labels for the two ACH states already exist:
 *     'pending_payment' → 'Awaiting payment', 'cancelled' → 'Cancelled'.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { statusChipLabel } from '../lib/teamshopOrderStatus';

jest.mock('../teamshop/useCoachSession', () => ({
  __esModule: true,
  default: () => ({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'coach-tok', signOut: () => {} }),
}));

// Stripe stubs: Elements/PaymentElement render inert; confirmPayment is a
// per-test controllable resolver (plain functions, not jest.fn factories —
// react-scripts runs jest with resetMocks).
let mockConfirmPayment = async () => ({ paymentIntent: { id: 'pi_ach_1', status: 'processing' } });
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => children,
  PaymentElement: () => { const React = require('react'); return React.createElement('div', { 'data-testid': 'payment-element' }); },
  useStripe: () => ({ confirmPayment: (...a) => mockConfirmPayment(...a) }),
  useElements: () => ({}),
}));
jest.mock('@stripe/stripe-js', () => ({ loadStripe: async () => ({ __stripe: true }) }));

const CheckoutPage = require('../teamshop/CheckoutPage').default;

const QUOTE = {
  customer_id: 'custA', tier: 'B', subtotal: 40, quote_hash: 'hash-1',
  lines: [{ product_id: 'p1', sku: 'TS1', name: 'Team Tee', size: 'AL', qty: 2, unit_sell: 20, line_total: 40, decorations: [] }],
};
const CUSTOMER = { id: 'custA', name: 'Central High' };
const ACH_ORDER = { id: 'ord-ach', status: 'pending_payment', buyer_email: 'coach@team.com', status_token: 'tok-ach', order_number: 1010009, stripe_pi_id: 'pi_ach_1' };

// Routes the page's fetches and records every teamshop-checkout action sent.
function mockFetch() {
  const actions = [];
  global.fetch = jest.fn(async (url, opts) => {
    const u = String(url);
    let out = {};
    if (u.includes('stripe-payment')) {
      out = { publishableKey: 'pk_test_1' };
    } else if (u.includes('teamshop-context')) {
      out = { ok: true, customers: [{ id: 'custA', name: 'Central High' }] };
    } else if (u.includes('teamshop-checkout')) {
      const body = JSON.parse((opts && opts.body) || '{}');
      actions.push(body.action);
      if (body.action === 'quote_totals') out = { ok: true, quote: QUOTE, quote_hash: 'hash-1', totals: { subtotal: 40, shipping: 5, tax: 0, tax_state: '', total: 45 } };
      if (body.action === 'place_order_ach') out = { order: ACH_ORDER, totals: { subtotal: 40, shipping: 5, tax: 0, total: 45 }, clientSecret: 'cs_ach_1', intentId: 'pi_ach_1', ach: true };
    } else if (u.includes('webstore-checkout')) {
      const body = JSON.parse((opts && opts.body) || '{}');
      actions.push('ws:' + body.action);
    }
    return { ok: true, status: 200, json: async () => out };
  });
  return actions;
}

const fillOrderForm = (container) => {
  // Inputs in render order: name, email, phone, street, apt, city, state, zip.
  const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
  const values = ['Coach Carter', 'coach@team.com', '555', '1 Main St', '', 'Fresno', 'CA', '93703'];
  values.forEach((v, i) => { if (v) fireEvent.change(inputs[i], { target: { value: v } }); });
};

afterEach(() => { jest.clearAllMocks(); });

test('Bank transfer (ACH) is offered to every coach — no rep gate — alongside card; School PO stays hidden', async () => {
  mockFetch();
  render(<CheckoutPage customer={CUSTOMER} quote={QUOTE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByText('Bank transfer (ACH)')).toBeTruthy());
  expect(screen.getByText('Pay by card')).toBeTruthy();
  expect(screen.queryByText('School purchase order')).toBeFalsy();

  // Selecting ACH surfaces the settle-then-produce expectation up front.
  fireEvent.click(screen.getByText('Bank transfer (ACH)'));
  await waitFor(() => expect(screen.getByText(/production starts once the payment clears/i)).toBeTruthy());
});

test('ACH flow: place_order_ach → processing intent → pending screen; finalize and convert_order are NEVER called', async () => {
  const actions = mockFetch();
  mockConfirmPayment = async () => ({ paymentIntent: { id: 'pi_ach_1', status: 'processing' } });
  const { container } = render(<CheckoutPage customer={CUSTOMER} quote={QUOTE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByText('Bank transfer (ACH)')).toBeTruthy());

  fillOrderForm(container);
  fireEvent.click(screen.getByText('Bank transfer (ACH)'));
  await waitFor(() => expect(screen.getByText('Continue to payment')).toBeTruthy());
  // totals must have landed for the button to enable
  await waitFor(() => expect(screen.getByText('Continue to payment').disabled).toBe(false), { timeout: 3000 });

  fireEvent.click(screen.getByText('Continue to payment'));
  await waitFor(() => expect(actions).toContain('place_order_ach'));
  expect(actions).not.toContain('place_order');

  // The Payment Element form renders with the bank-specific CTA.
  await waitFor(() => expect(screen.getByText('Pay from bank account')).toBeTruthy());
  await act(async () => { fireEvent.click(screen.getByText('Pay from bank account')); });

  // Processing screen: order number, the few-business-days expectation, and
  // the produce-after-clearing promise.
  await waitFor(() => expect(screen.getByText(/bank payment processing/i)).toBeTruthy());
  expect(screen.getByText(/#1010009/)).toBeTruthy();
  expect(screen.getByText(/business days to clear/i)).toBeTruthy();
  expect(screen.getByText(/start production as soon as your payment clears/i)).toBeTruthy();

  // Settle-then-produce: the client made NO settlement or conversion calls.
  expect(actions).not.toContain('ws:finalize');
  expect(actions).not.toContain('convert_order');
});

test('coach label map for the ACH lifecycle: processing reads Awaiting payment, a bounced payment reads Cancelled', () => {
  expect(statusChipLabel({ status: 'pending_payment' })).toBe('Awaiting payment');
  expect(statusChipLabel({ status: 'cancelled' })).toBe('Cancelled');
  // settled + converted orders read from production stage as before
  expect(statusChipLabel({ status: 'batched', production: { stage: 'queued' } })).toBe('Queued');
});
