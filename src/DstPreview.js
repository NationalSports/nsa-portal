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
// not green). Unknown names return null and draw grey so they stand out.
function inkHex(ink) {
  const s = String(ink || '').trim();
  const hex = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) return '#' + hex[1];
  const n = s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (THREAD_COLORS[n]) return THREAD_COLORS[n];
  let best = null;
  for (const k of Object.keys(THREAD_COLORS)) if (new RegExp('\\b' + k + '\\b').test(n) && (!best || k.length > best.length)) best = k;
  return best ? THREAD_COLORS[best] : null;
}
const UNKNOWN = '#9ca3af';
function shade(hex, f) {
  let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16), ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Draw the design centered in a size×size canvas. bg null = transparent (for export).
function drawDst(canvas, design, inks, bg, size) {
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
    const base = inkHex(inks[bi]) || UNKNOWN;
    // Two passes — a darker edge, then the thread color — give stitches some texture.
    [[shade(base, 0.72), lw], [base, lw * 0.6]].forEach(([color, w]) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      runs.forEach(r => { ctx.moveTo(r[0] * scale + ox, r[1] * scale + oy); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i] * scale + ox, r[i + 1] * scale + oy); });
      ctx.stroke();
    });
  });
}

function DstTile({ design, cw, idx, onEnlarge, onSetPreview, busy }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const inks = cw?.inks || [];
  const garmentHex = inkHex(cw?.garment_color);
  useEffect(() => { if (ref.current) drawDst(ref.current, design, inks, garmentHex || '#f8fafc', 440); }, [design, inks.join('|'), garmentHex]);
  const exportBlob = () => new Promise(res => { const c = document.createElement('canvas'); drawDst(c, design, inks, null, 1200); c.toBlob(res, 'image/png'); });
  const download = async () => { const b = await exportBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `stitch-preview-cw${idx + 1}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const stops = design.blocks.map((_, bi) => inks[bi] || '');
  const btn = { flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 10, fontWeight: 700, color: '#475569', padding: '5px 6px', cursor: 'pointer' };
  return <div style={{ width: 220, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    {/* Header — mirrors the color-way card: CW badge, garment swatch, garment name */}
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 10px', background: '#f8fafc', borderBottom: '1px solid #eef2f6' }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#475569', borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>{cw ? `CW ${idx + 1}` : 'Preview'}</span>
      <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: '1px solid #cbd5e1', background: garmentHex || 'repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#e2e8f0 3px,#e2e8f0 6px)' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: cw?.garment_color ? '#334155' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cw?.garment_color || 'Garment color not set'}</span>
    </div>
    {/* The stitch render */}
    <div style={{ position: 'relative', cursor: onEnlarge ? 'zoom-in' : 'default' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onEnlarge && ref.current && onEnlarge(ref.current.toDataURL('image/png'))} title={onEnlarge ? 'Click to enlarge' : undefined}>
      <canvas ref={ref} style={{ width: 220, height: 220, display: 'block' }} />
      {onEnlarge && <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 10, fontWeight: 700, color: 'white', background: 'rgba(15,23,42,0.6)', borderRadius: 6, padding: '2px 7px', opacity: hover ? 1 : 0, transition: 'opacity 0.15s' }}>⤢ Enlarge</span>}
    </div>
    {/* Thread stops in sew order — stop N is drawn in thread line N */}
    <div style={{ padding: '8px 10px', borderTop: '1px solid #eef2f6' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Thread stops</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        {stops.map((ink, si) => { const hex = inkHex(ink); return <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: ink ? '#334155' : '#b45309' }}>
          <span style={{ fontSize: 10, color: '#94a3b8', width: 12, textAlign: 'right', flexShrink: 0 }}>{si + 1}</span>
          <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: '1px solid #d1d5db', background: hex || UNKNOWN }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: ink ? 500 : 600 }}>{ink || 'No thread set'}</span>
        </div>; })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {onSetPreview && <button type="button" disabled={busy} style={{ ...btn, color: '#6d28d9', background: '#f5f3ff', borderColor: '#ddd6fe', opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }} title="Save this render (transparent PNG) as the art folder's preview image" onClick={async () => onSetPreview(await exportBlob())}>{busy ? 'Saving…' : '★ Set preview'}</button>}
        <button type="button" style={btn} title="Download a transparent PNG to drop into mockups" onClick={download}>⬇ PNG</button>
      </div>
    </div>
  </div>;
}

export default function DstPreview({ dstUrl, colorWays, onEnlarge, onSetPreview }) {
  const [design, setDesign] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; setDesign(null); setErr('');
    if (dstUrl) loadDst(dstUrl).then(d => live && setDesign(d), e => live && setErr(e.message || 'failed'));
    return () => { live = false; };
  }, [dstUrl]);
  if (!dstUrl) return null;
  const cws = (colorWays || []).length ? colorWays : [null];
  const blocks = design ? design.blocks.length : 0;
  const mismatch = design && cws.some(cw => cw && (cw.inks || []).filter(x => String(x || '').trim()).length !== blocks);
  const unknown = design ? [...new Set(cws.flatMap(cw => (cw?.inks || []).slice(0, blocks)).filter(x => String(x || '').trim() && !inkHex(x)))] : [];
  const setPreview = onSetPreview && (async blob => { setBusy(true); try { await onSetPreview(blob); } finally { setBusy(false); } });
  const note = (bg, bd, c) => ({ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, fontWeight: 600, color: c, background: bg, border: '1px solid ' + bd, borderRadius: 6, padding: '7px 10px', marginTop: 8 });
  return <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 0.3 }}>STITCH PREVIEW</span>
      <span style={{ fontSize: 9, color: '#94a3b8' }}>Drawn from the DST — change a thread color above and it updates here</span>
      {design && <span style={{ fontSize: 9, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', border: '1px solid #ddd6fe', borderRadius: 8, padding: '0 7px', lineHeight: '16px' }}>{blocks} stop{blocks === 1 ? '' : 's'} · {design.stitches.toLocaleString()} stitches</span>}
    </div>
    {err && <div style={note('#fffbeb', '#fde68a', '#b45309')}>⚠ Couldn't load the DST for a preview ({err}). The file is still attached — try re-uploading it if this keeps happening.</div>}
    {!err && !design && <div style={{ width: 220, height: 120, borderRadius: 10, border: '1px dashed #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#94a3b8' }}>Loading stitch file…</div>}
    {design && <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {cws.map((cw, ci) => <DstTile key={cw?.id || ci} design={design} cw={cw} idx={ci} onEnlarge={onEnlarge} onSetPreview={setPreview} busy={busy} />)}
      </div>
      {mismatch && <div style={note('#fffbeb', '#fde68a', '#b45309')}>⚠ This DST has {blocks} thread stops. List one thread per stop, in sew order — repeat a color if it's sewn twice.</div>}
      {unknown.length > 0 && <div style={note('#f8fafc', '#e2e8f0', '#64748b')}>No swatch for {unknown.join(', ')} — shown grey. Use a common color name (e.g. Kelly Green) or a hex code like #1b5e20.</div>}
    </>}
  </div>;
}

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
        out[a.id + '|' + (cw?.id || '')] = { url: c.toDataURL('image/png'), garment: cw?.garment_color || '' };
      }))
      .catch(() => {}));
  });
  await Promise.all(jobs);
  return out;
}
