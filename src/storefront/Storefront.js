/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Elements, PaymentElement, AddressElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase';
import { placementById } from '../lib/artPlacements';
import { foldScale, foldedQty, foldedSoon, regularSize } from '../lib/storeInventory';
import { normSzName } from '../pricing';

// Route SanMar garment photos through a Cloudinary transform that trims to the
// garment (on its white studio background) and pads to a uniform 4:5 frame, so
// every product is framed identically and an applied team logo lands at the same
// spot instead of drifting with each photo's crop. Only SanMar-hosted images are
// wrapped (the Cloudinary account's fetch allowlist covers those hosts); a store's
// own uploaded mockup or another vendor's image passes through untouched. f_jpg
// keeps the output decodable everywhere. Cloud name matches utils' CLOUDINARY_CLOUD.
const _CLD_GARMENT = 'https://res.cloudinary.com/dwlyljyuz/image/fetch/e_trim:10/c_pad,w_800,h_1000,b_white,f_jpg,q_auto/';
function normGarment(url) {
  if (!url || typeof url !== 'string') return url;
  let host; try { host = new URL(url).hostname; } catch (e) { return url; }
  if (!/(?:^|\.)cdn[pm]\.sanmar\.com$/i.test(host)) return url;
  return _CLD_GARMENT + encodeURIComponent(url);
}

// Stripe publishable key is fetched at runtime from the server so changing
// it in Netlify env vars takes effect without a rebuild.
let stripePromiseCache = null;
async function _getStripePromise() {
  if (stripePromiseCache) return stripePromiseCache;
  try {
    const r = await fetch('/.netlify/functions/stripe-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'config' }) });
    const d = await r.json().catch(() => ({}));
    if (d.publishableKey) stripePromiseCache = loadStripe(d.publishableKey);
  } catch {}
  return stripePromiseCache;
}
// Fire immediately so the key + Stripe.js are cached before the user reaches checkout.
if (typeof window !== 'undefined') _getStripePromise();

// ── Cart (localStorage, per store slug) ──────────────────────────────
const cartKey = (slug) => 'nsa_cart_' + slug;
const loadCart = (slug) => { try { return JSON.parse(localStorage.getItem(cartKey(slug)) || '[]'); } catch { return []; } };
const saveCart = (slug, items) => { try { localStorage.setItem(cartKey(slug), JSON.stringify(items)); } catch {} };

// ── Player roster link (per-store) ───────────────────────────────────
// A player arrives via /shop/<slug>?player=<token>. We stash the token so it
// survives in-store navigation (navTo builds clean paths without the query),
// then resolve it to the player's name/number for greeting + prefill.
const playerKey = (slug) => 'nsa_player_' + slug;
const loadPlayerToken = (slug) => { try { return localStorage.getItem(playerKey(slug)) || ''; } catch { return ''; } };
const savePlayerToken = (slug, tok) => { try { if (tok) localStorage.setItem(playerKey(slug), tok); else localStorage.removeItem(playerKey(slug)); } catch {} };
const lineUnit = (l) => (Number(l.unit_price) || 0) + (Number(l.fundraise) || 0) + (Number(l.name_extra) || 0) + (Number(l.size_extra) || 0);
const cartCount = (items) => items.reduce((a, l) => a + (l.qty || 1), 0);
const cartTotal = (items) => items.reduce((a, l) => a + lineUnit(l) * (l.qty || 1), 0);
const shipFee = (store) => store && store.delivery_mode === 'ship_home' ? (Number(store.flat_shipping) || 0) : 0;
// Processing fee: a percent of the item subtotal only — base price + size upcharge,
// excluding fundraising and name upcharge (mirrors the server's priceCart subtotal).
const procPct = (store) => Math.max(0, Number(store && store.processing_pct) || 0);
const cartProcBase = (items) => items.reduce((a, l) => a + ((Number(l.unit_price) || 0) + (Number(l.size_extra) || 0)) * (l.qty || 1), 0);
const procFeeAmt = (store, items) => Math.round(procPct(store) / 100 * cartProcBase(items) * 100) / 100;
const grandTotal = (store, items) => cartTotal(items) + shipFee(store) + procFeeAmt(store, items);

// Type system aligned with the NSA design system:
// Barlow Condensed for display (uppercase headlines/buttons/badges/prices),
// Source Sans 3 for body copy.
const DISPLAY = "'Barlow Condensed','Arial Narrow','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

// Fixed neutrals (not themed) — the warm "paper" system from the redesign.
const NEUTRAL = {
  cream: '#FAF6EF', // page background
  paper: '#FFFFFF', // cards, header
  warm:  '#F2ECE0', // product image tile
  line:  '#E7DFD0', // hairline borders
  ink:   '#16223F', // default team ink (top strip, footer) when store has none
  inkText: '#2A2F3E', // body copy
  subText: '#6B6256', // secondary copy, labels
};
// Stock badge + success colors (fixed).
const STOCK = { in: '#1E6B3A', low: '#9A7B2E' };

function StoreStyles() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        .sf-root *{box-sizing:border-box}
        .sf-root{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:${NEUTRAL.cream};color:${NEUTRAL.inkText}}
        .sf-root ::selection{background:var(--sf-primary,#8C1D40);color:#fff}
        html{scroll-behavior:smooth}
        .sf-btn{transition:transform .18s cubic-bezier(.4,0,.2,1), background .18s ease, box-shadow .18s ease}
        .sf-btn:hover{transform:translateY(-2px)}
        .sf-btn:active{transform:translateY(0)}
        .sf-skew{transform:skewX(-3deg)}
        .sf-skew:hover{transform:skewX(-3deg) translateY(-2px)}
        .sf-card{transition:transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s ease, border-color .2s ease}
        .sf-card .sf-img{transition:transform .35s ease}
        .sf-card:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(25,40,83,.10);border-color:var(--sf-primary,#8C1D40) !important}
        .sf-card:hover .sf-img{transform:scale(1.05)}
        .sf-navitem:hover{color:${NEUTRAL.ink} !important}
        .sf-search:focus{outline:none;border-color:var(--sf-primary,#8C1D40) !important}
        .sf-input:focus{outline:none;border-color:var(--sf-primary,#8C1D40) !important}
        .sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:20px}
        .sf-pdp-media{position:sticky;top:170px}
        .sf-search-toggle{display:none}
        @media (max-width:860px){
          .sf-hero-grid{grid-template-columns:1fr !important}
          .sf-hero-collage{display:none !important}
          .sf-2col{grid-template-columns:1fr !important}
          .sf-pdp-media{position:static !important;top:auto !important}
        }
        @media (max-width:600px){
          .sf-grid{grid-template-columns:1fr 1fr;gap:12px}
          .sf-topstrip-brand{display:none !important}
          .sf-topstrip-inner{justify-content:center !important}
          /* Collapse the store search to just a magnifying-glass icon inline with the
             category tabs; tapping it expands a full-width search field on its own row. */
          .sf-search-toggle{display:inline-flex;align-items:center}
          .sf-search-wrap{display:none !important}
          .sf-search-wrap.sf-search-open{display:flex !important;width:100%;min-width:0 !important;margin-left:0 !important}
        }
      `}</style>
    </>
  );
}

// Multiplicative darken used by the redesign tokens: each channel × (1 − amount).
function darken(hex, amount) {
  try {
    const h = (hex || '#000000').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(n, 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = Math.round(r * (1 - amount)); g = Math.round(g * (1 - amount)); b = Math.round(b * (1 - amount));
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  } catch { return hex; }
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
// Per-size upcharge — bigger sizes (2XL/3XL+) cost the vendor more, so the view
// publishes a size→extra-dollars map. 0 when the store has it off or the size is standard.
const sizeUp = (p, sz) => (sz ? Number((p.size_upcharges || {})[sz]) || 0 : 0);
// Group color variants of one garment (rows sharing variant_group_id) so the grid
// shows one card and the product page offers a color picker. Bundles never group.
const variantKey = (p) => p.variant_group_id || p.webstore_product_id;
function groupProducts(list) {
  const byKey = new Map(); const order = [];
  for (const p of (list || [])) {
    const k = p.kind === 'bundle' ? ('b:' + p.webstore_product_id) : variantKey(p);
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
    byKey.get(k).push(p);
  }
  // The first row (lowest sort_order — the list is ordered by sort_order) is the primary: it
  // supplies the card image and the default-selected color. Reordering colors in the builder
  // changes which color leads here.
  return order.map((k) => { const rows = byKey.get(k); return { key: k, rep: rows[0], rows }; });
}
// Effective stock counts on-hand warehouse + Adidas vendor (drop-ship) stock.
const effOnHand = (p) => sumSizes(p.size_stock) + (Number(p.vendor_on_hand) || 0);
const _rawSizeQty = (p, sz) => (Number((p.size_stock || {})[sz]) || 0) + (Number((p.vendor_size_stock || {})[sz]) || 0);
// A size is "available soon" when its vendor restock date is within ~2 weeks, so we
// surface sizes a shopper can actually get shortly (in stock now or arriving) and
// hide ones whose next delivery is months out.
const SIZE_SOON_MS = 14 * 24 * 60 * 60 * 1000;
const _rawSizeSoon = (p, sz) => { const d = (p.vendor_size_eta || {})[sz]; if (!d) return false; const t = Date.parse(d); return !isNaN(t) && t <= Date.now() + SIZE_SOON_MS; };
// A tall size fulfills its regular twin (a shopper picks "L"; we ship "LT" if that's the
// stock), so the store shows regular sizes only and a size counts its tall twin's stock/ETA.
const effSizeQty = (p, sz) => foldedQty(sz, (s) => _rawSizeQty(p, s));
const sizeSoon = (p, sz) => foldedSoon(sz, (s) => _rawSizeSoon(p, s));
const sizeSellable = (p, sz) => effSizeQty(p, sz) > 0 || sizeSoon(p, sz);
const isIncoming = (p) => (Number(p.on_order_qty) > 0) || !!p.earliest_eta || !!p.vendor_eta;
const etaOf = (p) => [p.earliest_eta, p.vendor_eta].filter(Boolean).sort()[0] || null;
// An item is inventory-tracked (the stock guard applies) only when it's stock-backed AND
// hasn't opted out. Custom / made-to-order products (no inventory_source, or 'manual') are
// never tracked — every offered size stays sellable. track_inventory=false opts a tracked
// item out, so it keeps selling all sizes regardless of stock.
const isTracked = (p) => p.track_inventory !== false && !!p.inventory_source && p.inventory_source !== 'manual';
// Tidy scraped vendor copy for display: drop empty "LABEL: N/A" spec fields
// (common in the Adidas feed) and squeeze the leftover separators/whitespace.
function cleanDesc(s) {
  if (!s) return '';
  return String(s)
    .replace(/\b[A-Z][A-Z0-9 /&+-]*:\s*N\/?A\b\.?/g, ' ')
    .replace(/\s*·\s*(?=·)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·.]+|[\s·]+$/g, '')
    .trim();
}

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
    // Three team inputs drive the palette; the rest derive by darkening.
    // We only persist primary_color + accent_color today, so ink defaults to the
    // design's navy. (If a store ever stores ink_color, it's honored.)
    const primary = store?.primary_color || '#8C1D40';
    const accent = store?.accent_color || '#B6985A';
    const ink = store?.ink_color || NEUTRAL.ink;
    const theme = store?.theme || 'classic';
    // Hero treatment. The flagship redesign is the lighter "Open" look (cream,
    // two-column with a product collage), so that's the default for every store.
    // "Bold" (full-bleed team gradient) is opt-in via an explicit hero_look flag —
    // we intentionally do NOT key it off the legacy `theme` field, which used to
    // mean corner-radius style and would mis-trigger Bold on many existing stores.
    const look = store?.hero_look === 'bold' ? 'bold' : 'open';
    return {
      primary,
      primaryDark: darken(primary, 0.16),
      deep: darken(primary, 0.34),
      accent,
      accentDeep: darken(accent, 0.24),
      ink,
      theme,
      look,
      // Angular, not pillowy: cards 6, buttons/badges/inputs 4, panels 8.
      radius: 6,
      ...NEUTRAL,
    };
  }, [store]);
}

// True once the page has scrolled past `px` — drives the collapsing sticky header
// so the tall three-bar top panel shrinks to a compact bar as the shopper scrolls.
function useScrolled(px = 56) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    // Hysteresis stops the header from jiggling. Collapsing removes ~60px from the
    // sticky region, and the browser's scroll-anchoring nudges scrollY by about that
    // much — with a single threshold that nudge flips `scrolled` straight back and the
    // two states fight forever. A collapse/expand gap wider than the shift absorbs it,
    // so the state settles instead of oscillating.
    const enter = Math.max(px, 72), exit = 8;
    let on = window.scrollY > enter;
    setScrolled(on);
    const onScroll = () => {
      const y = window.scrollY;
      if (!on && y > enter) { on = true; setScrolled(true); }
      else if (on && y <= exit) { on = false; setScrolled(false); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [px]);
  return scrolled;
}

// Team crest — uses the store logo when present, else a shield with initials
// (mirrors the redesign's placeholder OL crest).
function Crest({ store, theme, size = 40 }) {
  if (store && store.logo_url) {
    return <img src={store.logo_url} alt="" style={{ height: size, width: size, objectFit: 'contain', display: 'block' }} />;
  }
  const initials = (store?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>
      <path d="M20 2 L36 7 V20 C36 30 28 36 20 39 C12 36 4 30 4 20 V7 Z" fill={theme.primary} stroke={theme.accent} strokeWidth="1.6" />
      <text x="20" y="25" textAnchor="middle" fontFamily={DISPLAY} fontWeight="800" fontSize="15" fill="#fff" letterSpacing="0.5">{initials}</text>
    </svg>
  );
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

  // Roster player context, resolved from ?player=<token> (or a previously
  // stashed token for this store). null = shopping as a normal guest.
  const [playerCtx, setPlayerCtx] = useState(null);
  useEffect(() => {
    if (!route.slug) { setPlayerCtx(null); return; }
    const qsTok = (new URLSearchParams(window.location.search).get('player') || '').trim();
    if (qsTok) savePlayerToken(route.slug, qsTok);
    const tok = qsTok || loadPlayerToken(route.slug);
    if (!tok) { setPlayerCtx(null); return; }
    let cancelled = false;
    (async () => {
      const r = await checkoutCall({ action: 'roster_lookup', storeSlug: route.slug, token: tok });
      if (cancelled) return;
      if (r && r.player) setPlayerCtx({ token: tok, ...r.player });
      // Only forget the token when the server says it's genuinely invalid — a
      // transient network error shouldn't wipe a real player's link.
      else if (r && r.code === 'roster_not_found') { savePlayerToken(route.slug, ''); setPlayerCtx(null); }
      else setPlayerCtx(null);
    })();
    return () => { cancelled = true; };
  }, [route.slug]);
  const clearPlayer = useCallback(() => { savePlayerToken(route.slug, ''); setPlayerCtx(null); }, [route.slug]);

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [compInfo, setCompInfo] = useState({}); // product_id -> {name,image_front_url,available_sizes}
  const [compExtras, setCompExtras] = useState([]); // archived items kept alive only inside a package
  const [status, setStatus] = useState('loading');
  const [errMsg, setErrMsg] = useState('');
  // Browse filters driven by the persistent category sub-nav + search field.
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async (slug) => {
    setStatus('loading');
    const { data: stores, error } = await supabase.from('webstores_public').select('*').eq('slug', slug).limit(1);
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
      const { data } = await supabase.from('products').select('id,sku,name,image_front_url,available_sizes,color').in('id', compPids);
      (data || []).forEach((p) => { info[p.id] = p; });
    }
    setCompInfo(info);
    // A package can reference an item the store owner archived (active=false) so it no
    // longer shows as its own card but still lives inside the package. Those rows are
    // filtered out of the storefront view, so fetch them straight from webstore_products
    // and shape them like view rows — the package keeps its custom photo/name/logos, and
    // editing the archived item still flows through here.
    const activeWpIds = new Set(prods.map((p) => p.webstore_product_id));
    const missingWpIds = [...new Set(bItems.map((b) => b.webstore_product_id).filter((id) => id && !activeWpIds.has(id)))];
    if (missingWpIds.length) {
      const { data: arch } = await supabase.from('webstore_products').select('id,product_id,sku,display_name,image_url,image_back_url,decorations,retail_price,fundraise_amount').in('id', missingWpIds);
      const extras = (arch || []).map((wp) => {
        const base = info[wp.product_id] || {};
        return {
          webstore_product_id: wp.id, product_id: wp.product_id, kind: 'single', sku: wp.sku,
          name: wp.display_name || base.name || wp.sku,
          image_front_url: wp.image_url || base.image_front_url || null,
          image_back_url: wp.image_back_url || null,
          available_sizes: base.available_sizes || null,
          color: base.color || null,
          decorations: wp.decorations || null,
          retail_price: wp.retail_price, fundraise_amount: wp.fundraise_amount,
        };
      });
      setCompExtras(extras);
    } else {
      setCompExtras([]);
    }
    setStatus('ok');
  }, []);

  useEffect(() => { if (route.slug) load(route.slug); }, [route.slug, load]);
  const theme = useTheme(store);
  const scrolled = useScrolled(56);

  if (status === 'loading') return <Splash>Loading store…</Splash>;
  if (status === 'nomigration') return <Splash>This store isn’t available yet.</Splash>;
  if (status === 'notfound') return <Splash>We couldn’t find that store.</Splash>;
  if (status === 'error') return <Splash>Something went wrong.<div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>{errMsg}</div></Splash>;

  const isOpen = store.status === 'open';
  // Bifurcate by roster position: a positioned player (e.g. goalkeeper) sees only
  // items tagged for everyone ('all') or their position; guests and unassigned
  // players see the full catalog and self-select. Everything downstream — the
  // category nav, browse grid, hero, and direct product/package links — reads
  // from this filtered list so the store is consistently scoped to the player.
  const shownProducts = (playerCtx && playerCtx.position)
    ? products.filter((p) => { const a = (p.roster_audience || 'all'); return a === 'all' || a === playerCtx.position; })
    : products;
  // Category list for the sub-nav: ordered by the builder's sort order, "All Gear" first.
  const categories = (() => {
    const seen = new Map();
    for (const p of groupProducts(shownProducts)) {
      const c = (p.rep.store_category || '').trim();
      if (!c) continue;
      if (!seen.has(c)) seen.set(c, p.rep.sort_order || 0);
    }
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  })();
  // Category clicks always land on the browse grid (sub-nav is persistent chrome).
  const onCat = (c) => { setCat(c); if (route.view !== 'home') navTo('/shop/' + store.slug); else document.getElementById('shop-grid')?.scrollIntoView({ behavior: 'smooth' }); };
  return (
    <div className="sf-root" style={{ '--sf-accent': theme.accent, '--sf-primary': theme.primary, '--sf-ink': theme.ink, fontFamily: BODY, color: theme.inkText, minHeight: '100vh', background: theme.cream, display: 'flex', flexDirection: 'column' }}>
      <StoreStyles />
      <div style={{ position: 'sticky', top: 0, zIndex: 30 }}>
        <TopStrip store={store} theme={theme} collapsed={scrolled} />
        <Header store={store} theme={theme} cartCount={cartCount(cart)} collapsed={scrolled} />
        <CategoryNav theme={theme} categories={categories} cat={cat} onCat={onCat} query={query} setQuery={setQuery} onSearch={() => { setCat('all'); if (route.view !== 'home') navTo('/shop/' + store.slug); }} />
      </div>
      {!isOpen && <PreviewBanner status={store.status} />}
      {playerCtx && <PlayerBanner player={playerCtx} theme={theme} onClear={clearPlayer} />}
      <main style={{ flex: 1 }}>
        {route.view === 'home' && <Home store={store} theme={theme} products={shownProducts} bundleItems={bundleItems} compInfo={compInfo} compExtras={compExtras} cat={cat} query={query} />}
        {route.view === 'p' && (() => {
          const grp = groupProducts(shownProducts).find((g) => g.rows.some((r) => r.webstore_product_id === route.id));
          const rep = grp ? grp.rep : shownProducts.find((p) => p.webstore_product_id === route.id);
          return <Wrap><ProductPage store={store} theme={theme} product={rep} colorRows={grp ? grp.rows : (rep ? [rep] : [])} isOpen={isOpen} onAdd={addToCart} player={playerCtx} /></Wrap>;
        })()}
        {route.view === 'b' && <Wrap><BundlePage store={store} theme={theme} product={shownProducts.find((p) => p.webstore_product_id === route.id)} components={bundleItems.filter((b) => b.bundle_id === route.id)} compInfo={compInfo} products={[...products, ...compExtras]} isOpen={isOpen} onAdd={addToCart} player={playerCtx} /></Wrap>}
        {route.view === 'cart' && <Wrap><CartPage store={store} theme={theme} cart={cart} onUpdate={updateCart} /></Wrap>}
        {route.view === 'checkout' && <Wrap><CheckoutPage store={store} theme={theme} cart={cart} onUpdate={updateCart} onClear={() => updateCart([])} player={playerCtx} /></Wrap>}
        {route.view === 'order' && <Wrap><OrderStatusPage store={store} theme={theme} orderId={route.id} /></Wrap>}
      </main>
      <Footer store={store} theme={theme} />
    </div>
  );
}

const Wrap = ({ children }) => <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 24px 64px', boxSizing: 'border-box' }}>{children}</div>;

// ── Top strip ────────────────────────────────────────────────────────
function TopStrip({ store, theme, collapsed = false }) {
  const closes = closesLabel(store.close_at);
  const deliver = store.delivery_mode === 'ship_home' ? 'Ships to your door' : 'Ships to the team';
  // The essential line shoppers need: where it ships + when the store closes. On
  // mobile this is all that shows (the brand label is hidden via .sf-topstrip-brand);
  // on desktop the brand label sits on the left and this sits on the right.
  const status = closes ? `${deliver} · ${closes.text}` : deliver;
  return (
    <div style={{ background: theme.ink, color: 'rgba(255,255,255,0.82)', maxHeight: collapsed ? 0 : 44, overflow: 'hidden', transition: 'max-height .25s ease' }}>
      <div className="sf-topstrip-inner" style={{ maxWidth: 1240, margin: '0 auto', padding: '7px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontFamily: DISPLAY, fontSize: 12.5, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase' }}>
        <span className="sf-topstrip-brand" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: theme.accent }}>★</span> Official Team Store · National Sports Apparel
        </span>
        <span style={{ whiteSpace: 'nowrap', color: closes && closes.urgent ? theme.accent : 'rgba(255,255,255,0.82)' }}>{status}</span>
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────
function Header({ store, theme, cartCount = 0, collapsed = false }) {
  return (
    <header style={{ background: theme.paper, borderBottom: `1px solid ${theme.line}`, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: collapsed ? '8px 16px' : '14px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', transition: 'padding .2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minWidth: 0, flex: 1 }} onClick={() => navTo('/shop/' + store.slug)}>
          <Crest store={store} theme={theme} size={collapsed ? 30 : 40} />
          <div style={{ lineHeight: 1.05, minWidth: 0 }}>
            {!collapsed && <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: theme.accentDeep }}>Official Team Store</div>}
            <div style={{ fontFamily: DISPLAY, fontSize: collapsed ? 'clamp(15px,4vw,20px)' : 'clamp(17px,4.6vw,24px)', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: theme.primary }}>{store.name}</div>
          </div>
        </div>
        <button className="sf-btn sf-skew" onClick={() => navTo('/shop/' + store.slug + '/cart')} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 9, background: theme.primary, color: '#fff', border: 'none', borderRadius: 4, padding: '11px 18px', cursor: 'pointer', fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, transform: 'skewX(3deg)' }}>
            <CartIcon />Cart
            <span style={{ background: theme.accent, color: theme.ink, borderRadius: 999, minWidth: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, padding: '0 6px' }}>{cartCount}</span>
          </span>
        </button>
      </div>
    </header>
  );
}

// ── Category sub-nav (categories + search) ───────────────────────────
function CategoryNav({ theme, categories, cat, onCat, query, setQuery, onSearch }) {
  const tabs = [['all', 'All Gear'], ...categories.map((c) => [c, c])];
  // On mobile the field collapses to a magnifying-glass toggle that sits inline with the
  // tabs; tapping it reveals the full-width search input (and focuses it). Desktop always
  // shows the full field. A live query keeps it open so the input stays put while typing.
  const [searchOpen, setSearchOpen] = useState(false);
  const open = searchOpen || !!query;
  const inputRef = useRef(null);
  useEffect(() => { if (searchOpen && inputRef.current) inputRef.current.focus(); }, [searchOpen]);
  return (
    <nav style={{ background: theme.paper, borderBottom: `1px solid ${theme.line}` }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', minHeight: 52 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, flexWrap: 'wrap' }}>
          {tabs.map(([key, label]) => {
            const active = cat === key;
            return (
              <button key={key} className="sf-navitem" onClick={() => onCat(key)} style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '15px 10px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: 0.5, textTransform: 'uppercase', color: active ? theme.primary : theme.subText }}>
                {label}
                {active && <span aria-hidden style={{ position: 'absolute', left: 8, right: 8, bottom: 8, height: 4, background: theme.accent, transform: 'skewX(-12deg)' }} />}
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Search the store" className="sf-search-toggle" onClick={() => setSearchOpen((o) => !o)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: theme.subText }}>
          <SearchIcon color={theme.subText} />
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: theme.cream, border: `1px solid ${theme.line}`, borderRadius: 4, padding: '0 12px', height: 38, minWidth: 200 }} className={'sf-search-wrap' + (open ? ' sf-search-open' : '')}>
          <SearchIcon color={theme.subText} />
          <input ref={inputRef} className="sf-search" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) onSearch(); }} placeholder="Search the store" style={{ border: 'none', background: 'transparent', outline: 'none', fontFamily: BODY, fontSize: 14, color: theme.inkText, width: '100%' }} />
        </div>
      </div>
    </nav>
  );
}

function CartIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>;
}
function SearchIcon({ color = '#888' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
}

function PreviewBanner({ status }) {
  return <div style={{ background: '#fde68a', color: '#92400e', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: '8px 16px', letterSpacing: 0.3 }}>
    PREVIEW · This store is {(status || 'draft').toUpperCase()} and not open to shoppers yet.
  </div>;
}

// Shown when a player follows their personal roster link. Greets them by name,
// tells them personalization is prefilled, and offers an escape hatch if the
// wrong person is at the keyboard (a parent ordering for a different kid).
function PlayerBanner({ player, theme, onClear }) {
  const posLabel = player.position === 'gk' ? 'Goalkeeper' : player.position === 'field' ? 'Field player' : '';
  const label = [player.player_name, player.player_number ? '#' + player.player_number : ''].filter(Boolean).join(' ');
  return (
    <div style={{ background: theme.ink, color: '#fff', padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
      <span style={{ fontWeight: 700 }}>
        {player.ordered ? '✓ ' : '👟 '}
        You’re shopping for <span style={{ color: theme.accent }}>{label || 'your player'}</span>
        {posLabel ? <span style={{ opacity: 0.85, fontWeight: 600 }}> · {posLabel} kit</span> : null}
        {player.ordered ? ' — already ordered (you can order again).' : '. Name & number are filled in for you.'}
      </span>
      <button onClick={onClear} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Not you?
      </button>
    </div>
  );
}

// Diagonal hash texture for team-color heroes.
const HASH = 'repeating-linear-gradient(-55deg, transparent, transparent 26px, rgba(255,255,255,0.04) 26px, rgba(255,255,255,0.04) 52px)';
// Split a name into all-but-last + last word, so the last word can be italic-em.
function splitHeadline(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { head: '', tail: name || '' };
  return { head: parts.slice(0, -1).join(' '), tail: parts[parts.length - 1] };
}

// ── Home: hero + grid ────────────────────────────────────────────────
function Home({ store, theme, products, bundleItems = [], compInfo = {}, compExtras = [], cat = 'all', query = '' }) {
  const grouped = groupProducts(products);
  // wpById also resolves archived items kept alive only inside a package, so package
  // previews keep their custom photo/name even though those items aren't in the grid.
  const wpById = buildWpById([...products, ...compExtras]);
  const firstBundle = products.find((p) => p.kind === 'bundle');
  const goBundle = firstBundle ? () => navTo(`/shop/${store.slug}/b/${firstBundle.webstore_product_id}`) : null;
  const scrollGrid = () => document.getElementById('shop-grid')?.scrollIntoView({ behavior: 'smooth' });
  const lead = store.hero_blurb || `The official ${store.name} store — coach-approved, custom-decorated, and delivered to the team. Order before the window shuts.`;

  // Browse filter: active category + free-text search.
  const q = query.trim().toLowerCase();
  const visible = grouped.filter((g) => {
    const inCat = cat === 'all' || (g.rep.store_category || '').trim() === cat;
    const inQ = !q || [g.rep.name, g.rep.store_category, g.rep.category].filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
    return inCat && inQ;
  });
  const filtered = cat !== 'all' || !!q;

  return (
    <>
      {theme.look === 'bold'
        ? <HeroBold store={store} theme={theme} lead={lead} goBundle={goBundle} scrollGrid={scrollGrid} />
        : <HeroOpen store={store} theme={theme} lead={lead} goBundle={goBundle} scrollGrid={scrollGrid} products={products} compExtras={compExtras} />}

      <ValueStrip store={store} theme={theme} />

      {firstBundle && !filtered && <PackPromo store={store} theme={theme} bundle={firstBundle} bundleItems={bundleItems} onClick={goBundle} />}

      <div id="shop-grid" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 24px clamp(48px,6vw,72px)' }}>
        {products.length === 0
          ? <Splash>No products in this store yet.</Splash>
          : visible.length === 0
          ? <Splash>No gear matches that search.</Splash>
          : (() => {
              const cardOf = ({ rep, rows }) => {
                if (rep.kind === 'bundle' && rep.card_style === 'banner') return <BannerCard key={rep.webstore_product_id} store={store} theme={theme} p={rep} bundleItems={bundleItems} compInfo={compInfo} wpById={wpById} />;
                if (rep.kind === 'bundle' && rep.card_style === 'showcase') return <ShowcaseCard key={rep.webstore_product_id} store={store} theme={theme} p={rep} bundleItems={bundleItems} compInfo={compInfo} wpById={wpById} />;
                return <Card key={rep.webstore_product_id} store={store} theme={theme} p={rep} colorRows={rows} bundleItems={bundleItems} compInfo={compInfo} wpById={wpById} />;
              };
              // When filtered to one category (or searching), show a single grid; the
              // full "All Gear" view splits into the store's category sections.
              const byCat = new Map();
              for (const g of visible) { const c = (g.rep.store_category || '').trim(); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(g); }
              const sections = [...byCat.entries()].map(([c, gs]) => ({ cat: c, gs, minSort: Math.min(...gs.map((x) => x.rep.sort_order || 0)) }));
              sections.sort((a, b) => ((a.cat === '' ? 1 : 0) - (b.cat === '' ? 1 : 0)) || (a.minSort - b.minSort));
              const useCats = !filtered && (sections.length > 1 || (sections.length === 1 && sections[0].cat));
              if (!useCats) return <div className="sf-grid">{visible.map(cardOf)}</div>;
              return sections.map((sec) => (
                <div key={sec.cat || '__more'} style={{ marginBottom: 48 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, margin: '0 0 20px' }}>
                    <h2 style={{ position: 'relative', fontFamily: DISPLAY, fontSize: 'clamp(26px,3.4vw,34px)', textTransform: 'uppercase', letterSpacing: 0.3, color: theme.ink, margin: 0, fontWeight: 800, paddingBottom: 12 }}>
                      {sec.cat || 'More Gear'}
                      <span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0, width: 58, height: 4, background: theme.accent, transform: 'skewX(-12deg)' }} />
                    </h2>
                    <span style={{ fontFamily: DISPLAY, fontSize: 13, color: theme.subText, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{sec.gs.length} item{sec.gs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="sf-grid">{sec.gs.map(cardOf)}</div>
                </div>
              ));
            })()}
      </div>
    </>
  );
}

// Open hero — team-color gradient, two-column, curated product collage on the right.
function HeroOpen({ store, theme, lead, goBundle, scrollGrid, products = [], compExtras = [] }) {
  const { head, tail } = splitHeadline(store.name);
  const closes = closesLabel(store.close_at);
  const imgs = featuredHeroImgs(store, products, compExtras);
  const showCollage = imgs.length > 0;
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${theme.primary}, ${theme.deep})`, color: '#fff' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1240, margin: '0 auto', padding: 'clamp(32px,4vw,56px) 24px', display: 'grid', gridTemplateColumns: showCollage ? 'minmax(0,1.05fr) minmax(0,0.95fr)' : '1fr', gap: 'clamp(24px,4vw,48px)', alignItems: 'center' }} className="sf-hero-grid">
        <div>
          <span style={{ display: 'inline-block', background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 1.6, textTransform: 'uppercase', padding: '7px 16px', marginBottom: 18, transform: 'skewX(-6deg)' }}>
            <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>{closes && closes.urgent ? closes.text : 'Spirit Pack · Now Open'}</span>
          </span>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(40px,5.2vw,72px)', lineHeight: 0.95, textTransform: 'uppercase', margin: '0 0 18px', color: '#fff' }}>
            {head ? <>{head} <em style={{ fontStyle: 'italic', color: theme.accent }}>{tail}</em></> : tail}
          </h1>
          <p style={{ margin: '0 0 26px', maxWidth: 480, fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.86)' }}>{lead}</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {goBundle && <SkewBtn theme={theme} variant="accent" onClick={goBundle}>Build the Player Pack →</SkewBtn>}
            <SkewBtn theme={theme} variant="outlineLight" onClick={scrollGrid}>Shop the Collection</SkewBtn>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(20px,4vw,40px)', marginTop: 34, flexWrap: 'wrap' }}>
            {[['No', 'Minimums'], ['Top', 'Brands'], ['4–5wk', 'Team Delivery']].map(([n, l]) => (
              <div key={l}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, color: '#fff', lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: 0.4, marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        {showCollage && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }} className="sf-hero-collage">
            {imgs.map((p, i) => {
              // Layout adapts to how many real featured images exist so we never render
              // an empty placeholder tile: 1 → full-width hero · 2 → two tall columns ·
              // 3 → one tall left + two stacked right.
              const tall = i === 0;
              const full = imgs.length === 1;
              const spanRows = tall || (imgs.length === 2 && i === 1);
              return (
                <div key={i} style={{ gridColumn: full ? '1 / span 2' : tall ? '1' : '2', gridRow: spanRows ? '1 / span 2' : 'auto', aspectRatio: full ? '4 / 3' : spanRows ? '3 / 4' : '1', background: '#fff', borderRadius: 6, overflow: 'hidden', transform: `skewX(-3deg) rotate(${i === 1 ? -1.5 : i === 2 ? 1.5 : 0}deg)`, boxShadow: '0 16px 40px rgba(0,0,0,0.28)' }}>
                  <div style={{ width: '100%', height: '100%', transform: 'skewX(3deg)', position: 'relative' }}>
                    <div style={{ position: 'absolute', inset: '8%' }}>
                      <img src={p.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <DecoOverlay decorations={p.decorations} colorName={p.color} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// Hero collage images: an admin-curated list of webstore_product_ids when set,
// else mandatory (package) items first, then any items, up to 3.
//   null/undefined → auto (mandatory first, then top items) · [] → none · [ids] → those (≤3).
function featuredHeroImgs(store, products, compExtras = []) {
  const pool = [...(products || []), ...(compExtras || [])].filter((p) => p.kind !== 'bundle' && p.image_front_url);
  const featured = store && Array.isArray(store.featured_product_ids) ? store.featured_product_ids : null;
  if (!featured) {
    const mandatory = pool.filter((p) => p.required);
    const rest = pool.filter((p) => !p.required);
    return [...mandatory, ...rest].slice(0, 3);
  }
  return featured.map((id) => pool.find((p) => p.webstore_product_id === id)).filter(Boolean).slice(0, 3);
}

// Bold hero — full-bleed team gradient, hash + diagonal wedge.
function HeroBold({ store, theme, lead, goBundle, scrollGrid }) {
  const { head, tail } = splitHeadline(store.name);
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${theme.primary}, ${theme.deep})`, color: '#fff' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.16)', clipPath: 'polygon(28% 0,100% 0,100% 100%,0 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1240, margin: '0 auto', padding: 'clamp(40px,5vw,72px) 24px' }}>
        <span style={{ display: 'inline-block', background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 1.6, textTransform: 'uppercase', padding: '7px 16px', marginBottom: 18, transform: 'skewX(-6deg)' }}>
          <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Official Team Store</span>
        </span>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(44px,6vw,84px)', lineHeight: 0.92, textTransform: 'uppercase', margin: '0 0 18px', maxWidth: 900 }}>
          {head ? <>{head} <em style={{ fontStyle: 'italic', color: theme.accent }}>{tail}</em></> : tail}
        </h1>
        <p style={{ margin: '0 0 28px', maxWidth: 520, fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.86)' }}>{lead}</p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {goBundle && <SkewBtn theme={theme} variant="accent" onClick={goBundle}>Build the Player Pack →</SkewBtn>}
          <SkewBtn theme={theme} variant="outlineLight" onClick={scrollGrid}>Shop the Collection</SkewBtn>
        </div>
      </div>
    </section>
  );
}

// Skewed CTA — NSA signature −3° skew with an upright inner span.
function SkewBtn({ theme, variant = 'primary', onClick, children }) {
  const map = {
    primary: { background: theme.primary, color: '#fff', border: 'none' },
    accent: { background: theme.accent, color: theme.ink, border: 'none' },
    outline: { background: 'transparent', color: theme.primary, border: `2px solid ${theme.primary}` },
    outlineLight: { background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.7)' },
  };
  const s = map[variant] || map.primary;
  return (
    <button className="sf-btn sf-skew" onClick={onClick} style={{ ...s, fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: 1.2, textTransform: 'uppercase', padding: '14px 28px', cursor: 'pointer', borderRadius: 4 }}>
      <span style={{ display: 'inline-block', transform: 'skewX(3deg)', whiteSpace: 'nowrap' }}>{children}</span>
    </button>
  );
}

// Section break between the hero and the product/pack content — a clean bordered
// band with a small skewed accent mark (kept as a deliberate divider; the old
// four-icon proof-point row was removed at the store owner's request).
function ValueStrip({ theme }) {
  return (
    <div style={{ background: theme.paper, borderTop: `1px solid ${theme.line}`, borderBottom: `1px solid ${theme.line}` }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '16px 24px', display: 'flex', justifyContent: 'center' }}>
        <span aria-hidden style={{ width: 64, height: 4, background: theme.accent, transform: 'skewX(-12deg)' }} />
      </div>
    </div>
  );
}

// Player Pack promo — wide clickable gradient card.
function PackPromo({ store, theme, bundle, bundleItems = [], onClick }) {
  const comps = bundleItems.filter((b) => b.bundle_id === bundle.webstore_product_id);
  const n = comps.length || 0;
  const price = priceOf(bundle);
  // Retail = sum of component list prices when we can compute it (for the strike-through).
  const retail = comps.reduce((a, c) => a + (Number(c.qty || 1) * 0), 0); // components carry no price in this view
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '8px 24px clamp(8px,2vw,16px)' }}>
      <div onClick={onClick} className="sf-btn" style={{ position: 'relative', cursor: 'pointer', overflow: 'hidden', borderRadius: 8, background: `linear-gradient(120deg, ${theme.primary}, ${theme.deep})`, padding: 'clamp(24px,3vw,34px) clamp(24px,3vw,38px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', boxShadow: '0 14px 36px rgba(0,0,0,0.16)' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: theme.accent, marginBottom: 8 }}>Required for every player</div>
          <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(24px,3vw,32px)', textTransform: 'uppercase', color: '#fff', margin: '0 0 6px', lineHeight: 1 }}>{bundle.name || 'The Player Pack'}{n ? ` — ${n} Pieces, One Checkout` : ''}</h3>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.82)', maxWidth: 520 }}>Pick a size for each item — the whole kit checks out as one package.</div>
        </div>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 20 }}>
          {retail > price && <span style={{ fontFamily: DISPLAY, fontSize: 20, color: 'rgba(255,255,255,0.6)', textDecoration: 'line-through' }}>{money(retail)}</span>}
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, color: '#fff', lineHeight: 1 }}>{money(price)}</span>
          <span style={{ background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', padding: '9px 16px', transform: 'skewX(-6deg)' }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Build It →</span></span>
        </div>
      </div>
    </div>
  );
}

// Lucide-style line icons (24×24, 2px stroke).
function LineIcon({ name, color = '#888', size = 22 }) {
  const paths = {
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12l8.73-5.04M12 22.08V12',
    heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.55z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name] || paths.star} /></svg>;
}

// Garment silhouette tile (warm bg + crest watermark + Lucide-ish garment).
function GarmentTile({ theme, store, kind = 'top', badge, catLabel }) {
  const paths = {
    top: 'M30 14 L42 9 L54 14 L60 26 L52 32 L48 28 L48 56 L22 56 L22 28 L18 32 L10 26 Z',
    bottom: 'M26 12 H54 L52 56 H42 L40 30 L38 56 H28 Z',
    cap: 'M16 40 C16 26 28 20 40 20 C54 20 62 28 62 40 L60 44 H18 Z',
  };
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: theme.warm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, opacity: 0.9 }}><Crest store={store} theme={theme} size={26} /></div>
      <svg viewBox="0 0 72 72" width="58%" height="58%" fill="none" stroke={theme.primary} strokeOpacity="0.17" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
        <path d={paths[kind] || paths.top} />
      </svg>
      {badge}
      {catLabel}
    </div>
  );
}

function stockBadge(p, theme) {
  const ink = theme ? theme.ink : NEUTRAL.ink;
  if (p.kind === 'bundle') return { text: 'Package', color: '#fff', bg: ink };
  if (!isTracked(p)) return { text: 'In stock', color: '#fff', bg: STOCK.in }; // made-to-order / not tracked
  if (effOnHand(p) > 0) return { text: 'In stock', color: '#fff', bg: STOCK.in };
  if (isIncoming(p)) { return { text: 'Low stock', color: '#fff', bg: STOCK.low }; }
  return { text: 'Sold out', color: '#fff', bg: theme ? theme.primary : '#8C1D40' };
}

function bundleBadge(count, theme) {
  return { text: count > 1 ? `${count}-Piece Pack` : 'Package', color: '#fff', bg: theme ? theme.ink : NEUTRAL.ink };
}

// Montage of a package's component photos so the grid card previews the actual
// gear (jersey / shorts / hood …) instead of a generic placeholder. Layout
// adapts to the piece count: 2 side-by-side, 3 as one hero + two stacked, 4 in
// a 2×2. Thin white gaps separate the tiles into a clean "kit" composition.
// Per-color web-logo override (mirrors the store builder): a deco's cw_by_color maps a
// lowercased garment color -> the web logo to show for that color (e.g. a white logo on a
// black tee); falls back to the placed art_url.
const decoUrlForColor = (d, colorName) => {
  const k = String(colorName || '').trim().toLowerCase();
  const v = d && d.cw_by_color && k && d.cw_by_color[k]; // bare url (legacy) or { url, color_way_id }
  return (typeof v === 'string' ? v : (v && v.url) || '') || (d && d.art_url) || '';
};
// Applied logo art (from webstore_products.decorations) composited on the
// garment image at its placement — the on-screen mock shoppers see. colorName picks the
// per-color web logo so the right color way shows for the active variant.
function DecoOverlay({ decorations, side = 'front', colorName }) {
  if (!Array.isArray(decorations)) return null;
  // Skip `baked` decorations — their logo is already rendered into the garment image (a
  // Quick Mock), so overlaying it again would double-stamp. They're retained on the record
  // only so the store→SO conversion still knows what art to print.
  return <>{decorations.filter((d) => d && !d.baked && (d.side || 'front') === side && decoUrlForColor(d, colorName)).map((d, i) => {
    const pl = placementById(d.placement);
    // A decoration may carry its own x/y/w (editable placement) overriding the preset.
    const x = d.x != null ? d.x : pl.x, y = d.y != null ? d.y : pl.y, w = d.w != null ? d.w : pl.w;
    return <img key={i} src={decoUrlForColor(d, colorName)} alt="" loading="lazy" style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${w}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))', zIndex: 1 }} />;
  })}</>;
}

// Sample number/name on the garment mockup so shoppers see an item is personalized.
// Default back placement; the real value is entered at checkout. Mirrors the builder.
const PERSO_DEFAULTS = { name: { x: 50, y: 22, w: 64 }, number: { x: 50, y: 51, w: 34 } };
function PersoMock({ takesNumber, takesName, decorations = [], sampleName = 'PLAYER', sampleNumber = '00' }) {
  if (!takesNumber && !takesName) return null;
  // Honor the rep's placed/resized perso token when present; else the default.
  const place = (kind, def) => { const d = (decorations || []).find((x) => x && x.kind === kind); return d ? { x: d.x != null ? d.x : def.x, y: d.y != null ? d.y : def.y, w: d.w != null ? d.w : def.w } : def; };
  const tok = (p, vb, ty, fs, body) => (
    <div style={{ position: 'absolute', left: p.x + '%', top: p.y + '%', width: p.w + '%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 1 }}>
      <svg viewBox={'0 0 100 ' + vb} style={{ display: 'block', width: '100%', overflow: 'visible' }}>
        <text x="50" y={ty} textAnchor="middle" fontFamily="'Barlow Condensed',Oswald,Impact,sans-serif" fontWeight="800" fontSize={fs} fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="1.3" paintOrder="stroke" letterSpacing="1">{body}</text>
      </svg>
    </div>
  );
  return <>
    {takesName && tok(place('perso_name', PERSO_DEFAULTS.name), 26, 20, 20, String(sampleName).toUpperCase())}
    {takesNumber && tok(place('perso_number', PERSO_DEFAULTS.number), 64, 52, 58, sampleNumber)}
  </>;
}

function BundleCollage({ comps, theme }) {
  // Each tile shows the component WITH its inherited decoration (the kit garments are
  // decorated in production — the preview must say so, not show blank garments).
  const tiles = comps.filter((c) => c.img).slice(0, 4);
  if (!tiles.length) return <Placeholder theme={theme} label="Package" />;
  const n = tiles.length;
  const Tile = ({ c, style }) => (
    <div style={{ position: 'relative', overflow: 'hidden', background: '#EEF1F6', ...style }}>
      <img className="sf-img" src={normGarment(c.img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <DecoOverlay decorations={c.decorations} colorName={c.color} />
    </div>
  );
  const grid = (cols, rows, children) => (
    <div style={{ width: '100%', height: '100%', display: 'grid', gridTemplateColumns: cols, gridTemplateRows: rows, gap: 3, background: '#fff' }}>{children}</div>
  );
  if (n === 1) return grid('1fr', '1fr', [<Tile key={0} c={tiles[0]} />]);
  if (n === 2) return grid('1fr 1fr', '1fr', tiles.map((c, i) => <Tile key={i} c={c} />));
  if (n === 3) return grid('1.5fr 1fr', '1fr 1fr', [
    <Tile key={0} c={tiles[0]} style={{ gridRow: '1 / span 2' }} />,
    <Tile key={1} c={tiles[1]} />,
    <Tile key={2} c={tiles[2]} />,
  ]);
  return grid('1fr 1fr', '1fr 1fr', tiles.map((c, i) => <Tile key={i} c={c} />));
}

// Map a category name to a garment silhouette kind for the placeholder tile.
function garmentKind(p) {
  const s = `${p.store_category || ''} ${p.category || ''} ${p.name || ''}`.toLowerCase();
  if (/(pant|jogger|short|bottom|legging)/.test(s)) return 'bottom';
  if (/(hat|cap|beanie|headwear|visor)/.test(s)) return 'cap';
  return 'top';
}
// Small color swatch dots for a card (color variants).
function ColorDots({ rows, theme, max = 4 }) {
  if (!rows || rows.length < 2) return null;
  const shown = rows.slice(0, max);
  const extra = rows.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
      {shown.map((c) => (
        <span key={c.webstore_product_id} title={c.color || ''} style={{ width: 15, height: 15, borderRadius: '50%', background: swatchColor(c.color), border: `1px solid ${theme.line}`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4)' }} />
      ))}
      {extra > 0 && <span style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: theme.subText }}>+{extra}</span>}
    </div>
  );
}

// Resolve a package component's display meta. When the component is linked to a
// specific in-store item (webstore_product_id), use that item's custom photo,
// name, color and sizes; otherwise fall back to the base catalog product.
function compMeta(c, wpById, compInfo) {
  const wp = c && c.webstore_product_id && wpById ? wpById[c.webstore_product_id] : null;
  if (wp) return { name: wp.name, image: wp.image_front_url, sizes: wp.available_sizes, color: wp.color, decorations: wp.decorations };
  // Not linked to an in-store item — if the store carries a single of the SAME base
  // product, inherit its photo/decorations so the component still shows its decorated look.
  const twin = c && c.product_id && wpById ? Object.values(wpById).find((w) => w && w.product_id === c.product_id && w.kind !== 'bundle') : null;
  if (twin) return { name: twin.name, image: twin.image_front_url, sizes: twin.available_sizes, color: twin.color, decorations: twin.decorations };
  const base = (compInfo || {})[c.product_id] || {};
  return { name: base.name || c.sku, image: base.image_front_url, sizes: base.available_sizes, color: null, decorations: null };
}
const buildWpById = (products) => { const m = {}; (products || []).forEach((p) => { m[p.webstore_product_id] = p; }); return m; };

function Card({ store, theme, p, colorRows = [], bundleItems = [], compInfo = {}, wpById = null }) {
  const isBundle = p.kind === 'bundle';
  // For a package, preview the actual pieces instead of one image.
  const comps = isBundle
    ? bundleItems.filter((b) => b.bundle_id === p.webstore_product_id)
        .map((c) => { const m = compMeta(c, wpById, compInfo); return { img: m.image, name: m.name, decorations: m.decorations, color: m.color }; })
    : [];
  const hasCollage = isBundle && comps.some((c) => c.img);
  const b = isBundle ? bundleBadge(comps.length, theme) : stockBadge(p, theme);
  const catLabel = (p.store_category || p.category || '').trim();
  const go = () => navTo(`/shop/${store.slug}/${isBundle ? 'b' : 'p'}/${p.webstore_product_id}`);
  return (
    <div className="sf-card" onClick={go} style={{ cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 6, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 5', background: '#fff', overflow: 'hidden' }}>
        {hasCollage
          ? <BundleCollage comps={comps} theme={theme} />
          : p.image_front_url
            ? <div style={{ position: 'absolute', inset: '10%', width: '80%', height: '80%' }}>
                <img className="sf-img" src={normGarment(p.image_front_url)} alt={p.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {!isBundle && <DecoOverlay decorations={p.decorations} colorName={p.color} />}
              </div>
            : <GarmentTile theme={theme} store={store} kind={garmentKind(p)} />}
        {/* Stock / package badge — skewed −6°, top-right */}
        <span style={{ position: 'absolute', top: 12, right: 12, fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', padding: '4px 10px', background: b.bg, color: b.color, transform: 'skewX(-6deg)', borderRadius: 2, zIndex: 2 }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>{b.text}</span></span>
        {/* Category label — bottom-right */}
        {catLabel && <span style={{ position: 'absolute', bottom: 10, right: 12, fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.subText, zIndex: 2 }}>{catLabel}</span>}
      </div>
      <div style={{ padding: '14px 15px 16px' }}>
        <div style={{ fontFamily: DISPLAY, textTransform: 'uppercase', fontWeight: 700, fontSize: 18, letterSpacing: 0.3, lineHeight: 1.12, color: theme.ink, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
        {!isBundle && <ColorDots rows={colorRows} theme={theme} />}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, letterSpacing: 0.3, fontWeight: 800, color: theme.primary }}>{money(priceOf(p))}</span>
          <span style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: theme.accentDeep }}>View →</span>
        </div>
      </div>
    </div>
  );
}

// ── Package card: Banner style ─────────────────────────────────────────────
// Full-width dark banner; text + price left, 2×2 item collage right.
function BannerCard({ store, theme, p, bundleItems = [], compInfo = {}, wpById = null }) {
  const comps = bundleItems.filter((b) => b.bundle_id === p.webstore_product_id)
    .map((c) => { const m = compMeta(c, wpById, compInfo); return { img: m.image, name: m.name }; });
  const imgs = comps.map((c) => c.img).filter(Boolean).slice(0, 4);
  // Pad to 4 tiles by repeating so the 2×2 grid is always filled.
  const tiles = imgs.length ? Array.from({ length: 4 }, (_, i) => imgs[i % imgs.length]) : [];
  const go = () => navTo(`/shop/${store.slug}/b/${p.webstore_product_id}`);
  return (
    <div className="sf-card" onClick={go} style={{ gridColumn: '1 / -1', cursor: 'pointer', position: 'relative', overflow: 'hidden', borderRadius: 8, background: `linear-gradient(120deg, ${theme.primary}, ${theme.deep})`, display: 'flex', alignItems: 'stretch', minHeight: 190, boxShadow: '0 14px 36px rgba(0,0,0,0.16)' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
      <div style={{ flex: 1, padding: 'clamp(22px,3vw,32px) clamp(24px,3vw,38px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: theme.accent, marginBottom: 8 }}>★ Required for every player</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 'clamp(22px,2.6vw,30px)', textTransform: 'uppercase', color: '#fff', lineHeight: 1.05, marginBottom: 6 }}>{p.name}{comps.length ? ` — ${comps.length} Pieces, One Checkout` : ''}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>Pick a size for each item — the whole kit checks out together.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 22px 16px 0', gap: 16, position: 'relative', zIndex: 1, flexShrink: 0 }}>
        {tiles.length > 0 && (
          <div style={{ width: 130, height: 130, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 3, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
            {tiles.map((src, i) => (
              <div key={i} style={{ overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
                <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', padding: 4 }} />
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 38, color: '#fff', lineHeight: 1 }}>{money(priceOf(p))}</span>
          <span style={{ background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', padding: '9px 16px', transform: 'skewX(-6deg)', borderRadius: 2 }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Build It →</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Package card: Showcase style ───────────────────────────────────────────
// Full-width card: dark header (name + price + CTA) above a row showing each
// component item with its image and name. Shoppers see exactly what's in the kit.
function ShowcaseCard({ store, theme, p, bundleItems = [], compInfo = {}, wpById = null }) {
  const comps = bundleItems.filter((b) => b.bundle_id === p.webstore_product_id)
    .map((c) => { const m = compMeta(c, wpById, compInfo); return { img: m.image, name: m.name, decorations: m.decorations, color: m.color }; });
  const go = () => navTo(`/shop/${store.slug}/b/${p.webstore_product_id}`);
  return (
    <div className="sf-card" onClick={go} style={{ gridColumn: '1 / -1', cursor: 'pointer', background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
      {/* Dark header */}
      <div style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(120deg, ${theme.primary}, ${theme.deep})`, padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: theme.accent, marginBottom: 4 }}>★ Required for every player{comps.length ? ` — ${comps.length}-Piece Kit` : ''}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 'clamp(20px,2.4vw,26px)', textTransform: 'uppercase', color: '#fff' }}>{p.name}</div>
        </div>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 32, color: '#fff' }}>{money(priceOf(p))}</span>
          <span style={{ background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', padding: '8px 16px', transform: 'skewX(-6deg)', borderRadius: 2 }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Build It →</span></span>
        </div>
      </div>
      {/* Item row */}
      <div style={{ display: 'flex', overflowX: 'auto' }}>
        {comps.map((c, i) => (
          <div key={i} style={{ flex: '1 1 0', minWidth: 120, padding: '14px 12px 16px', borderRight: i < comps.length - 1 ? `1px solid ${theme.line}` : 'none', textAlign: 'center' }}>
            <div style={{ width: '100%', aspectRatio: '1 / 1', background: theme.warm, borderRadius: 4, overflow: 'hidden', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Inner 4:5 frame = the frame placements are authored against. object-fit
                  cover fills the frame exactly like the art editor's garment stage, so the
                  inherited decoration overlay lands where it was placed. */}
              {c.img ? <div style={{ position: 'relative', height: '92%', aspectRatio: '4 / 5', borderRadius: 3, overflow: 'hidden' }}><img src={normGarment(c.img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /><DecoOverlay decorations={c.decorations} colorName={c.color} /></div> : <GarmentTile theme={theme} store={store} kind="top" />}
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: theme.ink, lineHeight: 1.2 }}>{c.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Placeholder used by detail/cart image boxes — warm tile + crest + silhouette.
function Placeholder({ theme, label, kind = 'top', store }) {
  return <GarmentTile theme={theme} store={store || { name: label }} kind={kind} />;
}

// Rough color-name → swatch hex for the small color dots.
function swatchColor(name) {
  const n = String(name || '').trim().toLowerCase();
  const table = { black: '#1A1A1A', white: '#F2F2F2', navy: '#16223F', royal: '#1D4E89', red: '#B11226', maroon: '#7A1F2B', gold: '#B6985A', yellow: '#E5C100', green: '#1E6B3A', forest: '#243B2E', kelly: '#2E8B57', purple: '#5B2A86', orange: '#E2711D', pink: '#E36FA0', gray: '#9AA0A6', grey: '#9AA0A6', silver: '#C9CDD2', charcoal: '#36393E', brown: '#5A3A22', teal: '#1E7C82', columbia: '#9BCBEB', carolina: '#9BCBEB' };
  for (const k of Object.keys(table)) { if (n.includes(k)) return table[k]; }
  return '#B9B2A5';
}

// ── Single product ───────────────────────────────────────────────────
function ProductPage({ store, theme, product: rep, colorRows = [], isOpen, onAdd, player = null }) {
  const [colorId, setColorId] = useState(rep ? rep.webstore_product_id : null);
  const [size, setSize] = useState(null);
  const [img, setImg] = useState('front');
  const [num, setNum] = useState('');
  const [pname, setPname] = useState('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  // Reset the picked color / size when navigating to a different product.
  useEffect(() => { setColorId(rep ? rep.webstore_product_id : null); setSize(null); setImg('front'); }, [rep ? rep.webstore_product_id : null]);
  // Prefill personalization from the player's roster link — jersey number is the
  // high-value bit; name is prefilled too but stays editable.
  useEffect(() => {
    if (!player || !rep) return;
    if (rep.takes_number && player.player_number) setNum(String(player.player_number).replace(/[^0-9]/g, '').slice(0, 3));
    if (rep.takes_name && player.player_name) setPname(String(player.player_name).slice(0, 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, rep ? rep.webstore_product_id : null]);
  if (!rep) return <Splash>Product not found.</Splash>;
  // The active color variant drives the image, sizes, stock, price and cart line —
  // each color is its own row, so everything downstream stays per-SKU and correct.
  const p = (colorRows.length ? colorRows.find((r) => r.webstore_product_id === colorId) : null) || rep;
  // Fit/gender variants (Adult / Women's / Youth) carry a variant_label and share
  // one image. Unlike colors, they get no picker — each fit renders as its own
  // labeled size row, and a size click resolves to that fit's own SKU.
  const isFitGroup = colorRows.length > 1 && colorRows.some((r) => r.variant_label);
  // Sellable sizes for one variant row. Honors the store's per-product size
  // selection (sizes_offered; null = all). Talls fold into their regular twin
  // (LT → L), so we compare on the folded label — a legacy sizes_offered that
  // still lists "LT" keeps matching the offered "L". Only surfaces sizes a shopper
  // can actually get (in stock now, warehouse or vendor, OR restocking within
  // ~2 weeks); if nothing qualifies yet but the item is on the way, fall back to
  // the full scale so backorderable items stay orderable.
  // Map an offered label to the catalog's size code before matching. OMG imports store the
  // report's verbose labels ("Men's Small", "Men's 3X-Large"), which never equal the product's
  // "S"/"3XL" scale — so every offered size filtered out and an in-stock item read "Sold out"
  // while the badge (which sums raw stock) still said "In stock". normSzName strips the
  // gender/age qualifier and normalizes the size; regularSize folds a tall to its regular twin.
  const _offeredKey = (o) => String(regularSize(normSzName(o))).toUpperCase();
  const sizesFor = (c) => {
    const offered = Array.isArray(c.sizes_offered) && c.sizes_offered.length ? c.sizes_offered.map(_offeredKey) : null;
    const scale = foldScale(c.available_sizes).filter((s) => !offered || offered.includes(String(s).toUpperCase()));
    if (!isTracked(c)) {
      // Sizes the rep explicitly offered that aren't part of the catalog product's own
      // scale (an apparel item switched to footwear sizing, or 3XL/4XL added). For a
      // made-to-order item these always sell — checkout's stock guard skips them too.
      const prodScale = foldScale(c.available_sizes).map((s) => String(s).toUpperCase());
      const extras = (Array.isArray(c.sizes_offered) ? c.sizes_offered : []).filter((o) => !prodScale.includes(_offeredKey(o)));
      return [...scale, ...extras]; // not inventory-tracked → every offered size sells
    }
    const avail = scale.filter((s) => sizeSellable(c, s));
    return avail.length ? avail : (isIncoming(c) ? scale : avail);
  };
  const sizesArr = sizesFor(p);
  // One reusable set of size buttons for a variant row. A click selects both the
  // variant (its SKU) and the size, so a fit row resolves to the right SKU.
  const renderSizeButtons = (c, cSizes) => cSizes.map((sz) => {
    const q = effSizeQty(c, sz); const soon = sizeSoon(c, sz); const etaD = (c.vendor_size_eta || {})[sz] || Object.entries(c.vendor_size_eta || {}).filter(([k]) => String(regularSize(k)).toUpperCase() === String(sz).toUpperCase()).map(([, v]) => v).filter(Boolean).sort()[0]; const selB = colorId === c.webstore_product_id && size === sz; const out = isTracked(c) ? (q <= 0 && !soon && !isIncoming(c)) : false; const up = sizeUp(c, sz);
    return <button key={sz} disabled={out} onClick={() => { setColorId(c.webstore_product_id); setSize(sz); }} title={[q > 0 ? `${q} available` : soon ? `Arriving ~${etaD}` : isIncoming(c) ? 'Backorder' : 'Out of stock', up > 0 ? `+${money(up)} for ${sz}` : ''].filter(Boolean).join(' · ')}
      style={{ ...sizeBtn(theme, selB), opacity: out ? 0.35 : 1, cursor: out ? 'not-allowed' : 'pointer', textDecoration: out ? 'line-through' : 'none' }}>{sz}{up > 0 ? <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4, fontWeight: 700 }}>+${up}</span> : null}</button>;
  });
  const nameUp = Number(p.name_upcharge) || 0;
  const upNow = sizeUp(p, size);
  const total = priceOf(p) + upNow + (p.takes_name && pname.trim() ? nameUp : 0);
  const needSize = isFitGroup ? true : sizesArr.length > 0;
  // A product that inherently has sizes (a real size scale, or a rep-added
  // sizes_offered list) but yields ZERO sellable sizes is sold out in every size and
  // not restocking. Its size list is empty, so needSize is false — without this guard
  // the button would enable and add it with size=null (unfulfillable). Block it; the
  // server rejects the same case (checkSizesRequired) as defense in depth.
  const inherentlySized = !isFitGroup && (foldScale(p.available_sizes).length > 0 || (Array.isArray(p.sizes_offered) && p.sizes_offered.length > 0));
  const soldOutNoSize = inherentlySized && sizesArr.length === 0;
  const needNumber = !!p.takes_number;
  const isPersonalized = needNumber || !!p.takes_name;
  const canAdd = isOpen && !soldOutNoSize && (!needSize || size) && (!needNumber || num.trim());
  const addToCart = () => {
    onAdd({
      kind: 'single', webstore_product_id: p.webstore_product_id, product_id: p.product_id, sku: p.sku,
      name: p.name, color: p.color || null, variant_label: p.variant_label || null, image: ((isFitGroup ? rep : p).image_front_url) || null, size: size || null,
      unit_price: Number(p.retail_price) || 0, fundraise: Number(p.fundraise_amount) || 0,
      size_extra: upNow,
      name_extra: p.takes_name && pname.trim() ? nameUp : 0,
      player_number: needNumber ? num.trim() : null,
      player_name: p.takes_name && pname.trim() ? pname.trim() : null,
      qty: isPersonalized ? 1 : qty,
    });
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  };
  const sizes = sizesArr;
  const onHand = effOnHand(p);
  const incoming = isIncoming(p);
  // Only surface the back when it actually carries artwork (per the store builder's
  // "show back only if it's got artwork" rule). The back image falls back to the front
  // so the back logos always have a garment to sit on.
  const descText = cleanDesc(p.description);
  const hasBackDeco = Array.isArray(p.decorations) && p.decorations.some((d) => d && d.art_url && d.side === 'back');
  // Number/name personalization previews on the back, so make the back viewable for it too.
  const isPerso = !!(p.takes_number || p.takes_name);
  // Fits share one image — keep the representative row's image no matter which
  // fit's size is selected (each fit is a different product with its own photo).
  const imgRow = isFitGroup ? rep : p;
  const imgUrl = img === 'back' ? (imgRow.image_back_url || imgRow.image_front_url) : imgRow.image_front_url;
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  const label = { fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, color: theme.ink, marginBottom: 10 };
  const proof = ['Custom team decoration included', 'adidas & Under Armour quality', 'Ships to the team when the store closes'];
  return (
    <div style={{ paddingTop: 24 }}>
      <BackLink store={store} theme={theme} />
      <div className="sf-2col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,0.95fr)', gap: 44, alignItems: 'start' }}>
        <div className="sf-pdp-media">
          <div style={{ position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto', aspectRatio: '4 / 5', background: theme.warm, borderRadius: 8, border: `1px solid ${theme.line}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {imgUrl ? <img src={normGarment(imgUrl)} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GarmentTile theme={theme} store={store} kind={garmentKind(p)} />}
            <DecoOverlay decorations={p.decorations} side={img === 'back' ? 'back' : 'front'} colorName={p.color} />
            {img === 'back' && <PersoMock takesNumber={p.takes_number} takesName={p.takes_name} decorations={p.decorations} />}
          </div>
          {(hasBackDeco || isPerso) && <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {['front', 'back'].map((v) => <button key={v} onClick={() => setImg(v)} style={thumbBtn(theme, img === v)}>{v}</button>)}
          </div>}
        </div>
        <div style={{ paddingTop: 4 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: theme.accentDeep, marginBottom: 8 }}>{[p.store_category, p.category].filter(Boolean)[0] || 'Team Gear'}</div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(32px,4vw,48px)', margin: '0 0 12px', letterSpacing: 0.2, lineHeight: 0.96, textTransform: 'uppercase', color: theme.ink }}>{p.name}</h1>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, marginBottom: showFund ? 4 : 18, letterSpacing: 0.3, color: theme.primary }}>{money(priceOf(p) + upNow)}{upNow > 0 ? <span style={{ fontSize: 14, color: theme.subText, fontFamily: BODY, fontWeight: 600 }}> · {size} +{money(upNow)}</span> : null}</div>
          {showFund && <div style={{ fontSize: 13, color: STOCK.in, fontWeight: 700, marginBottom: 18 }}>Includes {money(p.fundraise_amount)} that supports the team</div>}
          {descText && <p style={{ fontSize: 16, lineHeight: 1.6, color: theme.subText, margin: '0 0 22px', maxWidth: 480, whiteSpace: 'pre-line' }}>{descText}</p>}

          {!isFitGroup && colorRows.length > 1 && <div style={{ margin: '4px 0 22px' }}>
            <div style={label}>Color{p.color ? ` — ${p.color}` : ''}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {colorRows.map((c) => { const on = c.webstore_product_id === p.webstore_product_id; return (
                <button key={c.webstore_product_id} type="button" title={c.color || ''} onClick={() => { setColorId(c.webstore_product_id); setSize(null); setImg('front'); }}
                  style={{ width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', padding: 0, background: c.image_front_url ? `center/cover url(${c.image_front_url})` : swatchColor(c.color), border: 'none', boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${theme.primary}` : `0 0 0 1px ${theme.line}` }} />
              ); })}
            </div>
          </div>}

          {!isFitGroup && <div style={{ marginBottom: 4 }}><StockLine onHand={onHand} incoming={incoming} eta={etaOf(p)} onOrder={p.on_order_qty} /></div>}

          {isFitGroup ? (
            <div style={{ margin: '22px 0' }}>
              <div style={label}>Select fit &amp; size</div>
              {colorRows.map((c) => {
                const cs = sizesFor(c);
                if (!cs.length) return null;
                return (
                  <div key={c.webstore_product_id} style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: theme.subText, marginBottom: 8, textTransform: 'uppercase' }}>{c.variant_label || c.name}</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{renderSizeButtons(c, cs)}</div>
                  </div>
                );
              })}
            </div>
          ) : (sizes.length > 0 && <div style={{ margin: '22px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={label}>Select Size</div>
              <span style={{ fontSize: 13, color: theme.accentDeep, cursor: 'pointer', textDecoration: 'underline' }}>Size guide</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{renderSizeButtons(p, sizes)}</div>
          </div>)}

          {(p.takes_number || p.takes_name) && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0 18px' }}>
              {p.takes_number && <div>
                <div style={label}>Number</div>
                <input className="sf-input" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="#" inputMode="numeric" style={fieldStyle(theme, 80)} />
              </div>}
              {p.takes_name && <div>
                <div style={label}>Name {nameUp > 0 ? `(+${money(nameUp)})` : ''}</div>
                <input className="sf-input" value={pname} onChange={(e) => setPname(e.target.value.slice(0, 20))} placeholder="Last name" style={fieldStyle(theme, 220)} />
              </div>}
            </div>
          )}

          {(upNow > 0 || (p.takes_name && nameUp > 0 && pname.trim())) ? <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, marginBottom: 10, color: theme.ink }}>Total: {money(total)}</div> : null}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {!isPersonalized && (
              <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.line}`, borderRadius: 4, overflow: 'hidden', height: 50 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} style={qtyBtn(qty <= 1)}>−</button>
                <span style={{ minWidth: 40, textAlign: 'center', fontWeight: 700, fontSize: 16, fontFamily: DISPLAY }}>{qty}</span>
                <button onClick={() => setQty((q) => Math.min(99, q + 1))} style={qtyBtn(false)}>+</button>
              </div>
            )}
            <button className="sf-btn sf-skew" onClick={addToCart} disabled={!canAdd} style={{ ...cta(theme), flex: 1, minWidth: 220, opacity: canAdd ? 1 : 0.55, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
              <span style={{ display: 'inline-block', transform: 'skewX(3deg)' }}>{!isOpen ? 'Store not open yet' : soldOutNoSize ? 'Sold out' : added ? '✓ Added to Cart' : needSize && !size ? 'Select a size' : needNumber && !num.trim() ? 'Enter a number' : `Add to Cart · ${money(total * (isPersonalized ? 1 : qty))}`}</span>
            </button>
          </div>
          {added && <div style={{ marginTop: 14, background: '#EAF3EC', border: '1px solid #BFE0C8', color: STOCK.in, borderRadius: 6, padding: '11px 14px', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>✓ Added to cart — <span onClick={() => navTo('/shop/' + store.slug + '/cart')} style={{ textDecoration: 'underline', cursor: 'pointer' }}>view cart</span></div>}

          <div style={{ marginTop: 24, display: 'grid', gap: 10, borderTop: `1px solid ${theme.line}`, paddingTop: 20 }}>
            {proof.map((pt) => <div key={pt} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: theme.subText }}><span style={{ color: theme.accentDeep, fontWeight: 800 }}>✓</span>{pt}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Package ──────────────────────────────────────────────────────────
function BundlePage({ store, theme, product: p, components, compInfo = {}, products = [], isOpen, onAdd, player = null }) {
  const [picks, setPicks] = useState({}); // component id -> selected size
  const [nums, setNums] = useState({});   // component id -> jersey number
  const [names, setNames] = useState({}); // component id -> custom name
  const [added, setAdded] = useState(false);
  // Prefill every numbered/named component from the player's roster link.
  useEffect(() => {
    if (!player || !components) return;
    if (player.player_number) { const n = String(player.player_number).replace(/[^0-9]/g, '').slice(0, 3); setNums((prev) => { const next = { ...prev }; components.forEach((c) => { if (c.takes_number && !next[c.id]) next[c.id] = n; }); return next; }); }
    if (player.player_name) { const nm = String(player.player_name).slice(0, 20); setNames((prev) => { const next = { ...prev }; components.forEach((c) => { if (c.takes_name && !next[c.id]) next[c.id] = nm; }); return next; }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, p ? p.webstore_product_id : null]);
  const wpById = buildWpById(products);
  const meta = (c) => compMeta(c, wpById, compInfo);
  if (!p) return <Splash>Package not found.</Splash>;
  const compSizesArr = (c) => foldScale(meta(c).sizes);
  const nameExtra = components.reduce((a, c) => a + ((c.takes_name && (names[c.id] || '').trim()) ? (Number(c.name_upcharge) || 0) : 0), 0);
  const missingSize = components.some((c) => c.size_required && compSizesArr(c).length > 0 && !picks[c.id]);
  const missingNum = components.some((c) => c.takes_number && !(nums[c.id] || '').trim());
  const canAdd = isOpen && !missingSize && !missingNum;
  const addToCart = () => {
    onAdd({
      kind: 'bundle', webstore_product_id: p.webstore_product_id, product_id: null, sku: null,
      name: p.name, image: p.image_front_url || (components.map((c) => meta(c).image).find(Boolean)) || null,
      unit_price: Number(p.retail_price) || 0, fundraise: Number(p.fundraise_amount) || 0, name_extra: nameExtra,
      components: components.map((c) => { const m = meta(c); return {
        bundle_item_id: c.id, product_id: c.product_id, sku: c.sku, name: m.name, image: m.image || null,
        size: picks[c.id] || null,
        player_number: c.takes_number ? (nums[c.id] || '').trim() : null,
        player_name: c.takes_name ? (names[c.id] || '').trim() : null,
      }; }),
      qty: 1,
    });
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  };
  const showFund = store.fundraise_show_parents && Number(p.fundraise_amount) > 0;
  const compName = (c) => meta(c).name || c.sku || 'Item';
  const compImg = (c) => meta(c).image;
  const compSizes = (c) => foldScale(meta(c).sizes);
  // A step is complete when every required input on it is satisfied.
  const isComplete = (c) => (!(c.size_required && compSizes(c).length > 0) || !!picks[c.id]) && (!c.takes_number || (nums[c.id] || '').trim());
  const total = components.length;
  const selCount = components.filter(isComplete).length;
  const pct = total ? selCount / total : 1;
  const pack = priceOf(p);
  // Strike-through retail when the store priced the pack below list.
  const list = Number(p.retail_price) || 0;
  const showSave = p.display_price != null && list > pack;
  const save = showSave ? list - pack : 0;
  const ringDeg = Math.round(pct * 360);

  return (
    <div style={{ paddingTop: 24 }}>
      <BackLink store={store} theme={theme} />
      {/* Hero band */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, background: `linear-gradient(135deg, ${theme.primary}, ${theme.deep})`, color: '#fff', padding: 'clamp(24px,3vw,34px)', display: 'flex', alignItems: 'center', gap: 'clamp(20px,3vw,32px)', flexWrap: 'wrap', boxShadow: '0 14px 36px rgba(0,0,0,0.16)' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: HASH, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1, flex: '0 0 auto' }}>
          <div style={{ position: 'relative', width: 92, height: 92, borderRadius: '50%', background: `conic-gradient(${theme.accent} ${ringDeg}deg, rgba(255,255,255,0.18) ${ringDeg}deg)`, display: 'grid', placeItems: 'center', transition: 'background .3s ease' }}>
            <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', background: theme.deep, display: 'grid', placeItems: 'center', lineHeight: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: '#fff' }}>{selCount}</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, color: theme.accent }}>OF {total}</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: theme.accent, marginBottom: 8 }}>Required · Every player orders this</div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(30px,4vw,46px)', textTransform: 'uppercase', lineHeight: 0.96, margin: '0 0 8px' }}>Build Your <em style={{ fontStyle: 'italic', color: theme.accent }}>{p.name || 'Player Pack'}</em></h1>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.85)', maxWidth: 520 }}>Pick a size for each piece — the whole kit checks out as one package.{showFund ? ` Includes ${money(p.fundraise_amount)} that supports the team.` : ''}</p>
        </div>
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {showSave && <span style={{ fontFamily: DISPLAY, fontSize: 20, color: 'rgba(255,255,255,0.6)', textDecoration: 'line-through' }}>{money(list)}</span>}
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, lineHeight: 1 }}>{money(pack)}</span>
          {showSave && <span style={{ background: theme.accent, color: theme.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', padding: '6px 12px', transform: 'skewX(-6deg)' }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Save {money(save)}</span></span>}
        </div>
      </div>

      {/* Item grid */}
      {components.length === 0 ? <Splash>This pack has no items configured yet.</Splash> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 20, margin: '24px 0 96px' }}>
          {components.map((c, i) => {
            const sizes = compSizes(c);
            const complete = isComplete(c);
            return (
              <div key={c.id} style={{ background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: 'border-color .2s ease' }}>
                {/* Full-width item image */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5', background: theme.warm, overflow: 'hidden', flexShrink: 0 }}>
                  {compImg(c) ? <><img src={normGarment(compImg(c))} alt={compName(c)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /><DecoOverlay decorations={meta(c).decorations} colorName={meta(c).color} /></> : <GarmentTile theme={theme} store={store} kind={garmentKind({ name: compName(c) })} />}
                  {/* Step badge — top-left */}
                  <div style={{ position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, background: complete ? theme.accent : theme.ink, color: complete ? theme.ink : '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', zIndex: 2 }}>{complete ? '✓' : i + 1}</div>
                  {/* Required badge — top-right */}
                  {c.size_required && <span style={{ position: 'absolute', top: 12, right: 12, fontFamily: DISPLAY, fontWeight: 700, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', background: theme.primary, color: '#fff', padding: '4px 9px', transform: 'skewX(-6deg)', borderRadius: 2, zIndex: 2 }}><span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Required</span></span>}
                  {/* Completion bar at bottom of image */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: complete ? theme.accent : 'transparent', transition: 'background .25s ease' }} />
                </div>
                {/* Info + selectors */}
                <div style={{ padding: '14px 16px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.3, color: theme.ink, lineHeight: 1.1, marginBottom: 12 }}>{c.qty > 1 ? `${c.qty}× ` : ''}{compName(c)}</div>
                {c.size_required && sizes.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: theme.subText, marginBottom: 8 }}>Size</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {sizes.map((sz) => <button key={sz} onClick={() => setPicks((x) => ({ ...x, [c.id]: sz }))} style={sizeBtn(theme, picks[c.id] === sz)}>{sz}</button>)}
                    </div>
                  </div>
                )}
                {(c.takes_number || c.takes_name) && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                    {c.takes_number && <div>
                      <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: theme.subText, marginBottom: 6 }}>Number</div>
                      <input className="sf-input" value={nums[c.id] || ''} onChange={(e) => setNums((x) => ({ ...x, [c.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} placeholder="#" inputMode="numeric" style={fieldStyle(theme, 70)} />
                    </div>}
                    {c.takes_name && <div>
                      <div style={{ fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: theme.subText, marginBottom: 6 }}>Name {Number(c.name_upcharge) > 0 ? `(+${money(c.name_upcharge)})` : ''}</div>
                      <input className="sf-input" value={names[c.id] || ''} onChange={(e) => setNames((x) => ({ ...x, [c.id]: e.target.value.slice(0, 20) }))} placeholder="Last name" style={fieldStyle(theme, 160)} />
                    </div>}
                  </div>
                )}
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: complete ? STOCK.in : theme.accentDeep, marginTop: 4 }}>
                    {complete ? `✓ Selected${picks[c.id] ? ` · ${picks[c.id]}` : ''}` : (c.size_required ? 'Choose a size' : 'Add your details')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky action bar */}
      <div style={{ position: 'sticky', bottom: 0, zIndex: 10, background: theme.ink, borderRadius: '8px 8px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.18)', padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 180 }}>
          <div style={{ width: 170, maxWidth: '60vw', height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: theme.accent, borderRadius: 999, transition: 'width .3s ease' }} />
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>{!isOpen ? 'Store not open yet' : canAdd ? 'Pack complete — ready to add' : `${selCount} of ${total} selected`}</div>
        </div>
        <button className="sf-btn sf-skew" onClick={addToCart} disabled={!canAdd} style={{ border: 'none', borderRadius: 4, padding: '15px 28px', fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: 1.2, textTransform: 'uppercase', cursor: canAdd ? 'pointer' : 'not-allowed', background: canAdd ? theme.accent : 'rgba(255,255,255,0.16)', color: canAdd ? theme.ink : 'rgba(255,255,255,0.5)' }}>
          <span style={{ display: 'inline-block', transform: 'skewX(3deg)' }}>{!isOpen ? 'Store not open yet' : added ? '✓ Added' : `Add Player Pack · ${money(pack + nameExtra)}`}</span>
        </button>
      </div>
    </div>
  );
}

// ── Cart ─────────────────────────────────────────────────────────────
function lineDetail(l) {
  if (l.kind === 'bundle') return (l.components || []).map((c) => `${c.name}${c.size ? ' · ' + c.size : ''}${c.player_number ? ' · #' + c.player_number : ''}${c.player_name ? ' · ' + c.player_name : ''}`);
  return [
    [l.variant_label, l.size && 'Size ' + l.size, l.player_number && '#' + l.player_number, l.player_name].filter(Boolean).join(' · '),
    Number(l.size_extra) > 0 ? `Includes +${money(l.size_extra)} for ${l.size}` : null,
  ].filter(Boolean);
}
function CartPage({ store, theme, cart, onUpdate }) {
  const remove = (key) => onUpdate(cart.filter((l) => l.key !== key));
  const setQty = (key, q) => onUpdate(cart.map((l) => (l.key === key ? { ...l, qty: Math.max(1, q) } : l)));
  // Personalized items (a specific jersey number/name) and packs are 1-of-a-kind.
  const fixedQty = (l) => l.kind === 'bundle' || !!l.player_number || !!l.player_name;
  const heading = <h1 style={{ position: 'relative', fontFamily: DISPLAY, fontSize: 'clamp(32px,5vw,46px)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 26px', lineHeight: 0.95, color: theme.ink, paddingBottom: 14 }}>Your Cart<span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0, width: 58, height: 4, background: theme.accent, transform: 'skewX(-12deg)' }} /></h1>;
  if (!cart.length) return <div style={{ paddingTop: 24 }}><BackLink store={store} theme={theme} />{heading}<div style={{ background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 8, padding: '48px 24px', textAlign: 'center' }}><div style={{ fontSize: 16, color: theme.subText, marginBottom: 18 }}>Your cart is empty.</div><SkewBtn theme={theme} variant="primary" onClick={() => navTo('/shop/' + store.slug)}>Start with the Player Pack</SkewBtn></div></div>;

  const thumb = (img, kind) => <div style={{ width: 52, height: 52, borderRadius: 6, background: theme.warm, overflow: 'hidden', flexShrink: 0, display: 'grid', placeItems: 'center' }}>{img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GarmentTile theme={theme} store={store} kind={kind || 'top'} />}</div>;
  const optLabel = (parts) => parts.filter(Boolean).join(' · ');

  return (
    <div style={{ paddingTop: 24 }}>
      <BackLink store={store} theme={theme} />
      {heading}
      <div className="sf-2col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,0.85fr)', gap: 32, alignItems: 'start' }}>
        <div>
          {cart.map((l) => l.kind === 'bundle' ? (
            // Grouped Player Pack card — one priced unit, child items show "incl."
            <div key={l.key} style={{ background: theme.paper, border: `1px solid ${theme.line}`, borderLeft: `4px solid ${theme.accent}`, borderRadius: 6, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${theme.line}` }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.3, color: theme.ink }}>{l.name} · {money(lineUnit(l))}</div>
                <button onClick={() => remove(l.key)} style={{ background: 'none', border: 'none', color: theme.primary, cursor: 'pointer', fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Remove pack</button>
              </div>
              {(l.components || []).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < (l.components.length - 1) ? `1px solid ${theme.cream}` : 'none' }}>
                  {thumb(c.image, garmentKind({ name: c.name }))}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, textTransform: 'uppercase', letterSpacing: 0.3, color: theme.ink }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: theme.subText }}>{optLabel([c.size, c.player_number && '#' + c.player_number, c.player_name])}</div>
                  </div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: theme.subText }}>incl.</div>
                </div>
              ))}
            </div>
          ) : (
            <div key={l.key} style={{ display: 'flex', gap: 14, padding: '16px', background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 6, marginBottom: 16, alignItems: 'center' }}>
              {thumb(l.image, garmentKind(l))}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.3, color: theme.ink }}>{l.name}</div>
                <div style={{ fontSize: 13, color: theme.subText }}>{optLabel([l.variant_label, l.size, l.player_number && '#' + l.player_number, l.player_name])}</div>
                {fixedQty(l)
                  ? <button onClick={() => remove(l.key)} style={{ background: 'none', border: 'none', color: theme.primary, cursor: 'pointer', fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.5, textTransform: 'uppercase', padding: '6px 0 0' }}>Remove</button>
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.line}`, borderRadius: 4, overflow: 'hidden', height: 36 }}>
                        <button onClick={() => setQty(l.key, (l.qty || 1) - 1)} disabled={(l.qty || 1) <= 1} style={{ ...qtyBtn((l.qty || 1) <= 1), width: 34, minHeight: 34, fontSize: 17 }}>−</button>
                        <span style={{ minWidth: 32, textAlign: 'center', fontWeight: 700, fontSize: 14, fontFamily: DISPLAY }}>{l.qty || 1}</span>
                        <button onClick={() => setQty(l.key, (l.qty || 1) + 1)} style={{ ...qtyBtn(false), width: 34, minHeight: 34, fontSize: 17 }}>+</button>
                      </div>
                      <button onClick={() => remove(l.key)} style={{ background: 'none', border: 'none', color: theme.primary, cursor: 'pointer', fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Remove</button>
                    </div>}
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, color: theme.primary }}>{money(lineUnit(l) * (l.qty || 1))}</div>
            </div>
          ))}
        </div>

        {/* Sticky order summary */}
        <div style={{ position: 'sticky', top: 170, background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 8, padding: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', letterSpacing: 0.5, color: theme.ink, marginBottom: 16 }}>Order Summary</div>
          <Row label="Subtotal" value={money(cartTotal(cart))} theme={theme} />
          <Row label="Custom decoration" value="Included" theme={theme} green />
          <Row label={store.delivery_mode === 'ship_home' ? 'Shipping' : 'Team delivery'} value={shipFee(store) > 0 ? money(shipFee(store)) : 'Free'} theme={theme} green={shipFee(store) <= 0} />
          {procFeeAmt(store, cart) > 0 && <Row label={`Processing fee (${procPct(store)}%)`} value={money(procFeeAmt(store, cart))} theme={theme} />}
          <div style={{ borderTop: `1px solid ${theme.line}`, margin: '14px 0', paddingTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', color: theme.ink }}>Total</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: theme.primary }}>{money(grandTotal(store, cart))}</span>
          </div>
          <button className="sf-btn sf-skew" onClick={() => navTo('/shop/' + store.slug + '/checkout')} style={{ ...cta(theme), marginTop: 4 }}><span style={{ display: 'inline-block', transform: 'skewX(3deg)' }}>Checkout →</span></button>
          <p style={{ fontSize: 12.5, color: theme.subText, lineHeight: 1.5, margin: '14px 0 0' }}>{store.delivery_mode === 'ship_home' ? 'Custom-decorated and shipped to your door' : 'Delivered to the team'} ~4–5 weeks after the store closes{closesLabel(store.close_at) ? ` ${closesLabel(store.close_at).text.replace(/^Closes /, '').replace(/^Open until /, 'on ')}` : ''}.</p>
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, theme, green }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 15, marginBottom: 10 }}>
    <span style={{ color: theme.subText }}>{label}</span>
    <span style={{ fontWeight: 700, color: green ? STOCK.in : theme.ink }}>{value}</span>
  </div>;
}

// Soft oversell guard: re-check live stock for plain (non-bundle) sized items
// right before placing the order. Backorder-OK items (incoming) always pass.
// Not fully atomic — shrinks the window, doesn't eliminate a simultaneous race.
// ── Server-side checkout ─────────────────────────────────────────────
// Pricing, stock + coupon validation, the order/items/number-claim writes,
// PaymentIntent creation, and confirmation emails all happen in
// netlify/functions/webstore-checkout — the browser sends item identities and
// personalization only, never prices. (The old client-side placeOrder trusted
// localStorage cart prices and could leave a paid order with no items.)
async function checkoutCall(payload) {
  try {
    const r = await fetch('/.netlify/functions/webstore-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: { message: d.error || ('Checkout failed (HTTP ' + r.status + ')') }, code: d.code, totals: d.totals };
    return d;
  } catch (e) { return { error: { message: e.message } }; }
}

// After a `totals_changed` rejection the cart's snapshot prices are stale — a rep changed
// a price, the store's fundraising, or a size upcharge while items sat in the cart. Re-read
// the live prices for every product in the cart from the same public view the storefront
// prices from, and rebuild each line's price fields so the next submit computes the exact
// total the server will accept. Turns a permanent dead-end (retrying the stale total 409s
// forever) into a "prices updated — review and place again" flow. Returns a NEW cart array;
// on any lookup failure returns the original cart unchanged (never worse than before).
async function repriceCart(store, cart) {
  try {
    const ids = [...new Set(cart.map((l) => l.webstore_product_id).filter(Boolean))];
    if (!ids.length) return cart;
    const [{ data: prods }, { data: bitems }] = await Promise.all([
      supabase.from('webstore_storefront_products')
        .select('webstore_product_id,retail_price,fundraise_amount,size_upcharges,name_upcharge')
        .eq('store_id', store.id).in('webstore_product_id', ids),
      supabase.from('webstore_bundle_items').select('id,bundle_id,name_upcharge,takes_name').in('bundle_id', ids),
    ]);
    const byId = {}; (prods || []).forEach((p) => { byId[p.webstore_product_id] = p; });
    const biById = {}; (bitems || []).forEach((b) => { biById[b.id] = b; });
    return cart.map((l) => {
      const p = byId[l.webstore_product_id];
      if (!p) return l; // product gone/deactivated — leave as-is; the server surfaces its own error
      const unit_price = Number(p.retail_price) || 0;
      const fundraise = Number(p.fundraise_amount) || 0;
      if (l.kind === 'bundle') {
        // Bundle name upcharge = sum over selected components that take a name and have one.
        const name_extra = (l.components || []).reduce((a, c) => {
          const bi = c.bundle_item_id ? biById[c.bundle_item_id] : null;
          const hasName = c.player_name && String(c.player_name).trim();
          return a + ((bi && bi.takes_name && hasName) ? (Number(bi.name_upcharge) || 0) : 0);
        }, 0);
        return { ...l, unit_price, fundraise, name_extra };
      }
      const size_extra = l.size ? (Number((p.size_upcharges || {})[l.size]) || 0) : 0;
      const name_extra = (l.player_name && String(l.player_name).trim()) ? (Number(p.name_upcharge) || 0) : 0;
      return { ...l, unit_price, fundraise, size_extra, name_extra };
    });
  } catch (e) { return cart; }
}

// Percent coupons discount the order; whether shipping is included is per-coupon
// (cover_shipping, default on). Free shipping is handled by zeroing the fee.
function couponDiscount(coupon, cart, shipping = 0) {
  if (!coupon || coupon.kind !== 'percent') return 0;
  const base = cartTotal(cart) + (coupon.cover_shipping !== false ? (Number(shipping) || 0) : 0);
  return Math.round(base * (Number(coupon.value) || 0) / 100 * 100) / 100;
}

// Billing-ZIP collector for club-delivery (pickup) stores. Instead of a bare manual
// "Billing ZIP" text box, we source the tax ZIP from a Stripe billing AddressElement —
// which Link autofills for returning shoppers, so most buyers don't type it at all.
// IMPORTANT: this Elements instance ONLY hosts the address widget; the real charge still
// runs through the separate PaymentIntent-backed Elements below, unchanged. The amount
// here is nominal (never charged) and the options object is module-level constant so the
// Elements never re-initializes and wipes the buyer's input as the tax total updates.
const STRIPE_ADDR_OPTS = { mode: 'payment', amount: 100, currency: 'usd', appearance: { theme: 'stripe' } };

// If the Stripe address widget ever fails to render/init, fall back to the plain ZIP
// input so club-delivery checkout can never be *blocked* by this enhancement.
class StripeFieldBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { try { console.warn('[storefront] billing address widget failed; using plain ZIP:', err && err.message); } catch (e) {} }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function BillingAddressInner({ onZip }) {
  return (
    <AddressElement
      options={{ mode: 'billing', fields: { phone: 'never' } }}
      onChange={(e) => {
        const pc = e && e.value && e.value.address && e.value.address.postal_code;
        if (pc) onZip(String(pc).replace(/\D/g, '').slice(0, 5));
      }}
    />
  );
}

// Renders the Stripe billing address (its postal drives the sales-tax quote), or the
// plain ZIP `fallback` when locked (PaymentIntent created — inputs frozen), when Stripe
// isn't available, or if the widget errors.
function BillingZip({ stripePromise, disabled, onZip, fallback }) {
  if (disabled || !stripePromise) return fallback;
  return (
    <StripeFieldBoundary fallback={fallback}>
      <Elements stripe={stripePromise} options={STRIPE_ADDR_OPTS}>
        <BillingAddressInner onZip={onZip} />
      </Elements>
    </StripeFieldBoundary>
  );
}

function CheckoutPage({ store, theme, cart, onUpdate, onClear, player = null }) {
  const allowUnpaid = store.payment_mode === 'unpaid' || store.payment_mode === 'either';
  const allowPaid = store.payment_mode === 'paid' || store.payment_mode === 'either';
  const [stripePromise, setStripePromise] = useState(null);
  useEffect(() => { if (allowPaid) _getStripePromise().then((p) => setStripePromise(p || null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // player_name = who the gear is for (often a parent buys for their kid). On
  // club/team stores it's required so every order tags to a player for the
  // player report + bagging; pre-filled from the roster link when present.
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '', zip: '', player_name: (player && player.player_name) ? String(player.player_name) : '' });
  const [ship, setShip] = useState({ name: '', street1: '', street2: '', city: '', state: '', zip: '' });
  const [method, setMethod] = useState(allowPaid ? 'paid' : 'unpaid');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponErr, setCouponErr] = useState('');
  // Shown after a `totals_changed` rejection once we've refreshed the cart to live prices.
  const [priceNotice, setPriceNotice] = useState(false);
  // Once the PaymentIntent exists (card form is mounted), the order + charge amount are
  // fixed server-side. Freeze the inputs that would change the price/method so the buyer
  // can't (e.g.) apply a coupon that lowers the displayed total while the card still
  // charges the original amount, or switch to team-tab and mint a duplicate order.
  const locked = !!clientSecret;
  const [checkoutMsg, setCheckoutMsg] = useState('');
  useEffect(() => { supabase.from('webstore_settings').select('checkout_message').eq('id', 1).maybeSingle().then(({ data }) => setCheckoutMsg((data && data.checkout_message) || '')).catch(() => {}); }, []);
  const needAddr = store.delivery_mode === 'ship_home';
  // Server-quoted sales tax: CA via CDTFA, registered out-of-state via TaxCloud. Quoted once
  // we can source tax (a complete ship address, or pickup which sources to NSA's location).
  const [taxInfo, setTaxInfo] = useState(null); // { tax, total, tax_state }
  const _shipKey = needAddr ? [ship.street1, ship.city, ship.state, ship.zip].join('|') : ('pickup|' + (buyer.zip || ''));
  const _cartKey = JSON.stringify(cart.map((l) => [l.webstore_product_id, l.size, l.qty]));
  useEffect(() => {
    if (needAddr && !(ship.street1 && ship.city && ship.state && ship.zip)) { setTaxInfo(null); return; }
    if (!needAddr && (buyer.zip || '').length < 5) { setTaxInfo(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await checkoutCall({ action: 'quote', storeSlug: store.slug, cart, ship: needAddr ? ship : null, billing: needAddr ? null : { zip: buyer.zip }, couponCode: coupon ? coupon.code : null });
      if (!cancelled && r && r.totals) setTaxInfo(r.totals);
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_shipKey, _cartKey, coupon && coupon.code, store.slug]);

  // place_order idempotency: one clientRef per distinct checkout payload. An identical
  // resubmit (double-click, retry after a lost response) reuses the ref, so the server
  // returns the SAME order instead of creating a duplicate (migration 00170); any change
  // to the cart, buyer, coupon, or pay mode mints a fresh ref. Cleared on completion.
  const _orderRefState = useRef({ key: '', ref: '' });
  const orderRefFor = (payMode) => {
    const key = JSON.stringify([store.slug, payMode, buyer.email, coupon ? coupon.code : null,
      cart.map((l) => [l.webstore_product_id, l.size, l.qty, l.player_name || null, l.player_number || null, l.components || null])]);
    if (_orderRefState.current.key !== key) {
      const uuid = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'ref' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      _orderRefState.current = { key, ref: uuid };
    }
    return _orderRefState.current.ref;
  };
  const clearOrderRef = () => { _orderRefState.current = { key: '', ref: '' }; };

  if (!cart.length) return <div style={{ paddingTop: 26 }}><BackLink store={store} theme={theme} /><Splash>Your cart is empty.</Splash></div>;

  const validBuyer = buyer.name.trim() && /.+@.+\..+/.test(buyer.email)
    && (needAddr ? (ship.street1 && ship.city && ship.state && ship.zip) : (((buyer.zip || '').length === 5) && (buyer.player_name || '').trim()));
  const ship_ = coupon && coupon.kind === 'free_shipping' ? 0 : shipFee(store);
  const discount = couponDiscount(coupon, cart, ship_);
  const processing = procFeeAmt(store, cart);
  const payable = Math.max(0, cartTotal(cart) + ship_ + processing - discount);
  const comped = payable <= 0; // fully covered by a code → no card, invoice the program

  const applyCoupon = async () => {
    setCouponErr(''); setPriceNotice(false); const code = couponInput.trim(); if (!code) return;
    const r = await checkoutCall({ action: 'check_coupon', storeSlug: store.slug, code });
    if (r.error) { setCoupon(null); setCouponErr(r.error.message); return; }
    setCoupon(r.coupon); setCouponErr('');
  };

  // A `totals_changed` 409 means the cart's snapshot prices went stale (a price/fundraise
  // change while items sat in the cart). Refresh the cart to live prices — so the next
  // attempt computes the total the server accepts — and show a notice, instead of the
  // dead-end error the shopper could never clear by retrying.
  const onTotalsChanged = async () => {
    const repriced = await repriceCart(store, cart);
    onUpdate(repriced);
    setPriceNotice(true); setErr('');
  };

  const submitUnpaid = async () => {
    setErr(''); setPriceNotice(false); if (!validBuyer) { setErr(needAddr ? 'Please complete your contact and shipping info.' : 'Please complete your name, email, player name and billing ZIP.'); return; }
    setBusy(true);
    const r = await checkoutCall({ action: 'place_order', storeSlug: store.slug, cart, buyer, ship: { ...ship, name: ship.name || buyer.name }, payMode: 'unpaid', couponCode: coupon ? coupon.code : null, expectedTotalCents: Math.round(payable * 100), clientRef: orderRefFor('unpaid'), rosterToken: player ? player.token : null });
    setBusy(false);
    if (r.error) { if (r.code === 'totals_changed') return onTotalsChanged(); setErr(r.error.message); return; }
    clearOrderRef();
    onClear(); navTo(`/shop/${store.slug}/order/${r.order.id}`);
  };

  // Order-first: the server re-prices the cart, persists the order as
  // pending_payment (items + number claims committed transactionally), creates
  // the PaymentIntent with the SERVER total, then we show the card form. The
  // Stripe webhook flips it to paid even if the buyer closes the tab.
  const startCard = async () => {
    setErr(''); setPriceNotice(false); if (!validBuyer) { setErr(needAddr ? 'Please complete your contact and shipping info.' : 'Please complete your name, email, player name and billing ZIP.'); return; }
    setBusy(true);
    const r = await checkoutCall({ action: 'place_order', storeSlug: store.slug, cart, buyer, ship: { ...ship, name: ship.name || buyer.name }, payMode: 'paid', couponCode: coupon ? coupon.code : null, expectedTotalCents: Math.round(payable * 100), clientRef: orderRefFor('paid'), rosterToken: player ? player.token : null });
    if (r.error) { setBusy(false); if (r.code === 'totals_changed') return onTotalsChanged(); setErr(r.error.message); return; }
    if (r.alreadyPaid) {
      // Replay of an order whose payment already went through — finalize and land
      // on the confirmation instead of showing a card form for a settled intent.
      await checkoutCall({ action: 'finalize', orderId: r.order.id, stripePiId: r.order.stripe_pi_id || r.intentId });
      clearOrderRef();
      onClear(); navTo(`/shop/${store.slug}/order/${r.order.id}`);
      return;
    }
    if (!r.clientSecret) { setErr('Could not start payment.'); setBusy(false); return; }
    setPendingOrder(r.order);
    setClientSecret(r.clientSecret);
    setBusy(false);
  };

  const confirmPaid = async (paymentIntentId) => {
    if (!pendingOrder) { setErr('Order reference lost — your card was charged. Please contact us and we’ll confirm your order.'); return; }
    // Server-side finalize verifies the PaymentIntent against the order, flips it
    // to paid, and sends the confirmation email. If this call never lands (tab
    // closed, network drop), the Stripe webhook does the same — the atomic
    // confirmation_sent claim means exactly one of them sends the email.
    await checkoutCall({ action: 'finalize', orderId: pendingOrder.id, stripePiId: paymentIntentId || pendingOrder.stripe_pi_id });
    clearOrderRef();
    onClear(); navTo(`/shop/${store.slug}/order/${pendingOrder.id}`);
  };

  return (
    <div style={{ paddingTop: 24, maxWidth: 640 }}>
      <BackLink store={store} theme={theme} />
      <h1 style={{ position: 'relative', fontFamily: DISPLAY, fontSize: 'clamp(32px,5vw,46px)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 26px', lineHeight: 0.95, color: theme.ink, paddingBottom: 14 }}>Checkout<span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0, width: 58, height: 4, background: theme.accent, transform: 'skewX(-12deg)' }} /></h1>
      {checkoutMsg && <div style={{ background: '#eff6ff', color: '#1e3a5f', border: '1px solid #bfdbfe', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14, whiteSpace: 'pre-wrap' }}>{checkoutMsg}</div>}
      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{err}</div>}
      {priceNotice && <div style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>Prices changed while you were shopping, so we refreshed your cart to the current prices. Please review your new total below and place your order again.</div>}

      <Field label="Your name"><input style={inp} value={buyer.name} disabled={locked} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Email"><input style={inp} value={buyer.email} disabled={locked} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></Field>
        <Field label="Phone (optional)"><input style={inp} value={buyer.phone} disabled={locked} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></Field>
      </div>

      {needAddr ? (
        <><div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', margin: '12px 0 6px' }}>Ship to home</div>
        <Field label="Street"><input style={inp} value={ship.street1} disabled={locked} onChange={(e) => setShip({ ...ship, street1: e.target.value })} /></Field>
        <Field label="Apt / unit (optional)"><input style={inp} value={ship.street2} disabled={locked} onChange={(e) => setShip({ ...ship, street2: e.target.value })} /></Field>
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="City"><input style={inp} value={ship.city} disabled={locked} onChange={(e) => setShip({ ...ship, city: e.target.value })} /></Field>
          <Field label="State"><input style={inp} value={ship.state} disabled={locked} onChange={(e) => setShip({ ...ship, state: e.target.value })} /></Field>
          <Field label="ZIP"><input style={inp} value={ship.zip} disabled={locked} onChange={(e) => setShip({ ...ship, zip: e.target.value })} /></Field>
        </div></>
      ) : (
        <><div style={{ background: '#eff6ff', color: '#1e40af', padding: '10px 14px', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>Orders for this store are <b>delivered to the club</b> — no shipping address needed.</div>
        <Field label="Player's name"><input style={inp} value={buyer.player_name || ''} disabled={locked} maxLength={60} placeholder="First &amp; last name" onChange={(e) => setBuyer({ ...buyer, player_name: e.target.value })} /><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Required — the team sorts each order by player. Add yours even if you're the buyer.</div></Field>
        <Field label="Billing address"><BillingZip stripePromise={stripePromise} disabled={locked} onZip={(z) => setBuyer((b) => ({ ...b, zip: z }))} fallback={<input style={{ ...inp, maxWidth: 160 }} value={buyer.zip || ''} disabled={locked} inputMode="numeric" maxLength={5} placeholder="e.g. 93703" onChange={(e) => setBuyer({ ...buyer, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })} />} /><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Your billing address is used only to apply the correct sales tax for your area — Link fills it in automatically for returning shoppers.</div></Field></>
      )}

      {/* Coupon / scholarship code */}
      <div style={{ marginTop: 16 }}>
        {coupon ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
            <span style={{ color: '#166534', fontWeight: 700 }}>Code {coupon.code} applied{coupon.kind === 'free_shipping' ? ' — free shipping' : ` — ${coupon.value}% off`}</span>
            {!locked && <button onClick={() => { setCoupon(null); setCouponInput(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>Remove</button>}
          </div>
        ) : locked ? null : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...inp, maxWidth: 220 }} placeholder="Discount / scholarship code" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCoupon(); }} />
            <button onClick={applyCoupon} style={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: 8, padding: '10px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Apply</button>
          </div>
        )}
        {couponErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{couponErr}</div>}
      </div>

      {discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#16a34a', marginTop: 14 }}><span>Discount ({coupon.code})</span><span>−{money(discount)}</span></div>}
      {ship_ > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: discount > 0 ? 6 : 14 }}><span>Shipping (flat)</span><span>{money(ship_)}</span></div>}
      {coupon && coupon.kind === 'free_shipping' && shipFee(store) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#16a34a', marginTop: 14 }}><span>Shipping</span><span>Free</span></div>}
      {processing > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: (discount > 0 || ship_ > 0) ? 6 : 14 }}><span>Processing fee ({procPct(store)}%)</span><span>{money(processing)}</span></div>}
      {taxInfo && Number(taxInfo.tax) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: (discount > 0 || ship_ > 0 || processing > 0) ? 6 : 14 }}><span>Sales tax{taxInfo.tax_state ? ` (${taxInfo.tax_state})` : ''}</span><span>{money(Number(taxInfo.tax))}</span></div>}
      {needAddr && !taxInfo && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#94a3b8', marginTop: (discount > 0 || ship_ > 0 || processing > 0) ? 6 : 14 }}><span>Sales tax</span><span>Calculated at address</span></div>}
      <div style={{ borderTop: '1px solid #eef1f5', margin: (discount > 0 || ship_ > 0 || processing > 0 || taxInfo) ? '10px 0 0' : '18px 0', paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 900 }}>
        <span>Total</span><span>{money(payable + (taxInfo ? Number(taxInfo.tax) || 0 : 0))}</span>
      </div>

      {comped ? (
        <button className="sf-btn" onClick={submitUnpaid} disabled={busy || !validBuyer} style={{ ...cta(theme), opacity: busy || !validBuyer ? 0.5 : 1 }}>{busy ? 'Placing…' : 'Place order — covered by code'}</button>
      ) : (<>
      {store.payment_mode === 'either' && !locked && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, marginTop: 14 }}>
          {allowPaid && stripePromise && <button onClick={() => { setMethod('paid'); setClientSecret(null); }} style={methodBtn(theme, method === 'paid')}>Pay by card</button>}
          {allowUnpaid && <button onClick={() => { setMethod('unpaid'); setClientSecret(null); }} style={methodBtn(theme, method === 'unpaid')}>Put on team tab</button>}
        </div>
      )}

      {method === 'paid' && allowPaid ? (
        stripePromise ? (
          clientSecret ? (
            <>
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
                <CardForm theme={theme} onPaid={confirmPaid} />
              </Elements>
              {/* Escape hatch: go back to change the cart/coupon/details. Resuming with the
                  same order reuses its PaymentIntent (idempotent clientRef) — no duplicate. */}
              <button onClick={() => { setClientSecret(null); setPendingOrder(null); }} style={{ marginTop: 12, background: 'none', border: 'none', color: theme.subText || '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>← Edit order details</button>
            </>
          ) : <button className="sf-btn" onClick={startCard} disabled={busy || !validBuyer} style={{ ...cta(theme), opacity: busy || !validBuyer ? 0.5 : 1, marginTop: store.payment_mode === 'either' ? 0 : 14 }}>{busy ? 'Starting…' : 'Continue to payment'}</button>
        ) : <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 14 }}>Card payment isn’t set up for this store yet — please contact us.</div>
      ) : allowUnpaid ? (
        <button className="sf-btn" onClick={submitUnpaid} disabled={busy || !validBuyer} style={{ ...cta(theme), opacity: busy || !validBuyer ? 0.5 : 1 }}>{busy ? 'Placing…' : 'Place order — invoice the team'}</button>
      ) : null}
      </>)}
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
      const r = await checkoutCall({ action: 'get_order', orderId });
      if (r.error || !r.order) { setStatus('notfound'); return; }
      setOrder(r.order);
      setItems(r.items || []); setStatus('ok');
    })();
  }, [orderId]);
  if (status === 'loading') return <Splash>Loading your order…</Splash>;
  if (status === 'notfound') return <div style={{ paddingTop: 26 }}><BackLink store={store} theme={theme} /><Splash>Order not found.</Splash></div>;

  // Stage definitions — icons are SVG path strings
  const STAGE_IDX = { pending: 0, received: 1, in_production: 2, bagging: 3, shipped: 4, complete: 4 };
  const CHECK = 'M20 6 9 17l-5-5';
  const STAGES = [
    { label: 'Ordered',       icon: CHECK },
    { label: 'Received',      icon: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' },
    { label: 'In Production', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z' },
    { label: 'Bagging',       icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0' },
    { label: 'Shipped',       icon: 'M10 17h4V5H2v12h3 M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1 M14 17h1 M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z' },
  ];
  const STAGE_MSGS = [
    "Your order is in. It will be produced alongside the rest of the team's gear once the store closes.",
    "We've received and verified your order. It's queued for production with the team.",
    "Your gear is being custom-decorated right now — names, numbers, and team marks applied.",
    "Items are decorated and being sorted and bagged by player for the team delivery.",
    "Your team's order has shipped to the school. Your coach will hand out gear when it arrives.",
  ];

  // Overall stage = the LEAST-advanced real line (bundle parents don't advance), so we
  // never tell a buyer "Shipped" while items are still in production. partiallyShipped
  // flags the mixed state where some lines have moved ahead of the rest.
  const lineIdxs = items.filter((i) => !i.is_bundle_parent).map((i) => STAGE_IDX[i.line_status] ?? 0);
  const curIdx = lineIdxs.length ? Math.min(...lineIdxs) : 0;
  const maxIdx = lineIdxs.length ? Math.max(...lineIdxs) : 0;
  const partiallyShipped = maxIdx >= 4 && maxIdx > curIdx;
  const curStageLabel = STAGES[curIdx]?.label || 'Ordered';
  const displayItems = items.filter((i) => !i.bundle_product_id || i.is_bundle_parent);
  const bundleParents = displayItems.filter((i) => i.is_bundle_parent);
  const soloItems = displayItems.filter((i) => !i.is_bundle_parent);

  // Colors
  const P = theme.primary || '#192853';
  const A = theme.accent || '#962C32';
  const LINE = '#E7DFD0';
  const SUB = '#6B6256';
  const INK = '#1E2742';
  const WARM = '#F2ECE0';

  // Financials
  const paid = order.payment_mode === 'paid';
  const discount = Number(order.discount_amt) || 0;
  const shipping = Number(order.shipping_fee) || 0;
  const processing = Number(order.processing_fee) || 0;
  const tax = Number(order.tax) || 0;
  // Use the stored subtotal so it ties to the sum of the item rows above (each row
  // shows unit_price); fundraising/name add-ons are surfaced as their own line.
  const subtotal = order.subtotal != null ? Number(order.subtotal) : Number(order.total) - shipping - processing - tax + discount;
  const fundraise = Number(order.fundraise_amt) || 0;
  const totalPieces = items.reduce((s, i) => s + (Number(i.qty) || 1), 0);

  // Labels
  // Friendly running order number (migration 00177) once present; older orders
  // fall back to a short slice of the UUID so they still show *something*.
  const shortId = order.order_number ? ('#' + order.order_number) : ('#' + (order.id || '').slice(0, 8).toUpperCase());
  const placedDate = order.created_at ? new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const updatedAt = order.updated_at || order.created_at;
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + new Date(updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  // Team delivery is ~4–5 weeks after the store CLOSES (production runs once the
  // store closes), not from the order date. Show the later (5-week) edge so we
  // don't over-promise — matches the "~4–5 weeks after the store closes" copy.
  const estDelivery = store.close_at ? 'Wk of ' + new Date(new Date(store.close_at).getTime() + 35 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'TBD';
  const orderedDate = order.created_at ? new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  // Inline helpers
  const chip = (text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: A + '1a', color: A, fontFamily: DISPLAY, fontWeight: 700, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 3 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: A, flexShrink: 0 }} />{text}
    </span>
  );
  const itemChip = (lineStatus) => {
    const idx = STAGE_IDX[lineStatus] ?? 0;
    return chip(STAGES[idx]?.label || 'Ordered');
  };
  // A bundle's own parent row never advances (it has no SKU to receive against), so a
  // package's status reflects the least-advanced component it actually contains.
  const chipForLines = (lines) => {
    const idxs = lines.map((i) => STAGE_IDX[i.line_status] ?? 0);
    return chip(STAGES[idxs.length ? Math.min(...idxs) : 0]?.label || 'Ordered');
  };
  const sizeTag = (label) => (
    <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: P, border: `1px solid ${LINE}`, background: '#fff', padding: '4px 9px', borderRadius: 3, whiteSpace: 'nowrap' }}>{label}</span>
  );
  const numTag = (num) => (
    <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 0.5, color: A, border: `1px solid ${A}4d`, background: A + '0f', padding: '4px 9px', borderRadius: 3, whiteSpace: 'nowrap' }}>#{num}</span>
  );
  const imgThumb = (item, size) => item.image_url
    ? <img src={item.image_url} alt={item.name || item.sku} style={{ width: size, height: size, minWidth: size, objectFit: 'cover', borderRadius: 5, border: `1px solid ${LINE}`, display: 'block', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, minWidth: size, borderRadius: 5, background: 'linear-gradient(150deg,#F4EFE6,#E8E0D0)', border: `1px solid ${LINE}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke={P} strokeOpacity="0.2" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" /></svg>
      </div>;

  // Tracker geometry
  const nStages = STAGES.length;
  const edge = 100 / (nStages * 2);
  const fillPct = edge + (curIdx / (nStages - 1)) * (100 - edge * 2);

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 0 80px' }}>
      <style>{`@keyframes nsaPulse{0%,100%{box-shadow:0 0 0 0 ${A}70}50%{box-shadow:0 0 0 8px ${A}00}}`}</style>

      <BackLink store={store} theme={theme} />

      {/* Confirmed banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, background: '#fff', border: `1px solid ${LINE}`, borderLeft: `5px solid ${A}`, borderRadius: 8, padding: '24px 26px', marginBottom: 18 }}>
        <div style={{ flexShrink: 0, width: 60, height: 60, borderRadius: '50%', background: A, display: 'grid', placeItems: 'center', color: '#fff' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, lineHeight: 1, textTransform: 'uppercase', color: P, margin: '0 0 5px' }}>Order Confirmed</h1>
          <p style={{ fontSize: 14.5, color: SUB, margin: 0 }}>{paid ? 'Paid in full' : 'Invoiced to the team'} · confirmation sent to <strong style={{ color: INK }}>{order.buyer_email}</strong></p>
        </div>
      </div>

      {/* Meta strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: P, borderRadius: 8, overflow: 'hidden', marginBottom: 18 }}>
        {[{ label: 'Order', value: shortId }, { label: 'Placed', value: placedDate }, { label: 'Items', value: totalPieces + ' pieces' }, { label: 'Est. Delivery', value: estDelivery }].map((m, i) => (
          <div key={m.label} style={{ padding: '14px 18px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.12)' : 'none' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: A, marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, textTransform: 'uppercase', color: '#fff', lineHeight: 1.15 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Order status tracker */}
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '26px 26px 22px', marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', color: P, margin: 0 }}>Order Status</h2>
            {chip(curStageLabel)}
          </div>
          {updatedLabel && <span style={{ fontSize: 13, color: SUB }}>Updated {updatedLabel}</span>}
        </div>
        {/* Rail + nodes */}
        <div style={{ position: 'relative', padding: '4px 0' }}>
          <div style={{ position: 'absolute', left: edge + '%', right: edge + '%', top: 23, height: 3, background: LINE, zIndex: 0 }} />
          <div style={{ position: 'absolute', left: edge + '%', width: (fillPct - edge) + '%', top: 23, height: 3, background: P, zIndex: 1, transition: 'width .35s' }} />
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', zIndex: 2 }}>
            {STAGES.map((s, i) => {
              const done = i < curIdx, cur = i === curIdx;
              return (
                <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: done ? P : cur ? A : '#fff', border: `2px solid ${done ? P : cur ? A : LINE}`, display: 'grid', placeItems: 'center', zIndex: 2, position: 'relative', boxShadow: cur ? `0 0 0 4px ${A}1f` : 'none', animation: cur ? 'nsaPulse 2.2s ease-out infinite' : 'none', transition: 'all .2s' }}>
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={(done || cur) ? '#fff' : '#B8AE9C'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={done ? CHECK : s.icon} /></svg>
                  </div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', color: (done || cur) ? P : SUB, marginTop: 9, textAlign: 'center', lineHeight: 1.05 }}>{s.label}</div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: cur ? A : '#A89F8E', marginTop: 3, textAlign: 'center' }}>{cur ? 'In progress' : i === 0 ? orderedDate : ''}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Stage message */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginTop: 24, paddingTop: 18, borderTop: `1px solid ${LINE}` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: SUB, margin: 0 }}>{STAGE_MSGS[curIdx]}{partiallyShipped ? ' Some of your items have already shipped ahead of the rest — the stage above tracks the items still in progress.' : ''}</p>
        </div>
      </div>

      {/* Your Order heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: P, margin: 0, whiteSpace: 'nowrap' }}>Your Order</h2>
        <div style={{ flex: 1, height: 3, background: A, transform: 'skewX(-12deg)' }} />
      </div>

      {/* Bundle cards */}
      {bundleParents.map((item) => {
        // Match by bundle_ref (the per-line UUID) so ordering the same package twice
        // doesn't cross-list both packs' components under each card; fall back to the
        // product id for any legacy rows saved before bundle_ref existed.
        const bundleChildren = items.filter((i) => !i.is_bundle_parent && (item.bundle_ref ? i.bundle_ref === item.bundle_ref : i.bundle_product_id === item.bundle_product_id));
        const label = item.name || 'Player Pack';
        return (
          <div key={item.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderTop: `4px solid ${A}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
              <div style={{ flexShrink: 0 }}>{imgThumb(item, 64)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, textTransform: 'uppercase', color: P, lineHeight: 1.05 }}>{label}</span>
                  <span style={{ display: 'inline-block', fontFamily: DISPLAY, fontWeight: 700, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#fff', background: A, padding: '3px 9px', transform: 'skewX(-6deg)' }}>
                    <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>Bundle · {bundleChildren.length} items</span>
                  </span>
                </div>
                <div style={{ marginTop: 5 }}>{chipForLines(bundleChildren)}</div>
              </div>
              <div style={{ flexShrink: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: 21, color: P }}>{money(Number(item.unit_price) * (item.qty || 1))}</div>
            </div>
            {bundleChildren.length > 0 && (
              <div style={{ background: WARM, borderTop: `1px solid ${LINE}`, padding: '6px 20px 10px' }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: SUB, padding: '10px 0 6px' }}>Included In Package</div>
                {bundleChildren.map((child) => (
                  <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '9px 0', borderTop: `1px solid ${LINE}` }}>
                    <div style={{ flexShrink: 0 }}>{imgThumb(child, 46)}</div>
                    <div style={{ flex: 1, minWidth: 0, fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, textTransform: 'uppercase', color: INK, lineHeight: 1.1 }}>{child.name || child.sku || 'Item'}</div>
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {child.size && sizeTag('Size ' + child.size)}
                      {child.player_number && numTag(child.player_number)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Individual items */}
      {soloItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {soloItems.map((item) => {
            const label = item.name || item.sku || 'Item';
            const sub = [item.size && 'Size ' + item.size, item.player_number && '#' + item.player_number, item.player_name].filter(Boolean).join(' · ');
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ flexShrink: 0 }}>{imgThumb(item, 60)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', color: P, lineHeight: 1.05 }}>{label}{item.qty > 1 ? ` ×${item.qty}` : ''}</div>
                  {sub && <div style={{ fontSize: 13.5, color: SUB, marginTop: 2 }}>{sub}</div>}
                  <div style={{ marginTop: 6 }}>{itemChip(item.line_status)}</div>
                </div>
                <div style={{ flexShrink: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, color: P }}>{money(Number(item.unit_price) * (item.qty || 1))}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Order summary */}
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '22px 24px', marginBottom: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 15, color: SUB }}>
          {subtotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span style={{ color: INK, fontWeight: 600 }}>{money(subtotal)}</span></div>}
          {fundraise > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Team fundraiser</span><span style={{ color: INK, fontWeight: 600 }}>{money(fundraise)}</span></div>}
          {discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#1E6B3A' }}>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</span><span style={{ color: '#1E6B3A', fontWeight: 600 }}>−{money(discount)}</span></div>}
          {shipping > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Shipping</span><span style={{ color: INK, fontWeight: 600 }}>{money(shipping)}</span></div>}
          {processing > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Processing fee</span><span style={{ color: INK, fontWeight: 600 }}>{money(processing)}</span></div>}
          {tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Sales tax</span><span style={{ color: INK, fontWeight: 600 }}>{money(tax)}</span></div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: P }}>Total</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: P }}>{money(order.total)}</span>
        </div>
        {order.ship_method !== 'ship_home' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 14, color: SUB }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            Delivered to the team — no shipping needed.
          </div>
        )}
      </div>

      {order.ship_method === 'ship_home' && <ShippingBlock theme={theme} order={order} shipped={!!order.shipped_at || curIdx >= 4} onSaved={(addr) => setOrder((o) => ({ ...o, ship_address: addr }))} />}

      {/* What's next */}
      <div style={{ background: WARM, border: `1px solid ${LINE}`, borderRadius: 8, padding: '20px 24px', marginBottom: 22 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: A, marginBottom: 8 }}>What's Next</div>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: INK, margin: 0 }}>Your order has been received and will be produced with the rest of the team's gear. We'll email you each time it moves to a new stage above. Everything ships together to the team once the store closes — no separate shipping or pickup to arrange.</p>
      </div>

      {/* Contact line */}
      <p style={{ textAlign: 'center', fontSize: 13.5, color: SUB, margin: '0 0 24px' }}>
        Questions about your order? — <a href="mailto:hello@nationalsportsapparel.com" style={{ color: A, fontWeight: 600, textDecoration: 'none' }}>hello@nationalsportsapparel.com</a>
      </p>

      {/* Back button */}
      <div style={{ textAlign: 'center' }}>
        <button onClick={() => navTo('/shop/' + store.slug)} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer', background: P, color: '#fff', fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: 1.4, textTransform: 'uppercase', padding: '14px 30px', transform: 'skewX(-3deg)' }}>
          <span style={{ display: 'inline-block', transform: 'skewX(3deg)' }}>← Back To Store</span>
        </button>
      </div>
    </div>
  );
}

// Shows the order's shipping address and — until it ships — lets the buyer fix it.
function ShippingBlock({ theme, order, shipped, onSaved }) {
  const a = order.ship_address || {};
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: a.name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', zip: a.zip || '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (!f.street1 || !f.city || !f.state || !f.zip) { setMsg('Please complete street, city, state and ZIP.'); return; }
    setBusy(true); setMsg('');
    const r = await checkoutCall({ action: 'update_ship', orderId: order.id, ship: f });
    setBusy(false);
    if (r.error) { setMsg(r.error.message || 'Could not save — please try again.'); return; }
    onSaved(r.ship_address || { ...a, ...f }); setEditing(false);
  };
  return (
    <div style={{ marginTop: 22, borderTop: '1px solid #eef1f5', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>Shipping to</div>
        {!shipped && !editing && <button onClick={() => setEditing(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Edit address</button>}
      </div>
      {editing ? (
        <div>
          <Field label="Name"><input style={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Street"><input style={inp} value={f.street1} onChange={(e) => setF({ ...f, street1: e.target.value })} /></Field>
          <Field label="Apt / unit (optional)"><input style={inp} value={f.street2} onChange={(e) => setF({ ...f, street2: e.target.value })} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="City"><input style={inp} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="State"><input style={inp} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field>
            <Field label="ZIP"><input style={inp} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value })} /></Field>
          </div>
          {msg && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="sf-btn" onClick={save} disabled={busy} style={{ ...cta(theme), width: 'auto', padding: '12px 28px', fontSize: 14 }}>{busy ? 'Saving…' : 'Save address'}</button>
            <button onClick={() => { setEditing(false); setMsg(''); }} style={{ background: 'none', border: '2px solid #e2e8f0', borderRadius: theme.radius, padding: '12px 22px', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: '#0b1220', lineHeight: 1.5 }}>
          {a.name && <div>{a.name}</div>}
          <div>{a.street1}{a.street2 ? ', ' + a.street2 : ''}</div>
          <div>{a.city}{a.city ? ', ' : ''}{a.state} {a.zip}</div>
          {shipped && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>This order has shipped, so the address can no longer be changed.</div>}
        </div>
      )}
    </div>
  );
}

const qtyBtn = (disabled) => ({ width: 44, height: '100%', minHeight: 48, border: 'none', background: 'transparent', color: disabled ? '#C9BFAE' : NEUTRAL.ink, fontSize: 20, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', lineHeight: 1 });
const inp = { width: '100%', padding: '12px 13px', borderRadius: 4, border: `1px solid ${NEUTRAL.line}`, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' };
const methodBtn = (t, sel) => ({ flex: 1, padding: '13px', borderRadius: 4, border: `2px solid ${sel ? t.primary : t.line}`, background: sel ? t.primary : '#fff', color: sel ? '#fff' : t.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer' });
function Field({ label, children }) { return <div style={{ marginBottom: 14, flex: 1 }}><div style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: NEUTRAL.subText, marginBottom: 6 }}>{label}</div>{children}</div>; }

function StockLine({ onHand, incoming, eta, onOrder }) {
  if (onHand > 0) return <Pill bg="#EAF3EC" fg={STOCK.in}>● In stock — ready to decorate</Pill>;
  if (incoming) return <Pill bg="#FAF1DB" fg={STOCK.low}>{eta ? `Arriving around ${eta}` : `On the way${onOrder ? ` — ${onOrder} on order` : ''}`} · backorder available</Pill>;
  return <Pill bg="#F6E7E7" fg="#962C32">Sold out</Pill>;
}

// ── atoms ────────────────────────────────────────────────────────────
function Pill({ children, bg, fg }) { return <span style={{ display: 'inline-block', fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '7px 13px', borderRadius: 4, background: bg, color: fg }}>{children}</span>; }
function BackLink({ store, theme }) { return <button onClick={() => navTo('/shop/' + store.slug)} style={{ background: 'none', border: 'none', color: (theme && theme.subText) || '#6B6256', cursor: 'pointer', fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, padding: 0, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>← Back to store</button>; }
function Splash({ children }) { return <div style={{ minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: NEUTRAL.subText, fontSize: 15, padding: '60px 20px', fontFamily: BODY }}>{children}</div>; }
function Footer({ store, theme }) {
  // Authorized dealer wordmarks — never Nike.
  const dealers = ['Adidas', 'Under Armour', 'New Balance', 'Rawlings', 'Richardson', 'Wilson'];
  const deliver = store && store.delivery_mode === 'ship_home' ? 'shipped to your door' : 'delivered to the team';
  const colHead = { fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', marginBottom: 14, position: 'relative', paddingBottom: 10 };
  const underline = { content: '""', position: 'absolute', left: 0, bottom: 0, width: 30, height: 3, background: theme.accent };
  return (
    <footer style={{ background: theme.ink, color: 'rgba(255,255,255,0.7)', marginTop: 'auto' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '48px 24px 28px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 36 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Crest store={store} theme={theme} size={38} />
            <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#fff' }}>{store ? store.name : 'Team Store'}</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, maxWidth: 320 }}>An official team store decorated and fulfilled by National Sports Apparel, your authorized team dealer. Every order is custom-made and {deliver} when the store closes.</p>
        </div>
        <div>
          <div style={colHead}>Store Info<span style={underline} /></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9, fontSize: 14 }}>
            <li>Custom team decoration included</li>
            <li>No order minimums</li>
            <li>4–5 week team delivery</li>
            <li>Questions? hello@nationalsportsapparel.com</li>
          </ul>
        </div>
        <div>
          <div style={colHead}>Authorized Dealer<span style={underline} /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>
            {dealers.map((d) => <span key={d}>{d}</span>)}
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '16px 24px', fontSize: 12.5, letterSpacing: 0.4, color: 'rgba(255,255,255,0.6)' }}>
          © 2026 National Sports Apparel · (714) 279-8777 · hello@nationalsportsapparel.com
        </div>
      </div>
    </footer>
  );
}

// Size chips skew −4°; selected = primary fill, white text.
const sizeBtn = (t, sel) => ({ minWidth: 50, padding: '11px 14px', borderRadius: 4, border: `1px solid ${sel ? t.primary : t.line}`, background: sel ? t.primary : '#fff', color: sel ? '#fff' : t.ink, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: 0.5, cursor: 'pointer', transform: 'skewX(-4deg)' });
const thumbBtn = (t, sel) => ({ padding: '9px 18px', borderRadius: 4, border: `1px solid ${sel ? t.primary : t.line}`, background: sel ? t.primary : '#fff', color: sel ? '#fff' : t.subText, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, cursor: 'pointer' });
const cta = (t) => ({ width: '100%', padding: '0 28px', height: 50, borderRadius: 4, border: 'none', background: t.primary, color: '#fff', fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
const fieldStyle = (t, w) => ({ width: w, padding: '11px 12px', borderRadius: 4, border: `1px solid ${t.line}`, fontSize: 15, fontWeight: 600, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' });

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
