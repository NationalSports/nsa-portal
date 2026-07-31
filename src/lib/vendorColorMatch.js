// Pure color-matching helpers for vendor Part ID / SKU resolution.
//
// Kept dependency-free (no React, no network) so it can be unit-tested in isolation and
// shared by vendorApis.js. See sanmarResolvePartIds for the SanMar Part ID (Unique_Key)
// resolver that uses these.

// SanMar abbreviates the words in compound (multi-part) colorway names — its cap/beanie
// colors come back like "For Grn/Blk/Wht" for "Forest Green/Black/White". Map each known
// abbreviation to the full word so an order's spelled-out color can match. Only exact,
// unambiguous abbreviations live here (no fuzzy prefix/vowel logic) — a wrong entry would
// conflate two real colors, so keep this conservative and expand it as new ones are seen.
const COLOR_ABBREV = {
  FOR: 'FOREST', FRST: 'FOREST',
  GRN: 'GREEN',
  BLK: 'BLACK', BK: 'BLACK',
  WHT: 'WHITE', WH: 'WHITE', WHI: 'WHITE',
  GRY: 'GREY', GY: 'GREY', GRAY: 'GREY',
  TR: 'TRUE',
  ROY: 'ROYAL',
  GLD: 'GOLD',
  NVY: 'NAVY',
  RD: 'RED',
  ATH: 'ATHLETIC',
  PNK: 'PINK',
  MAR: 'MAROON',
  PUR: 'PURPLE', PPL: 'PURPLE',
  ORG: 'ORANGE',
  YEL: 'YELLOW',
  SIL: 'SILVER',
  CHAR: 'CHARCOAL',
};

// Color words, canonicalized: split on any non-alphanumeric run, then expand known SanMar
// abbreviations to their full word. "For Grn/Blk/Wht" -> ['FOREST','GREEN','BLACK','WHITE'];
// "Forest Green" -> ['FOREST','GREEN'].
export const smColorTokens = (s) =>
  String(s ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
    .map((t) => COLOR_ABBREV[t] || t);

// A vendor color safely matches the order color ONLY when the vendor's (canonicalized) words
// are a SUBSET of the order's — i.e. the vendor carries a shorter or abbreviated spelling of
// the same color, never the reverse. Because tokens are abbreviation-expanded first, this
// covers both "Forest" for an order's "Forest Green" AND SanMar's "For Grn/Blk/Wht" for
// "Forest Green/Black/White". It never lets a generic order color ("Green") grab a
// more-specific vendor colorway ("Forest Green"). Both sides must be non-empty.
//
// It is intentionally allowed to return true for two different vendor colors against the same
// order color (both "Forest" and "Green" are subsets of "Forest Green"); the caller is
// responsible for treating that as ambiguous and refusing to guess.
export const smColorSubset = (vendorColor, orderColor) => {
  const s = smColorTokens(vendorColor), o = smColorTokens(orderColor);
  if (!s.length || !o.length) return false;
  const oset = new Set(o);
  return s.every((t) => oset.has(t));
};

// Order lines carry OUR style code, but S&S catalogs the bare MANUFACTURER style number.
// For many brands SanMar (where our styles originate) prefixes a brand code — Bella+Canvas
// "BC3945", Next Level "NL3600" — while S&S lists the same garment as "3945" / "3600".
// Produce the ordered list of style codes to search S&S for: the code as-is first, then
// progressively looser forms tried ONLY as fallbacks for lines the exact code didn't match.
// Every form still matches on exact color+size downstream, so a looser search can never place
// a wrong item — an unmatched line just stays blocked. `strict:true` forms additionally
// require an exact part-number/style-name hit (never the first fuzzy result), so stripping a
// brand prefix can't grab a different brand that happens to share the bare number.
export const ssStyleSearchVariants = (style) => {
  const s = String(style ?? '').toUpperCase().trim();
  const out = [];
  const add = (code, strict) => { const t = String(code || '').trim(); if (t && !out.some((o) => o.code === t)) out.push({ code: t, strict }); };
  add(s, false);
  // Trailing color suffix: "AT300-50" → base style "AT300".
  const dash = s.lastIndexOf('-');
  if (dash > 0) add(s.slice(0, dash), false);
  // Leading 1–3 letter brand prefix on a numeric style: "BC3945" → "3945", "NL3600" → "3600".
  const m = /^([A-Z]{1,3})(\d[A-Z0-9]*)$/.exec(s);
  if (m) add(m[2], true);
  return out;
};

// Youth size labels → their bare catalog equivalent. SanMar lists youth-only styles (e.g.
// Gildan 18500B) with plain S/M/L/XL, while portal orders carry the youth form ("YS").
const YOUTH_BARE = { YXS: 'XS', YS: 'S', YM: 'M', YL: 'L', YXL: 'XL' };

// Compare two ALREADY-NORMALIZED size tokens (run each through the caller's size normalizer
// first). Equal → match. A youth order size also matches its bare catalog equivalent (order
// "YS" ↔ catalog "S") — one direction only, so an adult order can never grab a youth garment.
// Callers still enforce "exactly one Unique_Key" so a style that somehow lists both "YS" and
// "S" for one color stays ambiguous rather than guessing.
export const smSizeMatch = (orderSizeNorm, catalogSizeNorm) => {
  if (!orderSizeNorm || !catalogSizeNorm) return false;
  if (orderSizeNorm === catalogSizeNorm) return true;
  return YOUTH_BARE[orderSizeNorm] === catalogSizeNorm;
};
