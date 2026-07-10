// Team Shop placement engine — the single source of truth mapping a coach's
// picker choices (garment + zone + logo + method) into:
//   (a) preview overlay props for src/lib/decoOverlay.js (the SAME renderer the
//       live public storefront uses), and
//   (b) the canonical order-line `decorations` JSON entry that later stages
//       persist and that netlify/functions/quickorder-quote.js cleanDeco()
//       accepts for server-side pricing.
//
// Pure — no React, no DOM, no network. The one JSON shape must round-trip both
// ways: DecoOverlay renders it as-is (art_url/side/x/y/w/placement), and
// cleanDeco prices it as-is (type + colors|stitches|dtf_size|underbase).
// src/__tests__/decoSpec.test.js proves both directions.
import { ART_PLACEMENTS, placementById } from '../lib/artPlacements';
import { garmentTypeOf } from '../lib/artGrid';
import * as DECO from '../lib/decoPricing';

// ── Bounds (exported so the picker UI and tests share them) ──────────
// A coach may nudge a logo at most this many percent points from the zone's
// default center, and resize between SCALE_MIN×..SCALE_MAX× the default width.
// Tight on purpose: the coach picks a zone, not free-form art placement.
export const NUDGE_LIMIT = 8; // ± percent points on x and y
export const SCALE_MIN = 0.6; // × zone default width
export const SCALE_MAX = 1.4; // × zone default width

// Decoration methods the quote function prices (cleanDeco rejects anything else).
export const DECO_METHODS = ['screen_print', 'embroidery', 'dtf'];
export const DEFAULT_STITCHES = 8000; // cleanDeco's own fallback — keep in sync
export const MAX_STITCHES = 999999;
export const MAX_SP_COLORS = 5;
// DTF sizes are an index into the shared pricing table (0 = smallest).
export const DTF_SIZES = DECO.DTF.map((t, i) => ({ value: i, label: t.label }));

// ── Zone derivation ──────────────────────────────────────────────────
// Which ART_PLACEMENTS zones make sense per garment archetype (artGrid's
// garmentTypeOf). Plackets/zippers rule out full-front; tanks have no sleeves;
// caps/bags/socks get a single centered mark; bottoms take a small hip mark
// (the left_chest zone lands on the upper-left of the product photo).
const ZONE_SIDES = { full_back: 'back' }; // everything else previews on the front photo
const TOP_FULL = ['left_chest', 'full_front', 'full_back', 'left_sleeve', 'right_sleeve'];
const TOP_PLACKET = ['left_chest', 'full_back', 'left_sleeve', 'right_sleeve'];
const ZONES_BY_TYPE = {
  tee: TOP_FULL,
  long_sleeve: TOP_FULL,
  crew: TOP_FULL,
  hoodie: TOP_FULL,
  jersey: TOP_FULL,
  tank: ['left_chest', 'full_front', 'full_back'],
  polo: TOP_PLACKET,
  quarter_zip: TOP_PLACKET,
  jacket: TOP_PLACKET,
  hat: ['center'],
  bag: ['center'],
  socks: ['center'],
  shorts: ['left_chest'],
  pants: ['left_chest'],
  other: ['left_chest', 'full_front', 'full_back', 'center'],
};

// The applicable zones for a product (object with .name, or a bare name string):
// [{ id, label, side, x, y, w }] — x/y/w are the zone's DEFAULT placement.
export function zonesForGarment(product) {
  const name = typeof product === 'string' ? product : (product && product.name) || '';
  const type = garmentTypeOf(name);
  const ids = ZONES_BY_TYPE[type] || ZONES_BY_TYPE.other;
  return ids
    .map((id) => ART_PLACEMENTS.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, label: p.label, side: ZONE_SIDES[p.id] || 'front', x: p.x, y: p.y, w: p.w }));
}

// ── Clamped nudge/resize ─────────────────────────────────────────────
const _num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const _r1 = (n) => Math.round(n * 10) / 10; // keep the persisted JSON tidy

// Bound a requested {x,y,w} to the zone: x/y within ±NUDGE_LIMIT of the zone
// default, w within [w×SCALE_MIN, w×SCALE_MAX]. Garbage in → the zone default
// out; the result is ALWAYS a valid placement.
export function clampPlacement(zone, place) {
  const z = zone || placementById(null);
  const p = place || {};
  return {
    x: _r1(_clamp(_num(p.x, z.x), z.x - NUDGE_LIMIT, z.x + NUDGE_LIMIT)),
    y: _r1(_clamp(_num(p.y, z.y), z.y - NUDGE_LIMIT, z.y + NUDGE_LIMIT)),
    w: _r1(_clamp(_num(p.w, z.w), z.w * SCALE_MIN, z.w * SCALE_MAX)),
  };
}

// ── Spec construction ────────────────────────────────────────────────
const _method = (m) => {
  const t = String(m || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return t === 'screenprint' ? 'screen_print' : t;
};

// Method-specific pricing fields, mirroring cleanDeco's normalization exactly so
// what we persist is what the server prices (no silent re-clamping drift).
function _pricingFields(type, options) {
  const o = options || {};
  if (type === 'screen_print') {
    return { colors: _clamp(parseInt(o.colors, 10) || 1, 1, MAX_SP_COLORS), underbase: !!o.underbase };
  }
  if (type === 'embroidery') {
    return { stitches: _clamp(parseInt(o.stitches, 10) || DEFAULT_STITCHES, 1, MAX_STITCHES) };
  }
  if (type === 'dtf') {
    const i = parseInt(o.dtf_size, 10);
    return { dtf_size: DECO.DTF[i] ? i : 0 };
  }
  return null;
}

// Build the canonical decorations entry from picker choices. Throws on inputs a
// working picker can never produce (unknown method, no zone, logo without a url)
// — those are programming errors, not coach input.
//   zone      — an entry from zonesForGarment()
//   placement — optional {x,y,w} nudge (clamped to the zone)
//   logo      — teamshop-art.js entry: { id, url, name?, source: 'art_library'|'teamshop' }
//   method    — 'screen_print' (or 'screenprint') | 'embroidery' | 'dtf'
//   options   — { colors?, underbase?, stitches?, dtf_size? } per method
//   side      — optional 'front'|'back' override (defaults to the zone's side)
export function buildDecoSpec({ zone, placement, logo, method, options, side } = {}) {
  if (!zone || !zone.id) throw new Error('buildDecoSpec: zone required');
  if (!logo || !logo.url) throw new Error('buildDecoSpec: logo with a url required');
  const type = _method(method);
  if (!DECO_METHODS.includes(type)) throw new Error(`buildDecoSpec: unsupported method "${method}"`);
  const s = side || zone.side || 'front';
  if (s !== 'front' && s !== 'back') throw new Error(`buildDecoSpec: bad side "${side}"`);
  const pos = clampPlacement(zone, placement);
  const idField = (logo.source === 'teamshop')
    ? { teamshop_logo_id: logo.id }
    : { art_file_id: logo.id };
  return {
    // Overlay fields — exactly what DecoOverlay renders.
    art_url: logo.url,
    side: s,
    x: pos.x,
    y: pos.y,
    w: pos.w,
    placement: zone.id,
    // Provenance — which logo record this came from, for later stages.
    logo_source: logo.source || 'art_library',
    ...idField,
    // Pricing fields — exactly what cleanDeco accepts.
    type,
    ..._pricingFields(type, options),
  };
}

// The exact props DecoOverlay consumes to preview one spec on a garment photo.
export function specToOverlayProps(spec, colorName) {
  return {
    decorations: [spec],
    side: (spec && spec.side) || 'front',
    ...(colorName != null ? { colorName } : {}),
  };
}

// ── Validation guard ─────────────────────────────────────────────────
const _fail = (reason) => ({ ok: false, reason });
const _isInt = (v) => Number.isInteger(v);

// Is a spec safe to persist and price? Checks the overlay contract (renderable
// placement inside the zone's clamp bounds) AND the pricing contract (fields
// cleanDeco needs, already normalized). Returns { ok: true } or { ok:false, reason }.
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') return _fail('not an object');
  if (!spec.art_url || typeof spec.art_url !== 'string') return _fail('missing art_url');
  if (spec.side !== 'front' && spec.side !== 'back') return _fail('side must be front or back');
  const zone = ART_PLACEMENTS.find((p) => p.id === spec.placement);
  if (!zone) return _fail(`unknown placement "${spec.placement}"`);
  const { x, y, w } = spec;
  if (!Number.isFinite(x) || Math.abs(x - zone.x) > NUDGE_LIMIT) return _fail('x outside the zone nudge range');
  if (!Number.isFinite(y) || Math.abs(y - zone.y) > NUDGE_LIMIT) return _fail('y outside the zone nudge range');
  if (!Number.isFinite(w) || w < zone.w * SCALE_MIN || w > zone.w * SCALE_MAX) return _fail('w outside the zone scale range');
  if (!DECO_METHODS.includes(spec.type)) return _fail(`unsupported type "${spec.type}"`);
  if (spec.type === 'screen_print' && !(_isInt(spec.colors) && spec.colors >= 1 && spec.colors <= MAX_SP_COLORS)) return _fail('screen_print needs colors 1-5');
  if (spec.type === 'embroidery' && !(_isInt(spec.stitches) && spec.stitches >= 1 && spec.stitches <= MAX_STITCHES)) return _fail('embroidery needs a stitch count');
  if (spec.type === 'dtf' && !(_isInt(spec.dtf_size) && DECO.DTF[spec.dtf_size])) return _fail('dtf needs a valid dtf_size');
  if (spec.logo_source === 'teamshop') {
    if (!spec.teamshop_logo_id) return _fail('teamshop logo needs teamshop_logo_id');
  } else if (!spec.art_file_id) return _fail('library logo needs art_file_id');
  return { ok: true };
}
