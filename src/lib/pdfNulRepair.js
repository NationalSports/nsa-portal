/* eslint-disable */
// ── Repair Wilcom / pdfFactory proof PDFs that pdf.js can't read ──
// Wilcom "Design Information" proofs printed through pdfFactory Pro write some
// dash patterns with NUL bytes between every character ("[0\0.\03\06\0 …] 0\0 d",
// a UTF-16 slip). pdf.js's lexer throws "Invalid number" on the first one and
// drops the WHOLE page's text — so "Read from PDF" found no size, stitches or
// threads even though the proof prints them plainly (SO-1023, Servite).
//
// This rewrites only those content streams: inflate, strip the NULs inside the
// dash-pattern operators, and store the stream uncompressed. Nothing else in the
// file changes; pdf.js rebuilds the (now shifted) xref on its own. Callers use it
// as a retry when the first extraction came back empty — a readable PDF never
// goes through here.

const DASH_RE = /\[[^\]()<>]*\][\s\x00]*[\d.\-\x00]+[\s\x00]*d(?![A-Za-z])/g;

function toBinary(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
}
function fromBinary(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// inflate: async (Uint8Array) => Uint8Array (zlib format). Returns repaired bytes, or null when
// nothing needed fixing (so the caller can skip a pointless second parse).
async function repairPdfDashNulls(input, inflate) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const src = toBinary(bytes);
  if (src.indexOf('/FlateDecode') < 0) return null;
  // One object's dictionary: from "N G obj" to its "stream" keyword, never across an endobj.
  const re = /\d+\s+\d+\s+obj\b((?:(?!endobj)[\s\S])*?)stream(\r\n|\n)/g;
  let out = '', last = 0, fixed = 0, m;
  while ((m = re.exec(src))) {
    const dict = m[1], dictAt = m.index + m[0].indexOf(m[1]), start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    // Plain Flate page/form content only — never fonts, images, xref or object streams.
    if (!/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(dict)) continue;
    if (/\/DecodeParms|\/Length1|\/Subtype\s*\/Image|\/Type\s*\/(?:XRef|ObjStm)/.test(dict)) continue;
    const direct = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let dataEnd = direct ? start + Number(direct[1]) : end;
    if (dataEnd > end) dataEnd = end;
    let content;
    try { content = toBinary(await inflate(fromBinary(src.slice(start, dataEnd).replace(/[\r\n]+$/, '')))); } catch (e) { continue; }
    if (content.indexOf('\x00') < 0) continue;
    const repaired = content.replace(DASH_RE, s => s.replace(/\x00/g, ''));
    if (repaired === content) continue;
    const newDict = dict
      .replace(/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/, '')
      .replace(/\/Length\s+\d+(?:\s+\d+\s+R)?/, '/Length ' + repaired.length);
    out += src.slice(last, dictAt) + newDict + 'stream\n' + repaired + '\n';
    last = end;
    fixed++;
  }
  if (!fixed) return null;
  return fromBinary(out + src.slice(last));
}

// Browser inflate (zlib "deflate" format) via DecompressionStream.
async function browserInflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

export { repairPdfDashNulls, browserInflate };
