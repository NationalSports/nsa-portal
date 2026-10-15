/* CoachPortalApp — the public ?portal= entry that replaced booting the staff App. */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockLoad = jest.fn();
jest.mock('../lib/coachPortalData', () => ({ loadCoachPortal: (...a) => mockLoad(...a) }));
const mockPortalProps = [];
jest.mock('../CoachPortal', () => (props) => { mockPortalProps.push(props); return <div>portal for {props.customer.name}</div>; });

const CoachPortalApp = require('../CoachPortalApp').default;
const { NSA } = require('../constants');

const loaded = (over = {}) => ({
  status: 'ok', customer: { id: 'c-fb', name: 'Football' }, customers: [{ id: 'c-fb', name: 'Football' }],
  sos: [{ id: 'SO-1' }], ests: [{ id: 'EST-1' }], invs: [{ id: 'INV-1' }], reps: [{ id: 'r1', name: 'Rep' }], products: [],
  appState: { company_info: { name: 'NSA', phone: '714', addr: '1 St', city: 'Orange', state: 'CA', zip: '92865' } }, ...over,
});

beforeEach(() => { mockLoad.mockReset(); mockPortalProps.length = 0; });

test('shows the loading screen, then the portal with the team\'s data and no save function', async () => {
  mockLoad.mockResolvedValue(loaded());
  render(<CoachPortalApp alphaTag="fb" />);
  expect(screen.getByText('Loading portal...')).toBeInTheDocument();
  expect(await screen.findByText('portal for Football')).toBeInTheDocument();
  expect(mockLoad).toHaveBeenCalledWith('fb');
  const p = mockPortalProps[mockPortalProps.length - 1];
  expect(p.sos.map((s) => s.id)).toEqual(['SO-1']);
  expect(p.REPS.map((r) => r.id)).toEqual(['r1']);
  expect(p.savSOFn).toBeUndefined();
  expect(p.portalSettings.ccFeePct).toBe(0.029);
  expect(NSA.fullAddr).toBe('1 St, Orange, CA 92865');
});

test('the portal\'s own updates land in local state', async () => {
  mockLoad.mockResolvedValue(loaded());
  render(<CoachPortalApp alphaTag="fb" />);
  await screen.findByText('portal for Football');
  act(() => { mockPortalProps[mockPortalProps.length - 1].onUpdateSOs((prev) => prev.map((s) => ({ ...s, approved: true }))); });
  expect(mockPortalProps[mockPortalProps.length - 1].sos[0].approved).toBe(true);
});

test.each([
  ['not_found', 'Portal not found for'],
  ['ambiguous', 'This portal code matches more than one account.'],
])('%s tag shows the same message as before', async (status, text) => {
  mockLoad.mockResolvedValue({ status });
  render(<CoachPortalApp alphaTag="zz" />);
  expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
});

test('a failed load offers a retry that recovers', async () => {
  mockLoad.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(loaded());
  jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<CoachPortalApp alphaTag="fb" />);
  fireEvent.click(await screen.findByText('Try again'));
  expect(await screen.findByText('portal for Football')).toBeInTheDocument();
  console.error.mockRestore();
});

test('returning to the tab after a minute refreshes quietly; a failed refresh keeps the page', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  mockLoad.mockResolvedValueOnce(loaded()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(loaded({ sos: [{ id: 'SO-1' }, { id: 'SO-9' }] }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<CoachPortalApp alphaTag="fb" />);
  await screen.findByText('portal for Football');
  document.dispatchEvent(new Event('visibilitychange')); // under a minute: no reload
  expect(mockLoad).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1000000 + 61000);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(screen.getByText('portal for Football')).toBeInTheDocument();
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(mockPortalProps[mockPortalProps.length - 1].sos.map((s) => s.id)).toEqual(['SO-1', 'SO-9']));
  now.mockRestore(); console.error.mockRestore();
});
