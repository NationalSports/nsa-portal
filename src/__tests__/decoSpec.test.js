/* Team Shop placement engine (Stage 4 core) — src/teamshop/decoSpec.js.
 *
 * The load-bearing contract: ONE decorations JSON shape that (a) the shared
 * DecoOverlay renderer (src/lib/decoOverlay.js — the live storefront's own
 * renderer) draws as-is, and (b) the quote function's cleanDeco accepts for
 * server-side pricing. Both directions are proven here with the REAL modules,
 * not copies: cleanDeco is imported from netlify/functions/quickorder-quote.js
 * and DecoOverlay from the extracted shared module. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

import {
  zonesForGarment, clampPlacement, buildDecoSpec, specToOverlayProps, validateSpec,
  NUDGE_LIMIT, SCALE_MIN, SCALE_MAX, DECO_METHODS, DEFAULT_STITCHES, DTF_SIZES,
  METHOD_FAMILIES, familyOfType, OPTION_KEYS,
} from '../teamshop/decoSpec';
import { ART_PLACEMENTS, placementById } from '../lib/artPlacements';
import { garmentTypeOf } from '../lib/artGrid';
import * as overlayModule from '../lib/decoOverlay';
import { DecoOverlay, decoUrlForColor } from '../lib/decoOverlay';
import * as DECO from '../lib/decoPricing';

const { cleanDeco } = require('../../netlify/functions/quickorder-quote');

const LIB_LOGO = { id: 'art_1', url: 'https://cdn/x/logo.png', name: 'Crest', source: 'art_library' };
const UP_LOGO = { id: 'ts_9', url: 'https://cdn/x/upload.png', name: 'Upload', source: 'teamshop' };
const zoneById = (product, id) => zonesForGarment(product).find((z) => z.id === id);

// ── Zone derivation per garment archetype ────────────────────────────
describe('zonesForGarment', () => {
  const ids = (product) => zonesForGarment(product).map((z) => z.id);

  test('tee / long sleeve / crew / hoodie / jersey get the full top set', () => {
    for (const name of ['Team Cotton Tee', 'Long Sleeve Performance Tee', 'Crewneck Sweatshirt', 'Fleece Hoodie', 'Replica Jersey']) {
      expect(ids(name)).toEqual(['left_chest', 'full_front', 'full_back', 'left_sleeve', 'right_sleeve']);
    }
  });
  test('placket/zipper tops (polo, quarter-zip, jacket) exclude full front', () => {
    for (const name of ['Performance Polo', '1/4 Zip Pullover', 'Warmup Jacket']) {
      expect(ids(name)).toEqual(['left_chest', 'full_back', 'left_sleeve', 'right_sleeve']);
      expect(ids(name)).not.toContain('full_front');
    }
  });
  test('tanks have no sleeve zones', () => {
    expect(ids('Ladies Racerback Tank')).toEqual(['left_chest', 'full_front', 'full_back']);
  });
  test('caps, bags, socks get a single centered zone', () => {
    expect(ids('Snapback Cap')).toEqual(['center']);
    expect(ids('Team Duffel Bag')).toEqual(['center']);
    expect(ids('Crew Socks')).toEqual(['center']);
  });
  test('bottoms get the small left-hip mark', () => {
    expect(ids('Mesh Shorts')).toEqual(['left_chest']);
    expect(ids('Fleece Joggers')).toEqual(['left_chest']);
  });
  test('unclassified products fall back to a sensible general set', () => {
    expect(garmentTypeOf('Stainless Water Bottle')).toBe('other');
    expect(ids('Stainless Water Bottle')).toEqual(['left_chest', 'full_front', 'full_back', 'center']);
  });
  test('accepts a product object and matches artGrid classification', () => {
    expect(ids({ name: 'Youth Hooded Sweatshirt' })).toEqual(ids('Fleece Hoodie'));
    expect(garmentTypeOf('Youth Hooded Sweatshirt')).toBe('hoodie');
  });
  test('every zone carries the ART_PLACEMENTS default and a side (full_back → back)', () => {
    for (const z of zonesForGarment('Team Cotton Tee')) {
      const src = placementById(z.id);
      expect({ x: z.x, y: z.y, w: z.w }).toEqual({ x: src.x, y: src.y, w: src.w });
      expect(z.side).toBe(z.id === 'full_back' ? 'back' : 'front');
    }
    // and every id we hand out actually exists in the shared placement table
    for (const type of [['Tee'], ['Polo'], ['Tank'], ['Cap'], ['Shorts'], ['Bottle']]) {
      for (const z of zonesForGarment(type[0])) expect(ART_PLACEMENTS.some((p) => p.id === z.id)).toBe(true);
    }
  });
});

// ── Clamped nudge/resize ─────────────────────────────────────────────
describe('clampPlacement', () => {
  const zone = zoneById('Team Cotton Tee', 'left_chest'); // default x67 y33 w20

  test('a placement inside the bounds passes through', () => {
    expect(clampPlacement(zone, { x: 70, y: 30, w: 24 })).toEqual({ x: 70, y: 30, w: 24 });
  });
  test('exactly at the bounds is kept', () => {
    expect(clampPlacement(zone, { x: zone.x + NUDGE_LIMIT, y: zone.y - NUDGE_LIMIT, w: zone.w * SCALE_MAX }))
      .toEqual({ x: 75, y: 25, w: 28 });
    expect(clampPlacement(zone, { x: zone.x - NUDGE_LIMIT, y: zone.y + NUDGE_LIMIT, w: zone.w * SCALE_MIN }))
      .toEqual({ x: 59, y: 41, w: 12 });
  });
  test('far outside clamps to the edge, never rejects', () => {
    expect(clampPlacement(zone, { x: 5, y: 99, w: 500 })).toEqual({ x: 59, y: 41, w: 28 });
    expect(clampPlacement(zone, { x: 100, y: -20, w: 0 })).toEqual({ x: 75, y: 25, w: 12 });
  });
  test('missing/garbage input yields the zone default', () => {
    expect(clampPlacement(zone, undefined)).toEqual({ x: 67, y: 33, w: 20 });
    expect(clampPlacement(zone, { x: 'abc', y: null, w: NaN })).toEqual({ x: 67, y: 33, w: 20 });
  });
  test('bounds derive from EACH zone, not a global box', () => {
    const back = zoneById('Team Cotton Tee', 'full_back'); // x50 y43 w44
    expect(clampPlacement(back, { x: 0, y: 0, w: 999 }))
      .toEqual({ x: back.x - NUDGE_LIMIT, y: back.y - NUDGE_LIMIT, w: Math.round(back.w * SCALE_MAX * 10) / 10 });
  });
});

// ── buildDecoSpec per method ─────────────────────────────────────────
describe('buildDecoSpec', () => {
  const zone = zoneById('Team Cotton Tee', 'left_chest');

  test('screen print: colors clamped 1-5, underbase boolean, defaults to 1 color', () => {
    const s = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screen_print', options: { colors: 3, underbase: 1 } });
    expect(s).toMatchObject({ type: 'screen_print', colors: 3, underbase: true, placement: 'left_chest', side: 'front', art_url: LIB_LOGO.url, logo_source: 'art_library', art_file_id: 'art_1' });
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screen_print' })).toMatchObject({ colors: 1, underbase: false });
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screen_print', options: { colors: 99 } }).colors).toBe(5);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screen_print', options: { colors: 0 } }).colors).toBe(1);
  });
  test('"screenprint" spelling normalizes to the cleanDeco type', () => {
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screenprint' }).type).toBe('screen_print');
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'Screen Print' }).type).toBe('screen_print');
  });
  test('embroidery: defaults to 8000 stitches when unknown, clamps the extremes', () => {
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery' }).stitches).toBe(DEFAULT_STITCHES);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery', options: { stitches: 12500 } }).stitches).toBe(12500);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery', options: { stitches: 99999999 } }).stitches).toBe(999999);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery', options: { stitches: 'lots' } }).stitches).toBe(DEFAULT_STITCHES);
  });
  test('dtf: dtf_size must index the shared DTF table, else 0', () => {
    expect(DTF_SIZES.length).toBe(DECO.DTF.length);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf' }).dtf_size).toBe(0);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf', options: { dtf_size: 1 } }).dtf_size).toBe(1);
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf', options: { dtf_size: 42 } }).dtf_size).toBe(0);
  });
  test('logo identity: teamshop uploads carry teamshop_logo_id, library art art_file_id', () => {
    const up = buildDecoSpec({ zone, logo: UP_LOGO, method: 'dtf' });
    expect(up).toMatchObject({ logo_source: 'teamshop', teamshop_logo_id: 'ts_9' });
    expect(up.art_file_id).toBeUndefined();
    const lib = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery' });
    expect(lib).toMatchObject({ logo_source: 'art_library', art_file_id: 'art_1' });
    expect(lib.teamshop_logo_id).toBeUndefined();
  });
  test('side: defaults from the zone, explicit override wins', () => {
    const back = zoneById('Team Cotton Tee', 'full_back');
    expect(buildDecoSpec({ zone: back, logo: LIB_LOGO, method: 'dtf' }).side).toBe('back');
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf' }).side).toBe('front');
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf', side: 'back' }).side).toBe('back');
  });
  test('nudges are clamped into the spec, defaults used when no placement given', () => {
    const s = buildDecoSpec({ zone, placement: { x: 200, y: -5, w: 1000 }, logo: LIB_LOGO, method: 'dtf' });
    expect({ x: s.x, y: s.y, w: s.w }).toEqual({ x: zone.x + NUDGE_LIMIT, y: zone.y - NUDGE_LIMIT, w: zone.w * SCALE_MAX });
    const d = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf' });
    expect({ x: d.x, y: d.y, w: d.w }).toEqual({ x: zone.x, y: zone.y, w: zone.w });
  });
  test('programming errors throw: no zone, no logo url, unknown method, bad side', () => {
    expect(() => buildDecoSpec({ logo: LIB_LOGO, method: 'dtf' })).toThrow(/zone/);
    expect(() => buildDecoSpec({ zone, logo: { id: 'x' }, method: 'dtf' })).toThrow(/logo/);
    expect(() => buildDecoSpec({ zone, logo: LIB_LOGO, method: 'laser_etch' })).toThrow(/unsupported/);
    expect(() => buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf', side: 'left' })).toThrow(/side/);
  });
});

// ── Round trip (b): cleanDeco prices every valid spec ────────────────
describe('cleanDeco round trip — the spec IS the pricing input', () => {
  const zone = zoneById('Team Cotton Tee', 'left_chest');
  const cases = [];
  for (const logo of [LIB_LOGO, UP_LOGO]) {
    for (let colors = 1; colors <= 5; colors++) {
      for (const underbase of [false, true]) cases.push(['screen_print', { colors, underbase }, logo]);
    }
    for (const stitches of [undefined, 1, 5000, 8000, 15000, 999999]) cases.push(['embroidery', { stitches }, logo]);
    for (let i = 0; i < DECO.DTF.length; i++) cases.push(['dtf', { dtf_size: i }, logo]);
  }

  test.each(cases)('%s %j survives cleanDeco unchanged and prices > 0', (method, options, logo) => {
    const spec = buildDecoSpec({ zone, logo, method, options });
    expect(validateSpec(spec)).toEqual({ ok: true });
    const cleaned = cleanDeco(spec);
    expect(cleaned).not.toBeNull();
    expect(cleaned.type).toBe(method);
    // cleanDeco must not renormalize anything — the persisted spec is already canonical
    // (option defaults to 'standard' on both sides of the wire).
    if (method === 'screen_print') expect(cleaned).toEqual({ type: 'screen_print', option: 'standard', colors: spec.colors, underbase: spec.underbase });
    if (method === 'embroidery') expect(cleaned).toEqual({ type: 'embroidery', option: 'standard', stitches: spec.stitches });
    if (method === 'dtf') expect(cleaned).toEqual({ type: 'dtf', option: 'standard', dtf_size: spec.dtf_size });
    // and the shared pricing engine actually prices it
    const priced = DECO.dP(DECO.DEFAULTS, cleaned, 24);
    expect(Number(priced.sell)).toBeGreaterThan(0);
  });

  test('every method the engine offers is a method the server prices', () => {
    for (const m of DECO_METHODS) {
      expect(cleanDeco({ type: m })).not.toBeNull();
    }
  });

  test('the new heat kinds round-trip with their option (flat rate-card types — no dP price)', () => {
    for (const [type, option] of [['vinyl', 'standard'], ['vinyl', 'number'], ['vinyl', 'name_number'], ['silicone_patch', 'standard']]) {
      const spec = buildDecoSpec({ zone, logo: LIB_LOGO, type, option });
      expect(validateSpec(spec)).toEqual({ ok: true });
      expect(spec).toMatchObject({ type, option, family: 'heat' });
      expect(cleanDeco(spec)).toEqual({ type, option });
    }
  });
});

// ── Method families (owner-approved taxonomy, mirrors 00198 seeds) ────
describe('METHOD_FAMILIES', () => {
  test('three families: embroidery, heat (with kinds), screen_print (24 min)', () => {
    expect(METHOD_FAMILIES.map((f) => f.key)).toEqual(['embroidery', 'heat', 'screen_print']);
    const heat = METHOD_FAMILIES.find((f) => f.key === 'heat');
    expect(heat.label).toBe('Heat Applications');
    expect(heat.types.map((t) => t.type)).toEqual(['dtf', 'vinyl', 'silicone_patch']);
    expect(heat.types.find((t) => t.type === 'vinyl').options).toEqual(['standard', 'number', 'name_number']);
    expect(METHOD_FAMILIES.find((f) => f.key === 'screen_print').minQty).toBe(24);
  });

  test('every family type is a priceable DECO_METHOD and every option is whitelisted', () => {
    for (const f of METHOD_FAMILIES) {
      for (const t of f.types) {
        expect(DECO_METHODS).toContain(t.type);
        expect(familyOfType(t.type)).toBe(f.key);
        for (const o of t.options) expect(OPTION_KEYS).toContain(o);
      }
    }
  });

  test('familyOfType: dtf is a heat KIND (not top-level); unknown types are null', () => {
    expect(familyOfType('dtf')).toBe('heat');
    expect(familyOfType('embroidery')).toBe('embroidery');
    expect(familyOfType('screen_print')).toBe('screen_print');
    expect(familyOfType('laser')).toBeNull();
  });

  test('buildDecoSpec stamps family from the TYPE (production identity wins over a bogus family)', () => {
    const s = buildDecoSpec({ zone: zoneById('Team Cotton Tee', 'left_chest'), logo: LIB_LOGO, family: 'screen_print', type: 'dtf' });
    expect(s.family).toBe('heat');
    expect(s.type).toBe('dtf');
  });

  test('backward compat: a pre-family spec (bare type dtf, no family/option) still validates', () => {
    const zone = zoneById('Team Cotton Tee', 'left_chest');
    const legacy = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf' });
    delete legacy.family;
    delete legacy.option;
    expect(validateSpec(legacy)).toEqual({ ok: true });
    expect(cleanDeco(legacy)).toEqual({ type: 'dtf', option: 'standard', dtf_size: 0 });
  });

  test('validateSpec rejects an incoherent family or an option the type does not offer', () => {
    const zone = zoneById('Team Cotton Tee', 'left_chest');
    const vinyl = buildDecoSpec({ zone, logo: LIB_LOGO, type: 'vinyl', option: 'number' });
    expect(validateSpec({ ...vinyl, family: 'screen_print' }).ok).toBe(false);
    expect(validateSpec({ ...vinyl, option: 'gigantic' }).ok).toBe(false);
    const emb = buildDecoSpec({ zone, logo: LIB_LOGO, type: 'embroidery' });
    expect(validateSpec({ ...emb, option: 'name_number' }).ok).toBe(false); // embroidery offers standard only
  });

  test('buildDecoSpec normalizes an unknown option to standard', () => {
    const zone = zoneById('Team Cotton Tee', 'left_chest');
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, type: 'vinyl', option: 'nope' }).option).toBe('standard');
    expect(buildDecoSpec({ zone, logo: LIB_LOGO, type: 'embroidery', option: 'number' }).option).toBe('standard');
  });
});

// ── Round trip (a): DecoOverlay renders the spec as-is ───────────────
describe('specToOverlayProps → DecoOverlay contract', () => {
  const zone = zoneById('Fleece Hoodie', 'full_front');
  const spec = buildDecoSpec({ zone, placement: { x: 52, y: 40, w: 36 }, logo: LIB_LOGO, method: 'screen_print', options: { colors: 2 } });

  test('overlay props carry the spec verbatim on the right side', () => {
    expect(specToOverlayProps(spec)).toEqual({ decorations: [spec], side: 'front' });
    expect(specToOverlayProps(spec, 'Black')).toEqual({ decorations: [spec], side: 'front', colorName: 'Black' });
    const back = buildDecoSpec({ zone: zoneById('Fleece Hoodie', 'full_back'), logo: LIB_LOGO, method: 'dtf' });
    expect(specToOverlayProps(back).side).toBe('back');
  });

  test('DecoOverlay draws the spec at its clamped x/y/w with the logo url', () => {
    const el = DecoOverlay(specToOverlayProps(spec, 'Black'));
    const imgs = React_Children(el);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].type).toBe('img');
    expect(imgs[0].props.src).toBe(LIB_LOGO.url);
    expect(imgs[0].props.style).toMatchObject({ left: `${spec.x}%`, top: `${spec.y}%`, width: `${spec.w}%`, position: 'absolute' });
  });

  test('a back spec does not render on the front preview (and vice versa)', () => {
    const back = buildDecoSpec({ zone: zoneById('Fleece Hoodie', 'full_back'), logo: LIB_LOGO, method: 'dtf' });
    expect(React_Children(DecoOverlay({ decorations: [back], side: 'front' }))).toHaveLength(0);
    expect(React_Children(DecoOverlay(specToOverlayProps(back)))).toHaveLength(1);
  });
});

// Unwrap the fragment DecoOverlay returns into its rendered <img> children.
function React_Children(el) {
  if (el == null) return [];
  const kids = el.props && el.props.children;
  return (Array.isArray(kids) ? kids : [kids]).filter(Boolean);
}

// ── validateSpec rejections ──────────────────────────────────────────
describe('validateSpec', () => {
  const zone = zoneById('Team Cotton Tee', 'left_chest');
  const good = () => buildDecoSpec({ zone, logo: LIB_LOGO, method: 'screen_print', options: { colors: 2 } });

  test('a built spec always validates', () => {
    expect(validateSpec(good())).toEqual({ ok: true });
  });
  const reject = (mut, why) => {
    const s = { ...good(), ...mut };
    const r = validateSpec(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(why);
  };
  test('rejects a missing/blank art_url', () => { reject({ art_url: '' }, /art_url/); reject({ art_url: null }, /art_url/); });
  test('rejects an unknown placement zone', () => reject({ placement: 'right_chest' }, /placement/));
  test('rejects a bad side', () => reject({ side: 'sleeve' }, /side/));
  test('rejects x/y outside the nudge bounds and w outside the scale bounds', () => {
    reject({ x: zone.x + NUDGE_LIMIT + 1 }, /x outside/);
    reject({ y: zone.y - NUDGE_LIMIT - 0.5 }, /y outside/);
    reject({ w: zone.w * SCALE_MAX + 1 }, /w outside/);
    reject({ w: zone.w * SCALE_MIN - 1 }, /w outside/);
    reject({ x: NaN }, /x outside/);
  });
  test('rejects unpriceable methods and bad pricing fields', () => {
    reject({ type: 'laser_etch' }, /type/);
    reject({ colors: 0 }, /colors/);
    reject({ colors: 6 }, /colors/);
    reject({ colors: 2.5 }, /colors/);
    const emb = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'embroidery' });
    expect(validateSpec({ ...emb, stitches: 0 }).ok).toBe(false);
    expect(validateSpec({ ...emb, stitches: '8000' }).ok).toBe(false); // strings are not canonical
    const dtf = buildDecoSpec({ zone, logo: LIB_LOGO, method: 'dtf' });
    expect(validateSpec({ ...dtf, dtf_size: 99 }).ok).toBe(false);
    expect(validateSpec({ ...dtf, dtf_size: -1 }).ok).toBe(false);
  });
  test('rejects a spec missing its logo identity for its source', () => {
    const up = buildDecoSpec({ zone, logo: UP_LOGO, method: 'dtf' });
    expect(validateSpec({ ...up, teamshop_logo_id: undefined }).ok).toBe(false);
    const lib = good();
    expect(validateSpec({ ...lib, art_file_id: undefined }).ok).toBe(false);
  });
  test('rejects non-objects', () => {
    expect(validateSpec(null).ok).toBe(false);
    expect(validateSpec('spec').ok).toBe(false);
  });
});

// ── Extraction guard: the shared overlay module the LIVE storefront uses ─
describe('decoOverlay module (extracted from Storefront) exports are intact', () => {
  test('named + default exports', () => {
    expect(typeof DecoOverlay).toBe('function');
    expect(typeof decoUrlForColor).toBe('function');
    expect(overlayModule.default).toBe(DecoOverlay);
  });
  test('decoUrlForColor: per-color override, legacy bare-url map, art_url fallback', () => {
    const d = { art_url: 'orig.png', cw_by_color: { black: { url: 'white.png' }, navy: 'navy.png' } };
    expect(decoUrlForColor(d, 'Black')).toBe('white.png');
    expect(decoUrlForColor(d, 'navy')).toBe('navy.png');
    expect(decoUrlForColor(d, 'Red')).toBe('orig.png');
    expect(decoUrlForColor({ art_url: 'a.png' }, undefined)).toBe('a.png');
    expect(decoUrlForColor(null, 'Black')).toBe('');
  });
  test('storefront behaviors preserved: baked skipped, preset fallback, null-safe', () => {
    expect(DecoOverlay({ decorations: null })).toBeNull();
    const baked = { art_url: 'a.png', baked: true };
    expect(React_Children(DecoOverlay({ decorations: [baked] }))).toHaveLength(0);
    // no x/y/w on the deco → falls back to the shared placement preset
    const preset = placementById('left_chest');
    const [img] = React_Children(DecoOverlay({ decorations: [{ art_url: 'a.png', placement: 'left_chest' }] }));
    expect(img.props.style).toMatchObject({ left: `${preset.x}%`, top: `${preset.y}%`, width: `${preset.w}%` });
  });
  test('Storefront still builds against the shared module (lazy route entry loads)', () => {
    const Storefront = require('../storefront/Storefront');
    expect(typeof Storefront.default).toBe('function');
  });
});
