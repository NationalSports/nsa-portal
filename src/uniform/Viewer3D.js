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
import { makePatternTile } from './patterns';
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
    if (pat === 'solid') {
      mat.color.set(color);
    } else if (pat === 'fade') {
      mat.color.set('#ffffff'); mat.map = gradientTexture(color, color2);
    } else {
      const tile = makePatternTile(pat, color, color2);
      if (tile) {
        const tex = new THREE.CanvasTexture(tile);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(entry.zone === 'body' ? 5 : 3, entry.zone === 'body' ? 5 : 3);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.color.set('#ffffff');
      } else { mat.color.set(color); }
    }
    mat.roughness = 0.72; mat.metalness = 0.0;
    mat.needsUpdate = true;
  }
}

export default function Viewer3D({ spec, modelUrl, autoRotate }) {
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
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

    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(1.5, 2.5, 2.5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-2, 0.5, 1); scene.add(fill);

    const st = { renderer, scene, camera, controls, pmrem, meshes: [], raf: 0, mounted: true };
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
      const dist = (maxDim / 2) / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.5;
      camera.position.set(0, size.y * 0.02, dist);
      camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      // Distance limits must scale with the model (units vary per asset), or the
      // camera gets clamped inside the mesh.
      controls.minDistance = dist * 0.35; controls.maxDistance = dist * 4;
      controls.update();

      rootObj.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.side = THREE.FrontSide;
          const zone = matchZone(o.name) || matchZone(o.material && o.material.name);
          st.meshes.push({ mesh: o, zone });
        }
      });
      scene.add(rootObj);
      try { applyDesign(st, spec); } catch (e) { /* keep default */ }
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
    if (st && st.meshes && st.meshes.length) { try { applyDesign(st, spec); } catch (e) {} }
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
