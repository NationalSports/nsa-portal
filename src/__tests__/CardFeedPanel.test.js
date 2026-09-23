/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CardFeedPanel from '../CardFeedPanel';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'test' } } })) } } }));
const account = { id: '11111111-1111-4111-8111-111111111111', name: 'Business Card', mask: '4242', qbo_payment_account_id: '2', account_subtype: 'credit card' };
const transaction = { id: '22222222-2222-4222-8222-222222222222', account_id: account.id, account, merchant_name: 'Mobile Carrier', description: 'MOBILE CARRIER',
  transaction_date: '2026-09-20', amount_cents: 4852, status: 'new', pending: false, provider_removed: false, receipt_required: true };
const base = { configured: true, environment: 'sandbox', connections: [{ id: 'c1', institution_name: 'Test Bank' }], accounts: [account], rules: [], transactions: [transaction],
  report: { total_cents: 4852, count: 1, needs_review: 1, ready: 0, submitted: 0, posted: 0, missing_receipts: 1,
    by_account: [{ expense_account_id: null, expense_account_name: 'Uncategorized', amount_cents: 4852, count: 1 }] } };
const options = { accounts: [
  { Id: '1', AcctNum: '64200', Name: 'Telephone', AccountType: 'Expense' },
  { Id: '2', AcctNum: '21000', Name: 'Business Card', AccountType: 'Credit Card' },
] };

beforeEach(() => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test' } } });
  global.fetch = jest.fn(async (_, request) => {
    const body = JSON.parse(request.body);
    const data = body.action === 'categorize' ? { ...base, transactions: [{ ...transaction, status: 'ready', expense_account_id: '1', expense_account_number: '64200', expense_account_name: 'Telephone', purpose: body.purpose }],
      report: { ...base.report, needs_review: 0, ready: 1, by_account: [{ expense_account_id: '1', expense_account_number: '64200', expense_account_name: 'Telephone', amount_cents: 4852, count: 1 }] } } : base;
    return { ok: true, json: async () => data };
  });
});
afterEach(() => { delete global.fetch; });

test('categorizes an imported charge and hands the verified transaction to expense review', async () => {
  const prepare = jest.fn();
  render(<CardFeedPanel company="national" options={options} onPrepare={prepare} />);
  expect((await screen.findAllByText('$48.52')).length).toBeGreaterThan(0);
  expect(screen.getByText('1 missing receipts')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Expense account for Mobile Carrier'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Purpose for Mobile Carrier'), { target: { value: 'Monthly mobile service' } });
  fireEvent.click(screen.getByLabelText('Remember merchant rule'));
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
  await screen.findByText('Category saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Prepare expense' }));
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ id: transaction.id, status: 'ready', expense_account_id: '1', purpose: 'Monthly mobile service' }));
  const request = global.fetch.mock.calls.map(([, config]) => JSON.parse(config.body)).find(body => body.action === 'categorize');
  expect(request).toMatchObject({ transaction_id: transaction.id, expense_account_id: '1', purpose: 'Monthly mobile service', remember: true, receipt_required: true });
});

test('shows setup requirements without exposing a card-login form', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...base, configured: false, connections: [], accounts: [], transactions: [], report: { ...base.report, count: 0, total_cents: 0, by_account: [] } }) });
  render(<CardFeedPanel company="national" options={options} onPrepare={jest.fn()} />);
  expect(await screen.findByText(/ready for provider credentials/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect card' })).toBeDisabled());
});
