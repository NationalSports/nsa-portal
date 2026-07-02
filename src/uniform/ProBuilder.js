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
import { renderToDataURL, renderProductionPDF } from './renderCanvas';
import * as ds from './designSpec';

const Viewer3D = React.lazy(() => import('./Viewer3D'));
const UniformBuilder = React.lazy(() => import('./UniformBuilder'));

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
const PALETTE = [
  { hex: '#192853', name: 'Navy' }, { hex: '#962C32', name: 'Red' }, { hex: '#0B0B0B', name: 'Black' },
  { hex: '#FFFFFF', name: 'White' }, { hex: '#1E4D8C', name: 'Royal' }, { hex: '#7CB0E0', name: 'Sky' },
  { hex: '#0B6E4F', name: 'Forest' }, { hex: '#F2B705', name: 'Gold' }, { hex: '#5B2A86', name: 'Purple' },
  { hex: '#7A1F3D', name: 'Maroon' }, { hex: '#D9631E', name: 'Orange' }, { hex: '#0EA5A5', name: 'Teal' },
];
const nameForHex = (hex) => {
  const h = String(hex || '').toUpperCase();
  const hit = PALETTE.find((p) => p.hex.toUpperCase() === h);
  return hit ? hit.name : 'Custom';
};

// Pattern ids must match designSpec's PATTERN_IDS or cleanZone silently drops them.
const PATTERNS = [
  { id: 'solid', label: 'Solid' }, { id: 'stripes', label: 'Stripes' },
  { id: 'boldstripe', label: 'Bold Stripes' }, { id: 'pinstripe', label: 'Pinstripe' },
];
const FONTS = [
  { id: 'block', label: 'Block', font: 'anton', preview: 'normal' },
  { id: 'varsity', label: 'Varsity', font: 'squada', preview: 'normal' },
  { id: 'outline', label: 'Outline', font: 'anton', preview: 'normal', hollow: true },
];
// Logo slots — each projects onto the jersey from a view; sleeve logos land on
// the sleeve panel (the 3D viewer raycasts the whole model, so a logo attaches
// to whatever surface it's over). Defaults pre-place each slot sensibly.
const LOGO_SLOTS = [
  { key: 'chest', label: 'Chest', view: 'front', x: 0.5, y: 0.42, scale: 1 },
  { key: 'leftSleeve', label: 'L Sleeve', view: 'front', x: 0.17, y: 0.33, scale: 0.5 },
  { key: 'rightSleeve', label: 'R Sleeve', view: 'front', x: 0.83, y: 0.33, scale: 0.5 },
  { key: 'back', label: 'Back', view: 'back', x: 0.5, y: 0.16, scale: 0.7 },
];
const SLOT_BY_KEY = LOGO_SLOTS.reduce((m, s) => { m[s.key] = s; return m; }, {});
const emptyLogos = () => LOGO_SLOTS.reduce((m, s) => { m[s.key] = { src: null, x: s.x, y: s.y, scale: s.scale, rot: 0, aspect: 1 }; return m; }, {});

const SIZES = ['YS', 'YM', 'YL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'];
const SIZE_LABELS = { YS: 'Youth S', YM: 'Youth M', YL: 'Youth L', AS: 'Adult S', AM: 'Adult M', AL: 'Adult L', AXL: 'Adult XL', A2XL: 'Adult 2XL' };
const UNIT_PRICE = 80;
const STEPS = [
  { key: 'team', label: 'Team' }, { key: 'jersey', label: 'Jersey' }, { key: 'numbers', label: 'Numbers' },
  { key: 'roster', label: 'Roster' }, { key: 'finalize', label: 'Finalize' },
];

const DEFAULT_CONFIG = {
  teamName: 'ARGENTINA',
  primary: '#7CB0E0',   // body
  secondary: '#FFFFFF', // stripes / secondary
  trim: '#192853',      // collar + sleeves/cuffs
  pattern: 'boldstripe',
  logos: emptyLogos(),
  playerName: 'MESSI', playerNumber: '10',
  numberColor: '#192853', font: 'block',
};

// ── persistence ──────────────────────────────────────────────────────────────
// Autosave honors the top bar's "Changes save automatically": the in-progress
// design + roster survive a refresh or accidental close. Saved designs and
// order requests share the old builder's localStorage + best-effort Supabase
// pattern (silent no-op if the table/RLS isn't provisioned).
const AUTOSAVE_KEY = 'nsa_uniform_pro_autosave';
function loadAutosave() {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch { return null; }
}
function restoredConfig() {
  const a = loadAutosave();
  if (!a || !a.config) return { ...DEFAULT_CONFIG };
  // Merge over defaults so configs saved before new fields/slots existed stay valid.
  return { ...DEFAULT_CONFIG, ...a.config, logos: { ...emptyLogos(), ...(a.config.logos || {}) } };
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
  const outline = fontDef.hollow ? numColor : ds.contrastInk(numColor);
  const fill = fontDef.hollow ? '#ffffff' : numColor;
  const outlineWidth = fontDef.hollow ? 8 : 5;
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
  return ds.normalizeSpec({
    garmentId: 'octa_jersey', fabric: 'sublimated',
    zones: {
      body: { color: cfg.primary, color2: cfg.secondary, pattern: cfg.pattern || 'solid' },
      sleeveL: { color: cfg.trim, pattern: 'solid' },
      sleeveR: { color: cfg.trim, pattern: 'solid' },
      collar: { color: cfg.trim, pattern: 'solid' },
    },
    text: {
      front: {
        number: { value: num, font, fill, outline, outlineWidth, size: 0.95 },
        name: { value: '', font: 'saira' },
      },
      back: {
        number: { value: num, font, fill, outline, outlineWidth: outlineWidth + 1, size: 1.3 },
        name: { value: (cfg.playerName || '').toUpperCase(), font: 'saira', fill, outline, size: 0.7 },
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

function Swatch({ hex, active, onClick, size = 42 }) {
  return (
    <button onClick={onClick} title={nameForHex(hex)} style={{
      width: size, height: size, borderRadius: 6, background: hex, cursor: 'pointer', padding: 0, boxSizing: 'border-box',
      border: active ? '3px solid ' + C.navy : '1px solid ' + C.mid,
      boxShadow: active ? '0 2px 8px rgba(25,40,83,0.25)' : 'none',
    }} />
  );
}
function SwatchGroup({ head, value, hex, onPick, size }) {
  return (
    <div style={{ padding: '22px 0', borderBottom: '1px solid ' + C.light }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={groupHead}>{head}</div><div style={groupVal}>{value}</div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {PALETTE.map((p) => <Swatch key={p.hex} hex={p.hex} size={size} active={String(hex).toUpperCase() === p.hex.toUpperCase()} onClick={() => onPick(p.hex)} />)}
      </div>
    </div>
  );
}
function Pills({ options, active, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o.id === active;
        return <button key={o.id} onClick={() => onPick(o.id)} style={{
          fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, padding: '7px 13px',
          borderRadius: 4, background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy, border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer',
        }}>{o.label}</button>;
      })}
    </div>
  );
}
function LabeledInput({ label, value, onChange, maxLength }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: C.textLight, marginBottom: 7 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} style={{
        width: '100%', boxSizing: 'border-box', border: '1.5px solid ' + C.mid, borderRadius: 6, padding: '11px 12px',
        fontFamily: F_BODY, fontSize: 15, color: C.text,
      }} />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProBuilder({ onExit, onCreateOrder }) {
  const [config, setConfig] = useState(restoredConfig);
  const [step, setStep] = useState('team');
  const [spin, setSpin] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  // Roster / sizes
  const [selectedSize, setSelectedSize] = useState('AM');
  const [assignments, setAssignments] = useState(() => {
    const a = loadAutosave();
    return (a && a.assignments && typeof a.assignments === 'object') ? a.assignments : { AM: ['10'] };
  });

  // Finalize state
  const [review, setReview] = useState({ front: null, back: null });
  const [ordered, setOrdered] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [busy, setBusy] = useState('');
  const logoInputRef = useRef(null);

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const spec = useMemo(() => specFromConfig(config), [config]);
  const tpl = getTemplate('octa_jersey');

  // Autosave (debounced — logo data URLs make the payload chunky, so don't
  // write on every pointer-move of a drag).
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ config, assignments, ts: Date.now() })); } catch (_e) { /* quota */ }
    }, 600);
    return () => clearTimeout(t);
  }, [config, assignments]);

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
  const rosterBreakdown = useMemo(() => SIZES
    .map((sz) => ({ size: sz, label: SIZE_LABELS[sz], qty: (assignments[sz] || []).length, nums: (assignments[sz] || []).slice().sort((a, b) => Number(a) - Number(b)).join(', ') }))
    .filter((r) => r.qty > 0), [assignments]);

  const downloadRoster = () => {
    const rows = [['Player Name', 'Number', 'Size']];
    let any = false;
    SIZES.forEach((sz) => (assignments[sz] || []).forEach((n) => { rows.push(['', n, sz]); any = true; }));
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
      const src = ev.target.result;
      const img = new Image();
      img.onload = () => setLogo({ src, aspect: (img.naturalWidth / img.naturalHeight) || 1, x: slotDef.x, y: slotDef.y, scale: slotDef.scale, rot: 0 });
      img.onerror = () => setLogo({ src, aspect: 1 });
      img.src = src;
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
  }, [step, config.primary, config.secondary, config.trim, config.pattern, config.playerNumber, config.playerName, config.numberColor, config.font]);

  const padPoint = (e) => {
    const rect = padRef.current.getBoundingClientRect();
    const x = Math.min(0.92, Math.max(0.08, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height));
    setLogo({ x, y });
  };
  const onPadDown = (e) => { draggingRef.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} padPoint(e); };
  const onPadMove = (e) => { if (draggingRef.current) padPoint(e); };
  const onPadUp = (e) => { draggingRef.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} };

  // ── finalize: render 2D proof images for the review ──
  useEffect(() => {
    if (step !== 'finalize') return;
    let alive = true;
    setReview({ front: null, back: null });
    (async () => {
      try {
        const [front, back] = await Promise.all([
          renderToDataURL(spec, { view: 'front', scale: 1 }),
          renderToDataURL(spec, { view: 'back', scale: 1 }),
        ]);
        if (alive) setReview({ front, back });
      } catch (e) { /* review images optional */ }
    })();
    return () => { alive = false; };
  }, [step, spec]);

  const rosterSummary = () => rosterBreakdown.map((r) => `${r.size} ×${r.qty} (#${r.nums})`).join('; ');

  const saveDesign = () => {
    try {
      const key = 'nsa_uniform_saved';
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      prev.unshift({ id: 'u_' + Date.now().toString(36), name: config.teamName || 'Team', config, assignments, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 40)));
      setSavedMsg(true); setTimeout(() => setSavedMsg(false), 3000);
    } catch (e) {}
    trySupabaseSave({ name: config.teamName || 'Team', spec, thumb: review.front });
  };

  const downloadProofPDF = async () => {
    setBusy('Building production PDF…');
    try {
      const doc = await renderProductionPDF(spec);
      doc.save(`${(config.teamName || 'uniform').toLowerCase().replace(/\s+/g, '-')}-proof.pdf`);
    } catch (e) { /* jsPDF unavailable */ } finally { setBusy(''); }
  };

  const createOrder = () => {
    const order = { assignments, totalQty, unitPrice: UNIT_PRICE, total: totalQty * UNIT_PRICE };
    if (onCreateOrder) { onCreateOrder({ config, spec, ...order }); return; }
    // No host order flow (standalone route): persist the request so a rep can
    // pick it up — locally, and best-effort to the shared uniform_designs table
    // with the roster embedded and a human-readable summary in meta.notes.
    const notes = `ORDER REQUEST — ${totalQty} jerseys @ $${UNIT_PRICE} = $${order.total.toLocaleString()}. ${rosterSummary()}`.slice(0, 500);
    const rec = {
      name: `${config.teamName || 'Team'} — ORDER REQUEST`,
      spec: { ...spec, meta: { ...spec.meta, notes }, order },
      thumb: review.front,
    };
    try {
      const prev = JSON.parse(localStorage.getItem('nsa_uniform_orders') || '[]');
      prev.unshift({ id: 'o_' + Date.now().toString(36), ...rec, config, ts: Date.now() });
      localStorage.setItem('nsa_uniform_orders', JSON.stringify(prev.slice(0, 20)));
    } catch (e) {}
    trySupabaseSave(rec);
    setOrdered(true); setTimeout(() => setOrdered(false), 6000);
  };

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const goNext = () => { if (step === 'finalize') { createOrder(); return; } setStep(STEPS[Math.min(stepIdx + 1, STEPS.length - 1)].key); };
  const goPrev = () => setStep(STEPS[Math.max(stepIdx - 1, 0)].key);
  const nextLabel = step === 'finalize' ? 'Create Order' : 'Next';

  if (advanced) {
    return (
      <React.Suspense fallback={<div style={loadStyle}>Loading editor…</div>}>
        <UniformBuilder onExit={() => setAdvanced(false)} />
      </React.Suspense>
    );
  }

  const isBuilderStep = step === 'team' || step === 'jersey' || step === 'numbers';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: F_BODY, zIndex: 40 }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', height: 64, borderBottom: '1px solid ' + C.light, flexShrink: 0 }}>
        <button onClick={onExit} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, color: C.textLight, background: 'none', border: 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: 16 }}>←</span> {onExit ? 'Exit Builder' : 'Team Stores'}
        </button>
        <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 18, letterSpacing: 1, color: C.navy, textTransform: 'uppercase' }}>
          Uniform Builder <span style={{ color: C.textLight, fontWeight: 700, fontSize: 12 }}>National Sports</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => setAdvanced(true)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '7px 12px', cursor: 'pointer' }}>Advanced editor</button>
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Changes save automatically</div>
        </div>
      </div>

      {/* STEP NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, height: 52, borderBottom: '1px solid ' + C.light, flexShrink: 0, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const on = s.key === step; const done = i < stepIdx;
          return (
            <button key={s.key} onClick={() => { if (s.key === 'finalize') { /* allow */ } setStep(s.key); }} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 6px',
              borderBottom: '3px solid ' + (on ? C.red : 'transparent'),
              fontFamily: F_DISP, fontWeight: 700, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1,
              color: on ? C.navy : done ? C.navy : C.textLight,
            }}>
              <span style={{ color: on ? C.red : C.mid, marginRight: 7 }}>{i + 1}</span>{s.label}
            </button>
          );
        })}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {isBuilderStep && (
          <>
            {/* CENTER STAGE — 3D */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 0, background: '#fff', padding: '24px 16px 0' }}>
              <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Custom Build</div>
              <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: C.navy, margin: '2px 0 2px' }}>{(config.teamName || 'Team')} Home Jersey</h2>
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight, marginBottom: 6 }}>{nameForHex(config.primary)} / {nameForHex(config.trim)} / {nameForHex(config.secondary)}</div>
              <div style={{ flex: 1, width: '100%', minHeight: 0 }}>
                <React.Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textLight }}>Loading 3D…</div>}>
                  <Viewer3D spec={spec} modelUrl={tpl.model3d} autoRotate={spin} />
                </React.Suspense>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 12px' }}>
                <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight }}>Drag to rotate · scroll to zoom</span>
                <button onClick={() => setSpin((v) => !v)} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: spin ? '#fff' : C.navy, background: spin ? C.navy : '#fff', border: '1px solid ' + (spin ? C.navy : C.mid), borderRadius: 4, padding: '5px 11px', cursor: 'pointer' }}>{spin ? 'Pause Spin' : 'Auto-Spin'}</button>
              </div>
            </div>

            {/* RIGHT PANEL */}
            <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '24px 22px', overflowY: 'auto' }}>
              {step === 'team' && (
                <div>
                  <LabeledInput label="Team Name" value={config.teamName} onChange={(v) => set({ teamName: v })} maxLength={24} />
                  <div style={{ height: 18 }} />
                  <SwatchGroup head="Primary · Body" value={nameForHex(config.primary)} hex={config.primary} onPick={(h) => set({ primary: h })} />
                  <SwatchGroup head="Accent 1 · Trim" value={nameForHex(config.trim)} hex={config.trim} onPick={(h) => set({ trim: h })} />
                  <SwatchGroup head="Accent 2 · Stripe" value={nameForHex(config.secondary)} hex={config.secondary} onPick={(h) => set({ secondary: h })} />
                </div>
              )}
              {step === 'jersey' && (
                <div>
                  <div style={railLabel}>Jersey Pattern</div>
                  <div style={{ paddingBottom: 22, marginBottom: 22, borderBottom: '1px solid ' + C.light }}>
                    <Pills options={PATTERNS} active={config.pattern} onPick={(p) => set({ pattern: p })} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ ...railLabel, marginBottom: 0 }}>Team Logos</div>
                    {logoCount > 0 && <div style={groupVal}>{logoCount} placed</div>}
                  </div>
                  {/* slot selector */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                    {LOGO_SLOTS.map((s) => {
                      const on = s.key === logoSlot; const has = config.logos && config.logos[s.key] && config.logos[s.key].src;
                      return (
                        <button key={s.key} onClick={() => setLogoSlot(s.key)} style={{ position: 'relative', fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '7px 11px', borderRadius: 4, background: on ? C.navy : '#fff', color: on ? '#fff' : C.navy, border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer' }}>
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
                        <input type="range" min="0.3" max="1.8" step="0.05" value={activeLogo.scale || 1} onChange={(e) => setLogo({ scale: parseFloat(e.target.value) })} style={{ flex: 1 }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                        <span style={{ width: 46, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy }}>Rotate</span>
                        <input type="range" min="-180" max="180" step="1" value={activeLogo.rot || 0} onChange={(e) => setLogo({ rot: parseInt(e.target.value, 10) })} style={{ flex: 1 }} />
                        <button onClick={() => setLogo({ rot: 0 })} title="Reset rotation" style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, color: C.textLight, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}>0°</button>
                      </div>
                      <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                        <label style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.navy, cursor: 'pointer' }}>
                          Replace<input type="file" accept="image/*" onChange={onLogoFile} style={{ display: 'none' }} />
                        </label>
                        <button onClick={() => setLogo({ src: null })} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: C.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
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
                </div>
              )}
              {step === 'numbers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <LabeledInput label="Player Name (Back)" value={config.playerName} onChange={(v) => set({ playerName: v })} maxLength={14} />
                  <LabeledInput label="Player Number" value={config.playerNumber} onChange={(v) => set({ playerNumber: v.replace(/[^0-9]/g, '').slice(0, 2) })} maxLength={2} />
                  <div style={{ paddingBottom: 22, borderBottom: '1px solid ' + C.light }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={groupHead}>Number Color</div><div style={groupVal}>{nameForHex(config.numberColor)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {PALETTE.map((p) => <Swatch key={p.hex} hex={p.hex} size={38} active={String(config.numberColor).toUpperCase() === p.hex.toUpperCase()} onClick={() => set({ numberColor: p.hex })} />)}
                    </div>
                  </div>
                  <div>
                    <div style={railLabel}>Number &amp; Name Font</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {FONTS.map((f) => {
                        const on = f.id === config.font;
                        return (
                          <button key={f.id} onClick={() => set({ font: f.id })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 14px', borderRadius: 4, background: on ? C.navy : '#fff', border: '1px solid ' + (on ? C.navy : C.mid), cursor: 'pointer' }}>
                            <span style={{ fontWeight: 800, fontSize: 18, color: on ? '#fff' : C.navy, WebkitTextStroke: f.hollow ? ('1px ' + (on ? '#fff' : C.navy)) : undefined, WebkitTextFillColor: f.hollow ? 'transparent' : undefined }}>23</span>
                            <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, color: on ? '#fff' : C.navy }}>{f.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ROSTER VIEW */}
        {step === 'roster' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '28px 40px', background: C.offWhite, overflow: 'auto' }}>
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
          </div>
        )}

        {/* FINALIZE VIEW */}
        {step === 'finalize' && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'auto', background: '#fff' }}>
            <div style={{ flex: 1, minWidth: 0, padding: '34px 40px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: C.red }}>Design Complete</div>
              <h2 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: C.navy, lineHeight: 1, margin: '2px 0 0' }}>{(config.teamName || 'Team').toUpperCase()}</h2>
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.textLight, margin: '6px 0 24px' }}>{(config.teamName || 'Team')} Home Jersey</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 640 }}>
                {['front', 'back'].map((v) => (
                  <div key={v} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: '100%', aspectRatio: '1/1', background: C.offWhite, border: '1px solid ' + C.light, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {review[v] ? <img src={review[v]} alt={v} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: C.textLight, fontSize: 13 }}>Rendering…</span>}
                    </div>
                    <span style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, color: C.textLight }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* summary */}
            <div style={{ width: 400, flexShrink: 0, borderLeft: '1px solid ' + C.light, padding: '32px 32px 40px', display: 'flex', flexDirection: 'column', background: C.offWhite, overflowY: 'auto' }}>
              <h3 style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', color: C.navy, margin: '0 0 6px' }}>You've Finished Designing</h3>
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 20 }}>Download your design or continue to place your team order. Your rep confirms every order within 24 hours.</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
                <button onClick={() => setStep('team')} style={{ flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: C.navy, background: '#fff', border: '1px solid ' + C.navy, borderRadius: 4, padding: '13px 10px', cursor: 'pointer' }}>Change Design</button>
                <button onClick={createOrder} style={{ flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: '#fff', background: C.red, border: '1px solid ' + C.red, borderRadius: 4, padding: '13px 10px', cursor: 'pointer' }}>Create Order</button>
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
                <button onClick={saveDesign} style={ghostBtn}>Save Design</button>
                <button onClick={downloadProofPDF} style={ghostBtn}>{busy ? 'Building…' : 'Proof PDF'}</button>
                <button onClick={downloadRoster} style={ghostBtn}>Roster CSV</button>
              </div>
              <div style={sectionHead}>Construction Materials</div>
              {[
                { label: 'Jersey Pattern', value: (PATTERNS.find((p) => p.id === config.pattern) || {}).label || 'Solid' },
                { label: 'Body', value: nameForHex(config.primary), sw: config.primary },
                { label: 'Stripe / Secondary', value: nameForHex(config.secondary), sw: config.secondary },
                { label: 'Sleeves / Trim', value: nameForHex(config.trim), sw: config.trim },
                { label: 'Collar Binding', value: nameForHex(config.trim), sw: config.trim },
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
                  <span style={{ fontFamily: F_BODY, fontSize: 12, color: C.textLight, textAlign: 'right' }}>#{r.nums}</span>
                </div>
              )) : <div style={{ fontFamily: F_BODY, fontSize: 13, color: C.textLight, padding: '9px 0' }}>No sizes assigned yet — add them in the Roster step.</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 15, borderTop: '2px solid ' + C.navy }}>
                <div style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textLight }}>{totalQty} jerseys · ${UNIT_PRICE} ea</div>
                <div style={{ fontFamily: F_DISP, fontWeight: 800, fontSize: 26, color: C.navy }}>${(totalQty * UNIT_PRICE).toLocaleString()}</div>
              </div>
              {ordered && <div style={{ marginTop: 18, padding: '14px 16px', background: '#fff', borderLeft: '3px solid ' + C.red, fontFamily: F_BODY, fontSize: 13, color: C.text, lineHeight: 1.6 }}>Order request received — your rep will follow up within 24 hours.</div>}
              {savedMsg && <div style={{ marginTop: 18, padding: '14px 16px', background: '#fff', borderLeft: '3px solid ' + C.navy, fontFamily: F_BODY, fontSize: 13, color: C.text }}>Design saved.</div>}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM BAR */}
      <div style={{ height: 72, flexShrink: 0, borderTop: '1px solid ' + C.light, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[config.primary, config.trim, config.secondary].map((c, i) => <span key={i} style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid ' + C.light }} />)}
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 14, color: C.text }}>{(config.teamName || 'TEAM').toUpperCase()} · No. {config.playerNumber || '—'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={goPrev} style={{ visibility: stepIdx === 0 ? 'hidden' : 'visible', fontFamily: F_DISP, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: C.navy, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '11px 18px', cursor: 'pointer' }}>Back</button>
          <button onClick={goNext} style={{ fontFamily: F_DISP, fontWeight: 700, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: '#fff', background: C.red, border: 'none', borderRadius: 4, padding: '12px 26px', cursor: 'pointer' }}>{nextLabel}</button>
        </div>
      </div>
    </div>
  );
}

const loadStyle = { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textLight, fontFamily: F_BODY };
const ghostBtn = { flex: 1, fontFamily: F_DISP, fontWeight: 700, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: C.textLight, background: 'none', border: '1px solid ' + C.mid, borderRadius: 4, padding: '10px 8px', cursor: 'pointer' };
const sectionHead = { fontFamily: F_DISP, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: C.navy, borderBottom: '2px solid ' + C.navy, paddingBottom: 8, marginBottom: 2 };
