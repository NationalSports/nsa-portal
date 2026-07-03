// Uniform Builder — athletic lettering engine.
//
// One text-drawing path shared by the 2D production renderer and the 3D decal
// canvas (the PDF embeds the 2D render, so it inherits this too). Supports the
// two treatments that make a back-of-jersey read "real team uniform":
//   • arch — per-letter placement along a circular arc (name curved over the
//     number). arch is the arc's total angle factor, 0 = straight.
//   • letterSpacing — expressed as % of the font size so it scales with the
//     garment render instead of being a fixed pixel gap.
//
// Callers resolve colors first (auto-contrast etc.) and pass concrete hexes.

import { fontShorthand } from './fonts';

// Measure the text block: total advance width, and the arc sagitta (extra
// height above the baseline block) when arched.
export function measureAthleticText(ctx, { value, font, size, letterSpacing = 0, arch = 0 }) {
  ctx.font = fontShorthand(font, size);
  const chars = [...value];
  const ws = chars.map((c) => ctx.measureText(c).width);
  const ls = (letterSpacing / 100) * size;
  const total = ws.reduce((a, b) => a + b, 0) + ls * Math.max(0, chars.length - 1);
  let sag = 0;
  if (arch > 0 && chars.length > 1 && total > 0) {
    const theta = Math.min(2.4 * arch, 2.2);
    const R = total / theta;
    sag = R * (1 - Math.cos(theta / 2));
  }
  return { total, sag, ws, ls, chars };
}

// Draw at (x, y): y is the middle of the glyph line; an arch bows the line
// upward so the CENTER letter stays at y and the ends fall below it — the
// classic "name over number" curve.
export function drawAthleticText(ctx, opts) {
  const { value, font, size, fill, outline, outlineWidth = 0, outline2, outline2Width = 0, letterSpacing = 0, arch = 0, x, y } = opts;
  const m = measureAthleticText(ctx, opts);
  ctx.font = fontShorthand(font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const strokeW = (outline && outline !== 'none' && outlineWidth > 0) ? outlineWidth * 2 : 0;
  // Second outline rings the first: its stroke is widened by the inner
  // stroke's width so exactly outline2Width of it shows past the inner ring.
  const stroke2W = (strokeW && outline2 && outline2 !== 'none' && outline2Width > 0) ? (outlineWidth + outline2Width) * 2 : 0;
  const paint = (ch, px, py) => {
    if (stroke2W) { ctx.strokeStyle = outline2; ctx.lineWidth = stroke2W; ctx.strokeText(ch, px, py); }
    if (strokeW) { ctx.strokeStyle = outline; ctx.lineWidth = strokeW; ctx.strokeText(ch, px, py); }
    ctx.fillStyle = fill; ctx.fillText(ch, px, py);
  };

  if (!(arch > 0) || m.chars.length < 2 || m.total <= 0) {
    if (!m.ls) { paint(value, x, y); return m; }
    // manual per-char advance so spacing scales with size everywhere
    let cx = x - m.total / 2;
    for (let i = 0; i < m.chars.length; i++) {
      paint(m.chars[i], cx + m.ws[i] / 2, y);
      cx += m.ws[i] + m.ls;
    }
    return m;
  }

  const theta = Math.min(2.4 * arch, 2.2);
  const R = m.total / theta;
  const cy = y + R; // circle center below the line → arc bows up
  let acc = 0;
  for (let i = 0; i < m.chars.length; i++) {
    const mid = acc + m.ws[i] / 2;
    const a = (mid / m.total - 0.5) * theta;
    ctx.save();
    ctx.translate(x + R * Math.sin(a), cy - R * Math.cos(a));
    ctx.rotate(a);
    paint(m.chars[i], 0, 0);
    ctx.restore();
    acc += m.ws[i] + m.ls;
  }
  return m;
}
