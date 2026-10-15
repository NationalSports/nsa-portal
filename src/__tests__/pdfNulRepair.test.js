/* eslint-disable */
// Wilcom/pdfFactory proofs write dash patterns with NULs between characters, which makes
// pdf.js drop the whole page's text (SO-1023). repairPdfDashNulls strips only those NULs.
const zlib = require('zlib');
const { repairPdfDashNulls } = require('../lib/pdfNulRepair');

const inflate = b => new Uint8Array(zlib.inflateSync(Buffer.from(b)));
const bin = s => Uint8Array.from(Buffer.from(s, 'latin1'));
const str = u => Buffer.from(u).toString('latin1');
function pdfWith(content, dictExtra = '') {
  const z = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n5 0 obj\n<<\n/Filter/FlateDecode${dictExtra}\n/Length ${z.length}\n>>\nstream\n`, 'latin1'),
    z, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}
const BAD = '0.75 0.75 0.75 RG [0\x00.\x003\x006\x00 0\x00.\x001\x002\x00] 0\x00 d 227.4 437.4 m\n[] 0\x00 d\nBT\n/F1 8.64 Tf\n(Stitches:) Tj\n(10645) Tj\nET\n';

describe('repairPdfDashNulls', () => {
  test('strips NULs from dash patterns and stores the stream uncompressed', async () => {
    const out = await repairPdfDashNulls(new Uint8Array(pdfWith(BAD)), inflate);
    expect(out).not.toBeNull();
    const s = str(out);
    expect(s).toContain('[0.36 0.12] 0 d 227.4 437.4 m');
    expect(s).toContain('[] 0 d');
    expect(s).toContain('(Stitches:) Tj');
    expect(s).not.toContain('\x00');
    expect(s).not.toContain('/FlateDecode');
    const body = s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream'));
    expect(s).toContain('/Length ' + body.length);
    expect(s.endsWith('endstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')).toBe(true);
  });
  test('a clean PDF is left alone (null)', async () => {
    expect(await repairPdfDashNulls(new Uint8Array(pdfWith('[3 2] 0 d\nBT (Hi) Tj ET\n')), inflate)).toBeNull();
  });
  test('NULs inside text strings are not touched', async () => {
    expect(await repairPdfDashNulls(new Uint8Array(pdfWith('BT (\x00A\x00B) Tj ET\n')), inflate)).toBeNull();
  });
  test('fonts and images are never rewritten', async () => {
    expect(await repairPdfDashNulls(new Uint8Array(pdfWith(BAD, '/Length1 99')), inflate)).toBeNull();
    expect(await repairPdfDashNulls(new Uint8Array(pdfWith(BAD, '/Subtype/Image')), inflate)).toBeNull();
  });
  test('no Flate streams → null without inflating', async () => {
    expect(await repairPdfDashNulls(bin('%PDF-1.4\n<< >>\nstream\nabc\nendstream\n'), () => { throw new Error('no'); })).toBeNull();
  });
});
