// Reports → Webstores: every club webstore combined.
//
// Order numbers come from webstore_orders / webstore_order_items (live orders
// only: no unpaid card checkouts, no cancellations). Shopper numbers come from
// the anonymous storefront tracking (webstoreFunnel.js). Money uses the same
// helpers as the per-store Analytics tab (lib/webstoreOrderMoney.js).
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import { orderNetCollected, netFundraise } from './lib/webstoreOrderMoney';
import { loadFunnel, sumFunnel, FunnelCard, DeviceCard, InterestCard, SourceCard, SoldOutCard } from './webstoreFunnel';

const RANGES = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: '365', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
];

export function rangeStart(id, now = new Date()) {
  if (id === 'all') return null;
  if (id === 'ytd') return new Date(now.getFullYear(), 0, 1);
  const d = new Date(now); d.setDate(d.getDate() - Number(id)); return d;
}

export const isLiveOrder = (o) => o && o.status !== 'pending_payment' && o.status !== 'cancelled';

// Card checkouts that reached payment and were never paid — minus the ones where
// the same buyer came back to the same store and did pay (a retry, not a loss).
export function abandonedAtPayment(orders) {
  const paidAt = {};
  orders.filter(isLiveOrder).forEach((o) => {
    const k = o.store_id + '|' + String(o.buyer_email || '').toLowerCase();
    const t = new Date(o.created_at).getTime();
    if (!(k in paidAt) || t > paidAt[k]) paidAt[k] = t;
  });
  return orders.filter((o) => {
    if (o.status !== 'pending_payment') return false;
    const k = o.store_id + '|' + String(o.buyer_email || '').toLowerCase();
    return !(k in paidAt) || paidAt[k] < new Date(o.created_at).getTime() - 3600 * 1000;
  });
}

// Top items across every store. Units count every garment that ships (package
// components included); revenue comes from the line that carries the price.
export function topItems(items) {
  const by = {};
  items.forEach((i) => {
    if (i.is_bundle_parent) return;
    const qty = Math.max(0, (Number(i.qty) || 0) - (Number(i.cancelled_qty) || 0));
    if (!qty) return;
    const key = i.sku ? String(i.sku).toUpperCase() + '|' + (i.color || '') : 'name:' + (i.name || '?');
    if (!by[key]) by[key] = { key, sku: i.sku || '', name: i.name || i.sku || 'Item', color: i.color || '', units: 0, revenue: 0, stores: new Set() };
    const r = by[key];
    r.units += qty;
    r.revenue += qty * (Number(i.unit_price) || 0);
    if (i._store) r.stores.add(i._store);
  });
  return Object.values(by).map((r) => ({ ...r, stores: r.stores.size }));
}

// Spreadsheet export. Cells are quoted, and ones that start like a formula get a
// leading apostrophe so Excel/Sheets never run them.
export function toCsv(header, rows) {
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
function downloadCsv(filename, header, rows) {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const exportBtn = { padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 600, cursor: 'pointer' };

async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) return out;
  }
}

async function fetchItems(orderIds) {
  const out = [];
  for (let i = 0; i < orderIds.length; i += 150) {
    const chunk = orderIds.slice(i, i + 150);
    const { data, error } = await supabase.from('webstore_order_items')
      .select('order_id,sku,name,color,size,qty,unit_price,is_bundle_parent,cancelled_qty')
      .in('order_id', chunk);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 + '%' : '—');
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 };
const hdr = { fontWeight: 800, fontSize: 14, color: '#1e293b' };
const sub = { fontSize: 12, color: '#94a3b8', marginTop: 2, marginBottom: 10 };
const th = { padding: '6px 8px', fontSize: 11, color: '#94a3b8', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' };
const td = { padding: '7px 8px', fontSize: 13, borderTop: '1px solid #f1f5f9' };
const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function Bars({ rows, color = '#2563eb', fmt = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{ width: 92, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.label}>{r.label}</div>
          <div style={{ flex: 1, height: 10, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: (r.v / max) * 100 + '%', height: '100%', background: color }} /></div>
          <div style={{ width: 64, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.v)}</div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, note, color }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#1e293b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {note && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{note}</div>}
    </div>
  );
}

// repId: when set, only that rep's stores (reps are locked to their own numbers).
// reps: [{id,name}] for the rep column.
export default function WebstoreReports({ repId = null, reps = [] }) {
  const [range, setRange] = useState('90');
  const [itemSort, setItemSort] = useState('units');
  const [storeSort, setStoreSort] = useState('revenue');
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const start = rangeStart(range);
      const fromIso = start ? start.toISOString() : null;
      const stores = await fetchAll(() => supabase.from('webstores').select('id,name,slug,status,rep_id,open_at,close_at,is_template').order('created_at'));
      const orders = await fetchAll(() => {
        let q = supabase.from('webstore_orders')
          .select('id,store_id,status,payment_mode,total,original_total,refunded_amt,subtotal,fundraise_amt,discount_amt,coupon_code,buyer_email,created_at,backorder_of')
          .is('backorder_of', null).order('created_at');
        if (fromIso) q = q.gte('created_at', fromIso);
        return q;
      });
      const [items, funnel] = await Promise.all([
        fetchItems(orders.filter(isLiveOrder).map((o) => o.id)),
        loadFunnel({ from: fromIso }),
      ]);
      if (!cancelled) setState({ loading: false, stores, orders, items, funnel });
    })().catch((e) => { if (!cancelled) setState({ loading: false, error: e.message || String(e) }); });
    return () => { cancelled = true; };
  }, [range]);

  const view = useMemo(() => {
    if (state.loading || state.error) return null;
    const storeById = {};
    state.stores.filter((s) => !s.is_template && (!repId || s.rep_id === repId)).forEach((s) => { storeById[s.id] = s; });
    const allOrders = state.orders.filter((o) => storeById[o.store_id]);
    const live = allOrders.filter(isLiveOrder);
    const liveIds = new Set(live.map((o) => o.id));
    const orderStore = {}; live.forEach((o) => { orderStore[o.id] = o.store_id; });
    const items = state.items.filter((i) => liveIds.has(i.order_id)).map((i) => ({ ...i, _store: orderStore[i.order_id] }));

    const revenue = live.reduce((a, o) => a + orderNetCollected(o), 0);
    const fundraising = live.filter((o) => o.status !== 'refunded').reduce((a, o) => a + netFundraise(o), 0);
    const units = items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + Math.max(0, (Number(i.qty) || 0) - (Number(i.cancelled_qty) || 0)), 0);
    const buyers = new Set(live.map((o) => String(o.buyer_email || '').toLowerCase()).filter(Boolean));

    const funnelRows = (state.funnel.rows || []).filter((r) => storeById[r.store_id]);
    const funnelTotals = sumFunnel(funnelRows);
    const funnelByStore = {}; funnelRows.forEach((r) => { funnelByStore[r.store_id] = r; });

    // Per-store leaderboard
    const per = {};
    live.forEach((o) => {
      const p = per[o.store_id] || (per[o.store_id] = { revenue: 0, orders: 0, fund: 0 });
      p.revenue += orderNetCollected(o); p.orders += 1; p.fund += o.status === 'refunded' ? 0 : netFundraise(o);
    });
    const storeRows = Object.keys({ ...per, ...funnelByStore }).filter((id) => storeById[id]).map((id) => {
      const s = storeById[id], p = per[id] || { revenue: 0, orders: 0, fund: 0 }, f = funnelByStore[id];
      return { id, name: s.name, status: s.status, rep: (reps.find((r) => r.id === s.rep_id) || {}).name || '', ...p, aov: p.orders ? p.revenue / p.orders : 0, visitors: f ? Number(f.visitors) || 0 : 0, conv: f && Number(f.visitors) > 0 ? (Number(f.purchasers) || 0) / Number(f.visitors) : null };
    });

    // Timing: day of week, hour, and days before the store closed
    const dow = [0, 0, 0, 0, 0, 0, 0], hours = new Array(24).fill(0);
    const closeBuckets = { 'Final 24 hours': 0, '2–3 days out': 0, '4–7 days out': 0, '1–2 weeks out': 0, '2+ weeks out': 0 };
    let closeKnown = 0;
    live.forEach((o) => {
      const d = new Date(o.created_at); dow[d.getDay()]++; hours[d.getHours()]++;
      const close = storeById[o.store_id].close_at;
      if (!close) return;
      const days = (new Date(close).getTime() - d.getTime()) / 86400000;
      if (days < 0) return;
      closeKnown++;
      closeBuckets[days <= 1 ? 'Final 24 hours' : days <= 3 ? '2–3 days out' : days <= 7 ? '4–7 days out' : days <= 14 ? '1–2 weeks out' : '2+ weeks out']++;
    });
    const hourBlocks = [['6a–9a', 6, 9], ['9a–noon', 9, 12], ['noon–3p', 12, 15], ['3p–6p', 15, 18], ['6p–9p', 18, 21], ['9p–midnight', 21, 24], ['midnight–6a', 0, 6]]
      .map(([label, a, b]) => ({ label, v: hours.slice(a, b).reduce((x, y) => x + y, 0) }));

    // Month-by-month
    const byMonth = {};
    live.forEach((o) => { const k = String(o.created_at).slice(0, 7); byMonth[k] = (byMonth[k] || 0) + orderNetCollected(o); });
    const months = Object.keys(byMonth).sort().slice(-12).map((k) => ({ label: new Date(k + '-15').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), v: byMonth[k] }));

    // Sizes
    const sizes = {};
    items.filter((i) => !i.is_bundle_parent && i.size).forEach((i) => { sizes[i.size] = (sizes[i.size] || 0) + Math.max(0, (Number(i.qty) || 0) - (Number(i.cancelled_qty) || 0)); });
    const sizeRows = Object.entries(sizes).map(([label, v]) => ({ label, v })).sort((a, b) => b.v - a.v).slice(0, 10);

    // Packages
    const pk = {};
    items.filter((i) => i.is_bundle_parent).forEach((i) => { const k = i.name || 'Package'; if (!pk[k]) pk[k] = { name: k, units: 0, revenue: 0 }; pk[k].units += Number(i.qty) || 1; pk[k].revenue += (Number(i.qty) || 1) * (Number(i.unit_price) || 0); });
    const packages = Object.values(pk).sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    // Coupons
    const cp = {};
    live.filter((o) => o.coupon_code).forEach((o) => { const k = String(o.coupon_code).toUpperCase(); if (!cp[k]) cp[k] = { code: k, uses: 0, discount: 0 }; cp[k].uses++; cp[k].discount += Number(o.discount_amt) || 0; });
    const coupons = Object.values(cp).sort((a, b) => b.uses - a.uses).slice(0, 8);

    const abandoned = abandonedAtPayment(allOrders);
    const paidAttempts = allOrders.filter((o) => o.payment_mode === 'paid').length;

    return {
      revenue, orders: live.length, units, fundraising, buyers: buyers.size,
      aov: live.length ? revenue / live.length : 0,
      storesSelling: Object.keys(per).length, openNow: Object.values(storeById).filter((s) => s.status === 'open').length,
      repeatBuyers: (() => { const c = {}; live.forEach((o) => { const e = String(o.buyer_email || '').toLowerCase(); if (e) c[e] = (c[e] || 0) + 1; }); return Object.values(c).filter((x) => x > 1).length; })(),
      funnelTotals, funnelProducts: (state.funnel.products || []).filter((r) => storeById[r.store_id]),
      funnelSources: (state.funnel.sources || []).filter((r) => storeById[r.store_id]),
      funnelSoldout: (state.funnel.soldout || []).filter((r) => storeById[r.store_id]), funnelSince: state.funnel.since, funnelMissing: state.funnel.missing, funnelError: state.funnel.error,
      storeById, storeRows, items: topItems(items), packages, coupons, sizeRows, months,
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ label, v: dow[i] })),
      hourBlocks, closeRows: Object.entries(closeBuckets).map(([label, v]) => ({ label, v })), closeKnown,
      abandoned, abandonedValue: abandoned.reduce((a, o) => a + (Number(o.total) || 0), 0), paidAttempts,
    };
  }, [state, repId, reps]);

  // Item names for the "looked at, not added" list (only the handful shown).
  const [wpNames, setWpNames] = useState({});
  useEffect(() => {
    if (!view) return;
    const soldoutTop = [...view.funnelSoldout].sort((a, b) => Number(b.viewers) - Number(a.viewers)).slice(0, 10);
    const ids = [...new Set([...view.funnelProducts.filter((r) => Number(r.viewers) >= 10), ...soldoutTop].map((r) => r.webstore_product_id))].filter((id) => !(id in wpNames)).slice(0, 300);
    if (!ids.length) return;
    supabase.from('webstore_products').select('id,display_name,sku').in('id', ids).then(({ data }) => {
      const next = {}; ids.forEach((id) => { next[id] = null; });
      (data || []).forEach((r) => { next[r.id] = r.display_name || r.sku; });
      setWpNames((w) => ({ ...w, ...next }));
    });
  }, [view]);

  const rangeBar = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {RANGES.map((r) => (
        <button key={r.id} onClick={() => setRange(r.id)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid ' + (range === r.id ? '#1e3a8a' : '#e2e8f0'), background: range === r.id ? '#1e3a8a' : '#fff', color: range === r.id ? '#fff' : '#334155', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{r.label}</button>
      ))}
      {repId && <span style={{ fontSize: 12, color: '#64748b', marginLeft: 6 }}>Showing your stores only</span>}
    </div>
  );

  if (state.loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{rangeBar}<div style={{ ...card, color: '#94a3b8', fontSize: 13 }}>Loading webstore data…</div></div>;
  if (state.error) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{rangeBar}<div style={{ ...card, color: '#b91c1c', fontSize: 13 }}>Couldn’t load webstore data: {state.error}</div></div>;
  const v = view;

  const sortedItems = [...v.items].sort((a, b) => b[itemSort] - a[itemSort]).slice(0, 15);
  const sortedStores = [...v.storeRows].sort((a, b) => (b[storeSort] ?? -1) - (a[storeSort] ?? -1)).slice(0, 20);
  const sortTh = (label, key, cur, set, right = true) => <th style={{ ...th, textAlign: right ? 'right' : 'left', cursor: 'pointer', color: cur === key ? '#1e3a8a' : th.color }} onClick={() => set(key)}>{label}{cur === key ? ' ↓' : ''}</th>;
  const wpLabel = (r) => (wpNames[r.webstore_product_id] || 'Item') + ' · ' + ((v.storeById[r.store_id] || {}).name || '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {rangeBar}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <Kpi label="Revenue" value={money(v.revenue)} note="net of refunds" />
        <Kpi label="Orders" value={v.orders.toLocaleString()} note={`${v.buyers.toLocaleString()} buyers · ${v.repeatBuyers} bought twice+`} />
        <Kpi label="Avg order" value={money(v.aov)} />
        <Kpi label="Units sold" value={v.units.toLocaleString()} />
        <Kpi label="Club fundraising" value={money(v.fundraising)} color="#166534" note="owed to clubs, after coupons" />
        <Kpi label="Stores selling" value={v.storesSelling} note={`${v.openNow} open right now`} />
        {v.funnelTotals.visitors > 0 && <Kpi label="Shoppers who bought" value={pct(v.funnelTotals.purchasers, v.funnelTotals.visitors)} note={`of ${v.funnelTotals.visitors.toLocaleString()} store visitors`} color="#1e3a8a" />}
      </div>

      {v.funnelMissing || v.funnelError
        ? <div style={{ ...card, fontSize: 13, color: '#94a3b8' }}>Shopper funnel isn’t available{v.funnelError ? ': ' + v.funnelError : ' yet (tracking table not set up).'}</div>
        : <>
          <FunnelCard totals={v.funnelTotals} since={v.funnelSince} title="Shopper funnel · all stores" note="a parent visiting two stores counts in each" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <DeviceCard totals={v.funnelTotals} />
            <InterestCard products={v.funnelProducts} nameFor={wpLabel} />
            <SourceCard rows={v.funnelSources} />
            <SoldOutCard rows={v.funnelSoldout} nameFor={wpLabel} />
          </div>
        </>}

      <div style={card}>
        <div style={hdr}>Left at the payment screen</div>
        <div style={sub}>Card checkouts that were submitted but never paid, where the buyer didn’t come back and pay later</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 13, color: '#334155' }}>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{v.abandoned.length}</div>orders lost</div>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{money(v.abandonedValue)}</div>in carts</div>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{pct(v.abandoned.length, v.paidAttempts)}</div>of card checkouts</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div style={hdr}>Top selling items</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Units include items inside packages · click a column to sort</div>
            {v.items.length > 0 && <button style={exportBtn} onClick={() => downloadCsv(`webstore-items-${range}.csv`, ['Item', 'Color', 'SKU', 'Units', 'Revenue', 'Stores'], [...v.items].sort((a, b) => b.units - a.units).map((r) => [r.name, r.color, r.sku, r.units, r.revenue.toFixed(2), r.stores]))}>⬇ Export all</button>}
          </div>
        </div>
        {sortedItems.length === 0 ? <div style={{ fontSize: 13, color: '#64748b', marginTop: 10 }}>No items sold in this period.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={th}>#</th><th style={th}>Item</th><th style={th}>SKU</th>{sortTh('Units', 'units', itemSort, setItemSort)}{sortTh('Revenue', 'revenue', itemSort, setItemSort)}{sortTh('Stores', 'stores', itemSort, setItemSort)}</tr></thead>
              <tbody>{sortedItems.map((r, i) => (
                <tr key={r.key}>
                  <td style={{ ...td, color: '#94a3b8' }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}{r.color ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {r.color}</span> : null}</td>
                  <td style={{ ...td, color: '#64748b', fontSize: 12 }}>{r.sku}</td>
                  <td style={tdr}>{r.units.toLocaleString()}</td>
                  <td style={tdr}>{r.revenue > 0 ? money(r.revenue) : <span style={{ color: '#94a3b8' }}>in packages</span>}</td>
                  <td style={tdr}>{r.stores}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div style={hdr}>Store leaderboard</div>
          {v.storeRows.length > 0 && <button style={exportBtn} onClick={() => downloadCsv(`webstore-stores-${range}.csv`, ['Store', 'Status', 'Rep', 'Revenue', 'Orders', 'Avg order', 'Visitors', 'Bought %', 'Fundraising'], [...v.storeRows].sort((a, b) => b.revenue - a.revenue).map((r) => [r.name, r.status, r.rep, r.revenue.toFixed(2), r.orders, r.aov.toFixed(2), r.visitors, r.conv == null ? '' : (r.conv * 100).toFixed(1), r.fund.toFixed(2)]))}>⬇ Export all</button>}
        </div>
        <div style={sub}>Top 20 stores in this period · click a column to sort · export has every store</div>
        {sortedStores.length === 0 ? <div style={{ fontSize: 13, color: '#64748b' }}>No store activity in this period.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Store</th><th style={th}>Rep</th>{sortTh('Revenue', 'revenue', storeSort, setStoreSort)}{sortTh('Orders', 'orders', storeSort, setStoreSort)}{sortTh('Avg order', 'aov', storeSort, setStoreSort)}{sortTh('Visitors', 'visitors', storeSort, setStoreSort)}{sortTh('Bought', 'conv', storeSort, setStoreSort)}{sortTh('Fundraising', 'fund', storeSort, setStoreSort)}</tr></thead>
              <tbody>{sortedStores.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}{r.status === 'open' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>OPEN</span>}</td>
                  <td style={{ ...td, color: '#64748b' }}>{r.rep}</td>
                  <td style={tdr}>{money(r.revenue)}</td>
                  <td style={tdr}>{r.orders}</td>
                  <td style={tdr}>{r.orders ? money(r.aov) : '—'}</td>
                  <td style={tdr}>{r.visitors || '—'}</td>
                  <td style={tdr}>{r.conv == null ? '—' : Math.round(r.conv * 1000) / 10 + '%'}</td>
                  <td style={{ ...tdr, color: '#166534' }}>{money(r.fund)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        <div style={card}>
          <div style={hdr}>When orders come in: before close</div>
          <div style={sub}>How close to the store’s close date parents ordered ({v.closeKnown} orders with a close date). Use this to time reminder emails.</div>
          <Bars rows={v.closeRows} color="#b45309" />
        </div>
        <div style={card}>
          <div style={hdr}>Day of week</div>
          <div style={sub}>Orders placed on each day</div>
          <Bars rows={v.dow} />
        </div>
        <div style={card}>
          <div style={hdr}>Time of day</div>
          <div style={sub}>Orders by time (your local time)</div>
          <Bars rows={v.hourBlocks} color="#7c3aed" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        <div style={card}>
          <div style={hdr}>Revenue by month</div>
          <div style={sub}>Last 12 months in this period</div>
          {v.months.length ? <Bars rows={v.months} color="#16a34a" fmt={money} /> : <div style={{ fontSize: 13, color: '#64748b' }}>No orders.</div>}
        </div>
        <div style={card}>
          <div style={hdr}>Size mix</div>
          <div style={sub}>Top sizes ordered, all stores — useful for stocking blanks</div>
          {v.sizeRows.length ? <Bars rows={v.sizeRows} color="#0891b2" fmt={(x) => x.toLocaleString()} /> : <div style={{ fontSize: 13, color: '#64748b' }}>No sized items.</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        <div style={card}>
          <div style={hdr}>Top packages</div>
          <div style={sub}>Player packs and bundles sold</div>
          {v.packages.length === 0 ? <div style={{ fontSize: 13, color: '#64748b' }}>No packages sold in this period.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Package</th><th style={{ ...th, textAlign: 'right' }}>Sold</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>{v.packages.map((p) => <tr key={p.name}><td style={{ ...td, fontWeight: 600 }}>{p.name}</td><td style={tdr}>{p.units}</td><td style={tdr}>{money(p.revenue)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div style={card}>
          <div style={hdr}>Coupon codes</div>
          <div style={sub}>Most-used codes and what they gave away</div>
          {v.coupons.length === 0 ? <div style={{ fontSize: 13, color: '#64748b' }}>No coupons used in this period.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Code</th><th style={{ ...th, textAlign: 'right' }}>Uses</th><th style={{ ...th, textAlign: 'right' }}>Discount</th></tr></thead>
              <tbody>{v.coupons.map((c) => <tr key={c.code}><td style={{ ...td, fontWeight: 600 }}>{c.code}</td><td style={tdr}>{c.uses}</td><td style={tdr}>{money(c.discount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
