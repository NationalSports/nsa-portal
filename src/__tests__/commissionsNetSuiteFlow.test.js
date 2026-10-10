import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommissionsPage from '../CommissionsPage';
import { DEFAULT_REPS } from '../constants';

const mockData = { current: null };
const mockRpc = jest.fn();
const mockSendBrevoEmail = jest.fn();

jest.mock('../AppContext', () => ({ useAppData: () => mockData.current }));
jest.mock('../components', () => ({ calcSOStatus: jest.fn(() => ({})) }));
jest.mock('../App', () => ({ dP: jest.fn(() => ''), rQ: jest.fn(() => 0), parseDate: jest.fn(() => null), _decoUnitCostComb: jest.fn(() => 0) }));
jest.mock('../utils', () => ({ sendBrevoEmail: (...args) => mockSendBrevoEmail(...args) }));
jest.mock('../lib/dbEngine', () => ({
  __esModule: true,
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'test' } } }) },
    from: (table) => {
      const query = {
        select: jest.fn(() => query),
        eq: jest.fn(() => query),
        in: jest.fn(() => query),
        limit: jest.fn(() => query),
        maybeSingle: jest.fn(() => Promise.resolve(table === 'app_state'
          ? { data: { value: JSON.stringify({ [mockData.current.REPS.find(r => r.name === 'Kevin McCormack').id]: {
            nsComm: { '2026-09': 4500 },
            nsInvoices: { 'NS-100': { id: 'NS-100', month: '2026-09', customer: 'West High', paidDate: '2026-09-18', daysToPay: 40, rate: 0.25, revenue: 553.72, cost: 0, gp: 553.72, marginPct: 100, commission: 165.86, items: [] } },
          } }), version: 7 }, error: null }
          : { data: null, error: null })),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return query;
    },
    rpc: (...args) => mockRpc(...args),
  },
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const adminId = '00000000-0000-0000-0000-000000000001';
const kevin = DEFAULT_REPS.find(r => r.name === 'Kevin McCormack');

function mountPage() {
  mockData.current = {
    REPS: DEFAULT_REPS,
    commMonth: '2026-09', commOverrides: {}, commRep: 'all', commTab: 'adminDash',
    cu: { id: adminId, name: 'Steve Peterson', role: 'admin' },
    cust: [], invs: [], sos: [],
    setCommMonth: jest.fn(), setCommOverrides: jest.fn(), setCommRep: jest.fn(), setCommTab: jest.fn(),
    setESO: jest.fn(), setESOC: jest.fn(), setESOTab: jest.fn(), setPg: jest.fn(), setSOs: jest.fn(),
  };
  return render(<CommissionsPage />);
}

async function openKevinPage() {
  await screen.findByText('Kevin McCormack');
  const cell = screen.getAllByText('Kevin McCormack').find(node => node.tagName === 'TD');
  fireEvent.click(cell.closest('tr'));
  await screen.findByText('NetSuite commission');
}

beforeEach(() => {
  mockRpc.mockReset();
  mockSendBrevoEmail.mockReset();
  mockRpc.mockImplementation(() => Promise.resolve({ data: 8, error: null }));
  mockSendBrevoEmail.mockResolvedValue({ ok: true });
  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
  window.URL.createObjectURL = jest.fn(() => 'blob:test');
  window.URL.revokeObjectURL = jest.fn();
});

describe('Commissions NetSuite payout actions', () => {
  test('Send & mark paid waits for the save and records Kevin’s September payout', async () => {
    const save = deferred();
    mockRpc.mockReturnValue(save.promise);
    mountPage();

    await openKevinPage();
    fireEvent.click(screen.getByRole('button', { name: /Send report & mark paid/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send & mark paid' }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('app_state_cas', expect.objectContaining({ p_key: 'comm_rep_comp', p_expected: 7 })));
    expect(screen.queryByText(/Marked paid/)).toBeNull();
    await act(async () => { save.resolve({ data: 8, error: null }); await save.promise; });

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Marked paid: Kevin McCormack $4,665.86')));
    const saved = JSON.parse(mockRpc.mock.calls[0][1].p_value);
    expect(saved[kevin.id].paid['2026-09'].amount).toBe(4665.86);
    expect(saved[kevin.id].paid['2026-09'].by).toBe('Steve Peterson');
    expect(screen.getByText(/Marked paid \$4,665\.86 on/)).toBeTruthy();
  });

  test('failed save never tells the user the payout was marked paid', async () => {
    const save = deferred();
    mockRpc.mockReturnValue(save.promise);
    mountPage();

    await openKevinPage();
    fireEvent.click(screen.getByRole('button', { name: /Send report & mark paid/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send & mark paid' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await act(async () => { save.resolve({ data: null, error: new Error('write denied') }); await save.promise; });

    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('payment was NOT recorded'));
    expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('Marked paid:'));
    expect(screen.queryByText(/Marked paid \$4,665\.86 on/)).toBeNull();
  });

  test('NetSuite-only payout can be exported and the emailed CSV filename includes Kevin', async () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mountPage();

    await openKevinPage();
    let downloaded;
    let exportedBlob;
    window.URL.createObjectURL = jest.fn(blob => { exportedBlob = blob; return 'blob:test'; });
    click.mockImplementation(function captureName() { downloaded = this.download; });
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(click).toHaveBeenCalled();
    expect(downloaded).toBe('commissions-2026-09-kevin-mccormack.csv');
    const exportedCsv = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exportedBlob);
    });
    expect(exportedCsv).toContain('NS-100');
    expect(exportedCsv).toContain('4665.86');
    fireEvent.click(screen.getByRole('button', { name: /Send report & mark paid/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send & mark paid' }));
    await waitFor(() => expect(mockSendBrevoEmail).toHaveBeenCalled());
    const attachment = mockSendBrevoEmail.mock.calls[0][0].attachment[0];
    expect(attachment.name).toBe('commissions-2026-09-kevin-mccormack.csv');
    const emailedCsv = decodeURIComponent(escape(atob(attachment.content)));
    expect(emailedCsv).toContain('NS-100');
    expect(emailedCsv).toContain('165.86');
    expect(emailedCsv).toContain('4665.86');
    click.mockRestore();
  });
});
