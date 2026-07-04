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

const _words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

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
