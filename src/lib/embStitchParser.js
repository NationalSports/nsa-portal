/* eslint-disable */
// ── Embroidery stitch-count parser ──
// Pulls the stitch count out of an embroidery digitizing proof sheet
// (Wilcom / Tajima / Melco / Pulse "Design Information" exports) or a
// NetSuite-style "up to N stitches" line description. Pure and dependency-free
// so it unit-tests in isolation AND runs in the browser (OrderEditor feeds it
// the text that App.js's extractPdfText produces via pdf.js).
//
// The stitch count is the embroidery price driver: decoPricing.emP() buckets it
// into the EM.sb tiers (≤10k / ≤15k / ≤20k / 20k+). When an art file has no
// stitch count, embroidery costs fall back to a flat 8000-stitch default, which
// mis-costs any design above the first tier — hence reading the real number.
//
// Robustness the proof sheets force on us:
//  • pdf.js fragments a label into per-glyph runs separated by spaces, so
//    "Stitches:" comes out as "S titc he s:". We match on a whitespace-stripped
//    copy of the text so that spacing can't hide the label.
//  • Proof sheets also print "Max Stitch: 6.9 mm" and "Min Stitch: 0.4 mm" — a
//    stitch *length* in millimetres, not a count. We only accept the plural
//    "Stitches:" count and reject decimal / mm values so those can't poison it.
//  • Some sheets/descriptions comma-group the number ("12,345 stitches"); we
//    strip commas between digits before matching.
//  • Image-only proofs (no text layer) yield empty text → we return null and the
//    caller falls back to manual entry.

const MIN_STITCHES = 100;       // below this it's noise (a page number, a color count), not a design
const MAX_STITCHES = 1000000;   // 1M ceiling — guards against accidentally gluing digit runs together

function _inRange(n) { return Number.isFinite(n) && n >= MIN_STITCHES && n <= MAX_STITCHES; }

// Returns an integer stitch count, or null when none can be found confidently.
function parseStitchCount(text) {
  if (!text || typeof text !== 'string') return null;
  // Lowercase, strip whitespace (see per-glyph note) and digit-grouping commas.
  const despaced = text.toLowerCase().replace(/\s+/g, '').replace(/(\d),(\d)/g, '$1$2');

  // Pattern A — explicit "Stitches: N" on a proof sheet. Plural label + integer.
  // Reject a trailing decimal (".9") or "mm" so a millimetre length can never match.
  let m = despaced.match(/stitches:?(\d{3,7})(?!\.\d)(?!mm)/);
  if (m) { const n = parseInt(m[1], 10); if (_inRange(n)) return n; }

  // Pattern B — "N stitches" / "up to N stitches" (NetSuite line descriptions,
  // some proof footers): digits immediately before the word, no letter after.
  m = despaced.match(/(\d{3,7})stitch(?:es)?(?![a-z])/);
  if (m) { const n = parseInt(m[1], 10); if (_inRange(n)) return n; }

  // Pattern C — "Stitch count: N".
  m = despaced.match(/stitchcount:?(\d{3,7})/);
  if (m) { const n = parseInt(m[1], 10); if (_inRange(n)) return n; }

  return null;
}

// The EM.sb price tier a stitch count lands in, as a short human label. Kept here
// (not in decoPricing) because it's UI sugar; the brackets mirror EM.sb defaults.
function embStitchTierLabel(stitches) {
  const s = Number(stitches);
  if (!(s > 0)) return null;
  if (s <= 10000) return '≤10k';   // ≤10k
  if (s <= 15000) return '10k–15k'; // 10k–15k
  if (s <= 20000) return '15k–20k'; // 15k–20k
  return '20k+';
}

export { parseStitchCount, embStitchTierLabel, MIN_STITCHES, MAX_STITCHES };
export default parseStitchCount;
