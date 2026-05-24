/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// Public club storefront — /shop/<slug>
//   /shop/<slug>            landing + product grid
//   /shop/<slug>/p/<id>     single-product page
//   /shop/<slug>/b/<id>     bundle configurator (browse only for now)
// Reads the migration-011 storefront view with the anon key. No portal
// login. Cart/checkout arrive in a later step; for now this is browse-only
// so we can dial in the look.
// ─────────────────────────────────────────────────────────────────────

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumSizes = (j) => Object.values(j || {}).reduce((a, v) => a + (Number(v) || 0), 0);

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

// Minimal path router (no react-router dependency).
function parsePath() {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['shop','<slug>',...]
  const slug = segs[1] || '';
  const rest = segs.slice(2);
  return { slug, view: rest[0] || 'home', id: rest[1] || null };
}
function navTo(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ── Theme derived from store branding ────────────────────────────────
function useTheme(store) {
  return useMemo(() => {
    const primary = store?.primary_color || '#0f172a';
    const accent = store?.accent_color || store?.primary_color || '#2563eb';
    const theme = store?.theme || 'classic';
    return {
      primary, accent, theme,
      radius: theme === 'minimal' ? 4 : theme === 'bold' ? 16 : 10,
      heroPad: theme === 'bold' ? 96 : 64,
    };
  }, [store]);
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
  const [status, setStatus] = useState('loading'); // loading|ok|notfound|nomigration|error
  const [errMsg, setErrMsg] = useState('');

  const load = useCallback(async (slug) => {
    setStatus('loading');
    const { data: stores, error } = await supabase.from('webstores').select('*').eq('slug', slug).limit(1);
    if (error) { if (isMissingTable(error)) { setStatus('nomigration'); } else { setStatus('error'); setErrMsg(error.message); } return; }
    const s = (stores || [])[0];
    if (!s) { setStatus('notfound'); return; }
    if (s.status === 'archived') { setStatus('notfound'); return; }
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

  if (status === 'loading') return <Centered>Loading store…</Centered>;
  if (status === 'nomigration') return <Centered>This store isn’t available yet.</Centered>;
  if (status === 'notfound') return <Centered>🔍 We couldn’t find that store.</Centered>;
  if (status === 'error') return <Centered>Something went wrong loading this store.<div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{errMsg}</div></Centered>;

  const isOpen = store.status === 'open';

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', color: '#0f172a', minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <Header store={store} theme={theme} />
      {!isOpen && <PreviewBanner status={store.status} />}

      <main style={{ flex: 1, width: '100%', maxWidth: 1120, margin: '0 auto', padding: '0 20px 56px', boxSizing: 'border-box' }}>
        {route.view === 'home' && <Grid store={store} theme={theme} products={products} />}
        {route.view === 'p' && <ProductPage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} isOpen={isOpen} />}
        {route.view === 'b' && <BundlePage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} components={bundleItems.filter((b) => b.bundle_id === route.id)} isOpen={isOpen} />}
        {['cart', 'checkout', 'order'].includes(route.view) && <Centered>This part of the store is coming soon.</Centered>}
      </main>

      <Footer />
    </div>
  );
}

// ── Layout pieces ────────────────────────────────────────────────────
function Header({ store, theme }) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 10, background: theme.primary, color: '#fff', boxShadow: '0 1px 0 rgba(0,0,0,0.08)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={() => navTo('/shop/' + store.slug)}>
        {store.logo_url
          ? <img src={store.logo_url} alt="" style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 2 }} />
          : <div style={{ height: 40, width: 40, borderRadius: 8, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{(store.name || '?')[0]}</div>}
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.2 }}>{store.name}</div>
      </div>
    </header>
  );
}

function PreviewBanner({ status }) {
  return <div style={{ background: '#fef3c7', color: '#92400e', textAlign: 'center', fontSize: 13, fontWeight: 600, padding: '8px 16px' }}>
    Preview — this store is <b>{(status || 'draft').toUpperCase()}</b> and not open to shoppers yet.
  </div>;
}

function Hero({ store, theme }) {
  const bg = store.banner_url
    ? `linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url(${store.banner_url}) center/cover`
    : `linear-gradient(135deg, ${theme.primary}, ${theme.accent})`;
  return (
    <section style={{ background: bg, color: '#fff', padding: `${theme.heroPad}px 24px`, textAlign: 'center', borderRadius: theme.theme === 'minimal' ? 0 : 0 }}>
      <h1 style={{ margin: 0, fontSize: 38, fontWeight: 900, letterSpacing: -0.5 }}>{store.name}</h1>
      {store.hero_blurb && <p style={{ margin: '14px auto 0', maxWidth: 600, fontSize: 16, opacity: 0.95, lineHeight: 1.55 }}>{store.hero_blurb}</p>}
    </section>
  );
}

function Grid({ store, theme, products }) {
  return (
    <>
      <div style={{ margin: '0 -20px' }}><Hero store={store} theme={theme} /></div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '28px 0 14px' }}>Shop the collection</h2>
      {products.length === 0
        ? <Centered>No products in this store yet.</Centered>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 18 }}>
            {products.map((p) => <Card key={p.webstore_product_id} store={store} theme={theme} p={p} />)}
          </div>}
    </>
  );
}

function stockBadge(p) {
  if (p.kind === 'bundle') return { text: 'Package', color: '#1e40af', bg: '#dbeafe' };
  const onHand = sumSizes(p.size_stock);
  if (onHand > 0) return { text: 'In stock', color: '#166534', bg: '#dcfce7' };
  if (p.on_order_qty > 0) return { text: p.earliest_eta ? `Arriving ~${p.earliest_eta}` : 'On the way', color: '#92400e', bg: '#fef3c7' };
  return { text: 'Sold out', color: '#b91c1c', bg: '#fee2e2' };
}

function Card({ store, theme, p }) {
  const b = stockBadge(p);
  const go = () => navTo(`/shop/${store.slug}/${p.kind === 'bundle' ? 'b' : 'p'}/${p.webstore_product_id}`);
  return (
    <div onClick={go} style={{ background: '#fff', borderRadius: theme.radius, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', transition: 'transform .12s, box-shadow .12s', display: 'flex', flexDirection: 'column' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}>
      <div style={{ aspectRatio: '1', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {p.image_front_url
          ? <img src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: '#cbd5e1', fontSize: 13 }}>No image</span>}
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: b.bg, color: b.color }}>{b.text}</span>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{p.name}</div>
        <div style={{ marginTop: 'auto', fontWeight: 800, fontSize: 16, color: theme.primary }}>{money(p.retail_price)}</div>
      </div>
    </div>
  );
}

// ── Single product page ──────────────────────────────────────────────
function ProductPage({ store, theme, product: p, isOpen }) {
  const [size, setSize] = useState(null);
  const [img, setImg] = useState('front');
  if (!p) return <Centered>Product not found.</Centered>;
  const sizes = Array.isArray(p.available_sizes) ? p.available_sizes : [];
  const stock = p.size_stock || {};
  const onHand = sumSizes(stock);
  const incoming = p.on_order_qty > 0;
  const imgUrl = img === 'back' && p.image_back_url ? p.image_back_url : p.image_front_url;
  return (
    <div style={{ paddingTop: 24 }}>
      <BackLink store={store} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(280px,1fr)', gap: 36, alignItems: 'start' }}>
        <div>
          <div style={{ aspectRatio: '1', background: '#fff', borderRadius: theme.radius, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            {imgUrl ? <img src={imgUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#cbd5e1' }}>No image</span>}
          </div>
          {p.image_back_url && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {['front', 'back'].map((v) => <button key={v} onClick={() => setImg(v)} style={{ ...thumbBtn(theme, img === v) }}>{v}</button>)}
          </div>}
        </div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 6px' }}>{p.name}</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{[p.color, p.category].filter(Boolean).join(' · ')}</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: theme.primary, marginBottom: 16 }}>{money(p.retail_price)}</div>

          <StockLine onHand={onHand} incoming={incoming} eta={p.earliest_eta} onOrder={p.on_order_qty} />

          {sizes.length > 0 && <div style={{ margin: '18px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: 8 }}>Size</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sizes.map((sz) => {
                const q = Number(stock[sz] || 0);
                const sel = size === sz;
                const out = q <= 0 && !incoming;
                return <button key={sz} disabled={out} onClick={() => setSize(sz)} title={q > 0 ? `${q} in stock` : incoming ? 'Backorder' : 'Out of stock'}
                  style={{ ...sizeBtn(theme, sel), opacity: out ? 0.4 : 1, cursor: out ? 'not-allowed' : 'pointer', textDecoration: out ? 'line-through' : 'none' }}>{sz}</button>;
              })}
            </div>
          </div>}

          <button disabled style={{ ...cta(theme), opacity: 0.55, cursor: 'not-allowed', marginTop: 8 }}>
            {isOpen ? 'Add to cart (coming soon)' : 'Store not open yet'}
          </button>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Cart &amp; checkout are being built — this is a preview of the product page.</div>
        </div>
      </div>
    </div>
  );
}

// ── Bundle / package page ────────────────────────────────────────────
function BundlePage({ store, theme, product: p, components, isOpen }) {
  const [picks, setPicks] = useState({});
  if (!p) return <Centered>Package not found.</Centered>;
  return (
    <div style={{ paddingTop: 24 }}>
      <BackLink store={store} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(300px,1.1fr)', gap: 36, alignItems: 'start' }}>
        <div style={{ aspectRatio: '1', background: '#fff', borderRadius: theme.radius, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          {p.image_front_url ? <img src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#cbd5e1' }}>Package</span>}
        </div>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#dbeafe', color: '#1e40af' }}>PACKAGE</span>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '10px 0 6px' }}>{p.name}</h1>
          <div style={{ fontSize: 26, fontWeight: 900, color: theme.primary, marginBottom: 6 }}>{money(p.retail_price)}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>One price — choose a size for each item below.</div>

          {components.length === 0 ? <Centered>This package has no items configured yet.</Centered> :
            components.map((c) => (
              <div key={c.id} style={{ background: '#fff', borderRadius: theme.radius, padding: 14, marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.qty > 1 ? `${c.qty}× ` : ''}{c.sku || c.product_id}{c.takes_number ? ' (your number)' : ''}</div>
                  {!c.size_required && <span style={{ fontSize: 11, color: '#94a3b8' }}>one size</span>}
                </div>
                {c.size_required && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Size selection appears here at checkout.</div>}
              </div>
            ))}

          <button disabled style={{ ...cta(theme), opacity: 0.55, cursor: 'not-allowed', marginTop: 12 }}>
            {isOpen ? 'Add package to cart (coming soon)' : 'Store not open yet'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockLine({ onHand, incoming, eta, onOrder }) {
  if (onHand > 0) return <Pill bg="#dcfce7" fg="#166534">● In stock</Pill>;
  if (incoming) return <Pill bg="#fef3c7" fg="#92400e">{eta ? `Arriving around ${eta}` : `On the way${onOrder ? ` — ${onOrder} on order` : ''}`} · backorder available</Pill>;
  return <Pill bg="#fee2e2" fg="#b91c1c">Sold out</Pill>;
}

// ── Small UI atoms ───────────────────────────────────────────────────
function Pill({ children, bg, fg }) { return <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: bg, color: fg }}>{children}</span>; }
function BackLink({ store }) { return <button onClick={() => navTo('/shop/' + store.slug)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 16 }}>← Back to store</button>; }
function Centered({ children }) { return <div style={{ textAlign: 'center', color: '#64748b', fontSize: 15, padding: '60px 20px' }}>{children}</div>; }
function Footer() { return <footer style={{ background: '#0f172a', color: '#94a3b8', textAlign: 'center', fontSize: 12, padding: '20px' }}>Powered by National Sports Apparel</footer>; }

const sizeBtn = (t, sel) => ({ minWidth: 46, padding: '9px 12px', borderRadius: t.radius, border: `1.5px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#0f172a', fontWeight: 700, fontSize: 13 });
const thumbBtn = (t, sel) => ({ padding: '6px 14px', borderRadius: t.radius, border: `1.5px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#475569', fontWeight: 600, fontSize: 12, textTransform: 'capitalize', cursor: 'pointer' });
const cta = (t) => ({ width: '100%', padding: '14px 18px', borderRadius: t.radius, border: 'none', background: t.accent, color: '#fff', fontWeight: 800, fontSize: 15 });
