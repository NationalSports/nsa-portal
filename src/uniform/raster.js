// Uniform Builder — photoreal raster compositing.
//
// A "raster" template is a real garment image instead of hand-drawn vector paths.
// Each view carries two images:
//   • base  — the garment rendered/photographed in ONE neutral gray, keeping all
//             the real fabric texture, folds, seams, and shadows.
//   • mask  — the same garment where every zone is a FLAT solid color (an ID map),
//             e.g. body=#ff0000, sleeveL=#00ff00. No lighting.
//
// To render a colorway we tint each zone's color THROUGH the base (multiply, so
// the base's shadows/highlights survive) and keep only that zone's pixels using
// an alpha mask derived from the ID map. The realism comes entirely from the
// base image, so a Blender/CLO render — or a photographed blank — looks real.
//
// This is the destination for the Blender workflow: export base_front/back.png +
// mask_front/back.png using the color convention below and import them.

import * as ds from './designSpec';
import { makePatternTile, tintedTile } from './patterns';

// Canonical zone → flat mask color. Matches the ids used in designSpec's default
// zones so an imported template's colors apply immediately, and matches the flat
// emission colors the Blender/mockup instructions tell the artist to use.
export const RASTER_ZONE_MAP = [
  { id: 'body', label: 'Body', maskColor: '#ff0000' },
  { id: 'sleeveL', label: 'Left Sleeve', maskColor: '#00ff00' },
  { id: 'sleeveR', label: 'Right Sleeve', maskColor: '#0000ff' },
  { id: 'collar', label: 'Collar', maskColor: '#ffff00' },
  { id: 'sidePanelL', label: 'Left Side Panel', maskColor: '#ff00ff' },
  { id: 'sidePanelR', label: 'Right Side Panel', maskColor: '#00ffff' },
  { id: 'yoke', label: 'Shoulder Yoke', maskColor: '#ff8000' },
  { id: 'pocket', label: 'Pocket', maskColor: '#8000ff' },
  { id: 'hood', label: 'Hood', maskColor: '#00ff80' },
];

export function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

function newCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// Build a per-zone alpha mask from the ID map. Every garment pixel (mask alpha
// present) is assigned to its NEAREST zone color — winner-take-all — so there are
// no unassigned pixels at anti-aliased zone/silhouette edges (which used to show
// as speckles/gaps). Also returns the raw mask ImageData for click hit-testing.
function computeZoneAlpha(maskImg, zones, w, h) {
  const mc = newCanvas(w, h);
  const mx = mc.getContext('2d', { willReadFrequently: true });
  mx.drawImage(maskImg, 0, 0, w, h);
  const md = mx.getImageData(0, 0, w, h);
  const data = md.data;
  const zc = zones.map((z) => ({ id: z.id, ...ds.hexToRgb(z.maskColor) }));
  const bufs = {};
  for (const z of zones) { const a = newCanvas(w, h); const ctx = a.getContext('2d'); bufs[z.id] = { canvas: a, ctx, img: ctx.createImageData(w, h), any: false }; }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // transparent background -> no zone
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let best = null, bestD = Infinity;
    for (const z of zc) { const dr = r - z.r, dg = g - z.g, db = b - z.b; const dd = dr * dr + dg * dg + db * db; if (dd < bestD) { bestD = dd; best = z.id; } }
    if (best != null) { const buf = bufs[best]; const od = buf.img.data; od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 255; buf.any = true; }
  }
  const zoneAlpha = {};
  for (const z of zones) { const buf = bufs[z.id]; if (buf.any) { buf.ctx.putImageData(buf.img, 0, 0); zoneAlpha[z.id] = buf.canvas; } }
  return { zoneAlpha, maskData: md };
}

// Brighten the base so flat fabric maps to ~white and only folds/shadows stay
// dark. Without this the mid-gray render multiplies every color darker (white
// reads as gray). Returns a canvas usable as a drawImage source.
function normalizeBase(img, w, h) {
  const c = newCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++; }
  }
  const mean = n ? sum / n : 180;
  const factor = Math.min(1.9, 236 / Math.max(mean, 1));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) { d[i] = Math.min(255, d[i] * factor); d[i + 1] = Math.min(255, d[i + 1] * factor); d[i + 2] = Math.min(255, d[i + 2] * factor); }
  }
  x.putImageData(id, 0, 0);
  return c;
}

// Load + precompute everything for a raster view, cached on the view object so we
// only pay the pixel scan once. Returns the assets bundle renderUniform needs.
export async function preloadRasterAssets(view) {
  if (view._assets) return view._assets;
  const baseImg = typeof view.base === 'string' ? await loadImage(view.base) : view.base;
  const mask = typeof view.mask === 'string' ? await loadImage(view.mask) : view.mask;
  if (!baseImg || !mask) return null;
  const w = view.w || baseImg.naturalWidth || baseImg.width;
  const h = view.h || baseImg.naturalHeight || baseImg.height;
  const { zoneAlpha, maskData } = computeZoneAlpha(mask, view.zones, w, h);
  const base = normalizeBase(baseImg, w, h);
  view._assets = { base, w, h, zoneAlpha, maskData };
  return view._assets;
}

// Admin-library print patterns are image tiles. Canvas pattern fills need a
// decoded image synchronously, so the async render entry points preload every
// zone's patternImage into this cache first; tint() then reads it directly.
export const patternImgCache = {};
export function preloadPatternImages(spec) {
  const urls = new Set();
  Object.values((spec && spec.zones) || {}).forEach((z) => { if (z && z.patternImage) urls.add(z.patternImage); });
  return Promise.all([...urls].map((u) => patternImgCache[u]
    ? Promise.resolve()
    : loadImage(u).then((im) => { if (im) patternImgCache[u] = im; })));
}

// Tint a full-canvas layer (already holding the base) by a zone's color/pattern
// using multiply so the base shading shows through.
function tint(lx, zoneSpec, w, h) {
  const color = ds.toHex(zoneSpec.color, '#1f2a44');
  const color2 = ds.toHex(zoneSpec.color2, '#ffffff');
  const pat = zoneSpec.pattern || 'solid';
  lx.globalCompositeOperation = 'multiply';
  if (pat === 'custom' && zoneSpec.patternImage) {
    let img = patternImgCache[zoneSpec.patternImage];
    if (img && zoneSpec.patternTint) img = tintedTile(img, zoneSpec.patternImage, color, color2, ds.toHex(zoneSpec.color3, '#ffffff'), ds.toHex(zoneSpec.color4, '#ffffff'), zoneSpec.patternTintMode);
    const cp = img ? lx.createPattern(img, 'repeat') : null;
    // Tile a fixed ~4 times across the garment width so the print reads at the
    // same physical scale as the 3D preview (which repeats the body 4×) and the
    // same size across every zone. Without this the tile drew ~1× (way too big).
    if (cp && typeof cp.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
      const iw = img.naturalWidth || img.width || 1024;
      try { cp.setTransform(new DOMMatrix().scale((w / 3) / iw)); } catch (_e) { /* older browsers */ }
    }
    lx.fillStyle = cp || color; lx.fillRect(0, 0, w, h); return; // flat fallback until loaded
  }
  if (pat === 'solid') { lx.fillStyle = color; lx.fillRect(0, 0, w, h); return; }
  if (pat === 'fade') {
    const g = lx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color); g.addColorStop(1, color2);
    lx.fillStyle = g; lx.fillRect(0, 0, w, h); return;
  }
  const tile = makePatternTile(pat, color, color2);
  if (!tile) { lx.fillStyle = color; lx.fillRect(0, 0, w, h); return; }
  const cp = lx.createPattern(tile, 'repeat');
  lx.fillStyle = cp || color; lx.fillRect(0, 0, w, h);
}

// Composite all tinted zones of a raster view onto ctx, scaled to dw×dh.
export function compositeRaster(ctx, view, spec, assets, dw, dh) {
  const { base, w, h, zoneAlpha } = assets;
  const comp = newCanvas(w, h);
  const cx = comp.getContext('2d');
  for (const z of view.zones) {
    const alpha = zoneAlpha[z.id];
    if (!alpha) continue;
    // A construction detail can be an independent mask while sourcing its
    // color from another builder area's secondary channel. AGI-1012 uses this
    // for the chest stripe and the two sleeve bands, matching the live 3D UV
    // masks without inventing duplicate saved-spec zones.
    const sourceId = z.sourceId || z.id;
    const source = (spec.zones && spec.zones[sourceId]) || ds.DEFAULT_ZONE;
    const zs = z.colorField
      ? { ...source, color: source[z.colorField] || source.color, pattern: 'solid' }
      : source;
    const layer = newCanvas(w, h);
    const lx = layer.getContext('2d');
    lx.drawImage(base, 0, 0, w, h);
    tint(lx, zs, w, h);
    lx.globalCompositeOperation = 'destination-in';
    lx.drawImage(alpha, 0, 0);
    cx.drawImage(layer, 0, 0);
  }
  ctx.drawImage(comp, 0, 0, dw, dh);
}

// Which zone (if any) is under a normalized point — reads the ID map.
export function zoneAtPoint(view, assets, fx, fy) {
  const { w, h, maskData } = assets;
  const x = Math.max(0, Math.min(w - 1, Math.floor(fx * w)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(fy * h)));
  const i = (y * w + x) * 4;
  const d = maskData.data;
  const pr = d[i], pg = d[i + 1], pb = d[i + 2];
  let best = null, bestD = 60 * 60;
  for (const z of view.zones) {
    const { r, g, b } = ds.hexToRgb(z.maskColor);
    const dd = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (dd < bestD) { bestD = dd; best = z.sourceId || z.id; }
  }
  return best;
}

// Build a raster template object from imported images. front/back are
// { base, mask, w, h } (dataURLs + natural dims). Only zones whose mask color is
// actually present will be colorable (computed lazily in preloadRasterAssets).
export function makeRasterTemplate(id, name, front, back) {
  const mkView = (v) => ({
    base: v.base, mask: v.mask, w: v.w, h: v.h,
    viewBox: `0 0 ${v.w} ${v.h}`,
    zones: RASTER_ZONE_MAP.slice(),
    seams: [],
    anchors: {
      number: { x: 0.5, y: 0.5, size: Math.round(v.h * 0.26) },
      name: { x: 0.5, y: 0.27, size: Math.round(v.h * 0.08) },
    },
  });
  const views = { front: mkView(front), back: mkView(back || front) };
  return { id, name, category: 'Photoreal', type: 'raster', custom: true, views };
}
