import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AdidasClickAssignPanel from '../components/AdidasClickAssignPanel';

const payload = {
  target: 'adidas_click',
  po_number: 'PO-60852',
  lines: [{ sku: 'IS1111', sizes: { S: 5 } }],
};

const rows = [
  { sku: 'IS1111', size: 'S 5"', stock_qty: 10, future_delivery_date: null, future_delivery_qty: null, last_synced: '2026-10-16T00:00:00Z' },
  { sku: 'IS1111', size: 'S 7"', stock_qty: 3, future_delivery_date: '2026-10-24', future_delivery_qty: 8, last_synced: '2026-10-16T00:00:00Z' },
];

test('shows the four timing choices, stale age, exact CLICK sizes, and saves a variant', () => {
  const onChange = jest.fn();
  const onSavePreference = jest.fn();
  render(<AdidasClickAssignPanel
    payload={payload}
    inventoryRows={rows}
    savedPreferences={{}}
    value={{}}
    onChange={onChange}
    onSavePreference={onSavePreference}
  />);

  expect(screen.getAllByText('Available now only').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Complete SKU').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Each size when ready').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Hold & re-check').length).toBeGreaterThan(0);
  expect(screen.getByText(/Inventory .*h old/)).toBeTruthy();
  expect(screen.getByText(/S:5 → choose variant/)).toBeTruthy();

  fireEvent.change(screen.getByDisplayValue('Choose variant…'), { target: { value: '7' } });
  expect(onSavePreference).toHaveBeenCalledWith('IS1111', '7');
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    preferences: { IS1111: '7' },
  }));
});

test('renders duplicate source lines as one per-SKU decision', () => {
  render(<AdidasClickAssignPanel
    payload={{ ...payload, lines: [{ sku: 'IS1111', sizes: { S: 2 } }, { sku: 'IS1111', sizes: { S: 3 } }] }}
    inventoryRows={rows}
    savedPreferences={{ IS1111: '7' }}
    value={{}}
    onChange={() => {}}
  />);

  expect(screen.getAllByText('IS1111')).toHaveLength(1);
  expect(screen.getByText(/S:5 → S 7"/)).toBeTruthy();
});
