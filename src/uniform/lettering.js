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

// Canvas font sizes describe an em box, not the visible height of the glyphs.
// Athletic faces vary dramatically inside that box (a condensed block "15"
// can be much shorter than a varsity "15" at the same CSS size). Production
// sizing is specified by finished visible height, so scale each face from its
// real bounding-box metrics before measuring or drawing it.
function normalizedDrawSize(ctx, value, font, targetSize) {
  ctx.font = fontShorthand(font, targetSize);
  const metrics = ctx.measureText(value || '88');
  const visible = Number(metrics.actualBoundingBoxAscent || 0) + Number(metrics.actualBoundingBoxDescent || 0);
  if (!Number.isFinite(visible) || visible < 1) return targetSize;
  const correction = Math.max(0.65, Math.min(1.8, targetSize / visible));
  return targetSize * correction;
}

// Measure the text block: total advance width, and the arc sagitta (extra
// height above the baseline block) when arched.
export function measureAthleticText(ctx, { value, font, size, letterSpacing = 0, arch = 0 }) {
  const drawSize = normalizedDrawSize(ctx, value, font, size);
  ctx.font = fontShorthand(font, drawSize);
  const chars = [...value];
  // Canvas centers the font's advance box, but many athletic faces have
  // asymmetric side bearings (especially a leading "1"). Measure the actual
  // ink bounds so changing number styles never makes a centered back number
  // appear to jump left or right.
  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'center';
  const wholeMetrics = ctx.measureText(value);
  const charMetrics = chars.map((c) => ctx.measureText(c));
  ctx.textAlign = previousAlign;
  const ws = charMetrics.map((metric) => metric.width);
  const ls = (letterSpacing / 100) * size;
  const total = ws.reduce((a, b) => a + b, 0) + ls * Math.max(0, chars.length - 1);
  const bound = (metric, side, fallback) => {
    const n = Number(metric && metric[side]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  let inkLeft = -total / 2;
  let inkRight = total / 2;
  if (!ls && value) {
    const left = bound(wholeMetrics, 'actualBoundingBoxLeft', total / 2);
    const right = bound(wholeMetrics, 'actualBoundingBoxRight', total / 2);
    inkLeft = -left; inkRight = right;
  } else if (chars.length) {
    let cursor = -total / 2;
    inkLeft = Infinity; inkRight = -Infinity;
    for (let i = 0; i < chars.length; i++) {
      const center = cursor + ws[i] / 2;
      const left = bound(charMetrics[i], 'actualBoundingBoxLeft', ws[i] / 2);
      const right = bound(charMetrics[i], 'actualBoundingBoxRight', ws[i] / 2);
      inkLeft = Math.min(inkLeft, center - left);
      inkRight = Math.max(inkRight, center + right);
      cursor += ws[i] + ls;
    }
  }
  const visualOffsetX = Number.isFinite(inkLeft) && Number.isFinite(inkRight) ? (inkLeft + inkRight) / 2 : 0;
  const inkWidth = Number.isFinite(inkLeft) && Number.isFinite(inkRight) ? Math.max(0, inkRight - inkLeft) : total;
  let sag = 0;
  if (arch > 0 && chars.length > 1 && total > 0) {
    const theta = Math.min(2.4 * arch, 2.2);
    const R = total / theta;
    sag = R * (1 - Math.cos(theta / 2));
  }
  return { total, sag, ws, ls, chars, drawSize, inkLeft, inkRight, inkWidth, visualOffsetX };
}

// Draw at (x, y): y is the middle of the glyph line; an arch bows the line
// upward so the CENTER letter stays at y and the ends fall below it — the
// classic "name over number" curve.
export function drawAthleticText(ctx, opts) {
  const { value, font, size, fill, outline, outlineWidth = 0, outline2, outline2Width = 0, letterSpacing = 0, arch = 0, x, y } = opts;
  const m = measureAthleticText(ctx, opts);
  ctx.font = fontShorthand(font, m.drawSize || size);
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
    if (!m.ls) { paint(value, x - m.visualOffsetX, y); return m; }
    // manual per-char advance so spacing scales with size everywhere
    let cx = x - m.total / 2 - m.visualOffsetX;
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
    const mid = acc + m.ws[i] / 2 - m.visualOffsetX;
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
