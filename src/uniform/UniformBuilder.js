/* eslint-disable */
// Uniform Builder — full custom-uniform designer.
//
// Left rail  : garment + fabric + zone list + swatch palette + custom-SVG upload
// Center     : live, interactive SVG proof (click a zone to select, drag number/name)
// Right rail : selected-zone color/pattern controls, number/name typography, AI
//              design prompt, and saved designs
// Export     : high-res PNG, front+back production proof, vector SVG, spec JSON
//
// The SVG here is the interactive editor; the pixel-accurate production output is
// produced by renderCanvas.js from the SAME templates + pattern tiles, so what a
// coach sees is what the shop prints.

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { listTemplates, getTemplate, registerTemplate, parseUploadedSvg } from './templates';
import { FONTS, fontStack, fontWeight } from './fonts';
import { makePatternTile, makeFabricOverlay } from './patterns';
import { renderToDataURL, renderProductionSheet, renderProductionPDF } from './renderCanvas';
import * as ds from './designSpec';

// ── palette / tiny style kit (mirrors the app's NSA design tokens) ───────────
const NSA = {
  navy: '#192853', navyDark: '#0F1A38', red: '#962C32', redBright: '#B8333B',
  white: '#fff', offWhite: '#F7F8FB', light: '#EEF1F6', mid: '#D1D5DE',
  text: '#2A2F3E', textLight: '#5A6075', textMuted: '#8A90A0', green: '#1F7A3D',
};
const F_DISPLAY = "'Saira Condensed','Barlow Condensed','Arial Narrow',sans-serif";
const F_BODY = "'Source Sans 3','Segoe UI',system-ui,sans-serif";
const railLabel = { fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: NSA.textLight, margin: '2px 0 8px' };
const btn = (active) => ({ cursor: 'pointer', border: '1.5px solid ' + (active ? NSA.navy : NSA.mid), background: active ? NSA.navy : '#fff', color: active ? '#fff' : NSA.textLight, padding: '7px 12px', borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: .5, textTransform: 'uppercase' });
const cta = { cursor: 'pointer', border: 'none', background: NSA.red, color: '#fff', padding: '9px 16px', borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: .6, textTransform: 'uppercase' };
const field = { width: '100%', boxSizing: 'border-box', border: '1.5px solid ' + NSA.mid, borderRadius: 6, padding: '8px 10px', fontFamily: F_BODY, fontSize: 14, color: NSA.text };

function parseVB(vb) { const [x, y, w, h] = String(vb).split(/[\s,]+/).map(Number); return { x: x || 0, y: y || 0, w: w || 400, h: h || 480 }; }

// ── interactive SVG proof ────────────────────────────────────────────────────
function UniformSvg({ spec, view, selectedZone, onSelectZone, onDragText, svgRef, selectedLogoId, onSelectLogo, onDragLogo, onResizeLogo }) {
  const tpl = getTemplate(spec.garmentId);
  const v = tpl.views[view] || tpl.views.front;
  const vb = parseVB(v.viewBox);
  const dragRef = useRef(null);

  // Build pattern/gradient <defs> + fill refs for each zone. Memoized on the
  // zones + fabric so we don't re-rasterize tiles on every pointer move.
  const { defs, fillFor, fabricFill } = useMemo(() => {
    const defsEls = [];
    const fillFor = {};
    v.zones.forEach((z) => {
      const zs = spec.zones[z.id] || ds.DEFAULT_ZONE;
      const color = ds.toHex(zs.color, '#1f2a44');
      const color2 = ds.toHex(zs.color2, '#ffffff');
      if (!zs.pattern || zs.pattern === 'solid') { fillFor[z.id] = color; return; }
      if (zs.pattern === 'fade') {
        const gid = `fade-${z.id}`;
        defsEls.push(
          <linearGradient key={gid} id={gid} x1="0" y1={vb.y} x2="0" y2={vb.y + vb.h} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={color} /><stop offset="1" stopColor={color2} />
          </linearGradient>
        );
        fillFor[z.id] = `url(#${gid})`; return;
      }
      const tile = makePatternTile(zs.pattern, color, color2);
      if (!tile) { fillFor[z.id] = color; return; }
      const pid = `pat-${z.id}`;
      const url = tile.toDataURL();
      defsEls.push(
        <pattern key={pid} id={pid} patternUnits="userSpaceOnUse" width={tile.width} height={tile.height}>
          <image href={url} xlinkHref={url} width={tile.width} height={tile.height} />
        </pattern>
      );
      fillFor[z.id] = `url(#${pid})`;
    });
    // Fabric overlay pattern (clipped to silhouette via a group clip-path).
    let fabricFill = null;
    const fo = makeFabricOverlay(spec.fabric);
    if (fo) {
      const url = fo.toDataURL();
      defsEls.push(
        <pattern key="fabric" id="fabric-tex" patternUnits="userSpaceOnUse" width={fo.width} height={fo.height}>
          <image href={url} xlinkHref={url} width={fo.width} height={fo.height} />
        </pattern>
      );
      fabricFill = 'url(#fabric-tex)';
    }
    return { defs: defsEls, fillFor, fabricFill };
  }, [spec.zones, spec.fabric, spec.garmentId, view]);

  const clientToFrac = (e) => {
    const svg = svgRef.current; if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    return { x: ds.clamp((p.x - vb.x) / vb.w, 0, 1), y: ds.clamp((p.y - vb.y) / vb.h, 0, 1) };
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const f = clientToFrac(e); if (!f) return;
    if (d.kind === 'text') { onDragText(d.role, f); return; }
    if (d.kind === 'logo' && d.mode === 'move') { onDragLogo(d.id, f); return; }
    if (d.kind === 'logo' && d.mode === 'resize') {
      const logo = (spec.logos[view] || []).find((l) => l.id === d.id); if (!logo) return;
      // width fraction from radial distance of the pointer to the logo center
      const dx = (f.x - logo.x) * vb.w, dy = (f.y - logo.y) * vb.h;
      const w = ds.clamp((2 * Math.hypot(dx, dy)) / (vb.w * Math.hypot(1, logo.aspect || 1)), 0.03, 1);
      onResizeLogo(d.id, w);
    }
  };
  const endDrag = () => { dragRef.current = null; };

  const text = spec.text[view] || {};
  const renderText = (role) => {
    const el = text[role]; if (!el || !(el.value || '').trim()) return null;
    const anchor = v.anchors[role] || { x: 0.5, y: 0.45, size: 100 };
    const x = (Number.isFinite(el.x) ? el.x : anchor.x) * vb.w + vb.x;
    const y = (Number.isFinite(el.y) ? el.y : anchor.y) * vb.h + vb.y;
    const size = anchor.size * (el.size || 1);
    const fill = ds.toHex(el.fill, '#fff');
    let outline = el.outline === 'auto' ? ds.contrastInk(fill) : el.outline;
    const stroke = (outline && outline !== 'none' && el.outlineWidth > 0) ? ds.toHex(outline, '#111') : 'none';
    return (
      <text key={role} x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fontFamily={fontStack(el.font)} fontWeight={fontWeight(el.font)} fontSize={size}
        fill={fill} stroke={stroke} strokeWidth={stroke === 'none' ? 0 : el.outlineWidth * 2}
        paintOrder="stroke" style={{ letterSpacing: (el.letterSpacing || 0) + 'px', cursor: 'move', userSelect: 'none' }}
        onPointerDown={(e) => { e.preventDefault(); dragRef.current = { kind: 'text', role }; }}>
        {el.value}
      </text>
    );
  };

  const logos = spec.logos[view] || [];
  const renderLogo = (l) => {
    const w = l.w * vb.w, h = w * (l.aspect || 1);
    const cx = l.x * vb.w, cy = l.y * vb.h;
    const sel = selectedLogoId === l.id;
    return (
      <g key={l.id} transform={`rotate(${l.rotation || 0} ${cx} ${cy})`} opacity={l.opacity} style={{ cursor: 'move' }}
        onPointerDown={(e) => { e.preventDefault(); onSelectLogo(l.id); dragRef.current = { kind: 'logo', id: l.id, mode: 'move' }; }}>
        <image href={l.src} xlinkHref={l.src} x={cx - w / 2} y={cy - h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
        {sel && (
          <g pointerEvents="visiblePainted">
            <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} fill="none" stroke={NSA.redBright} strokeWidth="2" strokeDasharray="5 4" />
            <rect x={cx + w / 2 - 7} y={cy + h / 2 - 7} width="14" height="14" fill={NSA.navy} stroke="#fff" strokeWidth="1.5" style={{ cursor: 'nwse-resize' }}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelectLogo(l.id); dragRef.current = { kind: 'logo', id: l.id, mode: 'resize' }; }} />
          </g>
        )}
      </g>
    );
  };

  const silD = v.zones.map((z) => z.d).join(' ');
  return (
    <svg ref={svgRef} viewBox={v.viewBox} style={{ width: '100%', height: '100%', touchAction: 'none' }}
      onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
      <defs>
        {defs}
        <clipPath id="silo"><path d={silD} /></clipPath>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0F1A38" floodOpacity="0.28" />
        </filter>
      </defs>
      {/* shadow pass */}
      <path d={silD} fill="#ffffff" filter="url(#soft)" />
      {/* zones */}
      {v.zones.map((z) => (
        <path key={z.id} d={z.d} fill={fillFor[z.id]} onClick={() => onSelectZone(z.id)}
          style={{ cursor: 'pointer' }} />
      ))}
      {/* fabric texture */}
      {fabricFill && <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={fabricFill} clipPath="url(#silo)" pointerEvents="none" />}
      {/* seams */}
      {(v.seams || []).map((s, i) => <path key={i} d={s.d} fill="none" stroke="rgba(15,26,56,0.32)" strokeWidth="1.2" pointerEvents="none" />)}
      {/* edge */}
      <path d={silD} fill="none" stroke="rgba(15,26,56,0.5)" strokeWidth="1.6" pointerEvents="none" />
      {/* selection highlight */}
      {selectedZone && v.zones.find((z) => z.id === selectedZone) &&
        <path d={v.zones.find((z) => z.id === selectedZone).d} fill="none" stroke={NSA.redBright} strokeWidth="3" strokeDasharray="7 5" pointerEvents="none" />}
      {/* uploaded logos (above garment, below lettering) */}
      {logos.map(renderLogo)}
      {renderText('name')}
      {renderText('number')}
    </svg>
  );
}

// ── swatch chip ──────────────────────────────────────────────────────────────
const Swatch = ({ hex, size = 22, active, onClick, title }) => (
  <button type="button" title={title} onClick={onClick}
    style={{ width: size, height: size, borderRadius: 5, background: hex, cursor: 'pointer',
      border: active ? `3px solid ${NSA.navy}` : '1.5px solid rgba(0,0,0,0.18)', padding: 0, boxShadow: active ? '0 0 0 2px #fff inset' : 'none' }} />
);

function download(dataUrl, filename) {
  const a = document.createElement('a'); a.href = dataUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

const AI_EXAMPLES = [
  'Aggressive red and black with camo sleeves and a bold block number',
  'Classic navy and vegas gold, pinstripe body, collegiate font',
  'Carolina blue fade to white, clean modern look',
  'Blackout uniform, charcoal digital camo, neon green number',
];

export default function UniformBuilder({ onExit }) {
  const [spec, setSpec] = useState(() => ds.makeDefaultSpec('crew_jersey'));
  const [view, setView] = useState('front');
  const [selectedZone, setSelectedZone] = useState('body');
  const [selectedLogoId, setSelectedLogoId] = useState(null);
  const [tab, setTab] = useState('design'); // design | text | art | ai | saved
  const [templates, setTemplates] = useState(() => listTemplates());
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [saved, setSaved] = useState(() => loadSaved());
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const svgRef = useRef(null);
  const historyRef = useRef([]);
  const fileRef = useRef(null);
  const logoFileRef = useRef(null);

  const tpl = getTemplate(spec.garmentId);
  const view0 = tpl.views[view] || tpl.views.front;

  const pushHistory = useCallback((prev) => { historyRef.current.push(JSON.stringify(prev)); if (historyRef.current.length > 40) historyRef.current.shift(); }, []);
  const commit = useCallback((updater) => setSpec((prev) => { pushHistory(prev); return typeof updater === 'function' ? updater(prev) : updater; }), [pushHistory]);
  const undo = () => { const h = historyRef.current.pop(); if (h) setSpec(JSON.parse(h)); };

  const flashMsg = (m) => { setFlash(m); setTimeout(() => setFlash(''), 2200); };

  // zone mutation
  const setZone = (patch) => commit((prev) => ({ ...prev, zones: { ...prev.zones, [selectedZone]: { ...(prev.zones[selectedZone] || ds.DEFAULT_ZONE), ...patch } } }));
  const setText = (role, patch) => commit((prev) => ({ ...prev, text: { ...prev.text, [view]: { ...prev.text[view], [role]: { ...prev.text[view][role], ...patch } } } }));
  const dragText = (role, frac) => setSpec((prev) => ({ ...prev, text: { ...prev.text, [view]: { ...prev.text[view], [role]: { ...prev.text[view][role], x: frac.x, y: frac.y } } } }));
  const setGarment = (id) => commit((prev) => ({ ...prev, garmentId: id }));
  const setFabric = (id) => commit((prev) => ({ ...prev, fabric: id }));

  // ── logo layers ─────────────────────────────────────────────────────────────
  const selectZone = (id) => { setSelectedZone(id); setSelectedLogoId(null); };
  const dragLogo = (id, frac) => setSpec((prev) => ({ ...prev, logos: { ...prev.logos, [view]: prev.logos[view].map((l) => l.id === id ? { ...l, x: frac.x, y: frac.y } : l) } }));
  const resizeLogo = (id, w) => setSpec((prev) => ({ ...prev, logos: { ...prev.logos, [view]: prev.logos[view].map((l) => l.id === id ? { ...l, w } : l) } }));
  const updateLogo = (id, patch) => commit((prev) => ({ ...prev, logos: { ...prev.logos, [view]: prev.logos[view].map((l) => l.id === id ? { ...l, ...patch } : l) } }));
  const removeLogo = (id) => { commit((prev) => ({ ...prev, logos: { ...prev.logos, [view]: prev.logos[view].filter((l) => l.id !== id) } })); if (selectedLogoId === id) setSelectedLogoId(null); };

  const addLogo = async (file) => {
    if (!file) return;
    try {
      const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const aspect = await new Promise((res) => { const im = new Image(); im.onload = () => res(im.naturalHeight && im.naturalWidth ? im.naturalHeight / im.naturalWidth : 1); im.onerror = () => res(1); im.src = src; });
      const logo = ds.cleanLogo({ src, aspect, x: 0.5, y: 0.32, w: 0.28 });
      if (!logo) { flashMsg('Unsupported image.'); return; }
      commit((prev) => ({ ...prev, logos: { ...prev.logos, [view]: [...prev.logos[view], logo].slice(0, 8) } }));
      setSelectedLogoId(logo.id); setTab('art');
      flashMsg('Logo added — drag it onto the jersey');
    } catch (_e) { flashMsg('Could not add that image.'); }
  };

  // Vectorize a raster logo client-side (imagetracerjs) into a crisp SVG so it's
  // production-ready. Skips SVGs (already vector).
  const vectorizeLogo = async (id) => {
    const logo = (spec.logos[view] || []).find((l) => l.id === id); if (!logo) return;
    if (/^data:image\/svg/i.test(logo.src)) { flashMsg('Already a vector logo.'); return; }
    setBusy('Vectorizing…');
    try {
      const ImageTracer = (await import('imagetracerjs')).default;
      const svg = await new Promise((res, rej) => {
        ImageTracer.imageToSVG(logo.src, (s) => res(s), { scale: 1, ltres: 1, qtres: 1, numberofcolors: 16, pathomit: 8 });
        setTimeout(() => rej(new Error('timeout')), 15000);
      });
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      updateLogo(id, { src: dataUrl });
      flashMsg('Logo vectorized');
    } catch (_e) { flashMsg('Vectorize failed — keeping original.'); } finally { setBusy(''); }
  };

  // ensure selected zone exists on the current garment
  useEffect(() => {
    const ids = view0.zones.map((z) => z.id);
    if (!ids.includes(selectedZone)) setSelectedZone(ids[0]);
  }, [spec.garmentId, view]); // eslint-disable-line

  const zoneSpec = spec.zones[selectedZone] || ds.DEFAULT_ZONE;
  const zoneLabel = (view0.zones.find((z) => z.id === selectedZone) || {}).label || selectedZone;

  // ── AI design ──────────────────────────────────────────────────────────────
  const runAI = async (prompt) => {
    const p = (prompt || aiPrompt).trim();
    if (!p) return;
    setAiBusy(true); setAiError('');
    try {
      const r = await fetch('/.netlify/functions/uniform-ai-design', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, garmentId: spec.garmentId, currentSpec: spec }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `AI error (${r.status})`);
      pushHistory(spec);
      setSpec(ds.normalizeSpec(data.spec, spec));
      flashMsg('AI design applied — tweak anything you like');
    } catch (e) {
      setAiError((e && e.message) || 'Could not reach the AI designer.');
    } finally { setAiBusy(false); }
  };

  // ── custom SVG upload ────────────────────────────────────────────────────────
  const onUploadSvg = async (file) => {
    if (!file) return;
    try {
      const txt = await file.text();
      const t = parseUploadedSvg(txt, `custom_${Date.now()}`);
      if (!t) { flashMsg('Could not read zones from that SVG.'); return; }
      registerTemplate(t);
      setTemplates(listTemplates());
      commit((prev) => ({ ...prev, garmentId: t.id }));
      flashMsg(`Imported "${file.name}" as a template`);
    } catch (_e) { flashMsg('Upload failed.'); }
  };

  // ── exports ──────────────────────────────────────────────────────────────────
  const exportPNG = async () => {
    setBusy('Rendering PNG…');
    try { const url = await renderToDataURL(spec, { view, width: 1400, background: '#ffffff' }); download(url, `uniform-${spec.garmentId}-${view}.png`); } finally { setBusy(''); }
  };
  const exportProof = async () => {
    setBusy('Building production proof…');
    try { const url = await renderProductionSheet(spec, { width: 900 }); download(url, `uniform-${spec.garmentId}-proof.png`); } finally { setBusy(''); }
  };
  const exportSVG = () => {
    const node = svgRef.current; if (!node) return;
    const clone = node.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    download('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str), `uniform-${spec.garmentId}-${view}.svg`);
  };
  const exportSpec = () => {
    const str = JSON.stringify(buildProductionSpec(spec), null, 2);
    download('data:application/json;charset=utf-8,' + encodeURIComponent(str), `uniform-${spec.garmentId}-spec.json`);
  };
  const exportPDF = async () => {
    setBusy('Building PDF proof…');
    try { const doc = await renderProductionPDF(spec); doc.save(`uniform-${spec.garmentId}-proof.pdf`); } catch (e) { flashMsg('PDF export failed.'); } finally { setBusy(''); }
  };

  // ── save / load ──────────────────────────────────────────────────────────────
  const saveDesign = async () => {
    setBusy('Saving…');
    try {
      const thumb = await renderToDataURL(spec, { view: 'front', width: 320, background: '#ffffff' });
      const name = (spec.meta && spec.meta.teamName) || `${tpl.name} design`;
      const rec = { id: `d_${Date.now()}`, name, ts: Date.now(), spec, thumb };
      const next = [rec, ...saved].slice(0, 60);
      setSaved(next); persistSaved(next);
      trySupabaseSave(rec).catch(() => {});
      flashMsg('Design saved');
    } finally { setBusy(''); }
  };
  const loadDesign = (rec) => { pushHistory(spec); setSpec(ds.normalizeSpec(rec.spec)); flashMsg(`Loaded "${rec.name}"`); };
  const deleteDesign = (id) => { const next = saved.filter((s) => s.id !== id); setSaved(next); persistSaved(next); };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: NSA.offWhite, display: 'flex', flexDirection: 'column', fontFamily: F_BODY, color: NSA.text, zIndex: 50 }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: NSA.navy, color: '#fff', flexShrink: 0 }}>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 22, letterSpacing: .5, textTransform: 'uppercase' }}>Uniform Builder</div>
        <div style={{ opacity: .6, fontSize: 12, fontFamily: F_DISPLAY, letterSpacing: 1 }}>NATIONAL SPORTS</div>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn(false), background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} onClick={undo}>↶ Undo</button>
        <button style={{ ...btn(false), background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} onClick={() => commit(ds.makeDefaultSpec(spec.garmentId))}>Reset</button>
        <button style={cta} onClick={saveDesign}>Save Design</button>
        {onExit && <button style={{ ...btn(false), background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} onClick={onExit}>✕ Close</button>}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* ── left rail ── */}
        <div style={{ width: 240, flexShrink: 0, background: '#fff', borderRight: '1px solid ' + NSA.light, overflowY: 'auto', padding: 16 }}>
          <div style={railLabel}>Garment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {templates.map((t) => (
              <button key={t.id} style={{ ...btn(spec.garmentId === t.id), fontSize: 12, padding: '8px 6px' }} onClick={() => setGarment(t.id)}>{t.name}</button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/svg+xml,.svg" style={{ display: 'none' }} onChange={(e) => { onUploadSvg(e.target.files[0]); e.target.value = ''; }} />
          <button style={{ ...btn(false), width: '100%', marginTop: 8, fontSize: 12 }} onClick={() => fileRef.current && fileRef.current.click()}>⭱ Upload SVG Template</button>

          <div style={{ ...railLabel, marginTop: 20 }}>Fabric</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ds.FABRICS.map((f) => <button key={f.id} style={{ ...btn(spec.fabric === f.id), fontSize: 11, padding: '6px 9px' }} onClick={() => setFabric(f.id)}>{f.label}</button>)}
          </div>

          <div style={{ ...railLabel, marginTop: 20 }}>Zones — tap to edit</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {view0.zones.map((z) => {
              const zs = spec.zones[z.id] || ds.DEFAULT_ZONE;
              return (
                <button key={z.id} onClick={() => { setSelectedZone(z.id); setTab('design'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', padding: '7px 9px', borderRadius: 6,
                    border: '1.5px solid ' + (selectedZone === z.id ? NSA.navy : NSA.light), background: selectedZone === z.id ? NSA.offWhite : '#fff' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: ds.toHex(zs.color), border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{z.label}</span>
                  {zs.pattern !== 'solid' && <span style={{ marginLeft: 'auto', fontSize: 10, color: NSA.textMuted, textTransform: 'uppercase' }}>{zs.pattern}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── center stage ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid ' + NSA.light, background: '#fff' }}>
            <button style={btn(view === 'front')} onClick={() => setView('front')}>Front</button>
            <button style={btn(view === 'back')} onClick={() => setView('back')}>Back</button>
            <div style={{ flex: 1 }} />
            <button style={btn(false)} onClick={exportPNG}>⤓ PNG</button>
            <button style={btn(false)} onClick={exportSVG}>⤓ SVG</button>
            <button style={btn(false)} onClick={exportSpec}>⤓ Spec</button>
            <button style={btn(false)} onClick={exportProof}>⤓ Proof PNG</button>
            <button style={cta} onClick={exportPDF}>Production PDF</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 0, background: 'radial-gradient(circle at 50% 35%, #fff 0%, ' + NSA.light + ' 100%)' }}>
            <div style={{ height: '100%', maxHeight: 620, aspectRatio: `${parseVB(view0.viewBox).w} / ${parseVB(view0.viewBox).h}` }}>
              <UniformSvg spec={spec} view={view} selectedZone={selectedZone} onSelectZone={selectZone} onDragText={dragText} svgRef={svgRef}
                selectedLogoId={selectedLogoId} onSelectLogo={setSelectedLogoId} onDragLogo={dragLogo} onResizeLogo={resizeLogo} />
            </div>
          </div>
          {(busy || flash) && (
            <div style={{ padding: '8px 16px', background: busy ? NSA.navy : NSA.green, color: '#fff', fontSize: 13, fontWeight: 600 }}>{busy || flash}</div>
          )}
        </div>

        {/* ── right rail ── */}
        <div style={{ width: 320, flexShrink: 0, background: '#fff', borderLeft: '1px solid ' + NSA.light, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid ' + NSA.light }}>
            {['design', 'text', 'art', 'ai', 'saved'].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, cursor: 'pointer', border: 'none', background: tab === t ? NSA.offWhite : '#fff', color: tab === t ? NSA.navy : NSA.textLight,
                padding: '11px 4px', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: .5, textTransform: 'uppercase', borderBottom: '3px solid ' + (tab === t ? NSA.red : 'transparent') }}>
                {t === 'ai' ? '✨ AI' : t}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {tab === 'design' && (
              <div>
                <div style={railLabel}>{zoneLabel} · Color</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {ds.PALETTE.map((p) => <Swatch key={p.hex} hex={p.hex} title={p.name} active={ds.toHex(zoneSpec.color) === p.hex} onClick={() => setZone({ color: p.hex })} />)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <input type="color" value={ds.toHex(zoneSpec.color)} onChange={(e) => setZone({ color: e.target.value })} style={{ width: 40, height: 34, border: 'none', background: 'none' }} />
                  <input style={field} value={ds.toHex(zoneSpec.color)} onChange={(e) => { const h = ds.toHex(e.target.value); if (h) setZone({ color: h }); }} />
                </div>

                <div style={railLabel}>Pattern</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {ds.PATTERNS.map((p) => <button key={p.id} style={{ ...btn(zoneSpec.pattern === p.id), fontSize: 11, padding: '6px 9px' }} onClick={() => setZone({ pattern: p.id })}>{p.label}</button>)}
                </div>

                {zoneSpec.pattern !== 'solid' && (
                  <>
                    <div style={railLabel}>Secondary Color</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {ds.PALETTE.map((p) => <Swatch key={p.hex} hex={p.hex} size={20} title={p.name} active={ds.toHex(zoneSpec.color2) === p.hex} onClick={() => setZone({ color2: p.hex })} />)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="color" value={ds.toHex(zoneSpec.color2)} onChange={(e) => setZone({ color2: e.target.value })} style={{ width: 40, height: 34, border: 'none', background: 'none' }} />
                      <input style={field} value={ds.toHex(zoneSpec.color2)} onChange={(e) => { const h = ds.toHex(e.target.value); if (h) setZone({ color2: h }); }} />
                    </div>
                  </>
                )}

                <div style={{ marginTop: 18, padding: 12, background: NSA.offWhite, borderRadius: 8, fontSize: 12, color: NSA.textLight }}>
                  Apply this color to every zone:
                  <button style={{ ...btn(false), width: '100%', marginTop: 8, fontSize: 12 }} onClick={() => commit((prev) => { const z = { ...prev.zones }; view0.zones.forEach((zz) => { z[zz.id] = { ...z[zz.id], color: zoneSpec.color }; }); return { ...prev, zones: z }; })}>Fill all zones</button>
                </div>
              </div>
            )}

            {tab === 'text' && (
              <div>
                {['number', 'name'].map((role) => {
                  const el = spec.text[view][role];
                  return (
                    <div key={role} style={{ marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid ' + NSA.light }}>
                      <div style={railLabel}>{role} ({view})</div>
                      <input style={{ ...field, marginBottom: 8 }} placeholder={role === 'number' ? 'e.g. 23' : 'e.g. JOHNSON'} value={el.value} onChange={(e) => setText(role, { value: e.target.value })} maxLength={role === 'number' ? 3 : 20} />
                      <select style={{ ...field, marginBottom: 8 }} value={el.font} onChange={(e) => setText(role, { font: e.target.value })}>
                        {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ fontSize: 12, color: NSA.textLight }}>Fill</label>
                        <input type="color" value={ds.toHex(el.fill)} onChange={(e) => setText(role, { fill: e.target.value })} style={{ width: 34, height: 30, border: 'none', background: 'none' }} />
                        <label style={{ fontSize: 12, color: NSA.textLight }}>Outline</label>
                        <input type="color" value={ds.toHex(el.outline === 'auto' ? ds.contrastInk(ds.toHex(el.fill)) : el.outline, '#111827')} onChange={(e) => setText(role, { outline: e.target.value })} style={{ width: 34, height: 30, border: 'none', background: 'none' }} />
                        <button style={{ ...btn(el.outline === 'none'), fontSize: 11, padding: '5px 8px' }} onClick={() => setText(role, { outline: el.outline === 'none' ? 'auto' : 'none' })}>No outline</button>
                      </div>
                      <label style={{ fontSize: 12, color: NSA.textLight }}>Size</label>
                      <input type="range" min="0.3" max="2.6" step="0.05" value={el.size} onChange={(e) => setText(role, { size: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                      <label style={{ fontSize: 12, color: NSA.textLight }}>Outline width</label>
                      <input type="range" min="0" max="16" step="0.5" value={el.outlineWidth} onChange={(e) => setText(role, { outlineWidth: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                      <label style={{ fontSize: 12, color: NSA.textLight }}>Letter spacing</label>
                      <input type="range" min="-6" max="30" step="1" value={el.letterSpacing} onChange={(e) => setText(role, { letterSpacing: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                    </div>
                  );
                })}
                <div style={{ fontSize: 12, color: NSA.textMuted }}>Tip: drag the number or name right on the jersey to reposition it.</div>
              </div>
            )}

            {tab === 'art' && (
              <div>
                <div style={railLabel}>Logos & Artwork ({view})</div>
                <input ref={logoFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { addLogo(e.target.files[0]); e.target.value = ''; }} />
                <button style={{ ...cta, width: '100%' }} onClick={() => logoFileRef.current && logoFileRef.current.click()}>⭱ Upload Logo</button>
                <div style={{ fontSize: 12, color: NSA.textMuted, margin: '8px 0 14px' }}>PNG, JPG, or SVG. Drag it on the jersey to place; drag the corner handle to resize.</div>

                {(() => {
                  const logos = spec.logos[view] || [];
                  if (!logos.length) return <div style={{ fontSize: 13, color: NSA.textMuted }}>No logos on the {view} yet.</div>;
                  const sel = logos.find((l) => l.id === selectedLogoId);
                  return (
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                        {logos.map((l) => (
                          <div key={l.id} onClick={() => setSelectedLogoId(l.id)} title="Select"
                            style={{ width: 54, height: 54, border: '2px solid ' + (selectedLogoId === l.id ? NSA.navy : NSA.light), borderRadius: 8, background: '#fff url(' + l.src + ') center/contain no-repeat', cursor: 'pointer' }} />
                        ))}
                      </div>
                      {sel && (
                        <div style={{ borderTop: '1px solid ' + NSA.light, paddingTop: 12 }}>
                          <div style={railLabel}>Selected Logo</div>
                          <label style={{ fontSize: 12, color: NSA.textLight }}>Size</label>
                          <input type="range" min="0.05" max="0.85" step="0.01" value={sel.w} onChange={(e) => updateLogo(sel.id, { w: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                          <label style={{ fontSize: 12, color: NSA.textLight }}>Rotation</label>
                          <input type="range" min="-180" max="180" step="1" value={sel.rotation} onChange={(e) => updateLogo(sel.id, { rotation: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                          <label style={{ fontSize: 12, color: NSA.textLight }}>Opacity</label>
                          <input type="range" min="0.1" max="1" step="0.05" value={sel.opacity} onChange={(e) => updateLogo(sel.id, { opacity: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button style={{ ...btn(false), flex: 1, fontSize: 12 }} onClick={() => vectorizeLogo(sel.id)} title="Trace to vector for production">Vectorize</button>
                            <button style={{ ...btn(false), flex: 1, fontSize: 12, color: NSA.red, borderColor: NSA.mid }} onClick={() => removeLogo(sel.id)}>Delete</button>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 11, color: NSA.textMuted }}>Vectorize traces a raster logo into clean SVG paths for cutting/printing. Vector logos scale with no fuzzy edges.</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {tab === 'ai' && (
              <div>
                <div style={railLabel}>✨ Design with AI</div>
                <div style={{ fontSize: 12, color: NSA.textLight, marginBottom: 8 }}>Describe the look you want. AI sets colors, patterns, and fonts — then you can fine-tune everything.</div>
                <textarea style={{ ...field, minHeight: 90, resize: 'vertical' }} placeholder="e.g. Aggressive red and black, camo sleeves, big block number" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
                <button style={{ ...cta, width: '100%', marginTop: 8, opacity: aiBusy ? .6 : 1 }} disabled={aiBusy} onClick={() => runAI()}>{aiBusy ? 'Designing…' : 'Generate Design'}</button>
                {aiError && <div style={{ marginTop: 8, fontSize: 12, color: NSA.red }}>{aiError}</div>}
                <div style={{ ...railLabel, marginTop: 18 }}>Try one</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {AI_EXAMPLES.map((ex) => <button key={ex} style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid ' + NSA.light, background: NSA.offWhite, borderRadius: 6, padding: '8px 10px', fontSize: 12.5, color: NSA.text }} onClick={() => { setAiPrompt(ex); runAI(ex); }}>{ex}</button>)}
                </div>
                <div style={{ marginTop: 16, fontSize: 11, color: NSA.textMuted }}>Coming soon: upload your team logo and let AI match the palette (Claude Vision).</div>
              </div>
            )}

            {tab === 'saved' && (
              <div>
                <div style={railLabel}>Saved Designs</div>
                {!saved.length && <div style={{ fontSize: 13, color: NSA.textMuted }}>No saved designs yet. Hit “Save Design” up top.</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {saved.map((rec) => (
                    <div key={rec.id} style={{ border: '1px solid ' + NSA.light, borderRadius: 8, overflow: 'hidden' }}>
                      <img src={rec.thumb} alt={rec.name} style={{ width: '100%', display: 'block', cursor: 'pointer', background: '#fff' }} onClick={() => loadDesign(rec)} />
                      <div style={{ padding: '6px 8px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.name}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button style={{ ...btn(false), fontSize: 10, padding: '3px 7px' }} onClick={() => loadDesign(rec)}>Open</button>
                          <button style={{ ...btn(false), fontSize: 10, padding: '3px 7px', color: NSA.red, borderColor: NSA.mid }} onClick={() => deleteDesign(rec.id)}>Del</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* team name / notes footer */}
          <div style={{ borderTop: '1px solid ' + NSA.light, padding: 12 }}>
            <input style={{ ...field, marginBottom: 6 }} placeholder="Team name" value={spec.meta.teamName} onChange={(e) => setSpec((p) => ({ ...p, meta: { ...p.meta, teamName: e.target.value } }))} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── production spec (what the shop reads) ────────────────────────────────────
function buildProductionSpec(spec) {
  spec = ds.normalizeSpec(spec);
  const tpl = getTemplate(spec.garmentId);
  const zoneRows = {};
  const view = tpl.views.front;
  view.zones.forEach((z) => {
    const zs = spec.zones[z.id]; if (!zs) return;
    zoneRows[z.label] = { color: zs.color, colorName: ds.nameForHex(zs.color), pattern: zs.pattern, secondaryColor: zs.pattern !== 'solid' ? zs.color2 : undefined };
  });
  const textRows = {};
  ['front', 'back'].forEach((v) => {
    ['number', 'name'].forEach((r) => {
      const t = spec.text[v][r]; if (!t || !(t.value || '').trim()) return;
      textRows[`${v} ${r}`] = { value: t.value, font: t.font, fill: t.fill, fillName: ds.nameForHex(t.fill) };
    });
  });
  return { garment: tpl.name, garmentId: spec.garmentId, fabric: spec.fabric, team: spec.meta.teamName || null, zones: zoneRows, lettering: textRows, generatedAt: new Date().toISOString() };
}

// ── persistence helpers ──────────────────────────────────────────────────────
const LS_KEY = 'nsa_uniform_designs';
function loadSaved() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
function persistSaved(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (_e) { /* quota */ } }

// Best-effort server save so designs survive across devices. Silent no-op if the
// table/RLS isn't set up yet (localStorage remains the source of truth for the demo).
async function trySupabaseSave(rec) {
  try {
    const mod = await import('../lib/supabase');
    const sb = mod.supabase;
    if (!sb) return;
    await sb.from('uniform_designs').insert({ name: rec.name, spec: rec.spec, thumb: rec.thumb });
  } catch (_e) { /* ignore */ }
}
