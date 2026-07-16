import React, { useEffect, useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';
import ProductPage from './ProductPage';
import ProductLoadingSkeleton from './ProductLoadingSkeleton';
import Home from './Home';
import DecorationPage from './DecorationPage';
import FAQPage from './FAQPage';
import Search from './Search';
import TeamStoresPage from './TeamStoresPage';
import StartWithLogo from './StartWithLogo';
import LogoPicker from './LogoPicker';
import PlacementPicker from './PlacementPicker';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
import AccountPage from './AccountPage';
import ChatWidget from './ChatWidget';
import TabBar from './TabBar';
import { useCart } from './cart';
import useCoachSession from './useCoachSession';
import { STORAGE_KEY as NTS_CUSTOMER_KEY } from './TeamPicker';
import { supabaseCoach } from '../lib/supabaseCoach';
import { getProductBySku } from './productBySku';
import { useTeamShopRoute, parseRoute } from './useTeamShopRoute';
import {
  ensureTeamShopStyles, NAVY, NAVY_DARK, RED, BORDER, TEXT_MUTED, FONT_BODY, displayType,
} from './theme';

// Team Shop storefront chunk root — nationalteamshop.com lands here (and
// /teamshop on any host, for deploy previews / e2e), routed by src/index.js
// via src/lib/hostRouting.js. Lazy-loaded so portal visitors never download it.
//
// Stage 1: a minimal structural landing shell only. Deliberately unstyled
// beyond the basics — the real landing design arrives later from an approved
// design concept.
//
// Stage 2 adds coach sign-in (CoachGate), team context (TeamPicker), and an
// anonymous garment catalog browse (Catalog), wired together with a tiny
// internal route switch below — no router library, just local state, per the
// "lightweight internal routing" scope for this stage.
//
// Stage 3 adds the team logo library (LogoPicker) as a 'logos' view inside the
// signed-in order flow — Catalog stays the default after TeamPicker.
//
// Stage 4 wires the real garment → logo placement flow: a catalog card click
// opens LogoPicker in select mode, choosing a logo opens PlacementPicker (the
// decoSpec engine + DecoOverlay preview) for that product/logo pair, and
// confirming there stores the resulting decoSpec as an in-memory "draft line"
// and shows a placeholder confirmation.
//
// Stage 5 replaces that in-memory draft line with a real cart (src/teamshop/cart.js,
// localStorage, keyed per customer) and a live-priced CartPage — a garment can
// also be added straight to the cart without decoration ("Add blank" on a
// catalog card, or "Also add without decoration" once a line is decorated).
//
// Stage 6 adds checkout (CheckoutPage): CartPage hands its server quote
// (lines + quote_hash) to onCheckout, CheckoutPage collects contact/shipping,
// places the order through netlify/functions/teamshop-checkout.js, and takes
// card payment via Stripe Elements (finalized by webstore-checkout).
//
// The landing view renders Home.js — the approved "National Team Shop - Home"
// Claude Design mockup, translated section-by-section (hero, brand strip,
// category panels/tiles, value props, how-it-works, decoration styles,
// featured products, social proof). Header/footer below are shared across
// every view, landing included, so Home.js is content-only.
//
// Stage 7 adds StartWithLogo.js — the approved "Start With Your Logo" Claude
// Design mockup. Every path into the 'order' route IS a "Start with your
// logo" CTA (hero, footer, popup, how-it-works, header/footer buttons all
// call the same handler), so StartWithLogo is the entry chrome for that
// route: it wraps CoachGate -> TeamPicker -> LogoPicker with the mockup's
// hero copy/stepper/live-preview card until the coach reaches the mockup's
// "Done" step and continues ("Start shopping"), at which point the derived
// `inOrderShell` flips true (see the Stage 11 routing note below) and the
// pre-existing nav/orderView switch (unchanged) takes over for the rest of
// the session — including mid-flow re-visits to the 'logos' sub-view, which
// stay in their plain Stage-3 styling.
//
// Logo-first wiring: choosing a logo before any product is picked
// (StartWithLogo's onLogoChosen) sets selectedLogo and, since selectedProduct
// is still null, lands on 'catalog' (see startPlacementWithLogo). The very
// next product picked from there skips the 'logos' step entirely (see
// startPlacement) and goes straight to 'placement' with that logo — the
// "logo select -> catalog -> placement" path the mockup implies. That
// carried-over logo is a one-shot convenience for the very next product only
// (cleared in finishPlacement): every product after that goes through the
// 'logos' step again, same as the pre-existing product-first path.
//
// Stage 8 adds ProductPage.js — the approved "Product - Performance Polo"
// Claude Design mockup — as a detail stage BETWEEN a catalog card click and
// the logo/placement flow, in both places a card can be clicked:
//   - the anonymous top-level catalog (route === 'catalog'): a card now opens
//     the product page (previously inert with no onSelectProduct at all);
//     anonymous browsing stays anonymous — "Add blank" is still unavailable
//     there (matches the pre-existing behavior of that route), and
//     "Customize with your logo" gates to sign-in via the existing
//     goStartWithLogo() -> StartWithLogo -> CoachGate/TeamPicker path, same
//     as every other "Start with your logo" CTA.
//   - the signed-in order flow's catalog (orderView === 'catalog'): a card
//     opens the product page instead of jumping straight to 'logos'/
//     'placement'; "Customize" there calls the existing startPlacement()
//     unchanged (logo carry included), and "Add blank" calls the existing
//     addBlank() unchanged.
// previewProduct is the in-memory row backing whichever product the URL
// currently names (see the Stage 11 routing note below) — set alongside the
// `navTo('product', ...)` call a catalog/search card click makes, so the
// product page paints immediately with zero refetch; a cold/forward/back
// arrival at `/product/:sku` with no matching row re-fetches it by sku
// (getProductBySku) behind a loading skeleton.
//
// Stage 9 adds AccountPage.js — the approved "Account" Claude Design mockup,
// the LAST page in the approved design set — as a new top-level 'account'
// route (same tier as 'landing'/'catalog'/'order'). It's the destination for
// the header Account icon and the footer's "My logos"/"Reorder" links
// (previously all inert TODO(teamshop-nav) placeholders). It shares
// orderCustomer/setOrderCustomer with the rest of the app — same
// 'nts_customer' localStorage key, one team context everywhere — via
// AccountPage's customer/onCustomerSelect props. accountSection tells it
// which section to scroll to (see goAccount below); "Order help" now routes
// to FAQPage — see goFAQ below.
//
// Stage 10 adds FAQPage.js ('faq' route) and Search.js ('search' route) —
// the approved "Help Center" and "Search" Claude Design mocks, both
// content-only components rendered inside this shared header/footer, same
// convention as every other view. FAQPage's copy is grounded in real system
// facts (see faqData.js), not the mock's placeholder numbers. Search reuses
// the exact same search_products RPC + CatalogCard + colorway grouping the
// top-level catalog already uses (see Search.js) — no forked search or card
// logic. The header's search icon (previously an inert TODO(teamshop-nav)
// placeholder) now opens 'search' via goSearch below.
//
// Stage 11 adds real URL + browser-history routing (useTeamShopRoute.js):
// `route`/`orderView`/`catalogCategory`/`decorationMethod`/`accountSection`
// are now all DERIVED from the parsed URL instead of living in their own
// useState — a deep link, refresh, or Back/Forward reconstructs the exact
// view. `enteredShop` (the old standalone flag deciding StartWithLogo vs. the
// CoachGate shell) is GONE entirely, replaced by `inOrderShell`, derived the
// same way every render — see that comment below. Product also moves from
// "state nested inside whichever catalog you were on" to its own top-level
// `/product/:sku` route: a catalog/search card click still sets
// `previewProduct` before navigating (so the page paints with zero refetch),
// but a cold/forward/back arrival with no matching row fetches it
// (getProductBySku) behind ProductLoadingSkeleton. Money/session state
// (cart lines, the checkout quote, the coach session, the ?handoff= code,
// orderCustomer's pricing) is never put in the URL — see useTeamShopRoute.js.

export default function TeamShopApp() {
  const { route, navTo } = useTeamShopRoute();
  // Zero-fetch view state, all derived from the parsed URL (see
  // useTeamShopRoute.js's parseRoute) — none of these are their own useState
  // anymore, so a deep link/refresh/Back/Forward always reconstructs exactly
  // what the address bar says, with no separate flag to fall out of sync.
  const catalogCategory = route.name === 'catalog' ? route.category : null;
  const decorationMethod = route.name === 'decoration' ? route.method : 'embroidery';
  const accountSection = route.name === 'account' ? route.section : null;
  const orderView = route.name === 'cart' ? 'cart'
    : route.name === 'order' ? route.orderView : null; // start|catalog|logos|placement|checkout|confirmed
  // True once the coach has moved past StartWithLogo's entry chrome into the
  // CoachGate-gated shell (tab bar + catalog/logos/placement/confirmed/cart/
  // checkout) — replaces the old standalone `enteredShop` useState, which the
  // popstate listener never touched and could desync from Back/Forward.
  // Derived fresh from the URL every render instead: bare `/order` (i.e.
  // `orderView==='start'`) is StartWithLogo; every other `/order/*` sub-view,
  // and the top-level `/cart`, are the shell.
  const inOrderShell = route.name === 'cart' || (route.name === 'order' && route.orderView !== 'start');

  // orderCustomer's cold-load rehydration is scoped to the order funnel: a
  // shared `/product`, `/catalog`, or landing link must stay anonymous even
  // when this browser has a saved `nts_customer` from an earlier order — see
  // the routing plan's §3. Only `/cart` and non-'start' `/order/*` URLs
  // rehydrate it at mount; every other route starts (and, for `/product`,
  // stays — see productBySku.js) anonymous.
  const [orderCustomer, setOrderCustomer] = useState(() => {
    const r = parseRoute();
    const inFunnel = r.name === 'cart' || (r.name === 'order' && r.orderView !== 'start');
    if (!inFunnel) return null;
    try { return JSON.parse(window.localStorage.getItem(NTS_CUSTOMER_KEY)) || null; } catch { return null; }
  });
  const [checkoutQuote, setCheckoutQuote] = useState(null); // server quote (lines + quote_hash) handed from CartPage
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [confirmedLine, setConfirmedLine] = useState(null); // { product, logo, line } for the confirmation view text
  const [previewProduct, setPreviewProduct] = useState(null); // product row backing the current /product/:sku route, if any

  const { lines: cartLines, addLine } = useCart(orderCustomer && orderCustomer.id);
  const { signedIn: coachSignedIn } = useCoachSession(); // header sign-in label only

  useEffect(() => { ensureTeamShopStyles(); }, []);

  // Route-keyed normalization/guards — re-runs on every route change (not
  // mount-only), so forward/back re-entry is re-guarded exactly like a cold
  // load, not just the first visit:
  //   - /product/:sku: fetch by sku UNLESS `previewProduct` already matches
  //     (a catalog/search click already set it) — unknown sku replaces to
  //     /catalog, hidden behind the skeleton.
  //   - /order/placement with no product+logo drafted → replace to
  //     /order/logos.
  //   - /order/checkout with no quote, OR a quote drafted for a DIFFERENT
  //     customer than the one now signed in (stale foreign-team totals) →
  //     replace to /cart. Ownership check, not just presence.
  //   - /order/confirmed with no confirmed line → replace to /cart.
  useEffect(() => {
    if (route.name === 'product') {
      if (previewProduct && previewProduct.sku === route.sku) return undefined;
      let alive = true;
      getProductBySku(route.sku).then((row) => {
        if (!alive) return;
        if (row) setPreviewProduct(row);
        else navTo('catalog', {}, { replace: true });
      });
      return () => { alive = false; };
    }
    if (route.name === 'order') {
      if (route.orderView === 'placement' && !(selectedProduct && selectedLogo)) {
        navTo('order', { orderView: 'logos' }, { replace: true });
      } else if (route.orderView === 'checkout'
        && (!checkoutQuote || checkoutQuote.customer_id !== (orderCustomer && orderCustomer.id))) {
        navTo('cart', {}, { replace: true }); // ownership check — never show a stale/foreign-team quote
      } else if (route.orderView === 'confirmed' && !confirmedLine) {
        navTo('cart', {}, { replace: true });
      }
    }
    return undefined;
  }, [route.name, route.orderView, route.sku, previewProduct, selectedProduct, selectedLogo, checkoutQuote, confirmedLine, orderCustomer, navTo]);

  // Belt-and-suspenders: a team switch clears in-memory drafts tied to the
  // PREVIOUS team, so a stale selectedProduct/selectedLogo/checkoutQuote from
  // one team's session can never bleed into another's (no-op on first mount —
  // all three already start null).
  useEffect(() => {
    setCheckoutQuote(null);
    setSelectedProduct(null);
    setSelectedLogo(null);
    // eslint-disable-next-line
  }, [orderCustomer && orderCustomer.id]);

  // ── Connect → Team Shop handoff arrival (Coach Crossover, Workstream 1) ──
  // A ?handoff=<code> in the URL is a one-time server-minted code from the
  // Connect portal (netlify/functions/teamshop-handoff.js). Exchange it for a
  // { token_hash, email } pair and finish sign-in with verifyOtp — the sign-in
  // credential itself never appears in the URL, only the opaque single-use
  // code, which is stripped from the address bar either way. ANY failure
  // (expired code, network, verifyOtp) falls through silently to normal
  // anonymous browsing — CoachGate appears where it always does, never an
  // error wall.
  const [handoffBusy, setHandoffBusy] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('handoff'); } catch { return false; }
  });
  // alpha_tag of the Connect portal the coach came from — persisted for the
  // tab session so the header's "← Back to Connect" link survives navigation.
  const [connectTag, setConnectTag] = useState(() => {
    try { return window.sessionStorage.getItem('nts_connect_return') || null; } catch { return null; }
  });
  useEffect(() => {
    if (!handoffBusy) return undefined;
    let alive = true;
    (async () => {
      let code = null;
      try { code = new URLSearchParams(window.location.search).get('handoff'); } catch { /* no URL API — fall through */ }
      try {
        const res = await fetch('/.netlify/functions/teamshop-handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exchange', code }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.token_hash || !json.email) throw new Error('handoff exchange failed');
        const { error } = await supabaseCoach.auth.verifyOtp({ type: 'email', email: json.email, token_hash: json.token_hash });
        if (error) throw error;
        if (json.alpha_tag) {
          try { window.sessionStorage.setItem('nts_connect_return', json.alpha_tag); } catch { /* sessionStorage unavailable */ }
          if (alive) setConnectTag(json.alpha_tag);
        }
        if (json.customer_id) {
          // Preselect the handed-off team through the existing mechanism:
          // the same 'nts_customer' localStorage key TeamPicker/AccountPage
          // persist to, plus the live orderCustomer state for this render.
          const cust = { id: json.customer_id, name: json.customer_name || '' };
          try { window.localStorage.setItem(NTS_CUSTOMER_KEY, JSON.stringify(cust)); } catch { /* selection just won't persist */ }
          if (alive) setOrderCustomer(cust);
        }
      } catch (e) {
        // Silent fall-through to anonymous browsing (see comment above).
      } finally {
        try {
          const params = new URLSearchParams(window.location.search);
          params.delete('handoff');
          const qs = params.toString();
          window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
        } catch { /* leave the URL as-is */ }
        if (alive) setHandoffBusy(false);
      }
    })();
    return () => { alive = false; };
    // Run-once on mount; handoffBusy's initial value decides whether there's anything to do.
    // eslint-disable-next-line
  }, []);

  // Every "Start with your logo" CTA (hero, header, footer, popup,
  // how-it-works) shares this handler — it (re)enters the StartWithLogo
  // entry chrome (bare /order → orderView 'start'). The cart icon is the one
  // path into the order shell that is NOT a "Start with your logo" CTA — it
  // jumps straight to the existing top-level cart view.
  const goStartWithLogo = () => navTo('order');
  const goCart = () => { setPreviewProduct(null); navTo('cart'); };
  // Entering the top-level catalog fresh (nav/header/Home CTAs) always starts
  // at the grid, never mid-way through a stale product-page preview.
  // `categoryKey` (optional) is a launch-category key from categories.js —
  // Home's category tiles and the footer's Shop links pass one so the
  // catalog opens pre-filtered to that category; every other caller (nav
  // Shop/Apparel, Home's other CTAs) omits it and lands on 'All'.
  const goCatalog = (categoryKey) => { setPreviewProduct(null); navTo('catalog', categoryKey ? { category: categoryKey } : {}); };
  // Account icon (header) and footer "My logos"/"Reorder" links all land
  // here; `section` scrolls AccountPage to the right part ('logos'|'orders').
  const goAccount = (section) => { setPreviewProduct(null); navTo('account', section ? { section } : {}); };
  // AccountPage's Reorder button (Stage 8): fetch the order's first item's
  // product row — same anon `products` read categoryHeroes.js already relies
  // on (RLS: products_select `for select using (true)`) — and open it on the
  // shared top-level /product/:sku route (see the route.name==='product'
  // branch below), setting `previewProduct` first so it paints with zero
  // refetch (the guard effect above skips the fetch once sku matches).
  const reorderProduct = async (productId) => {
    if (!productId) return;
    try {
      const { data, error } = await supabaseCoach.from('products')
        .select('id,sku,name,brand,image_front_url,category')
        .eq('id', productId).limit(1);
      if (error || !data || !data[0]) return;
      const row = data[0];
      setPreviewProduct(row);
      navTo('product', { sku: row.sku });
    } catch { /* no-op — the coach stays on Account */ }
  };
  // Header "Decoration" nav item, footer Decoration column links, and Home's
  // "How we decorate" cards all land here — `method` defaults to whatever's
  // already selected (nav item) or picks a specific variant (footer/Home
  // links, and DecorationPage's own "Other methods" cards via onSelectMethod
  // below). navTo scrolls to top on push, so switching methods from "Other
  // methods" reads as a fresh page, not a silent mid-scroll content swap.
  const goDecoration = (method) => navTo('decoration', method ? { method } : {});

  // Footer "FAQ" link (Help column) and the Account column's "Order help*"
  // link (previously inert — see FOOTER_ACCOUNT_ACTIONS below) both land
  // here. Header search icon opens 'search' — see goSearch below.
  const goFAQ = () => { setPreviewProduct(null); navTo('faq'); };
  // Header search icon — the one TODO(teamshop-nav) placeholder this build
  // resolves. Reuses the same previewProduct/ProductPage flow the top-level
  // catalog uses for a result card click (see the 'search' route below).
  const goSearch = () => { setPreviewProduct(null); navTo('search'); };
  // Header "Team Stores" nav item and the footer's "Team Stores" link land
  // here — TeamStoresPage, the approved "Team Stores" mock. Its store finder
  // reuses the /team-stores directory's webstores_public query (see
  // src/lib/publicTeamStores.js).
  const goTeamStores = () => { setPreviewProduct(null); navTo('stores'); };

  const lineFromProduct = (product, decorations) => ({
    product_id: product && product.id,
    product_name: (product && (product.name || product.sku)) || '',
    image_url: (product && (product.image_front_url || product.image_url)) || '',
    sku: product && product.sku,
    qty: 1,
    decorations,
  });

  const startPlacement = (product) => {
    setSelectedProduct(product);
    // A logo already selected (via the logo-first StartWithLogo entry) skips
    // straight to placement for this one product; see the Stage-7 comment
    // above the component. Otherwise, the classic product-first path: pick a
    // logo for this product via the 'logos' step.
    navTo('order', { orderView: selectedLogo ? 'placement' : 'logos' });
  };
  // Signed-in catalog card click: the logo-first one-shot carryover (see the
  // Stage-7 comment) still skips straight to the existing PlacementPicker for
  // this one product. Otherwise (the normal product-first click), open the
  // shared top-level product page (see the route.name==='product' branch
  // below) — set-then-nav, batched, so it paints with zero refetch.
  const selectProductFromCatalog = (product) => {
    if (selectedLogo) startPlacement(product);
    else { setPreviewProduct(product); navTo('product', { sku: product.sku }); }
  };
  const startPlacementWithLogo = (logo) => {
    setSelectedLogo(logo);
    // No product chosen yet (logo-first entry) — browse the in-shop catalog
    // next; a product already in hand (product-first, or "change logo"
    // mid-flow) — go straight to placement. Also the StartWithLogo entry's
    // onLogoChosen handler (bare /order → here) — reaching either
    // 'catalog' or 'placement' makes `inOrderShell` true, replacing the old
    // separate `setEnteredShop(true)` call that used to sit alongside this.
    navTo('order', { orderView: selectedProduct ? 'placement' : 'catalog' });
  };
  const finishPlacement = (spec) => {
    const added = addLine(lineFromProduct(selectedProduct, [spec]));
    setConfirmedLine({ product: selectedProduct, logo: selectedLogo, line: added });
    // Consume the one-shot logo-first carry-over — subsequent products go
    // through the 'logos' step again, same as the product-first path always has.
    setSelectedLogo(null);
    // replace: the confirmation is a mutation RESULT, not a step a shopper
    // should be able to hit Forward back into after leaving — same reason
    // Storefront.js-style flows replace on a terminal step.
    navTo('order', { orderView: 'confirmed' }, { replace: true });
  };
  // "Add blank" on a catalog card (Stage 5) — a coach can add a garment to the
  // cart with no decoration at all, skipping the logo/placement pickers.
  const addBlank = (product) => {
    addLine(lineFromProduct(product, []));
  };

  // "Customize with your logo" from the top-level product page's anonymous
  // mode: there's no order flow to continue yet (no coach signed in, maybe
  // no product picked before now), so this stashes the product as the
  // logo-first path already does with selectedLogo (see the Stage-7 comment)
  // and hands off to the same goStartWithLogo() every other CTA uses. Once
  // the coach reaches the order flow's catalog with this product already in
  // selectedProduct, startPlacementWithLogo/startPlacement pick it up exactly
  // like the pre-existing product-first and logo-first paths do.
  const previewCustomize = (product) => {
    setSelectedProduct(product);
    setPreviewProduct(null);
    goStartWithLogo();
  };

  // Header/footer visual design per the approved "Shop - Polos" Claude Design
  // mockup. View routing logic is unchanged — nav items map onto the existing
  // route/orderView state; mockup destinations that don't exist yet render as
  // inert labels with TODOs.
  const navLinkStyle = (active) => ({
    ...displayType(16, { letterSpacing: '0.07em' }),
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: active ? RED : NAVY,
  });
  // TODO(teamshop-nav): Swift Ship has no destination yet — inert placeholder
  // per the mockup. (Account routes to AccountPage — see goAccount above;
  // Decoration routes to DecorationPage — see goDecoration above; Team Stores
  // routes to TeamStoresPage — see goTeamStores above.)
  const inertNavStyle = { ...displayType(16, { letterSpacing: '0.07em' }), color: NAVY, cursor: 'default' };

  return (
    <div className="nts-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#2A2F3E', fontFamily: FONT_BODY }}>
      {handoffBusy && (
        <div style={{ background: NAVY, color: '#fff', textAlign: 'center', fontSize: 13, fontWeight: 600, padding: '6px 12px' }}>Signing you in…</div>
      )}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.97)', backdropFilter: 'saturate(180%) blur(8px)', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 24px 4px' }}>
          {/* Centered brand lockup — logo dead-center, thin tagline balanced
              beneath it so the whole mark reads as one centered unit. */}
          <button
            onClick={() => navTo('landing')}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, margin: '0 auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Real National Sports Apparel logo (public/), light-bg treatment
                  per CoachPortal.js — size by height, never stretched. The
                  "Team Shop" sub-brand rides alongside it. */}
              <img src="/NEW NSA Logo on white.png" alt="National Sports Apparel" style={{ height: 40, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
              <span style={displayType('clamp(15px, 1.7vw, 18px)', { letterSpacing: '0.18em', color: NAVY, lineHeight: 1, borderLeft: `1px solid ${BORDER}`, paddingLeft: 12 })}>Team Shop</span>
            </span>
          </button>
          {/* Menu bar: nav centered, utilities pinned right via a balanced
              1fr / auto / 1fr track so the nav stays optically centered. */}
          <div className="nts-header-row2" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, padding: '8px 0 4px' }}>
            {/* Left spacer doubles as the reverse handoff link — only shown
                when this tab arrived via a Connect handoff with a known
                portal alpha_tag (set in the arrival effect above). */}
            {connectTag ? (
              <a
                href={`https://nationalsportsapparel.com/?portal=${encodeURIComponent(connectTag)}`}
                style={{ justifySelf: 'start', fontSize: 13, fontWeight: 600, color: TEXT_MUTED, textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                ← Back to Connect
              </a>
            ) : <span />}
            <nav className="nts-header-nav" style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="nts-navlink" onClick={() => goCatalog()} style={navLinkStyle(route.name === 'catalog')}>Shop</button>
              <button className="nts-navlink" onClick={() => goCatalog()} style={navLinkStyle(false)}>Apparel</button>
              <button className="nts-navlink" onClick={() => goDecoration()} style={navLinkStyle(route.name === 'decoration')}>Decoration</button>
              <button className="nts-navlink" onClick={goTeamStores} style={navLinkStyle(route.name === 'stores')}>Team Stores</button>
              <span style={inertNavStyle}>Swift Ship</span>
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifySelf: 'end' }}>
              <button
                className="nts-navlink"
                aria-label="Search"
                onClick={goSearch}
                style={{ color: route.name === 'search' ? RED : NAVY, display: 'flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              </button>
              {/* Coach sign-in must be VISIBLE, not an unlabeled icon — signing in
                  unlocks team pricing, so the label sells the reason to do it. */}
              <button
                className="nts-navlink"
                aria-label="Account"
                onClick={() => goAccount()}
                style={{ color: route.name === 'account' ? RED : NAVY, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
                <span className="nts-signin-label" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.15, textAlign: 'left' }}>
                  {coachSignedIn ? 'My account' : (
                    <>Coach sign-in<span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: TEXT_MUTED }}>for team pricing</span></>
                  )}
                </span>
              </button>
              <button
                className="nts-navlink"
                aria-label={`Cart, ${cartLines.length} items`}
                onClick={goCart}
                style={{ position: 'relative', color: NAVY, display: 'flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
                <span style={{ position: 'absolute', top: -7, right: -9, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: RED, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cartLines.length}</span>
              </button>
              <button
                className="nts-cta-navy nts-header-cta"
                onClick={goStartWithLogo}
                style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 14, background: NAVY, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                Start with your logo
              </button>
            </div>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {route.name === 'landing' && (
          <Home onStartOrder={goStartWithLogo} onBrowseCatalog={goCatalog} onOpenDecoration={goDecoration} onOpenStores={goTeamStores} />
        )}

        {route.name === 'decoration' && (
          <DecorationPage
            method={decorationMethod}
            onSelectMethod={goDecoration}
            onShopMethod={goCatalog}
          />
        )}

        {route.name === 'catalog' && (
          <Catalog key={`catalog-${route.category || 'all'}`} onSelectProduct={(product) => { setPreviewProduct(product); navTo('product', { sku: product.sku }); }} initialCategory={catalogCategory} />
        )}

        {route.name === 'faq' && <FAQPage />}

        {route.name === 'stores' && <TeamStoresPage />}

        {route.name === 'search' && (
          <Search
            onSelectProduct={(product) => { setPreviewProduct(product); navTo('product', { sku: product.sku }); }}
            onBrowseCatalog={goCatalog}
            initialQuery={route.q}
            initialCategory={route.category}
            onQueryChange={(q, category) => navTo('search', q ? { q, category } : {}, { replace: true })}
          />
        )}

        {/* Product detail is now its own top-level route (/product/:sku),
            reachable from any catalog context (anonymous top-level catalog,
            search, or the signed-in order flow's in-shop catalog) instead of
            being nested state inside whichever one you clicked from — see
            the Stage 11 comment above the component and the route-keyed
            guard effect, which fetches by sku on cold/forward/back entry.
            Mode is driven by `orderCustomer` (signed-in vs anonymous), NOT by
            which catalog the shopper came from — a bare /product URL is
            deliberately context-free (see useTeamShopRoute.js's §3 note on
            orderCustomer's funnel-scoped cold-load rehydration): a coach with
            an active session sees "Add to order"/"Add blank" here even from
            the anonymous catalog; a shared/cold link always starts
            anonymous. onBack/onAddBlank use the real browser history (Back
            "closes" the product page for free, returning to whichever
            catalog/search view pushed this route) rather than guessing which
            catalog to return to. */}
        {route.name === 'product' && (
          previewProduct && previewProduct.sku === route.sku ? (
            <ProductPage
              product={previewProduct}
              customer={orderCustomer}
              onBack={() => window.history.back()}
              onCustomize={previewCustomize}
              onAddBlank={orderCustomer ? (product) => { addBlank(product); window.history.back(); } : undefined}
              onAddToOrder={orderCustomer ? (lines) => {
                lines.forEach((line) => addLine(line));
                setPreviewProduct(null);
                goCart();
              } : undefined}
            />
          ) : (
            <ProductLoadingSkeleton />
          )
        )}

        {route.name === 'account' && (
          <AccountPage
            section={accountSection}
            customer={orderCustomer}
            onCustomerSelect={setOrderCustomer}
            onReorder={reorderProduct}
          />
        )}

        {route.name === 'order' && orderView === 'start' && (
          <StartWithLogo
            customer={orderCustomer}
            onCustomerSelect={setOrderCustomer}
            onLogoChosen={startPlacementWithLogo}
          />
        )}

        {inOrderShell && (
          <CoachGate>
            {!orderCustomer ? (
              <TeamPicker onSelect={setOrderCustomer} />
            ) : (
              <>
                <nav style={{ display: 'flex', gap: 24, justifyContent: 'center', padding: '14px 32px 0' }}>
                  {[['catalog', 'Catalog'], ['logos', 'Logos'], ['cart', `Cart${cartLines.length ? ` (${cartLines.length})` : ''}`]].map(([key, label]) => (
                    <button
                      key={key}
                      className="nts-navlink"
                      onClick={() => { setPreviewProduct(null); if (key === 'cart') navTo('cart'); else navTo('order', { orderView: key }); }}
                      style={{ ...displayType(15, { letterSpacing: '0.07em' }), background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: orderView === key ? RED : NAVY }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {orderView === 'catalog' && (
                  <Catalog onSelectProduct={selectProductFromCatalog} onAddBlank={addBlank} />
                )}
                {orderView === 'logos' && (
                  <LogoPicker
                    customer={orderCustomer}
                    onSelect={startPlacementWithLogo}
                  />
                )}
                {orderView === 'placement' && selectedProduct && selectedLogo && (
                  <PlacementPicker
                    product={selectedProduct}
                    logo={selectedLogo}
                    onDone={finishPlacement}
                    onBack={() => navTo('order', { orderView: 'logos' })}
                  />
                )}
                {orderView === 'confirmed' && confirmedLine && (
                  <div style={{ padding: '48px 32px', textAlign: 'center' }}>
                    <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Added to your cart</h1>
                    <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
                      {(confirmedLine.product && (confirmedLine.product.name || confirmedLine.product.sku)) || 'Garment'} with {(confirmedLine.logo && confirmedLine.logo.name) || 'your logo'}.
                    </p>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                      <button
                        onClick={() => navTo('cart')}
                        style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        View cart
                      </button>
                      <button
                        onClick={() => navTo('order', { orderView: 'catalog' })}
                        style={{ background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Keep shopping
                      </button>
                    </div>
                  </div>
                )}
                {orderView === 'cart' && (
                  <CartPage
                    customer={orderCustomer}
                    onKeepShopping={() => navTo('order', { orderView: 'catalog' })}
                    onCheckout={(quote) => { setCheckoutQuote(quote); navTo('order', { orderView: 'checkout' }); }}
                  />
                )}
                {orderView === 'checkout' && (
                  <CheckoutPage
                    customer={orderCustomer}
                    quote={checkoutQuote}
                    onBack={() => navTo('cart')}
                  />
                )}
              </>
            )}
          </CoachGate>
        )}
      </main>

      {/* Footer per the mockup. Column links are inert placeholders —
          TODO(teamshop-footer): point at real category/decoration
          destinations as those views land. (Account's "My logos"/"Reorder"/
          "Order help" and the Help column's "FAQ" now route to real
          destinations — see FOOTER_ACCOUNT_ACTIONS below.) */}
      <footer style={{ background: NAVY_DARK, color: 'rgba(255,255,255,0.72)', padding: 'clamp(48px, 6vw, 72px) 24px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 40, paddingBottom: 40, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                {/* Dark-footer treatment: navy+red logo rendered white via the
                    same filter CoachPortal.js uses, so it reads on the navy. */}
                <img src="/NEW NSA Logo on white.png" alt="National Sports Apparel" style={{ height: 32, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.95, flexShrink: 0 }} />
                <span style={displayType(16, { letterSpacing: '0.16em', color: '#fff', borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 12 })}>Team Shop</span>
              </div>
              <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.6)', maxWidth: 280 }}>
                Quick-turn team gear, decorated in-house and shipped in days.
              </p>
              <button
                className="nts-cta-red"
                onClick={goStartWithLogo}
                style={{ display: 'inline-block', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, background: RED, color: '#fff', border: 'none', padding: '11px 20px', borderRadius: 8, cursor: 'pointer' }}
              >
                Start with your logo
              </button>
            </div>
            {[
              // Shop column: relabeled to match the real launch categories
              // (categories.js) instead of the mockup's original "Polos &
              // Performance" / "Caps & Headwear" / "Uniforms" copy — Uniforms
              // isn't a launch category at all, so it's replaced with Tees.
              ['Shop', ['Polos', 'Hoodies & Fleece', 'Hats', 'Tees']],
              ['Decoration', ['Embroidery', 'DTF Print', 'Heat Applications', 'Saved Logos']],
              ['Account', ['My logos', 'Reorder', 'Order help']],
              ['Help', ['FAQ', 'Team Stores']],
            ].map(([heading, items]) => (
              <div key={heading}>
                <p style={displayType(13, { letterSpacing: '0.12em', color: '#fff', margin: '0 0 16px' })}>{heading}</p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {items.map((item) => {
                    // FOOTER_ACCOUNT_ACTIONS: the Account column's "My
                    // logos"/"Reorder"/"Order help" route to AccountPage/
                    // FAQPage; the Shop column's category links route to the
                    // catalog pre-filtered to that launch category; the
                    // Decoration column's method links (renamed "Heat
                    // Applications" per the approved design) route to
                    // DecorationPage with the matching method; the Help
                    // column's "FAQ" routes to FAQPage. "Saved Logos" stays
                    // an inert TODO(teamshop-footer) placeholder — no
                    // destination exists for it yet.
                    const action = heading === 'Account' && item === 'My logos' ? () => goAccount('logos')
                      : heading === 'Account' && item === 'Reorder' ? () => goAccount('orders')
                        : heading === 'Account' && item === 'Order help' ? () => goFAQ()
                          : heading === 'Help' && item === 'FAQ' ? () => goFAQ()
                            : heading === 'Help' && item === 'Team Stores' ? () => goTeamStores()
                            : heading === 'Shop' && item === 'Polos' ? () => goCatalog('polos')
                              : heading === 'Shop' && item === 'Hoodies & Fleece' ? () => goCatalog('hoodies')
                                : heading === 'Shop' && item === 'Hats' ? () => goCatalog('hats')
                                  : heading === 'Shop' && item === 'Tees' ? () => goCatalog('tees')
                                    : heading === 'Decoration' && item === 'Embroidery' ? () => goDecoration('embroidery')
                                      : heading === 'Decoration' && item === 'DTF Print' ? () => goDecoration('dtf')
                                        : heading === 'Decoration' && item === 'Heat Applications' ? () => goDecoration('heat')
                                          : null;
                    return (
                      <li key={item}>
                        {action ? (
                          <button
                            className="nts-footlink"
                            onClick={action}
                            style={{ background: 'none', border: 'none', padding: 0, color: 'rgba(255,255,255,0.72)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                          >
                            {item}
                          </button>
                        ) : (
                          <span style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14 }}>{item}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingTop: 24 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>© 2026 National Team Shop. A National Sports Apparel company.</p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {/* TODO(teamshop-footer): legal pages. */}
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Privacy</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Terms</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Shipping &amp; Returns</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile bottom tab bar (Home/Shop/Stores/Account) — hidden on
          desktop, see `.nts-tabbar` in theme.js. Mounted outside the route
          switch, same convention as ChatWidget below, so it survives
          navigation. */}
      <TabBar
        active={route.name === 'landing' ? 'home' : route.name === 'catalog' ? 'shop' : route.name === 'stores' ? 'stores' : route.name === 'account' ? 'account' : null}
        onHome={() => navTo('landing')}
        onShop={() => goCatalog()}
        onStores={goTeamStores}
        onAccount={() => goAccount()}
      />

      {/* Team Shop Assistant — floating chat widget, available on every
          storefront view (mounted here, outside the route switch, so it
          survives navigation). v1 is a canned/rule-based bot, no AI
          backend — see ChatWidget.js. */}
      <ChatWidget customer={orderCustomer} onOpenAccount={() => goAccount()} onOpenDecoration={goDecoration} />
    </div>
  );
}
