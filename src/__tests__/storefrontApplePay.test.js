import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockAvailableMethods = { applePay: true, googlePay: false, link: false, paypal: false, amazonPay: false, klarna: false };
let mockSubmitResult = {};
let mockConfirmResult = { paymentIntent: { id: 'pi_apple_1', status: 'succeeded' } };
const mockCalls = [];

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => children,
  AddressElement: () => null,
  PaymentElement: () => { const React = require('react'); return React.createElement('div', { 'data-testid': 'payment-element' }); },
  ExpressCheckoutElement: (props) => {
    const React = require('react');
    React.useEffect(() => props.onReady({ availablePaymentMethods: mockAvailableMethods }), []);
    return React.createElement('button', { type: 'button', onClick: props.onConfirm }, 'Apple Pay');
  },
  useStripe: () => ({
    confirmPayment: async (...args) => { mockCalls.push(['confirm', ...args]); return mockConfirmResult; },
  }),
  useElements: () => ({
    submit: async () => { mockCalls.push(['submit']); return mockSubmitResult; },
  }),
}));
jest.mock('@stripe/stripe-js', () => ({ loadStripe: async () => ({}) }));

const { CardForm } = require('../storefront/Storefront');
const theme = { accent: '#ef1234', ink: '#10213c' };

beforeEach(() => {
  mockAvailableMethods = { applePay: true, googlePay: false, link: false, paypal: false, amazonPay: false, klarna: false };
  mockSubmitResult = {};
  mockConfirmResult = { paymentIntent: { id: 'pi_apple_1', status: 'succeeded' } };
  mockCalls.length = 0;
});

test('Apple Pay express checkout submits Elements, confirms the existing PaymentIntent, then finalizes the order', async () => {
  const paid = jest.fn(async () => {});
  render(<CardForm theme={theme} onPaid={paid} onProcessing={() => {}} />);

  await waitFor(() => expect(screen.getByText('Or pay another way')).toBeTruthy());
  fireEvent.click(screen.getByText('Apple Pay'));

  await waitFor(() => expect(paid).toHaveBeenCalledWith('pi_apple_1'));
  expect(mockCalls.map((c) => c[0])).toEqual(['submit', 'confirm']);
  expect(mockCalls[1][1]).toMatchObject({ redirect: 'if_required' });
  expect(screen.getByTestId('payment-element')).toBeTruthy();
});

test('unsupported browsers keep the card form and collapse the express divider', async () => {
  mockAvailableMethods = undefined;
  render(<CardForm theme={theme} onPaid={() => {}} onProcessing={() => {}} />);

  await waitFor(() => expect(screen.queryByText('Or pay another way')).toBeFalsy());
  expect(screen.getByTestId('payment-element')).toBeTruthy();
  expect(screen.getByText('Pay now')).toBeTruthy();
});

test('wallet submission errors do not attempt to confirm or finalize', async () => {
  mockSubmitResult = { error: { message: 'Wallet was cancelled.' } };
  const paid = jest.fn(async () => {});
  render(<CardForm theme={theme} onPaid={paid} onProcessing={() => {}} />);

  fireEvent.click(screen.getByText('Apple Pay'));
  await waitFor(() => expect(screen.getByText('Wallet was cancelled.')).toBeTruthy());
  expect(mockCalls.map((c) => c[0])).toEqual(['submit']);
  expect(paid).not.toHaveBeenCalled();
});
