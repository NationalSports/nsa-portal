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
  // Pattern name abbreviated on our order lines — S&S spells it out ("Green/White Pl" vs
  // S&S "Green/ White Plaid"). Only the whole-word token "PL"/"PLD" maps here (tokens are
  // split on non-alphanumerics first, so "PLAID" itself is never touched).
  PL: 'PLAID', PLD: 'PLAID',
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

// SanMar brand prefix → the brand S&S lists that garment under, so a prefix-stripped search
// can be pinned to the RIGHT brand. Values are distinctive tokens matched (normalized,
// either-direction substring) against S&S's brandName — "NEXTLEVEL" ⊂ "Next Level Apparel",
// "BELLA" ⊂ "BELLA + CANVAS". Extend as new prefixed styles show up; an unmapped prefix falls
// back to "use the bare number only if exactly one S&S style has it" (still never a wrong brand).
const SS_BRAND_BY_PREFIX = {
  BC: 'Bella', NL: 'Next Level', CC: 'Comfort Colors', G: 'Gildan',
  DT: 'District', DM: 'District', AA: 'Alternative', BB: 'Bella',
};

// Order lines carry OUR style code, but S&S catalogs the bare MANUFACTURER style number.
// For many brands SanMar (where our styles originate) prefixes a brand code — Bella+Canvas
// "BC3945", Next Level "NL3600" — while S&S lists the same garment as "3945" / "3600".
// Produce the ordered list of style codes to search S&S for: the code as-is first, then
// progressively looser forms tried ONLY as fallbacks for lines the exact code didn't match.
// Every form still matches on exact color+size downstream, so a looser search can never place
// a wrong item — an unmatched line just stays blocked. `strict:true` forms additionally
// require an exact part-number/style-name hit (never the first fuzzy result); when a `brand`
// is known (from the stripped prefix) the resolver pins the search to that brand, so a bare
// number shared across brands ("1580" is Next Level's crop top AND another brand's style)
// resolves to OURS instead of whichever S&S returns first.
export const ssStyleSearchVariants = (style) => {
  const s = String(style ?? '').toUpperCase().trim();
  const out = [];
  const add = (code, strict, brand) => { const t = String(code || '').trim(); if (t && !out.some((o) => o.code === t)) out.push({ code: t, strict, ...(brand ? { brand } : {}) }); };
  const dash = s.lastIndexOf('-');
  // Synced API skus are '<style>-<numericColorCode>' ("AT105-50"). The whole code never
  // names an S&S style, but its fuzzy /Styles?search= still downloads hundreds-to-thousands
  // of styles before the base-style variant would get its turn — so when the suffix looks
  // like a numeric color code, search the base style FIRST (typically an exact single hit)
  // and demote the as-is code to the fallback.
  const numericColorSuffix = dash > 0 && /^\d{1,3}$/.test(s.slice(dash + 1));
  if (numericColorSuffix) add(s.slice(0, dash), false);
  add(s, false);
  // Trailing non-numeric suffix: "AT300-XYZ" → base style "AT300" as a fallback. Synced
  // skus can also spell out the whole colorway NAME ("AT101-BLACK-WHITE",
  // "AT101-MEDIUM-GREY-HEATHER-BLACK"), so strip trailing word segments all the way down to
  // the base style. Only the full base is offered — an intermediate prefix ("AT101-BLACK")
  // never names an S&S style, and a fuzzy first-hit on one could land the wrong garment.
  let base = numericColorSuffix ? s.slice(0, dash) : s;
  for (let d = base.lastIndexOf('-'); d > 0 && /^[A-Z]+$/.test(base.slice(d + 1)); d = base.lastIndexOf('-')) base = base.slice(0, d);
  if (base !== s) add(base, false);
  // Leading 1–3 letter brand prefix on a numeric style: "BC3945" → "3945", "NL3600" → "3600".
  const m = /^([A-Z]{1,3})(\d[A-Z0-9]*)$/.exec(s);
  if (m) add(m[2], true, SS_BRAND_BY_PREFIX[m[1]]);
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
