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

describe('decorator address picker', () => {
  const { decoShipToPresets } = require('../lib/botTasks');

  const DECOS = [
    { id: 'd1', name: 'Silver Screen', address_line1: '1717 S Chestnut Ave.', address_line2: 'Suite 4', city: 'Fresno', state: 'CA', zip: '93702' },
    { id: 'd2', name: 'Linked Deco', vendor_id: 'v9' },              // address lives on the vendor record
    { id: 'd3', name: 'Addressless', vendor_id: 'v-none' },          // nothing usable → not offered
    { id: 'd4', name: 'Retired Deco', address_line1: '9 Old Rd', city: 'Reno', state: 'NV', zip: '89502', is_active: false },
  ];
  const VENDORS = [{ id: 'v9', name: 'Vendor Nine', address_line1: '55 Vendor Way', city: 'Clovis', state: 'CA', zip: '93611' }];
  const presets = () => decoShipToPresets({ decoVendors: DECOS, vendors: VENDORS });

  test('offers active decorators that have an address, falling back to the linked vendor record', () => {
    expect(presets().map(p => p.id)).toEqual(['d1', 'd2']);
    expect(presets()[0].address).toMatchObject({
      companyName: 'Silver Screen', address1: '1717 S Chestnut Ave.', address2: 'Suite 4',
      city: 'Fresno', region: 'CA', postalCode: '93702',
    });
    // d2 keeps the decorator's name but takes the vendor record's address.
    expect(presets()[1].address).toMatchObject({ companyName: 'Linked Deco', address1: '55 Vendor Way', city: 'Clovis' });
  });

  test('picking one fills the address, keeps the attention line, and does not re-run the lookup', async () => {
    render(
      <SSOrderModal poNumber="PO 57060 FPUSW" batchPOs={batchOf([NAVY_S])} shipTo={SHIP_TO}
        shipPresets={presets()} onClose={() => {}} />
    );
    expect(await screen.findByText(SKU)).toBeTruthy();
    expect(ssResolveSkus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('✏️ Edit address'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'd1' } });

    await waitFor(() => expect(screen.getByDisplayValue('1717 S Chestnut Ave.')).toBeTruthy());
    expect(screen.getByDisplayValue('Silver Screen')).toBeTruthy();
    expect(screen.getByDisplayValue('Suite 4')).toBeTruthy();
    expect(screen.getByDisplayValue('Fresno')).toBeTruthy();
    expect(screen.getByDisplayValue('93702')).toBeTruthy();
    // The caller's attention line (a PO reference) must survive the fill.
    expect(screen.getByDisplayValue('PO6712 // PO6713 FPUMS')).toBeTruthy();
    expect(ssResolveSkus).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SKU)).toBeTruthy();
  });

  test('no picker when there are no decorator addresses to offer', async () => {
    render(<SSOrderModal poNumber="PO 57060 FPUSW" batchPOs={batchOf([NAVY_S])} shipTo={SHIP_TO} onClose={() => {}} />);
    expect(await screen.findByText(SKU)).toBeTruthy();
    fireEvent.click(screen.getByText('✏️ Edit address'));
    expect(screen.queryByRole('combobox')).toBeNull();
  });
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
