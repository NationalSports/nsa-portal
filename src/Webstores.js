/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// Webstores — read-only admin screen (step 2).
// Reads the migration-011 tables directly (isolated from the central
// _dbLoad/_diffSave engine on purpose, so it can never affect existing
// estimate/SO persistence). Editing/creation comes in a later step.
// ─────────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  open:    { bg: '#dcfce7', fg: '#166534' },
  closed:  { bg: '#dbeafe', fg: '#1e40af' },
  draft:   { bg: '#f1f5f9', fg: '#64748b' },
  archived:{ bg: '#fef3c7', fg: '#92400e' },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg }}>{(status || 'draft').toUpperCase()}</span>;
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumSizes = (jsonb) => Object.values(jsonb || {}).reduce((a, v) => a + (Number(v) || 0), 0);

// Detect "table/relation does not exist" so we can show a helpful message
// instead of a crash while migration 011 is still under review.
function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

function Webstores({ cust = [], REPS = [] }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [sel, setSel] = useState(null);          // selected store row
  const [tab, setTab] = useState('catalog');
  const [detail, setDetail] = useState(null);    // {products, orders, orderItems, roster, claims}
  const [detailLoading, setDetailLoading] = useState(false);

  const custName = useCallback((id) => cust.find((c) => c.id === id)?.name || '—', [cust]);
  const repName = useCallback((id) => REPS.find((r) => r.id === id)?.name || '—', [REPS]);

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    const { data, error } = await supabase.from('webstores').select('*').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true);
      else setErr(error.message);
      setStores([]);
    } else {
      setStores(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  const openStore = useCallback(async (store) => {
    setSel(store); setTab('catalog'); setDetail(null); setDetailLoading(true);
    const sid = store.id;
    const [prodRes, bundleRes, ordRes, itemRes, rosterRes, claimRes] = await Promise.all([
      supabase.from('webstore_storefront_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_orders').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      supabase.from('webstore_order_items').select('*'),
      supabase.from('webstore_roster').select('*').eq('store_id', sid).order('player_name'),
      supabase.from('webstore_number_claims').select('*').eq('store_id', sid).order('player_number'),
    ]);
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const bundleIds = new Set((prodRes.data || []).filter((p) => p.kind === 'bundle').map((p) => p.webstore_product_id));
    setDetail({
      products: prodRes.data || [],
      bundleItems: (bundleRes.data || []).filter((b) => bundleIds.has(b.bundle_id)),
      orders,
      orderItems: (itemRes.data || []).filter((i) => orderIds.has(i.order_id)),
      roster: rosterRes.data || [],
      claims: claimRes.data || [],
    });
    setDetailLoading(false);
  }, []);

  // ── Migration-not-applied state ──────────────────────────────────────
  if (needsMigration) {
    return (
      <div className="card" style={{ maxWidth: 620, margin: '40px auto' }}>
        <div className="card-body" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
          <h2 style={{ margin: '0 0 8px', color: '#1e293b' }}>Webstores not set up yet</h2>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
            The webstore tables haven't been created in the database yet. Apply
            migration <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>supabase_migration_011_webstores.sql</code> in
            the Supabase SQL editor, then reload this page.
            <br /><br />
            The migration is purely additive — it only creates new tables and
            does not touch any existing data.
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={loadStores}>Retry</button>
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 40, color: '#64748b', fontSize: 14 }}>Loading webstores…</div>;
  if (err) return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <div className="card-body" style={{ padding: 24 }}>
        <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Couldn't load webstores</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>{err}</div>
        <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={loadStores}>Retry</button>
      </div>
    </div>
  );

  // ── Detail view ──────────────────────────────────────────────────────
  if (sel) return <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab}
    custName={custName} repName={repName} onBack={() => { setSel(null); setDetail(null); }} />;

  // ── List view ────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{stores.length} store{stores.length === 1 ? '' : 's'}</div>
        <button className="btn btn-primary" disabled title="Store creation comes in the next build step" style={{ opacity: 0.55, cursor: 'not-allowed' }}>+ New Store (coming soon)</button>
      </div>

      {stores.length === 0 ? (
        <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No webstores yet. The tables exist — create the first store once the admin editor ships in the next step.
        </div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {stores.map((s) => (
            <div key={s.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openStore(s)}>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{s.name}</div>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <Chip label={s.payment_mode === 'either' ? 'Paid + Invoice' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'} />
                  {s.fundraise_enabled && <Chip label="Fundraising" tone="green" />}
                  {s.number_enabled && <Chip label={s.number_unique ? 'Unique #s' : 'Numbers'} tone="blue" />}
                  <Chip label={'/shop/' + s.slug} tone="gray" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone = 'slate' }) {
  const tones = { slate: { bg: '#f1f5f9', fg: '#475569' }, green: { bg: '#dcfce7', fg: '#166534' }, blue: { bg: '#dbeafe', fg: '#1e40af' }, gray: { bg: '#f8fafc', fg: '#94a3b8' } };
  const t = tones[tone] || tones.slate;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: t.bg, color: t.fg, fontFamily: tone === 'gray' ? 'monospace' : 'inherit' }}>{label}</span>;
}

function StoreDetail({ store: s, detail, loading, tab, setTab, custName, repName, onBack }) {
  const orders = detail?.orders || [];
  const orderItems = detail?.orderItems || [];
  const products = detail?.products || [];
  const roster = detail?.roster || [];
  const bundleItems = detail?.bundleItems || [];

  const totalSales = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraiseTotal = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const playerCount = new Set(orderItems.map((i) => (i.player_name || '').trim().toLowerCase()).filter(Boolean)).size;
  const notOrdered = roster.filter((r) => !r.ordered);

  const TABS = [
    { id: 'catalog', label: `Catalog (${products.length})` },
    { id: 'orders', label: `Orders (${orders.length})` },
    { id: 'roster', label: roster.length ? `Roster (${roster.length})` : 'Roster' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <>
      <button className="btn btn-sm btn-secondary" onClick={onBack} style={{ marginBottom: 12 }}>← Back to All Stores</button>

      <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.name}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)} · <span style={{ fontFamily: 'monospace' }}>/shop/{s.slug}</span></div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={s.status} />
              {(s.open_at || s.close_at) && <span style={{ fontSize: 11, color: '#64748b' }}>📅 {s.open_at ? new Date(s.open_at).toLocaleDateString() : '—'} → {s.close_at ? new Date(s.close_at).toLocaleDateString() : '—'}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, textAlign: 'right' }}>
            <Stat label="Orders" value={orders.length} />
            <Stat label="Players" value={playerCount} />
            <Stat label="Sales" value={money(totalSales)} />
            {s.fundraise_enabled && <Stat label="Fundraising" value={money(fundraiseTotal)} tone="#166534" />}
          </div>
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {loading ? <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading store details…</div> : (
        <>
          {tab === 'catalog' && <CatalogTab products={products} bundleItems={bundleItems} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} />}
          {tab === 'roster' && <RosterTab roster={roster} notOrdered={notOrdered} />}
          {tab === 'settings' && <SettingsTab store={s} />}
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }) {
  return <div><div style={{ fontSize: 18, fontWeight: 800, color: tone || '#1e293b' }}>{value}</div><div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div></div>;
}

function stockLabel(p) {
  const onHand = sumSizes(p.size_stock);
  if (onHand > 0) return { text: `In stock (${onHand})`, color: '#166534' };
  if (p.on_order_qty > 0) return { text: p.earliest_eta ? `Arriving ~${p.earliest_eta}` : `On order (${p.on_order_qty})`, color: '#92400e' };
  return { text: 'Out of stock', color: '#b91c1c' };
}

function CatalogTab({ products, bundleItems }) {
  if (!products.length) return <Empty msg="No products in this store's catalog yet." />;
  return (
    <div className="card"><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={th}>Product</th><th style={th}>Type</th><th style={th}>Price</th><th style={th}>Stock / ETA</th>
        </tr></thead>
        <tbody>
          {products.map((p) => {
            const st = stockLabel(p);
            const comps = p.kind === 'bundle' ? bundleItems.filter((b) => b.bundle_id === p.webstore_product_id) : [];
            return (
              <tr key={p.webstore_product_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{p.name || p.sku || '(unnamed)'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, p.color, p.category].filter(Boolean).join(' · ')}</div>
                  {comps.length > 0 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    {comps.map((c) => <div key={c.id}>• {c.qty}× {c.sku || c.product_id}{c.size_required ? '' : ' (one size)'}{c.takes_number ? ' #' : ''}</div>)}
                  </div>}
                </td>
                <td style={td}>{p.kind === 'bundle' ? <Chip label="Bundle" tone="blue" /> : <Chip label="Single" />}</td>
                <td style={td}>{money(p.retail_price)}</td>
                <td style={{ ...td, color: st.color, fontWeight: 600 }}>{p.kind === 'bundle' ? '—' : st.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div></div>
  );
}

function OrdersTab({ orders, orderItems, numbersEnabled }) {
  if (!orders.length) return <Empty msg="No orders placed in this store yet." />;
  const itemsByOrder = {};
  orderItems.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  return (
    <div className="card"><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {orders.map((o) => {
            const items = itemsByOrder[o.id] || [];
            const players = [...new Set(items.map((i) => i.player_name).filter(Boolean))];
            const numbers = [...new Set(items.map((i) => i.player_number).filter(Boolean))];
            const lineStatus = items[0]?.line_status || 'pending';
            return (
              <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0)}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(lineStatus || 'pending').replace(/_/g, ' ')} tone={lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div></div>
  );
}

function RosterTab({ roster, notOrdered }) {
  if (!roster.length) return <Empty msg="No roster uploaded. Upload one (coming in a later step) to track who hasn't ordered." />;
  return (
    <>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>{notOrdered.length} of {roster.length} players have not ordered yet.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Player</th><th style={th}>#</th><th style={th}>Parent email</th><th style={th}>Ordered?</th>
          </tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}>{r.player_name}</td><td style={td}>{r.player_number || '—'}</td><td style={td}>{r.parent_email || '—'}</td>
                <td style={td}>{r.ordered ? <Chip label="Ordered" tone="green" /> : <Chip label="Not yet" tone="gray" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

function SettingsTab({ store: s }) {
  const rows = [
    ['Slug', '/shop/' + s.slug],
    ['Status', (s.status || 'draft').toUpperCase()],
    ['Payment mode', s.payment_mode === 'either' ? 'Card + invoice-later' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'],
    ['Login required', s.require_login ? 'Yes (club members only)' : 'No (public)'],
    ['Shipping', 'Ship (ShipStation)'],
    ['Numbers', s.number_enabled ? `Enabled (${s.number_min}–${s.number_max}${s.number_unique ? ', unique' : ''})` : 'Off'],
    ['SO creation', s.so_creation],
    ['Fundraising', s.fundraise_enabled ? `On (${s.fundraise_pct ? s.fundraise_pct * 100 + '%' : money(s.fundraise_flat) + '/item'}${s.fundraise_show_parents ? ', shown to parents' : ''})` : 'Off'],
    ['Theme', s.theme || 'classic'],
  ];
  return (
    <div className="card"><div style={{ padding: 16 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
          <div style={{ width: 160, color: '#64748b' }}>{k}</div><div style={{ fontWeight: 600 }}>{v}</div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>Editing settings comes in the next build step. This view is read-only.</div>
    </div></div>
  );
}

function Empty({ msg }) {
  return <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>{msg}</div></div>;
}

const th = { padding: '10px 12px', fontWeight: 600 };
const td = { padding: '10px 12px', verticalAlign: 'top' };

export default Webstores;
