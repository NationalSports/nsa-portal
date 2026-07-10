import React from 'react';

// One garment tile in the anonymous Team Shop catalog browse.
//
// Real pricing is server-priced (see netlify/functions/quickorder-quote.js) —
// this card deliberately never computes or imports pricing tables; it renders
// a placeholder until a later stage wires up a real quote.
//
// Stage 4: clicking a card opens the garment → logo placement flow (see
// TeamShopApp's order view) via onSelect(product); anonymous browsing (no
// onSelect passed) leaves the card inert.
export default function CatalogCard({ product, stock, onSelect }) {
  const img = (product && (product.image_front_url || product.image_url)) || '';
  const inStock = !!(stock && stock.units > 0);

  return (
    <div
      onClick={() => onSelect && onSelect(product)}
      style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff', cursor: onSelect ? 'pointer' : 'default' }}
    >
      <div style={{ aspectRatio: '1 / 1', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {img ? (
          <img src={img} alt={(product && product.name) || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>No photo</span>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {(product && product.brand) || ''}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '2px 0 6px' }}>
          {(product && (product.name || product.sku)) || ''}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>from —</span>
          {inStock && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>In stock</span>}
        </div>
      </div>
    </div>
  );
}
