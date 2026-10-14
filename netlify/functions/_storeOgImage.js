// Draws a team store's headline as a 1200×630 link-preview image (iMessage,
// Slack, Facebook…). It mirrors the storefront's "Varsity" hero
// (VsHero in src/storefront/Storefront.js): light hatched panel, the sport or
// mascot word set huge and ghosted in the team color, the team logo in front,
// an accent wedge on the right edge, a dot matrix, and the accent ribbon tab.
//
// Text is drawn as vector outlines from _storeOgGlyphs.json (Barlow Condensed,
// the storefront's display face, SIL OFL — see src/allSchool/assets/
// Barlow-Condensed-OFL.txt). Serverless hosts ship no usable fonts, so relying
// on installed fonts would silently print the words in a fallback face or not
// at all; outlines render the same everywhere.
//
// Pure: takes the store row + logo bytes, returns JPEG bytes. No network.

const sharp = require('sharp');
const GLYPHS = require('./_storeOgGlyphs.json');

const W = 1200;
const H = 630;

// ── Colors ───────────────────────────────────────────────────────────
// HAND-SYNCED with the storefront: darken/luminance/bandColor in
// src/storefront/Storefront.js and contrastRatio/readable in src/lib/a11y.js.
function parseHex(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null;
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => '#' + rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const cleanHex = (hex, fallback) => (parseHex(hex) ? toHex(parseHex(hex)) : fallback);
const darken = (hex, amount) => toHex(parseHex(hex).map((v) => v * (1 - amount)));
const luminance = (hex) => {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
function bandColor(hex) {
  let c = hex;
  for (let i = 0; i < 8 && luminance(c) > 0.26; i++) c = darken(c, 0.18);
  return c;
}
function relLum(hex) {
  const ch = parseHex(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const readableOn = (bg) => (contrast('#FFFFFF', bg) >= contrast('#111111', bg) ? '#FFFFFF' : '#111111');

// ── Names ────────────────────────────────────────────────────────────
// HAND-SYNCED with storeShortName / mascotWord in src/storefront/Storefront.js.
function storeShortName(name) {
  const raw = String(name || '').trim();
  const n = raw
    .replace(/\s+(19|20)\d{2}$/, '')
    .replace(/\s+(team\s+)?(store|shop)$/i, '')
    .replace(/\s+(19|20)\d{2}$/, '')
    .trim();
  return n || raw;
}
function mascotWord(name) {
  const parts = storeShortName(name).split(/\s+/).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : '').toUpperCase();
}

// ── Text → SVG outlines ──────────────────────────────────────────────
// Uppercases, folds accents (É → E), and drops anything the glyph set lacks.
function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split('')
    .filter((ch) => ch === ' ' || GLYPHS.x800.g[ch])
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// Width in px of `text` at `size` px, with `tracking` in em (CSS letter-spacing).
function measure(text, face, size, tracking = 0) {
  const f = GLYPHS[face];
  let units = 0;
  const chars = text.split('');
  chars.forEach((ch, i) => {
    const g = f.g[ch];
    if (!g) return;
    units += g.a;
    if (i < chars.length - 1) units += f.kern[ch + chars[i + 1]] || 0;
  });
  const trackPx = tracking * size * Math.max(0, chars.length - 1);
  return (units / f.upm) * size + trackPx;
}

// SVG <path> for `text` with its baseline at (x, y).
function textPath(text, face, size, x, y, fill, tracking = 0, extra = '') {
  const f = GLYPHS[face];
  const s = size / f.upm;
  const parts = [];
  let pen = 0; // font units
  const chars = text.split('');
  chars.forEach((ch, i) => {
    const g = f.g[ch];
    if (!g) return;
    if (g.d) {
      const tx = (x + pen * s + i * tracking * size).toFixed(2);
      parts.push(`<path transform="translate(${tx} ${y.toFixed(2)}) scale(${s.toFixed(5)})" d="${g.d}"/>`);
    }
    pen += g.a + (i < chars.length - 1 ? f.kern[ch + chars[i + 1]] || 0 : 0);
  });
  return `<g fill="${fill}"${extra}>${parts.join('')}</g>`;
}

// Largest size (≤ maxSize) at which `text` fits in `maxWidth`.
function fitSize(text, face, maxSize, maxWidth, tracking = 0) {
  const w = measure(text, face, maxSize, tracking);
  return w <= maxWidth ? maxSize : Math.floor((maxSize * maxWidth) / w);
}

const capHeight = (face, size) => (GLYPHS[face].cap / GLYPHS[face].upm) * size;

// "Sun, Oct 25" in Pacific time — stores close at 11:59 PM PT, so a UTC date
// would read a day late.
function closeLabel(closeAt) {
  if (!closeAt) return '';
  const d = new Date(closeAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });
}

// Background + ghost word + ribbon + bottom band. The logo is composited on top
// separately (sharp) so its own pixels are never re-encoded through SVG.
function heroSvg({ name, band, accent, word, closeAt, open }) {
  const short = normalizeText(storeShortName(name));
  const ribbonText = normalizeText(`The official ${storeShortName(name)} team store`);
  const ghost = normalizeText(word);

  const BAND_H = 64; // bottom team-color band (the storefront's marquee strip)
  const bodyTop = 96;
  const bodyBottom = H - BAND_H;
  const bodyMid = (bodyTop + bodyBottom) / 2;

  // Ghost word: as large as fits (storefront caps it at 340px), centered on the body.
  const ghostSize = Math.min(330, fitSize(ghost, 'x800', 330, W - 120, -0.01));
  const ghostW = measure(ghost, 'x800', ghostSize, -0.01);
  const ghostBase = bodyMid + capHeight('x800', ghostSize) / 2;

  // Ribbon: accent tab top-left, skewed -6°, text fitted to the space left of the wedge.
  const rPadX = 28;
  const rSize = fitSize(ribbonText, 'x700', 27, W * 0.85 - 40 - rPadX * 2, 0.14);
  const rTextW = measure(ribbonText, 'x700', rSize, 0.14);
  const rH = Math.round(rSize * 1.9);
  const rX = 40;
  const rY = 30;
  const ribbonInk = readableOn(accent);

  // Bottom band: "Order by Sun, Oct 25" while open, otherwise the team name.
  const close = closeLabel(closeAt);
  const bandMsg = normalizeText(open && close ? `Order by ${close}` : `${short} team store`);
  const bSize = fitSize(bandMsg, 'x800', 30, W - 200, 0.05);
  const bW = measure(bandMsg, 'x800', bSize, 0.05);
  const starSize = bSize * 0.8;
  const bBase = bodyBottom + 4 + (BAND_H - 4) / 2 + capHeight('x800', bSize) / 2;
  const bX = (W - bW) / 2;
  const starInk = contrast(accent, band) >= 3 ? accent : readableOn(band);
  const star = (cx) => {
    const r = starSize / 2, pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(bBase - capHeight('x800', bSize) / 2 + rr * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${starInk}"/>`;
  };

  // Edge shapes from the storefront's CSS clip-paths (15% wide each side).
  const edgeW = W * 0.15;
  const leftPts = [[0, 0], [0.88, 0], [1, 0.08], [0.9, 0.22], [1, 0.4], [0.88, 0.58], [1, 0.74], [0.9, 0.9], [1, 1], [0, 1]]
    .map(([x, y]) => `${(x * edgeW).toFixed(1)},${(y * bodyBottom).toFixed(1)}`).join(' ');
  const rightPts = [[0.12, 0], [1, 0], [1, 1], [0.1, 1], [0, 0.88], [0.12, 0.74], [0, 0.58], [0.12, 0.4], [0, 0.22], [0.12, 0.08]]
    .map(([x, y]) => `${(W - edgeW + x * edgeW).toFixed(1)},${(y * bodyBottom).toFixed(1)}`).join(' ');

  const [ar, ag, ab] = parseHex(accent);
  const [br, bg, bb] = parseHex(band);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="hatch" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="2" height="11" fill="rgb(20,32,26)" fill-opacity="0.05"/>
    </pattern>
    <pattern id="hatchDark" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="3" height="12" fill="rgb(20,32,26)" fill-opacity="0.14"/>
    </pattern>
    <pattern id="dots" width="15" height="15" patternUnits="userSpaceOnUse">
      <circle cx="1.6" cy="1.6" r="1.6" fill="rgb(${ar},${ag},${ab})" fill-opacity="0.55"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#F7F8FB"/>
  <rect width="${W}" height="${bodyBottom}" fill="url(#hatch)"/>
  <polygon points="${leftPts}" fill="url(#hatchDark)"/>
  <polygon points="${rightPts}" fill="${accent}" fill-opacity="0.9"/>
  <rect x="${W * 0.82 - 180}" y="${Math.round(H * 0.14)}" width="180" height="200" fill="url(#dots)"/>
  ${textPath(ghost, 'x800', ghostSize, (W - ghostW) / 2, ghostBase, `rgb(${br},${bg},${bb})`, -0.01, ' fill-opacity="0.28"')}
  <g transform="translate(${rX} ${rY}) skewX(-6)">
    <rect width="${(rTextW + rPadX * 2).toFixed(1)}" height="${rH}" fill="${accent}"/>
    ${textPath(ribbonText, 'x700', rSize, rPadX, rH / 2 + capHeight('x700', rSize) / 2, ribbonInk, 0.14)}
  </g>
  <rect y="${bodyBottom}" width="${W}" height="${BAND_H}" fill="${band}"/>
  <rect y="${bodyBottom}" width="${W}" height="4" fill="${accent}"/>
  ${star(bX - 18 - starSize / 2)}
  ${textPath(bandMsg, 'x800', bSize, bX, bBase, '#FFFFFF', 0.05)}
  ${star(bX + bW + 18 + starSize / 2)}
</svg>`;
}

// Team logo, fitted into a square box, with the storefront's soft team-color
// drop shadow (0 9px 12px band @ 34%).
async function logoLayers(logoBytes, band, box, centerX, centerY) {
  const logo = await sharp(logoBytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize(box, box, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = logo.info;
  const left = Math.round(centerX - width / 2);
  const top = Math.round(centerY - height / 2);

  // Shadow = the logo's alpha channel, filled with the band color, blurred.
  const [r, g, b] = parseHex(band);
  const pad = 30;
  const alpha = await sharp(logo.data).extractChannel('alpha').linear(0.34, 0).toBuffer();
  const shadow = await sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .joinChannel(alpha)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(8)
    .png()
    .toBuffer();
  return [
    { input: shadow, left: left - pad, top: top - pad + 9 },
    { input: logo.data, left, top },
  ];
}

// Fallback crest when a store has no logo: team-color shield with initials.
function crestSvg(name, band, accent, size) {
  const words = storeShortName(name).split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const initials = normalizeText(words.slice(0, 3).map((w) => w[0]).join('')) || 'NSA';
  const tSize = fitSize(initials, 'x800', size * 0.42, size * 0.62, 0.02);
  const tW = measure(initials, 'x800', tSize, 0.02);
  const base = size * 0.5 + capHeight('x800', tSize) / 2;
  const s = size;
  const shield = `M${s * 0.5},${s * 0.04} L${s * 0.9},${s * 0.16} L${s * 0.88},${s * 0.56} C${s * 0.86},${s * 0.78} ${s * 0.7},${s * 0.9} ${s * 0.5},${s * 0.97} C${s * 0.3},${s * 0.9} ${s * 0.14},${s * 0.78} ${s * 0.12},${s * 0.56} L${s * 0.1},${s * 0.16} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><path d="${shield}" fill="${band}" stroke="${accent}" stroke-width="${s * 0.035}"/>${textPath(initials, 'x800', tSize, (s - tW) / 2, base, '#FFFFFF', 0.02)}</svg>`;
}

/**
 * @param {object} store  webstores row: name, primary_color, accent_color, close_at, status
 * @param {Buffer|null} logoBytes  the store logo (any format sharp reads), or null
 * @returns {Promise<Buffer>} JPEG, 1200×630
 */
async function renderStoreOgImage(store, logoBytes) {
  const primary = cleanHex(store.primary_color, '#8C1D40');
  const accent = cleanHex(store.accent_color, '#B6985A');
  const band = bandColor(primary);
  const word = mascotWord(store.name) || 'TEAM';
  const svg = heroSvg({
    name: store.name || 'Team Store',
    band,
    accent,
    word,
    closeAt: store.close_at,
    open: store.status === 'open',
  });

  const BOX = 360;
  const cx = W / 2;
  const cy = (96 + (H - 64)) / 2 + 12;
  let layers = [];
  if (logoBytes) {
    try {
      layers = await logoLayers(logoBytes, band, BOX, cx, cy);
    } catch {
      layers = []; // unreadable logo → crest below
    }
  }
  if (!layers.length) {
    const crest = Buffer.from(crestSvg(store.name, band, accent, 300));
    layers = [{ input: crest, left: Math.round(cx - 150), top: Math.round(cy - 150) }];
  }

  return sharp(Buffer.from(svg))
    .composite(layers)
    .flatten({ background: '#F7F8FB' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

module.exports = { renderStoreOgImage, storeShortName, mascotWord, closeLabel, normalizeText };
