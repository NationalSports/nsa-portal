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
    { id: 'sidePanelL', label: 'Left Side Stripe',
      d: 'M120 84 L136 84 L134 300 L128 300 Q118 210 120 84 Z' },
    { id: 'sidePanelR', label: 'Right Side Stripe',
      d: 'M264 84 L280 84 Q282 210 272 300 L266 300 Z' },
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
    views: { front: SHORTS_FRONT, back: SHORTS_BACK },
  },
  hoodie: {
    id: 'hoodie', name: 'Hoodie', category: 'Tops',
    views: { front: HOODIE_FRONT, back: HOODIE_BACK },
  },
  // Built-in photoreal jersey: a neutral 3D render + zone mask (front/back) shipped
  // in /public/uniform, so the Photoreal path works out-of-the-box with no import.
  // Colors/patterns/logos tint through the base's real folds and shadows.
  octa_jersey: {
    id: 'octa_jersey', name: 'Photoreal Jersey', category: 'Photoreal', type: 'raster',
    credit: '3D model “Octa Asa 6” by Sebastian Zayas — CC BY',
    views: {
      front: {
        base: PUB('/uniform/octa-base-front.png'), mask: PUB('/uniform/octa-mask-front.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.5, size: 150 }, name: { x: 0.5, y: 0.3, size: 58 } },
      },
      back: {
        base: PUB('/uniform/octa-base-back.png'), mask: PUB('/uniform/octa-mask-back.png'),
        w: 760, h: 940, viewBox: '0 0 760 940', zones: RASTER_ZONE_MAP.slice(), seams: [],
        anchors: { number: { x: 0.5, y: 0.48, size: 190 }, name: { x: 0.5, y: 0.27, size: 70 } },
      },
    },
  },
};

export function getTemplate(id) { return TEMPLATES[id] || TEMPLATES.crew_jersey; }
export function listTemplates() { return Object.values(TEMPLATES); }

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
