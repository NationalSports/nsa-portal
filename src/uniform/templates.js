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

// Shared helper: a seam is just a path we stroke lightly; grouping keeps the
// template literals readable.
const seam = (d, opts = {}) => ({ d, ...opts });

// ── Crew / soccer-style jersey ──────────────────────────────────────────────
const JERSEY_FRONT = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M150 122 L170 104 Q200 130 230 104 L250 122 L250 430 L150 430 Z' },
    { id: 'sidePanelL', label: 'Left Side Panel',
      d: 'M150 178 L174 202 L174 430 L150 430 Z' },
    { id: 'sidePanelR', label: 'Right Side Panel',
      d: 'M250 178 L226 202 L226 430 L250 430 Z' },
    { id: 'yoke', label: 'Shoulder Yoke',
      d: 'M150 122 L250 122 L250 150 Q200 170 150 150 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M150 122 L104 150 L112 200 L150 178 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M250 122 L296 150 L288 200 L250 178 Z' },
    { id: 'collar', label: 'Collar',
      d: 'M166 100 Q200 134 234 100 L230 110 Q200 124 170 110 Z' },
  ],
  seams: [
    seam('M150 178 L174 202 L174 430'), seam('M250 178 L226 202 L226 430'),
    seam('M150 122 L112 200'), seam('M250 122 L288 200'),
  ],
  // cx/cy/size expressed as fractions of the viewBox (0–1).
  anchors: {
    number: { x: 0.5, y: 0.42, size: 120 },
    name: { x: 0.5, y: 0.30, size: 40 },
  },
};

const JERSEY_BACK = {
  viewBox: '0 0 400 480',
  zones: [
    { id: 'body', label: 'Body',
      d: 'M150 122 L170 106 Q200 120 230 106 L250 122 L250 430 L150 430 Z' },
    { id: 'sidePanelL', label: 'Left Side Panel',
      d: 'M150 178 L174 202 L174 430 L150 430 Z' },
    { id: 'sidePanelR', label: 'Right Side Panel',
      d: 'M250 178 L226 202 L226 430 L250 430 Z' },
    { id: 'yoke', label: 'Shoulder Yoke',
      d: 'M150 122 L250 122 L250 148 Q200 160 150 148 Z' },
    { id: 'sleeveL', label: 'Left Sleeve',
      d: 'M150 122 L104 150 L112 200 L150 178 Z' },
    { id: 'sleeveR', label: 'Right Sleeve',
      d: 'M250 122 L296 150 L288 200 L250 178 Z' },
    { id: 'collar', label: 'Collar',
      d: 'M168 106 Q200 120 232 106 L230 116 Q200 128 170 116 Z' },
  ],
  seams: [
    seam('M150 178 L174 202 L174 430'), seam('M250 178 L226 202 L226 430'),
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
