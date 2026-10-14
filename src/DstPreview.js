/* eslint-disable */
// Stitch preview for an embroidery art folder: draws the uploaded DST in the
// thread colors from each color way, so changing "Dark Green" → "Kelly Green"
// in the thread list recolors the picture immediately. Block N of the DST is
// sewn in thread line N (the order Wilcom's proof lists them, which is also the
// order the PDF auto-read fills them in).
//
// Shared by OrderEditorClassic and OrderEditor (CLAUDE.md: both editors) so the
// drawing logic lives in one place; each editor only wires the upload/save.
import React, { useEffect, useRef, useState } from 'react';
import { parseDst } from './lib/dstParser';
import { THREAD_COLORS, artLiveDsts } from './constants';

const _dstCache = new Map(); // url → Promise<design>
function loadDst(url) {
  if (!_dstCache.has(url)) {
    const p = fetch(url, { mode: 'cors' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(buf => { const d = parseDst(buf); if (!d) throw new Error('Not a readable DST'); return d; });
    p.catch(() => _dstCache.delete(url));
    _dstCache.set(url, p);
  }
  return _dstCache.get(url);
}

// Best color for a thread line: an explicit hex wins, then the exact thread
// name, then the LONGEST known name inside it ("Dark Green (1)" → dark green,
// not green), then the account's own thread colors (palette = [{name,hex}]), then a known
// name that starts with it ("Vegas" → vegas gold). Unknown names return null and draw grey.
function inkHex(ink, palette) {
  const s = String(ink || '').trim();
  const hex = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) return '#' + hex[1];
  const n = s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (THREAD_COLORS[n]) return THREAD_COLORS[n];
  let best = null;
  for (const k of Object.keys(THREAD_COLORS)) if (new RegExp('\\b' + k + '\\b').test(n) && (!best || k.length > best.length)) best = k;
  if (best) return THREAD_COLORS[best];
  const own = (palette || []).find(p => p && String(p.name || '').trim().toLowerCase() === n);
  if (own) { const h = String(own.hex || '').trim(); if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return h[0] === '#' ? h : '#' + h; }
  const pre = Object.keys(THREAD_COLORS).filter(k => k.startsWith(n + ' ')).sort((a, b) => a.length - b.length)[0];
  return pre ? THREAD_COLORS[pre] : null;
}
const UNKNOWN = '#9ca3af';
function shade(hex, f) {
  let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16), ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Draw the design centered in a size×size canvas. bg null = transparent (for export).
function drawDst(canvas, design, inks, bg, size, palette) {
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0, 0, size, size);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  const { minX, minY, width, height } = design.bounds;
  const pad = size * 0.06, scale = (size - pad * 2) / Math.max(width, height, 1);
  const ox = (size - width * scale) / 2 - minX * scale, oy = (size - height * scale) / 2 - minY * scale;
  const lw = Math.max(0.8, 4 * scale); // ~0.4 mm thread
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  design.blocks.forEach((runs, bi) => {
    const base = inkHex(inks[bi], palette) || UNKNOWN;
    // Two passes — a darker edge, then the thread color — give stitches some texture.
    [[shade(base, 0.72), lw], [base, lw * 0.6]].forEach(([color, w]) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      runs.forEach(r => { ctx.moveTo(r[0] * scale + ox, r[1] * scale + oy); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i] * scale + ox, r[i + 1] * scale + oy); });
      ctx.stroke();
    });
  });
}

// One color way's render. `compact` = sitting beside/under its own color-way card in
// ColorWaysEditor, so the card already shows the CW badge and thread list — the tile
// is just the picture plus actions. Otherwise it carries its own header + stop list.
function DstTile({ design, cw, idx, onEnlarge, onUseAsLogo, busy, compact = false, width = 220, palette }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const inks = cw?.inks || [];
  const garmentHex = inkHex(cw?.garment_color);
  useEffect(() => { if (ref.current) drawDst(ref.current, design, inks, garmentHex || '#f8fafc', 520, palette); }, [design, inks.join('|'), garmentHex, palette]);
  const exportBlob = () => new Promise(res => { const c = document.createElement('canvas'); drawDst(c, design, inks, null, 1200, palette); c.toBlob(res, 'image/png'); });
  const download = async () => { const b = await exportBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `stitch-preview-cw${idx + 1}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const stops = design.blocks.map((_, bi) => inks[bi] || '');
  const setCount = stops.filter(x => String(x).trim()).length;
  const btn = { flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 10, fontWeight: 700, color: '#475569', padding: '5px 6px', cursor: 'pointer' };
  return <div style={{ width, flexShrink: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    {/* Header — mirrors the color-way card: CW badge, garment swatch, garment name */}
    {compact
      ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #eef2f6' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>Stitch preview</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: setCount === stops.length ? '#6d28d9' : '#b45309' }}>{setCount}/{stops.length} stops set</span>
        </div>
      : <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 10px', background: '#f8fafc', borderBottom: '1px solid #eef2f6' }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#475569', borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>{cw ? `CW ${idx + 1}` : 'Preview'}</span>
          <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: '1px solid #cbd5e1', background: garmentHex || 'repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#e2e8f0 3px,#e2e8f0 6px)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: cw?.garment_color ? '#334155' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cw?.garment_color || 'Garment color not set'}</span>
        </div>}
    {/* The stitch render — square, scales with the tile */}
    <div style={{ position: 'relative', cursor: onEnlarge ? 'zoom-in' : 'default' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onEnlarge && ref.current && onEnlarge(ref.current.toDataURL('image/png'))} title={onEnlarge ? 'Click to enlarge' : undefined}>
      <canvas ref={ref} style={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }} />
      {onEnlarge && <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 10, fontWeight: 700, color: 'white', background: 'rgba(15,23,42,0.6)', borderRadius: 6, padding: '2px 7px', opacity: hover ? 1 : 0, transition: 'opacity 0.15s' }}>⤢ Enlarge</span>}
    </div>
    <div style={{ padding: '8px 10px', borderTop: '1px solid #eef2f6' }}>
      {/* Thread stops in sew order — stop N is drawn in thread line N */}
      {!compact && <>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Thread stops</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
          {stops.map((ink, si) => { const hex = inkHex(ink, palette); return <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: ink ? '#334155' : '#b45309' }}>
            <span style={{ fontSize: 10, color: '#94a3b8', width: 12, textAlign: 'right', flexShrink: 0 }}>{si + 1}</span>
            <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: '1px solid #d1d5db', background: hex || UNKNOWN }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: ink ? 500 : 600 }}>{ink || 'No thread set'}</span>
          </div>; })}
        </div>
      </>}
      <div style={{ display: 'flex', gap: 6 }}>
        {onUseAsLogo && <button type="button" disabled={busy} style={{ ...btn, color: '#6d28d9', background: '#f5f3ff', borderColor: '#ddd6fe', opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }} title="Save this render (transparent PNG) as this color way's web logo — used on webstores and as the logo detail on mockups and production sheets" onClick={async () => onUseAsLogo(await exportBlob(), cw)}>{busy ? 'Saving…' : '★ Web logo'}</button>}
        <button type="button" style={btn} title="Download a transparent PNG to drop into mockups" onClick={download}>⬇ PNG</button>
      </div>
    </div>
  </div>;
}

// Load + parse a DST once per url (cached across renders/components).
function useDstDesign(dstUrl) {
  const [state, setState] = useState({ design: null, err: '' });
  useEffect(() => {
    let live = true; setState({ design: null, err: '' });
    if (dstUrl) loadDst(dstUrl).then(d => live && setState({ design: d, err: '' }), e => live && setState({ design: null, err: e.message || 'failed' }));
    return () => { live = false; };
  }, [dstUrl]);
  return state;
}

const _note = (bg, bd, c) => ({ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, fontWeight: 600, color: c, background: bg, border: '1px solid ' + bd, borderRadius: 6, padding: '7px 10px', marginTop: 8 });
// Badge for the section header: "4 stops · 13,402 stitches".
function StitchBadge({ design }) {
  if (!design) return null;
  const n = design.blocks.length;
  return <span title="Read from the uploaded DST" style={{ fontSize: 9, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', border: '1px solid #ddd6fe', borderRadius: 8, padding: '0 7px', lineHeight: '16px' }}>🧵 {n} stop{n === 1 ? '' : 's'} · {design.stitches.toLocaleString()} stitches</span>;
}
// Load error / stop-count mismatch / unknown thread names, under the previews.
function StitchNotes({ design, err, colorWays, palette }) {
  if (err) return <div style={_note('#fffbeb', '#fde68a', '#b45309')}>⚠ Couldn't load the DST for a preview ({err}). The file is still attached — try re-uploading it if this keeps happening.</div>;
  if (!design) return null;
  const blocks = design.blocks.length;
  const cws = colorWays || [];
  const mismatch = cws.some(cw => cw && (cw.inks || []).filter(x => String(x || '').trim()).length !== blocks);
  const unknown = [...new Set(cws.flatMap(cw => (cw?.inks || []).slice(0, blocks)).filter(x => String(x || '').trim() && !inkHex(x, palette)))];
  return <>
    {mismatch && <div style={_note('#fffbeb', '#fde68a', '#b45309')}>⚠ This DST has {blocks} thread stops. List one thread per stop, in sew order — repeat a color if it's sewn twice.</div>}
    {unknown.length > 0 && <div style={_note('#f8fafc', '#e2e8f0', '#64748b')}>No swatch for {unknown.join(', ')} — shown grey. Use a common color name (e.g. Kelly Green) or a hex code like #1b5e20.</div>}
  </>;
}
const StitchLoading = ({ width = 220 }) => <div style={{ width, height: 120, flexShrink: 0, borderRadius: 10, border: '1px dashed #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#94a3b8' }}>Loading stitch file…</div>;

// Standalone block (customer art library): header + one tile per color way + notes.
export default function DstPreview({ dstUrl, colorWays, onEnlarge, onUseAsLogo, palette }) {
  const { design, err } = useDstDesign(dstUrl);
  const [busy, setBusy] = useState(false);
  if (!dstUrl) return null;
  const cws = (colorWays || []).length ? colorWays : [null];
  const useAsLogo = onUseAsLogo && (async (blob, cw) => { setBusy(true); try { await onUseAsLogo(blob, cw); } finally { setBusy(false); } });
  return <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 0.3 }}>STITCH PREVIEW</span>
      <span style={{ fontSize: 9, color: '#94a3b8' }}>Drawn from the DST — change a thread color and it updates here</span>
      <StitchBadge design={design} />
    </div>
    {!err && !design && <StitchLoading />}
    {design && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {cws.map((cw, ci) => <DstTile key={cw?.id || ci} design={design} cw={cw} idx={ci} onEnlarge={onEnlarge} onUseAsLogo={useAsLogo} busy={busy} palette={palette} />)}
    </div>}
    <StitchNotes design={design} err={err} colorWays={colorWays} palette={palette} />
  </div>;
}

// Embroidery logo detail source: the folder's live DST + the color way's threads, or null.
function stitchSourceFor(art, colorWayId) {
  if (!art || art.deco_type !== 'embroidery') return null;
  const dst = artLiveDsts(art).slice(-1)[0];
  const dstUrl = dst ? (typeof dst === 'string' ? dst : (dst.url || '')) : '';
  if (!/^https?:\/\//i.test(dstUrl)) return null;
  const cw = (art.color_ways || []).find(c => c && c.id === colorWayId) || ((art.color_ways || []).length === 1 ? art.color_ways[0] : null);
  return { dstUrl, inks: cw?.inks || [], label: cw?.garment_color || '' };
}
// Transparent stitch render sized to its box (logo detail frame paints the garment color behind).
function StitchCanvas({ design, inks, style }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && design) drawDst(ref.current, design, inks || [], null, 520); }, [design, (inks || []).join('|')]);
  return <canvas ref={ref} style={{ display: 'block', aspectRatio: '1 / 1', maxWidth: '100%', maxHeight: '100%', ...style }} />;
}
// Full-resolution transparent PNG File of a design in the given threads (for logo uploads).
function stitchPngFile(design, inks, name) {
  return new Promise(res => { const c = document.createElement('canvas'); drawDst(c, design, inks || [], null, 1200); c.toBlob(b => res(new File([b], name || 'stitch-render.png', { type: 'image/png' })), 'image/png'); });
}

export { DstTile, useDstDesign, StitchBadge, StitchNotes, StitchLoading, stitchSourceFor, StitchCanvas, stitchPngFile };

// ── For printed sheets (production sheet, job art sheet) ──
// Draws each embroidery design's live DST in every color way's threads as a PNG
// data URL, at print time, so the sheet always matches the current thread list.
// Returns { [artId+'|'+colorWayId]: { url, garment } } ('' colorWayId = no color way).
// A DST that can't be fetched within the timeout is skipped — never blocks printing.
export async function stitchPreviewsFor(artFiles, { size = 520, timeoutMs = 8000 } = {}) {
  const out = {};
  const jobs = [];
  (artFiles || []).forEach(a => {
    if (!a || a.deco_type !== 'embroidery') return;
    const dst = artLiveDsts(a).slice(-1)[0];
    const url = dst ? (typeof dst === 'string' ? dst : (dst.url || '')) : '';
    if (!/^https?:\/\//i.test(url)) return;
    const cws = (a.color_ways || []).length ? a.color_ways : [null];
    jobs.push(Promise.race([loadDst(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))])
      .then(design => cws.forEach(cw => {
        const c = document.createElement('canvas');
        drawDst(c, design, cw?.inks || [], null, size);
        // WebP (~56KB vs ~150KB PNG) keeps the server-rendered PDF request small; browsers that
        // can't encode WebP return PNG from the same call.
        out[a.id + '|' + (cw?.id || '')] = { url: c.toDataURL('image/webp', 0.9), garment: cw?.garment_color || '' };
      }))
      .catch(() => {}));
  });
  await Promise.all(jobs);
  return out;
}
