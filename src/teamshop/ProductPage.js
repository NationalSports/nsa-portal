import React, { useState } from 'react';
import {
  NAVY, RED, BORDER, BORDER_DARK, TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, OFF_WHITE, displayType,
} from './theme';

// Product detail page — new stage inserted between a catalog card click and
// the existing logo/placement flow, per the approved "Product - Performance
// Polo" Claude Design mockup. Faithful translation notes:
//
// - Gallery: the mockup's front/back view toggle + thumbnail row + a live
//   logo-preview overlay driven by its own component state (color/method/
//   placement pickers that only exist in the design tool). We render the
//   real product photos (image_front_url/image_back_url) with the mockup's
//   placeholder look as a fallback, but do NOT reimplement the mockup's
//   logo-preview/placement/color/method pickers here — that's PlacementPicker
//   (src/teamshop/decoSpec.js + src/lib/decoOverlay.js) one screen later,
//   and duplicating it here would be exactly the "hand-synced duplicate
//   logic" this repo already has too much of.
// - Color swatches: the mockup's <sc-for list="{{ colors }}"> assumes a
//   structured colorway list. search_products only returns a single `color`
//   string per row (see supabase/migrations/00151_..._exclude_api_vendors.sql)
//   plus an untyped `_colors` jsonb blob with no stable shape used anywhere
//   else in this codebase — not enough to safely render clickable swatches.
//   TODO(colors): render real swatches once product rows carry a structured
//   colorway list; until then this is a single-color name readout (still
//   faithful to the mockup's "Color" label + value row) plus a TODO placeholder.
// - Sizes: display-only chips from available_sizes (falls back to the same
//   default run Catalog/CatalogCard's neighbors use elsewhere in the repo).
//   Actual size/qty selection is a cart-level concern (CartPage), unchanged
//   here — clicking a chip does nothing per this comment, not a bug.
// - Decoration method: explainer only (Embroidery / DTF Print / Heat Press),
//   matching the mockup's three method tiles — no method is "selected" here;
//   the real method choice happens in PlacementPicker.
// - Price: "from —" per the existing CatalogCard TODO(price-teaser) — no
//   client-side pricing exists in this codebase (netlify/functions/
//   quickorder-quote.js is the only source of truth), so this page doesn't
//   invent one either.
// - Related products: omitted (not a real fetch) rather than reusing
//   CatalogCard with an ad-hoc related-products query — the mockup doesn't
//   actually spec a related-products strip (it ends at the roster/actions
//   block), and there's no existing "related" notion in search_products to
//   query faithfully. TODO(related-products): add a strip once a real
//   relatedness signal (category/brand match via search_products) is wanted.
//
// props: { product, onCustomize(product), onAddBlank(product), onBack }

const DECO_METHODS = [
  { key: 'embroidery', label: 'Embroidery', note: 'Polos · caps · jackets' },
  { key: 'dtf', label: 'DTF Print', note: 'Full-color · gradients' },
  { key: 'heat', label: 'Heat Press', note: 'Names · numbers' },
];

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

function GalleryPane({ product }) {
  const [view, setView] = useState('front');
  const front = product && (product.image_front_url || product.image_url);
  const back = product && product.image_back_url;
  const hasBack = !!back;
  const img = view === 'back' ? back : front;
  const name = (product && (product.name || product.sku)) || '';

  const tabStyle = (active) => ({
    fontFamily: 'inherit', fontWeight: 600, fontSize: 13, padding: '6px 14px', borderRadius: 999,
    border: 'none', cursor: 'pointer', background: active ? NAVY : 'transparent', color: active ? '#fff' : TEXT_MUTED,
  });

  return (
    <div style={{ position: 'sticky', top: 150 }}>
      <div style={{ position: 'relative', aspectRatio: '4 / 5', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(150deg,#F7F8FB,#E8ECF4)' }}>
        {hasBack && (
          <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 2, display: 'flex', gap: 6, background: 'rgba(255,255,255,0.9)', border: `1px solid ${BORDER}`, borderRadius: 999, padding: 4 }}>
            <button type="button" onClick={() => setView('front')} style={tabStyle(view === 'front')}>Front</button>
            <button type="button" onClick={() => setView('back')} style={tabStyle(view === 'back')}>Back</button>
          </div>
        )}
        {img ? (
          <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: TEXT_FAINT }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10L6 11 4 7z" /></svg>
            <span style={displayType(12, { letterSpacing: '0.16em', color: TEXT_FAINT })}>{view === 'front' ? 'Garment Photo — Front' : 'Garment Photo — Back'}</span>
          </span>
        )}
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 12, color: TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 7 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
        Final proof approved before production.*
      </p>
    </div>
  );
}

export default function ProductPage({ product, onCustomize, onAddBlank, onBack }) {
  const brand = (product && product.brand) || '';
  const name = (product && (product.name || product.sku)) || '';
  const sku = product && product.sku;
  const colorName = product && product.color;
  const sizes = (product && Array.isArray(product.available_sizes) && product.available_sizes.length)
    ? product.available_sizes
    : DEFAULT_SIZES;

  return (
    <div className="nts-root" style={{ width: '100%' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 0', fontSize: 13, color: TEXT_MUTED }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: TEXT_MUTED, fontSize: 13, fontFamily: 'inherit' }}>
          ← Back to catalog
        </button>
      </div>

      <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 24px clamp(48px,6vw,80px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'clamp(32px,4vw,56px)', alignItems: 'start' }}>
        <GalleryPane product={product} />

        <div>
          <p style={displayType(13, { letterSpacing: '0.14em', color: TEXT_MUTED, margin: '0 0 6px' })}>{brand}</p>
          <h1 style={displayType('clamp(2rem,3.6vw,2.6rem)', { color: NAVY, margin: '0 0 10px', lineHeight: 1.04, letterSpacing: '0.01em' })}>{name}</h1>
          {sku && <p style={{ margin: '0 0 18px', fontSize: 13, color: TEXT_MUTED }}>SKU {sku}</p>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
            {/* TODO(price-teaser): no client-side pricing; a real server-quoted
                teaser can replace this once one exists (see CatalogCard). */}
            <span style={{ fontSize: 20, fontWeight: 600, color: TEXT }}>
              from — <span style={{ fontSize: 13, color: TEXT_MUTED, fontWeight: 500 }}>/ pc</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: GREEN, background: '#EAF3EE', border: '1px solid #D4E7DC', padding: '5px 12px', borderRadius: 999 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: GREEN }} />
              Ready to decorate
            </span>
          </div>

          {/* COLOR — see the TODO(colors) note atop this file. */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <span style={displayType(14, { letterSpacing: '0.08em', color: NAVY })}>Color</span>
              <span style={{ fontSize: 13, color: TEXT_MUTED }}>{colorName || 'Not specified'}</span>
            </div>
            {colorName ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span
                  aria-label={colorName}
                  style={{ width: 38, height: 38, borderRadius: 999, border: `2px solid ${NAVY}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: 999, background: BORDER_DARK, border: '1px solid rgba(15,26,56,0.15)' }} />
                </span>
              </div>
            ) : (
              // TODO(colors): products don't carry a structured colorway list
              // yet — this placeholder row stands in for the mockup's swatches.
              <div style={{ border: `1px dashed ${BORDER_DARK}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: TEXT_FAINT }}>
                Color options coming soon
              </div>
            )}
          </div>

          {/* DECORATION METHOD — explainer only; the real choice happens in
              PlacementPicker one screen later. */}
          <div style={{ marginBottom: 26 }}>
            <span style={displayType(14, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 12 })}>Decoration method</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {DECO_METHODS.map((m) => (
                <div key={m.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '13px 8px', borderRadius: 10, background: '#fff', color: NAVY, border: `1.5px solid ${BORDER}` }}>
                  <span style={displayType(15, { letterSpacing: '0.04em' })}>{m.label}</span>
                  <span style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{m.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIZES — display-only chips per the design; actual size/qty
              selection stays a cart-level concern (CartPage), unchanged. */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 22, background: OFF_WHITE, marginBottom: 24 }}>
            <span style={displayType(15, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 6 })}>Available sizes</span>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: TEXT_MUTED }}>Size and quantity are set in your cart after adding this garment.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {sizes.map((s) => (
                <span key={s} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 600, color: NAVY }}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* ACTIONS */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="nts-cta-red"
              onClick={() => onCustomize && onCustomize(product)}
              style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 17, letterSpacing: '0.02em', padding: '17px 28px', border: 'none', borderRadius: 8, cursor: 'pointer', textTransform: 'uppercase', fontFamily: 'inherit' }}
            >
              Customize with your logo
            </button>
            {onAddBlank && (
              <button
                type="button"
                onClick={() => onAddBlank(product)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: 'transparent', color: NAVY, fontWeight: 600, fontSize: 16, padding: '17px 26px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Add blank
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
