// Shopper funnel for the club webstores — shared by the per-store Analytics tab
// (Webstores.js) and Reports → Webstores (WebstoreReports.js).
//
// Data comes from the anonymous storefront tracking (src/lib/webstoreTracking.js →
// webstore_events) through the webstore_funnel / webstore_product_funnel RPCs.
// Each number is a count of distinct shoppers (browsers), not page views.
import React from 'react';
import { supabase } from './lib/supabase';

export const FUNNEL_STEPS = [
  { key: 'visitors', label: 'Visited the store' },
  { key: 'product_viewers', label: 'Viewed an item' },
  { key: 'cart_adders', label: 'Added to cart' },
  { key: 'checkout_starters', label: 'Started checkout' },
  { key: 'order_placers', label: 'Submitted order' },
  { key: 'purchasers', label: 'Completed purchase' },
];

// What a leak at each step usually means, in plain English. Keyed by the step
// shoppers failed to reach.
const LEAK_ADVICE = {
  product_viewers: 'Most visitors leave without opening a single item. Look at the store’s first screen: is the hero clear, are prices and photos showing on the item cards?',
  cart_adders: 'Shoppers open items but don’t add them. That usually points at price, missing sizes, or weak photos — check the items listed under “Looked at, not added”.',
  checkout_starters: 'Carts get filled but checkout never starts. Parents often wait to confirm sizes with their player — a reminder email a few days before the store closes can recover these.',
  order_placers: 'Shoppers start checkout but don’t submit. The checkout form (fields required, shipping cost surprise) is where they stop.',
  purchasers: 'Orders are submitted but the card payment isn’t completed.',
};

const MIN_SAMPLE = 20; // below this many visitors, rates are noise

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// Add up per-store funnel rows into one set of totals.
export function sumFunnel(rows) {
  const keys = ['visitors', 'product_viewers', 'cart_adders', 'checkout_starters', 'order_placers', 'purchasers',
    'mobile_visitors', 'desktop_visitors', 'tablet_visitors', 'mobile_purchasers', 'desktop_purchasers', 'tablet_purchasers'];
  const t = {}; keys.forEach((k) => { t[k] = 0; });
  (rows || []).forEach((r) => keys.forEach((k) => { t[k] += n(r[k]); }));
  return t;
}

// The step with the worst step-to-step drop (only once there's enough traffic).
export function biggestLeak(t) {
  if (!t || n(t.visitors) < MIN_SAMPLE) return null;
  let worst = null;
  for (let i = 1; i < FUNNEL_STEPS.length; i++) {
    const prev = n(t[FUNNEL_STEPS[i - 1].key]), cur = n(t[FUNNEL_STEPS[i].key]);
    if (prev <= 0) continue;
    const drop = 1 - cur / prev;
    if (!worst || drop > worst.drop) worst = { from: FUNNEL_STEPS[i - 1], to: FUNNEL_STEPS[i], drop, lost: prev - cur };
  }
  if (!worst || worst.drop <= 0) return null;
  return { ...worst, advice: LEAK_ADVICE[worst.to.key] || '' };
}

// Fetch funnel rows (+ per-item interest) for a date window. `missing` = the
// tracking migration isn't applied yet, so callers can say so instead of erroring.
export async function loadFunnel({ from = null, to = null, storeId = null } = {}) {
  const args = { p_from: from, p_to: to, p_store_id: storeId };
  const [f, p, first] = await Promise.all([
    supabase.rpc('webstore_funnel', args),
    supabase.rpc('webstore_product_funnel', args),
    (() => { let q = supabase.from('webstore_events').select('created_at').order('created_at', { ascending: true }).limit(1); if (storeId) q = q.eq('store_id', storeId); return q; })(),
  ]);
  const err = f.error || p.error;
  if (err) {
    const missing = /does not exist|could not find|schema cache/i.test(err.message || '');
    return { rows: [], products: [], since: null, missing, error: missing ? null : err.message };
  }
  return { rows: f.data || [], products: p.data || [], since: (first.data && first.data[0] && first.data[0].created_at) || null, missing: false, error: null };
}

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 };
const hdr = { fontWeight: 800, fontSize: 14, color: '#1e293b' };
const sub = { fontSize: 12, color: '#94a3b8', marginTop: 2 };

export function FunnelCard({ totals, since, title = 'Shopper funnel', note }) {
  const t = totals || sumFunnel([]);
  const top = Math.max(1, n(t.visitors));
  const leak = biggestLeak(t);
  const sinceTxt = since ? new Date(since).toLocaleDateString() : null;
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div style={hdr}>{title}</div>
        {n(t.visitors) > 0 && <div style={{ fontSize: 13, color: '#334155' }}><b style={{ color: '#166534', fontSize: 16 }}>{pct(t.purchasers, t.visitors)}%</b> of visitors bought</div>}
      </div>
      <div style={sub}>Unique shoppers reaching each step{sinceTxt ? ` · tracking since ${sinceTxt}` : ''}{note ? ` · ${note}` : ''}</div>
      {n(t.visitors) === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 14 }}>No shopper activity recorded yet. Tracking counts visits to <b>open</b> stores from the day it went live — numbers will fill in as parents shop.</div>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FUNNEL_STEPS.map((s, i) => {
            const v = n(t[s.key]);
            const prev = i > 0 ? n(t[FUNNEL_STEPS[i - 1].key]) : null;
            const isLeak = leak && leak.to.key === s.key;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <div style={{ width: 140, color: '#334155', fontWeight: 600, flexShrink: 0 }}>{s.label}</div>
                <div style={{ flex: 1, height: 22, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: Math.max(1, (v / top) * 100) + '%', height: '100%', background: i === FUNNEL_STEPS.length - 1 ? '#16a34a' : '#2563eb', opacity: 1 - i * 0.08 }} />
                </div>
                <div style={{ width: 54, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</div>
                <div style={{ width: 70, textAlign: 'right', fontSize: 11, color: isLeak ? '#b91c1c' : '#94a3b8', fontWeight: isLeak ? 800 : 400 }}>{prev != null ? (prev > 0 ? `${pct(v, prev)}% kept` : '—') : ''}</div>
              </div>
            );
          })}
        </div>
      )}
      {leak && (
        <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#7f1d1d', lineHeight: 1.45 }}>
          <b>Biggest leak: {leak.from.label.toLowerCase()} → {leak.to.label.toLowerCase()}</b> — {Math.round(leak.drop * 100)}% of shoppers ({leak.lost.toLocaleString()}) stop here. {leak.advice}
        </div>
      )}
      {!leak && n(t.visitors) > 0 && n(t.visitors) < MIN_SAMPLE && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Fewer than {MIN_SAMPLE} visitors so far — too early to call where shoppers drop off.</div>
      )}
    </div>
  );
}

export function DeviceCard({ totals }) {
  const t = totals || sumFunnel([]);
  const rows = [['Phone', t.mobile_visitors, t.mobile_purchasers], ['Computer', t.desktop_visitors, t.desktop_purchasers], ['Tablet', t.tablet_visitors, t.tablet_purchasers]]
    .map(([label, v, p]) => ({ label, v: n(v), p: n(p) }));
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div style={card}>
      <div style={hdr}>Phone vs. computer</div>
      <div style={sub}>Share of shoppers, and how often each group buys</div>
      {total === 0 ? <div style={{ fontSize: 13, color: '#64748b', marginTop: 14 }}>No shoppers recorded yet.</div> : (
        <table style={{ width: '100%', marginTop: 10, fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ color: '#94a3b8', fontSize: 11, textAlign: 'left' }}><th style={{ padding: '4px 0' }}>Device</th><th style={{ textAlign: 'right' }}>Shoppers</th><th style={{ textAlign: 'right' }}>Share</th><th style={{ textAlign: 'right' }}>Bought</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.label} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '6px 0', fontWeight: 600 }}>{r.label}</td>
              <td style={{ textAlign: 'right' }}>{r.v.toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>{pct(r.v, total)}%</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: '#166534' }}>{r.v ? pct(r.p, r.v) + '%' : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// Items shoppers look at but rarely add — the "something is off with this item" list.
// `nameFor(row)` labels a row (item name, optionally with its store).
export function InterestCard({ products, nameFor, minViewers = 10, limit = 8 }) {
  const rows = (products || [])
    .filter((r) => n(r.viewers) >= minViewers)
    .map((r) => ({ ...r, rate: n(r.adders) / n(r.viewers) }))
    .sort((a, b) => a.rate - b.rate || n(b.viewers) - n(a.viewers))
    .slice(0, limit);
  return (
    <div style={card}>
      <div style={hdr}>Looked at, not added</div>
      <div style={sub}>Items with {minViewers}+ viewers and the lowest add-to-cart rate — check price, sizes, and photos</div>
      {rows.length === 0 ? <div style={{ fontSize: 13, color: '#64748b', marginTop: 14 }}>Not enough item views yet.</div> : (
        <table style={{ width: '100%', marginTop: 10, fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ color: '#94a3b8', fontSize: 11, textAlign: 'left' }}><th style={{ padding: '4px 0' }}>Item</th><th style={{ textAlign: 'right' }}>Viewed</th><th style={{ textAlign: 'right' }}>Added</th><th style={{ textAlign: 'right' }}>Rate</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.store_id + ':' + r.webstore_product_id} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '6px 8px 6px 0', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nameFor(r)}>{nameFor(r)}</td>
              <td style={{ textAlign: 'right' }}>{n(r.viewers)}</td>
              <td style={{ textAlign: 'right' }}>{n(r.adders)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: r.rate < 0.1 ? '#b91c1c' : '#334155' }}>{Math.round(r.rate * 100)}%</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
