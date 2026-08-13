/* Editing the ship-to must not disturb the vendor SKU/partId resolution.
 *
 * Regression for the 2026-08-13 report (PO 57060 FPUSW / SO-1591): every line in
 * the S&S modal had a matched SKU, the rep edited the shipping address, and all
 * four lines flipped to "has no matched S&S SKU" and blocked submit. Two faults:
 *
 *  1. the line list was built through the payload builder WITH the ship-to, so it
 *     was memoized on the address object. Each keystroke made a new object → new
 *     lines → new `missing` → the resolve effect re-fired, one full round of
 *     vendor lookups per character typed;
 *  2. the resolvers report a failed API call as "no match" (they catch per-style
 *     errors and return an empty map), and the modals REPLACED the resolved map
 *     with that empty result — so one rate-limited re-run erased good matches.
 *
 * These assert the chain, not the builders: a pure-function test can't see a
 * useMemo dependency. Mock style follows floorStation.test.js. */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../vendorApis', () => ({
  ssResolveSkus: jest.fn(),
  ssSearchProducts: jest.fn(() => Promise.resolve([])),
  ssSubmitOrder: jest.fn(),
  ssGetWarehouseStock: jest.fn(() => Promise.resolve({})),
}));

const { ssResolveSkus, ssGetWarehouseStock } = require('../vendorApis');
const SSOrderModal = require('../SSOrderModal').default;

const SKU = 'B0012345';
const LINE_KEY = 'AT106|Team Navy Blue|S';

const batchOf = (items) => [{ so_id: 'SO-1591', items }];
const NAVY_S = { sku: 'AT106', color: 'Team Navy Blue', unit_cost: 10, sizes: { S: 4 } };
const NAVY_M = { sku: 'AT106', color: 'Team Navy Blue', unit_cost: 10, sizes: { M: 5 } };

const SHIP_TO = {
  companyName: 'Silver Screen',
  attentionTo: 'PO6712 // PO6713 FPUMS',
  address1: '1135 S Rock Blvd',
  city: 'Reno',
  region: 'NV',
  postalCode: '89502',
};

const renderModal = (batchPOs) => render(
  <SSOrderModal poNumber="PO 57060 FPUSW" batchPOs={batchPOs} shipTo={SHIP_TO} onClose={() => {}} />
);

beforeEach(() => {
  jest.clearAllMocks();
  ssGetWarehouseStock.mockResolvedValue({});
  ssResolveSkus.mockResolvedValue({ resolved: { [LINE_KEY]: SKU }, candidates: {} });
});

test('editing the ship-to does not re-run the SKU lookup, and the matched SKU survives', async () => {
  renderModal(batchOf([NAVY_S]));
  expect(await screen.findByText(SKU)).toBeTruthy();
  expect(ssResolveSkus).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByText('✏️ Edit address'));
  // One change event per character, the way typing a new street address arrives.
  const street = screen.getByDisplayValue('1135 S Rock Blvd');
  for (const value of ['1135 S Rock Blvd S', '1135 S Rock Blvd Su', '1135 S Rock Blvd Sui',
                       '1135 S Rock Blvd Suite', '1135 S Rock Blvd Suite #340']) {
    fireEvent.change(street, { target: { value } });
  }

  await waitFor(() => expect(screen.getByDisplayValue('1135 S Rock Blvd Suite #340')).toBeTruthy());
  // The address edit must not have touched the resolver — pre-fix this was 6 calls.
  expect(ssResolveSkus).toHaveBeenCalledTimes(1);
  expect(screen.getByText(SKU)).toBeTruthy();
  expect(screen.queryByText(/has no matched S&S SKU/)).toBeNull();
});

test('a degraded re-run that resolves nothing does not blank SKUs already matched', async () => {
  const { rerender } = renderModal(batchOf([NAVY_S]));
  expect(await screen.findByText(SKU)).toBeTruthy();

  // A legitimate re-resolve (the batch gained a line) that comes back empty — what a
  // rate-limited lookup looks like, since the resolver swallows API failures.
  ssResolveSkus.mockResolvedValue({ resolved: {}, candidates: {} });
  rerender(
    <SSOrderModal poNumber="PO 57060 FPUSW" batchPOs={batchOf([NAVY_S, NAVY_M])} shipTo={SHIP_TO} onClose={() => {}} />
  );

  await waitFor(() => expect(ssResolveSkus).toHaveBeenCalledTimes(2));
  // The already-matched line keeps its SKU; only the genuinely unmatched one is flagged.
  await waitFor(() => expect(screen.getByText(SKU)).toBeTruthy());
  expect(screen.getAllByText('🔍 find SKU')).toHaveLength(1);
});
