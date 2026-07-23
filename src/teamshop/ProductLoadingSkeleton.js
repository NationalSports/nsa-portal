import React from 'react';
import { OFF_WHITE, BORDER } from './theme';

// Shown on `/product/:sku` while the single cold fetch (getProductBySku)
// resolves — cold load / refresh / forward-nav re-entry only; a catalog or
// search card click sets previewProduct before navTo, so that path never
// sees this (see TeamShopApp.js's route-keyed guard effect). Deliberately
// minimal: a garment-shaped placeholder + shimmer, never a hollow
// ProductPage rendered with a null product.
const shimmer = {
  background: `linear-gradient(90deg, ${OFF_WHITE} 25%, #fff 37%, ${OFF_WHITE} 63%)`,
  backgroundSize: '400% 100%',
  animation: 'nts-skeleton-shimmer 1.4s ease infinite',
};

export default function ProductLoadingSkeleton() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px) 24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(24px, 4vw, 48px)' }} className="nts-product-skeleton">
      <style>{'@keyframes nts-skeleton-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }'}</style>
      <div aria-hidden="true" style={{ aspectRatio: '1 / 1', borderRadius: 12, border: `1px solid ${BORDER}`, ...shimmer }} />
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
        <div style={{ width: '40%', height: 14, borderRadius: 4, ...shimmer }} />
        <div style={{ width: '75%', height: 30, borderRadius: 6, ...shimmer }} />
        <div style={{ width: '30%', height: 20, borderRadius: 4, ...shimmer }} />
        <div style={{ width: '100%', height: 1, background: BORDER, margin: '10px 0' }} />
        <div style={{ width: '90%', height: 14, borderRadius: 4, ...shimmer }} />
        <div style={{ width: '85%', height: 14, borderRadius: 4, ...shimmer }} />
        <div style={{ width: '60%', height: 14, borderRadius: 4, ...shimmer }} />
        <div style={{ width: 180, height: 46, borderRadius: 8, marginTop: 16, ...shimmer }} />
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} role="status">Loading product…</span>
    </div>
  );
}
