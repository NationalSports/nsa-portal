// Pure helpers for the store Art tab's "apply a logo to garments" grid.
// Kept out of the React component so the color-way and placement logic is unit-tested
// independently of the DOM. Two concerns:
//   1. Autocolor — pick the right logo appearance per garment color (real per-CW
//      variant when the logo has one, else a light/dark recolor).
//   2. Placement — resolve a garment's logo position/size from the per-style placement
//      with an optional per-garment nudge override.
import { normalizeWebLogos } from '../businessLogic';

// The garment-color brightness rule, shared by Autocolor and the grid defaults so a
// "Navy"/"Maroon"/"Forest" garment is correctly treated as dark (gets the light logo).
// One source of truth — the grid and the resolver must never disagree on light vs dark.
export const DARK_WORDS = ['black', 'navy', 'royal', 'forest', 'maroon', 'charcoal', 'graphite', 'purple', 'brown', 'hunter', 'dark', 'midnight', 'kelly', 'olive', 'crimson', 'cardinal'];
export const guessDarkColor = (name) => { const s = String(name || '').toLowerCase(); return DARK_WORDS.some((w) => s.includes(w)); };

// Common apparel color names → a representative swatch hex, so a web-logo card can preview
// its cutout on the garment color it covers (a white cutout must sit on a dark swatch to
// read; a dark cutout on a light one). Mirrors the palette in QuickMockBuilder. Unknown
// names fall back to the brightness guess, so every color still gets a legible background.
const GARMENT_HEX = {
  black: '#111827', white: '#ffffff', navy: '#1f2a44', 'navy blue': '#1f2a44',
  royal: '#1d4ed8', 'royal blue': '#1d4ed8', red: '#dc2626', maroon: '#7f1d1d',
  cardinal: '#9b1c31', scarlet: '#c8102e', burgundy: '#7b1e3b', forest: '#14532d',
  'forest green': '#14532d', green: '#16a34a', kelly: '#16a34a', 'kelly green': '#16a34a',
  lime: '#84cc16', 'safety green': '#c6ff00', 'neon green': '#39ff14', gold: '#d4af37',
  'old gold': '#caa53d', 'vegas gold': '#c5b358', yellow: '#facc15', orange: '#ea580c',
  purple: '#7c3aed', grey: '#9ca3af', gray: '#9ca3af', 'heather grey': '#b6bcc4',
  'heather gray': '#b6bcc4', 'athletic heather': '#cbd5e1', charcoal: '#374151',
  graphite: '#3a3f45', silver: '#cbd5e1', pink: '#ec4899', 'light blue': '#7dd3fc',
  'carolina blue': '#4b9cd3', 'columbia blue': '#9bcbeb', teal: '#14b8a6', brown: '#5c4033',
  tan: '#d2b48c', natural: '#f0ead6', cream: '#fffdd0', sand: '#e0d3af', ash: '#e6e8ea',
  midnight: '#0b1220', hunter: '#14532d', olive: '#556b2f', crimson: '#a11221',
};
// Look up a garment-color hex: exact name, else any word in it ("Heather Charcoal" →
// charcoal), else null so the caller can fall back by brightness.
const _garmentHexOf = (name) => {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  if (GARMENT_HEX[key]) return GARMENT_HEX[key];
  for (const w of key.split(/[^a-z0-9]+/).filter(Boolean)) { if (GARMENT_HEX[w]) return GARMENT_HEX[w]; }
  return null;
};
// Background hex for a garment color — known swatch, else a neutral dark/light by brightness.
export function garmentHex(name) {
  return _garmentHexOf(name) || (guessDarkColor(name) ? '#1f2937' : '#e5e7eb');
}
// Is a garment color dark enough to want a light (white) logo? Uses the swatch luminance
// when the color is known — so "Red" and "Grey" bucket correctly (word lists miss those) —
// and falls back to the word heuristic for names with no swatch.
const _lum = (hex) => { const m = String(hex || '').replace('#', '').match(/.{2}/g); if (!m) return 128; const [r, g, b] = m.map((x) => parseInt(x, 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };
export function garmentIsDark(name) {
  const hx = _garmentHexOf(name);
  return hx ? _lum(hx) < 130 : guessDarkColor(name);
}

const _words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Decoration methods whose colors are FIXED — embroidery (thread colors are stitched in),
// DTF and sublimation (full-color prints). A flat white/black recolor would knock a
// multi-color mark down to a single-color silhouette, so these must always show the real
// logo (Orig). Only genuine single-ink methods (screen print, vinyl) flip light/dark.
export const FIXED_COLOR_DECO = new Set(['embroidery', 'dtf', 'sublimation']);

// Decide how to color the logo for one garment color:
//   { kind:'variant', url, colorWayId, label } — use a real per-CW web-logo variant the
//        artist made (preferred: a proper 2-color knockout beats a flat recolor).
//   { kind:'recolor', choice:'white'|'original' } — no suitable variant; pixel-recolor
//        the single cutout (white on dark garments, original on light).
// Variant match order: (1) share a color word with the garment name ("Heather Grey" →
// "Grey" variant); (2) brightness — a variant whose OWN label is a dark color is the one
// meant FOR dark garments (its ink is light), so a dark garment picks it and a light
// garment picks a light-labeled variant. Only ≥2 real variants trigger variant mode.
export function autoColorChoice(activeArt, colorName) {
  const wls = normalizeWebLogos(activeArt && activeArt.web_logos, activeArt && activeArt.color_ways).filter((w) => w && w.url);
  if (wls.length >= 2) {
    const g = _words(colorName);
    let hit = null;
    if (g.length) hit = wls.find((w) => { const c = _words(w.color_way); return c.length && (c.some((t) => g.includes(t)) || g.some((t) => c.includes(t))); });
    if (!hit) {
      const dark = guessDarkColor(colorName);
      hit = wls.find((w) => (w.color_way || '').trim() && guessDarkColor(w.color_way) === dark);
    }
    if (hit) return { kind: 'variant', url: hit.url, colorWayId: hit.color_way_id || null, label: hit.color_way || '' };
  }
  // Fixed-color methods never get a flat recolor — the real logo reads correctly on any garment.
  if (FIXED_COLOR_DECO.has(String((activeArt && activeArt.deco_type) || '').toLowerCase())) return { kind: 'recolor', choice: 'original' };
  return { kind: 'recolor', choice: guessDarkColor(colorName) ? 'white' : 'original' };
}

// Resolve a garment's placement: start from the chosen preset, layer the per-style
// placement (drag/resize applies to the whole style), then a per-garment nudge override
// for the odd garment. preset is an ART_PLACEMENTS entry ({ id, x, y, w }).
export function resolveItemPlacement(preset, placeByStyle, placeByItem, styleKey, itemId) {
  const base = { placement: (preset && preset.id) || 'left_chest', x: (preset && preset.x) || 50, y: (preset && preset.y) || 50, w: (preset && preset.w) || 30 };
  const sp = (placeByStyle && placeByStyle[styleKey]) || null;
  const merged = sp ? Object.assign({}, base, sp) : base;
  const ov = (placeByItem && placeByItem[itemId]) || null;
  return ov ? Object.assign({}, merged, ov) : merged;
}

// Classify a product name into a garment TYPE for placement memory — "left chest on a
// hoodie" sits differently than on a tee (collar, zipper, pocket), so remembered
// placements key on this. Order matters: more specific words first (a "hooded long
// sleeve tee" is a hoodie; a "polo tee" doesn't exist, but "pocket tee" must stay tee).
const GARMENT_TYPES = [
  ['hoodie', /hood/],
  ['quarter_zip', /(1\/4|quarter|qtr|half)[\s-]*zip/],
  ['jacket', /jacket|windbreaker|anorak|parka|coat/],
  ['polo', /polo/],
  ['crew', /crew\s*neck|crewneck|sweatshirt|fleece\s*crew/],
  ['jersey', /jersey/],
  ['tank', /tank|singlet|sleeveless/],
  ['long_sleeve', /long[\s-]*sleeve|\bls\b/],
  ['tee', /\btee\b|t[\s-]*shirt|\btshirt\b|\btop\b/],
  ['shorts', /short\b|shorts/],
  ['pants', /pant|jogger|legging|tight/],
  ['hat', /\bcap\b|\bhat\b|visor|beanie/],
  ['bag', /\bbag\b|backpack|duffel|sackpack|tote/],
  ['socks', /sock/],
];
export function garmentTypeOf(name) {
  const s = String(name || '').toLowerCase();
  for (const [type, re] of GARMENT_TYPES) { if (re.test(s)) return type; }
  return 'other';
}
