import React, { useEffect, useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';
import ProductPage from './ProductPage';
import Home from './Home';
import StartWithLogo from './StartWithLogo';
import LogoPicker from './LogoPicker';
import PlacementPicker from './PlacementPicker';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
import AccountPage from './AccountPage';
import { useCart } from './cart';
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
// "Done" step and continues ("Start shopping"), at which point `enteredShop`
// flips true and the pre-existing nav/orderView switch (unchanged) takes
// over for the rest of the session — including mid-flow re-visits to the
// 'logos' sub-view, which stay in their plain Stage-3 styling.
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
// previewProduct is the one piece of state for this: which product (if any)
// is showing on the product page, in whichever catalog context the coach is
// currently in. Setting it back to null (onBack) returns to that catalog's
// grid.
//
// Stage 9 adds AccountPage.js — the approved "Account" Claude Design mockup,
// the LAST page in the approved design set — as a new top-level 'account'
// route (same tier as 'landing'/'catalog'/'order'). It's the destination for
// the header Account icon and the footer's "My logos"/"Reorder" links
// (previously all inert TODO(teamshop-nav) placeholders). It shares
// orderCustomer/setOrderCustomer with the rest of the app — same
// 'nts_customer' localStorage key, one team context everywhere — via
// AccountPage's customer/onCustomerSelect props. accountSection tells it
// which section to scroll to (see goAccount below); "Order help*" stays
// inert, there's nowhere for it to go yet.

export default function TeamShopApp() {
  const [route, setRoute] = useState('landing'); // landing|catalog|order|account
  const [enteredShop, setEnteredShop] = useState(false); // false while StartWithLogo owns the 'order' route
  const [orderCustomer, setOrderCustomer] = useState(null);
  const [orderView, setOrderView] = useState('catalog'); // catalog|logos|placement|confirmed|cart|checkout (within the order flow)
  const [checkoutQuote, setCheckoutQuote] = useState(null); // server quote (lines + quote_hash) handed from CartPage
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [confirmedLine, setConfirmedLine] = useState(null); // { product, logo, line } for the confirmation view text
  const [previewProduct, setPreviewProduct] = useState(null); // product shown on ProductPage, in either catalog context
  const [accountSection, setAccountSection] = useState(null); // which AccountPage section to scroll to, if any

  const { lines: cartLines, addLine } = useCart(orderCustomer && orderCustomer.id);

  useEffect(() => { ensureTeamShopStyles(); }, []);

  // Every "Start with your logo" CTA (hero, header, footer, popup,
  // how-it-works) shares this handler — it (re)enters the StartWithLogo
  // entry chrome. The cart icon is the one path into 'order' that is NOT a
  // "Start with your logo" CTA — it jumps straight to the existing cart view.
  const goStartWithLogo = () => { setRoute('order'); setEnteredShop(false); };
  const goCart = () => { setRoute('order'); setEnteredShop(true); setOrderView('cart'); setPreviewProduct(null); };
  // Entering the top-level catalog fresh (nav/header/Home CTAs) always starts
  // at the grid, never mid-way through a stale product-page preview.
  const goCatalog = () => { setRoute('catalog'); setPreviewProduct(null); };
  // Account icon (header) and footer "My logos"/"Reorder" links all land
  // here; `section` scrolls AccountPage to the right part ('logos'|'orders').
  const goAccount = (section) => { setRoute('account'); setAccountSection(section || null); setPreviewProduct(null); };

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
    if (selectedLogo) {
      setOrderView('placement');
    } else {
      setOrderView('logos');
    }
  };
  const startPlacementWithLogo = (logo) => {
    setSelectedLogo(logo);
    // No product chosen yet (logo-first entry) — browse the catalog next;
    // a product already in hand (product-first, or "change logo" mid-flow) —
    // go straight to placement.
    setOrderView(selectedProduct ? 'placement' : 'catalog');
  };
  const finishPlacement = (spec) => {
    const added = addLine(lineFromProduct(selectedProduct, [spec]));
    setConfirmedLine({ product: selectedProduct, logo: selectedLogo, line: added });
    // Consume the one-shot logo-first carry-over — subsequent products go
    // through the 'logos' step again, same as the product-first path always has.
    setSelectedLogo(null);
    setOrderView('confirmed');
  };
  // "Add blank" on a catalog card (Stage 5) — a coach can add a garment to the
  // cart with no decoration at all, skipping the logo/placement pickers.
  const addBlank = (product) => {
    addLine(lineFromProduct(product, []));
  };

  // "Customize with your logo" from the anonymous top-level catalog's product
  // page: there's no order flow to continue yet (no coach signed in, maybe
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
  // TODO(teamshop-nav): Decoration / Team Stores / Swift Ship / Search have
  // no destinations yet — inert placeholders per the mockup. (Account now
  // routes to AccountPage — see goAccount above.)
  const inertNavStyle = { ...displayType(16, { letterSpacing: '0.07em' }), color: NAVY, cursor: 'default' };

  return (
    <div className="nts-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#2A2F3E', fontFamily: FONT_BODY }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.97)', backdropFilter: 'saturate(180%) blur(8px)', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 24px 0' }}>
          <div className="nts-header-grid" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
            <span />
            <button
              onClick={() => setRoute('landing')}
              style={{ display: 'flex', alignItems: 'center', gap: 13, justifySelf: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {/* Real National Sports Apparel logo (public/), light-bg treatment
                  per CoachPortal.js — size by height, never stretched. The
                  "Team Shop" sub-brand rides alongside it. */}
              <img src="/NEW NSA Logo on white.png" alt="National Sports Apparel" style={{ height: 44, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
              <span style={displayType('clamp(15px, 1.7vw, 19px)', { letterSpacing: '0.18em', color: NAVY, lineHeight: 1, borderLeft: `1px solid ${BORDER}`, paddingLeft: 13 })}>Team Shop</span>
            </button>
            <span className="nts-header-tagline" style={{ justifySelf: 'end', textAlign: 'right', fontSize: 13.5, fontWeight: 500, color: TEXT_MUTED, maxWidth: 280, lineHeight: 1.45 }}>
              Free decoration setup* · Saved logos · Fast turnaround, days not weeks*
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', flexWrap: 'wrap' }}>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 30, flexWrap: 'wrap', margin: '0 auto' }}>
              <button className="nts-navlink" onClick={goCatalog} style={navLinkStyle(route === 'catalog')}>Shop</button>
              <button className="nts-navlink" onClick={goCatalog} style={navLinkStyle(false)}>Apparel</button>
              <span style={inertNavStyle}>Decoration</span>
              <span style={inertNavStyle}>Team Stores</span>
              <span style={inertNavStyle}>Swift Ship</span>
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '0 auto' }}>
              {/* TODO(teamshop-nav): search overlay — inert per mockup; catalog search lives in the sidebar. */}
              <span aria-hidden="true" style={{ color: NAVY, display: 'flex' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              </span>
              <button
                className="nts-navlink"
                aria-label="Account"
                onClick={() => goAccount()}
                style={{ color: route === 'account' ? RED : NAVY, display: 'flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
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
                className="nts-cta-navy"
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
        {route === 'landing' && (
          <Home onStartOrder={goStartWithLogo} onBrowseCatalog={goCatalog} />
        )}

        {route === 'catalog' && !previewProduct && (
          <Catalog onSelectProduct={setPreviewProduct} />
        )}
        {route === 'catalog' && previewProduct && (
          <ProductPage
            product={previewProduct}
            onBack={() => setPreviewProduct(null)}
            onCustomize={previewCustomize}
            // No onAddBlank here — anonymous browsing has never offered
            // "Add blank" (no cart to add to without a signed-in customer);
            // unchanged from the pre-existing anonymous Catalog's behavior.
          />
        )}

        {route === 'account' && (
          <AccountPage
            section={accountSection}
            customer={orderCustomer}
            onCustomerSelect={setOrderCustomer}
          />
        )}

        {route === 'order' && !enteredShop && (
          <StartWithLogo
            customer={orderCustomer}
            onCustomerSelect={setOrderCustomer}
            onLogoChosen={(logo) => { setEnteredShop(true); startPlacementWithLogo(logo); }}
          />
        )}

        {route === 'order' && enteredShop && (
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
                      onClick={() => { setOrderView(key); setPreviewProduct(null); }}
                      style={{ ...displayType(15, { letterSpacing: '0.07em' }), background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: orderView === key ? RED : NAVY }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {orderView === 'catalog' && !previewProduct && (
                  <Catalog onSelectProduct={setPreviewProduct} onAddBlank={addBlank} />
                )}
                {orderView === 'catalog' && previewProduct && (
                  <ProductPage
                    product={previewProduct}
                    onBack={() => setPreviewProduct(null)}
                    onCustomize={(product) => { setPreviewProduct(null); startPlacement(product); }}
                    onAddBlank={(product) => { addBlank(product); setPreviewProduct(null); }}
                  />
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
                    onBack={() => setOrderView('logos')}
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
                        onClick={() => setOrderView('cart')}
                        style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        View cart
                      </button>
                      <button
                        onClick={() => setOrderView('catalog')}
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
                    onKeepShopping={() => setOrderView('catalog')}
                    onCheckout={(quote) => { setCheckoutQuote(quote); setOrderView('checkout'); }}
                  />
                )}
                {orderView === 'checkout' && (
                  <CheckoutPage
                    customer={orderCustomer}
                    quote={checkoutQuote}
                    onBack={() => setOrderView('cart')}
                  />
                )}
              </>
            )}
          </CoachGate>
        )}
      </main>

      {/* Footer per the mockup. Column links are inert placeholders —
          TODO(teamshop-footer): point at real category/decoration
          destinations as those views land. (Account's "My logos"/"Reorder"
          now route to AccountPage — see FOOTER_ACCOUNT_ACTIONS below;
          "Order help*" stays inert, there's nowhere for it to go yet.) */}
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
              ['Shop', ['Polos & Performance', 'Hoodies & Fleece', 'Caps & Headwear', 'Uniforms']],
              ['Decoration', ['Embroidery', 'DTF Print', 'Heat Press', 'Saved Logos']],
              ['Account', ['My logos', 'Reorder', 'Order help*']],
            ].map(([heading, items]) => (
              <div key={heading}>
                <p style={displayType(13, { letterSpacing: '0.12em', color: '#fff', margin: '0 0 16px' })}>{heading}</p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {items.map((item) => {
                    // FOOTER_ACCOUNT_ACTIONS: only the Account column's "My
                    // logos"/"Reorder" have a real destination (AccountPage);
                    // every other footer link, including "Order help*",
                    // stays an inert TODO(teamshop-footer) placeholder.
                    const action = heading === 'Account' && item === 'My logos' ? () => goAccount('logos')
                      : heading === 'Account' && item === 'Reorder' ? () => goAccount('orders')
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
    </div>
  );
}
