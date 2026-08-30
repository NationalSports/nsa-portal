import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FinancialsPage from '../FinancialsPage';
import { AppDataProvider } from '../AppContext';

jest.mock('../lib/supabase', () => ({ supabase: null }));

describe('Financials stale-order collaboration', () => {
  test('an admin can chat with the rep and assign an order-linked TODO', () => {
    const setMsgs = jest.fn();
    const setAssignedTodos = jest.fn();
    const value = {
      cu: { id: 'A1', name: 'Andrea Accounting', role: 'admin' },
      REPS: [
        { id: 'A1', name: 'Andrea Accounting', role: 'admin', is_active: true },
        { id: 'R1', name: 'Rep One', role: 'rep', is_active: true },
      ],
      cust: [{ id: 'C1', name: 'Alpha Athletics', primary_rep_id: 'R1', payment_terms: 'net30', contacts: [] }],
      sos: [{
        id: 'SO-STALE', customer_id: 'C1', created_at: '2026-01-01', status: 'need_order', created_by: 'R1',
        items: [{ sku: 'TEE', unit_sell: 20, nsa_cost: 5, sizes: { M: 10 }, decorations: [] }], jobs: [],
      }],
      invs: [], histInvs: [], msgs: [], setMsgs, assignedTodos: [], setAssignedTodos,
      nf: jest.fn(), setESO: jest.fn(), setESOC: jest.fn(), setPg: jest.fn(), setSelC: jest.fn(), setInvF: jest.fn(),
    };

    render(<AppDataProvider value={value}><FinancialsPage /></AppDataProvider>);
    fireEvent.click(screen.getByText('Stale Orders'));
    expect(screen.getByText('SO-STALE')).toBeTruthy();
    fireEvent.click(screen.getByText('Chat / TODO'));

    fireEvent.change(screen.getByPlaceholderText(/Message Rep One about SO-STALE/), { target: { value: 'Please confirm whether this can be invoiced.' } });
    fireEvent.click(screen.getByText('Post message'));
    const messageUpdater = setMsgs.mock.calls[setMsgs.mock.calls.length - 1][0];
    expect(messageUpdater([])[0]).toMatchObject({ so_id: 'SO-STALE', entity_type: 'so', entity_id: 'SO-STALE', tagged_members: ['R1'] });

    fireEvent.change(screen.getByPlaceholderText('What needs to happen before invoicing?'), { target: { value: 'Verify final shipment status' } });
    fireEvent.click(screen.getByText('Assign TODO'));
    const todoUpdater = setAssignedTodos.mock.calls[0][0];
    expect(todoUpdater([])[0]).toMatchObject({ so_id: 'SO-STALE', customer_id: 'C1', assigned_to: 'R1', status: 'open' });
  });
});
