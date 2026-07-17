import { knockoutWhiteBackground } from '../lib/imageKnockout';

// Build a WxH RGBA array from a (x,y) -> [r,g,b,a] function.
const grid = (w, h, fn) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fn(x, y);
    const p = (y * w + x) * 4;
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = a == null ? 255 : a;
  }
  return d;
};
const alphaAt = (d, w, x, y) => d[(y * w + x) * 4 + 3];

const WHITE = [255, 255, 255, 255];
const OFFWHITE = [234, 233, 236, 255]; // JPEG-tinted "white" the old >=240 test missed
const TAN = [201, 169, 106, 255];

test('clears a pure-white background, keeps the colored mark opaque', () => {
  const w = 10, h = 10;
  // white everywhere except a solid tan block in the middle (3..6)
  const d = grid(w, h, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6) ? TAN : WHITE);
  const cleared = knockoutWhiteBackground(d, w, h);
  expect(cleared).toBeGreaterThan(0);
  expect(alphaAt(d, w, 0, 0)).toBe(0);   // corner background gone
  expect(alphaAt(d, w, 5, 5)).toBe(255); // mark stays
});

test('clears an off-white / JPEG-tinted background (the reported bug)', () => {
  const w = 8, h = 8;
  const d = grid(w, h, (x, y) => (x === 4 && y === 4) ? TAN : OFFWHITE);
  knockoutWhiteBackground(d, w, h);
  expect(alphaAt(d, w, 0, 0)).toBe(0);
  expect(alphaAt(d, w, 4, 4)).toBe(255);
});

test('preserves white ENCLOSED by the art (letter counters)', () => {
  const w = 9, h = 9;
  // a tan ring (border 2..6) with a white hole at the center (3..5) — the hole is not
  // connected to the edge, so it must stay opaque.
  const ring = (x, y) => {
    const inOuter = x >= 2 && x <= 6 && y >= 2 && y <= 6;
    const inHole = x >= 3 && x <= 5 && y >= 3 && y <= 5;
    if (inOuter && !inHole) return TAN;
    if (inHole) return WHITE;
    return WHITE; // outside the ring = background
  };
  const d = grid(w, h, ring);
  knockoutWhiteBackground(d, w, h);
  expect(alphaAt(d, w, 0, 0)).toBe(0);   // outside background cleared
  expect(alphaAt(d, w, 2, 2)).toBe(255); // ring stays
  expect(alphaAt(d, w, 4, 4)).toBe(255); // enclosed white hole preserved
});

test('a non-white (colored) background is left untouched', () => {
  const w = 6, h = 6;
  const NAVY = [20, 30, 80, 255];
  const d = grid(w, h, () => NAVY);
  const cleared = knockoutWhiteBackground(d, w, h);
  expect(cleared).toBe(0);
  expect(alphaAt(d, w, 0, 0)).toBe(255);
});

test('is a no-op on bad input', () => {
  expect(knockoutWhiteBackground(null, 4, 4)).toBe(0);
  expect(knockoutWhiteBackground(new Uint8ClampedArray(4), 0, 0)).toBe(0);
});
