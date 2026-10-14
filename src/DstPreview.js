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
import { THREAD_COLORS } from './constants';

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
  const inks = cw?.inks || [];
  const garmentHex = inkHex(cw?.garment_color);
  useEffect(() => { if (ref.current) drawDst(ref.current, design, inks, garmentHex || '#f1f5f9', 360); }, [design, inks.join('|'), garmentHex]);
  const exportBlob = () => new Promise(res => { const c = document.createElement('canvas'); drawDst(c, design, inks, null, 1200); c.toBlob(res, 'image/png'); });
  const btn = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 10, fontWeight: 600, color: '#475569', padding: '3px 8px', cursor: 'pointer' };
  return <div style={{ width: 180, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
    <canvas ref={ref} title="Click to enlarge" onClick={() => onEnlarge && onEnlarge(ref.current.toDataURL('image/png'))} style={{ width: 180, height: 180, display: 'block', cursor: onEnlarge ? 'zoom-in' : 'default' }} />
    <div style={{ padding: '6px 8px', borderTop: '1px solid #eef2f6' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cw ? `CW ${idx + 1} · ${cw.garment_color || 'no garment color'}` : 'No color way yet'}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {onSetPreview && <button type="button" disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }} title="Save this stitch render (transparent PNG) as the folder's preview image" onClick={async () => onSetPreview(await exportBlob())}>Set as preview</button>}
        <button type="button" style={btn} title="Download a transparent PNG to use in mockups" onClick={async () => { const b = await exportBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `stitch-preview-cw${idx + 1}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>PNG</button>
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
  const unknown = design && [...new Set(cws.flatMap(cw => (cw?.inks || []).slice(0, blocks)).filter(x => String(x || '').trim() && !inkHex(x)))];
  const setPreview = onSetPreview && (async blob => { setBusy(true); try { await onSetPreview(blob); } finally { setBusy(false); } });
  return <div style={{ marginBottom: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 0.3 }}>STITCH PREVIEW</span>
      <span style={{ fontSize: 9, color: '#94a3b8' }}>Drawn from the DST — edit a thread color above and it updates here{design ? ` · ${blocks} thread stop${blocks === 1 ? '' : 's'} · ${design.stitches.toLocaleString()} stitches` : ''}</span>
    </div>
    {err && <div style={{ fontSize: 11, color: '#b45309' }}>Couldn't load the DST for a preview ({err}).</div>}
    {!err && !design && <div style={{ fontSize: 11, color: '#94a3b8' }}>Loading stitch file…</div>}
    {design && <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cws.map((cw, ci) => <DstTile key={cw?.id || ci} design={design} cw={cw} idx={ci} onEnlarge={onEnlarge} onSetPreview={setPreview} busy={busy} />)}
      </div>
      {mismatch && <div style={{ fontSize: 10, color: '#b45309', marginTop: 4 }}>The DST has {blocks} thread stops — list one thread per stop, in sew order (repeat a color if it's used twice). Missing lines draw grey.</div>}
      {unknown && unknown.length > 0 && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>No swatch for: {unknown.join(', ')} — drawn grey. Type a known color name or a hex like #1b5e20.</div>}
    </>}
  </div>;
}

export { inkHex, drawDst };
