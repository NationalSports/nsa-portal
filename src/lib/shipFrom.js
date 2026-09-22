/* eslint-disable */
// ── Ship-from locations — single source of truth ─────────────────────────────
// Every shipping label we buy needs an origin/return address. Parcels leave from
// one of three kinds of place:
//
//   * the NSA warehouse (Emerson) — the default, where bagged store orders go out;
//   * the NSA office (Glassell) — the company address, for anything mailed from
//     the front desk;
//   * an outside decorator, when the decorator ships finished goods straight to
//     the customer instead of back to us.
//
// The two NSA sites are fixed entries below. Decorators are NOT listed here: they
// come from Settings → Deco Vendors (the deco_vendors table, falling back to the
// linked Vendor record for an address), so adding a decorator there is all it
// takes for it to show up as a ship-from choice. A decorator's code is
// "deco:<deco_vendor id>".
//
// Codes are stored on rows (webstores.ship_from_code, webstore_orders.ship_from_code),
// so never rename or reuse a fixed code. A decorator that later loses its
// address or is removed still leaves its code on old orders; display handles
// that ("Decorator (not on file)"), and buying a NEW label with it is refused
// rather than silently shipping from the wrong place.
//
// Dual-consumer CommonJS, same pattern as src/lib/decoPricing.js: the webpack
// client imports it (`import * as SHIPFROM from './lib/shipFrom'`) AND the
// Netlify function runtime requires it directly (bundled via netlify.toml
// included_files). Keep it dependency-free CJS — no import/export keywords, or
// webpack treats it as ESM and drops module.exports.

const NSA_PHONE = '(619) 555-0127';

const SHIP_FROM_LOCATIONS = [
  {
    code: 'warehouse',
    kind: 'nsa',
    label: 'NSA Warehouse — Emerson',
    hint: 'Where bagged store orders leave from. The default.',
    name: 'National Sports Apparel',
    company: 'National Sports Apparel',
    street1: '210 E Emerson Ave',
    street2: 'Suite E',
    city: 'Orange',
    state: 'CA',
    zip: '92865',
    phone: NSA_PHONE,
  },
  {
    code: 'office',
    kind: 'nsa',
    label: 'NSA Office — Glassell',
    hint: 'Company address. Use for anything mailed from the front office.',
    name: 'National Sports Apparel',
    company: 'National Sports Apparel',
    street1: '2238 N Glassell St Ste E',
    street2: '',
    city: 'Orange',
    state: 'CA',
    zip: '92865',
    phone: NSA_PHONE,
  },
];

// A label with no location chosen ships from the warehouse — that is where the
// parcels physically are.
const DEFAULT_SHIP_FROM_CODE = 'warehouse';

const DECO_PREFIX = 'deco:';

const SHIP_FROM_CODES = SHIP_FROM_LOCATIONS.map((l) => l.code);

function decoShipFromCode(decoVendorId) {
  return DECO_PREFIX + String(decoVendorId || '');
}

// "deco:dv_silver_screen" → "dv_silver_screen"; anything else → null.
function decoIdFromCode(code) {
  const s = String(code || '');
  return s.indexOf(DECO_PREFIX) === 0 && s.length > DECO_PREFIX.length ? s.slice(DECO_PREFIX.length) : null;
}

// Shape check only — is this a code we would ever store? Fixed codes, or a
// decorator code with a sane id. Does NOT check the decorator exists.
function isShipFromCode(code) {
  if (SHIP_FROM_CODES.indexOf(String(code || '')) !== -1) return true;
  const id = decoIdFromCode(code);
  return !!id && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

// Build the ship-from entry for one decorator. `dv` is the deco_vendors row;
// `lv` its linked vendors row (may be null). Precedence is the same as
// src/lib/botTasks.js decoAddressSource — the decorator's own saved address,
// else the linked Vendor's — so a deco PO and a shipping label can never
// disagree about where a decorator is. Returns null when neither has one:
// a decorator with no address cannot be an origin.
function decoShipFromLocation(dv, lv) {
  if (!dv || !dv.id) return null;
  const own = dv.address_line1 || dv.city;
  const src = own ? dv : (lv && (lv.address_line1 || lv.city) ? lv : null);
  if (!src || !src.address_line1 || !src.city || !src.state || !src.zip) return null;
  const name = dv.name || (lv && lv.name) || 'Decorator';
  return {
    code: decoShipFromCode(dv.id),
    kind: 'deco',
    label: name,
    hint: 'Decorator ships finished goods straight to the customer.',
    name,
    company: name,
    street1: src.address_line1,
    street2: src.address_line2 || '',
    city: src.city,
    state: src.state,
    zip: src.zip,
    phone: dv.phone || src.phone || src.contact_phone || (lv && lv.contact_phone) || NSA_PHONE,
  };
}

// Every decorator that can be an origin, from the two tables' rows.
function decoShipFromLocations(decoVendors, vendors) {
  const byId = {};
  (vendors || []).forEach((v) => { if (v && v.id) byId[v.id] = v; });
  return (decoVendors || [])
    .filter((dv) => dv && dv.is_active !== false)
    .map((dv) => decoShipFromLocation(dv, dv.vendor_id ? byId[dv.vendor_id] : null))
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// All choosable origins: NSA sites first, then decorators.
function allShipFromLocations(decoLocations) {
  return SHIP_FROM_LOCATIONS.concat(decoLocations || []);
}

function findShipFromLocation(code, decoLocations) {
  const c = String(code || '');
  return allShipFromLocations(decoLocations).find((l) => l.code === c) || null;
}

// Resolve a stored code to its location. An unknown, retired, or empty code
// falls back to the default — for DISPLAY and for a store's default setting.
// Never use this to buy a label with a decorator code; use resolveShipFrom.
function shipFromLocation(code, decoLocations) {
  return findShipFromLocation(code, decoLocations) || findShipFromLocation(DEFAULT_SHIP_FROM_CODE);
}

// Normalize whatever a row/dropdown holds into a code we can store. A
// well-formed decorator code passes through even if that decorator is not in
// the list handed in (the list may simply not be loaded yet).
function shipFromCode(code, decoLocations) {
  if (findShipFromLocation(code, decoLocations)) return String(code);
  if (isShipFromCode(code) && decoIdFromCode(code)) return String(code);
  return DEFAULT_SHIP_FROM_CODE;
}

// The address a NEW label will actually print. Strict about decorators: a
// decorator code that cannot be resolved to an address throws instead of
// quietly falling back to the warehouse, because the parcel is not at the
// warehouse. Fixed codes and empty/unknown non-decorator codes use the default.
function resolveShipFrom(code, decoLocations) {
  const found = findShipFromLocation(code, decoLocations);
  if (found) return found;
  const decoId = decoIdFromCode(code);
  if (decoId) {
    const err = new Error('Ship-from decorator "' + decoId + '" has no address on file (Settings → Deco Vendors). Pick another origin.');
    err.code = 'SHIP_FROM_UNRESOLVED';
    throw err;
  }
  return findShipFromLocation(DEFAULT_SHIP_FROM_CODE);
}

// The ShipStation `shipFrom` object for a location (see resolveShipFrom).
function shipStationShipFrom(code, decoLocations) {
  const l = resolveShipFrom(code, decoLocations);
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
function shipFromAddressLine(code, decoLocations) {
  const l = findShipFromLocation(code, decoLocations);
  if (!l) return decoIdFromCode(code) ? 'Decorator address not on file' : shipFromAddressLine(DEFAULT_SHIP_FROM_CODE);
  return [l.street1, l.street2].filter(Boolean).join(' ') + ', ' + l.city + ', ' + l.state + ' ' + l.zip;
}

// Short name for a stored code, honest about a decorator we can no longer see.
function shipFromLabel(code, decoLocations) {
  const l = findShipFromLocation(code, decoLocations);
  if (l) return l.label;
  return decoIdFromCode(code) ? 'Decorator (not on file)' : shipFromLocation(code).label;
}

module.exports = {
  SHIP_FROM_LOCATIONS,
  SHIP_FROM_CODES,
  DEFAULT_SHIP_FROM_CODE,
  DECO_PREFIX,
  isShipFromCode,
  decoShipFromCode,
  decoIdFromCode,
  decoShipFromLocation,
  decoShipFromLocations,
  allShipFromLocations,
  findShipFromLocation,
  shipFromLocation,
  shipFromCode,
  resolveShipFrom,
  shipStationShipFrom,
  shipFromAddressLine,
  shipFromLabel,
};
