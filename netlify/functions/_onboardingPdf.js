// Builds the new-hire packet PDFs from a completed submission using pdf-lib
// (already a portal dependency). Each document is a clean, generated PDF laid
// out from a simple block spec — labeled fields, headings, wrapped paragraphs,
// and typed-signature lines. The onboarding-admin "generate_zip" action bundles
// the returned docs with JSZip.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { w: 612, h: 792, margin: 54 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.8, 0.82, 0.85);

function wrap(text, font, size, maxWidth) {
  const words = String(text == null ? '' : text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// blocks: array of
//   {type:'heading', text}
//   {type:'field', label, value}
//   {type:'para', text}
//   {type:'bullet', text}
//   {type:'sig', name, date, label}
//   {type:'spacer', h}
//   {type:'rule'}
async function renderDocument({ title, subtitle, footer, blocks }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contentW = PAGE.w - PAGE.margin * 2;

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;

  const newPage = () => { page = pdf.addPage([PAGE.w, PAGE.h]); y = PAGE.h - PAGE.margin; };
  const need = (h) => { if (y - h < PAGE.margin) newPage(); };

  // Header
  page.drawText('NATIONAL SPORTS APPAREL, LLC', { x: PAGE.margin, y, size: 9, font: bold, color: MUTED });
  y -= 20;
  for (const ln of wrap(title, bold, 17, contentW)) { page.drawText(ln, { x: PAGE.margin, y, size: 17, font: bold, color: INK }); y -= 21; }
  if (subtitle) { for (const ln of wrap(subtitle, font, 10, contentW)) { page.drawText(ln, { x: PAGE.margin, y, size: 10, font, color: MUTED }); y -= 14; } }
  y -= 4;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.w - PAGE.margin, y }, thickness: 1, color: RULE });
  y -= 18;

  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === 'spacer') { y -= (b.h || 10); continue; }
    if (b.type === 'rule') { need(14); page.drawLine({ start: { x: PAGE.margin, y: y + 4 }, end: { x: PAGE.w - PAGE.margin, y: y + 4 }, thickness: 0.5, color: RULE }); y -= 12; continue; }
    if (b.type === 'heading') {
      need(26);
      page.drawText(String(b.text || ''), { x: PAGE.margin, y, size: 12, font: bold, color: INK });
      y -= 18;
      continue;
    }
    if (b.type === 'field') {
      const label = String(b.label || '');
      const value = (b.value == null || b.value === '') ? '—' : String(b.value);
      need(16);
      page.drawText(label, { x: PAGE.margin, y, size: 9, font: bold, color: MUTED });
      const valLines = wrap(value, font, 11, contentW);
      // label on its own line, value below for clean alignment
      y -= 13;
      for (const ln of valLines) { need(14); page.drawText(ln, { x: PAGE.margin, y, size: 11, font, color: INK }); y -= 14; }
      y -= 4;
      continue;
    }
    if (b.type === 'para') {
      for (const ln of wrap(b.text, font, 10, contentW)) { need(14); page.drawText(ln, { x: PAGE.margin, y, size: 10, font, color: INK }); y -= 14; }
      y -= 6;
      continue;
    }
    if (b.type === 'bullet') {
      const lines = wrap(b.text, font, 10, contentW - 14);
      lines.forEach((ln, i) => { need(14); page.drawText(i === 0 ? '•' : ' ', { x: PAGE.margin, y, size: 10, font, color: INK }); page.drawText(ln, { x: PAGE.margin + 14, y, size: 10, font, color: INK }); y -= 14; });
      y -= 2;
      continue;
    }
    if (b.type === 'sig') {
      need(50);
      y -= 6;
      page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + 260, y }, thickness: 0.8, color: INK });
      page.drawText(String(b.name || ''), { x: PAGE.margin + 2, y: y + 4, size: 12, font: bold, color: INK });
      page.drawText(b.label || 'Signature (typed / e-signed)', { x: PAGE.margin, y: y - 11, size: 8, font, color: MUTED });
      page.drawLine({ start: { x: PAGE.margin + 300, y }, end: { x: PAGE.margin + 460, y }, thickness: 0.8, color: INK });
      page.drawText(String(b.date || ''), { x: PAGE.margin + 302, y: y + 4, size: 11, font, color: INK });
      page.drawText('Date', { x: PAGE.margin + 300, y: y - 11, size: 8, font, color: MUTED });
      y -= 28;
      continue;
    }
  }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(footer || 'National Sports Apparel, LLC — Confidential Employee Record', { x: PAGE.margin, y: 30, size: 7.5, font, color: MUTED });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE.w - PAGE.margin - 60, y: 30, size: 7.5, font, color: MUTED });
  });

  return pdf;
}

function fmtDate(v) {
  if (!v) return '';
  try { const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return String(v); }
}
function fmtDateTime(v) {
  if (!v) return '';
  try { const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT'; }
  catch { return String(v); }
}

module.exports = { renderDocument, wrap, fmtDate, fmtDateTime, PAGE };
