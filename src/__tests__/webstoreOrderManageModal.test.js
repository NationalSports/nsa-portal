import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ data: [], order: async () => ({ data: [] }) }),
      }),
    }),
  },
}));

const { OrderManageModal } = require('../Webstores');

const baseOrder = {
  id: 'order-1', order_number: '1234', buyer_name: 'Test Buyer',
  buyer_email: 'buyer@example.com', payment_mode: 'paid', stripe_pi_id: 'pi_test',
  total: 30, original_total: 30, subtotal: 30, fundraise_amt: 0,
  shipping_fee: 0, processing_fee: 0, tax: 0, discount_amt: 0, refunded_amt: 0,
};

const baseItem = {
  id: 'item-1', product_id: 'product-1', sku: 'HI0704', name: 'Training Pant',
  size: 'XS', qty: 1, unit_price: 30, unit_fundraise: 0,
  cancelled_qty: 0, refunded_qty: 0, line_status: 'pending',
};

const renderModal = async (overrides = {}) => {
  let view;
  await act(async () => {
    view = render(
      <OrderManageModal
        order={{ ...baseOrder, ...(overrides.order || {}) }}
        items={[{ ...baseItem, ...(overrides.item || {}) }]}
        availSizes={{ 'product-1': ['XS', 'S'] }}
        nameByPid={{ 'product-1': 'Training Pant' }}
        storeName="Test Store"
        onSave={overrides.onSave || jest.fn(async () => ({
          ok: true,
          owed: 30,
          pending_items: [{ ...baseItem, item_id: 'item-1', qty: 1 }],
        }))}
        onRefund={jest.fn()}
        onClose={jest.fn()}
      />,
    );
  });
  return view;
};

test('an item reduction saves and goes directly to refund review without moving money', async () => {
  const onSave = jest.fn(async () => ({
    ok: true,
    owed: 30,
    pending_items: [{ ...baseItem, item_id: 'item-1', qty: 1 }],
  }));
  await renderModal({ onSave });

  fireEvent.click(screen.getByRole('button', { name: 'remove' }));
  const save = screen.getByRole('button', { name: 'Save & review refund' });
  expect(screen.getByText(/Nothing is refunded until you confirm/)).not.toBeNull();
  fireEvent.click(save);

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('button', { name: 'Send & refund $30.00' })).not.toBeNull();
});

test('a size-only change remains a one-step save and does not open refund review', async () => {
  const onSave = jest.fn(async () => ({ ok: true, owed: 0, pending_items: [] }));
  await renderModal({ onSave });

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'S' } });
  expect(screen.getByRole('button', { name: 'Save item changes' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save item changes' }));

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: /Send & refund/ })).toBeNull();
});
