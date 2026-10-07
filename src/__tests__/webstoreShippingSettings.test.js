import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WebstoreShippingSettings from '../ui/WebstoreShippingSettings';
function Form({ initial = {} }) {
  const [store, setStore] = useState({ delivery_mode: 'ship_home', flat_shipping: 12, ...initial });
  return <><WebstoreShippingSettings store={store} onChange={patch => setStore(s => ({ ...s, ...patch }))} /><output data-testid="saved">{JSON.stringify(store)}</output></>;
}
const saved = () => JSON.parse(screen.getByTestId('saved').textContent);
test('store can configure tiers and a free threshold in cents, then change the tier basis', () => {
  render(<Form />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order_total' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tier' }));
  fireEvent.change(screen.getByLabelText('Tier 2 minimum'), { target: { value: '75' } });
  fireEvent.change(screen.getByLabelText('Tier 2 shipping'), { target: { value: '6.50' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Free shipping at or above ($)'), { target: { value: '150' } });
  expect(saved().shipping_settings).toMatchObject({ mode: 'order_total', free_over_cents: 15000, tiers: [{ from: 0, amount_cents: 1200 }, { from: 7500, amount_cents: 650 }] });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'item_count' } });
  expect(saved().shipping_settings.tiers).toEqual([{ from: 0, amount_cents: 1200 }]);
});
test('existing live UPS settings are displayed and preserved when changing the threshold', () => {
  render(<Form initial={{ all_school_settings: { shipping: { mode: 'ups_live', package_weight_oz: 3, length_in: 15, width_in: 11, height_in: 4, origin_code: 'OR', service_code: 'ups_ground' } } }} />);
  expect(screen.getByRole('combobox').value).toBe('ups_live');
  expect(screen.getByLabelText('Packaging weight (oz)').value).toBe('3');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(saved().shipping_settings).toMatchObject({ mode: 'ups_live', package_weight_oz: 3, length_in: 15, free_over_cents: 10000 });
});
