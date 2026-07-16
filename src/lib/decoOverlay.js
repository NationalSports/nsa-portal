// Shared decoration overlay renderer — composites applied logo art (the
// webstore_products.decorations JSON: { art_url, side, x, y, w, placement, ... })
// on top of a garment image as CSS percent-positioned <img> layers.
//
// Moved verbatim from src/storefront/Storefront.js so the Team Shop picker can
// preview placements with the EXACT same renderer the live public storefront
// uses — one source of truth for how a decorations entry turns into pixels.
// Keep this module dependency-light (React + artPlacements only); it must never
// import Storefront or Team Shop code.
import React from 'react';
import { placementById } from './artPlacements';

// Per-color web-logo override (mirrors the store builder): a deco's cw_by_color maps a
// lowercased garment color -> the web logo to show for that color (e.g. a white logo on a
// black tee); falls back to the placed art_url.
export const decoUrlForColor = (d, colorName) => {
  const k = String(colorName || '').trim().toLowerCase();
  const v = d && d.cw_by_color && k && d.cw_by_color[k]; // bare url (legacy) or { url, color_way_id }
  return (typeof v === 'string' ? v : (v && v.url) || '') || (d && d.art_url) || '';
};

// Applied logo art (from webstore_products.decorations) composited on the
// garment image at its placement — the on-screen mock shoppers see. colorName picks the
// per-color web logo so the right color way shows for the active variant.
export function DecoOverlay({ decorations, side = 'front', colorName }) {
  if (!Array.isArray(decorations)) return null;
  // Skip `baked` decorations — their logo is already rendered into the garment image (a
  // Quick Mock), so overlaying it again would double-stamp. They're retained on the record
  // only so the store→SO conversion still knows what art to print.
  return <>{decorations.filter((d) => d && !d.baked && (d.side || 'front') === side && decoUrlForColor(d, colorName)).map((d, i) => {
    const pl = placementById(d.placement);
    // A decoration may carry its own x/y/w (editable placement) overriding the preset.
    const x = d.x != null ? d.x : pl.x, y = d.y != null ? d.y : pl.y, w = d.w != null ? d.w : pl.w;
    return <img key={i} src={decoUrlForColor(d, colorName)} alt="" loading="lazy" style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${w}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))', zIndex: 1 }} />;
  })}</>;
}

export default DecoOverlay;
