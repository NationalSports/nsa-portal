// Momentec 3D garment catalog.
//
// The vendor package intentionally separates physical garment geometry from
// production artwork:
//   1. one GLB + normal map per garment cut;
//   2. one UV-aligned SVG atlas per approved design line.
//
// A model is safe to preview as soon as `modelReady` is true. It is NOT safe to
// show a multi-panel design until its exact supplier atlas has been installed.
// Keeping those states separate prevents camera-projected or guessed artwork
// from being mistaken for a production layout.

export const MOMENTEC_STYLE_IDS = [
  '2P8S2S', '4B3VTA', '4B3VTB', '4R3CHA', '4R3VTB', '4R6VTB', '5R2LGB', '5R2LGM',
  '5S1S2S', '5S1S2X', '6R3CHA', '7B3VTA', '7B3VTB', '7D6S2X', '7D7S2X', '7D7VTX',
  '7R3CHA', '7R3VTB', '7R6VTB', '329X3B', '329X3M', '346LGB', '347LGS', '684VTS',
  '745VTG', '745VTX', '746LGG', '746LGX', '756S2X', '756VTX', '227130', '228015',
  '228103', '228108', '228110', '228111', '228112', '228113', '228114', '228118',
  '228119', '228120', '228121', '228122', '228123', '228124', '228125', '228126',
  '228129', '228137',
];

const MODEL_ROOT = '/uniform/catalog/momentec/models';
const ATLAS_READY_STYLES = new Set(['4R3CHA']);

// Only product identities confirmed from Momentec's product catalog belong
// here. The remaining files stay available for audit without being presented
// to customers under a guessed sport, gender, or garment type.
const VERIFIED_PRODUCTS = {
  '2P8S2S': { name: 'Dynaspeed Short Sleeve Compression', sport: 'multisport', garment: 'top', program: 'adult' },
  '4B3VTA': { name: 'Dynaspeed Basketball Jersey', sport: 'basketball', garment: 'jersey', program: 'mens' },
  '4B3VTB': { name: 'Dynaspeed 10-inch Basketball Shorts', sport: 'basketball', garment: 'shorts', program: 'mens' },
  '4R3CHA': { name: 'Elite Basketball Jersey', sport: 'basketball', garment: 'jersey', program: 'mens', mates: ['4R3VTB', '4R6VTB'] },
  '4R3VTB': { name: 'Elite 8-inch Basketball Shorts', sport: 'basketball', garment: 'shorts', program: 'mens', mates: ['4R3CHA'] },
  '4R6VTB': { name: 'Elite 6-inch Basketball Shorts', sport: 'basketball', garment: 'shorts', program: 'mens', mates: ['4R3CHA'] },
  '6R3CHA': { name: 'Youth Elite Basketball Jersey', sport: 'basketball', garment: 'jersey', program: 'youth' },
  '7B3VTA': { name: 'Ladies Dynaspeed Basketball Jersey', sport: 'basketball', garment: 'jersey', program: 'womens' },
  '7R3CHA': { name: 'Ladies Elite Basketball Jersey', sport: 'basketball', garment: 'jersey', program: 'womens' },
};

export const MOMENTEC_CATALOG = MOMENTEC_STYLE_IDS.map((style) => ({
  style,
  name: VERIFIED_PRODUCTS[style]?.name || style,
  sport: VERIFIED_PRODUCTS[style]?.sport || null,
  garment: VERIFIED_PRODUCTS[style]?.garment || null,
  program: VERIFIED_PRODUCTS[style]?.program || null,
  mates: VERIFIED_PRODUCTS[style]?.mates || [],
  modelUrl: `${MODEL_ROOT}/${style}.glb`,
  modelReady: true,
  atlasReady: ATLAS_READY_STYLES.has(style),
  atlasRoot: ATLAS_READY_STYLES.has(style) ? `/uniform/designs/${style.toLowerCase()}` : null,
  editableSurfaces: ['exterior', 'interior'],
  surfaceMaterials: { exterior: 'main', interior: 'reverse' },
  classification: VERIFIED_PRODUCTS[style] ? 'verified' : 'pending',
  source: `https://static.momentecbrands.com/3D-Sublimation/${style}/${style}.glb`,
}));

export function getMomentecProduct(style) {
  return MOMENTEC_CATALOG.find((product) => product.style === style) || null;
}

export function listMomentecProducts(filters = {}) {
  return MOMENTEC_CATALOG.filter((product) => Object.entries(filters).every(([key, value]) => (
    value == null || product[key] === value
  )));
}
