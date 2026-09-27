/* eslint-disable */
/**
 * Embroidery stitch-count parser (src/lib/embStitchParser.js).
 *
 * Fixtures mirror the real text pdf.js (App.js extractPdfText) produces from
 * embroidery digitizing proof sheets — including the per-glyph label
 * fragmentation ("S titc he s:") and the "Max Stitch / Min Stitch" millimetre
 * lengths that must NOT be mistaken for the stitch count.
 *
 * SAFE: pure function — no Supabase, no DOM, no network.
 */
const { parseStitchCount, parseEmbroideryDimensions, fillEmbroiderySpecs, embStitchTierLabel } = require('../lib/embStitchParser');

// Reconstructed from the DG631963 "Alemany A Flag" Wilcom ES-65 proof (has a
// text layer). pdf.js row-grouping puts each label adjacent to its value, but
// fragments the label glyphs with spaces.
const WILCOM_PROOF = `
Wilcom ES-65 Designer   Z: 1.00
Alemany_A_Flag
H: 2.57 in     W: 3.51 in
S titc he s:  6295
Co l o rs:  3
Co l o r c hange s: 2
S t op s:  3
Ma c h i ne :  T aj i ma
T ri m s:  5
Le ft:   44.6 mm    Ri gh t:  44.6 mm
Up:  32.6 mm   Down:  32.6 mm
Ma x   S titc h :  6.9 mm
M i n   S titc h :  0.4 mm
Ma x  J ump :  6.9 mm
Colorway: ISACORD
`;

describe('parseStitchCount', () => {
  test('reads the count off a Wilcom/Tajima proof sheet', () => {
    expect(parseStitchCount(WILCOM_PROOF)).toBe(6295);
  });

  test('does NOT mistake "Max Stitch / Min Stitch" millimetre lengths for a count', () => {
    const onlyLengths = `
      Ma x   S titc h :  6.9 mm
      M i n   S titc h :  0.4 mm
      Ma x  J ump :  6.9 mm
    `;
    expect(parseStitchCount(onlyLengths)).toBeNull();
  });

  test('plain "Stitches: N" label', () => {
    expect(parseStitchCount('Stitches: 12480\nColors: 4')).toBe(12480);
    expect(parseStitchCount('STITCHES 8500')).toBe(8500);
  });

  test('comma-grouped counts', () => {
    expect(parseStitchCount('Stitches: 12,345')).toBe(12345);
    expect(parseStitchCount('Total: 24,000 stitches')).toBe(24000);
  });

  test('"up to N stitches" NetSuite-style description', () => {
    expect(parseStitchCount('Embroidery up to 8000 stitches, left chest')).toBe(8000);
    expect(parseStitchCount('Left Chest Embroidery — 15000 stitch')).toBe(15000);
  });

  test('"Stitch count: N" phrasing', () => {
    expect(parseStitchCount('Stitch Count: 9,850')).toBe(9850);
  });

  test('empty / image-only proof (no text layer) → null', () => {
    expect(parseStitchCount('')).toBeNull();
    expect(parseStitchCount('   \n  \t ')).toBeNull();
    expect(parseStitchCount(null)).toBeNull();
    expect(parseStitchCount(undefined)).toBeNull();
  });

  test('rejects out-of-range / noise numbers', () => {
    expect(parseStitchCount('Stitches: 12')).toBeNull();     // too small — not a real design
    expect(parseStitchCount('Colors: 3\nStops: 6')).toBeNull(); // no stitch label at all
  });

  test('picks the count even when it appears after the mm lengths in the text', () => {
    const reordered = `
      Max Stitch: 6.9 mm
      Min Stitch: 0.4 mm
      Stitches: 6295
    `;
    expect(parseStitchCount(reordered)).toBe(6295);
  });
});

describe('embStitchTierLabel', () => {
  test('maps stitch counts to EM.sb price tiers', () => {
    expect(embStitchTierLabel(3658)).toBe('≤5k');
    expect(embStitchTierLabel(5000)).toBe('≤5k');
    expect(embStitchTierLabel(5001)).toBe('5k–10k');
    expect(embStitchTierLabel(6295)).toBe('5k–10k');
    expect(embStitchTierLabel(10000)).toBe('5k–10k');
    expect(embStitchTierLabel(12000)).toBe('10k–15k');
    expect(embStitchTierLabel(18000)).toBe('15k–20k');
    expect(embStitchTierLabel(25000)).toBe('20k+');
  });

  test('null-ish for missing / zero', () => {
    expect(embStitchTierLabel(0)).toBeNull();
    expect(embStitchTierLabel(null)).toBeNull();
    expect(embStitchTierLabel(undefined)).toBeNull();
  });
});

describe('parseEmbroideryDimensions', () => {
  test('reads the actual flattened Wilcom header', () => {
    expect(parseEmbroideryDimensions('Wilcom ES-65 Designer Z: 1.00 SJM 1A H: 2.25 in W: 2.71 in')).toEqual({
      width: 2.71, height: 2.25, unit: 'in', artSize: '2.71" W x 2.25" H',
    });
  });
  test('accepts width/height in either order and across lines', () => {
    expect(parseEmbroideryDimensions('Width: 68.834 mm\nHeight: 5.715 cm')).toEqual({
      width: 68.83, height: 57.15, unit: 'mm', artSize: '68.83 mm W x 57.15 mm H',
    });
    expect(parseEmbroideryDimensions('Height 1 in   Width 2 in')).toMatchObject({ width: 2, height: 1, unit: 'in' });
  });
  test('permits identical repeated headers but rejects conflicting dimensions', () => {
    expect(parseEmbroideryDimensions('H: 2.25 in W: 2.71 in\nH: 2.25 in W: 2.71 in')).not.toBeNull();
    expect(parseEmbroideryDimensions('H: 2.25 in W: 2.71 in\nH: 2.50 in W: 2.71 in')).toBeNull();
    expect(parseEmbroideryDimensions('H: 2 in W: 3 in Width: 4 in')).toBeNull();
  });
  test('ignores geometry, stitch extents, and unlabelled values', () => {
    expect(parseEmbroideryDimensions('Left: 34.5 mm Right: 34.5 mm Up: 28.6 mm Down: 28.6 mm EndX: 0.00 in EndY: 0.00 in Max Stitch: 6.7 mm')).toBeNull();
    expect(parseEmbroideryDimensions('Page width: 8.5 in, page height: 11 in')).toBeNull();
    expect(parseEmbroideryDimensions('2.25 in x 2.71 in')).toBeNull();
  });
  test('rejects nonpositive dimensions', () => {
    expect(parseEmbroideryDimensions('W: -2 in H: 3 in')).toBeNull();
    expect(parseEmbroideryDimensions('W: 2 in H: 0 in')).toBeNull();
  });
  test('requires explicit units for both labelled dimensions', () => {
    expect(parseEmbroideryDimensions('W: 2.71 in H: 2.25')).toBeNull();
  });
});

describe('fillEmbroiderySpecs', () => {
  test('fills only missing fields and preserves manual values', () => {
    expect(fillEmbroiderySpecs({ id: 'a', art_size: '', stitches: null }, { artId: 'a', dimensions: { artSize: '2.71" W x 2.25" H' }, stitches: 7569 })).toEqual({ id: 'a', art_size: '2.71" W x 2.25" H', stitches: 7569 });
    expect(fillEmbroiderySpecs({ id: 'a', art_size: 'manual', stitches: 9000 }, { artId: 'a', dimensions: { artSize: 'parsed' }, stitches: 7569 })).toEqual({ id: 'a', art_size: 'manual', stitches: 9000 });
  });
  test('ignores stale or deleted art extraction and can suppress stitch filling', () => {
    const art = { id: 'new', art_size: '', stitches: null };
    expect(fillEmbroiderySpecs(art, { artId: 'old', dimensions: { artSize: 'parsed' }, stitches: 7569 })).toBe(art);
    expect(fillEmbroiderySpecs(art, { deleted: true, dimensions: { artSize: 'parsed' } })).toBe(art);
    expect(fillEmbroiderySpecs(art, { artId: 'new', dimensions: { artSize: 'parsed' }, stitches: 7569 }, { allowStitches: false })).toEqual({ ...art, art_size: 'parsed' });
  });
});
