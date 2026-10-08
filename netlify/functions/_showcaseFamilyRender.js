const sharp = require('sharp');
const clamp = (x, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, x));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function pixels(bytes) {
  return sharp(bytes, { limitInputPixels: 40000000 }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function rect(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) throw new Error('Invalid fabric sampling rectangle');
  const [x, y, w, h] = value;
  if (x < 0 || y < 0 || w < .01 || h < .01 || w > .3 || h > .3 || x + w > 1 || y + h > 1) throw new Error('Fabric sampling rectangle is outside its supplier photo');
  return value;
}
async function sampleFabric(bytes, patches, texture = 'solid') {
  if (!Array.isArray(patches) || patches.length < 2 || patches.length > 8) throw new Error('At least two clean fabric samples are required');
  const { data, info: { width, height } } = await pixels(bytes);
  const samples = [];
  for (const patch of patches) {
    const [x, y, w, h] = rect(patch);
    for (let py = Math.floor(y * height); py < (y + h) * height; py++) {
      for (let px = Math.floor(x * width); px < (x + w) * width; px++) {
        const i = (py * width + px) * 4;
        if (data[i + 3] > 240) samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  if (samples.length < 50) throw new Error('Supplier fabric samples are too small');
  // Trim shadows and highlights within the selected fabric patches. Never use a
  // color-name lookup or average the whole photo (which includes the backdrop).
  samples.sort((a, b) => a.reduce((v, c) => v + c, 0) - b.reduce((v, c) => v + c, 0));
  const mid = samples.slice(Math.floor(samples.length * .2), Math.ceil(samples.length * .8));
  const result = { rgb: [0, 1, 2].map((c) => median(mid.map((p) => p[c]))), pixels: samples.length, patches };
  if (texture === 'heather') {
    const [x,y,w,h] = rect(patches[0]);
    const tile = await sharp(bytes).rotate().extract({left:Math.floor(x*width),top:Math.floor(y*height),width:Math.floor(w*width),height:Math.floor(h*height)}).resize(64,64).greyscale().raw().toBuffer();
    const smooth = await sharp(tile,{raw:{width:64,height:64,channels:1}}).blur(2).raw().toBuffer();
    // Actual small-scale supplier texture, with lighting removed. Mirrored
    // tiling avoids a repeating hard seam; master folds still provide shading.
    result.grain = Array.from(tile,(v,i)=>clamp(v-smooth[i],-35,35));
  }
  return result;
}
function inside(x, y, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = polygon[i], [c, d] = polygon[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) yes = !yes;
  }
  return yes;
}
function polygons(value) {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid protected garment regions');
  for (const p of value) if (!Array.isArray(p) || p.length < 3 || p.length > 30 || p.some((xy) => !Array.isArray(xy) || xy.length !== 2 || xy.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Invalid garment region coordinates');
  return value;
}
async function prepareMaster(bytes, layout) {
  const { data, info } = await pixels(bytes);
  const protectedRegions = polygons(layout.protected_regions);
  const occluders = polygons(layout.logo_occluders);
  const mask = new Float32Array(info.width * info.height);
  const light = [];
  for (let i = 0; i < mask.length; i++) {
    const [r, g, b] = data.subarray(i * 4, i * 4 + 3);
    // Master cloth is deliberately green; protected labels, marks, hardware,
    // white background and its neutral grounding shadow remain unchanged.
    // Do not freeze entire QA polygons: their fabric margins would retain a
    // green halo. Neutral/other-hue marks are protected by pixel classification;
    // polygons separately prevent artwork from covering manufacturer details.
    if (g > r + 6 && g > b + 6 && g > 12) {
      mask[i] = clamp((g - Math.max(r, b)) / 25, 0, 1);
      light.push(g);
    }
  }
  const coverage = light.length / mask.length;
  if (coverage < .12 || coverage > .8) throw new Error('Master fabric mask needs correction; generate a new base');
  return { data, info, mask, median: median(light), occluders, protectedRegions };
}
function recolor(master, rgb, grain) {
  const out = Buffer.from(master.data);
  for (let i = 0; i < master.mask.length; i++) {
    if (!master.mask[i]) continue;
    const shade = master.data[i * 4 + 1] / master.median;
    for (let c = 0; c < 3; c++) {
      // Keep black readable without raising it to gray; preserve highlights and
      // folds for white instead of clipping every lit pixel to white.
      const base = rgb[c];
      let value = shade <= 1 ? base * Math.pow(shade, .85) : base + (255 - base) * (1 - Math.exp(-(shade - 1) * 1.8));
      if (grain?.length === 4096) {
        const mirror = (n) => n % 128 < 64 ? n % 128 : 127 - n % 128;
        value += grain[mirror(Math.floor(i/master.info.width))*64+mirror(i%master.info.width)] * Math.min(1,shade);
      }
      out[i * 4 + c] = Math.round(clamp(value * master.mask[i] + Math.min(master.data[i*4],master.data[i*4+2]) * (1-master.mask[i])));
    }
  }
  return out;
}
function validateQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) throw new Error('Missing mapped artwork placement');
  polygons([quad]);
  const [a,b,c,d] = quad;
  if (b[0] <= a[0] || c[0] <= d[0] || d[1] <= a[1] || c[1] <= b[1]) throw new Error('Artwork placement is reversed');
  if (Math.max(...quad.map((p) => p[0])) - Math.min(...quad.map((p) => p[0])) > .65) throw new Error('Artwork placement is too large');
  return quad;
}
async function validateArtwork(bytes) {
  const logo = await pixels(bytes);
  if (!logo.data.some((alpha, i) => i % 4 === 3 && alpha < 20)) throw new Error('A transparent logo file is required for shared-base rendering');
  return logo;
}
async function applyArtwork(output, master, bytes, quad, finish, options = {}) {
  validateQuad(quad);
  const logo = await validateArtwork(bytes);
  if (options.fitSquare) {
    const ratio = logo.info.height / logo.info.width;
    const midLeft = [(quad[0][0]+quad[3][0])/2,(quad[0][1]+quad[3][1])/2];
    const midRight = [(quad[1][0]+quad[2][0])/2,(quad[1][1]+quad[2][1])/2];
    quad = quad.map((p,i)=>{const mid=[0,3].includes(i)?midLeft:midRight;return p.map((v,c)=>mid[c]+(v-mid[c])*ratio);});
    validateQuad(quad);
  }
  const { width, height } = master.info;
  const blocked = [...master.occluders,...master.protectedRegions];
  const [tl, tr, br, bl] = quad.map(([x,y]) => [x * width, y * height]);
  const minY = Math.max(0, Math.floor(Math.min(tl[1],tr[1]))), maxY = Math.min(height,Math.ceil(Math.max(bl[1],br[1])));
  const minX = Math.max(0, Math.floor(Math.min(tl[0],bl[0]))), maxX = Math.min(width,Math.ceil(Math.max(tr[0],br[0])));
  let applied = 0;
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    const idx = y * width + x;
    if (!master.mask[idx] || blocked.some((p) => inside(x / width,y / height,p))) continue;
    // Invert the bilinear quad by Newton iterations; artwork follows the mapped
    // garment plane, with the same coordinates for every logo/color variant.
    let u = .5, v = .5;
    for (let k = 0; k < 6; k++) {
      const ex = tl[0]*(1-u)*(1-v)+tr[0]*u*(1-v)+bl[0]*(1-u)*v+br[0]*u*v-x;
      const ey = tl[1]*(1-u)*(1-v)+tr[1]*u*(1-v)+bl[1]*(1-u)*v+br[1]*u*v-y;
      const ax = (tr[0]-tl[0])*(1-v)+(br[0]-bl[0])*v, ay = (tr[1]-tl[1])*(1-v)+(br[1]-bl[1])*v;
      const bx = (bl[0]-tl[0])*(1-u)+(br[0]-tr[0])*u, by = (bl[1]-tl[1])*(1-u)+(br[1]-tr[1])*u;
      const det = ax*by-ay*bx;
      if (Math.abs(det)<.01) throw new Error('Artwork placement has no area');
      u -= (ex*by-ey*bx)/det; v -= (ey*ax-ex*ay)/det;
    }
    if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
    const li = (Math.floor(v*logo.info.height)*logo.info.width+Math.floor(u*logo.info.width))*4;
    const alpha = logo.data[li+3]/255;
    if (!alpha) continue;
    const shade = clamp(master.data[idx*4+1]/master.median,.65,1.15);
    const texture = finish === 'embroidery' ? 1 + .035*Math.sin((x+y)*2)
      : finish === 'chenille' ? 1 + .045*Math.sin(x*12.9898+y*78.233)
      : finish === 'tackle_twill' ? 1 + .02*Math.sin(x*2)*Math.sin(y*2) : 1;
    for (let c = 0; c < 3; c++) output[idx*4+c] = Math.round(clamp(output[idx*4+c]*(1-alpha)+logo.data[li+c]*shade*texture*alpha));
    applied++;
  }
  if (applied < 30) throw new Error('Artwork did not land on the garment; check its placement');
}
async function encode(output, master) { return sharp(output,{ raw: master.info }).png().toBuffer(); }
module.exports = { validateArtwork,sampleFabric, prepareMaster, recolor, applyArtwork, encode, validateQuad };
