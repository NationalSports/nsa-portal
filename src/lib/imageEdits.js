// Pure pixel operations. Always edit a copy so reset restores the uploaded image.
export const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
export const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
export function paletteOf(data, limit = 24) {
  const buckets = new Map();
  const stride = 4 * Math.max(1, Math.ceil(data.length / 4 / 250000));
  for (let i = 0; i < data.length; i += stride) {
    if (data[i + 3] < 128) continue;
    const color = Array.from(data.slice(i, i + 3));
    const key = color.map(v => Math.round(v / 24)).join(',');
    const b = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
    b.count++; color.forEach((v, c) => { b.sum[c] += v; }); buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, limit).map(b => hex(b.sum.map(v => v / b.count)));
}
export function editPixels(source, width, height, { background = null, tolerance = 24, colors = {} } = {}) {
  const data = new Uint8ClampedArray(source);
  if (background) {
    const target = rgb(background), visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height); let head = 0, tail = 0;
    const add = p => {
      if (visited[p]) return;
      visited[p] = 1;
      const i = p * 4;
      if (data[i + 3] !== 0 && distance(Array.from(data.slice(i, i + 3)), target) > tolerance) return;
      queue[tail++] = p;
    };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
      const p = queue[head++]; data[p * 4 + 3] = 0;
      if (p % width) add(p - 1);
      if (p % width < width - 1) add(p + 1);
      if (p >= width) add(p - width);
      if (p < width * (height - 1)) add(p + width);
    }
  }
  const replacements = Object.entries(colors).map(([from, to]) => [rgb(from), to === null ? null : rgb(to)]);
  if (!replacements.length) return data;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const original = Array.from(source.slice(i, i + 3));
    let best = null, score = Infinity;
    for (const entry of replacements) {
      const d = distance(original, entry[0]);
      if (d <= tolerance && d < score) { best = entry; score = d; }
    }
    if (best) {
      if (best[1] === null) data[i + 3] = 0;
      else best[1].forEach((v, c) => { data[i + c] = v; });
    }
  }
  return data;
}
