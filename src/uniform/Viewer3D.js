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
import { makePatternTile } from './patterns';
import { fontShorthand } from './fonts';
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

// Procedural knit normal map: fine grain + a soft vertical rib, tiled across
// the garment. Vendor models without a baked normal map (CLO exports ship
// none) render as smooth plastic without this — the micro-bump is what makes
// a solid color read as fabric.
let _knitNormal = null;
function knitNormalTexture() {
  if (_knitNormal) return _knitNormal;
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const img = x.createImageData(S, S);
  const d = img.data;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = (py * S + px) * 4;
      const rib = Math.sin((px / S) * Math.PI * 16) * 14;           // vertical knit ribs
      const grainX = (Math.sin(px * 12.9898 + py * 78.233) * 43758.5453 % 1) * 24 - 12; // hash noise
      const grainY = (Math.sin(px * 39.346 + py * 11.135) * 24634.6345 % 1) * 24 - 12;
      d[i] = Math.max(0, Math.min(255, 128 + rib + grainX));
      d[i + 1] = Math.max(0, Math.min(255, 128 + grainY));
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  _knitNormal = t;
  return t;
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
    if (mat.map) { mat.map.dispose(); mat.map = null; }
    if (pat === 'custom' && zs.patternImage) {
      // Admin-library print pattern: image tile loads async; a generation token
      // drops stale loads if the design changed again before the image decoded.
      const gen = (entry._patGen = (entry._patGen || 0) + 1);
      mat.color.set(color); // flat placeholder while the tile decodes
      new THREE.TextureLoader().load(zs.patternImage, (tex) => {
        if (entry._patGen !== gen || !entry.mesh.material) return;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const rep = entry.zone === 'body' ? 4 : 2.5;
        tex.repeat.set(rep, rep);
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = entry.mesh.material;
        if (m.map) m.map.dispose();
        m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
      });
    } else if (pat === 'solid') {
      entry._patGen = (entry._patGen || 0) + 1; // invalidate in-flight custom tiles
      mat.color.set(color);
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
    // Fabric choice reads as sheen: gloss is noticeably shinier, matte knit
    // flatter. (2D renderers carry the texture side of the fabric look.)
    const FABRIC_ROUGHNESS = { matte: 0.88, mesh: 0.8, heather: 0.82, sublimated: 0.72, gloss: 0.5 };
    mat.roughness = FABRIC_ROUGHNESS[spec.fabric] || 0.72;
    mat.metalness = 0.0;
    mat.needsUpdate = true;
  }
}

// Render a text element to a transparent canvas for use as a decal texture.
function decalTextCanvas(el) {
  const val = (el.value || '').trim();
  if (!val) return null;
  const S = 220;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = fontShorthand(el.font, S);
  const tw = Math.ceil(meas.measureText(val).width);
  const pad = Math.ceil(S * 0.4);
  const c = document.createElement('canvas');
  c.width = Math.max(8, tw + pad * 2); c.height = Math.ceil(S * 1.5);
  const x = c.getContext('2d');
  x.font = fontShorthand(el.font, S);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  const fill = ds.toHex(el.fill, '#ffffff');
  let outline = el.outline === 'auto' ? ds.contrastInk(fill) : el.outline;
  if (outline && outline !== 'none' && el.outlineWidth > 0) {
    x.strokeStyle = ds.toHex(outline, '#111827');
    x.lineWidth = el.outlineWidth * (S / 24);
    x.strokeText(val, c.width / 2, c.height / 2);
  }
  x.fillStyle = fill; x.fillText(val, c.width / 2, c.height / 2);
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
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(32, W / H, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.autoRotate = !!autoRotate; controls.autoRotateSpeed = 1.1;

    const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(1.5, 2.5, 2.5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-2, 0.5, 1); scene.add(fill);
    // Rear light + even hemisphere fill so the BACK of the garment reads its true
    // colorway (orbit moves the camera, not the model, so front-only lights leave
    // the back in shadow — whites go gray, blues muddy).
    const back = new THREE.DirectionalLight(0xffffff, 0.7); back.position.set(-1, 1.5, -2.5); scene.add(back);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xbfc4cc, 0.55); scene.add(hemi);

    const st = { renderer, scene, camera, controls, pmrem, meshes: [], decals: [], bodyMesh: null, modelSize: null, raf: 0, mounted: true };
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
          o.material = new THREE.MeshStandardMaterial({
            name: srcMat.name,
            color: srcMat.color ? srcMat.color.clone() : 0xffffff,
            side: THREE.FrontSide,
            envMapIntensity: 0.35,
            // Keep a baked normal map when the vendor supplied one (that's the
            // cloth-wrinkle detail); otherwise fall back to our knit bump so
            // solid colors still read as fabric, not plastic.
            normalMap: srcMat.normalMap || knitNormalTexture(),
            normalScale: srcMat.normalMap ? (srcMat.normalScale || new THREE.Vector2(1, 1)) : new THREE.Vector2(0.55, 0.55),
          });
          const zone = matchZone(o.name) || matchZone(o.material && o.material.name);
          st.meshes.push({ mesh: o, zone });
        }
      });
      scene.add(rootObj);
      scene.updateMatrixWorld(true);
      st.bodyMesh = (st.meshes.find((m) => m.zone === 'body') || st.meshes[0] || {}).mesh || null;
      st.modelRoot = rootObj;
      st.modelSize = size.clone();
      try { applyDesign(st, spec); updateDecals(st, spec); } catch (e) { /* keep default */ }
      setStatus('ready');
      draco.dispose();
    }, undefined, () => { setStatus('error'); });

    const animate = () => { st.raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    // Keep the drawing buffer synced to the container (ResizeObserver catches the
    // lazy/Suspense mount where the container starts at 0×0; window 'resize' won't).
    const resize = () => {
      if (!st.mounted) return;
      const w = mount.clientWidth || W, h = mount.clientHeight || H;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h, false);
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
      st.meshes.forEach(({ mesh }) => { if (mesh.material.map) mesh.material.map.dispose(); mesh.material.dispose(); mesh.geometry.dispose(); });
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [modelUrl]); // eslint-disable-line

  // re-apply on autoRotate toggle
  useEffect(() => { const st = stateRef.current; if (st && st.controls) st.controls.autoRotate = !!autoRotate; }, [autoRotate]);

  // re-color on spec change
  useEffect(() => {
    const st = stateRef.current;
    if (st && st.meshes && st.meshes.length) { try { applyDesign(st, spec); updateDecals(st, spec); } catch (e) {} }
  }, [spec]);

  return (
    <div ref={mountRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, cursor: 'grab' }}>
      {status === 'loading' && <div style={ovl}>Loading 3D…</div>}
      {status === 'error' && <div style={ovl}>Couldn’t load the 3D model.</div>}
      {status === 'nomodel' && <div style={ovl}>3D preview isn’t available for this garment yet.</div>}
    </div>
  );
}

const ovl = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5A6075', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 14, pointerEvents: 'none' };
