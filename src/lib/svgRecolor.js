/* eslint-disable */
// ── SVG color reader / swapper ──
// An SVG spells every color out as text (fill="#1b365d", style="stroke:rgb(0,0,0)",
// a <style> block of .st0{fill:#231F20} classes from Illustrator), so the portal can
// list the colors a logo uses and swap any of them for an ink — the vector-art
// counterpart of the DST stitch preview recoloring by thread.
//
// Pure string work (no DOM) so it unit-tests in node and runs in the browser. Only
// color VALUES are rewritten; nothing else in the file changes.

const PROPS = 'fill|stroke|stop-color|flood-color|lighting-color|color';
// One pass over the file, in document order: a <style> block, a style="" attribute,
// or a color presentation attribute (fill="…"). Attribute names must follow whitespace
// so "stop-color" is never read as "color".
const SVG_RE = new RegExp(
  '(<(?:[\\w-]+:)?style\\b[^>]*>)([\\s\\S]*?)(</(?:[\\w-]+:)?style>)'
  + '|(\\s)(style\\s*=\\s*)(["\'])([\\s\\S]*?)\\6'
  + '|(\\s)(' + PROPS + ')(\\s*=\\s*)(["\'])([^"\']*)\\11', 'gi');
// A CSS declaration inside a <style> block or style="" value.
const CSS_RE = new RegExp('(^|[\\s;{])(' + PROPS + ')(\\s*:\\s*)([^;}"\'<]+)', 'gi');

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', silver: '#c0c0c0',
  gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000', purple: '#800080', teal: '#008080',
  navy: '#000080', orange: '#ffa500', gold: '#ffd700', brown: '#a52a2a', pink: '#ffc0cb',
};
const h2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// A CSS color value → { hex: '#rrggbb', alpha: '' | alpha suffix to keep } or null for
// none / url(#gradient) / currentColor / anything unrecognized (left untouched).
function parseColor(v) {
  const s = String(v || '').replace(/!important/i, '').trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    return { hex: '#' + h.slice(0, 6), alpha: h.length === 8 ? h.slice(6) : '' };
  }
  m = s.match(/^rgba?\(\s*([-\d.]+%?)[\s,]+([-\d.]+%?)[\s,]+([-\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const ch = x => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x));
    if ([m[1], m[2], m[3]].some(x => isNaN(ch(x)))) return null;
    let alpha = '';
    if (m[4] != null) { const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); if (!isNaN(a) && a < 1) alpha = h2(a * 255); }
    return { hex: '#' + h2(ch(m[1])) + h2(ch(m[2])) + h2(ch(m[3])), alpha };
  }
  return NAMED[s] ? { hex: NAMED[s], alpha: '' } : null;
}

// Walk every color value in document order. visit(hex, prop) returns a replacement
// '#rrggbb', or 'none' to drop that color out (transparent), or nothing to keep it.
// Returns the rewritten text.
function walkColors(svgText, visit) {
  const swap = (value, prop) => {
    const c = parseColor(value);
    if (!c) return value;
    const to = visit(c.hex, prop.toLowerCase());
    if (!to || to.toLowerCase() === c.hex) return value;
    const lead = value.match(/^\s*/)[0], imp = /!important/i.test(value) ? ' !important' : '';
    // fill/stroke "none" paints nothing; the other color props take "transparent".
    if (to === 'none') return lead + (/^(fill|stroke)$/i.test(prop) ? 'none' : 'transparent') + imp;
    return lead + to.toLowerCase() + c.alpha + imp;
  };
  const css = text => text.replace(CSS_RE, (all, pre, prop, colon, value) => pre + prop + colon + swap(value, prop));
  return String(svgText || '').replace(SVG_RE, (all, sOpen, sBody, sClose, sp, sAttr, sq, sVal, ap, aProp, aEq, aq, aVal) => {
    if (sOpen) return sOpen + css(sBody) + sClose;
    if (sAttr) return sp + sAttr + sq + css(sVal) + sq;
    return ap + aProp + aEq + aq + swap(aVal, aProp) + aq;
  });
}

// Shapes and text with no fill of their own are painted black by default — a color no
// attribute names, so it could never be swapped. When the file has such an element, writing
// fill="#000000" on the root <svg> (inherited, so it changes nothing visually) makes that black
// a color like any other. pdf.js writes its black text this way, so converted .ai files need it.
// Only added when something relies on it, so art without a default-black part doesn't list a
// phantom black (an element styled by a class or style="" is assumed to set its own fill).
const _SHAPE_RE = /<(?:[\w-]+:)?(path|rect|circle|ellipse|polygon|polyline|text|tspan)\b([^>]*)>/gi;
function usesDefaultFill(s) {
  for (const m of s.matchAll(_SHAPE_RE)) {
    const attrs = m[2];
    // A <text> wrapping <tspan>s: the tspans carry (or lack) the fill, and are checked themselves.
    if (m[1].toLowerCase() === 'text' && /^\s*<(?:[\w-]+:)?tspan\b/i.test(s.slice(m.index + m[0].length, m.index + m[0].length + 200))) continue;
    if (/\sfill\s*=/i.test(attrs) || /\sclass\s*=/i.test(attrs) || /\sstyle\s*=\s*["'][^"']*fill\s*:/i.test(attrs)) continue;
    return true;
  }
  return false;
}
function withDefaultFill(svgText) {
  const s = String(svgText || '');
  const m = s.match(/<(?:[\w-]+:)?svg\b[^>]*>/i);
  if (!m || /\sfill\s*=/i.test(m[0]) || !usesDefaultFill(s)) return s;
  const tag = m[0].replace(/(\/?>)$/, ' fill="#000000"$1');
  return s.slice(0, m.index) + tag + s.slice(m.index + m[0].length);
}

// Distinct colors in the file, in the order they first appear: [{ hex, uses }].
function svgColors(svgText) {
  const seen = new Map();
  walkColors(svgText, hex => { seen.set(hex, (seen.get(hex) || 0) + 1); });
  return [...seen].map(([hex, uses]) => ({ hex, uses }));
}

// "Redmean" RGB distance — cheap, and close enough to how far apart two inks look.
function colorDist(a, b) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b), rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
// The colors a rep actually picks inks for, as groups of look-alike shades — so one pick
// changes ALL of a color: every white in the file (#ffffff, an off-white #fdfdfd left by a
// CMYK conversion, anti-aliased edges) recolors or drops out together. Shades within about
// 10 per RGB channel always share a group; traced art with hundreds of shades loosens the
// grouping until there are at most maxColors. Each group is named by its most-used shade and
// listed in first-appearance order: [{ hex, uses, members: [hex…] }].
const SAME_COLOR = 32; // redmean distance ≈ 10 per channel on light colors
function svgPalette(svgText, maxColors = 12) {
  const all = svgColors(svgText);
  const order = new Map(all.map((c, i) => [c.hex, i]));
  let groups = [];
  for (const tol of [SAME_COLOR, 48, 64, 96, 140]) {
    // Busiest shades seed the groups; every other shade joins the nearest seed within tol.
    const seeds = [];
    [...all].sort((a, b) => b.uses - a.uses || order.get(a.hex) - order.get(b.hex)).forEach(c => {
      let best = null, bd = Infinity;
      for (const g of seeds) { const d = colorDist(c.hex, g.hex); if (d < bd) { bd = d; best = g; } }
      if (best && bd <= tol) { best.members.push(c.hex); best.uses += c.uses; } else seeds.push({ hex: c.hex, uses: c.uses, members: [c.hex] });
    });
    seeds.forEach(g => { g.at = Math.min(...g.members.map(h => order.get(h))); });
    groups = seeds.sort((a, b) => a.at - b.at);
    if (groups.length <= maxColors) break;
  }
  return groups.map(g => ({ hex: g.hex, uses: g.uses, members: g.members }));
}

// Swap colors: map = { '#rrggbb' (as listed by svgColors): '#rrggbb' new, or 'none' to drop it out }.
function recolorSvg(svgText, map) {
  const m = {};
  Object.keys(map || {}).forEach(k => {
    const c = parseColor(k); if (!c) return;
    if (map[k] === 'none') { m[c.hex] = 'none'; return; }
    const to = parseColor(map[k]); if (to) m[c.hex] = to.hex;
  });
  return walkColors(svgText, hex => m[hex]);
}

// What happens to each palette color for one color way (cw null = the art with no color way):
// an ink line index, -1 = keep the file's own color, or 'drop' = drop it out (transparent).
//   1. dropped: in cw.art_drop ([paletteHex…]), or in `dropouts` (the session-only drop-outs for
//      art with no color way, e.g. a DTF white background). An older 'drop' in art_recolor counts too.
//   2. else the ink line the color is linked to, cw.art_recolor = { paletteHex: inkIndex } (see
//      bindInks) — so changing that line's ink recolors every part of the art in that color.
//   3. else keep the file's color (no ink line matches it, or the linked line is empty).
function recolorPlan(palette, cw, dropouts) {
  const inks = (cw && cw.inks) || [], set = (cw && cw.art_recolor) || {};
  const drop = new Set([...(dropouts || []), ...((cw && cw.art_drop) || [])]);
  const ok = i => Number.isInteger(i) && i >= 0 && !!String(inks[i] || '').trim();
  const out = {};
  (palette || []).forEach(c => {
    const own = Object.prototype.hasOwnProperty.call(set, c.hex) ? set[c.hex] : undefined;
    if (own === 'drop' || drop.has(c.hex)) out[c.hex] = 'drop';
    else out[c.hex] = ok(own) ? own : -1;
  });
  return out;
}

// Link a color way's ink lines to the art's colors: each line not linked yet goes to the closest
// art color not linked yet (closest pairs first), if it's close enough to plausibly be that color
// (≈40 per RGB channel) — "PMS 123" finds the gold, "PMS White" the white. Links are saved on the
// color way and then stay put, so retyping a line ("PMS 123" → "PMS 186") recolors that part of the
// art instead of re-linking. inkHex(name) → '#rrggbb' | null. Returns the new art_recolor, or null
// when nothing new links.
const LINK_DIST = 130;
function bindInks(palette, cw, inkHex) {
  const inks = (cw && cw.inks) || [], cur = { ...((cw && cw.art_recolor) || {}) };
  const isLink = v => Number.isInteger(v) && v >= 0;
  const usedLines = new Set(Object.values(cur).filter(isLink));
  const free = (palette || []).filter(c => !isLink(cur[c.hex]) && cur[c.hex] !== 'drop');
  const pairs = [];
  inks.forEach((ink, i) => {
    if (usedLines.has(i)) return;
    const c = parseColor(inkHex(ink));
    if (c) free.forEach(f => { const d = colorDist(f.hex, c.hex); if (d <= LINK_DIST) pairs.push([d, i, f.hex]); });
  });
  pairs.sort((x, y) => x[0] - y[0]);
  const lines = new Set(), colors = new Set();
  for (const [, i, hex] of pairs) {
    if (lines.has(i) || colors.has(hex)) continue;
    cur[hex] = i; lines.add(i); colors.add(hex);
  }
  return lines.size ? cur : null;
}

// Whether a color way has any art color linked to an ink line or dropped out — i.e. the rep has
// set colors for it (used to decide when its art render can stand as the web logo).
const hasArtPicks = cw => !!cw && ((cw.art_drop || []).length > 0
  || Object.values(cw.art_recolor || {}).some(v => v === 'drop' || (Number.isInteger(v) && v >= 0)));

// Remove ink line ii from a color way, keeping the art links on the right lines: the removed
// line's color is unlinked (keeps its file color until another line links to it) and later lines
// shift up by one. Returns the patch { inks, art_recolor? }.
function removeInkLine(cw, ii) {
  const inks = ((cw && cw.inks) || []).filter((_, x) => x !== ii);
  const rc = cw && cw.art_recolor;
  if (!rc) return { inks };
  const next = {};
  Object.keys(rc).forEach(k => {
    const v = rc[k];
    if (!(Number.isInteger(v) && v >= 0)) next[k] = v;
    else if (v !== ii) next[k] = v > ii ? v - 1 : v;
  });
  return { inks, art_recolor: next };
}

// The member-level swap map for recolorSvg: every shade in a group → its ink's hex, or 'none'.
// inkHex(name) resolves an ink name to '#rrggbb' (null = unknown, keep the file's color).
function recolorMap(palette, cw, dropouts, inkHex) {
  const plan = recolorPlan(palette, cw, dropouts), inks = (cw && cw.inks) || [], map = {};
  (palette || []).forEach(g => {
    const p = plan[g.hex], to = p === 'drop' ? 'none' : p >= 0 ? inkHex(inks[p]) : null;
    if (to) g.members.forEach(h => { map[h] = to; });
  });
  return map;
}

export { parseColor, svgColors, svgPalette, withDefaultFill, recolorSvg, recolorPlan, recolorMap, bindInks, removeInkLine, hasArtPicks };
