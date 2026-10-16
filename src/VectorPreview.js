/* eslint-disable */
// Art preview for a print art folder (screen print, DTF, heat transfer…): draws the
// uploaded .svg — or an .ai converted to SVG on the fly — in each color way's inks.
// Each ink line in a color way links to the matching color in the art (bindInks — "PMS 123"
// finds the gold), so changing that line recolors that part of the art. Below the picture every
// art color is listed with the line it follows, and can be dropped out (transparent — e.g. a DTF
// white box).
// The vector-art counterpart of DstPreview's stitch preview.
//
// Shared by OrderEditorClassic and OrderEditor through ColorWaysEditor (CLAUDE.md: both
// editors), so the logic lives in one place; each editor only wires the props.
//
// The uploaded file is never changed. Choices are saved on the color way (cw.art_recolor,
// inside the existing color_ways JSON — no new column); with no color way they last for the
// session. The recolored art leaves the portal only as a web logo / PNG / SVG exported here.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { svgPalette, withDefaultFill, recolorSvg, recolorPlan, recolorMap, bindInks, hasArtPicks } from './lib/svgRecolor';
import { aiToSvg } from './lib/aiToSvg';
import { pantoneHex, threadHex, isStaleFile } from './constants';

const _ext = f => { const n = (typeof f === 'string' ? f : (f && (f.name || f.url)) || '').toLowerCase().split('?')[0]; const m = n.match(/\.(\w+)$/); return m ? m[1] : ''; };
const _url = f => (typeof f === 'string' ? f : (f && f.url) || '');

const _name = f => (typeof f === 'object' && f && f.name) || _url(f).split('?')[0].split('/').pop();
// Separation files (each ink split out, registration marks) aren't the design.
const _isSeps = f => /\bseps?\b|\bseparations?\b/i.test(_name(f));

// The art folder's design file: its newest live .svg or .ai, skipping separations and the SVGs
// the portal saved itself. { url, name, kind } or null. An .ai whose SVG the portal already saved
// (prod file with from_ai = the .ai's url) loads that SVG instead — { kind: 'svg', fromAi }.
// files: the folder's files when they don't live on art.files/prod_files (customer Art
// Library gathers production files from every order that uses the design).
function vectorSourceFor(art, files) {
  if (!art || art.deco_type === 'embroidery') return null;
  const live = (files || [...(art.files || []), ...(art.prod_files || [])]).filter(f => !isStaleFile(f) && /^https?:\/\//i.test(_url(f)));
  const f = live.filter(x => ['svg', 'ai'].includes(_ext(x)) && !(x && x.from_ai) && !_isSeps(x)).slice(-1)[0];
  if (!f) return null;
  if (_ext(f) === 'svg') return { url: _url(f), name: _name(f), kind: 'svg' };
  const saved = live.find(x => x && x.from_ai === _url(f));
  return saved ? { url: _url(saved), name: _name(f), kind: 'svg', fromAi: _url(f) } : { url: _url(f), name: _name(f), kind: 'ai' };
}

// url → Promise<{ svg, palette, kind }> — fetched, converted and analyzed once per file.
const _cache = new Map();
function loadVector(url, kind) {
  if (!_cache.has(url)) {
    const p = fetch(url, { mode: 'cors' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return kind === 'ai' ? r.arrayBuffer().then(aiToSvg) : r.text(); })
      .then(text => {
        if (!/<(?:[\w-]+:)?svg\b/i.test(text)) throw new Error('Not a readable SVG');
        const svg = withDefaultFill(text);
        // images: a pasted-in picture (photo / PNG) inside the art — its pixels can't be recolored.
        return { svg, palette: svgPalette(svg), kind, images: /<(?:[\w-]+:)?image\b/i.test(svg) };
      });
    p.catch(() => _cache.delete(url));
    _cache.set(url, p);
  }
  return _cache.get(url);
}
function useVectorArt(src) {
  const [state, setState] = useState({ art: null, err: '' });
  const url = src ? src.url : '', kind = src ? src.kind : '', fromAi = !!(src && src.fromAi);
  useEffect(() => {
    let live = true; setState({ art: null, err: '' });
    // An SVG the portal saved from an .ai still reads as "from .ai" (spot colors approximated).
    if (url) loadVector(url, kind).then(a => live && setState({ art: fromAi ? { ...a, kind: 'ai' } : a, err: '' }), e => live && setState({ art: null, err: e.message || 'failed' }));
    return () => { live = false; };
  }, [url, kind]);
  return state;
}

// Ink name → '#rrggbb': an explicit hex, a Pantone code, a common color name, or the
// customer's own saved Pantone/thread colors ([{code|name, hex}]). Unknown → null.
function inkToHex(ink, palette) {
  const s = String(ink || '').trim();
  if (!s) return null;
  const hex = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) return '#' + hex[1];
  const known = pantoneHex(s) || threadHex(s);
  if (known) return known;
  const n = s.toLowerCase().replace(/^pms\s*/, '');
  const own = (palette || []).find(p => p && [p.code, p.name].some(v => v && String(v).trim().toLowerCase().replace(/^pms\s*/, '') === n));
  return own && own.hex ? (own.hex[0] === '#' ? own.hex : '#' + own.hex) : null;
}

// Give the root <svg> an explicit pixel size so an <img> renders it at that resolution.
function sizedSvg(svg, longest) {
  const m = svg.match(/<(?:[\w-]+:)?svg\b[^>]*>/i);
  if (!m) return svg;
  const tag = m[0];
  const vb = (tag.match(/viewBox\s*=\s*["']([^"']+)["']/i) || [])[1];
  const num = a => parseFloat((tag.match(new RegExp('\\s' + a + '\\s*=\\s*["\']([\\d.]+)', 'i')) || [])[1]);
  let w = num('width'), h = num('height');
  if (vb) { const p = vb.trim().split(/[\s,]+/).map(Number); if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; } }
  if (!(w > 0 && h > 0)) { w = 1; h = 1; }
  const s = longest / Math.max(w, h);
  let t = tag.replace(/\s(width|height)\s*=\s*(["'])[^"']*\2/gi, '');
  if (!vb) t = t.replace(/(\/?>)$/, ` viewBox="0 0 ${w} ${h}"$1`);
  t = t.replace(/(\/?>)$/, ` width="${Math.round(w * s)}" height="${Math.round(h * s)}"$1`);
  return svg.slice(0, m.index) + t + svg.slice(m.index + tag.length);
}

// SVG text → a decoded <img>. Shown only through <img>/canvas — never inserted into the
// page — so an uploaded SVG can't run script.
function svgImage(svg, longest) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([sizedSvg(svg, longest)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not draw the SVG')); };
    img.src = url;
  });
}
// Where the visible art sits, as fractions of the artboard ({x,y,w,h}) — artboards often carry
// empty margin, so the art is trimmed to this before it's drawn. Found on a small render.
async function inkBounds(svg) {
  const img = await svgImage(svg, 512);
  const t = document.createElement('canvas'); t.width = img.width; t.height = img.height;
  const tc = t.getContext('2d'); tc.drawImage(img, 0, 0);
  let data;
  try { data = tc.getImageData(0, 0, t.width, t.height).data; } catch (e) { return { x: 0, y: 0, w: 1, h: 1 }; }
  let x0 = t.width, y0 = t.height, x1 = -1, y1 = -1;
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (data[(y * t.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null; // nothing visible (every color dropped out)
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(t.width - 1, x1 + 1); y1 = Math.min(t.height - 1, y1 + 1);
  return { x: x0 / t.width, y: y0 / t.height, w: (x1 - x0 + 1) / t.width, h: (y1 - y0 + 1) / t.height };
}
// Draw the trimmed art centered in a size×size canvas. bg null = transparent (exports).
// The full artboard is rendered just large enough that the trimmed art fills `size` sharply.
// isLive() false = a newer draw has started; this one stops before touching the canvas.
async function drawVector(canvas, svg, bg, size, isLive = () => true) {
  const box = await inkBounds(svg);
  const img = box ? await svgImage(svg, Math.min(8192, Math.ceil(size / Math.max(box.w, box.h)))) : null;
  if (!isLive()) return;
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0, 0, size, size);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  if (!img) return;
  const sx = box.x * img.width, sy = box.y * img.height, w = box.w * img.width, h = box.h * img.height;
  const pad = size * 0.06, s = (size - pad * 2) / Math.max(w, h);
  ctx.drawImage(img, sx, sy, w, h, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
}
const _checker = 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 10px 10px';

// The recolored SVG text for one color way.
function recolored(art, cw, dropouts, palette) {
  return recolorSvg(art.svg, recolorMap(art.palette, cw, dropouts, ink => inkToHex(ink, palette)));
}

// ── Auto web logo (order editors) — the counterpart of the stitch render's ──
// A color way is ready once it has colors set (a linked ink line or a drop-out); with neither the
// render is just the uploaded art, which may not suit the garment (the ★ button still saves it).
const artLogoReady = hasArtPicks;

// Links each color way's new ink lines to the art's matching colors (bindInks) and saves the links
// with one onBind(nextColorWays). Runs once the color ways have been still for 2s, so a half-typed
// ink name can't link to the wrong color and nothing edited meanwhile is overwritten.
function useInkBinding(art, cws, palette, onBind) {
  const list = cws || [];
  const sig = art && onBind ? JSON.stringify(list) + JSON.stringify(palette || []) : '';
  useEffect(() => {
    if (!sig) return;
    const t = setTimeout(() => {
      let changed = false;
      const next = list.map(cw => {
        const rc = cw && bindInks(art.palette, cw, ink => inkToHex(ink, palette));
        if (!rc) return cw;
        changed = true; return { ...cw, art_recolor: rc };
      });
      if (changed) onBind(next);
    }, 2000);
    return () => clearTimeout(t);
  }, [sig, art]); // eslint-disable-line react-hooks/exhaustive-deps
}
// What a color way's render shows, as text — the design file plus each color's outcome. It changes
// exactly when the render would, so an auto-saved logo is re-saved only when it changed.
function artRenderSig(src, art, cw) {
  const plan = recolorPlan(art.palette, cw, []), inks = (cw && cw.inks) || [];
  return (src.fromAi || src.url) + '|' + art.palette.map(c => {
    const p = plan[c.hex];
    return c.hex + '=' + (p === 'drop' ? 'drop' : p >= 0 ? String(inks[p]).trim() : 'keep');
  }).join(',');
}
// The color way's render as a transparent PNG File (1200px), for the web-logo upload.
async function artPngFile(art, cw, palette, name) {
  const c = document.createElement('canvas');
  await drawVector(c, recolored(art, cw, [], palette), null, 1200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([blob], name || 'art-render.png', { type: 'image/png' });
}

// One color way's render + its color list. No garment color → a checkerboard shows through, so
// dropped-out areas read as transparent. cw null = the art with no color way (e.g. DTF): colors
// can only be kept or dropped, held by the caller for the session.
//   onPatch({ art_drop, art_recolor? }) — save this color way's drop-outs
//   onDropouts(next [hex…])             — the no-color-way drop-outs
// autoLogo: the order editors save this render as the color way's web logo by themselves.
function VectorTile({ art, cw, idx, dropouts, onPatch, onDropouts, onEnlarge, onUseAsLogo, autoLogo = false, busy, compact = false, width = 220, palette, name }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const inks = (cw && cw.inks) || [];
  const garmentHex = cw ? inkToHex(cw.garment_color) : null;
  const plan = recolorPlan(art.palette, cw, dropouts);
  // Recoloring rewrites the whole file (can be MBs for traced art) — only when a choice changes.
  const svg = useMemo(() => recolored(art, cw, dropouts, palette),
    [art, inks.join('|'), JSON.stringify((cw && cw.art_recolor) || {}), ((cw && cw.art_drop) || []).join('|'), (dropouts || []).join('|'), JSON.stringify(palette || [])]);
  useEffect(() => { let live = true; if (ref.current) drawVector(ref.current, svg, garmentHex, 520, () => live).catch(() => {}); return () => { live = false; }; }, [svg, garmentHex]);
  const base = String(name || 'art').replace(/\.\w+$/, '').replace(/[^\w-]+/g, '_') + (cw ? '_' + String(cw.garment_color || 'cw' + (idx + 1)).replace(/[^\w-]+/g, '_') : '');
  const pngBlob = size => new Promise((res, rej) => { const c = document.createElement('canvas'); drawVector(c, svg, null, size).then(() => c.toBlob(res, 'image/png'), rej); });
  const save = (blob, file) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  // Drop a color out (or bring it back). A color way keeps them in art_drop, apart from the ink-line
  // links, so bringing a color back restores the ink it was linked to.
  const toggleDrop = (hex, on) => {
    if (!cw) { const d = new Set(dropouts || []); if (on) d.add(hex); else d.delete(hex); onDropouts && onDropouts([...d]); return; }
    const d = new Set(cw.art_drop || []); if (on) d.add(hex); else d.delete(hex);
    const patch = { art_drop: [...d] };
    if (!on && (cw.art_recolor || {})[hex] === 'drop') { const rc = { ...cw.art_recolor }; delete rc[hex]; patch.art_recolor = rc; }
    onPatch && onPatch(patch);
  };
  const dropped = art.palette.filter(c => plan[c.hex] === 'drop').length;
  const btn = { flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 10, fontWeight: 700, color: '#475569', padding: '5px 6px', cursor: 'pointer' };
  return <div style={{ width, flexShrink: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #eef2f6' }}>
      {!compact && <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#475569', borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>{cw ? `CW ${idx + 1}` : 'All garments'}</span>}
      {compact || !cw
        ? <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>Art preview</span>
        : <span style={{ fontSize: 11, fontWeight: 600, color: cw.garment_color ? '#334155' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cw.garment_color || 'Garment color not set'}</span>}
      {dropped > 0 && <span title={cw ? undefined : 'Not saved — add a color way to keep these picks'} style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: '#b45309', whiteSpace: 'nowrap' }}>{dropped} dropped{cw ? ' out' : ' · not saved'}</span>}
    </div>
    <div style={{ position: 'relative', cursor: onEnlarge ? 'zoom-in' : 'default', background: garmentHex ? undefined : _checker }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onEnlarge && ref.current && onEnlarge(ref.current.toDataURL('image/png'))} title={onEnlarge ? 'Click to enlarge' : undefined}>
      <canvas ref={ref} style={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }} />
      {onEnlarge && <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 10, fontWeight: 700, color: 'white', background: 'rgba(15,23,42,0.6)', borderRadius: 6, padding: '2px 7px', opacity: hover ? 1 : 0, transition: 'opacity 0.15s' }}>⤢ Enlarge</span>}
    </div>
    <div style={{ padding: '8px 10px', borderTop: '1px solid #eef2f6' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Colors in this art</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        {art.palette.map((c, ci) => {
          const p = plan[c.hex];
          const to = p === 'drop' ? null : p >= 0 ? (inkToHex(inks[p], palette) || '#9ca3af') : c.hex;
          return <div key={c.hex} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ fontSize: 10, color: '#94a3b8', width: 12, textAlign: 'right', flexShrink: 0 }}>{ci + 1}</span>
            <span title={'In the file: ' + c.hex + (c.members.length > 1 ? ' (+' + (c.members.length - 1) + ' similar shades)' : '')} style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: '1px solid #d1d5db', background: c.hex }} />
            <span style={{ color: '#cbd5e1', fontSize: 10 }}>→</span>
            <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: '1px solid #d1d5db', background: to || _checker }} />
            {/* Which ink line this color follows — change that line above to recolor it */}
            <span title={p === 'drop' ? 'Dropped out — no ink' : p >= 0 ? 'Follows ink line ' + (p + 1) + ' — change that line to recolor this part of the art' : (cw ? 'No ink line matches this color — it stays as it is in the file' : 'As it is in the file')}
              style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: p >= 0 ? '#334155' : '#94a3b8', fontWeight: p >= 0 ? 600 : 400, fontStyle: p === 'drop' ? 'italic' : undefined }}>
              {p === 'drop' ? 'Dropped out' : p >= 0 ? 'Line ' + (p + 1) + ' · ' + inks[p] : 'Original color'}</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 10, fontWeight: 600, color: p === 'drop' ? '#b45309' : '#64748b', cursor: 'pointer' }}>
              <input type="checkbox" checked={p === 'drop'} onChange={e => toggleDrop(c.hex, e.target.checked)} style={{ margin: 0 }} />Drop out</label>
          </div>;
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {autoLogo && artLogoReady(cw)
          ? <span style={{ ...btn, cursor: 'default', color: '#166534', background: '#f0fdf4', borderColor: '#bbf7d0' }} title="This art render IS the web logo — it saves automatically and updates when you change a color">✓ Web logo</span>
          : onUseAsLogo && <button type="button" disabled={busy} style={{ ...btn, color: '#6d28d9', background: '#f5f3ff', borderColor: '#ddd6fe', opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }} title="Save this render (transparent PNG) as this color way's web logo — used on webstores and as the logo detail on mockups and production sheets" onClick={async () => onUseAsLogo(await pngBlob(1200), cw)}>{busy ? 'Saving…' : '★ Web logo'}</button>}
        <button type="button" style={btn} title="Download a high-res transparent PNG (3000px) with these colors" onClick={async () => save(await pngBlob(3000), base + '.png')}>⬇ PNG</button>
        <button type="button" style={btn} title="Download the art as an SVG with these colors — opens in Illustrator, Inkscape, Canva…" onClick={() => save(new Blob([svg], { type: 'image/svg+xml' }), base + '.svg')}>⬇ SVG</button>
      </div>
    </div>
  </div>;
}

const _note = (bg, bd, c) => ({ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, fontWeight: 600, color: c, background: bg, border: '1px solid ' + bd, borderRadius: 6, padding: '7px 10px', marginTop: 8 });
// Badge for the section header: "🎨 3 colors · from .ai".
function VectorBadge({ art }) {
  if (!art) return null;
  const n = art.palette.length;
  return <span title={art.kind === 'ai' ? 'Converted from the uploaded .ai' : 'Read from the uploaded SVG'} style={{ fontSize: 9, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 8, padding: '0 7px', lineHeight: '16px' }}>🎨 {n} color{n === 1 ? '' : 's'}{art.kind === 'ai' ? ' · from .ai' : ''}</span>;
}
function VectorNotes({ art, err, colorWays, palette }) {
  if (err) return <div style={_note('#fffbeb', '#fde68a', '#b45309')}>⚠ Couldn't show the art preview ({err}). The file is still attached.</div>;
  if (!art) return null;
  const grouped = art.palette.some(c => c.members.length > 1);
  const unknown = [...new Set((colorWays || []).flatMap(cw => (cw && cw.inks) || []).filter(x => String(x || '').trim() && !inkToHex(x, palette)))];
  return <>
    {art.kind === 'ai' && <div style={_note('#f8fafc', '#e2e8f0', '#64748b')}>Preview converted from the .ai — Pantone spot colors show as close screen colors. The .ai stays the production file.</div>}
    {art.images && <div style={_note('#fffbeb', '#fde68a', '#b45309')}>⚠ Part of this art is a pasted-in picture (not vector), so its colors won't change here — ask the artist for a fully vector file.</div>}
    {grouped && <div style={_note('#f8fafc', '#e2e8f0', '#64748b')}>Look-alike shades are treated as one color (e.g. every white changes together){art.palette.length >= 12 ? ' — this art has many shades, so similar ones are grouped more loosely' : ''}.</div>}
    {unknown.length > 0 && <div style={_note('#f8fafc', '#e2e8f0', '#64748b')}>No swatch for {unknown.join(', ')} — those colors stay as they are in the file. Use a PMS code (e.g. 186 C), a common color name, or a hex code like #1b5e20.</div>}
  </>;
}
// Standalone block (customer Art Library): header + one tile per color way + notes — the
// counterpart of DstPreview's default export. onPatch(ci, patch) saves a color way's drop-outs and
// onBind(nextColorWays) its ink-line links; without them (read-only view) picks last for the session.
function VectorArtPreview({ src, colorWays, onPatch, onBind, onEnlarge, onUseAsLogo, palette }) {
  const { art, err } = useVectorArt(src);
  const [busy, setBusy] = useState(false);
  const [drops, setDrops] = useState([]); // no-color-way drop-outs (session only)
  const [local, setLocal] = useState({}); // cw id → patch, when there's no onPatch
  useInkBinding(art, colorWays, palette, onBind);
  if (!src) return null;
  const cws = (colorWays || []).length ? colorWays : [null];
  const useAsLogo = onUseAsLogo && (async (blob, cw) => { setBusy(true); try { await onUseAsLogo(blob, cw); } finally { setBusy(false); } });
  return <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 0.3 }}>ART PREVIEW</span>
      <span style={{ fontSize: 9, color: '#94a3b8' }}>Drawn from the {src.kind === 'ai' ? '.ai' : 'SVG'} — colors follow each color way's ink lines; drop out any you don't print</span>
      <VectorBadge art={art} />
    </div>
    {!err && !art && <VectorLoading kind={src.kind} />}
    {art && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {cws.map((cw, ci) => {
        const c = cw && !onPatch && local[cw.id] ? { ...cw, ...local[cw.id] } : cw;
        return <VectorTile key={cw?.id || ci} art={art} cw={c} idx={ci} width={240} dropouts={cw ? [] : drops} onDropouts={setDrops}
          onPatch={p => (onPatch ? onPatch(ci, p) : setLocal(l => ({ ...l, [cw.id]: { ...(l[cw.id] || {}), ...p } })))}
          onEnlarge={onEnlarge} onUseAsLogo={useAsLogo} busy={busy} palette={palette} name={src.name} />;
      })}
    </div>}
    <VectorNotes art={art} err={err} colorWays={colorWays} palette={palette} />
  </div>;
}
const VectorLoading = ({ width = 220, kind }) => <div style={{ width, height: 120, flexShrink: 0, borderRadius: 10, border: '1px dashed #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#94a3b8' }}>{kind === 'ai' ? 'Converting .ai…' : 'Loading art…'}</div>;

export { vectorSourceFor, useVectorArt, useInkBinding, VectorArtPreview, VectorTile, artLogoReady, artRenderSig, artPngFile, VectorBadge, VectorNotes, VectorLoading, inkToHex, sizedSvg };
