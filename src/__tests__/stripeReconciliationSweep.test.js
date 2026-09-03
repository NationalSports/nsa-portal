/** @jest-environment node */

jest.mock('stripe', () => jest.fn());
jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn() }));

const { isScheduled } = require('../../netlify/functions/stripe-reconciliation-sweep');

describe('Stripe reconciliation scheduled-function boundary', () => {
  test('accepts Netlify schedule invocations', () => {
    expect(isScheduled({ headers: { 'x-nf-event': 'schedule' }, body: '{}' })).toBe(true);
    expect(isScheduled({ headers: {}, body: JSON.stringify({ next_run: '2026-09-04T09:17:00Z' }) })).toBe(true);
  });

  test('does not treat an ordinary public request as scheduled', () => {
    expect(isScheduled({ headers: {}, body: '{}' })).toBe(false);
  });
});
