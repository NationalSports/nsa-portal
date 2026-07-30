// Pure color-matching helpers for vendor Part ID / SKU resolution.
//
// Kept dependency-free (no React, no network) so it can be unit-tested in isolation and
// shared by vendorApis.js. See sanmarResolvePartIds for the SanMar Part ID (Unique_Key)
// resolver that uses these.

// Color words: split on any non-alphanumeric run. "Forest Green" -> ['FOREST','GREEN'].
export const smColorTokens = (s) =>
  String(s ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

// A vendor color safely matches the order color ONLY when the vendor's words are a SUBSET of
// the order's — i.e. the vendor carries a shorter spelling of the same color ("Forest" for an
// order's "Forest Green"), never the reverse. This never lets a generic order color ("Green")
// grab a more-specific vendor colorway ("Forest Green"). Both sides must be non-empty.
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
