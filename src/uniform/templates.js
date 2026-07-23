// Uniform Builder — garment template registry.
//
// A template describes ONE garment as a set of front/back "views". Each view is a
// list of colorable **zones** (an SVG path `d` + a friendly label), a set of
// **seams** (thin decorative stitch lines drawn on top, never colored), and
// **anchors** telling the renderer where a number / name sit by default.
//
// Zones are stored in paint order (first = bottom layer). Both renderers walk the
// same list, so the silhouette is defined here exactly once. Coordinates live in
// the view's own `viewBox` space; the renderers scale to whatever pixel size they
// draw at, and text anchors are expressed as fractions of the viewBox so a saved
// number position survives a garment/size change.
//
// Custom uploaded SVGs are converted into this same shape at import time (see
// parseUploadedSvg below), so a coach's own template is a first-class citizen.

import { RASTER_ZONE_MAP } from './raster';

// Shared helper: a seam is just a path we stroke lightly; grouping keeps the
// template literals readable.
const seam = (d, opts = {}) => ({ d, ...opts });

// Public-asset URL helper (CRA serves /public at the site root).
const PUB = (p) => (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL ? process.env.PUBLIC_URL : '') + p;

// ── Crew / soccer-style jersey ──────────────────────────────────────────────
// Athletic jersey with a real cut: shallow V-neck, curved cap sleeves, a torso
// that tapers at the waist and flares to a rounded hem. Curves (not straight
// lines) are what read as "garment" rather than "icon".
const JERSEY_FRONT = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M150 120 Q138 142 146 200 Q140 322 152 432 Q200 448 248 432 Q260 322 254 200 Q262 142 250 120 Q224 132 200 152 Q176 132 150 120 Z' },
    { id: 'sidePanelL', label: 'Left Side Panel',
      d: 'M146 202 Q140 322 152 432 L170 432 Q160 322 166 206 Z' },
    { id: 'sidePanelR', label: 'Right Side Panel',
      d: 'M254 202 Q260 322 248 432 L230 432 Q240 322 234 206 Z' },
    { id: 'yoke', label: 'Shoulder Yoke',
      d: 'M150 120 Q200 150 250 120 Q259 140 250 160 Q200 180 150 160 Q141 140 150 120 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M150 122 Q128 132 120 160 Q114 186 122 208 L150 200 Q142 152 150 122 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M250 122 Q272 132 280 160 Q286 186 278 208 L250 200 Q258 152 250 122 Z' },
    { id: 'collar', label: 'Collar',
      d: 'M174 126 Q200 152 226 126 L234 134 Q200 168 166 134 Z' },
  ],
  seams: [
    seam('M148 200 Q140 322 152 432'), seam('M252 200 Q260 322 248 432'),
    seam('M150 122 Q128 152 122 206'), seam('M250 122 Q272 152 278 206'),
  ],
  // cx/cy/size expressed as fractions of the viewBox (0–1).
  anchors: {
    number: { x: 0.5, y: 0.46, size: 120 },
    name: { x: 0.5, y: 0.31, size: 40 },
  },
};

const JERSEY_BACK = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M150 120 Q138 142 146 200 Q140 322 152 432 Q200 448 248 432 Q260 322 254 200 Q262 142 250 120 Q224 130 200 134 Q176 130 150 120 Z' },
    { id: 'sidePanelL', label: 'Left Side Panel',
      d: 'M146 202 Q140 322 152 432 L170 432 Q160 322 166 206 Z' },
    { id: 'sidePanelR', label: 'Right Side Panel',
      d: 'M254 202 Q260 322 248 432 L230 432 Q240 322 234 206 Z' },
    { id: 'yoke', label: 'Shoulder Yoke',
      d: 'M150 120 Q200 136 250 120 Q259 140 250 158 Q200 170 150 158 Q141 140 150 120 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M150 122 Q128 132 120 160 Q114 186 122 208 L150 200 Q142 152 150 122 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M250 122 Q272 132 280 160 Q286 186 278 208 L250 200 Q258 152 250 122 Z' },
    { id: 'collar', label: 'Collar',
      d: 'M172 122 Q200 140 228 122 L230 132 Q200 150 170 132 Z' },
  ],
  seams: [
    seam('M148 200 Q140 322 152 432'), seam('M252 200 Q260 322 248 432'),
  ],
  anchors: {
    name: { x: 0.5, y: 0.30, size: 46 },
    number: { x: 0.5, y: 0.52, size: 190 },
  },
};

// ── Athletic shorts ─────────────────────────────────────────────────────────
const SHORTS_FRONT = {
  viewBox: '0 0 400 360',
  zones: [
    { id: 'waistband', label: 'Waistband',
      d: 'M120 60 L280 60 L280 84 L120 84 Z' },
    { id: 'legL', label: 'Left Leg',
      d: 'M120 84 L198 84 L198 300 L128 300 Q118 210 120 84 Z' },
    { id: 'legR', label: 'Right Leg',
      d: 'M202 84 L280 84 Q282 210 272 300 L202 300 Z' },
    { id: 'sidePanelL', label: 'Left Angular Insert',
      d: 'M120 150 Q126 178 136 202 L140 258 L128 300 Q118 210 120 150 Z' },
    { id: 'sidePanelR', label: 'Right Angular Insert',
      d: 'M280 150 Q274 178 264 202 L260 258 L272 300 Q282 210 280 150 Z' },
  ],
  seams: [seam('M200 84 L200 300'), seam('M120 84 L280 84')],
  anchors: {
    number: { x: 0.68, y: 0.5, size: 70 },
    name: { x: 0.32, y: 0.5, size: 26 },
  },
};

const SHORTS_BACK = {
  viewBox: '0 0 400 360',
  zones: [
    { id: 'waistband', label: 'Waistband',
      d: 'M120 60 L280 60 L280 84 L120 84 Z' },
    { id: 'legL', label: 'Left Leg',
      d: 'M120 84 L198 84 L198 300 L128 300 Q118 210 120 84 Z' },
    { id: 'legR', label: 'Right Leg',
      d: 'M202 84 L280 84 Q282 210 272 300 L202 300 Z' },
    { id: 'sidePanelL', label: 'Left Angular Insert',
      d: 'M120 190 Q128 236 154 270 Q170 288 190 300 L128 300 Q118 224 120 190 Z' },
    { id: 'sidePanelR', label: 'Right Angular Insert',
      d: 'M280 190 Q272 236 246 270 Q230 288 210 300 L272 300 Q282 224 280 190 Z' },
  ],
  seams: [seam('M200 84 L200 300')],
  anchors: {
    number: { x: 0.5, y: 0.5, size: 80 },
    name: { x: 0.5, y: 0.26, size: 24 },
  },
};

// ── Hoodie ──────────────────────────────────────────────────────────────────
const HOODIE_FRONT = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M138 158 L262 158 L262 452 L138 452 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M138 158 L92 190 L66 428 L116 438 L138 214 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M262 158 L308 190 L334 428 L284 438 L262 214 Z' },
    { id: 'hood', label: 'Hood',
      d: 'M158 160 Q200 92 242 160 L232 168 Q200 120 168 168 Z' },
    { id: 'pocket', label: 'Pocket',
      d: 'M150 336 L250 336 L262 404 L138 404 Z' },
    { id: 'cuff', label: 'Cuffs & Hem',
      d: 'M138 438 L262 438 L262 452 L138 452 Z M66 428 L116 438 L112 452 L62 442 Z M334 428 L284 438 L288 452 L338 442 Z' },
    { id: 'collar', label: 'Collar',
      d: 'M168 160 Q200 138 232 160 L232 170 Q200 150 168 170 Z' },
  ],
  seams: [seam('M150 336 L250 336 L262 404'), seam('M138 214 L138 452'), seam('M262 214 L262 452')],
  anchors: {
    number: { x: 0.5, y: 0.44, size: 100 },
    name: { x: 0.5, y: 0.30, size: 40 },
  },
};

const HOODIE_BACK = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M138 158 L262 158 L262 452 L138 452 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M138 158 L92 190 L66 428 L116 438 L138 214 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M262 158 L308 190 L334 428 L284 438 L262 214 Z' },
    { id: 'hood', label: 'Hood',
      d: 'M158 160 Q200 96 242 160 L230 166 Q200 128 170 166 Z' },
    { id: 'cuff', label: 'Cuffs & Hem',
      d: 'M138 438 L262 438 L262 452 L138 452 Z M66 428 L116 438 L112 452 L62 442 Z M334 428 L284 438 L288 452 L338 442 Z' },
  ],
  seams: [seam('M138 214 L138 452'), seam('M262 214 L262 452')],
  anchors: {
    name: { x: 0.5, y: 0.28, size: 46 },
    number: { x: 0.5, y: 0.5, size: 170 },
  },
};

const TEMPLATES = {
  crew_jersey: {
    id: 'crew_jersey', name: 'Crew Jersey', category: 'Tops',
    views: { front: JERSEY_FRONT, back: JERSEY_BACK },
  },
  shorts: {
    id: 'shorts', name: 'Athletic Shorts', category: 'Bottoms',
    model3d: PUB('/uniform/agi-shorts.glb?v=6'),
    views: { front: SHORTS_FRONT, back: SHORTS_BACK },
  },
  shorts_321821: {
    id: 'shorts_321821', name: '321821 Soccer Shorts', category: 'Bottoms',
    credit: 'Artist-built Holloway 321821 base',
    model3d: PUB('/uniform/321821-soccer-shorts.glb?v=1'),
    // This vendor atlas follows glTF's native UV origin. The 228187 flag atlas
    // is browser-oriented, so Viewer3D keeps that older default unless an
    // individual garment opts out here.
    atlasFlipY: false,
    views: { front: SHORTS_FRONT, back: SHORTS_BACK },
  },
  basketball_4r3chb_shorts: {
    id: 'basketball_4r3chb_shorts', name: '4R3CHB Reversible Basketball Shorts', category: 'Bottoms',
    credit: 'Holloway 4R3CHB vendor configurator extraction',
    model3d: PUB('/uniform/4R3CHB-full.glb'),
    reversible: true,
    // The companion shorts SVGs were exported from the same vendor UV system
    // as the jersey. Keep their atlas in glTF UV orientation as well.
    atlasFlipY: false,
    views: { front: SHORTS_FRONT, back: SHORTS_BACK },
  },
  hoodie: {
    id: 'hoodie', name: 'Hoodie', category: 'Tops',
    views: { front: HOODIE_FRONT, back: HOODIE_BACK },
  },
  // Sahrul's NEW base (CLO3D → optimized GLB, 45MB raw → ~2MB: topstitch + flat
  // pattern pieces stripped, panels renamed to our zones, Draco-compressed). Real
  // baked fabric normal + set-in sleeves. 3D preview is native; the 2D proof reuses
  // the octa flat art as a placeholder until Sahrul ships flat front/back + mask.
  nsapro_jersey: {
    id: 'nsapro_jersey', name: 'NSA Pro (New Base)', category: 'Photoreal', type: 'raster',
    credit: 'Base garment by Sahrul (CLO3D)',
    model3d: PUB('/uniform/nsapro-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.33, y: 0.2, size: 88 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.45, size: 225 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // Sahrul's upgraded base (Blender → GLB). Built to the production-pipeline spec:
  // a full PBR set (clean albedo + normal + packed metallic-roughness + AO) plus
  // REAL modeled stitch geometry (40 StitchMatShape meshes) along every seam, not
  // a fake normal-map trick. Zones split by mesh/material — FRONT/BACK + SIDE
  // panels (body), SLEVEE + SIDE SLEVEE (sleeves), Collar. Draco-compressed from
  // 26MB → 5.2MB. 2D proof reuses octa flat art as a placeholder for now.
  sahrul2_jersey: {
    id: 'sahrul2_jersey', name: 'Sahrul v2 (Production)', category: 'Photoreal', type: 'raster',
    credit: 'Base garment by Sahrul (Blender)',
    model3d: PUB('/uniform/sahrul-v2-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.33, y: 0.2, size: 88 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.45, size: 225 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // NSA soccer foundation with the approved AGI-1012 artwork. The three
  // grayscale images are UV masks rather than baked colors: Viewer3D combines
  // them with the builder's primary/secondary swatches, so the exact chest and
  // sleeve-band placement stays fixed while both colors remain editable.
  agi1012_jersey: {
    id: 'agi1012_jersey', name: 'AGI-1012 Soccer', category: 'Photoreal', type: 'raster',
    credit: 'NSA soccer foundation · AGI-1012 approved layout',
    model3d: PUB('/uniform/agi-1012-jersey.glb'),
    designMasks: {
      body_front: PUB('/uniform/agi-1012-body-front-mask.png'),
      sleeve_left: PUB('/uniform/agi-1012-sleeve-left-mask.png'),
      sleeve_right: PUB('/uniform/agi-1012-sleeve-right-mask.png'),
    },
    designMaskAreas: {
      body_front: { base: 'body', accent: 'bodyStripe' },
      sleeve_left: { base: 'sleeveL', accent: 'sleeveBandL' },
      sleeve_right: { base: 'sleeveR', accent: 'sleeveBandR' },
    },
    views: {
      front: {
        base: PUB('/uniform/agi-1012-proof-base-front.png?v=6'), mask: PUB('/uniform/agi-1012-proof-mask-front.png?v=6'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Body', maskColor: '#ff0000' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#00ff00' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#0000ff' },
          { id: 'collar', label: 'Collar', maskColor: '#ffff00' },
          { id: 'bodyStripe', label: 'Chest Stripe', maskColor: '#ff00ff', sourceId: 'body', colorField: 'color2' },
          { id: 'sleeveBandL', label: 'Left Sleeve Band', maskColor: '#00ffff', sourceId: 'sleeveL', colorField: 'color2' },
          { id: 'sleeveBandR', label: 'Right Sleeve Band', maskColor: '#ff8000', sourceId: 'sleeveR', colorField: 'color2' },
        ], seams: [],
        anchors: { number: { x: 0.5, y: 0.24, size: 86 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/agi-1012-proof-base-back.png?v=6'), mask: PUB('/uniform/agi-1012-proof-mask-back.png?v=6'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Body', maskColor: '#ff0000' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#00ff00' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#0000ff' },
          { id: 'collar', label: 'Collar', maskColor: '#ffff00' },
          { id: 'sleeveBandL', label: 'Left Sleeve Band', maskColor: '#00ffff', sourceId: 'sleeveL', colorField: 'color2' },
          { id: 'sleeveBandR', label: 'Right Sleeve Band', maskColor: '#ff8000', sourceId: 'sleeveR', colorField: 'color2' },
        ], seams: [],
        anchors: { number: { x: 0.5, y: 0.46, size: 205 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // AYSONSA is full garment artwork authored over front and back elevations.
  // The live renderer projects those elevations over this same approved soccer
  // foundation, preserving the original PBR fabric and all builder decorations.
  ayson_jersey: {
    id: 'ayson_jersey', name: 'AYSONSA Soccer', category: 'Photoreal', type: 'raster',
    credit: 'NSA soccer foundation · AYSONSA supplied vector layout',
    model3d: PUB('/uniform/agi-1012-jersey.glb'),
    proceduralLayout: 'ayson',
    projectionFront: PUB('/uniform/designs/ayson/projection-front.png?v=3'),
    projectionBack: PUB('/uniform/designs/ayson/projection-back.png?v=3'),
    projectionBodyU: { frontMin: 0.243, frontMax: 0.681, backMin: 0.339, backMax: 0.743 },
    views: {
      front: {
        base: PUB('/uniform/agi-1012-proof-base-front.png?v=6'), mask: PUB('/uniform/designs/ayson/proof-mask-front.png?v=2'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Main Body', maskColor: '#ff0000' },
          { id: 'aysonInk2', label: 'Artwork', maskColor: '#00ff00', sourceId: 'body', colorField: 'color2' },
          { id: 'collar', label: 'Collar', maskColor: '#00ffff' },
        ], seams: [],
        anchors: { number: { x: 0.5, y: 0.27, size: 86 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/agi-1012-proof-base-back.png?v=6'), mask: PUB('/uniform/designs/ayson/proof-mask-back.png?v=2'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Main Body', maskColor: '#ff0000' },
          { id: 'aysonInk2', label: 'Artwork', maskColor: '#00ff00', sourceId: 'body', colorField: 'color2' },
          { id: 'collar', label: 'Collar', maskColor: '#00ffff' },
        ], seams: [],
        anchors: { number: { x: 0.5, y: 0.46, size: 205 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // AGI-1011 shares the approved soccer garment and cloth treatment, but its
  // construction artwork is independent: cyan main panels, black vertical side
  // inserts, black opening-tracked sleeve cuffs and a black collar.
  agi1011_jersey: {
    id: 'agi1011_jersey', name: 'AGI-1011 Soccer', category: 'Photoreal', type: 'raster',
    credit: 'NSA soccer foundation · AGI-1011 layout',
    model3d: PUB('/uniform/agi-1012-jersey.glb'),
    proceduralLayout: 'sidePanels',
    designMasks: {
      body_front: PUB('/uniform/agi-1011-body-front-mask.png'),
      body_back: PUB('/uniform/agi-1011-body-back-mask.png'),
      sleeve_left: PUB('/uniform/agi-1011-sleeve-left-mask.png'),
      sleeve_right: PUB('/uniform/agi-1011-sleeve-right-mask.png'),
    },
    designMaskAreas: {
      body_front: { base: 'body', accent: 'bodyAccent' },
      body_back: { base: 'body', accent: 'bodyAccent' },
      sleeve_left: { base: 'sleeveL', accent: 'sleeveBandL' },
      sleeve_right: { base: 'sleeveR', accent: 'sleeveBandR' },
    },
    views: {
      front: {
        base: PUB('/uniform/agi-1011-proof-base-front.png?v=1'), mask: PUB('/uniform/agi-1011-proof-mask-front.png?v=1'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Body', maskColor: '#ff0000' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#00ff00' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#0000ff' },
          { id: 'collar', label: 'Collar', maskColor: '#ffff00' },
          { id: 'bodyAccent', label: 'Side Panels', maskColor: '#ff00ff', sourceId: 'body', colorField: 'color2' },
          { id: 'sleeveBandL', label: 'Left Sleeve Cuff', maskColor: '#00ffff', sourceId: 'sleeveL', colorField: 'color2' },
          { id: 'sleeveBandR', label: 'Right Sleeve Cuff', maskColor: '#ff8000', sourceId: 'sleeveR', colorField: 'color2' },
        ], seams: [],
        anchors: { number: { x: 0.61, y: 0.27, size: 86 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/agi-1011-proof-base-back.png?v=1'), mask: PUB('/uniform/agi-1011-proof-mask-back.png?v=1'),
        w: 500, h: 580, viewBox: '0 0 500 580',
        zones: [
          { id: 'body', label: 'Body', maskColor: '#ff0000' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#00ff00' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#0000ff' },
          { id: 'collar', label: 'Collar', maskColor: '#ffff00' },
          { id: 'bodyAccent', label: 'Side Panels', maskColor: '#ff00ff', sourceId: 'body', colorField: 'color2' },
          { id: 'sleeveBandL', label: 'Left Sleeve Cuff', maskColor: '#00ffff', sourceId: 'sleeveL', colorField: 'color2' },
          { id: 'sleeveBandR', label: 'Right Sleeve Cuff', maskColor: '#ff8000', sourceId: 'sleeveR', colorField: 'color2' },
        ], seams: [],
        anchors: { number: { x: 0.5, y: 0.46, size: 205 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // Vikram's base (Blender → GLB, delivered web-ready at 3.5MB, 10.7K tris, native
  // .blend included). Zones are separated by MATERIAL (Body/Sleeves/Collar) on one
  // clean mesh, with a full PBR set (albedo + normal + metallic-roughness). 3D
  // preview is native; 2D proof reuses octa flat art as a placeholder for now.
  vikram_jersey: {
    id: 'vikram_jersey', name: 'Vikram Base', category: 'Photoreal', type: 'raster',
    credit: 'Base garment by Vikram (Blender)',
    model3d: PUB('/uniform/vikram-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.33, y: 0.2, size: 88 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.45, size: 225 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // Holloway 228187 reversible flag-football cut. The vendor GLB has one
  // exterior material (main) and one interior material (reverse), both with a
  // complete UV set and embedded fabric normal. It is a useful live-builder
  // prototype, but not yet a production master: collar/trim/panels were not
  // separated into independent meshes and no editable source .blend was sent.
  flag228187_jersey: {
    id: 'flag228187_jersey', name: '228187 Reversible Flag Football', category: 'Flag Football', type: 'raster',
    credit: 'Holloway 228187 vendor configurator extraction',
    model3d: PUB('/uniform/flag-228187-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.35, size: 150 }, name: { x: 0.5, y: 0.19, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.43, size: 225 }, name: { x: 0.5, y: 0.18, size: 70 } },
      },
    },
  },
  // Holloway 228125 reversible basketball jersey. 4R3CHB is its matching
  // short and is intentionally kept as a separate paired-garment asset.
  // two physical fabric faces as `main` and `reverse`; ProBuilder presents them
  // together so a coach can design both colorways without mentally flipping a
  // single model back and forth.
  basketball_4r3chb: {
    id: 'basketball_4r3chb', name: '228125 Reversible Basketball Jersey', category: 'Basketball', type: 'raster',
    credit: 'Holloway 228125 vendor configurator extraction',
    model3d: PUB('/uniform/228125-full.glb'),
    reversible: true,
    // Extracted vendor SVGs share glTF's native lower-left UV origin.
    // Disabling the browser-image Y flip keeps armhole/hem shells from landing
    // on the torso as large circular or block-shaped artifacts.
    atlasFlipY: false,
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.36, size: 150 }, name: { x: 0.5, y: 0.19, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.43, size: 225 }, name: { x: 0.5, y: 0.18, size: 70 } },
      },
    },
  },
  // Built-in photoreal jersey: a neutral 3D render + zone mask (front/back) shipped
  // in /public/uniform, so the Photoreal path works out-of-the-box with no import.
  // Colors/patterns/logos tint through the base's real folds and shadows.
  octa_jersey: {
    id: 'octa_jersey', name: 'Photoreal Jersey', category: 'Photoreal', type: 'raster',
    credit: '3D model “Octa Asa 6” by Sebastian Zayas — CC BY',
    // Live 3D model (GLB, Draco-compressed) — meshes named by zone so the viewer
    // recolors each section. Vendor-delivered garments plug in here the same way.
    model3d: PUB('/uniform/octa-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.33, y: 0.2, size: 88 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.45, size: 225 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
  // Vendor-delivered garment #2 (Sahrul, CLO3D → Blender → GLB). Real sewn front
  // and back panels (not one continuous mesh), so this is the model the
  // whole-model raycast fix in Viewer3D was written for. Zone-mark renders use
  // this artist's own flat mask colors (sampled from the delivered PNGs), not the
  // shared RASTER_ZONE_MAP convention, since a different vendor/render can pick
  // any colors as long as each view lists them here.
  sahrul_jersey: {
    id: 'sahrul_jersey', name: 'Photoreal Jersey II', category: 'Photoreal', type: 'raster',
    model3d: PUB('/uniform/sahrul-jersey.glb'),
    views: {
      front: {
        base: PUB('/uniform/sahrul-base-front.jpg'), mask: PUB('/uniform/sahrul-mask-front.png'),
        w: 800, h: 939, viewBox: '0 0 800 939', seams: [],
        zones: [
          { id: 'body', label: 'Body', maskColor: '#94ffcb' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#1927a6' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#ff682a' },
          { id: 'collar', label: 'Collar', maskColor: '#afbf00' },
        ],
        // Kit-standard front layout (calibrated to pro sublimated kits): small
        // number high on the wearer's RIGHT chest (image-left), crest/logo slot
        // mirrored on the wearer's LEFT chest — both up near the collarbone
        // line, never stacked mid-torso.
        anchors: { number: { x: 0.33, y: 0.2, size: 88 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/sahrul-base-back.jpg'), mask: PUB('/uniform/sahrul-mask-back.png'),
        w: 800, h: 939, viewBox: '0 0 800 939', seams: [],
        zones: [
          { id: 'body', label: 'Body', maskColor: '#ff5577' },
          { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#1927a6' },
          { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#f46a31' },
          { id: 'collar', label: 'Collar', maskColor: '#bfd00a' },
        ],
        // Name rides the shoulder yoke; the number is the hero — big and
        // centered on the upper-mid back like a real match kit.
        anchors: { number: { x: 0.5, y: 0.45, size: 225 }, name: { x: 0.5, y: 0.2, size: 70 } },
      },
    },
  },
};

export function getTemplate(id) { return TEMPLATES[id] || TEMPLATES.crew_jersey; }
// Photoreal (raster) templates first so the picker leads with the realistic one.
export function listTemplates() {
  const all = Object.values(TEMPLATES);
  return [...all.filter((t) => t.type === 'raster'), ...all.filter((t) => t.type !== 'raster')];
}

// Register a template at runtime (used by the custom-SVG importer). Returns the
// stored template. Kept in the same module-level map so getTemplate() finds it.
export function registerTemplate(tpl) {
  if (tpl && tpl.id) TEMPLATES[tpl.id] = tpl;
  return tpl;
}

// ── Custom SVG import ───────────────────────────────────────────────────────
// Turn an uploaded SVG string into a template view. Colorable zones come from
// elements whose id/data-zone starts with a known token (body, sleeve, collar,
// …) OR, failing that, every <path>/<polygon> in document order becomes zone1,
// zone2, … so an untagged silhouette still imports and can be tapped to assign
// meaning in the editor. Returns null if the SVG has no usable geometry.
export function parseUploadedSvg(svgText, id) {
  if (typeof DOMParser === 'undefined') return null;
  let doc;
  try { doc = new DOMParser().parseFromString(svgText, 'image/svg+xml'); } catch (_e) { return null; }
  const svg = doc.querySelector('svg');
  if (!svg || doc.querySelector('parsererror')) return null;

  const vb = svg.getAttribute('viewBox')
    || `0 0 ${parseFloat(svg.getAttribute('width')) || 400} ${parseFloat(svg.getAttribute('height')) || 480}`;

  const shapes = Array.from(svg.querySelectorAll('path, polygon, rect, circle, ellipse'));
  const zones = [];
  shapes.forEach((el, i) => {
    const d = el.getAttribute('d');
    if (!d) return; // only real path geometry is colorable/exportable across both renderers
    const rawId = el.getAttribute('data-zone') || el.id || '';
    const label = rawId ? rawId.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : `Zone ${i + 1}`;
    zones.push({ id: rawId || `zone${i + 1}`, label, d });
  });
  if (!zones.length) return null;

  const view = { viewBox: vb, zones, seams: [], anchors: { number: { x: 0.5, y: 0.45, size: 120 }, name: { x: 0.5, y: 0.3, size: 40 } } };
  const tpl = {
    id: id || `custom_${zones.length}_${Math.abs(hashStr(svgText)) % 100000}`,
    name: 'Custom Template', category: 'Custom', custom: true,
    views: { front: view, back: view },
  };
  return tpl;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return h;
}
