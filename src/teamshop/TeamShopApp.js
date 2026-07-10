import React, { useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import Catalog from './Catalog';

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
// TODO(teamshop-landing): replace the hero placeholder below with the designed
// landing page once the approved design concept lands. Product/cart/checkout
// also mount from here in later stages.

export default function TeamShopApp() {
  const [route, setRoute] = useState('landing'); // landing|catalog|order
  const [orderCustomer, setOrderCustomer] = useState(null);

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
            {!orderCustomer ? <TeamPicker onSelect={setOrderCustomer} /> : <Catalog />}
          </CoachGate>
        )}
      </main>

      <footer style={{ padding: '16px 32px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        A National Sports Apparel company
      </footer>
    </div>
  );
}
