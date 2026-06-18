/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { SZ_ORD, pantoneHex, NSA, prodFilesStatusFor } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs, safeFirm, safeArt, resolveMockLink, mockLinkDependents, mockLinkSourceFiles } from './safeHelpers';
import { calcSOStatus } from './components';
import { dP, rQ, SP } from './pricing';
import { _portalAction, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, printDoc, buildDocHtml, pdfDecoLabel, getBillingContacts, invokeEdgeFn, cloudUpload } from './utils';
import { StripePaymentModal } from './modals';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './lib/supabase';
import { CatalogKitStyles, KitScope, DISPLAY } from './ui/catalogKit';
import { fetchStockMap } from './lib/storeInventory';

// Read-only team-store view for the coach: headline order/fundraising/batch
// summary up top, with the per-player order list as a searchable, collapsible
// section below. No editing.
const _cpMoney = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _cpStages = { pending: 'Ordered', received: 'Received', in_production: 'In production', bagging: 'Bagging', shipped: 'Shipped', complete: 'Complete' };
const _cpTone = (s) => s === 'complete' ? '#166534' : s === 'shipped' ? '#1e40af' : s === 'bagging' ? '#86198f' : s === 'in_production' ? '#92400e' : s === 'received' ? '#3730a3' : '#64748b';

function CoachStore({ customer }) {
  const [stores, setStores] = useState([]);
  const [data, setData] = useState({}); // storeId -> {orders, items, roster}
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const ids = [customer.id, customer.parent_id].filter(Boolean);
      const { data: ws, error } = await supabase.from('webstores').select('*').in('customer_id', ids);
      if (cancel) return;
      if (error || !ws || !ws.length) { setLoaded(true); return; }
      setStores(ws);
      const out = {};
      for (const s of ws) {
        const [o, r] = await Promise.all([
          supabase.from('webstore_orders').select('*').eq('store_id', s.id).order('created_at', { ascending: false }),
          supabase.from('webstore_roster').select('*').eq('store_id', s.id),
        ]);
        const orders = o.data || [];
        const orderIds = orders.map((x) => x.id);
        let items = [];
        if (orderIds.length) { const it = await supabase.from('webstore_order_items').select('*').in('order_id', orderIds); items = it.data || []; }
        out[s.id] = { orders, items, roster: r.data || [] };
      }
      if (!cancel) { setData(out); setLoaded(true); }
    })();
    return () => { cancel = true; };
  }, [customer.id, customer.parent_id]);

  if (!loaded || !stores.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      {stores.map((s) => <CoachStoreCard key={s.id} store={s} d={data[s.id] || { orders: [], items: [], roster: [] }} />)}
    </div>
  );
}

function CoachStoreCard({ store: s, d }) {
  const [q, setQ] = useState('');
  const [showOrders, setShowOrders] = useState(false);
  const [openOrder, setOpenOrder] = useState(null);
  const itemsByOrder = {}; d.items.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  // Active orders exclude abandoned pre-payment carts and cancellations.
  const active = d.orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_payment');
  const players = new Set(d.items.map((i) => (i.player_name || '').trim().toLowerCase()).filter(Boolean));
  const units = d.items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0);
  const fundraising = active.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const sales = active.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const paidCount = active.filter((o) => o.payment_mode === 'paid').length;
  const notOrdered = (d.roster || []).filter((r) => !r.ordered);

  // Group batched orders by Sales Order; derive a representative status.
  const batchMap = {}; active.forEach((o) => { if (o.so_id) (batchMap[o.so_id] = batchMap[o.so_id] || []).push(o); });
  const batchStatus = (ords) => {
    const its = ords.flatMap((o) => itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent);
    const stages = its.map((i) => i.line_status || 'pending');
    if (stages.length && stages.every((x) => x === 'complete')) return 'complete';
    if (stages.some((x) => x === 'shipped' || x === 'complete')) return 'shipped';
    if (stages.some((x) => x === 'in_production')) return 'in_production';
    return 'pending';
  };
  const batches = Object.entries(batchMap).map(([soId, ords]) => ({ soId, count: ords.length, status: batchStatus(ords) }));
  const unbatched = active.filter((o) => !o.so_id).length;

  const orderRows = active.filter((o) => {
    if (!q.trim()) return true;
    const its = itemsByOrder[o.id] || [];
    const hay = `${o.buyer_name || ''} ${o.buyer_email || ''} ${its.map((i) => i.player_name).filter(Boolean).join(' ')} ${its.map((i) => i.player_number).filter(Boolean).join(' ')}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const Kpi = ({ label, value, color }) => (
    <div style={{ flex: '1 1 110px', minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || '#0b1220' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>🛍️ {s.name} <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>· team store</span></div>
        <a href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#bfdbfe', textDecoration: 'none' }}>Visit store ↗</a>
      </div>
      <div style={{ padding: 16 }}>
        {/* Headline KPIs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
          <Kpi label="Orders" value={active.length} />
          <Kpi label="Players" value={players.size} />
          <Kpi label="Items" value={units} />
          <Kpi label="Sales" value={_cpMoney(sales)} />
          <Kpi label="Fundraising" value={_cpMoney(fundraising)} color="#166534" />
          <Kpi label="Paid / Tab" value={`${paidCount} / ${active.length - paidCount}`} />
        </div>

        {/* Store batches */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 8 }}>Production batches</div>
          {batches.length === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b' }}>No batches yet{unbatched ? ` — ${unbatched} order${unbatched === 1 ? '' : 's'} waiting to be batched.` : '.'}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {batches.map((b) => (
                <div key={b.soId} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>{b.soId}</span>
                  <span style={{ color: '#64748b' }}>{b.count} order{b.count === 1 ? '' : 's'}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: _cpTone(b.status) }}>{_cpStages[b.status]}</span>
                </div>
              ))}
              {unbatched > 0 && <div style={{ fontSize: 12, color: '#92400e' }}>+ {unbatched} new order{unbatched === 1 ? '' : 's'} not yet batched.</div>}
            </div>
          )}
        </div>

        {/* Not-yet-ordered roster */}
        {notOrdered.length > 0 && <div style={{ marginTop: 14, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
          <b>Not yet ordered ({notOrdered.length}):</b> {notOrdered.map((r) => r.player_name + (r.player_number ? ' #' + r.player_number : '')).join(', ')}
        </div>}

        {/* Player orders — collapsible + searchable */}
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          <button onClick={() => setShowOrders((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#0b1220', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ transform: showOrders ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>▶</span>
            Player orders ({active.length})
          </button>
          {showOrders && (
            <div style={{ marginTop: 10 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, parent, email or number…" style={{ width: '100%', maxWidth: 360, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />
              {active.length === 0 ? <div style={{ fontSize: 13, color: '#64748b' }}>No orders yet.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}><th style={{ padding: 6, width: 18 }}></th><th style={{ padding: 6 }}>Player</th><th style={{ padding: 6 }}>#</th><th style={{ padding: 6 }}>Items</th><th style={{ padding: 6 }}>Paid?</th><th style={{ padding: 6 }}>Status</th></tr></thead>
                    <tbody>
                      {orderRows.map((o) => { const its = itemsByOrder[o.id] || []; const player = [...new Set(its.map((i) => i.player_name).filter(Boolean))].join(', '); const num = [...new Set(its.map((i) => i.player_number).filter(Boolean))].join(', '); const ls = its[0]?.line_status || 'pending'; const qty = its.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0); const open = openOrder === o.id; const lineItems = its.filter((i) => !i.is_bundle_parent); return (
                        <React.Fragment key={o.id}>
                        <tr onClick={() => setOpenOrder(open ? null : o.id)} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: open ? '#f8fafc' : 'transparent' }}>
                          <td style={{ padding: 6, color: '#94a3b8' }}>{open ? '▾' : '▸'}</td>
                          <td style={{ padding: 6 }}>{player || o.buyer_name || '—'}</td>
                          <td style={{ padding: 6 }}>{num || '—'}</td>
                          <td style={{ padding: 6 }}>{qty}</td>
                          <td style={{ padding: 6 }}>{o.payment_mode === 'paid' ? 'Paid' : 'Team tab'}</td>
                          <td style={{ padding: 6, fontWeight: 700, color: _cpTone(ls) }}>{_cpStages[ls] || ls}</td>
                        </tr>
                        {open && <tr><td></td><td colSpan={5} style={{ padding: '4px 6px 12px', background: '#f8fafc' }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0' }}>Ordered by {o.buyer_name || '—'}{o.buyer_email ? ` · ${o.buyer_email}` : ''}</div>
                          {lineItems.map((i) => (
                            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderTop: '1px solid #eef1f5' }}>
                              <span>{i.sku || 'Item'}{i.size ? ' · ' + i.size : ''}{i.player_number ? ' · #' + i.player_number : ''}{i.player_name ? ' · ' + i.player_name : ''}{i.qty > 1 ? ` · ×${i.qty}` : ''}</span>
                              <span style={{ color: _cpTone(i.line_status || 'pending'), fontWeight: 600 }}>{_cpStages[i.line_status || 'pending'] || i.line_status}</span>
                            </div>
                          ))}
                        </td></tr>}
                        </React.Fragment>
                      ); })}
                      {orderRows.length === 0 && <tr><td colSpan={6} style={{ padding: 10, color: '#94a3b8' }}>No orders match “{q}”.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One pickable catalog item in the coach builder, in the live-look card style.
// Shows the LOCKED price and live in-stock sizes; selection is a tap.
function CoachPickCard({ p, on, onToggle }) {
  const [imgErr, setImgErr] = useState(false);
  const sizes = p._stock?.sizes || [];
  return (
    <button type="button" className="ai-card" onClick={onToggle} aria-pressed={on} style={{ outline: on ? '2px solid #191919' : '2px solid transparent', outlineOffset: -2 }}>
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        {p.image_url && !imgErr
          ? <img src={p.image_url} alt="" loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain', opacity: on ? 1 : 0.85 }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>No image</div>}
        <span style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, background: on ? '#191919' : 'rgba(255,255,255,.9)', border: '1px solid ' + (on ? '#191919' : '#cbd5e1'), color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{on ? '✓' : ''}</span>
        <span style={{ position: 'absolute', top: 8, right: 8, background: '#191919', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 12.5, fontWeight: 700 }}>{_cpMoney((p.price || 0) + (p.fundraise || 0))}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', textAlign: 'left', width: '100%' }}>
        {p.brand && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{p.brand}</div>}
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 14.5, lineHeight: 1.12, textTransform: 'uppercase' }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: '#6A7180', marginTop: 2 }}>{[p.category, p.color].filter(Boolean).join(' · ') || ' '}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#166534' }}>{p._stock?.units || 0} in stock</span>
          {sizes.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6A7180' }}>{sizes.slice(0, 7).join(' · ')}{sizes.length > 7 ? ` +${sizes.length - 7}` : ''}</span>}
        </div>
      </div>
    </button>
  );
}

// Map common apparel color words to a swatch hex. Returns null when we can't
// confidently resolve one, so the caller can fall back to a labeled chip.
const COACH_COLOR_HEX = { black: '#191919', white: '#ffffff', royal: '#1e40af', navy: '#1e293b', red: '#dc2626', scarlet: '#dc2626', cardinal: '#9b1c31', maroon: '#7f1d1d', burgundy: '#7f1d1d', gold: '#d4af37', vegas: '#d4af37', yellow: '#facc15', kelly: '#15803d', forest: '#14532d', green: '#16a34a', orange: '#ea580c', purple: '#7c3aed', pink: '#ec4899', charcoal: '#374151', graphite: '#374151', grey: '#9ca3af', gray: '#9ca3af', silver: '#cbd5e1', brown: '#92400e', teal: '#0d9488', carolina: '#7dd3fc', columbia: '#60a5fa', 'light blue': '#7dd3fc', 'team royal': '#1e40af', cream: '#f5f0e1', natural: '#f5f0e1' };
const coachColorHex = (name) => { const s = (name || '').toLowerCase(); for (const k of Object.keys(COACH_COLOR_HEX)) { if (s.includes(k)) return COACH_COLOR_HEX[k]; } return null; };
const coachIsLight = (hex) => { const h = (hex || '').replace('#', ''); if (h.length < 6) return true; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 160; };

// One STYLE in the coach builder, with its colorways as pickable swatches.
// Each swatch toggles a specific colorway (product_id) into the selection, so a
// coach can carry the same shirt in several colors — just like the live-look.
function CoachStyleCard({ g, sel, onToggle }) {
  const [imgErr, setImgErr] = useState(false);
  const selected = g.colorways.filter((c) => sel.has(c.product_id));
  const lead = selected[0] || g.colorways[0];
  const priceMin = Math.min(...g.colorways.map((c) => (c.price || 0) + (c.fundraise || 0)));
  const anyOn = selected.length > 0;
  return (
    <div className="ai-card" style={{ outline: anyOn ? '2px solid #191919' : '2px solid transparent', outlineOffset: -2, cursor: 'default' }}>
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        {lead.image_url && !imgErr
          ? <img src={lead.image_url} alt="" loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>No image</div>}
        {anyOn && <span style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, background: '#191919', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{selected.length}</span>}
        <span style={{ position: 'absolute', top: 8, right: 8, background: '#191919', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 12.5, fontWeight: 700 }}>{_cpMoney(priceMin)}{g.colorways.length > 1 ? '+' : ''}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', textAlign: 'left', width: '100%' }}>
        {g.brand && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{g.brand}</div>}
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 14.5, lineHeight: 1.12, textTransform: 'uppercase' }}>{g.name}</div>
        <div style={{ fontSize: 11.5, color: '#6A7180', marginTop: 2 }}>{g.category || ' '}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
          {g.colorways.map((c) => {
            const on = sel.has(c.product_id);
            const hex = coachColorHex(c.color);
            const title = `${c.color || 'Color'} · ${c._stock?.units || 0} in stock`;
            if (!hex) return (
              <button key={c.product_id} type="button" title={title} onClick={() => onToggle(c.product_id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, cursor: 'pointer', border: on ? '2px solid #191919' : '1px solid #cbd5e1', background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150' }}>
                {on ? '✓ ' : ''}{c.color || 'Color'}
              </button>
            );
            return (
              <button key={c.product_id} type="button" title={title} onClick={() => onToggle(c.product_id)}
                style={{ width: 26, height: 26, borderRadius: '50%', background: hex, cursor: 'pointer', border: on ? '2px solid #191919' : '1px solid #cbd5e1', position: 'relative', boxShadow: on ? '0 0 0 2px #fff inset' : 'none' }}>
                {on && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: coachIsLight(hex) ? '#191919' : '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: '#6A7180', marginTop: 7, fontWeight: 600 }}>{anyOn ? `${selected.length} color${selected.length === 1 ? '' : 's'} added` : `${g.colorways.length} color${g.colorways.length === 1 ? '' : 's'} — tap to pick`}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Coach self-serve store builder — a constrained sibling of the staff builder.
// Coaches pick from a PRE-APPROVED pool (a staff template's items if any exist,
// else the coach_store_config allow-list), at LOCKED prices, IN-STOCK only
// (out-of-stock is hard-hidden — no toggle), brand it, and submit for approval.
// Everything is re-enforced server-side by coach-store-submit; this is the
// friendly guided front end.
// ─────────────────────────────────────────────────────────
function CoachStoreBuilder({ customer, onClose }) {
  const [step, setStep] = useState('start');   // start | items | brand | review | done
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null); // null = allow-list mode
  const [pool, setPool] = useState([]);         // in-stock, price-locked pool
  const [poolErr, setPoolErr] = useState('');
  const [search, setSearch] = useState('');
  const [brief, setBrief] = useState('');
  const [aiSpec, setAiSpec] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [name, setName] = useState(customer?.name ? `${customer.name} Team Store` : 'Team Store');
  const [primary, setPrimary] = useState('#1e3a5f');
  const [accent, setAccent] = useState('#2563eb');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [submitErr, setSubmitErr] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase.from('webstores').select('id,name').eq('is_template', true).order('name');
      if (cancel) return;
      const t = data || [];
      setTemplates(t);
      setLoading(false);
      if (!t.length) { setTemplateId(null); setStep('items'); loadPool(null); } // no templates → straight to catalog
    })();
    return () => { cancel = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the in-stock, price-locked pool for the chosen source.
  const loadPool = async (tid) => {
    setLoading(true); setPoolErr(''); setPool([]); setSel(new Set());
    try {
      let items = [];
      if (tid) {
        const { data: tItems } = await supabase.from('webstore_products')
          .select('product_id,sku,display_name,image_url,retail_price,fundraise_amount')
          .eq('store_id', tid).eq('active', true).eq('kind', 'single');
        const rows = (tItems || []).filter((r) => r.product_id);
        const ids = rows.map((r) => r.product_id);
        const meta = {};
        if (ids.length) {
          const { data: pr } = await supabase.from('products').select('id,sku,name,brand,color,category,image_front_url').in('id', ids);
          for (const p of pr || []) meta[p.id] = p;
        }
        items = rows.map((r) => { const m = meta[r.product_id] || {}; return {
          product_id: r.product_id, sku: r.sku || m.sku, name: r.display_name || m.name || r.sku,
          brand: m.brand || '', color: m.color || '', category: m.category || '',
          image_url: r.image_url || m.image_front_url || '',
          price: Number(r.retail_price) || 0, fundraise: Number(r.fundraise_amount) || 0,
        }; });
      } else {
        const { data: cfg } = await supabase.from('coach_store_config').select('*').eq('id', 1).maybeSingle();
        const brands = cfg?.allowed_brands || []; const cats = cfg?.allowed_categories || []; const dFund = Number(cfg?.default_fundraise) || 0;
        let q = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,catalog_sell_price,image_front_url').eq('is_active', true).or('is_archived.is.null,is_archived.eq.false').limit(400);
        if (brands.length) q = q.in('brand', brands);
        if (cats.length) q = q.in('category', cats);
        const { data: pr } = await q;
        items = (pr || []).map((p) => ({
          product_id: p.id, sku: p.sku, name: p.name || p.sku, brand: p.brand || '', color: p.color || '', category: p.category || '',
          image_url: p.image_front_url || '',
          price: p.catalog_sell_price != null ? Number(p.catalog_sell_price) : Number(p.retail_price) || 0,
          fundraise: dFund,
        }));
      }
      // Hard in-stock filter — coaches never see dead stock.
      const stock = await fetchStockMap(items.map((i) => ({ id: i.product_id, sku: i.sku })));
      const inStock = items
        .map((i) => ({ ...i, _stock: stock.get(i.product_id) || { units: 0, sizes: [] } }))
        .filter((i) => (i._stock.units || 0) > 0);
      setPool(inStock);
      // Template items are pre-curated → default all selected; catalog → start empty.
      setSel(new Set(tid ? inStock.map((i) => i.product_id) : []));
    } catch (e) { setPoolErr(e.message || String(e)); }
    setLoading(false);
  };

  const runBrief = async () => {
    if (!brief.trim()) { setAiSpec(null); return; }
    setAiBusy(true);
    try {
      const d = await invokeEdgeFn(supabase, 'ai-store-builder', { brief: brief.trim() });
      setAiSpec(d?.ok ? d.spec : null);
    } catch { setAiSpec(null); }
    setAiBusy(false);
  };

  // Filtered = approved pool narrowed by search + the AI brief (never widened).
  const q = search.trim().toLowerCase();
  let filtered = pool;
  if (q) filtered = filtered.filter((r) => (r.name + ' ' + (r.sku || '') + ' ' + r.color + ' ' + r.brand).toLowerCase().includes(q));
  if (aiSpec) {
    const sb = (aiSpec.brands || []).map((b) => b.toLowerCase());
    const sc = (aiSpec.categories || []).map((c) => c.toLowerCase());
    const scol = (aiSpec.colors || []).map((c) => c.toLowerCase());
    const skw = (aiSpec.keywords || []).map((k) => k.toLowerCase());
    filtered = filtered.filter((r) => {
      if (sb.length && !sb.includes((r.brand || '').toLowerCase())) return false;
      if (sc.length && !sc.includes((r.category || '').toLowerCase())) return false;
      if ((scol.length || skw.length) && !(scol.some((c) => (r.color || '').toLowerCase().includes(c)) || skw.some((k) => (r.name || '').toLowerCase().includes(k)))) return false;
      return true;
    });
  }
  // Group colorways into styles so coaches pick a product then its colors.
  const groupMap = new Map();
  for (const it of filtered) {
    const key = (it.name || it.sku || '').toUpperCase();
    let g = groupMap.get(key);
    if (!g) { g = { key, name: it.name, brand: it.brand, category: it.category, colorways: [] }; groupMap.set(key, g); }
    g.colorways.push(it);
  }
  const groups = [...groupMap.values()].slice(0, 90);

  const chosen = pool.filter((p) => sel.has(p.product_id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setLogoBusy(true);
    try { const url = await cloudUpload(f, 'nsa-store-logos'); setLogoUrl(url); } catch (err) { alert('Logo upload failed: ' + (err.message || err)); }
    setLogoBusy(false);
  };

  const submit = async () => {
    setSubmitting(true); setSubmitErr('');
    try {
      const d = await invokeEdgeFn(supabase, 'coach-store-submit', {
        alpha_tag: customer.alpha_tag, customer_id: customer.id, name: name.trim(),
        template_id: templateId, item_product_ids: chosen.map((c) => c.product_id),
        branding: { primary_color: primary, accent_color: accent, logo_url: logoUrl, hero_blurb: blurb.trim(), coach_contact_email: (customer.contacts || [])[0]?.email || '' },
      });
      if (!d?.ok) throw new Error(d?.error || 'Submission failed.');
      setResult(d); setStep('done');
    } catch (e) { setSubmitErr(e.message || String(e)); }
    setSubmitting(false);
  };

  const ink = '#191919';
  const stepIdx = { items: 1, brand: 2, review: 3 }[step] || 0;
  const headBtn = { background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <CatalogKitStyles />
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={onClose} style={headBtn}>← Back to portal</button>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: '.02em' }}>Build Your Team Store</div>
        <div style={{ width: 110, textAlign: 'right', fontSize: 11.5, opacity: 0.9, fontWeight: 700 }}>{stepIdx ? `Step ${stepIdx} of 3` : ''}</div>
      </div>

      <KitScope style={{ maxWidth: 1120, margin: '0 auto', padding: '22px 16px 130px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 10px', fontWeight: 600 }}>Loading…</div>
        ) : step === 'start' ? (
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Pick a starting point</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 18 }}>Start from one of our ready-made store templates — we'll pre-fill the items and pricing, and you just tweak it. Or browse the catalog yourself.</div>
            <div className="ai-grid">
              {templates.map((t) => (
                <button key={t.id} type="button" className="ai-card" onClick={() => { setTemplateId(t.id); setStep('items'); loadPool(t.id); }} style={{ padding: 0 }}>
                  <div style={{ padding: '26px 16px', width: '100%', textAlign: 'left' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#2563eb' }}>Template</div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1, marginTop: 4 }}>{t.name}</div>
                    <div style={{ fontSize: 12.5, color: '#6A7180', marginTop: 10, fontWeight: 700 }}>Use this template →</div>
                  </div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setTemplateId(null); setStep('items'); loadPool(null); }}
              style={{ marginTop: 18, background: 'none', border: 'none', color: '#2563eb', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', padding: 0 }}>
              Or browse the full catalog instead →
            </button>
          </div>
        ) : step === 'items' ? (
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Choose your items</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 14 }}>
              {templateId ? 'Your template items are pre-selected — tap to add or remove. ' : 'Tap items to add them to your store. '}
              Only items that are in stock right now are shown, and prices are set for you.
            </div>
            <textarea className="ai-search" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runBrief(); }}
              placeholder={'Optional — describe what you want and we\'ll narrow it down (e.g. "black and white tees and hoodies")'}
              style={{ resize: 'vertical', minHeight: 52, lineHeight: 1.4 }} aria-label="Describe your store" />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="ai-more" style={{ margin: 0 }} onClick={runBrief} disabled={aiBusy || !brief.trim()}>{aiBusy ? 'Thinking…' : 'Narrow with AI'}</button>
              {aiSpec && <button type="button" className="ai-iconbtn" onClick={() => { setAiSpec(null); setBrief(''); }}>Clear</button>}
              <input className="ai-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ flex: 1, minWidth: 160 }} aria-label="Search items" />
            </div>
            {poolErr && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600, marginTop: 12 }}>{poolErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} selected · {groups.length} style{groups.length === 1 ? '' : 's'} shown</div>
              {chosen.length > 0 && <button type="button" className="ai-iconbtn" onClick={() => setSel(new Set())}>Clear all</button>}
            </div>
            {groups.length === 0 ? (
              <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>
                {pool.length === 0 ? 'No in-stock items are available to build from right now — please check with your rep.' : 'Nothing matches that — clear the search or AI filter to see all available items.'}
              </div>
            ) : (
              <div className="ai-grid">
                {groups.map((g) => <CoachStyleCard key={g.key} g={g} sel={sel} onToggle={toggle} />)}
              </div>
            )}
          </div>
        ) : step === 'brand' ? (
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Brand your store</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 18 }}>Give it a name, your team colors, and a logo. You can tell us anything else in the notes.</div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 }}>Store name</label>
            <input className="ai-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lincoln HS Baseball Store" aria-label="Store name" />
            <div style={{ display: 'flex', gap: 18, marginTop: 18, flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 }}>Primary color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} style={{ width: 46, height: 38, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' }} aria-label="Primary color" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#3A4150', fontFamily: 'monospace' }}>{primary}</span>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 }}>Accent color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 46, height: 38, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' }} aria-label="Accent color" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#3A4150', fontFamily: 'monospace' }}>{accent}</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 }}>Team logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 76, height: 76, borderRadius: 12, border: '1px dashed #cbd5e1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {logoUrl ? <img src={logoUrl} alt="logo" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} /> : <span style={{ color: '#A8AEB8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>No logo</span>}
                </div>
                <label className="ai-more" style={{ margin: 0, cursor: 'pointer' }}>
                  {logoBusy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/*" onChange={onLogo} style={{ display: 'none' }} disabled={logoBusy} />
                </label>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 }}>Notes for our team (optional)</label>
              <textarea className="ai-search" rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Open/close dates, special requests, anything we should know…" style={{ resize: 'vertical' }} aria-label="Notes" />
            </div>
          </div>
        ) : step === 'review' ? (
          <div style={{ maxWidth: 720 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Review &amp; submit</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 18 }}>Here's your store. When you submit, our team reviews it and publishes it — you'll get an email when it's live.</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #eef0f3' }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, background: primary, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} /> : <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{(name || '?').slice(0, 1)}</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1 }}>{name || 'Untitled store'}</div>
                <div style={{ fontSize: 13, color: '#6A7180', marginTop: 3 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} · prices set for you</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: primary, border: '1px solid #e2e8f0' }} />
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: accent, border: '1px solid #e2e8f0' }} />
                </div>
              </div>
            </div>
            <div className="ai-grid" style={{ marginTop: 16 }}>
              {chosen.slice(0, 12).map((p) => <CoachPickCard key={p.product_id} p={p} on onToggle={() => {}} />)}
            </div>
            {chosen.length > 12 && <div style={{ color: '#6A7180', fontSize: 13, marginTop: 10, fontWeight: 600 }}>+ {chosen.length - 12} more item{chosen.length - 12 === 1 ? '' : 's'}</div>}
            {submitErr && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 700, marginTop: 14 }}>{submitErr}</div>}
          </div>
        ) : step === 'done' ? (
          <div style={{ maxWidth: 560, textAlign: 'center', padding: '40px 10px' }}>
            <div style={{ fontSize: 46 }}>🎉</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, textTransform: 'uppercase', letterSpacing: '.01em', marginTop: 6 }}>Store submitted!</div>
            <div style={{ color: '#5A616E', fontSize: 15, marginTop: 8 }}>
              Thanks! <b>{name}</b> was sent to our team with {result?.count || chosen.length} item{(result?.count || chosen.length) === 1 ? '' : 's'}. We'll review it, set up shipping &amp; checkout, and publish it — you'll get an email when it's live.
            </div>
            <button type="button" onClick={onClose} className="ai-more" style={{ marginTop: 22 }}>Back to my portal</button>
          </div>
        ) : null}
      </KitScope>

      {/* Sticky action bar — the primary next step for each screen */}
      {!loading && step !== 'start' && step !== 'done' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, zIndex: 20, boxShadow: '0 -4px 16px rgba(0,0,0,.05)' }}>
          <button type="button" onClick={() => setStep(step === 'items' ? (templates.length ? 'start' : 'items') : step === 'brand' ? 'items' : 'brand')}
            style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 9, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, color: '#3A4150', cursor: 'pointer', visibility: step === 'items' && !templates.length ? 'hidden' : 'visible' }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} selected</span>
            {step === 'items' && (
              <button type="button" disabled={!chosen.length} onClick={() => setStep('brand')}
                style={{ background: chosen.length ? ink : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 800, cursor: chosen.length ? 'pointer' : 'not-allowed' }}>Continue to branding →</button>
            )}
            {step === 'brand' && (
              <button type="button" disabled={!name.trim()} onClick={() => setStep('review')}
                style={{ background: name.trim() ? ink : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 800, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>Review →</button>
            )}
            {step === 'review' && (
              <button type="button" disabled={submitting || !chosen.length} onClick={submit}
                style={{ background: submitting ? '#64748b' : '#166534', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}>{submitting ? 'Submitting…' : 'Submit for approval'}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CoachPortal({customer,allCustomers,sos,ests,invs:initInvs,REPS,prod,onUpdateInvs,onUpdateSOs,onUpdateEsts,savSOFn,portalSettings}){
  const _portalDisclaimer=portalSettings?.disclaimer||'';
  const[jobView,setJobView]=useState(null);
  const[invView,setInvView]=useState(null);
  const[estView,setEstView]=useState(null);
  const[soView,setSoView]=useState(null);
  const[comment,setComment]=useState('');
  const[contactEdit,setContactEdit]=useState(null);
  const[contactMsg,setContactMsg]=useState('');
  const[updateRequestText,setUpdateRequestText]=useState('');
  const[updateRequestSent,setUpdateRequestSent]=useState(false);
  const[showPay,setShowPay]=useState(null);// null | 'all' | inv object
  const[payLoading,setPayLoading]=useState(false);// loading state for pay button feedback
  const[paySuccess,setPaySuccess]=useState(null);// {amount,fee,invoices}
  const[invs,setInvs]=useState(initInvs);
  const[lightbox,setLightbox]=useState(null);// url string for lightbox overlay
  const[storeBuilder,setStoreBuilder]=useState(false);// coach self-serve store builder view
  useEffect(()=>setInvs(initInvs),[initInvs]);
  const isP=!customer.parent_id;
  const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  const custSOs=sos.filter(s=>ids.includes(s.customer_id));
  const custEsts=ests.filter(e=>ids.includes(e.customer_id));
  // Shared estimate total — sums sizes, falling back to est_qty when there's no
  // strict size breakdown, so list cards match the estimate detail/internal pricing.
  const calcEstTotal=(est)=>{
    const eaf=est.art_files||[];const _eAQ={};
    (est.items||[]).forEach(it=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const q2=_sq>0?_sq:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const sub=(est.items||[]).reduce((a,it)=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=_sq>0?_sq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const _sh=est.shipping_type==='pct'?sub*(est.shipping_value||0)/100:(est.shipping_value||0);
    const _tr=customer?.tax_exempt?0:(customer?.tax_rate||0);
    return sub+_sh+sub*_tr;
  };
  const activeSOs=custSOs.filter(s=>calcSOStatus(s)!=='complete');
  const completedSOs=custSOs.filter(s=>calcSOStatus(s)==='complete');
  // Recent (last 30 days) not-yet-converted estimates, surfaced in Active Orders.
  const _estRecentCutoff=Date.now()-30*24*60*60*1000;
  const recentEsts=custEsts.filter(e=>{if(e.status==='converted')return false;const t=new Date(e.created_at).getTime();return isFinite(t)&&t>=_estRecentCutoff;});
  const custInvs=invs.filter(inv=>ids.includes(inv.customer_id));
  const openInvs=custInvs.filter(inv=>inv.status==='open'||inv.status==='partial');
  const paidInvs=custInvs.filter(inv=>inv.status==='paid');
  const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
  const rep=REPS.find(r=>r.id===customer.primary_rep_id);
  const allPortalJobs=[];activeSOs.forEach(so=>{safeJobs(so).forEach(j=>{allPortalJobs.push({...j,so,soMemo:so.memo})})});
  // Resolve CC-pay setting; sub-customers inherit from their parent.
  const _parentForCC=customer.parent_id?(allCustomers||[]).find(c=>c.id===customer.parent_id):null;
  const ccDisabled=!!(customer.disable_cc_pay||(_parentForCC&&_parentForCC.disable_cc_pay));
  // Artwork awaiting coach approval — surface at top of portal
  const waitingArtJobs=allPortalJobs.filter(j=>j.art_status==='waiting_approval');
  const artLabelsP={needs_art:'Art Needed',art_requested:'Art Requested',art_in_progress:'Art In Progress',waiting_approval:'Awaiting Your Approval',production_files_needed:'Art Approved — Waiting',art_complete:'Approved'};
  const prodLabelsP={hold:'On Hold',staging:'In Line',in_process:'In Production',completed:'Done',shipped:'Shipped'};
  const contactEmail=(customer.contacts||[])[0]?.email||'';

  // Track portal visit — mark sent documents as viewed by coach
  const _portalTracked=useRef(false);
  useEffect(()=>{
    if(_portalTracked.current)return;_portalTracked.current=true;
    const now=new Date().toLocaleString();
    // Mark estimates with email_status='sent' as viewed
    const sentEsts=custEsts.filter(e=>e.email_status==='sent'&&!e.email_viewed_at);
    if(sentEsts.length&&onUpdateEsts)onUpdateEsts(prev=>prev.map(e=>sentEsts.some(se=>se.id===e.id)?{...e,email_status:'opened',email_viewed_at:now,updated_at:now}:e));
    // Mark SOs with email_status='sent' as viewed
    const sentSOs=custSOs.filter(s=>s.email_status==='sent'&&!s.email_viewed_at);
    if(sentSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>sentSOs.some(ss=>ss.id===s.id)?{...s,email_status:'opened',email_viewed_at:now,updated_at:now}:s));
    // Mark invoices with email_status='sent' as viewed
    const sentInvs=custInvs.filter(i=>i.email_status==='sent'&&!i.email_viewed_at);
    if(sentInvs.length){
      const updater=prev=>prev.map(i=>sentInvs.some(si=>si.id===i.id)?{...i,email_status:'opened',email_viewed_at:now,updated_at:now}:i);
      setInvs(updater);if(onUpdateInvs)onUpdateInvs(updater);
    }
    // Mark job art approvals as viewed when coach opens portal
    const jobSOs=custSOs.filter(s=>safeJobs(s).some(j=>j.sent_to_coach_at&&!j.coach_email_opened_at));
    if(jobSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>{if(!jobSOs.some(js=>js.id===s.id))return s;const updJobs=safeJobs(s).map(j=>j.sent_to_coach_at&&!j.coach_email_opened_at?{...j,coach_email_opened_at:new Date().toISOString()}:j);return{...s,jobs:updJobs,updated_at:now}}));
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePaymentSuccess=(result)=>{
    // Async methods (ACH/bank, and occasionally cards) come back as 'processing': the payment is
    // submitted but not settled, so we must NOT mark the invoice paid yet — settlement is confirmed
    // later by the Stripe webhook (a few business days for ACH). Just show a pending banner so the
    // buyer isn't falsely told the payment failed.
    if(result.status==='processing'){
      setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices||[],processing:true});
      setShowPay(null);setInvView(null);setPayLoading(false);
      return;
    }
    // Update invoices locally and in parent (persists to Supabase/localStorage/QB)
    const paidInvIds=result.invoices.map(i=>i.id);
    // Surcharge rate must match what StripePaymentModal actually charged (portalSettings.ccFeePct,
    // default 2.9%). The old code referenced an undefined CC_FEE_PORTAL here, which threw the moment
    // a payment succeeded — so the invoice never got marked paid and the portal hit its error boundary.
    const ccPct=(typeof portalSettings?.ccFeePct==='number'?portalSettings.ccFeePct:0.029);
    const updater=prev=>prev.map(inv=>{
      if(!paidInvIds.includes(inv.id))return inv;
      const bal=(inv.total||0)-(inv.paid||0);
      const fee=Math.round(bal*ccPct*100)/100;
      const newTotal=(inv.total||0)+fee; // CC surcharge added to invoice total
      const newPaid=(inv.paid||0)+bal+fee; // Customer pays balance + fee
      const payment={amount:bal+fee,method:'cc',ref:'Stripe '+result.intentId,date:new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}),cc_fee:fee};
      return{...inv,total:newTotal,paid:newPaid,status:newPaid>=newTotal?'paid':'partial',cc_fee:(inv.cc_fee||0)+fee,payments:[...(inv.payments||[]),payment],updated_at:new Date().toLocaleString()};
    });
    setInvs(updater);
    if(onUpdateInvs)onUpdateInvs(updater);// optimistic UI; the DB write below is what actually persists
    // The public portal is anonymous and RLS-blocks direct invoice writes (the parent save above fails
    // with 401 by design), so reconcile server-side: a Netlify function re-verifies the charge with
    // Stripe and marks the invoice paid via the service role. The webhook is a secondary backstop.
    if(result.intentId)fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize_invoice',payment_intent_id:result.intentId}),keepalive:true}).catch(()=>{});
    setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices});
    setShowPay(null);setInvView(null);setPayLoading(false);
  };

  // Finalize a payment that came back via a Stripe redirect (3-D Secure, wallets, etc.).
  // StripeCheckoutForm confirms with redirect:'if_required' and return_url = this page, so when a
  // redirect IS required the buyer lands back here with ?payment_intent..&redirect_status=.. in the
  // URL and the in-page onSuccess never fired. Retrieve the intent with the publishable key (read-only,
  // safe in the public portal) and run the same finalize, so the invoice updates and the buyer sees a
  // result instead of a stale "due". The webhook reconciles server-side too; both paths are idempotent.
  const _payReturnHandled=useRef(false);
  useEffect(()=>{
    if(_payReturnHandled.current)return;
    const params=new URLSearchParams(window.location.search);
    const clientSecret=params.get('payment_intent_client_secret');
    const redirectStatus=params.get('redirect_status');
    if(!clientSecret||!redirectStatus)return;
    _payReturnHandled.current=true;
    const cleanUrl=()=>{try{const u=new URL(window.location.href);['payment_intent','payment_intent_client_secret','redirect_status','source_type'].forEach(k=>u.searchParams.delete(k));window.history.replaceState({},document.title,u.pathname+u.search+u.hash);}catch(e){/* noop */}};
    (async()=>{
      try{
        let pk=(typeof process!=='undefined'&&process.env&&process.env.REACT_APP_STRIPE_PK)||'';
        if(!pk){const cfg=await fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'config'})}).then(r=>r.json()).catch(()=>({}));pk=cfg&&cfg.publishableKey;}
        if(!pk)return;
        const stripe=await loadStripe(pk);
        if(!stripe)return;
        const{paymentIntent}=await stripe.retrievePaymentIntent(clientSecret);
        if(!paymentIntent)return;
        if(paymentIntent.status==='succeeded'){
          const ids=String(paymentIntent.metadata?.invoice_id||'').split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
          const matched=custInvs.filter(inv=>ids.includes(inv.id));
          const collected=(paymentIntent.amount||0)/100;
          if(matched.length){
            const balTotal=matched.reduce((a,inv)=>a+Math.max(0,(inv.total||0)-(inv.paid||0)),0);
            handlePaymentSuccess({intentId:paymentIntent.id,amount:balTotal,fee:Math.max(0,Math.round((collected-balTotal)*100)/100),invoices:matched,status:'succeeded'});
          }else{
            // Invoices not loaded into this view — reconcile server-side directly, then confirm.
            fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize_invoice',payment_intent_id:paymentIntent.id}),keepalive:true}).catch(()=>{});
            setPaySuccess({amount:collected,fee:0,invoices:[]});
          }
        }else if(paymentIntent.status==='processing'){
          setPaySuccess({amount:(paymentIntent.amount||0)/100,fee:0,invoices:[],processing:true});
        }
        // failed / requires_payment_method: the modal already showed an error before the redirect.
      }catch(e){/* best-effort; the webhook is the source of truth */}
      finally{cleanUrl();}
    })();
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single source of truth for the payment modal. Each portal view (estimate/job/invoice/main) is its
  // own early return, so the modal must be rendered in every view that can launch it — not just the
  // main one. Previously it lived only in the main return, so tapping "Pay" from an opened invoice set
  // showPay but never mounted the modal: the button just span on "Opening secure checkout…" forever.
  const payModalEl = showPay ? <StripePaymentModal
    invoices={showPay==='all'?openInvs:[showPay]}
    customerName={customer.name}
    customerEmail={contactEmail}
    alphaTag={customer.alpha_tag}
    feePct={typeof portalSettings?.ccFeePct==='number'?portalSettings.ccFeePct:undefined}
    paymentNote={portalSettings?.paymentNote||''}
    onSuccess={handlePaymentSuccess}
    onClose={()=>{setShowPay(null);setPayLoading(false)}}
  /> : null;

  // Estimate detail view
  if(estView){
    const est=estView;
    const eaf=safeArt(est);const _eAQ={};(est.items||[]).forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const estSubtotal=(est.items||[]).reduce((a,it)=>{const sqq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=sqq>0?sqq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const estShip=est.shipping_type==='pct'?estSubtotal*(est.shipping_value||0)/100:(est.shipping_value||0);
    const estTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const estTax=estSubtotal*estTaxRate;
    const estTotal=estSubtotal+estShip+estTax;
    const canApprove=est.status==='sent'||est.status==='open';
    // Generate printable estimate PDF — uses shared printDoc for consistent style
    const downloadEstPdf=()=>{
      const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const rows=[];const eTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
      (est.items||[]).forEach((it,i)=>{
        const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const lineTotal=qty*safeNum(it.unit_sell);
        const szText=Object.entries(safeSizes(it)).filter(([,v])=>v>0).map(([sz,q])=>sz+':'+q).join(' ');
        let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'')+(szText?'<br/><span style="color:#555">'+szText+'</span>':'');
        if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
        rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(safeNum(it.unit_sell)),style:'text-align:right'},{value:_$(lineTotal),style:'text-align:right;font-weight:600'}]});
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoAmt=eq2*dp2.sell;
          const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors2=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
          const decoType2=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel2=decoType2?decoType2.replace(/_/g,' '):'';
          const colorCount2=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors2;const stitchCount2=safeNum(d.stitches)||safeNum(d.tbd_stitches);
          const decoDetail2=decoType2==='embroidery'&&stitchCount2?stitchCount2.toLocaleString()+' stitches':colorCount2?colorCount2+' color'+(colorCount2>1?'s':''):'';
          const label=d.kind==='numbers'?'Numbers — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel2||d.position||'Decoration')+(decoDetail2?' — '+decoDetail2:'')+(decoTypeLabel2&&d.position?' — '+d.position:'');
          rows.push({cells:[{value:eq2,style:'text-align:center;color:#888'},{value:'',style:''},{value:'<span style="padding-left:16px;color:#666">'+label+'</span>'},{value:_$(dp2.sell),style:'text-align:right;color:#888'},{value:_$(decoAmt),style:'text-align:right;color:#888'}]});
        });
      });
      const eBillAddr=customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':(customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':'');
      printDoc({
        title:customer?.name||'Customer',docNum:est.id,docType:'ESTIMATE',
        headerRight:'<div class="ta">'+_$(estTotal)+'</div><div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>',
        infoBoxes:[
          {label:'Bill To',value:customer?.name||'—',sub:eBillAddr||''},
          {label:'Expires',value:new Date(Date.now()+30*86400000).toLocaleDateString()},
          {label:'Sales Rep',value:rep?.name||'—'},
          {label:'Estimate',value:est.id},
          {label:'Memo',value:est.memo||'—'},
        ],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
          rows:[...rows,
            {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'},{value:'<strong>'+_$(estSubtotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'}]},
            ...(estShip>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(estShip),style:'text-align:right;border:none'}]}]:[]),
            ...(estTax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(estTaxRate*100).toFixed(2)+'%)</strong>',style:'text-align:right;border:none'},{value:_$(estTax),style:'text-align:right;border:none'}]}]:[]),
            {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong>'+_$(estTotal)+'</strong>',style:'text-align:right'}]},
          ]}],
        footer:'This estimate is valid for 30 days. Prices subject to change. '+NSA.depositTerms
      });
    };
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#92400e,#d97706)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setEstView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ESTIMATE</div>
            <div style={{fontSize:20,fontWeight:800}}>{est.memo||est.id}</div>
            <div style={{fontSize:12,opacity:0.8}}>{est.id} · {est.created_at?.split(' ')[0]}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:16,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Estimated Total</div>
            <div style={{fontSize:36,fontWeight:800,color:'#92400e'}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <span style={{padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700,background:est.status==='approved'?'#dcfce7':est.status==='converted'?'#dbeafe':'#fef3c7',color:est.status==='approved'?'#166534':est.status==='converted'?'#1e40af':'#92400e'}}>{est.status==='converted'?'Converted to Order':est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
            <div style={{marginTop:10}}><button style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:8,padding:'8px 20px',fontSize:13,fontWeight:700,cursor:'pointer'}} onClick={downloadEstPdf}>📄 Download Estimate PDF</button></div>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Items</div>
          {(est.items||[]).map((it,i)=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qty=_sq>0?_sq:safeNum(it.est_qty);const lineTotal=qty*safeNum(it.unit_sell);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0).sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);decoTotal+=qty*dp2.sell});
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'} {it.brand&&'· '+it.brand}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:14,color:'#1e3a5f'}}>${(lineTotal+decoTotal).toFixed(2)}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{qty} × ${safeNum(it.unit_sell).toFixed(2)}</div>
                </div>
              </div>
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
                {sizes.map(([sz,q])=>{const avail=(it.size_availability||{})[sz];return<div key={sz} style={{textAlign:'center',padding:'3px 6px',background:avail?'#fffbeb':'#f8fafc',borderRadius:5,minWidth:32,border:avail?'1px solid #fde68a':'none'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:12,fontWeight:800,color:'#1e3a5f'}}>{q}</div>
                  {avail&&<div style={{fontSize:8,color:'#92400e',fontWeight:600,whiteSpace:'nowrap'}}>Avail {new Date(avail+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}
                </div>})}
              </div>}
              {(()=>{const sa=it.size_availability||{};const delayed=Object.entries(sa).filter(([sz,d])=>d&&(it.sizes||{})[sz]>0);
                if(delayed.length===0)return null;
                return<div style={{fontSize:10,color:'#92400e',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:5,padding:'4px 8px',marginBottom:6}}>
                  ⏳ Some sizes available later: {delayed.map(([sz,d])=>sz+' ('+new Date(d+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})+')').join(', ')}
                </div>})()}
              {safeDecos(it).length>0&&<div style={{fontSize:11,color:'#64748b',borderTop:'1px solid #f1f5f9',paddingTop:4}}>
                {safeDecos(it).map((d,di)=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoLine=eq2*dp2.sell;
                  const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
                  const decoType=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel=decoType?decoType.replace(/_/g,' '):'';
                  const colorCount=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors;const stitchCount=safeNum(d.stitches)||safeNum(d.tbd_stitches);
                  const decoDetail=decoType==='embroidery'&&stitchCount?stitchCount.toLocaleString()+' stitches':colorCount?colorCount+' color'+(colorCount>1?'s':''):'';
                  const decoLabel=d.kind==='numbers'?'Numbers · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel||d.position||'Decoration')+(decoDetail?' · '+decoDetail:'')+(decoTypeLabel&&d.position?' · '+d.position:'');
                  return<div key={di} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{d.kind==='numbers'?'#️⃣':d.kind==='names'?'🏷️':'🎨'} {decoLabel}</span>{decoLine>0&&<span style={{fontWeight:600}}>{eq2} × ${dp2.sell.toFixed(2)}/ea = +${decoLine.toFixed(2)}</span>}</div>})}
              </div>}
            </div>})}
          <div style={{borderTop:'2px solid #e2e8f0',paddingTop:12,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Subtotal</span><span style={{fontWeight:700}}>${estSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {estShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Shipping</span><span>${estShip.toFixed(2)}</span></div>}
            {estTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Tax ({(estTaxRate*100).toFixed(2)}%)</span><span>${estTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',borderTop:'2px solid #1e3a5f',marginTop:6}}>
              <span style={{fontWeight:800,fontSize:16}}>Estimated Total</span><span style={{fontWeight:800,fontSize:18,color:'#92400e'}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {canApprove&&<button id="est-approve-btn" style={{width:'100%',padding:'14px 20px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer',marginBottom:10}} onClick={async()=>{
            const _approvedAt=new Date().toISOString();const _updatedAt=new Date().toLocaleString();
            const _approvedEst={...est,status:'approved',approved_by:'Coach',approved_at:_approvedAt,updated_at:_updatedAt};
            if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_approvedEst:e))}
            setEstView({...est,status:'approved'});
            // Email the assigned rep when coach approves estimate. Fall back to the
            // customer's primary rep, then a monitored admin inbox, so a rep missing
            // an email on file never silently swallows the approval notification.
            const _apprRep=REPS.find(r=>r.id===est.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
            const _apprTo=_apprRep?.email||'steve@nationalsportsapparel.com';
            const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
            // Persist via the serverless endpoint — the public portal's anon role can't write under RLS
            const _res=await _portalAction({alphaTag:customer.alpha_tag,
              estimates:[{id:est.id,status:'approved',approved_by:'Coach',approved_at:_approvedAt,updated_at:_updatedAt}],
              email:{to:[{email:_apprTo}],cc:_accCc,subject:'✅ Estimate approved by coach — '+(est.memo||est.id)+' ('+est.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved estimate <strong>'+est.id+'</strong>'+(est.memo?' — '+est.memo:'')+'.</p><p>This estimate is ready to be converted to a sales order.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?est='+est.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Estimate '+est.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:_apprRep?.email?{email:_apprRep.email,name:_apprRep.name}:undefined},
            });
            if(!_res.ok)alert('Could not save your approval — please try again or contact your rep.\n\n'+(_res.error||''));
          }}>✅ Approve This Estimate</button>}
          {canApprove&&<div id="est-request-box" style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:'#1e3a5f',marginBottom:8}}>Need changes? Request updates from your rep</div>
            {updateRequestSent?<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:600}}>Your update request has been sent to your rep!</div>
            :<>
              <textarea style={{width:'100%',border:'1px solid #d1d5db',borderRadius:8,padding:10,fontSize:13,resize:'vertical',minHeight:60,fontFamily:'inherit',boxSizing:'border-box'}} placeholder="Tell your rep what you'd like changed (sizes, items, pricing, etc.)..." value={updateRequestText} onChange={e=>setUpdateRequestText(e.target.value)} rows={3}/>
              <button style={{width:'100%',marginTop:8,padding:'12px 20px',background:updateRequestText.trim()?'#d97706':'#e5e7eb',color:updateRequestText.trim()?'white':'#9ca3af',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:updateRequestText.trim()?'pointer':'not-allowed'}} disabled={!updateRequestText.trim()} onClick={async()=>{
                if(!updateRequestText.trim())return;
                const _reqText=updateRequestText.trim();
                const req={id:'UR-'+Date.now(),text:_reqText,from:'Coach',at:new Date().toISOString(),status:'pending'};
                const _newReqs=[...(est.update_requests||[]),req];const _updatedAt=new Date().toLocaleString();
                const _updatedEst={...est,update_requests:_newReqs,updated_at:_updatedAt};
                if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_updatedEst:e))}
                setEstView({...est,update_requests:_newReqs});
                // Notify the assigned rep that the coach requested changes
                const _urRep=REPS.find(r=>r.id===est.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                const _safeText=_reqText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');
                // Persist via the serverless endpoint — the public portal's anon role can't write under RLS
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  estimates:[{id:est.id,update_requests:_newReqs,updated_at:_updatedAt}],
                  email:_urRep?.email?{to:[{email:_urRep.email}],cc:_accCc,subject:'📝 Estimate update requested by coach — '+(est.memo||est.id)+' ('+est.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p><strong>'+customer.name+'</strong> requested changes to estimate <strong>'+est.id+'</strong>'+(est.memo?' — '+est.memo:'')+'.</p><div style="margin:12px 0;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#78350f"><div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:4px">Coach\'s request</div>'+_safeText+'</div><p>Please update the estimate and resend it to the coach.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?est='+est.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Estimate '+est.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:{email:_urRep.email,name:_urRep.name}}:undefined,
                });
                if(!_res.ok){alert('Could not send your request — please try again or contact your rep.\n\n'+(_res.error||''));return}
                setUpdateRequestText('');setUpdateRequestSent(true);
              }}>Request Updates</button>
            </>}
          </div>}
          {(est.update_requests||[]).length>0&&<div style={{border:'1px solid #fde68a',background:'#fffbeb',borderRadius:10,padding:14,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:'#92400e',marginBottom:8}}>Update Requests</div>
            {(est.update_requests||[]).map((req,ri)=><div key={ri} style={{padding:'8px 0',borderBottom:ri<(est.update_requests||[]).length-1?'1px solid #fde68a':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#92400e'}}>{req.from}</span>
                <span style={{fontSize:10,color:'#b45309'}}>{new Date(req.at).toLocaleDateString()}</span>
              </div>
              <div style={{fontSize:12,color:'#78350f',marginTop:2}}>{req.text}</div>
              <span style={{fontSize:10,padding:'1px 6px',borderRadius:6,fontWeight:600,background:req.status==='completed'?'#dcfce7':req.status==='in_progress'?'#dbeafe':'#fef3c7',color:req.status==='completed'?'#166534':req.status==='in_progress'?'#1e40af':'#92400e'}}>{req.status==='completed'?'Done':req.status==='in_progress'?'In Progress':'Pending'}</span>
            </div>)}
          </div>}
          {est.status==='approved'&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Approved — your rep will convert this to an order</div>}
          {est.status==='converted'&&<div style={{textAlign:'center',padding:12,background:'#dbeafe',borderRadius:8,color:'#1e40af',fontWeight:700}}>📦 This estimate has been converted to an active order</div>}
          {canApprove&&<div style={{height:64}}/>}
        </div>
      </div>
      {/* Sticky action bar — keeps Approve / Request changes reachable on long estimates without forcing the coach to commit before reviewing the items above */}
      {canApprove&&<div style={{position:'fixed',left:0,right:0,bottom:0,display:'flex',justifyContent:'center',padding:'10px 16px',background:'rgba(255,255,255,0.92)',backdropFilter:'blur(6px)',borderTop:'1px solid #e2e8f0',boxShadow:'0 -2px 12px rgba(0,0,0,0.06)',zIndex:50}}>
        <div style={{width:'100%',maxWidth:640,display:'flex',gap:10}}>
          <button style={{flex:1,padding:'12px 16px',background:'white',color:'#d97706',border:'1px solid #d97706',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'}} onClick={()=>document.getElementById('est-request-box')?.scrollIntoView({behavior:'smooth',block:'center'})}>✏️ Request changes</button>
          <button style={{flex:1,padding:'12px 16px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:800,cursor:'pointer'}} onClick={()=>document.getElementById('est-approve-btn')?.scrollIntoView({behavior:'smooth',block:'center'})}>✅ Approve</button>
        </div>
      </div>}
    </div>
  }

  // Order detail view (skip if jobView is active — artwork cards set jobView while soView is still set)
  if(soView&&!jobView){
    const so=soView;
    const soAF=safeArt(so);
    const _soAQ={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_soAQ[d.art_file_id]=(_soAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const soSubtotal=safeItems(so).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qq;const dp2=dP(d,qq,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const soShip=so.shipping_type==='pct'?soSubtotal*(so.shipping_value||0)/100:(so.shipping_value||0);
    const soTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const soTax=soSubtotal*soTaxRate;
    const soTotal=soSubtotal+soShip+soTax;
    let soTotalU=0,soFulU=0;
    safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{soTotalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);soFulU+=Math.min(v,pQ+rQ)})});
    const soPct=soTotalU>0?Math.round(soFulU/soTotalU*100):0;
    const soDaysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
    const soJobsList=safeJobs(so);
    const soShipments=so._shipments||[];
    const soLegacy=so._tracking_number&&!soShipments.find(s=>s.tracking_number===so._tracking_number);
    const soAllShipments=soLegacy?[{tracking_number:so._tracking_number,carrier:so._carrier||'',ship_date:so._ship_date||'',tracking_url:so._tracking_url||''},...soShipments]:soShipments;
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setSoView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ORDER</div>
            <div style={{fontSize:20,fontWeight:800}}>{so.memo||so.id}</div>
            <div style={{fontSize:12,opacity:0.8}}>{so.id} · {so.created_at?.split(' ')[0]}{so.expected_date?(' · Expected '+so.expected_date):''}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* Progress bar */}
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
              <span style={{fontSize:11,fontWeight:700,color:soPct>=100?'#166534':'#1e3a5f'}}>{soPct}%</span>
            </div>
            <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
              <div style={{height:8,borderRadius:6,background:soPct>=100?'#22c55e':soPct>50?'#3b82f6':'#f59e0b',width:soPct+'%',transition:'width 0.3s'}}/></div>
            {soDaysOut!=null&&<div style={{fontSize:11,color:soDaysOut<=7?'#dc2626':'#64748b',marginTop:4,textAlign:'right'}}>{soDaysOut>0?soDaysOut+' day'+(soDaysOut!==1?'s':'')+' out':soDaysOut===0?'Due today':'Overdue'}</div>}
          </div>
          {/* Line items */}
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Items</div>
          {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            let recvQ=0;Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);recvQ+=Math.min(v,pQ+rQ)});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);decoTotal+=eq2*dp2.sell});
            const lineTotal=qty*safeNum(it.unit_sell)+decoTotal;
            const _prd=(prod||[]).find(pp=>pp.id===it.product_id||pp.sku===it.sku);
            const itImg=_prd?.image_url||(_prd?.images&&_prd.images[0])||it._colorImage||'';
            return<div key={ii} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                <div style={{flex:1,display:'flex',gap:10,alignItems:'center'}}>
                  {itImg&&isUrl(itImg)?<img src={itImg} alt={safeStr(it.name)||'Item'} title="Click to enlarge" onClick={()=>setLightbox(itImg)} style={{width:48,height:48,objectFit:'cover',borderRadius:8,border:'1px solid #e2e8f0',flexShrink:0,cursor:'zoom-in'}}/>
                  :<div style={{width:48,height:48,background:'#f8fafc',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><div style={{fontSize:20}}>👕</div></div>}
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'} {it.brand&&'· '+it.brand}</div>
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:14,color:'#1e3a5f'}}>${lineTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{qty} units</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{flex:1,background:'#f1f5f9',borderRadius:6,height:4,marginRight:10}}>
                  <div style={{height:4,borderRadius:6,background:recvQ>=qty?'#22c55e':recvQ>0?'#3b82f6':'#e2e8f0',width:(qty>0?Math.round(recvQ/qty*100):0)+'%'}}/></div>
                <span style={{fontSize:11,fontWeight:600,color:recvQ>=qty?'#166534':'#64748b',whiteSpace:'nowrap'}}>{recvQ} of {qty} received</span>
              </div>
              {(()=>{const _szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])<0?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])<0?99:SZ_ORD.indexOf(b[0])));
                if(_szList.length===0)return null;
                return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:8}}>
                  {_szList.map(([sz,sq])=><div key={sz} style={{textAlign:'center',padding:'3px 8px',background:'#f8fafc',borderRadius:6,minWidth:34}}>
                    <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:12,fontWeight:800,color:'#1e3a5f'}}>{sq}</div>
                  </div>)}
                </div>})()}
            </div>})}
          {/* Order totals */}
          <div style={{borderTop:'2px solid #e2e8f0',paddingTop:12,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Subtotal</span><span style={{fontWeight:700}}>${soSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {soShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Shipping</span><span>${soShip.toFixed(2)}</span></div>}
            {soTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13}}><span>Tax ({(soTaxRate*100).toFixed(2)}%)</span><span>${soTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',borderTop:'2px solid #1e3a5f',marginTop:6}}>
              <span style={{fontWeight:800,fontSize:16}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#1e3a5f'}}>${soTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {/* Artwork & Decoration jobs */}
          {soJobsList.length>0&&<>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Artwork & Decoration</div>
            {soJobsList.map(j=>{const artFile=soAF.find(a=>a.id===j.art_file_id);const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));(j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);
              // Scope mockups to SKUs that belong to THIS job — prevents leakage from sibling jobs that share an art file.
              const _jSkus=new Set((j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return it?.sku||gi.sku}).filter(Boolean));
              const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus.has(k.split('|')[0])).flatMap(([,arr])=>arr||[])));
              const _jMf=_jIm.length===0?_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[])):[];
              const _jSeen=new Set();const mockups=[..._jIm,..._jMf].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_jSeen.has(u))return false;_jSeen.add(u);return true});
              const _clickJob=()=>{setJobView({job:j,so});setComment('');if(j.sent_to_coach_at&&!j.coach_email_opened_at){const liveSO2=sos.find(s=>s.id===so.id);if(liveSO2){const updSO2={...liveSO2,jobs:(liveSO2.jobs||safeJobs(liveSO2)).map(jj=>jj.id===j.id?{...jj,coach_email_opened_at:new Date().toISOString()}:jj),updated_at:new Date().toLocaleString()};if(savSOFn)savSOFn(updSO2);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO2:s))}}};
              return<div key={j.id} style={{border:'1px solid '+(j.art_status==='waiting_approval'?'#f59e0b':'#e2e8f0'),background:j.art_status==='waiting_approval'?'#fffbeb':'#fafbfc',borderRadius:10,marginBottom:8,overflow:'hidden',cursor:'pointer'}} onClick={_clickJob}>
                {/* Mockup thumbnails — show all images in a grid */}
                {mockups.length>0&&<div style={{display:'grid',gridTemplateColumns:mockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
                  {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);const isPdf=_isPdfUrl(url,f);const pdfThumb=isPdf?_cloudinaryPdfThumb(url):null;
                    return<div key={fi} style={{background:'white'}}>
                      {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                      :isPdf&&pdfThumb?<img src={pdfThumb} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}} onError={e=>{e.target.style.display='none'}}/>
                      :<div style={{height:mockups.length>1?140:200,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                    </div>})}
                </div>}
                {/* Job info bar */}
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px'}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>{j.art_name}</div>
                    <div style={{fontSize:10,color:'#64748b'}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                  </div>
                  <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#dcfce7':j.art_status==='waiting_approval'?'#fef3c7':'#fee2e2',color:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#166534':j.art_status==='waiting_approval'?'#92400e':'#dc2626'}}>{artLabelsP[j.art_status]}</span>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </>}
          {/* Shipping / Tracking */}
          {soAllShipments.length>0&&<div style={{marginTop:12}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Shipping & Tracking</div>
            {soAllShipments.map((shp,si)=><div key={si} style={{padding:'10px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,marginBottom:6}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:'#166534'}}>📦 {shp.carrier||'Package'} {soAllShipments.length>1?'#'+(si+1):''}</div>
                  {shp.ship_date&&<div style={{fontSize:10,color:'#64748b'}}>Shipped {shp.ship_date}</div>}
                </div>
                {shp.tracking_number&&<a href={shp.tracking_url||((/^1Z/i.test(shp.tracking_number))?'https://www.ups.com/track?tracknum='+shp.tracking_number:'https://www.fedex.com/fedextrack/?trknbr='+shp.tracking_number)} target="_blank" rel="noreferrer" style={{fontSize:11,fontWeight:600,color:'#2563eb',textDecoration:'none'}}>Track →</a>}
              </div>
              {shp.tracking_number&&<div style={{fontSize:11,fontFamily:'monospace',color:'#64748b',marginTop:4}}>{shp.tracking_number}</div>}
            </div>)}
          </div>}
          {/* Firm dates */}
          {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:8,fontSize:12,color:'#166534'}}>
            📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
        </div>
      </div>
    </div>
  }

  // Job detail view
  if(jobView){
    const _liveSO=sos.find(s=>s.id===jobView.so.id)||jobView.so;
    const _liveJob=(safeJobs(_liveSO)).find(jj=>jj.id===jobView.job.id)||jobView.job;
    const j=_liveJob;const so=_liveSO;
    const artFile=safeArt(so).find(a=>a.id===j.art_file_id);
    const _jobArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
    (j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jobArtIds.add(d.art_file_id)})});
    const _jobArtFiles=[..._jobArtIds].map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
    // Mock links: a garment the rep linked to another garment shows a "same mockup as X"
    // note instead of repeating the image; the source garment shows it once with an
    // "also applies to" caption. Unlinked garments keep their own per-item mock.
    const _linkOfC=gi=>resolveMockLink(_jobArtFiles,gi.sku,gi.color);
    const _depsOfC=gi=>mockLinkDependents(_jobArtFiles,gi.sku,gi.color);
    const mockups=_filterDisplayable(_jobArtFiles.flatMap(_af=>_af?.mockup_files||_af?.files||[]));
    const _hasAnyItemMockup=gi=>{const src=_linkOfC(gi);if(src)return _filterDisplayable(mockLinkSourceFiles(_jobArtFiles,src)).length>0;const _mk=gi.sku+'|'+(gi.color||'');return _jobArtFiles.some(_af=>{const m=_af?.item_mockups||{};const v=m[_mk]&&m[_mk].length>0?m[_mk]:(m[gi.sku]||[]);return _filterDisplayable(v).length>0})};
    const items=(j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];const prd=it?prod.find(pp=>pp.id===it.product_id||pp.sku===it.sku):null;return{...gi,brand:it?.brand||'',fullName:safeStr(it?.name)||gi.name,image_url:prd?.image_url||(prd?.images&&prd.images[0])||it?._colorImage||'',back_image_url:prd?.back_image_url||(prd?.images&&prd.images[1])||it?._colorBackImage||''}});
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      {/* ── Lightbox overlay ── */}
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>{const _backSO=soView?sos.find(s=>s.id===jobView.so.id):null;setJobView(null);if(_backSO)setSoView(_backSO)}}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ARTWORK PROOF</div>
            <div style={{fontSize:18,fontWeight:800}}>{j.art_name}</div>
            <div style={{fontSize:12,opacity:0.7}}>{so.memo} · {j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* ── Per-item mockups + art details (linked garments reference their source's mock) ── */}
          {items.map((gi,i)=>{const srcItem=safeItems(so)[gi.item_idx];
            const _mySrc=_linkOfC(gi);
            const _myDeps=_depsOfC(gi).filter(k=>items.some(g=>(g.sku+'|'+(g.color||''))===k));
            const _itemArtIds=srcItem?[...new Set(safeDecos(srcItem).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd').map(d=>d.art_file_id))]:[];
            const _itemArtFiles=(_itemArtIds.length>0?_itemArtIds:[...new Set([artFile?.id,...(j._art_ids||[])].filter(Boolean))]).map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
            const _mk=gi.sku+'|'+(gi.color||'');
            const _cpDecosSorted=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'):[];const _seenIm=new Set();const _cpFirst=(_af)=>{const im=_af?.item_mockups||{};const v=im[_mk];if(v&&v.length>0)return v[0];const vb=im[gi.sku];if(vb&&vb.length>0)return vb[0];const de=Object.entries(im).find(([k])=>k.startsWith(_mk+'|'));return de&&de[1]&&de[1].length>0?de[1][0]:null;};
            // Linked garment → no images of its own (a note references the source); else per-item.
            const itemMockups=_mySrc?[]:_filterDisplayable(_cpDecosSorted.length>1?_cpDecosSorted.flatMap((d,i)=>{const af3=safeArt(so).find(a=>a.id===d.art_file_id);if(!af3)return[];const disc=i===0?'':(d.color_way_id||('d'+i));const key=_mk+(disc?('|'+disc):'');const im=af3?.item_mockups||{};const v=im[key];if(v&&v.length>0)return[v[0]];const f=_cpFirst(af3);return f?[f]:[];}):_itemArtFiles.length>1?_itemArtFiles.flatMap(_af=>{const f=_cpFirst(_af);return f?[f]:[]}):_itemArtFiles.flatMap(_af=>{const im=_af?.item_mockups||{};const v=im[_mk];return v&&v.length>0?v:(im[gi.sku]||[])})).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seenIm.has(u))return false;_seenIm.add(u);return true});
            const artDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'):[];
            const artPos=artDecos.map(d=>d.position||'Front Center').filter((v,idx,arr)=>arr.indexOf(v)===idx);
            const numDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='numbers'):[];
            const nameDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='names'):[];
            const nd=numDecos[0];const _isEmb=artFile?.deco_type==='embroidery';
            const gk=gi.sku+'|'+(gi.color||'');const gc=artFile?.garment_colors?.[gk]||{};
            const gcColors=Object.values(gc).flat().filter((v,idx,arr)=>v&&arr.indexOf(v)===idx);
            const cwColors2=[];artDecos.forEach(d=>{if(d.color_way_id&&artFile?.color_ways){const cw=artFile.color_ways.find(c=>c.id===d.color_way_id);if(cw)cw.inks?.forEach(c=>{if(c&&c.trim()&&!cwColors2.includes(c.trim()))cwColors2.push(c.trim())})}});
            const fallbackColors=(artFile?.ink_colors||artFile?.thread_colors||'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
            // Final fallback: union of all CW inks on the art file. Covers SOs where CWs are defined but
            // decorations don't carry an explicit color_way_id link — without this, colors render as empty.
            const allCwInks=[...new Set((artFile?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
            const itemColors=gcColors.length>0?gcColors:cwColors2.length>0?cwColors2:fallbackColors.length>0?fallbackColors:allCwInks;
            const _cm3={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
            const sizesSrc=gi.sizes?Object.entries(gi.sizes).filter(([,v])=>v>0):(srcItem?Object.entries(safeSizes(srcItem)).filter(([,v])=>v>0):[]);
            const sizes=sizesSrc.sort((a,b)=>{const o2=SZ_ORD;return(o2.indexOf(a[0])<0?99:o2.indexOf(a[0]))-(o2.indexOf(b[0])<0?99:o2.indexOf(b[0]))});
            const roster=gi.roster||(numDecos.length>0?numDecos[0].roster:null);
            const names=nameDecos.length>0?nameDecos[0].names:null;
            const sortedSizes=sizes.map(([sz])=>sz);
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:12,marginBottom:14,overflow:'hidden'}}>
            {/* Item mockup images */}
            {_mySrc?<div style={{padding:'8px 14px',background:'#eef2ff',fontSize:11,fontWeight:700,color:'#3730a3',textAlign:'center',cursor:'pointer'}} onClick={()=>{const sf=_filterDisplayable(mockLinkSourceFiles(_jobArtFiles,_mySrc))[0];const u=sf?(typeof sf==='string'?sf:(sf?.url||'')):'';if(u&&isUrl(u))setLightbox(u)}}>🔗 Same mockup as {_mySrc.split('|')[0]} — tap to view</div>
            :itemMockups.length>0&&<><div style={{display:'grid',gridTemplateColumns:itemMockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
              {itemMockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);
                return<div key={fi} style={{background:'white',cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                  {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:itemMockups.length>1?180:280,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                  :<div style={{height:180,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                </div>})}
            </div>{_myDeps.length>0&&<div style={{padding:'6px 14px',background:'#eef2ff',fontSize:11,fontWeight:700,color:'#3730a3',textAlign:'center'}}>One mockup — also applies to {_myDeps.map(k=>k.split('|')[0]).join(', ')}</div>}</>}
            {/* Item header */}
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:10}}>
                {gi.image_url?<img src={gi.image_url} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:8,border:'1px solid #e2e8f0',flexShrink:0}}/>
                :<div style={{width:44,height:44,background:'#f8fafc',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><div style={{fontSize:18}}>👕</div></div>}
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{gi.fullName}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{gi.sku} · {gi.color||'—'} {gi.brand&&'· '+gi.brand}</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>📍 {artPos.length>0?artPos.join(', '):(j.positions||'—')} · {gi.units} units</div>
                </div>
              </div>
              {/* Per-item art details */}
              {artFile&&<div style={{padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:10}}>
                {(()=>{
                  // Render one row per decoration so coaches see each location's method, size, and inks separately.
                  // Falls back to a single row built from the job's primary art file when no per-item art decorations exist.
                  const _gk2=gi.sku+'|'+(gi.color||'');
                  const _renderDeco=(d,di,_aF)=>{
                    const _gc2=_aF?.garment_colors?.[_gk2]||{};
                    const _gcCols=Object.values(_gc2).flat().filter((v,idx,arr)=>v&&v.trim()&&arr.indexOf(v)===idx);
                    const cwObj=d?.color_way_id&&_aF?.color_ways?_aF.color_ways.find(c=>c.id===d.color_way_id):null;
                    const _cwCols=cwObj?(cwObj.inks||[]).filter(c=>c&&c.trim()):[];
                    const _fbCols=(_aF?.ink_colors||_aF?.thread_colors||'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
                    const _allCwInks=[...new Set((_aF?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
                    const dColors=_gcCols.length>0?_gcCols:_cwCols.length>0?_cwCols:_fbCols.length>0?_fbCols:_allCwInks;
                    const method=((d?.type||_aF?.deco_type||j.deco_type||'')+'').replace(/_/g,' ')||'—';
                    const position=d?.position||(artPos.length>0?artPos.join(', '):'—');
                    const size=(d?.position&&_aF?.art_sizes?.[d.position])||_aF?.art_size||'—';
                    const _isEmb2=(_aF?.deco_type||d?.type)==='embroidery';
                    return<div key={di} style={{paddingTop:di>0?10:0,borderTop:di>0?'1px solid #e2e8f0':'none',marginTop:di>0?10:0}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:dColors.length>0?8:0}}>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{method}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Location</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{position}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{size}</div></div>
                      </div>
                      {dColors.length>0&&<div>
                        <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>{_isEmb2?'Thread Colors':'Ink Colors / Pantones'} ({dColors.length})</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {dColors.map((cl,ci)=>{const clL=cl.toLowerCase();const sw=_cm3[cl]||Object.entries(_cm3).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                            return<div key={ci} style={{display:'flex',alignItems:'center',gap:4,padding:'2px 8px',background:'white',border:'1px solid #e2e8f0',borderRadius:5,fontSize:10,fontWeight:600}}>
                              <div style={{width:12,height:12,borderRadius:2,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                              {cl}</div>})}
                        </div>
                      </div>}
                    </div>;
                  };
                  if(artDecos.length===0)return _renderDeco(null,0,artFile);
                  return artDecos.map((d,di)=>{const _dAf=d.art_file_id?safeArt(so).find(a=>a.id===d.art_file_id):null;return _renderDeco(d,di,_dAf||artFile)});
                })()}
                {nd&&<div style={{marginTop:10,paddingTop:10,borderTop:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>Numbers</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:11}}>
                    <span><strong>{(nd.num_method||'heat_transfer').replace(/_/g,' ')}</strong></span>
                    <span>Size: <strong>{nd.num_size||'—'}</strong></span>
                    {nd.front_and_back&&<span>Back: <strong>{nd.num_size_back||nd.num_size||'—'}</strong></span>}
                    {nd.print_color&&<span>Color: <strong>{nd.print_color}</strong></span>}
                    {nd.front_and_back&&<span style={{padding:'1px 5px',borderRadius:3,background:'#7c3aed',color:'white',fontSize:9,fontWeight:700}}>Front + Back</span>}
                  </div>
                </div>}
              </div>}
              {/* Size breakdown */}
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:roster?10:0}}>
                {sizes.map(([sz,qty])=><div key={sz} style={{textAlign:'center',padding:'4px 8px',background:'#f8fafc',borderRadius:6,minWidth:36}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f'}}>{qty}</div>
                </div>)}
              </div>}
              {/* Numbers roster — grouped by size */}
              {roster&&Object.keys(roster).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#6d28d9',marginBottom:6}}>#️⃣ Numbers</div>
                {sortedSizes.map(sz=>{const nums=(roster[sz]||[]).filter(n=>n!=='');
                  if(nums.length===0)return null;
                  return<div key={sz} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',minWidth:56,flexShrink:0}}>{sz} ({nums.length})</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nums.sort((a,b)=>Number(a)-Number(b)).map((n,ni)=>
                        <span key={ni} style={{display:'inline-block',minWidth:32,textAlign:'center',padding:'3px 6px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:4,fontSize:12,fontWeight:700,color:'#6d28d9'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
              {/* Names */}
              {names&&Object.keys(names).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:6}}>🏷️ Names</div>
                {sortedSizes.map(sz=>{const nms=(names[sz]||[]).filter(n=>n!=='');
                  if(nms.length===0)return null;
                  return<div key={sz} style={{marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>{sz}</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nms.map((n,ni)=>
                        <span key={ni} style={{padding:'3px 8px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:4,fontSize:11,fontWeight:600,color:'#0369a1'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
            </div>
          </div>})}
          {/* General mockups (not per-item) */}
          {mockups.length>0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Artwork Mockups</div>
            {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);const isImg=_isImgUrl(url);
              return<div key={fi} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:10,marginBottom:8,cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                {isImg&&isUrl(url)&&<img src={url} alt={name} style={{width:'100%',borderRadius:8,marginBottom:6,maxHeight:400,objectFit:'contain',background:'#f8fafc'}}/>}
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#1e40af'}}>{name}</span>
                  {isUrl(url)&&<span style={{fontSize:10,color:'#64748b'}}>— tap to enlarge</span>}
                </div>
              </div>})}
          </div>}
          {mockups.length===0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{padding:16,background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:10,marginBottom:16,textAlign:'center'}}>
            <div style={{fontSize:24,marginBottom:4}}>🎨</div>
            <div style={{fontSize:12,color:'#9a3412',fontWeight:600}}>Mockup files haven't been uploaded yet</div>
          </div>}
          {j.art_status==='waiting_approval'&&<div style={{border:'2px solid #f59e0b',background:'#fffbeb',borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontWeight:700,color:'#92400e',marginBottom:10}}>⏳ This artwork needs your approval</div>
            {_portalDisclaimer&&<div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,marginBottom:12,fontSize:12,color:'#991b1b',lineHeight:1.5}}><strong>⚠️ Important:</strong> {_portalDisclaimer}</div>}
            <div style={{marginBottom:10}}>
              <textarea className="form-input" rows={3} placeholder="Add a note (optional for approval, required for rejection)..." value={comment} onChange={e=>setComment(e.target.value)} style={{fontSize:12,resize:'vertical'}}/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'10px 16px'}} onClick={async()=>{
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const jArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const coachComment=comment.trim();
                const _apDeco=(safeArt(liveSO).find(a=>jArtIds.includes(a.id))?.deco_type)||j.deco_type;const _apSt=prodFilesStatusFor(_apDeco);
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:_apSt,coach_approved_at:new Date().toISOString(),coach_approval_comment:coachComment||undefined}:jj),art_files:safeArt(liveSO).map(a=>jArtIds.includes(a.id)?{...a,status:'approved'}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                // Email the assigned rep
                const rep=REPS.find(r=>r.id===liveSO.created_by);
                const commentHtml=coachComment?'<p style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px"><strong>Coach\'s note:</strong> '+coachComment+'</p>':'';
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                // Persist via the serverless endpoint — the public portal's anon role can't write under RLS
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  jobs:[{so_id:liveSO.id,id:j.id,art_status:_apSt,coach_approved_at:new Date().toISOString(),coach_approval_comment:coachComment||null}],
                  artFiles:jArtIds.map(aid=>({so_id:liveSO.id,id:aid,status:'approved'})),
                  touchSO:liveSO.id,
                  email:rep?.email?{to:[{email:rep.email}],cc:_accCc,subject:'✅ Art approved by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p>'+commentHtml+'<p>The job is now ready for production file prep.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:{email:rep.email,name:rep.name}}:undefined,
                });
                if(!_res.ok){alert('Could not save your approval — please try again or contact your rep.\n\n'+(_res.error||''));return}
                setComment('');// stay on the job view — it re-renders from live state to show the "approved" banner
              }}>✅ Approve Artwork</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'10px 16px'}} onClick={async()=>{
                if(!comment.trim()){alert('Please describe what changes you need.');return}
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const _fb=comment.trim();
                const rej={reason:_fb,by:'Coach',at:new Date().toISOString()};
                const rArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const _curJob=(liveSO.jobs||safeJobs(liveSO)).find(jj=>jj.id===j.id);
                const _newRejections=[...((_curJob&&_curJob.rejections)||[]),rej];
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:'art_requested',coach_rejected:true,rejections:_newRejections}:jj),art_files:safeArt(liveSO).map(a=>rArtIds.includes(a.id)?{...a,status:'waiting_for_art',notes:(a.notes?a.notes+'\n':'')+'Coach feedback: '+_fb}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                const rep=REPS.find(r=>r.id===liveSO.created_by);
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                const _safeText=_fb.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  jobs:[{so_id:liveSO.id,id:j.id,art_status:'art_requested',coach_rejected:true,rejections:_newRejections}],
                  artFiles:rArtIds.map(aid=>{const a=safeArt(liveSO).find(x=>x.id===aid);return{so_id:liveSO.id,id:aid,status:'waiting_for_art',notes:((a&&a.notes)?a.notes+'\n':'')+'Coach feedback: '+_fb}}),
                  touchSO:liveSO.id,
                  email:rep?.email?{to:[{email:rep.email}],cc:_accCc,subject:'📝 Art changes requested by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p><strong>'+customer.name+'</strong> requested changes to the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p><div style="margin:12px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b"><div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;margin-bottom:4px">Coach\'s feedback</div>'+_safeText+'</div><p>Please revise the artwork and resend it for approval.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:{email:rep.email,name:rep.name}}:undefined,
                });
                if(!_res.ok){alert('Could not send your request — please try again or contact your rep.\n\n'+(_res.error||''));return}
                setComment('');// stay on the job view — it re-renders from live state to show the "changes requested" banner
              }}>❌ Request Changes</button>
            </div>
          </div>}
          {(j.art_status==='art_complete'||j.art_status==='production_files_needed')&&<div style={{background:'#f0fdf4',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#166534',fontWeight:600}}>✅ You approved this artwork{j.coach_approval_comment&&<div style={{fontWeight:400,marginTop:6,color:'#15803d'}}>Your note: "{j.coach_approval_comment}"</div>}</div>}
          {(j.art_status==='art_requested'&&j.coach_rejected)&&<div style={{background:'#fef2f2',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#dc2626',fontWeight:600}}>🔄 Changes requested — your artist is working on revisions</div>}
          {(j.art_status==='art_complete'||j.art_status==='production_files_needed'||(j.art_status==='art_requested'&&j.coach_rejected))&&(()=>{
            const _next=waitingArtJobs.find(w=>!(w.so&&w.so.id===so.id&&w.id===j.id));
            return<div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              {_next&&<button style={{width:'100%',padding:'12px 16px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:800,cursor:'pointer'}} onClick={()=>{setSoView(_next.so);setJobView({job:_next,so:_next.so});setComment('')}}>Review next artwork ({waitingArtJobs.length} still need{waitingArtJobs.length===1?'s':''} approval) →</button>}
              <button style={{width:'100%',padding:'12px 16px',background:'#1e3a5f',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'}} onClick={()=>{setJobView(null);setSoView(null);setComment('')}}>← Back to all artwork</button>
            </div>;
          })()}
          {j.prod_status!=='hold'&&<div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:16}}>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PRODUCTION STATUS</div>
            <div style={{fontSize:14,fontWeight:700,color:'#1e40af',marginTop:2}}>{prodLabelsP[j.prod_status]||j.prod_status}</div>
          </div>}
        </div>
      </div>
    </div>
  }

  // Invoice detail view
  if(invView){
    const inv=invView;const bal=(inv.total||0)-(inv.paid||0);
    const linkedSO=inv.so_id?custSOs.find(s=>s.id===inv.so_id):null;
    // Generate a printable/downloadable invoice PDF — mirrors the estimate download and
    // the admin invoice layout, but shows the school PO number (not the internal SO).
    const downloadInvPdf=()=>{
      const _$=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const poNum=inv._po_number||linkedSO?.po_number;
      const isDeposit=inv.inv_type==='deposit';const depPct=isDeposit?(inv.deposit_pct||50)/100:1;
      const rows=[];let subTotal=0;
      const soItems=linkedSO?safeItems(linkedSO):[];const soArt=linkedSO?safeArt(linkedSO):[];
      const _pAQ={};soItems.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
      if(soItems.length>0){
        soItems.forEach(it=>{
          const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);if(!qty)return;
          const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
          const unitPrice=safeNum(it.unit_sell);const lineAmt=Math.round(qty*unitPrice*depPct*100)/100;subTotal+=lineAmt;
          let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'');
          if(szStr)itemName+='<br/><span style="color:#555">'+szStr+'</span>';
          rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
          safeDecos(it).forEach(d=>{
            const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soArt,cq);
            const eq=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoAmt=Math.round(eq*dp2.sell*depPct*100)/100;subTotal+=decoAmt;
            const artF=soArt.find(a2=>a2.id===d.art_file_id);const posLabel=d.position?' — '+d.position:'';
            rows.push({_class:'deco-row',cells:[{value:eq,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+pdfDecoLabel(d,artF)+posLabel+'</span>'},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
          });
        });
      }else{
        (inv.line_items||[]).forEach(li=>{const qty=safeNum(li.qty);const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):qty*rate;subTotal+=amt;rows.push({cells:[{value:qty,style:'text-align:center'},{value:li._sku||li.sku||'',style:'font-weight:700'},{value:safeStr(li._name||li.name||li.desc)||'Item'},{value:_$(rate),style:'text-align:right'},{value:_$(amt),style:'text-align:right;font-weight:600'}]})});
      }
      const _ship=inv.shipping!=null?inv.shipping:(linkedSO?(linkedSO.shipping_type==='pct'?subTotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0)):0);
      const _tax=inv.tax||0;
      const billAddr=customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':(customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':'');
      const terms=inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial Invoice':inv.inv_type==='full'?'Invoice':'Final Invoice';
      printDoc({
        title:customer?.name||'Customer',docNum:inv.id,docType:'INVOICE',date:inv.date,
        headerRight:'<div class="ta">'+_$(inv.total||0)+'</div><div class="ts">Balance Due: <strong>'+_$(bal)+'</strong></div>'+(poNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+poNum+'</div>':''),
        infoBoxes:[
          {label:'Bill To',value:customer?.name||'—',sub:billAddr||''},
          {label:'Invoice Date',value:inv.date||new Date().toLocaleDateString(),sub:inv.due_date?'Due: '+inv.due_date:''},
          {label:'PO Number',value:poNum||'—'},
          {label:'Payment Terms',value:terms,sub:'Rep: '+(rep?.name||'—')},
        ],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
          rows:[...rows,
            {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
            ...(_ship>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(_ship),style:'text-align:right;border:none'}]}]:[]),
            ...(_tax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$(_tax),style:'text-align:right;border:none'}]}]:[]),
            {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(inv.total||0)+'</strong>',style:'text-align:right'}]},
            ...(inv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$(inv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
            ...(bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$(bal)+'</strong>',style:'text-align:right'}]}]:[]),
          ]}],
        footer:inv.inv_type==='deposit'?NSA.depositTerms:NSA.terms
      });
    };
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:550,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#991b1b,#dc2626)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setInvView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>INVOICE</div>
            <div style={{fontSize:20,fontWeight:800}}>{inv.id}</div>
            <div style={{fontSize:13,opacity:0.8}}>{inv.memo||'—'}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Amount Due</div>
            <div style={{fontSize:36,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div>
            {inv.paid>0&&<div style={{fontSize:12,color:'#64748b'}}>Paid: ${inv.paid.toLocaleString()} of ${inv.total.toLocaleString()}</div>}
            <div style={{marginTop:14}}><button style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 6px rgba(30,58,95,0.25)'}} onClick={downloadInvPdf}>📄 Download Invoice PDF</button></div>
          </div>
          {/* Order details from linked sales order */}
          {linkedSO&&(()=>{const soAF=linkedSO.art_files||[];const soJobs=safeJobs(linkedSO);
            const itemSubtotal=safeItems(linkedSO).reduce((a,it)=>{const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);return a+qty*safeNum(it.unit_sell)},0);
            const shipAmt=inv.shipping!=null?inv.shipping:(linkedSO.shipping_type==='pct'?itemSubtotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0));
            const taxAmt=inv.tax||0;
            return<div style={{marginBottom:16,border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden'}}>
            <div style={{padding:'10px 14px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e3a5f'}}>📦 Order Details — {linkedSO.memo||linkedSO.id}</div>
              <span style={{fontSize:10,color:'#64748b'}}>{linkedSO.id}</span>
            </div>
            {safeItems(linkedSO).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0);
              const decos=safeDecos(it).filter(d=>d.type||d.deco_type||d.kind);
              const decoLabels=decos.map(d=>{const t=d.type||d.deco_type||d.kind||'';const pos=d.position||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(pos?' — '+pos:'')}).filter(Boolean);
              const matchedJobs=soJobs.filter(j=>(j.items||[]).some(ji=>ji===it.id||ji===ii)||(!j.items&&soAF.some(af=>af.id===j.art_file_id&&decos.some(d=>d.art_file_id===af.id))));
              const jobDecoLabels=matchedJobs.map(j=>{const t=j.deco_type||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(j.art_name?' — '+j.art_name:'')}).filter(Boolean);
              const allDecoLabels=[...new Set([...decoLabels,...jobDecoLabels])];
              return<div key={ii} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{qty} units</div>
                    <div style={{fontSize:10,color:'#64748b'}}>${safeNum(it.unit_sell).toFixed(2)}/ea</div>
                  </div>
                </div>
                {allDecoLabels.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {allDecoLabels.map((label,di)=><span key={di} style={{padding:'2px 8px',background:'#ede9fe',color:'#6d28d9',borderRadius:6,fontSize:10,fontWeight:600}}>{label}</span>)}
                </div>}
                {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {sizes.sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))}).map(([sz,q])=><div key={sz} style={{textAlign:'center',padding:'2px 5px',background:'#f1f5f9',borderRadius:4,minWidth:28}}>
                    <div style={{fontSize:8,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:11,fontWeight:700,color:'#1e3a5f'}}>{q}</div>
                  </div>)}
                </div>}
              </div>})}
            {linkedSO.expected_date&&<div style={{padding:'8px 14px',background:'#f8fafc',fontSize:11,color:'#64748b',display:'flex',justifyContent:'space-between'}}>
              <span>Expected Date</span><span style={{fontWeight:600,color:'#1e3a5f'}}>{linkedSO.expected_date}</span>
            </div>}
          </div>})()}
          {/* Invoice line items — only shown when there's no linked SO. When an SO is
              linked, the Order Details section above already lists every item (with
              correct pricing and sizes), so we don't repeat them here. */}
          {inv.line_items?.length>0&&!linkedSO&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Invoice Line Items</div>
            {inv.line_items.map((li,i)=>{const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):safeNum(li.qty)*rate;
              return<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{safeStr(li._name||li.name||li.desc)||li._sku||li.sku}</div><div style={{fontSize:11,color:'#64748b'}}>{safeNum(li.qty)} × ${rate.toFixed(2)}</div></div>
              <div style={{fontWeight:700,fontSize:13}}>${amt.toFixed(2)}</div>
            </div>})}
          </div>}
          {/* Cost breakdown: subtotal, shipping, tax */}
          {(()=>{const _sub=(inv.total||0)-(inv.shipping||0)-(inv.tax||0);
            const _ship=inv.shipping||0;const _tax=inv.tax||0;
            const soForShip=linkedSO;
            const computedShip=_ship===0&&soForShip?(soForShip.shipping_type==='pct'?_sub*(soForShip.shipping_value||0)/100:(soForShip.shipping_value||0)):_ship;
            const showBreakdown=computedShip>0||_tax>0;
            return showBreakdown&&<div style={{marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Subtotal</span><span>${_sub.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>
              {computedShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Shipping</span><span>${computedShip.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
              {_tax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Tax</span><span>${_tax.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
            </div>})()}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:'2px solid #e2e8f0'}}>
            <span style={{fontWeight:800}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#dc2626'}}>${inv.total?.toLocaleString()}</span>
          </div>
          {bal>0&&!ccDisabled&&<button style={{width:'100%',marginTop:16,padding:'14px 20px',background:payLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:payLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:payLoading?0.8:1,transition:'all 0.2s'}} disabled={payLoading} onClick={()=>{setPayLoading(true);setShowPay(inv)}}>
            {payLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay ${bal.toLocaleString()}</>}
          </button>}
          {bal>0&&ccDisabled&&<div style={{textAlign:'center',marginTop:16,padding:12,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,color:'#475569',fontSize:12,lineHeight:1.5}}>Please remit payment by check or ACH per your account terms. Contact your rep for details.</div>}
          {bal<=0&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Paid in Full</div>}
        </div>
      </div>
      {payModalEl}
    </div>
  }

  // Coach store builder — full-screen guided flow
  if(storeBuilder) return <CoachStoreBuilder customer={customer} onClose={()=>setStoreBuilder(false)} />;

  // Main portal view
  return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
    <div style={{width:'100%',maxWidth:700,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'24px 28px',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <img src="/NEW NSA Logo on white.png" alt="NSA" style={{height:38,filter:'brightness(0) invert(1)',marginBottom:6}}/>
            <div style={{fontSize:22,fontWeight:800}}>{customer.name}</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>Customer Portal</div>
          </div>
          <div style={{textAlign:'right'}}>
            {totalDue>0&&<><div style={{fontSize:10,opacity:0.7}}>BALANCE DUE</div><div style={{fontSize:24,fontWeight:800}}>${totalDue.toLocaleString()}</div></>}
          </div>
        </div>
      </div>
      <div style={{padding:'20px 28px'}}>

        {/* Build a team store — coach self-serve entry */}
        <button onClick={()=>setStoreBuilder(true)} style={{width:'100%',textAlign:'left',border:'none',cursor:'pointer',background:'linear-gradient(135deg,#0f172a,#1e3a5f)',color:'#fff',borderRadius:14,padding:'18px 20px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,boxShadow:'0 2px 10px rgba(15,23,42,.12)'}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',textTransform:'uppercase',opacity:.8}}>New</div>
            <div style={{fontSize:18,fontWeight:800,marginTop:2}}>✨ Build your team store</div>
            <div style={{fontSize:12.5,opacity:.85,marginTop:3}}>Pick your gear, add your colors &amp; logo, and submit it — we'll publish it for you.</div>
          </div>
          <div style={{fontSize:13,fontWeight:800,background:'rgba(255,255,255,.16)',border:'1px solid rgba(255,255,255,.3)',borderRadius:9,padding:'10px 16px',whiteSpace:'nowrap'}}>Start →</div>
        </button>

        {/* Team store — read-only order tracking for the coach */}
        <CoachStore customer={customer} />

        {/* Payment success banner */}
        {paySuccess&&<div style={{padding:16,background:paySuccess.processing?'#fffbeb':'#f0fdf4',border:'2px solid '+(paySuccess.processing?'#f59e0b':'#22c55e'),borderRadius:12,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>{paySuccess.processing?'⏳':'✅'}</div>
          <div style={{fontSize:18,fontWeight:800,color:paySuccess.processing?'#92400e':'#166534',marginBottom:4}}>{paySuccess.processing?'Payment Processing':'Payment Successful!'}</div>
          <div style={{fontSize:14,color:paySuccess.processing?'#92400e':'#166534'}}>${paySuccess.amount.toLocaleString(undefined,{minimumFractionDigits:2})}{paySuccess.processing?' is processing':' paid'}{paySuccess.fee>0?' + $'+paySuccess.fee.toFixed(2)+' processing fee':''}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>{paySuccess.processing?'This can take a few minutes to confirm. Your invoice will update automatically once it clears.':'A receipt has been sent to your email. Your account has been updated.'}</div>
        </div>}

        {/* Artwork awaiting approval — prominent at top, same treatment as estimates */}
        {waitingArtJobs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>🎨 Artwork to Approve ({waitingArtJobs.length})</div>
          {waitingArtJobs.map(j=>{const so=j.so;const soAF=safeArt(so);
            const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
            (j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});
            const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);
            const _jSkus=new Set((j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return it?.sku||gi.sku}).filter(Boolean));
            const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus.has(k.split('|')[0])).flatMap(([,arr])=>arr||[])));
            const _jMf=_jIm.length===0?_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[])):[];
            const _seen=new Set();const mockups=[..._jIm,..._jMf].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});
            const firstMock=mockups[0];const fmUrl=firstMock?(typeof firstMock==='string'?firstMock:firstMock.url):'';
            const fmIsImg=fmUrl&&_isImgUrl(fmUrl,firstMock);const fmIsPdf=fmUrl&&_isPdfUrl(fmUrl,firstMock);const fmPdfThumb=fmIsPdf?_cloudinaryPdfThumb(fmUrl):null;
            return<div key={j.id} style={{border:'2px solid #f59e0b',borderRadius:10,marginBottom:10,background:'#fffbeb',cursor:'pointer',overflow:'hidden'}} onClick={()=>{setSoView(so);setJobView({job:j,so});setComment('')}}>
              <div style={{display:'flex',gap:12,alignItems:'center',padding:12}}>
                <div style={{width:72,height:72,flexShrink:0,borderRadius:8,overflow:'hidden',background:'white',border:'1px solid #fde68a',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {fmIsImg&&isUrl(fmUrl)?<img src={fmUrl} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :fmIsPdf&&fmPdfThumb?<img src={fmPdfThumb} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :<span style={{fontSize:28}}>🎨</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{j.art_name||'Artwork'}</div>
                  <div style={{fontSize:11,color:'#78350f',marginTop:2}}>{so.memo||so.id} · {(j.deco_type||'').replace(/_/g,' ')||'—'}</div>
                  <div style={{marginTop:6}}><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e'}}>⏳ Awaiting Your Approval</span></div>
                </div>
                <span style={{color:'#94a3b8',fontSize:14}}>›</span>
              </div>
            </div>})}
        </>}

        {/* Estimates awaiting approval — needs coach attention */}
        {(()=>{const openEsts=custEsts.filter(e=>e.status==='sent'||e.status==='open');
          const estBadge=(st)=>({background:st==='sent'||st==='open'?'#fef3c7':'#f1f5f9',color:st==='sent'||st==='open'?'#92400e':'#64748b'});
          return openEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>📋 Estimates to Approve ({openEsts.length})</div>
          {openEsts.map(est=>{const t=calcEstTotal(est);
            return<div key={est.id} style={{border:'2px solid #f59e0b',borderRadius:10,padding:14,marginBottom:10,background:'#fffbeb',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{est.memo||est.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:'#92400e'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,...estBadge(est.status)}}>{est.status==='sent'?'Awaiting Approval':est.status}</span></div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div></div>})}
          </>})()}

        {/* Open invoices — payment needed */}
        {openInvs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#dc2626',marginBottom:10,marginTop:16}}>💰 Open Invoices</div>
          <div style={{border:'1px solid #fecaca',borderRadius:10,overflow:'hidden',marginBottom:10}}>
            {openInvs.map((inv,i)=>{const bal=(inv.total||0)-(inv.paid||0);const age=inv.date?Math.ceil((new Date()-new Date(inv.date))/(1000*60*60*24)):0;
              return<div key={inv.id} style={{padding:'12px 16px',borderBottom:i<openInvs.length-1?'1px solid #fef2f2':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                <div>
                  <div style={{fontWeight:700}}>{inv.id} <span style={{fontSize:11,color:'#64748b'}}>{inv.memo}</span></div>
                  <div style={{fontSize:11,color:age>30?'#dc2626':'#64748b'}}>{inv.date} · {age>0?age+' days ago':'Current'}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:800,fontSize:16,color:'#dc2626'}}>${bal.toLocaleString()}</span>
                  {!ccDisabled&&<button className="btn btn-sm" style={{background:'#22c55e',color:'white',fontSize:10}} onClick={e=>{e.stopPropagation();setPayLoading(true);setShowPay(inv)}}>Pay</button>}
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
            <div style={{padding:'12px 16px',background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:800,color:'#dc2626'}}>Total Balance Due</span>
              <span style={{fontSize:20,fontWeight:800,color:'#dc2626'}}>${totalDue.toLocaleString()}</span>
            </div>
          </div>
          {!ccDisabled&&totalDue>0&&<div style={{marginBottom:14}}>
            <button style={{width:'100%',padding:'14px 20px',background:payLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:payLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:payLoading?0.8:1,transition:'all 0.2s'}} disabled={payLoading} onClick={()=>{setPayLoading(true);setShowPay('all')}}>
              {payLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay Now — ${totalDue.toLocaleString()}</>}
            </button>
            <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:6}}>
              <span style={{fontSize:10,color:'#94a3b8'}}>💳 Credit Card</span>
              <span style={{fontSize:10,color:'#94a3b8'}}> Apple Pay</span>
              <span style={{fontSize:10,color:'#94a3b8'}}>🏦 ACH/Bank</span>
            </div>
          </div>}
        </>}

        {/* Active orders */}
        {(activeSOs.length>0||recentEsts.length>0)&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f',marginBottom:10}}>📦 Active Orders</div>
          {activeSOs.map(so=>{
            let totalU=0,fulU=0;
            safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
            const pct=totalU>0?Math.round(fulU/totalU*100):0;
            const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
            const soJobs=safeJobs(so);
            return<div key={so.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>setSoView(so)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{so.memo||so.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Order {so.id} · {so.created_at?.split(' ')[0]}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {so.expected_date&&<div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'#64748b'}}>EXPECTED</div>
                    <div style={{fontSize:14,fontWeight:700,color:daysOut!=null&&daysOut<=7?'#dc2626':'#1e3a5f'}}>{so.expected_date}</div>
                  </div>}
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
                  <span style={{fontSize:11,fontWeight:700,color:pct>=100?'#166534':'#1e3a5f'}}>{pct}%</span>
                </div>
                <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
                  <div style={{height:8,borderRadius:6,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>
              </div>
              <div style={{fontSize:12}}>
                {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                  return<div key={ii} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #f8fafc'}}>
                    <span>{safeStr(it.name)||'Item'} <span style={{color:'#94a3b8'}}>({safeStr(it.color)||'—'})</span></span>
                    <span style={{fontWeight:600,color:'#64748b'}}>{qty} units</span></div>})}
              </div>
              {soJobs.filter(j=>j.art_status==='waiting_approval').length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#fffbeb',border:'1px solid #f59e0b',borderRadius:6,fontSize:11,color:'#92400e',fontWeight:600}}>
                ⏳ {soJobs.filter(j=>j.art_status==='waiting_approval').length} artwork{soJobs.filter(j=>j.art_status==='waiting_approval').length!==1?'s':''} awaiting your approval</div>}
              {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534'}}>
                📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
            </div>})}
          {recentEsts.map(est=>{const t=calcEstTotal(est);
            const _stLabel={sent:'Awaiting Approval',open:'Open',approved:'Approved',draft:'Draft'}[est.status]||est.status;
            const _stStyle={sent:{background:'#fef3c7',color:'#92400e'},open:{background:'#fef3c7',color:'#92400e'},approved:{background:'#dcfce7',color:'#166534'},draft:{background:'#f1f5f9',color:'#64748b'}}[est.status]||{background:'#f1f5f9',color:'#64748b'};
            return<div key={'recest_'+est.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{est.memo||est.id} <span style={{fontSize:10,fontWeight:700,color:'#94a3b8',padding:'1px 6px',border:'1px solid #e2e8f0',borderRadius:6}}>ESTIMATE</span></div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:800,fontSize:15,color:'#1e3a5f'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,..._stStyle}}>{_stLabel}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>
            </div>})}
        </>}

        {/* Approved estimates — no action needed, listed for reference */}
        {(()=>{const approvedEsts=custEsts.filter(e=>e.status==='approved');
          return approvedEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Approved Estimates ({approvedEsts.length})</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
            {approvedEsts.map((est,i,arr)=>{const t=calcEstTotal(est);
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:'#dcfce7',color:'#166534'}}>Approved</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>
          </>})()}

        {/* Paid invoices — historical reference */}
        {paidInvs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Paid Invoices</div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {paidInvs.slice(0,10).map((inv,i,arr)=>
                <div key={inv.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                  <div><span style={{fontWeight:600}}>{inv.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{inv.memo}</span>
                    <div style={{fontSize:10,color:'#64748b'}}>{inv.date}</div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:700,fontSize:13,color:'#166534'}}>${(inv.total||0).toLocaleString()}</span>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:'#dcfce7',color:'#166534'}}>Paid</span>
                    <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                  </div>
                </div>)}
            </div>
          </>}

        {/* Completed orders — below invoices for reference */}
        {completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setSoView(so)}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span className="badge badge-green">Complete</span><span style={{color:'#94a3b8',fontSize:14}}>›</span></div></div>)}
        </>}

        {/* Past Estimates — converted/draft, de-emphasized at bottom */}
        {(()=>{const pastEsts=custEsts.filter(e=>e.status==='converted'||e.status==='draft');
          const estBadge=(st)=>({background:st==='converted'?'#dbeafe':'#f1f5f9',color:st==='converted'?'#1e40af':'#64748b'});
          return pastEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#94a3b8',marginBottom:10,marginTop:16}}>📋 Past Estimates ({pastEsts.length})</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10,opacity:0.75}}>
            {pastEsts.map((est,i,arr)=>{const t=calcEstTotal(est);
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,...estBadge(est.status)}}>{est.status==='converted'?'Converted':est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>
          </>})()}

        {/* Your rep */}
        <div style={{marginTop:20,padding:14,background:'#f8fafc',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6}}>YOUR NSA REP</div>
          <div style={{fontSize:14,fontWeight:600}}>{rep?.name||'NSA Team'}</div>
          <div style={{fontSize:12,color:'#64748b'}}>National Sports Apparel · team@nsa-teamwear.com</div>
          <button className="btn btn-sm btn-secondary" style={{marginTop:8,fontSize:11}} onClick={()=>alert('Message to '+rep?.name+' (demo)')}>💬 Message Your Rep</button>
        </div>

        {/* Contact update */}
        <div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:6}}>📋 Update Contact / Shipping Info</div>
          {!contactEdit?<>
            <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Current: {(customer.contacts||[])[0]?.name} · {(customer.contacts||[])[0]?.email}{customer.shipping_city&&' · '+customer.shipping_city+', '+customer.shipping_state}</div>
            <button className="btn btn-sm btn-secondary" onClick={()=>setContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})}>✏️ Request Update</button>
          </>:<>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Name" style={{flex:1,fontSize:12}} value={contactEdit.name} onChange={e=>setContactEdit(p=>({...p,name:e.target.value}))}/><input className="form-input" placeholder="Email" style={{flex:1,fontSize:12}} value={contactEdit.email} onChange={e=>setContactEdit(p=>({...p,email:e.target.value}))}/></div>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Phone" style={{flex:1,fontSize:12}} value={contactEdit.phone} onChange={e=>setContactEdit(p=>({...p,phone:e.target.value}))}/><input className="form-input" placeholder="Shipping Address" style={{flex:1,fontSize:12}} value={contactEdit.shipping} onChange={e=>setContactEdit(p=>({...p,shipping:e.target.value}))}/></div>
              <textarea className="form-input" placeholder="Notes for your rep (optional)" rows={2} style={{fontSize:12}} value={contactMsg} onChange={e=>setContactMsg(e.target.value)}/>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{alert('📩 Update request sent to '+rep?.name+' for approval! (demo)\n\nYour rep will review and update your info.');setContactEdit(null);setContactMsg('')}}>Send Request</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setContactEdit(null);setContactMsg('')}}>Cancel</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6}}>Changes will be reviewed by your rep before updating</div>
          </>}
        </div>
      </div>
    </div>

    {/* Stripe Payment Modal — shared element (also rendered in the invoice-detail view above) */}
    {payModalEl}
  </div>
}

// ─── PO NUMBER EXTRACTION FROM OCR TEXT ───
const extractPOFromText=(text)=>{
  if(!text)return null;
  // Patterns to match PO numbers on shipping labels:
  // "PO-NO : 0902323374", "PO-NO: 0902323374"
  // "TEAM/CUSTOMER PO : PO7540 EXP", "Cust PO#: PO7770 CSM SP"
  // "PO: 7775GBHSTEN-JB", "PO#: 12345", "PO 12345"
  // "SalesOrder#:SO-158374470", "RO12173689"
  const lines=text.split('\n');
  for(const line of lines){
    const l=line.trim();
    // Match "PO-NO" or "PO NO" followed by separator and value
    let m=l.match(/PO[\s-]*NO\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
    // Match "Cust PO#" or "CUSTOMER PO" or "TEAM/CUSTOMER PO" followed by value
    m=l.match(/(?:CUST(?:OMER)?|TEAM\/CUSTOMER)\s*PO\s*#?\s*[:#=]\s*(.+)/i);
    if(m)return m[1].trim().replace(/[.,]+$/,'');
    // Match "PO#:" or "PO:" followed by value
    m=l.match(/\bPO\s*#?\s*[:#=]\s*(.+)/i);
    if(m){const v=m[1].trim();if(v.length>=4)return v.replace(/[.,]+$/,'')}
    // Match "SalesOrder#:" pattern
    m=l.match(/Sales\s*Order\s*#?\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
  }
  return null;
};

// ─── BARCODE / QR CAMERA SCANNER ───
const BarcodeScanner=({onScan,onClose,placeholder='Scan barcode or QR code...'})=>{
  const videoRef=useRef(null);const streamRef=useRef(null);const scanningRef=useRef(false);
  const[active,setActive]=useState(false);const[error,setError]=useState(null);const[manualVal,setManualVal]=useState('');
  const detectorRef=useRef(null);
  const[scanMode,setScanMode]=useState('barcode');// 'barcode' | 'text'
  const[ocrStatus,setOcrStatus]=useState('');// OCR progress status
  const[ocrResults,setOcrResults]=useState([]);// extracted PO numbers from OCR
  const ocrBusyRef=useRef(false);
  const canvasRef=useRef(null);

  const startCamera=async()=>{
    setError(null);setOcrResults([]);setOcrStatus('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}});
      streamRef.current=stream;
      const v=videoRef.current;
      if(v){
        v.srcObject=stream;
        await new Promise((resolve)=>{
          if(v.readyState>=v.HAVE_METADATA){resolve();return}
          v.onloadedmetadata=()=>resolve();
        });
        await v.play();
      }
      setActive(true);
      if(scanMode==='barcode'){
        const DetectorImpl='BarcodeDetector' in window?window.BarcodeDetector:BarcodeDetectorPolyfill;
        detectorRef.current=new DetectorImpl({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','codabar','itf']});
      }
      scanningRef.current=true;
      if(scanMode==='barcode')scanLoop();
    }catch(err){
      if(err.name==='NotAllowedError')setError('Camera permission denied. Please allow camera access and try again.');
      else if(err.name==='NotFoundError')setError('No camera found. Use manual entry below.');
      else setError('Camera error: '+err.message);
    }
  };

  const scanLoop=async()=>{
    if(!scanningRef.current||!videoRef.current||!detectorRef.current)return;
    try{
      const barcodes=await detectorRef.current.detect(videoRef.current);
      if(barcodes.length>0){
        const val=barcodes[0].rawValue;
        if(val){stopCamera();onScan(val);return}
      }
    }catch(err){if(err?.name!=='InvalidStateError')console.warn('[BarcodeScanner] detect error:',err?.message||err)}
    requestAnimationFrame(()=>setTimeout(scanLoop,150));
  };

  // Capture a frame from video for OCR
  const captureFrame=()=>{
    const v=videoRef.current;
    if(!v||!v.videoWidth)return null;
    let canvas=canvasRef.current;
    if(!canvas){canvas=document.createElement('canvas');canvasRef.current=canvas}
    canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(v,0,0);
    return canvas;
  };

  // Run OCR on current camera frame
  const runOCR=async()=>{
    if(ocrBusyRef.current)return;
    ocrBusyRef.current=true;
    setOcrStatus('Reading text...');setOcrResults([]);
    try{
      const canvas=captureFrame();
      if(!canvas){setOcrStatus('No camera frame available');ocrBusyRef.current=false;return}
      const worker=await createWorker('eng');
      const{data:{text}}=await worker.recognize(canvas);
      await worker.terminate();
      if(!text||!text.trim()){setOcrStatus('No text detected — try adjusting angle');ocrBusyRef.current=false;return}
      // Extract PO numbers from OCR text
      const po=extractPOFromText(text);
      if(po){
        setOcrResults([po]);setOcrStatus('Found PO: '+po);
      }else{
        // Show raw text so user can pick out the PO
        const lines=text.split('\n').map(l=>l.trim()).filter(l=>l.length>2);
        setOcrResults(lines.slice(0,10));
        setOcrStatus('No PO pattern found — select a line or try again');
      }
    }catch(err){
      console.warn('[OCR] error:',err?.message||err);
      setOcrStatus('OCR error: '+(err?.message||'Unknown error'));
    }
    ocrBusyRef.current=false;
  };

  const stopCamera=()=>{
    scanningRef.current=false;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null}
    if(videoRef.current){videoRef.current.srcObject=null}
    setActive(false);setOcrStatus('');setOcrResults([]);
  };

  // Cleanup on unmount
  React.useEffect(()=>()=>{scanningRef.current=false;if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop())};},[]);

  // Restart camera when mode changes while active
  const prevMode=useRef(scanMode);
  React.useEffect(()=>{
    if(prevMode.current!==scanMode&&active){stopCamera();setTimeout(()=>startCamera(),200)}
    prevMode.current=scanMode;
  },[scanMode]);// eslint-disable-line react-hooks/exhaustive-deps

  const handleManual=(e)=>{
    if(e.key==='Enter'&&manualVal.trim()){onScan(manualVal.trim());setManualVal('')}
  };

  return<div style={{background:'#0f172a',borderRadius:12,overflow:'hidden',border:'2px solid #334155'}}>
    {/* Mode toggle */}
    <div style={{display:'flex',borderBottom:'1px solid #1e293b'}}>
      <button onClick={()=>setScanMode('barcode')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='barcode'?'#1e293b':'transparent',color:scanMode==='barcode'?'#22c55e':'#64748b',borderBottom:scanMode==='barcode'?'2px solid #22c55e':'2px solid transparent'}}>
        Barcode Scan
      </button>
      <button onClick={()=>setScanMode('text')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='text'?'#1e293b':'transparent',color:scanMode==='text'?'#f59e0b':'#64748b',borderBottom:scanMode==='text'?'2px solid #f59e0b':'2px solid transparent'}}>
        PO Text Scan
      </button>
    </div>
    {/* Single video element always in DOM so ref/stream survive re-renders */}
    <div style={{position:'relative',background:'#000',display:active?'block':'none'}}>
      <video ref={videoRef} style={{width:'100%',maxHeight:280,objectFit:'cover',display:'block'}} autoPlay playsInline muted/>
      {/* Scan overlay */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <div style={{width:scanMode==='text'?280:200,height:scanMode==='text'?160:200,
          border:scanMode==='text'?'2px solid rgba(245,158,11,0.7)':'2px solid rgba(34,197,94,0.7)',borderRadius:12,boxShadow:'0 0 0 9999px rgba(0,0,0,0.3)'}}/>
      </div>
      <div style={{position:'absolute',bottom:scanMode==='text'?40:8,left:0,right:0,textAlign:'center',
        color:scanMode==='text'?'#f59e0b':'#22c55e',fontSize:11,fontWeight:600,textShadow:'0 1px 3px rgba(0,0,0,0.8)'}}>
        {scanMode==='text'?'Point camera at PO label, then tap Capture':'Point camera at barcode or QR code'}
      </div>
      {scanMode==='text'&&<button onClick={runOCR} disabled={ocrBusyRef.current}
        style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50)',background:ocrBusyRef.current?'#475569':'#f59e0b',
          color:ocrBusyRef.current?'#94a3b8':'#000',border:'none',borderRadius:8,padding:'6px 24px',cursor:ocrBusyRef.current?'default':'pointer',fontSize:13,fontWeight:700}}>
        {ocrBusyRef.current?'Reading...':'Capture & Read'}
      </button>}
      <button onClick={stopCamera} style={{position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.6)',border:'none',color:'white',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:12}}>Close Camera</button>
    </div>
    {/* OCR results */}
    {scanMode==='text'&&active&&(ocrStatus||ocrResults.length>0)&&<div style={{padding:'8px 12px',borderBottom:'1px solid #1e293b'}}>
      {ocrStatus&&<div style={{fontSize:11,color:ocrResults.length===1?'#22c55e':'#f59e0b',marginBottom:ocrResults.length>1?6:0,fontWeight:600}}>{ocrStatus}</div>}
      {ocrResults.length===1&&<button onClick={()=>{const v=ocrResults[0];stopCamera();onScan(v)}}
        style={{marginTop:4,width:'100%',background:'#22c55e',color:'#000',border:'none',borderRadius:6,padding:'8px',fontSize:13,fontWeight:700,cursor:'pointer'}}>
        Use: {ocrResults[0]}
      </button>}
      {ocrResults.length>1&&<div style={{maxHeight:120,overflowY:'auto'}}>
        {ocrResults.map((line,i)=><button key={i} onClick={()=>{stopCamera();onScan(line)}}
          style={{display:'block',width:'100%',textAlign:'left',background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155',borderRadius:4,padding:'4px 8px',marginBottom:2,fontSize:11,fontFamily:'monospace',cursor:'pointer',':hover':{background:'#334155'}}}>
          {line}
        </button>)}
      </div>}
    </div>}
    {!active&&<div style={{padding:'20px',textAlign:'center'}}>
      {error?<div style={{color:'#f87171',fontSize:12,marginBottom:10}}>{error}</div>:
      <div style={{color:'#94a3b8',fontSize:12,marginBottom:10}}>
        {scanMode==='text'?'Open the camera to scan PO text from shipping labels':'Open the camera to scan barcodes/QR codes, or type manually below'}
      </div>}
      <button onClick={startCamera} style={{background:scanMode==='text'?'#f59e0b':'#22c55e',color:scanMode==='text'?'#000':'white',border:'none',borderRadius:8,padding:'10px 24px',fontSize:14,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Open Camera
      </button>
    </div>}
    {/* Manual entry always available */}
    <div style={{padding:'10px 16px',borderTop:'1px solid #1e293b',display:'flex',gap:8}}>
      <input value={manualVal} onChange={e=>setManualVal(e.target.value)} onKeyDown={handleManual}
        placeholder={placeholder} style={{flex:1,background:'#1e293b',border:'1px solid #334155',borderRadius:6,padding:'8px 12px',color:'white',fontSize:13,fontWeight:600,fontFamily:'monospace'}}/>
      <button onClick={()=>{if(manualVal.trim()){onScan(manualVal.trim());setManualVal('')}}}
        style={{background:'#2563eb',color:'white',border:'none',borderRadius:6,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Look Up</button>
      {onClose&&<button onClick={onClose} style={{background:'#334155',color:'#94a3b8',border:'none',borderRadius:6,padding:'8px 12px',cursor:'pointer',fontSize:12}}>Cancel</button>}
    </div>
  </div>;
};

// MAIN APP


export default CoachPortal;
