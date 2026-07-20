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
import { makePatternTile, makeFabricOverlay, tintedTile } from './patterns';
import { fontShorthand, ensureFontsReady } from './fonts';
import { drawAthleticText } from './lettering';
import { canvasFromImage } from './logoImage';
import { getTemplate } from './templates';
import * as ds from './designSpec';
import { preloadRasterAssets, compositeRaster, preloadPatternImages, patternImgCache } from './raster';

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

  if (pat === 'custom' && zone.patternImage) {
    let img = patternImgCache[zone.patternImage];
    if (img && zone.patternTint) img = tintedTile(img, zone.patternImage, color, color2, ds.toHex(zone.color3, '#ffffff'), ds.toHex(zone.color4, '#ffffff'), zone.patternTintMode);
    const cp = img ? ctx.createPattern(img, 'repeat') : null;
    if (cp && typeof cp.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
      // Fixed ~6 repeats across the view width → consistent physical scale in
      // every zone and a match to the 3D preview (was natural-size ≈ 1 repeat).
      const iw = img.naturalWidth || img.width || 1024;
      try { cp.setTransform(new DOMMatrix().scale((vb.w / 6) / iw)); } catch (_e) { /* older browsers */ }
    }
    ctx.fillStyle = cp || color;
    ctx.fill(path);
    return;
  }
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
  await Promise.all(all.map(async (l) => {
    const img = await loadImg(l.src);
    try { map[l.id] = canvasFromImage(img); } catch (_e) { map[l.id] = img; }
  }));
  return map;
}

// Draw the logos for a view. `images` maps logo id -> HTMLImageElement.
function drawLogos(ctx, logos, images, vb) {
  for (const l of logos || []) {
    const img = images && images[l.id];
    if (!img) continue;
    // Logo controls use finished visible height in inches, matching lettering. Keep the
    // legacy viewBox fraction as a fallback for older saved designs.
    const aspect = img.width && img.height ? img.width / img.height : (l.aspect || 1);
    const h = Number.isFinite(l.inches) ? vb.h * (l.inches / 30) : (l.w * vb.w) / aspect;
    const w = h * aspect;
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
  // Production artwork is ordered by finished lettering height. Treat the
  // garment proof as a 30" tall jersey so a 4" chest number, 8" back number,
  // etc. stay physically consistent between the proof and the 3D model.
  const size = Number.isFinite(el.inches)
    ? vb.h * (el.inches / 30)
    : anchor.size * (el.size || 1);

  ctx.save();
  const fill = ds.toHex(el.fill, '#ffffff');
  let outline = el.outline;
  if (outline === 'auto') outline = ds.contrastInk(fill);
  if (outline && outline !== 'none') outline = ds.toHex(outline, '#111827');
  const outline2 = (el.outline2 && el.outline2 !== 'none') ? ds.toHex(el.outline2, '#111827') : 'none';
  drawAthleticText(ctx, {
    value, font: el.font, size, fill, outline, outlineWidth: el.outlineWidth,
    outline2, outline2Width: el.outline2Width || 0,
    letterSpacing: el.letterSpacing || 0, arch: el.arch || 0, x: px, y: py,
  });
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

  // Photoreal path: composite tinted zones onto the base render, then draw logos
  // and lettering on top (in viewBox/image space). Assets must be preloaded by
  // the caller (the async export wrappers and the editor both do this).
  if (tpl.type === 'raster') {
    if (opts.assets) compositeRaster(ctx, view, spec, opts.assets, width, height);
    ctx.save();
    ctx.scale(s, s);
    drawLogos(ctx, (spec.logos && spec.logos[viewName]) || [], opts.images, vb);
    if (opts.showText !== false) {
      const t = spec.text[viewName] || {};
      if (t.name) drawText(ctx, { ...t.name, _role: 'name' }, view, vb);
      if (t.number) drawText(ctx, { ...t.number, _role: 'number' }, view, vb);
    }
    ctx.restore();
    return { width, height };
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

  // Volumetric shading: ambient-occlusion at the edges + a top sheen, clipped to
  // the garment — matches the SVG editor's #uAO/#uHi overlays.
  ctx.save();
  ctx.clip(sil);
  const ao = ctx.createRadialGradient(vb.x + vb.w * 0.5, vb.y + vb.h * 0.4, vb.w * 0.12, vb.x + vb.w * 0.5, vb.y + vb.h * 0.4, vb.h * 0.62);
  ao.addColorStop(0.52, 'rgba(0,0,0,0)');
  ao.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ao; ctx.fillRect(vb.x, vb.y, vb.w, vb.h);
  const hi = ctx.createLinearGradient(0, vb.y, 0, vb.y + vb.h * 0.3);
  hi.addColorStop(0, 'rgba(255,255,255,0.42)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = hi; ctx.fillRect(vb.x, vb.y, vb.w, vb.h);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

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
  const nspec = ds.normalizeSpec(spec);
  const images = await preloadLogos(nspec);
  await preloadPatternImages(nspec);
  const tpl = getTemplate(nspec.garmentId);
  const view = tpl.views[opts.view || 'front'] || tpl.views.front;
  const assets = tpl.type === 'raster' ? await preloadRasterAssets(view) : undefined;
  const canvas = document.createElement('canvas');
  renderUniform(canvas, spec, { ...opts, images, assets });
  return canvas.toDataURL('image/png');
}

// Render both sides side-by-side onto one canvas — the production "flat" a shop
// prints from. Includes a small colorway legend strip beneath each side.
export async function renderProductionSheet(spec, opts = {}) {
  await ensureFontsReady();
  const nspec = ds.normalizeSpec(spec);
  const tpl = getTemplate(nspec.garmentId);
  const per = opts.width || 700;
  let front = document.createElement('canvas');
  let back = document.createElement('canvas');
  let f, b;
  if (opts.frontImage && opts.backImage) {
    // The live WebGL viewer is the visual source of truth. Preserve its camera,
    // materials, folds and decals in the downloadable sheet instead of
    // rebuilding an approximate jersey through the older flat renderer.
    const [frontImg, backImg] = await Promise.all([loadImg(opts.frontImage), loadImg(opts.backImage)]);
    const aspect = Number(opts.proofAspect) > 0 ? Number(opts.proofAspect) : 1;
    const proofH = Math.round(per / aspect);
    for (const [canvas, img] of [[front, frontImg], [back, backImg]]) {
      canvas.width = per; canvas.height = proofH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, per, proofH);
      if (img) ctx.drawImage(img, 0, 0, per, proofH);
    }
    f = { width: front.width, height: front.height };
    b = { width: back.width, height: back.height };
  } else {
    const images = await preloadLogos(nspec);
    await preloadPatternImages(nspec);
    const assetsF = tpl.type === 'raster' ? await preloadRasterAssets(tpl.views.front) : undefined;
    const assetsB = tpl.type === 'raster' ? await preloadRasterAssets(tpl.views.back) : undefined;
    f = renderUniform(front, spec, { ...opts, images, assets: assetsF, view: 'front', width: per, background: '#ffffff' });
    b = renderUniform(back, spec, { ...opts, images, assets: assetsB, view: 'back', width: per, background: '#ffffff' });
  }

  // Optional paired bottom garment (e.g. shorts) — a second row, same column
  // widths as the top row so front/back line up visually.
  let bf, bb, bottomSpecN, bottomTpl;
  if (opts.bottomSpec) {
    bottomSpecN = ds.normalizeSpec(opts.bottomSpec);
    const bImages = await preloadLogos(bottomSpecN);
    await preloadPatternImages(bottomSpecN);
    bottomTpl = getTemplate(bottomSpecN.garmentId);
    const bAssetsF = bottomTpl.type === 'raster' ? await preloadRasterAssets(bottomTpl.views.front) : undefined;
    const bAssetsB = bottomTpl.type === 'raster' ? await preloadRasterAssets(bottomTpl.views.back) : undefined;
    bf = document.createElement('canvas'); bb = document.createElement('canvas');
    renderUniform(bf, bottomSpecN, { images: bImages, assets: bAssetsF, view: 'front', width: f.width, background: '#ffffff' });
    renderUniform(bb, bottomSpecN, { images: bImages, assets: bAssetsB, view: 'back', width: b.width, background: '#ffffff' });
  }

  const pad = 40; const gap = 40; const headH = 70; const rowGap = 26;
  const topRowH = Math.max(f.height, b.height);
  const bottomRowH = bf ? Math.max(bf.height, bb.height) : 0;
  const out = document.createElement('canvas');
  out.width = pad * 2 + f.width + gap + b.width;
  out.height = headH + topRowH + (bf ? rowGap + bottomRowH : 0) + pad;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);

  // Header.
  ctx.fillStyle = '#192853';
  ctx.font = "700 30px 'Saira Condensed', Arial, sans-serif";
  ctx.textBaseline = 'middle';
  const title = bf ? `${(spec.meta && spec.meta.teamName) || 'Custom Uniform'} — ${tpl.name} + ${bottomTpl.name}` : `${(spec.meta && spec.meta.teamName) || 'Custom Uniform'} — ${tpl.name}`;
  ctx.fillText(title, pad, headH / 2);
  ctx.font = "400 16px Arial, sans-serif";
  ctx.fillStyle = '#5A6075';
  ctx.textAlign = 'right';
  ctx.fillText('PRODUCTION PROOF · FRONT / BACK', out.width - pad, headH / 2);
  ctx.textAlign = 'left';

  ctx.drawImage(front, pad, headH);
  ctx.drawImage(back, pad + f.width + gap, headH);
  if (bf) {
    const y2 = headH + topRowH + rowGap;
    ctx.drawImage(bf, pad, y2);
    ctx.drawImage(bb, pad + f.width + gap, y2);
  }
  return out.toDataURL('image/png');
}

// Print-ready PDF proof: front + back renders on top, a colorway/lettering spec
// table below — the sheet a shop actually works from. Returns a jsPDF doc; the
// caller decides whether to .save() or hand it to a print flow.
export async function renderProductionPDF(spec, opts = {}) {
  spec = ds.normalizeSpec(spec);
  const tpl = getTemplate(spec.garmentId);
  const frontUrl = opts.frontImage || await renderToDataURL(spec, { view: 'front', width: 900, background: '#ffffff' });
  const backUrl = opts.backImage || await renderToDataURL(spec, { view: 'back', width: 900, background: '#ffffff' });

  // A production sheet should print cleanly on the paper every shop already
  // uses. Keep the complete job on one portrait US Letter page: approved views
  // at the top, then construction, decoration, roster, pricing and checks in a
  // compact two-column specification grid.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const GAP = 14;
  const COL = (W - M * 2 - GAP) / 2;
  const NAVY = [25, 40, 83];
  const RED = [150, 44, 50];
  const INK = [34, 42, 58];
  const MUTED = [101, 110, 129];
  const RULE = [216, 220, 229];
  const PALE = [247, 248, 251];
  const GREEN = [31, 122, 61];

  // jsPDF's built-in Helvetica font is reliable for ASCII. Normalize proof
  // copy so inch marks and separators print correctly on every production PC.
  const pdfSafe = (value) => String(value == null ? '' : value)
    .replace(/\u2033/g, '"')
    .replace(/\u00b7/g, ' - ')
    .replace(/\u00d7/g, ' x ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
  const titleCase = (value) => pdfSafe(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const inches = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}" tall`;
  const program = spec.meta && spec.meta.program
    ? (({ mens: "Men's", womens: "Women's", youth: 'Youth' })[spec.meta.program] || titleCase(spec.meta.program))
    : 'Custom';
  const team = (spec.meta && spec.meta.teamName) || 'Custom Uniform';
  const designId = (spec.meta && spec.meta.designId) || spec.garmentId || 'Custom';
  const bottomSpec = opts.bottomSpec ? ds.normalizeSpec(opts.bottomSpec) : null;
  const bottomTpl = bottomSpec ? getTemplate(bottomSpec.garmentId) : null;

  const placedLogos = ['front', 'back'].flatMap((view) => ((spec.logos && spec.logos[view]) || []).map((logo) => ({ view, logo })));
  const logoPreviews = {};
  await Promise.all(placedLogos.slice(0, 4).map(async ({ logo }) => {
    try {
      const img = await loadImg(logo.src);
      const canvas = img && canvasFromImage(img, 800);
      if (canvas) logoPreviews[logo.id] = canvas.toDataURL('image/png');
    } catch (_e) { /* the written logo spec remains usable without a thumbnail */ }
  }));

  const setText = (size = 8, color = INK, style = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const sectionHead = (x, y, w, title, value = '') => {
    doc.setFillColor(...NAVY); doc.rect(x, y, w, 20, 'F');
    setText(8.2, [255, 255, 255], 'bold'); doc.text(pdfSafe(title).toUpperCase(), x + 8, y + 13);
    if (value) { setText(7.2, [224, 228, 239], 'bold'); doc.text(pdfSafe(value).toUpperCase(), x + w - 8, y + 13, { align: 'right' }); }
    return y + 20;
  };
  const row = (x, y, w, label, value, options = {}) => {
    const labelW = options.labelWidth || 82;
    const valueX = x + labelW;
    const available = w - labelW - 8;
    setText(options.fontSize || 7.35, INK, options.valueBold ? 'bold' : 'normal');
    const wrapped = doc.splitTextToSize(pdfSafe(value || '-'), available);
    const shown = wrapped.slice(0, options.maxLines || 2);
    const h = Math.max(options.minHeight || 17, shown.length * 8.3 + 7);
    if (options.fill) { doc.setFillColor(...options.fill); doc.rect(x, y, w, h, 'F'); }
    doc.setDrawColor(...RULE); doc.line(x, y + h, x + w, y + h);
    setText(6.8, options.labelColor || MUTED, 'bold'); doc.text(pdfSafe(label).toUpperCase(), x + 7, y + 11);
    if (options.swatch) {
      const hex = ds.toHex(options.swatch, '#ffffff');
      doc.setFillColor(hex); doc.setDrawColor(185, 190, 201); doc.roundedRect(valueX, y + 4, 10, 10, 1.5, 1.5, 'FD');
      setText(options.fontSize || 7.35, INK, options.valueBold ? 'bold' : 'normal');
      doc.text(shown, valueX + 15, y + 11);
    } else {
      setText(options.fontSize || 7.35, options.valueColor || INK, options.valueBold ? 'bold' : 'normal');
      doc.text(shown, valueX, y + 11);
    }
    return y + h;
  };

  // Brand/title band.
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 60, 'F');
  doc.setFillColor(...RED); doc.rect(M, 16, 4, 30, 'F');
  setText(9, [224, 228, 239], 'bold'); doc.text('NATIONAL SPORTS APPAREL', M + 13, 23);
  setText(20, [255, 255, 255], 'bold'); doc.text(pdfSafe(team).toUpperCase(), M + 13, 42);
  setText(8.3, [224, 228, 239], 'bold'); doc.text('PRODUCTION SPECIFICATION', W - M, 23, { align: 'right' });
  setText(13, [255, 255, 255], 'bold'); doc.text(pdfSafe(designId).toUpperCase(), W - M, 42, { align: 'right' });

  // Compact job identity row.
  doc.setFillColor(...PALE); doc.rect(0, 60, W, 31, 'F');
  doc.setDrawColor(...RULE); doc.line(0, 91, W, 91);
  const meta = [
    ['GARMENT', bottomTpl ? `${tpl.name} + ${bottomTpl.name}` : tpl.name],
    ['PROGRAM', program],
    ['FABRIC', titleCase(spec.fabric || 'Sublimated Poly')],
    ['DATE', new Date().toLocaleDateString('en-US')],
  ];
  const metaW = (W - M * 2) / meta.length;
  meta.forEach(([label, value], i) => {
    const x = M + i * metaW;
    if (i) { doc.setDrawColor(...RULE); doc.line(x, 67, x, 84); }
    setText(6.2, MUTED, 'bold'); doc.text(label, x + (i ? 8 : 0), 72);
    setText(7.5, NAVY, 'bold');
    const clipped = doc.splitTextToSize(pdfSafe(value), metaW - 12)[0] || '';
    doc.text(clipped, x + (i ? 8 : 0), 83);
  });

  // Approved front/back views. The source images are square, so contain them
  // without stretching and leave the labels outside the artwork itself.
  const cardsY = 101;
  const cardH = 226;
  const cardW = COL;
  const drawView = (x, label, url) => {
    doc.setFillColor(...PALE); doc.setDrawColor(...RULE); doc.roundedRect(x, cardsY, cardW, cardH, 3, 3, 'FD');
    const art = 202;
    const artX = x + (cardW - art) / 2;
    doc.addImage(url, 'PNG', artX, cardsY + 5, art, art, undefined, 'FAST');
    doc.setDrawColor(...RULE); doc.line(x, cardsY + cardH - 19, x + cardW, cardsY + cardH - 19);
    setText(7.4, NAVY, 'bold'); doc.text(label, x + cardW / 2, cardsY + cardH - 7, { align: 'center' });
  };
  drawView(M, 'APPROVED FRONT', frontUrl);
  drawView(M + COL + GAP, 'APPROVED BACK', backUrl);

  // Colorway strip — visible swatches with exact production hex values.
  const allTemplateZones = [...(tpl.views.front.zones || []), ...(tpl.views.back.zones || [])];
  const uniqueZones = [];
  allTemplateZones.forEach((z) => {
    if (uniqueZones.some((existing) => existing.id === z.id)) return;
    // Artist-mask areas such as chest stripes and sleeve bands are virtual
    // zones: they read color2 from their source panel instead of owning a full
    // zone record. Resolve that mapping here so the production sheet lists the
    // same editable areas the coach saw in the builder.
    const source = spec.zones && spec.zones[z.sourceId || z.id];
    if (!source) return;
    const colorField = z.colorField || 'color';
    uniqueZones.push({
      ...z,
      spec: colorField === 'color'
        ? source
        : { ...source, color: source[colorField], color2: source.color, pattern: 'solid' },
    });
  });
  const uniqueColors = [];
  uniqueZones.forEach(({ spec: zs }) => [zs.color, zs.color2].forEach((color) => {
    const hex = ds.toHex(color, '');
    if (hex && !uniqueColors.includes(hex)) uniqueColors.push(hex);
  }));
  const stripY = 337;
  setText(6.8, MUTED, 'bold'); doc.text('APPROVED COLORWAY', M, stripY + 13);
  let chipX = M + 94;
  uniqueColors.slice(0, 7).forEach((hex) => {
    doc.setFillColor(hex); doc.setDrawColor(178, 184, 197); doc.roundedRect(chipX, stripY + 3, 17, 17, 2, 2, 'FD');
    setText(6.4, INK, 'bold'); doc.text(hex.toUpperCase(), chipX + 22, stripY + 14);
    chipX += 68;
  });
  doc.setDrawColor(...RULE); doc.line(M, stripY + 25, W - M, stripY + 25);

  // Left column — construction and every editable color boundary.
  let leftY = 372;
  leftY = sectionHead(M, leftY, COL, 'Construction & Materials', `${uniqueZones.length} color areas`);
  leftY = row(M, leftY, COL, 'Garment', bottomTpl ? `${tpl.name} + ${bottomTpl.name}` : tpl.name, { valueBold: true });
  leftY = row(M, leftY, COL, 'Fabric', titleCase(spec.fabric || 'Sublimated Poly'));
  uniqueZones.forEach(({ label, spec: zs }) => {
    const pattern = zs.pattern && zs.pattern !== 'solid'
      ? ` - ${titleCase(zs.pattern)}${zs.color2 ? ` / ${ds.nameForHex(zs.color2)} ${ds.toHex(zs.color2)}` : ''}`
      : '';
    leftY = row(M, leftY, COL, label, `${ds.nameForHex(zs.color)} ${ds.toHex(zs.color)}${pattern}`, { swatch: zs.color, minHeight: 16, fontSize: 7.05 });
  });

  leftY += 8;
  leftY = sectionHead(M, leftY, COL, 'Decoration', `${placedLogos.length} logo${placedLogos.length === 1 ? '' : 's'}`);
  ['front', 'back'].forEach((view) => ['number', 'name'].forEach((role) => {
    const t = spec.text && spec.text[view] && spec.text[view][role];
    if (!t || !(t.value || '').trim()) return;
    const outline = !t.outline || t.outline === 'none' ? 'no outline' : t.outline === 'auto' ? 'auto outline' : `${ds.nameForHex(t.outline)} outline`;
    const size = Number.isFinite(t.inches) ? inches(t.inches) : `${Math.round((t.size || 1) * 100)}% scale`;
    const position = `center ${Math.round((Number.isFinite(t.x) ? t.x : 0.5) * 100)}% x ${Math.round((Number.isFinite(t.y) ? t.y : 0.5) * 100)}%`;
    leftY = row(M, leftY, COL, `${view} ${role}`, `"${t.value}" - ${titleCase(t.font)} - ${size} - ${ds.nameForHex(t.fill)} ${ds.toHex(t.fill)} - ${outline} - ${position}`, { maxLines: 2, fontSize: 6.95 });
  }));
  placedLogos.forEach(({ view, logo }, i) => {
    const logoSize = Number.isFinite(logo.inches) ? inches(logo.inches) : 'legacy scale';
    const dpi = Number.isFinite(logo.pixelHeight) && Number.isFinite(logo.inches) && logo.inches > 0
      ? `${Math.round(logo.pixelHeight / logo.inches)} DPI`
      : 'resolution not recorded';
    leftY = row(M, leftY, COL, `${view} ${logo.slot || `logo ${i + 1}`}`, `${logoSize} - ${dpi} - rotate ${logo.rotation || 0} deg`, { maxLines: 2, fontSize: 6.95 });
    const preview = logoPreviews[logo.id];
    if (preview) {
      try { doc.addImage(preview, 'PNG', M + 87, leftY - 15, 12, 12, undefined, 'FAST'); } catch (_e) { /* text spec is authoritative */ }
    }
  });

  // Right column — shop quantities, price authorization and readiness checks.
  const RX = M + COL + GAP;
  let rightY = 372;
  const roster = opts.roster || [];
  const orderQty = Number(opts.order && opts.order.totalQty) || 0;
  rightY = sectionHead(RX, rightY, COL, 'Roster & Sizes', `${orderQty} garment${orderQty === 1 ? '' : 's'}`);
  if (roster.length) {
    roster.forEach((r) => {
      rightY = row(RX, rightY, COL, `${r.label} x${r.qty}`, r.numsDisplay || r.nums || 'Numbers not assigned', { minHeight: 16, fontSize: 7.05 });
    });
  } else {
    rightY = row(RX, rightY, COL, 'Roster', 'No sizes assigned - review before production', { valueColor: RED, maxLines: 2 });
  }

  rightY += 8;
  rightY = sectionHead(RX, rightY, COL, 'Order Summary', orderQty ? `${orderQty} piece${orderQty === 1 ? '' : 's'}` : 'quote');
  if (opts.order) {
    const publicUnit = Number(opts.order.publicUnitPrice ?? opts.order.unitPrice);
    const publicTotal = Number(opts.order.publicTotal ?? (opts.order.totalQty * publicUnit));
    const discountPercent = Number(opts.order.discountPercent || 0);
    rightY = row(RX, rightY, COL, 'Public price', `${opts.order.totalQty || 0} @ ${money(publicUnit)} = ${money(publicTotal)}`);
    if (discountPercent > 0) {
      rightY = row(RX, rightY, COL, 'Coach discount', `${discountPercent}% - save ${money(opts.order.discountTotal)}`, { valueColor: GREEN, valueBold: true });
      rightY = row(RX, rightY, COL, 'Authorized total', money(opts.order.total), { fill: [243, 249, 245], valueColor: GREEN, valueBold: true });
    } else {
      rightY = row(RX, rightY, COL, 'Authorized total', money(opts.order.total), { fill: [243, 249, 245], valueColor: GREEN, valueBold: true });
    }
  } else {
    rightY = row(RX, rightY, COL, 'Pricing', 'Not attached to this proof');
  }

  rightY += 8;
  const checks = opts.checks || [];
  rightY = sectionHead(RX, rightY, COL, 'Production Readiness', `${checks.filter((c) => c.ok).length}/${checks.length || 0} passed`);
  if (checks.length) {
    checks.forEach((check) => {
      rightY = row(RX, rightY, COL, check.ok ? 'Pass' : 'Review', `${check.label}: ${check.detail}`, {
        labelColor: check.ok ? GREEN : RED,
        valueColor: check.ok ? INK : RED,
        maxLines: 2,
        fontSize: 6.85,
      });
    });
  } else {
    rightY = row(RX, rightY, COL, 'Status', 'Production checks not recorded');
  }

  // Use the lower page area for the standards that prevent common production
  // mistakes. These statements document how the builder measures and places
  // art; they are instructions, not invented order data.
  const contentBottom = Math.max(leftY, rightY);
  const notesY = Math.max(contentBottom + 12, 670);
  if (notesY < H - 44) {
    const notesH = H - 42 - notesY;
    doc.setFillColor(...PALE); doc.setDrawColor(...RULE); doc.roundedRect(M, notesY, W - M * 2, notesH, 3, 3, 'FD');
    setText(7.2, NAVY, 'bold'); doc.text('PRODUCTION NOTES', M + 9, notesY + 14);
    const noteLines = [
      'Decoration sizes are finished visible height; transparent PNG margins are excluded.',
      'Hex values and approved views define the colorway. Do not sample color from the rendered lighting.',
      'Artwork centers must remain inside the approved sew-safe panel boundaries shown above.',
    ];
    noteLines.forEach((note, i) => {
      doc.setFillColor(...RED); doc.circle(M + 11, notesY + 27 + i * 13, 1.4, 'F');
      setText(6.8, INK, 'normal'); doc.text(pdfSafe(note), M + 18, notesY + 29 + i * 13);
    });
  }

  // One-sheet guarantee: a visible warning is safer than silently creating a
  // second page or clipping production data when a very large roster is used.
  if (contentBottom > H - 44) {
    doc.setFillColor(255, 247, 237); doc.rect(M, H - 50, W - M * 2, 15, 'F');
    setText(6.7, RED, 'bold'); doc.text('REVIEW: DENSE JOB - VERIFY ALL ROSTER AND DECORATION DETAILS IN THE ORDER RECORD.', W / 2, H - 40, { align: 'center' });
  }

  // Strong footer identity, like a conventional artist color-up sheet.
  doc.setFillColor(...NAVY); doc.rect(0, H - 30, W, 30, 'F');
  setText(7.2, [255, 255, 255], 'bold'); doc.text(`${pdfSafe(designId).toUpperCase()} - ${pdfSafe(tpl.name).toUpperCase()}`, M, H - 12);
  setText(6.8, [224, 228, 239], 'normal'); doc.text('APPROVED VIEWS, SCALE, COLOR AND ROSTER MUST MATCH PRODUCTION', W - M, H - 12, { align: 'right' });

  return doc;
}
