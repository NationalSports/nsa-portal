/* S&S ship-from warehouse (2026-09-29, NSA 4684): 1717 Black showed 📦 KS for an Orange, CA
 * ship-to although Reno had every size in stock. The chip trusted S&S's `closest` flag, which
 * is relative to the ACCOUNT's default address, and orders went out without S&S's "fastest"
 * freight preference. These pin the fixes: rank by S&S's own days-in-transit to the ship-to
 * ZIP, send the preference, and record the warehouse S&S actually assigned. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { buildSSOrderPayload } from '../ssOrder';

jest.mock('../vendorApis', () => ({
  ssResolveSkus: jest.fn(),
  ssSearchProducts: jest.fn(() => Promise.resolve([])),
  ssSubmitOrder: jest.fn(),
  ssGetWarehouseStock: jest.fn(),
  ssGetDaysInTransit: jest.fn(),
}));
const { ssResolveSkus, ssGetWarehouseStock, ssGetDaysInTransit, ssSubmitOrder } = require('../vendorApis');
const SSOrderModal = require('../SSOrderModal').default;

const SKU = 'B00708503';
const LINE_KEY = '1717|Black|S';
const BATCH = [{ so_id: 'SO-2714', items: [{ sku: '1717', color: 'Black', unit_cost: 6.55, sizes: { S: 26 } }] }];
const SHIP_TO = { companyName: 'National Sports Apparel', address1: '210 E Emerson Ave', city: 'Orange', region: 'CA', postalCode: '92865' };

beforeEach(() => {
  jest.clearAllMocks();
  ssResolveSkus.mockResolvedValue({ resolved: { [LINE_KEY]: SKU }, candidates: {} });
  // KS carries S&S's account-relative `closest` flag; NV (Reno) has plenty and is 1 day away.
  ssGetWarehouseStock.mockResolvedValue({ [SKU]: [
    { abbr: 'KS', qty: 18947, closest: true },
    { abbr: 'NV', qty: 25000, closest: false },
  ] });
});

const renderModal = (props = {}) => render(<SSOrderModal poNumber="NSA 4684" batchPOs={BATCH} shipTo={SHIP_TO} onClose={() => {}} {...props} />);

test('orders ask S&S for its "fastest" warehouse selection', () => {
  const { order } = buildSSOrderPayload({ poNumber: 'P', lineItems: [{ sku: SKU, quantity: 1 }], shipTo: SHIP_TO });
  expect(order.autoselectWarehouse).toBe(true);
  expect(order.AutoSelectWarehouse_Preference).toBe('fastest');
  const manual = buildSSOrderPayload({ poNumber: 'P', lineItems: [{ sku: SKU, quantity: 1 }], shipTo: SHIP_TO, autoselectWarehouse: false }).order;
  expect(manual.AutoSelectWarehouse_Preference).toBeUndefined();
});

test('expected ship-from uses S&S transit days to the ship-to ZIP, not the account "closest" flag', async () => {
  ssGetDaysInTransit.mockResolvedValue({ NV: 1, KS: 3 });
  renderModal();
  await waitFor(() => expect(screen.getByText(/📦 NV/)).toBeTruthy());
  expect(screen.queryByText(/📦 KS/)).toBeNull();
  expect(ssGetDaysInTransit).toHaveBeenCalledWith('92865');
});

test('falls back to the closest flag when the transit lookup returns nothing', async () => {
  ssGetDaysInTransit.mockResolvedValue({});
  renderModal();
  await waitFor(() => expect(screen.getByText(/📦 KS/)).toBeTruthy());
});

test('the warehouse S&S actually assigned is shown and passed to the PO record', async () => {
  ssGetDaysInTransit.mockResolvedValue({ NV: 1, KS: 3 });
  ssSubmitOrder.mockResolvedValue({ orderNumber: '555', raw: [], lineErrors: [], shipments: [{ orderNumber: '555', warehouseAbbr: 'NV', skus: [SKU] }] });
  const onSubmitted = jest.fn().mockResolvedValue(true);
  renderModal({ onSubmitted });
  await waitFor(() => expect(screen.getByText(/📦 NV/)).toBeTruthy());
  fireEvent.click(screen.getByRole('checkbox', { name: /real order/i }));
  fireEvent.click(screen.getByText(/Place Order with S&S/));
  await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  const [, apiLines] = onSubmitted.mock.calls[0];
  expect(apiLines[0]).toMatchObject({ sku: SKU, warehouse: 'NV', warehouse_basis: 'vendor' });
  expect(await screen.findByText(/Shipping from \(per S&S\)/)).toBeTruthy();
  expect(screen.getByText(/Reno, NV \(1-day transit\)/)).toBeTruthy();
});

test('a line S&S splits across two warehouses records both', async () => {
  ssGetDaysInTransit.mockResolvedValue({ NV: 1, KS: 3 });
  ssSubmitOrder.mockResolvedValue({ orderNumber: '1', raw: [], lineErrors: [], shipments: [
    { orderNumber: '1', warehouseAbbr: 'NV', skus: [SKU] },
    { orderNumber: '2', warehouseAbbr: 'KS', skus: [SKU] },
  ] });
  const onSubmitted = jest.fn().mockResolvedValue(true);
  renderModal({ onSubmitted });
  await waitFor(() => expect(screen.getByText(/📦 NV/)).toBeTruthy());
  fireEvent.click(screen.getByRole('checkbox', { name: /real order/i }));
  fireEvent.click(screen.getByText(/Place Order with S&S/));
  await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  expect(onSubmitted.mock.calls[0][1][0].warehouse).toBe('NV+KS');
  expect(await screen.findByText(/split this PO into 2 orders/)).toBeTruthy();
});
