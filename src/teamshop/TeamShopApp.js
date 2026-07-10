import React, { useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';
import LogoPicker from './LogoPicker';
import PlacementPicker from './PlacementPicker';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
import { useCart } from './cart';

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
// TODO(teamshop-landing): replace the hero placeholder below with the designed
// landing page once the approved design concept lands. Product/cart/checkout
// also mount from here in later stages.

export default function TeamShopApp() {
  const [route, setRoute] = useState('landing'); // landing|catalog|order
  const [orderCustomer, setOrderCustomer] = useState(null);
  const [orderView, setOrderView] = useState('catalog'); // catalog|logos|placement|confirmed|cart|checkout (within the order flow)
  const [checkoutQuote, setCheckoutQuote] = useState(null); // server quote (lines + quote_hash) handed from CartPage
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [confirmedLine, setConfirmedLine] = useState(null); // { product, logo, line } for the confirmation view text

  const { lines: cartLines, addLine } = useCart(orderCustomer && orderCustomer.id);

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ padding: '20px 32px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => setRoute('landing')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'inherit', color: 'inherit' }}
        >
          National Team Shop
        </button>
        <nav style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
          <button
            onClick={() => setRoute('landing')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: route === 'landing' ? '#0f172a' : '#64748b' }}
          >
            Home
          </button>
          <button
            onClick={() => setRoute('catalog')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: route === 'catalog' ? '#0f172a' : '#64748b' }}
          >
            Catalog
          </button>
        </nav>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {route === 'landing' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
            {/* Hero placeholder — swapped for the approved landing design (see TODO above). */}
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Your logo. Team-quality gear.</h1>
              <p style={{ fontSize: 15, color: '#64748b', marginTop: 12 }}>
                The National Team Shop storefront is coming soon.
              </p>
              <button
                onClick={() => setRoute('order')}
                style={{ marginTop: 20, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Start an order
              </button>
            </div>
          </div>
        )}

        {route === 'catalog' && <Catalog />}

        {route === 'order' && (
          <CoachGate>
            {!orderCustomer ? (
              <TeamPicker onSelect={setOrderCustomer} />
            ) : (
              <>
                <nav style={{ display: 'flex', gap: 16, justifyContent: 'center', padding: '14px 32px 0' }}>
                  {[['catalog', 'Catalog'], ['logos', 'Logos'], ['cart', `Cart${cartLines.length ? ` (${cartLines.length})` : ''}`]].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setOrderView(key)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: orderView === key ? '#0f172a' : '#64748b' }}
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

      <footer style={{ padding: '16px 32px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        A National Sports Apparel company
      </footer>
    </div>
  );
}
