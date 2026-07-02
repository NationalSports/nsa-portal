// Uniform Builder — one pattern generator, two consumers.
//
// Every non-solid pattern is drawn once into a small offscreen <canvas> tile.
// That single tile then feeds BOTH renderers with no duplicated pattern math:
//   • the SVG editor embeds `tile.toDataURL()` inside <pattern><image/></pattern>
//   • the Canvas 2D exporter passes the tile to ctx.createPattern(tile,'repeat')
// So "how a stripe looks" is defined in exactly one place.
//
// `fade` and `solid` intentionally return no tile: they're a flat fill / linear
// gradient that each renderer applies directly (a gradient can't tile).

// Deterministic tiny PRNG so camo/heather look organic but render identically
// every time (important: the production PNG must match the on-screen preview).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newTile(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

// Returns an HTMLCanvasElement tile for the pattern, or null when the pattern is
// a flat fill / gradient the renderer handles itself. `a` is the zone's primary
// color, `b` its secondary (pattern) color.
export function makePatternTile(pattern, a, b) {
  a = a || '#1f2a44';
  b = b || '#ffffff';
  switch (pattern) {
    case 'stripes': return stripes(a, b, 24, 12);
    case 'boldstripe': return stripes(a, b, 120, 60);
    case 'pinstripe': return stripes(a, b, 20, 3);
    case 'chevron': return chevron(a, b);
    case 'dots': return dots(a, b);
    case 'camo': return camo(a, b);
    case 'digicamo': return digicamo(a, b);
    case 'carbon': return carbon(a, b);
    case 'hex': return hexMesh(a, b);
    default: return null; // solid, fade
  }
}

function stripes(a, b, period, band) {
  const c = newTile(period); const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, period, period);
  x.fillStyle = b; x.fillRect(0, 0, band, period);
  return c;
}

function chevron(a, b) {
  const s = 40; const c = newTile(s); const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, s, s);
  x.strokeStyle = b; x.lineWidth = 7; x.lineJoin = 'miter';
  for (let off = -s; off <= s; off += 20) {
    x.beginPath();
    x.moveTo(0 + off, s); x.lineTo(s / 2 + off, 0); x.lineTo(s + off, s);
    x.stroke();
  }
  return c;
}

function dots(a, b) {
  const s = 26; const c = newTile(s); const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, s, s);
  x.fillStyle = b;
  for (const [cx, cy] of [[7, 7], [20, 20]]) {
    x.beginPath(); x.arc(cx, cy, 4, 0, Math.PI * 2); x.fill();
  }
  return c;
}

function camo(a, b) {
  const s = 120; const c = newTile(s); const x = c.getContext('2d');
  const rnd = mulberry32(1337);
  // Two darker/lighter siblings of the two colors give a 4-tone camo.
  const tones = [a, b, mix(a, '#000000', 0.35), mix(b, '#000000', 0.25)];
  x.fillStyle = tones[0]; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 22; i++) {
    x.fillStyle = tones[1 + (i % 3)];
    const cx = rnd() * s, cy = rnd() * s, r = 10 + rnd() * 22;
    x.beginPath();
    // Wobbly blob so it reads organic, not like polka dots.
    for (let t = 0; t <= Math.PI * 2 + 0.01; t += Math.PI / 6) {
      const rr = r * (0.7 + rnd() * 0.6);
      const px = cx + Math.cos(t) * rr, py = cy + Math.sin(t) * rr;
      t === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  }
  return c;
}

function digicamo(a, b) {
  const s = 96; const px = 8; const c = newTile(s); const x = c.getContext('2d');
  const rnd = mulberry32(4242);
  const tones = [a, mix(a, '#000000', 0.3), b, mix(b, '#000000', 0.2)];
  for (let yy = 0; yy < s; yy += px) {
    for (let xx = 0; xx < s; xx += px) {
      x.fillStyle = tones[Math.floor(rnd() * tones.length)];
      x.fillRect(xx, yy, px, px);
    }
  }
  return c;
}

function carbon(a, b) {
  const s = 16; const c = newTile(s); const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, s, s);
  x.fillStyle = mix(a, b, 0.5);
  x.fillRect(0, 0, s / 2, s / 2); x.fillRect(s / 2, s / 2, s / 2, s / 2);
  x.fillStyle = mix(a, '#000', 0.25);
  x.fillRect(s / 2, 0, s / 2, s / 2); x.fillRect(0, s / 2, s / 2, s / 2);
  return c;
}

function hexMesh(a, b) {
  const s = 34; const c = newTile(s); const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, s, s);
  x.strokeStyle = mix(a, b, 0.4); x.lineWidth = 1.5;
  const drawHex = (cx, cy, r) => {
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i - Math.PI / 6;
      const pxp = cx + Math.cos(ang) * r, pyp = cy + Math.sin(ang) * r;
      i === 0 ? x.moveTo(pxp, pyp) : x.lineTo(pxp, pyp);
    }
    x.closePath(); x.stroke();
  };
  drawHex(s / 2, s / 2, 9); drawHex(0, 0, 9); drawHex(s, 0, 9); drawHex(0, s, 9); drawHex(s, s, 9);
  return c;
}

// A translucent surface-texture tile multiplied over a zone to suggest the
// fabric. Returns null for smooth fabrics the renderer leaves flat.
export function makeFabricOverlay(fabric) {
  switch (fabric) {
    case 'mesh': {
      const s = 6; const c = newTile(s); const x = c.getContext('2d');
      x.clearRect(0, 0, s, s);
      x.fillStyle = 'rgba(0,0,0,0.10)';
      x.beginPath(); x.arc(3, 3, 1.4, 0, Math.PI * 2); x.fill();
      return c;
    }
    case 'heather': {
      const s = 48; const c = newTile(s); const x = c.getContext('2d');
      const rnd = mulberry32(99);
      for (let i = 0; i < 240; i++) {
        x.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        x.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
      return c;
    }
    default: return null; // matte, sublimated, gloss (gloss = highlight, done in renderer)
  }
}

// Linear blend of two hex colors. `t=0` → a, `t=1` → b.
export function mix(a, b, t) {
  const pa = hx(a), pb = hx(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hx(h) {
  const m = String(h || '#000000').replace('#', '').match(/.{2}/g) || ['00', '00', '00'];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

// ── tintable print tiles ─────────────────────────────────────────────────────
// Recolor a library tile with the team's colors. Two modes:
//   'solid' — 3-slot mapping: near-neutral pixels split by luminance (light →
//             color1/primary, dark → color2/secondary); saturated pixels (the
//             designer uses pure red) → color3/accent. Every pixel snaps to
//             exactly ONE team color — crisp separations, no blending.
//   'blend' — grayscale luminance lerp color2→color1 (tonal/smoke art).
// Cached per (src, mode, colors); alpha preserved.
const _tintCache = new Map();
export function tintedTile(img, src, color1, color2, color3, mode) {
  const m = mode === 'blend' ? 'blend' : 'solid';
  const c3 = color3 || '#ffffff';
  const key = src + '|' + m + '|' + color1 + '|' + color2 + '|' + c3;
  if (_tintCache.has(key)) return _tintCache.get(key);
  const w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const A = hx(color1), B = hx(color2), C3 = hx(c3);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (m === 'solid') {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      // saturation → accent slot; neutrals split on luminance. AA fringes
      // between white/black stay neutral, so no accent halos.
      const S = sat > 60 ? C3 : (lum >= 128 ? A : B);
      d[i] = S[0]; d[i + 1] = S[1]; d[i + 2] = S[2];
    } else {
      const t = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      d[i] = Math.round(B[0] + (A[0] - B[0]) * t);
      d[i + 1] = Math.round(B[1] + (A[1] - B[1]) * t);
      d[i + 2] = Math.round(B[2] + (A[2] - B[2]) * t);
    }
  }
  x.putImageData(id, 0, 0);
  if (_tintCache.size > 60) _tintCache.clear();
  _tintCache.set(key, c);
  return c;
}
