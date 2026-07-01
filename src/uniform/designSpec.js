// Uniform Builder — shared design-spec model.
//
// A "design spec" is the single source of truth for a custom uniform: which
// garment, and for each zone/text element what color / pattern / fabric / font
// is applied. The SVG editor, the Canvas 2D production renderer, the AI design
// function, and the saved-design persistence all speak this exact shape, so the
// same object round-trips from AI → editor → production render → database.
//
// Everything here is pure (no React, no DOM). It's an ES module imported by the
// client; the Netlify AI function keeps its own copy of the vocab rather than
// importing this, so this file never has to support CommonJS require().

// ── Color vocabulary ────────────────────────────────────────────────────────
// Team-apparel color names → hex. Mirrors QuickMockBuilder's list (kept local so
// this module has no cross-imports) and drives the AI prompt + swatch palette so
// a coach can say "vegas gold" and get the right chip. Unknown names fall back to
// neutral grey at lookup time.
const COLOR_HEX = {
  black: '#111827', white: '#ffffff', navy: '#1f2a44', 'navy blue': '#1f2a44',
  royal: '#1d4ed8', 'royal blue': '#1d4ed8', red: '#dc2626', maroon: '#7f1d1d',
  cardinal: '#9b1c31', scarlet: '#c8102e', burgundy: '#7b1e3b', forest: '#14532d',
  'forest green': '#14532d', green: '#16a34a', kelly: '#16a34a', 'kelly green': '#16a34a',
  lime: '#84cc16', 'safety green': '#c6ff00', 'neon green': '#39ff14', gold: '#d4af37',
  'old gold': '#caa53d', 'vegas gold': '#c5b358', yellow: '#facc15', orange: '#ea580c',
  purple: '#7c3aed', grey: '#9ca3af', gray: '#9ca3af', 'heather grey': '#b6bcc4',
  'heather gray': '#b6bcc4', 'athletic heather': '#cbd5e1', charcoal: '#374151',
  silver: '#cbd5e1', pink: '#ec4899', 'light blue': '#7dd3fc', 'carolina blue': '#4b9cd3',
  'columbia blue': '#9bcbeb', teal: '#14b8a6', brown: '#5c4033', tan: '#d2b48c',
  natural: '#f0ead6', cream: '#fffdd0', sand: '#e0d3af',
};

// Curated brand-forward palette shown as clickable chips in the editor. Ordered
// light→dark→accent so the row reads like a real swatch card.
const PALETTE = [
  { name: 'White', hex: '#ffffff' }, { name: 'Silver', hex: '#cbd5e1' },
  { name: 'Vegas Gold', hex: '#c5b358' }, { name: 'Gold', hex: '#d4af37' },
  { name: 'Yellow', hex: '#facc15' }, { name: 'Safety Green', hex: '#c6ff00' },
  { name: 'Orange', hex: '#ea580c' }, { name: 'Red', hex: '#dc2626' },
  { name: 'Scarlet', hex: '#c8102e' }, { name: 'Cardinal', hex: '#9b1c31' },
  { name: 'Maroon', hex: '#7f1d1d' }, { name: 'Pink', hex: '#ec4899' },
  { name: 'Purple', hex: '#7c3aed' }, { name: 'Navy', hex: '#1f2a44' },
  { name: 'Royal', hex: '#1d4ed8' }, { name: 'Carolina', hex: '#4b9cd3' },
  { name: 'Teal', hex: '#14b8a6' }, { name: 'Kelly', hex: '#16a34a' },
  { name: 'Forest', hex: '#14532d' }, { name: 'Charcoal', hex: '#374151' },
  { name: 'Black', hex: '#111827' },
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Normalize any color-ish input (hex or a known name) to a 6-digit hex string.
// Returns null when it can't be resolved so callers can decide the fallback.
function toHex(input, fallback = null) {
  if (typeof input !== 'string') return fallback;
  const s = input.trim();
  if (HEX_RE.test(s)) {
    // Expand shorthand #abc → #aabbcc.
    if (s.length === 4) return '#' + s.slice(1).split('').map((c) => c + c).join('').toLowerCase();
    return s.toLowerCase();
  }
  const named = COLOR_HEX[s.toLowerCase()];
  return named || fallback;
}

// Nearest named color for a hex — used on the production spec sheet so the shop
// sees "Navy (#1f2a44)" instead of a bare hex. Simple RGB distance is plenty.
function nameForHex(hex) {
  const h = toHex(hex);
  if (!h) return '';
  const { r, g, b } = hexToRgb(h);
  let best = '', bestD = Infinity;
  for (const [name, val] of Object.entries(COLOR_HEX)) {
    const c = hexToRgb(val);
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  // Title-case the winner.
  return best.replace(/\b\w/g, (m) => m.toUpperCase());
}

function hexToRgb(h) {
  const m = String(h || '').replace('#', '').match(/.{2}/g);
  return m ? { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) } : { r: 0, g: 0, b: 0 };
}

// Relative luminance (0–255-ish). Used to auto-pick black vs white text/outline
// against a given fill so numbers stay legible on any colorway.
function luminance(hex) {
  const { r, g, b } = hexToRgb(toHex(hex, '#808080'));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function isDark(hex) { return luminance(hex) < 130; }
function contrastInk(hex) { return isDark(hex) ? '#ffffff' : '#111827'; }

// ── Catalogs ────────────────────────────────────────────────────────────────
// Pattern ids the renderer knows how to draw. 'solid' means a flat fill; every
// other id blends the zone color with the zone's secondary color (`color2`).
const PATTERNS = [
  { id: 'solid', label: 'Solid' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'pinstripe', label: 'Pinstripe' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'fade', label: 'Fade' },
  { id: 'dots', label: 'Dots' },
  { id: 'camo', label: 'Camo' },
  { id: 'digicamo', label: 'Digital Camo' },
  { id: 'carbon', label: 'Carbon' },
  { id: 'hex', label: 'Hex Mesh' },
];
const PATTERN_IDS = PATTERNS.map((p) => p.id);

// Fabric affects the subtle surface texture in the render and is carried onto the
// production sheet (what the mill actually cuts/sublimates).
const FABRICS = [
  { id: 'matte', label: 'Matte Knit' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'heather', label: 'Heather' },
  { id: 'sublimated', label: 'Sublimated Poly' },
  { id: 'gloss', label: 'Gloss' },
];
const FABRIC_IDS = FABRICS.map((f) => f.id);

// ── Zone / text defaults ────────────────────────────────────────────────────
const DEFAULT_ZONE = { color: '#1f2a44', color2: '#ffffff', pattern: 'solid' };

// A text element (number or name). x/y are fractions of the view box (0–1) so a
// placement survives switching garments/views; the anchor in the template only
// supplies the starting point. `auto` outline lets the renderer pick an outline
// that contrasts the fill until the user overrides it.
const DEFAULT_TEXT = {
  value: '', font: 'anton', fill: '#ffffff', outline: 'auto', outlineWidth: 5,
  size: 1, x: null, y: null, letterSpacing: 0,
};

function makeDefaultSpec(garmentId = 'crew_jersey') {
  return {
    version: 1,
    garmentId,
    fabric: 'sublimated',
    // Zones are stored flat and keyed by zone id; a garment simply ignores zone
    // ids it doesn't define, so one spec can survive a garment swap.
    zones: {
      body: { ...DEFAULT_ZONE, color: '#1f2a44' },
      yoke: { ...DEFAULT_ZONE, color: '#962C32' },
      sleeveL: { ...DEFAULT_ZONE, color: '#962C32' },
      sleeveR: { ...DEFAULT_ZONE, color: '#962C32' },
      collar: { ...DEFAULT_ZONE, color: '#962C32' },
      sidePanelL: { ...DEFAULT_ZONE, color: '#ffffff' },
      sidePanelR: { ...DEFAULT_ZONE, color: '#ffffff' },
      waistband: { ...DEFAULT_ZONE, color: '#962C32' },
      legL: { ...DEFAULT_ZONE, color: '#1f2a44' },
      legR: { ...DEFAULT_ZONE, color: '#1f2a44' },
      pocket: { ...DEFAULT_ZONE, color: '#1f2a44' },
      hood: { ...DEFAULT_ZONE, color: '#962C32' },
      cuff: { ...DEFAULT_ZONE, color: '#962C32' },
    },
    // Text is keyed by view then element so front and back can differ (e.g. big
    // number on the back, small number on the front chest).
    text: {
      front: {
        number: { ...DEFAULT_TEXT, value: '23', size: 0.72 },
        name: { ...DEFAULT_TEXT, value: '', size: 0.5, font: 'saira' },
      },
      back: {
        number: { ...DEFAULT_TEXT, value: '23', size: 1.4 },
        name: { ...DEFAULT_TEXT, value: 'JOHNSON', size: 0.62, font: 'saira' },
      },
    },
    // Uploaded artwork / team logos, per view. Each is placed, sized, and rotated
    // over the garment and rendered by both the SVG editor and the Canvas export.
    logos: { front: [], back: [] },
    meta: { teamName: '', notes: '' },
  };
}

// Sanitize one logo layer. src must be a data: or http(s) image URL (a coach
// upload is a data URL; a vectorized logo is a data:image/svg+xml URL). x/y are
// the center as viewBox fractions; w is width as a fraction of the viewBox width;
// aspect is height/width so the renderer can derive height.
let _logoSeq = 0;
function cleanLogo(l) {
  if (!l || typeof l !== 'object') return null;
  const src = typeof l.src === 'string' && /^(data:image\/|https?:)/i.test(l.src) ? l.src : null;
  if (!src) return null;
  return {
    id: typeof l.id === 'string' && l.id ? l.id : `logo_${Date.now().toString(36)}_${_logoSeq++}`,
    src,
    x: Number.isFinite(l.x) ? clamp(l.x, 0, 1) : 0.5,
    y: Number.isFinite(l.y) ? clamp(l.y, 0, 1) : 0.3,
    w: Number.isFinite(l.w) ? clamp(l.w, 0.03, 1) : 0.25,
    aspect: Number.isFinite(l.aspect) && l.aspect > 0 ? l.aspect : 1,
    rotation: Number.isFinite(l.rotation) ? clamp(l.rotation, -180, 180) : 0,
    opacity: Number.isFinite(l.opacity) ? clamp(l.opacity, 0, 1) : 1,
  };
}

// ── Sanitizing / merging (defensive — trusts nothing) ───────────────────────
// Coerce one zone from arbitrary input, keeping only known fields.
function cleanZone(z, base = DEFAULT_ZONE) {
  const out = { ...base };
  if (z && typeof z === 'object') {
    const c = toHex(z.color); if (c) out.color = c;
    const c2 = toHex(z.color2); if (c2) out.color2 = c2;
    if (typeof z.pattern === 'string' && PATTERN_IDS.includes(z.pattern)) out.pattern = z.pattern;
  }
  return out;
}

function cleanText(t, base = DEFAULT_TEXT) {
  const out = { ...base };
  if (t && typeof t === 'object') {
    if (typeof t.value === 'string') out.value = t.value.slice(0, 24);
    if (typeof t.font === 'string') out.font = t.font;
    const f = toHex(t.fill); if (f) out.fill = f;
    if (t.outline === 'auto' || t.outline === 'none') out.outline = t.outline;
    else { const o = toHex(t.outline); if (o) out.outline = o; }
    if (Number.isFinite(t.outlineWidth)) out.outlineWidth = clamp(t.outlineWidth, 0, 20);
    if (Number.isFinite(t.size)) out.size = clamp(t.size, 0.2, 3);
    if (Number.isFinite(t.x)) out.x = clamp(t.x, 0, 1);
    if (Number.isFinite(t.y)) out.y = clamp(t.y, 0, 1);
    if (Number.isFinite(t.letterSpacing)) out.letterSpacing = clamp(t.letterSpacing, -10, 40);
  }
  return out;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// Merge a (possibly partial, possibly AI-authored) spec onto a complete base so
// the result is always safe to render. Only known zones/fields survive.
function normalizeSpec(input, base) {
  const b = base || makeDefaultSpec(input && input.garmentId);
  const out = makeDefaultSpec(
    typeof (input && input.garmentId) === 'string' ? input.garmentId : b.garmentId
  );
  if (typeof (input && input.fabric) === 'string' && FABRIC_IDS.includes(input.fabric)) {
    out.fabric = input.fabric;
  } else { out.fabric = b.fabric; }

  // Start from base zones, then overlay input zones.
  for (const id of Object.keys(out.zones)) {
    out.zones[id] = cleanZone((input && input.zones && input.zones[id]) || (b.zones && b.zones[id]), out.zones[id]);
  }
  for (const view of ['front', 'back']) {
    for (const el of ['number', 'name']) {
      const src = (input && input.text && input.text[view] && input.text[view][el])
        || (b.text && b.text[view] && b.text[view][el]);
      out.text[view][el] = cleanText(src, out.text[view][el]);
    }
  }
  for (const v of ['front', 'back']) {
    const arr = (input && input.logos && Array.isArray(input.logos[v])) ? input.logos[v]
      : ((b.logos && b.logos[v]) || []);
    out.logos[v] = arr.map(cleanLogo).filter(Boolean).slice(0, 8);
  }
  if (input && input.meta && typeof input.meta === 'object') {
    if (typeof input.meta.teamName === 'string') out.meta.teamName = input.meta.teamName.slice(0, 80);
    if (typeof input.meta.notes === 'string') out.meta.notes = input.meta.notes.slice(0, 500);
  } else if (b.meta) { out.meta = { ...b.meta }; }
  return out;
}

// Pure ESM export (the client bundles this as an ES module — assigning
// module.exports here crashes at runtime with "ES Modules may not assign
// module.exports"). The Netlify AI function keeps its own copy of the
// vocab, so nothing consumes this via CommonJS require().
export {
  COLOR_HEX, PALETTE, PATTERNS, PATTERN_IDS, FABRICS, FABRIC_IDS,
  DEFAULT_ZONE, DEFAULT_TEXT,
  toHex, nameForHex, hexToRgb, luminance, isDark, contrastInk, clamp,
  makeDefaultSpec, normalizeSpec, cleanZone, cleanText, cleanLogo,
};
