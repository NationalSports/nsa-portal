// ── Garment photos for the API-catalog vendors (SanMar, S&S, Richardson, Momentec) ──
//
// Those four vendors are excluded from the in-memory `prod` catalog on purpose: together
// they are ~50k rows and pushed the client load past its 20k cap, hiding later-alphabet
// SKUs from search (see API_CATALOG_VENDOR_IDS in lib/dbEngine.js). Their rows stay in the
// DB, kept current by the nightly Netlify syncs — the browser just never downloads them.
//
// The consequence nobody wired around: an order line for one of these vendors is saved at
// STYLE level (sku 'ST850', color 'True Navy', product_id null) while the photo lives on the
// per-COLOR row ('ST850-TrueNavy'). The editors resolve a line's product by exact sku/id
// (buildProductIndex), so the lookup missed twice over — wrong sku shape AND the row not
// loaded — and the Quick Mock Builder showed "Not in system" for every SanMar/S&S garment.
// A rep then hand-uploaded a photo the catalog already had, on every mock, every time.
//
// These helpers bridge it: given a style-level line, build the PostgREST filter that fetches
// just that style's colorway rows (~15, not 50k), then resolve the line's own color to its
// photo. Pure and synchronous — the fetching/caching lives in the caller.
//
// Everything here prefers the GARMENT-ONLY ("flat"/"form") photo over model photography: a
// mockup is a picture of the decoration, and a model's face and pose fight the art. SanMar
// publishes flats in image_flat_front_url/image_flat_back_url (scraped by
// sanmar-flat-images-background.js; migration 075's trigger also mirrors them into
// image_front_url), and S&S's own colorFrontImage is already a laydown. Where a vendor has
// published no flat, model photography is still better than an empty canvas, so it is used
// as the fallback rather than treated as "no image".

// Vendors whose catalogs are NOT in the client-side `prod` array. Mirrors
// API_CATALOG_VENDOR_IDS in lib/dbEngine.js — keep the two in sync.
export const API_CATALOG_VENDOR_IDS = ['v3', 'v4', 'v5', 'v8'];
export const isApiCatalogVendor = (vendorId) => !!vendorId && API_CATALOG_VENDOR_IDS.includes(String(vendorId));

// Color names arrive spelled differently on the line and in the catalog ('True Navy' vs
// 'TrueNavy', 'Black/ White' vs 'Black/White'), so compare on letters and digits only.
export const colorKey = (c) => String(c == null ? '' : c).toLowerCase().replace(/[^a-z0-9]/g, '');

// There is deliberately NO "any colorway of this style" fallback. The mock canvas is
// exported as the composite the coach approves, so a right-garment/wrong-color photo would
// ship a navy mockup for a red order — the silent wrong-colorway class the 2026-07 art
// audits closed (see linkSwappedGarmentMock, which links a mock only on an exact color
// match). An unmatched color falls through to the existing upload prompt instead.

// A style sku is only interpolated into a PostgREST filter when it is plainly safe: letters,
// digits, dot, underscore and dash. Anything else (a comma, a quote, a '%' or '*' wildcard)
// would change the meaning of the filter, so those styles simply don't get bridged.
const SAFE_SKU = /^[A-Za-z0-9._-]+$/;

// PostgREST `or` filter selecting a style's own row plus its per-color rows. The separator
// is anchored ('ST850-*' / 'ST850.*', never 'ST850*') because a bare prefix would also match
// a DIFFERENT style — 'ST850' would drag in ST8500 and put the wrong garment on the mock.
// SanMar and S&S use '-', Momentec uses '.'; covering both keeps this one code path.
export const styleSkuOrFilter = (sku) => {
  const s = String(sku == null ? '' : sku).trim();
  if (!s || !SAFE_SKU.test(s)) return null;
  return `sku.eq."${s}",sku.like."${s}-*",sku.like."${s}.*"`;
};

// Build { colorKey: {front, back, id, sku} } from fetched colorway rows. Accepts DB column
// names (image_flat_front_url/image_front_url) and the in-memory mirror names
// (image_url/back_image_url) so it works on either shape. Rows with no front image are
// skipped: a back-only row would mock the front with nothing.
// Colors the style HAS but has no photo for. Kept under a key colorKey() can never produce
// (it strips the underscore), so it cannot collide with a real color. Without it, a line in
// 'Red' whose own catalog row simply lacks a photo would fall through to the spelling match
// and land on 'Red Frost' — a different garment color on a mockup the coach then approves.
export const NO_IMAGE_KEY = '_noImageColors';

export const buildStyleColorwayMap = (rows) => {
  const map = {};
  const noImage = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r) return;
    const k = colorKey(r.color);
    if (!k) return;
    const front = r.image_flat_front_url || r.image_front_url || r.image_url || null;
    if (!front) { noImage.push(k); return; }
    const back = r.image_flat_back_url || r.image_back_url || r.back_image_url || null;
    const entry = {front, back: back || null, id: r.id || null, sku: r.sku || null};
    // First row wins per color, matching Array.find semantics everywhere else in the editors.
    if (!map[k]) map[k] = entry;
  });
  if (noImage.length) Object.defineProperty(map, NO_IMAGE_KEY, {value: noImage, enumerable: false});
  return map;
};

// ── Abbreviated color names ─────────────────────────────────────────────────────────────
// SanMar's order feed abbreviates ('HtdChar', 'VtgWhite', 'GdnaW/Grvl') where the catalog
// carries the full name ('Heathered Charcoal', 'Vintage White', 'Gardenia White/ Gravel').
// Measured against real order lines, that alone accounted for 93 of 258 unresolved garments.
// The matcher below is ported from sanmar-flat-images-background.js, which has been pairing
// these same two spellings in production; its conservatism is the point, and is kept intact.

// In-order subsequence test: an abbreviation drops letters but never reorders them. The
// length floor stops a tiny code ('Bk') matching almost any long name.
const isAbbrevOf = (code, name) => {
  if (!code || !name || code.length > name.length || code.length * 3 < name.length) return false;
  let i = 0;
  for (const ch of name) { if (ch === code[i]) i++; if (i === code.length) return true; }
  return false;
};

// Character-bigram Dice coefficient (0..1) — tolerates the feed's occasional typos and
// variants ('Blust Frost' vs 'Blush Frost') without the false matches a substring test gives.
const dice = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let inter = 0;
  for (const [g, n] of A) if (B.has(g)) inter += Math.min(n, B.get(g));
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
};

// Pick the catalog color key that best matches the line's color. An exact or abbreviation
// match wins outright; otherwise the closest spelling, but ONLY when it clears a high bar AND
// clearly beats the runner-up. A wrong-color garment on an approval mockup is worse than no
// garment at all, so ambiguity resolves to no match — never to a guess.
const bestColorKey = (want, keys) => {
  const score = (k) => {
    if (k === want) return 1;
    if (isAbbrevOf(want, k) || isAbbrevOf(k, want)) return 0.9;
    return dice(want, k);
  };
  let top = null, topScore = 0, second = 0;
  for (const k of keys) {
    const sc = score(k);
    if (sc > topScore) { second = topScore; topScore = sc; top = k; }
    else if (sc > second) { second = sc; }
  }
  if (topScore >= 0.999 || (topScore >= 0.74 && topScore - second >= 0.08)) return top;
  return null;
};

// Resolve a line item's {front, back} from its style map, or null.
// Exact color first, then the conservative abbreviation/spelling match above. There is still
// NO any-colorway fallback — an unrecognized color yields null, not another color's photo.
export const lookupStyleColorway = (map, item) => {
  if (!map || !item) return null;
  const k = colorKey(item && item.color);
  if (!k) return null;
  if (map[k]) return map[k];
  // The catalog knows this exact color and simply has no photo for it — say so, rather than
  // reaching for a near-spelled DIFFERENT color.
  if ((map[NO_IMAGE_KEY] || []).includes(k)) return null;
  const near = bestColorKey(k, Object.keys(map));
  return (near && map[near]) || null;
};
