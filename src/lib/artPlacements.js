// src/lib/artPlacements.js
// Shared logo placements for the store builder's Art Studio mock AND the public
// storefront, so the on-garment position matches between the staff preview and
// what shoppers see. x/y = the logo's center as a % of the garment image;
// w = the logo width as a % of the image width.
export const ART_PLACEMENTS = [
  { id: 'left_chest', label: 'Left chest', x: 67, y: 33, w: 20 },
  { id: 'full_front', label: 'Full front', x: 50, y: 45, w: 40 },
  { id: 'full_back', label: 'Full back', x: 50, y: 43, w: 44 },
  { id: 'left_sleeve', label: 'L. sleeve', x: 83, y: 58, w: 13 },
  { id: 'right_sleeve', label: 'R. sleeve', x: 17, y: 58, w: 13 },
  { id: 'center', label: 'Center', x: 50, y: 50, w: 34 },
];
export const placementById = (id) => ART_PLACEMENTS.find((p) => p.id === id) || ART_PLACEMENTS[0];
