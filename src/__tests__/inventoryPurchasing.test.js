/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryPurchasing from '../allSchool/InventoryPurchasing';
import { supabase } from '../lib/supabase';
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const stock = [{ id: 'logo', code: 'L', label: 'Serra Script', unit_cost: 3 }];
beforeEach(() => {
 jest.clearAllMocks();
 if (!global.crypto) global.crypto = {};
 Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'receipt-request') });
 const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockResolvedValue({ data: [] }) };
 supabase.from.mockReturnValue(query);
});
test('create stock PO with explicit artwork costs, preserving request ID across retry', async () => {
 supabase.rpc.mockResolvedValueOnce({ error: { message: 'Temporary network error' } }).mockResolvedValue({ data: {} });
 render(<InventoryPurchasing storeId="store" transfers={stock} />);
 fireEvent.click(screen.getByText('+ Create inventory PO'));
 fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Transfer vendor' } });
 fireEvent.change(screen.getByLabelText('Stock item'), { target: { value: 't:logo' } });
 fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '100' } });
 fireEvent.click(screen.getByText('Create draft PO'));
 await screen.findByText('Temporary network error');
 const first = supabase.rpc.mock.calls[0];
 expect(first[0]).toBe('create_store_inventory_po');
 expect(first[1].p_lines[0]).toMatchObject({ transfer_id: 'logo', qty: 100, unit_cost_cents: 300 });
 fireEvent.click(screen.getByText('Create draft PO'));
 await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
 expect(supabase.rpc.mock.calls[1][1].p_request_id).toBe(first[1].p_request_id);
 await screen.findByText(/Inventory PO created/);
});
test('invalid quantity is rejected before calling the database', async () => {
 render(<InventoryPurchasing storeId="store" transfers={stock} />);
 fireEvent.click(screen.getByText('+ Create inventory PO'));
 fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Transfer vendor' } });
 fireEvent.change(screen.getByLabelText('Stock item'), { target: { value: 't:logo' } });
 fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1.5' } });
 fireEvent.click(screen.getByText('Create draft PO'));
 await screen.findByRole('alert');
 expect(supabase.rpc).not.toHaveBeenCalled();
});
