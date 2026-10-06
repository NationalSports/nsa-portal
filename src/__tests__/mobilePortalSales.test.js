/**
 * Phone sales flows: Today card, editing a saved estimate, mark approved →
 * create sales order, sheets drawing over detail pages (Send Estimate, pay link
 * QR), and vendor stock in the size picker.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';

const mockInserts = [];
jest.mock('../lib/supabase', () => {
  const q = (table) => { const o = { select: () => o, eq: () => o, neq: () => o, in: () => o, order: () => o, insert: (row) => { mockInserts.push([table, row]); return o; }, limit: () => Promise.resolve({ data: [], error: null }), then: (r) => Promise.resolve({ data: [], count: 0, error: null }).then(r) }; return o; };
  return { supabase: { from: q, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {}, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
jest.mock('../lib/webstorePublicData', () => ({ fetchPublicInventory: jest.fn() }));
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: async () => 'data:image/png;base64,QR' } }));
import MobilePortal from '../MobilePortal';
import { fetchPublicInventory } from '../lib/webstorePublicData';

// CRA resets mock implementations before every test.
beforeEach(() => {
  fetchPublicInventory.mockImplementation(async () => [
    { sku: 'NKDC1963', size: 'M', stock_qty: 120, source: 'nike', last_synced: '2026-10-05T10:00:00Z' },
    { sku: 'NKDC1963', size: 'L', stock_qty: 6, future_delivery_date: '2026-10-20', future_delivery_qty: 80, source: 'nike' },
  ]);
});
const pad = (n) => String(n).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const cust = [{ id: 'c1', name: 'Lincoln High School', alpha_tag: 'LHS', primary_rep_id: 'tm1', contacts: [{ name: 'Kim Patel', role: 'Billing', phone: '4085550101', email: 'kim@lhs.org' }] }];
const item = { sku: 'NKDC1963', name: 'Nike Dri-FIT Polo', color: 'Navy', unit_sell: 24, sizes: { M: 10, L: 20 }, available_sizes: ['M', 'L'], decorations: [{ kind: 'art', position: 'Left Chest' }] };
const baseProps = () => ({
  cu: { id: 'tm1', name: 'Steve Peterson', role: 'rep' }, cust, histInvs: [], msgs: [], prod: [], vend: [], REPS: [{ id: 'tm1', name: 'Steve Peterson' }],
  sos: [{ id: 'SO-1', customer_id: 'c1', status: 'in_production', expected_date: day(2), created_at: day(-10) + 'T10:00:00Z', items: [] }],
  ests: [
    { id: 'EST-1', customer_id: 'c1', status: 'sent', memo: 'Polos', total: 720, created_at: day(-9) + 'T10:00:00Z', updated_at: day(-8) + 'T10:00:00Z', items: [item], art_files: [{ id: 'a1' }], shipping_value: 7 },
    { id: 'EST-2', customer_id: 'c1', status: 'approved', memo: 'Hoodies', total: 1000, created_at: day(-3) + 'T10:00:00Z', items: [item] },
  ],
  invs: [{ id: 'INV-1', customer_id: 'c1', status: 'open', total: 500, paid: 100, created_at: day(-3) + 'T10:00:00Z' }],
  assignedTodos: [{ id: 't1', title: 'Call the AD', status: 'open', due_date: day(-1), assigned_to: 'tm1', customer_id: 'c1' }],
  computedTodos: [], dismissedTodos: [], onDismissTodo: () => {}, onLogout: () => {}, onSwitchDesktop: () => {},
  onSaveEstimate: jest.fn((e) => e), onSaveSO: (s) => s, onConvertEstimate: jest.fn(async () => {}), nextEstId: () => 'EST-9', nf: jest.fn(), onMsg: () => {}, canAccess: () => true,
});
const open = (props, mtab) => { window.history.pushState({}, '', '/?mtab=' + mtab); return render(<MobilePortal {...props} />); };

test('Today lists the overdue to-do, the order due this week, and a quote gone quiet', () => {
  open(baseProps(), 'home');
  expect(screen.getByText('Today')).toBeTruthy();
  expect(screen.getAllByText('Call the AD').length).toBeGreaterThan(0);
  expect(screen.getByText(/Overdue · was due/)).toBeTruthy();
  expect(screen.getByText(/SO-1 · LHS/)).toBeTruthy();
  expect(screen.getByText(/Follow up: EST-1/)).toBeTruthy();
});

test('editing a saved estimate saves the same estimate, keeping what the phone does not edit', () => {
  const props = baseProps();
  open(props, 'home');
  fireEvent.click(screen.getByText(/Follow up: EST-1/));
  fireEvent.click(screen.getByText('✏️ Edit'));
  expect(screen.getByText('Edit EST-1')).toBeTruthy();
  fireEvent.click(screen.getByText('Save'));
  const saved = props.onSaveEstimate.mock.calls[0][0];
  expect(saved).toMatchObject({ id: 'EST-1', status: 'sent', shipping_value: 7, art_files: [{ id: 'a1' }], memo: 'Polos' });
  expect(saved.items[0].decorations).toEqual(item.decorations);
});

test('an estimate still loading cannot be opened for editing', () => {
  const props = baseProps();
  props.ests[0]._decosHydrated = false;
  open(props, 'home');
  fireEvent.click(screen.getByText(/Follow up: EST-1/));
  fireEvent.click(screen.getByText('✏️ Edit'));
  expect(screen.queryByText('Edit EST-1')).toBeNull();
  expect(props.nf).toHaveBeenCalledWith(expect.stringMatching(/still loading/), 'error');
});

test('mark approved, then create the sales order with an in-hands date', async () => {
  const props = baseProps();
  window.confirm = () => true;
  open(props, 'home');
  fireEvent.click(screen.getByText(/Follow up: EST-1/));
  fireEvent.click(screen.getByText('✓ Mark approved'));
  expect(props.onSaveEstimate).toHaveBeenCalledWith(expect.objectContaining({ id: 'EST-1', status: 'approved' }));
  expect(screen.getByText('→ Create sales order')).toBeTruthy();
  fireEvent.click(screen.getByText('→ Create sales order'));
  const btn = screen.getByText('Create order');
  expect(btn.disabled).toBe(true);
  fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: day(14) } });
  fireEvent.click(screen.getByText('Create order'));
  await waitFor(() => expect(props.onConvertEstimate).toHaveBeenCalledWith(expect.objectContaining({ id: 'EST-1' }), day(14)));
});

test('Send Estimate opens its sheet over the estimate page', () => {
  open(baseProps(), 'home');
  fireEvent.click(screen.getByText(/Follow up: EST-1/));
  const before = document.body.textContent;
  fireEvent.click(screen.getAllByText(/Send Estimate/)[0]);
  expect(document.body.textContent.length).toBeGreaterThan(before.length);
  expect(screen.getAllByText(/EST-1/).length).toBeGreaterThan(1);
});

test('an order with no invoice has no Get paid button', () => {
  open(baseProps(), 'home');
  fireEvent.click(screen.getByText(/SO-1 · LHS/));
  expect(screen.queryByText(/Get paid/)).toBeNull();
});

test('Get paid: full balance link with a QR, a text to the billing contact, and full-screen QR', async () => {
  const props = baseProps();
  props.invs[0].so_id = 'SO-1';
  open(props, 'home');
  fireEvent.click(screen.getByText(/SO-1 · LHS/));
  fireEvent.click(screen.getByText(/Get paid · INV-1/));
  expect(screen.getByText('$400.00', { selector: 'div' })).toBeTruthy();
  const text = screen.getByText('Text link').closest('a').getAttribute('href');
  expect(text).toMatch(/^sms:4085550101\?&body=/);
  expect(decodeURIComponent(text)).toContain('pay $400.00 for invoice INV-1');
  expect(decodeURIComponent(text)).toContain('coach?portal=LHS&inv=INV-1');
  const qr = await waitFor(() => screen.getByAltText('QR code to pay invoice INV-1'));
  fireEvent.click(qr);
  expect(screen.getByText('Scan to pay $400.00')).toBeTruthy();
});

test('Get paid: a part payment creates a pay request for that amount and links to it', async () => {
  const props = baseProps();
  props.invs[0].so_id = 'SO-1';
  if (!window.crypto) Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  mockInserts.length = 0;
  open(props, 'home');
  fireEvent.click(screen.getByText(/SO-1 · LHS/));
  fireEvent.click(screen.getByText(/Get paid · INV-1/));
  fireEvent.click(screen.getByText('Part payment'));
  expect(screen.queryByAltText('QR code to pay invoice INV-1')).toBeNull();
  fireEvent.click(screen.getByText(/^50% ·/));
  expect(screen.getByDisplayValue('200.00')).toBeTruthy();
  fireEvent.change(screen.getByDisplayValue('200.00'), { target: { value: '150' } });
  fireEvent.click(screen.getByText('Create $150.00 pay link'));
  await waitFor(() => expect(mockInserts).toEqual([['invoice_pay_requests', expect.objectContaining({ invoice_id: 'INV-1', amount: 150, created_by: 'Steve Peterson' })]]));
  const token = mockInserts[0][1].id;
  const text = await waitFor(() => screen.getByText('Text link').closest('a').getAttribute('href'));
  expect(decodeURIComponent(text)).toContain('pay $150.00 toward invoice INV-1');
  expect(decodeURIComponent(text)).toContain('&payreq=' + token);
  expect(screen.getByText(/of \$400.00/)).toBeTruthy();
});

test('Get paid: more than the balance is refused and nothing is created', async () => {
  const props = baseProps();
  props.invs[0].so_id = 'SO-1';
  mockInserts.length = 0;
  open(props, 'home');
  fireEvent.click(screen.getByText(/SO-1 · LHS/));
  fireEvent.click(screen.getByText(/Get paid · INV-1/));
  fireEvent.click(screen.getByText('Part payment'));
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '450' } });
  fireEvent.click(screen.getByText('Create $450.00 pay link'));
  await waitFor(() => expect(props.nf).toHaveBeenCalledWith('That is more than the $400.00 open balance', 'error'));
  expect(mockInserts).toEqual([]);
});

test('size picker shows vendor stock and flags a size asking for more than the vendor has', async () => {
  const props = baseProps();
  open(props, 'home');
  fireEvent.click(screen.getByText(/Follow up: EST-1/));
  fireEvent.click(screen.getByText('✏️ Edit'));
  await waitFor(() => expect(fetchPublicInventory).toHaveBeenCalled());
  await waitFor(() => screen.getByText(/Vendor short on L/));
  fireEvent.click(screen.getByText('Nike Dri-FIT Polo'));
  expect(screen.getByText('120 in stock')).toBeTruthy();
  const l = screen.getByText('6 in stock');
  expect(l.style.color).toBe('rgb(220, 38, 38)');
  expect(within(l.parentElement).getByText(/\+80/)).toBeTruthy();
});
