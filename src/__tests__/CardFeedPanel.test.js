/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CardFeedPanel, { reportCsv } from '../CardFeedPanel';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'test' } } })) } } }));
const account = { id: '11111111-1111-4111-8111-111111111111', name: 'Business Card', mask: '4242', qbo_payment_account_id: '2', qbo_realm_id: '123', account_subtype: 'credit card' };
const transaction = { id: '22222222-2222-4222-8222-222222222222', account_id: account.id, account, merchant_name: 'Mobile Carrier', description: 'MOBILE CARRIER',
  transaction_date: '2026-09-20', amount_cents: 4852, currency: 'USD', expense_realm_id: '123', status: 'new', pending: false, provider_removed: false, receipt_required: true };
const base = { configured: true, environment: 'sandbox', connections: [{ id: 'c1', institution_name: 'Test Bank' }], accounts: [account], rules: [], transactions: [transaction],
  report: { total_cents: 4852, count: 1, needs_review: 1, ready: 0, submitted: 0, posted: 0, missing_receipts: 1,
    by_account: [{ expense_account_id: null, expense_account_name: 'Uncategorized', amount_cents: 4852, count: 1 }] } };
const options = { realm_id: '123', accounts: [
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
afterEach(() => { delete global.fetch; delete window.Plaid; sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

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
  expect(await screen.findByText(/Card connections need setup/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect card' })).toBeDisabled());
});

test('does not prepare a ready charge while its category edits are unsaved', async () => {
  const prepare = jest.fn();
  const readyTransaction = { ...transaction, status: 'ready', expense_account_id: '1', expense_account_number: '64200', expense_account_name: 'Telephone', purpose: 'Monthly mobile service' };
  global.fetch.mockImplementation(async (_, request) => {
    const body = JSON.parse(request.body);
    const data = body.action === 'categorize' ? { ...base, transactions: [readyTransaction] } : { ...base, transactions: [readyTransaction] };
    return { ok: true, json: async () => data };
  });
  render(<CardFeedPanel company="national" options={options} onPrepare={prepare} />);
  await screen.findByDisplayValue('Monthly mobile service');
  const prepareButton = screen.getByRole('button', { name: 'Prepare expense' });
  expect(prepareButton).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Purpose for Mobile Carrier'), { target: { value: 'Updated purpose' } });
  expect(prepareButton).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare expense' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Prepare expense' }));
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'Monthly mobile service' }));
});

test('a late response from the previous business cannot overwrite the selected business', async () => {
  let releaseNational;
  global.fetch.mockImplementation(async (_, request) => {
    const body = JSON.parse(request.body);
    if (body.company === 'national') return new Promise(resolve => { releaseNational = resolve; });
    return { ok: true, json: async () => ({ ...base, transactions: [{ ...transaction, merchant_name: 'Methodic charge' }] }) };
  });
  const view = render(<CardFeedPanel company="national" options={options} onPrepare={jest.fn()} />);
  await waitFor(() => expect(releaseNational).toBeDefined());
  view.rerender(<CardFeedPanel company="methodic" options={options} onPrepare={jest.fn()} />);
  await screen.findByText('Methodic charge');
  await act(async () => releaseNational({ ok: true, json: async () => base }));
  expect(screen.getByText('Methodic charge')).toBeInTheDocument();
  expect(screen.queryByText('Mobile Carrier')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh cards' })).toBeEnabled();
});

test('OAuth return restores the chosen business and cannot be overwritten by the initial list response', async () => {
  const month = new Date().toLocaleDateString('en-CA').slice(0, 7);
  sessionStorage.setItem('nsa-plaid-link-state', JSON.stringify({ company: 'methodic', month, link_token: 'link-test' }));
  window.history.replaceState({}, '', '/?oauth_state_id=test');
  let config; const staleLoads = [];
  window.Plaid = { create: jest.fn(value => { config = value; return { open: jest.fn(), destroy: jest.fn() }; }) };
  global.fetch.mockImplementation(async (_, request) => {
    const body = JSON.parse(request.body);
    if (body.action === 'list') return new Promise(resolve => staleLoads.push(resolve));
    expect(body).toMatchObject({ action: 'exchange', company: 'methodic', month, public_token: 'public-test' });
    return { ok: true, json: async () => ({ ...base, transactions: [{ ...transaction, merchant_name: 'New connected charge' }] }) };
  });
  function Host() {
    const [company, setCompany] = React.useState('national');
    return <CardFeedPanel key={company} company={company} onCompanyChange={setCompany} options={options} onPrepare={jest.fn()} />;
  }
  render(<Host />);
  await waitFor(() => expect(window.Plaid.create).toHaveBeenCalledTimes(1));
  expect(config.receivedRedirectUri).toContain('oauth_state_id=test');
  await act(async () => config.onSuccess('public-test', {}));
  await screen.findByText('New connected charge');
  await act(async () => { for (const release of staleLoads) release({ ok: true, json: async () => base }); });
  expect(screen.getByText('New connected charge')).toBeInTheDocument();
  expect(screen.queryByText('Mobile Carrier')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh cards' })).toBeEnabled();
});

test('CSV neutralizes merchant formulas while preserving numeric refunds and source status/currency', () => {
  const csv = reportCsv([{ ...transaction, merchant_name: '=HYPERLINK("bad")', description: '+CMD', amount_cents: -1200, pending: true, currency: 'CAD' }]);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"'); expect(csv).toContain('"\'+CMD"');
  expect(csv).toContain('"-12.00","CAD","Pending","Yes","No"');
});
