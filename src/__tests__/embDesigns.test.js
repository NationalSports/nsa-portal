/* eslint-disable */
/**
 * NSA Portal — Embroidery machine-design helpers
 *
 * Covers the production-sheet barcode pipeline: DG code extraction from the
 * digitizer's file names, base-name derivation (used to pair DST + PDF run
 * sheet), Cloudinary PDF page URLs, and the inline Code 128 barcode SVG.
 */

const { dgCodeOf, isDstFile } = require('../constants');
const { fileBaseName, barcodeSvg, _cloudinaryPdfPage } = require('../utils');

// jsdom ships no canvas; JsBarcode only touches it to measure the label text
// width, so a measureText stub is enough to exercise the real encoding path.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: String(t || '').length * 7 }) });
});

describe('dgCodeOf', () => {
  test('extracts DG number from digitizer file names', () => {
    expect(dgCodeOf('DG648617_A_3D_CAP_FRONT.DST')).toBe('DG648617');
    expect(dgCodeOf('DG648617_A_3D_CAP_FRONT')).toBe('DG648617');
  });
  test('handles dash/underscore/space variants and case', () => {
    expect(dgCodeOf('DG-648617.dst')).toBe('DG648617');
    expect(dgCodeOf('dg_648617 rev B.pdf')).toBe('DG648617');
    expect(dgCodeOf('DG 648617')).toBe('DG648617');
  });
  test('returns null when no DG number present', () => {
    expect(dgCodeOf('eagle_logo.dst')).toBe(null);
    expect(dgCodeOf('')).toBe(null);
    expect(dgCodeOf(null)).toBe(null);
  });
});

describe('fileBaseName', () => {
  test('strips extension from file objects', () => {
    expect(fileBaseName({ name: 'DG648617_A_3D_CAP_FRONT.DST' })).toBe('DG648617_A_3D_CAP_FRONT');
  });
  test('derives name from URL strings', () => {
    expect(fileBaseName('https://res.cloudinary.com/x/raw/upload/v1/nsa-art-files/DG648617_A_3D_CAP_FRONT.dst'))
      .toBe('DG648617_A_3D_CAP_FRONT');
  });
});

describe('isDstFile', () => {
  test('matches uppercase .DST (digitizer delivers uppercase)', () => {
    expect(isDstFile({ name: 'DG648617_A_3D_CAP_FRONT.DST' })).toBe(true);
    expect(isDstFile('DG648617.dst')).toBe(true);
    expect(isDstFile({ name: 'DG648617_A_3D_CAP_FRONT.pdf' })).toBe(false);
  });
});

describe('_cloudinaryPdfPage', () => {
  test('builds page-N PNG render URLs from raw upload URLs', () => {
    const u = 'https://res.cloudinary.com/x/raw/upload/v1/nsa-art-files/DG648617.pdf';
    expect(_cloudinaryPdfPage(u, 3)).toBe('https://res.cloudinary.com/x/image/upload/pg_3,f_png/v1/nsa-art-files/DG648617.pdf');
  });
  test('returns null for non-Cloudinary URLs', () => {
    expect(_cloudinaryPdfPage('https://example.com/a.pdf', 1)).toBe(null);
    expect(_cloudinaryPdfPage('', 1)).toBe(null);
  });
});

describe('barcodeSvg', () => {
  test('renders an inline Code 128 SVG for digitizer file names (underscores included)', () => {
    const svg = barcodeSvg('DG648617_A_3D_CAP_FRONT');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<rect');
    expect(svg).toContain('DG648617_A_3D_CAP_FRONT');
  });
  test('returns empty string instead of throwing on unencodable input', () => {
    expect(barcodeSvg('')).toBe('');
  });
});
