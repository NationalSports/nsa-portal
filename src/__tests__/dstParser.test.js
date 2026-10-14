/* eslint-disable */
// Tajima DST reader (src/lib/dstParser.js) against a real Wilcom export:
// DG-472934 "San Mateo 1" — header says ±38.4 mm x ±42.8 mm, 3 color changes,
// and the proof lists 4 stops of 4773 / 4869 / 2083 / 1722 stitches.
const fs = require('fs');
const path = require('path');
const { parseDst } = require('../lib/dstParser');

describe('parseDst', () => {
  const d = parseDst(fs.readFileSync(path.join(__dirname, 'fixtures', 'san_mateo_1.dst')));
  test('splits the design into one block per thread stop', () => {
    expect(d.blocks).toHaveLength(4);
  });
  test('extents match the DST header (0.1 mm units)', () => {
    expect(d.bounds).toMatchObject({ minX: -384, maxX: 384, minY: -428, maxY: 428 });
  });
  test('per-block stitch counts track the proof sheet', () => {
    const counts = d.blocks.map(runs => runs.reduce((a, r) => a + r.length / 2 - 1, 0));
    [4773, 4869, 2083, 1722].forEach((n, i) => expect(Math.abs(counts[i] - n) / n).toBeLessThan(0.02));
  });
  test('rejects non-DST input', () => {
    expect(parseDst(new Uint8Array(600))).toBeNull();
    expect(parseDst(null)).toBeNull();
  });
});
