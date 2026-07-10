import React from 'react';
import {
  NAVY, BORDER, TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, displayType,
} from './theme';

// One garment tile in the Team Shop catalog, styled per the approved
// "Shop - Polos" design mockup: 3:4 photo area, brand eyebrow, condensed
// display name, "Ready to decorate" line, price slot + Customize CTA.
//
// Real pricing is server-priced (see netlify/functions/quickorder-quote.js) —
// this card deliberately never computes or imports pricing tables.
// TODO(price-teaser): the mockup shows "from $XX*" here; render the real
// server-quoted teaser once a price endpoint exists. Until then: "from —".
//
// Stage 4: clicking a card (or its Customize CTA) opens the garment → logo
// placement flow via onSelect(product); anonymous browsing (no onSelect
// passed) leaves the card inert and renders the CTA as a visual pill only.
//
// Stage 5: when the coach order flow is active, TeamShopApp also passes
// onAddBlank so a coach can add the garment straight to their cart with no
// decoration (decorations: []) — kept as a small secondary action under the
// price row, preserving the pre-redesign behavior.
export default function CatalogCard({ product, stock, onSelect, onAddBlank }) {
  const img = (product && (product.image_front_url || product.image_url)) || '';
  const name = (product && (product.name || product.sku)) || '';
  const inStock = !!(stock && stock.units > 0);

  return (
    <div
      onClick={() => onSelect && onSelect(product)}
      className="nts-card"
      style={{
        background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(15,26,56,0.06)', display: 'flex', flexDirection: 'column',
        cursor: onSelect ? 'pointer' : 'default',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '3 / 4', background: 'linear-gradient(150deg,#F7F8FB 0%,#EEF1F6 55%,#E4E8F0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#C3CAD8' }}>
        {/* Badge spec from the mockup: 'Deal' = red pill, others = white pill with
            navy text + shadow, top-left of the photo. We only have live stock
            today, so "In stock" renders as the white pill. */}
        {inStock && (
          <span style={{ position: 'absolute', top: 10, left: 10, background: '#fff', color: NAVY, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, boxShadow: '0 2px 8px rgba(15,26,56,0.14)', zIndex: 1 }}>
            In stock
          </span>
        )}
        {img ? (
          <img src={img} alt={name} loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <>
            {/* Fallback only — real image_front_url renders above when present. */}
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10L6 11 4 7z" /></svg>
            <span style={displayType(11, { letterSpacing: '0.14em', color: TEXT_FAINT })}>Product Photo</span>
          </>
        )}
      </div>
      <div style={{ padding: '15px 17px 17px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT_MUTED, fontWeight: 600 }}>
          {(product && product.brand) || ''}
        </span>
        <div style={displayType(18, { color: NAVY, lineHeight: 1.15, letterSpacing: '0.01em' })}>{name}</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: GREEN, marginTop: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
          Ready to decorate
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 12, gap: 8 }}>
          <div style={{ fontSize: 15, color: TEXT, fontWeight: 600 }}>
            from — <small style={{ color: TEXT_MUTED, fontWeight: 500, fontSize: 12 }}>ea</small>
          </div>
          {onSelect ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect(product); }}
              className="nts-cta-navy"
              style={{ fontWeight: 600, fontSize: 13, background: NAVY, color: '#fff', border: 'none', padding: '9px 15px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Customize
            </button>
          ) : (
            <span style={{ fontWeight: 600, fontSize: 13, background: NAVY, color: '#fff', padding: '9px 15px', borderRadius: 8 }}>Customize</span>
          )}
        </div>
        {onAddBlank && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddBlank(product); }}
            style={{ marginTop: 8, alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: TEXT_MUTED, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Add blank
          </button>
        )}
      </div>
    </div>
  );
}
