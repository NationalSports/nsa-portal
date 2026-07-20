/* eslint-disable */
// Uniform Builder — live 3D viewer.
//
// Loads a garment GLB (Draco-compressed) whose meshes are named by section, and
// recolors each section live from the design spec — so the same spec that drives
// the flat 2D editor also drives a rotatable 3D preview. Vendor-delivered models
// slot in the same way: one mesh/material per editable section, named by zone.
//
// Lazy-loaded (three.js is heavy), so it only downloads when the 3D tab opens.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makePatternTile, tintedTile } from './patterns';
import { fontShorthand } from './fonts';
import { drawAthleticText, measureAthleticText } from './lettering';
import { getTemplate } from './templates';
import * as ds from './designSpec';
import { shouldStartDecorationDrag } from './decorationInteraction';
import { canvasFromImage } from './logoImage';

const PUB = (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL) ? process.env.PUBLIC_URL : '';

// Map a mesh/material name to one of our zone ids (tolerant of naming variants a
// vendor might use — "Left Sleeve", "sleeve_l", "cuff", etc.).
function matchZone(name) {
  if (!name) return null;
  const s = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const rules = [
    ['sidepanell', 'sidePanelL'], ['sidepanelr', 'sidePanelR'],
    ['legl', 'legL'], ['leftleg', 'legL'], ['legr', 'legR'], ['rightleg', 'legR'],
    ['waistband', 'waistband'], ['waist', 'waistband'],
    ['sleevel', 'sleeveL'], ['leftsleeve', 'sleeveL'], ['sleeveleft', 'sleeveL'], ['larm', 'sleeveL'],
    ['sleever', 'sleeveR'], ['rightsleeve', 'sleeveR'], ['sleeveright', 'sleeveR'], ['rarm', 'sleeveR'],
    ['sidel', 'sidePanelL'], ['sider', 'sidePanelR'],
    ['collar', 'collar'], ['neck', 'collar'], ['cuff', 'collar'], ['trim', 'collar'], ['rib', 'collar'],
    // Reversible flag-football jerseys expose the inside as a second material
    // instead of a separate garment node. Reuse the collar configuration slot
    // so coaches can color/print the reverse side independently.
    ['reverse', 'collar'],
    ['yoke', 'yoke'], ['shoulder', 'yoke'], ['pocket', 'pocket'], ['hood', 'hood'],
    ['sleeve', 'sleeveL'],
    ['body', 'body'], ['torso', 'body'], ['front', 'body'], ['main', 'body'], ['chest', 'body'], ['jersey', 'body'],
  ];
  for (const [k, z] of rules) if (s.includes(k)) return z;
  return null;
}

// Sample a normal map at low res and report whether it's essentially neutral
// everywhere (no baked detail). Cached per texture so we only pay once.
function isFlatNormalTexture(tex) {
  if (tex._nsaFlatChecked !== undefined) return tex._nsaFlatChecked;
  let flat = false;
  try {
    const img = tex.image;
    if (img && (img.width || img.videoWidth)) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data;
      let dev = 0;
      for (let i = 0; i < d.length; i += 4) {
        const dr = Math.abs(d[i] - 128), dg = Math.abs(d[i + 1] - 128);
        if (dr > dev) dev = dr; if (dg > dev) dev = dg;
      }
      flat = dev < 10;
    }
  } catch (_e) { /* cross-origin or compressed — assume it's real */ }
  tex._nsaFlatChecked = flat;
  return flat;
}

// ── Fabric surface library ──────────────────────────────────────────────────
// Each fabric option gets its own procedurally generated surface (normal map,
// and for heather a color fleck), so "Mesh" actually shows perforations and
// "Heather" actually flecks — the finish (roughness) alone never sold the
// difference. Textures are cached module-wide and shared across meshes, so
// they are tagged shared and must never be disposed by per-mesh cleanup.
const FABRIC_SURFACES = {
  matte:      { gen: 'knit',   normalScale: 0.7,  repeat: 10 },
  mesh:       { gen: 'mesh',   normalScale: 0.95, repeat: 14 },
  heather:    { gen: 'knit',   normalScale: 0.55, repeat: 10 },
  sublimated: { gen: 'smooth', normalScale: 0.45, repeat: 10 },
  gloss:      { gen: 'smooth', normalScale: 0.3,  repeat: 10 },
};
const _fabricNormals = {};
const _designMaskImages = {};
const _designMaskTextures = {};
const _selectionMaskTextures = {};

// Direct garment targeting uses the exact same UV artwork mask that colors the
// jersey. This keeps clicks on a chest stripe, side insert or sleeve band tied
// to the real production boundary without drawing any selection overlay.
function designMaskIsAccent(url, uv) {
  if (!url || !uv) return false;
  const img = _designMaskImages[url];
  if (!img || !img.complete || !(img.naturalWidth || img.width)) return false;
  try {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const x = Math.max(0, Math.min(w - 1, Math.floor(uv.x * w)));
    // Canvas rows are top-down while the hit UV is bottom-up; mirror V to sample
    // the same source texel the GPU uses for the garment artwork.
    const y = Math.max(0, Math.min(h - 1, Math.floor((1 - uv.y) * h)));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[0] >= 128;
  } catch (_e) { return false; }
}

function rgb255(hex) {
  const n = parseInt(String(hex || '#000000').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A real white textile reflects less light than a perfect digital white.
// Keeping the builder swatch at #fff but rendering it with a believable cloth
// albedo preserves the knit, folds and seam shading under product lighting.
function textileAlbedo(hex) {
  const [r, g, b] = rgb255(hex);
  if (Math.min(r, g, b) >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 12) return '#e5e5e2';
  return hex;
}

// Recolor a UV-aligned grayscale layout mask into a two-color albedo texture.
// The texture is cached by mask + color pair, so changing another builder field
// does not repeatedly process the 2K artwork. A white mask pixel is accent;
// black is the section's base color, with gray preserving antialiased edges.
function designMaskTexture(url, baseHex, accentHex, onReady) {
  const key = [url, baseHex, accentHex].join('|');
  if (_designMaskTextures[key]) { onReady(_designMaskTextures[key]); return; }
  const build = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 2048;
    canvas.height = img.naturalHeight || img.height || 2048;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    const a = rgb255(baseHex), b = rgb255(accentHex);
    for (let i = 0; i < d.length; i += 4) {
      // This is a sublimated color break, not a soft overlay. Thresholding the
      // artist mask removes its wide gray fringe; texture filtering still adds
      // a clean one-pixel antialias at render time.
      const t = d[i] >= 128 ? 1 : 0;
      d[i] = Math.round(a[0] + (b[0] - a[0]) * t);
      d[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
      d[i + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
      d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    // GLTFLoader uses the glTF UV convention (no browser-image Y flip). Match
    // it here or asymmetric sleeve masks land on the opposite side of UV space.
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    // The binary source keeps the break crisp; high-quality mip filtering and
    // stronger anisotropy keep that edge stable at steep sleeve angles without
    // introducing shimmer when the full jersey is in view.
    // Preserve the two selected sublimation inks. Mipmaps average high-contrast
    // inks into a third, washed-out color at normal builder distance.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
    tex.userData.shared = true;
    _designMaskTextures[key] = tex;
    onReady(tex);
  };
  if (_designMaskImages[url]) {
    const cached = _designMaskImages[url];
    if (cached.complete) build(cached); else cached.addEventListener('load', () => build(cached), { once: true });
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  _designMaskImages[url] = img;
  img.onload = () => build(img);
  img.src = url;
}

// Apply an editable print to the BASE side of an approved two-area layout
// mask while preserving its independently colored accent (AGI-1012 chest
// stripe / sleeve bands). Without this composite, the fixed layout mask wins
// over a coach-selected print and only unmasked back panels receive artwork.
function designMaskPatternTexture(url, patternCanvas, patternKey, accentHex, repeat, onReady) {
  const rep = Math.max(1, Number(repeat) || 1);
  const key = ['masked-print', url, patternKey, accentHex, rep.toFixed(4)].join('|');
  if (_designMaskTextures[key]) { onReady(_designMaskTextures[key]); return; }
  const build = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 2048;
    canvas.height = img.naturalHeight || img.height || 2048;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    const patternSource = patternCanvas.getContext ? patternCanvas : (() => {
      const c = document.createElement('canvas');
      c.width = patternCanvas.naturalWidth || patternCanvas.width || 1;
      c.height = patternCanvas.naturalHeight || patternCanvas.height || 1;
      c.getContext('2d').drawImage(patternCanvas, 0, 0, c.width, c.height);
      return c;
    })();
    const pw = patternSource.width || 1, ph = patternSource.height || 1;
    const pctx = patternSource.getContext('2d', { willReadFrequently: true });
    const pd = pctx.getImageData(0, 0, pw, ph).data;
    const accent = rgb255(accentHex);
    for (let y = 0; y < canvas.height; y++) {
      const py = Math.min(ph - 1, Math.floor((((y / canvas.height) * rep) % 1) * ph));
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (d[i] >= 128) {
          d[i] = accent[0]; d[i + 1] = accent[1]; d[i + 2] = accent[2]; d[i + 3] = 255;
          continue;
        }
        const px = Math.min(pw - 1, Math.floor((((x / canvas.width) * rep) % 1) * pw));
        const pi = (py * pw + px) * 4;
        d[i] = pd[pi]; d[i + 1] = pd[pi + 1]; d[i + 2] = pd[pi + 2]; d[i + 3] = pd[pi + 3];
      }
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
    tex.userData.shared = true;
    _designMaskTextures[key] = tex;
    onReady(tex);
  };
  if (_designMaskImages[url]) {
    const cached = _designMaskImages[url];
    if (cached.complete) build(cached); else cached.addEventListener('load', () => build(cached), { once: true });
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  _designMaskImages[url] = img;
  img.onload = () => build(img);
  img.src = url;
}

// Convert the artwork mask into an EDGE-ONLY alpha texture for selection. A
// translucent fill made the fabric look glossy and exposed mesh intersections;
// outlining the real color break keeps the textile completely untouched.
function selectionEdgeTexture(url, selectAccent, onReady) {
  const key = [url, selectAccent ? 'accent-edge' : 'base-edge'].join('|');
  if (_selectionMaskTextures[key]) { onReady(_selectionMaskTextures[key]); return; }
  const build = (img) => {
    const sourceW = img.naturalWidth || img.width || 2048;
    const sourceH = img.naturalHeight || img.height || 2048;
    const scale = Math.min(1, 1024 / Math.max(sourceW, sourceH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    const binary = new Uint8Array(canvas.width * canvas.height);
    for (let p = 0; p < binary.length; p++) binary[p] = ((d[p * 4] >= 128) === selectAccent) ? 1 : 0;
    const radius = 3;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const p = y * canvas.width + x;
        const here = binary[p];
        const left = binary[y * canvas.width + Math.max(0, x - radius)];
        const right = binary[y * canvas.width + Math.min(canvas.width - 1, x + radius)];
        const up = binary[Math.max(0, y - radius) * canvas.width + x];
        const down = binary[Math.min(canvas.height - 1, y + radius) * canvas.width + x];
        const edge = here !== left || here !== right || here !== up || here !== down;
        const i = p * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = edge ? 255 : 0;
      }
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
    tex.userData.shared = true;
    _selectionMaskTextures[key] = tex;
    onReady(tex);
  };
  if (_designMaskImages[url]) {
    const cached = _designMaskImages[url];
    if (cached.complete) build(cached); else cached.addEventListener('load', () => build(cached), { once: true });
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  _designMaskImages[url] = img;
  img.onload = () => build(img);
  img.src = url;
}

function makeNormalCanvas(gen) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const img = x.createImageData(S, S);
  const d = img.data;
  const TAU = Math.PI * 2;
  // Hex-offset grid of round perforations for mesh fabric.
  const CELL = 32, R = 7;
  const holeOffset = (px, py) => {
    const row = Math.floor(py / CELL);
    const ox = (row % 2) * (CELL / 2);
    const cx = (Math.floor((px - ox) / CELL) + 0.5) * CELL + ox;
    const cy = (row + 0.5) * CELL;
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > R || dist === 0) return null;
    // dimple: normals lean toward the hole center, deepest at the rim
    const k = (dist / R) * 46;
    return [-(dx / dist) * k, -(dy / dist) * k];
  };
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = (py * S + px) * 4;
      const u = px / S, v = py / S;
      // Broad soft cloth undulation (tile-safe sines) — reads at arm's length.
      const broadX = (Math.sin(u * TAU * 2 + Math.sin(v * TAU)) + Math.sin(v * TAU * 3 + u * TAU)) * 5;
      const broadY = (Math.cos(v * TAU * 2 + Math.sin(u * TAU * 2)) + Math.sin(u * TAU * 3)) * 5;
      const grainX = (Math.sin(px * 12.9898 + py * 78.233) * 43758.5453 % 1) * 18 - 9;
      const grainY = (Math.sin(px * 39.346 + py * 11.135) * 24634.6345 % 1) * 18 - 9;
      let nx = broadX + grainX, ny = broadY + grainY;
      if (gen === 'knit') nx += Math.sin(u * TAU * 16) * 12; // vertical knit ribs
      if (gen === 'smooth') { nx = broadX + grainX * 0.5; ny = broadY + grainY * 0.5; }
      if (gen === 'mesh') {
        const hole = holeOffset(px, py);
        if (hole) { nx += hole[0]; ny += hole[1]; }
      }
      d[i] = Math.max(0, Math.min(255, 128 + nx));
      d[i + 1] = Math.max(0, Math.min(255, 128 + ny));
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

function fabricNormalTexture(fabric) {
  const def = FABRIC_SURFACES[fabric] || FABRIC_SURFACES.sublimated;
  if (_fabricNormals[def.gen]) return _fabricNormals[def.gen];
  const t = new THREE.CanvasTexture(makeNormalCanvas(def.gen));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(def.repeat, def.repeat);
  t.userData.shared = true;
  _fabricNormals[def.gen] = t;
  return t;
}

// Heather fleck: near-white tile peppered with soft gray specks; multiplied
// under the zone color it reads as melange yarn.
let _heatherMap = null;
function heatherFleckTexture() {
  if (_heatherMap) return _heatherMap;
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, S, S);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    const g = 150 + Math.floor(rand() * 80);
    x.fillStyle = 'rgba(' + g + ',' + g + ',' + (g + 4) + ',' + (0.25 + rand() * 0.45).toFixed(2) + ')';
    const w = 1 + rand() * 2.4;
    x.fillRect(rand() * S, rand() * S, w, w * (0.5 + rand()));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  _heatherMap = t;
  return t;
}

// ── Studio render profile ────────────────────────────────────────────────────
// Every dial that shapes the product-render look, in one place. The viewer
// seeds from localStorage so a tuned look sticks in that browser; opening the
// builder with ?studio=1 shows a slider panel that edits these live on the
// real garment. "Copy values" exports the JSON so winning numbers can be baked
// in here as the shipped defaults.
export const STUDIO_DEFAULTS = {
  key: 0.94,      // main top-front light; kept below clipping for white fabric
  fill: 0.08,     // restrained fill preserves folds instead of flattening them
  back: 0.34,     // rear light (back-view color read)
  hemi: 0.06,     // low ambient keeps white knit and under-sleeve shape visible
  exposure: 0.82, // leaves highlight headroom while preserving brand colors
  env: 0.08,      // subtle environment reflections
  sheen: 0.08,    // fabric grazing-angle glow
  aoRadius: 0.075,// tighter AO keeps seams crisp rather than muddy
  aoScale: 2.8,   // stronger contact definition on white garments
  bg: 0.92,       // soft off-white wall separates white cloth without looking gray
};
const STUDIO_LS_KEY = 'nsa_uniform_studio_v3';
export function loadStudioProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STUDIO_LS_KEY) || 'null');
    const out = { ...STUDIO_DEFAULTS };
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(STUDIO_DEFAULTS)) if (Number.isFinite(saved[k])) out[k] = saved[k];
    }
    return out;
  } catch (_e) { return { ...STUDIO_DEFAULTS }; }
}
function saveStudioProfile(p) { try { localStorage.setItem(STUDIO_LS_KEY, JSON.stringify(p)); } catch (_e) { /* quota */ } }

// Push a profile onto a live scene (lights, tone mapping, materials, AO).
function applyStudioProfile(st, p) {
  if (!st || !st.lights) return;
  st.lights.key.intensity = p.key;
  st.lights.fill.intensity = p.fill;
  st.lights.back.intensity = p.back;
  st.lights.hemi.intensity = p.hemi;
  st.renderer.toneMappingExposure = p.exposure;
  if (st.scene.background && st.scene.background.isColor) st.scene.background.setScalar(p.bg);
  for (const { mesh } of st.meshes) {
    if (mesh.material) { mesh.material.envMapIntensity = p.env; mesh.material.sheen = p.sheen; mesh.material.needsUpdate = true; }
  }
  if (st.gtao && st.modelSize) {
    const maxDim = Math.max(st.modelSize.x, st.modelSize.y, st.modelSize.z) || 1;
    try { st.gtao.updateGtaoMaterial({ radius: maxDim * p.aoRadius, distanceExponent: 1.2, thickness: maxDim * 0.02, scale: p.aoScale, samples: 16, distanceFallOff: 1, screenSpaceRadius: false }); } catch (_e) { /* best-effort */ }
  }
}

function gradientTexture(a, b) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, a); g.addColorStop(1, b);
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// How much of the 0–1 UV range this mesh's shell actually occupies. A pattern's
// texture.repeat is applied over UV space, so the number of pattern tiles the
// coach SEES across a panel is repeat × uvSpan. Small panels (sleeves) tend to
// pack into a small UV region, so a fixed repeat lands only ~1 tile on them and
// the pattern looks blown up. Targeting a tile COUNT (repeat = tiles / uvSpan)
// keeps every panel — and both garment models, whose UV scales differ — showing
// a sensible amount of pattern.
function zoneUvSpan(mesh) {
  const geo = mesh.geometry;
  const uv = geo.attributes && geo.attributes.uv;
  if (!uv || !uv.count) return null;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }
  const span = Math.max(uMax - uMin, vMax - vMin);
  return span > 1e-4 ? span : null;
}
function zoneRepeat(span, targetTiles, fallback) {
  if (!span) return fallback;
  return Math.max(2, Math.min(60, targetTiles / span));
}

// Hex Flow contains several motifs inside one source tile. Give it a modestly
// higher density than a conventional all-over print: large enough to read as
// real garment artwork, but not so dense that the two inks visually merge.
function customPatternRepeat(zs, span) {
  const isHexFlow = /hex[\s_-]*flow/i.test(`${zs.patternName || ''} ${zs.patternImage || ''}`);
  return zoneRepeat(span, isHexFlow ? 3 : 3.5, 5);
}

// AGI-1011's side insert crosses separate front/back UV shells. Computing the
// color break from the garment surface itself keeps one continuous, clean edge
// across that construction seam (and still leaves the UV mask available for
// click targeting and production proofs).
function applySidePanelSurface(st, mat, baseHex, accentHex) {
  if (!st._sidePanelBounds) {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let depthMin = Infinity, depthMax = -Infinity;
    for (const entry of st.meshes) {
      const name = String(entry.mesh && entry.mesh.name || '').toLowerCase();
      if (name !== 'body_front' && name !== 'body_back') continue;
      const geo = entry.mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const box = geo.boundingBox;
      xMin = Math.min(xMin, box.min.x); xMax = Math.max(xMax, box.max.x);
      // GLTFLoader exposes the garment Y-up: Y is height and Z is the
      // front-to-back depth around the torso.
      yMin = Math.min(yMin, box.min.y); yMax = Math.max(yMax, box.max.y);
      depthMin = Math.min(depthMin, box.min.z); depthMax = Math.max(depthMax, box.max.z);
    }
    st._sidePanelBounds = {
      cx: (xMin + xMax) * 0.5,
      half: Math.max((xMax - xMin) * 0.5, 1e-5),
      yMin,
      height: Math.max(yMax - yMin, 1e-5),
      depthCenter: (depthMin + depthMax) * 0.5,
      depthHalf: Math.max((depthMax - depthMin) * 0.5, 1e-5),
    };
  }
  const b = st._sidePanelBounds;
  const data = mat.userData.nsaSidePanel || {
    base: new THREE.Color(), accent: new THREE.Color(),
    cx: { value: b.cx }, half: { value: b.half }, yMin: { value: b.yMin }, height: { value: b.height },
    depthCenter: { value: b.depthCenter }, depthHalf: { value: b.depthHalf },
  };
  data.base.set(baseHex); data.accent.set(accentHex);
  mat.userData.nsaSidePanel = data;
  if (!mat.userData.nsaSidePanelInstalled) {
    mat.userData.nsaSidePanelInstalled = true;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.nsaPanelBase = { value: data.base };
      shader.uniforms.nsaPanelAccent = { value: data.accent };
      shader.uniforms.nsaPanelCx = data.cx;
      shader.uniforms.nsaPanelHalf = data.half;
      shader.uniforms.nsaPanelYMin = data.yMin;
      shader.uniforms.nsaPanelHeight = data.height;
      shader.uniforms.nsaPanelDepthCenter = data.depthCenter;
      shader.uniforms.nsaPanelDepthHalf = data.depthHalf;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNsaPanelPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNsaPanelPosition = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNsaPanelPosition;\nuniform vec3 nsaPanelBase;\nuniform vec3 nsaPanelAccent;\nuniform float nsaPanelCx;\nuniform float nsaPanelHalf;\nuniform float nsaPanelYMin;\nuniform float nsaPanelHeight;\nuniform float nsaPanelDepthCenter;\nuniform float nsaPanelDepthHalf;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float nsaYn = clamp((vNsaPanelPosition.y - nsaPanelYMin) / nsaPanelHeight, 0.0, 1.0);
          float nsaDepth = abs(vNsaPanelPosition.z - nsaPanelDepthCenter) / nsaPanelDepthHalf;
          // A sewn side insert is bounded by two vertical front/back cut lines.
          // Depth-space boundaries keep those lines straight in a true side
          // view instead of letting them zig-zag with every torso fold.
          float nsaSide = (1.0 - smoothstep(0.472, 0.488, nsaDepth)) * (1.0 - smoothstep(0.695, 0.710, nsaYn));
          diffuseColor.rgb = mix(nsaPanelBase, nsaPanelAccent, nsaSide);`);
    };
    mat.customProgramCacheKey = () => 'nsa-side-panel-v3';
  }
  mat.color.set('#ffffff');
  mat.needsUpdate = true;
}

function applyDesign(st, rawSpec) {
  const spec = ds.normalizeSpec(rawSpec);
  const tpl = getTemplate(spec.garmentId);
  // One repeat per ZONE, not per mesh: garments cut into several panels per zone
  // (e.g. an upper + lower body panel) must show the same stripe width across
  // the seam, so every panel in a zone uses the zone's dominant UV span.
  const spanByZone = {};
  for (const e of st.meshes) {
    const s = zoneUvSpan(e.mesh);
    if (s && (!spanByZone[e.zone] || s > spanByZone[e.zone])) spanByZone[e.zone] = s;
  }
  for (const entry of st.meshes) {
    const zone = entry.zone;
    const zs = (zone && spec.zones[zone]) || spec.zones.body || ds.DEFAULT_ZONE;
    const mat = entry.mesh.material;
    const color = textileAlbedo(ds.toHex(zs.color, '#1f2a44'));
    const color2 = textileAlbedo(ds.toHex(zs.color2, '#ffffff'));
    const patternColor2 = textileAlbedo(ds.toHex(zs.patternColor2, color2));
    const pat = zs.pattern || 'solid';
    const meshName = String(entry.mesh.name || '').toLowerCase();
    const maskUrl = tpl.designMasks && tpl.designMasks[meshName];
    if (mat.map) { if (!(mat.map.userData && mat.map.userData.shared)) mat.map.dispose(); mat.map = null; }
    if (tpl.proceduralLayout === 'sidePanels' && (meshName === 'body_front' || meshName === 'body_back')) {
      entry._patGen = (entry._patGen || 0) + 1;
      applySidePanelSurface(st, mat, color, color2);
    } else if (maskUrl && pat === 'custom' && zs.patternImage) {
      // Composite the selected print into every BASE pixel of the approved
      // layout mask. The accent pixels remain the independently editable chest
      // stripe/sleeve band, so the print covers the full chosen panel without
      // erasing construction artwork.
      const gen = (entry._patGen = (entry._patGen || 0) + 1);
      mat.color.set(color);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (entry._patGen !== gen || !entry.mesh.material) return;
        const source = zs.patternTint ? tintedTile(img, zs.patternImage, color, patternColor2, ds.toHex(zs.color3, '#ffffff'), ds.toHex(zs.color4, '#ffffff'), zs.patternTintMode) : img;
        // The composite lives in the garment's original UV atlas. Convert the
        // desired panel-local tile count to atlas-space repetition.
        const rep = customPatternRepeat(zs, spanByZone[entry.zone]);
        const patternKey = [zs.patternImage, zs.patternTintMode, color, patternColor2, zs.color3, zs.color4].join('|');
        designMaskPatternTexture(maskUrl, source, patternKey, color2, rep, (tex) => {
          if (entry._patGen !== gen || !entry.mesh.material) return;
          const m = entry.mesh.material;
          m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
          if (st.queueSnapshot) st.queueSnapshot(120);
        });
      };
      img.src = zs.patternImage;
    } else if (maskUrl) {
      const gen = (entry._patGen = (entry._patGen || 0) + 1);
      mat.color.set('#ffffff');
      designMaskTexture(maskUrl, color, color2, (tex) => {
        if (entry._patGen !== gen || !entry.mesh.material) return;
        const m = entry.mesh.material;
        m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
        if (st.queueSnapshot) st.queueSnapshot(120);
      });
    } else if (pat === 'custom' && zs.patternImage) {
      // Admin-library print pattern: image tile loads async; a generation token
      // drops stale loads if the design changed again before the image decoded.
      const gen = (entry._patGen = (entry._patGen || 0) + 1);
      mat.color.set(color); // flat placeholder while the tile decodes
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (entry._patGen !== gen || !entry.mesh.material) return;
        // Tintable tiles are grayscale: recolor with the zone's colors so one
        // uploaded tile serves every colorway.
        const source = zs.patternTint ? tintedTile(img, zs.patternImage, color, patternColor2, ds.toHex(zs.color3, '#ffffff'), ds.toHex(zs.color4, '#ffffff'), zs.patternTintMode) : img;
        const tex = new THREE.CanvasTexture(source);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        // Same tile-count logic as the built-ins: ~2.5 print repeats across each
        // panel so a print never balloons on the sleeves.
        const rep = customPatternRepeat(zs, spanByZone[entry.zone]);
        tex.repeat.set(rep, rep);
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = entry.mesh.material;
        if (m.map) m.map.dispose();
        m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
        if (st.queueSnapshot) st.queueSnapshot(120);
      };
      img.src = zs.patternImage;
    } else if (pat === 'solid') {
      entry._patGen = (entry._patGen || 0) + 1; // invalidate in-flight custom tiles
      mat.color.set(color);
      // Heather is a yarn-color effect, not a print: multiply a fleck tile
      // under the chosen color so it reads as melange fabric.
      if (spec.fabric === 'heather') mat.map = heatherFleckTexture();
    } else if (pat === 'fade') {
      entry._patGen = (entry._patGen || 0) + 1;
      mat.color.set('#ffffff'); mat.map = gradientTexture(color, color2);
    } else {
      const tile = makePatternTile(pat, color, color2);
      entry._patGen = (entry._patGen || 0) + 1; // invalidate in-flight custom tiles
      if (tile) {
        const tex = new THREE.CanvasTexture(tile);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        // Repeat derives from the panel's real UV-to-world density so a tile is
        // the same physical size on the body and the sleeves, and on either
        // garment model. Fine patterns (stripes/pinstripe/…) target a smaller
        // physical tile than coarse ones (chevron/camo/…).
        const fine = pat === 'stripes' || pat === 'pinstripe' || pat === 'dots' || pat === 'carbon' || pat === 'hex';
        // Aim for ~this many pattern tiles across the panel's larger UV axis —
        // calibrated so the density matches the good V-neck look and the crew
        // model (whose sleeves pack into a much smaller UV span) no longer blows
        // the pattern up.
        const rep = zoneRepeat(spanByZone[entry.zone], fine ? 6 : 2.6, entry.zone === 'body' ? (fine ? 10 : 5) : (fine ? 10 : 6));
        tex.repeat.set(rep, rep);
        tex.anisotropy = 8; // crisp the pattern at grazing angles (was blurry/blown up)
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.color.set('#ffffff');
      } else { mat.color.set(color); }
    }
    // Fabric = finish (roughness) + surface (normal map): gloss is shinier and
    // smoother, mesh shows perforations, matte shows knit ribs. A vendor-baked
    // normal map (real cloth wrinkles) always wins over the generic surface.
    const FABRIC_ROUGHNESS = { matte: 0.94, mesh: 0.88, heather: 0.9, sublimated: 0.86, gloss: 0.6 };
    mat.roughness = FABRIC_ROUGHNESS[spec.fabric] || 0.86;
    if (!entry.vendorNormal) {
      const def = FABRIC_SURFACES[spec.fabric] || FABRIC_SURFACES.sublimated;
      mat.normalMap = fabricNormalTexture(spec.fabric);
      mat.normalScale.set(def.normalScale, def.normalScale);
    }
    mat.metalness = 0.0;
    mat.needsUpdate = true;
  }
}

// Render a text element to a transparent canvas for use as a decal texture.
// Runs through the shared lettering engine so arch + spacing match the 2D
// proof exactly.
function decalTextCanvas(el) {
  const val = (el.value || '').trim();
  if (!val) return null;
  const S = 220;
  const fill = ds.toHex(el.fill, '#ffffff');
  let outline = el.outline === 'auto' ? ds.contrastInk(fill) : el.outline;
  if (outline && outline !== 'none') outline = ds.toHex(outline, '#111827');
  // Convert proof-space outline units to a finished athletic border. The text
  // engine doubles this value for canvas lineWidth, so /7 lands around 6–8% of
  // glyph height instead of the oversized quarter-height ring from the first
  // projection pass.
  const ow = el.outlineWidth > 0 ? (el.outlineWidth * (S / 24)) / 7 : 0;
  const outline2 = (el.outline2 && el.outline2 !== 'none') ? ds.toHex(el.outline2, '#111827') : 'none';
  const ow2 = el.outline2Width > 0 ? (el.outline2Width * (S / 24)) / 7 : 0;
  const opts = { value: val, font: el.font, size: S, fill, outline, outlineWidth: ow, outline2, outline2Width: ow2, letterSpacing: el.letterSpacing || 0, arch: el.arch || 0 };
  const meas = document.createElement('canvas').getContext('2d');
  const m = measureAthleticText(meas, opts);
  const pad = Math.ceil(S * 0.4);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.ceil(Math.max(m.total, m.inkWidth || 0)) + pad * 2);
  c.height = Math.ceil(S * 1.5 + m.sag);
  const x = c.getContext('2d');
  // center the visual block: an arch adds `sag` below the center letter's line
  drawAthleticText(x, { ...opts, x: c.width / 2, y: (c.height - m.sag) / 2 });
  return c;
}

// Project number/name onto the garment surface as decals (they wrap the fabric
// and rotate with the model). Rebuilt whenever the spec changes.
function updateDecals(st, rawSpec) {
  const spec = ds.normalizeSpec(rawSpec);
  for (const d of st.decals) { st.scene.remove(d); d.geometry.dispose(); if (d.material.map) d.material.map.dispose(); d.material.dispose(); }
  st.decals = [];
  const body = st.bodyMesh;
  if (!body || !st.modelSize) return;
  const size = st.modelSize;
  const tpl = getTemplate(spec.garmentId);
  const raycaster = new THREE.Raycaster();

  // Chest/back decorations must map to the TORSO, not the whole model — the full
  // bounding box includes the outstretched sleeves, which squeezes x toward the
  // center (number + crest end up stacked mid-chest) and drops y too low. Build
  // the torso box from the body panel(s) and place body decorations within it.
  const torsoBox = new THREE.Box3();
  for (const m of st.meshes) if (m.zone === 'body' && m.mesh) torsoBox.expandByObject(m.mesh);
  const hasTorso = !torsoBox.isEmpty();
  const torsoW = hasTorso ? (torsoBox.max.x - torsoBox.min.x) : size.x;
  const torsoH = hasTorso ? (torsoBox.max.y - torsoBox.min.y) : size.y;
  const torsoCx = hasTorso ? (torsoBox.min.x + torsoBox.max.x) / 2 : 0;
  const torsoTop = hasTorso ? torsoBox.max.y : size.y * 0.5;
  st.decorationFrame = { torsoW, torsoH, torsoCx, torsoTop, size: size.clone() };

  const placeOne = (el, role, view, key) => {
    if (!el || !(el.value || '').trim()) return;
    const canvas = decalTextCanvas(el); if (!canvas) return;
    const vw = tpl.views[view] || {};
    const anchor = (vw.anchors && vw.anchors[role]) || { x: 0.5, y: 0.5, size: 160 };
    const viewH = vw.h || 940;
    const xFrac = Number.isFinite(el.x) ? el.x : anchor.x;
    const yFrac = Number.isFinite(el.y) ? el.y : anchor.y;
    const front = view === 'front';
    const dir = new THREE.Vector3(0, 0, front ? -1 : 1);
    const wx = torsoCx + (front ? (xFrac - 0.5) : (0.5 - xFrac)) * torsoW;
    const wy = torsoTop - yFrac * torsoH;
    const origin = new THREE.Vector3(wx, wy, front ? size.z * 3 : -size.z * 3);
    raycaster.set(origin, dir);
    // Raycast the whole model, not just the body mesh: garments built from real
    // sewn panels (e.g. separate front/back meshes) need the back decal to hit
    // the back panel, not miss because it only faces away from "body".
    const target = st.modelRoot || body;
    const hits = raycaster.intersectObject(target, true);
    if (!hits.length) return;
    const hit = hits[0];
    const surface = hit.object && hit.object.isMesh ? hit.object : body;
    const normal = hit.face.normal.clone().transformDirection(surface.matrixWorld).normalize();
    const helper = new THREE.Object3D();
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(normal));
    // The transparent text canvas is 1.5× the glyph height. Scale its decal so
    // the visible lettering itself matches the requested finished inches on a
    // 30" jersey, consistent with the 2D production proof.
    const decalH = Number.isFinite(el.inches)
      ? (el.inches / 30) * torsoH * 1.5
      : anchor.size * (size.y / viewH) * (el.size || 1) * 1.05;
    const decalW = decalH * (canvas.width / canvas.height);
    const dsize = new THREE.Vector3(decalW, decalH, Math.max(size.x, size.y, size.z) * 0.5);
    let geo;
    try { geo = new DecalGeometry(surface, hit.point, helper.rotation, dsize); } catch (e) { return; }
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, roughness: 0.7, metalness: 0.0, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nsaDecal = { key, view, role };
    st.scene.add(mesh); st.decals.push(mesh);
  };

  placeOne(spec.text.front.number, 'number', 'front', 'frontNumber');
  placeOne(spec.text.front.name, 'name', 'front', 'frontName');
  placeOne(spec.text.back.number, 'number', 'back', 'backNumber');
  placeOne(spec.text.back.name, 'name', 'back', 'backName');

  // Uploaded logos → surface decals. Images decode async; we cache the decoded
  // canvas per src (keyed on the data URL) so dragging the logo (same src, new
  // x/y) re-projects synchronously without reloading or flickering. A per-call
  // generation token drops decals from a superseded spec once its image loads.
  st._decalGen = (st._decalGen || 0) + 1;
  const gen = st._decalGen;
  const canvasCache = st._logoCanvas || (st._logoCanvas = {});
  const drawLogo = (cv, logo, view) => {
    const aspect = (cv._aspect && cv._aspect > 0) ? cv._aspect : ((logo.aspect && logo.aspect > 0) ? logo.aspect : 1);
    const front = view === 'front';
    const dir = new THREE.Vector3(0, 0, front ? -1 : 1);
    // Chest/back logos map to the torso; sleeve logos need the full model width
    // to reach out over the sleeve meshes.
    const sleeve = logo.slot === 'leftSleeve' || logo.slot === 'rightSleeve';
    const boxW = sleeve ? size.x : torsoW;
    const boxH = sleeve ? size.y : torsoH;
    const cx = sleeve ? 0 : torsoCx;
    const topY = sleeve ? size.y * 0.5 : torsoTop;
    const wx = cx + (front ? (logo.x - 0.5) : (0.5 - logo.x)) * boxW;
    const wy = topY - logo.y * boxH;
    const origin = new THREE.Vector3(wx, wy, front ? size.z * 3 : -size.z * 3);
    raycaster.set(origin, dir);
    // Raycast the whole model so a logo attaches to whatever panel it's over
    // (chest/back → body, sleeve logos → the sleeve mesh).
    const target = st.modelRoot || body;
    const hits = raycaster.intersectObject(target, true);
    if (!hits.length) return;
    const hit = hits[0];
    const surface = hit.object && hit.object.isMesh ? hit.object : body;
    const normal = hit.face.normal.clone().transformDirection(surface.matrixWorld).normalize();
    const helper = new THREE.Object3D();
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(normal));
    if (logo.rotation) helper.rotateZ((logo.rotation * Math.PI / 180) * (front ? 1 : -1));
    // Logos, names, and numbers all use finished visible HEIGHT. The decoded
    // image canvas is alpha-trimmed, so transparent PNG padding cannot make a
    // nominal 4-inch crest appear smaller than a 4-inch number.
    const decalH = Number.isFinite(logo.inches)
      ? (logo.inches / 30) * torsoH
      : (Math.max(0.02, (logo.w || 0.22)) * size.x) / aspect;
    const decalW = decalH * aspect;
    const dsize = new THREE.Vector3(decalW, decalH, Math.max(size.x, size.y, size.z) * 0.6);
    let geo;
    try { geo = new DecalGeometry(surface, hit.point, helper.rotation, dsize); } catch (e) { return; }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, roughness: 0.75, metalness: 0.0, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nsaDecal = { key: `logo:${logo.slot}`, view, slot: logo.slot, role: 'logo' };
    st.scene.add(mesh); st.decals.push(mesh);
    if (st.queueSnapshot) st.queueSnapshot(120);
  };
  const placeLogo = (logo, view) => {
    if (!logo || !logo.src) return;
    const cached = canvasCache[logo.src];
    if (cached) { drawLogo(cached, logo, view); return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      let cv;
      try { cv = canvasFromImage(img); }
      catch (_e) {
        const w = img.naturalWidth || img.width || 256, h = img.naturalHeight || img.height || 256;
        cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
      }
      cv._aspect = cv.width / cv.height;
      canvasCache[logo.src] = cv;
      if (st._decalGen === gen && st.mounted && st.bodyMesh) drawLogo(cv, logo, view);
    };
    img.src = logo.src;
  };
  ((spec.logos && spec.logos.front) || []).forEach((l) => placeLogo(l, 'front'));
  ((spec.logos && spec.logos.back) || []).forEach((l) => placeLogo(l, 'back'));
}

const ACTIVE_AREA_LABELS = {
  body: 'Body', bodyStripe: 'Chest Stripe', bodyAccent: 'Side Panels', sleeves: 'Sleeves',
  legs: 'Shorts Legs', stripe: 'Shorts Side Inserts', waistband: 'Shorts Waistband',
  sleeveL: 'Left Sleeve', sleeveR: 'Right Sleeve', sleeveBands: 'Sleeve Bands',
  sleeveBandL: 'Left Sleeve Band', sleeveBandR: 'Right Sleeve Band',
  collar: 'Collar & Cuffs',
};

const DECORATION_LABELS = {
  frontNumber: 'Front Number', backNumber: 'Back Number', backName: 'Back Name',
  'logo:chest': 'Left Chest Logo', 'logo:rightChest': 'Right Chest Logo',
  'logo:leftSleeve': 'Left Sleeve Logo', 'logo:rightSleeve': 'Right Sleeve Logo',
  'logo:back': 'Back Neck Logo', 'logo:backUnderNumber': 'Under Number Logo',
};

// Selecting back artwork while the camera is showing the front made the
// decoration controls feel broken. Keep the garment untouched, but rotate the
// camera to the relevant working face. The customer can immediately resume
// free orbiting from this position.
function focusDecorationView(st, key) {
  if (!st || !st.camera || !st.controls || !key) return;
  const target = st.controls.target;
  const offset = st.camera.position.clone().sub(target);
  const radius = Math.max(offset.length(), 0.001);
  const y = offset.y;
  const horizontal = Math.sqrt(Math.max(radius * radius - y * y, radius * radius * 0.3));
  let x = 0, z = horizontal;
  if (key === 'backNumber' || key === 'backName' || key === 'logo:back' || key === 'logo:backUnderNumber') z = -horizontal;
  else if (key === 'logo:leftSleeve') { x = -horizontal * 0.52; z = horizontal * 0.85; }
  else if (key === 'logo:rightSleeve') { x = horizontal * 0.52; z = horizontal * 0.85; }
  st.controls.autoRotate = false;
  st.camera.position.set(target.x + x, target.y + y, target.z + z);
  st.camera.lookAt(target);
  st.controls.update();
}

function selectionMode(activeArea, zone) {
  if (!activeArea || !zone) return null;
  if (activeArea === 'legs') return (zone === 'legL' || zone === 'legR') ? 'whole' : null;
  if (activeArea === 'stripe') return (zone === 'sidePanelL' || zone === 'sidePanelR') ? 'whole' : null;
  if (activeArea === 'waistband') return zone === 'waistband' ? 'whole' : null;
  if (activeArea === 'body') return zone === 'body' ? 'base' : null;
  if (activeArea === 'bodyStripe') return zone === 'body' ? 'accent' : null;
  if (activeArea === 'sleeves') return (zone === 'sleeveL' || zone === 'sleeveR') ? 'base' : null;
  if (activeArea === 'sleeveL') return zone === 'sleeveL' ? 'base' : null;
  if (activeArea === 'sleeveR') return zone === 'sleeveR' ? 'base' : null;
  if (activeArea === 'sleeveBands') return (zone === 'sleeveL' || zone === 'sleeveR') ? 'accent' : null;
  if (activeArea === 'sleeveBandL') return zone === 'sleeveL' ? 'accent' : null;
  if (activeArea === 'sleeveBandR') return zone === 'sleeveR' ? 'accent' : null;
  return activeArea === zone ? 'whole' : null;
}

function clearSelection(st) {
  if (st.outlinePass) st.outlinePass.selectedObjects = [];
  for (const overlay of (st.selectionOverlays || [])) {
    if (overlay.parent) overlay.parent.remove(overlay);
    if (overlay.material) overlay.material.dispose();
  }
  st.selectionOverlays = [];
}

function addSelectionEdge(st, entry, alphaMap) {
  if (!st.mounted || !entry.mesh || !entry.mesh.geometry) return;
  const material = new THREE.MeshBasicMaterial({
    color: '#192853',
    transparent: true,
    opacity: 0.92,
    alphaMap,
    alphaTest: 0.08,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  const overlay = new THREE.Mesh(entry.mesh.geometry, material);
  overlay.name = `selected_${entry.mesh.name || entry.zone || 'area'}`;
  overlay.renderOrder = 25;
  overlay.userData.nsaSelectionOverlay = true;
  entry.mesh.add(overlay);
  st.selectionOverlays.push(overlay);
}

// The controls and garment always point at the same thing, but selection must
// never change the garment's finish. Whole sewn panels use a screen-space
// contour; artwork sub-zones trace only the real UV color-break boundary.
function applySelection(st, activeArea, rawSpec) {
  if (!st) return;
  st._selectionGen = (st._selectionGen || 0) + 1;
  clearSelection(st);
}

// `fit` scales the initial camera distance: 1.5 leaves generous margin (editor
// default); smaller values frame the garment closer for hero/stage layouts.
// `tiltDeg` orbits the camera up for a more dramatic 3/4 look (target stays on
// the model center so it stays framed). `shiftPx` pans the model horizontally by
// N screen pixels — the wizard uses it to sit the jersey under the whole page's
// center even though the 3D stage only occupies the area left of the rail.
export default function Viewer3D({ spec, modelUrl, autoRotate, fit = 1.5, tiltDeg = 0, shiftPx = 0, view = null, interactive = true, activeArea = null, activeDecoration = null, onDecorationSelect = null, onDecorationMove = null, onZoneSelect = null, onSnapshot = null, fallbackImage = null }) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const activeAreaRef = useRef(activeArea); activeAreaRef.current = activeArea;
  const activeDecorationRef = useRef(activeDecoration); activeDecorationRef.current = activeDecoration;
  const decorationSelectRef = useRef(onDecorationSelect); decorationSelectRef.current = onDecorationSelect;
  const decorationMoveRef = useRef(onDecorationMove); decorationMoveRef.current = onDecorationMove;
  const zoneSelectRef = useRef(onZoneSelect); zoneSelectRef.current = onZoneSelect;
  const snapshotRef = useRef(onSnapshot); snapshotRef.current = onSnapshot;
  const specRef = useRef(spec); specRef.current = spec;
  const autoRotateRef = useRef(autoRotate); autoRotateRef.current = autoRotate;
  const [status, setStatus] = useState('loading');
  const [studio, setStudio] = useState(loadStudioProfile);
  const studioRef = useRef(studio); studioRef.current = studio;
  const studioOpen = typeof window !== 'undefined' && /[?&]studio=1/.test(window.location.search);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !modelUrl) { setStatus('nomodel'); return undefined; }
    const W = mount.clientWidth || 600, H = mount.clientHeight || 700;

    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch (_e) { setStatus('error'); return undefined; }
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR-neutral tone mapping: built for product configurators — keeps
    // saturated brand colors true. ACES filmic skewed deep reds (maroon) toward
    // salmon pink on the lit side.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = studioRef.current.exposure;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    // Solid white stage: the AO pass needs an opaque background, and both host
    // surfaces (wizard stage / editor stage) are white anyway.
    scene.background = new THREE.Color().setScalar(studioRef.current.bg);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(32, W / H, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enabled = !!interactive;
    controls.autoRotate = !!autoRotate; controls.autoRotateSpeed = 1.1;
    // Lens shift: move the rendered image right by `shiftPx` CSS px without
    // moving the camera or orbit target. Re-applied on resize so the shift
    // tracks the current canvas size.
    const applyShift = (w, h) => {
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      if (shiftPx) camera.setViewOffset(w, h, -shiftPx, 0, w, h);
      else if (camera.view && camera.view.enabled) camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };

    // Directional-heavy rig: the flatter the fill, the faster a white garment
    // disappears into a white page. Shape comes from the key + AO; hemi stays
    // low so downward-facing cloth shades into soft gray like a studio render.
    const key = new THREE.DirectionalLight(0xffffff, studioRef.current.key); key.position.set(1.2, 3.2, 2.2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, studioRef.current.fill); fill.position.set(-2, 0.5, 1); scene.add(fill);
    // Rear light so the BACK of the garment reads its true colorway (orbit moves
    // the camera, not the model).
    const back = new THREE.DirectionalLight(0xffffff, studioRef.current.back); back.position.set(-1, 2.2, -2.5); scene.add(back);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xaeb4bd, studioRef.current.hemi); scene.add(hemi);

    // Post chain: GTAO is what keeps a white jersey visible on a white page —
    // creases, under-sleeve and collar contact shading build up the way they do
    // in studio product renders. Radius is set from the model's real size once
    // it loads (AO distances are in model units).
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, W, H);
    composer.addPass(gtao);
    composer.addPass(new OutputPass());

    const st = { renderer, scene, camera, controls, pmrem, composer, gtao, lights: { key, fill, back, hemi }, meshes: [], detailMeshes: [], decals: [], selectionOverlays: [], bodyMesh: null, modelSize: null, raf: 0, mounted: true };
    stateRef.current = st;

    // Finalize and production exports use this exact WebGL render instead of a
    // second flat-art approximation. preserveDrawingBuffer above makes the
    // post-processed canvas safe to capture after materials and decals settle.
    const queueSnapshot = (delay = 220) => {
      if (!snapshotRef.current) return;
      clearTimeout(st.snapshotTimer);
      st.snapshotTimer = setTimeout(() => {
        if (!st.mounted || !snapshotRef.current) return;
        requestAnimationFrame(() => {
          if (!st.mounted || !snapshotRef.current) return;
          try {
            controls.update(); composer.render();
            const canvas = renderer.domElement;
            snapshotRef.current({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, view: st.captureView || 'front' });
          } catch (_e) { /* capture is best-effort; the live model remains usable */ }
        });
      }, delay);
    };
    st.queueSnapshot = queueSnapshot;

    // Direct-on-garment decoration placement is intentionally two-step. The
    // first click selects artwork without moving it; only a later drag on that
    // already-selected item captures the pointer and changes its position.
    const dragRay = new THREE.Raycaster();
    const dragPointer = new THREE.Vector2();
    const rayHits = (e, objects) => {
      if (!objects || !objects.length) return [];
      const rect = renderer.domElement.getBoundingClientRect();
      dragPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      dragPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      scene.updateMatrixWorld(true);
      dragRay.setFromCamera(dragPointer, camera);
      return dragRay.intersectObjects(objects, false);
    };
    const stopPointer = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation();
      else if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    const onDirectDown = (e) => {
      if (decorationMoveRef.current && st.decals.length) {
        const hit = rayHits(e, st.decals)[0];
        const meta = hit && hit.object && hit.object.userData && hit.object.userData.nsaDecal;
        if (meta && meta.key) {
          stopPointer(e);
          if (!shouldStartDecorationDrag(activeDecorationRef.current, meta.key)) {
            st.selectDecorationPointer = e.pointerId;
            if (decorationSelectRef.current) decorationSelectRef.current(meta.key);
            return;
          }
          st.dragDecoration = { ...meta, pointerId: e.pointerId };
          controls.enabled = false; controls.autoRotate = false;
          try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_e) {}
          return;
        }
      }
      if (zoneSelectRef.current) st.zoneClick = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    };
    const onDirectMove = (e) => {
      if (st.zoneClick && st.zoneClick.pointerId === e.pointerId && Math.hypot(e.clientX - st.zoneClick.x, e.clientY - st.zoneClick.y) > 6) st.zoneClick.moved = true;
      const drag = st.dragDecoration;
      if (!drag || drag.pointerId !== e.pointerId || !st.decorationFrame) return;
      stopPointer(e);
      let targets = st.meshes.map((entry) => entry.mesh).filter(Boolean);
      if (drag.slot === 'leftSleeve' || drag.slot === 'rightSleeve') {
        const wanted = drag.slot === 'leftSleeve' ? 'sleeveL' : 'sleeveR';
        const sleeveTargets = st.meshes.filter((entry) => entry.zone === wanted).map((entry) => entry.mesh).filter(Boolean);
        if (sleeveTargets.length) targets = sleeveTargets;
      } else {
        const bodyTargets = st.meshes.filter((entry) => entry.zone === 'body').map((entry) => entry.mesh).filter(Boolean);
        if (bodyTargets.length) targets = bodyTargets;
      }
      const hit = rayHits(e, targets)[0];
      if (!hit) return;
      const f = st.decorationFrame;
      const front = drag.view !== 'back';
      const sleeve = drag.slot === 'leftSleeve' || drag.slot === 'rightSleeve';
      const boxW = sleeve ? f.size.x : f.torsoW;
      const boxH = sleeve ? f.size.y : f.torsoH;
      const cx = sleeve ? 0 : f.torsoCx;
      const topY = sleeve ? f.size.y * 0.5 : f.torsoTop;
      const dx = (hit.point.x - cx) / Math.max(boxW, 0.0001);
      const x = THREE.MathUtils.clamp(front ? 0.5 + dx : 0.5 - dx, 0.03, 0.97);
      const y = THREE.MathUtils.clamp((topY - hit.point.y) / Math.max(boxH, 0.0001), 0.03, 0.97);
      if (decorationMoveRef.current) decorationMoveRef.current({ key: drag.key, x, y });
    };
    const onDirectUp = (e) => {
      if (st.selectDecorationPointer === e.pointerId) {
        stopPointer(e);
        st.selectDecorationPointer = null;
        st.zoneClick = null;
        return;
      }
      if (st.dragDecoration && st.dragDecoration.pointerId === e.pointerId) {
        stopPointer(e);
        st.dragDecoration = null;
        st.zoneClick = null;
        controls.enabled = true; controls.autoRotate = !!autoRotateRef.current;
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_e) {}
        return;
      }
      const click = st.zoneClick;
      st.zoneClick = null;
      if (click && click.moved) st.suppressNextZoneClick = true;
      if (!click || click.pointerId !== e.pointerId || click.moved || !zoneSelectRef.current) return;
      const hit = rayHits(e, st.meshes.map((entry) => entry.mesh).filter(Boolean))[0];
      if (!hit) return;
      const entry = st.meshes.find((candidate) => candidate.mesh === hit.object);
      if (!entry || !entry.zone) return;
      const tpl = getTemplate(specRef.current && specRef.current.garmentId);
      const meshName = String(entry.mesh.name || '').toLowerCase();
      const areaMap = tpl.designMaskAreas && tpl.designMaskAreas[meshName];
      const maskUrl = tpl.designMasks && tpl.designMasks[meshName];
      let accent = false;
      if (areaMap && tpl.proceduralLayout === 'sidePanels' && (meshName === 'body_front' || meshName === 'body_back') && st._sidePanelBounds) {
        const p = entry.mesh.worldToLocal(hit.point.clone());
        const b = st._sidePanelBounds;
        const yn = THREE.MathUtils.clamp((p.y - b.yMin) / b.height, 0, 1);
        const depth = Math.abs(p.z - b.depthCenter) / b.depthHalf;
        accent = yn < 0.70 && depth < 0.48;
      } else if (areaMap && (entry.zone === 'sleeveL' || entry.zone === 'sleeveR')) {
        // Sleeve openings are narrow UV strips. Use both the authored mask and
        // the physical distance from the opening so a click on the visible cuff
        // remains dependable even at steep side/back viewing angles.
        accent = designMaskIsAccent(maskUrl, hit.uv);
        if (!accent) {
          const worldBox = new THREE.Box3().setFromObject(entry.mesh);
          const height = Math.max(worldBox.max.y - worldBox.min.y, 1e-5);
          const yn = (hit.point.y - worldBox.min.y) / height;
          accent = yn < 0.46;
        }
      } else if (areaMap) accent = designMaskIsAccent(maskUrl, hit.uv);
      const area = areaMap ? (accent ? areaMap.accent : areaMap.base) : entry.zone;
      if (area) zoneSelectRef.current(area);
    };
    // A native click fallback covers browsers/automation surfaces that do not
    // expose PointerEvent ids consistently. Real orbit drags are suppressed by
    // the movement guard above, so this never turns rotation into a selection.
    const onDirectClick = (e) => {
      if (!zoneSelectRef.current || st.dragDecoration) return;
      if (st.suppressNextZoneClick) { st.suppressNextZoneClick = false; return; }
      st.zoneClick = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      onDirectUp(e);
    };
    const onDirectCancel = (e) => {
      st.zoneClick = null;
      if (st.selectDecorationPointer === e.pointerId) st.selectDecorationPointer = null;
      if (st.dragDecoration && st.dragDecoration.pointerId === e.pointerId) onDirectUp(e);
    };
    renderer.domElement.addEventListener('pointerdown', onDirectDown, true);
    renderer.domElement.addEventListener('pointermove', onDirectMove, true);
    renderer.domElement.addEventListener('pointerup', onDirectUp, true);
    renderer.domElement.addEventListener('pointercancel', onDirectCancel, true);
    renderer.domElement.addEventListener('click', onDirectClick, true);

    const draco = new DRACOLoader().setDecoderPath(PUB + '/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load(modelUrl, (gltf) => {
      if (!st.mounted) return;
      const rootObj = gltf.scene;
      const box = new THREE.Box3().setFromObject(rootObj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      rootObj.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = (maxDim / 2) / Math.tan((camera.fov * Math.PI / 180) / 2) * fit;
      // tiltDeg orbits the camera up (keeping the model center as the target) so
      // the garment reads with a more dramatic 3/4 angle but stays framed. Camera
      // and target both stay on the model center so OrbitControls pivots around
      // the middle of the garment.
      const tiltRad = (tiltDeg || 0) * Math.PI / 180;
      // QA/product-view query support also gives merchandisers deterministic
      // front/side/back URLs when reviewing a garment in the real web renderer.
      const requestedView = view || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null);
      st.captureView = requestedView || 'front';
      const horizontal = dist * Math.cos(tiltRad);
      camera.position.set(requestedView === 'side' ? horizontal : 0, dist * Math.sin(tiltRad), requestedView === 'back' ? -horizontal : requestedView === 'side' ? 0 : horizontal);
      camera.near = dist / 100; camera.far = dist * 100;
      controls.target.set(0, 0, 0);
      // The horizontal shift (to sit the model under the whole page's center,
      // past the control rail) is a lens shift via setViewOffset — it moves the
      // image, NOT the camera/target, so the orbit pivot stays centered.
      applyShift(mount.clientWidth || W, mount.clientHeight || H);
      // Distance limits must scale with the model (units vary per asset), or the
      // camera gets clamped inside the mesh.
      controls.minDistance = dist * 0.35; controls.maxDistance = dist * 4;
      controls.update();

      rootObj.traverse((o) => {
        if (o.isMesh) {
          // Replace the vendor material with our own plain fabric material —
          // applyDesign owns color/map/roughness anyway, and vendor exports
          // (e.g. CLO3D's KHR_materials_specular at full strength) otherwise
          // catch the lights and wash tinted colors toward pastel. Keep the
          // original name: matchZone falls back to it for zone matching.
          const srcMat = o.material;
          // Sewn topstitch and drawcord geometry is authored as a fixed detail,
          // not a recolorable fabric zone. Preserve those neutral thread/cord
          // materials while the garment panels remain fully editable.
          // The soccer foundation names the stitch objects `stitch_*` while
          // their shared material is `detail_stitch`.  Looking only at the
          // object name accidentally treated those raised seam tubes as body
          // fabric and recolored them cyan.  On AGI-1011's black insert that
          // produced the large broken/zig-zag side seam the user could see.
          const detailName = `${o.name || ''} ${srcMat && srcMat.name || ''}`;
          if (/(^|\s)(detail_|stitch_)/i.test(detailName)) {
            srcMat.side = THREE.DoubleSide;
            srcMat.envMapIntensity = studioRef.current.env;
            srcMat.needsUpdate = true;
            st.detailMeshes.push(o);
            return;
          }
          // A vendor normal only counts if it actually carries detail — some
          // exports ship an all-neutral (128,128,255) map, which would both look
          // like flat plastic AND block our per-fabric surface system.
          const vendorNormal = !!srcMat.normalMap && !isFlatNormalTexture(srcMat.normalMap);
          o.material = new THREE.MeshPhysicalMaterial({
            name: srcMat.name,
            color: srcMat.color ? srcMat.color.clone() : 0xffffff,
            // Double-sided so looking through the neck/openings shows the fabric
            // interior, not the studio background bleeding through culled backfaces
            // ("just white inside"). A real jersey's inside is the same cloth.
            side: THREE.DoubleSide,
            envMapIntensity: studioRef.current.env,
            // Keep a baked normal map when the vendor supplied a REAL one (that's
            // the cloth-wrinkle detail); otherwise fall back to our knit bump so
            // solid colors still read as fabric, not plastic.
            normalMap: vendorNormal ? srcMat.normalMap : fabricNormalTexture('sublimated'),
            normalScale: vendorNormal ? (srcMat.normalScale || new THREE.Vector2(1, 1)) : new THREE.Vector2(0.45, 0.45),
            // Fabric sheen (the soft edge glow cloth has at grazing angles) is
            // what separates "jersey" from "painted plastic" at arm's length.
            sheen: studioRef.current.sheen,
            sheenRoughness: 0.7,
            sheenColor: new THREE.Color(0xffffff),
          });
          const zone = matchZone(o.name) || matchZone(o.material && o.material.name);
          st.meshes.push({ mesh: o, zone, vendorNormal });
        }
      });
      scene.add(rootObj);
      scene.updateMatrixWorld(true);
      st.bodyMesh = (st.meshes.find((m) => m.zone === 'body') || st.meshes[0] || {}).mesh || null;
      st.modelRoot = rootObj;
      st.modelSize = size.clone();
      // AO distances are in model units, so tune the pass to this asset's size.
      try {
        const sp = studioRef.current;
        gtao.updateGtaoMaterial({ radius: maxDim * sp.aoRadius, distanceExponent: 1.2, thickness: maxDim * 0.02, scale: sp.aoScale, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
        gtao.setSceneClipBox(new THREE.Box3().setFromObject(rootObj));
      } catch (e) { /* AO tuning is best-effort */ }
      try { applyDesign(st, spec); updateDecals(st, spec); applySelection(st, activeAreaRef.current, spec); } catch (e) { /* keep default */ }
      if (activeDecorationRef.current) focusDecorationView(st, activeDecorationRef.current);
      setStatus('ready');
      queueSnapshot(450);
      draco.dispose();
    }, undefined, () => { setStatus('error'); });

    const animate = () => { st.raf = requestAnimationFrame(animate); controls.update(); composer.render(); };
    animate();

    // Keep the drawing buffer synced to the container (ResizeObserver catches the
    // lazy/Suspense mount where the container starts at 0×0; window 'resize' won't).
    const resize = () => {
      if (!st.mounted) return;
      const w = mount.clientWidth || W, h = mount.clientHeight || H;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      applyShift(w, h);
    };
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(mount); }
    window.addEventListener('resize', resize);
    resize();

    return () => {
      st.mounted = false;
      renderer.domElement.removeEventListener('pointerdown', onDirectDown, true);
      renderer.domElement.removeEventListener('pointermove', onDirectMove, true);
      renderer.domElement.removeEventListener('pointerup', onDirectUp, true);
      renderer.domElement.removeEventListener('pointercancel', onDirectCancel, true);
      renderer.domElement.removeEventListener('click', onDirectClick, true);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      clearTimeout(st.snapshotTimer);
      cancelAnimationFrame(st.raf);
      controls.dispose();
      clearSelection(st);
      st.decals.forEach((d) => { if (d.material.map) d.material.map.dispose(); d.material.dispose(); d.geometry.dispose(); });
      st.meshes.forEach(({ mesh }) => { const m = mesh.material.map; if (m && !(m.userData && m.userData.shared)) m.dispose(); mesh.material.dispose(); mesh.geometry.dispose(); });
      st.detailMeshes.forEach((mesh) => { if (mesh.material && mesh.material.map) mesh.material.map.dispose(); if (mesh.material) mesh.material.dispose(); if (mesh.geometry) mesh.geometry.dispose(); });
      pmrem.dispose();
      try { gtao.dispose(); composer.dispose(); } catch (e) { /* older three */ }
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [modelUrl, view, interactive]); // eslint-disable-line

  // re-apply on autoRotate toggle
  useEffect(() => { const st = stateRef.current; if (st && st.controls) st.controls.autoRotate = !!autoRotate; }, [autoRotate]);

  // Jump to the working face when a decoration is selected. This changes only
  // the view, never the jersey surface or the saved placement.
  useEffect(() => { const st = stateRef.current; if (st && st.meshes && st.meshes.length && activeDecoration) focusDecorationView(st, activeDecoration); }, [activeDecoration]);

  // studio profile changes apply to the live scene and persist locally
  useEffect(() => {
    const st = stateRef.current;
    if (st) applyStudioProfile(st, studio);
    saveStudioProfile(studio);
  }, [studio]);

  // re-color on spec change
  useEffect(() => {
    const st = stateRef.current;
    if (st && st.meshes && st.meshes.length) {
      try { applyDesign(st, spec); updateDecals(st, spec); st.queueSnapshot && st.queueSnapshot(350); } catch (e) {}
    }
  }, [spec]);

  // Keep the 3D garment visually tied to the section currently being edited.
  useEffect(() => {
    const st = stateRef.current;
    if (st && st.meshes && st.meshes.length) { try { applySelection(st, activeArea, spec); } catch (e) {} }
  }, [activeArea]); // eslint-disable-line

  const STUDIO_SLIDERS = [
    ['key', 'Key Light', 0, 2.5, 0.05], ['fill', 'Fill Light', 0, 1.5, 0.02], ['back', 'Back Light', 0, 1.5, 0.02],
    ['hemi', 'Ambient', 0, 1, 0.02], ['exposure', 'Exposure', 0.6, 1.6, 0.02], ['env', 'Reflections', 0, 1, 0.02],
    ['sheen', 'Sheen', 0, 1, 0.02], ['aoRadius', 'Shadow Size', 0.01, 0.25, 0.005], ['aoScale', 'Shadow Strength', 0, 5, 0.1],
    ['bg', 'Backdrop', 0.8, 1, 0.01],
  ];

  return (
    <div ref={mountRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, cursor: interactive ? 'grab' : 'default' }}>
      {status === 'loading' && <div style={ovl}>Loading 3D…</div>}
      {(status === 'error' || status === 'nomodel') && fallbackImage && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
          <img src={fallbackImage} alt="2D garment proof" style={{ width: '92%', height: '92%', objectFit: 'contain' }} />
          <span style={{ position: 'absolute', right: 18, bottom: 18, padding: '6px 9px', borderRadius: 999, background: 'rgba(255,255,255,.94)', border: '1px solid #d1d5de', color: '#5A6075', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: .6, textTransform: 'uppercase' }}>2D proof view</span>
        </div>
      )}
      {status === 'error' && !fallbackImage && <div style={ovl}>Couldn’t load the 3D model.</div>}
      {status === 'nomodel' && !fallbackImage && <div style={ovl}>3D preview isn’t available for this garment yet.</div>}
      {status === 'ready' && activeArea && (
        <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 999, background: 'rgba(255,255,255,.94)', border: '1px solid rgba(25,40,83,.2)', boxShadow: '0 3px 12px rgba(15,23,42,.11)', color: '#192853', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase', pointerEvents: 'none', zIndex: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#192853', boxShadow: '0 0 0 3px rgba(25,40,83,.13)' }} />
          Editing {ACTIVE_AREA_LABELS[activeArea] || activeArea}
        </div>
      )}
      {status === 'ready' && activeDecoration && (
        <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 999, background: 'rgba(255,255,255,.94)', border: '1px solid rgba(150,44,50,.22)', boxShadow: '0 3px 12px rgba(15,23,42,.11)', color: '#192853', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase', pointerEvents: 'none', zIndex: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#962C32', boxShadow: '0 0 0 3px rgba(150,44,50,.13)' }} />
          {DECORATION_LABELS[activeDecoration] || 'Artwork'} Selected · Drag to Reposition
        </div>
      )}
      {studioOpen && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 230, background: 'rgba(255,255,255,0.96)', border: '1px solid #d7dbe3', borderRadius: 8, padding: '12px 14px', boxShadow: '0 4px 18px rgba(15,23,42,.14)', fontFamily: 'system-ui, sans-serif', zIndex: 5 }}
          onPointerDown={(e) => e.stopPropagation()}>
          <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#192853', marginBottom: 8 }}>Render Studio</div>
          {STUDIO_SLIDERS.map(([k, label, min, max, step]) => (
            <div key={k} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#3d4356', marginBottom: 2 }}>
                <span>{label}</span><span>{Number(studio[k]).toFixed(k === 'aoRadius' ? 3 : 2)}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={studio[k]}
                onChange={(e) => setStudio((prev) => ({ ...prev, [k]: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: '#192853' }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setStudio({ ...STUDIO_DEFAULTS })} style={studioBtn}>Reset</button>
            <button onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(studio, null, 2)); } catch (_e) {} }} style={{ ...studioBtn, background: '#192853', color: '#fff', borderColor: '#192853' }}>Copy values</button>
          </div>
        </div>
      )}
    </div>
  );
}

const studioBtn = { flex: 1, fontSize: 11, fontWeight: 700, padding: '7px 0', borderRadius: 5, border: '1px solid #c9cedb', background: '#fff', color: '#192853', cursor: 'pointer' };

const ovl = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5A6075', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 14, pointerEvents: 'none' };
