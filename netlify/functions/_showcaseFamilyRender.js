const sharp = require('sharp');
const clamp = (x, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, x));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Match the placement editor's contain-fitted 4:5 coordinate frame exactly.
async function placementReference(bytes, placements = []) {
  const framed = await sharp(bytes, { limitInputPixels: 40000000 }).rotate()
    .resize(1000, 1250, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  if (!placements.length) return framed;
  const guides = placements.map(([id, p]) => {
    if (![p.x,p.y,p.w].every(Number.isFinite) || p.w <= 0 || p.w > 100 || p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) throw new Error('Invalid saved logo placement');
    const x=p.x*10, y=p.y*12.5, w=p.w*10;
    const label=String(id).replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
    return `<rect x="${x-w/2}" y="${y-w/2}" width="${w}" height="${w}" fill="none" stroke="#ff00ff" stroke-width="3"/><path d="M${x-8},${y}h16 M${x},${y-8}v16" stroke="#ff00ff" stroke-width="2"/><text x="${x-w/2}" y="${y-w/2-6}" fill="#aa00aa" font-size="18">${label}</text>`;
  }).join('');
  return sharp(framed).composite([{input:Buffer.from(`<svg width="1000" height="1250">${guides}</svg>`)}]).png().toBuffer();
}
async function pixels(bytes) {
  return sharp(bytes, { limitInputPixels: 40000000 }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function rect(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) throw new Error('Invalid fabric sampling rectangle');
  const [x, y, w, h] = value;
  if (x < 0 || y < 0 || w < .01 || h < .01 || w > .3 || h > .3 || x + w > 1 || y + h > 1) throw new Error('Fabric sampling rectangle is outside its supplier photo');
  return value;
}
async function sampleFabric(bytes, patches, texture = 'solid', colorway = '') {
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
  // A heather color name is supporting evidence, never a replacement RGB value.
  if (/\bheather(?:ed)?\b|\bmarled\b/i.test(colorway)) texture = 'heather';
  const result = { texture, colorway, rgb: [0, 1, 2].map((c) => median(mid.map((p) => p[c]))), pixels: samples.length, patches };
  if (texture === 'heather') {
    // Average the retained yarn tones rather than choosing the dark median.
    // Keep the same outlier trim so stray background pixels cannot wash it out.
    result.rgb = [0,1,2].map(c => Math.round(mid.reduce((sum,p) => sum+p[c],0)/mid.length));
    const [x,y,w,h] = rect(patches[0]);
    const tw = Math.min(64,Math.floor(w*width)), th = Math.min(64,Math.floor(h*height));
    // Crop at native resolution: shrinking an entire patch averages the light
    // and dark yarn together and turns black heather into nearly solid black.
    const tile = await sharp(bytes).rotate().extract({left:Math.floor(x*width),top:Math.floor(y*height),width:tw,height:th}).resize(64,64).greyscale().raw().toBuffer();
    const smooth = await sharp(tile,{raw:{width:64,height:64,channels:1}}).blur(2).greyscale().raw().toBuffer();
    // Sharp expands a one-channel raw input to RGB unless explicitly converted
    // back to greyscale. Subtracting RGB bytes by pixel index creates false bands.
    if (smooth.length !== tile.length) throw new Error('Fabric texture channel mismatch');
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
  for (const p of value) if (!Array.isArray(p) || p.length < 3 || p.length > 80 || p.some((xy) => !Array.isArray(xy) || xy.length !== 2 || xy.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Invalid garment region coordinates');
  return value;
}
// Drawstrings are traced as narrow variable-width paths, not bounding boxes.
// Reject broad or sparse traces rather than deleting an arbitrary strip of logo.
function validateStrands(value = []) {
  if (!Array.isArray(value) || value.length > 12) throw new Error('Invalid drawstring paths');
  for (const [index,strand] of value.entries()) {
    if (!Array.isArray(strand?.points) || strand.points.length < 3 || strand.points.length > 80)
      throw new Error(`Drawstring trace ${index+1}: provide 3–80 centerline points`);
    strand.points = strand.points.map((p, j) => {
      const raw = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x,p.y,p.width] : [];
      const point = raw.map(v => typeof v === 'string' && v.trim() ? Number(v) : v);
      if (point.length !== 3 || point.some(v => !Number.isFinite(v))) throw new Error(`Drawstring trace ${index+1}, point ${j+1}: expected numeric [x,y,width]`);
      if (point[0]<0 || point[0]>1 || point[1]<0 || point[1]>1) throw new Error(`Drawstring trace ${index+1}, point ${j+1}: x/y must be normalized 0..1`);
      if (point[2]<=0 || point[2]>.025) throw new Error(`Drawstring trace ${index+1}, point ${j+1}: width ${point[2]} must be actual narrow strand width, greater than 0 and at most 0.025 of image width; exclude shadows and surrounding fabric`);
      return point;
    });
  }
  return value;
}
function strandCoverage(x, y, strands, width, height) {
  let coverage = 0;
  for (const { points } of strands) for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    const ax = a[0]*width, ay = a[1]*height, dx = (b[0]-a[0])*width, dy = (b[1]-a[1])*height;
    const t = clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy || 1),0,1);
    const radius = (a[2]*(1-t)+b[2]*t)*width/2;
    coverage = Math.max(coverage,clamp(radius + .5 - Math.hypot(x-ax-t*dx,y-ay-t*dy),0,1));
  }
  return coverage;
}
function normalizeRegions(value) {
  if (!Array.isArray(value)) throw new Error('protected_regions must be an array of polygons');
  const number = v => typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  const normalized = value.map(p => {
    if (!Array.isArray(p)) throw new Error('Each protected region must be an array of [x,y] points');
    return p.map(point => {
      if (Array.isArray(point) && point.length === 2) return point.map(number);
      if (point && !Array.isArray(point) && typeof point === 'object' && 'x' in point && 'y' in point) return [number(point.x),number(point.y)];
      throw new Error('Each protected region point must contain exactly x and y');
    });
  });
  return polygons(normalized);
}

async function prepareMaster(bytes, layout, resolution) {
  // Render artwork from the original file at a larger working resolution. This
  // adds no inferred stitching or photographic evidence to the garment master.
  const source = resolution ? await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: resolution, height: resolution, fit: 'inside' }).png().toBuffer() : bytes;
  const { data, info } = await pixels(source);
  const protectedRegions = polygons(layout.protected_regions);
  const occluders = polygons(layout.logo_occluders || []);
  const strands = validateStrands(layout.logo_strands);
  if (strands.length && occluders.length) throw new Error('Use drawstring paths without duplicate polygon cutouts');
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
  return { data, info, mask, median: median(light), occluders, strands, protectedRegions };
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
      let value = shade <= 1 ? base * Math.pow(shade, .85) : base * (1 + .28 * (1 - Math.exp(-(shade - 1))));
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
    // Premultiplied bilinear sampling preserves transparent edges without dark halos.
    const lx = u*(logo.info.width-1), ly = v*(logo.info.height-1);
    const x0 = Math.floor(lx), y0 = Math.floor(ly), fx = lx-x0, fy = ly-y0;
    let sourceAlpha = 0; const rgb = [0,0,0];
    for (const [ox,oy,weight] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]) {
      const li = (Math.min(y0+oy,logo.info.height-1)*logo.info.width+Math.min(x0+ox,logo.info.width-1))*4;
      const a = logo.data[li+3]/255*weight;
      sourceAlpha += a;
      for(let c=0;c<3;c++) rgb[c] += logo.data[li+c]*a;
    }
    const alpha = sourceAlpha * (1-strandCoverage(x,y,master.strands || [],width,height));
    if (!alpha) continue;
    // Source hue stays independent of garment color. Bounded neutral light
    // and fine relief simulate a finish; never recolor the artwork with cloth RGB.
    const raised = ['tackle_twill','embroidery','chenille'].includes(finish);
    const light = options.finishRelief ? clamp(1 + (master.data[idx*4+1]/master.median-1)*.18,.90,1.06) : 1;
    const weave = options.finishRelief && raised ? 1 + .018*Math.sin((x+y)*Math.PI/2) : 1;
    for (let c = 0; c < 3; c++) {
      const color = rgb[c]/sourceAlpha;
      const shade = light*weave;
      const lit = shade <= 1 ? color*shade : color+(255-color)*(shade-1);
      output[idx*4+c] = Math.round(output[idx*4+c]*(1-alpha)+lit*alpha);
    }
    if (options.finishRelief && ['tackle_twill','embroidery','chenille'].includes(finish)) {
      const offset = Math.max(1,Math.round(logo.info.width / Math.max(1,maxX-minX)));
      const alphaAt = (px,py) => px<0 || py<0 || px>=logo.info.width || py>=logo.info.height ? 0 : logo.data[(py*logo.info.width+px)*4+3]/255;
      const edge = Math.max(0,sourceAlpha-Math.min(alphaAt(x0-offset,y0),alphaAt(x0+offset,y0),alphaAt(x0,y0-offset),alphaAt(x0,y0+offset)));
      // Subpixel edge relief only: retain the original palette throughout the fill.
      const relief = (alphaAt(x0+offset,y0+offset)-alphaAt(x0-offset,y0-offset))*.10*edge*alpha;
      for(let c=0;c<3;c++) output[idx*4+c] = Math.round(clamp(output[idx*4+c] + (relief>0 ? (255-output[idx*4+c])*relief : output[idx*4+c]*relief)));
    }
    applied++;
  }
  if (applied < 30) throw new Error('Artwork did not land on the garment; check its placement');
  return quad;
}
async function encode(output, master) { return sharp(output,{ raw: master.info }).png().toBuffer(); }
async function decorationDetail(output, master, quad) {
  validateQuad(quad);
  const { width, height } = master.info;
  const xs = quad.map(([x]) => x * width), ys = quad.map(([,y]) => y * height);
  const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
  const size = Math.min(width, height, Math.ceil(span * 1.35));
  if (size < 160) throw new Error('Logo detail is too small for customer review');
  const left = Math.round(clamp((Math.min(...xs)+Math.max(...xs)-size)/2,0,width-size));
  const top = Math.round(clamp((Math.min(...ys)+Math.max(...ys)-size)/2,0,height-size));
  // Exact pixels from the finished hero retain fabric, color, folds and overlap.
  // Never upscale a crop or invent additional production texture.
  return sharp(output, { raw: master.info }).extract({left,top,width:size,height:size})
    .resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toBuffer();
}
module.exports = { placementReference, normalizeRegions, validateStrands, strandCoverage, decorationDetail, validateArtwork,sampleFabric, prepareMaster, recolor, applyArtwork, encode, validateQuad };
