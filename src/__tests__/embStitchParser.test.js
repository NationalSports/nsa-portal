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
const { parseStitchCount, embStitchTierLabel } = require('../lib/embStitchParser');

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
    expect(embStitchTierLabel(6295)).toBe('≤10k');
    expect(embStitchTierLabel(10000)).toBe('≤10k');
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
