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
//   locations : [{artFileId, name, position, existingFiles:[...], preview:{url}|null}]
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
  })));
  const [mocks, setMocks] = useState(() => ({...(initialMocks || {})}));
  const [imgOverride, setImgOverride] = useState({});
  const [busy, setBusy] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  // Recolor targeting: artColors holds the distinct colors detected in the selected
  // art; pickedColor is the one the user chose to change (null = recolor everything).
  const [pickedColor, setPickedColor] = useState(null);
  const [artColors, setArtColors] = useState([]);
  // Identifies which drop zone (if any) a dragged file is currently hovering, so we can
  // highlight it: 'canvas', 'product', or 'layer-<idx>' for a specific art location.
  const [dragOver, setDragOver] = useState(null);

  const garment = garments[gi] || {};
  const baseUrl = side === 'back' ? garment.backUrl : garment.frontUrl;
  const garmentUrl = imgOverride[garment.key] || baseUrl;
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

  const placeLayer = layer => {
    if (!canvas) return;
    clearLayer(layer.artFileId);
    const preview = layer.preview;
    if (!preview) { placeStandIn(layer); return; }
    if (preview.svgString) {
      fabric.loadSVGFromString(preview.svgString).then(result => {
        if (!result || !result.objects || !result.objects.length) return;
        const group = fabric.util.groupSVGElements(result.objects, result.options);
        const scale = 170 / group.width;
        group.set({left: 230, top: 250, scaleX: scale, scaleY: scale});
        styleArt(group); group._layerId = layer.artFileId;
        canvas.add(group); canvas.setActiveObject(group); canvas.renderAll();
        markDirty();
      }).catch(() => addImg(preview.url, layer));
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
        const img = new fabric.FabricImage(el);
        const scale = 150 / img.width;
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
      return [...set].slice(0, 12);
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
      const reps = Object.values(buckets).filter(b => b.count / total >= 0.02)
        .sort((a, b) => b.count - a.count).slice(0, 8)
        .map(b => '#' + [b.r, b.g, b.b].map(s => Math.round(s / b.count).toString(16).padStart(2, '0')).join(''));
      const out = [];
      reps.forEach(hx => { const rgb = hexToRgb(hx); if (!out.some(o => rgbDist(hexToRgb(o), rgb) < 40)) out.push(hx); });
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

  // Detect the art's colors whenever an art layer is selected, so the user can pick
  // which one to change. Clearing the selection resets the palette.
  useEffect(() => {
    if (!canvas) return;
    const onSel = () => { const o = canvas.getActiveObject(); if (o && o._isArt) setArtColors(computePalette(o)); };
    const onClear = () => { setArtColors([]); setPickedColor(null); };
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
    if (!layers.length) { nf && nf('No art locations on this job to attach art to', 'error'); return; }
    let idx = -1;
    const active = canvas && canvas.getActiveObject();
    if (active && active._isArt && active._layerId) idx = layers.findIndex(l => l.artFileId === active._layerId);
    if (idx < 0) idx = layers.findIndex(l => !l.source);
    if (idx < 0) idx = 0;
    uploadLayerFile(idx, file, {place: true});
  }, [canvas, layers, uploadLayerFile, nf]);

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
  const _renderSceneMock = async (g, sd, sceneObjs) => {
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

  const savedCount = Object.values(mocks).filter(a => (a || []).length > 0).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth: 940, width: '95%'}} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', color: 'white'}}>
          <h2 style={{color: 'white', margin: 0}}>Quick Mock Builder</h2>
          <button className="modal-close" style={{color: 'white'}} onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{maxHeight: '78vh', overflowY: 'auto'}}>
          <div style={{fontSize: 12, color: '#64748b', marginBottom: 12}}>
            Drop your vector/art onto the garment and drag the handles to size and position it. Build a mockup for each garment color — the coach reviews these, skipping the artist on the mockup phase. Your source files stay attached to each artwork for the artist's separation work later.
          </div>

          {garments.length > 1 && <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12}}>
            {garments.map((g, i) => <button key={g.key} title={[g.name, g.color].filter(Boolean).join(' — ')} className={`btn btn-sm ${i === gi ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5}}
              onClick={() => switchGarment(i)}>{g.color && <ColorSwatch name={g.color} />}<span>{(g.sku || g.name || 'Item')}{g.color ? ' · ' + g.color : ''}</span>{(mocks[g.key] || []).length > 0 && <span>✓</span>}</button>)}
          </div>}

          <div style={{display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16}}>
            <div>
              <div style={{fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6}}>Art Locations</div>
              {layers.map((l, idx) => <div key={l.artFileId || idx}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('layer-' + idx); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'layer-' + idx ? null : d); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (!f) return; if (!isArtFile(f)) { nf && nf('Drop a PNG, JPG, SVG, AI, EPS, or PDF art file', 'error'); return; } uploadLayerFile(idx, f); }}
                style={{padding: 8, border: '1px solid ' + (dragOver === 'layer-' + idx ? '#7c3aed' : '#e2e8f0'), borderRadius: 6, marginBottom: 8, background: dragOver === 'layer-' + idx ? '#f5f3ff' : '#fff', transition: 'background 0.12s, border-color 0.12s'}}>
                <div style={{fontSize: 12, fontWeight: 700, color: '#1e293b'}}>{l.name || 'Artwork'}</div>
                {l.position && <div style={{fontSize: 10, color: '#94a3b8', marginBottom: 4}}>{l.position}</div>}
                {l.source ? <div style={{fontSize: 10, color: '#166534', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6}}>
                  <Icon name="check" size={12} /> {l.source.name}{!l.preview && <span style={{color: '#d97706'}}>(stand-in)</span>}
                </div> : l.hasExisting ? <div style={{fontSize: 10, color: '#166534', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6}}>
                  <Icon name="check" size={12} /> Using art on file{(l.files && l.files[l.fileIdx || 0]) ? ': ' + l.files[l.fileIdx || 0].name : (l.existingFiles[0] ? ': ' + l.existingFiles[0].name : '')}{!l.preview && <span style={{color: '#d97706'}}> (stand-in)</span>}
                </div> : <div style={{fontSize: 10, color: '#94a3b8', marginBottom: 6}}>No file yet</div>}
                {!l.source && l.files && l.files.length > 1 && <div style={{display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, fontSize: 10, color: '#475569'}}>
                  <span style={{fontWeight: 700}}>File</span>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 11, padding: '0 7px', lineHeight: 1.6}} disabled={busy || (l.fileIdx || 0) <= 0} onClick={() => setLayerFile(idx, -1)}>◀</button>
                  <span style={{minWidth: 24, textAlign: 'center', fontWeight: 700}}>{(l.fileIdx || 0) + 1}/{l.files.length}</span>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 11, padding: '0 7px', lineHeight: 1.6}} disabled={busy || (l.fileIdx || 0) >= l.files.length - 1} onClick={() => setLayerFile(idx, 1)}>▶</button>
                  <span style={{color: '#94a3b8'}}>wrong art? try another file</span>
                </div>}
                <div style={{display: 'flex', gap: 4}}>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} disabled={busy}
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.png,.jpg,.jpeg,.svg,.ai,.eps,.pdf'; inp.onchange = () => { if (inp.files[0]) uploadLayerFile(idx, inp.files[0]); }; inp.click(); }}>
                    <Icon name="upload" size={11} /> {(l.source || l.hasExisting) ? 'Replace' : 'Upload'}
                  </button>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} disabled={busy} onClick={() => placeLayer(l)}>
                    <Icon name="plus" size={11} /> Place
                  </button>
                </div>
              </div>)}
              {layers.length === 0 && <div style={{fontSize: 11, color: '#94a3b8'}}>No art locations on this job.</div>}

              <div
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('product'); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'product' ? null : d); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (!f) return; if (!f.type.startsWith('image/')) { nf && nf('Drop an image file for the product photo', 'error'); return; } uploadGarmentImg(f); }}
                style={{marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0', borderRadius: 6, background: dragOver === 'product' ? '#f5f3ff' : 'transparent', boxShadow: dragOver === 'product' ? '0 0 0 2px #7c3aed' : 'none', transition: 'background 0.12s, box-shadow 0.12s'}}>
                <div style={{fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4}}>Product Image</div>
                {garmentUrl ? <div style={{fontSize: 10, color: '#166534'}}>Using catalog image</div>
                  : <div style={{fontSize: 10, color: '#d97706', marginBottom: 4}}>Not in system — drag an image here or upload</div>}
                <button className="btn btn-sm btn-secondary" style={{fontSize: 10, marginTop: 4}} disabled={busy}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { if (inp.files[0]) uploadGarmentImg(inp.files[0]); }; inp.click(); }}>
                  <Icon name="upload" size={11} /> Upload Product Image
                </button>
              </div>
            </div>

            <div>
              <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap'}}>
                <span style={{fontSize: 12, fontWeight: 700, color: '#1e293b', display: 'inline-flex', alignItems: 'center', gap: 5}}>{garment.color && <ColorSwatch name={garment.color} size={14} />}{garment.name || garment.sku} — {garment.color || 'Default'}</span>
                {garment.backUrl && <div style={{display: 'flex', gap: 2}}>
                  <button className={`btn btn-sm ${side === 'front' ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 10}} disabled={busy} onClick={() => switchSide('front')}>Front</button>
                  <button className={`btn btn-sm ${side === 'back' ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 10}} disabled={busy} onClick={() => switchSide('back')}>Back</button>
                </div>}
                <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} title="Delete selected" onClick={() => { if (!canvas) return; const sel = canvas.getActiveObject(); if (sel && sel._isArt) { canvas.remove(sel); canvas.discardActiveObject(); canvas.renderAll(); } else nf && nf('Select an art element to delete', 'error'); }}>
                  <Icon name="trash" size={11} /> Delete
                </button>
                <div style={{display: 'flex', alignItems: 'center', gap: 4}} title="Pick which color of the logo to change, then pick what to change it to.">
                  <span style={{fontSize: 10, color: '#475569', fontWeight: 600}}>Change:</span>
                  <button onClick={() => setPickedColor(null)} title="Recolor the whole design" style={{fontSize: 9, padding: '2px 6px', borderRadius: 4, border: '1px solid ' + (!pickedColor ? '#7c3aed' : '#cbd5e1'), background: !pickedColor ? '#ede9fe' : '#fff', color: !pickedColor ? '#6d28d9' : '#475569', cursor: 'pointer', fontWeight: 600}}>All</button>
                  {artColors.map(c => { const sel = pickedColor && rgbDist(hexToRgb(pickedColor), hexToRgb(c)) < 8; return <button key={c} onClick={() => setPickedColor(c)} title={'Change this color (' + c + ')'} style={{width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: sel ? '2px solid #7c3aed' : '1px solid #cbd5e1', boxShadow: sel ? '0 0 0 2px #ede9fe' : 'none'}} />; })}
                  <span style={{fontSize: 10, color: '#475569', fontWeight: 600, marginLeft: 4}}>to:</span>
                  <button onClick={() => recolorActive('#ffffff')} title="White" style={{width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '1px solid #cbd5e1', cursor: 'pointer', padding: 0}} />
                  <button onClick={() => recolorActive('#111827')} title="Black" style={{width: 18, height: 18, borderRadius: '50%', background: '#111827', border: '1px solid #cbd5e1', cursor: 'pointer', padding: 0}} />
                  <input type="color" onChange={e => recolorActive(e.target.value)} title="Custom color" style={{width: 22, height: 20, padding: 0, border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer', background: '#fff'}} />
                  <button onClick={() => recolorActive(null, true)} disabled={!pickedColor} title={pickedColor ? 'Remove this color (make it transparent)' : 'Pick a color above first, then remove it'} style={{fontSize: 9, padding: '2px 6px', borderRadius: 4, border: '1px solid #cbd5e1', background: pickedColor ? '#fff' : '#f1f5f9', color: pickedColor ? '#b91c1c' : '#94a3b8', cursor: pickedColor ? 'pointer' : 'not-allowed', fontWeight: 600, marginLeft: 2}}>Remove</button>
                </div>
                <button className="btn btn-sm btn-primary" style={{fontSize: 10, marginLeft: 'auto'}} disabled={busy} onClick={saveColorMock}>
                  <Icon name="save" size={11} /> Save Mock for {garment.color || garment.sku}
                </button>
              </div>
              <div
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver('canvas'); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(d => d === 'canvas' ? null : d); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(null); if (busy) return; const f = e.dataTransfer.files[0]; if (f) dropArtOnCanvas(f); }}
                style={{display: 'flex', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, padding: 12, position: 'relative', outline: dragOver === 'canvas' ? '2px dashed #7c3aed' : 'none', outlineOffset: -4}}>
                <div ref={wrapRef} />
                {(imgLoading || (!garmentUrl && garment.pending)) && <div style={{position: 'absolute', inset: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(248,250,252,0.85)', borderRadius: 8, pointerEvents: 'none'}}>
                  <Icon name="loader" size={26} style={{animation: 'spin 1s linear infinite', color: '#7c3aed'}} />
                  <span style={{fontSize: 12, color: '#6d28d9', fontWeight: 600}}>Loading product image…</span>
                </div>}
                {!garmentUrl && !garment.pending && !imgLoading && <div style={{position: 'absolute', inset: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none'}}>
                  <Icon name="image" size={28} style={{color: '#cbd5e1'}} />
                  <span style={{fontSize: 12, color: '#94a3b8', fontWeight: 600}}>No product image — upload one</span>
                </div>}
                {dragOver === 'canvas' && <div style={{position: 'absolute', inset: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(124,58,237,0.08)', borderRadius: 8, pointerEvents: 'none'}}>
                  <Icon name="upload" size={28} style={{color: '#7c3aed'}} />
                  <span style={{fontSize: 12, color: '#6d28d9', fontWeight: 700}}>Drop art to place it on the garment</span>
                </div>}
              </div>
              <div style={{fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'center'}}>Drag an art file onto the garment to place it. Click art to select; drag to move, corners to resize. Press Delete to remove.</div>
              {(mocks[garment.key] || []).length > 0 && <div style={{marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0'}}>
                <div style={{fontSize: 10, fontWeight: 700, color: '#166534', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4}}>
                  <Icon name="check" size={12} /> Saved mock{(mocks[garment.key].length > 1 ? 's' : '')} for {garment.color || garment.sku}
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  {(mocks[garment.key] || []).map((m, mi) => <div key={mi} style={{position: 'relative', border: '1px solid #e2e8f0', borderRadius: 6, padding: 4, background: '#fff'}}>
                    <img src={m.url} alt={m.name} style={{width: 72, height: 88, objectFit: 'contain', display: 'block'}} />
                    <button title="Remove this mock" onClick={() => setMocks(prev => ({...prev, [garment.key]: (prev[garment.key] || []).filter((_, x) => x !== mi)}))}
                      style={{position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0}}>×</button>
                  </div>)}
                </div>
              </div>}
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <span style={{fontSize: 11, color: savedCount > 0 ? '#166534' : '#94a3b8', fontWeight: 600}}>
            {savedCount} of {garments.length} color{garments.length === 1 ? '' : 's'} mocked
          </span>
          <button className="btn btn-primary" style={{marginLeft: 'auto', background: '#166534', borderColor: '#166534'}} disabled={(savedCount === 0 && !hasPending) || busy} onClick={handleDone}>Done — Attach Mockups</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
