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
import { SETTINGS_DEFAULTS, loadBuilderSettings } from './builderSettings';
import { FABRIC_DETAILS, fabricSwatchDataURL } from './fabricInfo';
import { renderToDataURL, renderProductionPDF, renderProductionSheet } from './renderCanvas';
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
  { key: 'stripe', label: 'Side Stripe' },
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
    return { legs: from(S.body), waistband: from(S.collar), stripe: from(S.sleeveL) };
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
    meta: { teamName: cfg.teamName },
  });
}

let FONTS = SETTINGS_DEFAULTS.numberStyles;
// Logo slots — each projects onto the jersey from a view; sleeve logos land on
// the sleeve panel (the 3D viewer raycasts the whole model, so a logo attaches
// to whatever surface it's over). Defaults pre-place each slot sensibly.
const LOGO_SLOTS = [
  // Crest default: wearer's LEFT chest = image-right; the front number sits
  // over the wearer's right chest, so the two never stack.
  { key: 'chest', label: 'Chest', view: 'front', x: 0.64, y: 0.3, scale: 0.52 },
  { key: 'leftSleeve', label: 'L Sleeve', view: 'front', x: 0.17, y: 0.33, scale: 0.5 },
  { key: 'rightSleeve', label: 'R Sleeve', view: 'front', x: 0.83, y: 0.33, scale: 0.5 },
  { key: 'back', label: 'Back', view: 'back', x: 0.5, y: 0.16, scale: 0.7 },
];
const SLOT_BY_KEY = LOGO_SLOTS.reduce((m, s) => { m[s.key] = s; return m; }, {});
const emptyLogos = () => LOGO_SLOTS.reduce((m, s) => { m[s.key] = { src: null, x: s.x, y: s.y, scale: s.scale, rot: 0, aspect: 1 }; return m; }, {});

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
  const byNeck = PROGRAM_GARMENTS[cfg.program] || PROGRAM_GARMENTS.mens;
  return byNeck[cfg.neckStyle === 'crew' ? 'crew' : 'vneck'];
}

const SIZES = ['YS', 'YM', 'YL', 'WS', 'WM', 'WL', 'WXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'];
const SIZE_LABELS = { YS: 'Youth S', YM: 'Youth M', YL: 'Youth L', WS: "Women's S", WM: "Women's M", WL: "Women's L", WXL: "Women's XL", AS: 'Adult S', AM: 'Adult M', AL: 'Adult L', AXL: 'Adult XL', A2XL: 'Adult 2XL' };
const UNIT_PRICE = 80;
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
  bottom: defaultBottom(),
  logos: emptyLogos(),
  playerName: 'MESSI', playerNumber: '10',
  numberColor: '#192853', font: 'block',
  outlineColor: 'auto', numberSize: 1, nameSize: 1,
  nameArch: 'arched', nameSpacing: 8,
  neckStyle: 'vneck', frontNumber: 'right',
  program: 'mens', outline2Color: 'none',
};

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
  return { ...DEFAULT_CONFIG, ...a.config, sections, bottom, logos: { ...emptyLogos(), ...(a.config.logos || {}) } };
}
async function trySupabaseSave(rec) {
  try {
    const mod = await import('../lib/supabase');
    const sb = mod.supabase;
    if (!sb) return;
    await sb.from('uniform_designs').insert({ name: rec.name, spec: rec.spec, thumb: rec.thumb || null });
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
  const outlineWidth = fontDef.hollow ? 8 : (oc === 'none' ? 0 : 5);
  // Second outline rings the first — only meaningful when there IS a first.
  const oc2 = cfg.outline2Color || 'none';
  const outline2 = (outlineWidth && oc2 !== 'none') ? oc2 : 'none';
  const numScale = Number.isFinite(cfg.numberSize) ? cfg.numberSize : 1;
  const nameScale = Number.isFinite(cfg.nameSize) ? cfg.nameSize : 1;
  const num = (cfg.playerNumber || '').toString();
  const logos = { front: [], back: [] };
  const cfgLogos = cfg.logos || {};
  for (const slot of LOGO_SLOTS) {
    const L = cfgLogos[slot.key];
    if (!L || !L.src) continue;
    const item = {
      id: 'logo-' + slot.key, src: L.src, x: L.x, y: L.y, w: 0.22 * (L.scale || 1),
      aspect: L.aspect || 1, rotation: L.rot || 0, opacity: 1, slot: slot.key,
    };
    (slot.view === 'back' ? logos.back : logos.front).push(item);
  }
  const S = normSections(cfg.sections);
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
          : { value: num, font, fill, outline, outlineWidth, outline2, outline2Width: 3, size: 0.95 * numScale,
              ...(cfg.frontNumber === 'left' ? { x: 0.64, y: 0.3 } : cfg.frontNumber === 'center' ? { x: 0.5, y: 0.33 } : {}) },
        name: { value: '', font: 'saira' },
      },
      back: {
        number: { value: num, font, fill, outline, outlineWidth: outlineWidth ? outlineWidth + 1 : 0, outline2, outline2Width: 3, size: 1.3 * numScale },
        // The name follows the chosen lettering style (it used to be pinned to
        // one condensed font) and arches over the number by default.
        name: { value: (cfg.playerName || '').toUpperCase(), font, fill, outline, outlineWidth: Math.max(2, outlineWidth - 2), size: 0.7 * nameScale,
          arch: cfg.nameArch === 'straight' ? 0 : 0.35, letterSpacing: Number.isFinite(cfg.nameSpacing) ? cfg.nameSpacing : 8 },
      },
    },
    logos,
    meta: { teamName: cfg.teamName },
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

// One labeled swatch row (PRIMARY / ACCENT …) — several stack inside a single
// numbered Colors card, matching the pro-configurator panel layout.
function SwatchGroup({ head, value, hex, onPick, size, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, color: C.textLight }}>{head}</div>
        <div style={groupVal}>{value}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 4 }}>
        {PALETTE.map((p) => <Swatch key={p.hex} hex={p.hex} size={size} active={String(hex).toUpperCase() === p.hex.toUpperCase()} onClick={() => onPick(p.hex)} />)}
      </div>
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
function SectionEditor({ sectionDefs, sections, activeKey, onSelect, onPatch, printLib, teamColors }) {
  const active = sections[activeKey] || sections[sectionDefs[0].key];
  return (
    <div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap', paddingLeft: 4 }}>
        {sectionDefs.map((s) => {
          const on = s.key === activeKey;
          return (
            <button key={s.key} onClick={() => onSelect(s.key)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '7px 12px', borderRadius: 2, transform: 'skewX(-12deg)', background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy, border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: on ? '0 2px 6px rgba(25,40,83,0.25)' : 'none' }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: sections[s.key].color, border: '1px solid ' + (on ? 'rgba(255,255,255,.5)' : C.mid) }} />{s.label}
            </button>
          );
        })}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={groupHead}>{(sectionDefs.find((s) => s.key === activeKey) || sectionDefs[0]).label}</div>
          <div style={groupVal}>{nameForHex(active.color)} · {active.pattern === 'custom' ? (active.patternName || 'Print') : ((PATTERNS.find((p) => p.id === active.pattern) || {}).label || 'Solid')}</div>
        </div>
        <div style={{ ...railLabel, marginBottom: 8 }}>Pattern</div>
        <div style={{ marginBottom: 14 }}>
          <Pills options={PATTERNS} active={active.pattern} onPick={(p) => onPatch({ pattern: p })} />
        </div>
        {printLib.length > 0 && (
          <>
            <div style={{ ...railLabel, marginBottom: 8 }}>Print Patterns</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {printLib.map((p) => {
                const on = active.pattern === 'custom' && active.patternImage === p.image;
                return (
                  <button key={p.id} title={p.name + (p.tintable ? ' (recolors with your team colors)' : '')} onClick={() => onPatch({ pattern: 'custom', patternImage: p.image, patternName: p.name, patternTint: !!p.tintable, patternTintMode: (p.tint_mode === 'blend' || p.tint_mode === 'mono') ? p.tint_mode : 'solid' })}
                    style={{ width: 46, height: 40, borderRadius: 3, cursor: 'pointer', padding: 0, boxSizing: 'border-box', transform: 'skewX(-12deg)',
                      border: on ? '2.5px solid ' + C.navy : '1px solid ' + C.mid,
                      boxShadow: on ? '0 2px 8px rgba(25,40,83,0.3)' : '0 1px 2px rgba(15,23,42,0.08)',
                      backgroundImage: `url(${p.image})`, backgroundSize: '22px 22px', backgroundRepeat: 'repeat' }} />
                );
              })}
            </div>
          </>
        )}
        <div style={{ ...railLabel, marginBottom: 8 }}>Color</div>
        <div style={{ marginBottom: active.pattern !== 'solid' ? 14 : 0 }}>
          <QuickColors teamColors={teamColors} hex={active.color} onPick={(h) => onPatch({ color: h })} />
        </div>
        {active.pattern !== 'solid' && active.pattern !== 'custom' && (
          <>
            <div style={{ ...railLabel, marginBottom: 8 }}>Secondary Color</div>
            <QuickColors teamColors={teamColors} hex={active.color2} onPick={(h) => onPatch({ color2: h })} />
          </>
        )}
        {active.pattern === 'custom' && active.patternTint && active.patternTintMode === 'mono' && (
          <div style={{ marginTop: 12, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Monochrome print — shades derive automatically from the section color above.</div>
        )}
        {active.pattern === 'custom' && active.patternTint && active.patternTintMode !== 'mono' && (
          <>
            <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Secondary</div>
            <QuickColors teamColors={teamColors} hex={active.color2} onPick={(h) => onPatch({ color2: h })} />
            {active.patternTintMode !== 'blend' && (
              <>
                <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Accent 1</div>
                <QuickColors teamColors={teamColors} hex={active.color3 || '#FFFFFF'} onPick={(h) => onPatch({ color3: h })} />
                <div style={{ ...railLabel, margin: '14px 0 8px' }}>Print · Accent 2</div>
                <QuickColors teamColors={teamColors} hex={active.color4 || '#FFFFFF'} onPick={(h) => onPatch({ color4: h })} />
              </>
            )}
          </>
        )}
      </div>
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
export default function ProBuilder({ onExit, onCreateOrder }) {
  const [config, setConfig] = useState(restoredConfig);
  // Catalog flow: pick a sport → pick a starting design → the wizard.
  const [screen, setScreen] = useState('sports'); // sports | designs | wizard
  // Admin-managed palette/styles/presets: hydrate once per session, then bump
  // to re-render everything reading the module-level registries.
  const [, setSettingsRev] = useState(0);
  useEffect(() => {
    let alive = true;
    loadBuilderSettings().then((sx) => {
      if (!alive) return;
      PALETTE = sx.palette; FONTS = sx.numberStyles; DESIGN_PRESETS = sx.presets;
      setSettingsRev((r) => r + 1);
    });
    return () => { alive = false; };
  }, []);
  const [hasAutosave] = useState(() => !!loadAutosave());
  const [hasSavedDesigns] = useState(() => loadSavedDesigns().length > 0);
  const [thumbs, setThumbs] = useState(() => ({ ...thumbCache }));
  const [step, setStep] = useState('team');
  const [spin, setSpin] = useState(false);
  const [fabricGuide, setFabricGuide] = useState(false);
  const narrow = useNarrow();

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
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderDone, setOrderDone] = useState(null); // { fulfillment }
  const [busy, setBusy] = useState('');
  const logoInputRef = useRef(null);

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const spec = useMemo(() => specFromConfig(config), [config]);
  // Neck style picks the garment: the commissioned V-neck (crisp sewn panels)
  // or the crew-neck model. More cuts slot in here as the artist delivers them.
  const tpl = getTemplate(garmentFor(config));

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
  // The coach's declared colors (Team step) + staples — the quick palette every
  // later step leads with.
  const teamColors = (() => {
    const seen = new Set(); const out = [];
    for (const hex of [SX.body.color, SX.body.color2, SX.sleeveL.color, SX.collar.color, config.numberColor, '#FFFFFF', '#0B0B0B']) {
      const h = String(hex || '').toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(h) || seen.has(h)) continue;
      seen.add(h); out.push({ hex: h, name: nameForHex(h) });
    }
    return out;
  })();

  // Paired bottom garment (shorts) — linked by default (derives from the top's
  // sections); unlinking freezes the current derived look for independent edits.
  const [designBottomSection, setDesignBottomSection] = useState('legs');
  const bottom = config.bottom || defaultBottom();
  const bottomSections = effectiveBottomSections(config);
  const setBottomSection = (key, patch) => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: false, sections: { ...effectiveBottomSections(c), [key]: { ...effectiveBottomSections(c)[key], ...patch } } } }));
  const toggleBottomEnabled = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), enabled: !(c.bottom ? c.bottom.enabled : true) } }));
  const unlinkBottom = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: false, sections: effectiveBottomSections(c) } }));
  const relinkBottom = () => setConfig((c) => ({ ...c, bottom: { ...(c.bottom || defaultBottom()), linked: true } }));
  const bottomSpec = useMemo(() => bottomSpecFromConfig(config), [config]);

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
        const mod = await import('../lib/supabase');
        if (!mod.supabase) return;
        const { data } = await mod.supabase.from('uniform_patterns')
          .select('id,name,image,tintable,tint_mode').eq('active', true)
          .order('created_at', { ascending: false }).limit(40);
        if (alive && Array.isArray(data)) setPrintLib(data);
      } catch (_e) { /* offline / table missing */ }
    })();
    return () => { alive = false; };
  }, []);

  const pickSport = (key) => { set({ sport: key }); setScreen('designs'); };
  // A preset replaces the design (colors/pattern/number color) but keeps the
  // coach's team name, players, logos, and roster.
  const pickDesign = (pz) => {
    if (pz) set({ ...pz.config, ...(pz.config.sections ? { sections: normSections(pz.config.sections) } : {}) });
    setScreen('wizard'); setStep('team');
  };

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
    const restored = { ...DEFAULT_CONFIG, ...entry.config, sections: normSections(entry.config.sections), logos: { ...emptyLogos(), ...(entry.config.logos || {}) } };
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
    if (nameSrc && nameSrc.value) patch.playerName = String(nameSrc.value).slice(0, 14);
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
      const players = nums.map((n) => ({ num: n, name: playerNames[n] || '' }));
      return {
        size: sz, label: SIZE_LABELS[sz], qty: nums.length,
        nums: nums.join(', '),
        numsDisplay: players.map((pl) => (pl.name ? `${pl.name.toUpperCase()} #${pl.num}` : `#${pl.num}`)).join(', '),
        players,
      };
    })
    .filter((r) => r.qty > 0), [assignments, playerNames]);

  const setPlayerName = (num, name) => setPlayerNames((p) => ({ ...p, [num]: name }));

  const downloadRoster = () => {
    const rows = [['Player Name', 'Number', 'Size']];
    let any = false;
    SIZES.forEach((sz) => (assignments[sz] || []).forEach((n) => { rows.push([playerNames[n] || '', n, sz]); any = true; }));
    if (!any) rows.push(['Jordan Smith', '23', 'AM']);
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (config.teamName || 'team').toLowerCase().replace(/\s+/g, '-') + '-roster.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── logo slots + placement pad ──
  const padRef = useRef(null);
  const draggingRef = useRef(false);
  const [logoSlot, setLogoSlot] = useState('chest');
  const [proofs, setProofs] = useState({ front: null, back: null });
  const slotDef = SLOT_BY_KEY[logoSlot] || LOGO_SLOTS[0];
  const activeLogo = (config.logos && config.logos[logoSlot]) || {};
  const setLogo = (patch) => setConfig((c) => ({ ...c, logos: { ...c.logos, [logoSlot]: { ...c.logos[logoSlot], ...patch } } }));
  const logoCount = LOGO_SLOTS.filter((s) => config.logos && config.logos[s.key] && config.logos[s.key].src).length;

  const onLogoFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        const k = Math.min(1, MAX_LOGO_PX / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const full = cv.toDataURL('image/png'); // before knockout mutates the canvas
        let cut = null;
        try { cut = knockoutBackground(cv); } catch (_e) {}
        setLogo({ src: cut || full, srcFull: full, srcCut: cut, bgRemoved: !!cut, aspect: w / h, x: slotDef.x, y: slotDef.y, scale: slotDef.scale, rot: 0 });
      };
      img.onerror = () => setLogo({ src: ev.target.result, srcFull: ev.target.result, srcCut: null, bgRemoved: false, aspect: 1 });
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Pad backgrounds = front/back proofs WITHOUT logos (the draggable box shows
  // the logo on top). Depend only on the design, not logo position, so dragging
  // doesn't re-render them.
  useEffect(() => {
    if (step !== 'jersey') return;
    let alive = true;
    const bare = { ...config, logos: emptyLogos() };
    Promise.all([
      renderToDataURL(specFromConfig(bare), { view: 'front' }),
      renderToDataURL(specFromConfig(bare), { view: 'back' }),
    ]).then(([front, back]) => { if (alive) setProofs({ front, back }); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [step, JSON.stringify(config.sections), config.playerNumber, config.playerName, config.numberColor, config.font]);

  // Live shorts thumbnail — shown next to the 3D jersey stage so the top and
  // bottom "show together" while designing, even without a 3D shorts model.
  const [bottomPreview, setBottomPreview] = useState(null);
  useEffect(() => {
    if (!bottom.enabled) { setBottomPreview(null); return; }
    let alive = true;
    renderToDataURL(bottomSpec, { view: 'front', width: 300 }).then((u) => { if (alive) setBottomPreview(u); }).catch(() => {});
    return () => { alive = false; };
  }, [bottom.enabled, bottomSpec]);

  const padPoint = (e) => {
    const rect = padRef.current.getBoundingClientRect();
    const x = Math.min(0.92, Math.max(0.08, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height));
    setLogo({ x, y });
  };
  const onPadDown = (e) => { draggingRef.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} padPoint(e); };
  const onPadMove = (e) => { if (draggingRef.current) padPoint(e); };
  const onPadUp = (e) => { draggingRef.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} };

  // ── finalize: render 2D proof images for the review (+ paired bottom) ──
  const [bottomReview, setBottomReview] = useState({ front: null, back: null });
  useEffect(() => {
    if (step !== 'finalize') return;
    let alive = true;
    setReview({ front: null, back: null });
    setBottomReview({ front: null, back: null });
    (async () => {
      try {
        const [front, back] = await Promise.all([
          renderToDataURL(spec, { view: 'front', scale: 1 }),
          renderToDataURL(spec, { view: 'back', scale: 1 }),
        ]);
        if (alive) setReview({ front, back });
      } catch (e) { /* review images optional */ }
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
  }, [step, spec, bottom.enabled, bottomSpec]);

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
      const doc = await renderProductionPDF(spec, {
        roster: rosterBreakdown,
        order: { totalQty, unitPrice: UNIT_PRICE, total: totalQty * UNIT_PRICE },
        bottomSpec: bottom.enabled ? bottomSpec : undefined,
      });
      doc.save(`${fileBase()}-production.pdf`);
    } catch (e) { /* jsPDF unavailable */ } finally { setBusy(''); }
  };
  const downloadProofPNG = async () => {
    setBusy('Rendering production PNG…');
    try {
      const url = await renderProductionSheet(spec, { width: 1400, bottomSpec: bottom.enabled ? bottomSpec : undefined });
      downloadDataURL(url, `${fileBase()}-production.png`);
    } catch (e) { /* render failed */ } finally { setBusy(''); }
  };

  // A coach fills in name/email once, then picks how to complete the order —
  // pay by card now, submit a school PO, or add to the queue for a rep to
  // process manually. All three write one row to uniform_order_requests
  // (staff-only reads; see Settings -> Uniform Orders) so there's a single
  // queue to work from regardless of path.
  const contactValid = contactName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());

  const submitOrder = async (fulfillment, extra) => {
    setOrderBusy(true); setOrderError('');
    const row = {
      team_name: config.teamName || 'Team',
      sport: config.sport || null,
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      config,
      spec,
      bottom_spec: bottom.enabled ? bottomSpec : null,
      roster: rosterBreakdown,
      total_qty: totalQty,
      unit_price: UNIT_PRICE,
      total: totalQty * UNIT_PRICE,
      fulfillment,
      status: fulfillment === 'card' ? 'paid' : fulfillment === 'po' ? 'po_submitted' : 'queued',
      thumb: review.front || null,
      ...extra,
    };
    // localStorage is the guaranteed record — it can't fail on a network blip,
    // and it's what lets a coach complete an order offline. Supabase is a
    // best-effort mirror for the staff queue: if it's unreachable the coach
    // still gets a real confirmation, and the local record (plus the PDF/PNG
    // they can download) is the fallback until it syncs.
    let localOk = true;
    try {
      const prev = JSON.parse(localStorage.getItem('nsa_uniform_orders') || '[]');
      prev.unshift({ id: 'o_' + Date.now().toString(36), ...row, ts: Date.now() });
      localStorage.setItem('nsa_uniform_orders', JSON.stringify(prev.slice(0, 20)));
    } catch (_e) { localOk = false; /* quota / private mode */ }
    try {
      const mod = await import('../lib/supabase');
      if (mod.supabase) await mod.supabase.from('uniform_order_requests').insert(row);
    } catch (_e) { /* best-effort — local record still stands */ }
    if (localOk) {
      setOrderDone({ fulfillment });
      if (onCreateOrder) onCreateOrder({ ...row, assignments });
    } else {
      setOrderError("Could not save your order on this device. Please try again, or email us the Production PDF/PNG and your contact info directly.");
    }
    setOrderBusy(false);
  };

  const submitPO = () => {
    if (!poNumber.trim()) { setOrderError('Enter a PO number to continue.'); return; }
    submitOrder('po', { po_number: poNumber.trim(), po_contact: poContact.trim() });
  };
  const onStripeSuccess = (result) => {
    setShowStripeModal(false);
    submitOrder('card', { stripe_intent_id: (result && result.intentId) || null });
  };

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const goNext = () => { if (step === 'finalize') return; setStep(STEPS[Math.min(stepIdx + 1, STEPS.length - 1)].key); };
  const goPrev = () => { if (stepIdx === 0) { setScreen('designs'); return; } setStep(STEPS[stepIdx - 1].key); };
  const nextLabel = 'Next';

  const isBuilderStep = step === 'team' || step === 'jersey' || step === 'numbers';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: F_BODY, zIndex: 40 }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: narrow ? '0 14px' : '0 28px', height: narrow ? 56 : 64, borderBottom: '1px solid ' + C.light, flexShrink: 0 }}>
        <button onClick={onExit} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 16 }}>←</span> {narrow ? 'Exit' : onExit ? 'Exit Builder' : 'Team Stores'}
        </button>
        <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 15 : 18, letterSpacing: 1, color: C.navy, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Uniform Builder {!narrow && <span style={{ color: C.textLight, fontWeight: 700, fontSize: 12 }}>National Sports</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => setScreen('saved')} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>My Designs</button>
          {!narrow && <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Changes save automatically</div>}
        </div>
      </div>

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
                  <Viewer3D spec={spec} modelUrl={tpl.model3d} autoRotate={spin} fit={1.16} />
                </React.Suspense>
              </div>
              {/* floating info card — top left */}
              <div style={{ position: 'absolute', top: narrow ? 10 : 18, left: narrow ? 14 : 22, maxWidth: narrow ? 220 : 300, pointerEvents: 'none' }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: narrow ? 10 : 11, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Custom Build · {PROGRAM_LABELS[config.program] || "Men's"}</div>
                <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: narrow ? 16 : 21, textTransform: 'uppercase', color: C.navy, margin: '2px 0 6px', lineHeight: 1.15 }}>{(config.teamName || 'Team')} {config.sport ? SPORT_LABELS[config.sport] + ' ' : ''}Jersey</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {[SX.body.color, SX.sleeveL.color, SX.collar.color].map((c, i) => (
                    <span key={i} style={{ width: 13, height: 13, borderRadius: '50%', background: c, border: '1px solid rgba(15,23,42,.18)', flexShrink: 0 }} />
                  ))}
                  {!narrow && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>{nameForHex(SX.body.color)} / {nameForHex(SX.sleeveL.color)} / {nameForHex(SX.collar.color)}</span>}
                </div>
              </div>
              {/* floating shorts chip — bottom left */}
              {bottom.enabled && (
                <div style={{ position: 'absolute', left: narrow ? 14 : 22, bottom: narrow ? 10 : 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: narrow ? 42 : 52, height: narrow ? 42 : 52, borderRadius: 6, border: '1px solid ' + C.light, overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 5px rgba(15,23,42,.08)' }}>
                    {bottomPreview ? <img src={bottomPreview} alt="shorts" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, color: C.textLight }}>…</span>}
                  </div>
                  {!narrow && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>+ Matching Shorts{bottom.linked ? '' : ' (custom)'}</span>}
                </div>
              )}
              {/* floating viewer controls — bottom right */}
              <div style={{ position: 'absolute', right: narrow ? 14 : 22, bottom: narrow ? 10 : 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                {!narrow && <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Drag to rotate · scroll to zoom</span>}
                <button onClick={() => setSpin((v) => !v)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: spin ? '#fff' : C.navy, background: spin ? C.navy : '#fff', border: '1px solid ' + (spin ? C.navy : C.mid), borderRadius: 4, padding: '5px 11px', cursor: 'pointer' }}>{spin ? 'Pause Spin' : 'Auto-Spin'}</button>
              </div>
            </div>

            {/* RIGHT PANEL — stacks under the stage on narrow screens */}
            <div style={narrow
              ? { flex: 1, minHeight: 0, borderTop: '1px solid ' + C.light, padding: '16px 14px 28px', overflowY: 'auto', background: C.offWhite }
              : { width: 330, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '18px 16px 28px', overflowY: 'auto', background: C.offWhite }}>
              {step === 'team' && (
                <div>
                  <RailCard num={1} title="Team Name">
                    <LabeledInput label="" value={config.teamName} onChange={(v) => set({ teamName: v })} maxLength={24} />
                  </RailCard>
                  {/* Team colors — the working palette every later step leads with,
                      and the seed for the jersey's sections. */}
                  <RailCard num={2} title="Colors">
                    <SwatchGroup head="Primary" value={nameForHex(SX.body.color)} hex={SX.body.color} onPick={(h) => setSection('body', { color: h })} />
                    <SwatchGroup head="Accent 1 · Trim" value={nameForHex(SX.sleeveL.color)} hex={SX.sleeveL.color} onPick={(h) => { setSection('sleeveL', { color: h }); setSection('sleeveR', { color: h }); setSection('collar', { color: h }); }} />
                    <SwatchGroup head="Accent 2 · Secondary" value={nameForHex(SX.body.color2)} hex={SX.body.color2} onPick={(h) => setSection('body', { color2: h })} last />
                  </RailCard>
                  <RailCard num={3} title="Cut &amp; Style" value={config.neckStyle === 'crew' ? 'Crew Neck' : 'V-Neck'}>
                    <Pills options={[{ id: 'vneck', label: 'V-Neck' }, { id: 'crew', label: 'Crew Neck' }]} active={config.neckStyle || 'vneck'} onPick={(v) => set({ neckStyle: v })} />
                  </RailCard>
                  <RailCard num={4} title="Fabric"
                    action={<button onClick={() => setFabricGuide(true)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fabric guide →</button>}>
                    <Pills options={ds.FABRICS} active={config.fabric || 'sublimated'} onPick={(f) => set({ fabric: f })} />
                    <div style={{ marginTop: 10, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>
                      {(FABRIC_DETAILS.find((f) => f.id === (config.fabric || 'sublimated')) || FABRIC_DETAILS[0]).blurb}
                    </div>
                  </RailCard>
                </div>
              )}
              {step === 'jersey' && (
                <div>
                  <RailCard num={1} title="✨ AI Design Assist">
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
                  <RailCard num={2} title="Sections"
                    action={<button onClick={toggleSleevesLinked}
                      style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 3, padding: '4px 9px', cursor: 'pointer', transform: 'skewX(-12deg)' }}>
                      {sleevesLinked ? 'Split Sleeves' : 'Mirror Sleeves'}
                    </button>}>
                  <SectionEditor
                    sectionDefs={sleevesLinked
                      ? [{ key: 'body', label: 'Body' }, { key: 'sleeveL', label: 'Sleeves' }, { key: 'collar', label: 'Collar & Cuffs' }]
                      : SECTIONS}
                    sections={SX}
                    activeKey={sleevesLinked && designSection === 'sleeveR' ? 'sleeveL' : designSection}
                    onSelect={setDesignSection}
                    onPatch={(patch) => setSection(sleevesLinked && designSection === 'sleeveR' ? 'sleeveL' : designSection, patch)} printLib={printLib} teamColors={teamColors} />
                  </RailCard>
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
                </div>
              )}
              {step === 'numbers' && (
                <div>
                  <RailCard num={1} title="Team Logos" value={logoCount > 0 ? `${logoCount} placed` : null}>
                  {/* slot selector */}
                  <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap', paddingLeft: 4 }}>
                    {LOGO_SLOTS.map((s) => {
                      const on = s.key === logoSlot; const has = config.logos && config.logos[s.key] && config.logos[s.key].src;
                      return (
                        <button key={s.key} onClick={() => setLogoSlot(s.key)} style={{ position: 'relative', fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '7px 12px', borderRadius: 2, transform: 'skewX(-12deg)', background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy, border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer', boxShadow: on ? '0 2px 6px rgba(25,40,83,0.25)' : 'none' }}>
                          {s.label}{has && <span style={{ position: 'absolute', top: -4, right: -4, width: 9, height: 9, borderRadius: '50%', background: C.red, border: '1.5px solid #fff' }} />}
                        </button>
                      );
                    })}
                  </div>
                  {activeLogo.src ? (
                    <div>
                      <div ref={padRef} onPointerDown={onPadDown} onPointerMove={onPadMove} onPointerUp={onPadUp} onPointerLeave={onPadUp}
                        style={{ position: 'relative', width: '100%', aspectRatio: '760 / 940', background: (proofs[slotDef.view] ? `#fff url(${proofs[slotDef.view]}) center/contain no-repeat` : C.offWhite), border: '1px solid ' + C.mid, borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}>
                        <img src={activeLogo.src} alt="logo" draggable={false} style={{ position: 'absolute', left: ((activeLogo.x || 0.5) * 100) + '%', top: ((activeLogo.y || 0.4) * 100) + '%', width: (22 * (activeLogo.scale || 1)) + '%', transform: `translate(-50%,-50%) rotate(${activeLogo.rot || 0}deg)`, pointerEvents: 'none', userSelect: 'none' }} />
                        <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', fontFamily: F_BODY, fontSize: 11, color: C.textLight, textShadow: '0 1px 2px #fff' }}>drag to reposition · {slotDef.label} ({slotDef.view})</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                        <span style={{ width: 46, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy }}>Size</span>
                        {/* Sized in real inches (3" is the standard chest logo): the
                            front image spans ~26" of garment, logo.w = 0.22 × scale
                            of that width → 1 scale unit ≈ 5.72". */}
                        <input type="range" min="1" max="6" step="0.25" value={Math.round(((activeLogo.scale || 1) * 5.72) * 4) / 4} onChange={(e) => setLogo({ scale: parseFloat(e.target.value) / 5.72 })} style={{ flex: 1 }} />
                        <span style={{ width: 38, textAlign: 'right', fontFamily: F_DISP, fontWeight: 700, fontSize: 12, color: C.red }}>{(((activeLogo.scale || 1) * 5.72)).toFixed(2).replace(/0$/, '')}"</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                        <span style={{ width: 46, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy }}>Rotate</span>
                        <input type="range" min="-180" max="180" step="1" value={activeLogo.rot || 0} onChange={(e) => setLogo({ rot: parseInt(e.target.value, 10) })} style={{ flex: 1 }} />
                        <button onClick={() => setLogo({ rot: 0 })} title="Reset rotation" style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, color: C.textLight, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}>0°</button>
                      </div>
                      {activeLogo.srcCut && (
                        <button onClick={() => setLogo({ bgRemoved: !activeLogo.bgRemoved, src: activeLogo.bgRemoved ? activeLogo.srcFull : activeLogo.srcCut })}
                          style={{ marginTop: 10, fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: activeLogo.bgRemoved ? C.green : C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>
                          {activeLogo.bgRemoved ? '✓ Background removed · undo' : 'Remove background'}
                        </button>
                      )}
                      <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                        <label style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy, cursor: 'pointer' }}>
                          Replace<input type="file" accept="image/*" onChange={onLogoFile} style={{ display: 'none' }} />
                        </label>
                        <button onClick={() => setLogo({ src: null, srcFull: null, srcCut: null, bgRemoved: false })} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
                      </div>
                      <div style={{ marginTop: 10, fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Drag to place the {slotDef.label.toLowerCase()} logo; it appears live on the 3D jersey and the proof.</div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 150, border: '2px dashed ' + C.mid, borderRadius: 8, cursor: 'pointer', color: C.textLight, fontFamily: F_BODY, fontSize: 13, textAlign: 'center', padding: 16, boxSizing: 'border-box' }}>
                      <span style={{ fontSize: 24 }}>⬆︎</span>
                      <span>Upload a logo for the <strong style={{ color: C.navy }}>{slotDef.label}</strong></span>
                      <input ref={logoInputRef} type="file" accept="image/*" onChange={onLogoFile} style={{ display: 'none' }} />
                    </label>
                  )}
                  </RailCard>
                  <RailCard num={2} title="Front Number" value={({ right: 'Right Chest', left: 'Left Chest', center: 'Center', none: 'None' })[config.frontNumber || 'right']}>
                    <Pills options={[{ id: 'right', label: 'Right Chest' }, { id: 'left', label: 'Left Chest' }, { id: 'center', label: 'Center' }, { id: 'none', label: 'None' }]}
                      active={config.frontNumber || 'right'} onPick={(v) => set({ frontNumber: v })} />
                  </RailCard>
                  <RailCard num={3} title="Name &amp; Number">
                    <LabeledInput label="Player Name (Back)" value={config.playerName} onChange={(v) => set({ playerName: v })} maxLength={14} />
                    <div style={{ height: 12 }} />
                    <LabeledInput label="Player Number" value={config.playerNumber} onChange={(v) => set({ playerNumber: v.replace(/[^0-9]/g, '').slice(0, 2) })} maxLength={2} />
                  </RailCard>
                  <RailCard num={4} title="Name Style" value={config.nameArch === 'straight' ? 'Straight' : 'Arched'}>
                    <div style={{ marginBottom: 12 }}>
                      <Pills options={[{ id: 'arched', label: 'Arched' }, { id: 'straight', label: 'Straight' }]} active={config.nameArch || 'arched'} onPick={(v) => set({ nameArch: v })} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Letter Spacing</span>
                      <span style={groupVal}>{Number.isFinite(config.nameSpacing) ? config.nameSpacing : 8}%</span>
                    </div>
                    <input type="range" min={0} max={30} step={1} value={Number.isFinite(config.nameSpacing) ? config.nameSpacing : 8} onChange={(e) => set({ nameSpacing: parseInt(e.target.value, 10) })} style={{ width: '100%', accentColor: C.navy }} />
                  </RailCard>
                  <RailCard num={5} title="Number Color" value={nameForHex(config.numberColor)}>
                    <QuickColors teamColors={teamColors} size={38} hex={config.numberColor} onPick={(h) => set({ numberColor: h })} />
                  </RailCard>
                  {config.font !== 'outline' && (
                    <RailCard num={6} title="Outline" value={(config.outlineColor || 'auto') === 'auto' ? 'Auto' : config.outlineColor === 'none' ? 'None' : nameForHex(config.outlineColor)}>
                      <div style={{ marginBottom: 10 }}>
                        <Pills options={[{ id: 'auto', label: 'Auto' }, { id: 'none', label: 'None' }]} active={(config.outlineColor || 'auto')} onPick={(v) => set({ outlineColor: v })} />
                      </div>
                      <QuickColors teamColors={teamColors} size={26} hex={config.outlineColor || ''} onPick={(h) => set({ outlineColor: h })} />
                      {/* second outline — the pro "double border" look; needs a first outline to ring */}
                      {(config.outlineColor || 'auto') !== 'none' && (
                        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed ' + C.light }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                            <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Second Outline</span>
                            <span style={groupVal}>{(config.outline2Color || 'none') === 'none' ? 'None' : nameForHex(config.outline2Color)}</span>
                          </div>
                          <div style={{ marginBottom: 10 }}>
                            <Pills options={[{ id: 'none', label: 'None' }]} active={(config.outline2Color || 'none')} onPick={(v) => set({ outline2Color: v })} />
                          </div>
                          <QuickColors teamColors={teamColors} size={26} hex={config.outline2Color === 'none' ? '' : (config.outline2Color || '')} onPick={(h) => set({ outline2Color: h })} />
                        </div>
                      )}
                    </RailCard>
                  )}
                  <RailCard num={config.font !== 'outline' ? 7 : 6} title="Lettering Size">
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Number Size</span>
                      <span style={groupVal}>{Math.round((config.numberSize || 1) * 100)}%</span>
                    </div>
                    <input type="range" min={0.7} max={1.3} step={0.05} value={config.numberSize || 1} onChange={(e) => set({ numberSize: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: C.navy }} />
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '14px 0 6px' }}>
                      <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight }}>Name Size</span>
                      <span style={groupVal}>{Math.round((config.nameSize || 1) * 100)}%</span>
                    </div>
                    <input type="range" min={0.7} max={1.3} step={0.05} value={config.nameSize || 1} onChange={(e) => set({ nameSize: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: C.navy }} />
                  </RailCard>
                  <RailCard num={config.font !== 'outline' ? 8 : 7} title="Number Style" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', paddingLeft: 4 }}>
                      {FONTS.map((f) => {
                        const on = f.id === config.font;
                        return (
                          <button key={f.id} onClick={() => set({ font: f.id })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 14px', borderRadius: 2, transform: 'skewX(-12deg)', background: on ? C.navy : '#fff', border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer', boxShadow: on ? '0 2px 6px rgba(25,40,83,0.25)' : 'none' }}>
                            <span style={{ fontWeight: 800, fontSize: 18, color: on ? '#fff' : C.navy, WebkitTextStroke: f.hollow ? ('1px ' + (on ? '#fff' : C.navy)) : undefined, WebkitTextFillColor: f.hollow ? 'transparent' : undefined }}>23</span>
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
            {/* assigned players — names are optional, but complete the shop's roster sheet */}
            {totalQty > 0 && (
              <div style={{ background: '#fff', border: '1px solid ' + C.light, borderRadius: 6, padding: '16px 20px', marginTop: 16 }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, marginBottom: 4 }}>Assigned Players</div>
                <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 14 }}>Add a name per number (optional) — it flows into the roster CSV and the production PDF.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {SIZES.flatMap((sz) => (assignments[sz] || []).map((num) => ({ num, sz })))
                    .sort((a, b) => Number(a.num) - Number(b.num))
                    .map(({ num, sz }) => (
                      <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flexShrink: 0, minWidth: 50, textAlign: 'center', fontFamily: F_DISP, fontWeight: 800, fontSize: 13, color: C.navy, background: C.offWhite, borderRadius: 4, padding: '7px 4px' }}>#{num} <span style={{ fontWeight: 600, color: C.textLight }}>{sz}</span></span>
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
                        {review[v] ? <img src={review[v]} alt={v} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ color: C.textLight, fontSize: 13 }}>Rendering…</span>}
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
              : { width: 400, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '32px 32px 40px', display: 'flex', flexDirection: 'column', background: C.offWhite, overflowY: 'auto' }}>
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
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
                <button onClick={saveDesign} style={ghostBtn}>Save Design</button>
                <button onClick={downloadRoster} style={ghostBtn}>Roster CSV</button>
              </div>
              <div style={sectionHead}>Construction Materials</div>
              {[
                ...SECTIONS.map((s) => ({ label: s.label, value: zoneRowValue(SX[s.key]), sw: SX[s.key].color })),
                ...(bottom.enabled ? BOTTOM_SECTIONS.map((s) => ({ label: `Shorts — ${s.label}`, value: zoneRowValue(bottomSections[s.key]), sw: bottomSections[s.key].color })) : []),
                { label: 'Number Fill', value: nameForHex(config.numberColor), sw: config.numberColor },
                { label: 'Number & Name Font', value: (FONTS.find((f) => f.id === config.font) || {}).label || 'Block' },
                { label: 'Logos', value: (LOGO_SLOTS.filter((s) => config.logos && config.logos[s.key] && config.logos[s.key].src).map((s) => s.label).join(', ')) || 'None' },
                { label: 'Fabric', value: 'Sublimated Poly' },
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 15, borderTop: '2px solid ' + C.navy }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textLight }}>{totalQty} jerseys · ${UNIT_PRICE} ea</div>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 26, color: C.navy }}>${(totalQty * UNIT_PRICE).toLocaleString()}</div>
              </div>
              {savedMsg && <div style={{ marginTop: 18, padding: '14px 16px', background: '#fff', borderLeft: '3px solid ' + C.navy, fontFamily: F_BODY, fontSize: 13, color: C.text }}>Design saved.</div>}

              {/* Complete the order — pick a fulfillment path once contact info is filled in. */}
              <div style={{ marginTop: 22, padding: '18px 18px 20px', background: '#fff', border: '2px solid ' + C.navy, borderRadius: 8 }}>
                <div style={{ ...sectionHead, border: 'none', paddingBottom: 0, marginBottom: 14 }}>Complete Your Order</div>
                {orderDone ? (
                  <div style={{ padding: '14px 16px', background: C.offWhite, borderLeft: '3px solid ' + C.green, fontFamily: F_BODY, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                    {orderDone.fulfillment === 'card' && 'Payment received — thank you! Your rep will confirm production details within 24 hours.'}
                    {orderDone.fulfillment === 'po' && "PO submitted — we'll invoice your school per the PO terms. Your rep will follow up within 24 hours."}
                    {orderDone.fulfillment === 'manual' && "Order added to our queue — your rep will follow up within 24 hours to confirm payment and production."}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                      <LabeledInput label="Your Name" value={contactName} onChange={setContactName} maxLength={60} />
                      <LabeledInput label="Email" value={contactEmail} onChange={setContactEmail} maxLength={80} />
                    </div>
                    {!contactValid && <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, marginBottom: 12 }}>Enter your name and a valid email to complete the order.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button onClick={() => setShowStripeModal(true)} disabled={!contactValid || orderBusy} style={{ ...checkoutBtn(true), opacity: (!contactValid || orderBusy) ? 0.5 : 1 }}>💳 Pay by Card Now</button>
                      <button onClick={() => setPoOpen((v) => !v)} disabled={!contactValid || orderBusy} style={{ ...checkoutBtn(false), opacity: (!contactValid || orderBusy) ? 0.5 : 1 }}>🏫 School Purchase Order</button>
                      {poOpen && (
                        <div style={{ padding: '12px 14px', background: C.offWhite, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <LabeledInput label="PO Number" value={poNumber} onChange={setPoNumber} maxLength={40} />
                          <LabeledInput label="Billing Contact (optional)" value={poContact} onChange={setPoContact} maxLength={80} />
                          <button onClick={submitPO} disabled={orderBusy} style={{ ...prodBtn, opacity: orderBusy ? 0.6 : 1 }}>{orderBusy ? 'Submitting…' : 'Submit PO Order'}</button>
                        </div>
                      )}
                      <button onClick={() => submitOrder('manual')} disabled={!contactValid || orderBusy} style={{ ...checkoutBtn(false), opacity: (!contactValid || orderBusy) ? 0.5 : 1 }}>{orderBusy ? 'Submitting…' : '📋 Add to Order Queue'}</button>
                    </div>
                    <div style={{ fontFamily: F_BODY, fontSize: 11, color: C.textLight, marginTop: 10, lineHeight: 1.5 }}>Card charges now. PO and Order Queue require no payment today — your rep confirms details and invoices per your terms.</div>
                    {orderError && <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 12 }}>{orderError}</div>}
                  </>
                )}
              </div>
              {showStripeModal && (
                <StripePaymentModal
                  invoices={[{ id: 'uniform-' + fileBase(), total: totalQty * UNIT_PRICE, paid: 0 }]}
                  customerName={contactName || config.teamName || 'Team'}
                  customerEmail={contactEmail}
                  paymentNote={`${config.teamName || 'Team'} uniform order — ${totalQty} jersey${totalQty === 1 ? '' : 's'}${bottom.enabled ? ' + shorts' : ''}.`}
                  onClose={() => setShowStripeModal(false)}
                  onSuccess={onStripeSuccess}
                />
              )}
            </div>
          </div>
        )}
      </div>

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
