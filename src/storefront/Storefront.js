/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase';

const STRIPE_PK = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_STRIPE_PK) || '';
let _stripePromise = null;
try { if (STRIPE_PK) _stripePromise = loadStripe(STRIPE_PK); } catch { _stripePromise = null; }

// ── Cart (localStorage, per store slug) ──────────────────────────────
const cartKey = (slug) => 'nsa_cart_' + slug;
const loadCart = (slug) => { try { return JSON.parse(localStorage.getItem(cartKey(slug)) || '[]'); } catch { return []; } };
const saveCart = (slug, items) => { try { localStorage.setItem(cartKey(slug), JSON.stringify(items)); } catch {} };
const lineUnit = (l) => (Number(l.unit_price) || 0) + (Number(l.fundraise) || 0) + (Number(l.name_extra) || 0);
const cartCount = (items) => items.reduce((a, l) => a + (l.qty || 1), 0);
const cartTotal = (items) => items.reduce((a, l) => a + lineUnit(l) * (l.qty || 1), 0);
const shipFee = (store) => store && store.delivery_mode === 'ship_home' ? (Number(store.flat_shipping) || 0) : 0;
const grandTotal = (store, items) => cartTotal(items) + shipFee(store);

// Bold athletic type system: condensed display for headlines, Inter for body.
const DISPLAY = "'Anton','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Inter','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

function StoreStyles() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        .sf-root *{box-sizing:border-box}
        .sf-root{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
        .sf-root ::selection{background:var(--sf-accent,#e11d2a);color:#fff}
        html{scroll-behavior:smooth}
        .sf-btn{transition:transform .15s ease, filter .15s ease, box-shadow .15s ease}
        .sf-btn:hover{transform:translateY(-2px);filter:brightness(1.06)}
        .sf-btn:active{transform:translateY(0)}
        .sf-card{transition:transform .16s ease, box-shadow .16s ease}
        .sf-card .sf-img{transition:transform .35s ease}
        .sf-card:hover{transform:translateY(-5px);box-shadow:0 18px 40px rgba(11,18,32,.16)}
        .sf-card:hover .sf-img{transform:scale(1.07)}
        .sf-card:hover .sf-bar{transform:scaleX(1)}
      `}</style>
    </>
  );
}

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
// Effective stock counts on-hand warehouse + Adidas vendor (drop-ship) stock.
const effOnHand = (p) => sumSizes(p.size_stock) + (Number(p.vendor_on_hand) || 0);
const effSizeQty = (p, sz) => (Number((p.size_stock || {})[sz]) || 0) + (Number((p.vendor_size_stock || {})[sz]) || 0);
const isIncoming = (p) => (Number(p.on_order_qty) > 0) || !!p.earliest_eta || !!p.vendor_eta;
const etaOf = (p) => [p.earliest_eta, p.vendor_eta].filter(Boolean).sort()[0] || null;

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

  const [cart, setCart] = useState([]);
  useEffect(() => { if (route.slug) setCart(loadCart(route.slug)); }, [route.slug]);
  const updateCart = useCallback((items) => { setCart(items); saveCart(route.slug, items); }, [route.slug]);
  const addToCart = useCallback((line) => { const next = [...loadCart(route.slug), { ...line, key: Math.random().toString(36).slice(2) }]; updateCart(next); }, [route.slug, updateCart]);

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [compInfo, setCompInfo] = useState({}); // product_id -> {name,image_front_url,available_sizes}
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
    const bItems = (bundleRes.data || []).filter((b) => bundleIds.has(b.bundle_id));
    setBundleItems(bItems);
    // Component product details (name/image/sizes) so packages show real names + photos.
    const compPids = [...new Set(bItems.map((b) => b.product_id).filter(Boolean))];
    const info = {};
    if (compPids.length) {
      const { data } = await supabase.from('products').select('id,sku,name,image_front_url,available_sizes').in('id', compPids);
      (data || []).forEach((p) => { info[p.id] = p; });
    }
    setCompInfo(info);
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
    <div className="sf-root" style={{ '--sf-accent': theme.accent, '--sf-primary': theme.primary, fontFamily: BODY, color: '#0b1220', minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <StoreStyles />
      <Header store={store} theme={theme} cartCount={cartCount(cart)} />
      {!isOpen && <PreviewBanner status={store.status} />}
      <main style={{ flex: 1 }}>
        {route.view === 'home' && <Home store={store} theme={theme} products={products} />}
        {route.view === 'p' && <Wrap><ProductPage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} isOpen={isOpen} onAdd={addToCart} /></Wrap>}
        {route.view === 'b' && <Wrap><BundlePage store={store} theme={theme} product={products.find((p) => p.webstore_product_id === route.id)} components={bundleItems.filter((b) => b.bundle_id === route.id)} compInfo={compInfo} isOpen={isOpen} onAdd={addToCart} /></Wrap>}
        {route.view === 'cart' && <Wrap><CartPage store={store} theme={theme} cart={cart} onUpdate={updateCart} /></Wrap>}
        {route.view === 'checkout' && <Wrap><CheckoutPage store={store} theme={theme} cart={cart} onClear={() => updateCart([])} /></Wrap>}
        {route.view === 'order' && <Wrap><OrderStatusPage store={store} theme={theme} orderId={route.id} /></Wrap>}
      </main>
      <Footer theme={theme} />
    </div>
  );
}

const Wrap = ({ children }) => <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 20px 64px', boxSizing: 'border-box' }}>{children}</div>;

// ── Header ───────────────────────────────────────────────────────────
function Header({ store, theme, cartCount = 0 }) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: `linear-gradient(120deg, ${theme.primary}, ${shade(theme.primary, -10)})`, color: '#fff', borderBottom: `3px solid ${theme.accent}`, boxShadow: '0 2px 14px rgba(11,18,32,.18)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, cursor: 'pointer' }} onClick={() => navTo('/shop/' + store.slug)}>
          {store.logo_url
            ? <img src={store.logo_url} alt="" style={{ height: 46, width: 46, objectFit: 'contain', borderRadius: 10, background: '#fff', padding: 4, boxShadow: '0 2px 8px rgba(0,0,0,.25)' }} />
            : <div style={{ height: 46, width: 46, borderRadius: 10, background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontSize: 26, boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>{(store.name || '?')[0].toUpperCase()}</div>}
          <div style={{ fontFamily: DISPLAY, fontSize: 24, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1 }}>{store.name}</div>
        </div>
        <button className="sf-btn" onClick={() => navTo('/shop/' + store.slug + '/cart')} style={{ marginLeft: 'auto', background: cartCount > 0 ? theme.accent : 'rgba(255,255,255,0.14)', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 20px', fontWeight: 800, fontSize: 13, cursor: 'pointer', letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Cart{cartCount > 0 ? ` · ${cartCount}` : ''}
        </button>
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
  const stripes = `repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 26px)`;
  const heroBg = store.banner_url
    ? `linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.74)), url(${store.banner_url}) center/cover`
    : `${stripes}, radial-gradient(120% 130% at 85% -10%, ${theme.accent} 0%, transparent 45%), linear-gradient(135deg, ${theme.primary} 0%, ${shade(theme.primary, -16)} 70%)`;
  return (
    <>
      <section style={{ background: heroBg, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        {/* angled accent slash */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: -120, width: 220, background: theme.accent, opacity: store.banner_url ? 0.85 : 0.9, transform: 'skewX(-12deg)', boxShadow: '0 0 60px rgba(0,0,0,.25)' }} />
        <div style={{ position: 'relative', maxWidth: 1180, margin: '0 auto', padding: 'clamp(56px,9vw,96px) 20px clamp(56px,8vw,84px)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <span style={{ width: 30, height: 4, background: theme.accent, borderRadius: 2 }} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', opacity: 0.92 }}>Official Team Store</span>
          </div>
          {closes && <div style={{ display: 'inline-block', marginLeft: 0, marginBottom: 16, background: closes.urgent ? theme.accent : 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, boxShadow: closes.urgent ? '0 4px 14px rgba(0,0,0,.2)' : 'none' }}>{closes.text}</div>}
          <h1 style={{ fontFamily: DISPLAY, margin: 0, fontSize: 'clamp(44px,8vw,92px)', letterSpacing: -0.5, textTransform: 'uppercase', lineHeight: 0.88, maxWidth: 900, textShadow: store.banner_url ? '0 2px 20px rgba(0,0,0,.4)' : 'none' }}>{store.name}</h1>
          {store.hero_blurb && <p style={{ margin: '20px 0 0', maxWidth: 560, fontSize: 17, lineHeight: 1.55, opacity: 0.92, fontWeight: 500 }}>{store.hero_blurb}</p>}
          <button className="sf-btn" onClick={() => document.getElementById('shop-grid')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ marginTop: 28, background: theme.accent, color: '#fff', border: 'none', padding: '15px 38px', borderRadius: theme.radius, fontFamily: DISPLAY, fontSize: 16, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 8px 22px rgba(0,0,0,.25)' }}>Shop the Collection</button>
        </div>
      </section>

      <TrustStrip store={store} theme={theme} />

      <div id="shop-grid" style={{ maxWidth: 1180, margin: '0 auto', padding: '48px 20px 80px' }}>
        <SectionTitle theme={theme}>The Collection</SectionTitle>
        {products.length === 0
          ? <Splash>No products in this store yet.</Splash>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(238px,1fr))', gap: 22 }}>
              {products.map((p) => <Card key={p.webstore_product_id} store={store} theme={theme} p={p} />)}
            </div>}
      </div>
    </>
  );
}

function TrustStrip({ store, theme }) {
  const deliver = store.delivery_mode === 'ship_home' ? 'Ships to your door' : 'Delivered to the club';
  const items = [['★', 'Official team apparel'], ['⚡', 'Quality custom decoration'], ['📦', deliver], ['♥', 'Supports the team']];
  return (
    <div style={{ background: '#0b1220', color: '#fff' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {items.map(([icon, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>
            <span style={{ color: theme.accent, fontSize: 16 }}>{icon}</span>{label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children, theme }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
    <span style={{ width: 7, height: 30, background: theme.accent, borderRadius: 2 }} />
    <h2 style={{ fontFamily: DISPLAY, margin: 0, fontSize: 'clamp(26px,4vw,36px)', letterSpacing: 0.3, textTransform: 'uppercase', lineHeight: 1 }}>{children}</h2>
  </div>;
}

function stockBadge(p) {
  if (p.kind === 'bundle') return { text: 'Package', color: '#fff', bg: '#1e40af' };
  if (effOnHand(p) > 0) return { text: 'In stock', color: '#fff', bg: '#16a34a' };
  if (isIncoming(p)) { const e = etaOf(p); return { text: e ? `Arriving ${e}` : 'On the way', color: '#fff', bg: '#d97706' }; }
  return { text: 'Sold out', color: '#fff', bg: '#b91c1c' };
}

function Card({ store, theme, p }) {
  const b = stockBadge(p);
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  const go = () => navTo(`/shop/${store.slug}/${p.kind === 'bundle' ? 'b' : 'p'}/${p.webstore_product_id}`);
  return (
    <div className="sf-card" onClick={go} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: theme.radius, overflow: 'hidden', border: '1px solid #eef1f5', boxShadow: '0 1px 3px rgba(11,18,32,.05)' }}>
      <div style={{ position: 'relative', aspectRatio: '4/5', background: '#f4f6f9', overflow: 'hidden' }}>
        {p.image_front_url
          ? <img className="sf-img" src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Placeholder theme={theme} label={p.name || store.name} />}
        <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', padding: '5px 10px', borderRadius: 999, background: b.bg, color: b.color, boxShadow: '0 2px 6px rgba(0,0,0,.15)' }}>{b.text}</span>
      </div>
      <div style={{ position: 'relative', padding: '15px 15px 17px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span className="sf-bar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: theme.accent, transform: 'scaleX(0)', transformOrigin: 'left', transition: 'transform .2s ease' }} />
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, minHeight: 36 }}>{p.name}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, letterSpacing: 0.3 }}>{money(priceOf(p))}</span>
        </div>
        {showFund && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>♥ {money(p.fundraise_amount)} supports the team</div>}
      </div>
    </div>
  );
}

function Placeholder({ theme, label }) {
  const stripes = `repeating-linear-gradient(125deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 22px)`;
  return <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18, textAlign: 'center', background: `${stripes}, linear-gradient(135deg, ${theme.primary}, ${shade(theme.primary, -14)})` }}>
    <div style={{ width: 56, height: 56, borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontSize: 30, color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>{(label || '?')[0].toUpperCase()}</div>
    <div style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', lineHeight: 1.3, maxWidth: 160 }}>{label}</div>
  </div>;
}

// ── Single product ───────────────────────────────────────────────────
function ProductPage({ store, theme, product: p, isOpen, onAdd }) {
  const [size, setSize] = useState(null);
  const [img, setImg] = useState('front');
  const [num, setNum] = useState('');
  const [pname, setPname] = useState('');
  const [added, setAdded] = useState(false);
  if (!p) return <Splash>Product not found.</Splash>;
  const sizesArr = Array.isArray(p.available_sizes) ? p.available_sizes : [];
  const nameUp = Number(p.name_upcharge) || 0;
  const total = priceOf(p) + (p.takes_name && pname.trim() ? nameUp : 0);
  const needSize = sizesArr.length > 0;
  const needNumber = !!p.takes_number;
  const canAdd = isOpen && (!needSize || size) && (!needNumber || num.trim());
  const addToCart = () => {
    onAdd({
      kind: 'single', webstore_product_id: p.webstore_product_id, product_id: p.product_id, sku: p.sku,
      name: p.name, image: p.image_front_url || null, size: size || null,
      unit_price: Number(p.retail_price) || 0, fundraise: Number(p.fundraise_amount) || 0,
      name_extra: p.takes_name && pname.trim() ? nameUp : 0,
      player_number: needNumber ? num.trim() : null,
      player_name: p.takes_name && pname.trim() ? pname.trim() : null,
      qty: 1,
    });
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  };
  const sizes = Array.isArray(p.available_sizes) ? p.available_sizes : [];
  const onHand = effOnHand(p);
  const incoming = isIncoming(p);
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
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(30px,4vw,42px)', margin: '0 0 8px', letterSpacing: 0.2, lineHeight: 0.98, textTransform: 'uppercase' }}>{p.name}</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>{[p.color, p.category].filter(Boolean).join(' · ')}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, marginBottom: showFund ? 4 : 18, letterSpacing: 0.3 }}>{money(priceOf(p))}</div>
          {showFund && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, marginBottom: 18 }}>Includes {money(p.fundraise_amount)} that supports the team</div>}

          <StockLine onHand={onHand} incoming={incoming} eta={etaOf(p)} onOrder={p.on_order_qty} />

          {sizes.length > 0 && <div style={{ margin: '22px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#0b1220', marginBottom: 10 }}>Select size</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {sizes.map((sz) => {
                const q = effSizeQty(p, sz); const sel = size === sz; const out = q <= 0 && !incoming;
                return <button key={sz} disabled={out} onClick={() => setSize(sz)} title={q > 0 ? `${q} available` : incoming ? 'Backorder' : 'Out of stock'}
                  style={{ ...sizeBtn(theme, sel), opacity: out ? 0.35 : 1, cursor: out ? 'not-allowed' : 'pointer', textDecoration: out ? 'line-through' : 'none' }}>{sz}</button>;
              })}
            </div>
          </div>}

          {(p.takes_number || p.takes_name) && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0 18px' }}>
              {p.takes_number && <div>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#0b1220', marginBottom: 6 }}>Number</div>
                <input value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="#" inputMode="numeric" style={fieldStyle(theme, 80)} />
              </div>}
              {p.takes_name && <div>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#0b1220', marginBottom: 6 }}>Name {nameUp > 0 ? `(+${money(nameUp)})` : ''}</div>
                <input value={pname} onChange={(e) => setPname(e.target.value.slice(0, 20))} placeholder="Last name" style={fieldStyle(theme, 220)} />
              </div>}
            </div>
          )}

          {p.takes_name && nameUp > 0 && pname.trim() ? <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Total: {money(total)}</div> : null}
          <button className="sf-btn" onClick={addToCart} disabled={!canAdd} style={{ ...cta(theme), opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed', marginTop: 8 }}>
            {!isOpen ? 'Store not open yet' : added ? '✓ Added to cart' : needSize && !size ? 'Select a size' : needNumber && !num.trim() ? 'Enter a number' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Package ──────────────────────────────────────────────────────────
function BundlePage({ store, theme, product: p, components, compInfo = {}, isOpen, onAdd }) {
  const [picks, setPicks] = useState({}); // component id -> selected size
  const [nums, setNums] = useState({});   // component id -> jersey number
  const [names, setNames] = useState({}); // component id -> custom name
  const [added, setAdded] = useState(false);
  if (!p) return <Splash>Package not found.</Splash>;
  const compSizesArr = (c) => { const s = compInfo[c.product_id]?.available_sizes; return Array.isArray(s) ? s : []; };
  const nameExtra = components.reduce((a, c) => a + ((c.takes_name && (names[c.id] || '').trim()) ? (Number(c.name_upcharge) || 0) : 0), 0);
  const missingSize = components.some((c) => c.size_required && compSizesArr(c).length > 0 && !picks[c.id]);
  const missingNum = components.some((c) => c.takes_number && !(nums[c.id] || '').trim());
  const canAdd = isOpen && !missingSize && !missingNum;
  const addToCart = () => {
    onAdd({
      kind: 'bundle', webstore_product_id: p.webstore_product_id, product_id: null, sku: null,
      name: p.name, image: p.image_front_url || (components.map((c) => compInfo[c.product_id]?.image_front_url).find(Boolean)) || null,
      unit_price: Number(p.retail_price) || 0, fundraise: Number(p.fundraise_amount) || 0, name_extra: nameExtra,
      components: components.map((c) => ({
        bundle_item_id: c.id, product_id: c.product_id, sku: c.sku, name: compInfo[c.product_id]?.name || c.sku,
        size: picks[c.id] || null,
        player_number: c.takes_number ? (nums[c.id] || '').trim() : null,
        player_name: c.takes_name ? (names[c.id] || '').trim() : null,
      })),
      qty: 1,
    });
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  };
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  const compName = (c) => compInfo[c.product_id]?.name || c.sku || 'Item';
  const compImg = (c) => compInfo[c.product_id]?.image_front_url;
  const compSizes = (c) => { const s = compInfo[c.product_id]?.available_sizes; return Array.isArray(s) ? s : []; };
  // When the rep hasn't uploaded a custom package photo, show all the items.
  const galleryImgs = components.map(compImg).filter(Boolean);
  return (
    <div style={{ paddingTop: 26 }}>
      <BackLink store={store} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 44, alignItems: 'start' }}>
        <div>
          {p.image_front_url
            ? <div style={{ aspectRatio: '4/5', background: '#f4f6f9', borderRadius: theme.radius, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={p.image_front_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            : galleryImgs.length
              ? <div style={{ display: 'grid', gridTemplateColumns: galleryImgs.length === 1 ? '1fr' : 'repeat(2,1fr)', gap: 10 }}>
                  {components.filter(compImg).map((c) => (
                    <div key={c.id} style={{ aspectRatio: '1', background: '#f4f6f9', borderRadius: theme.radius, overflow: 'hidden' }}>
                      <img src={compImg(c)} alt={compName(c)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              : <div style={{ aspectRatio: '4/5', background: '#f4f6f9', borderRadius: theme.radius, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Placeholder theme={theme} label={store.name} /></div>}
        </div>
        <div style={{ paddingTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', padding: '5px 13px', borderRadius: 999, background: theme.accent, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>Package Deal</span>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(30px,4vw,42px)', margin: '12px 0 8px', letterSpacing: 0.2, lineHeight: 0.98, textTransform: 'uppercase' }}>{p.name}</h1>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, marginBottom: showFund ? 4 : 8, letterSpacing: 0.3 }}>{money(priceOf(p))}</div>
          {showFund && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, marginBottom: 8 }}>Includes {money(p.fundraise_amount)} that supports the team</div>}
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>One price — pick a size for each item below.</div>

          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>What's included</div>
          {components.length === 0 ? <Splash>This package has no items configured yet.</Splash> :
            components.map((c) => {
              const sizes = compSizes(c);
              return (
                <div key={c.id} style={{ padding: '14px 0', borderBottom: '1px solid #eef1f5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {compImg(c) && <img src={compImg(c)} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{c.qty > 1 ? `${c.qty}× ` : ''}{compName(c)}</div>
                      {c.takes_number && <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 600 }}>Your jersey number</div>}
                      {!c.size_required && <div style={{ fontSize: 12, color: '#94a3b8' }}>One size</div>}
                    </div>
                  </div>
                  <div style={{ marginLeft: compImg(c) ? 60 : 0 }}>
                    {c.size_required && sizes.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {sizes.map((sz) => {
                          const seld = picks[c.id] === sz;
                          return <button key={sz} onClick={() => setPicks((x) => ({ ...x, [c.id]: sz }))} style={sizeBtn(theme, seld)}>{sz}</button>;
                        })}
                      </div>
                    )}
                    {(c.takes_number || c.takes_name) && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                        {c.takes_number && <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Number</div>
                          <input value={nums[c.id] || ''} onChange={(e) => setNums((x) => ({ ...x, [c.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} placeholder="#" inputMode="numeric" style={fieldStyle(theme, 70)} />
                        </div>}
                        {c.takes_name && <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Name {Number(c.name_upcharge) > 0 ? `(+${money(c.name_upcharge)})` : ''}</div>
                          <input value={names[c.id] || ''} onChange={(e) => setNames((x) => ({ ...x, [c.id]: e.target.value.slice(0, 20) }))} placeholder="Last name" style={fieldStyle(theme, 180)} />
                        </div>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          {nameExtra > 0 && <div style={{ fontSize: 14, fontWeight: 700, marginTop: 16 }}>Total with personalization: {money(priceOf(p) + nameExtra)}</div>}
          <button className="sf-btn" onClick={addToCart} disabled={!canAdd} style={{ ...cta(theme), opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed', marginTop: 16 }}>
            {!isOpen ? 'Store not open yet' : added ? '✓ Added to cart' : missingSize ? 'Pick a size for each item' : missingNum ? 'Enter a number' : 'Add package to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cart ─────────────────────────────────────────────────────────────
function lineDetail(l) {
  if (l.kind === 'bundle') return (l.components || []).map((c) => `${c.name}${c.size ? ' · ' + c.size : ''}${c.player_number ? ' · #' + c.player_number : ''}${c.player_name ? ' · ' + c.player_name : ''}`);
  return [[l.size && 'Size ' + l.size, l.player_number && '#' + l.player_number, l.player_name].filter(Boolean).join(' · ')].filter(Boolean);
}
function CartPage({ store, theme, cart, onUpdate }) {
  if (!cart.length) return <div style={{ paddingTop: 26 }}><BackLink store={store} /><Splash>Your cart is empty.</Splash></div>;
  const remove = (key) => onUpdate(cart.filter((l) => l.key !== key));
  const setQty = (key, q) => onUpdate(cart.map((l) => (l.key === key ? { ...l, qty: Math.max(1, q) } : l)));
  // Personalized items (a specific jersey number/name) and packages are 1-of-a-kind.
  const fixedQty = (l) => l.kind === 'bundle' || !!l.player_number || !!l.player_name;
  return (
    <div style={{ paddingTop: 26 }}>
      <BackLink store={store} />
      <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(30px,5vw,44px)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 20px', lineHeight: 0.95 }}>Your cart</h1>
      {cart.map((l) => (
        <div key={l.key} style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: '1px solid #eef1f5', alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 8, background: '#f4f6f9', overflow: 'hidden', flexShrink: 0 }}>{l.image && <img src={l.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800 }}>{l.name}{l.kind === 'bundle' ? ' (package)' : ''}</div>
            {lineDetail(l).map((d, i) => <div key={i} style={{ fontSize: 12, color: '#64748b' }}>{d}</div>)}
            {fixedQty(l)
              ? <button onClick={() => remove(l.key)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12, padding: '4px 0 0' }}>Remove</button>
              : <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                    <button onClick={() => setQty(l.key, (l.qty || 1) - 1)} disabled={(l.qty || 1) <= 1} style={qtyBtn((l.qty || 1) <= 1)}>−</button>
                    <span style={{ minWidth: 30, textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{l.qty || 1}</span>
                    <button onClick={() => setQty(l.key, (l.qty || 1) + 1)} style={qtyBtn(false)}>+</button>
                  </div>
                  <button onClick={() => remove(l.key)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                </div>}
          </div>
          <div style={{ fontWeight: 800 }}>{money(lineUnit(l) * (l.qty || 1))}</div>
        </div>
      ))}
      {shipFee(store) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13, color: '#475569' }}><span>Shipping (flat)</span><span>{money(shipFee(store))}</span></div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: shipFee(store) > 0 ? 8 : 20 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, letterSpacing: 0.3 }}>Total: {money(grandTotal(store, cart))}</div>
        <button className="sf-btn" onClick={() => navTo('/shop/' + store.slug + '/checkout')} style={{ ...cta(theme), width: 'auto', padding: '15px 44px' }}>Checkout</button>
      </div>
    </div>
  );
}

// ── Order confirmation email (server-side Brevo proxy keeps the key secret) ──
async function sendOrderEmail({ store, order, cart, buyer, shipping, total }) {
  try {
    const link = `${window.location.origin}/shop/${store.slug}/order/${order.id}`;
    const rows = cart.map((l) => {
      const det = lineDetail(l).join(' · ');
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eef1f5">${l.name}${l.kind === 'bundle' ? ' (package)' : ''}${l.qty > 1 ? ` ×${l.qty}` : ''}${det ? `<div style="font-size:12px;color:#64748b">${det}</div>` : ''}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;white-space:nowrap">${money(lineUnit(l) * (l.qty || 1))}</td></tr>`;
    }).join('');
    const accent = store.accent_color || '#e11d2a';
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:560px;margin:0 auto">
      <div style="background:${store.primary_color || '#0b1f3a'};color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
        <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${store.name}</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">Order confirmed${order.payment_mode === 'paid' ? ' &amp; paid' : ''}</div>
      </div>
      <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
        <p style="margin:0 0 14px">Thanks, ${buyer.name}! ${order.payment_mode === 'paid' ? "We've received your payment." : 'Your order has been placed and will be invoiced to the team.'}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
          ${shipping > 0 ? `<tr><td style="padding:8px 0;color:#475569">Shipping</td><td style="padding:8px 0;text-align:right">${money(shipping)}</td></tr>` : ''}
          <tr><td style="padding:12px 0 0;font-weight:800;font-size:16px">Total</td><td style="padding:12px 0 0;text-align:right;font-weight:800;font-size:16px">${money(total)}</td></tr>
        </table>
        <a href="${link}" style="display:inline-block;margin-top:20px;background:${accent};color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700">Track your order</a>
        <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the link above is how you check your order status anytime.</p>
      </div></div>`;
    await fetch('/.netlify/functions/brevo-proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: store.name || 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: buyer.email, name: buyer.name }],
        subject: `Your ${store.name} order is confirmed`,
        htmlContent: html,
      }),
    });
  } catch (e) { console.warn('[storefront] confirmation email failed:', e); }
}

// ── Checkout ─────────────────────────────────────────────────────────
async function placeOrder({ store, cart, buyer, ship, payMode, stripePiId }) {
  const subtotal = cart.reduce((a, l) => a + (Number(l.unit_price) || 0) * (l.qty || 1), 0);
  const fundraise = cart.reduce((a, l) => a + ((Number(l.fundraise) || 0) + (Number(l.name_extra) || 0)) * (l.qty || 1), 0);
  const shipping = shipFee(store);
  const total = cartTotal(cart) + shipping;
  const { data: order, error } = await supabase.from('webstore_orders').insert({
    store_id: store.id, status: payMode === 'paid' ? 'paid' : 'unpaid', payment_mode: payMode, order_kind: 'individual',
    buyer_name: buyer.name, buyer_email: buyer.email, buyer_phone: buyer.phone || null,
    ship_address: store.delivery_mode === 'ship_home' ? ship : null, ship_method: store.delivery_mode,
    subtotal, fundraise_amt: fundraise, shipping_fee: shipping, total, stripe_pi_id: stripePiId || null,
  }).select().single();
  if (error) return { error };

  const items = [];
  cart.forEach((l) => {
    if (l.kind === 'bundle') {
      const bref = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
      items.push({ order_id: order.id, product_id: null, sku: null, size: null, qty: 1, unit_price: l.unit_price, unit_fundraise: (l.fundraise || 0) + (l.name_extra || 0), player_name: null, player_number: null, bundle_ref: bref, bundle_product_id: l.webstore_product_id, is_bundle_parent: true, line_status: 'pending' });
      (l.components || []).forEach((c) => items.push({ order_id: order.id, product_id: c.product_id, sku: c.sku, size: c.size, qty: 1, unit_price: 0, unit_fundraise: 0, player_name: c.player_name || null, player_number: c.player_number || null, bundle_ref: bref, bundle_product_id: l.webstore_product_id, is_bundle_parent: false, line_status: 'pending' }));
    } else {
      items.push({ order_id: order.id, product_id: l.product_id, sku: l.sku, size: l.size, qty: l.qty || 1, unit_price: l.unit_price, unit_fundraise: (l.fundraise || 0) + (l.name_extra || 0), player_name: l.player_name || null, player_number: l.player_number || null, line_status: 'pending' });
    }
  });
  await supabase.from('webstore_order_items').insert(items);

  // Jersey number uniqueness claims (only when the store enforces it).
  if (store.number_unique) {
    const nums = new Set();
    items.forEach((i) => { if (i.player_number) nums.add(i.player_number); });
    for (const n of nums) {
      const { error: ce } = await supabase.from('webstore_number_claims').insert({ store_id: store.id, player_number: String(n), order_id: order.id, player_name: buyer.name });
      if (ce && /duplicate|unique/i.test(ce.message || '')) return { error: { message: `Number ${n} was just taken by someone else — please pick a different number.` }, order };
    }
  }
  if (buyer.email) sendOrderEmail({ store, order, cart, buyer, shipping, total });
  return { order };
}

function CheckoutPage({ store, theme, cart, onClear }) {
  const allowUnpaid = store.payment_mode === 'unpaid' || store.payment_mode === 'either';
  const allowPaid = store.payment_mode === 'paid' || store.payment_mode === 'either';
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '' });
  const [ship, setShip] = useState({ name: '', street1: '', street2: '', city: '', state: '', zip: '' });
  const [method, setMethod] = useState(allowPaid && _stripePromise ? 'paid' : 'unpaid');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const needAddr = store.delivery_mode === 'ship_home';

  if (!cart.length) return <div style={{ paddingTop: 26 }}><BackLink store={store} /><Splash>Your cart is empty.</Splash></div>;

  const validBuyer = buyer.name.trim() && /.+@.+\..+/.test(buyer.email) && (!needAddr || (ship.street1 && ship.city && ship.state && ship.zip));

  const submitUnpaid = async () => {
    setErr(''); if (!validBuyer) { setErr('Please complete your contact and shipping info.'); return; }
    setBusy(true);
    const r = await placeOrder({ store, cart, buyer, ship: { ...ship, name: ship.name || buyer.name }, payMode: 'unpaid' });
    setBusy(false);
    if (r.error) { setErr(r.error.message); return; }
    onClear(); navTo(`/shop/${store.slug}/order/${r.order.id}`);
  };

  const startCard = async () => {
    setErr(''); if (!validBuyer) { setErr('Please complete your contact and shipping info.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/stripe-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_intent', amount_cents: Math.round(grandTotal(store, cart) * 100), customer_name: buyer.name, customer_email: buyer.email, invoice_id: store.slug, invoice_memo: store.name + ' webstore' }) });
      const data = await res.json();
      if (data.clientSecret) setClientSecret(data.clientSecret);
      else setErr(data.error || 'Could not start payment.');
    } catch (e) { setErr('Payment setup failed: ' + e.message); }
    setBusy(false);
  };

  return (
    <div style={{ paddingTop: 26, maxWidth: 640 }}>
      <BackLink store={store} />
      <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(30px,5vw,44px)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 20px', lineHeight: 0.95 }}>Checkout</h1>
      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{err}</div>}

      <Field label="Your name"><input style={inp} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Email"><input style={inp} value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></Field>
        <Field label="Phone (optional)"><input style={inp} value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></Field>
      </div>

      {needAddr ? (
        <><div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', margin: '12px 0 6px' }}>Ship to home</div>
        <Field label="Street"><input style={inp} value={ship.street1} onChange={(e) => setShip({ ...ship, street1: e.target.value })} /></Field>
        <Field label="Apt / unit (optional)"><input style={inp} value={ship.street2} onChange={(e) => setShip({ ...ship, street2: e.target.value })} /></Field>
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="City"><input style={inp} value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} /></Field>
          <Field label="State"><input style={inp} value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} /></Field>
          <Field label="ZIP"><input style={inp} value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} /></Field>
        </div></>
      ) : <div style={{ background: '#eff6ff', color: '#1e40af', padding: '10px 14px', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>Orders for this store are <b>delivered to the club</b> — no shipping address needed.</div>}

      {shipFee(store) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: 14 }}><span>Shipping (flat)</span><span>{money(shipFee(store))}</span></div>}
      <div style={{ borderTop: '1px solid #eef1f5', margin: shipFee(store) > 0 ? '10px 0 0' : '18px 0', paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 900 }}>
        <span>Total</span><span>{money(grandTotal(store, cart))}</span>
      </div>

      {store.payment_mode === 'either' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {allowPaid && _stripePromise && <button onClick={() => { setMethod('paid'); setClientSecret(null); }} style={methodBtn(theme, method === 'paid')}>Pay by card</button>}
          {allowUnpaid && <button onClick={() => { setMethod('unpaid'); setClientSecret(null); }} style={methodBtn(theme, method === 'unpaid')}>Put on team tab</button>}
        </div>
      )}

      {method === 'paid' && allowPaid ? (
        _stripePromise ? (
          clientSecret ? (
            <Elements stripe={_stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
              <CardForm theme={theme} onPaid={async (piId) => { const r = await placeOrder({ store, cart, buyer, ship: { ...ship, name: ship.name || buyer.name }, payMode: 'paid', stripePiId: piId }); if (r.error) { setErr(r.error.message); return; } onClear(); navTo(`/shop/${store.slug}/order/${r.order.id}`); }} />
            </Elements>
          ) : <button className="sf-btn" onClick={startCard} disabled={busy || !validBuyer} style={{ ...cta(theme), opacity: busy || !validBuyer ? 0.5 : 1 }}>{busy ? 'Starting…' : 'Continue to payment'}</button>
        ) : <div style={{ color: '#b91c1c', fontSize: 13 }}>Card payment isn’t configured for this store.</div>
      ) : (
        <button className="sf-btn" onClick={submitUnpaid} disabled={busy || !validBuyer} style={{ ...cta(theme), opacity: busy || !validBuyer ? 0.5 : 1 }}>{busy ? 'Placing…' : 'Place order — invoice the team'}</button>
      )}
    </div>
  );
}

function CardForm({ theme, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr('');
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) { setErr(error.message || 'Payment failed.'); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === 'succeeded') { await onPaid(paymentIntent.id); }
    else { setErr('Payment not completed.'); setBusy(false); }
  };
  return (
    <div>
      <PaymentElement />
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <button className="sf-btn" onClick={pay} disabled={busy} style={{ ...cta(theme), opacity: busy ? 0.5 : 1, marginTop: 14 }}>{busy ? 'Processing…' : 'Pay now'}</button>
    </div>
  );
}

// ── Order status (tokenless lookup by id; emailed link comes later) ──
function OrderStatusPage({ store, theme, orderId }) {
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    (async () => {
      const { data: o } = await supabase.from('webstore_orders').select('*').eq('id', orderId).limit(1);
      if (!o || !o[0]) { setStatus('notfound'); return; }
      setOrder(o[0]);
      const { data: its } = await supabase.from('webstore_order_items').select('*').eq('order_id', orderId);
      setItems(its || []); setStatus('ok');
    })();
  }, [orderId]);
  if (status === 'loading') return <Splash>Loading your order…</Splash>;
  if (status === 'notfound') return <div style={{ paddingTop: 26 }}><BackLink store={store} /><Splash>Order not found.</Splash></div>;
  const steps = ['pending', 'in_production', 'shipped', 'complete'];
  const cur = items[0]?.line_status || 'pending';
  const curIdx = Math.max(0, steps.indexOf(cur));
  return (
    <div style={{ paddingTop: 26, maxWidth: 640 }}>
      <BackLink store={store} />
      <div style={{ background: '#dcfce7', color: '#166534', padding: '14px 18px', borderRadius: theme.radius, fontWeight: 800, marginBottom: 18 }}>
        ✓ Order confirmed{order.payment_mode === 'paid' ? ' & paid' : ' — invoiced to the team'}. A confirmation was recorded for {order.buyer_email}.
      </div>
      <h1 style={{ fontFamily: DISPLAY, fontSize: 28, letterSpacing: 0.3, textTransform: 'uppercase', margin: '0 0 14px' }}>Order status</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {['Ordered', 'In production', 'Shipped', 'Complete'].map((s, i) => (
          <div key={s} style={{ flex: 1, minWidth: 110, textAlign: 'center', padding: '10px 6px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: i <= curIdx ? theme.accent : '#f1f5f9', color: i <= curIdx ? '#fff' : '#94a3b8' }}>{s}</div>
        ))}
      </div>
      {items.filter((i) => !i.is_bundle_parent).map((i) => (
        <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eef1f5', fontSize: 14 }}>
          <div>{i.sku}{i.size ? ' · ' + i.size : ''}{i.player_number ? ' · #' + i.player_number : ''}{i.player_name ? ' · ' + i.player_name : ''}</div>
          <div style={{ color: '#64748b' }}>{(i.line_status || 'pending').replace(/_/g, ' ')}</div>
        </div>
      ))}
      <div style={{ marginTop: 18, fontWeight: 900, fontSize: 18 }}>Total: {money(order.total)}</div>
    </div>
  );
}

const qtyBtn = (disabled) => ({ width: 32, height: 32, border: 'none', background: disabled ? '#f8fafc' : '#fff', color: disabled ? '#cbd5e1' : '#0b1220', fontSize: 18, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', lineHeight: 1 });
const inp = { width: '100%', padding: '11px 12px', borderRadius: 8, border: '2px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
const methodBtn = (t, sel) => ({ flex: 1, padding: '12px', borderRadius: t.radius, border: `2px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#0b1220', fontWeight: 800, fontSize: 13, cursor: 'pointer' });
function Field({ label, children }) { return <div style={{ marginBottom: 12, flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>{label}</div>{children}</div>; }

function StockLine({ onHand, incoming, eta, onOrder }) {
  if (onHand > 0) return <Pill bg="#dcfce7" fg="#166534">● In stock — ready to ship</Pill>;
  if (incoming) return <Pill bg="#fef3c7" fg="#92400e">{eta ? `Arriving around ${eta}` : `On the way${onOrder ? ` — ${onOrder} on order` : ''}`} · backorder available</Pill>;
  return <Pill bg="#fee2e2" fg="#b91c1c">Sold out</Pill>;
}

// ── atoms ────────────────────────────────────────────────────────────
function Pill({ children, bg, fg }) { return <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '7px 13px', borderRadius: 8, background: bg, color: fg }}>{children}</span>; }
function BackLink({ store }) { return <button onClick={() => navTo('/shop/' + store.slug)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>← Back to store</button>; }
function Splash({ children }) { return <div style={{ minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#64748b', fontSize: 15, padding: '60px 20px', fontFamily: BODY }}>{children}</div>; }
function Footer({ theme }) {
  return <footer style={{ background: `linear-gradient(120deg, ${theme.primary}, ${shade(theme.primary, -10)})`, color: 'rgba(255,255,255,0.82)', textAlign: 'center', padding: '34px 20px', borderTop: `3px solid ${theme.accent}` }}>
    <div style={{ fontFamily: DISPLAY, fontSize: 20, letterSpacing: 1, textTransform: 'uppercase', color: '#fff' }}>National Sports Apparel</div>
    <div style={{ fontSize: 12, letterSpacing: 0.5, marginTop: 6, opacity: 0.7 }}>Custom team apparel · Powered by NSA</div>
  </footer>;
}

const sizeBtn = (t, sel) => ({ minWidth: 52, padding: '12px 14px', borderRadius: t.radius, border: `2px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#0b1220', fontWeight: 800, fontSize: 14 });
const thumbBtn = (t, sel) => ({ padding: '8px 18px', borderRadius: t.radius, border: `2px solid ${sel ? t.accent : '#e2e8f0'}`, background: sel ? t.accent : '#fff', color: sel ? '#fff' : '#475569', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer' });
const cta = (t) => ({ width: '100%', padding: '16px 20px', borderRadius: t.radius, border: 'none', background: t.accent, color: '#fff', fontFamily: DISPLAY, fontSize: 17, letterSpacing: 1.2, textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 8px 20px rgba(11,18,32,.16)' });
const fieldStyle = (t, w) => ({ width: w, padding: '11px 12px', borderRadius: t.radius, border: '2px solid #e2e8f0', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', boxSizing: 'border-box' });

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
