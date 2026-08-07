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

// SanMar warehouse number → city, per the Web Services Integration Guide's
// "Warehouse Location Designations" table (the legacy inventory list response
// carries no ids — position designates the warehouse, in this order; AZ is 12
// because 8-11 are internal virtual warehouses).
export const SANMAR_WAREHOUSES = {
  1: 'Seattle, WA',
  2: 'Cincinnati, OH',
  3: 'Dallas, TX',
  4: 'Reno, NV',
  5: 'Robbinsville, NJ',
  6: 'Jacksonville, FL',
  7: 'Minneapolis, MN',
  12: 'Phoenix, AZ',
};

// entries: [{ label, city, qty, primary }] — primary marks the expected ship-from.
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
          {e.primary ? '📦 ' : ''}{e.label} {e.qty.toLocaleString()}
        </span>
      ))}
    </span>
  );
}

// Pick the expected ship-from: the vendor-flagged closest warehouse when it can
// cover the line qty, else the closest-to-front warehouse with enough stock, else
// the biggest stock. Returns display entries sorted primary-first then qty desc.
export function rankWarehouses(rows, lineQty) {
  const list = (rows || []).filter(r => r && r.label);
  if (!list.length) return [];
  const need = Number(lineQty) || 0;
  let primary = list.find(r => r.closest && r.qty >= need)
    || list.filter(r => r.qty >= need).sort((a, b) => b.qty - a.qty)[0]
    || [...list].sort((a, b) => b.qty - a.qty)[0];
  return [...list]
    .sort((a, b) => (b === primary) - (a === primary) || b.qty - a.qty)
    .map(r => ({ ...r, primary: r === primary && r.qty > 0 }));
}
