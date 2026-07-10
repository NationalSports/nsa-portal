import React, { useEffect, useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';
import Home from './Home';
import LogoPicker from './LogoPicker';
import PlacementPicker from './PlacementPicker';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
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

export default function TeamShopApp() {
  const [route, setRoute] = useState('landing'); // landing|catalog|order
  const [orderCustomer, setOrderCustomer] = useState(null);
  const [orderView, setOrderView] = useState('catalog'); // catalog|logos|placement|confirmed|cart|checkout (within the order flow)
  const [checkoutQuote, setCheckoutQuote] = useState(null); // server quote (lines + quote_hash) handed from CartPage
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [confirmedLine, setConfirmedLine] = useState(null); // { product, logo, line } for the confirmation view text

  const { lines: cartLines, addLine } = useCart(orderCustomer && orderCustomer.id);

  useEffect(() => { ensureTeamShopStyles(); }, []);

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
    setSelectedLogo(null);
    setOrderView('logos');
  };
  const startPlacementWithLogo = (logo) => {
    setSelectedLogo(logo);
    setOrderView('placement');
  };
  const finishPlacement = (spec) => {
    const added = addLine(lineFromProduct(selectedProduct, [spec]));
    setConfirmedLine({ product: selectedProduct, logo: selectedLogo, line: added });
    setOrderView('confirmed');
  };
  // "Add blank" on a catalog card (Stage 5) — a coach can add a garment to the
  // cart with no decoration at all, skipping the logo/placement pickers.
  const addBlank = (product) => {
    addLine(lineFromProduct(product, []));
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
  // TODO(teamshop-nav): Decoration / Team Stores / Swift Ship / Search /
  // Account have no destinations yet — inert placeholders per the mockup.
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
              <button className="nts-navlink" onClick={() => setRoute('catalog')} style={navLinkStyle(route === 'catalog')}>Shop</button>
              <button className="nts-navlink" onClick={() => setRoute('catalog')} style={navLinkStyle(false)}>Apparel</button>
              <span style={inertNavStyle}>Decoration</span>
              <span style={inertNavStyle}>Team Stores</span>
              <span style={inertNavStyle}>Swift Ship</span>
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '0 auto' }}>
              {/* TODO(teamshop-nav): search overlay — inert per mockup; catalog search lives in the sidebar. */}
              <span aria-hidden="true" style={{ color: NAVY, display: 'flex' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              </span>
              {/* TODO(teamshop-nav): account view — inert per mockup. */}
              <span aria-hidden="true" style={{ color: NAVY, display: 'flex' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
              </span>
              <button
                className="nts-navlink"
                aria-label={`Cart, ${cartLines.length} items`}
                onClick={() => { setRoute('order'); setOrderView('cart'); }}
                style={{ position: 'relative', color: NAVY, display: 'flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
                <span style={{ position: 'absolute', top: -7, right: -9, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: RED, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cartLines.length}</span>
              </button>
              <button
                className="nts-cta-navy"
                onClick={() => setRoute('order')}
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
          <Home onStartOrder={() => setRoute('order')} onBrowseCatalog={() => setRoute('catalog')} />
        )}

        {route === 'catalog' && <Catalog />}

        {route === 'order' && (
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
                      onClick={() => setOrderView(key)}
                      style={{ ...displayType(15, { letterSpacing: '0.07em' }), background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: orderView === key ? RED : NAVY }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {orderView === 'catalog' && <Catalog onSelectProduct={startPlacement} onAddBlank={addBlank} />}
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
          TODO(teamshop-footer): point at real category/decoration/account
          destinations as those views land. */}
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
                onClick={() => setRoute('order')}
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
                  {items.map((item) => (
                    <li key={item}><span style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14 }}>{item}</span></li>
                  ))}
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
