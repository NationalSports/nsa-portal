/* eslint-disable */
// ── Illustrator .ai → SVG, in the browser ──
// An .ai saved with "Create PDF Compatible File" (Illustrator's default) carries a full
// PDF copy of the artwork. pdf.js (already loaded for the NetSuite PDF import, Apache-2.0)
// reads that copy, and its SVG back end writes the vector paths out as an SVG — so the
// art preview can recolor .ai uploads the same way it recolors .svg ones.
//
// Spot colors (Pantone) come out as their RGB look-alikes and the first artboard only is
// converted — this is for previews, mocks and web logos; the .ai stays the production file.
import { loadPdfJs } from './pdfjs';

// An .ai without the PDF copy is a PostScript-only file pdf.js can't read.
function hasPdfCopy(buf) {
  const b = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s.includes('%PDF-');
}

// lib = the pdfjsLib global. Returns the first page as SVG text.
async function pdfToSvg(lib, buf) {
  if (!hasPdfCopy(buf)) throw new Error("This .ai was saved without PDF compatibility — re-save it in Illustrator with \"Create PDF Compatible File\" checked, or upload an SVG");
  if (!lib || !lib.SVGGraphics) throw new Error('The vector converter is not available');
  // fontExtraProperties: the SVG back end needs the raw font data to embed live (un-outlined) text.
  const pdf = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, fontExtraProperties: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    // forceDataSchema: embedded images become data: URLs, so the SVG text stands on its own.
    const gfx = new lib.SVGGraphics(page.commonObjs, page.objs, true);
    gfx.embedFonts = true;
    const el = await gfx.getSVG(ops, viewport);
    return new XMLSerializer().serializeToString(el);
  } finally {
    pdf.destroy();
  }
}

async function aiToSvg(buf) {
  await loadPdfJs();
  return pdfToSvg(window.pdfjsLib, buf);
}

export { aiToSvg, pdfToSvg, hasPdfCopy };
