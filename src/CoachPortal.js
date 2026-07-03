/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { SZ_ORD, pantoneHex, NSA, prodFilesStatusFor } from './constants';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs, safeFirm, safeArt, resolveMockLink, mockLinkDependents, mockLinkSourceFiles, soLineKey, jobItemDecosOfKind } from './safeHelpers';
import { calcSOStatus } from './components';
import { dP, rQ, SP, calcOrderTotals, calcAdidasItemSpend } from './pricing';
import { _portalAction, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, printDoc, buildDocHtml, pdfDecoLabel, getBillingContacts, invokeEdgeFn, cloudUpload } from './utils';
import { StripePaymentModal } from './modals';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './lib/supabase';
import { CatalogKitStyles, KitScope, DISPLAY } from './ui/catalogKit';
import { fetchStockMap } from './lib/storeInventory';
import StoreBuilder from './storefront/BuildStore';
import { RosterOrdersCoach } from './RosterOrders';

// The coach portal is also embedded in the marketing site (nationalsportsapparel.com)
// via an iframe with ?embed=1 — the same pattern as /team-stores and /livelook.
// When embedded, links to other surfaces must break OUT of the iframe (target=_top)
// and point at the marketing domain; opened directly, they open in a new tab.
const CP_EMBEDDED = (() => { try { return new URLSearchParams(window.location.search).get('embed') === '1'; } catch { return false; } })();
const CP_MARKETING = 'https://nationalsportsapparel.com';
const CP_LINK_TARGET = CP_EMBEDDED ? '_top' : '_blank';
// Live Look = the live-inventory catalog. Marketing wraps it at /livelook; the
// portal serves it directly at /adidas.
const CP_LIVELOOK_URL = CP_EMBEDDED ? `${CP_MARKETING}/livelook` : '/adidas';

// Read-only team-store view for the coach: headline order/fundraising/batch
// summary up top, with the per-player order list as a searchable, collapsible
// section below. No editing.
const _cpMoney = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _cpStages = { pending: 'Ordered', received: 'Received', in_production: 'In production', bagging: 'Bagging', shipped: 'Shipped', complete: 'Complete' };
const _cpTone = (s) => s === 'complete' ? '#166534' : s === 'shipped' ? '#1e40af' : s === 'bagging' ? '#86198f' : s === 'in_production' ? '#92400e' : s === 'received' ? '#3730a3' : '#64748b';

// ── Team-colored portal header ───────────────────────────────────────
// Wear the team's own colors in the portal header, the way each webstore
// header is themed by its store colors. customer.school_colors is an array of
// catalog color-family names (e.g. ["Navy","Orange","White"]); families + hexes
// match src/CoachCatalogAccess.js and src/storefront/AdidasInventory.js.
const CP_HEX = { Black: '#191919', White: '#FFFFFF', Grey: '#9AA1AC', Navy: '#1B2A4A', Royal: '#2148C7', Blue: '#3B82F6', Red: '#C8102E', Maroon: '#6B1F2A', Orange: '#EA580C', Gold: '#C9A227', Yellow: '#EAB308', Green: '#15803D', Purple: '#6D28D9', Pink: '#EC4899', Brown: '#7C4A21' };
// Darkest-first: which team color makes the best deep banner background (white
// text stays readable). Light/neutral families are intentionally excluded.
const CP_PRIMARY_PREF = ['Navy', 'Maroon', 'Purple', 'Green', 'Royal', 'Brown', 'Red', 'Black', 'Blue'];
// Brightest-first: which team color pops best as the accent underline/eyebrow.
const CP_ACCENT_PREF = ['Orange', 'Red', 'Gold', 'Yellow', 'Royal', 'Blue', 'Green', 'Pink', 'Purple', 'Maroon', 'Navy'];
const CP_DEFAULT_THEME = { primary: '#1e3a5f', accent: '#2563eb' }; // NSA navy/blue fallback
// Lighten (pct>0) / darken (pct<0) a hex — mirrors storefront/Storefront.js shade().
const cpShade = (hex, pct) => {
  try {
    const h = (hex || '#1e3a5f').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  } catch { return hex; }
};
// Resolve a {primary, accent} header theme from a customer's school colors.
// primary is always a dark, readable banner color (a dark team color or the NSA
// navy default); accent is the team's brightest color (or a tonal fallback).
function cpTeamTheme(customer) {
  const fams = Array.isArray(customer && customer.school_colors) ? customer.school_colors.filter((f) => CP_HEX[f]) : [];
  if (!fams.length) return { ...CP_DEFAULT_THEME };
  const darkFam = CP_PRIMARY_PREF.find((f) => fams.includes(f));
  const primary = darkFam ? CP_HEX[darkFam] : CP_DEFAULT_THEME.primary;
  const accentFam = CP_ACCENT_PREF.find((f) => fams.includes(f) && f !== darkFam)
    || fams.find((f) => f !== darkFam && f !== 'White' && f !== 'Grey' && f !== 'Black');
  const accent = (accentFam && CP_HEX[accentFam]) || cpShade(primary, 45);
  return { primary, accent };
}

function CoachStore({ customer, storeIds }) {
  const [stores, setStores] = useState([]);
  const [data, setData] = useState({}); // storeId -> {orders, items, roster}
  const [loaded, setLoaded] = useState(false);
  // For an athletic-dept (parent) account, storeIds covers the dept + every sub-team so
  // the parent sees all its teams' stores; for a single team it's [self, parent]. Falls
  // back to [self, parent] when no explicit set is passed.
  const _storeIdKey = (storeIds && storeIds.length ? storeIds : [customer.id, customer.parent_id]).filter(Boolean).join(',');
  useEffect(() => {
    let cancel = false;
    (async () => {
      const ids = _storeIdKey ? _storeIdKey.split(',') : [];
      if (!ids.length) { setLoaded(true); return; }
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
  }, [_storeIdKey]);

  if (!loaded) return null;
  // The coach sees their own submissions as "pending review"; staff work-in-
  // progress drafts stay hidden until published. Everything live renders as the
  // usual order-tracking card.
  const pending = stores.filter((s) => s.status === 'draft' && s.created_via === 'coach');
  const live = stores.filter((s) => s.status !== 'draft' && s.status !== 'archived');
  if (!pending.length && !live.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      {pending.map((s) => (
        <div key={s.id} style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 14, padding: '16px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 26 }}>⏳</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>{s.name}</div>
            <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 2 }}>Submitted — pending our review. We'll set up shipping &amp; checkout and email you when it's live.</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap' }}>Pending review</span>
        </div>
      ))}
      {live.map((s) => <CoachStoreCard key={s.id} store={s} d={data[s.id] || { orders: [], items: [], roster: [] }} />)}
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
  const[paySuccess,setPaySuccess]=useState(null);// {amount,fee,invoices,intentId}
  const[receiptEmail,setReceiptEmail]=useState('');// email-receipt recipient (prefilled w/ contact)
  const[receiptStatus,setReceiptStatus]=useState(null);// null|'sending'|'sent'|'error'
  const[invs,setInvs]=useState(initInvs);
  const[lightbox,setLightbox]=useState(null);// url string for lightbox overlay
  const[storeBuilder,setStoreBuilder]=useState(false);// coach self-serve store builder view
  const[adRange,setAdRange]=useState('period');// AD spend dashboard scope: 'period' | 'all'
  const[spendView,setSpendView]=useState(false);// AD Spend & Promo full-screen view
  const[page,setPage]=useState('home');// portal nav: home|orders|estimates|billing|art|shop
  const[artQuery,setArtQuery]=useState('');const[artDeco,setArtDeco]=useState('all');// Art Locker filters
  const[artView,setArtView]=useState(null);// Art Locker rich viewer: {art, idx}
  const[spendMode,setSpendMode]=useState('all');// dashboard metric: 'all' | 'adidas' (items only)
  const[teamFilter,setTeamFilter]=useState('all');// AD-only: filter Orders/Estimates/Art by sport (sub-customer)
  useEffect(()=>setInvs(initInvs),[initInvs]);
  const isP=!customer.parent_id;
  // ── NSA design tokens — hoisted so detail views (estimate/order/art) theme too ──
  const cpTheme=cpTeamTheme(customer);
  const cpMonogram=((customer.name||'').match(/\b[A-Za-z0-9]/g)||[]).slice(0,2).join('').toUpperCase()||'NS';
  const _nsaHasColors=Array.isArray(customer.school_colors)&&customer.school_colors.length>0;
  const tPrimary=_nsaHasColors?cpTheme.primary:'#192853';
  const tAccent=_nsaHasColors?cpTheme.accent:'#962C32';
  const tNavyDark=cpShade(tPrimary,-22),tNavyMid=cpShade(tPrimary,8),tNavyTint=cpShade(tPrimary,20);
  const tAccentLight=cpShade(tAccent,26),tAccentSoft=cpShade(tAccent,86);
  const _nsaHash='repeating-linear-gradient(-55deg, rgba(255,255,255,.04) 0 1px, transparent 1px 8px)';
  const _nsaFont="'Source Sans 3',system-ui,sans-serif";
  const _nsaImport="@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Source+Sans+3:wght@400;600;700&display=swap');";
  const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  // Logo: use own logo_url, fall back to parent's logo if sub has none set
  const _parentCust=customer.parent_id?(allCustomers||[]).find(c=>c.id===customer.parent_id):null;
  const cpLogo=customer.logo_url||(_parentCust&&_parentCust.logo_url)||null;
  // ── Team store presence — drives the conditional "Team Store" nav tab. Lightweight
  // top-level lookup (the full per-store tracking is fetched by <CoachStore/> when the
  // tab is opened). A store earns the tab when the coach should see it: any live/non-draft
  // store, or their own submitted draft awaiting review (mirrors CoachStore's render rule).
  // Parent/athletic-dept accounts track the dept's own store + every sub-team's store;
  // a single team tracks its own + its parent dept's. This same id set gates the nav tab
  // and is passed to <CoachStore/> so the tab's visibility always matches what it renders.
  const cpStoreCustomerIds=(isP?ids:[customer.id,customer.parent_id]).filter(Boolean);
  const[cpStores,setCpStores]=useState([]);
  const _cpStoreKey=cpStoreCustomerIds.join(',');
  useEffect(()=>{let cancel=false;(async()=>{
    const sIds=_cpStoreKey?_cpStoreKey.split(','):[];
    if(!sIds.length){if(!cancel)setCpStores([]);return;}
    const{data}=await supabase.from('webstores').select('id,name,slug,status,created_via,close_at').in('customer_id',sIds);
    if(!cancel)setCpStores(data||[]);
  })();return()=>{cancel=true;};},[_cpStoreKey]);
  const cpVisibleStores=cpStores.filter(s=>s.status!=='archived'&&(s.status!=='draft'||s.created_via==='coach'));
  const hasStore=cpVisibleStores.length>0;
  const openStoreCount=cpStores.filter(s=>s.status==='open').length;
  // Roster orders — invite-gated per customer (Catalog Access → coach_roster), same
  // pattern as coach_ai_builder/coach_livelook/coach_build_orders.
  const hasRoster=!!customer.coach_roster;
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
  // Active orders collapse on the portal — default collapsed for department/parent accounts and
  // long lists (they aggregate every team's orders), expanded for a regular single-team coach.
  const[ordersOpen,setOrdersOpen]=useState(!(isP||activeSOs.length>3));
  const openEstCount=custEsts.filter(e=>e.status==='sent'||e.status==='open').length;
  // ── Art Locker — every design the team has run, gathered from order artwork & mockups.
  // Deduped by art name + decoration; each card tracks which teams/orders used it.
  const artLibrary=(()=>{
    const map=new Map();
    custSOs.forEach(so=>{
      const team=((allCustomers||[]).find(c=>c.id===so.customer_id)||{}).name||customer.name;
      safeArt(so).forEach(af=>{
        const imgs=_filterDisplayable([...Object.values(af.item_mockups||{}).flatMap(a=>a||[]),...(af.mockup_files||[]),...(af.files||[])]);
        const urls=imgs.map(f=>typeof f==='string'?f:((f&&f.url)||'')).filter(u=>u&&isUrl(u));
        if(!urls.length)return;
        const name=af.name||af.logo_name||'Artwork';
        const deco=(af.deco_type||'').replace(/_/g,' ').trim();
        const key=(name+'|'+(af.deco_type||'')).toLowerCase();
        let rec=map.get(key);
        if(!rec){rec={key,name,deco,urls:new Set(),teams:new Set(),orders:new Set(),createdAt:so.created_at||''};map.set(key,rec);}
        urls.forEach(u=>rec.urls.add(u));if(team)rec.teams.add(team);rec.orders.add(so.id);
        if((so.created_at||'')>rec.createdAt)rec.createdAt=so.created_at||rec.createdAt;
      });
    });
    return[...map.values()].map(r=>({...r,urls:[...r.urls],teams:[...r.teams],orders:[...r.orders]})).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  })();
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
  // Invite-gated coach-portal capabilities — set per customer in Catalog Access
  // (CustDetail → Catalog tab). Default off so nothing new shows for everyone.
  const coachAiBuilder=!!customer.coach_ai_builder;
  const coachLivelook=!!customer.coach_livelook;
  const coachBuildOrders=!!customer.coach_build_orders;

  // ── Athletic-director Spend & Promo dashboard data (opt-in via customer.ad_spend_tracking) ──
  // Rolls up the family root (parent_id||id) + every team beneath it. Spend uses calcOrderTotals
  // (products + decoration; shipping & tax excluded). Promo reads the owner's merged periods.
  // Dates are parsed with Date() — order_date/created_at are stored M/D/YYYY, so an ISO string
  // compare would wrongly drop everything from the current-period filter.
  const adData=customer.ad_spend_tracking?(()=>{
    const now=new Date();const y=now.getFullYear();const h1=now.getMonth()<6;
    const period=h1?{start:y+'-01-01',end:y+'-06-30',label:'Jan–Jun '+y}:{start:y+'-07-01',end:y+'-12-31',label:'Jul–Dec '+y};
    const pStart=new Date(period.start+'T00:00:00').getTime();const pEnd=new Date(period.end+'T23:59:59').getTime();
    const parse=v=>{if(!v)return null;let d=new Date(v);if(isNaN(d.getTime()))d=new Date(String(v).replace(' ','T'));return isNaN(d.getTime())?null:d.getTime();};
    const inRange=so=>{if(adRange==='all')return true;const t=parse(so.order_date||so.created_at);return t!=null&&t>=pStart&&t<=pEnd;};
    const adRoot=customer.parent_id||customer.id;
    const adFamily=(allCustomers||[]).filter(c=>c.id===adRoot||c.parent_id===adRoot);
    const deptName=(adFamily.find(c=>c.id===adRoot)||customer).name||'Athletic department';
    const teamCount=adFamily.filter(c=>c.id!==adRoot).length;
    const teams=adFamily.map(c=>{const isDept=c.id===adRoot;const tSOs=(sos||[]).filter(s=>s.customer_id===c.id&&inRange(s));const spend=tSOs.reduce((a,s)=>a+(calcOrderTotals(s).rev||0),0);const adidas=tSOs.reduce((a,s)=>a+(calcAdidasItemSpend(s)||0),0);return{id:c.id,name:c.name||'Team',isDept,spend,adidas,orders:tSOs.length};}).filter(t=>!t.isDept||t.orders>0).sort((a,b)=>b.spend-a.spend);
    const totalSpend=teams.reduce((a,t)=>a+t.spend,0);
    const adidasTotal=teams.reduce((a,t)=>a+t.adidas,0);
    const maxSpend=teams.reduce((a,t)=>Math.max(a,t.spend),0)||1;
    const periods=customer.promo_periods||[];
    const scoped=adRange==='all'?periods:periods.filter(p=>p.period_start===period.start);
    const allocated=scoped.reduce((a,p)=>a+(p.allocated||0),0);
    const used=scoped.reduce((a,p)=>a+(p.used||0),0);
    const remaining=allocated-used;const remainingDisplay=Math.max(0,remaining);const overspent=remaining<0;
    const hasPromo=periods.length>0;
    const usedPct=allocated>0?Math.min(100,Math.round(used/allocated*100)):0;
    const money=n=>'$'+Math.round(n||0).toLocaleString();
    const money2=n=>'$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    return{period,teams,totalSpend,adidasTotal,maxSpend,allocated,used,remaining,remainingDisplay,overspent,hasPromo,deptName,teamCount,usedPct,money,money2};
  })():null;

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
      setReceiptEmail(contactEmail||'');setReceiptStatus(null);
      setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices||[],intentId:result.intentId,processing:true});
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
    setReceiptEmail(contactEmail||'');setReceiptStatus(null);
    setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices,intentId:result.intentId});
    setShowPay(null);setInvView(null);setPayLoading(false);
  };

  // Email a full itemized receipt for the just-completed payment. Content is built server-side from
  // our own DB + Stripe (see netlify/functions/receipt.js), so the client only passes the intent id
  // and a recipient address — it can't dictate what the receipt says.
  const sendReceipt=async()=>{
    const email=(receiptEmail||'').trim();
    if(!paySuccess?.intentId)return;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){setReceiptStatus('error');return;}
    setReceiptStatus('sending');
    try{
      const resp=await fetch('/.netlify/functions/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payment_intent_id:paySuccess.intentId,email})});
      setReceiptStatus(resp.ok?'sent':'error');
    }catch(e){setReceiptStatus('error');}
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
            setReceiptEmail(contactEmail||'');setReceiptStatus(null);
            setPaySuccess({amount:collected,fee:0,invoices:[],intentId:paymentIntent.id});
          }
        }else if(paymentIntent.status==='processing'){
          setReceiptEmail(contactEmail||'');setReceiptStatus(null);
          setPaySuccess({amount:(paymentIntent.amount||0)/100,fee:0,invoices:[],intentId:paymentIntent.id,processing:true});
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
    const _estStatusPill=est.status==='approved'?['Approved','#1F7A43','#E8F5EC']:est.status==='converted'?['Converted to Order','#1A3A6B','#E6ECF5']:['Open',tAccent,tAccentSoft];
    return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:_nsaFont,color:'#2A2F3E',display:'flex',justifyContent:'center',padding:'32px 16px'}}>
      <style>{_nsaImport+`.nsa-disp{font-family:'Barlow Condensed',sans-serif}.nsa-skew{transform:skewX(-3deg)}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}`}</style>
      <div style={{width:'100%',maxWidth:660}}>
        <button className="nsa-disp" onClick={()=>setEstView(null)} style={{display:'inline-flex',alignItems:'center',gap:8,background:'#fff',border:'1px solid #EEF1F6',color:tPrimary,fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 16px',borderRadius:4,cursor:'pointer',marginBottom:16,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>← Back to Estimates</button>
        <div style={{background:'#fff',borderRadius:8,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{position:'relative',overflow:'hidden',padding:'28px 28px 24px',color:'#fff',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 60%, ${tNavyMid} 100%)`}}>
          <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:0,right:0,width:120,height:'100%',background:tAccent,opacity:.9,clipPath:'polygon(38% 0, 100% 0, 100% 100%, 0 100%)'}}/>
          <div style={{position:'relative'}}>
            <div className="nsa-disp" style={{fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Estimate</div>
            <div className="nsa-disp" style={{fontWeight:800,fontSize:34,textTransform:'uppercase',lineHeight:1.02,marginTop:2}}>{est.memo||est.id}</div>
            <div style={{width:60,height:4,background:tAccentLight,transform:'skewX(-12deg)',margin:'10px 0 8px'}}/>
            <div style={{fontSize:13,color:'rgba(255,255,255,.8)'}}>{est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
          </div>
        </div>
        <div style={{padding:'22px 28px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap',padding:'4px 0 18px',borderBottom:'1px solid #EEF1F6',marginBottom:18}}>
            <div>
              <div className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0'}}>Estimated Total</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:44,color:tPrimary,lineHeight:1}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:_estStatusPill[2],color:_estStatusPill[1],fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 12px',borderRadius:4,marginTop:8}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{_estStatusPill[0]}</span></span>
            </div>
            <button className="nsa-disp" onClick={downloadEstPdf} style={{background:'#fff',color:tPrimary,border:`2px solid ${tPrimary}`,borderRadius:4,padding:'11px 18px',fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}}>📄 Download PDF</button>
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
          <div style={{borderTop:'1px solid #EEF1F6',paddingTop:14,marginBottom:18}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Subtotal</span><span style={{fontWeight:700,color:'#2A2F3E'}}>${estSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {estShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Shipping</span><span>${estShip.toFixed(2)}</span></div>}
            {estTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Tax ({(estTaxRate*100).toFixed(2)}%)</span><span>${estTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'12px 0 4px',borderTop:`2px solid ${tPrimary}`,marginTop:8}}>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Estimated Total</span><span className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {canApprove&&<button id="est-approve-btn" className="nsa-skew nsa-disp" style={{width:'100%',padding:'15px 20px',background:tAccent,color:'white',border:'none',borderRadius:4,fontSize:17,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer',marginBottom:10}} onClick={async()=>{
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
          }}><span>✅ Approve This Estimate</span></button>}
          {canApprove&&<div id="est-request-box" style={{border:'1px solid #EEF1F6',borderRadius:6,padding:18,marginBottom:10,background:'#F7F8FB'}}>
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
      </div>
      {/* Sticky action bar — keeps Approve / Request changes reachable on long estimates without forcing the coach to commit before reviewing the items above */}
      {canApprove&&<div style={{position:'fixed',left:0,right:0,bottom:0,display:'flex',justifyContent:'center',padding:'10px 16px',background:'rgba(255,255,255,0.92)',backdropFilter:'blur(6px)',borderTop:'1px solid #EEF1F6',boxShadow:'0 -2px 12px rgba(0,0,0,0.06)',zIndex:50}}>
        <div style={{width:'100%',maxWidth:660,display:'flex',gap:10}}>
          <button className="nsa-disp" style={{flex:1,padding:'13px 16px',background:'#fff',color:tAccent,border:`2px solid ${tAccent}`,borderRadius:4,fontSize:14,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}} onClick={()=>document.getElementById('est-request-box')?.scrollIntoView({behavior:'smooth',block:'center'})}>✏️ Request changes</button>
          <button className="nsa-skew nsa-disp" style={{flex:1,padding:'13px 16px',background:tAccent,color:'#fff',border:'none',borderRadius:4,fontSize:14,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}} onClick={()=>document.getElementById('est-approve-btn')?.scrollIntoView({behavior:'smooth',block:'center'})}><span>✅ Approve</span></button>
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
    const _soSt=calcSOStatus(so);const _soStMap={complete:['Delivered','#5A6075','#EEF1F6'],shipped:['Shipped','#1F7A43','#E8F5EC'],bagging:['Bagging',tPrimary,'#E6ECF5'],in_production:['In Production',tPrimary,'#E6ECF5'],received:['Received',tPrimary,'#E6ECF5'],pending:['Ordered','#5A6075','#EEF1F6']};
    const _soSm=_soStMap[_soSt]||['Ordered','#5A6075','#EEF1F6'];
    return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:_nsaFont,color:'#2A2F3E',display:'flex',justifyContent:'center',padding:'32px 16px'}}>
      <style>{_nsaImport+`.nsa-disp{font-family:'Barlow Condensed',sans-serif}.nsa-skew{transform:skewX(-3deg)}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}`}</style>
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:660}}>
        <button className="nsa-disp" onClick={()=>setSoView(null)} style={{display:'inline-flex',alignItems:'center',gap:8,background:'#fff',border:'1px solid #EEF1F6',color:tPrimary,fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 16px',borderRadius:4,cursor:'pointer',marginBottom:16,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>← Back to Orders</button>
        <div style={{background:'#fff',borderRadius:8,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        {/* NSA hero */}
        <div style={{position:'relative',overflow:'hidden',padding:'28px 28px 24px',color:'#fff',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 60%, ${tNavyMid} 100%)`}}>
          <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:0,right:0,width:120,height:'100%',background:tAccent,opacity:.9,clipPath:'polygon(38% 0, 100% 0, 100% 100%, 0 100%)'}}/>
          <div style={{position:'relative'}}>
            <div className="nsa-disp" style={{fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Order</div>
            <div className="nsa-disp" style={{fontWeight:800,fontSize:34,textTransform:'uppercase',lineHeight:1.02,marginTop:2}}>{so.memo||so.id}</div>
            <div style={{width:60,height:4,background:tAccentLight,transform:'skewX(-12deg)',margin:'10px 0 8px'}}/>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div style={{fontSize:13,color:'rgba(255,255,255,.8)'}}>{so.id}{so.created_at?' · '+so.created_at.split(' ')[0]:''}{so.expected_date?' · ETA '+so.expected_date:''}</div>
              <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:'rgba(0,0,0,.25)',color:'#fff',fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'3px 10px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{_soSm[0]}</span></span>
            </div>
          </div>
        </div>
        <div style={{padding:'22px 28px'}}>
          {/* Progress bar */}
          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <span className="nsa-disp" style={{fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'#5A6075'}}>Order Progress</span>
              <span className="nsa-disp" style={{fontSize:14,fontWeight:800,color:soPct>=100?'#1F7A43':tPrimary}}>{soPct}%</span>
            </div>
            <div style={{background:'#EEF1F6',borderRadius:999,height:7,overflow:'hidden'}}>
              <div style={{height:7,borderRadius:999,background:soPct>=100?'#1F7A43':tPrimary,width:soPct+'%',transition:'width 0.4s'}}/>
            </div>
            {soDaysOut!=null&&<div style={{fontSize:12,color:soDaysOut<=7?tAccent:'#94A0B0',marginTop:5,textAlign:'right',fontWeight:600}}>{soDaysOut>0?soDaysOut+' day'+(soDaysOut!==1?'s':'')+' out':soDaysOut===0?'Due today':'Overdue'}</div>}
          </div>
          {/* Section label */}
          <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Items</div>
          {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            let recvQ=0;Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);recvQ+=Math.min(v,pQ+rQ)});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);decoTotal+=eq2*dp2.sell});
            const lineTotal=qty*safeNum(it.unit_sell)+decoTotal;
            const _prd=(prod||[]).find(pp=>pp.id===it.product_id||pp.sku===it.sku);
            const itImg=_prd?.image_url||(_prd?.images&&_prd.images[0])||it._colorImage||'';
            const recvPct=qty>0?Math.round(recvQ/qty*100):0;
            return<div key={ii} style={{border:'1px solid #EEF1F6',borderLeft:`4px solid ${tPrimary}`,borderRadius:6,padding:'14px 16px',marginBottom:10,background:'#fff'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div style={{flex:1,display:'flex',gap:12,alignItems:'center'}}>
                  {itImg&&isUrl(itImg)?<img src={itImg} alt={safeStr(it.name)||'Item'} title="Click to enlarge" onClick={()=>setLightbox(itImg)} style={{width:52,height:52,objectFit:'cover',borderRadius:6,border:'1px solid #EEF1F6',flexShrink:0,cursor:'zoom-in'}}/>
                  :<div style={{width:52,height:52,background:'#F7F8FB',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:'1px solid #EEF1F6'}}><div style={{fontSize:22}}>👕</div></div>}
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.05}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{it.sku} · {safeStr(it.color)||'—'}{it.brand?' · '+it.brand:''}</div>
                  </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div className="nsa-disp" style={{fontWeight:800,fontSize:18,color:tPrimary}}>${lineTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:12,color:'#94A0B0'}}>{qty} units</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
                <div style={{flex:1,background:'#EEF1F6',borderRadius:999,height:5,overflow:'hidden'}}>
                  <div style={{height:5,borderRadius:999,background:recvQ>=qty?'#1F7A43':tPrimary,width:recvPct+'%',transition:'width .4s'}}/>
                </div>
                <span style={{fontSize:12,fontWeight:600,color:recvQ>=qty?'#1F7A43':'#94A0B0',whiteSpace:'nowrap'}}>{recvQ} of {qty} received</span>
              </div>
              {(()=>{const _szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])<0?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])<0?99:SZ_ORD.indexOf(b[0])));
                if(_szList.length===0)return null;
                return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:10}}>
                  {_szList.map(([sz,sq])=><div key={sz} style={{textAlign:'center',padding:'4px 10px',background:'#F7F8FB',borderRadius:4,minWidth:36,border:'1px solid #EEF1F6'}}>
                    <div className="nsa-disp" style={{fontSize:9,fontWeight:700,color:'#94A0B0',letterSpacing:'.5px'}}>{sz}</div>
                    <div className="nsa-disp" style={{fontSize:14,fontWeight:800,color:tPrimary}}>{sq}</div>
                  </div>)}
                </div>})()}
            </div>})}
          {/* Order totals */}
          <div style={{borderTop:'1px solid #EEF1F6',paddingTop:14,marginBottom:18,marginTop:6}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Subtotal</span><span style={{fontWeight:700,color:'#2A2F3E'}}>${soSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {soShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Shipping</span><span>${soShip.toFixed(2)}</span></div>}
            {soTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Tax ({(soTaxRate*100).toFixed(2)}%)</span><span>${soTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'12px 0 4px',borderTop:`2px solid ${tPrimary}`,marginTop:8}}>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Total</span>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary}}>${soTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {/* Artwork & Decoration jobs */}
          {soJobsList.length>0&&<>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Artwork &amp; Decoration</div>
            {soJobsList.map(j=>{const artFile=soAF.find(a=>a.id===j.art_file_id);const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));(j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);
              const _jSkus=new Set((j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return it?.sku||gi.sku}).filter(Boolean));
              const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus.has(k.split('|')[0])).flatMap(([,arr])=>arr||[])));
              const _jMf=_jIm.length===0?_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[])):[];
              const _jSeen=new Set();const mockups=[..._jIm,..._jMf].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_jSeen.has(u))return false;_jSeen.add(u);return true});
              const _clickJob=()=>{setJobView({job:j,so});setComment('');if(j.sent_to_coach_at&&!j.coach_email_opened_at){const liveSO2=sos.find(s=>s.id===so.id);if(liveSO2){const updSO2={...liveSO2,jobs:(liveSO2.jobs||safeJobs(liveSO2)).map(jj=>jj.id===j.id?{...jj,coach_email_opened_at:new Date().toISOString()}:jj),updated_at:new Date().toLocaleString()};if(savSOFn)savSOFn(updSO2);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO2:s))}}};
              const _jWait=j.art_status==='waiting_approval';
              return<div key={j.id} style={{border:`1px solid ${_jWait?tAccent:'#EEF1F6'}`,background:_jWait?tAccentSoft:'#F7F8FB',borderRadius:6,marginBottom:8,overflow:'hidden',cursor:'pointer'}} onClick={_clickJob}>
                {mockups.length>0&&<div style={{display:'grid',gridTemplateColumns:mockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#EEF1F6'}}>
                  {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);const isPdf=_isPdfUrl(url,f);const pdfThumb=isPdf?_cloudinaryPdfThumb(url):null;
                    return<div key={fi} style={{background:'white'}}>
                      {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                      :isPdf&&pdfThumb?<img src={pdfThumb} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}} onError={e=>{e.target.style.display='none'}}/>
                      :<div style={{height:mockups.length>1?140:200,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                    </div>})}
                </div>}
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px'}}>
                  <div style={{flex:1}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary}}>{j.art_name}</div>
                    <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                  </div>
                  <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#E8F5EC':_jWait?tAccentSoft:'#EEF1F6',color:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#1F7A43':_jWait?tAccent:'#5A6075',fontWeight:700,fontSize:10,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 10px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{artLabelsP[j.art_status]}</span></span>
                  <span style={{color:'#94A0B0',fontSize:16}}>›</span>
                </div>
              </div>})}
          </>}
          {/* Shipping / Tracking */}
          {soAllShipments.length>0&&<div style={{marginTop:14}}>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Shipping &amp; Tracking</div>
            {soAllShipments.map((shp,si)=><div key={si} style={{padding:'12px 16px',background:'#E8F5EC',border:'1px solid #A7D9B5',borderRadius:6,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
              <div>
                <div className="nsa-disp" style={{fontSize:14,fontWeight:700,color:'#1F7A43',textTransform:'uppercase'}}>📦 {shp.carrier||'Package'}{soAllShipments.length>1?' #'+(si+1):''}</div>
                {shp.ship_date&&<div style={{fontSize:12,color:'#5A6075',marginTop:2}}>Shipped {shp.ship_date}</div>}
                {shp.tracking_number&&<div style={{fontSize:11,fontFamily:'monospace',color:'#5A6075',marginTop:3}}>{shp.tracking_number}</div>}
              </div>
              {shp.tracking_number&&<a href={shp.tracking_url||((/^1Z/i.test(shp.tracking_number))?'https://www.ups.com/track?tracknum='+shp.tracking_number:'https://www.fedex.com/fedextrack/?trknbr='+shp.tracking_number)} target="_blank" rel="noreferrer" className="nsa-disp" style={{fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'#1F7A43',textDecoration:'none',border:'2px solid #1F7A43',borderRadius:4,padding:'7px 14px',flexShrink:0}}>Track →</a>}
            </div>)}
          </div>}
          {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'10px 14px',background:'#E8F5EC',border:'1px solid #A7D9B5',borderRadius:6,fontSize:13,color:'#1F7A43',fontWeight:600}}>
            📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||'TBD'}</div>}
        </div>
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
            const itemMockups=_mySrc?[]:_filterDisplayable(_cpDecosSorted.length>1?_cpDecosSorted.flatMap((d,i)=>{const af3=safeArt(so).find(a=>a.id===d.art_file_id);if(!af3)return[];const disc=i===0?'':(d.color_way_id||('d'+i));const key=_mk+(disc?('|'+disc):'');const im=af3?.item_mockups||{};const v=im[key];if(v&&v.length>0)return[v[0]];const f=_cpFirst(af3);return f?[f]:[];}):_itemArtFiles.length>1?_itemArtFiles.flatMap(_af=>{const f=_cpFirst(_af);return f?[f]:[]}):_itemArtFiles.flatMap(_af=>{const im=_af?.item_mockups||{};const v=im[_mk];return v&&v.length>0?v:(im[gi.sku]||[])})).concat(/* suffixed slots: reversible Side B, numbers, names */_filterDisplayable(_itemArtFiles.flatMap(_af=>Object.entries(_af?.item_mockups||{}).filter(([k,arr])=>k.startsWith(_mk+'|')&&Array.isArray(arr)&&arr.length>0).flatMap(([,arr])=>arr)))).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seenIm.has(u))return false;_seenIm.add(u);return true});
            const artDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'):[];
            const artPos=artDecos.map(d=>d.position||'Front Center').filter((v,idx,arr)=>arr.indexOf(v)===idx);
            // Numbers/names shown only when THIS job produces them — the coach approving a logo
            // job shouldn't see the sibling numbers job's roster on it.
            const numDecos=srcItem?jobItemDecosOfKind(gi,srcItem,'numbers'):[];
            const nameDecos=srcItem?jobItemDecosOfKind(gi,srcItem,'names'):[];
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
                // Pin the approval to the artwork on screen: every mock URL in view must still
                // exist server-side, or the approve conflicts instead of recording an approval
                // for an image the artist has since replaced.
                const _sm=new Set();const _seenMocks=[...mockups,..._jobArtFiles.flatMap(_af=>Object.values(_af?.item_mockups||{}).flat())].map(f=>typeof f==='string'?f:((f&&(f.url||f.name))||'')).filter(u=>{if(!u||_sm.has(u))return false;_sm.add(u);return true});
                // Rep to notify: creator → customer's primary rep → monitored inbox, so a rep
                // missing an email never silently swallows the decision (mirrors the estimate path).
                const rep=REPS.find(r=>r.id===liveSO.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _apprTo=rep?.email||'steve@nationalsportsapparel.com';
                const commentHtml=coachComment?'<p style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px"><strong>Coach\'s note:</strong> '+coachComment+'</p>':'';
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                // Server FIRST — apply_coach_art_decision (portal-action) verifies the job is
                // still awaiting the coach and applies the whole write set in one transaction;
                // local state only flips after it commits, so a stale tab never shows a phantom approval.
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  artDecision:{so_id:liveSO.id,job_id:j.id,decision:'approve',comment:coachComment||null,art_ids:jArtIds,approved_status:_apSt,seen_mocks:_seenMocks},
                  email:{to:[{email:_apprTo}],cc:_accCc,subject:'✅ Art approved by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p>'+commentHtml+'<p>The job is now ready for production file prep.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',...(rep?.email?{replyTo:{email:rep.email,name:rep.name}}:{})},
                });
                if(!_res.ok){alert(_res.error||'Could not save your approval — please try again or contact your rep.');return}
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:_apSt,coach_approved_at:new Date().toISOString(),coach_approval_comment:coachComment||undefined,coach_rejected:false}:jj),art_files:safeArt(liveSO).map(a=>jArtIds.includes(a.id)?{...a,status:'approved'}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                setComment('');// stay on the job view — it re-renders from live state to show the "approved" banner
              }}>✅ Approve Artwork</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'10px 16px'}} onClick={async()=>{
                if(!comment.trim()){alert('Please describe what changes you need.');return}
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const _fb=comment.trim();
                const _rejAt=new Date().toISOString();
                // Both key spellings on purpose: the portal reads `at`, the dashboard todo reads `rejected_at`.
                const rej={reason:_fb,by:'Coach',at:_rejAt,rejected_at:_rejAt};
                const rArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const _curJob=(liveSO.jobs||safeJobs(liveSO)).find(jj=>jj.id===j.id);
                const _newRejections=[...((_curJob&&_curJob.rejections)||[]),rej];
                const rep=REPS.find(r=>r.id===liveSO.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _rejTo=rep?.email||'steve@nationalsportsapparel.com';
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                const _safeText=_fb.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');
                // Server FIRST — the guarded transaction sends the job back to the artist with the
                // COMPLETE write set (send timestamp cleared, seps confirmation cleared) or conflicts
                // if this tab is stale; local state only flips after it commits.
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  artDecision:{so_id:liveSO.id,job_id:j.id,decision:'reject',comment:_fb,art_ids:rArtIds},
                  email:{to:[{email:_rejTo}],cc:_accCc,subject:'📝 Art changes requested by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p><strong>'+customer.name+'</strong> requested changes to the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p><div style="margin:12px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b"><div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;margin-bottom:4px">Coach\'s feedback</div>'+_safeText+'</div><p>Please revise the artwork and resend it for approval.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',...(rep?.email?{replyTo:{email:rep.email,name:rep.name}}:{})},
                });
                if(!_res.ok){alert(_res.error||'Could not send your request — please try again or contact your rep.');return}
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:'art_requested',coach_rejected:true,rejections:_newRejections,sent_to_coach_at:null}:jj),art_files:safeArt(liveSO).map(a=>rArtIds.includes(a.id)?{...a,status:'waiting_for_art',notes:(a.notes?a.notes+'\n':'')+'Coach feedback: '+_fb,prod_files_attached:false}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
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
                    {/* Prefer the invoice's stored line rate (garment + decoration, what the customer is
                        actually billed) — it.unit_sell is garment-only, which made lines not add up to
                        the invoice total (INV-63089: $16 shown for an $18 all-in item). Match by the
                        canonical soLineKey (same helper that stamped _so_line_key at invoice creation);
                        the fallback requires sku + color + qty and refuses ambiguous matches. */}
                    <div style={{fontSize:10,color:'#64748b'}}>${(()=>{const lis=inv.line_items||[];let li=lis.find(l=>l._so_line_key===soLineKey(it,ii));if(!li){const cands=lis.filter(l=>(l._sku||l.sku)===it.sku&&(l._color==null||l._color===it.color)&&safeNum(l.qty)===qty);if(cands.length===1)li=cands[0]}return safeNum(li&&li.rate!=null?li.rate:it.unit_sell)})().toFixed(2)}/ea</div>
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
  if(storeBuilder) return <StoreBuilder mode="coach" customer={customer} rep={rep} onClose={()=>setStoreBuilder(false)} />;

  // ── Athletic-director Spend & Promo — full-screen dashboard opened from the portal link ──
  if(spendView&&adData){
    const{period,teams,totalSpend,adidasTotal,allocated,used,remaining,remainingDisplay,overspent,hasPromo,deptName,teamCount,usedPct,money,money2}=adData;
    const teamsActive=teams.filter(t=>t.orders>0);
    const teamsZero=teams.filter(t=>t.orders===0);
    const adiAvail=adidasTotal>0;const isAdi=adiAvail&&spendMode==='adidas';const metric=isAdi?'adidas':'spend';
    const modeMax=Math.max(1,...teamsActive.map(t=>t[metric]||0));const modeTotal=isAdi?adidasTotal:totalSpend;
    return<div style={{minHeight:'100vh',background:'#f1f5f9',padding:'32px 16px'}}>
      <style>{`.ad-teams{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}@media(max-width:680px){.ad-teams{grid-template-columns:1fr}}.ad-top{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:stretch}@media(max-width:800px){.ad-top{grid-template-columns:1fr}}`}</style>
      <div style={{maxWidth:1000,margin:'0 auto'}}>
        <button onClick={()=>setSpendView(false)} style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,textTransform:'uppercase',letterSpacing:.5,color:'#64748b',background:'none',border:'none',cursor:'pointer',padding:0,marginBottom:14}}>‹ Back to Dashboard</button>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:20,marginBottom:26,flexWrap:'wrap'}}>
          <div>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:2,textTransform:'uppercase',color:tAccent,marginBottom:8}}>Athletic Department</div>
            <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:0,lineHeight:1}}>Spend &amp; Promo</h1>
            <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',margin:'12px 0 10px'}}/>
            <div style={{fontSize:15,color:'#64748b'}}>{deptName} · {teamCount} team{teamCount!==1?'s':''}</div>
          </div>
          <div style={{display:'flex',background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:4,boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
            {[['period',period.label],['all','All time']].map(([k,lbl])=>(
              <button key={k} onClick={()=>setAdRange(k)} className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:.5,textTransform:'uppercase',padding:'9px 18px',border:'none',borderRadius:4,cursor:'pointer',background:adRange===k?tPrimary:'transparent',color:adRange===k?'#fff':'#64748b',transition:'all .15s'}}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="ad-top" style={{marginBottom:34}}>
          {hasPromo&&<div style={{position:'relative',overflow:'hidden',borderRadius:8,boxShadow:'0 8px 32px rgba(0,0,0,.18)',background:`linear-gradient(125deg,${tNavyDark} 0%,${tPrimary} 60%,${tNavyMid} 100%)`,padding:'28px 30px',color:'#fff'}}>
            <div style={{position:'absolute',inset:0,background:'repeating-linear-gradient(-55deg,transparent,transparent 26px,rgba(255,255,255,.02) 26px,rgba(255,255,255,.02) 52px)'}}/>
            <div style={{position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:18}}>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:1.5,textTransform:'uppercase',color:'rgba(255,255,255,.62)'}}>Promo Budget · {adRange==='all'?'All time':period.label}</div>
                {overspent&&<span className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:.5,textTransform:'uppercase',background:tAccent,color:'#fff',padding:'4px 11px',borderRadius:999,whiteSpace:'nowrap'}}>Over by {money2(-remaining)}</span>}
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:12}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:52,lineHeight:1,color:'#fff'}}>{money2(used)}</div>
                <div style={{fontSize:15,color:'rgba(255,255,255,.7)'}}>used of {money2(allocated)}</div>
              </div>
              <div style={{height:10,background:'rgba(255,255,255,.14)',borderRadius:999,overflow:'hidden',margin:'20px 0 8px'}}>
                <div style={{height:'100%',width:Math.min(usedPct,100)+'%',background:overspent?'linear-gradient(90deg,#f59e0b,#b45309)':'linear-gradient(90deg,#22c55e,#15803d)',borderRadius:999}}/>
              </div>
              <div style={{fontSize:13,color:'rgba(255,255,255,.6)'}}>{usedPct}% used{overspent?' · over budget':remainingDisplay>0?' · '+money2(remainingDisplay)+' remaining':''}</div>
              <div style={{display:'flex',gap:26,marginTop:22,paddingTop:20,borderTop:'1px solid rgba(255,255,255,.14)'}}>
                {[['Allocated',money2(allocated)],['Applied to Orders',money2(used)],['Remaining',money2(remainingDisplay)]].map(([lbl,val])=>(
                  <div key={lbl}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:11,letterSpacing:1,textTransform:'uppercase',color:'rgba(255,255,255,.55)'}}>{lbl}</div>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:22,color:lbl==='Remaining'?tAccentLight:'#fff',marginTop:2}}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>}
          <div style={{display:'flex',flexDirection:'column',gap:22,...(!hasPromo?{gridColumn:'1/-1'}:{})}}>
            <div style={{flex:1,background:'#fff',border:'1px solid #e2e8f0',borderTop:`3px solid ${tPrimary}`,borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'24px 26px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#94a3b8'}}>Department Spend</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:40,color:tPrimary,lineHeight:1.05,margin:'5px 0 3px'}}>{money(totalSpend)}</div>
              <div style={{fontSize:13,color:'#64748b'}}>{adRange==='all'?'All time':period.label} · {teamsActive.length} active</div>
            </div>
            {adiAvail&&<div style={{flex:1,background:'#fff',border:'1px solid #e2e8f0',borderTop:`3px solid ${tAccent}`,borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'24px 26px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#94a3b8'}}>Adidas Items</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:40,color:tPrimary,lineHeight:1.05,margin:'5px 0 3px'}}>{money(adidasTotal)}</div>
              <div style={{fontSize:13,color:'#64748b'}}>Items only · no deco</div>
            </div>}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:18,flexWrap:'wrap'}}>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:22,textTransform:'uppercase',color:tPrimary}}>{isAdi?'Adidas Spend by Team':'Spend by Team'}</div>
          {adiAvail&&<div style={{display:'flex',background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:4,boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
            {[['all','All Spend'],['adidas','Adidas Only']].map(([k,lbl])=>(
              <button key={k} onClick={()=>setSpendMode(k)} className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:.5,textTransform:'uppercase',padding:'8px 16px',border:'none',borderRadius:4,cursor:'pointer',background:spendMode===k?tPrimary:'transparent',color:spendMode===k?'#fff':'#64748b',transition:'all .15s'}}>{lbl}</button>
            ))}
          </div>}
        </div>
        {teamsActive.length===0?
          <div style={{color:'#94a3b8',fontSize:13,padding:'20px 4px',textAlign:'center',border:'1px dashed #e2e8f0',borderRadius:10}}>No team spend {adRange==='all'?'on record yet':'in '+period.label}.{adRange!=='all'?<> Try <button onClick={()=>setAdRange('all')} style={{border:'none',background:'none',color:tPrimary,fontWeight:700,cursor:'pointer',textDecoration:'underline',padding:0,font:'inherit'}}>All time</button>.</>:null}</div>:
          <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'10px 28px'}}>
            <div className="ad-teams">
              {teamsActive.map(t=>{const val=t[metric]||0;const w=Math.round(val/modeMax*100);const share=modeTotal>0?Math.round(val/modeTotal*100):0;
                return<div key={t.id} style={{padding:'16px 0',borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:14,marginBottom:9}}>
                    <div className="nsa-disp" style={{flex:1,minWidth:0,fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{t.isDept?'🏛️ ':''}{t.name}</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:9,flexShrink:0}}>
                      <span className="nsa-disp" style={{fontWeight:800,fontSize:16,color:tPrimary}}>{money2(val)}</span>
                      <span style={{fontSize:12,color:'#94a3b8',width:30,textAlign:'right'}}>{share}%</span>
                    </div>
                  </div>
                  <div style={{height:6,background:'#f1f5f9',borderRadius:999,overflow:'hidden'}}><div style={{height:'100%',width:w+'%',background:tAccent,borderRadius:999}}/></div>
                </div>;
              })}
            </div>
          </div>}
        {teamsZero.length>0&&<details style={{marginTop:16}}>
          <summary style={{cursor:'pointer',fontSize:12.5,fontWeight:700,color:'#64748b'}}>{teamsZero.length} team{teamsZero.length!==1?'s':''} with no orders {adRange==='all'?'on record':'in '+period.label}</summary>
          <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
            {teamsZero.map(t=><span key={t.id} style={{fontSize:12,color:'#64748b',background:'#f8fafc',border:'1px solid #eef2f7',borderRadius:999,padding:'4px 11px'}}>{t.name}</span>)}
          </div>
        </details>}
        <div style={{fontSize:11,color:'#94a3b8',marginTop:20,lineHeight:1.5,borderTop:'1px solid #f1f5f9',paddingTop:14}}>
          {isAdi?'Adidas items only — decoration, shipping & tax are excluded.':'Spend reflects products & decoration only — shipping and tax are excluded.'}{hasPromo?' Promo dollars are shared across the whole department.':''}
        </div>
      </div>
    </div>;
  }

  // Main portal view — a branded "Team HQ" shell: team-colored sidebar + bottom nav, paged content.
  const cpTint=cpShade(cpTheme.primary,84);// light team-tint for active nav pills & highlights
  const cpNav=[
    {key:'home',label:'Home',icon:'🏠'},
    {key:'orders',label:'Orders',icon:'📦',badge:activeSOs.length},
    {key:'estimates',label:'Estimates',icon:'📋',badge:openEstCount},
    ...(hasRoster?[{key:'roster',label:'Roster',icon:'📋'}]:[]),
    ...(hasStore?[{key:'store',label:'Store',icon:'🛍️',badge:openStoreCount}]:[]),
    {key:'billing',label:'Billing',icon:'💳',badge:openInvs.length},
    {key:'art',label:'Art',icon:'🎨'},
    {key:'shop',label:'Shop',icon:'🛍️'},
    ...(adData?[{key:'spend',label:'Spend & Promo',icon:'📊',onClick:()=>setSpendView(true)}]:[]),
  ];
  // Reorder a saved design through Live Look — deep-links the catalog with the artwork so the
  // coach picks gear and the design rides along to the rep on the order request.
  const cpOrderWithArt=(a,url)=>{
    const base=CP_LIVELOOK_URL;const sep=base.includes('?')?'&':'?';
    const href=base+sep+'art='+encodeURIComponent(url||a.urls[0]||'')+'&an='+encodeURIComponent(a.name||'Design')+(a.deco?'&ad='+encodeURIComponent(a.deco):'');
    try{window.open(href,CP_LINK_TARGET,'noopener');}catch(e){window.location.href=href;}
  };
  // ── NSA nav (design tokens are hoisted to the top of the component) ──
  const _nsaNav=[['home','Dashboard'],['orders','Orders'],['estimates','Estimates'],...(hasRoster?[['roster','Roster']]:[]),...(hasStore?[['store','Team Store']]:[]),['art','Art Locker'],['billing','Billing'],['shop','Shop']];
  // AD-only "filter by sport" — the parent's sub-customers (teams) + the dept itself.
  const _teamName=id=>id==='all'?'all':(((allCustomers||[]).find(c=>c.id===id)||{}).name||'');
  const _teamOpts=isP?[{id:customer.id,name:'Athletic Dept.'},...[...subs].sort((a,b)=>(a.name||'').localeCompare(b.name||''))]:[];
  const _teamSort=(a,b)=>(_teamName(a.customer_id)||'').localeCompare(_teamName(b.customer_id)||'');
  const _teamSelect=(<select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} className="nsa-disp" style={{border:'1px solid #EEF1F6',borderRadius:4,padding:'10px 12px',fontSize:13,fontWeight:700,textTransform:'uppercase',letterSpacing:'.3px',color:tPrimary,background:'#fff',cursor:'pointer',maxWidth:260}}><option value="all">All teams</option>{_teamOpts.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>);
  return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:"'Source Sans 3',system-ui,sans-serif",color:'#2A2F3E'}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Source+Sans+3:wght@400;600;700&display=swap');
      .nsa-disp{font-family:'Barlow Condensed','Source Sans 3',system-ui,sans-serif}
      .nsa-tile{transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s,border-color .25s}
      .nsa-tile:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(25,40,83,.12)!important}
      .nsa-card{transition:background .2s}.nsa-card:hover{background:#F7F8FB}
      .nsa-nav{position:relative;background:none;border:none;cursor:pointer;height:84px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;text-transform:uppercase;letter-spacing:.8px;font-size:16px;font-weight:700;transition:color .2s}
      .nsa-skew{transform:skewX(-3deg);transition:transform .2s,background .2s,filter .2s}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}.nsa-skew:hover{transform:skewX(-3deg) translateY(-2px)}
      .nsa-desknav{display:none}@media(min-width:881px){.nsa-desknav{display:flex}}
      @media(max-width:880px){.nsa-mkt-util{font-size:11px}}
      .cp-bottomnav{position:fixed;left:12px;right:12px;bottom:12px;display:flex;justify-content:space-around;z-index:40;padding:8px 4px;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,.22);background:#fff;border:1px solid #EEF1F6}@media(min-width:881px){.cp-bottomnav{display:none}}
      .cp-bottombtn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;border:none;background:none;cursor:pointer;padding:3px 2px;font-size:10px;font-weight:800}
      .cp-grid{display:block}.cp-col{min-width:0}.cp-page{max-width:1240px;margin:0 auto}
      .cp-tool{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid #EEF1F6;background:#fff;border-radius:6px;padding:14px 16px;cursor:pointer;text-decoration:none;color:inherit;transition:border-color .12s,box-shadow .12s}.cp-tool:hover{box-shadow:0 2px 10px rgba(0,0,0,.08)}
      .cp-adidas{transition:box-shadow .14s,transform .14s}.cp-adidas:hover{box-shadow:0 6px 18px rgba(0,0,0,.22);transform:translateY(-1px)}
    `}</style>
    {/* ── Utility bar ── */}
    <div className="nsa-mkt-util" style={{background:tNavyDark,color:'rgba(255,255,255,.85)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',padding:'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',fontSize:13}}>
        <span className="nsa-disp" style={{fontWeight:700,textTransform:'uppercase',letterSpacing:'1.5px'}}><span style={{color:tAccentLight}}>★</span> Team Portal — Powered by National Sports Apparel <span style={{color:tAccentLight}}>★</span></span>
        <span style={{display:'flex',gap:16,alignItems:'center',fontWeight:600}}><span style={{opacity:.6}}>Need help?</span><a href="mailto:hello@nationalsportsapparel.com" style={{color:'#fff',textDecoration:'none'}}>hello@nationalsportsapparel.com</a><a href="tel:7142798777" style={{color:'#fff',textDecoration:'none'}}>(714) 279-8777</a></span>
      </div>
    </div>
    {/* ── Sticky header ── */}
    <div style={{background:'#fff',position:'sticky',top:0,zIndex:50,boxShadow:'0 4px 24px rgba(0,0,0,.08)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',display:'flex',alignItems:'center',gap:16,padding:'0 24px',height:84}}>
        <img src="/NEW NSA Logo on white.png" alt="NSA" style={{height:50,cursor:'pointer',flexShrink:0}} onClick={()=>setPage('home')}/>
        <div className="nsa-desknav" style={{flex:1,justifyContent:'center',alignItems:'center'}}>
          {_nsaNav.map(([k,lbl])=>{const active=page===k;const badge=k==='orders'?activeSOs.length:k==='estimates'?openEstCount:k==='store'?openStoreCount:0;return(
            <button key={k} className="nsa-nav nsa-disp" onClick={()=>setPage(k)} style={{color:active?tAccent:tPrimary}}>
              <span>{lbl}</span>
              {badge>0?<span className="nsa-disp" style={{fontWeight:700,fontSize:11,background:k==='estimates'?tAccent:tPrimary,color:'#fff',borderRadius:999,padding:'2px 7px',lineHeight:1}}>{badge}</span>:null}
              <span style={{position:'absolute',left:12,right:12,bottom:20,height:3,background:tAccent,transform:`skewX(-12deg) scaleX(${active?1:0})`,transformOrigin:'left',transition:'transform .25s ease'}}/>
            </button>
          )})}
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10,border:'1px solid #EEF1F6',borderRadius:999,padding:'6px 6px 6px 14px',flexShrink:0}}>
          <div style={{textAlign:'right',lineHeight:1.15}}>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:14,textTransform:'uppercase',letterSpacing:'.5px',color:tPrimary}}>{customer.name}</div>
            <div style={{fontSize:11,color:'#5A6075'}}>{(customer.contacts||[])[0]?.name||'Coach'}</div>
          </div>
          <div className="nsa-disp" style={{width:38,height:38,borderRadius:999,overflow:'hidden',background:customer.logo_url?'#fff':tPrimary,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:15,flexShrink:0}}>{cpLogo?<img src={cpLogo} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:cpMonogram}</div>
        </div>
      </div>
    </div>
    {/* ── Striped rule — sticks just below the header so the brand bar stays visible while scrolling ── */}
    <div style={{height:8,position:'sticky',top:84,zIndex:49,boxShadow:'0 2px 6px rgba(0,0,0,.12)',background:`repeating-linear-gradient(90deg, ${tAccent} 0 30%, ${tPrimary} 30% 32%, ${tAccent} 32% 70%, ${tPrimary} 70% 72%, ${tAccent} 72% 100%)`}}/>
    {/* ── MAIN ── */}
    <div className="cp-main" style={{maxWidth:1240,margin:'0 auto',padding:'36px 24px 110px'}}>
        <div className="cp-page">
        <div className="cp-grid">

        {/* ── content sections (each gated to a nav page) ── */}
        <div className="cp-col">
        {/* ── HOME HUB — school hero + color-coordinated section tiles (the launchpad) ── */}
        {page==='home'&&<div>
          <style>{`.nsa-qa{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.nsa-attn,.nsa-rep{display:grid;gap:24px}.nsa-attn{grid-template-columns:1fr 1fr}.nsa-rep{grid-template-columns:1.3fr 1fr}@media(max-width:880px){.nsa-qa{grid-template-columns:1fr}.nsa-attn,.nsa-rep{grid-template-columns:1fr}.nsa-herologo{display:none!important}.nsa-heroleft{max-width:100%!important}}`}</style>
          {/* ── Pennant hero ── */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:8,minHeight:320,boxShadow:'0 16px 40px rgba(0,0,0,.25)',marginBottom:28,background:`linear-gradient(120deg, ${tPrimary} 0%, ${tNavyMid} 58%, ${tNavyTint} 100%)`}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:0,right:0,bottom:0,width:'46%',background:tAccent,opacity:.14,clipPath:'polygon(28% 0,100% 0,100% 100%,0 100%)',pointerEvents:'none'}}/>
            <div className="nsa-herologo" style={{position:'absolute',top:0,right:0,bottom:0,width:'42%',display:'flex',alignItems:'center',justifyContent:'center',padding:'34px 40px'}}>
              <div style={{width:'100%',height:'100%',borderRadius:10,background:'rgba(255,255,255,.05)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {cpLogo?<img src={cpLogo} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>:<div style={{textAlign:'center',color:'rgba(255,255,255,.45)'}}><div className="nsa-disp" style={{fontSize:64,fontWeight:800,letterSpacing:'-.04em',lineHeight:1}}>{cpMonogram}</div><div style={{fontSize:12,marginTop:6}}>Set team logo (customer detail)</div></div>}
              </div>
            </div>
            <div className="nsa-heroleft" style={{position:'relative',maxWidth:'56%',padding:'40px',color:'#fff'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'1px',color:tAccentLight,textTransform:'uppercase'}}>★ Team HQ ★</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:48,lineHeight:.98,textTransform:'uppercase',margin:'10px 0 0'}}>{customer.name}</h1>
              <div style={{fontSize:15,color:'rgba(255,255,255,.78)',marginTop:10}}>{isP?(adData?adData.teamCount:subs.length)+' teams · ':''}Powered by National Sports Apparel</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:18}}>
                <span className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.6)'}}>Team Colors</span>
                {[tPrimary,tAccent,'#ffffff'].map((c,i)=><span key={i} style={{width:24,height:24,background:c,border:'2px solid rgba(255,255,255,.5)',transform:'skewX(-12deg)'}}/>)}
              </div>
              {totalDue>0&&<><div style={{height:1,background:'rgba(255,255,255,.15)',margin:'22px 0 18px',maxWidth:400}}/>
              <div style={{display:'flex',alignItems:'center',gap:22,flexWrap:'wrap'}}>
                <div><div className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.6)'}}>Balance Due</div><div className="nsa-disp" style={{fontWeight:800,fontSize:38,color:tAccentLight,lineHeight:1}}>${totalDue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
                <button className="nsa-skew nsa-disp" onClick={()=>setPage('billing')} style={{background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'12px 22px',borderRadius:4,cursor:'pointer'}}><span>Pay Balance →</span></button>
              </div></>}
            </div>
          </div>
          {/* ── Quick Access ── */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:22,textTransform:'uppercase',letterSpacing:'.5px',color:tPrimary,margin:'8px 0 16px'}}>Quick Access</div>
          <div className="nsa-qa">
            {(()=>{const qa=[
              {k:'orders',t:'Orders',sub:activeSOs.length+' active',icon:'📦',accent:false},
              {k:'estimates',t:'Estimates',sub:openEstCount?openEstCount+' to approve':'All clear',icon:'📋',accent:true,sa:openEstCount>0},
              {k:'art',t:'Art Locker',sub:artLibrary.length+' design'+(artLibrary.length!==1?'s':''),icon:'🎨',accent:false},
              {k:'billing',t:'Billing',sub:totalDue>0?'$'+totalDue.toLocaleString(undefined,{minimumFractionDigits:2})+' due':'Up to date',icon:'💳',accent:true,sa:totalDue>0},
              {k:'shop',t:'Catalogs',sub:'Browse the team store',icon:'🛍️',accent:false},
              ...(adData?[{k:'spend',t:'Promo & Spend',sub:adData.hasPromo?adData.money2(adData.remainingDisplay)+' promo balance':'View report',icon:'📊',accent:false,onClick:()=>setSpendView(true)}]:[]),
            ];
            return qa.map(q=>(
              <button key={q.k} className="nsa-tile" onClick={q.onClick||(()=>setPage(q.k))} style={{background:'#fff',border:'1px solid #EEF1F6',borderTop:`3px solid ${q.accent?tAccent:tPrimary}`,borderRadius:6,padding:22,display:'flex',alignItems:'center',gap:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',cursor:'pointer',textAlign:'left'}}>
                <span style={{width:50,height:50,flexShrink:0,borderRadius:6,background:q.accent?tAccent:tPrimary,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>{q.icon}</span>
                <span style={{minWidth:0}}>
                  <span className="nsa-disp" style={{display:'block',fontWeight:700,fontSize:19,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>{q.t}</span>
                  <span style={{display:'block',fontSize:13,color:q.sa?tAccent:'#5A6075',fontWeight:q.sa?700:400,marginTop:4}}>{q.sub}</span>
                </span>
              </button>
            ));})()}
          </div>
          {/* ── Needs Your Attention ── */}
          <div className="nsa-attn" style={{marginTop:28}}>
            {(()=>{const openE=custEsts.filter(e=>e.status==='sent'||e.status==='open').slice(0,3);return(
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 22px'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Estimates to Approve</div>
                <button onClick={()=>setPage('estimates')} className="nsa-disp" style={{background:'none',border:'none',cursor:'pointer',color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase'}}>View all →</button>
              </div>
              {openE.length===0?<div style={{padding:'0 22px 18px',color:'#5A6075',fontSize:13}}>You're all caught up — nothing waiting.</div>:
               openE.map(est=>{const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';const tt=calcEstTotal(est);
                return<div key={est.id} className="nsa-card" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn||est.memo||est.id}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo||est.id} · ${tt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  </div>
                  <button className="nsa-skew nsa-disp" onClick={(ev)=>{ev.stopPropagation();setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{flexShrink:0,background:tPrimary,color:'#fff',border:'none',fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 18px',borderRadius:4,cursor:'pointer'}}><span>Approve</span></button>
                </div>})}
            </div>);})()}
            {(()=>{const jobs=waitingArtJobs.slice(0,3);return(
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 22px'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Designs to Review</div>
                <button onClick={()=>setPage('art')} className="nsa-disp" style={{background:'none',border:'none',cursor:'pointer',color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase'}}>Art Locker →</button>
              </div>
              {jobs.length===0?<div style={{padding:'0 22px 18px',color:'#5A6075',fontSize:13}}>No proofs waiting on you right now.</div>:
               jobs.map((j,ix)=>{const so=j.so;
                return<div key={j.id} className="nsa-card" style={{display:'flex',alignItems:'center',gap:12,padding:'12px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>{setSoView(so);setJobView({job:j,so});setComment('')}}>
                  <div className="nsa-disp" style={{width:46,height:54,flexShrink:0,borderRadius:4,background:`linear-gradient(150deg, ${tPrimary} 0%, ${tNavyMid} 100%)`,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,.85)',fontWeight:800,fontSize:16,clipPath:'polygon(0 0,100% 0,100% 100%,8px 100%,0 calc(100% - 8px))'}}>{String(ix+1).padStart(2,'0')}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.art_name||so.memo||'Artwork'}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo||so.id}</div>
                  </div>
                  <button className="nsa-disp" onClick={(ev)=>{ev.stopPropagation();setSoView(so);setJobView({job:j,so});setComment('')}} style={{flexShrink:0,background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:12,letterSpacing:'.5px',textTransform:'uppercase',padding:'7px 14px',borderRadius:4,cursor:'pointer'}}>Review</button>
                </div>})}
            </div>);})()}
          </div>
          {/* ── Rep + Contact ── */}
          <div className="nsa-rep" style={{marginTop:24}}>
            <div style={{position:'relative',overflow:'hidden',borderRadius:6,padding:'24px 28px',color:'#fff',background:`linear-gradient(120deg, ${tPrimary}, ${tNavyMid})`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>
              <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
              <div style={{position:'relative',minWidth:0}}>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:tAccentLight}}>Your Dedicated Rep</div>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:26,textTransform:'uppercase',marginTop:4}}>{rep?.name||'NSA Team'}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,.7)',marginTop:3}}>Knows your teams, your colors, your deadlines.</div>
              </div>
              <a href={`mailto:${rep?.email||'team@nsa-teamwear.com'}`} className="nsa-skew nsa-disp" style={{position:'relative',flexShrink:0,background:tAccent,color:'#fff',textDecoration:'none',fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px 20px',borderRadius:4}}><span>Contact {(rep?.name||'NSA Team').split(' ')[0]}</span></a>
            </div>
            <div style={{background:'#fff',border:'1px dashed #D1D5DE',borderRadius:6,padding:'20px 22px'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary}}>Contact &amp; Shipping</div>
              <div style={{fontSize:13,color:'#5A6075',margin:'6px 0 12px'}}>{(customer.contacts||[])[0]?.name||'—'}{(customer.contacts||[])[0]?.email?' · '+(customer.contacts||[])[0].email:''}{customer.shipping_city?' · '+customer.shipping_city+', '+(customer.shipping_state||''):''}</div>
              <button onClick={()=>setContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})} className="nsa-disp" style={{background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:13,textTransform:'uppercase',padding:'8px 16px',borderRadius:4,cursor:'pointer'}}>Request Update</button>
            </div>
          </div>
        </div>}
        {/* ── ART LOCKER (NSA spec — navy proof tiles) ── */}
        {page==='art'&&(()=>{
          const decos=['all',...Array.from(new Set(artLibrary.map(a=>a.deco).filter(Boolean)))];
          const q=artQuery.trim().toLowerCase();
          const _tfName=isP&&teamFilter!=='all'?_teamName(teamFilter):null;
          let filtered=artLibrary.filter(a=>(artDeco==='all'||a.deco===artDeco)&&(!q||a.name.toLowerCase().includes(q)||(a.deco||'').toLowerCase().includes(q))&&(!_tfName||(a.teams||[]).includes(_tfName)));
          if(isP)filtered=[...filtered].sort((a,b)=>((a.teams||[])[0]||'').localeCompare((b.teams||[])[0]||''));
          return<div>
            <style>{`.nsa-artgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}@media(max-width:980px){.nsa-artgrid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.nsa-artgrid{grid-template-columns:1fr}}.nsa-arttile{background:#fff;border:1px solid #EEF1F6;border-radius:6px;overflow:hidden;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .25s,box-shadow .25s}.nsa-arttile:hover{transform:translateY(-6px);box-shadow:0 16px 40px rgba(0,0,0,.22)}`}</style>
            <div style={{marginBottom:24}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Proofs &amp; Approved Designs</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Art Locker</h1>
              <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
            </div>
            {artLibrary.length===0?
              <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,padding:'48px',textAlign:'center',color:'#5A6075'}}>Every design we mock up for your team is collected here — ready to view, download &amp; re-order.</div>
            :<>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
                <input value={artQuery} onChange={e=>setArtQuery(e.target.value)} placeholder={'Search '+artLibrary.length+' design'+(artLibrary.length!==1?'s':'')+'…'} style={{flex:'1 1 220px',minWidth:160,padding:'11px 14px',border:'1px solid #EEF1F6',borderRadius:6,fontSize:14,fontFamily:'inherit'}}/>
                {isP&&_teamSelect}
                {decos.length>2&&decos.map(d=>{const on=artDeco===d;return<button key={d} onClick={()=>setArtDeco(d)} className="nsa-disp" style={{border:'none',background:on?tPrimary:'#fff',color:on?'#fff':'#5A6075',borderRadius:4,padding:'9px 14px',fontSize:12,fontWeight:700,cursor:'pointer',textTransform:'uppercase',letterSpacing:'.5px',boxShadow:on?'none':'0 1px 2px rgba(0,0,0,.06)'}}>{d==='all'?'All':d}</button>})}
              </div>
              {filtered.length===0?<div style={{color:'#5A6075',fontSize:14,padding:'24px',textAlign:'center'}}>No designs match your search.</div>:
              <div className="nsa-artgrid">
                {filtered.map(a=>{const u=a.urls[0];const isPdf=_isPdfUrl(u);const thumb=isPdf?_cloudinaryPdfThumb(u):u;
                  return<div key={a.key} className="nsa-arttile" onClick={()=>setArtView({art:a,idx:0})}>
                    <div style={{position:'relative',aspectRatio:'4 / 3.4',background:`linear-gradient(150deg, ${tNavyDark} 0%, ${tPrimary} 55%, ${tNavyMid} 100%)`,display:'flex',alignItems:'center',justifyContent:'center',padding:14,overflow:'hidden'}}>
                      <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
                      {thumb&&isUrl(thumb)?<img src={thumb} alt={a.name} loading="lazy" style={{position:'relative',maxWidth:'100%',maxHeight:'100%',objectFit:'contain',filter:'drop-shadow(0 6px 16px rgba(0,0,0,.35))'}}/>:<span className="nsa-disp" style={{position:'relative',color:'rgba(255,255,255,.9)',fontSize:48,fontWeight:800}}>{cpMonogram}</span>}
                      {a.deco&&<span className="nsa-disp" style={{position:'absolute',top:10,left:0,transform:'skewX(-12deg)',background:tAccent,color:'#fff',fontWeight:700,fontSize:10,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 12px 4px 14px'}}><span style={{display:'inline-block',transform:'skewX(12deg)'}}>{a.deco}</span></span>}
                      {a.urls.length>1&&<span style={{position:'absolute',bottom:8,right:8,fontSize:10,fontWeight:800,background:'rgba(0,0,0,.5)',color:'#fff',borderRadius:4,padding:'2px 7px'}}>⊞ {a.urls.length}</span>}
                    </div>
                    <div style={{padding:'12px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                      <div style={{minWidth:0}}>
                        <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
                        <div style={{fontSize:12,color:'#94A0B0',marginTop:1}}>{a.orders.length} order{a.orders.length!==1?'s':''}{isP&&a.teams.length?' · '+a.teams[0]:''}</div>
                      </div>
                      <span title="Approved" style={{width:9,height:9,borderRadius:'50%',background:'#1F7A43',flexShrink:0}}/>
                    </div>
                  </div>;
                })}
              </div>}
            </>}
          </div>;
        })()}

        {false&&(!waitingArtJobs.length&&!openInvs.length&&!paidInvs.length&&!activeSOs.length&&!completedSOs.length&&!custEsts.length&&!paySuccess)&&
          <div style={{color:'#94a3b8',fontSize:13,padding:'24px 4px',textAlign:'center',border:'1px dashed #e2e8f0',borderRadius:10}}>No orders, estimates, or invoices yet.<br/>Your rep will post them here as they come in.</div>}

        {/* Payment success banner */}
        {page==='home'&&paySuccess&&<div style={{padding:16,background:paySuccess.processing?'#fffbeb':'#f0fdf4',border:'2px solid '+(paySuccess.processing?'#f59e0b':'#22c55e'),borderRadius:12,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>{paySuccess.processing?'⏳':'✅'}</div>
          <div style={{fontSize:18,fontWeight:800,color:paySuccess.processing?'#92400e':'#166534',marginBottom:4}}>{paySuccess.processing?'Payment Processing':'Payment Successful!'}</div>
          <div style={{fontSize:14,color:paySuccess.processing?'#92400e':'#166534'}}>${paySuccess.amount.toLocaleString(undefined,{minimumFractionDigits:2})}{paySuccess.processing?' is processing':' paid'}{paySuccess.fee>0?' + $'+paySuccess.fee.toFixed(2)+' processing fee':''}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>{paySuccess.processing?'This can take a few minutes to confirm. Your invoice will update automatically once it clears.':'Your account has been updated. Download or email yourself an itemized receipt below.'}</div>
          {paySuccess.intentId&&<div style={{marginTop:14,paddingTop:14,borderTop:'1px solid '+(paySuccess.processing?'#fde68a':'#bbf7d0')}}>
            <a href={'/.netlify/functions/receipt?payment_intent_id='+encodeURIComponent(paySuccess.intentId)} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',background:'#1e3a5f',color:'white',textDecoration:'none',padding:'9px 18px',borderRadius:8,fontSize:14,fontWeight:700}}>📄 Download receipt</a>
            <div style={{marginTop:12,fontSize:12,color:'#475569',fontWeight:600}}>Or email a copy:</div>
            <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:6,flexWrap:'wrap'}}>
              <input type="email" value={receiptEmail} onChange={e=>{setReceiptEmail(e.target.value);if(receiptStatus)setReceiptStatus(null);}} placeholder="you@example.com" style={{flex:'1 1 200px',maxWidth:280,padding:'9px 12px',border:'1px solid #cbd5e1',borderRadius:8,fontSize:14}}/>
              <button onClick={sendReceipt} disabled={receiptStatus==='sending'} style={{background:receiptStatus==='sending'?'#94a3b8':'#2563eb',color:'white',border:'none',padding:'9px 18px',borderRadius:8,fontSize:14,fontWeight:700,cursor:receiptStatus==='sending'?'default':'pointer'}}>{receiptStatus==='sending'?'Sending…':'✉️ Email receipt'}</button>
            </div>
            {receiptStatus==='sent'&&<div style={{fontSize:12,color:'#166534',marginTop:8,fontWeight:600}}>✓ Receipt sent to {receiptEmail}</div>}
            {receiptStatus==='error'&&<div style={{fontSize:12,color:'#b91c1c',marginTop:8,fontWeight:600}}>Couldn't send — check the email address and try again.</div>}
          </div>}
        </div>}

        {/* Artwork awaiting approval — now surfaced via the Dashboard "Designs to Review" card */}
        {false&&waitingArtJobs.length>0&&<>
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
        {page==='estimates'&&(()=>{
          const _tf=e=>!isP||teamFilter==='all'||e.customer_id===teamFilter;
          const openEsts=custEsts.filter(e=>(e.status==='sent'||e.status==='open')&&_tf(e));
          const approvedEsts=custEsts.filter(e=>e.status==='approved'&&_tf(e));
          if(isP){openEsts.sort(_teamSort);approvedEsts.sort(_teamSort);}
          const cards=[...openEsts.map(e=>({e,ap:false})),...approvedEsts.map(e=>({e,ap:true}))];
          return<div>
            <style>{`.nsa-estgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:760px){.nsa-estgrid{grid-template-columns:1fr}}`}</style>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:24}}>
              <div>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Awaiting Your Approval</div>
                <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Estimates</h1>
                <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                {isP&&_teamSelect}
                {openEsts.length>0&&<div className="nsa-disp" style={{transform:'skewX(-6deg)',background:tAccent,color:'#fff',padding:'10px 18px',borderRadius:4}}><div style={{transform:'skewX(6deg)',textAlign:'center'}}><div style={{fontWeight:800,fontSize:30,lineHeight:1}}>{openEsts.length}</div><div style={{fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',opacity:.9}}>to approve</div></div></div>}
              </div>
            </div>
            {cards.length===0?<div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,padding:'40px',textAlign:'center',color:'#5A6075'}}>No estimates right now — your rep will post quotes here.</div>:
            <div className="nsa-estgrid">
              {cards.map(({e:est,ap})=>{const t=calcEstTotal(est);const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';
                return<div key={est.id} style={{position:'relative',background:'#fff',border:'1px solid #EEF1F6',borderLeft:`4px solid ${ap?'#1F7A43':tAccent}`,borderRadius:6,padding:'20px 22px',boxShadow:'0 2px 12px rgba(0,0,0,.06)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                    <div style={{minWidth:0}}>
                      <div className="nsa-disp" style={{fontWeight:800,fontSize:19,textTransform:'uppercase',color:tPrimary,lineHeight:1.05}}>{tn||est.memo||est.id}</div>
                      <div style={{fontSize:13,color:'#5A6075',marginTop:3}}>{est.memo||'Estimate'} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div>
                      <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
                    </div>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary,textAlign:'right',flexShrink:0}}>${t.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  </div>
                  <div style={{marginTop:16}}>
                    {ap?
                      <div className="nsa-disp" style={{background:'#E8F5EC',color:'#1F7A43',borderRadius:4,padding:'10px',textAlign:'center',fontWeight:800,fontSize:14}}>✓ Approved</div>
                    :<div style={{display:'flex',gap:10}}>
                      <button className="nsa-skew nsa-disp" onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{flex:1,background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px',borderRadius:4,cursor:'pointer'}}><span>Approve Estimate</span></button>
                      <button className="nsa-disp" onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:14,textTransform:'uppercase',padding:'11px 16px',borderRadius:4,cursor:'pointer'}}>Details</button>
                    </div>}
                  </div>
                </div>;
              })}
            </div>}
          </div>;
        })()}

        {/* ── BILLING (NSA spec — invoice history + balance panel) ── */}
        {page==='billing'&&(()=>{
          const allInv=[...openInvs,...paidInvs];
          return<div>
            <style>{`.nsa-bill{display:grid;grid-template-columns:1.5fr 1fr;gap:24px;align-items:start}@media(max-width:820px){.nsa-bill{grid-template-columns:1fr}}`}</style>
            <div style={{marginBottom:24}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Invoices &amp; Payments</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Billing</h1>
              <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
            </div>
            <div className="nsa-bill">
              <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
                <div className="nsa-disp" style={{padding:'14px 22px',background:'#F7F8FB',fontWeight:800,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',color:tPrimary}}>Invoice History</div>
                {allInv.length===0?<div style={{padding:'28px 22px',color:'#5A6075',fontSize:13}}>No invoices yet.</div>:
                 allInv.map(inv=>{const open=inv.status==='open'||inv.status==='partial';const bal=(inv.total||0)-(inv.paid||0);
                  return<div key={inv.id} className="nsa-card" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'14px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                    <div style={{minWidth:0}}>
                      <div className="nsa-disp" style={{fontWeight:700,fontSize:16,color:tPrimary}}>{inv.id}</div>
                      <div style={{fontSize:13,color:'#5A6075',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{inv.date||''}{inv.memo?' · '+inv.memo:''}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                      <span className="nsa-disp" style={{fontWeight:700,fontSize:18,color:tPrimary}}>${(open?bal:(inv.total||0)).toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                      <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:open?tAccentSoft:'#E8F5EC',color:open?tAccent:'#1F7A43',fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 11px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{open?'Open':'Paid'}</span></span>
                    </div>
                  </div>})}
              </div>
              <div style={{position:'relative',overflow:'hidden',borderRadius:6,padding:28,color:'#fff',background:`linear-gradient(135deg, ${tNavyDark}, ${tPrimary})`}}>
                <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
                <div style={{position:'relative'}}>
                  <div className="nsa-disp" style={{fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Total Balance Due</div>
                  <div className="nsa-disp" style={{fontWeight:800,fontSize:48,color:tAccentLight,lineHeight:1,marginTop:4}}>${totalDue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:13,color:'rgba(255,255,255,.7)',marginTop:6}}>{totalDue>0?'Net 30 terms · pay by card or PO':"You're all paid up — thank you!"}</div>
                  {!ccDisabled&&totalDue>0&&<button onClick={()=>{setPayLoading(true);setShowPay('all')}} disabled={payLoading} className="nsa-skew nsa-disp" style={{width:'100%',marginTop:18,background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:16,letterSpacing:'.5px',textTransform:'uppercase',padding:'14px',borderRadius:4,cursor:payLoading?'wait':'pointer'}}><span>{payLoading?'Opening checkout…':'Pay Balance'}</span></button>}
                  <div style={{height:1,background:'rgba(255,255,255,.15)',margin:'18px 0 12px'}}/>
                  <div style={{fontSize:12,color:'rgba(255,255,255,.6)'}}>💳 Credit card · Apple Pay · 🏦 ACH/Bank · or pay by PO</div>
                </div>
              </div>
            </div>
          </div>;
        })()}

        {/* ── ORDERS (NSA spec — embedded estimates panel + order history table) ── */}
        {page==='orders'&&(()=>{
          const statusMap={complete:['Delivered','#5A6075','#EEF1F6'],shipped:['Shipped','#1F7A43','#E8F5EC'],bagging:['Bagging','#1A3A6B','#E6ECF5'],in_production:['In Production','#1A3A6B','#E6ECF5'],received:['Received','#1A3A6B','#E6ECF5'],pending:['Ordered','#5A6075','#EEF1F6']};
          // Estimates to approve — embedded at top of orders page per new design
          const _tfEst=e=>!isP||teamFilter==='all'||e.customer_id===teamFilter;
          const openEsts=custEsts.filter(e=>(e.status==='sent'||e.status==='open')&&_tfEst(e));
          if(isP)openEsts.sort(_teamSort);
          let rows=[...activeSOs,...completedSOs];
          if(isP&&teamFilter!=='all')rows=rows.filter(so=>so.customer_id===teamFilter);
          if(isP)rows=[...rows].sort(_teamSort);
          return<div>
            <style>{`@media(max-width:760px){.nsa-otab{grid-template-columns:1fr!important;gap:8px!important}.nsa-ohead{display:none!important}}`}</style>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:24}}>
              <div>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Active &amp; Recent</div>
                <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Orders</h1>
                <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
              </div>
              {isP&&_teamSelect}
            </div>
            {/* ── Estimates to Approve — inline panel (new design) ── */}
            {openEsts.length>0&&<div style={{background:'#fff',border:'1px solid #EEF1F6',borderLeft:`4px solid ${tAccent}`,borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden',marginBottom:28}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'16px 22px',borderBottom:'1px solid #EEF1F6',background:'#FAFBFC'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span className="nsa-disp" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:999,background:tAccent,color:'#fff',fontWeight:800,fontSize:13}}>{openEsts.length}</span>
                  <div className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Estimates to Approve</div>
                  <span style={{fontSize:13,color:'#5A6075'}}>— approve to start production</span>
                </div>
                <button onClick={()=>setPage('estimates')} className="nsa-disp" style={{background:'none',border:'none',cursor:'pointer',color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase',letterSpacing:'.3px',whiteSpace:'nowrap'}}>View all →</button>
              </div>
              {openEsts.map(est=>{const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';const tt=calcEstTotal(est);
                return<div key={est.id} className="nsa-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'14px 22px',borderBottom:'1px solid #EEF1F6',cursor:'pointer',transition:'background .15s'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn||est.memo||est.id}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo||'Estimate'} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''} · {est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:16,flexShrink:0}}>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:18,color:tPrimary}}>${tt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                    <button className="nsa-skew nsa-disp" onClick={ev=>{ev.stopPropagation();setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 18px',borderRadius:4,cursor:'pointer'}}><span>Approve</span></button>
                  </div>
                </div>})}
            </div>}
            {/* ── Order History table ── */}
            <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Order History</div>
            {rows.length===0?<div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,padding:'40px',textAlign:'center',color:'#5A6075'}}>No orders yet — your rep will post them here.</div>:
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div className="nsa-disp nsa-otab nsa-ohead" style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 1fr .8fr',gap:16,padding:'14px 24px',background:'#F7F8FB',fontWeight:700,fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'#5A6075'}}>
                <span>Order</span><span>Status</span><span>Delivery</span><span style={{textAlign:'right'}}>Total</span>
              </div>
              {rows.map(so=>{
                const st=calcSOStatus(so);const sm=statusMap[st]||['Ordered','#5A6075','#EEF1F6'];
                let totalU=0,fulU=0;safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
                const pct=totalU>0?Math.round(fulU/totalU*100):0;
                const team=(allCustomers||[]).find(c=>c.id===so.customer_id);const tn=isP&&team&&team.id!==customer.id?team.name:(so.memo||so.id);
                const tot=calcOrderTotals(so).grand;
                return<div key={so.id} className="nsa-card nsa-otab" onClick={()=>setSoView(so)} style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 1fr .8fr',gap:16,padding:'16px 24px',borderTop:'1px solid #EEF1F6',cursor:'pointer',alignItems:'center'}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:17,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo||'Order'} · {totalU} pcs · {so.id}</div>
                    <div style={{height:5,background:'#EEF1F6',borderRadius:999,marginTop:9,overflow:'hidden',maxWidth:220}}><div style={{height:'100%',width:pct+'%',background:tPrimary,borderRadius:999}}/></div>
                  </div>
                  <div><span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:sm[2],color:sm[1],fontWeight:700,fontSize:12,letterSpacing:'.5px',textTransform:'uppercase',padding:'5px 12px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{sm[0]}</span></span></div>
                  <div style={{fontSize:14,color:'#2A2F3E'}}>{so.expected_date?(st==='shipped'?'Arrives ':'ETA ')+so.expected_date:'—'}</div>
                  <div className="nsa-disp" style={{textAlign:'right',fontWeight:700,fontSize:18,color:tPrimary}}>${tot.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                </div>;
              })}
            </div>}
          </div>;
        })()}
        {/* Active orders (legacy, retired in favor of the NSA table above) */}
        {false&&(activeSOs.length>0||recentEsts.length>0)&&<>
          <button onClick={()=>setOrdersOpen(o=>!o)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',background:'none',border:'none',padding:0,cursor:'pointer',marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:800,color:'#1e3a5f'}}>📦 Active Orders ({activeSOs.length}{recentEsts.length>0?' + '+recentEsts.length+' est':''})</span>
            <span style={{fontSize:11,fontWeight:700,color:'#64748b',display:'inline-flex',alignItems:'center',gap:6,textTransform:'uppercase',letterSpacing:'.04em'}}>{ordersOpen?'Hide':'Show'}<span style={{fontSize:12}}>{ordersOpen?'▾':'▸'}</span></span>
          </button>
          {ordersOpen&&activeSOs.map(so=>{
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
          {ordersOpen&&recentEsts.map(est=>{const t=calcEstTotal(est);
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
        {false&&(()=>{const approvedEsts=custEsts.filter(e=>e.status==='approved');
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

        {/* Paid invoices (legacy, retired — folded into the NSA Billing invoice history) */}
        {false&&paidInvs.length>0&&<>
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

        {/* Completed orders (legacy, retired — folded into the NSA Orders table) */}
        {false&&completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setSoView(so)}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span className="badge badge-green">Complete</span><span style={{color:'#94a3b8',fontSize:14}}>›</span></div></div>)}
        </>}

        {/* Past Estimates — converted/draft, de-emphasized at bottom */}
        {false&&(()=>{const pastEsts=custEsts.filter(e=>e.status==='converted'||e.status==='draft');
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

        </div>{/* ── /LEFT COLUMN ── */}

        {/* ── Team store, shop & home tools ── */}
        <div className="cp-col">

        {/* ── SHOP / CATALOGS (NSA redesign — hero + Shop & Order tiles + Catalogs & Stores) ── */}
        {page==='store'&&<div>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:'clamp(26px,4vw,34px)',textTransform:'uppercase',color:tPrimary,lineHeight:1,marginBottom:6}}>Team Store Tracking</div>
          <div style={{fontSize:14,color:'#5A6075',marginBottom:22}}>Live orders, fundraising and production status for your team store{cpVisibleStores.length>1?'s':''}.</div>
          <CoachStore customer={customer} storeIds={cpStoreCustomerIds}/>
        </div>}

        {/* Roster orders — spreadsheet-style season kit ordering per team */}
        {page==='roster'&&<div>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:'clamp(26px,4vw,34px)',textTransform:'uppercase',color:tPrimary,lineHeight:1,marginBottom:6}}>Roster Orders</div>
          <div style={{fontSize:14,color:'#5A6075',marginBottom:22}}>Build your team, fill in player sizes, and submit to {rep?.name||'your rep'} when you're ready.</div>
          <RosterOrdersCoach customer={customer} />
        </div>}

        {page==='shop'&&<div>
          {/* Hero */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:8,boxShadow:'0 16px 40px rgba(0,0,0,.25)',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 55%, ${tNavyMid} 100%)`,color:'#fff',padding:'48px 44px',marginBottom:32}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:0,right:0,bottom:0,width:'40%',background:tAccent,opacity:.14,clipPath:'polygon(30% 0,100% 0,100% 100%,0 100%)',pointerEvents:'none'}}/>
            <div style={{position:'relative',maxWidth:560}}>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:48,lineHeight:.98,textTransform:'uppercase',margin:'0 0 14px'}}>Outfit Your Team <em style={{fontStyle:'italic',color:tAccentLight}}>The Right Way</em></h1>
              <p style={{fontSize:16,lineHeight:1.6,color:'rgba(255,255,255,.82)',margin:'0 0 24px'}}>Browse live inventory at your team pricing and colors, build an order, or open a spirit-pack store — all in your team's gear.</p>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                <a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-skew nsa-disp" style={{background:tAccent,color:'#fff',textDecoration:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'13px 28px',borderRadius:4}}><span>Browse Gear</span></a>
                <a href={CP_MARKETING+'/design-lab'} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-disp" style={{background:'transparent',color:'#fff',border:'2px solid rgba(255,255,255,.6)',textDecoration:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px 26px',borderRadius:4}}>Custom Quote</a>
              </div>
            </div>
          </div>

          {/* Build a team store — invite-only self-serve */}
          {coachAiBuilder&&<button onClick={()=>setStoreBuilder(true)} style={{width:'100%',textAlign:'left',border:'none',cursor:'pointer',background:`linear-gradient(135deg,${tNavyDark},${tPrimary})`,color:'#fff',borderRadius:8,padding:'18px 24px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,boxShadow:'0 2px 10px rgba(15,23,42,.12)'}}>
            <div>
              <div className="nsa-disp" style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',textTransform:'uppercase',opacity:.7}}>New</div>
              <div className="nsa-disp" style={{fontSize:20,fontWeight:800,marginTop:2,textTransform:'uppercase'}}>Build Your Team Store</div>
              <div style={{fontSize:13,opacity:.85,marginTop:3}}>Pick your gear, add your colors &amp; logo, and submit it — we'll publish it for you.</div>
            </div>
            <div className="nsa-disp" style={{fontSize:14,fontWeight:800,background:'rgba(255,255,255,.16)',border:'1px solid rgba(255,255,255,.3)',borderRadius:4,padding:'10px 18px',whiteSpace:'nowrap'}}>Start →</div>
          </button>}

          {/* Shop & Order section */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Shop &amp; Order</div>

          {/* Live Look tile — the highlight */}
          <a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:`linear-gradient(120deg, ${tPrimary} 0%, ${tNavyMid} 100%)`,border:`1px solid ${tPrimary}`,borderRadius:8,padding:'26px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.1)',position:'relative',overflow:'hidden',marginBottom:14}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'relative',width:58,height:58,flexShrink:0,borderRadius:8,background:tAccent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>👁️</div>
            <div style={{position:'relative',flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:24,textTransform:'uppercase',color:'#fff',lineHeight:1}}>Live Look — Shop Live Inventory</div>
                <span style={{display:'inline-flex',alignItems:'center',gap:5,background:'rgba(31,122,67,.22)',border:'1px solid #2EC971',color:'#8FF0B5',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:11,letterSpacing:'1px',textTransform:'uppercase',padding:'3px 9px',borderRadius:999}}><span style={{width:7,height:7,borderRadius:999,background:'#2EC971',display:'inline-block'}}/> Live</span>
              </div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.78)',marginTop:5}}>Browse in-stock gear at your team pricing &amp; colors — real-time inventory.</div>
            </div>
            <div style={{position:'relative',flexShrink:0,color:'rgba(255,255,255,.6)',fontSize:24}}>›</div>
          </a>

          {/* Build & Submit an Order tile */}
          {coachBuildOrders&&<a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:'#fff',border:'1px solid #EEF1F6',borderRadius:8,padding:'22px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.06)',marginBottom:32}}>
            <div style={{width:54,height:54,flexShrink:0,borderRadius:8,background:'#F7F8FB',color:tPrimary,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>🧾</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:21,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>Build &amp; Submit an Order</div>
              <div style={{fontSize:14,color:'#5A6075',marginTop:5}}>Put an order together and send it to {rep?.name||'your rep'} for a quote.</div>
            </div>
            <div style={{flexShrink:0,color:'#94A0B0',fontSize:24}}>›</div>
          </a>}
          {!coachBuildOrders&&<div style={{marginBottom:32}}/>}

          {/* Catalogs & Stores section */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Catalogs &amp; Stores</div>

          {/* Team Stores — inline (CoachStore renders existing stores) */}
          <CoachStore customer={customer} storeIds={cpStoreCustomerIds} />

          {/* Custom & Catalog Gear tile */}
          <a href={CP_MARKETING+'/design-lab'} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:'#fff',border:'1px solid #EEF1F6',borderRadius:8,padding:'22px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.06)',marginBottom:14}}>
            <div style={{width:54,height:54,flexShrink:0,borderRadius:8,background:'#F7F8FB',color:tPrimary,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>🎨</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:21,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>Custom &amp; Catalog Gear</div>
              <div style={{fontSize:14,color:'#5A6075',marginTop:5}}>Browse our brand catalogs or request a custom quote.</div>
            </div>
            <div style={{flexShrink:0,color:'#94A0B0',fontSize:24}}>›</div>
          </a>

          {/* adidas catalog banner */}
          <a className="cp-adidas" href="https://www.adidas-team.com/usa/us-team/" target={CP_LINK_TARGET} rel="noopener noreferrer"
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,minHeight:100,borderRadius:8,overflow:'hidden',textDecoration:'none',color:'#fff',backgroundColor:'#0a0a0a',backgroundImage:`linear-gradient(110deg,rgba(8,8,8,.92) 0%,rgba(8,8,8,.58) 58%,rgba(8,8,8,.26) 100%),url('/adidas-team-catalog.webp')`,backgroundSize:'cover',backgroundPosition:'center 28%',padding:'28px 32px'}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,letterSpacing:'2px',textTransform:'lowercase',color:'rgba(255,255,255,.75)',marginBottom:4}}>adidas</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:28,textTransform:'uppercase',lineHeight:1}}>Shop the adidas Catalog</div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.78)',marginTop:6}}>Browse the full adidas team collection at your pricing.</div>
            </div>
            <div className="nsa-skew nsa-disp" style={{flexShrink:0,background:'#fff',color:tPrimary,fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'12px 24px',borderRadius:4}}><span>View Catalog</span></div>
          </a>
        </div>}

        {/* Contact update — summary lives in the Dashboard; this is the edit form when active */}
        {page==='home'&&contactEdit&&<div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
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
        </div>}
        </div>{/* /RIGHT */}
        </div>{/* /cp-grid */}
        </div>{/* /cp-page */}
      </div>{/* /cp-main */}

    {/* ── Footer ── */}
    <div style={{background:tNavyDark,color:'rgba(255,255,255,.6)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',padding:'28px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <img src="/NEW NSA Logo on white.png" alt="National Sports Apparel" style={{height:34,filter:'brightness(0) invert(1)',opacity:.9}}/>
        <span style={{fontSize:13}}>© 2026 National Sports Apparel · 2238 N Glassell St, Orange, CA · (714) 279-8777</span>
      </div>
    </div>

    {/* ── BOTTOM NAV (mobile) — team-colored tab bar ── */}
    <nav className="cp-bottomnav">
      {/* 7 fits today's max real combo (home/orders/estimates/roster/billing/art/shop); if
          store and roster are ever both enabled for the same account this clips one item —
          revisit if that combo becomes common. */}
      {cpNav.filter(n=>n.key!=='spend').slice(0,7).map(it=>{const active=page===it.key;return(
        <button key={it.key} className="cp-bottombtn" onClick={it.onClick||(()=>setPage(it.key))} style={{color:active?cpTheme.primary:'#94a3b8'}}>
          <span style={{position:'relative',width:38,height:30,borderRadius:11,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:active?cpTint:'transparent',transition:'background .12s'}}>{it.icon}{it.badge>0?<span style={{position:'absolute',top:-3,right:-1,fontSize:9,fontWeight:800,background:cpTheme.accent,color:'#fff',borderRadius:999,padding:'0 5px',minWidth:14,textAlign:'center'}}>{it.badge}</span>:null}</span>
          <span>{it.label}</span>
        </button>
      )})}
    </nav>

    {/* Art Locker — rich design viewer with reorder-into-Live-Look CTA */}
    {artView&&(()=>{const a=artView.art;const idx=Math.min(artView.idx,a.urls.length-1);const u=a.urls[idx];const isPdf=_isPdfUrl(u);
      return<div style={{position:'fixed',inset:0,background:'rgba(8,11,18,.93)',zIndex:9999,display:'flex',flexDirection:'column',padding:16}} onClick={()=>setArtView(null)}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',color:'#fff',gap:12,marginBottom:8}} onClick={e=>e.stopPropagation()}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:17,fontWeight:800,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,.6)',textTransform:'capitalize'}}>{a.deco||'Design'}{a.orders.length>1?' · used on '+a.orders.length+' orders':''}{isP&&a.teams.length?' · '+a.teams.join(', '):''}</div>
          </div>
          <button onClick={()=>setArtView(null)} style={{flexShrink:0,background:'rgba(255,255,255,0.14)',border:'none',color:'#fff',fontSize:24,borderRadius:'50%',width:40,height:40,cursor:'pointer'}}>×</button>
        </div>
        <div onClick={e=>e.stopPropagation()} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',minHeight:0}}>
          {isPdf?<iframe title="Design" src={'https://docs.google.com/gview?url='+encodeURIComponent(u)+'&embedded=true'} style={{width:'90vw',height:'70vh',border:'none',borderRadius:10,background:'#fff'}}/>:<img src={u} alt={a.name} style={{maxWidth:'94vw',maxHeight:'64vh',objectFit:'contain',borderRadius:10}}/>}
        </div>
        {a.urls.length>1&&<div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',margin:'10px 0 2px'}}>
          {a.urls.map((url,i)=>{const t=_isPdfUrl(url)?_cloudinaryPdfThumb(url):url;return<button key={i} onClick={()=>setArtView({art:a,idx:i})} style={{width:48,height:48,borderRadius:8,overflow:'hidden',border:'2px solid '+(i===idx?cpTheme.accent:'rgba(255,255,255,.25)'),background:'#fff',cursor:'pointer',padding:0,flexShrink:0}}>{t&&isUrl(t)?<img src={t} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span style={{fontSize:18}}>🎨</span>}</button>})}
        </div>}
        <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap',marginTop:12}}>
          <a href={u} target="_blank" rel="noopener noreferrer" style={{background:'rgba(255,255,255,0.16)',color:'#fff',textDecoration:'none',padding:'11px 18px',borderRadius:10,fontSize:14,fontWeight:700}}>⬇ Download</a>
          <button onClick={()=>cpOrderWithArt(a,u)} style={{background:cpTheme.accent,color:'#fff',border:'none',padding:'11px 22px',borderRadius:10,fontSize:14,fontWeight:800,cursor:'pointer'}}>🛍️ Order with this design →</button>
        </div>
      </div>;
    })()}

    {/* Lightbox — full-size art/mockup viewer (Art Locker) */}
    {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
      <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
      {_isPdfUrl(lightbox)?<iframe title="Design preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
      :<img src={lightbox} alt="Design" style={{maxWidth:'95vw',maxHeight:'86vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>}
      <a href={lightbox} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{position:'absolute',bottom:20,background:'rgba(255,255,255,0.16)',color:'#fff',textDecoration:'none',padding:'9px 18px',borderRadius:999,fontSize:13,fontWeight:700}}>⬇ Download / open full size</a>
    </div>}

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
  const[torchOn,setTorchOn]=useState(false);const[torchOk,setTorchOk]=useState(false);// phone flashlight (warehouse aisles are dim)

  const startCamera=async()=>{
    setError(null);setOcrResults([]);setOcrStatus('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}});
      streamRef.current=stream;
      // Torch is only exposed on a live track on some phones — probe once we have the stream.
      try{const _trk=stream.getVideoTracks&&stream.getVideoTracks()[0];const _caps=_trk&&_trk.getCapabilities&&_trk.getCapabilities();setTorchOk(!!(_caps&&_caps.torch))}catch(e){setTorchOk(false)}
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
        if(val){try{navigator.vibrate&&navigator.vibrate(120)}catch(e){}stopCamera();onScan(val);return}
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

  // Toggle the phone flashlight on the live video track (no-op where unsupported).
  const toggleTorch=async()=>{
    try{const track=streamRef.current&&streamRef.current.getVideoTracks&&streamRef.current.getVideoTracks()[0];if(!track)return;const next=!torchOn;await track.applyConstraints({advanced:[{torch:next}]});setTorchOn(next)}catch(e){setTorchOk(false)}
  };

  const stopCamera=()=>{
    scanningRef.current=false;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null}
    if(videoRef.current){videoRef.current.srcObject=null}
    setActive(false);setOcrStatus('');setOcrResults([]);setTorchOn(false);setTorchOk(false);
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
      <video ref={videoRef} style={{width:'100%',maxHeight:'58vh',minHeight:240,objectFit:'cover',display:'block',background:'#000'}} autoPlay playsInline muted/>
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
        style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',background:ocrBusyRef.current?'#475569':'#f59e0b',
          color:ocrBusyRef.current?'#94a3b8':'#000',border:'none',borderRadius:8,padding:'6px 24px',cursor:ocrBusyRef.current?'default':'pointer',fontSize:13,fontWeight:700}}>
        {ocrBusyRef.current?'Reading...':'Capture & Read'}
      </button>}
      {torchOk&&<button onClick={toggleTorch} title="Toggle flashlight" style={{position:'absolute',top:8,left:8,background:torchOn?'#fde68a':'rgba(0,0,0,0.6)',border:'none',color:torchOn?'#000':'white',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:12,fontWeight:700}}>🔦 {torchOn?'On':'Off'}</button>}
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
