/** @jest-environment node */

/* Ship-from locations (src/lib/shipFrom.js) — the origin address printed on a
 * shipping label. Labels used to always print the company address even when the
 * parcel left the Emerson warehouse; staff can now pick the origin per run.
 *
 * What these pin:
 *   - the default stays the company address, so existing stores and any row with
 *     no code saved keep the exact behavior they had before;
 *   - an unknown/retired/empty code falls back instead of throwing, because a
 *     bad code must never block a label the packer is standing there waiting for;
 *   - the ShipStation payload shape is what the API expects (postalCode, country);
 *   - the Bagging Station's auto-label actually honors the store's saved choice. */

const {
  SHIP_FROM_LOCATIONS, DEFAULT_SHIP_FROM_CODE, isShipFromCode,
  shipFromCode, shipFromLocation, shipStationShipFrom, shipFromAddressLine,
} = require('../lib/shipFrom');

test('codes are unique and every location is addressable', () => {
  const codes = SHIP_FROM_LOCATIONS.map((l) => l.code);
  expect(new Set(codes).size).toBe(codes.length);
  SHIP_FROM_LOCATIONS.forEach((l) => {
    expect(l.street1 && l.city && l.state && l.zip).toBeTruthy();
    expect(isShipFromCode(l.code)).toBe(true);
  });
});

test('the default is the company address — unchanged behavior for saved rows', () => {
  expect(DEFAULT_SHIP_FROM_CODE).toBe('office');
  expect(shipStationShipFrom(null).street1).toBe('2238 N Glassell St Ste E');
  expect(shipStationShipFrom(undefined).street1).toBe('2238 N Glassell St Ste E');
  expect(shipStationShipFrom('').street1).toBe('2238 N Glassell St Ste E');
});

test('an unknown or retired code falls back instead of throwing', () => {
  expect(isShipFromCode('retired-dock')).toBe(false);
  expect(shipFromCode('retired-dock')).toBe(DEFAULT_SHIP_FROM_CODE);
  expect(shipFromLocation('retired-dock').code).toBe(DEFAULT_SHIP_FROM_CODE);
  expect(() => shipFromAddressLine(null)).not.toThrow();
});

test('the warehouse resolves to Emerson in the shape ShipStation wants', () => {
  const from = shipStationShipFrom('warehouse');
  expect(from).toMatchObject({
    street1: '210 E Emerson Ave', street2: 'Suite E',
    city: 'Orange', state: 'CA', postalCode: '92865', country: 'US',
  });
  expect(from.name).toBeTruthy();
  expect(from.zip).toBeUndefined(); // ShipStation reads postalCode, not zip
  expect(shipFromAddressLine('warehouse')).toBe('210 E Emerson Ave Suite E, Orange, CA 92865');
});

test('a store with no choice saved still ships from the default', () => {
  expect(shipFromCode((({}).ship_from_code))).toBe(DEFAULT_SHIP_FROM_CODE);
});
