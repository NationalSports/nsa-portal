import React from 'react';

// Team Shop storefront chunk root — nationalteamshop.com lands here (and
// /teamshop on any host, for deploy previews / e2e), routed by src/index.js
// via src/lib/hostRouting.js. Lazy-loaded so portal visitors never download it.
//
// Stage 1: a minimal structural landing shell only. Deliberately unstyled
// beyond the basics — the real landing design arrives later from an approved
// design concept.
//
// TODO(teamshop-landing): replace the hero placeholder below with the designed
// landing page once the approved design concept lands. Routes/pages (catalog,
// product, cart, checkout) also mount from here in later stages.

export default function TeamShopApp() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ padding: '20px 32px', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>
          National Team Shop
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
        {/* Hero placeholder — swapped for the approved landing design (see TODO above). */}
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Your logo. Team-quality gear.</h1>
          <p style={{ fontSize: 15, color: '#64748b', marginTop: 12 }}>
            The National Team Shop storefront is coming soon.
          </p>
        </div>
      </main>

      <footer style={{ padding: '16px 32px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        A National Sports Apparel company
      </footer>
    </div>
  );
}
