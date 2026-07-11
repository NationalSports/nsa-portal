/* Team Shop consumer checkout — School-PO option gating (src/teamshop/CheckoutPage.js).
 *
 * The PO payment option must appear ONLY when teamshop-context reports the
 * active customer's teamshop_po_allowed = true (rep-gated, 00196); it defaults
 * hidden on false/absent/fetch failure. The flag is cosmetic — place_order_po
 * re-verifies server-side (covered in teamshopCheckout.test.js). Also pins the
 * coach-facing label for the pending status: 'unpaid' → 'PO review'
 * (src/lib/teamshopOrderStatus.js, shared by AccountPage and CoachPortal).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { statusChipLabel } from '../lib/teamshopOrderStatus';

jest.mock('../teamshop/useCoachSession', () => ({
  __esModule: true,
  default: () => ({ loading: false, signedIn: true, email: 'coach@team.com', accessToken: 'coach-tok', signOut: () => {} }),
}));

const CheckoutPage = require('../teamshop/CheckoutPage').default;

const QUOTE = {
  customer_id: 'custA', tier: 'B', subtotal: 40, quote_hash: 'hash-1',
  lines: [{ product_id: 'p1', sku: 'TS1', name: 'Team Tee', size: 'AL', qty: 2, unit_sell: 20, line_total: 40, decorations: [] }],
};
const CUSTOMER = { id: 'custA', name: 'Central High' };

// Routes the page's fetches: stripe config (no key → card form inert),
// teamshop-context (the PO gate), teamshop-checkout quote_totals.
const mockFetch = ({ poAllowed }) => {
  global.fetch = jest.fn(async (url, opts) => {
    const u = String(url);
    let out = {};
    if (u.includes('teamshop-context')) {
      out = { ok: true, customers: [{ id: 'custA', name: 'Central High', ...(poAllowed === undefined ? {} : { teamshop_po_allowed: poAllowed }) }] };
    } else if (u.includes('teamshop-checkout')) {
      const body = JSON.parse((opts && opts.body) || '{}');
      if (body.action === 'quote_totals') out = { ok: true, quote: QUOTE, quote_hash: 'hash-1', totals: { subtotal: 40, shipping: 5, tax: 0, tax_state: '', total: 45 } };
    }
    return { ok: true, status: 200, json: async () => out };
  });
};

afterEach(() => { jest.clearAllMocks(); });

test('rep-approved program: the School PO payment option appears', async () => {
  mockFetch({ poAllowed: true });
  render(<CheckoutPage customer={CUSTOMER} quote={QUOTE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByText('School purchase order')).toBeTruthy());
  expect(screen.getByText('Pay by card')).toBeTruthy();

  // Selecting it swaps in the PO form (number + PDF) and hides the card CTA.
  fireEvent.click(screen.getByText('School purchase order'));
  await waitFor(() => expect(screen.getByLabelText('po-number')).toBeTruthy());
  expect(screen.getByLabelText('po-pdf')).toBeTruthy();
  expect(screen.getByText('Place order with PO')).toBeTruthy();
  expect(screen.queryByText('Continue to payment')).toBeFalsy();
});

test('not approved (flag false): no PO option, card flow untouched', async () => {
  mockFetch({ poAllowed: false });
  render(<CheckoutPage customer={CUSTOMER} quote={QUOTE} onBack={() => {}} />);
  // context fetch resolves during this wait; the option must never appear
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('Continue to payment')).toBeTruthy());
  expect(screen.queryByText('School purchase order')).toBeFalsy();
});

test('flag absent from the server response (pre-00196 backend): default hidden', async () => {
  mockFetch({ poAllowed: undefined });
  render(<CheckoutPage customer={CUSTOMER} quote={QUOTE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByText('Continue to payment')).toBeTruthy());
  expect(screen.queryByText('School purchase order')).toBeFalsy();
});

test("coach label map: the pending status 'unpaid' reads as PO review; rejection reads as Cancelled", () => {
  expect(statusChipLabel({ status: 'unpaid' })).toBe('PO review');
  expect(statusChipLabel({ status: 'cancelled' })).toBe('Cancelled');
  // approved orders convert ('batched') and read from production stage as before
  expect(statusChipLabel({ status: 'batched', production: { stage: 'received' } })).toBe('Received');
});
