import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamStoreConversionModal from './TeamStoreConversionModal';

const item = { id: 'item', kind: 'single', active: true, product_id: 'blank', sku: 'TEE', image_url: 'mock.png', decorations: [] };
const props = {
  store: { id: 'store', org_type: 'team', status: 'closed' },
  catalog: [item],
  transfers: [],
  art: [],
  stockByWp: { item: { color: 'Royal', name: 'Team Tee' } },
  inventorySourceByProductId: { blank: 'sanmar' },
  orders: [],
  onClose: jest.fn(),
  onConfirm: jest.fn(async () => true),
};

test('shows the product review and requires typed confirmation before conversion', async () => {
  render(<TeamStoreConversionModal {...props} />);
  expect(screen.getByText('Team Tee')).toBeTruthy();
  expect(screen.getByText('Keep active')).toBeTruthy();
  const convert = screen.getByRole('button', { name: 'Convert store' });
  expect(convert.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Type CONVERT to confirm'), { target: { value: 'CONVERT' } });
  fireEvent.click(convert);
  await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ readyCount: 1 })));
});

test('explains that incompatible items are hidden instead of deleted', () => {
  render(<TeamStoreConversionModal {...props} catalog={[{ ...item, product_id: null }]} />);
  expect(screen.getByText('Hide')).toBeTruthy();
  expect(screen.getByText(/hidden, not deleted/i)).toBeTruthy();
});
