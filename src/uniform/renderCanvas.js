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

import { jsPDF } from 'jspdf';
import { makePatternTile, makeFabricOverlay } from './patterns';
import { fontShorthand, ensureFontsReady } from './fonts';
import { getTemplate } from './templates';
import * as ds from './designSpec';

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

// Load an image src (data URL or http) into an HTMLImageElement. Resolves null
// on error so one bad logo never rejects the whole render.
function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

// Preload every logo image referenced by the spec (both views), keyed by id, so
// renderUniform can stay synchronous while drawImage has ready bitmaps.
export async function preloadLogos(spec) {
  const map = {};
  const all = [...((spec.logos && spec.logos.front) || []), ...((spec.logos && spec.logos.back) || [])];
  await Promise.all(all.map(async (l) => { map[l.id] = await loadImg(l.src); }));
  return map;
}

// Draw the logos for a view. `images` maps logo id -> HTMLImageElement.
function drawLogos(ctx, logos, images, vb) {
  for (const l of logos || []) {
    const img = images && images[l.id];
    if (!img) continue;
    const w = l.w * vb.w;
    const h = w * (l.aspect || 1);
    const cx = l.x * vb.w + vb.x;
    const cy = l.y * vb.h + vb.y;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(l.opacity) ? l.opacity : 1;
    ctx.translate(cx, cy);
    if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
    try { ctx.drawImage(img, -w / 2, -h / 2, w, h); } catch (_e) { /* tainted/broken */ }
    ctx.restore();
  }
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

  // Uploaded logos / artwork (above the garment, below lettering).
  drawLogos(ctx, (spec.logos && spec.logos[viewName]) || [], opts.images, vb);

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
  const images = await preloadLogos(ds.normalizeSpec(spec));
  const canvas = document.createElement('canvas');
  renderUniform(canvas, spec, { ...opts, images });
  return canvas.toDataURL('image/png');
}

// Render both sides side-by-side onto one canvas — the production "flat" a shop
// prints from. Includes a small colorway legend strip beneath each side.
export async function renderProductionSheet(spec, opts = {}) {
  await ensureFontsReady();
  const images = await preloadLogos(ds.normalizeSpec(spec));
  const per = opts.width || 700;
  const front = document.createElement('canvas');
  const back = document.createElement('canvas');
  const f = renderUniform(front, spec, { ...opts, images, view: 'front', width: per, background: '#ffffff' });
  const b = renderUniform(back, spec, { ...opts, images, view: 'back', width: per, background: '#ffffff' });

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

// Print-ready PDF proof: front + back renders on top, a colorway/lettering spec
// table below — the sheet a shop actually works from. Returns a jsPDF doc; the
// caller decides whether to .save() or hand it to a print flow.
export async function renderProductionPDF(spec, opts = {}) {
  spec = ds.normalizeSpec(spec);
  const tpl = getTemplate(spec.garmentId);
  const frontUrl = await renderToDataURL(spec, { view: 'front', width: 900, background: '#ffffff' });
  const backUrl = await renderToDataURL(spec, { view: 'back', width: 900, background: '#ffffff' });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  doc.setFillColor(25, 40, 83); doc.rect(0, 0, W, 54, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(`${(spec.meta && spec.meta.teamName) || 'Custom Uniform'} — ${tpl.name}`, M, 34);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text('PRODUCTION PROOF', W - M, 34, { align: 'right' });

  // Front/back proofs.
  const imgW = (W - M * 2 - 30) / 2;
  const imgH = imgW * (parseViewBox(tpl.views.front.viewBox).h / parseViewBox(tpl.views.front.viewBox).w);
  const top = 70;
  doc.addImage(frontUrl, 'PNG', M, top, imgW, imgH);
  doc.addImage(backUrl, 'PNG', M + imgW + 30, top, imgW, imgH);
  doc.setTextColor(90); doc.setFontSize(9);
  doc.text('FRONT', M + imgW / 2, top + imgH + 12, { align: 'center' });
  doc.text('BACK', M + imgW + 30 + imgW / 2, top + imgH + 12, { align: 'center' });

  // Spec table on a second page for room.
  doc.addPage('letter', 'landscape');
  doc.setTextColor(25, 40, 83); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('Build Specification', M, 44);
  doc.setFontSize(10); doc.setTextColor(40);
  let y = 70;
  const line = (label, value) => {
    doc.setFont('helvetica', 'bold'); doc.text(String(label), M, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(value), M + 190, y);
    y += 18;
  };
  line('Garment', tpl.name);
  line('Fabric', spec.fabric);
  if (spec.meta && spec.meta.teamName) line('Team', spec.meta.teamName);
  y += 6;
  doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 40, 83); doc.text('Zones', M, y); y += 18;
  doc.setTextColor(40);
  tpl.views.front.zones.forEach((z) => {
    const zs = spec.zones[z.id]; if (!zs) return;
    const pat = zs.pattern && zs.pattern !== 'solid' ? ` · ${zs.pattern} w/ ${ds.nameForHex(zs.color2)} (${zs.color2})` : '';
    line(z.label, `${ds.nameForHex(zs.color)} (${zs.color})${pat}`);
  });
  y += 6;
  doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 40, 83); doc.text('Lettering', M, y); y += 18;
  doc.setTextColor(40);
  ['front', 'back'].forEach((v) => ['number', 'name'].forEach((r) => {
    const t = spec.text[v][r]; if (!t || !(t.value || '').trim()) return;
    line(`${v} ${r}`, `"${t.value}" · ${t.font} · ${ds.nameForHex(t.fill)} (${t.fill})`);
  }));
  const logoCount = ((spec.logos && spec.logos.front) || []).length + ((spec.logos && spec.logos.back) || []).length;
  if (logoCount) { y += 6; line('Logos', `${logoCount} placed (see proof)`); }

  return doc;
}
