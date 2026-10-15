import React from 'react';
import { render, screen } from '@testing-library/react';
import OrderTrack from '../storefront/OrderTrack';
jest.mock('../lib/supabase', () => ({ supabase: {} }));
const oldFetch = global.fetch;
afterEach(() => { global.fetch = oldFetch; });
test('public order link renders estimates for standalone items and bundle components', async () => {
  window.history.replaceState({}, '', '/shop/order/private-token');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    store: { name: '24/7 School Store' }, order: { id: 'o1', total: 0 },
    items: [
      { id: 'a', name: 'Tee', qty: 1, line_status: 'pending' },
      { id: 'b', name: 'Pack', is_bundle_parent: true, bundle_ref: 'pack', bundle_product_id: 'pack' },
      { id: 'c', name: 'Hoodie', bundle_ref: 'pack', bundle_product_id: 'pack', line_status: 'pending' },
    ],
    item_estimates: {
      a: { state: 'estimated', message: 'Stock pull: allow 3 business days', ready_date: '2026-10-14', ship_date: '2026-10-20', production_days: 4 },
      c: { state: 'delayed', message: 'Timing update needed; ship estimate pending', ready_date: '2026-10-01', ship_date: null, production_days: 4 },
    },
  }) });
  render(<OrderTrack />);
  expect(await screen.findByText('Estimated to ship: Oct 20, 2026')).toBeTruthy();
  expect(screen.getByText('Estimated stock ready: Oct 14, 2026')).toBeTruthy();
  expect(screen.getByText('Timing update needed; ship estimate pending')).toBeTruthy();
  expect(screen.queryByText(/Oct 1, 2026/)).toBeNull();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ action: 'track_order', token: 'private-token' });
});
