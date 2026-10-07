import React from 'react';
import { render, screen } from '@testing-library/react';
import StorePickerPrice, { suggestedStorePrice } from '../ui/StorePickerPrice';
test('picker distinguishes account cost and saved store price instead of showing retail', () => {
  render(<StorePickerPrice product={{ nsa_cost: 35.87, retail_price: 53.81 }} storeItem={{ retail_price: 82 }} />);
  expect(screen.getByText('Garment cost $35.87')).toBeTruthy();
  expect(screen.getByText('Store price $82.00')).toBeTruthy();
  expect(screen.queryByText(/53.81/)).toBeNull();
});
test('new product suggests the same cost-plus-decoration margin used when adding', () => {
  render(<StorePickerPrice product={{ nsa_cost: 35.87, retail_price: 53.81 }} decorationCost={5} />);
  expect(screen.getByText('Suggested price $75.00')).toBeTruthy();
  expect(suggestedStorePrice(35.87, 5)).toBe(75);
});
test('unknown cost is explicit and does not disguise retail as cost', () => {
  render(<StorePickerPrice product={{ nsa_cost: 0, retail_price: 53.81 }} />);
  expect(screen.getByText('Cost unavailable')).toBeTruthy();
  expect(screen.queryByText(/53.81/)).toBeNull();
});
