/** @jest-environment node */

/* Ship-from locations (src/lib/shipFrom.js) — the origin address printed on a
 * shipping label: the NSA warehouse by default, the office, or a decorator that
 * ships finished goods straight to the customer.
 *
 * What these pin:
 *   - the default is the WAREHOUSE (Emerson), where the parcels physically are;
 *   - decorators come from deco_vendors rows (own address, else the linked
 *     Vendor's — same precedence as botTasks.decoAddressSource), and one with no
 *     address is not offered;
 *   - buying a label with a decorator code that cannot be resolved THROWS rather
 *     than silently shipping from the warehouse (the goods are not there);
 *   - display of a stored decorator code that is no longer on file stays honest;
 *   - the ShipStation payload shape is what the API expects (postalCode, country). */

const {
  SHIP_FROM_LOCATIONS, DEFAULT_SHIP_FROM_CODE, isShipFromCode, decoShipFromCode, decoIdFromCode,
  decoShipFromLocation, decoShipFromLocations, shipFromCode, shipFromLocation, resolveShipFrom,
  shipStationShipFrom, shipFromAddressLine, shipFromLabel,
} = require('../lib/shipFrom');

const decoRows = [
  { id: 'dv_silver_screen', name: 'Silver Screen', is_active: true, address_line1: '1135 S Rock Blvd Suite #340', city: 'Reno', state: 'NV', zip: '89502', vendor_id: 'ns_3297' },
  { id: 'dv_linked_only', name: 'Linked Only', is_active: true, vendor_id: 'ns_1' },
  { id: 'dv_no_address', name: 'No Address', is_active: true, vendor_id: null },
  { id: 'dv_inactive', name: 'Retired', is_active: false, address_line1: '1 Old Rd', city: 'X', state: 'CA', zip: '90000' },
];
const vendorRows = [
  { id: 'ns_1', name: 'Linked Vendor Co', address_line1: '9 Vendor Rd', city: 'Fresno', state: 'CA', zip: '93706', contact_phone: '(559) 555-0100' },
  { id: 'ns_3297', name: 'Silver Screen Inc', address_line1: 'SHOULD NOT WIN', city: 'Nowhere', state: 'ZZ', zip: '00000' },
];
const decos = decoShipFromLocations(decoRows, vendorRows);

test('fixed codes are unique and every NSA site is addressable', () => {
  const codes = SHIP_FROM_LOCATIONS.map((l) => l.code);
  expect(new Set(codes).size).toBe(codes.length);
  SHIP_FROM_LOCATIONS.forEach((l) => {
    expect(l.street1 && l.city && l.state && l.zip).toBeTruthy();
    expect(isShipFromCode(l.code)).toBe(true);
  });
});

test('the default is the warehouse — where bagged orders actually leave from', () => {
  expect(DEFAULT_SHIP_FROM_CODE).toBe('warehouse');
  ['', null, undefined, 'retired-dock'].forEach((c) => {
    expect(shipStationShipFrom(c).street1).toBe('210 E Emerson Ave');
    expect(shipFromCode(c)).toBe('warehouse');
  });
  expect(shipStationShipFrom('office').street1).toBe('2238 N Glassell St Ste E');
});

test('decorators come from deco_vendors, own address first, then the linked vendor', () => {
  expect(decos.map((d) => d.code)).toEqual(['deco:dv_linked_only', 'deco:dv_silver_screen']); // sorted by label; no-address + inactive dropped
  const ss = decos.find((d) => d.code === 'deco:dv_silver_screen');
  expect(ss.street1).toBe('1135 S Rock Blvd Suite #340'); // own address beats the linked vendor's
  expect(ss.label).toBe('Silver Screen');
  const linked = decos.find((d) => d.code === 'deco:dv_linked_only');
  expect(linked).toMatchObject({ street1: '9 Vendor Rd', city: 'Fresno', phone: '(559) 555-0100' });
  expect(decoShipFromLocation(decoRows[2], null)).toBeNull();
});

test('decorator codes round-trip and pass the shape check without needing the list', () => {
  expect(decoShipFromCode('dv_x')).toBe('deco:dv_x');
  expect(decoIdFromCode('deco:dv_x')).toBe('dv_x');
  expect(decoIdFromCode('warehouse')).toBeNull();
  expect(isShipFromCode('deco:dv_x')).toBe(true);
  expect(isShipFromCode('deco:')).toBe(false);
  expect(isShipFromCode('deco:has spaces')).toBe(false);
  // A store's saved decorator default survives normalization even before the list loads.
  expect(shipFromCode('deco:dv_silver_screen')).toBe('deco:dv_silver_screen');
});

test('a label for a decorator prints the decorator as origin, in the ShipStation shape', () => {
  const from = shipStationShipFrom('deco:dv_silver_screen', decos);
  expect(from).toMatchObject({ name: 'Silver Screen', company: 'Silver Screen', street1: '1135 S Rock Blvd Suite #340', city: 'Reno', state: 'NV', postalCode: '89502', country: 'US' });
  expect(from.zip).toBeUndefined();
  expect(from.phone).toBeTruthy(); // carriers want a shipper phone; falls back to NSA's
  expect(shipFromAddressLine('deco:dv_silver_screen', decos)).toBe('1135 S Rock Blvd Suite #340, Reno, NV 89502');
});

test('a decorator with no resolvable address refuses to buy a label instead of using the warehouse', () => {
  expect(() => resolveShipFrom('deco:dv_no_address', decos)).toThrow(/no address on file/);
  expect(() => shipStationShipFrom('deco:dv_gone', decos)).toThrow(/no address on file/);
  let code = null;
  try { shipStationShipFrom('deco:dv_gone', decos); } catch (e) { code = e.code; }
  expect(code).toBe('SHIP_FROM_UNRESOLVED');
  // Display of the same stored code stays honest rather than showing the warehouse.
  expect(shipFromLabel('deco:dv_gone', decos)).toBe('Decorator (not on file)');
  expect(shipFromAddressLine('deco:dv_gone', decos)).toBe('Decorator address not on file');
  // shipFromLocation (display/default use) still falls back for non-decorator junk.
  expect(shipFromLocation('junk').code).toBe('warehouse');
});
