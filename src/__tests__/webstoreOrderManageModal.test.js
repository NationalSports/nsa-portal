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

test('a fully refunded order is read-only and cannot restore its items', async () => {
  const onSave = jest.fn();
  await renderModal({ order: { refunded_amt: 30, status: 'refunded' }, onSave });

  expect(screen.getByText('Fully refunded — item history is locked.')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'refunded' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Save item changes' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Full ($0.00)' }).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});

test('a paid order cannot add an uncharged unit', async () => {
  const onSave = jest.fn();
  await renderModal({ onSave });

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Training Pant' }), { target: { value: '2' } });

  expect(screen.getByRole('alert').textContent).toMatch(/does not collect the additional card payment/i);
  expect(screen.getByRole('button', { name: 'Save item changes' }).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});

test('a team-tab order may increase quantity because no settled card amount is bypassed', async () => {
  const onSave = jest.fn(async () => ({ ok: true, owed: 0, pending_items: [] }));
  await renderModal({ order: { payment_mode: 'unpaid', stripe_pi_id: null }, onSave });

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Training Pant' }), { target: { value: '2' } });
  const save = screen.getByRole('button', { name: 'Save item changes' });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
});

describe('a cancel that was never refunded stays in front of the rep', () => {
  const cancelledLeftOwed = {
    order: { total: 0, original_total: 30, refunded_amt: 0 },
    item: { qty: 0, cancelled_qty: 1, refunded_qty: 0, line_status: 'cancelled' },
  };

  test('reopening the order shows the amount owed and a one-click refund', async () => {
    await renderModal(cancelledLeftOwed);
    expect(screen.getByText('Refund owed: $30.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refund $30.00 now' }));
    expect(screen.getByRole('button', { name: /Send & refund \$30\.00/ })).toBeTruthy();
    // Dismissing the review keeps the flag up rather than dropping the money owed.
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByText('Refund owed: $30.00')).toBeTruthy();
  });

  test('closing with money owed asks first, and staying keeps the modal open', async () => {
    const onClose = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      render(<OrderManageModal order={{ ...baseOrder, ...cancelledLeftOwed.order }} items={[{ ...baseItem, ...cancelledLeftOwed.item }]}
        availSizes={{}} nameByPid={{}} storeName="Test Store" onSave={jest.fn()} onRefund={jest.fn()} onClose={onClose} />);
    });
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('$30.00 is still owed back to Test Buyer'));
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(onClose).toHaveBeenCalled();
    confirm.mockRestore();
  });

  test('a fully settled order closes without asking', async () => {
    const onClose = jest.fn();
    const confirm = jest.spyOn(window, 'confirm');
    await act(async () => {
      render(<OrderManageModal order={baseOrder} items={[baseItem]} availSizes={{}} nameByPid={{}} storeName="Test Store" onSave={jest.fn()} onRefund={jest.fn()} onClose={onClose} />);
    });
    expect(screen.queryByText(/Refund owed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe('refunding shipping', () => {
  const shippedOrder = { ...baseOrder, total: 42, original_total: 42, shipping_fee: 12, subtotal: 30 };

  test('takes shipping off the order, then opens the refund review with the shipping amount', async () => {
    const onRemoveShipping = jest.fn(async () => ({ ok: true, owed: 12 }));
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      render(<OrderManageModal order={shippedOrder} items={[baseItem]} availSizes={{}} nameByPid={{}} storeName="Test Store"
        onSave={jest.fn()} onRefund={jest.fn()} onRemoveShipping={onRemoveShipping} onClose={jest.fn()} />);
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refund shipping ($12.00)' })); });
    expect(onRemoveShipping).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-1' }));
    expect(screen.getByRole('button', { name: /Send & refund \$12\.00/ })).toBeTruthy();
    expect(screen.getByDisplayValue(/refunded the \$12\.00 shipping charge/)).toBeTruthy();
    confirm.mockRestore();
  });

  test('backing out of the confirm changes nothing', async () => {
    const onRemoveShipping = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      render(<OrderManageModal order={shippedOrder} items={[baseItem]} availSizes={{}} nameByPid={{}} storeName="Test Store"
        onSave={jest.fn()} onRefund={jest.fn()} onRemoveShipping={onRemoveShipping} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refund shipping ($12.00)' }));
    expect(onRemoveShipping).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  test('no shipping button without a card charge or without shipping', async () => {
    await act(async () => {
      render(<OrderManageModal order={{ ...shippedOrder, stripe_pi_id: null, payment_mode: 'unpaid' }} items={[baseItem]} availSizes={{}} nameByPid={{}}
        onSave={jest.fn()} onRefund={jest.fn()} onRemoveShipping={jest.fn()} onClose={jest.fn()} />);
    });
    expect(screen.queryByRole('button', { name: /Refund shipping/ })).toBeNull();
  });
});
