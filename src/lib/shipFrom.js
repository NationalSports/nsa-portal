/* eslint-disable */
// ── Ship-from locations — single source of truth ─────────────────────────────
// Every shipping label we buy needs a return/origin address. Until now that was
// hardcoded to the company address (Glassell) in four separate places, even for
// parcels that physically leave the Emerson warehouse — so the label's origin,
// the carrier pickup scan, and any return came back to the wrong door.
//
// This file owns the list of places a parcel can ship FROM. To add one, append
// an entry below (a new `code` is all the UI and DB need — nothing else to
// change). Codes are stored on rows, so never rename or reuse an existing code.
//
// Dual-consumer CommonJS, same pattern as src/lib/decoPricing.js: the webpack
// client imports it (`import * as SHIPFROM from './lib/shipFrom'`) AND the
// Netlify function runtime requires it directly (bundled via netlify.toml
// included_files). Keep it dependency-free CJS — no import/export keywords, or
// webpack treats it as ESM and drops module.exports.

const SHIP_FROM_LOCATIONS = [
  {
    code: 'office',
    label: 'NSA Office — Glassell',
    hint: 'Company address. Use for anything mailed from the front office.',
    name: 'National Sports Apparel',
    company: 'National Sports Apparel',
    street1: '2238 N Glassell St Ste E',
    street2: '',
    city: 'Orange',
    state: 'CA',
    zip: '92865',
    phone: '(619) 555-0127',
  },
  {
    code: 'warehouse',
    label: 'NSA Warehouse — Emerson',
    hint: 'Where bagged store orders actually leave from.',
    name: 'National Sports Apparel',
    company: 'National Sports Apparel',
    street1: '210 E Emerson Ave',
    street2: 'Suite E',
    city: 'Orange',
    state: 'CA',
    zip: '92865',
    phone: '(619) 555-0127',
  },
];

// Today's behavior, unchanged: a label with no location chosen still ships from
// the company address. Stores opt into Emerson by picking it in store settings.
const DEFAULT_SHIP_FROM_CODE = 'office';

const SHIP_FROM_CODES = SHIP_FROM_LOCATIONS.map((l) => l.code);

function isShipFromCode(code) {
  return SHIP_FROM_CODES.indexOf(String(code || '')) !== -1;
}

// Resolve a stored code to its location. An unknown or empty code falls back to
// the default rather than throwing — a retired code must never block a label.
function shipFromLocation(code) {
  const found = SHIP_FROM_LOCATIONS.find((l) => l.code === String(code || ''));
  return found || SHIP_FROM_LOCATIONS.find((l) => l.code === DEFAULT_SHIP_FROM_CODE);
}

// Normalize whatever a row/dropdown holds into a real code (for storing).
function shipFromCode(code) {
  return shipFromLocation(code).code;
}

// The ShipStation `shipFrom` object for a location code.
function shipStationShipFrom(code) {
  const l = shipFromLocation(code);
  return {
    name: l.name,
    company: l.company,
    street1: l.street1,
    ...(l.street2 ? { street2: l.street2 } : {}),
    city: l.city,
    state: l.state,
    postalCode: l.zip,
    country: 'US',
    phone: l.phone,
  };
}

// One-line address for UI ("210 E Emerson Ave Suite E, Orange, CA 92865").
function shipFromAddressLine(code) {
  const l = shipFromLocation(code);
  return [l.street1, l.street2].filter(Boolean).join(' ') + ', ' + l.city + ', ' + l.state + ' ' + l.zip;
}

module.exports = {
  SHIP_FROM_LOCATIONS,
  SHIP_FROM_CODES,
  DEFAULT_SHIP_FROM_CODE,
  isShipFromCode,
  shipFromLocation,
  shipFromCode,
  shipStationShipFrom,
  shipFromAddressLine,
};
