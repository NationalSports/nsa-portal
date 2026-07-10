import React, { useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';
import LogoPicker from './LogoPicker';
import PlacementPicker from './PlacementPicker';

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
// TODO(stage-5): draftLine becomes a real cart line (persistence + checkout).
//
// TODO(teamshop-landing): replace the hero placeholder below with the designed
// landing page once the approved design concept lands. Product/cart/checkout
// also mount from here in later stages.

export default function TeamShopApp() {
  const [route, setRoute] = useState('landing'); // landing|catalog|order
  const [orderCustomer, setOrderCustomer] = useState(null);
  const [orderView, setOrderView] = useState('catalog'); // catalog|logos|placement|confirmed (within the order flow)
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [draftLine, setDraftLine] = useState(null); // TODO(stage-5): replace with a real cart line

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
    setDraftLine({ product: selectedProduct, logo: selectedLogo, spec });
    setOrderView('confirmed');
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
                  {[['catalog', 'Catalog'], ['logos', 'Logos']].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setOrderView(key)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: orderView === key ? '#0f172a' : '#64748b' }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {orderView === 'catalog' && <Catalog onSelectProduct={startPlacement} />}
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
                {orderView === 'confirmed' && draftLine && (
                  <div style={{ padding: '48px 32px', textAlign: 'center' }}>
                    <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Added to design — cart coming soon</h1>
                    <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
                      {(draftLine.product && (draftLine.product.name || draftLine.product.sku)) || 'Garment'} with {(draftLine.logo && draftLine.logo.name) || 'your logo'}.
                    </p>
                    {/* TODO(stage-5): show the draft line in a real cart instead of this placeholder. */}
                    <button
                      onClick={() => setOrderView('catalog')}
                      style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Back to catalog
                    </button>
                  </div>
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
