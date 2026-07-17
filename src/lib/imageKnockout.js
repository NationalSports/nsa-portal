// Zero out the CONNECTED near-white background of a raster logo — a flood-fill inward from
// every edge pixel. Only background-connected near-white is cleared (alpha -> 0), so white that
// is ENCLOSED by the art (letter counters, highlights) is preserved, and an off-white / JPEG-
// tinted background (e.g. a rep's re-saved JPG where "white" lands around 232) still clears —
// the old flat `>= 240 on every channel` test missed those and left the white behind.
//
// Mutates `data` (an RGBA byte array, e.g. ImageData.data) in place; returns the number of
// pixels cleared. A pixel counts as background when it's already transparent, OR light (each
// channel >= minChannel) and near-neutral (channel spread <= maxSpread) so only whites/greys
// clear, never a colored mark.
export function knockoutWhiteBackground(data, w, h, opts = {}) {
  const minChannel = opts.minChannel != null ? opts.minChannel : 224;
  const maxSpread = opts.maxSpread != null ? opts.maxSpread : 26;
  if (!w || !h || !data || data.length < w * h * 4) return 0;
  const isBg = (q) => {
    const p = q * 4;
    if (data[p + 3] < 16) return true; // already transparent — don't let it wall off the fill
    const r = data[p], g = data[p + 1], b = data[p + 2];
    return r >= minChannel && g >= minChannel && b >= minChannel &&
      (Math.max(r, g, b) - Math.min(r, g, b)) <= maxSpread;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const q = y * w + x;
    if (seen[q]) return;
    seen[q] = 1;
    if (isBg(q)) stack.push(q);
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  let cleared = 0;
  while (stack.length) {
    const q = stack.pop();
    if (data[q * 4 + 3] !== 0) { data[q * 4 + 3] = 0; cleared++; }
    const x = q % w, y = (q - x) / w;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  return cleared;
}
