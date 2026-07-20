/* eslint-disable */
// Uniform Builder — Pro Configurator (guided flow).
//
// A step-based team-uniform designer (Team → Jersey → Numbers → Roster →
// Finalize) inspired by the pro sportswear configurators. It keeps the live
// GLB 3D preview (Viewer3D) as the render engine and the shared design-spec
// model, but wraps them in a guided commerce flow that ends in a team roster
// and an order hand-off.
//
// The wizard keeps a small, human "config" (three brand colors, a pattern, a
// number/name/font, a logo) and maps it onto the richer design spec via
// specFromConfig() so the same 3D viewer + 2D production renderer light up.
//
// The full-power editor (per-zone patterns, AI design, SVG upload, PDF proof)
// is still one click away via "Advanced editor".

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getTemplate } from './templates';
import { SETTINGS_DEFAULTS, loadBuilderSettings, loadBuilderPatterns } from './builderSettings';
import { FABRIC_DETAILS, fabricSwatchDataURL } from './fabricInfo';
import { renderToDataURL, renderProductionPDF, renderProductionSheet } from './renderCanvas';
import { fontStack } from './fonts';
import { calculateUniformPrice, formatUniformMoney, normalizeUniformDiscount } from './pricing';
import { canvasFromImage, cloneCanvas, trimTransparentCanvas } from './logoImage';
import * as ds from './designSpec';
import { StripePaymentModal } from '../modals';

const Viewer3D = React.lazy(() => import('./Viewer3D'));

// ── design tokens (match the NSA design system) ──────────────────────────────
const C = {
  navy: '#192853', navyDark: '#0F1A38', red: '#962C32', redBright: '#B8333B',
  white: '#fff', offWhite: '#F7F8FB', light: '#EEF1F6', mid: '#D1D5DE',
  text: '#2A2F3E', textLight: '#5A6075', green: '#1F7A3D',
};
const F_DISP = "'Saira Condensed','Barlow Condensed','Arial Narrow',sans-serif";
const F_BODY = "'Source Sans 3','Segoe UI',system-ui,sans-serif";

// When the standalone /uniform-builder route is iframed onto the marketing site
// (nationalsportsapparel.com) under its own header — same pattern as /team-stores
// and /livelook (.../uniform-builder?embed=1) — the marketing header already
// provides site nav, so we drop our own top-left "back" button (it has nowhere
// to go on the public route) and let the builder sit cleanly as page content.
const EMBEDDED = (() => { try { return new URLSearchParams(window.location.search).get('embed') === '1'; } catch { return false; } })();
// Dedicated review links for the approved soccer layouts. They bypass
// autosave/catalog state so every URL opens a deterministic starting point.
const REVIEW_DESIGN = (() => { try { return new URLSearchParams(window.location.search).get('design') || ''; } catch { return ''; } })();
const AGI_PREVIEW = REVIEW_DESIGN === 'AGI-1011' || REVIEW_DESIGN === 'AGI-1012';
// The first procedural shorts study is intentionally withheld from the customer
// flow. Keep the underlying template/source for a future artist-built replacement,
// while the released configurator stays focused on the production-ready jersey.
const SHORTS_PREVIEW_ENABLED = false;

// 12-color team palette (+ sky, kept selectable so the Argentina demo maps to
// real swatches rather than a "custom" hex).
// Admin-managed via Settings → Uniform Builder; hydrated from Supabase on
// mount (see loadBuilderSettings) with these safe built-ins until then.
let PALETTE = SETTINGS_DEFAULTS.palette;
const nameForHex = (hex) => {
  const h = String(hex || '').toUpperCase();
  const hit = PALETTE.find((p) => p.hex.toUpperCase() === h);
  return hit ? hit.name : 'Custom';
};

// Full pattern library (ids/labels from designSpec, so they always validate).
const PATTERNS = ds.PATTERNS;
// Human-readable "Construction Materials" row value for a section/zone.
const zoneRowValue = (z) => {
  if (z.pattern === 'custom') return `Print: ${z.patternName || 'Custom'}`;
  if (z.pattern !== 'solid') return `${nameForHex(z.color)} · ${(PATTERNS.find((p) => p.id === z.pattern) || {}).label || 'Solid'} w/ ${nameForHex(z.color2)}`;
  return nameForHex(z.color);
};

// ── per-section design ────────────────────────────────────────────────────────
// Each section carries its own pattern + two colors. Sleeves are stored per-arm
// (sleeveL/sleeveR) but mirror each other by default — a "Split sleeves" toggle
// lets a coach style them independently.
const SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'sleeveL', label: 'Left Sleeve' },
  { key: 'sleeveR', label: 'Right Sleeve' },
  { key: 'collar', label: 'Collar & Cuffs' },
];
const AGI1012_LINKED_SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'bodyStripe', label: 'Chest Stripe', sourceKey: 'body', colorField: 'color2' },
  { key: 'sleeveL', label: 'Sleeves' },
  { key: 'sleeveBands', label: 'Sleeve Bands', sourceKey: 'sleeveL', colorField: 'color2' },
  { key: 'collar', label: 'Collar & Cuffs' },
];
const AGI1012_SPLIT_SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'bodyStripe', label: 'Chest Stripe', sourceKey: 'body', colorField: 'color2' },
  { key: 'sleeveL', label: 'Left Sleeve' },
  { key: 'sleeveBandL', label: 'Left Band', sourceKey: 'sleeveL', colorField: 'color2' },
  { key: 'sleeveR', label: 'Right Sleeve' },
  { key: 'sleeveBandR', label: 'Right Band', sourceKey: 'sleeveR', colorField: 'color2' },
  { key: 'collar', label: 'Collar & Cuffs' },
];
const AGI1011_LINKED_SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'bodyAccent', label: 'Side Panels', sourceKey: 'body', colorField: 'color2' },
  { key: 'sleeveL', label: 'Sleeves' },
  { key: 'sleeveBands', label: 'Sleeve Cuffs', sourceKey: 'sleeveL', colorField: 'color2' },
  { key: 'collar', label: 'Collar' },
];
const AGI1011_SPLIT_SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'bodyAccent', label: 'Side Panels', sourceKey: 'body', colorField: 'color2' },
  { key: 'sleeveL', label: 'Left Sleeve' },
  { key: 'sleeveBandL', label: 'Left Cuff', sourceKey: 'sleeveL', colorField: 'color2' },
  { key: 'sleeveR', label: 'Right Sleeve' },
  { key: 'sleeveBandR', label: 'Right Cuff', sourceKey: 'sleeveR', colorField: 'color2' },
  { key: 'collar', label: 'Collar' },
];
const defaultSections = () => ({
  body: { color: '#7CB0E0', color2: '#FFFFFF', pattern: 'boldstripe' },
  sleeveL: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' },
  sleeveR: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' },
  collar: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' },
});
// Accept sections written in either vocabulary: presets and pre-split autosaves
// say "sleeves" (one entry for both arms); storage/UI is always per-sleeve. An
// explicit sleeveL/sleeveR wins over the combined key.
const expandSections = (saved) => {
  if (!saved) return {};
  const out = { ...saved };
  if (saved.sleeves) {
    if (!out.sleeveL) out.sleeveL = { ...saved.sleeves };
    if (!out.sleeveR) out.sleeveR = { ...saved.sleeves };
    delete out.sleeves;
  }
  return out;
};
// Normalized read: defaults filled, combined-sleeves expanded.
const normSections = (sections) => ({ ...defaultSections(), ...expandSections(sections) });
// Autosaves from before per-section design carried flat color fields.
const sectionsFromLegacy = (c) => expandSections({
  body: { color: c.primary || '#7CB0E0', color2: c.secondary || '#FFFFFF', pattern: c.pattern || 'solid' },
  sleeves: { color: c.trim || '#192853', color2: c.secondary || '#FFFFFF', pattern: 'solid' },
  collar: { color: c.trim || '#192853', color2: c.secondary || '#FFFFFF', pattern: 'solid' },
});
// ── paired bottom garment (shorts) ────────────────────────────────────────────
// A top can ship with a matching bottom shown alongside it. Default is linked:
// the bottom's three sections derive live from the top's (legs<-body,
// waistband<-collar, stripe<-sleeves) so a coach never has to think about the
// shorts unless they want to; unlinking freezes the current derived look so
// they can then customize it independently.
const BOTTOM_SECTIONS = [
  { key: 'legs', label: 'Legs' },
  { key: 'waistband', label: 'Waistband' },
  { key: 'stripe', label: 'Angular Side Inserts' },
];
const defaultBottomSections = () => ({
  legs: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' },
  waistband: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' },
  stripe: { color: '#7CB0E0', color2: '#FFFFFF', pattern: 'solid' },
});
const defaultBottom = () => ({ enabled: true, linked: true, sections: defaultBottomSections() });
// The linked derivation, or the coach's independent sections once unlinked.
function effectiveBottomSections(cfg) {
  const S = normSections(cfg.sections);
  const bottom = cfg.bottom || defaultBottom();
  if (bottom.linked) {
    const from = (z) => ({ color: z.color, color2: z.color2, color3: z.color3, color4: z.color4, pattern: z.pattern, patternImage: z.patternImage, patternName: z.patternName, patternTint: z.patternTint, patternTintMode: z.patternTintMode });
    // Match the supplied shorts construction: body-color legs + waistband,
    // with the jersey's secondary graphic color on the angular side insert.
    const stripe = from(S.body);
    stripe.color = S.body.color2 || S.sleeveL.color2 || S.sleeveL.color;
    stripe.color2 = S.body.color;
    return { legs: from(S.body), waistband: from(S.body), stripe };
  }
  return { ...defaultBottomSections(), ...(bottom.sections || {}) };
}
function bottomSpecFromConfig(cfg) {
  const B = effectiveBottomSections(cfg);
  const zoneOf = (z) => ({
    color: z.color, color2: z.color2, pattern: z.pattern || 'solid',
    color3: z.color3, color4: z.color4,
    ...(z.pattern === 'custom' && z.patternImage ? { patternImage: z.patternImage, patternName: z.patternName, patternTint: !!z.patternTint, patternTintMode: z.patternTintMode } : {}),
  });
  return ds.normalizeSpec({
    garmentId: 'shorts', fabric: cfg.fabric || 'sublimated',
    zones: {
      legL: zoneOf(B.legs), legR: zoneOf(B.legs),
      waistband: zoneOf(B.waistband),
      sidePanelL: zoneOf(B.stripe), sidePanelR: zoneOf(B.stripe),
    },
    text: {
      front: { number: { value: '' }, name: { value: '' } },
      back: { number: { value: '' }, name: { value: '' } },
    },
    meta: { teamName: cfg.teamName },
  });
}

let FONTS = SETTINGS_DEFAULTS.numberStyles;
// Logo slots — each projects onto the jersey from a view; sleeve logos land on
// the sleeve panel (the 3D viewer raycasts the whole model, so a logo attaches
// to whatever surface it's over). Defaults pre-place each slot sensibly.
const LOGO_SLOTS = [
  // Crest default: wearer's LEFT chest = image-right, mirroring the front
  // number's spot on the wearer's right chest — both high, on the collarbone
  // line, like a pro kit.
  { key: 'chest', label: 'Left Chest', view: 'front', x: 0.67, y: 0.2, scale: 0.46 },
  { key: 'rightChest', label: 'Right Chest', view: 'front', x: 0.33, y: 0.2, scale: 0.46 },
  { key: 'leftSleeve', label: 'Left Sleeve', view: 'front', x: 0.17, y: 0.33, scale: 0.5 },
  { key: 'rightSleeve', label: 'Right Sleeve', view: 'front', x: 0.83, y: 0.33, scale: 0.5 },
  // Keep the legacy `back` key so saved designs retain their placed artwork.
  { key: 'back', label: 'Back Neck', view: 'back', x: 0.5, y: 0.15, scale: 0.46 },
  { key: 'backUnderNumber', label: 'Under Number', view: 'back', x: 0.5, y: 0.78, scale: 0.55 },
];
const SLOT_BY_KEY = LOGO_SLOTS.reduce((m, s) => { m[s.key] = s; return m; }, {});
const emptyLogos = () => LOGO_SLOTS.reduce((m, s) => { m[s.key] = { src: null, x: s.x, y: s.y, scale: s.scale, rot: 0, aspect: 1 }; return m; }, {});
const INCH_OPTIONS = [2, 4, 6, 8, 10].map((n) => ({ id: String(n), label: `${n}\u2033` }));
const OUTLINE_WEIGHT_OPTIONS = [
  { id: 'thin', label: 'Thin' },
  { id: 'standard', label: 'Standard' },
  { id: 'bold', label: 'Bold' },
];
const OUTLINE_WIDTHS = { thin: 2, standard: 3.25, bold: 5 };

// Production-safe decoration centers. These are normalized proof/garment
// coordinates, shared by presets, direct 3D dragging and exported proofs. They
// keep artwork off neck holes, arm seams and hems. Back numbers stay on the
// production centerline while remaining vertically adjustable; other artwork
// can still move freely across its real panel.
const DECORATION_SAFE_AREAS = {
  frontNumber: { x: [0.24, 0.76], y: [0.24, 0.50] },
  backNumber: { x: [0.5, 0.5], y: [0.28, 0.72] },
  backName: { x: [0.24, 0.76], y: [0.11, 0.31] },
  'logo:chest': { x: [0.22, 0.78], y: [0.13, 0.78] },
  'logo:rightChest': { x: [0.22, 0.78], y: [0.13, 0.78] },
  'logo:back': { x: [0.22, 0.78], y: [0.13, 0.78] },
  'logo:backUnderNumber': { x: [0.24, 0.76], y: [0.63, 0.86] },
  'logo:leftSleeve': { x: [0.07, 0.32], y: [0.17, 0.49] },
  'logo:rightSleeve': { x: [0.68, 0.93], y: [0.17, 0.49] },
};
function safeDecorationPosition(key, x, y) {
  const area = DECORATION_SAFE_AREAS[key] || { x: [0.03, 0.97], y: [0.03, 0.97] };
  return {
    x: ds.clamp(Number.isFinite(x) ? x : 0.5, area.x[0], area.x[1]),
    y: ds.clamp(Number.isFinite(y) ? y : 0.3, area.y[0], area.y[1]),
  };
}
const logoFinishedInches = (logo) => Math.round((((logo && logo.scale) || 1) * 5.72) * 100) / 100;
const logoDpi = (logo) => {
  const inches = logoFinishedInches(logo);
  return logo && Number.isFinite(logo.pixelHeight) && inches > 0 ? Math.round(logo.pixelHeight / inches) : null;
};

// Convert every populated placement into the shared production/3D logo lists.
// Kept as a pure exported helper so multi-logo behavior is regression-tested
// without depending on the browser's native file chooser.
export function logoSpecFromConfig(cfgLogos = {}) {
  const logos = { front: [], back: [] };
  for (const slot of LOGO_SLOTS) {
    const L = cfgLogos[slot.key];
    if (!L || !L.src) continue;
    const pos = safeDecorationPosition(`logo:${slot.key}`, L.x, L.y);
    const item = {
      id: 'logo-' + slot.key, src: L.src, x: pos.x, y: pos.y, w: 0.22 * (L.scale || 1),
      inches: 5.72 * (L.scale || 1), aspect: L.aspect || 1,
      rotation: L.rot || 0, opacity: 1, slot: slot.key,
      pixelWidth: L.pixelWidth || null, pixelHeight: L.pixelHeight || null,
    };
    (slot.view === 'back' ? logos.back : logos.front).push(item);
  }
  return logos;
}

// Artwork can arrive from the coach Art Locker, an order's art_files, or a
// small caller-owned list. Normalize those shapes once so the Embellish picker
// stays deliberately simple: one thumbnail, one name, one click to place.
function normalizeExistingArtwork(items) {
  const fileUrl = (file) => typeof file === 'string' ? file : (file && (file.url || file.src || file.preview_url)) || '';
  const firstUrl = (item) => {
    const direct = [item && item.src, item && item.url, item && item.preview_url, item && item.web_logo_url];
    const nested = [
      ...((item && item.urls) || []),
      ...((item && item.web_logos) || []),
      ...((item && item.mockup_files) || []),
      ...((item && item.files) || []),
      ...Object.values((item && item.item_mockups) || {}).flatMap((group) => group || []),
    ];
    return [...direct, ...nested].map(fileUrl).find(Boolean) || '';
  };
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const src = firstUrl(item || {});
    const name = String((item && (item.name || item.logo_name || item.label)) || `Team Art ${index + 1}`).trim();
    const id = String((item && (item.id || item.key)) || `${name}-${index}`);
    return { id, name, src };
  }).filter((item) => item.src && !seen.has(item.src) && seen.add(item.src));
}

// ── catalog: sports + starting designs ───────────────────────────────────────
// Every design is a preset over the same spec model, so each one is fully
// recolorable after selection. Thumbnails render live from the real proof
// pipeline (no static assets); vendor garment models per sport slot in here.
const SPORTS = [
  { key: 'football', label: 'Football', icon: '🏈' },
  { key: 'volleyball', label: 'Volleyball', icon: '🏐' },
  { key: 'basketball', label: 'Basketball', icon: '🏀' },
  { key: 'baseball', label: 'Baseball', icon: '⚾' },
  { key: 'track', label: 'Track & Field', icon: '🎽' },
  { key: 'soccer', label: 'Soccer', icon: '⚽' },
];
const SPORT_LABELS = SPORTS.reduce((m, s) => { m[s.key] = s.label; return m; }, {});
let DESIGN_PRESETS = SETTINGS_DEFAULTS.presets;
const thumbCache = {}; // module-level: gallery thumbs render once per session
const savedThumbsCache = {}; // module-level: My Designs thumbs render once per session

// ── logo upload hardening ────────────────────────────────────────────────────
// Coaches upload phone photos and JPGs with solid backgrounds. Every upload is
// downscaled (huge data URLs slow the 3D decal and can blow the autosave
// quota), and a near-uniform background is knocked out via a border flood fill
// so a JPG crest doesn't show as a colored rectangle on the jersey. Flood fill
// (not global color distance) so whites INSIDE the logo survive.
const MAX_LOGO_PX = 900;
function knockoutBackground(canvas) {
  const w = canvas.width, h = canvas.height;
  const x = canvas.getContext('2d');
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  // Already has real transparency → nothing to do.
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4 * 97) { if (d[i] < 250) transparent++; if (transparent > 3) return null; }
  // All four corners must agree on one background color.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const avg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + d[i + c], 0) / 4);
  const TOL2 = 46 * 46;
  const near = (i) => { const dr = d[i] - avg[0], dg = d[i + 1] - avg[1], db = d[i + 2] - avg[2]; return dr * dr + dg * dg + db * db < TOL2; };
  if (!corners.every(near)) return null;
  // BFS from every matching border pixel.
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0, removed = 0;
  const push = (p) => { if (!seen[p] && near(p * 4)) { seen[p] = 1; q[qt++] = p; } };
  for (let px = 0; px < w; px++) { push(px); push((h - 1) * w + px); }
  for (let py = 0; py < h; py++) { push(py * w); push(py * w + w - 1); }
  while (qh < qt) {
    const p = q[qh++];
    d[p * 4 + 3] = 0; removed++;
    const px = p % w, py = (p / w) | 0;
    if (px > 0) push(p - 1);
    if (px < w - 1) push(p + 1);
    if (py > 0) push(p - w);
    if (py < h - 1) push(p + w);
  }
  if (removed < (w * h) * 0.02) return null; // border noise, not a real background
  x.putImageData(id, 0, 0);
  return canvas.toDataURL('image/png');
}

// Produce tightly cropped variants once, at intake. A PNG's transparent canvas
// must never count toward finished height; otherwise a nominal 4-inch logo can
// print visibly smaller than a 4-inch number beside it.
function prepareLogoImage(img) {
  const fullCanvas = canvasFromImage(img, MAX_LOGO_PX);
  const full = fullCanvas.toDataURL('image/png');
  const cutCanvas = cloneCanvas(fullCanvas);
  let cut = null, croppedCut = null;
  try {
    if (knockoutBackground(cutCanvas)) {
      croppedCut = trimTransparentCanvas(cutCanvas);
      cut = croppedCut.toDataURL('image/png');
    }
  } catch (_e) { /* non-uniform or protected source; retain original */ }
  const selected = croppedCut || fullCanvas;
  return {
    src: cut || full, srcFull: full, srcCut: cut, bgRemoved: !!cut,
    aspect: selected.width / selected.height,
    pixelWidth: selected.width, pixelHeight: selected.height,
    fullAspect: fullCanvas.width / fullCanvas.height,
    fullPixelWidth: fullCanvas.width, fullPixelHeight: fullCanvas.height,
    cutAspect: croppedCut ? croppedCut.width / croppedCut.height : null,
    cutPixelWidth: croppedCut ? croppedCut.width : null,
    cutPixelHeight: croppedCut ? croppedCut.height : null,
  };
}

// ── programs (cuts) ──────────────────────────────────────────────────────────
// Men's / Women's / Youth are genuinely different silhouettes, each with its
// own base 3D model. Until the women's + youth cut models arrive from the
// artists, every program routes to the current men's bases — swapping in the
// real cuts later is a one-line change per entry here.
const PROGRAMS = ['mens', 'womens', 'youth'];
const PROGRAM_LABELS = { mens: "Men's", womens: "Women's", youth: 'Youth' };
const PROGRAM_GARMENTS = {
  mens: { vneck: 'sahrul_jersey', crew: 'octa_jersey' },
  womens: { vneck: 'sahrul_jersey', crew: 'octa_jersey' }, // TODO: women's cut models
  youth: { vneck: 'sahrul_jersey', crew: 'octa_jersey' },  // TODO: youth cut models
};
function garmentFor(cfg) {
  // The design's production garment stays independent from artist-cut previews
  // so a cut comparison never changes the approved 2D proof or design zones.
  if (cfg.neckStyle === 'agi1011') return 'agi1011_jersey';
  if (cfg.neckStyle === 'agi1012') return 'agi1012_jersey';
  if (cfg.neckStyle === 'newbase') return 'nsapro_jersey'; // Sahrul (v1)
  if (cfg.neckStyle === 'sahrul2') return 'sahrul2_jersey'; // Sahrul (v2, production spec)
  if (cfg.neckStyle === 'vikram') return 'vikram_jersey';  // Vikram
  const byNeck = PROGRAM_GARMENTS[cfg.program] || PROGRAM_GARMENTS.mens;
  return byNeck[cfg.neckStyle === 'crew' ? 'crew' : 'vneck'];
}

export function modelGarmentFor(cfg) {
  // Approved catalog designs must use one physical cut all the way from the
  // live viewer through proofing and production. Artist comparisons were
  // useful during model selection, but leaving them selectable on a real
  // design made the customer's view diverge from the production asset.
  if (cfg.neckStyle === 'agi1011' || cfg.neckStyle === 'agi1012') return garmentFor(cfg);
  if (cfg.artistCut === 'sahrul') return 'sahrul2_jersey';
  if (cfg.artistCut === 'vikram') return 'vikram_jersey';
  return garmentFor(cfg);
}

const SIZES = ['YS', 'YM', 'YL', 'WS', 'WM', 'WL', 'WXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'];
const SIZE_LABELS = { YS: 'Youth S', YM: 'Youth M', YL: 'Youth L', WS: "Women's S", WM: "Women's M", WL: "Women's L", WXL: "Women's XL", AS: 'Adult S', AM: 'Adult M', AL: 'Adult L', AXL: 'Adult XL', A2XL: 'Adult 2XL' };
const STEPS = [
  { key: 'team', label: 'Team' }, { key: 'jersey', label: 'Jersey' }, { key: 'numbers', label: 'Embellish' },
  { key: 'roster', label: 'Roster' }, { key: 'finalize', label: 'Finalize' },
];

const DEFAULT_CONFIG = {
  sport: null,
  teamName: 'ARGENTINA',
  sections: defaultSections(),
  sleevesLinked: true,
  fabric: 'sublimated',
  decorationMethod: 'sublimated',
  bottom: defaultBottom(),
  logos: emptyLogos(),
  // The garment starts CLEAN — no number, no name, no logos. The coach adds
  // every decoration themselves (Embellish step), like a real kit order.
  playerName: '', playerNumber: '', includePlayerName: false,
  numberColor: '#192853', font: 'block',
  outlineColor: 'auto', outlineWeight: 'thin', numberSize: 1, nameSize: 1,
  // Production lettering is specified by finished height in inches. Back
  // number remains null until resolved from program (8" men, 6" women/youth).
  frontNumberInches: 4, backNumberInches: null, nameInches: 2,
  frontNumberX: null, frontNumberY: null,
  backNumberX: null, backNumberY: null,
  backNameX: null, backNameY: null,
  nameArch: 'arched', nameSpacing: 8,
  neckStyle: 'vneck', artistCut: 'foundation', frontNumber: 'right',
  program: 'mens', outline2Color: 'none',
};

function agi1012PreviewConfig() {
  return {
    ...DEFAULT_CONFIG,
    sport: 'soccer', designId: 'AGI-1012', neckStyle: 'agi1012',
    teamName: 'AGI-1012', playerNumber: '15', frontNumber: 'none',
    // White lettering must remain legible when a coach places it over the
    // jersey's white chest stripe; Auto resolves to the dark contrast ink.
    numberColor: '#FFFFFF', outlineColor: 'auto', bottom: { ...defaultBottom(), enabled: false },
    teamPalette: ['#6A1F28', '#FFFFFF'],
    sections: {
      body: { color: '#6A1F28', color2: '#FFFFFF', pattern: 'solid' },
      sleeveL: { color: '#6A1F28', color2: '#FFFFFF', pattern: 'solid' },
      sleeveR: { color: '#6A1F28', color2: '#FFFFFF', pattern: 'solid' },
      collar: { color: '#FFFFFF', color2: '#6A1F28', pattern: 'solid' },
    },
  };
}

function agi1011PreviewConfig() {
  return {
    ...DEFAULT_CONFIG,
    sport: 'soccer', designId: 'AGI-1011', neckStyle: 'agi1011',
    teamName: 'AGI-1011', playerNumber: '13', frontNumber: 'right',
    numberColor: '#0B0B0B', outlineColor: 'none', frontNumberX: 0.61, frontNumberY: 0.27,
    bottom: { ...defaultBottom(), enabled: false },
    teamPalette: ['#3AA0D4', '#0B0B0B', '#FFFFFF'],
    sections: {
      body: { color: '#3AA0D4', color2: '#0B0B0B', pattern: 'solid' },
      sleeveL: { color: '#3AA0D4', color2: '#0B0B0B', pattern: 'solid' },
      sleeveR: { color: '#3AA0D4', color2: '#0B0B0B', pattern: 'solid' },
      collar: { color: '#0B0B0B', color2: '#3AA0D4', pattern: 'solid' },
    },
  };
}

// ── persistence ──────────────────────────────────────────────────────────────
// Autosave honors the top bar's "Changes save automatically": the in-progress
// design + roster survive a refresh or accidental close. Saved designs and
// order requests share the old builder's localStorage + best-effort Supabase
// pattern (silent no-op if the table/RLS isn't provisioned).
const AUTOSAVE_KEY = 'nsa_uniform_pro_autosave';
const SAVED_DESIGNS_KEY = 'nsa_uniform_saved';
function loadSavedDesigns() {
  try { return JSON.parse(localStorage.getItem(SAVED_DESIGNS_KEY) || '[]'); } catch { return []; }
}
function loadAutosave() {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch { return null; }
}
function restoredConfig() {
  if (REVIEW_DESIGN === 'AGI-1011') return agi1011PreviewConfig();
  if (REVIEW_DESIGN === 'AGI-1012') return agi1012PreviewConfig();
  const a = loadAutosave();
  if (!a || !a.config) return { ...DEFAULT_CONFIG };
  // Merge over defaults so configs saved before new fields/slots existed stay
  // valid; flat-color autosaves migrate to per-section design.
  const base = defaultSections();
  const saved = a.config.sections ? expandSections(a.config.sections) : sectionsFromLegacy(a.config);
  const sections = {};
  for (const s of SECTIONS) sections[s.key] = { ...base[s.key], ...(saved[s.key] || {}) };
  const savedBottom = a.config.bottom || defaultBottom();
  const bottom = { ...defaultBottom(), ...savedBottom, sections: { ...defaultBottomSections(), ...(savedBottom.sections || {}) } };
  const includePlayerName = typeof a.config.includePlayerName === 'boolean'
    ? a.config.includePlayerName
    : !!String(a.config.playerName || '').trim();
  return { ...DEFAULT_CONFIG, ...a.config, includePlayerName, sections, bottom, logos: { ...emptyLogos(), ...(a.config.logos || {}) } };
}
async function trySupabaseSave(rec) {
  try {
    // uniform_designs is staff-only under RLS; the public builder saves through
    // the service-role data function (size-capped server-side). Best-effort.
    await fetch('/.netlify/functions/uniform-builder-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_design', name: rec.name, spec: rec.spec, thumb: rec.thumb || null }),
    });
  } catch (_e) { /* best-effort */ }
}

// ── wizard config → design spec ──────────────────────────────────────────────
// The three brand colors map onto the octa jersey's real zones; the number/name/
// font drive the shared text model that both the 3D decals and 2D proof read.
function specFromConfig(cfg) {
  const fontDef = FONTS.find((f) => f.id === cfg.font) || FONTS[0];
  const font = fontDef.font;
  const numColor = cfg.numberColor;
  // Outline: 'auto' picks a contrasting ink, 'none' drops the stroke, a hex is
  // used as-is. Hollow fonts need their stroke to BE the number color.
  const oc = cfg.outlineColor || 'auto';
  const outline = fontDef.hollow ? numColor : (oc === 'auto' ? ds.contrastInk(numColor) : oc);
  const fill = fontDef.hollow ? '#ffffff' : numColor;
  // A thin sewn/sublimated keyline is the production default. Back numbers use
  // the same physical border as the front instead of silently getting heavier.
  const selectedOutlineWidth = OUTLINE_WIDTHS[cfg.outlineWeight] || OUTLINE_WIDTHS.thin;
  const outlineWidth = fontDef.hollow ? 7 : (oc === 'none' ? 0 : selectedOutlineWidth);
  // Second outline rings the first — only meaningful when there IS a first.
  const oc2 = cfg.outline2Color || 'none';
  const outline2 = (outlineWidth && oc2 !== 'none') ? oc2 : 'none';
  const frontNumberInches = Number.isFinite(cfg.frontNumberInches) ? cfg.frontNumberInches : 4;
  const backNumberInches = Number.isFinite(cfg.backNumberInches) ? cfg.backNumberInches : (cfg.program === 'mens' ? 8 : 6);
  const nameInches = Number.isFinite(cfg.nameInches) ? cfg.nameInches : 2;
  const num = (cfg.playerNumber || '').toString();
  const logos = logoSpecFromConfig(cfg.logos || {});
  const S = normSections(cfg.sections);
  const frontX = cfg.frontNumber === 'center'
    ? 0.5
    : (Number.isFinite(cfg.frontNumberX) ? cfg.frontNumberX : (cfg.frontNumber === 'left' ? 0.67 : 0.33));
  const frontPos = safeDecorationPosition('frontNumber', frontX, Number.isFinite(cfg.frontNumberY) ? cfg.frontNumberY : 0.265);
  const backNumberPos = safeDecorationPosition('backNumber', Number.isFinite(cfg.backNumberX) ? cfg.backNumberX : 0.5, Number.isFinite(cfg.backNumberY) ? cfg.backNumberY : 0.46);
  const backNamePos = safeDecorationPosition('backName', Number.isFinite(cfg.backNameX) ? cfg.backNameX : 0.5, Number.isFinite(cfg.backNameY) ? cfg.backNameY : 0.2);
  // Only carry the print-pattern image when the section is actually set to it,
  // so switching back to a built-in pattern fully clears the image fill.
  const zoneOf = (z) => ({
    color: z.color, color2: z.color2, pattern: z.pattern || 'solid',
    color3: z.color3, color4: z.color4,
    ...(z.pattern === 'custom' && z.patternImage ? { patternImage: z.patternImage, patternName: z.patternName, patternTint: !!z.patternTint, patternTintMode: z.patternTintMode } : {}),
  });
  return ds.normalizeSpec({
    garmentId: garmentFor(cfg), fabric: cfg.fabric || 'sublimated',
    zones: {
      body: zoneOf(S.body),
      sleeveL: zoneOf(S.sleeveL),
      sleeveR: zoneOf(S.sleeveR),
      collar: zoneOf(S.collar),
    },
    text: {
      front: {
        // Placement: right chest is the template anchor; left/center override
        // the anchor per design; 'none' drops the front number entirely.
        number: (cfg.frontNumber === 'none')
          ? { value: '' }
          : { value: num, font, fill, outline, outlineWidth, outline2, outline2Width: 1.5, inches: frontNumberInches,
              x: frontPos.x, y: frontPos.y },
        name: { value: '', font: 'saira' },
      },
      back: {
        number: { value: num, font, fill, outline, outlineWidth, outline2, outline2Width: 1.5, inches: backNumberInches,
          x: backNumberPos.x, y: backNumberPos.y },
        // The name follows the chosen lettering style (it used to be pinned to
        // one condensed font) and arches over the number by default.
        name: { value: cfg.includePlayerName ? (cfg.playerName || '').toUpperCase() : '', font, fill, outline, outlineWidth: outlineWidth ? Math.max(1, outlineWidth * 0.7) : 0, inches: nameInches,
          x: backNamePos.x, y: backNamePos.y,
          arch: cfg.nameArch === 'straight' ? 0 : 0.35, letterSpacing: Number.isFinite(cfg.nameSpacing) ? cfg.nameSpacing : 8 },
      },
    },
    logos,
    meta: { teamName: cfg.teamName, program: cfg.program || 'mens', designId: cfg.designId || '' },
  });
}

// ── small style helpers ──────────────────────────────────────────────────────
const railLabel = { fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, color: C.textLight, marginBottom: 12 };
const groupHead = { fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.6, color: C.navy };
const groupVal = { fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: C.red };

// The rail is broken into numbered cards (1 · COLORS, 2 · CUT & STYLE …) so
// each decision reads as its own little panel instead of one long scroll.
function RailCard({ num, title, value, action, children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 8, padding: '15px 16px 17px', marginBottom: 12, boxShadow: '0 1px 4px rgba(15,23,42,.05)', ...style }}>
      {title != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 13 }}>
          <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.6, color: C.navy }}>
            {num != null && <span style={{ color: C.red }}>{num} · </span>}{title}
          </div>
          {action || (value != null && <div style={groupVal}>{value}</div>)}
        </div>
      )}
      {children}
    </div>
  );
}

// Slanted chip — the NSA "speed slant" carried into every selectable swatch.
function Swatch({ hex, active, onClick, size = 42 }) {
  return (
    <button onClick={onClick} title={nameForHex(hex)} style={{
      width: size, height: Math.round(size * 0.86), borderRadius: 3, background: hex, cursor: 'pointer', padding: 0, boxSizing: 'border-box',
      transform: 'skewX(-12deg)',
      border: active ? '2.5px solid ' + C.navy : '1px solid ' + C.mid,
      boxShadow: active ? '0 2px 8px rgba(25,40,83,0.3)' : '0 1px 2px rgba(15,23,42,0.08)',
    }} />
  );
}
// Compact color picker for the steps AFTER Team: leads with the coach's own
// team colors (plus white/black staples) so choices stay consistent, with the
// full palette one tap away. The Team step stays the place where the "main"
// colors get declared from the full range.
function QuickColors({ teamColors, hex, onPick, size = 30 }) {
  const [more, setMore] = useState(false);
  const shown = more ? PALETTE : teamColors;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 4 }}>
        {shown.map((p) => <Swatch key={p.hex} hex={p.hex} size={size} active={String(hex).toUpperCase() === p.hex.toUpperCase()} onClick={() => onPick(p.hex)} />)}
        <button onClick={() => setMore((m) => !m)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textLight, background: 'none', border: '1px dashed ' + C.mid, borderRadius: 3, padding: '6px 9px', cursor: 'pointer', transform: 'skewX(-12deg)' }}>
          {more ? 'Team colors' : 'More…'}
        </button>
      </div>
    </div>
  );
}

// The Team step's single color picker: the coach curates the set of colors that
// then show up as quick-picks everywhere else. Each chip is removable; the "+"
// opens the full range to add more. (Replaces the old Primary/Accent1/Accent2
// role pickers — roles are assigned per-zone on the Jersey step instead.)
function TeamPaletteEditor({ colors, onAdd, onRemove, onReplace }) {
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState(null);
  const have = new Set(colors.map((c) => c.hex.toUpperCase()));
  const chip = (hex, size = 46) => ({
    width: size, height: Math.round(size * 0.86), borderRadius: 3, background: hex, cursor: 'pointer',
    padding: 0, boxSizing: 'border-box', transform: 'skewX(-12deg)',
    border: '1px solid ' + C.mid, boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
  });
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 4 }}>
        {colors.map((c) => (
          <div key={c.hex} style={{ position: 'relative' }}>
            <button title={`Replace ${c.name}`} style={{ ...chip(c.hex), border: replacing === c.hex ? '3px solid ' + C.navy : '1px solid ' + C.mid, boxShadow: replacing === c.hex ? '0 0 0 3px rgba(25,40,83,.12)' : '0 1px 2px rgba(15,23,42,0.08)' }}
              onClick={() => { setReplacing((r) => r === c.hex ? null : c.hex); setAdding(true); }} />
            {colors.length > 1 && (
              <span onClick={() => { onRemove(c.hex); if (replacing === c.hex) setReplacing(null); }} title={'Remove ' + c.name}
                style={{ position: 'absolute', top: -7, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#fff', border: '1px solid ' + C.mid, color: C.textLight, fontFamily: F_BODY, fontSize: 12, lineHeight: '13px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(15,23,42,.22)' }}>×</span>
            )}
          </div>
        ))}
        <button onClick={() => { setReplacing(null); setAdding((a) => !a); }} title="Add a color" style={{
          width: 46, height: 40, borderRadius: 3, transform: 'skewX(-12deg)', cursor: 'pointer',
          background: adding ? C.navy : '#fff', color: adding ? '#fff' : C.navy,
          border: '1px dashed ' + (adding ? C.navy : C.mid), fontFamily: F_DISP, fontWeight: 800, fontSize: 20, lineHeight: '38px', padding: 0,
        }}>+</button>
      </div>
      {adding && (
        <div style={{ marginTop: 14, padding: '12px 12px 14px', background: C.offWhite, borderRadius: 6, border: '1px solid ' + C.light }}>
          <div style={{ ...railLabel, marginBottom: 10 }}>{replacing ? `Replace ${nameForHex(replacing)} everywhere` : 'Tap to add or remove'}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 4 }}>
            {PALETTE.map((p) => {
              const on = have.has(p.hex.toUpperCase());
              return (
                <button key={p.hex} title={p.name} onClick={() => {
                  if (replacing) { onReplace(replacing, p.hex); setReplacing(null); setAdding(false); }
                  else (on ? onRemove(p.hex) : onAdd(p.hex));
                }} style={{
                  ...chip(p.hex, 38),
                  border: on ? '2.5px solid ' + C.navy : '1px solid ' + C.mid,
                  boxShadow: on ? '0 2px 8px rgba(25,40,83,0.3)' : '0 1px 2px rgba(15,23,42,0.08)',
                }} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
function Pills({ options, active, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', paddingLeft: 4 }}>
      {options.map((o) => {
        const on = o.id === active;
        return <button key={o.id} onClick={() => onPick(o.id)} style={{
          fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, padding: '7px 14px',
          borderRadius: 2, transform: 'skewX(-12deg)',
          background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy, border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer',
          boxShadow: on ? '0 2px 6px rgba(25,40,83,0.25)' : 'none',
        }}>{o.label}</button>;
      })}
    </div>
  );
}
// Per-section pattern + color editor — used for both the jersey's sections
// (Body/Sleeves/Collar) and the shorts' sections (Legs/Waistband/Stripe).
// Every construction area is expanded in one scrollable form. Coaches can see
// Body, Sleeves, Cuffs, Collar, etc. with their colors immediately instead of
// selecting a section tab before the color controls appear.
function SectionEditor({ sectionDefs, sections, activeKey, onSelect, onPatch, printLib, teamColors, layoutLocked = false, layoutLabel = 'Approved layout' }) {
  const sectionValue = (def) => {
    const src = sections[def.sourceKey || def.key] || sections.body || defaultSections().body;
    return def.colorField ? { ...src, color: src[def.colorField], pattern: 'solid' } : src;
  };
  const patchSection = (def, patch) => {
    const sourceKey = def.sourceKey || def.key;
    if (onSelect && def.key !== activeKey) onSelect(def.key);
    if (!def.colorField) { onPatch(patch, sourceKey); return; }
    const translated = { ...patch };
    if (Object.prototype.hasOwnProperty.call(translated, 'color')) {
      translated[def.colorField] = translated.color;
      delete translated.color;
    }
    onPatch(translated, sourceKey);
  };
  return (
    <div>
      {layoutLocked && (
        <div style={{ marginBottom: 2, padding: '7px 9px', borderRadius: 5, background: C.light, color: C.navy, fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          {layoutLabel}
        </div>
      )}
      {sectionDefs.map((def, index) => {
        const value = sectionValue(def);
        const patternName = value.pattern === 'custom'
          ? (value.patternName || 'Print')
          : ((PATTERNS.find((p) => p.id === value.pattern) || {}).label || 'Solid');
        return (
          <div key={def.key} style={{ padding: layoutLocked ? (index === 0 ? '10px 0 12px' : '12px 0') : (index === 0 ? '18px 0 20px' : '20px 0'), borderTop: index === 0 ? 'none' : '1px solid ' + C.light }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: layoutLocked ? 7 : 12 }}>
              <div style={layoutLocked ? { ...groupHead, fontSize: 13 } : groupHead}>{def.label}</div>
              <div style={groupVal}>{nameForHex(value.color)}{layoutLocked ? '' : ` · ${patternName}`}</div>
            </div>
            {!layoutLocked && (
              <>
                <div style={{ ...railLabel, marginBottom: 8 }}>Pattern</div>
                <div style={{ marginBottom: 14 }}>
                  <Pills options={PATTERNS} active={value.pattern} onPick={(p) => patchSection(def, { pattern: p })} />
                </div>
              </>
            )}
            {!layoutLocked && printLib.length > 0 && (
              <>
                <div style={{ ...railLabel, marginBottom: 8 }}>Print Patterns</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {printLib.map((p) => {
                    const on = value.pattern === 'custom' && value.patternImage === p.image;
                    return (
                      <button key={p.id} title={p.name + (p.tintable ? ' (recolors with your team colors)' : '')} onClick={() => patchSection(def, { pattern: 'custom', patternImage: p.image, patternName: p.name, patternTint: !!p.tintable, patternTintMode: (p.tint_mode === 'blend' || p.tint_mode === 'mono') ? p.tint_mode : 'solid' })}
                        style={{ width: 46, height: 40, borderRadius: 3, cursor: 'pointer', padding: 0, boxSizing: 'border-box', transform: 'skewX(-12deg)',
                          border: on ? '2.5px solid ' + C.navy : '1px solid ' + C.mid,
                          boxShadow: on ? '0 2px 8px rgba(25,40,83,0.3)' : '0 1px 2px rgba(15,23,42,0.08)',
                          backgroundImage: `url(${p.image})`, backgroundSize: '22px 22px', backgroundRepeat: 'repeat' }} />
                    );
                  })}
                </div>
              </>
            )}
            {!layoutLocked && <div style={{ ...railLabel, marginBottom: 8 }}>Color</div>}
            <div style={{ marginBottom: layoutLocked ? 0 : (value.pattern !== 'solid' ? 14 : 0) }}>
              <QuickColors teamColors={teamColors} hex={value.color} onPick={(h) => patchSection(def, { color: h })} />
            </div>
            {!layoutLocked && value.pattern !== 'solid' && value.pattern !== 'custom' && (
              <>
                <div style={{ ...railLabel, marginBottom: 8 }}>Secondary Color</div>
                <QuickColors teamColors={teamColors} hex={value.color2} onPick={(h) => patchSection(def, { color2: h })} />
              </>
            )}
            {value.pattern === 'custom' && value.patternTint && value.patternTintMode === 'mono' && (
              <div style={{ marginTop: 12, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Monochrome print — shades derive automatically from the section color above.</div>
            )}
            {value.pattern === 'custom' && value.patternTint && value.patternTintMode !== 'mono' && (
              <>
                <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Secondary</div>
                <QuickColors teamColors={teamColors} hex={value.color2} onPick={(h) => patchSection(def, { color2: h })} />
                {value.patternTintMode !== 'blend' && (
                  <>
                    <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Accent 1</div>
                    <QuickColors teamColors={teamColors} hex={value.color3 || '#FFFFFF'} onPick={(h) => patchSection(def, { color3: h })} />
                    <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Accent 2</div>
                    <QuickColors teamColors={teamColors} hex={value.color4 || '#FFFFFF'} onPick={(h) => patchSection(def, { color4: h })} />
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LabeledInput({ label, value, onChange, maxLength }) {
  return (
    <label style={{ display: 'block' }}>
      {label ? <span style={{ display: 'block', fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: C.textLight, marginBottom: 7 }}>{label}</span> : null}
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} style={{
        width: '100%', boxSizing: 'border-box', border: '1.5px solid ' + C.mid, borderRadius: 6, padding: '11px 12px',
        fontFamily: F_BODY, fontSize: 15, color: C.text,
      }} />
    </label>
  );
}

const ORDER_STATUS_LABELS = {
  submitted: 'Order received', rep_review: 'Rep review', proof_ready: 'Proof ready',
  changes_requested: 'Changes requested', approved: 'Proof approved', production: 'In production',
  quality_check: 'Quality check', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

function initialOrderLink() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const orderNumber = query.get('order');
  const token = query.get('token');
  return orderNumber && token ? { orderNumber, token } : null;
}

function OrderStatusPage({ data, loading, error, narrow, onRefresh, onDecision, onReorder, onBack }) {
  const [note, setNote] = useState('');
  const order = data && data.order;
  const proofs = (data && data.proofs) || [];
  const events = (data && data.events) || [];
  const latestProof = proofs[0];
  if (loading && !order) return <div style={loadStyle}>Loading your order…</div>;
  if (!order) return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.offWhite }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '70px 22px', textAlign: 'center' }}>
        <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 28, textTransform: 'uppercase', color: C.navy }}>Order not found</div>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, marginTop: 8 }}>{error || 'Use the private link in your confirmation email, or contact your rep.'}</div>
        <button onClick={onBack} style={{ ...prodBtn, marginTop: 22, paddingLeft: 24, paddingRight: 24 }}>Return to Builder</button>
      </div>
    </div>
  );
  const canDecide = order.production_status === 'proof_ready' && latestProof && !order.locked_at;
  const canReorder = !!order.locked_at || order.production_status === 'delivered';
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.offWhite }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: narrow ? '24px 16px 60px' : '38px 28px 70px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 14, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: C.textLight }}>← Uniform Builder</button>
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0,1.45fr) minmax(300px,.85fr)', gap: 18, alignItems: 'start' }}>
          <div>
            <div style={{ borderRadius: 12, padding: narrow ? '24px 20px' : '28px 30px', color: '#fff', background: `linear-gradient(135deg, ${C.navy}, #283d72)` }}>
              <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', opacity: .76 }}>Custom Uniform Order</div>
              <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 28 : 36, lineHeight: 1, textTransform: 'uppercase', marginTop: 6 }}>{ORDER_STATUS_LABELS[order.production_status] || order.production_status}</div>
              <div style={{ fontFamily: F_BODY, fontSize: 14, opacity: .86, marginTop: 9 }}>{order.order_number} · {order.team_name}</div>
            </div>
            {error && <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, color: '#991b1b', fontFamily: F_BODY, fontSize: 13 }}>{error}</div>}

            <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 10, padding: '20px 22px', marginTop: 16 }}>
              <div style={sectionHead}>Order Progress</div>
              {events.length ? events.map((event, i) => (
                <div key={`${event.created_at}-${i}`} style={{ position: 'relative', display: 'flex', gap: 13, padding: '12px 0' }}>
                  {i < events.length - 1 && <span style={{ position: 'absolute', width: 2, left: 7, top: 27, bottom: -6, background: C.light }} />}
                  <span style={{ flex: '0 0 16px', width: 16, height: 16, borderRadius: '50%', background: i === events.length - 1 ? C.red : C.navy, marginTop: 2, zIndex: 1, boxShadow: '0 0 0 4px #fff' }} />
                  <span>
                    <strong style={{ display: 'block', fontFamily: F_BODY, fontSize: 13.5, color: C.text }}>{event.message || String(event.event_type || '').replace(/_/g, ' ')}</strong>
                    <span style={{ display: 'block', fontFamily: F_BODY, fontSize: 11.5, color: C.textLight, marginTop: 2 }}>{new Date(event.created_at).toLocaleString()}</span>
                  </span>
                </div>
              )) : <div style={{ padding: '16px 0', fontFamily: F_BODY, fontSize: 13, color: C.textLight }}>Your order was received. Updates will appear here.</div>}
            </div>

            {latestProof && (
              <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 10, padding: '20px 22px', marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <div style={{ ...sectionHead, flex: 1, marginBottom: 0 }}>Production Proof · Version {latestProof.version}</div>
                  {latestProof.customer_decision && <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', color: latestProof.customer_decision === 'approved' ? C.green : C.red }}>{latestProof.customer_decision.replace('_', ' ')}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: latestProof.back_image ? '1fr 1fr' : '1fr', gap: 10 }}>
                  {latestProof.front_image && <img src={latestProof.front_image} alt="Front proof" style={{ width: '100%', borderRadius: 7, border: '1px solid ' + C.light, background: '#fff' }} />}
                  {latestProof.back_image && <img src={latestProof.back_image} alt="Back proof" style={{ width: '100%', borderRadius: 7, border: '1px solid ' + C.light, background: '#fff' }} />}
                </div>
                {latestProof.note && <div style={{ marginTop: 12, padding: '11px 12px', background: C.offWhite, borderRadius: 6, fontFamily: F_BODY, fontSize: 13, lineHeight: 1.45, color: C.text }}>{latestProof.note}</div>}
                {canDecide && (
                  <div style={{ marginTop: 16, borderTop: '1px solid ' + C.light, paddingTop: 15 }}>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional approval note, or describe exactly what should change" maxLength={2000} style={{ width: '100%', minHeight: 86, boxSizing: 'border-box', resize: 'vertical', border: '1.5px solid ' + C.mid, borderRadius: 6, padding: 11, fontFamily: F_BODY, fontSize: 13.5 }} />
                    <div style={{ display: 'flex', gap: 9, marginTop: 9, flexWrap: 'wrap' }}>
                      <button disabled={loading} onClick={() => onDecision('approved', note)} style={{ ...prodBtn, minWidth: 180, opacity: loading ? .55 : 1 }}>Approve Version {latestProof.version}</button>
                      <button disabled={loading || !note.trim()} onClick={() => onDecision('changes_requested', note)} style={{ ...ghostBtn, minWidth: 180, color: C.red, opacity: (loading || !note.trim()) ? .5 : 1 }}>Request Changes</button>
                    </div>
                    <div style={{ marginTop: 8, fontFamily: F_BODY, fontSize: 11.5, lineHeight: 1.45, color: C.textLight }}>Approval applies only to this proof version. A revised proof always requires a new approval.</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 10, padding: '18px 20px' }}>
              <div style={sectionHead}>Order Details</div>
              {[
                ['Production', ORDER_STATUS_LABELS[order.production_status] || order.production_status],
                ['Payment', String(order.payment_status || '').replace(/_/g, ' ')],
                ['Quantity', `${order.total_qty} jersey${order.total_qty === 1 ? '' : 's'}`],
                ['Total', formatUniformMoney(order.total)],
                ['Submitted', new Date(order.created_at).toLocaleDateString()],
              ].map(([label, value]) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid ' + C.light, fontFamily: F_BODY, fontSize: 13 }}><span style={{ color: C.textLight }}>{label}</span><strong style={{ color: C.text, textTransform: label === 'Payment' ? 'capitalize' : 'none', textAlign: 'right' }}>{value}</strong></div>)}
              {order.tracking_number && <a href={order.tracking_url || `https://www.google.com/search?q=${encodeURIComponent(order.tracking_number)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 14, padding: '11px 12px', borderRadius: 6, textAlign: 'center', fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', color: '#fff', background: C.red, textDecoration: 'none' }}>Track Shipment</a>}
            </div>
            <button onClick={onRefresh} disabled={loading} style={{ ...ghostBtn, background: '#fff', opacity: loading ? .6 : 1 }}>{loading ? 'Refreshing…' : 'Refresh Status'}</button>
            {canReorder && <button onClick={onReorder} disabled={loading} style={{ ...prodBtn, opacity: loading ? .6 : 1 }}>Reorder This Uniform</button>}
            <div style={{ padding: '14px 16px', borderRadius: 8, background: '#fff', border: '1px solid ' + C.light, fontFamily: F_BODY, fontSize: 12.5, lineHeight: 1.55, color: C.textLight }}>Need help? Reply to any order email and your rep will see the order number and current proof version.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Below ~900px the side-by-side stage + rail doesn't fit — the wizard stacks
// the 3D stage on top with the controls scrolling underneath.
function useNarrow(bp = 900) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < bp);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bp]);
  return narrow;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProBuilder({ onExit, onCreateOrder, existingArtwork = [], coachDiscountPercent = 0, pricingPolicy = {} }) {
  const [config, setConfig] = useState(restoredConfig);
  const [orderLink] = useState(initialOrderLink);
  // Catalog flow: pick a sport → pick a starting design → the wizard.
  const [screen, setScreen] = useState(orderLink ? 'status' : (AGI_PREVIEW ? 'wizard' : 'sports')); // sports | designs | wizard | status
  // Admin-managed palette/styles/presets: hydrate once per session, then bump
  // to re-render everything reading the module-level registries.
  const [settingsRev, setSettingsRev] = useState(0);
  // Admin-configured pricing (uniform_settings/pricing_policy) served by the
  // builder-data function. Overrides the prop so the public preview always
  // matches what the server will quote at checkout.
  const [serverPricingPolicy, setServerPricingPolicy] = useState(null);
  const effectivePricingPolicy = serverPricingPolicy || pricingPolicy;
  useEffect(() => {
    let alive = true;
    loadBuilderSettings().then((sx) => {
      if (!alive) return;
      PALETTE = sx.palette; FONTS = sx.numberStyles; DESIGN_PRESETS = sx.presets;
      if (sx.pricingPolicy) setServerPricingPolicy(sx.pricingPolicy);
      setSettingsRev((r) => r + 1);
    });
    return () => { alive = false; };
  }, []);
  const [hasAutosave] = useState(() => !!loadAutosave());
  const [hasSavedDesigns] = useState(() => loadSavedDesigns().length > 0);
  const [thumbs, setThumbs] = useState(() => ({ ...thumbCache }));
  const [step, setStep] = useState(AGI_PREVIEW ? 'jersey' : 'team');
  const [spin, setSpin] = useState(false);
  const [stagePiece, setStagePiece] = useState('jersey');
  const [fabricGuide, setFabricGuide] = useState(false);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const [logoPlacementOpen, setLogoPlacementOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false); // "Change Design" dropdown
  const [changeThumbs, setChangeThumbs] = useState({});
  const narrow = useNarrow();
  const savedArtwork = useMemo(() => normalizeExistingArtwork(existingArtwork), [existingArtwork]);

  // Roster / sizes
  const [selectedSize, setSelectedSize] = useState('AM');
  const [assignments, setAssignments] = useState(() => {
    const a = loadAutosave();
    return (a && a.assignments && typeof a.assignments === 'object') ? a.assignments : { AM: ['10'] };
  });
  // Player name per jersey number (a number belongs to one jersey, so a flat
  // map is enough regardless of which size it's assigned to).
  const [playerNames, setPlayerNames] = useState(() => {
    const a = loadAutosave();
    return (a && a.playerNames && typeof a.playerNames === 'object') ? a.playerNames : {};
  });
  const [rosterPreview, setRosterPreview] = useState(null);
  const [rosterPreviewImage, setRosterPreviewImage] = useState(null);

  // Finalize state
  const [review, setReview] = useState({ front: null, back: null });
  const [savedMsg, setSavedMsg] = useState(false);

  // Order fulfillment — three ways to complete an order, one shared record.
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [poOpen, setPoOpen] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [poContact, setPoContact] = useState('');
  const [showStripeModal, setShowStripeModal] = useState(false);
  const cardOrderRef = useRef(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderDone, setOrderDone] = useState(null); // authoritative API response
  const [orderStatus, setOrderStatus] = useState(null);
  const [orderStatusBusy, setOrderStatusBusy] = useState(!!orderLink);
  const [orderStatusError, setOrderStatusError] = useState('');
  const orderClientRef = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `uniform-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [busy, setBusy] = useState('');
  const logoInputRef = useRef(null);

  const callOrderApi = useCallback(async (payload) => {
    const res = await fetch('/.netlify/functions/uniform-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || 'The order service did not confirm the request.');
    return json;
  }, []);

  const loadOrderStatus = useCallback(async (link = orderLink || (orderStatus && orderStatus.order && { orderNumber: orderStatus.order.order_number, token: orderStatus.order.token })) => {
    if (!link) return;
    setOrderStatusBusy(true); setOrderStatusError('');
    try {
      const json = await callOrderApi({ action: 'status', order_number: link.orderNumber, token: link.token });
      setOrderStatus(json);
    } catch (e) { setOrderStatusError(e.message || 'Could not load order status.'); }
    setOrderStatusBusy(false);
  }, [callOrderApi, orderLink, orderStatus]);

  useEffect(() => { if (orderLink) loadOrderStatus(orderLink); }, []); // private order link is stable for this mount

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const spec = useMemo(() => specFromConfig(config), [config]);
  // Neck style picks the garment: the commissioned V-neck (crisp sewn panels)
  // or the crew-neck model. More cuts slot in here as the artist delivers them.
  const tpl = getTemplate(garmentFor(config));
  const modelTpl = getTemplate(modelGarmentFor(config));

  // Per-section design: which section the Jersey step is editing, and a helper
  // that patches one section's {color, color2, pattern}.
  const [designSection, setDesignSection] = useState('body');
  // Section edits go through the normalized store; while sleeves are mirrored,
  // editing either sleeve writes both.
  const setSection = (key, patch) => setConfig((c) => {
    const cur = normSections(c.sections);
    const mirror = c.sleevesLinked !== false && (key === 'sleeveL' || key === 'sleeveR');
    const keys = mirror ? ['sleeveL', 'sleeveR'] : [key];
    const sections = { ...cur };
    for (const k of keys) sections[k] = { ...cur[k], ...patch };
    return { ...c, sections };
  });
  const SX = normSections(config.sections);
  const sleevesLinked = config.sleevesLinked !== false;
  const toggleSleevesLinked = () => setConfig((c) => {
    const cur = normSections(c.sections);
    if (c.sleevesLinked !== false) return { ...c, sleevesLinked: false }; // split — keep current values
    return { ...c, sleevesLinked: true, sections: { ...cur, sleeveR: { ...cur.sleeveL } } }; // re-mirror from the left
  });
  const activeSection = SX[designSection] || SX.body;
  // The stage mirrors the section controls. Linked sleeves highlight together;
  // virtual stripe/band tabs keep their own exact masked focus in Viewer3D.
  const viewerActiveArea = step === 'jersey'
    ? ((sleevesLinked && (designSection === 'sleeveL' || designSection === 'sleeveR')) ? 'sleeves' : designSection)
    : null;
  // The team's colors — declared once on the Team step and offered as the quick
  // palette every later step leads with. When the coach hasn't curated a palette
  // yet (fresh design, a starting preset, or an older autosave), we seed it from
  // the jersey's own colors so the quick-swatches still make sense; the first
  // add/remove on the Team step materializes it into an explicit, editable list.
  const teamColors = (() => {
    const seen = new Set(); const out = [];
    const src = (Array.isArray(config.teamPalette) && config.teamPalette.length)
      ? config.teamPalette
      : [SX.body.color, SX.body.color2, SX.sleeveL.color, SX.collar.color, config.numberColor, '#FFFFFF', '#0B0B0B'];
    for (const hex of src) {
      const h = String(hex || '').toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(h) || seen.has(h)) continue;
      seen.add(h); out.push({ hex: h, name: nameForHex(h) });
    }
    return out;
  })();
  // Palette edits are explicit from here on. Materialize the current resolved
  // list on first touch so removing a seeded color sticks.
  const addTeamColor = (hex) => setConfig((c) => {
    const H = String(hex || '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(H)) return c;
    const cur = (Array.isArray(c.teamPalette) && c.teamPalette.length) ? c.teamPalette.map((x) => x.toUpperCase()) : teamColors.map((t) => t.hex);
    if (cur.includes(H)) return c;
    return { ...c, teamPalette: [...cur, H] };
  });
  const removeTeamColor = (hex) => setConfig((c) => {
    const H = String(hex || '').toUpperCase();
    const cur = (Array.isArray(c.teamPalette) && c.teamPalette.length) ? c.teamPalette.map((x) => x.toUpperCase()) : teamColors.map((t) => t.hex);
    const next = cur.filter((x) => x !== H);
    return { ...c, teamPalette: next.length ? next : cur }; // never empty
  });
  // Replacing a declared team color updates every zone that still uses that
  // exact color. Individually customized zones remain untouched, so this feels
  // like a smart brand-color edit rather than a destructive global repaint.
  const replaceTeamColor = (fromHex, toHex) => setConfig((c) => {
    const from = String(fromHex || '').toUpperCase();
    const to = String(toHex || '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(from) || !/^#[0-9A-F]{6}$/.test(to) || from === to) return c;
    const replaceValue = (value) => String(value || '').toUpperCase() === from ? to : value;
    const replaceZone = (zone) => {
      const next = { ...(zone || {}) };
      for (const key of ['color', 'color2', 'color3', 'color4']) if (next[key]) next[key] = replaceValue(next[key]);
      return next;
    };
    const sections = {};
    for (const [key, zone] of Object.entries(c.sections || {})) sections[key] = replaceZone(zone);
    const bottom = c.bottom ? {
      ...c.bottom,
      sections: Object.fromEntries(Object.entries((c.bottom && c.bottom.sections) || {}).map(([key, zone]) => [key, replaceZone(zone)])),
    } : c.bottom;
    const palette = [];
    for (const value of ((Array.isArray(c.teamPalette) && c.teamPalette.length) ? c.teamPalette : teamColors.map((t) => t.hex))) {
      const next = replaceValue(value);
      if (!palette.some((p) => p.toUpperCase() === String(next).toUpperCase())) palette.push(next);
    }
    return {
      ...c, sections, bottom, teamPalette: palette,
      numberColor: replaceValue(c.numberColor),
      outlineColor: replaceValue(c.outlineColor),
      outline2Color: replaceValue(c.outline2Color),
    };
  });

  // Paired bottom garment (shorts) — linked by default (derives from the top's
  // sections); unlinking freezes the current derived look for independent edits.
  const [designBottomSection, setDesignBottomSection] = useState('legs');
  const bottom = SHORTS_PREVIEW_ENABLED
    ? (config.bottom || defaultBottom())
    : { ...defaultBottom(), enabled: false };
  const bottomSections = effectiveBottomSections(config);
  const setBottomSection = (key, patch) => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: false, sections: { ...effectiveBottomSections(c), [key]: { ...effectiveBottomSections(c)[key], ...patch } } } }));
  const toggleBottomEnabled = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), enabled: !(c.bottom ? c.bottom.enabled : true) } }));
  const unlinkBottom = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: false, sections: effectiveBottomSections(c) } }));
  const relinkBottom = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: true } }));
  const bottomSpec = useMemo(() => bottomSpecFromConfig(config), [config]);
  const shortsTpl = getTemplate('shorts');
  const showingShorts = stagePiece === 'shorts' && bottom.enabled;
  // The 3D model may use an artist cut, while `spec` remains on the approved
  // design template for production proofs, exports and fallbacks.
  const jerseyModelSpec = useMemo(() => ({ ...spec, garmentId: modelGarmentFor(config) }), [spec, config.artistCut, config.neckStyle]);
  const stageSpec = showingShorts ? bottomSpec : jerseyModelSpec;
  const stageTpl = showingShorts ? shortsTpl : modelTpl;
  const [stageFallback, setStageFallback] = useState(null);
  const stageColors = showingShorts
    ? [bottomSections.legs.color, bottomSections.stripe.color, bottomSections.waistband.color]
    : [SX.body.color, SX.sleeveL.color, SX.collar.color];
  const stageActiveArea = step !== 'jersey' ? null : (showingShorts && !bottom.linked)
    ? ({ legs: 'legs', waistband: 'waistband', stripe: 'stripe' })[designBottomSection]
    : showingShorts ? null : viewerActiveArea;
  useEffect(() => { if (step !== 'jersey' || !bottom.enabled) setStagePiece('jersey'); }, [step, bottom.enabled]);
  // The fallback is generated by the exact production proof renderer. If WebGL
  // or a vendor model fails, the builder remains fully usable and visually
  // faithful instead of showing an empty stage.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const image = await renderToDataURL(showingShorts ? bottomSpec : spec, { view: 'front', width: 760 });
        if (alive) setStageFallback(image);
      } catch (_e) { if (alive) setStageFallback(null); }
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [showingShorts, bottomSpec, spec]);

  // Click any assigned player to proof that person's actual name and number on
  // the back of the garment before the order reaches Finalize.
  useEffect(() => {
    if (step !== 'roster' || !rosterPreview) { setRosterPreviewImage(null); return undefined; }
    let alive = true;
    setRosterPreviewImage(null);
    const timer = setTimeout(async () => {
      try {
        const playerSpec = specFromConfig({
          ...config,
          playerNumber: rosterPreview,
          playerName: playerNames[rosterPreview] || '',
        });
        const image = await renderToDataURL(playerSpec, { view: 'back', width: 420 });
        if (alive) setRosterPreviewImage(image);
      } catch (_e) { if (alive) setRosterPreviewImage(null); }
    }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [step, rosterPreview, config, playerNames]);

  const selectGarmentZone = useCallback((area) => {
    if (step !== 'jersey' || showingShorts) return;
    let key = area;
    if (sleevesLinked) {
      if (key === 'sleeveL' || key === 'sleeveR') key = 'sleeveL';
      if (key === 'sleeveBandL' || key === 'sleeveBandR') key = 'sleeveBands';
    }
    const definitions = config.neckStyle === 'agi1012'
      ? (sleevesLinked ? AGI1012_LINKED_SECTIONS : AGI1012_SPLIT_SECTIONS)
      : config.neckStyle === 'agi1011'
        ? (sleevesLinked ? AGI1011_LINKED_SECTIONS : AGI1011_SPLIT_SECTIONS)
        : (sleevesLinked ? [{ key: 'body' }, { key: 'sleeveL' }, { key: 'collar' }] : SECTIONS);
    if (definitions.some((def) => def.key === key)) setDesignSection(key);
  }, [step, showingShorts, sleevesLinked, config.neckStyle]);

  // Autosave (debounced — logo data URLs make the payload chunky, so don't
  // write on every pointer-move of a drag).
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ config, assignments, playerNames, ts: Date.now() })); } catch (_e) { /* quota */ }
    }, 600);
    return () => clearTimeout(t);
  }, [config, assignments, playerNames]);

  // Gallery thumbnails — rendered live from the proof pipeline, cached for the
  // session. Blank number/name so the thumb reads as the design, not a player.
  useEffect(() => {
    if (screen !== 'designs') return;
    let alive = true;
    (async () => {
      for (const pz of DESIGN_PRESETS) {
        if (thumbCache[pz.id]) continue;
        try {
          const tspec = specFromConfig({ ...DEFAULT_CONFIG, ...pz.config, teamName: '', playerName: '', playerNumber: '', logos: emptyLogos() });
          const url = await renderToDataURL(tspec, { view: 'front', width: 320 });
          thumbCache[pz.id] = url;
          if (alive) setThumbs((t) => ({ ...t, [pz.id]: url }));
        } catch (_e) { /* thumb optional */ }
      }
    })();
    return () => { alive = false; };
  }, [screen]);

  // Admin-curated print patterns (Settings → Uniform Patterns). Best-effort:
  // the builder works fine with an empty library if Supabase is unreachable.
  const [printLib, setPrintLib] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await loadBuilderPatterns();
        if (alive && Array.isArray(data)) setPrintLib(data);
      } catch (_e) { /* offline / table missing */ }
    })();
    return () => { alive = false; };
  }, []);

  const pickSport = (key) => { set({ sport: key }); setScreen('designs'); };
  // A preset replaces the design (colors/pattern/number color) but keeps the
  // coach's team name, players, logos, and roster.
  const pickDesign = (pz) => {
    // Picking a gallery design starts a CLEAN garment: no numbers, name or
    // logos carried over from a previous session's autosave — only the team's
    // identity (sport, name, palette, program) survives. "Start From Scratch"
    // (pz == null) intentionally keeps the current setup, as its card says.
    if (pz) setConfig((c) => ({
      ...DEFAULT_CONFIG,
      sport: c.sport, teamName: c.teamName, teamPalette: c.teamPalette, program: c.program,
      ...pz.config,
      designId: pz.id,
      ...(pz.config.sections ? { sections: normSections(pz.config.sections) } : {}),
    }));
    setScreen('wizard'); setStep('team');
  };

  // "Change Design" (in-wizard): re-skin the jersey with a different starting
  // design but keep the coach's own colors, numbers, name, logos and fabric.
  // The preset defines the pattern per zone and a primary/secondary/accent color
  // relationship; we remap those three roles onto the colors the coach has
  // already chosen so each alternative shows up in *their* colors.
  const recolorSectionsFrom = (pz, cur) => {
    const ps = normSections(pz.config.sections);
    const pPrimary = String(ps.body.color || '').toUpperCase();
    const pSecondary = String(ps.body.color2 || '').toUpperCase();
    const pAccent = String(ps.sleeveL.color || '').toUpperCase();
    const uPrimary = cur.body.color, uSecondary = cur.body.color2, uAccent = cur.sleeveL.color;
    const map = new Map([[pPrimary, uPrimary], [pSecondary, uSecondary], [pAccent, uAccent]]);
    const rc = (c) => map.get(String(c || '').toUpperCase()) || uPrimary;
    const zone = (z) => {
      const out = { color: rc(z.color), color2: rc(z.color2), pattern: z.pattern || 'solid' };
      // Preset patterns are always built-ins, so clear any custom-print fields.
      return out;
    };
    return { body: zone(ps.body), sleeveL: zone(ps.sleeveL), sleeveR: zone(ps.sleeveR), collar: zone(ps.collar) };
  };
  const applyDesignPort = (pz) => {
    setConfig((c) => ({ ...c, designId: pz.id, sections: recolorSectionsFrom(pz, normSections(c.sections)) }));
    setChangeOpen(false);
  };
  // Render the alt-design thumbnails in the coach's current colors while the
  // dropdown is open (regenerated when colors change so they stay in sync).
  const changeDesigns = useMemo(
    () => DESIGN_PRESETS.filter((pz) => !pz.sports || !pz.sports.length || pz.sports.includes(config.sport)),
    [config.sport, settingsRev] // eslint-disable-line
  );
  useEffect(() => {
    if (!changeOpen) return;
    let alive = true;
    (async () => {
      for (const pz of changeDesigns) {
        try {
          const secs = recolorSectionsFrom(pz, SX);
          const tspec = specFromConfig({ ...config, sections: secs, playerName: '', teamName: '' });
          const url = await renderToDataURL(tspec, { view: 'front', width: 190 });
          if (alive) setChangeThumbs((t) => ({ ...t, [pz.id]: url }));
        } catch (_e) { /* thumb optional */ }
      }
    })();
    return () => { alive = false; };
  }, [changeOpen, SX.body.color, SX.sleeveL.color, SX.body.color2]); // eslint-disable-line

  // ── My Designs (browser-local; a coach's saves are only ever on their own
  // device — nothing here is pulled from the shared uniform_designs table) ──
  const [savedList, setSavedList] = useState([]);
  const [savedThumbs, setSavedThumbs] = useState({});
  useEffect(() => {
    if (screen !== 'saved') return;
    const list = loadSavedDesigns();
    setSavedList(list);
    let alive = true;
    (async () => {
      for (const entry of list) {
        if (savedThumbsCache[entry.id]) continue;
        try {
          const url = await renderToDataURL(specFromConfig({ ...DEFAULT_CONFIG, ...entry.config }), { view: 'front', width: 260 });
          savedThumbsCache[entry.id] = url;
          if (alive) setSavedThumbs((t) => ({ ...t, [entry.id]: url }));
        } catch (_e) { /* thumb optional */ }
      }
    })();
    return () => { alive = false; };
  }, [screen]); // eslint-disable-line
  const loadSavedDesign = (entry) => {
    const restored = {
      ...DEFAULT_CONFIG,
      ...entry.config,
      includePlayerName: typeof entry.config.includePlayerName === 'boolean'
        ? entry.config.includePlayerName
        : !!String(entry.config.playerName || '').trim(),
      sections: normSections(entry.config.sections),
      logos: { ...emptyLogos(), ...(entry.config.logos || {}) },
    };
    setConfig(restored);
    setAssignments((entry.assignments && typeof entry.assignments === 'object') ? entry.assignments : { AM: ['10'] });
    setPlayerNames((entry.playerNames && typeof entry.playerNames === 'object') ? entry.playerNames : {});
    setScreen('wizard'); setStep('team');
  };
  const deleteSavedDesign = (id) => {
    const next = savedList.filter((e) => e.id !== id);
    setSavedList(next);
    try { localStorage.setItem(SAVED_DESIGNS_KEY, JSON.stringify(next)); } catch (_e) { /* quota */ }
  };

  // ── AI design assist (Team step) — a plain-English brief becomes a starting
  // point the coach then fine-tunes with the normal controls. Reuses the same
  // Claude-backed function the advanced editor's AI tab calls; 'crew_jersey'
  // is the closest existing zone vocabulary (body/sleeveL/sleeveR/collar) —
  // the octa jersey's sections map onto it directly.
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNote, setAiNote] = useState('');
  // 2-3 looks per brief, each a ready-to-apply config patch + thumbnail — the
  // coach compares and picks instead of getting one take forced on them.
  const [aiCandidates, setAiCandidates] = useState([]);

  // Turn one AI design (spec + styling) into a wizard config patch. Everything
  // is validated here: unknown patterns/fonts/colors just don't make it in.
  const aiDesignToPatch = (d) => {
    const spec = d.spec || {}; const zones = spec.zones || {};
    const zoneToSection = (z) => {
      const color = ds.toHex(z && z.color);
      if (!color) return null;
      const sec = { color, color2: ds.toHex(z && z.color2) || '#FFFFFF', pattern: (z && z.pattern) || 'solid' };
      const c3 = ds.toHex(z && z.color3); if (c3) sec.color3 = c3;
      const c4 = ds.toHex(z && z.color4); if (c4) sec.color4 = c4;
      // A named print from the shop library beats a built-in pattern.
      if (z && z.printPattern) {
        const lib = printLib.find((p) => (p.name || '').toLowerCase() === String(z.printPattern).toLowerCase());
        if (lib) Object.assign(sec, { pattern: 'custom', patternImage: lib.image, patternName: lib.name, patternTint: !!lib.tintable, patternTintMode: lib.tint_mode || 'solid' });
      }
      return sec;
    };
    const sections = {};
    const bodySec = zoneToSection(zones.body); if (bodySec) sections.body = bodySec;
    const sl = zoneToSection(zones.sleeveL || zones.sleeveR); if (sl) sections.sleeveL = sl;
    const sr = zoneToSection(zones.sleeveR || zones.sleeveL); if (sr) sections.sleeveR = sr;
    const collarSec = zoneToSection(zones.collar); if (collarSec) sections.collar = collarSec;
    const patch = { sections };
    const st = d.styling || {};
    if (st.neckStyle === 'vneck' || st.neckStyle === 'crew') patch.neckStyle = st.neckStyle;
    if (['right', 'left', 'center', 'none'].includes(st.frontNumber)) patch.frontNumber = st.frontNumber;
    if (st.nameArch === 'arched' || st.nameArch === 'straight') patch.nameArch = st.nameArch;
    if (Number.isFinite(st.nameSpacing)) patch.nameSpacing = Math.min(30, Math.max(0, st.nameSpacing));
    if (['matte', 'mesh', 'heather', 'sublimated', 'gloss'].includes(spec.fabric)) patch.fabric = spec.fabric;
    const t = spec.text || {};
    const numSrc = (t.back && t.back.number) || (t.front && t.front.number);
    const nameSrc = (t.back && t.back.name) || (t.front && t.front.name);
    if (numSrc) {
      const fill = ds.toHex(numSrc.fill); if (fill) patch.numberColor = fill;
      if (numSrc.outline === 'auto' || numSrc.outline === 'none') patch.outlineColor = numSrc.outline;
      else { const o = ds.toHex(numSrc.outline); if (o) patch.outlineColor = o; }
      if (numSrc.outline2 === 'none') patch.outline2Color = 'none';
      else { const o2 = ds.toHex(numSrc.outline2); if (o2) patch.outline2Color = o2; }
      // The AI names a raw font; the wizard stores a lettering STYLE — pick the
      // first admin style built on that font.
      if (numSrc.font) { const styleDef = FONTS.find((f) => f.font === numSrc.font && !f.hollow) || FONTS.find((f) => f.font === numSrc.font); if (styleDef) patch.font = styleDef.id; }
      if (numSrc.value) { const n = String(numSrc.value).replace(/[^0-9]/g, '').slice(0, 2); if (n) patch.playerNumber = n; }
    }
    if (nameSrc && nameSrc.value) {
      patch.playerName = String(nameSrc.value).slice(0, 14);
      patch.includePlayerName = true;
    }
    if (spec.meta && spec.meta.teamName) patch.teamName = String(spec.meta.teamName).slice(0, 24);
    return patch;
  };

  const applyAICandidate = (cand) => {
    setConfig((c) => ({ ...c, ...cand.patch, sections: { ...normSections(c.sections), ...cand.patch.sections } }));
    setAiNote(`"${cand.name}" applied — fine-tune anything below, or try another look.`);
  };

  const runAIDesign = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setAiBusy(true); setAiError(''); setAiNote(''); setAiCandidates([]);
    try {
      const res = await fetch('/.netlify/functions/uniform-ai-design', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt, garmentId: 'sahrul_jersey', count: 3,
          context: {
            sport: config.sport || '', program: config.program || 'mens',
            teamColors: teamColors.map((c) => c.hex),
            printPatterns: printLib.map((p) => ({ name: p.name, tintable: !!p.tintable, tintMode: p.tint_mode || 'solid' })),
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setAiError(data.error || 'AI design is not available right now.'); return; }
      const raw = Array.isArray(data.designs) && data.designs.length ? data.designs : [{ name: 'Design', spec: data.spec, styling: {}, rationale: data.rationale || '' }];
      const cands = [];
      for (const d of raw.slice(0, 3)) {
        const patch = aiDesignToPatch(d);
        if (!patch.sections.body) continue; // a look with no body color isn't a look
        let thumb = '';
        try {
          // Thumbnail from the exact spec Apply would produce, so what the coach
          // picks is what they get.
          thumb = await renderToDataURL(specFromConfig({ ...config, ...patch, sections: { ...normSections(config.sections), ...patch.sections } }), { view: 'front', width: 200 });
        } catch (_e) { /* thumb optional */ }
        cands.push({ name: d.name || 'Design', rationale: d.rationale || '', patch, thumb });
      }
      if (!cands.length) { setAiError('The AI came back empty — try rewording the brief.'); return; }
      setAiCandidates(cands);
      if (cands.length === 1) { applyAICandidate(cands[0]); setAiCandidates([]); }
      else setAiNote('Pick the look you like — every one stays fully editable.');
    } catch (e) {
      setAiError('Could not reach the AI design service. Please try again.');
    } finally { setAiBusy(false); }
  };

  // ── roster helpers ──
  const numberOwner = useCallback((num) => {
    for (const k of Object.keys(assignments)) if ((assignments[k] || []).includes(num)) return k;
    return null;
  }, [assignments]);
  const totalQty = useMemo(() => Object.values(assignments).reduce((t, a) => t + a.length, 0), [assignments]);
  const price = useMemo(() => calculateUniformPrice({
    quantity: totalQty,
    fabric: config.fabric || 'sublimated',
    decorationMethod: config.decorationMethod || 'sublimated',
    discountPercent: normalizeUniformDiscount(coachDiscountPercent),
    policy: effectivePricingPolicy,
  }), [totalQty, config.fabric, config.decorationMethod, coachDiscountPercent, effectivePricingPolicy]);
  const fabricOptions = useMemo(() => ds.FABRICS.map((fabric) => {
    const quote = calculateUniformPrice({ fabric: fabric.id, policy: effectivePricingPolicy, quantity: 1 });
    const adjustment = quote.fabricAdjustment;
    return { ...fabric, label: adjustment ? `${fabric.label} ${adjustment > 0 ? '+' : '−'}${formatUniformMoney(Math.abs(adjustment))}` : fabric.label };
  }), [effectivePricingPolicy]);
  const toggleNumber = (num) => setAssignments((s) => {
    const next = {}; for (const k of Object.keys(s)) next[k] = s[k].slice();
    const mine = (next[selectedSize] || []).includes(num);
    for (const k of Object.keys(next)) next[k] = next[k].filter((n) => n !== num); // a number belongs to one jersey
    if (!mine) next[selectedSize] = [...(next[selectedSize] || []), num];
    for (const k of Object.keys(next)) if (!next[k].length) delete next[k];
    return next;
  });
  const clearSize = () => setAssignments((s) => { const n = { ...s }; delete n[selectedSize]; return n; });
  // Each size's roster carries both a plain "7, 10" string (nums — for CSV
  // parsing/back-compat) and a display string with names folded in
  // (numsDisplay — "#7, MESSI #10" — for the on-screen summary and the
  // production PDF/PNG), plus the raw {num,name} pairs (players) so the
  // admin queue can regenerate a real CSV even for orders placed before a
  // name was added to a given number.
  const rosterBreakdown = useMemo(() => SIZES
    .map((sz) => {
      const nums = (assignments[sz] || []).slice().sort((a, b) => Number(a) - Number(b));
      const players = nums.map((n) => ({ num: n, name: config.includePlayerName ? (playerNames[n] || '') : '' }));
      return {
        size: sz, label: SIZE_LABELS[sz], qty: nums.length,
        nums: nums.join(', '),
        numsDisplay: players.map((pl) => (pl.name ? `${pl.name.toUpperCase()} #${pl.num}` : `#${pl.num}`)).join(', '),
        players,
      };
    })
    .filter((r) => r.qty > 0), [assignments, playerNames, config.includePlayerName]);

  // Finalize must preserve the exact design the customer approved. Roster
  // numbers remain in the roster table/CSV; they never silently replace the
  // number currently shown in the builder.
  const productionSpec = spec;

  const productionChecks = useMemo(() => {
    const placedLogos = LOGO_SLOTS.map((slot) => ({ slot, logo: config.logos && config.logos[slot.key] })).filter((x) => x.logo && x.logo.src);
    const lowRes = placedLogos.filter(({ logo }) => { const dpi = logoDpi(logo); return dpi != null && dpi < 150; });
    const unknownRes = placedLogos.filter(({ logo }) => logoDpi(logo) == null);
    return [
      { ok: !!String(config.teamName || '').trim(), label: 'Team identity', detail: String(config.teamName || '').trim() || 'Add a team name' },
      { ok: totalQty > 0, label: 'Roster quantities', detail: totalQty > 0 ? `${totalQty} garment${totalQty === 1 ? '' : 's'} assigned` : 'Assign at least one size and number' },
      { ok: true, label: 'Lettering scale', detail: `Front ${config.frontNumberInches || 4}\u2033 · Back ${Number.isFinite(config.backNumberInches) ? config.backNumberInches : (config.program === 'mens' ? 8 : 6)}\u2033${config.includePlayerName ? ` · Name ${config.nameInches || 2}\u2033` : ''}` },
      { ok: true, label: 'Placement boundaries', detail: 'Artwork centers constrained to sew-safe garment panels' },
      { ok: lowRes.length === 0 && unknownRes.length === 0, label: 'Logo resolution', detail: !placedLogos.length ? 'No uploaded logos' : lowRes.length ? `${lowRes.map((x) => x.slot.label).join(', ')} below 150 DPI at finished size` : unknownRes.length ? 'Replace legacy artwork to verify print resolution' : `${placedLogos.length} logo${placedLogos.length === 1 ? '' : 's'} at 150+ DPI` },
    ];
  }, [config, totalQty]);

  const setPlayerName = (num, name) => setPlayerNames((p) => ({ ...p, [num]: name }));

  const downloadRoster = () => {
    const rows = [config.includePlayerName ? ['Player Name', 'Number', 'Size'] : ['Number', 'Size']];
    SIZES.forEach((sz) => (assignments[sz] || []).forEach((n) => {
      rows.push(config.includePlayerName ? [playerNames[n] || '', n, sz] : [n, sz]);
    }));
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (config.teamName || 'team').toLowerCase().replace(/\s+/g, '-') + '-roster.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── decorations ──
  // Logos and lettering are positioned on the full-size 3D garment. The first
  // click selects a decoration; only a subsequent drag can reposition it.
  const [logoSlot, setLogoSlot] = useState('');
  const [activeDecoration, setActiveDecoration] = useState('');
  useEffect(() => { if (step !== 'numbers') setActiveDecoration(''); }, [step]);
  const slotDef = SLOT_BY_KEY[logoSlot] || LOGO_SLOTS[0];
  const activeLogo = (config.logos && config.logos[logoSlot]) || {};
  const activeDecorationPresent = activeDecoration === 'frontNumber'
    ? config.frontNumber !== 'none' && !!String(config.playerNumber || '').trim()
    : activeDecoration === 'backNumber'
      ? !!String(config.playerNumber || '').trim()
      : activeDecoration === 'backName'
        ? config.includePlayerName && !!String(config.playerName || '').trim()
        : activeDecoration.startsWith('logo:')
          ? !!(config.logos && config.logos[activeDecoration.slice(5)] && config.logos[activeDecoration.slice(5)].src)
          : false;
  const activeDecorationLabel = activeDecoration.startsWith('logo:')
    ? `${(SLOT_BY_KEY[activeDecoration.slice(5)] || {}).label || 'Logo'} Logo`
    : ({ frontNumber: 'Front Number', backNumber: 'Back Number', backName: 'Back Name' })[activeDecoration] || 'Artwork';
  const setLogo = (patch) => {
    if (!logoSlot) return;
    setConfig((c) => ({ ...c, logos: { ...c.logos, [logoSlot]: { ...c.logos[logoSlot], ...patch } } }));
  };
  const placedLogoSlots = LOGO_SLOTS.filter((s) => config.logos && config.logos[s.key] && config.logos[s.key].src);
  const logoCount = placedLogoSlots.length;
  const removeActiveLogo = () => {
    if (!logoSlot) return;
    const removedSlot = logoSlot;
    setConfig((c) => ({
      ...c,
      logos: {
        ...c.logos,
        [removedSlot]: { ...(c.logos && c.logos[removedSlot]), src: null, srcFull: null, srcCut: null, bgRemoved: false, pixelWidth: null, pixelHeight: null, sourcePixelWidth: null, sourcePixelHeight: null },
      },
    }));
    setLogoSlot('');
    if (activeDecoration === `logo:${removedSlot}`) setActiveDecoration('');
  };

  const handleLogoFile = (file) => {
    if (!logoSlot || !file || !/^image\//.test(file.type || '')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        try {
          setLogo({ ...prepareLogoImage(img), sourcePixelWidth: iw, sourcePixelHeight: ih, x: slotDef.x, y: slotDef.y, scale: slotDef.scale, rot: 0 });
        } catch (_e) {
          setLogo({ src: ev.target.result, srcFull: ev.target.result, srcCut: null, bgRemoved: false, aspect: iw / ih, pixelWidth: iw, pixelHeight: ih, sourcePixelWidth: iw, sourcePixelHeight: ih, x: slotDef.x, y: slotDef.y, scale: slotDef.scale, rot: 0 });
        }
      };
      img.onerror = () => setLogo({ src: ev.target.result, srcFull: ev.target.result, srcCut: null, bgRemoved: false, aspect: 1, pixelWidth: null, pixelHeight: null });
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  const onLogoFile = (e) => { handleLogoFile(e.target.files && e.target.files[0]); e.target.value = ''; };
  // Drag-and-drop an image straight onto the logo area (in addition to click-to-
  // upload). Prevent-default on dragover is required for a drop to fire.
  const [logoDragOver, setLogoDragOver] = useState(false);
  const onLogoDragOver = (e) => { e.preventDefault(); if (!logoDragOver) setLogoDragOver(true); };
  const onLogoDragLeave = (e) => { e.preventDefault(); setLogoDragOver(false); };
  const onLogoDrop = (e) => {
    e.preventDefault(); setLogoDragOver(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleLogoFile(file);
  };
  const placeExistingArtwork = (art) => {
    if (!logoSlot || !art || !art.src) return;
    setArtPickerOpen(false);
    const base = { src: art.src, srcFull: art.src, srcCut: null, bgRemoved: false, sourceName: art.name, x: slotDef.x, y: slotDef.y, scale: slotDef.scale, rot: 0 };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      try { setLogo({ ...base, ...prepareLogoImage(img), sourcePixelWidth: iw, sourcePixelHeight: ih }); }
      catch (_e) { setLogo({ ...base, aspect: iw / ih, pixelWidth: iw, pixelHeight: ih, sourcePixelWidth: iw, sourcePixelHeight: ih }); }
    };
    img.onerror = () => setLogo({ ...base, aspect: 1, pixelWidth: null, pixelHeight: null, sourcePixelWidth: null, sourcePixelHeight: null });
    img.src = art.src;
  };

  // Live shorts thumbnail — shown next to the 3D jersey stage so the top and
  // bottom "show together" while designing, even without a 3D shorts model.
  const [bottomPreview, setBottomPreview] = useState(null);
  useEffect(() => {
    if (!bottom.enabled) { setBottomPreview(null); return; }
    let alive = true;
    renderToDataURL(bottomSpec, { view: 'front', width: 300 }).then((u) => { if (alive) setBottomPreview(u); }).catch(() => {});
    return () => { alive = false; };
  }, [bottom.enabled, bottomSpec]);

  const selectDecoration = (key) => {
    setActiveDecoration(key);
    if (key && key.startsWith('logo:')) {
      setLogoSlot(key.slice(5));
      setLogoPlacementOpen(false);
    }
  };
  const moveDecoration = ({ key, x, y }) => {
    if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const safe = safeDecorationPosition(key, x, y);
    setConfig((c) => {
      if (key.startsWith('logo:')) {
        const slot = key.slice(5);
        if (!c.logos || !c.logos[slot]) return c;
        return { ...c, logos: { ...c.logos, [slot]: { ...c.logos[slot], x: safe.x, y: safe.y } } };
      }
      if (key === 'frontNumber') return { ...c, frontNumberX: c.frontNumber === 'center' ? 0.5 : safe.x, frontNumberY: safe.y };
      if (key === 'backNumber') return { ...c, backNumberX: safe.x, backNumberY: safe.y };
      if (key === 'backName') return { ...c, backNameX: safe.x, backNameY: safe.y };
      return c;
    });
  };

  // ── finalize: capture the same 3D renderer used by the builder. The paired
  // bottom remains on its flat proof path until a production shorts model is
  // approved. ──
  const [bottomReview, setBottomReview] = useState({ front: null, back: null });
  useEffect(() => {
    if (step !== 'finalize') return;
    let alive = true;
    setReview({ front: null, back: null });
    setBottomReview({ front: null, back: null });
    (async () => {
      if (!bottom.enabled) return;
      try {
        const [bf, bb] = await Promise.all([
          renderToDataURL(bottomSpec, { view: 'front', scale: 1 }),
          renderToDataURL(bottomSpec, { view: 'back', scale: 1 }),
        ]);
        if (alive) setBottomReview({ front: bf, back: bb });
      } catch (e) { /* review images optional */ }
    })();
    return () => { alive = false; };
  }, [step, productionSpec, config.artistCut, bottom.enabled, bottomSpec]);

  const acceptReviewSnapshot = useCallback((viewName, shot) => {
    if (!shot || !shot.url) return;
    setReview((current) => current[viewName] === shot.url ? current : { ...current, [viewName]: shot.url });
  }, []);

  const saveDesign = () => {
    try {
      const key = SAVED_DESIGNS_KEY;
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      prev.unshift({ id: 'u_' + Date.now().toString(36), name: config.teamName || 'Team', config, assignments, playerNames, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 40)));
      setSavedMsg(true); setTimeout(() => setSavedMsg(false), 3000);
    } catch (e) {}
    trySupabaseSave({ name: config.teamName || 'Team', spec, thumb: review.front });
  };

  const fileBase = () => (config.teamName || 'uniform').toLowerCase().replace(/\s+/g, '-');
  const downloadDataURL = (url, name) => {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // Production exports — what gets emailed to the sublimation shop. The PDF
  // carries the renders + exact hex colorway + lettering + roster; the PNG is
  // a single high-res front/back sheet for quick reference.
  const downloadProofPDF = async () => {
    setBusy('Building production PDF…');
    try {
      const doc = await renderProductionPDF(productionSpec, {
        frontImage: review.front || undefined,
        backImage: review.back || undefined,
        proofAspect: 1,
        roster: rosterBreakdown,
        order: {
          totalQty,
          unitPrice: price.coachUnit,
          total: price.coachTotal,
          publicUnitPrice: price.publicUnit,
          publicTotal: price.publicTotal,
          discountPercent: price.discountPercent,
          discountTotal: price.savingsTotal,
        },
        bottomSpec: bottom.enabled ? bottomSpec : undefined,
        checks: productionChecks,
      });
      doc.save(`${fileBase()}-production.pdf`);
    } catch (e) { /* jsPDF unavailable */ } finally { setBusy(''); }
  };
  const downloadProofPNG = async () => {
    setBusy('Rendering production PNG…');
    try {
      const url = await renderProductionSheet(productionSpec, { width: 1400, frontImage: review.front || undefined, backImage: review.back || undefined, proofAspect: 1, bottomSpec: bottom.enabled ? bottomSpec : undefined });
      downloadDataURL(url, `${fileBase()}-production.png`);
    } catch (e) { /* render failed */ } finally { setBusy(''); }
  };

  // A coach fills in name/email once, then picks how to complete the order —
  // pay by card now, submit a school PO, or add to the queue for a rep to
  // process manually. All three write one row to uniform_order_requests
  // (staff-only reads; see Settings -> Uniform Orders) so there's a single
  // queue to work from regardless of path.
  const contactValid = contactName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const orderReady = contactValid && totalQty > 0;

  const orderPayload = (fulfillment, extra = {}) => ({
    team_name: config.teamName || 'Team',
    sport: config.sport || null,
    contact_name: contactName.trim(),
    contact_email: contactEmail.trim(),
    config,
    spec: productionSpec,
    bottom_spec: bottom.enabled ? bottomSpec : null,
    roster: rosterBreakdown,
    total_qty: totalQty,
    // Preview values are useful for diagnostics only. The order API replaces
    // every money field with its own policy/account calculation.
    public_unit_price: price.publicUnit,
    discount_percent: price.discountPercent,
    discount_total: price.savingsTotal,
    pricing_breakdown: price,
    unit_price: price.coachUnit,
    total: price.coachTotal,
    fulfillment,
    status: fulfillment === 'card' ? 'pending_payment' : fulfillment === 'po' ? 'po_submitted' : 'queued',
    thumb: review.front || null,
    back_thumb: review.back || null,
    client_ref: orderClientRef.current,
    ...extra,
  });

  const submitOrder = async (fulfillment, extra) => {
    if (!contactValid) { setOrderError('Enter your name and a valid email to continue.'); return; }
    if (totalQty < 1) { setOrderError('Add at least one player and size in the Roster step before submitting the order.'); return; }
    setOrderBusy(true); setOrderError('');
    const row = orderPayload(fulfillment, extra);
    try {
      // Success is shown only after the server returns the permanent order
      // number. client_ref makes a retry safe even if the first response was
      // lost after the database committed the order.
      const result = await callOrderApi({ action: 'create', ...row });
      setOrderDone({ ...result, fulfillment });
      setOrderStatus(result);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('order', result.order.order_number);
        url.searchParams.set('token', result.order.token);
        window.history.replaceState({}, '', url.toString());
      } catch (_e) { /* confirmation still contains the permanent number */ }
      // Browser storage is now only a convenience copy. It is written after
      // server acknowledgement and can never manufacture a false confirmation.
      try {
        const prev = JSON.parse(localStorage.getItem('nsa_uniform_orders') || '[]');
        prev.unshift({ id: result.order.id, order_number: result.order.order_number, ...row, ts: Date.now() });
        localStorage.setItem('nsa_uniform_orders', JSON.stringify(prev.slice(0, 20)));
      } catch (_e) { /* the confirmed server order remains authoritative */ }
      if (onCreateOrder) onCreateOrder({ ...row, id: result.order.id, order_number: result.order.order_number, assignments });
    } catch (e) {
      setOrderError(e.message || 'Your order was not confirmed. Nothing has been placed—please try again.');
    }
    setOrderBusy(false);
  };

  const submitPO = () => {
    if (!poNumber.trim()) { setOrderError('Enter a PO number to continue.'); return; }
    submitOrder('po', { po_number: poNumber.trim(), po_contact: poContact.trim() });
  };
  const prepareStripeIntent = async ({ method }) => {
    if (!orderReady) throw new Error('Add contact information and at least one rostered jersey first.');
    const result = await callOrderApi({ action: 'prepare_card', ...orderPayload('card'), method });
    cardOrderRef.current = result.order;
    return result;
  };
  const onStripeSuccess = async (payment) => {
    const prepared = cardOrderRef.current;
    if (!prepared) { setOrderError('The permanent order record could not be found. Your card was not marked complete—please contact NSA.'); return; }
    setOrderBusy(true); setOrderError('');
    try {
      const result = await callOrderApi({ action: 'finalize_card', order_number: prepared.order_number, token: prepared.token, stripe_intent_id: payment && payment.intentId });
      setShowStripeModal(false);
      setOrderDone({ ...result, fulfillment: 'card' });
      setOrderStatus(result);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('order', result.order.order_number);
        url.searchParams.set('token', result.order.token);
        window.history.replaceState({}, '', url.toString());
      } catch (_e) { /* permanent order still exists */ }
      if (onCreateOrder) onCreateOrder({ ...orderPayload('card'), id: result.order.id, order_number: result.order.order_number, assignments });
    } catch (e) {
      setOrderError(e.message || 'Payment verification is still pending. Use the private order link or contact NSA; do not pay again.');
    }
    setOrderBusy(false);
  };

  const showOrderStatus = () => {
    if (orderDone && orderDone.order) setOrderStatus(orderDone);
    setScreen('status');
  };
  const leaveOrderStatus = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('order'); url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    } catch (_e) {}
    setScreen('sports');
  };
  const decideProof = async (decision, note) => {
    if (!orderStatus || !orderStatus.order) return;
    setOrderStatusBusy(true); setOrderStatusError('');
    try {
      const result = await callOrderApi({ action: 'customer_decision', order_number: orderStatus.order.order_number, token: orderStatus.order.token, decision, note });
      setOrderStatus(result); setOrderDone(result);
    } catch (e) { setOrderStatusError(e.message || 'Your decision was not saved.'); }
    setOrderStatusBusy(false);
  };
  const reorderUniform = async () => {
    if (!orderStatus || !orderStatus.order) return;
    setOrderStatusBusy(true); setOrderStatusError('');
    try {
      const result = await callOrderApi({ action: 'reorder', order_number: orderStatus.order.order_number, token: orderStatus.order.token, client_ref: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `reorder-${Date.now()}` });
      setOrderStatus(result); setOrderDone(result);
      orderClientRef.current = result.order.id;
      const url = new URL(window.location.href);
      url.searchParams.set('order', result.order.order_number); url.searchParams.set('token', result.order.token);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { setOrderStatusError(e.message || 'The reorder was not created.'); }
    setOrderStatusBusy(false);
  };

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const goNext = () => { if (step === 'finalize') return; setStep(STEPS[Math.min(stepIdx + 1, STEPS.length - 1)].key); };
  const goPrev = () => { if (stepIdx === 0) { setScreen('designs'); return; } setStep(STEPS[stepIdx - 1].key); };
  const nextLabel = 'Continue';

  const isBuilderStep = step === 'team' || step === 'jersey' || step === 'numbers';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: F_BODY, zIndex: 40 }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: narrow ? '0 14px' : '0 28px', height: narrow ? 56 : 64, borderBottom: '1px solid ' + C.light, flexShrink: 0 }}>
        {(onExit || !EMBEDDED) ? (
          <button onClick={onExit} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 16 }}>←</span> {narrow ? 'Exit' : onExit ? 'Exit Builder' : 'Team Stores'}
          </button>
        ) : <div />}
        <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 15 : 18, letterSpacing: 1, color: C.navy, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Uniform Builder {!narrow && <span style={{ color: C.textLight, fontWeight: 700, fontSize: 12 }}>National Sports</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => setScreen('saved')} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>My Designs</button>
          {!narrow && <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Changes save automatically</div>}
        </div>
      </div>

      {screen === 'status' && (
        <OrderStatusPage
          data={orderStatus}
          loading={orderStatusBusy}
          error={orderStatusError}
          narrow={narrow}
          onRefresh={() => loadOrderStatus()}
          onDecision={decideProof}
          onReorder={reorderUniform}
          onBack={leaveOrderStatus}
        />
      )}

      {/* MY DESIGNS — browser-local saved designs, reopen or delete */}
      {screen === 'saved' && (
        <div style={{ flex: 1, overflowY: 'auto', background: C.offWhite }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: narrow ? '22px 16px 48px' : '32px 28px 60px' }}>
            <button onClick={() => setScreen('sports')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight, padding: 0, marginBottom: 14 }}>← All Sports</button>
            <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Saved on This Device</div>
            <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 30, textTransform: 'uppercase', color: C.navy, margin: '2px 0 6px' }}>My Designs</h2>
            <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, marginBottom: 24 }}>Designs you've saved from the Finalize step — stored in this browser only.</div>
            {savedList.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', background: '#fff', border: '1px dashed ' + C.mid, borderRadius: 8, color: C.textLight, fontFamily: F_BODY, fontSize: 14 }}>
                No saved designs yet — use <strong>Save Design</strong> on the Finalize step to keep one here.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
                {savedList.map((entry) => (
                  <div key={entry.id} style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,23,42,.06)' }}>
                    <button onClick={() => loadSavedDesign(entry)} style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '760 / 820', background: '#fff', overflow: 'hidden' }}>
                        {savedThumbs[entry.id] ? <img src={savedThumbs[entry.id]} alt={entry.name} style={{ width: '86%', height: 'auto' }} /> : <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Rendering…</span>}
                      </span>
                    </button>
                    <div style={{ padding: '12px 14px', borderTop: '1px solid ' + C.light }}>
                      <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy, marginBottom: 2 }}>{entry.name || 'Team'}</div>
                      <div style={{ fontFamily: F_BODY, fontSize: 11, color: C.textLight, marginBottom: 10 }}>{new Date(entry.ts).toLocaleDateString()}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => loadSavedDesign(entry)} style={{ flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#fff', background: C.navy, border: 'none', borderRadius: 4, padding: '7px 0', cursor: 'pointer' }}>Load</button>
                        <button onClick={() => deleteSavedDesign(entry.id)} style={{ flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.red, background: '#fff', border: '1px solid ' + C.mid, borderRadius: 4, padding: '7px 0', cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CATALOG · SPORT PICKER */}
      {screen === 'sports' && (
        <div style={{ flex: 1, overflowY: 'auto', background: C.offWhite }}>
          <div style={{ maxWidth: 980, margin: '0 auto', padding: narrow ? '26px 16px 48px' : '40px 28px 60px' }}>
            <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Custom Uniform Builder</div>
            <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 34, textTransform: 'uppercase', color: C.navy, margin: '2px 0 6px' }}>Pick Your Sport</h2>
            <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, marginBottom: 26 }}>Choose a sport, start from a design, then make it yours — colors, logos, numbers, and roster.</div>
            {hasAutosave && (
              <button onClick={() => { setScreen('wizard'); setStep('team'); }} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: C.navy, color: '#fff', border: 'none', borderRadius: 8, padding: '16px 22px', marginBottom: 24, cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
                <span>
                  <span style={{ display: 'block', fontFamily: F_DISP, fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.6 }}>Continue your last design</span>
                  <span style={{ display: 'block', fontFamily: F_BODY, fontSize: 12, opacity: 0.8, marginTop: 2 }}>{(config.teamName || 'Team')} · autosaved</span>
                </span>
                <span style={{ fontSize: 18 }}>→</span>
              </button>
            )}
            {hasSavedDesigns && (
              <button onClick={() => setScreen('saved')} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fff', color: C.navy, border: '1px solid ' + C.mid, borderRadius: 8, padding: '14px 22px', marginBottom: 24, cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
                <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.6 }}>My Designs</span>
                <span style={{ fontSize: 16 }}>→</span>
              </button>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {SPORTS.map((s) => (
                <button key={s.key} onClick={() => pickSport(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: '1px solid ' + C.light, borderRadius: 8, padding: '22px 20px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 4px rgba(15,23,42,.06)' }}>
                  <span style={{ fontSize: 34 }}>{s.icon}</span>
                  <span>
                    <span style={{ display: 'block', fontFamily: F_DISP, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy }}>{s.label}</span>
                    <span style={{ display: 'block', fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginTop: 2 }}>Jerseys · {DESIGN_PRESETS.filter((p) => !p.sports || !p.sports.length || p.sports.includes(s.key)).length} designs · more garments soon</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CATALOG · DESIGN GALLERY */}
      {screen === 'designs' && (
        <div style={{ flex: 1, overflowY: 'auto', background: C.offWhite }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: narrow ? '22px 16px 48px' : '32px 28px 60px' }}>
            <button onClick={() => setScreen('sports')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight, padding: 0, marginBottom: 14 }}>← All Sports</button>
            <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>{SPORT_LABELS[config.sport] || 'Team'} Uniforms</div>
            <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 30, textTransform: 'uppercase', color: C.navy, margin: '2px 0 6px' }}>Pick a Starting Design</h2>
            <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, marginBottom: 18 }}>Every design is fully customizable — colors, pattern, trim, lettering, and logos are all yours to change.</div>
            {/* program selector — men's / women's / youth cut */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: C.textLight, marginRight: 2 }}>Program</span>
              {PROGRAMS.map((pg) => {
                const on = (config.program || 'mens') === pg;
                return (
                  <button key={pg} onClick={() => setConfig((c) => ({ ...c, program: pg }))} style={{
                    padding: '8px 18px', borderRadius: 20, cursor: 'pointer',
                    border: '1.5px solid ' + (on ? C.navy : C.mid),
                    background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy,
                    fontFamily: F_DISP, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6,
                  }}>{PROGRAM_LABELS[pg]}</button>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {DESIGN_PRESETS.filter((pz) => !pz.sports || !pz.sports.length || pz.sports.includes(config.sport)).map((pz) => (
                <button key={pz.id} onClick={() => pickDesign(pz)} style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 8, padding: 0, cursor: 'pointer', overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,23,42,.06)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '760 / 820', background: '#fff', overflow: 'hidden' }}>
                    {thumbs[pz.id] ? <img src={thumbs[pz.id]} alt={pz.name} style={{ width: '86%', height: 'auto' }} /> : <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Rendering…</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderTop: '1px solid ' + C.light }}>
                    <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy }}>{pz.name}</span>
                    <span style={{ display: 'flex', gap: 3 }}>
                      {[pz.config.sections.body.color, (pz.config.sections.sleeves || pz.config.sections.sleeveL).color, pz.config.sections.body.color2].map((cx, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: cx, border: '1px solid ' + C.light }} />)}
                    </span>
                  </span>
                </button>
              ))}
              <button onClick={() => pickDesign(null)} style={{ minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#fff', border: '2px dashed ' + C.mid, borderRadius: 8, cursor: 'pointer' }}>
                <span style={{ fontSize: 26, color: C.textLight }}>✎</span>
                <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', color: C.navy }}>Start From Scratch</span>
                <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Keep your current setup</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === 'wizard' && (<>
      {/* STEP NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: narrow ? 'flex-start' : 'center', gap: narrow ? 20 : 30, height: narrow ? 46 : 52, padding: narrow ? '0 14px' : 0, borderBottom: '1px solid ' + C.light, flexShrink: 0, overflowX: narrow ? 'auto' : 'visible', flexWrap: narrow ? 'nowrap' : 'wrap' }}>
        {STEPS.map((s, i) => {
          const on = s.key === step; const done = i < stepIdx;
          return (
            <button key={s.key} onClick={() => { if (s.key === 'finalize') { /* allow */ } setStep(s.key); }} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 6px', flexShrink: 0,
              borderBottom: '3px solid ' + (on ? C.red : 'transparent'),
              fontFamily: F_DISP, fontWeight: 700, fontSize: narrow ? 13 : 15, textTransform: 'uppercase', letterSpacing: 1,
              color: on ? C.navy : done ? C.navy : C.textLight, whiteSpace: 'nowrap',
            }}>
              <span style={{ color: on ? C.red : C.mid, marginRight: 7 }}>{i + 1}</span>{s.label}
            </button>
          );
        })}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', flexDirection: narrow && isBuilderStep ? 'column' : 'row', minHeight: 0 }}>
        {isBuilderStep && (
          <>
            {/* CENTER STAGE — 3D fills the whole stage; info floats over it so the
                garment gets every available pixel instead of losing rows to a
                stacked header/footer. On narrow screens the stage takes the top
                ~45% of the viewport and the rail scrolls underneath. */}
            <div style={narrow
              ? { flex: '0 0 auto', height: '44vh', minHeight: 260, position: 'relative', minWidth: 0, background: '#fff' }
              : { flex: 1, position: 'relative', minHeight: 0, minWidth: 0, background: '#fff' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <React.Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textLight }}>Loading 3D…</div>}>
                  <Viewer3D spec={stageSpec} modelUrl={stageTpl.model3d} autoRotate={spin} fit={1.41} tiltDeg={showingShorts ? 2 : 8} shiftPx={narrow ? 0 : 165}
                    activeArea={stageActiveArea}
                    fallbackImage={stageFallback}
                    onZoneSelect={!showingShorts && step === 'jersey' ? selectGarmentZone : null}
                    activeDecoration={!showingShorts && step === 'numbers' && activeDecorationPresent ? activeDecoration : null}
                    onDecorationSelect={!showingShorts && step === 'numbers' ? selectDecoration : null}
                    onDecorationMove={!showingShorts && step === 'numbers' ? moveDecoration : null} />
                </React.Suspense>
              </div>
              {/* floating info card — top left */}
              <div style={{ position: 'absolute', top: narrow ? 10 : 20, left: narrow ? 14 : 24, maxWidth: narrow ? 220 : 300, pointerEvents: 'none' }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: narrow ? 10 : 11, textTransform: 'uppercase', letterSpacing: 1.5, color: C.red }}>Custom Build · {PROGRAM_LABELS[config.program] || "Men's"}</div>
                <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 16 : 20, textTransform: 'uppercase', color: C.navy, margin: '3px 0 9px', lineHeight: 1.06 }}>{(config.teamName || 'Team')} {config.sport ? SPORT_LABELS[config.sport] + ' ' : ''}{showingShorts ? 'Shorts' : 'Jersey'}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {stageColors.map((c, i) => (
                    <span key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c, border: '1px solid rgba(15,23,42,.18)', flexShrink: 0 }} />
                  ))}
                  {!narrow && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginLeft: 2 }}>{stageColors.map(nameForHex).join(' / ')}</span>}
                </div>
                {/* Change Design — re-skins the jersey with a different starting
                    design while keeping the coach's colors, numbers and logos. */}
                <div style={{ position: 'relative', marginTop: 12, pointerEvents: 'auto' }}>
                  <button onClick={() => setChangeOpen((o) => !o)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1,
                    color: changeOpen ? '#fff' : C.navy, background: changeOpen ? C.navy : 'rgba(255,255,255,0.9)',
                    border: '1.5px solid ' + C.navy, borderRadius: 3, padding: '9px 15px', transform: 'skewX(-12deg)',
                    boxShadow: '0 2px 8px rgba(15,23,42,0.14)',
                  }}>
                    <span style={{ transform: 'skewX(12deg)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 13 }}>⇆</span> Change Design
                      <span style={{ fontSize: 9, opacity: 0.8 }}>{changeOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {changeOpen && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 10px)', left: 0, width: 300, maxHeight: '58vh', overflowY: 'auto', background: '#fff', border: '1px solid ' + C.light, borderRadius: 10, boxShadow: '0 18px 50px rgba(15,23,42,.28)', padding: 14, zIndex: 30 }}>
                      <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, marginBottom: 3 }}>Swap the Design</div>
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 12, lineHeight: 1.4 }}>Shown in your colors. Your numbers, name and logos carry over.</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {changeDesigns.map((pz) => {
                          const on = config.designId === pz.id;
                          return (
                            <button key={pz.id} onClick={() => applyDesignPort(pz)} style={{ background: '#fff', border: '1.5px solid ' + (on ? C.navy : C.light), borderRadius: 8, padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'center', boxShadow: on ? '0 2px 8px rgba(25,40,83,0.2)' : 'none' }}>
                              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '760 / 820', background: C.offWhite, overflow: 'hidden' }}>
                                {changeThumbs[pz.id] ? <img src={changeThumbs[pz.id]} alt={pz.name} style={{ width: '92%', height: 'auto' }} /> : <span style={{ fontFamily: F_BODY, fontSize: 11, color: C.textLight }}>…</span>}
                              </span>
                              <span style={{ display: 'block', padding: '7px 4px', borderTop: '1px solid ' + C.light, fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: on ? C.red : C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pz.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* click-away layer closes the Change Design dropdown */}
              {changeOpen && <div onClick={() => setChangeOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'auto' }} />}
              {/* Matching shorts are now a real 3D garment. The large part of
                  this control switches the studio between top and bottom; the
                  compact × removes shorts from the order. */}
              {SHORTS_PREVIEW_ENABLED && (bottom.enabled ? (
                <div style={{ position: 'absolute', left: narrow ? 14 : 22, bottom: narrow ? 10 : 16, display: 'flex', alignItems: 'stretch', pointerEvents: 'auto', background: 'rgba(255,255,255,0.94)', border: '1.5px solid ' + C.navy, borderRadius: 8, boxShadow: '0 1px 6px rgba(15,23,42,.1)', overflow: 'hidden' }}>
                  <button onClick={() => { if (step === 'jersey') setStagePiece(showingShorts ? 'jersey' : 'shorts'); }} title={step === 'jersey' ? (showingShorts ? 'View the jersey' : 'View matching shorts in 3D') : 'Matching shorts included'}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: showingShorts ? 'rgba(25,40,83,.06)' : 'transparent', padding: '6px 11px 6px 6px', cursor: step === 'jersey' ? 'pointer' : 'default' }}>
                    <span style={{ width: narrow ? 38 : 46, height: narrow ? 38 : 46, borderRadius: 6, border: '1px solid ' + C.light, overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {bottomPreview ? <img src={bottomPreview} alt="shorts" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, color: C.textLight }}>…</span>}
                    </span>
                    <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: C.navy, whiteSpace: 'nowrap' }}>
                      {step !== 'jersey' ? 'Matching Shorts Included' : showingShorts ? 'Back to Jersey' : <>View Matching Shorts{bottom.linked ? '' : ' · Custom'}</>}
                    </span>
                  </button>
                  <button onClick={toggleBottomEnabled} title="Remove matching shorts" aria-label="Remove matching shorts"
                    style={{ width: 34, border: 0, borderLeft: '1px solid ' + C.light, background: 'transparent', color: C.red, fontFamily: F_DISP, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>×</button>
                </div>
              ) : (
                <button onClick={toggleBottomEnabled} title="Add matching shorts"
                  style={{ position: 'absolute', left: narrow ? 14 : 22, bottom: narrow ? 10 : 16, pointerEvents: 'auto', background: 'rgba(255,255,255,0.82)', border: '1.5px dashed ' + C.mid, borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 6px rgba(15,23,42,.1)', cursor: 'pointer', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: C.textLight }}>+ Add Matching Shorts</button>
              ))}
              {/* floating viewer controls — bottom right */}
              <div style={{ position: 'absolute', right: narrow ? 14 : 22, bottom: narrow ? 10 : 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                {!narrow && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Drag to rotate · scroll to zoom</span>}
                <button onClick={() => setSpin((v) => !v)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: spin ? '#fff' : C.navy, background: spin ? C.navy : '#fff', border: '1px solid ' + (spin ? C.navy : C.mid), borderRadius: 4, padding: '5px 11px', cursor: 'pointer' }}>{spin ? 'Pause Spin' : 'Auto-Spin'}</button>
              </div>
            </div>

            {/* RIGHT PANEL — stacks under the stage on narrow screens */}
            <div style={narrow
              ? { flex: 1, minHeight: 0, borderTop: '1px solid ' + C.light, padding: '16px 14px 28px', overflowY: 'auto', background: C.offWhite }
              : { width: 384, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '18px 18px 28px', overflowY: 'auto', background: C.offWhite }}>
              {step === 'team' && (
                <div>
                  <RailCard num={1} title="Team Name">
                    <LabeledInput label="" value={config.teamName} onChange={(v) => set({ teamName: v })} maxLength={24} />
                  </RailCard>
                  {/* Team colors — the one palette every later step leads with.
                      Roles (which color goes where) are assigned per-zone on the
                      Jersey step; here the coach just declares the set. */}
                  <RailCard num={2} title="Team Colors" value={`${teamColors.length} color${teamColors.length === 1 ? '' : 's'}`}>
                    <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 14 }}>
                      Your team's colors — offered as quick picks everywhere you design. Add or remove to match your program.
                    </div>
                    <TeamPaletteEditor colors={teamColors} onAdd={addTeamColor} onRemove={removeTeamColor} onReplace={replaceTeamColor} />
                  </RailCard>
                  <RailCard num={3} title="Cut &amp; Style" value={config.neckStyle === 'agi1011' ? 'AGI-1011 Foundation' : config.neckStyle === 'agi1012' ? 'AGI-1012 Foundation' : config.neckStyle === 'crew' ? 'Crew Neck' : 'V-Neck'}>
                    {(config.neckStyle === 'agi1011' || config.neckStyle === 'agi1012') ? (
                      <div style={{ padding: '11px 12px', borderRadius: 6, background: C.light, fontFamily: F_BODY, fontSize: 12, lineHeight: 1.5, color: C.text }}>
                        <strong style={{ display: 'block', fontFamily: F_DISP, fontSize: 12, textTransform: 'uppercase', color: C.navy, marginBottom: 3 }}>{config.designId} Foundation · Production Cut</strong>
                        This approved garment is locked so the 3D view, proof, and finished order always match.
                      </div>
                    ) : (
                      <Pills options={[{ id: 'vneck', label: 'V-Neck' }, { id: 'crew', label: 'Crew Neck' }]}
                        active={config.neckStyle || 'vneck'}
                        onPick={(v) => set({ artistCut: 'foundation', neckStyle: v })} />
                    )}
                  </RailCard>
                  <RailCard num={4} title="Fabric"
                    action={<button onClick={() => setFabricGuide(true)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fabric guide →</button>}>
                    <Pills options={fabricOptions} active={config.fabric || 'sublimated'} onPick={(f) => set({ fabric: f })} />
                    <div style={{ marginTop: 10, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>
                      {(FABRIC_DETAILS.find((f) => f.id === (config.fabric || 'sublimated')) || FABRIC_DETAILS[0]).blurb}
                    </div>
                    {price.fabricAdjustment !== 0 && <div style={{ marginTop: 7, fontFamily: F_DISP, fontWeight: 700, fontSize: 11, color: C.red, textTransform: 'uppercase', letterSpacing: .5 }}>{price.fabricAdjustment > 0 ? '+' : '−'}{formatUniformMoney(Math.abs(price.fabricAdjustment))} per jersey</div>}
                  </RailCard>
                </div>
              )}
              {step === 'jersey' && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ order: 2 }}>
                  <RailCard num={2} title="✨ AI Design Assist">
                    <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2} maxLength={800}
                      placeholder="e.g. Aggressive red and black with camo sleeves, bold block number"
                      style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid ' + C.mid, borderRadius: 6, padding: '9px 10px', fontFamily: F_BODY, fontSize: 13, color: C.text, resize: 'vertical' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <button onClick={runAIDesign} disabled={aiBusy || !aiPrompt.trim()} style={{ ...checkoutBtn(true), width: 'auto', padding: '9px 16px', opacity: (aiBusy || !aiPrompt.trim()) ? 0.6 : 1 }}>{aiBusy ? 'Designing…' : 'Generate'}</button>
                      {aiNote && !aiError && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>{aiNote}</span>}
                    </div>
                    {aiError && <div style={{ marginTop: 8, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 12 }}>{aiError}</div>}
                    {aiCandidates.length > 1 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${aiCandidates.length}, 1fr)`, gap: 8 }}>
                          {aiCandidates.map((cand, i) => (
                            <button key={i} onClick={() => applyAICandidate(cand)} title={cand.rationale}
                              style={{ background: '#fff', border: '1px solid ' + C.mid, borderRadius: 6, padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'center' }}>
                              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '760 / 820', background: '#fff', overflow: 'hidden' }}>
                                {cand.thumb ? <img src={cand.thumb} alt={cand.name} style={{ width: '92%', height: 'auto' }} /> : <span style={{ fontFamily: F_BODY, fontSize: 11, color: C.textLight }}>…</span>}
                              </span>
                              <span style={{ display: 'block', padding: '6px 4px', borderTop: '1px solid ' + C.light, fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cand.name}</span>
                            </button>
                          ))}
                        </div>
                        <button onClick={() => setAiCandidates([])} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: F_BODY, fontSize: 11, color: C.textLight, padding: 0 }}>Dismiss suggestions</button>
                      </div>
                    )}
                  </RailCard>
                  </div>
                  <div style={{ order: 1 }}>
                  <RailCard num={1} title="Sections"
                    action={<button onClick={toggleSleevesLinked}
                      style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 3, padding: '4px 9px', cursor: 'pointer', transform: 'skewX(-12deg)' }}>
                      {sleevesLinked ? 'Split Sleeves' : 'Mirror Sleeves'}
                    </button>}>
                  <SectionEditor
                    sectionDefs={config.neckStyle === 'agi1012'
                      ? (sleevesLinked ? AGI1012_LINKED_SECTIONS : AGI1012_SPLIT_SECTIONS)
                      : config.neckStyle === 'agi1011'
                        ? (sleevesLinked ? AGI1011_LINKED_SECTIONS : AGI1011_SPLIT_SECTIONS)
                      : (sleevesLinked
                        ? [{ key: 'body', label: 'Body' }, { key: 'sleeveL', label: 'Sleeves' }, { key: 'collar', label: 'Collar & Cuffs' }]
                        : SECTIONS)}
                    sections={SX}
                    activeKey={sleevesLinked && designSection === 'sleeveR' ? 'sleeveL' : designSection}
                    onSelect={setDesignSection}
                    onPatch={(patch, sourceKey) => setSection(sourceKey || (sleevesLinked && designSection === 'sleeveR' ? 'sleeveL' : designSection), patch)} printLib={printLib} teamColors={teamColors}
                    layoutLocked={config.neckStyle === 'agi1012' || config.neckStyle === 'agi1011'}
                    layoutLabel={`${config.designId || 'AGI'} approved layout`} />
                  </RailCard>
                  </div>
                  {SHORTS_PREVIEW_ENABLED && <div style={{ order: 3 }}>
                  <RailCard num={3} title="Shorts"
                    action={<label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={bottom.enabled} onChange={toggleBottomEnabled} />
                        <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Include shorts</span>
                      </label>}>
                    {bottom.enabled && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16, padding: '10px 12px', background: C.offWhite, borderRadius: 6 }}>
                          <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.text }}>{bottom.linked ? 'Matching jersey design' : 'Custom shorts design'}</span>
                          <button onClick={bottom.linked ? unlinkBottom : relinkBottom} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy, background: '#fff', border: '1px solid ' + C.mid, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}>
                            {bottom.linked ? 'Customize' : 'Match Jersey'}
                          </button>
                        </div>
                        {!bottom.linked && (
                          <SectionEditor sectionDefs={BOTTOM_SECTIONS} sections={bottomSections} activeKey={designBottomSection} onSelect={setDesignBottomSection}
                            onPatch={(patch) => setBottomSection(designBottomSection, patch)} printLib={printLib} teamColors={teamColors} />
                        )}
                      </>
                    )}
                  </RailCard>
                  </div>}
                </div>
              )}
              {step === 'numbers' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, padding: '10px 12px', borderRadius: 7, background: 'rgba(25,40,83,.055)', border: '1px solid rgba(25,40,83,.14)', color: C.navy, fontFamily: F_BODY, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, boxShadow: '0 0 0 3px rgba(150,44,50,.12)', flexShrink: 0 }} />
                    <span>{activeDecorationPresent
                      ? <><strong>{activeDecorationLabel} selected.</strong> Drag it to reposition, or click another item to select that one.</>
                      : <><strong>Click to select.</strong> The first click never moves artwork; drag it on your next interaction.</>}</span>
                  </div>
                  <RailCard num={1} title="Team Logos"
                    action={<button onClick={() => { setLogoPlacementOpen(true); setLogoSlot(''); }} style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: .65, color: '#fff', background: C.navy, border: '1px solid ' + C.navy, borderRadius: 4, padding: '6px 9px', cursor: 'pointer' }}>+ Add Logo</button>}
                    style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                  {placedLogoSlots.length > 0 && (
                    <div style={{ marginBottom: logoPlacementOpen || logoSlot ? 12 : 0 }}>
                      <div style={{ ...railLabel, marginBottom: 7 }}>{logoCount} Placed</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {placedLogoSlots.map((s) => {
                          const on = s.key === logoSlot;
                          return <button key={s.key} onClick={() => selectDecoration(`logo:${s.key}`)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: .45, color: on ? '#fff' : C.navy, background: on ? C.navy : C.offWhite, border: '1px solid ' + (on ? C.navy : C.mid), borderRadius: 4, padding: '6px 8px', cursor: 'pointer' }}>✓ {s.label}</button>;
                        })}
                      </div>
                    </div>
                  )}
                  {logoPlacementOpen && (
                    <div style={{ marginBottom: 12, padding: 11, background: C.offWhite, border: '1px solid ' + C.light, borderRadius: 7 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                        <span style={{ ...railLabel, margin: 0 }}>Where should it go?</span>
                        <button onClick={() => setLogoPlacementOpen(false)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: C.textLight, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Cancel</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {LOGO_SLOTS.map((s) => {
                          const has = config.logos && config.logos[s.key] && config.logos[s.key].src;
                          return (
                            <button key={s.key} onClick={() => { setLogoSlot(s.key); setActiveDecoration(''); setLogoPlacementOpen(false); }} style={{ textAlign: 'left', fontFamily: F_DISP, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: .35, color: C.navy, background: '#fff', border: '1px solid ' + (has ? C.navy : C.mid), borderRadius: 4, padding: '8px 9px', cursor: 'pointer' }}>
                              {has ? '✓ ' : '+ '}{s.label}{has && <span style={{ display: 'block', marginTop: 1, fontFamily: F_BODY, fontSize: 9.5, fontWeight: 600, textTransform: 'none', color: C.textLight }}>Already placed · select</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {activeLogo.src ? (
                    <div>
                      <div onDragOver={onLogoDragOver} onDragLeave={onLogoDragLeave} onDrop={onLogoDrop}
                        style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 12, background: logoDragOver ? 'rgba(150,44,50,.05)' : C.offWhite, border: '1px solid ' + (logoDragOver ? C.red : C.mid), borderRadius: 8 }}>
                        <div style={{ width: 64, height: 64, padding: 7, borderRadius: 6, boxSizing: 'border-box', background: '#fff', border: '1px solid ' + C.light, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <img src={activeLogo.src} alt="logo" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', transform: `rotate(${activeLogo.rot || 0}deg)`, userSelect: 'none' }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: .6, color: C.navy }}>{slotDef.label} Logo</div>
                          <div style={{ marginTop: 3, fontFamily: F_BODY, fontSize: 12, lineHeight: 1.35, color: C.textLight }}>{logoDragOver ? 'Drop image to replace it.' : 'Drag the logo itself on the large 3D jersey to place it.'}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                        <span style={{ width: 46, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy }}>Height</span>
                        {/* Finished visible height, measured after transparent
                            PNG margins are removed. This is the same physical
                            scale used by jersey names and numbers. */}
                        <input type="range" min="1" max="6" step="0.25" value={Math.round(logoFinishedInches(activeLogo) * 4) / 4} onChange={(e) => setLogo({ scale: parseFloat(e.target.value) / 5.72 })} style={{ flex: 1 }} />
                        <span style={{ width: 58, textAlign: 'right', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, color: C.red }}>{logoFinishedInches(activeLogo).toFixed(2).replace(/0$/, '')}" tall</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                        <span style={{ width: 46, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy }}>Rotate</span>
                        <input type="range" min="-180" max="180" step="1" value={activeLogo.rot || 0} onChange={(e) => setLogo({ rot: parseInt(e.target.value, 10) })} style={{ flex: 1 }} />
                        <button onClick={() => setLogo({ rot: 0 })} title="Reset rotation" style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, color: C.textLight, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}>0°</button>
                      </div>
                      {activeLogo.srcCut && (
                        <button onClick={() => {
                          const useCut = !activeLogo.bgRemoved;
                          setLogo({
                            bgRemoved: useCut,
                            src: useCut ? activeLogo.srcCut : activeLogo.srcFull,
                            aspect: useCut ? (activeLogo.cutAspect || activeLogo.aspect) : (activeLogo.fullAspect || activeLogo.aspect),
                            pixelWidth: useCut ? (activeLogo.cutPixelWidth || activeLogo.pixelWidth) : (activeLogo.fullPixelWidth || activeLogo.pixelWidth),
                            pixelHeight: useCut ? (activeLogo.cutPixelHeight || activeLogo.pixelHeight) : (activeLogo.fullPixelHeight || activeLogo.pixelHeight),
                          });
                        }}
                          style={{ marginTop: 10, fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: activeLogo.bgRemoved ? C.green : C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>
                          {activeLogo.bgRemoved ? '✓ Background removed · undo' : 'Remove background'}
                        </button>
                      )}
                      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
                        <button onClick={() => setArtPickerOpen(true)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Existing Art</button>
                        <label style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy, cursor: 'pointer' }}>
                          Upload New<input type="file" accept="image/*" onChange={onLogoFile} style={{ display: 'none' }} />
                        </label>
                        <button onClick={removeActiveLogo} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
                      </div>
                      <div style={{ marginTop: 10, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Placement updates the 3D jersey and production proof together.</div>
                      {logoDpi(activeLogo) != null && <div style={{ marginTop: 5, fontFamily: F_BODY, fontSize: 11.5, fontWeight: 700, color: logoDpi(activeLogo) >= 150 ? C.green : C.red }}>{logoDpi(activeLogo) >= 150 ? `✓ Print ready · ${logoDpi(activeLogo)} DPI at finished size` : `Low resolution · ${logoDpi(activeLogo)} DPI at finished size (150+ recommended)`}</div>}
                    </div>
                  ) : logoSlot ? (
                    <div onDragOver={onLogoDragOver} onDragLeave={onLogoDragLeave} onDrop={onLogoDrop}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', minHeight: 118, border: '2px dashed ' + (logoDragOver ? C.red : C.mid), background: logoDragOver ? 'rgba(150,44,50,0.05)' : 'transparent', borderRadius: 8, color: logoDragOver ? C.red : C.textLight, fontFamily: F_BODY, fontSize: 13, textAlign: 'center', padding: 14, boxSizing: 'border-box' }}>
                      <span style={{ fontSize: 24 }}>⬆︎</span>
                      <span>{logoDragOver ? 'Drop your image here' : <>Choose saved team art or upload a new image for the {slotDef.label}.</>}</span>
                      {!logoDragOver && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button onClick={() => setArtPickerOpen(true)} style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: .6, color: '#fff', background: C.navy, border: '1px solid ' + C.navy, borderRadius: 4, padding: '8px 11px', cursor: 'pointer' }}>Choose Existing Art</button>
                        <label style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: .6, color: C.navy, background: '#fff', border: '1px solid ' + C.mid, borderRadius: 4, padding: '8px 11px', cursor: 'pointer' }}>
                          Upload New<input ref={logoInputRef} type="file" accept="image/*" onChange={onLogoFile} style={{ display: 'none' }} />
                        </label>
                      </div>}
                    </div>
                  ) : !logoPlacementOpen && (
                    <div style={{ padding: '12px 10px', textAlign: 'center', fontFamily: F_BODY, fontSize: 12.5, lineHeight: 1.4, color: C.textLight, background: C.offWhite, border: '1px dashed ' + C.mid, borderRadius: 7 }}>
                      {logoCount ? 'Select a placed logo to edit it, or add another logo.' : 'No logos added. Choose Add Logo to select a placement.'}
                    </div>
                  )}
                  </RailCard>
                  <RailCard num={2} title="Numbers" value={config.playerNumber ? `No. ${config.playerNumber}` : 'Add Number'} style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                    <LabeledInput label="Player Number" value={config.playerNumber} onChange={(v) => set({ playerNumber: v.replace(/[^0-9]/g, '').slice(0, 2) })} maxLength={2} />
                    <div style={{ ...railLabel, margin: '13px 0 8px' }}>Front Placement</div>
                    <Pills options={[{ id: 'right', label: 'Right Chest' }, { id: 'left', label: 'Left Chest' }, { id: 'center', label: 'Center' }, { id: 'none', label: 'None' }]}
                      active={config.frontNumber || 'right'} onPick={(v) => { set({ frontNumber: v, frontNumberX: v === 'center' ? 0.5 : null, frontNumberY: null }); setActiveDecoration(''); }} />
                  </RailCard>
                  <RailCard num={3} title="Player Name" value={config.includePlayerName ? 'Added' : 'Optional'} style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                    {!config.includePlayerName ? (
                      <div>
                        <div style={{ fontFamily: F_BODY, fontSize: 12, lineHeight: 1.4, color: C.textLight, marginBottom: 10 }}>Most teams order numbers only. Add names only when this roster needs them.</div>
                        <button onClick={() => { set({ includePlayerName: true }); setActiveDecoration(''); }} style={{ width: '100%', fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: .7, color: C.navy, background: '#fff', border: '1px solid ' + C.navy, borderRadius: 4, padding: '9px 10px', cursor: 'pointer' }}>+ Add Player Names</button>
                      </div>
                    ) : (
                      <div>
                        <LabeledInput label="Sample Back Name" value={config.playerName} onChange={(v) => set({ playerName: v })} maxLength={14} />
                        <div style={{ ...railLabel, margin: '12px 0 7px' }}>Name Style</div>
                        <Pills options={[{ id: 'arched', label: 'Arched' }, { id: 'straight', label: 'Straight' }]} active={config.nameArch || 'arched'} onPick={(v) => set({ nameArch: v })} />
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '12px 0 5px' }}>
                          <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Letter Spacing</span>
                          <span style={groupVal}>{Number.isFinite(config.nameSpacing) ? config.nameSpacing : 8}%</span>
                        </div>
                        <input type="range" min={0} max={30} step={1} value={Number.isFinite(config.nameSpacing) ? config.nameSpacing : 8} onChange={(e) => set({ nameSpacing: parseInt(e.target.value, 10) })} style={{ width: '100%', accentColor: C.navy }} />
                        <div style={{ ...railLabel, margin: '12px 0 7px' }}>Finished Height</div>
                        <Pills options={INCH_OPTIONS} active={String(Number.isFinite(config.nameInches) ? config.nameInches : 2)} onPick={(v) => set({ nameInches: parseInt(v, 10) })} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 12 }}>
                          <button onClick={() => { set({ includePlayerName: false, playerName: '' }); if (activeDecoration === 'backName') setActiveDecoration(''); }} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: .6, color: C.red, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Remove</button>
                        </div>
                      </div>
                    )}
                  </RailCard>
                  <RailCard num={4} title="Number Color" value={nameForHex(config.numberColor)} style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                    <QuickColors teamColors={teamColors} size={38} hex={config.numberColor} onPick={(h) => set({ numberColor: h })} />
                  </RailCard>
                  {config.font !== 'outline' && (
                    <RailCard num={5} title="Outline" value={(config.outlineColor || 'auto') === 'none' ? 'None' : `${(config.outlineWeight || 'thin').replace(/^./, (m) => m.toUpperCase())} · ${(config.outlineColor || 'auto') === 'auto' ? 'Auto' : nameForHex(config.outlineColor)}`} style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                      <div style={{ marginBottom: 10 }}>
                        <Pills options={[{ id: 'auto', label: 'Auto' }, { id: 'none', label: 'None' }]} active={(config.outlineColor || 'auto')} onPick={(v) => set({ outlineColor: v })} />
                      </div>
                      {(config.outlineColor || 'auto') !== 'none' && (
                        <>
                          <div style={{ ...railLabel, marginBottom: 8 }}>Weight</div>
                          <div style={{ marginBottom: 12 }}>
                            <Pills options={OUTLINE_WEIGHT_OPTIONS} active={config.outlineWeight || 'thin'} onPick={(v) => set({ outlineWeight: v })} />
                          </div>
                        </>
                      )}
                      {(config.outlineColor || 'auto') !== 'none' && <QuickColors teamColors={teamColors} size={26} hex={config.outlineColor || ''} onPick={(h) => set({ outlineColor: h })} />}
                      {/* second outline — the pro "double border" look; needs a first outline to ring */}
                      {(config.outlineColor || 'auto') !== 'none' && (
                        <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px dashed ' + C.light }}>
                          {(config.outline2Color || 'none') === 'none' ? (
                            <button onClick={() => {
                              const first = (config.outlineColor || 'auto') === 'auto' ? ds.contrastInk(config.numberColor) : config.outlineColor;
                              const next = teamColors.map((c) => c.hex).find((hex) => hex.toUpperCase() !== String(config.numberColor).toUpperCase() && hex.toUpperCase() !== String(first).toUpperCase()) || '#FFFFFF';
                              set({ outline2Color: next });
                            }} style={{ width: '100%', fontFamily: F_DISP, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: .7, color: C.navy, background: '#fff', border: '1px solid ' + C.mid, borderRadius: 4, padding: '8px 10px', cursor: 'pointer' }}>+ Add Second Outline</button>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Second Outline</span>
                                <button onClick={() => set({ outline2Color: 'none' })} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: C.red, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Remove</button>
                              </div>
                              <QuickColors teamColors={teamColors} size={26} hex={config.outline2Color || ''} onPick={(h) => set({ outline2Color: h })} />
                            </>
                          )}
                        </div>
                      )}
                    </RailCard>
                  )}
                  <RailCard num={config.font !== 'outline' ? 6 : 5} title="Number Size · Inches" value="Finished Height" style={{ padding: '12px 14px 14px', marginBottom: 9 }}>
                    <div style={{ ...railLabel, marginBottom: 8 }}>Front Number</div>
                    <Pills options={INCH_OPTIONS} active={String(Number.isFinite(config.frontNumberInches) ? config.frontNumberInches : 4)} onPick={(v) => set({ frontNumberInches: parseInt(v, 10) })} />
                    <div style={{ ...railLabel, margin: '15px 0 8px' }}>Back Number</div>
                    <Pills options={INCH_OPTIONS} active={String(Number.isFinite(config.backNumberInches) ? config.backNumberInches : (config.program === 'mens' ? 8 : 6))} onPick={(v) => set({ backNumberInches: parseInt(v, 10) })} />
                    <div style={{ marginTop: 11, fontFamily: F_BODY, fontSize: 11, lineHeight: 1.4, color: C.textLight }}>Front defaults to 4″. Back defaults to {config.program === 'mens' ? '8\u2033 for men' : '6\u2033 for women and youth'}.</div>
                  </RailCard>
                  <RailCard num={config.font !== 'outline' ? 7 : 6} title="Number Style" style={{ padding: '12px 14px 14px', marginBottom: 0 }}>
                    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', paddingLeft: 4 }}>
                      {FONTS.map((f) => {
                        const on = f.id === config.font;
                        return (
                          <button key={f.id} onClick={() => set({ font: f.id })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 14px', borderRadius: 2, transform: 'skewX(-12deg)', background: on ? C.navy : '#fff', border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer', boxShadow: on ? '0 2px 6px rgba(25,40,83,0.25)' : 'none' }}>
                            <span style={{ fontFamily: fontStack(f.font), fontWeight: 700, fontSize: 21, lineHeight: 1, color: on ? '#fff' : C.navy, WebkitTextStroke: f.hollow ? ('1px ' + (on ? '#fff' : C.navy)) : undefined, WebkitTextFillColor: f.hollow ? 'transparent' : undefined }}>15</span>
                            <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, color: on ? '#fff' : C.navy }}>{f.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </RailCard>
                </div>
              )}
            </div>
          </>
        )}

        {/* ROSTER VIEW */}
        {step === 'roster' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: narrow ? '20px 14px 32px' : '28px 40px', background: C.offWhite, overflow: 'auto' }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Step 4 · Roster &amp; Sizes</div>
              <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 28, textTransform: 'uppercase', color: C.navy, margin: '2px 0 4px' }}>Build Your Team Roster</h2>
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight }}>Pick a size, then click the numbers to assign them — the fastest way to build a full team order.</div>
            </div>
            {/* size selector */}
            <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 6, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, marginRight: 4 }}>Size</span>
                {SIZES.map((sz) => {
                  const on = sz === selectedSize; const qty = (assignments[sz] || []).length;
                  return (
                    <button key={sz} onClick={() => setSelectedSize(sz)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 64, padding: '8px 10px', borderRadius: 4, background: on ? C.navy : '#fff', border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer' }}>
                      <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 14, color: on ? '#fff' : C.navy }}>{sz}</span>
                      <span style={{ fontFamily: F_BODY, fontSize: 12, fontWeight: 700, color: qty > 0 ? (on ? '#fff' : C.red) : C.textLight }}>{qty}</span>
                    </button>
                  );
                })}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, marginLeft: 6, paddingLeft: 16, borderLeft: '1px solid ' + C.light }}>
                  <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: C.navy }}>Total</span>
                  <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 17, color: C.red }}>{totalQty}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 13, paddingTop: 12, borderTop: '1px solid ' + C.light }}>
                <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.text }}>Selected: <strong style={{ color: C.navy, fontFamily: F_DISP, letterSpacing: 0.5 }}>{SIZE_LABELS[selectedSize]}</strong></div>
                {(assignments[selectedSize] || []).length > 0 && (
                  <button onClick={clearSize} style={{ background: 'none', border: 'none', color: C.red, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, cursor: 'pointer', padding: 0 }}>Clear {selectedSize}</button>
                )}
              </div>
            </div>
            {/* number grid */}
            <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 6, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: C.navy }}>Player Numbers <span style={{ fontWeight: 600, fontSize: 12, color: C.textLight, textTransform: 'none', letterSpacing: 0 }}>— click to assign to {SIZE_LABELS[selectedSize]}</span></div>
                <button onClick={downloadRoster} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: C.navy, background: '#fff', border: '1px solid ' + C.mid, borderRadius: 4, padding: '9px 14px', cursor: 'pointer' }}>⬇︎ Roster CSV</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 6 }}>
                {[...Array(100).keys()].map((i) => String(i)).concat(['00']).map((num) => {
                  const owner = numberOwner(num); const mine = owner === selectedSize; const taken = owner && !mine;
                  return (
                    <button key={num} onClick={() => toggleNumber(num)} style={{ position: 'relative', height: 42, border: '1px solid ' + (mine ? C.navy : C.light), borderRadius: 4, background: mine ? C.navy : taken ? C.offWhite : '#fff', color: mine ? '#fff' : taken ? C.textLight : C.navy, fontFamily: F_DISP, fontWeight: mine ? 800 : 600, fontSize: 16, cursor: 'pointer', padding: 0 }}>
                      {num}{taken && <span style={{ position: 'absolute', bottom: 2, right: 4, fontFamily: F_DISP, fontWeight: 700, fontSize: 8, color: C.red }}>{owner}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Player-name entry exists only when the coach explicitly adds names. */}
            {totalQty > 0 && config.includePlayerName && (
              <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 6, padding: '16px 20px', marginTop: 16 }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, marginBottom: 4 }}>Assigned Players</div>
                <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 14 }}>Add a name per number, then click the number badge to preview that player's real back proof.</div>
                {rosterPreview && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 16, padding: '12px 14px', borderRadius: 7, background: C.offWhite, border: '1px solid ' + C.light }}>
                    <div style={{ width: 118, height: 138, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: '#fff', border: '1px solid ' + C.light, overflow: 'hidden' }}>
                      {rosterPreviewImage
                        ? <img src={rosterPreviewImage} alt={`Player ${rosterPreview} proof`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Rendering…</span>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.1, color: C.red }}>Live player proof</div>
                      <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 24, textTransform: 'uppercase', lineHeight: 1.05, color: C.navy, marginTop: 3 }}>{(playerNames[rosterPreview] || 'Player').toUpperCase()} · #{rosterPreview}</div>
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginTop: 5 }}>{SIZE_LABELS[numberOwner(rosterPreview)] || numberOwner(rosterPreview)} · production back view</div>
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {SIZES.flatMap((sz) => (assignments[sz] || []).map((num) => ({ num, sz })))
                    .sort((a, b) => Number(a.num) - Number(b.num))
                    .map(({ num, sz }) => (
                      <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => setRosterPreview(num)} title={`Preview player ${num}`} style={{ flexShrink: 0, minWidth: 58, textAlign: 'center', fontFamily: F_DISP, fontWeight: 800, fontSize: 13, color: rosterPreview === num ? '#fff' : C.navy, background: rosterPreview === num ? C.navy : C.offWhite, border: '1px solid ' + (rosterPreview === num ? C.navy : C.light), borderRadius: 4, padding: '7px 5px', cursor: 'pointer' }}>#{num} <span style={{ fontWeight: 600, color: rosterPreview === num ? 'rgba(255,255,255,.76)' : C.textLight }}>{sz}</span></button>
                        <input value={playerNames[num] || ''} onChange={(e) => setPlayerName(num, e.target.value)} placeholder="Player name" maxLength={30}
                          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid ' + C.mid, borderRadius: 4, padding: '7px 9px', fontFamily: F_BODY, fontSize: 13, color: C.text }} />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FINALIZE VIEW */}
        {step === 'finalize' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0, overflow: 'auto', background: '#fff' }}>
            <div style={{ flex: narrow ? '0 0 auto' : 1, minWidth: 0, padding: narrow ? '22px 16px' : '34px 40px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Design Complete</div>
              <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: C.navy, lineHeight: 1, margin: '2px 0 0' }}>{(config.teamName || 'Team').toUpperCase()}</h2>
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, margin: '6px 0 24px' }}>{(config.teamName || 'Team')} Home Jersey{bottom.enabled ? ' + Shorts' : ''}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 640 }}>
                {['front', 'back'].map((v) => (
                  <div key={v} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: '100%', aspectRatio: bottom.enabled ? '4/5' : '1/1', background: C.offWhite, border: '1px solid ' + C.light, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 8, boxSizing: 'border-box' }}>
                      <div style={{ flex: bottom.enabled ? '0 1 62%' : '1 1 100%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <React.Suspense fallback={<span style={{ color: C.textLight, fontSize: 13 }}>Rendering…</span>}>
                          <Viewer3D key={`${v}-${modelGarmentFor(config)}`} spec={jerseyModelSpec} modelUrl={modelTpl.model3d} view={v} interactive={false} autoRotate={false} fit={1.34} tiltDeg={0} shiftPx={0}
                            fallbackImage={stageFallback}
                            onSnapshot={(shot) => acceptReviewSnapshot(v, shot)} />
                        </React.Suspense>
                      </div>
                      {bottom.enabled && (
                        <div style={{ flex: '0 1 34%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px dashed ' + C.light, paddingTop: 6, marginTop: 4 }}>
                          {bottomReview[v] ? <img src={bottomReview[v]} alt={v + '-shorts'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ color: C.textLight, fontSize: 12 }}>Rendering…</span>}
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, color: C.textLight }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* summary */}
            <div style={narrow
              ? { flexShrink: 0, borderTop: '1px solid ' + C.light, padding: '24px 16px 40px', display: 'flex', flexDirection: 'column', background: C.offWhite }
              : { width: 430, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '32px 32px 40px', display: 'flex', flexDirection: 'column', background: C.offWhite, overflowY: 'auto' }}>
              <h3 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: C.navy, margin: '0 0 6px' }}>You've Finished Designing</h3>
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 20 }}>Download your design or continue to place your team order. Your rep confirms every order within 24 hours.</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
                <button onClick={() => setStep('team')} style={{ flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: C.navy, background: '#fff', border: '1px solid ' + C.navy, borderRadius: 4, padding: '13px 10px', cursor: 'pointer' }}>Change Design</button>
              </div>
              <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid ' + C.light, borderRadius: 6, marginBottom: 14 }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, marginBottom: 4 }}>Send to Production</div>
                <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 10 }}>Everything your sublimation shop needs — renders, exact hex colors, lettering, and the roster.</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={downloadProofPDF} disabled={!!busy} style={{ ...prodBtn, opacity: busy ? 0.6 : 1 }}>⬇︎ Production PDF</button>
                  <button onClick={downloadProofPNG} disabled={!!busy} style={{ ...prodBtn, opacity: busy ? 0.6 : 1 }}>⬇︎ Production PNG</button>
                </div>
                {busy && <div style={{ marginTop: 8, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>{busy}</div>}
                {!busy && (!review.front || !review.back) && <div style={{ marginTop: 8, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Live 3D views are still rendering; exports use the exact production art until they are ready.</div>}
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
                <button onClick={saveDesign} style={ghostBtn}>Save Design</button>
                <button onClick={downloadRoster} style={ghostBtn}>Roster CSV</button>
              </div>
              <div style={sectionHead}>Production Readiness</div>
              <div style={{ marginBottom: 24 }}>
                {productionChecks.map((check) => (
                  <div key={check.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 0', borderBottom: '1px solid ' + C.light }}>
                    <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: check.ok ? 'rgba(31,122,61,.1)' : 'rgba(150,44,50,.1)', color: check.ok ? C.green : C.red, fontSize: 11, fontWeight: 900 }}>{check.ok ? '✓' : '!'}</span>
                    <span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontFamily: F_DISP, fontSize: 12, textTransform: 'uppercase', letterSpacing: .45, color: C.navy }}>{check.label}</strong><span style={{ display: 'block', marginTop: 1, fontFamily: F_BODY, fontSize: 11.5, lineHeight: 1.35, color: check.ok ? C.textLight : C.red }}>{check.detail}</span></span>
                  </div>
                ))}
              </div>
              <div style={sectionHead}>Construction Materials</div>
              {[
                ...SECTIONS.map((s) => ({ label: s.label, value: zoneRowValue(SX[s.key]), sw: SX[s.key].color })),
                ...(bottom.enabled ? BOTTOM_SECTIONS.map((s) => ({ label: `Shorts — ${s.label}`, value: zoneRowValue(bottomSections[s.key]), sw: bottomSections[s.key].color })) : []),
                { label: 'Number Fill', value: nameForHex(config.numberColor), sw: config.numberColor },
                { label: config.includePlayerName ? 'Number & Name Font' : 'Number Font', value: (FONTS.find((f) => f.id === config.font) || {}).label || 'Block' },
                { label: 'Logos', value: (LOGO_SLOTS.filter((s) => config.logos && config.logos[s.key] && config.logos[s.key].src).map((s) => s.label).join(', ')) || 'None' },
                { label: 'Fabric', value: (FABRIC_DETAILS.find((f) => f.id === (config.fabric || 'sublimated')) || FABRIC_DETAILS[0]).label },
              ].map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid ' + C.light }}>
                  <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy }}>{r.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F_BODY, fontSize: 13, color: C.text, fontWeight: 600 }}>
                    {r.sw && <span style={{ width: 15, height: 15, borderRadius: 3, background: r.sw, border: '1px solid ' + C.mid }} />}{r.value}
                  </span>
                </div>
              ))}
              <div style={{ ...sectionHead, marginTop: 26 }}>Roster &amp; Sizes</div>
              {rosterBreakdown.length ? rosterBreakdown.map((r) => (
                <div key={r.size} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: '1px solid ' + C.light }}>
                  <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy }}>{r.label} <span style={{ color: C.textLight }}>×{r.qty}</span></span>
                  <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, textAlign: 'right' }}>{r.numsDisplay || r.nums}</span>
                </div>
              )) : <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight, padding: '9px 0' }}>No sizes assigned yet — add them in the Roster step.</div>}
              <div style={{ marginTop: 18, paddingTop: 15, borderTop: '2px solid ' + C.navy }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: price.hasDiscount ? 7 : 0 }}>
                  <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textLight }}>Public price · {totalQty} jersey{totalQty === 1 ? '' : 's'}</div>
                  <div style={{ fontFamily: F_BODY, fontWeight: 700, fontSize: 13, color: price.hasDiscount ? C.textLight : C.navy, textDecoration: price.hasDiscount ? 'line-through' : 'none' }}>{formatUniformMoney(price.publicTotal)}</div>
                </div>
                {price.fabricAdjustment !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 5, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}><span>Fabric adjustment</span><span>{price.fabricAdjustment > 0 ? '+' : '−'}{formatUniformMoney(Math.abs(price.fabricAdjustment * totalQty))}</span></div>}
                {price.decorationAdjustment !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 5, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}><span>Decoration adjustment</span><span>{price.decorationAdjustment > 0 ? '+' : '−'}{formatUniformMoney(Math.abs(price.decorationAdjustment * totalQty))}</span></div>}
                {price.hasDiscount && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 5, fontFamily: F_BODY, fontWeight: 700, fontSize: 12, color: C.green }}><span>Coach discount ({price.discountPercent}%)</span><span>−{formatUniformMoney(price.savingsTotal)}</span></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, marginTop: price.hasDiscount ? 11 : 8 }}>
                  <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: .6, color: C.navy }}>{price.hasDiscount ? 'Coach total' : 'Order total'} · {formatUniformMoney(price.coachUnit)} ea</div>
                  <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 26, color: C.navy }}>{formatUniformMoney(price.coachTotal)}</div>
                </div>
              </div>
              {savedMsg && <div style={{ marginTop: 18, padding: '14px 16px', background: '#fff', borderLeft: '3px solid ' + C.navy, fontFamily: F_BODY, fontSize: 13, color: C.text }}>Design saved.</div>}

              {/* Complete the order — pick a fulfillment path once contact info is filled in. */}
              <div style={{ marginTop: 22, padding: '18px 18px 20px', background: '#fff', border: '2px solid ' + C.navy, borderRadius: 8 }}>
                <div style={{ ...sectionHead, border: 'none', paddingBottom: 0, marginBottom: 14 }}>Complete Your Order</div>
                {orderDone ? (
                  <div style={{ padding: '14px 16px', background: C.offWhite, borderLeft: '3px solid ' + C.green, fontFamily: F_BODY, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                    <strong style={{ display: 'block', fontFamily: F_DISP, fontSize: 17, textTransform: 'uppercase', color: C.navy, marginBottom: 3 }}>Order {orderDone.order && orderDone.order.order_number} Confirmed</strong>
                    {orderDone.fulfillment === 'card' && orderDone.order?.payment_status === 'paid' && 'Payment received — thank you! Your rep will confirm production details within 24 hours.'}
                    {orderDone.fulfillment === 'card' && orderDone.order?.payment_status !== 'paid' && 'Bank payment submitted and processing. Your order is saved, and your rep will confirm production details within 24 hours.'}
                    {orderDone.fulfillment === 'po' && "PO submitted — we'll invoice your school per the PO terms. Your rep will follow up within 24 hours."}
                    {orderDone.fulfillment === 'manual' && "Order received — your rep will follow up within 24 hours to confirm payment and production."}
                    <button onClick={showOrderStatus} style={{ ...prodBtn, display: 'block', width: '100%', marginTop: 12 }}>View Order Status</button>
                    <span style={{ display: 'block', marginTop: 8, fontSize: 11.5, color: C.textLight }}>A private status link was also emailed to {contactEmail}.</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                      <LabeledInput label="Your Name" value={contactName} onChange={setContactName} maxLength={60} />
                      <LabeledInput label="Email" value={contactEmail} onChange={setContactEmail} maxLength={80} />
                    </div>
                    {!contactValid && <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 12 }}>Enter your name and a valid email to complete the order.</div>}
                    {contactValid && totalQty < 1 && <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.red, marginBottom: 12 }}>Add at least one player and size in the Roster step before submitting.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button onClick={() => setShowStripeModal(true)} disabled={!orderReady || orderBusy} style={{ ...checkoutBtn(true), opacity: (!orderReady || orderBusy) ? 0.5 : 1 }}>💳 Pay by Card Now</button>
                      <button onClick={() => setPoOpen((v) => !v)} disabled={!orderReady || orderBusy} style={{ ...checkoutBtn(false), opacity: (!orderReady || orderBusy) ? 0.5 : 1 }}>🏫 School Purchase Order</button>
                      {poOpen && (
                        <div style={{ padding: '12px 14px', background: C.offWhite, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <LabeledInput label="PO Number" value={poNumber} onChange={setPoNumber} maxLength={40} />
                          <LabeledInput label="Billing Contact (optional)" value={poContact} onChange={setPoContact} maxLength={80} />
                          <button onClick={submitPO} disabled={orderBusy} style={{ ...prodBtn, opacity: orderBusy ? 0.6 : 1 }}>{orderBusy ? 'Submitting…' : 'Submit PO Order'}</button>
                        </div>
                      )}
                      <button onClick={() => submitOrder('manual')} disabled={!orderReady || orderBusy} style={{ ...checkoutBtn(false), opacity: (!orderReady || orderBusy) ? 0.5 : 1 }}>{orderBusy ? 'Submitting…' : '📋 Add to Order Queue'}</button>
                    </div>
                    <div style={{ fontFamily: F_BODY, fontSize: 11, color: C.textLight, marginTop: 10, lineHeight: 1.5 }}>Card charges now. PO and Order Queue require no payment today — your rep confirms details and invoices per your terms.</div>
                    {orderError && <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 12 }}>{orderError}</div>}
                  </>
                )}
              </div>
              {showStripeModal && (
                <StripePaymentModal
                  invoices={[{ id: 'uniform-' + orderClientRef.current, total: price.coachTotal, paid: 0 }]}
                  customerName={contactName || config.teamName || 'Team'}
                  customerEmail={contactEmail}
                  paymentNote={`${config.teamName || 'Team'} uniform order — ${totalQty} jersey${totalQty === 1 ? '' : 's'}${bottom.enabled ? ' + shorts' : ''}.`}
                  createIntent={prepareStripeIntent}
                  onClose={() => setShowStripeModal(false)}
                  onSuccess={onStripeSuccess}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* TEAM ART PICKER — real saved artwork from the coach portal/order. */}
      {artPickerOpen && (
        <div onClick={() => setArtPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'rgba(15,23,42,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '82vh', overflowY: 'auto', background: '#fff', borderRadius: 10, padding: '22px 24px 24px', boxShadow: '0 20px 64px rgba(15,23,42,.38)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
              <h3 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 21, textTransform: 'uppercase', letterSpacing: .5, color: C.navy, margin: 0 }}>Choose Existing Team Art</h3>
              <button onClick={() => setArtPickerOpen(false)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: C.textLight, background: 'none', border: 'none', cursor: 'pointer' }}>✕ Close</button>
            </div>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight, marginBottom: 16 }}>Select artwork to place on the {slotDef.label.toLowerCase()}. You can resize and move it immediately afterward.</div>
            {savedArtwork.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {savedArtwork.map((art) => (
                  <button key={art.id + art.src} onClick={() => placeExistingArtwork(art)} style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'stretch', textAlign: 'left', background: '#fff', border: '1px solid ' + C.mid, borderRadius: 7, padding: 10, cursor: 'pointer' }}>
                    <span style={{ height: 112, borderRadius: 5, background: C.offWhite, border: '1px solid ' + C.light, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8, boxSizing: 'border-box' }}>
                      <img src={art.src} alt={art.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    </span>
                    <span style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 12, lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: .45, color: C.navy }}>{art.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: '28px 18px', textAlign: 'center', background: C.offWhite, border: '1px dashed ' + C.mid, borderRadius: 8 }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', color: C.navy }}>No saved team art yet</div>
                <div style={{ marginTop: 5, fontFamily: F_BODY, fontSize: 12.5, color: C.textLight }}>Close this window and choose Upload New to add the first logo.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FABRIC GUIDE — swatch close-ups + plain-language copy per fabric */}
      {fabricGuide && (
        <div onClick={() => setFabricGuide(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 920, width: '100%', maxHeight: '86vh', overflowY: 'auto', padding: '26px 28px', boxShadow: '0 18px 60px rgba(15,23,42,.35)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <h3 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: C.navy, margin: 0 }}>Fabric Guide</h3>
              <button onClick={() => setFabricGuide(false)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 13, color: C.textLight, background: 'none', border: 'none', cursor: 'pointer' }}>✕ Close</button>
            </div>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight, marginBottom: 18 }}>All fabrics are performance polyester, printed edge-to-edge with your design. The choice is about surface and feel.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {FABRIC_DETAILS.map((f) => {
                const on = (config.fabric || 'sublimated') === f.id;
                return (
                  <div key={f.id} style={{ border: '1.5px solid ' + (on ? C.navy : C.light), borderRadius: 8, overflow: 'hidden' }}>
                    <img src={fabricSwatchDataURL(f.id)} alt={f.label} style={{ display: 'block', width: '100%', height: 120, objectFit: 'cover' }} />
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy }}>{f.label}</div>
                        {on && <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: C.red }}>Selected</div>}
                      </div>
                      <div style={{ fontFamily: F_BODY, fontSize: 12.5, color: C.text, margin: '6px 0 10px', lineHeight: 1.45 }}>{f.detail}</div>
                      <button onClick={() => { set({ fabric: f.id }); setFabricGuide(false); }}
                        style={{ width: '100%', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: on ? '#fff' : C.navy, background: on ? C.navy : '#fff', border: '1px solid ' + (on ? C.navy : C.mid), borderRadius: 4, padding: '9px 0', cursor: 'pointer' }}>
                        {on ? 'Selected' : 'Choose ' + f.label}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM BAR */}
      <div style={{ height: narrow ? 62 : 72, flexShrink: 0, borderTop: '1px solid ' + C.light, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: narrow ? '0 14px' : '0 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {[SX.body.color, SX.sleeveL.color, SX.body.color2].map((c, i) => <span key={i} style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid ' + C.light }} />)}
          </div>
          {!narrow && <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.text }}>{(config.teamName || 'TEAM').toUpperCase()} · No. {config.playerNumber || '—'}</div>}
        </div>
        <div data-testid="uniform-live-price" style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'center', lineHeight: 1.12 }}>
          <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 13 : 15, textTransform: 'uppercase', letterSpacing: .55, color: C.navy }}>{price.hasDiscount ? 'Coach price ' : 'Public price '}{formatUniformMoney(price.coachUnit)} / jersey</div>
          {!narrow && <div style={{ marginTop: 4, fontFamily: F_BODY, fontSize: 11.5, color: price.hasDiscount ? C.green : C.textLight }}>{price.hasDiscount ? <><span style={{ color: C.textLight, textDecoration: 'line-through' }}>{formatUniformMoney(price.publicUnit)} public</span> · {price.discountPercent}% account savings · </> : null}{totalQty} jersey{totalQty === 1 ? '' : 's'} · {formatUniformMoney(price.coachTotal)} total</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={goPrev} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '11px 18px', cursor: 'pointer' }}>{stepIdx === 0 ? 'Designs' : 'Back'}</button>
          {step !== 'finalize' && <button onClick={goNext} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: '#fff', background: C.red, border: 'none', borderRadius: 4, padding: '12px 26px', cursor: 'pointer' }}>{nextLabel}</button>}
        </div>
      </div>
      </>)}
    </div>
  );
}

const loadStyle = { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textLight, fontFamily: F_BODY };
const ghostBtn = { flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: C.textLight, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '10px 8px', cursor: 'pointer' };
const prodBtn = { flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: '#fff', background: C.navy, border: '1px solid ' + C.navy, borderRadius: 4, padding: '11px 8px', cursor: 'pointer' };
const sectionHead = { fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, borderBottom: '2px solid ' + C.navy, paddingBottom: 8, marginBottom: 2 };
const checkoutBtn = (primary) => ({ width: '100%', textAlign: 'left', fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: primary ? '#fff' : C.navy, background: primary ? C.red : '#fff', border: '1.5px solid ' + (primary ? C.red : C.mid), borderRadius: 6, padding: '13px 14px', cursor: 'pointer' });
