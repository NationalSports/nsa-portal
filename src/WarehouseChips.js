// Per-warehouse stock chips for the vendor order-review modals (S&S / SanMar).
// Shows where a line's goods will likely ship from: each warehouse with stock,
// sorted by quantity, the expected ship-from highlighted. Vendors route at
// submission time (nearest warehouse with stock, split shipments possible), so
// this is informational — it never blocks or alters the order.
import React from 'react';

// S&S warehouse abbreviations → city (tooltip only; an unknown abbr still renders).
export const SS_WAREHOUSES = {
  IL: 'Lockport, IL',
  KS: 'Olathe, KS',
  NV: 'Reno, NV',
  TX: 'Fort Worth, TX',
  GA: 'McDonough, GA',
  NJ: 'Robbinsville, NJ',
  DS: 'Dropship',
};

// SanMar warehouse number → code + city, per the PO Integration Guide's "SanMar
// Warehouse Will Call Ship Methods" table (8-11 are internal virtual warehouses,
// which is why Phoenix is 12). The NUMBER is what `fobId` takes on a line item
// when the account is configured for Warehouse Selection.
export const SANMAR_WAREHOUSE_INFO = {
  1:  { code: 'PRE', city: 'Seattle, WA' },
  2:  { code: 'CIN', city: 'Cincinnati, OH' },
  3:  { code: 'COP', city: 'Dallas, TX' },
  4:  { code: 'REN', city: 'Reno, NV' },
  5:  { code: 'NJE', city: 'Robbinsville, NJ' },
  6:  { code: 'JAC', city: 'Jacksonville, FL' },
  7:  { code: 'MSP', city: 'Minneapolis, MN' },
  12: { code: 'PHX', city: 'Phoenix, AZ' },
};
export const SANMAR_WAREHOUSES = Object.fromEntries(
  Object.entries(SANMAR_WAREHOUSE_INFO).map(([id, w]) => [id, w.city])
);

// ─── Distance ranking ───────────────────────────────────────────────────────
// Vendors route to the warehouse NEAREST the ship-to, so "which warehouse will
// this ship from" is a distance question, not a most-stock question. These
// coordinates are approximate (city centers / state centroids) and used only to
// order warehouses by proximity — never to compute anything the order depends on.
const WH_COORDS = {
  seattle: [47.45, -122.30], issaquah: [47.53, -122.03], kent: [47.38, -122.23],
  cincinnati: [39.10, -84.51], dallas: [32.78, -96.80], reno: [39.53, -119.81],
  robbinsville: [40.21, -74.62], jacksonville: [30.33, -81.66],
  minneapolis: [44.98, -93.27], phoenix: [33.45, -112.07], richmond: [37.54, -77.44],
};
const WH_ID_CITY = { 1: 'seattle', 2: 'cincinnati', 3: 'dallas', 4: 'reno', 5: 'robbinsville', 6: 'jacksonville', 7: 'minneapolis', 12: 'phoenix' };

// State centroids — enough resolution to order warehouses by distance from any
// US ship-to (our own dock or a decorator's).
const US_STATE_COORDS = {
  AL: [32.8, -86.8], AK: [64.0, -152.0], AZ: [34.2, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.3], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.6, -83.4], HI: [20.3, -156.4],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5],
  KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1],
  NY: [42.9, -75.5], NC: [35.5, -79.4], ND: [47.4, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.6],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.8, -86.4], TX: [31.5, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5],
  WV: [38.6, -80.6], WI: [44.6, -89.7], WY: [43.0, -107.6],
};

// Ship-to → [lat, lon] (state resolution). Returns null for a non-US/blank state,
// which makes every distance unknown and leaves ranking on its stock fallback.
export function shipToCoords(shipTo) {
  const st = String(shipTo?.region || shipTo?.state || '').trim().toUpperCase();
  return US_STATE_COORDS[st] || null;
}

// Warehouse row (vendor-returned name, and/or SanMar warehouse number) → coords.
// Name first: SanMar's inventory service returns real location names, so a DC we
// don't have a number for (e.g. Richmond, VA) still ranks correctly.
export function warehouseCoords(name, id) {
  const n = String(name || '').toLowerCase();
  for (const city of Object.keys(WH_COORDS)) if (n.includes(city)) return WH_COORDS[city];
  const byId = WH_ID_CITY[String(id ?? '').trim()];
  return byId ? WH_COORDS[byId] : null;
}

// Canonical "City, ST" for a vendor-returned warehouse row (display only). Name
// first, then the warehouse number, then whatever the vendor called it.
export function warehouseCity(name, id) {
  const n = String(name || '').toLowerCase().trim();
  const entries = Object.entries(SANMAR_WAREHOUSE_INFO);
  if (n) {
    const byName = entries.find(([, w]) => n.includes(w.city.split(',')[0].toLowerCase()));
    if (byName) return byName[1].city;
    if (n.includes('richmond')) return 'Richmond, VA';
  }
  const byId = SANMAR_WAREHOUSE_INFO[String(id ?? '').trim()];
  return byId ? byId.city : (String(name || '').trim() || ('WH ' + id));
}

// Great-circle miles between two [lat, lon] pairs; null if either is unknown.
export function milesBetween(a, b) {
  if (!a || !b) return null;
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// entries: [{ label, city, qty, primary }] — primary marks the expected ship-from.
// Chips show the warehouse only; current stock lives in the hover tooltip (the rep
// asked for "where is it shipping from", not an availability table).
export default function WarehouseChips({ entries, loading }) {
  if (loading) return <span style={{ color: '#94a3b8', fontSize: 11 }}>…</span>;
  const rows = (entries || []).filter(e => e && e.label);
  if (!rows.length) return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {rows.map((e, i) => (
        <span
          key={e.label + '-' + i}
          title={(e.city ? e.city + ' — ' : '') + e.qty.toLocaleString() + ' in stock' + (e.primary ? ' · expected ship-from' : '')}
          style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10.5,
            fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap',
            background: e.primary ? '#dcfce7' : e.qty > 0 ? '#f1f5f9' : '#fef2f2',
            border: '1px solid ' + (e.primary ? '#86efac' : e.qty > 0 ? '#e2e8f0' : '#fecaca'),
            color: e.primary ? '#166534' : e.qty > 0 ? '#475569' : '#b91c1c',
          }}
        >
          {e.primary ? '📦 ' : ''}{e.label}
        </span>
      ))}
    </span>
  );
}

// Proximity key for a row: a vendor-flagged `closest` wins outright, then our own
// computed `dist` (miles), then unknown. Rows with no distance info at all fall
// back to stock order, which is how S&S rows (closest flag only) behave.
const proximity = (r) => (r.closest ? -1 : (typeof r.dist === 'number' ? r.dist : Infinity));

// Pick the expected ship-from for ONE line: the nearest warehouse that can cover
// the line, else the biggest stock (the vendor will split or bump to the next
// warehouse). `forceKey` pins a specific warehouse — used when the whole order is
// consolidated to one DC, or when a rep has selected one. Returns display entries
// sorted primary-first, then nearest, then qty desc.
export function rankWarehouses(rows, lineQty, forceKey = null) {
  const list = (rows || []).filter(r => r && r.label);
  if (!list.length) return [];
  const need = Number(lineQty) || 0;
  const byNear = [...list].sort((a, b) => proximity(a) - proximity(b) || b.qty - a.qty);
  let primary = (forceKey != null && list.find(r => warehouseKey(r) === forceKey))
    || byNear.find(r => r.qty >= need)
    || byNear.slice().sort((a, b) => b.qty - a.qty)[0];
  return [...list]
    .sort((a, b) => (b === primary) - (a === primary) || proximity(a) - proximity(b) || b.qty - a.qty)
    .map(r => ({ ...r, primary: r === primary && r.qty > 0 }));
}

// Stable identity for a warehouse row across lines (id when the vendor gives one).
export function warehouseKey(r) {
  return String(r?.id ?? '').trim() || String(r?.label ?? '').trim().toUpperCase();
}

// SanMar's default account setting is Warehouse Consolidation: the ENTIRE order
// ships from the closest warehouse that can fill every line, bumping to the next
// closest when something is short. Mirror that so the modal predicts one DC for
// the whole PO instead of a different one per line.
// linesRows: [{ rows: [...], need }] → the winning warehouseKey, or null when no
// single warehouse covers the order (SanMar then splits — fall back to per-line).
export function pickConsolidatedWarehouse(linesRows) {
  const entries = (linesRows || []).filter(l => l && Array.isArray(l.rows));
  if (!entries.length) return null;
  const candidates = new Map(); // key -> representative row (for proximity)
  entries[0].rows.forEach(r => candidates.set(warehouseKey(r), r));
  for (const key of [...candidates.keys()]) {
    const coversAll = entries.every(({ rows, need }) => {
      const row = rows.find(r => warehouseKey(r) === key);
      return row && row.qty >= (Number(need) || 0);
    });
    if (!coversAll) candidates.delete(key);
  }
  if (!candidates.size) return null;
  return [...candidates.entries()].sort((a, b) => proximity(a[1]) - proximity(b[1]))[0][0];
}
