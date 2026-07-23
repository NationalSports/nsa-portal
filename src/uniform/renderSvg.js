// Uniform Builder — editable production SVG exporter.
//
// This is intentionally different from the PNG/PDF proof path. The SVG keeps
// garment areas, lettering and placed artwork in named groups so a production
// artist can inspect/recolor the approved design in Illustrator. Vector-backed
// garments export as paths. Artist/raster-backed garments retain their exact
// zone masks as separate clipped ink layers; any raster source is embedded so
// the file remains portable rather than depending on a local web URL.

import { getTemplate } from './templates';
import { fontStack, fontWeight } from './fonts';
import { tintedTile } from './patterns';
import { preloadPatternImages, patternImgCache } from './raster';
import * as ds from './designSpec';

const PAGE_W = 1600;
const ROW_H = 535;
const VIEW_W = 525;
const VIEW_H = 450;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function safeId(value) {
  return String(value || 'item').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function parseViewBox(value) {
  const [x, y, w, h] = String(value || '0 0 400 480').split(/[\s,]+/).map(Number);
  return { x: x || 0, y: y || 0, w: w || 400, h: h || 480 };
}

function hexRgb(hex) {
  const value = ds.toHex(hex, '#000000').slice(1);
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlineAsset(src) {
  if (!src || /^data:/i.test(src)) return src || '';
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Asset ${response.status}`);
    return await blobDataURL(await response.blob());
  } catch (_e) {
    // Preserve the source as a last resort. The SVG remains useful in the
    // browser and its metadata explicitly records that this asset is linked.
    return src;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// Convert one multi-color raster construction mask into one alpha mask per
// named garment zone. Each output stays independent/editable in the SVG.
async function rasterMasks(view) {
  if (!view.mask || typeof document === 'undefined') return {};
  try {
    const image = await loadImage(view.mask);
    const width = image.naturalWidth || view.w || 1;
    const height = image.naturalHeight || view.h || 1;
    const source = document.createElement('canvas');
    source.width = width; source.height = height;
    const sourceCtx = source.getContext('2d', { willReadFrequently: true });
    sourceCtx.drawImage(image, 0, 0, width, height);
    const pixels = sourceCtx.getImageData(0, 0, width, height).data;
    const zones = (view.zones || []).filter((zone) => zone.maskColor);
    const targets = zones.map((zone) => hexRgb(zone.maskColor));
    const outputs = zones.map(() => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return { canvas, image: canvas.getContext('2d').createImageData(width, height) };
    });

    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] < 8) continue;
      const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      let best = -1; let bestDistance = Infinity;
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i];
        const distance = (r - t[0]) ** 2 + (g - t[1]) ** 2 + (b - t[2]) ** 2;
        if (distance < bestDistance) { best = i; bestDistance = distance; }
      }
      // Mask artwork uses deliberately distant marker colors. A generous
      // threshold retains anti-aliased edges without claiming dark background.
      if (best < 0 || bestDistance > 18000) continue;
      const data = outputs[best].image.data;
      data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255;
      data[offset + 3] = pixels[offset + 3];
    }

    const result = {};
    outputs.forEach((output, i) => {
      output.canvas.getContext('2d').putImageData(output.image, 0, 0);
      result[zones[i].id] = output.canvas.toDataURL('image/png');
    });
    return result;
  } catch (_e) { return {}; }
}

function resolvedZone(spec, templateZone) {
  const source = (spec.zones && spec.zones[templateZone.sourceId || templateZone.id]) || {};
  const field = templateZone.colorField || 'color';
  if (field === 'color') return source;
  return { ...source, color: source[field], pattern: 'solid' };
}

function patternDefinition(id, zone, vb, customHref) {
  const a = ds.toHex(zone.color, '#1f2a44');
  const b = ds.toHex(zone.patternColor2 || zone.color2, '#ffffff');
  const pattern = zone.pattern || 'solid';
  if (pattern === 'fade') {
    return {
      paint: `url(#${id})`,
      def: `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`,
    };
  }
  if (pattern === 'custom' && customHref) {
    const atlas = zone.patternTintMode === 'atlas';
    const width = atlas ? vb.w : Math.max(32, vb.w / 4.5);
    const height = atlas ? vb.h : width;
    return {
      paint: `url(#${id})`,
      def: `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${vb.x}" y="${vb.y}" width="${width}" height="${height}"><image href="${esc(customHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${atlas ? 'none' : 'xMidYMid slice'}"/></pattern>`,
    };
  }
  if (pattern === 'solid') return { paint: a, def: '' };

  const sizes = { stripes: 24, boldstripe: 120, pinstripe: 20, chevron: 40, dots: 26, camo: 96, digicamo: 48, carbon: 16, hex: 34 };
  const size = sizes[pattern] || 32;
  let art = '';
  if (pattern === 'stripes' || pattern === 'boldstripe' || pattern === 'pinstripe') {
    const band = pattern === 'boldstripe' ? 60 : pattern === 'pinstripe' ? 3 : 12;
    art = `<rect width="${size}" height="${size}" fill="${a}"/><rect width="${band}" height="${size}" fill="${b}"/>`;
  } else if (pattern === 'chevron') {
    art = `<rect width="40" height="40" fill="${a}"/><path d="M-20 40 L0 0 L20 40 M0 40 L20 0 L40 40 M20 40 L40 0 L60 40" fill="none" stroke="${b}" stroke-width="7"/>`;
  } else if (pattern === 'dots') {
    art = `<rect width="26" height="26" fill="${a}"/><circle cx="7" cy="7" r="4" fill="${b}"/><circle cx="20" cy="20" r="4" fill="${b}"/>`;
  } else if (pattern === 'hex') {
    art = `<rect width="34" height="34" fill="${a}"/><path d="M17 7 L25 12 L25 22 L17 27 L9 22 L9 12 Z M0 -10 L8 -5 L8 5 L0 10 L-8 5 L-8 -5 Z M34 24 L42 29 L42 39 L34 44 L26 39 L26 29 Z" fill="none" stroke="${b}" stroke-width="1.5"/>`;
  } else if (pattern === 'carbon') {
    art = `<rect width="16" height="16" fill="${a}"/><rect width="8" height="8" fill="${b}" fill-opacity=".42"/><rect x="8" y="8" width="8" height="8" fill="${b}" fill-opacity=".42"/><rect x="8" width="8" height="8" fill="#000" fill-opacity=".2"/><rect y="8" width="8" height="8" fill="#000" fill-opacity=".2"/>`;
  } else if (pattern === 'digicamo') {
    art = `<rect width="48" height="48" fill="${a}"/><path d="M0 8h16v8H8v8H0zM24 0h16v8h8v16H32v-8h-8zM16 32h24v16H24v-8h-8z" fill="${b}"/><path d="M8 24h16v8H8zM40 24h8v16h-8z" fill="#000" fill-opacity=".18"/>`;
  } else {
    art = `<rect width="96" height="96" fill="${a}"/><path d="M-8 18 C8 2 28 7 35 21 S59 35 72 20 S103 13 108 29 L108 52 C90 63 70 44 55 58 S21 80 -8 65 Z" fill="${b}"/><path d="M12 76 C27 60 45 69 54 81 S80 92 102 72 L102 101 L0 101 Z" fill="#000" fill-opacity=".18"/>`;
  }
  return { paint: `url(#${id})`, def: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">${art}</pattern>` };
}

async function customPatternHref(zone) {
  if (!zone || zone.pattern !== 'custom' || !zone.patternImage) return '';
  const image = patternImgCache.get(zone.patternImage);
  if (image && zone.patternTint) {
    try {
      return tintedTile(
        image, zone.patternImage,
        ds.toHex(zone.color, '#1f2a44'),
        ds.toHex(zone.patternColor2 || zone.color2, '#ffffff'),
        ds.toHex(zone.color3, '#ffffff'), ds.toHex(zone.color4, '#ffffff'),
        zone.patternTintMode, ds.toHex(zone.color5, '#ffffff')
      ).toDataURL('image/png');
    } catch (_e) { /* fall back to embedded source */ }
  }
  return inlineAsset(zone.patternImage);
}

async function textLayer(spec, viewName, view, vb, prefix, defs) {
  const elements = (spec.text && spec.text[viewName]) || {};
  const chunks = [];
  for (const role of ['name', 'number']) {
    const item = elements[role] || {};
    const value = String(item.value || '').trim();
    if (!value) continue;
    const anchor = (view.anchors && view.anchors[role]) || { x: .5, y: .45, size: 100 };
    const x = vb.x + (Number.isFinite(item.x) ? item.x : anchor.x) * vb.w;
    const y = vb.y + (Number.isFinite(item.y) ? item.y : anchor.y) * vb.h;
    const size = Number.isFinite(item.inches) ? vb.h * (item.inches / 30) : anchor.size * (item.size || 1);
    const fill = ds.toHex(item.fill, '#ffffff');
    const outline = item.outline === 'auto' ? ds.contrastInk(fill) : (item.outline === 'none' ? 'none' : ds.toHex(item.outline, '#111827'));
    const outline2 = item.outline2 && item.outline2 !== 'none' ? ds.toHex(item.outline2, '#111827') : 'none';
    const baseAttrs = `x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${esc(fontStack(item.font))}" font-weight="${fontWeight(item.font)}" font-size="${size}" letter-spacing="${Number(item.letterSpacing || 0)}" data-role="${role}" data-finished-height-in="${Number.isFinite(item.inches) ? item.inches : ''}" data-font-id="${esc(item.font || '')}"`;
    const renderText = (extra = '') => `<text ${baseAttrs} ${extra}>${esc(value)}</text>`;
    let layers = '';
    if (outline2 !== 'none') {
      const outer = Math.max(0, Number(item.outlineWidth || 0)) + Math.max(0, Number(item.outline2Width || 0));
      layers += renderText(`fill="none" stroke="${outline2}" stroke-width="${outer * 2}" stroke-linejoin="round" paint-order="stroke"`);
    }
    layers += renderText(`fill="${fill}" stroke="${outline}" stroke-width="${outline === 'none' ? 0 : Number(item.outlineWidth || 0) * 2}" stroke-linejoin="round" paint-order="stroke fill"`);
    chunks.push(`<g id="${prefix}-${role}" inkscape:groupmode="layer" inkscape:label="${esc(`${viewName} ${role}`)}">${layers}</g>`);
  }
  return chunks.join('');
}

async function logoLayer(spec, viewName, vb, prefix) {
  const chunks = [];
  for (const logo of ((spec.logos && spec.logos[viewName]) || [])) {
    const href = await inlineAsset(logo.src);
    const aspect = Number.isFinite(logo.aspect) && logo.aspect > 0 ? logo.aspect : 1;
    const height = Number.isFinite(logo.inches) ? vb.h * (logo.inches / 30) : (logo.w * vb.w) / aspect;
    const width = height * aspect;
    const x = vb.x + logo.x * vb.w;
    const y = vb.y + logo.y * vb.h;
    chunks.push(`<g id="${prefix}-logo-${safeId(logo.id)}" inkscape:groupmode="layer" inkscape:label="${esc(`${viewName} ${logo.slot || 'logo'}`)}" data-slot="${esc(logo.slot || '')}" data-finished-height-in="${Number.isFinite(logo.inches) ? logo.inches : ''}" data-source-pixel-height="${logo.pixelHeight || ''}"><image href="${esc(href)}" x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" opacity="${Number.isFinite(logo.opacity) ? logo.opacity : 1}" preserveAspectRatio="xMidYMid meet" transform="rotate(${Number(logo.rotation || 0)} ${x} ${y})"/></g>`);
  }
  return chunks.join('');
}

async function garmentView(spec, viewName, row, column, label, defs, referenceImage) {
  const template = getTemplate(spec.garmentId);
  const view = template.views[viewName] || template.views.front;
  const vb = parseViewBox(view.viewBox);
  const scale = Math.min(VIEW_W / vb.w, VIEW_H / vb.h);
  const x = 55 + column * 565 + (VIEW_W - vb.w * scale) / 2;
  const y = 115 + row * ROW_H + (VIEW_H - vb.h * scale) / 2;
  const prefix = safeId(`${label}-${viewName}`);
  const masks = template.type === 'raster' ? await rasterMasks(view) : {};
  let zones = '';
  for (const zone of (view.zones || [])) {
    const zoneSpec = resolvedZone(spec, zone);
    const customHref = await customPatternHref(zoneSpec);
    const paint = patternDefinition(`${prefix}-${safeId(zone.id)}-fill`, zoneSpec, vb, customHref);
    if (paint.def) defs.push(paint.def);
    const common = `id="${prefix}-zone-${safeId(zone.id)}" inkscape:groupmode="layer" inkscape:label="${esc(zone.label || zone.id)}" data-zone="${esc(zone.id)}" data-source-zone="${esc(zone.sourceId || zone.id)}" data-color-field="${esc(zone.colorField || 'color')}" data-color="${esc(ds.toHex(zoneSpec.color, '#1f2a44'))}" data-pattern="${esc(zoneSpec.pattern || 'solid')}"`;
    if (zone.d) {
      zones += `<g ${common}><path d="${esc(zone.d)}" fill="${paint.paint}"/></g>`;
    } else if (masks[zone.id]) {
      const maskId = `${prefix}-${safeId(zone.id)}-mask`;
      defs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}"><image href="${esc(masks[zone.id])}" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" preserveAspectRatio="none"/></mask>`);
      zones += `<g ${common}><rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${paint.paint}" mask="url(#${maskId})"/></g>`;
    }
  }
  const seams = (view.seams || []).map((seam, i) => `<path id="${prefix}-seam-${i + 1}" d="${esc(seam.d)}" fill="none" stroke="#192853" stroke-opacity=".42" stroke-width="1.2"/>`).join('');
  const logos = await logoLayer(spec, viewName, vb, prefix);
  const text = await textLayer(spec, viewName, view, vb, prefix, defs);
  const reference = referenceImage
    ? `<g id="${prefix}-approved-3d-reference" inkscape:groupmode="layer" inkscape:label="Approved 3D Reference (hidden)" style="display:none"><image href="${esc(referenceImage)}" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" preserveAspectRatio="xMidYMid meet"/></g>`
    : '';
  return `<g id="${prefix}" transform="translate(${x} ${y}) scale(${scale})" data-garment-id="${esc(spec.garmentId)}" data-view="${viewName}" data-render-mode="${template.type === 'raster' ? 'editable-raster-mask-zones' : 'vector-path-zones'}"><title>${esc(label)} ${esc(viewName)}</title><g id="${prefix}-color-zones" inkscape:groupmode="layer" inkscape:label="Editable Color Zones">${zones}</g><g id="${prefix}-seams" inkscape:groupmode="layer" inkscape:label="Construction Seams">${seams}</g><g id="${prefix}-logos" inkscape:groupmode="layer" inkscape:label="Placed Logos">${logos}</g><g id="${prefix}-lettering" inkscape:groupmode="layer" inkscape:label="Names and Numbers">${text}</g>${reference}</g><text x="${55 + column * 565 + VIEW_W / 2}" y="${102 + row * ROW_H}" text-anchor="middle" class="view-label">${esc(label)} · ${esc(viewName.toUpperCase())}</text>`;
}

function uniqueColorRows(entries) {
  const rows = [];
  entries.forEach(({ spec, label }) => {
    const template = getTemplate(spec.garmentId);
    const seen = new Set();
    [...(template.views.front.zones || []), ...(template.views.back.zones || [])].forEach((zone) => {
      if (seen.has(zone.id)) return;
      seen.add(zone.id);
      const value = resolvedZone(spec, zone);
      rows.push({ label: `${label} · ${zone.label || zone.id}`, color: ds.toHex(value.color, '#1f2a44'), pattern: value.pattern || 'solid' });
    });
  });
  return rows;
}

/**
 * Build a self-contained, layer-named SVG production file.
 * Raster logos and raster pattern sources stay embedded at their native
 * resolution; vector garment paths, colors and lettering remain editable.
 */
export async function renderProductionSVG(input, opts = {}) {
  const spec = ds.normalizeSpec(input);
  const entries = [{ spec, label: opts.reverseSpec ? 'SIDE A' : 'JERSEY' }];
  if (opts.reverseSpec) entries.push({ spec: ds.normalizeSpec(opts.reverseSpec), label: 'SIDE B' });
  if (opts.bottomSpec) entries.push({ spec: ds.normalizeSpec(opts.bottomSpec), label: opts.reverseBottomSpec ? 'SHORTS SIDE A' : 'SHORTS' });
  if (opts.reverseBottomSpec) entries.push({ spec: ds.normalizeSpec(opts.reverseBottomSpec), label: 'SHORTS SIDE B' });
  await Promise.all(entries.map((entry) => preloadPatternImages(entry.spec).catch(() => {})));

  const pageH = 115 + entries.length * ROW_H + 145;
  const defs = [];
  const views = [];
  for (let row = 0; row < entries.length; row += 1) {
    const entry = entries[row];
    const refs = row === 0 ? { front: opts.frontImage, back: opts.backImage } : {};
    views.push(await garmentView(entry.spec, 'front', row, 0, entry.label, defs, refs.front));
    views.push(await garmentView(entry.spec, 'back', row, 1, entry.label, defs, refs.back));
  }

  const colors = uniqueColorRows(entries);
  const legend = colors.slice(0, Math.floor((pageH - 250) / 32)).map((item, i) => {
    const y = 204 + i * 32;
    return `<g id="color-spec-${i + 1}"><rect x="1205" y="${y - 15}" width="22" height="22" rx="3" fill="${item.color}" stroke="#c6cad4"/><text x="1237" y="${y}" class="legend-label">${esc(item.label)}</text><text x="1535" y="${y}" text-anchor="end" class="legend-value">${esc(item.color.toUpperCase())}${item.pattern !== 'solid' ? ` · ${esc(item.pattern)}` : ''}</text></g>`;
  }).join('');
  const team = (spec.meta && spec.meta.teamName) || 'Custom Uniform';
  const designId = (spec.meta && spec.meta.designId) || spec.garmentId;
  const metadata = {
    exportedAt: new Date().toISOString(),
    format: 'NSA editable production SVG v1',
    scaleBasis: 'Garment proof height represents 30 finished inches',
    notes: 'Text remains editable and requires the recorded font. Raster logos/patterns remain embedded at source resolution. Raster-backed garments use independent embedded alpha masks for exact editable color boundaries.',
    spec,
    reverseSpec: opts.reverseSpec ? ds.normalizeSpec(opts.reverseSpec) : null,
    bottomSpec: opts.bottomSpec ? ds.normalizeSpec(opts.bottomSpec) : null,
    reverseBottomSpec: opts.reverseBottomSpec ? ds.normalizeSpec(opts.reverseBottomSpec) : null,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="16in" height="${(pageH / 100).toFixed(2)}in" viewBox="0 0 ${PAGE_W} ${pageH}" role="img" aria-labelledby="production-title production-description"><title id="production-title">${esc(team)} ${esc(designId)} production artwork</title><desc id="production-description">Editable front and back garment artwork with named color, logo and lettering layers.</desc><metadata>${esc(JSON.stringify(metadata))}</metadata><defs>${defs.join('')}<style>.title{font:800 28px 'Arial Narrow',Arial,sans-serif;fill:#fff;letter-spacing:1px}.subtitle{font:700 13px Arial,sans-serif;fill:#dfe4ef;letter-spacing:.8px}.view-label{font:800 15px 'Arial Narrow',Arial,sans-serif;fill:#192853;letter-spacing:1px}.legend-head{font:800 15px 'Arial Narrow',Arial,sans-serif;fill:#192853;letter-spacing:1px}.legend-label{font:700 10px Arial,sans-serif;fill:#2a2f3e}.legend-value{font:700 9px Arial,sans-serif;fill:#5a6075}</style></defs><rect width="${PAGE_W}" height="${pageH}" fill="#fff"/><g id="job-header" inkscape:groupmode="layer" inkscape:label="Job Information"><rect width="${PAGE_W}" height="78" fill="#192853"/><rect x="40" y="20" width="5" height="38" fill="#962c32"/><text x="58" y="42" class="title">${esc(team.toUpperCase())}</text><text x="58" y="61" class="subtitle">${esc(String(designId).toUpperCase())} · EDITABLE PRODUCTION SVG · ${esc(spec.fabric.toUpperCase())}</text><text x="1550" y="41" text-anchor="end" class="subtitle">NATIONAL SPORTS APPAREL</text><text x="1550" y="60" text-anchor="end" class="subtitle">FRONT / BACK · FINISHED HEIGHT IN INCHES</text></g><g id="production-artwork" inkscape:groupmode="layer" inkscape:label="Production Artwork">${views.join('')}</g><g id="production-spec" inkscape:groupmode="layer" inkscape:label="Color and Construction Specification"><rect x="1175" y="100" width="385" height="${Math.max(220, pageH - 165)}" rx="8" fill="#f7f8fb" stroke="#d9dde6"/><text x="1205" y="138" class="legend-head">APPROVED COLOR AREAS</text><text x="1205" y="163" class="legend-label">Each swatch corresponds to a named editable layer.</text>${legend}</g><g id="production-notes" inkscape:groupmode="layer" inkscape:label="Production Notes"><line x1="40" y1="${pageH - 100}" x2="1560" y2="${pageH - 100}" stroke="#d9dde6"/><text x="40" y="${pageH - 72}" class="legend-head">PRODUCTION NOTES</text><text x="40" y="${pageH - 47}" class="legend-label">Lettering and logos use finished visible height. Verify roster, fonts, spelling, art resolution and physical pattern/UV files before sublimation.</text><text x="40" y="${pageH - 27}" class="legend-label">This editable SVG is the approved color/decorating specification; commissioned cut-panel files remain the manufacturing geometry source.</text></g></svg>`;
}

export function downloadSVG(svg, filename = 'uniform-production.svg') {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
