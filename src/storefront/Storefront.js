/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// Public club storefront — /shop/<slug>
//   /shop/<slug>            landing + product grid
//   /shop/<slug>/p/<id>     single-product page
//   /shop/<slug>/b/<id>     bundle/package page
// Bold, athletic, photo-forward design. Reads the migration-011 storefront
// view with the anon key. Browse-only for now; cart/checkout land next.
// ─────────────────────────────────────────────────────────────────────

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumSizes = (j) => Object.values(j || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const priceOf = (p) => (p.display_price != null ? p.display_price : p.retail_price);

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

function parsePath() {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  return { slug: segs[1] || '', view: segs[2] || 'home', id: segs[3] || null };
}
function navTo(path) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }

function useTheme(store) {
  return useMemo(() => {
    const primary = store?.primary_color || '#0b1f3a';
    const accent = store?.accent_color || '#e11d2a';
    const theme = store?.theme || 'classic';
    return { primary, accent, theme, radius: theme === 'minimal' ? 2 : theme === 'bold' ? 14 : 8 };
  }, [store]);
}

function closesLabel(close_at) {
  if (!close_at) return null;
  const d = new Date(close_at); if (isNaN(d)) return null;
  const days = Math.ceil((d - new Date()) / 86400000);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days < 0) return { text: 'Store closed', urgent: true };
  if (days === 0) return { text: 'Closes today', urgent: true };
  if (days <= 7) return { text: `Closes in ${days} day${days === 1 ? '' : 's'} · ${date}`, urgent: true };
  return { text: `Open until ${date}`, urgent: false };
}

export default function Storefront() {
  const [route, setRoute] = useState(parsePath());
  useEffect(() => {
    const onPop = () => setRoute(parsePath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errMsg, setErrMsg] = useState('');

  const load = useCallback(async (slug) => {
    setStatus('loading');
    const { data: stores, error } = await supabase.from('webstores').select('*').eq('slug', slug).limit(1);
    if (error) { if (isMissingTable(error)) setStatus('nomigration'); else { setStatus('error'); setErrMsg(error.message); } return; }
    const s = (stores || [])[0];
    if (!s || s.status === 'archived') { setStatus('notfound'); return; }
    setStore(s);
    const [prodRes, bundleRes] = await Promise.all([
      supabase.from('webstore_storefront_products').select('*').eq('store_id', s.id).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
    ]);
    const prods = prodRes.data || [];
    setProducts(prods);
    const bundleIds = new Set(prods.filter((p) => p.kind === 'bundle').map((p) => p.webstore_product_id));
    setBundleItems((bundleRes.data || []).filter((b) => bundleIds.has(b.bundle_id)));
    setStatus('ok');
  }, []);

  useEffect(() => { if (route.slug) load(route.slug); }, [route.slug, load]);
  const theme = useTheme(store);

  if (status === 'loading') return <Splash>Loading store…</Splash>;
  if (status === 'nomigration') return <Splash>This store isn’t available yet.</Splash>;
  if (status === 'notfound') return <Splash>We couldn’t find that store.</Splash>;
  if (status === 'error') return <Splash>Something went wrong.<div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>{errMsg}</div></Splash>;

  const isOpen = store.status === 'open';
  return (
    <div style={{ fontFamily: '"Helvetica Neue",system-ui,-apple-system,Segoe UI,Roboto,sans-serif', color: '#0b1220', minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <Header store={store} theme={theme} />
      {!isOpen && <PreviewBanner status={store.status} />}
      <main style={{ flex: 1 }}>
        {route.view === 'home' && <Home store={store} theme={theme} products={products} />}
        {route.view === 'p' && <Wrap><ProductPage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} isOpen={isOpen} /></Wrap>}
        {route.view === 'b' && <Wrap><BundlePage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} components={bundleItems.filter((b) => b.bundle_id === route.id)} isOpen={isOpen} /></Wrap>}
        {['cart', 'checkout', 'order'].includes(route.view) && <Wrap><Splash>This part of the store is coming soon.</Splash></Wrap>}
      </main>
      <Footer theme={theme} />
    </div>
  );
}

const Wrap = ({ children }) => <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 20px 64px', boxSizing: 'border-box' }}>{children}</div>;

// ── Header ───────────────────────────────────────────────────────────
function Header({ store, theme }) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: theme.primary, color: '#fff', borderBottom: `3px solid ${theme.accent}` }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={() => navTo('/shop/' + store.slug)}>
          {store.logo_url
            ? <img src={store.logo_url} alt="" style={{ height: 44, width: 44, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 3 }} />
            : <div style={{ height: 44, width: 44, borderRadius: 8, background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20 }}>{(store.name || '?')[0]}</div>}
          <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: 1, textTransform: 'uppercase' }}>{store.name}</div>
        </div>
      </div>
    </header>
  );
}

function PreviewBanner({ status }) {
  return <div style={{ background: '#fde68a', color: '#92400e', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: '8px 16px', letterSpacing: 0.3 }}>
    PREVIEW · This store is {(status || 'draft').toUpperCase()} and not open to shoppers yet.
  </div>;
}

// ── Home: hero + grid ────────────────────────────────────────────────
function Home({ store, theme, products }) {
  const closes = closesLabel(store.close_at);
  const heroBg = store.banner_url
    ? `linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.72)), url(${store.banner_url}) center/cover`
    : `linear-gradient(135deg, ${theme.primary} 0%, ${shade(theme.primary, -18)} 55%, ${theme.accent} 140%)`;
  return (
    <>
      <section style={{ background: heroBg, color: '#fff', position: 'relative' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '72px 20px 64px' }}>
          {closes && <div style={{ display: 'inline-block', background: closes.urgent ? theme.accent : 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, marginBottom: 18 }}>{closes.text}</div>}
          <h1 style={{ margin: 0, fontSize: 'clamp(34px,6vw,64px)', fontWeight: 900, letterSpacing: -1, textTransform: 'uppercase', lineHeight: 0.98, maxWidth: 880 }}>{store.name}</h1>
          {store.hero_blurb && <p style={{ margin: '18px 0 0', maxWidth: 560, fontSize: 17, lineHeight: 1.55, opacity: 0.92 }}>{store.hero_blurb}</p>}
          <button onClick={() => document.getElementById('shop-grid')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ marginTop: 26, background: theme.accent, color: '#fff', border: 'none', padding: '14px 30px', borderRadius: theme.radius, fontWeight: 800, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}>Shop now</button>
        </div>
      </section>

      <div id="shop-grid" style={{ maxWidth: 1180, margin: '0 auto', padding: '44px 20px 72px' }}>
        <SectionTitle theme={theme}>The Collection</SectionTitle>
        {products.length === 0
          ? <Splash>No products in this store yet.</Splash>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 22 }}>
              {products.map((p) => <Card key={p.webstore_product_id} store={store} theme={theme} p={p} />)}
            </div>}
      </div>
    </>
  );
}

function SectionTitle({ children, theme }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
    <span style={{ width: 6, height: 28, background: theme.accent, borderRadius: 2 }} />
    <h2 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: -0.5, textTransform: 'uppercase' }}>{children}</h2>
  </div>;
}

function stockBadge(p) {
  if (p.kind === 'bundle') return { text: 'Package', color: '#fff', bg: '#1e40af' };
  const onHand = sumSizes(p.size_stock);
  if (onHand > 0) return { text: 'In stock', color: '#fff', bg: '#16a34a' };
  if (p.on_order_qty > 0) return { text: p.earliest_eta ? `Arriving ${p.earliest_eta}` : 'On the way', color: '#fff', bg: '#d97706' };
  return { text: 'Sold out', color: '#fff', bg: '#b91c1c' };
}

function Card({ store, theme, p }) {
  const b = stockBadge(p);
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  const go = () => navTo(`/shop/${store.slug}/${p.kind === 'bundle' ? 'b' : 'p'}/${p.webstore_product_id}`);
  return (
    <div onClick={go} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: theme.radius, overflow: 'hidden', border: '1px solid #eef1f5', transition: 'transform .14s, box-shadow .14s' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 14px 32px rgba(11,18,32,0.14)'; const im = e.currentTarget.querySelector('img'); if (im) im.style.transform = 'scale(1.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; const im = e.currentTarget.querySelector('img'); if (im) im.style.transform = 'none'; }}>
      <div style={{ position: 'relative', aspectRatio: '4/5', background: '#f4f6f9', overflow: 'hidden' }}>
        {p.image_front_url
          ? <img src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform .3s' }} />
          : <Placeholder theme={theme} label={store.name} />}
        <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 999, background: b.bg, color: b.color }}>{b.text}</span>
      </div>
      <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, minHeight: 36 }}>{p.name}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 900, fontSize: 18 }}>{money(priceOf(p))}</span>
        </div>
        {showFund && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>{money(p.fundraise_amount)} supports the team</div>}
      </div>
    </div>
  );
}

function Placeholder({ theme, label }) {
  return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})`, color: 'rgba(255,255,255,0.85)', fontWeight: 900, fontSize: 30, letterSpacing: 1 }}>{(label || '?')[0]}</div>;
}

// ── Single product ───────────────────────────────────────────────────
function ProductPage({ store, theme, product: p, isOpen }) {
  const [size, setSize] = useState(null);
  const [img, setImg] = useState('front');
  if (!p) return <Splash>Product not found.</Splash>;
  const sizes = Array.isArray(p.available_sizes) ? p.available_sizes : [];
  const stock = p.size_stock || {};
  const onHand = sumSizes(stock);
  const incoming = p.on_order_qty > 0;
  const imgUrl = img === 'back' && p.image_back_url ? p.image_back_url : p.image_front_url;
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  return (
    <div style={{ paddingTop: 26 }}>
      <BackLink store={store} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 44, alignItems: 'start' }}>
        <div>
          <div style={{ aspectRatio: '4/5', background: '#f4f6f9', borderRadius: theme.radius, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {imgUrl ? <img src={imgUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder theme={theme} label={store.name} />}
          </div>
          {p.image_back_url && <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {['front', 'back'].map((v) => <button key={v} onClick={() => setImg(v)} style={thumbBtn(theme, img === v)}>{v}</button>)}
          </div>}
        </div>
        <div style={{ paddingTop: 4 }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: '0 0 8px', letterSpacing: -0.5, lineHeight: 1.05 }}>{p.name}</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>{[p.color, p.category].filter(Boolean).join(' · ')}</div>
          <div style={{ fontSize: 30, fontWeight: 900, marginBottom: showFund ? 4 : 18 }}>{money(priceOf(p))}</div>
          {showFund && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, marginBottom: 18 }}>Includes {money(p.fundraise_amount)} that supports the team</div>}

          <StockLine onHand={onHand} incoming={incoming} eta={p.earliest_eta} onOrder={p.on_order_qty} />

          {sizes.length > 0 && <div style={{ margin: '22px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#0b1220', marginBottom: 10 }}>Select size</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {sizes.map((sz) => {
                const q = Number(stock[sz] || 0); const sel = size === sz; const out = q <= 0 && !incoming;
                return <button key={sz} disabled={out} onClick={() => setSize(sz)} title={q > 0 ? `${q} in stock` : incoming ? 'Backorder' : 'Out of stock'}
                  style={{ ...sizeBtn(theme, sel), opacity: out ? 0.35 : 1, cursor: out ? 'not-allowed' : 'pointer', textDecoration: out ? 'line-through' : 'none' }}>{sz}</button>;
              })}
            </div>
          </div>}

          <button disabled style={{ ...cta(theme), opacity: 0.5, cursor: 'not-allowed', marginTop: 8 }}>{isOpen ? 'Add to cart — coming soon' : 'Store not open yet'}</button>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>Cart &amp; checkout are being built — this is a preview of the product page.</div>
        </div>
      </div>
    </div>
  );
}

// ── Package ──────────────────────────────────────────────────────────
function BundlePage({ store, theme, product: p, components, isOpen }) {
  if (!p) return <Splash>Package not found.</Splash>;
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  return (
    <div style={{ paddingTop: 26 }}>
      <BackLink store={store} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 44, alignItems: 'start' }}>
        <div style={{ aspectRatio: '4/5', background: '#f4f6f9', borderRadius: theme.radius, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {p.image_front_url ? <img src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder theme={theme} label={store.name} />}
        </div>
        <div style={{ paddingTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, background: '#1e40af', color: '#fff' }}>Package Deal</span>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: '12px 0 8px', letterSpacing: -0.5, lineHeight: 1.05 }}>{p.name}</h1>
          <div style={{ fontSize: 30, fontWeight: 900, marginBottom: showFund ? 4 : 8 }}>{money(priceOf(p))}</div>
          {showFund && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, marginBottom: 8 }}>Includes {money(p.fundraise_amount)} that supports the team</div>}
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>One price — pick a size for each item at checkout.</div>

          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>What's included</div>
          {components.length === 0 ? <Splash>This package has no items configured yet.</Splash> :
            components.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #eef1f5' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.qty > 1 ? `${c.qty}× ` : ''}{c.sku || c.product_id}{c.takes_number ? ' · your number' : ''}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.size_required ? 'choose size' : 'one size'}</div>
              </div>
            ))}

          <button disabled style={{ ...cta(theme), opacity: 0.5, cursor: 'not-allowed', marginTop: 20 }}>{isOpen ? 'Add package — coming soon' : 'Store not open yet'}</button>
        </div>
      </div>
    </div>
  );
}

function StockLine({ onHand, incoming, eta, onOrder }) {
  if (onHand > 0) return <Pill bg="#dcfce7" fg="#166534">● In stock — ready to ship</Pill>;
  if (incoming) return <Pill bg="#fef3c7" fg="#92400e">{eta ? `Arriving around ${eta}` : `On the way${onOrder ? ` — ${onOrder} on order` : ''}`} · backorder available</Pill>;
  return <Pill bg="#fee2e2" fg="#b91c1c">Sold out</Pill>;
}

// ── atoms ────────────────────────────────────────────────────────────
function Pill({ children, bg, fg }) { return <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '7px 13px', borderRadius: 8, background: bg, color: fg }}>{children}</span>; }
function BackLink({ store }) { return <button onClick={() => navTo('/shop/' + store.slug)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>← Back to store</button>; }
function Splash({ children }) { return <div style={{ minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#64748b', fontSize: 15, padding: '60px 20px', fontFamily: 'system-ui,sans-serif' }}>{children}</div>; }
function Footer({ theme }) {
  return <footer style={{ background: theme.primary, color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 12, padding: '26px 20px', borderTop: `3px solid ${theme.accent}`, letterSpacing: 0.5 }}>Powered by National Sports Apparel</footer>;
}

const sizeBtn = (t, sel) => ({ minWidth: 52, padding: '12px 14px', borderRadius: t.radius, border: `2px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#0b1220', fontWeight: 800, fontSize: 14 });
const thumbBtn = (t, sel) => ({ padding: '8px 18px', borderRadius: t.radius, border: `2px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#475569', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer' });
const cta = (t) => ({ width: '100%', padding: '16px 20px', borderRadius: t.radius, border: 'none', background: t.accent, color: '#fff', fontWeight: 900, fontSize: 15, letterSpacing: 1, textTransform: 'uppercase' });

// Darken/lighten a hex color by pct (−100..100) for hero gradients.
function shade(hex, pct) {
  try {
    const h = (hex || '#0b1f3a').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  } catch { return hex; }
}
