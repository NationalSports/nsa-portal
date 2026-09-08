/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExpensesWorkspace from '../ExpensesWorkspace';
import { supabase } from '../lib/supabase';
jest.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'test' } } })) } } }));
const accounts = [
  { Id: '1', AcctNum: '62000', Name: 'Travel', AccountType: 'Expense' },
  { Id: '2', AcctNum: '10100', Name: 'Business Checking', AccountType: 'Bank' },
  { Id: '3', AcctNum: '20000', Name: 'Accounts Payable', AccountType: 'Accounts Payable' },
];
const row = { id: 'c0402a77-6564-4a70-8b98-09256bfba465', merchant: 'Airline', expense_date: '2026-08-31', amount_cents: 12495,
  purpose: 'Customer meeting', payment_kind: 'personal', expense_account_number: '62000', expense_account_name: 'Travel',
  payment_account_number: '20000', payment_account_name: 'Accounts Payable',
  vendor_name: 'Steve Peterson', status: 'submitted', qb_entity_type: 'Bill' };
let requests, submitFail;
beforeEach(() => {
  requests = []; submitFail = false;
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test' } } });
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => row.id } });
  global.fetch = jest.fn(async (_, opts) => {
    const body = JSON.parse(opts.body); requests.push(body);
    let data;
    if (body.action === 'list') data = { expenses: [row], nextOffset: null };
    if (body.action === 'options') data = { realm_id: '123', accounts: body.company === 'methodic' ? [{ Id: '20', AcctNum: '62100', Name: 'Methodic Travel', AccountType: 'Expense' }] : accounts };
    if (body.action === 'vendors') data = { vendors: [{ Id: '4', DisplayName: 'Steve Peterson' }] };
    if (body.action === 'post') data = { expense: { ...row, status: 'posted', qb_entity_id: '900' } };
    if (body.action === 'submit') {
      if (submitFail) { submitFail = false; return { ok: false, status: 500, json: async () => ({ error: 'Temporary service failure' }) }; }
      data = { expense: row };
    }
    return { ok: true, json: async () => data };
  });
});
afterEach(() => { delete global.fetch; });
test('defaults to personal reimbursement and shows only payable accounts', async () => {
  render(<ExpensesWorkspace />);
  const account = await screen.findByLabelText('Accounts payable account');
  expect(within(account).getByRole('option', { name: '20000 · Accounts Payable · Accounts Payable' })).toBeInTheDocument();
  expect(within(account).queryByRole('option', { name: /Business Checking/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Who paid?'), { target: { value: 'business' } });
  expect(within(screen.getByLabelText('Paid from account')).getByRole('option', { name: '10100 · Business Checking · Bank' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Reimbursement payee')).not.toBeInTheDocument();
});
test('business changes clear prior account selections and load the other chart', async () => {
  render(<ExpensesWorkspace />);
  fireEvent.change(await screen.findByLabelText('QuickBooks expense account'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Business'), { target: { value: 'methodic' } });
  await screen.findByRole('option', { name: '62100 · Methodic Travel · Expense' });
  expect(screen.getByLabelText('QuickBooks expense account')).toHaveValue('');
  expect(screen.queryByRole('option', { name: /62000 · Travel/ })).not.toBeInTheDocument();
});
test('reviewing a mapping never posts until the explicit posting action', async () => {
  render(<ExpensesWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review & post' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('National Sports Apparel')).toBeInTheDocument();
  expect(within(dialog).getByText('Steve Peterson')).toBeInTheDocument();
  expect(within(dialog).getByText('62000 · Travel')).toBeInTheDocument();
  expect(within(dialog).getByText('20000 · Accounts Payable')).toBeInTheDocument();
  expect(requests.filter(r => r.action === 'post')).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Post to QuickBooks' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('QuickBooks Bill #900')).toBeInTheDocument();
  expect(requests.filter(r => r.action === 'post')).toEqual([{ action: 'post', company: 'national', id: row.id }]);
});
test('ambiguous submission failure freezes its payload and retries with the same ID', async () => {
  render(<ExpensesWorkspace />);
  fireEvent.change(await screen.findByLabelText('Merchant'), { target: { value: 'Airline' } });
  fireEvent.change(screen.getByLabelText('Who paid?'), { target: { value: 'business' } });
  fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '124.95' } });
  fireEvent.change(screen.getByLabelText('Expense date'), { target: { value: '2026-08-31' } });
  fireEvent.change(screen.getByLabelText('Business purpose'), { target: { value: 'Customer meeting' } });
  fireEvent.change(screen.getByLabelText('QuickBooks expense account'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Paid from account'), { target: { value: '2' } });
  submitFail = true;
  fireEvent.submit(screen.getByRole('button', { name: 'Submit expense' }).closest('form'));
  await screen.findByRole('button', { name: 'Retry same submission' });
  expect(screen.getByLabelText('Merchant')).toBeDisabled();
  fireEvent.submit(screen.getByRole('button', { name: 'Retry same submission' }).closest('form'));
  await screen.findByText(/Expense submitted. Review/);
  const submissions = requests.filter(r => r.action === 'submit');
  expect(submissions).toHaveLength(2); expect(submissions[0]).toEqual(submissions[1]);
  expect(screen.getByLabelText('Merchant')).toHaveValue('');
});
