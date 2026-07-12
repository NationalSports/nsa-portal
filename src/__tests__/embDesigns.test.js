/* eslint-disable */
/**
 * NSA Portal — Embroidery machine-design helpers
 *
 * Covers the production-sheet barcode pipeline: DG code extraction from the
 * digitizer's file names (dgCodeOf for display, dgScanOf for the machine's
 * substring search), base-name derivation (used to pair DST + PDF run sheet),
 * Cloudinary PDF page URLs, and the inline barcode SVG (CODE128 + CODE39).
 */

const { dgCodeOf, dgScanOf, scanTokenOf, isDstFile } = require('../constants');
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

describe('dgScanOf', () => {
  test('preserves the dash exactly as in the file name (must be a literal substring for the machine search)', () => {
    expect(dgScanOf('DG-619597_DONS_SB_Football')).toBe('DG-619597');
    expect(dgScanOf('DG648617_A_3D_CAP_FRONT')).toBe('DG648617');
  });
  test('uppercases and returns null when no DG number present', () => {
    expect(dgScanOf('dg-705669_ts_3409')).toBe('DG-705669');
    expect(dgScanOf('eagle_logo.dst')).toBe(null);
    expect(dgScanOf('')).toBe(null);
  });
});

describe('scanTokenOf (what the machine barcode actually encodes)', () => {
  test('full base name when it is verbatim CODE39-safe (unique per file; covers generated name files)', () => {
    expect(scanTokenOf('001-L-NAME-SMITH')).toBe('001-L-NAME-SMITH');
    expect(scanTokenOf('002-L-NUM-12')).toBe('002-L-NUM-12');
  });
  test('falls to the DG token as written when the full name has unsafe chars (underscores/lowercase)', () => {
    expect(scanTokenOf('DG-619597_DONS_SB_Football')).toBe('DG-619597');
    expect(scanTokenOf('DG648617_A_3D_CAP_FRONT')).toBe('DG648617');
  });
  test('falls to bare digits when the DG token itself is CODE39-unsafe (underscore separator, lowercase dg)', () => {
    expect(scanTokenOf('DG_648617_X_BACK')).toBe('648617'); // "_" not encodable in CODE39
    expect(scanTokenOf('dg-648617 rev b')).toBe('648617'); // lowercase isn't a verbatim CODE39 substring
  });
  test('full-name path respects the 30-char scan limit', () => {
    const long = 'A'.repeat(31) + '-DG-123456';
    expect(scanTokenOf(long)).toBe('DG-123456');
  });
  test('null when nothing scannable exists (text tile fallback)', () => {
    expect(scanTokenOf('sm-logo')).toBe(null); // lowercase, no DG number
    expect(scanTokenOf('')).toBe(null);
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
  test('renders a CODE39 barcode for a DG number (machine format)', () => {
    const svg = barcodeSvg('DG-619597', { format: 'CODE39' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('<rect');
    expect(svg).toContain('DG-619597');
  });
  test('CODE39 rejects underscores (returns empty → caller prints text fallback)', () => {
    // The digitizer's underscores are exactly why the machine barcode encodes the
    // DG number, not the full file name — CODE39 can't represent an underscore.
    expect(barcodeSvg('DG-619597_DONS', { format: 'CODE39' })).toBe('');
  });
  test('returns empty string instead of throwing on unencodable input', () => {
    expect(barcodeSvg('')).toBe('');
  });
});
