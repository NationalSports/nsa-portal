import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('../ArtRequestProofs', () => () => null);
jest.mock('../lib/supabase', () => ({ supabase: null }));
jest.mock('../lib/supabaseCoach', () => ({ supabaseCoach: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } } }));
const mockPortalAction = jest.fn();
jest.mock('../utils', () => ({ ...jest.requireActual('../utils'), _portalAction: (...args) => mockPortalAction(...args) }));
const CoachPortal = require('../CoachPortal').default;

const customer = { id: 'team', name: 'CCAA Athletics', alpha_tag: 'test-team', contacts: [], school_colors: ['Navy', 'Red'] };
const sent = '2026-10-14T10:00:00Z';
function order(over = {}) {
  return { id: 'SO-1', customer_id: 'team', memo: 'Fall Gear', items: [
    { sku: 'PC78Q', name: 'Royal pullover', color: 'Royal', sizes: { S: 2, M: 3 }, decorations: [{ kind: 'art', art_file_id: 'A1', type: 'screen_print', position: 'Left Chest' }] },
    { sku: 'C821', name: 'Black cap', color: 'Black', sizes: { OSFA: 4 }, decorations: [{ kind: 'art', art_file_id: 'A2', type: 'embroidery', position: 'Front' }] },
    { sku: 'SF000', name: 'Grey crewneck', color: 'Grey', sizes: { L: 6 }, decorations: [{ kind: 'art', art_file_id: 'A3', type: 'screen_print', position: 'Back' }] },
  ], jobs: [
    { id: 'J1', art_name: 'Chest crest', art_file_id: 'A1', art_status: 'waiting_approval', sent_to_coach_at: sent, prod_status: 'hold', deco_type: 'screen_print', positions: 'Left Chest', items: [{ item_idx: 0, sku: 'PC78Q', color: 'Royal', sizes: { S: 2, M: 3 }, units: 5, deco_idxs: [0] }] },
    { id: 'J2', art_name: 'Cap crest', art_file_id: 'A2', art_status: 'waiting_approval', sent_to_coach_at: sent, prod_status: 'hold', deco_type: 'embroidery', positions: 'Front', items: [{ item_idx: 1, sku: 'C821', color: 'Black', sizes: { OSFA: 4 }, units: 4, deco_idxs: [0] }] },
    { id: 'J3', art_name: 'Back crest', art_file_id: 'A3', art_status: 'waiting_approval', sent_to_coach_at: null, prod_status: 'hold', deco_type: 'screen_print', positions: 'Back', items: [{ item_idx: 2, sku: 'SF000', color: 'Grey', sizes: { L: 6 }, units: 6, deco_idxs: [0] }] },
  ], art_files: [
    { id: 'A1', name: 'Chest crest', deco_type: 'screen_print', item_mockups: { 'PC78Q|Royal': ['https://example.com/pullover.png'] } },
    { id: 'A2', name: 'Cap crest', deco_type: 'embroidery', item_mockups: { 'C821|Black': ['https://example.com/cap.png'] } },
    { id: 'A3', name: 'Back crest', deco_type: 'screen_print', item_mockups: { 'SF000|Grey': ['https://example.com/internal-draft.png'] } },
  ], ...over };
}
function mount(initial = order(), extras = []) {
  function Harness() {
    const [orders, setOrders] = useState([initial, ...extras]);
    return <CoachPortal customer={customer} allCustomers={[customer]} sos={orders} ests={[]} invs={[]} REPS={[]} prod={[]}
      onUpdateSOs={setOrders} portalSettings={{}} />;
  }
  return render(<Harness />);
}
beforeEach(() => {
  window.history.replaceState({}, '', '/?portal=test-team&so=SO-1&job=J1');
  mockPortalAction.mockReset().mockResolvedValue({ ok: true });
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ stores: [], proofs: [] }) });
});
afterEach(() => jest.restoreAllMocks());

test('order strip changes design without a portal round-trip, retaining real mockups and size details', async () => {
  mount();
  const strip = await screen.findByRole('region', { name: 'Order proof collection' });
  expect(within(strip).getByRole('button', { name: /Grey crewneck/ })).toBeDisabled();
  expect(document.querySelector('img[src="https://example.com/internal-draft.png"]')).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: /Black cap/ }));
  expect(await screen.findByRole('heading', { name: /Cap crest/i })).toBeInTheDocument();
  expect(screen.getByText('Size Breakdown')).toBeInTheDocument();
  expect(screen.getByText('OSFA')).toBeInTheDocument();
  expect(mockPortalAction).not.toHaveBeenCalled();
});

test('approval commits only the current design and continues within the same order', async () => {
  mount(order(), [{ ...order(), id: 'SO-OTHER', memo: 'Other order' }]);
  fireEvent.click(await screen.findByRole('button', { name: /Approve This Proof.*Continue/ }));
  expect(await screen.findByRole('heading', { name: /Cap crest/i })).toBeInTheDocument();
  expect(mockPortalAction).toHaveBeenCalledTimes(1);
  const decision = mockPortalAction.mock.calls[0][0].artDecision;
  expect(decision).toMatchObject({ so_id: 'SO-1', job_id: 'J1', decision: 'approve', art_ids: ['A1'] });
  expect(decision.seen_mocks).toEqual(['https://example.com/pullover.png']);
  const strip = screen.getByRole('region', { name: 'Order proof collection' });
  expect(within(strip).getByRole('button', { name: /Royal pullover.*Approved/ })).toBeEnabled();
});

test('conflicts and thrown network failures keep the current proof pending', async () => {
  mockPortalAction.mockResolvedValueOnce({ ok: false, error: 'NSA_MOCKS_CHANGED' }).mockRejectedValueOnce(new Error('offline'));
  mount();
  const approve = await screen.findByRole('button', { name: /Approve This Proof.*Continue/ });
  fireEvent.click(approve);
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('NSA_MOCKS_CHANGED'));
  expect(screen.getByRole('heading', { name: /Chest crest/i })).toBeInTheDocument();
  await waitFor(() => expect(approve).toBeEnabled());
  fireEvent.click(approve);
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Could not save')));
  expect(screen.getByRole('heading', { name: /Chest crest/i })).toBeInTheDocument();
});

test('navigation and repeat decisions lock while an approval is committing', async () => {
  let finish;
  mockPortalAction.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount();
  const approve = await screen.findByRole('button', { name: /Approve This Proof.*Continue/ });
  fireEvent.click(approve);fireEvent.click(approve);
  expect(mockPortalAction).toHaveBeenCalledTimes(1);
  const strip = screen.getByRole('region', { name: 'Order proof collection' });
  within(strip).getAllByRole('button').forEach(button => expect(button).toBeDisabled());
  finish({ ok: true });
  expect(await screen.findByRole('heading', { name: /Cap crest/i })).toBeInTheDocument();
});

test('unsent feedback is not silently dropped when moving to another design', async () => {
  window.confirm.mockReturnValue(false);
  mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Note to your rep' }), { target: { value: 'Move the crest lower' } });
  fireEvent.click(within(screen.getByRole('region', { name: 'Order proof collection' })).getByRole('button', { name: /Black cap/ }));
  expect(window.confirm).toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Note to your rep' })).toHaveValue('Move the crest lower');
  expect(screen.getByRole('heading', { name: /Chest crest/i })).toBeInTheDocument();
});

test('a missing mock still blocks approval while a change request remains possible', async () => {
  const initial = order();initial.art_files[0].item_mockups = {};
  mount(initial);
  await screen.findByRole('region', { name: 'Order proof collection' });
  expect(screen.queryByRole('button', { name: /Approve This Proof/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Request Changes' })).toBeEnabled();
  expect(mockPortalAction).not.toHaveBeenCalled();
});


test('selecting a later garment in another design is not reset to that design’s first garment', async () => {
  const initial = order();
  initial.jobs[1].items.push({ ...initial.jobs[0].items[0] });
  mount(initial);
  const strip = await screen.findByRole('region', { name: 'Order proof collection' });
  fireEvent.click(within(strip).getByRole('button', { name: /Royal pullover.*Front/ }));
  await screen.findByRole('heading', { name: /Cap crest/i });
  await waitFor(() => expect(document.querySelector('.cp-proof-entry[aria-current="step"]')).toHaveTextContent('Royal pullover'));
  expect(screen.getByText('Size Breakdown')).toBeInTheDocument();
  expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
});

test('change requests preserve their server scope and do not silently advance the review', async () => {
  mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Note to your rep' }), { target: { value: 'Make the chest crest smaller' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request Changes' }));
  expect(await screen.findByText('Changes requested', { exact: true, selector: 'div' })).toBeInTheDocument();
  expect(mockPortalAction.mock.calls[0][0].artDecision).toMatchObject({
    so_id: 'SO-1', job_id: 'J1', decision: 'reject', art_ids: ['A1'], comment: 'Make the chest crest smaller',
  });
  expect(screen.getByRole('heading', { name: /Chest crest/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Review next design in this order/ })).toBeEnabled();
});
