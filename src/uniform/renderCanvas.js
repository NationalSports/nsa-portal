// Uniform Builder — Canvas 2D production renderer.
//
// Draws a design spec onto a real <canvas> using Path2D for every zone. This is
// the "push to 2D production" path: canvas text honors document-loaded webfonts
// (unlike an SVG rasterized through an <img>, which can't see them), so the
// exported PNG matches the on-screen SVG preview exactly — same template paths,
// same pattern tiles, same fonts.
//
// It also doubles as the texture source a future 3D preview would wrap on a
// garment mesh: call renderUniform() into an offscreen canvas and hand that
// canvas to three.js as a THREE.CanvasTexture. Nothing else has to change.

import { makePatternTile, makeFabricOverlay } from './patterns';
import { fontShorthand, ensureFontsReady } from './fonts';
import { getTemplate } from './templates';

const ds = require('./designSpec');

function parseViewBox(vb) {
  const [x, y, w, h] = String(vb).split(/[\s,]+/).map(Number);
  return { x: x || 0, y: y || 0, w: w || 400, h: h || 480 };
}

// Concatenate every zone path into one Path2D — the full garment silhouette.
// Used for the fabric-texture clip, the gloss highlight, and the edge shadow.
function silhouette(view) {
  const p = new Path2D();
  for (const z of view.zones) { try { p.addPath(new Path2D(z.d)); } catch (_e) { /* skip bad path */ } }
  return p;
}

// Fill one zone according to its pattern. `s` is the viewBox→pixel scale, passed
// so tile/gradient density stays constant no matter what size we export at.
function fillZone(ctx, path, zone, vb, s) {
  const color = ds.toHex(zone.color, '#1f2a44');
  const color2 = ds.toHex(zone.color2, '#ffffff');
  const pat = zone.pattern || 'solid';

  if (pat === 'solid') {
    ctx.fillStyle = color;
    ctx.fill(path);
    return;
  }
  if (pat === 'fade') {
    const g = ctx.createLinearGradient(0, vb.y, 0, vb.y + vb.h);
    g.addColorStop(0, color);
    g.addColorStop(1, color2);
    ctx.fillStyle = g;
    ctx.fill(path);
    return;
  }
  const tile = makePatternTile(pat, color, color2);
  if (!tile) { ctx.fillStyle = color; ctx.fill(path); return; }
  const cp = ctx.createPattern(tile, 'repeat');
  // Counter-scale the pattern so tiles are drawn at device resolution rather than
  // being magnified by the garment scale — keeps stripes/camo a consistent size.
  if (cp && typeof cp.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
    try { cp.setTransform(new DOMMatrix().scale(1 / s)); } catch (_e) { /* older browsers */ }
  }
  ctx.fillStyle = cp || color;
  ctx.fill(path);
}

// Draw one text element (number or name).
function drawText(ctx, el, view, vb) {
  const value = (el.value || '').trim();
  if (!value) return;
  const anchor = view.anchors[el._role] || { x: 0.5, y: 0.45, size: 100 };
  const px = (Number.isFinite(el.x) ? el.x : anchor.x) * vb.w + vb.x;
  const py = (Number.isFinite(el.y) ? el.y : anchor.y) * vb.h + vb.y;
  const size = anchor.size * (el.size || 1);

  ctx.save();
  ctx.font = fontShorthand(el.font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) { try { ctx.letterSpacing = `${el.letterSpacing || 0}px`; } catch (_e) { /* unsupported */ } }
  ctx.lineJoin = 'round';

  const fill = ds.toHex(el.fill, '#ffffff');
  let outline = el.outline;
  if (outline === 'auto') outline = ds.contrastInk(fill);
  if (outline && outline !== 'none' && el.outlineWidth > 0) {
    ctx.strokeStyle = ds.toHex(outline, '#111827');
    ctx.lineWidth = el.outlineWidth * 2; // stroke straddles the path; ×2 ≈ visible width
    ctx.strokeText(value, px, py);
  }
  ctx.fillStyle = fill;
  ctx.fillText(value, px, py);
  ctx.restore();
}

// Core: render the whole garment into `canvas`. Returns { width, height }.
// options: { width, background, showText }
export function renderUniform(canvas, spec, opts = {}) {
  spec = ds.normalizeSpec(spec);
  const tpl = getTemplate(spec.garmentId);
  const viewName = opts.view || 'front';
  const view = tpl.views[viewName] || tpl.views.front;
  const vb = parseViewBox(view.viewBox);

  const width = opts.width || 900;
  const s = width / vb.w;
  const height = Math.round(vb.h * s);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (opts.background !== 'transparent') {
    ctx.fillStyle = opts.background || '#f4f6fb';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-vb.x, -vb.y);

  // Soft ground shadow for depth.
  const sil = silhouette(view);
  ctx.save();
  ctx.shadowColor = 'rgba(15,26,56,0.28)';
  ctx.shadowBlur = 14; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#000';
  ctx.fill(sil);
  ctx.restore();

  // Zones, bottom layer first.
  for (const z of view.zones) {
    const zone = spec.zones[z.id] || ds.DEFAULT_ZONE;
    let path;
    try { path = new Path2D(z.d); } catch (_e) { continue; }
    fillZone(ctx, path, zone, vb, s);
  }

  // Fabric surface texture, clipped to the silhouette.
  const overlay = makeFabricOverlay(spec.fabric);
  if (overlay) {
    ctx.save();
    ctx.clip(sil);
    const cp = ctx.createPattern(overlay, 'repeat');
    if (cp && typeof cp.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
      try { cp.setTransform(new DOMMatrix().scale(1 / s)); } catch (_e) { /* noop */ }
    }
    ctx.fillStyle = cp; ctx.fillRect(vb.x, vb.y, vb.w, vb.h);
    ctx.restore();
  }
  // Gloss fabric: a soft top-down white highlight.
  if (spec.fabric === 'gloss') {
    ctx.save();
    ctx.clip(sil);
    const g = ctx.createLinearGradient(0, vb.y, 0, vb.y + vb.h * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(vb.x, vb.y, vb.w, vb.h);
    ctx.restore();
  }

  // Seams.
  ctx.strokeStyle = 'rgba(15,26,56,0.32)';
  ctx.lineWidth = 1.2;
  for (const sm of (view.seams || [])) {
    try { ctx.stroke(new Path2D(sm.d)); } catch (_e) { /* skip */ }
  }
  // Silhouette edge.
  ctx.strokeStyle = 'rgba(15,26,56,0.5)';
  ctx.lineWidth = 1.6;
  ctx.stroke(sil);

  // Numbers + names.
  if (opts.showText !== false) {
    const t = spec.text[viewName] || {};
    if (t.name) drawText(ctx, { ...t.name, _role: 'name' }, view, vb);
    if (t.number) drawText(ctx, { ...t.number, _role: 'number' }, view, vb);
  }

  ctx.restore();
  return { width, height };
}

// Convenience: render to a fresh canvas and return a PNG data URL. Waits for
// webfonts first so the export never captures a fallback face.
export async function renderToDataURL(spec, opts = {}) {
  await ensureFontsReady();
  const canvas = document.createElement('canvas');
  renderUniform(canvas, spec, opts);
  return canvas.toDataURL('image/png');
}

// Render both sides side-by-side onto one canvas — the production "flat" a shop
// prints from. Includes a small colorway legend strip beneath each side.
export async function renderProductionSheet(spec, opts = {}) {
  await ensureFontsReady();
  const per = opts.width || 700;
  const front = document.createElement('canvas');
  const back = document.createElement('canvas');
  const f = renderUniform(front, spec, { ...opts, view: 'front', width: per, background: '#ffffff' });
  const b = renderUniform(back, spec, { ...opts, view: 'back', width: per, background: '#ffffff' });

  const pad = 40; const gap = 40; const headH = 70;
  const out = document.createElement('canvas');
  out.width = pad * 2 + f.width + gap + b.width;
  out.height = headH + Math.max(f.height, b.height) + pad;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);

  // Header.
  ctx.fillStyle = '#192853';
  ctx.font = "700 30px 'Saira Condensed', Arial, sans-serif";
  ctx.textBaseline = 'middle';
  const tpl = getTemplate(ds.normalizeSpec(spec).garmentId);
  ctx.fillText(`${(spec.meta && spec.meta.teamName) || 'Custom Uniform'} — ${tpl.name}`, pad, headH / 2);
  ctx.font = "400 16px Arial, sans-serif";
  ctx.fillStyle = '#5A6075';
  ctx.textAlign = 'right';
  ctx.fillText('PRODUCTION PROOF · FRONT / BACK', out.width - pad, headH / 2);
  ctx.textAlign = 'left';

  ctx.drawImage(front, pad, headH);
  ctx.drawImage(back, pad + f.width + gap, headH);
  return out.toDataURL('image/png');
}
