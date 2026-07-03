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

const PUB = (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL) ? process.env.PUBLIC_URL : '';

// Map a mesh/material name to one of our zone ids (tolerant of naming variants a
// vendor might use — "Left Sleeve", "sleeve_l", "cuff", etc.).
function matchZone(name) {
  if (!name) return null;
  const s = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const rules = [
    ['sleevel', 'sleeveL'], ['leftsleeve', 'sleeveL'], ['sleeveleft', 'sleeveL'], ['larm', 'sleeveL'],
    ['sleever', 'sleeveR'], ['rightsleeve', 'sleeveR'], ['sleeveright', 'sleeveR'], ['rarm', 'sleeveR'],
    ['sidepanell', 'sidePanelL'], ['sidepanelr', 'sidePanelR'], ['sidel', 'sidePanelL'], ['sider', 'sidePanelR'],
    ['collar', 'collar'], ['neck', 'collar'], ['cuff', 'collar'], ['trim', 'collar'], ['rib', 'collar'],
    ['yoke', 'yoke'], ['shoulder', 'yoke'], ['pocket', 'pocket'], ['hood', 'hood'],
    ['sleeve', 'sleeveL'],
    ['body', 'body'], ['torso', 'body'], ['front', 'body'], ['main', 'body'], ['chest', 'body'], ['jersey', 'body'],
  ];
  for (const [k, z] of rules) if (s.includes(k)) return z;
  return null;
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
  key: 1.3,       // main top-front light
  fill: 0.18,     // soft left fill
  back: 0.5,      // rear light (back-view color read)
  hemi: 0.14,     // ambient — the higher it goes, the flatter the garment
  exposure: 1.0,  // overall brightness
  env: 0.12,      // environment reflections
  sheen: 0.1,     // fabric grazing-angle glow
  aoRadius: 0.09, // AO reach, as a fraction of garment size
  aoScale: 2.2,   // AO strength
  bg: 1.0,        // backdrop shade (1 = white, lower = gray studio wall)
};
const STUDIO_LS_KEY = 'nsa_uniform_studio';
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

function applyDesign(st, rawSpec) {
  const spec = ds.normalizeSpec(rawSpec);
  for (const entry of st.meshes) {
    const zone = entry.zone;
    const zs = (zone && spec.zones[zone]) || spec.zones.body || ds.DEFAULT_ZONE;
    const mat = entry.mesh.material;
    const color = ds.toHex(zs.color, '#1f2a44');
    const color2 = ds.toHex(zs.color2, '#ffffff');
    const pat = zs.pattern || 'solid';
    if (mat.map) { if (!(mat.map.userData && mat.map.userData.shared)) mat.map.dispose(); mat.map = null; }
    if (pat === 'custom' && zs.patternImage) {
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
        const source = zs.patternTint ? tintedTile(img, zs.patternImage, color, color2, ds.toHex(zs.color3, '#ffffff'), ds.toHex(zs.color4, '#ffffff'), zs.patternTintMode) : img;
        const tex = new THREE.CanvasTexture(source);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const rep = entry.zone === 'body' ? 4 : 2.5;
        tex.repeat.set(rep, rep);
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = entry.mesh.material;
        if (m.map) m.map.dispose();
        m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
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
        // Fine patterns need a higher repeat or they read as broad bands on the
        // body panel — keep the 3D stripe density close to the 2D proof's.
        const fine = pat === 'stripes' || pat === 'pinstripe' || pat === 'dots' || pat === 'carbon' || pat === 'hex';
        const rep = entry.zone === 'body' ? (fine ? 10 : 5) : (fine ? 5 : 3);
        tex.repeat.set(rep, rep);
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
  // 3D decals want a beefier stroke than the 2D proof (small on screen);
  // matches the old S/24 scaling via outlineWidth × 2 in the engine.
  const ow = el.outlineWidth > 0 ? (el.outlineWidth * (S / 24)) / 2 : 0;
  const opts = { value: val, font: el.font, size: S, fill, outline, outlineWidth: ow, letterSpacing: el.letterSpacing || 0, arch: el.arch || 0 };
  const meas = document.createElement('canvas').getContext('2d');
  const m = measureAthleticText(meas, opts);
  const pad = Math.ceil(S * 0.4);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.ceil(m.total) + pad * 2);
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

  const placeOne = (el, role, view) => {
    if (!el || !(el.value || '').trim()) return;
    const canvas = decalTextCanvas(el); if (!canvas) return;
    const vw = tpl.views[view] || {};
    const anchor = (vw.anchors && vw.anchors[role]) || { x: 0.5, y: 0.5, size: 160 };
    const viewH = vw.h || 940;
    const xFrac = Number.isFinite(el.x) ? el.x : anchor.x;
    const yFrac = Number.isFinite(el.y) ? el.y : anchor.y;
    const front = view === 'front';
    const dir = new THREE.Vector3(0, 0, front ? -1 : 1);
    const wx = (front ? (xFrac - 0.5) : (0.5 - xFrac)) * size.x;
    const wy = (0.5 - yFrac) * size.y;
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
    const decalH = anchor.size * (size.y / viewH) * (el.size || 1) * 1.05;
    const decalW = decalH * (canvas.width / canvas.height);
    const dsize = new THREE.Vector3(decalW, decalH, Math.max(size.x, size.y, size.z) * 0.5);
    let geo;
    try { geo = new DecalGeometry(surface, hit.point, helper.rotation, dsize); } catch (e) { return; }
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, roughness: 0.7, metalness: 0.0, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    st.scene.add(mesh); st.decals.push(mesh);
  };

  placeOne(spec.text.front.number, 'number', 'front');
  placeOne(spec.text.front.name, 'name', 'front');
  placeOne(spec.text.back.number, 'number', 'back');
  placeOne(spec.text.back.name, 'name', 'back');

  // Uploaded logos → surface decals. Images decode async; we cache the decoded
  // canvas per src (keyed on the data URL) so dragging the logo (same src, new
  // x/y) re-projects synchronously without reloading or flickering. A per-call
  // generation token drops decals from a superseded spec once its image loads.
  st._decalGen = (st._decalGen || 0) + 1;
  const gen = st._decalGen;
  const canvasCache = st._logoCanvas || (st._logoCanvas = {});
  const drawLogo = (cv, logo, view) => {
    const aspect = (logo.aspect && logo.aspect > 0) ? logo.aspect : (cv._aspect || 1);
    const front = view === 'front';
    const dir = new THREE.Vector3(0, 0, front ? -1 : 1);
    const wx = (front ? (logo.x - 0.5) : (0.5 - logo.x)) * size.x;
    const wy = (0.5 - logo.y) * size.y;
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
    const decalW = Math.max(0.02, (logo.w || 0.22)) * size.x;
    const decalH = decalW / aspect;
    const dsize = new THREE.Vector3(decalW, decalH, Math.max(size.x, size.y, size.z) * 0.6);
    let geo;
    try { geo = new DecalGeometry(surface, hit.point, helper.rotation, dsize); } catch (e) { return; }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, roughness: 0.75, metalness: 0.0, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    st.scene.add(mesh); st.decals.push(mesh);
  };
  const placeLogo = (logo, view) => {
    if (!logo || !logo.src) return;
    const cached = canvasCache[logo.src];
    if (cached) { drawLogo(cached, logo, view); return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || img.width || 256, h = img.naturalHeight || img.height || 256;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h); cv._aspect = w / h;
      canvasCache[logo.src] = cv;
      if (st._decalGen === gen && st.mounted && st.bodyMesh) drawLogo(cv, logo, view);
    };
    img.src = logo.src;
  };
  ((spec.logos && spec.logos.front) || []).forEach((l) => placeLogo(l, 'front'));
  ((spec.logos && spec.logos.back) || []).forEach((l) => placeLogo(l, 'back'));
}

// `fit` scales the initial camera distance: 1.5 leaves generous margin (editor
// default); smaller values frame the garment closer for hero/stage layouts.
export default function Viewer3D({ spec, modelUrl, autoRotate, fit = 1.5 }) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [studio, setStudio] = useState(loadStudioProfile);
  const studioRef = useRef(studio); studioRef.current = studio;
  const studioOpen = typeof window !== 'undefined' && /[?&]studio=1/.test(window.location.search);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !modelUrl) { setStatus('nomodel'); return undefined; }
    const W = mount.clientWidth || 600, H = mount.clientHeight || 700;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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
    controls.autoRotate = !!autoRotate; controls.autoRotateSpeed = 1.1;

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

    const st = { renderer, scene, camera, controls, pmrem, composer, gtao, lights: { key, fill, back, hemi }, meshes: [], decals: [], bodyMesh: null, modelSize: null, raf: 0, mounted: true };
    stateRef.current = st;

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
      camera.position.set(0, size.y * 0.02, dist);
      camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
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
          o.material = new THREE.MeshPhysicalMaterial({
            name: srcMat.name,
            color: srcMat.color ? srcMat.color.clone() : 0xffffff,
            side: THREE.FrontSide,
            envMapIntensity: studioRef.current.env,
            // Keep a baked normal map when the vendor supplied one (that's the
            // cloth-wrinkle detail); otherwise fall back to our knit bump so
            // solid colors still read as fabric, not plastic.
            normalMap: srcMat.normalMap || fabricNormalTexture('sublimated'),
            normalScale: srcMat.normalMap ? (srcMat.normalScale || new THREE.Vector2(1, 1)) : new THREE.Vector2(0.45, 0.45),
            // Fabric sheen (the soft edge glow cloth has at grazing angles) is
            // what separates "jersey" from "painted plastic" at arm's length.
            sheen: studioRef.current.sheen,
            sheenRoughness: 0.7,
            sheenColor: new THREE.Color(0xffffff),
          });
          const zone = matchZone(o.name) || matchZone(o.material && o.material.name);
          st.meshes.push({ mesh: o, zone, vendorNormal: !!srcMat.normalMap });
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
      try { applyDesign(st, spec); updateDecals(st, spec); } catch (e) { /* keep default */ }
      setStatus('ready');
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
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(mount); }
    window.addEventListener('resize', resize);
    resize();

    return () => {
      st.mounted = false;
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      cancelAnimationFrame(st.raf);
      controls.dispose();
      st.decals.forEach((d) => { if (d.material.map) d.material.map.dispose(); d.material.dispose(); d.geometry.dispose(); });
      st.meshes.forEach(({ mesh }) => { const m = mesh.material.map; if (m && !(m.userData && m.userData.shared)) m.dispose(); mesh.material.dispose(); mesh.geometry.dispose(); });
      pmrem.dispose();
      try { gtao.dispose(); composer.dispose(); } catch (e) { /* older three */ }
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [modelUrl]); // eslint-disable-line

  // re-apply on autoRotate toggle
  useEffect(() => { const st = stateRef.current; if (st && st.controls) st.controls.autoRotate = !!autoRotate; }, [autoRotate]);

  // studio profile changes apply to the live scene and persist locally
  useEffect(() => {
    const st = stateRef.current;
    if (st) applyStudioProfile(st, studio);
    saveStudioProfile(studio);
  }, [studio]);

  // re-color on spec change
  useEffect(() => {
    const st = stateRef.current;
    if (st && st.meshes && st.meshes.length) { try { applyDesign(st, spec); updateDecals(st, spec); } catch (e) {} }
  }, [spec]);

  const STUDIO_SLIDERS = [
    ['key', 'Key Light', 0, 2.5, 0.05], ['fill', 'Fill Light', 0, 1.5, 0.02], ['back', 'Back Light', 0, 1.5, 0.02],
    ['hemi', 'Ambient', 0, 1, 0.02], ['exposure', 'Exposure', 0.6, 1.6, 0.02], ['env', 'Reflections', 0, 1, 0.02],
    ['sheen', 'Sheen', 0, 1, 0.02], ['aoRadius', 'Shadow Size', 0.01, 0.25, 0.005], ['aoScale', 'Shadow Strength', 0, 5, 0.1],
    ['bg', 'Backdrop', 0.8, 1, 0.01],
  ];

  return (
    <div ref={mountRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, cursor: 'grab' }}>
      {status === 'loading' && <div style={ovl}>Loading 3D…</div>}
      {status === 'error' && <div style={ovl}>Couldn’t load the 3D model.</div>}
      {status === 'nomodel' && <div style={ovl}>3D preview isn’t available for this garment yet.</div>}
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
