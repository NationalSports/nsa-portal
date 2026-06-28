/* eslint-disable */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as fabric from 'fabric';
import { Icon } from './components';
import { fileUpload, _cloudinaryPdfThumb } from './utils';

// Quick Mock Builder
// Lets a rep build mockups themselves (skipping the artist on the mockup phase) by
// dropping art onto a garment image and dragging/resizing it. Supports multiple art
// locations per garment (one layer per artwork) and one mockup per garment color.
// Pre-fills each location from the art already on the artwork so the rep doesn't
// re-upload. Source files persist on each artwork; the artist still does separations.
//
// Props:
//   garments  : [{key, sku, color, name, frontUrl, backUrl}]
//   locations : [{artFileId, name, position, existingFiles:[...], preview:{url}|null,
//                 garmentKeys:[sku|color]}] — garmentKeys scopes a location to specific
//                 garments (empty = shown for every garment)
//   initialMocks : {key:[{url,name}]}
//   onSave({mocksByGarment, filesByLocation})
//   onClose()
//   nf
//   onSaveProductImage(garment, url, side) -> truthy when the photo was saved back to the
//     product catalog (matched by SKU/color), so an uploaded product image is reused later.

// Common apparel color names -> swatch hex, so the rep can eyeball which colorway
// they're mocking. Unknown names fall back to neutral grey.
const COLOR_HEX = {
  black:'#111827', white:'#ffffff', navy:'#1f2a44', 'navy blue':'#1f2a44',
  royal:'#1d4ed8', 'royal blue':'#1d4ed8', red:'#dc2626', maroon:'#7f1d1d',
  cardinal:'#9b1c31', scarlet:'#c8102e', burgundy:'#7b1e3b', forest:'#14532d',
  'forest green':'#14532d', green:'#16a34a', kelly:'#16a34a', 'kelly green':'#16a34a',
  lime:'#84cc16', 'safety green':'#c6ff00', 'neon green':'#39ff14', gold:'#d4af37',
  'old gold':'#caa53d', 'vegas gold':'#c5b358', yellow:'#facc15', orange:'#ea580c',
  purple:'#7c3aed', grey:'#9ca3af', gray:'#9ca3af', 'heather grey':'#b6bcc4',
  'heather gray':'#b6bcc4', 'athletic heather':'#cbd5e1', charcoal:'#374151',
  silver:'#cbd5e1', pink:'#ec4899', 'light blue':'#7dd3fc', 'carolina blue':'#4b9cd3',
  'columbia blue':'#9bcbeb', teal:'#14b8a6', brown:'#5c4033', tan:'#d2b48c',
  natural:'#f0ead6', cream:'#fffdd0', sand:'#e0d3af',
};
const hexesForColor = name => {
  if (!name) return ['#cbd5e1'];
  return name.split('/').map(p => COLOR_HEX[p.trim().toLowerCase()] || '#cbd5e1');
};
const ColorSwatch = ({name, size = 12}) => {
  const hx = hexesForColor(name);
  const bg = hx.length === 1 ? hx[0]
    : `linear-gradient(135deg, ${hx[0]} 0 50%, ${hx[1]} 50% 100%)`;
  return <span style={{display: 'inline-block', width: size, height: size, borderRadius: '50%', background: bg, border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0, verticalAlign: 'middle'}} />;
};
const hexToRgb = h => {
  const m = (h || '').replace('#', '').match(/.{2}/g);
  return m ? {r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16)} : {r: 0, g: 0, b: 0};
};
// One-click placements, tuned to the 460x560 mock canvas: cx/cy = the art's
// center, w = its width in px. Staff can still drag/resize after snapping.
const PLACE_PRESETS = {
  left_chest:   {label: 'Left chest', cx: 300, cy: 198, w: 92},
  full_front:   {label: 'Full front', cx: 230, cy: 288, w: 238},
  full_back:    {label: 'Full back',  cx: 230, cy: 258, w: 250},
  left_sleeve:  {label: 'L. sleeve',  cx: 392, cy: 300, w: 62},
  right_sleeve: {label: 'R. sleeve',  cx: 68,  cy: 300, w: 62},
  center:       {label: 'Center',     cx: 230, cy: 286, w: 178},
};
// Auto-contrast for "apply to all colors": white logo on dark garments.
const _lumOf = hex => { const {r, g, b} = hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; };
const garmentIsDark = color => { const hxs = hexesForColor(color); const avg = hxs.reduce((a, h) => a + _lumOf(h), 0) / (hxs.length || 1); return avg < 110; };
const tintWhite = obj => {
  if (typeof obj.getObjects === 'function') {
    const walk = o => { if (typeof o.getObjects === 'function') { o.getObjects().forEach(walk); return; } if (o.fill && o.fill !== 'transparent') o.set('fill', '#ffffff'); if (o.stroke && o.stroke !== 'transparent') o.set('stroke', '#ffffff'); };
    walk(obj); obj.dirty = true; return;
  }
  try {
    const el = obj.getElement(); const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const ctx = off.getContext('2d', {willReadFrequently: true}); ctx.drawImage(el, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; } }
    ctx.putImageData(id, 0, 0); obj.setElement(off);
  } catch (e) {}
};

// ── NSA brand design system (navy dominant, red as accent only) ──────────────
// Mirrors the design-system tokens (tokens/colors.css, typography.css). The whole
// builder is restyled to this palette/typography; all canvas/recolor logic below
// is unchanged from the prior version.
const NSA = {
  navy: '#192853', navyDark: '#0F1A38', navyMid: '#1c2d4f',
  red: '#962C32', redBright: '#B8333B', redLight: '#D94A52',
  white: '#ffffff', offWhite: '#F7F8FB', light: '#EEF1F6', mid: '#D1D5DE',
  text: '#2A2F3E', textLight: '#5A6075', textMuted: '#8A90A0', green: '#1F7A3D',
};
const F_DISPLAY = "'Barlow Condensed','Arial Narrow',sans-serif";
const F_BODY = "'Source Sans 3','Segoe UI',system-ui,sans-serif";
// Athletic slanted look used on brand CTAs — skew the button, un-skew the label.
const SKEW = {transform: 'skewX(-3deg)'};
const UNSKEW = {display: 'inline-block', transform: 'skewX(3deg)'};
// Uppercase Barlow eyebrow used on every rail/section header.
const railLabel = {fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: NSA.textLight};
// Front/Back segmented toggle button (navy when active).
const sideBtn = on => ({border: 'none', cursor: 'pointer', padding: '7px 18px', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: .6, textTransform: 'uppercase', background: on ? NSA.navy : '#fff', color: on ? '#fff' : NSA.textLight});
// Compact body-font action button used inside the right-rail artwork cards.
const smallBtn = {display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: F_BODY, fontWeight: 600, fontSize: 11, padding: '5px 9px', borderRadius: 5, border: '1px solid ' + NSA.mid, background: '#fff', color: NSA.textLight, cursor: 'pointer'};
// Placement-preset chip in the Location section.
const locChip = {cursor: 'pointer', border: '1.5px solid ' + NSA.mid, background: '#fff', color: NSA.textLight, padding: '6px 12px', borderRadius: 5, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: .5, textTransform: 'uppercase'};
// Garment silhouette (from the design) used as a tinted thumbnail when a real
// product photo isn't on file, so each colorway still reads at a glance.
const TEE_PATH = "M150 28 C140 28 131 31 124 36 L78 64 C73 67 71 73 73 78 L92 120 C94 125 100 127 105 124 L120 116 L120 304 C120 309 124 313 129 313 L171 313 C176 313 180 309 180 304 L180 116 L195 124 C200 127 206 125 208 120 L227 78 C229 73 227 67 222 64 L176 36 C169 31 160 28 150 28 Z";
const TeeSvg = ({fill, style}) => <svg viewBox="0 0 300 340" style={style}><path d={TEE_PATH} fill={fill} stroke="rgba(0,0,0,.18)" strokeWidth="4" /></svg>;

export default function QuickMockBuilder({garments, locations, initialMocks, initialScene, onSave, onClose, nf, onSaveProductImage}){
  const [gi, setGi] = useState(0);
  const [side, setSide] = useState('front');
  const [canvas, setCanvas] = useState(null);
  const wrapRef = useRef(null);
  // Serialized art per "gi|side" so switching garment color / side (which rebuilds the
  // fabric canvas) restores the art the user already placed instead of showing blank.
  // Seeded from a previously-saved scene (keyed garmentKey|side) so re-editing a mock
  // restores the placed art at its saved size/position instead of a blank canvas.
  const sceneRef = useRef(null);
  if (sceneRef.current === null) {
    const seed = {};
    if (initialScene) garments.forEach((g, i) => ['front', 'back'].forEach(s => { const k = g.key + '|' + s; if (initialScene[k] && initialScene[k].length) seed[i + '|' + s] = initialScene[k]; }));
    sceneRef.current = seed;
  }
  // Tracks whether the current canvas has art placed/changed since its last save, so we can
  // auto-commit a side's mockup when the user switches side/garment or finishes — otherwise
  // placed-but-not-explicitly-saved art is silently lost (e.g. only the back mock saved).
  const dirtyRef = useRef(false);
  // Reactive mirror of dirtyRef so the "Done" button / footer can reflect placed-but-unsaved art.
  const [hasPending, setHasPending] = useState(false);
  const markDirty = () => { dirtyRef.current = true; setHasPending(true); };
  const clearDirty = () => { dirtyRef.current = false; setHasPending(false); };
  // Each location is a layer. preview = renderable art to place on the canvas (may come
  // from the artwork already on file). source = a NEW file to append to the artwork on save.
  const [layers, setLayers] = useState(() => locations.map(l => ({
    artFileId: l.artFileId, name: l.name, position: l.position,
    existingFiles: l.existingFiles || [],
    files: l.files || [],
    fileIdx: 0,
    preview: (l.files && l.files[0] ? l.files[0].preview : l.preview) || null,
    source: null,
    hasExisting: (l.existingFiles || []).length > 0 || !!l.preview,
    // Garment keys (sku|color) this art belongs to. Empty = applies to every garment (the
    // common one-design case); otherwise the location only shows for its own garment(s).
    garmentKeys: l.garmentKeys || [],
  })));
  const [mocks, setMocks] = useState(() => ({...(initialMocks || {})}));
  const [imgOverride, setImgOverride] = useState({});
  const [busy, setBusy] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  // Recolor targeting: artColors holds the distinct colors detected in the selected
  // art; pickedColor is the one the user chose to change (null = recolor everything).
  const [pickedColor, setPickedColor] = useState(null);
  const [artColors, setArtColors] = useState([]);
  const [sampling, setSampling] = useState(false); // cross-browser eyedropper: awaiting a canvas click
  // Identifies which drop zone (if any) a dragged file is currently hovering, so we can
  // highlight it: 'canvas', 'product', or 'layer-<idx>' for a specific art location.
  const [dragOver, setDragOver] = useState(null);
  // Size slider value for the selected art (1 = the default placement width). Seeded from
  // the selected object's current width so the slider reflects what's on the canvas.
  const [sizeVal, setSizeVal] = useState(1);
  // Colorway whose hover-zoom preview popup is showing in the left rail (null = none).
  const [hoverGi, setHoverGi] = useState(null);

  const garment = garments[gi] || {};
  const baseUrl = side === 'back' ? garment.backUrl : garment.frontUrl;
  const garmentUrl = imgOverride[garment.key] || baseUrl;
  // A location is shown for the selected garment when it isn't tied to specific garments
  // (applies to all) or its garment list includes the current one.
  const layerForGarment = l => !l.garmentKeys || !l.garmentKeys.length || l.garmentKeys.includes(garment.key);
  // Names of the art locations placed on a mock (by their layer/artFileId), so the job view can
  // label each mockup with the logo(s) it shows rather than just the filename.
  const _artLabels = layerIds => [...new Set((layerIds || []).filter(Boolean))]
    .map(id => (layers.find(l => l.artFileId === id) || {}).name).filter(Boolean).join(' + ');

  // Build the fabric canvas imperatively inside a wrapper div React owns. Fabric wraps
  // the <canvas> in its own container, so we never let React manage the canvas element
  // directly — that avoids the removeChild crash when switching garment color / side.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let disposed = false;
    const el = document.createElement('canvas');
    wrap.appendChild(el);
    const c = new fabric.Canvas(el, {width: 460, height: 560, backgroundColor: '#ffffff'});
    setCanvas(c);
    // Fresh canvas for this garment/side starts clean. User edits (drag/resize/delete) mark it
    // dirty; placing/recoloring art marks it dirty in those handlers. Restoring a saved scene and
    // adding the garment backdrop must NOT mark dirty, so we only listen to modify/remove here.
    clearDirty();
    c.on('object:modified', () => { markDirty(); });
    c.on('object:removed', () => { if (c.getObjects().some(o => o._isArt)) markDirty(); });
    const delHandler = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
        const sel = c.getActiveObject();
        if (sel && sel._isArt) { c.remove(sel); c.discardActiveObject(); c.renderAll(); }
      }
    };
    document.addEventListener('keydown', delHandler);

    // Restore art previously placed for this garment/side (the garment loads below and
    // is sent to the back, so restored art stays on top regardless of load order).
    const sceneKey = gi + '|' + side;
    const savedScene = sceneRef.current[sceneKey];
    if (savedScene && savedScene.length) {
      fabric.util.enlivenObjects(savedScene).then(objs => {
        if (disposed) return;
        objs.forEach(o => { styleArt(o); c.add(o); });
        c.renderAll();
      }).catch(() => {});
    }

    if (!garmentUrl) {
      setImgLoading(false);
    } else {
      setImgLoading(true);
      const place = imgEl => {
        if (disposed) return;
        setImgLoading(false);
        const garImg = new fabric.FabricImage(imgEl, {selectable: false, evented: false});
        const scale = Math.min(460 / garImg.width, 560 / garImg.height);
        garImg.set({scaleX: scale, scaleY: scale, left: (460 - garImg.width * scale) / 2, top: (560 - garImg.height * scale) / 2});
        c.add(garImg); c.sendObjectToBack(garImg); c.renderAll();
      };
      const proxyUrl = '/.netlify/functions/image-proxy?url=' + encodeURIComponent(garmentUrl);
      const imgEl = new Image(); imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => place(imgEl);
      imgEl.onerror = () => {
        const direct = new Image(); direct.crossOrigin = 'anonymous';
        direct.onload = () => place(direct);
        direct.onerror = () => { if (!disposed) { setImgLoading(false); c.add(new fabric.FabricText('Could not load garment image', {left: 230, top: 280, fontSize: 13, fill: '#ef4444', originX: 'center', originY: 'center', selectable: false})); c.renderAll(); } };
        direct.src = garmentUrl;
      };
      imgEl.src = proxyUrl;
    }
    return () => {
      disposed = true;
      document.removeEventListener('keydown', delHandler);
      // Snapshot the placed art before disposing so it can be restored on return.
      // Force crossOrigin so reloaded images stay canvas-exportable (no taint on re-save).
      try {
        sceneRef.current[gi + '|' + side] = c.getObjects().filter(o => o._isArt).map(o => {
          const j = o.toObject(['_isArt', '_layerId']);
          if (j.type && /image/i.test(j.type)) j.crossOrigin = 'anonymous';
          return j;
        });
      } catch (e) {}
      try { c.dispose(); } catch (e) {}
      try { wrap.innerHTML = ''; } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, side, garmentUrl]);

  const styleArt = obj => {
    obj.set({originX: 'center', originY: 'center', cornerColor: '#3b82f6', cornerStyle: 'circle', cornerSize: 10, transparentCorners: false, borderColor: '#3b82f6'});
    obj._isArt = true;
  };

  // Rasterize a Cloudinary vector doc (.ai/.eps/.pdf) to PNG, selecting a specific page/artboard.
  const vecThumb = (u, pg) => {
    if (!u) return u;
    const t = u.replace('/raw/upload/', '/image/upload/').replace('/video/upload/', '/image/upload/');
    return t.replace('/image/upload/', '/image/upload/pg_' + (pg || 1) + ',f_png/');
  };

  const clearLayer = lid => { if (!canvas) return; canvas.getObjects().filter(o => o._isArt && o._layerId === lid).forEach(o => canvas.remove(o)); };

  const placeStandIn = layer => {
    if (!canvas) return;
    const label = (layer.name || layer.position || 'ART').toUpperCase();
    const txt = new fabric.FabricText(label, {left: 230, top: 250, fontSize: 24, fontWeight: 'bold', fill: 'rgba(0,0,0,0.65)', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.7)'});
    styleArt(txt); txt._layerId = layer.artFileId;
    canvas.add(txt); canvas.setActiveObject(txt); canvas.renderAll();
    markDirty();
  };

  const isSvgUrl = u => /\.svg(\?|$)/i.test(u || '');

  // Fetch an SVG's markup (through the CORS proxy, so the canvas stays exportable) so it can
  // be rendered as vectors. Existing art on file arrives as a URL only — no inline string.
  const fetchSvgString = url => {
    const src = /^data:/.test(url) ? url : ('/.netlify/functions/image-proxy?url=' + encodeURIComponent(url));
    return fetch(src).then(r => { if (!r.ok) throw new Error('proxy ' + r.status); return r.text(); })
      .then(s => { if (!/<svg[\s>]/i.test(s)) throw new Error('not an svg'); return s; });
  };

  // Render SVG markup as a positioned, selectable vector group. Rejects on empty/unparseable
  // SVG so callers can fall back to raster loading.
  const renderSvgString = (svgString, layer) => fabric.loadSVGFromString(svgString).then(result => {
    const objects = (result && result.objects || []).filter(Boolean);
    if (!objects.length) throw new Error('empty svg');
    const group = fabric.util.groupSVGElements(objects, result.options);
    // Some SVGs (viewBox only, no width/height) parse with a zero/NaN width; guard the scale
    // so the art never collapses to an invisible, blank object.
    const w = group.width || (group.getScaledWidth ? group.getScaledWidth() : 0);
    const scale = w > 0 ? 170 / w : 1;
    group.set({left: 230, top: 250, scaleX: scale, scaleY: scale});
    styleArt(group); group._layerId = layer.artFileId;
    canvas.add(group); canvas.setActiveObject(group); canvas.renderAll();
    markDirty();
  });

  const placeLayer = layer => {
    if (!canvas) return;
    clearLayer(layer.artFileId);
    const preview = layer.preview;
    if (!preview) { placeStandIn(layer); return; }
    // Freshly dropped SVG: we already have the markup inline.
    if (preview.svgString) {
      renderSvgString(preview.svgString, layer).catch(() => addImg(preview.url, layer));
      return;
    }
    // Existing SVG art on file (URL only): loading it via <img> renders blank when the SVG has
    // no width/height attributes, so fetch the markup and render it as vectors instead.
    if (isSvgUrl(preview.url) && !preview.vectorSrc) {
      fetchSvgString(preview.url).then(s => renderSvgString(s, layer)).catch(() => addImg(preview.url, layer));
      return;
    }
    const url = preview.vectorSrc ? vecThumb(preview.vectorSrc, 1) : preview.url;
    addImg(url, layer);
  };

  // Switch which attached file this location previews (e.g. flip between a PDF and the .ai source files).
  const setLayerFile = (idx, delta) => {
    setLayers(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const files = l.files || [];
      if (!files.length) return l;
      const fileIdx = Math.max(0, Math.min(files.length - 1, (l.fileIdx || 0) + delta));
      const nl = {...l, fileIdx, preview: files[fileIdx] ? files[fileIdx].preview : l.preview};
      if (canvas && canvas.getObjects().some(o => o._isArt && o._layerId === l.artFileId)) setTimeout(() => placeLayer(nl), 0);
      return nl;
    }));
  };

  const addImg = (url, layer) => {
    // Proxy through image-proxy so cross-origin art can be drawn to (and exported from) the canvas.
    const tryLoad = () => {
      const el = new Image(); el.crossOrigin = 'anonymous';
      el.onload = () => {
        // A 0-width decode (e.g. an SVG with no intrinsic size) would scale to nothing — treat
        // it as a load failure so the stand-in fallback runs instead of placing a blank object.
        const w = el.naturalWidth || el.width;
        if (!w) { nf && nf('Could not render that art — placed a stand-in you can position', 'error'); placeStandIn(layer); return; }
        const img = new fabric.FabricImage(el);
        const scale = 150 / w;
        img.set({left: 230, top: 250, scaleX: scale, scaleY: scale});
        styleArt(img); img._layerId = layer.artFileId;
        canvas.add(img); canvas.setActiveObject(img); canvas.renderAll();
        markDirty();
      };
      return el;
    };
    const proxied = tryLoad();
    proxied.onerror = () => { const direct = tryLoad(); direct.onerror = () => { nf && nf('Could not render that art — placed a stand-in you can position', 'error'); placeStandIn(layer); }; direct.src = url; };
    proxied.src = /^data:/.test(url) ? url : ('/.netlify/functions/image-proxy?url=' + encodeURIComponent(url));
  };

  const fabricColorToHex = c => { try { return '#' + new fabric.Color(c).toHex(); } catch (e) { return null; } };
  const COLOR_TOL = 70; // sum-of-abs RGB distance for matching the picked color
  const rgbDist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

  // Extract the distinct colors in an art object. SVG: collect fills/strokes. Raster:
  // quantize pixels into buckets, keep the ones covering a meaningful share, and merge
  // near-duplicates (anti-aliasing) so the user gets a short, real palette to pick from.
  const computePalette = obj => {
    if (!obj) return [];
    if (typeof obj.getObjects === 'function') {
      const set = new Set();
      const walk = o => { if (typeof o.getObjects === 'function') { o.getObjects().forEach(walk); return; } [o.fill, o.stroke].forEach(c => { if (c && c !== 'transparent' && c !== '') { const hx = fabricColorToHex(c); if (hx) set.add(hx.toLowerCase()); } }); };
      walk(obj);
      const vout = []; [...set].forEach(hx => { const rgb = hexToRgb(hx); if (vout.length < 6 && !vout.some(o => rgbDist(hexToRgb(o), rgb) < 42)) vout.push(hx); }); return vout;
    }
    try {
      const el = obj.getElement();
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      if (!w || !h) return [];
      const sc = Math.min(1, 160 / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
      const off = document.createElement('canvas'); off.width = cw; off.height = ch;
      const ctx = off.getContext('2d', {willReadFrequently: true}); ctx.drawImage(el, 0, 0, cw, ch);
      const d = ctx.getImageData(0, 0, cw, ch).data;
      const buckets = {}; let total = 0; const STEP = 32;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        total++;
        const key = Math.round(d[i] / STEP) + ',' + Math.round(d[i + 1] / STEP) + ',' + Math.round(d[i + 2] / STEP);
        const bk = buckets[key] || (buckets[key] = {count: 0, r: 0, g: 0, b: 0});
        bk.count++; bk.r += d[i]; bk.g += d[i + 1]; bk.b += d[i + 2];
      }
      if (!total) return [];
      // Only colors that cover a meaningful share of the art, most-used first,
      // then collapse near-duplicates hard so the picker shows a few clean swatches
      // (a logo's real ink colors) instead of dozens of anti-aliased near-greys.
      const reps = Object.values(buckets).filter(b => b.count / total >= 0.045)
        .sort((a, b) => b.count - a.count).slice(0, 14)
        .map(b => '#' + [b.r, b.g, b.b].map(s => Math.round(s / b.count).toString(16).padStart(2, '0')).join(''));
      const out = [];
      reps.forEach(hx => { const rgb = hexToRgb(hx); if (out.length < 6 && !out.some(o => rgbDist(hexToRgb(o), rgb) < 58)) out.push(hx); });
      return out;
    } catch (e) { return []; }
  };

  // Recolor the selected art. With no picked color this flips the whole design to one
  // ink (per-fill for SVG, flat pixel tint for rasterized .ai/.eps/.pdf/.png). With a
  // picked color it recolors ONLY the matching fills/pixels — so one color in a
  // multi-color logo can be changed without touching the rest.
  const recolorActive = (hex, remove) => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj || !obj._isArt) { nf && nf('Select an art element to recolor', 'error'); return; }
    if (remove && !pickedColor) { nf && nf('Pick which color to remove first', 'error'); return; }
    const src = pickedColor ? hexToRgb(pickedColor) : null;
    const near = rgb => !src || rgbDist(rgb, src) <= COLOR_TOL;
    const done = () => { markDirty(); setArtColors(computePalette(obj)); if (remove) setPickedColor(null); else if (src) setPickedColor(hex); };
    if (typeof obj.getObjects === 'function') {
      const match = c => { if (!c || c === 'transparent' || c === '') return false; const hx = fabricColorToHex(c); return hx ? near(hexToRgb(hx)) : !src; };
      const apply = o => {
        if (typeof o.getObjects === 'function') { o.getObjects().forEach(apply); return; }
        if (match(o.fill)) o.set('fill', remove ? 'transparent' : hex);
        if (match(o.stroke)) o.set('stroke', remove ? 'transparent' : hex);
      };
      apply(obj); obj.dirty = true; canvas.requestRenderAll(); done();
      return;
    }
    try {
      const el = obj.getElement();
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      const off = document.createElement('canvas'); off.width = w; off.height = h;
      const ctx = off.getContext('2d', {willReadFrequently: true}); ctx.drawImage(el, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h); const d = id.data; const {r, g, b} = hexToRgb(hex || '#000000');
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        if (src && !near({r: d[i], g: d[i + 1], b: d[i + 2]})) continue;
        if (remove) { d[i + 3] = 0; continue; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      ctx.putImageData(id, 0, 0); obj.setElement(off); canvas.requestRenderAll(); done();
    } catch (e) { nf && nf('Could not recolor this art — try re-placing it', 'error'); }
  };

  // Native eyedropper — sample any color straight off the artwork (or anywhere on
  // screen) and target it for recolor, instead of hunting through swatches.
  const eyedrop = async () => {
    if (typeof window !== 'undefined' && window.EyeDropper) {
      try { const res = await new window.EyeDropper().open(); if (res && res.sRGBHex) setPickedColor(res.sRGBHex.toLowerCase()); }
      catch (_) { /* user cancelled */ }
      return;
    }
    // No native eyedropper (Safari/Firefox) — sample the next canvas click instead.
    setSampling(true); nf && nf('Click a color on the artwork to sample it', 'info');
  };

  // When sampling, the next click on the canvas reads the pixel under the cursor
  // and targets that color for recolor — so the eyedropper works in every browser.
  useEffect(() => {
    if (!canvas || !sampling) return;
    const onDown = (opt) => {
      try {
        const p = canvas.getPointer(opt.e);
        const ctx = canvas.lowerCanvasEl.getContext('2d', {willReadFrequently: true});
        const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        if (d[3] > 0) setPickedColor('#' + [d[0], d[1], d[2]].map(x => x.toString(16).padStart(2, '0')).join(''));
      } catch (_) {}
      setSampling(false);
    };
    canvas.on('mouse:down', onDown);
    canvas.defaultCursor = 'crosshair';
    return () => { canvas.off('mouse:down', onDown); canvas.defaultCursor = 'default'; };
  }, [canvas, sampling]);

  // Knock a logo's white box out to transparent so it sits cleanly on the garment.
  const knockoutWhite = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj || !obj._isArt) { nf && nf('Select an art element first', 'error'); return; }
    if (typeof obj.getObjects === 'function') { nf && nf('White knockout works on image logos (PNG/JPG)', 'error'); return; }
    try {
      const el = obj.getElement(); const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      const off = document.createElement('canvas'); off.width = w; off.height = h;
      const ctx = off.getContext('2d', {willReadFrequently: true}); ctx.drawImage(el, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h); const d = id.data;
      for (let i = 0; i < d.length; i += 4) { if (d[i] >= 240 && d[i + 1] >= 240 && d[i + 2] >= 240) d[i + 3] = 0; }
      ctx.putImageData(id, 0, 0); obj.setElement(off); canvas.requestRenderAll(); markDirty(); setArtColors(computePalette(obj));
    } catch (e) { nf && nf('Could not process this image', 'error'); }
  };

  // Snap the selected art to a standard placement (center origin + target width).
  const applyPlacement = (id) => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj || !obj._isArt) { nf && nf('Select an art element first', 'error'); return; }
    const pr = PLACE_PRESETS[id]; if (!pr) return;
    obj.set({originX: 'center', originY: 'center', left: pr.cx, top: pr.cy});
    if (typeof obj.scaleToWidth === 'function') obj.scaleToWidth(pr.w);
    obj.setCoords(); canvas.requestRenderAll(); markDirty();
  };

  // Detect the art's colors whenever an art layer is selected, so the user can pick
  // which one to change. Clearing the selection resets the palette.
  useEffect(() => {
    if (!canvas) return;
    const onSel = () => { const o = canvas.getActiveObject(); if (o && o._isArt) { setArtColors(computePalette(o)); const w = typeof o.getScaledWidth === 'function' ? o.getScaledWidth() : 150; setSizeVal(Math.max(0.4, Math.min(1.7, w / 150))); } };
    const onClear = () => { setArtColors([]); setPickedColor(null); setSizeVal(1); };
    canvas.on('selection:created', onSel);
    canvas.on('selection:updated', onSel);
    canvas.on('selection:cleared', onClear);
    return () => { try { canvas.off('selection:created', onSel); canvas.off('selection:updated', onSel); canvas.off('selection:cleared', onClear); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  const uploadLayerFile = useCallback(async (idx, file, {place} = {}) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
    const isSvg = ext === 'svg';
    const isVectorDoc = ['ai', 'eps', 'pdf'].includes(ext);
    setBusy(true);
    try {
      nf && nf('Uploading ' + file.name + '...');
      const url = await fileUpload(file, 'nsa-art-requests');
      const source = {name: file.name, url, size: file.size, type: file.type};
      let preview = null;
      if (isSvg) { const svgString = await file.text(); preview = {url, svgString}; }
      else if (isImg) { preview = {url}; }
      else if (isVectorDoc) { const png = _cloudinaryPdfThumb(url); if (png) preview = {url: png, vectorSrc: url}; }
      let placed = null;
      setLayers(prev => prev.map((l, i) => { if (i !== idx) return l; placed = {...l, source, preview, hasExisting: l.hasExisting}; return placed; }));
      nf && nf(file.name + ' attached' + (preview ? (isVectorDoc ? ' — generating a preview to place' : '') : ' (a stand-in will be placed on the mock)'));
      // When the file was dropped onto the garment, place it straight away so the rep
      // doesn't have to click "Place" afterward.
      if (place && placed) placeLayer(placed);
    } catch (e) {
      nf && nf('Upload failed: ' + e.message, 'error');
    } finally { setBusy(false); }
  }, [nf, placeLayer]);

  // Accepted art file extensions for the location cards and the garment drop zone.
  const ART_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ai', 'eps', 'pdf'];
  const isArtFile = f => ART_EXTS.includes((f.name.split('.').pop() || '').toLowerCase());

  // Handle a file dropped onto the garment canvas: upload it to a target art location and
  // place it. Target = the currently selected art's location, else the first location
  // without a newly uploaded file, else the first location.
  const dropArtOnCanvas = useCallback(file => {
    if (!file) return;
    if (!isArtFile(file)) { nf && nf('Drop a PNG, JPG, SVG, AI, EPS, or PDF art file', 'error'); return; }
    // Only consider art locations that belong to the garment currently on screen.
    const applies = (i) => layerForGarment(layers[i]);
    const visible = layers.map((l, i) => i).filter(applies);
    if (!visible.length) { nf && nf('No art location for this garment to attach art to', 'error'); return; }
    let idx = -1;
    const active = canvas && canvas.getActiveObject();
    if (active && active._isArt && active._layerId) { const i = layers.findIndex(l => l.artFileId === active._layerId); if (i >= 0 && applies(i)) idx = i; }
    if (idx < 0) idx = visible.find(i => !layers[i].source);
    if (idx == null || idx < 0) idx = visible[0];
    uploadLayerFile(idx, file, {place: true});
  }, [canvas, layers, uploadLayerFile, nf, garment.key]);

  const uploadGarmentImg = useCallback(async file => {
    setBusy(true);
    try {
      nf && nf('Uploading product image...');
      const url = await fileUpload(file, 'nsa-products');
      setImgOverride(prev => ({...prev, [garment.key]: url}));
      // Persist the photo back to the product catalog (matched by SKU/color) so it's reused
      // next time instead of re-uploaded. onSaveProductImage returns true when it matched a
      // catalog product. The current side decides whether it's the front or back image.
      if (onSaveProductImage) {
        const saved = await onSaveProductImage(garment, url, side);
        if (saved) nf && nf('Saved to the product catalog for future use');
      }
    } catch (e) { nf && nf('Upload failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }, [garment, side, nf, onSaveProductImage]);

  // Saves the current canvas as a mock for the current garment+side. Returns {key, entry} on
  // success (null otherwise) so callers can fold the just-saved mock into state that hasn't
  // re-rendered yet (e.g. on "Done").
  const saveColorMock = useCallback(async ({silent} = {}) => {
    if (!canvas) return null;
    if (!canvas.getObjects().some(o => o._isArt)) { if (!silent) nf && nf('Place at least one art layer before saving', 'error'); return null; }
    setBusy(true);
    try {
      const dataUrl = canvas.toDataURL({format: 'png', multiplier: 2});
      const blob = await (await fetch(dataUrl)).blob();
      const safe = s => (s || '').toString().replace(/[\/\\?%*:|"<>\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const fname = 'mock-' + (safe(garment.sku) || 'item') + '-' + (safe(garment.color) || 'default') + '-' + side + '.png';
      const fileObj = new File([blob], fname, {type: 'image/png'});
      const url = await fileUpload(fileObj, 'nsa-mockups');
      const art_label = _artLabels(canvas.getObjects().filter(o => o._isArt).map(o => o._layerId));
      const entry = {url, name: fname, sku: garment.sku, side, art_label};
      const key = garment.key;
      setMocks(prev => {
        const cur = (prev[key] || []).filter(m => m.name !== fname);
        return {...prev, [key]: [...cur, entry]};
      });
      clearDirty();
      nf && nf('Mockup saved for ' + (garment.color || garment.sku) + ' (' + side + ')');
      return {key, entry};
    } catch (e) { nf && nf('Could not save mockup: ' + e.message, 'error'); return null; }
    finally { setBusy(false); }
  }, [canvas, garment, side, nf]);

  // Before leaving the current garment/side (switching side, switching garment, or finishing),
  // auto-save any placed-but-unsaved art so a mock isn't silently lost. No-op when nothing changed.
  const commitPending = useCallback(async () => {
    if (!dirtyRef.current) return null;
    if (!canvas || !canvas.getObjects().some(o => o._isArt)) return null;
    return await saveColorMock({silent: true});
  }, [canvas, saveColorMock]);

  const switchSide = useCallback(async s => { if (s === side || busy) return; await commitPending(); setSide(s); }, [side, busy, commitPending]);
  const switchGarment = useCallback(async i => { if (i === gi || busy) return; await commitPending(); setSide('front'); setGi(i); }, [gi, busy, commitPending]);

  const _safeName = s => (s || '').toString().replace(/[\/\\?%*:|"<>\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const _mockFname = (g, sd) => 'mock-' + (_safeName(g.sku) || 'item') + '-' + (_safeName(g.color) || 'default') + '-' + sd + '.png';

  // Load a garment image CORS-clean (proxy first, direct fallback) for offscreen rendering.
  const _loadImg = garmentUrl => new Promise(resolve => {
    if (!garmentUrl) return resolve(null);
    const proxyUrl = '/.netlify/functions/image-proxy?url=' + encodeURIComponent(garmentUrl);
    const attempt = (src, onFail) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = onFail; im.src = src; };
    attempt(proxyUrl, () => attempt(garmentUrl, () => resolve(null)));
  });

  // Render a stored scene (placed art for one garment+side) to a PNG and upload it as a mock.
  const _renderSceneMock = async (g, sd, sceneObjs, makeWhite) => {
    const el = document.createElement('canvas');
    const c = new fabric.Canvas(el, {width: 460, height: 560, backgroundColor: '#ffffff'});
    try {
      const garmentUrl = imgOverride[g.key] || (sd === 'back' ? g.backUrl : g.frontUrl);
      const imgEl = await _loadImg(garmentUrl);
      if (imgEl) {
        const garImg = new fabric.FabricImage(imgEl, {selectable: false, evented: false});
        const scale = Math.min(460 / garImg.width, 560 / garImg.height);
        garImg.set({scaleX: scale, scaleY: scale, left: (460 - garImg.width * scale) / 2, top: (560 - garImg.height * scale) / 2});
        c.add(garImg); c.sendObjectToBack(garImg);
      }
      const objs = await fabric.util.enlivenObjects(sceneObjs);
      objs.forEach(o => c.add(o));
      if (makeWhite) objs.forEach(tintWhite);
      c.renderAll();
      const dataUrl = c.toDataURL({format: 'png', multiplier: 2});
      const blob = await (await fetch(dataUrl)).blob();
      const fname = _mockFname(g, sd);
      const url = await fileUpload(new File([blob], fname, {type: 'image/png'}), 'nsa-mockups');
      const art_label = _artLabels((sceneObjs || []).map(o => o._layerId));
      return {key: g.key, entry: {url, name: fname, sku: g.sku, side: sd, art_label}};
    } catch (e) { return null; }
    finally { try { c.dispose(); } catch (e2) {} }
  };

  // Done renders & saves a mock for every garment+side the rep placed art on — not just the
  // one on screen. The current canvas is snapshotted into the scene store first so it's included.
  // The serialized scenes are also re-keyed by garmentKey|side and passed back so a later
  // "Edit Mock" can restore the placed art.
  const handleDone = async () => {
    setBusy(true);
    try {
      if (canvas) {
        try {
          sceneRef.current[gi + '|' + side] = canvas.getObjects().filter(o => o._isArt).map(o => {
            const j = o.toObject(['_isArt', '_layerId']);
            if (j.type && /image/i.test(j.type)) j.crossOrigin = 'anonymous';
            return j;
          });
        } catch (e) {}
      }
      let finalMocks = {...mocks};
      const curKey = gi + '|' + side;
      for (const [k, objs] of Object.entries(sceneRef.current)) {
        if (!Array.isArray(objs) || !objs.length) continue;
        const [giStr, sd] = k.split('|');
        const g = garments[Number(giStr)];
        if (!g) continue;
        // Scenes left behind were auto-saved on exit; skip re-uploading an unchanged one. Always
        // (re)render the current view so its latest positions win.
        if (k !== curKey && (finalMocks[g.key] || []).some(m => m.name === _mockFname(g, sd))) continue;
        const res = await _renderSceneMock(g, sd, objs);
        if (res) {
          const cur = (finalMocks[res.key] || []).filter(m => m.name !== res.entry.name);
          finalMocks = {...finalMocks, [res.key]: [...cur, res.entry]};
        }
      }
      setMocks(finalMocks);
      clearDirty();
      const filesByLocation = {};
      // Only newly uploaded files get appended — art already on the artwork stays as-is.
      layers.forEach(l => { if (l.source && l.artFileId) filesByLocation[l.artFileId] = [...(filesByLocation[l.artFileId] || []), l.source]; });
      // Re-key the scenes by garmentKey|side so a later edit can restore the placed art.
      const sceneByGarment = {};
      Object.entries(sceneRef.current).forEach(([k, objs]) => { if (!objs || !objs.length) return; const sep = k.lastIndexOf('|'); const g = garments[+k.slice(0, sep)]; if (g) sceneByGarment[g.key + '|' + k.slice(sep + 1)] = objs; });
      onSave({mocksByGarment: finalMocks, filesByLocation, sceneByGarment});
    } finally { setBusy(false); }
  };

  // Apply the current placement to EVERY garment color in one pass — auto-whitening
  // the logo on dark garments. Renders + uploads a mock for each, all editable after.
  const applyToAllColors = async () => {
    if (!canvas) return;
    const artObjs = canvas.getObjects().filter(o => o._isArt);
    if (!artObjs.length) { nf && nf('Place the logo first, then apply it to all colors', 'error'); return; }
    const sceneObjs = artObjs.map(o => { const j = o.toObject(['_isArt', '_layerId']); if (j.type && /image/i.test(j.type)) j.crossOrigin = 'anonymous'; return j; });
    setBusy(true);
    try {
      let next = {...mocks}; let n = 0;
      for (let i = 0; i < garments.length; i++) {
        const g = garments[i];
        sceneRef.current[i + '|front'] = sceneObjs; // keep editable per garment
        const res = await _renderSceneMock(g, 'front', sceneObjs, garmentIsDark(g.color));
        if (res) { next = {...next, [res.key]: [...(next[res.key] || []).filter(m => m.name !== res.entry.name), res.entry]}; n++; }
      }
      setMocks(next); clearDirty();
      nf && nf('Logo applied to ' + n + ' color' + (n === 1 ? '' : 's') + ' — review any, then Done');
    } catch (e) { nf && nf('Could not apply to all colors: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  };

  // Make sure the NSA brand webfonts (Barlow Condensed / Source Sans 3) are present even
  // when the host page (the main portal) didn't load them — the storefront does, the app shell doesn't.
  useEffect(() => {
    const id = 'nsa-brand-fonts';
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';
    document.head.appendChild(link);
  }, []);

  // Resize the selected art from the Size slider (1 = the default placement width of 150px).
  const applySize = v => {
    setSizeVal(v);
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj || !obj._isArt) return;
    if (typeof obj.scaleToWidth === 'function') obj.scaleToWidth(150 * v);
    obj.setCoords(); canvas.requestRenderAll(); markDirty();
  };

  // Best thumbnail for a garment row: the rep's uploaded override, else the catalog front photo.
  const thumbFor = g => imgOverride[g.key] || g.frontUrl || '';

  // Logo Library: open a file picker and upload/replace the art for one location, placing it.
  const pickFileFor = idx => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.png,.jpg,.jpeg,.svg,.ai,.eps,.pdf'; inp.onchange = () => { if (inp.files[0]) uploadLayerFile(idx, inp.files[0], {place: true}); }; inp.click(); };
  // "+ Logo": add new art. Prefer filling an empty existing location (so the source attaches to a
  // real art slot); otherwise spin up a new local logo layer for this garment and upload into it.
  const addLogoFile = file => {
    if (!file) return;
    if (!isArtFile(file)) { nf && nf('Drop a PNG, JPG, SVG, AI, EPS, or PDF art file', 'error'); return; }
    const emptyIdx = layers.findIndex(l => layerForGarment(l) && !l.source && !l.hasExisting && !l.preview);
    if (emptyIdx >= 0) { uploadLayerFile(emptyIdx, file, {place: true}); return; }
    const newId = 'qm-logo-' + Date.now();
    const baseName = file.name.split('.').slice(0, -1).join('.') || file.name;
    const newIdx = layers.length;
    setLayers(prev => [...prev, {artFileId: newId, name: baseName, position: '', existingFiles: [], files: [], fileIdx: 0, preview: null, source: null, hasExisting: false, garmentKeys: []}]);
    uploadLayerFile(newIdx, file, {place: true});
  };
  const addLogo = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.png,.jpg,.jpeg,.svg,.ai,.eps,.pdf'; inp.onchange = () => { if (inp.files[0]) addLogoFile(inp.files[0]); }; inp.click(); };
  // Does a location have art to place (a preview, a freshly attached source, or art on file)?
  const layerHasArt = l => !!(l.preview || l.source || l.hasExisting);

  const savedCount = Object.values(mocks).filter(a => (a || []).length > 0).length;
  const pct = garments.length ? Math.round(savedCount / garments.length * 100) : 0;

  return (
    <div onClick={onClose} style={{position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,26,56,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: F_BODY}}>
      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
      <div onClick={e => e.stopPropagation()} style={{width: 1040, maxWidth: '100%', height: 792, maxHeight: '94vh', background: '#fff', borderRadius: 8, boxShadow: '0 30px 70px rgba(0,0,0,.45)', overflow: 'hidden', display: 'flex', flexDirection: 'column', color: NSA.text}}>

        {/* ── Header ── */}
        <div style={{background: 'linear-gradient(120deg,' + NSA.navy + ',' + NSA.navyMid + ')', color: '#fff', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '4px solid ' + NSA.red, flex: 'none'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 14, minWidth: 0}}>
            <div style={{width: 38, height: 38, borderRadius: 6, background: NSA.red, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'skewX(-6deg)', flex: 'none'}}>
              <span style={{transform: 'skewX(6deg)', fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 22, lineHeight: 1}}>★</span>
            </div>
            <div style={{minWidth: 0}}>
              <div style={{fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 24, letterSpacing: .5, textTransform: 'uppercase', lineHeight: 1}}>Mock Builder</div>
              <div style={{fontSize: 13, color: 'rgba(255,255,255,.72)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{[garment.name || garment.sku, garment.color].filter(Boolean).join(' · ') || 'Build mockups for coach review'}</div>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 22, flex: 'none'}}>
            <div style={{textAlign: 'right'}}>
              <div style={{fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.7)'}}>Progress</div>
              <div style={{fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 20, lineHeight: 1}}>{savedCount} of {garments.length} mocked</div>
              <div style={{width: 180, height: 5, background: 'rgba(255,255,255,.18)', borderRadius: 4, marginTop: 5, overflow: 'hidden'}}><div style={{height: '100%', background: NSA.redLight, borderRadius: 4, width: pct + '%', transition: 'width .25s'}} /></div>
            </div>
            <button onClick={onClose} style={{width: 30, height: 30, borderRadius: 6, background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', lineHeight: 1}}>×</button>
          </div>
        </div>

        {/* ── Body: three columns ── */}
        <div style={{flex: 1, display: 'flex', minHeight: 0}}>

          {/* Left rail — garment colors */}
          <div style={{width: 262, borderRight: '1px solid ' + NSA.light, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 'none'}}>
            <div style={{padding: '14px 18px 10px', flex: 'none'}}>
              <div style={railLabel}>Garment Colors · {garments.length}</div>
              <div style={{fontSize: 12.5, color: NSA.textMuted, marginTop: 2}}>Pick a color to build its mockup</div>
            </div>
            <div style={{flex: 1, overflowY: 'auto', padding: '0 10px 12px'}}>
              {garments.map((g, i) => { const active = i === gi; const done = (mocks[g.key] || []).length > 0; const tu = thumbFor(g); return (
                <button key={g.key} onClick={() => switchGarment(i)} onMouseEnter={() => setHoverGi(i)} onMouseLeave={() => setHoverGi(h => h === i ? null : h)} disabled={busy}
                  style={{position: 'relative', width: '100%', textAlign: 'left', border: 'none', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 6, marginBottom: 3, borderLeft: '3px solid ' + (active ? NSA.red : 'transparent'), background: active ? NSA.light : '#fff'}}>
                  <span style={{position: 'relative', flex: 'none', display: 'flex'}}>
                    <span style={{width: 36, height: 36, borderRadius: 6, background: '#F4F6FA', border: '1px solid ' + NSA.light, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
                      {tu ? <img src={tu} alt="" style={{width: '100%', height: '100%', objectFit: 'contain'}} /> : <TeeSvg fill={hexesForColor(g.color)[0]} style={{width: '122%', height: '122%'}} />}
                    </span>
                    {hoverGi === i && <span style={{position: 'absolute', left: 'calc(100% + 14px)', top: '50%', transform: 'translateY(-50%)', zIndex: 60, width: 186, background: '#fff', border: '1px solid ' + NSA.light, borderRadius: 10, boxShadow: '0 18px 44px rgba(15,26,56,.26)', padding: 12, pointerEvents: 'none'}}>
                      <span style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150, background: NSA.offWhite, borderRadius: 7, overflow: 'hidden'}}>
                        {tu ? <img src={tu} alt="" style={{maxWidth: '92%', maxHeight: '92%', objectFit: 'contain'}} /> : <TeeSvg fill={hexesForColor(g.color)[0]} style={{width: '82%', height: '82%'}} />}
                      </span>
                      <span style={{display: 'block', textAlign: 'center', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 16, color: NSA.navy, marginTop: 9, lineHeight: 1.05}}>{g.name || g.sku || 'Item'}</span>
                      <span style={{display: 'block', textAlign: 'center', fontSize: 12, color: NSA.textMuted}}>{g.sku || ''}</span>
                    </span>}
                  </span>
                  <span style={{flex: 1, minWidth: 0}}>
                    <span style={{display: 'block', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: .3, color: NSA.navy, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{g.name || g.sku || 'Item'}</span>
                    <span style={{display: 'block', fontSize: 12, color: NSA.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{g.sku || ''}</span>
                  </span>
                  {done ? <span style={{flex: 'none', width: 20, height: 20, borderRadius: '50%', background: NSA.green, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800}}>✓</span>
                    : <span style={{flex: 'none', width: 18, height: 18, borderRadius: '50%', border: '2px dashed ' + NSA.mid}} />}
                </button>
              ); })}
            </div>
            <div style={{padding: '11px 14px', borderTop: '1px solid ' + NSA.light, flex: 'none'}}>
              <button onClick={applyToAllColors} disabled={busy} title="Place this logo on every garment color at once (auto-white on dark garments)"
                style={{width: '100%', border: '1.5px solid ' + NSA.navy, background: '#fff', color: NSA.navy, cursor: busy ? 'default' : 'pointer', padding: 9, borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: .8, textTransform: 'uppercase', opacity: busy ? .6 : 1, ...SKEW}}><span style={UNSKEW}>⚡ Apply art to all {garments.length}</span></button>
            </div>
          </div>

          {/* Center — canvas */}
          <div style={{flex: 1, display: 'flex', flexDirection: 'column', background: NSA.offWhite, minWidth: 0}}>
            <div style={{padding: '14px 22px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', flex: 'none'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, minWidth: 0}}>
                {garment.color && <ColorSwatch name={garment.color} size={18} />}
                <span style={{fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 18, color: NSA.navy, textTransform: 'uppercase', letterSpacing: .3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{garment.name || garment.sku} — {garment.color || 'Default'}</span>
              </div>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, flex: 'none'}}>
                <button onClick={() => { if (!canvas) return; const sel = canvas.getActiveObject(); if (sel && sel._isArt) { canvas.remove(sel); canvas.discardActiveObject(); canvas.renderAll(); } else nf && nf('Select an art element to delete', 'error'); }} title="Delete selected art"
                  style={{display: 'inline-flex', alignItems: 'center', gap: 5, border: '1.5px solid ' + NSA.mid, background: '#fff', color: NSA.textLight, cursor: 'pointer', padding: '6px 12px', borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: .4, textTransform: 'uppercase'}}><Icon name="trash" size={13} /> Delete</button>
                {garment.backUrl && <div style={{display: 'flex', border: '1.5px solid ' + NSA.mid, borderRadius: 6, overflow: 'hidden'}}>
                  <button onClick={() => switchSide('front')} disabled={busy} style={sideBtn(side === 'front')}>Front</button>
                  <button onClick={() => switchSide('back')} disabled={busy} style={{...sideBtn(side === 'back'), borderLeft: '1.5px solid ' + NSA.mid}}>Back</button>
                </div>}
              </div>
            </div>
            <div style={{flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '6px 12px 16px', minHeight: 0}}>
              <div
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('canvas'); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'canvas' ? null : d); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (f) dropArtOnCanvas(f); }}
                style={{position: 'relative', borderRadius: 12, padding: 4, outline: dragOver === 'canvas' ? '2px dashed ' + NSA.red : 'none', outlineOffset: 2, flex: 'none'}}>
                <div style={{position: 'relative', background: '#fff', border: '1px solid ' + NSA.light, borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 24px rgba(25,40,83,.08)'}}>
                  <div ref={wrapRef} />
                  {(imgLoading || (!garmentUrl && garment.pending)) && <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(247,248,251,0.85)', pointerEvents: 'none'}}>
                    <span style={{width: 26, height: 26, border: '3px solid ' + NSA.light, borderTopColor: NSA.red, borderRadius: '50%', animation: 'spin 1s linear infinite'}} />
                    <span style={{fontSize: 12, color: NSA.navy, fontWeight: 600}}>Loading product image…</span>
                  </div>}
                  {!garmentUrl && !garment.pending && !imgLoading && <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none'}}>
                    <Icon name="image" size={28} style={{color: NSA.mid}} />
                    <span style={{fontSize: 12, color: NSA.textMuted, fontWeight: 600}}>No product image — upload one</span>
                  </div>}
                  {dragOver === 'canvas' && <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(150,44,50,0.08)', pointerEvents: 'none'}}>
                    <Icon name="upload" size={28} style={{color: NSA.red}} />
                    <span style={{fontSize: 12, color: NSA.red, fontWeight: 700}}>Drop art to place it on the garment</span>
                  </div>}
                </div>
              </div>
              <div style={{fontSize: 11.5, color: NSA.textMuted, textAlign: 'center'}}>Drag an art file onto the garment to place it. Click art to select; drag to move, corners to resize. Press Delete to remove.</div>
              {(mocks[garment.key] || []).length > 0 && <div style={{width: '100%', maxWidth: 480, paddingTop: 8, borderTop: '1px solid ' + NSA.light}}>
                <div style={{fontSize: 11, fontWeight: 700, color: NSA.green, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4}}>
                  <Icon name="check" size={12} /> Saved mock{(mocks[garment.key].length > 1 ? 's' : '')} for {garment.color || garment.sku}
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  {(mocks[garment.key] || []).map((m, mi) => <div key={mi} style={{position: 'relative', border: '1px solid ' + NSA.light, borderRadius: 6, padding: 4, background: '#fff'}}>
                    <img src={m.url} alt={m.name} style={{width: 72, height: 88, objectFit: 'contain', display: 'block'}} />
                    <button title="Remove this mock" onClick={() => setMocks(prev => ({...prev, [garment.key]: (prev[garment.key] || []).filter((_, x) => x !== mi)}))}
                      style={{position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: NSA.red, color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0}}>×</button>
                  </div>)}
                </div>
              </div>}
            </div>
          </div>

          {/* Right rail — tools */}
          <div style={{width: 290, borderLeft: '1px solid ' + NSA.light, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', flex: 'none'}}>

            {/* Logo Library — tap a tile to place; drag & drop (or the corner button) to add/replace */}
            <div style={{padding: '16px 18px 4px'}}>
              <div style={{...railLabel, marginBottom: 2}}>Logo Library</div>
              <div style={{fontSize: 11.5, color: NSA.textMuted, marginBottom: 9, lineHeight: 1.35}}>Tap to place · drag &amp; drop a PNG / SVG / AI to add</div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
                {layers.map((l, idx) => !layerForGarment(l) ? null : (
                  <div key={l.artFileId || idx}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('layer-' + idx); }}
                    onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'layer-' + idx ? null : d); }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (!f) return; if (!isArtFile(f)) { nf && nf('Drop a PNG, JPG, SVG, AI, EPS, or PDF art file', 'error'); return; } uploadLayerFile(idx, f, {place: true}); }}
                    style={{position: 'relative', border: '2px solid ' + (dragOver === 'layer-' + idx ? NSA.red : NSA.light), borderRadius: 9, overflow: 'hidden', background: '#fff', transition: 'border-color .12s'}}>
                    <button onClick={() => layerHasArt(l) ? placeLayer(l) : pickFileFor(idx)} disabled={busy} title={layerHasArt(l) ? 'Tap to place ' + (l.name || 'logo') : 'Upload art for ' + (l.name || 'this location')}
                      style={{display: 'block', width: '100%', border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', padding: 0}}>
                      <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: 74, padding: 8}}>
                        {l.preview && l.preview.url
                          ? <img src={l.preview.url} alt="" style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} />
                          : layerHasArt(l)
                          ? <span style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: NSA.textMuted}}><Icon name="file" size={20} /><span style={{fontSize: 9.5, fontWeight: 600}}>Attached</span></span>
                          : <span style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: NSA.mid}}><Icon name="image" size={20} /><span style={{fontSize: 9.5, fontWeight: 600, color: NSA.textMuted}}>Upload</span></span>}
                      </span>
                      <span style={{display: 'block', background: NSA.navy, color: '#fff', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 11, letterSpacing: .4, textTransform: 'uppercase', textAlign: 'center', padding: '4px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{l.name || l.position || 'Logo'}</span>
                    </button>
                    {layerHasArt(l) && <button onClick={() => pickFileFor(idx)} disabled={busy} title="Replace this art" style={{position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 6, border: '1px solid ' + NSA.mid, background: 'rgba(255,255,255,.92)', color: NSA.textLight, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0}}><Icon name="upload" size={12} /></button>}
                    {!l.source && l.files && l.files.length > 1 && <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 10, color: NSA.textLight, padding: '3px 0', borderTop: '1px solid ' + NSA.light, background: NSA.offWhite}}>
                      <button style={{border: 'none', background: 'transparent', cursor: 'pointer', color: NSA.textLight, padding: '0 4px', fontWeight: 700}} disabled={busy || (l.fileIdx || 0) <= 0} onClick={() => setLayerFile(idx, -1)}>◀</button>
                      <span style={{fontWeight: 700}}>{(l.fileIdx || 0) + 1}/{l.files.length}</span>
                      <button style={{border: 'none', background: 'transparent', cursor: 'pointer', color: NSA.textLight, padding: '0 4px', fontWeight: 700}} disabled={busy || (l.fileIdx || 0) >= l.files.length - 1} onClick={() => setLayerFile(idx, 1)}>▶</button>
                    </div>}
                  </div>
                ))}
                <button onClick={addLogo} disabled={busy} title="Add a new logo (PNG / SVG / AI)"
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('add-logo'); }}
                  onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'add-logo' ? null : d); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (f) addLogoFile(f); }}
                  style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 104, border: '2px dashed ' + (dragOver === 'add-logo' ? NSA.red : NSA.mid), borderRadius: 9, background: dragOver === 'add-logo' ? '#FBE9EA' : '#fff', color: NSA.textLight, cursor: busy ? 'default' : 'pointer', fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: .4, textTransform: 'uppercase'}}>
                  <Icon name="plus" size={18} /> Logo
                </button>
              </div>
            </div>

            {/* Product image */}
            <div style={{padding: '6px 18px 4px'}}>
              <div
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('product'); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'product' ? null : d); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (!f) return; if (!f.type.startsWith('image/')) { nf && nf('Drop an image file for the product photo', 'error'); return; } uploadGarmentImg(f); }}
                style={{borderRadius: 7, padding: dragOver === 'product' ? 8 : 0, background: dragOver === 'product' ? '#FBE9EA' : 'transparent', boxShadow: dragOver === 'product' ? '0 0 0 1.5px ' + NSA.red : 'none', transition: 'background .12s'}}>
                <div style={{...railLabel, marginBottom: 6}}>Product Image</div>
                {garmentUrl ? <div style={{fontSize: 11.5, color: NSA.green, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4}}><Icon name="check" size={12} /> Using catalog image</div>
                  : <div style={{fontSize: 11.5, color: NSA.redBright, marginBottom: 6}}>Not in system — drag an image here or upload</div>}
                <button style={{...smallBtn, opacity: busy ? .6 : 1}} disabled={busy}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { if (inp.files[0]) uploadGarmentImg(inp.files[0]); }; inp.click(); }}>
                  <Icon name="upload" size={11} /> Upload Product Image
                </button>
              </div>
            </div>

            {/* Location (placement presets) */}
            <div style={{padding: '12px 18px 4px'}}>
              <div style={{...railLabel, marginBottom: 9}}>Location</div>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                {Object.entries(PLACE_PRESETS).map(([id, pr]) => <button key={id} onClick={() => applyPlacement(id)} title={'Snap the selected art to ' + pr.label} style={locChip}>{pr.label}</button>)}
              </div>
            </div>

            {/* Size */}
            <div style={{padding: '12px 18px 4px'}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7}}>
                <span style={railLabel}>Size</span>
                <span style={{fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 14, color: NSA.navy}}>{Math.round(sizeVal * 100)}%</span>
              </div>
              <input type="range" min="0.4" max="1.7" step="0.02" value={sizeVal} onChange={e => applySize(parseFloat(e.target.value))} style={{width: '100%', accentColor: NSA.red}} />
            </div>

            {/* Recolor — two-step picker (pick a color in the logo, then change it) */}
            <div style={{padding: '12px 18px 6px'}}>
              <div style={{...railLabel, marginBottom: 9}}>Recolor Art</div>
              {artColors.length > 0 ? (<>
                <div style={{fontSize: 12, fontWeight: 700, color: NSA.textLight, marginBottom: 7}}>1 · Pick a color</div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12}}>
                  <button onClick={() => setPickedColor(null)} title="Recolor the whole design at once" style={{fontSize: 11.5, padding: '5px 11px', borderRadius: 999, border: '1.5px solid ' + (!pickedColor ? NSA.navy : NSA.mid), background: !pickedColor ? NSA.light : '#fff', color: NSA.navy, cursor: 'pointer', fontWeight: 700}}>Whole</button>
                  {artColors.map(c => { const sel = pickedColor && rgbDist(hexToRgb(pickedColor), hexToRgb(c)) < 12; return <button key={c} onClick={() => setPickedColor(c)} title={c} style={{width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: sel ? '3px solid ' + NSA.navy : '2px solid rgba(0,0,0,.12)', boxShadow: '0 1px 3px rgba(0,0,0,.12),inset 0 0 0 1px rgba(0,0,0,.06)'}} />; })}
                  <button onClick={eyedrop} title="Eyedropper — sample a color from the artwork" style={{display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, padding: '6px 11px', borderRadius: 999, border: '1.5px solid ' + (sampling ? NSA.navy : NSA.mid), background: sampling ? NSA.light : '#fff', color: NSA.navy, cursor: 'pointer'}}><span aria-hidden="true" style={{fontSize: 14, lineHeight: 1}}>🎯</span> {sampling ? 'Click art…' : 'Pick'}</button>
                  <button onClick={knockoutWhite} title="Make the logo's white background transparent" style={{fontSize: 11.5, fontWeight: 700, padding: '6px 11px', borderRadius: 999, border: '1.5px solid ' + NSA.mid, background: '#fff', color: NSA.navy, cursor: 'pointer'}}>Knock out white</button>
                </div>
                <div style={{fontSize: 12, fontWeight: 700, color: NSA.textLight, marginBottom: 7}}>2 · Change {pickedColor ? 'it' : 'everything'} to</div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center'}}>
                  <button onClick={() => recolorActive('#ffffff')} title="White" style={{width: 30, height: 30, borderRadius: '50%', background: '#fff', border: '2px solid ' + NSA.mid, cursor: 'pointer', padding: 0}} />
                  <button onClick={() => recolorActive('#111827')} title="Black" style={{width: 30, height: 30, borderRadius: '50%', background: '#111827', border: '2px solid rgba(0,0,0,.12)', cursor: 'pointer', padding: 0}} />
                  <button onClick={() => recolorActive(NSA.navy)} title="Navy" style={{width: 30, height: 30, borderRadius: '50%', background: NSA.navy, border: '2px solid rgba(0,0,0,.12)', cursor: 'pointer', padding: 0}} />
                  <button onClick={() => recolorActive(NSA.red)} title="Red" style={{width: 30, height: 30, borderRadius: '50%', background: NSA.red, border: '2px solid rgba(0,0,0,.12)', cursor: 'pointer', padding: 0}} />
                  <label style={{display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: NSA.textLight, cursor: 'pointer'}}>Custom<input type="color" onChange={e => recolorActive(e.target.value)} title="Custom color" style={{width: 32, height: 28, padding: 0, border: '1px solid ' + NSA.mid, borderRadius: 7, cursor: 'pointer', background: '#fff'}} /></label>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap'}}>
                  {pickedColor && <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: NSA.textLight, fontWeight: 600}}>targeting<span style={{width: 16, height: 16, borderRadius: 4, background: pickedColor, border: '1px solid ' + NSA.mid}} />{pickedColor}</span>}
                  <button onClick={() => recolorActive(null, true)} disabled={!pickedColor} title={pickedColor ? 'Make this color transparent' : 'Pick a color first'} style={{fontSize: 11.5, padding: '6px 12px', borderRadius: 999, border: '1.5px solid ' + (pickedColor ? '#f0bcc0' : NSA.light), background: '#fff', color: pickedColor ? NSA.red : NSA.textMuted, cursor: pickedColor ? 'pointer' : 'not-allowed', fontWeight: 700, marginLeft: 'auto'}}>Remove color</button>
                </div>
              </>) : (
                <div style={{fontSize: 12, color: NSA.textMuted, lineHeight: 1.5}}>Click a placed logo on the garment to recolor it. Drag it to reposition; resize with the slider above.</div>
              )}
            </div>

            {/* Save */}
            <div style={{marginTop: 'auto', padding: '14px 18px 16px', borderTop: '1px solid ' + NSA.light}}>
              <button onClick={saveColorMock} disabled={busy}
                style={{width: '100%', border: 'none', cursor: busy ? 'default' : 'pointer', background: NSA.red, color: '#fff', padding: 11, borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 15, letterSpacing: .8, textTransform: 'uppercase', boxShadow: '0 6px 18px rgba(150,44,50,.32)', opacity: busy ? .6 : 1, ...SKEW}}><span style={UNSKEW}>{busy ? 'Working…' : '💾 Save mock for ' + (garment.color || garment.sku)}</span></button>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{padding: '13px 24px', borderTop: '1px solid ' + NSA.light, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', flex: 'none'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: NSA.textLight}}><span style={{fontFamily: F_DISPLAY, fontWeight: 800, color: NSA.navy, fontSize: 16}}>{savedCount}/{garments.length}</span> color{garments.length === 1 ? '' : 's'} mocked — coach reviews these directly</div>
          <div style={{display: 'flex', gap: 10}}>
            <button onClick={onClose} style={{border: '1.5px solid ' + NSA.mid, background: '#fff', color: NSA.textLight, cursor: 'pointer', padding: '9px 20px', borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: .6, textTransform: 'uppercase'}}>Cancel</button>
            <button onClick={handleDone} disabled={(savedCount === 0 && !hasPending) || busy}
              style={{border: 'none', background: NSA.navy, color: '#fff', cursor: ((savedCount === 0 && !hasPending) || busy) ? 'default' : 'pointer', padding: '9px 24px', borderRadius: 6, fontFamily: F_DISPLAY, fontWeight: 800, fontSize: 14, letterSpacing: .6, textTransform: 'uppercase', opacity: ((savedCount === 0 && !hasPending) || busy) ? .5 : 1, ...SKEW}}><span style={UNSKEW}>Done — Attach Mockups</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
