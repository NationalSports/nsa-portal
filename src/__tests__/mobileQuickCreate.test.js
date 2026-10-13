/**
 * The phone's "+" menu: estimate, note (AI or typed), reminder, invoice link — and the
 * notifications sign-in fix (a lapsed token is refreshed; no token says how to fix it).
 */
import React from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';

jest.mock('../lib/supabase', () => {
  const q = () => { const o = { select: () => o, eq: () => o, neq: () => o, in: () => o, order: () => o, insert: () => o, limit: () => Promise.resolve({ data: [], error: null }), then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return o; };
  return { supabase: { from: q, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {}, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
jest.mock('../lib/webstorePublicData', () => ({ fetchPublicInventory: jest.fn(async () => []) }));
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: async () => 'data:image/png;base64,QR' } }));
import MobileQuickCreate, { localYmd } from '../MobileQuickCreate';
import MobilePortal from '../MobilePortal';
import { callPush, NO_SESSION } from '../lib/pushClient';

const cust = [
  { id: 'c1', name: 'Lincoln High School', alpha_tag: 'LHS', primary_rep_id: 'tm1', notes: 'Old note', contacts: [{ name: 'Kim', role: 'Billing', phone: '4085550101' }] },
  { id: 'c1b', name: 'Lincoln Baseball', alpha_tag: 'LHSB', parent_id: 'c1', primary_rep_id: 'tm1' },
  { id: 'c2', name: 'Mater Dei', alpha_tag: 'MD', primary_rep_id: 'tm9' },
];
const sos = [
  { id: 'SO-1', customer_id: 'c1', status: 'in_production', memo: 'Warmups', created_at: '2026-10-01' },
  { id: 'SO-2', customer_id: 'c1b', status: 'in_production', memo: 'Caps', created_at: '2026-10-02' },
];
const invs = [
  { id: 'INV-1', customer_id: 'c1', so_id: 'SO-1', status: 'open', total: 500, paid: 100, created_at: '2026-10-03' },
  { id: 'INV-2', customer_id: 'c1', status: 'paid', total: 300, paid: 300, created_at: '2026-10-01' },
  { id: 'INV-OLD', customer_id: 'c1', status: 'open', total: 90, paid: 0, _hist: true },
];
const setup = (extra = {}) => {
  const props = { open: true, onClose: jest.fn(), cu: { id: 'tm1', name: 'Steve Peterson' }, cust, sos, invs, canNotes: true, nf: jest.fn(),
    onNewEstimate: jest.fn(), onOpenNotes: jest.fn(), onAddTodo: jest.fn(), onSaveCustomer: jest.fn(async () => {}), onOpenPayLink: jest.fn(), ...extra };
  render(<MobileQuickCreate {...props} />);
  return props;
};

test('the menu offers four things to create; Estimate opens the estimate builder', () => {
  const p = setup();
  ['Estimate', 'Note', 'Reminder', 'Invoice link'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
  fireEvent.click(screen.getByText('Estimate'));
  expect(p.onClose).toHaveBeenCalled();
  expect(p.onNewEstimate).toHaveBeenCalled();
});

test('Note: AI capture modes hand off to AI Notes; a typed note is stamped onto the account', async () => {
  const p = setup();
  fireEvent.click(screen.getByText('Note'));
  fireEvent.click(screen.getByText('Record meeting'));
  expect(p.onOpenNotes).toHaveBeenCalledWith({ mode: 'recorded' });
  expect(p.onClose).toHaveBeenCalled();

  // (the parent closes the menu for real; here it stays on the note choice)
  fireEvent.click(screen.getByText('Quick note'));
  expect(screen.getByText('Save note').disabled).toBe(true);
  fireEvent.click(screen.getByText('Lincoln High School'));// a suggested account (mine)
  fireEvent.change(screen.getByPlaceholderText(/AD wants/), { target: { value: 'Budget approved in January' } });
  fireEvent.click(screen.getByText('Save note'));
  await new Promise((r) => setTimeout(r, 0));
  const saved = p.onSaveCustomer.mock.calls[0][0];
  expect(saved.id).toBe('c1');
  expect(saved.notes).toMatch(/^Old note\n.* — Budget approved in January \(Steve Peterson\)$/);
});

test('Reminder: becomes my own to-do with a local date, account, order and priority', () => {
  const p = setup();
  fireEvent.click(screen.getByText('Reminder'));
  fireEvent.change(screen.getByPlaceholderText('What do you need to do?'), { target: { value: 'Call about spring order' } });
  fireEvent.click(screen.getByText('Today'));
  fireEvent.click(screen.getByText('Lincoln High School'));
  fireEvent.click(screen.getByText(/SO-2 · Caps/));// a sub-team's order is offered under the school
  fireEvent.click(screen.getByText('High priority'));
  fireEvent.click(screen.getByText('Save reminder'));
  const t = p.onAddTodo.mock.calls[0][0];
  expect(t).toMatchObject({ title: 'Call about spring order', due_date: localYmd(), assigned_to: 'tm1', created_by: 'tm1', customer_id: 'c1', so_id: 'SO-2', priority: 1, status: 'open' });
});

test('Invoice link: accounts with money due come first; only open, payable invoices are listed', () => {
  const p = setup();
  fireEvent.click(screen.getByText('Invoice link'));
  expect(screen.getByText('$400.00 due · 1 invoice')).toBeTruthy();// INV-1 only: paid and imported history are skipped
  fireEvent.click(screen.getByText('Lincoln High School'));
  expect(screen.queryByText('INV-2')).toBeNull();
  expect(screen.queryByText('INV-OLD')).toBeNull();
  fireEvent.click(screen.getByText('Sales orders'));
  expect(screen.getByText(/No invoice yet/)).toBeTruthy();// SO-2 has no invoice to pay
  fireEvent.click(screen.getByText('SO-1'));
  expect(p.onOpenPayLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'INV-1' }));
});

test('the + button in the phone app opens the menu, and an invoice opens the Get paid sheet', async () => {
  render(<MobilePortal cu={{ id: 'tm1', name: 'Steve Peterson', role: 'rep' }} cust={cust} sos={sos} ests={[]} invs={invs} histInvs={[]} msgs={[]} prod={[]} vend={[]} REPS={[{ id: 'tm1', name: 'Steve Peterson' }]}
    assignedTodos={[]} computedTodos={[]} dismissedTodos={[]} onDismissTodo={() => {}} onLogout={() => {}} onSwitchDesktop={() => {}} onSaveEstimate={(e) => e} onSaveSO={(s) => s}
    nextEstId={() => 'EST-9'} nf={jest.fn()} onMsg={() => {}} canAccess={() => true} onAddTodo={jest.fn()} onSaveCustomer={jest.fn()} />);
  fireEvent.click(screen.getByLabelText('Create new'));
  const menu = screen.getByRole('dialog', { name: 'Create new' });
  fireEvent.click(within(menu).getByText('Invoice link'));
  fireEvent.click(screen.getByText('Lincoln High School'));
  fireEvent.click(screen.getByText('INV-1'));
  expect(await screen.findByText('Part payment')).toBeTruthy();
});

test('phone home opens on the KPI banner: money owed, open quotes, active orders', () => {
  render(<MobilePortal cu={{ id: 'tm1', name: 'Steve Peterson', role: 'rep' }} cust={cust} sos={sos} invs={invs} histInvs={[]} msgs={[]} prod={[]} vend={[]} REPS={[{ id: 'tm1', name: 'Steve Peterson' }]}
    ests={[{ id: 'EST-1', customer_id: 'c1', status: 'sent', items: [] }, { id: 'EST-2', customer_id: 'c1', status: 'converted', items: [] }]}
    assignedTodos={[]} computedTodos={[]} dismissedTodos={[]} onDismissTodo={() => {}} onLogout={() => {}} onSwitchDesktop={() => {}} onSaveEstimate={(e) => e} onSaveSO={(s) => s}
    nextEstId={() => 'EST-9'} nf={jest.fn()} onMsg={() => {}} canAccess={() => true} />);
  const hero = screen.getByLabelText('Your numbers');
  const tile = (label) => within(hero).getByText(label).closest('button');
  expect(within(tile('Owed to us')).getByText('$400')).toBeTruthy();// INV-1 only (paid + imported history skipped)
  expect(within(tile('Owed to us')).getByText('1 open invoice')).toBeTruthy();
  expect(within(tile('Open quotes')).getByText('1')).toBeTruthy();// sent counts, converted doesn't
  expect(within(tile('Active orders')).getByText('2')).toBeTruthy();
  expect(screen.getByText(/You’re all caught up/)).toBeTruthy();
});

describe('notifications sign-in', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const client = (session, refreshed) => ({ auth: {
    getSession: jest.fn(async () => ({ data: { session } })),
    refreshSession: jest.fn(async () => (refreshed ? { data: { session: refreshed } } : { data: { session: null }, error: { message: 'Auth session missing' } })),
  } });

  test('no token at all (admin picker sign-in) says how to fix it', async () => {
    global.fetch = jest.fn();
    await expect(callPush(client(null, null), { action: 'config' })).rejects.toMatchObject({ code: NO_SESSION, message: expect.stringMatching(/password sign-in/) });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a lapsed token is refreshed before calling; a 401 retries once with a fresh one', async () => {
    const old = { access_token: 'old', expires_at: Math.floor(Date.now() / 1000) - 5 };
    const sb = client(old, { access_token: 'new', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ publicKey: 'k' }) }));
    expect(await callPush(sb, { action: 'config' })).toEqual({ publicKey: 'k' });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer new');

    const live = { access_token: 'live', expires_at: Math.floor(Date.now() / 1000) + 3600 };
    const sb2 = client(live, { access_token: 'fresh', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Invalid token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    expect(await callPush(sb2, { action: 'test' })).toEqual({ ok: true });
    expect(global.fetch.mock.calls.map((c) => c[1].headers.Authorization)).toEqual(['Bearer live', 'Bearer fresh']);
  });
});
