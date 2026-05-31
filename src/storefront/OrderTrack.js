/* eslint-disable */
// Public, login-free order status page — /shop/order/<status_token>
//
// Reused by BOTH native webstore orders and OMG pop-up orders (the "shadow
// webstore" from migration 034). Because OMG shadow stores are status=archived,
// the normal storefront refuses them — so this page looks an order up by its
// secret status_token and loads the store regardless of status. The emailed
// "your order is being processed" link points here.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Carrier deep links for the tracking button.
function trackingUrl(carrier, num) {
  const c = (carrier || '').toLowerCase();
  if (!num) return '';
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  return `https://www.google.com/search?q=${encodeURIComponent(num)}`;
}

function readToken() {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  // /shop/order/<token>
  return segs[2] || '';
}

// The parent-facing journey. We map the four DB line_status values onto a
// friendlier, more granular story (received → in production/decorating →
// shipped → complete) so parents see warehouse + decoration progress.
const STAGES = [
  { key: 'received', label: 'Order received', blurb: 'We’ve got your order', icon: '📥' },
  { key: 'in_production', label: 'In production', blurb: 'Items pulled & being decorated', icon: '🎨' },
  { key: 'shipped', label: 'Shipped', blurb: 'On its way to you', icon: '📦' },
  { key: 'complete', label: 'Complete', blurb: 'All done — enjoy!', icon: '✅' },
];
// line_status → stage index reached.
function stageIndex(lineStatus) {
  switch (lineStatus) {
    case 'complete': return 3;
    case 'shipped': return 2;
    case 'in_production': return 1;
    default: return 0; // pending
  }
}

export default function OrderTrack() {
  const [token] = useState(readToken);
  const [store, setStore] = useState(null);
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    (async () => {
      if (!token) { setStatus('notfound'); return; }
      const { data: orders, error } = await supabase.from('webstore_orders').select('*').eq('status_token', token).limit(1);
      if (error || !orders || !orders[0]) { setStatus('notfound'); return; }
      const o = orders[0];
      setOrder(o);
      const [{ data: sRows }, { data: iRows }, { data: shRows }] = await Promise.all([
        supabase.from('webstores').select('name,slug,logo_url,primary_color,accent_color').eq('id', o.store_id).limit(1),
        supabase.from('webstore_order_items').select('*').eq('order_id', o.id),
        supabase.from('webstore_shipments').select('*').eq('order_id', o.id).order('created_at', { ascending: true }),
      ]);
      setStore((sRows && sRows[0]) || { name: 'Your Order' });
      setItems((iRows || []).filter((i) => !i.is_bundle_parent));
      setShipments(shRows || []);
      setStatus('ok');
    })();
  }, [token]);

  const theme = useMemo(() => ({
    primary: (store && store.primary_color) || '#0b1f3a',
    accent: (store && store.accent_color) || '#e11d2a',
  }), [store]);

  if (status === 'loading') return <Shell><Splash>Loading your order…</Splash></Shell>;
  if (status === 'notfound') return <Shell><Splash><div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>We couldn’t find that order.<div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>Check the link in your confirmation email, or contact us at stores@nationalsportsapparel.com.</div></Splash></Shell>;

  // Overall progress = the *least* advanced active line (so the order isn't
  // "complete" until every item is). Cancelled lines are ignored.
  const active = items.filter((i) => i.line_status !== 'cancelled');
  const reached = active.length ? Math.min(...active.map((i) => stageIndex(i.line_status))) : 0;
  const anyMissing = items.some((i) => Number(i.missing_qty) > 0);
  const tracking = order.tracking_number || (shipments[0] && shipments[0].tracking_number);
  const carrier = order.carrier || (shipments[0] && shipments[0].carrier);
  const a = order.ship_address || null;

  return (
    <Shell>
      <BrandBar store={store} theme={theme} />
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '0 18px 60px' }}>

        {/* Hero status card */}
        <div style={{ background: `linear-gradient(135deg, ${theme.primary}, ${shade(theme.primary, -14)})`, color: '#fff', borderRadius: 18, padding: '28px 26px', marginTop: 22, boxShadow: '0 20px 48px rgba(11,18,32,.22)' }}>
          <div style={{ fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.85 }}>{store.name}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1.05, textTransform: 'uppercase', marginTop: 6 }}>
            {STAGES[reached].icon} {STAGES[reached].label}
          </div>
          <div style={{ fontSize: 15, opacity: 0.9, marginTop: 6 }}>{STAGES[reached].blurb}</div>
          {order.omg_order_number && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>Order #{order.omg_order_number}{order.buyer_name ? ` · ${order.buyer_name}` : ''}</div>}
        </div>

        {/* Vertical progress timeline */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '24px 24px 8px', marginTop: 18, border: '1px solid #eef1f5', boxShadow: '0 4px 18px rgba(15,26,56,.05)' }}>
          {STAGES.map((s, i) => {
            const done = i < reached, current = i === reached;
            const dot = done ? theme.accent : current ? theme.accent : '#e2e8f0';
            return (
              <div key={s.key} style={{ display: 'flex', gap: 16, position: 'relative', paddingBottom: i === STAGES.length - 1 ? 16 : 26 }}>
                {i < STAGES.length - 1 && <div style={{ position: 'absolute', left: 17, top: 36, bottom: 0, width: 2, background: done ? theme.accent : '#eef1f5' }} />}
                <div style={{ width: 36, height: 36, flex: '0 0 36px', borderRadius: '50%', background: done || current ? dot : '#f1f5f9', color: done || current ? '#fff' : '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, boxShadow: current ? `0 0 0 5px ${hexA(theme.accent, 0.16)}` : 'none', transition: 'all .2s' }}>
                  {done ? '✓' : current ? s.icon : i + 1}
                </div>
                <div style={{ paddingTop: 3 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: done || current ? '#0b1220' : '#94a3b8' }}>{s.label}</div>
                  <div style={{ fontSize: 13, color: current ? '#475569' : '#94a3b8' }}>{s.blurb}{current ? ' — happening now' : ''}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tracking */}
        {tracking && (
          <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: '18px 20px', marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b' }}>{(carrier || 'Carrier').toUpperCase().replace('STAMPS_COM', 'USPS')} tracking</div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 12px', wordBreak: 'break-all' }}>{tracking}</div>
            <a href={trackingUrl(carrier, tracking)} target="_blank" rel="noopener noreferrer" style={btn(theme.accent)}>Track package →</a>
          </div>
        )}

        {/* Missing-items notice (warehouse flagged a shortage) */}
        {anyMissing && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '16px 20px', marginTop: 16, color: '#92400e' }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ Some items are delayed</div>
            <div style={{ fontSize: 14 }}>A few items in your order are temporarily short. We’ll ship them as soon as they arrive — flagged below.</div>
          </div>
        )}

        {/* Items */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '8px 22px 18px', marginTop: 16, border: '1px solid #eef1f5' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', padding: '16px 0 4px' }}>Your items</div>
          {items.map((i) => {
            const idx = stageIndex(i.line_status);
            const missing = Number(i.missing_qty) > 0;
            return (
              <div key={i.id} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                {i.image_url
                  ? <img src={i.image_url} alt="" width={52} height={52} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 9, background: '#f4f6f9', flex: '0 0 52px' }} />
                  : <div style={{ width: 52, height: 52, borderRadius: 9, background: '#f1f5f9', flex: '0 0 52px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👕</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{i.name || i.sku || 'Item'}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>
                    {[i.color, i.size && `Size ${i.size}`, `Qty ${i.qty || 1}`, i.player_number && `#${i.player_number}`, i.player_name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <StatusChip stage={idx} accent={theme.accent} />
                  {missing && <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, marginTop: 4 }}>{i.missing_qty} delayed</div>}
                </div>
              </div>
            );
          })}
          {order.total > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, fontWeight: 900, fontSize: 17 }}><span>Order total</span><span>{money(order.total)}</span></div>}
        </div>

        {/* Shipping address */}
        {a && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '18px 22px', marginTop: 16, border: '1px solid #eef1f5' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', marginBottom: 6 }}>Shipping to</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.55, color: '#0b1220' }}>
              {a.name && <div>{a.name}</div>}
              <div>{a.street1}{a.street2 ? ', ' + a.street2 : ''}</div>
              <div>{a.city}{a.city ? ', ' : ''}{a.state} {a.zip}</div>
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 26, fontSize: 13, color: '#94a3b8' }}>
          Questions? Email <a href="mailto:stores@nationalsportsapparel.com" style={{ color: theme.accent, fontWeight: 600 }}>stores@nationalsportsapparel.com</a>
          <div style={{ marginTop: 8 }}>Save this page — bookmark the link to check back anytime.</div>
        </div>
      </div>
      <Footer theme={theme} />
    </Shell>
  );
}

// ── building blocks ───────────────────────────────────────────────────
function StatusChip({ stage, accent }) {
  const map = ['Received', 'In production', 'Shipped', 'Complete'];
  const bg = ['#eef2ff', '#fef3c7', '#dbeafe', '#dcfce7'][stage];
  const fg = ['#3730a3', '#92400e', '#1e40af', '#166534'][stage];
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '5px 11px', borderRadius: 20, background: bg, color: fg, whiteSpace: 'nowrap' }}>{map[stage]}</span>;
}

function BrandBar({ store, theme }) {
  const nsaLogo = `${window.location.origin}/NEW%20NSA%20Logo%20on%20white.png`;
  return (
    <header style={{ background: '#fff', borderBottom: `3px solid ${theme.accent}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <img src={nsaLogo} alt="National Sports Apparel" style={{ height: 34 }} onError={(e) => { e.target.style.display = 'none'; }} />
      {store && store.logo_url
        ? <img src={store.logo_url} alt={store.name} style={{ height: 40, maxWidth: 140, objectFit: 'contain' }} />
        : <span style={{ fontFamily: DISPLAY, fontSize: 20, textTransform: 'uppercase', color: theme.primary }}>{store ? store.name : ''}</span>}
    </header>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F7F8FB', color: '#2A2F3E', fontFamily: BODY, display: 'flex', flexDirection: 'column', WebkitFontSmoothing: 'antialiased' }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
function Splash({ children }) { return <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#64748b', fontSize: 16, padding: '60px 24px' }}>{children}</div>; }
function Footer({ theme }) {
  return <footer style={{ background: `linear-gradient(120deg, ${theme.primary}, ${shade(theme.primary, -10)})`, color: 'rgba(255,255,255,0.82)', textAlign: 'center', padding: '30px 20px', borderTop: `3px solid ${theme.accent}` }}>
    <div style={{ fontFamily: DISPLAY, fontSize: 19, letterSpacing: 1, textTransform: 'uppercase', color: '#fff' }}>National Sports Apparel</div>
    <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>Custom team apparel · Powered by NSA</div>
  </footer>;
}

const btn = (accent) => ({ display: 'inline-block', background: accent, color: '#fff', textDecoration: 'none', padding: '11px 22px', borderRadius: 9, fontWeight: 700, fontSize: 14 });
function shade(hex, pct) {
  try {
    const h = (hex || '#0b1f3a').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  } catch { return hex; }
}
function hexA(hex, alpha) {
  try {
    const h = (hex || '#e11d2a').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${alpha})`;
  } catch { return hex; }
}
