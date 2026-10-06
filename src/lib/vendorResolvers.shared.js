// The portal and automated purchasing use the same SKU resolution rules.
const { normSzName } = require('./sizeNames.shared');
const { smColorSubset, smSizeMatch, ssStyleSearchVariants } = require('./vendorColorMatch.shared');
const _smNorm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Size match key. Run the size through normSzName first so an order's gendered
// label ("Mens S", "Women's L", "Youth M") collapses to the bare size SanMar
// returns ("S"/"L"/"M") before stripping punctuation — otherwise "MENSS" never
// equals "S" and every gendered line is left without a partId (blocked PO).
const _smSizeNorm = (s) => _smNorm(normSzName(s));
const _smColor = (bi) => bi.catalogColor || bi.color || bi.colorName || bi.millColor || bi.colorCode || '';
const _smSize = (bi) => bi.size || bi.sizeName || bi.apparelSize || bi.sizeCode || '';
const _smKey = (r, bi) => String(bi.uniqueKey || bi.Unique_Key || bi.UniqueKey || r.uniqueKey || r.Unique_Key || '');


function createVendorResolvers({ sanmarGetProduct, ssApiCall }) {
const sanmarResolvePartIds = async (descriptors) => {
  const resolved = {};
  const candidates = {};
  const styles = [...new Set((descriptors || [])
    .map(d => String(d.style || '').toUpperCase().trim()).filter(Boolean))];
  for (const style of styles) {
    const cand = [];
    const map = {}; // normalized "color|size" -> uniqueKey
    const addItems = (items) => {
      for (const r of (items || [])) {
        const bi = r.productBasicInfo || r;
        const uk = _smKey(r, bi); if (!uk) continue;
        const color = _smColor(bi), size = _smSize(bi);
        cand.push({ color, size, uniqueKey: uk });
        const mk = _smNorm(color) + '|' + _smSizeNorm(size);
        if (color && size && !(mk in map)) map[mk] = uk;
      }
    };
    // One call per style returns every color/size variant with its Unique_Key.
    try { const d = await sanmarGetProduct(style); addItems(d && d.items); }
    catch (e) { console.warn('[SanMar] partId lookup failed for', style, e.message); }
    const mine = descriptors.filter(d => String(d.style || '').toUpperCase().trim() === style);
    for (const d of mine) {
      const mk = _smNorm(d.color) + '|' + _smSizeNorm(d.size);
      if (map[mk]) resolved[d.key] = map[mk];
    }
    // Fallback: size-specific query for any line the bulk lookup didn't resolve
    // (covers styles whose bulk response omits per-size rows).
    for (const d of mine) {
      if (resolved[d.key]) continue;
      try {
        const dd = await sanmarGetProduct(style, d.color, d.size);
        const items = (dd && dd.items) || [];
        addItems(items);
        for (const r of items) {
          const bi = r.productBasicInfo || r;
          if (_smNorm(_smColor(bi)) === _smNorm(d.color) && _smSizeNorm(_smSize(bi)) === _smSizeNorm(d.size)) {
            const uk = _smKey(r, bi); if (uk) { resolved[d.key] = uk; break; }
          }
        }
      } catch (e) { /* leave unresolved — never guess */ }
    }
    // Safe fuzzy fallback for lines the exact match missed. Two vendor-naming gaps remain
    // once spacing is ignored: (1) the same color spelled with extra qualifier words — an
    // order built off an S&S/other feed carries "Forest Green" while SanMar lists "Forest";
    // (2) youth-only styles (18500B) that SanMar lists with a bare size ("S") against an
    // order's youth label ("YS"). Assign ONLY when exactly one SanMar Unique_Key qualifies;
    // any ambiguity (0 or >1 keys) leaves the line blank so the rep orders it manually — this
    // must never risk shipping the wrong colorway or size.
    for (const d of mine) {
      if (resolved[d.key]) continue;
      const dsz = _smSizeNorm(d.size);
      const keys = new Set();
      let hit = '';
      for (const c of cand) {
        if (!smSizeMatch(dsz, _smSizeNorm(c.size))) continue;
        if (!smColorSubset(c.color, d.color)) continue;
        if (c.uniqueKey) { keys.add(c.uniqueKey); hit = c.uniqueKey; }
      }
      if (keys.size === 1) resolved[d.key] = hit;
    }
    const seen = new Set();
    candidates[style] = cand.filter(c => { const k = c.color + '|' + c.size; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  return { resolved, candidates };
};

const ssResolveSkus = async (descriptors) => {
  const resolved = {};
  const candidates = {};
  const styles = [...new Set((descriptors || []).map(d => String(d.style || '').toUpperCase().trim()).filter(Boolean))];
  // One lookup per distinct SEARCH CODE, not per style code. Our synced skus carry the
  // colorway ("A231-00/-09/-50/-70" are four styles here but one S&S style "A231"), so
  // without this a four-colorway polo fires the same /Styles+/Products pair four times.
  // Live cost of that: batch PO 57402 SFGO's 15 style codes collapse to 7 real lookups —
  // the un-deduped burst is what put the modal over S&S's 60 req/min limit, and a
  // throttled lookup is indistinguishable from "no such style" downstream.
  const itemCache = new Map();
  // Styles whose lookup ERRORED (throttle/outage) as opposed to genuinely not matching.
  // The caller must be able to tell those apart: "S&S has no such colorway" is a data
  // problem the rep fixes by hand; "we never got an answer" is one they fix by retrying.
  const lookupErrors = new Map();

  // Circuit breaker. Each failing lookup now costs up to three backoff sleeps, so on a truly
  // throttled account a 15-style batch could sit there for minutes retrying calls that are all
  // going to fail. Two failures in a row means it's the account, not the style: stop calling,
  // mark the rest as unanswered, and let the rep retry once the window resets.
  let consecutiveFailures = 0;
  // Memoized wrapper — see itemCache above for why the cache is the point, not an optimization.
  const fetchItems = async (variant) => {
    const ck = variant.code + '|' + (variant.strict ? '1' : '0') + '|' + (variant.brand || '');
    if (itemCache.has(ck)) return itemCache.get(ck);
    if (consecutiveFailures >= 2) { lookupErrors.set(variant.code, 'skipped — S&S lookups are failing (rate limit or outage); retry in a minute'); return []; }
    const before = lookupErrors.size;
    const items = await fetchItemsUncached(variant);
    if (lookupErrors.size > before) consecutiveFailures += 1; else consecutiveFailures = 0;
    itemCache.set(ck, items);
    return items;
  };
  // Fetch a style's S&S products by a search code. S&S /Products?style= expects a numeric
  // styleID, not the style name — so resolve the styleID first via /Styles?search= (the same
  // path our other S&S lookups use), then fetch that style's products.
  //  - not strict (the exact code / suffix-trimmed code): first returned style, as before.
  //  - strict (a prefix-stripped bare number): never the first fuzzy result. When the brand is
  //    known (from the stripped prefix) pin to the S&S style of THAT brand — a bare number can
  //    belong to several brands ("1580" is Next Level's crop top AND another brand's style), so
  //    picking by brand yields ours, not whichever S&S lists first. With no brand (or none of
  //    the exact hits carry it) accept the exact match only when it's unambiguous (exactly one),
  //    so a shared number is left blocked rather than guessed.
  const fetchItemsUncached = async ({ code, strict, brand }) => {
    try {
      const styleList = await ssApiCall('/Styles?search=' + encodeURIComponent(code));
      const sa = Array.isArray(styleList) ? styleList : (styleList ? [styleList] : []);
      let match;
      if (!strict) {
        match = sa.find(s => _smNorm(s.partNumber) === _smNorm(code) || _smNorm(s.styleName) === _smNorm(code)) || sa[0];
      } else {
        const exacts = sa.filter(s => _smNorm(s.partNumber) === _smNorm(code) || _smNorm(s.styleName) === _smNorm(code));
        let chosen = null;
        if (brand) {
          const bn = _smNorm(brand);
          const branded = exacts.filter(s => { const sb = _smNorm(s.brandName || s.BrandName); return sb && (sb.includes(bn) || bn.includes(sb)); });
          if (branded.length) chosen = branded[0];
        }
        // No brand, or the brand didn't match any exact hit: use the exact match only if there's
        // exactly one (a number shared across brands stays blocked, never guessed).
        if (!chosen && exacts.length === 1) chosen = exacts[0];
        match = chosen;
      }
      const styleID = match && (match.styleID || match.StyleID);
      if (!styleID) return [];
      const data = await ssApiCall('/Products/?style=' + encodeURIComponent(styleID));
      return Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) { console.warn('[S&S] SKU lookup failed for', code, e.message); lookupErrors.set(code, e.message || 'lookup failed'); return []; }
  };

  const erroredStyles = new Set();
  for (const style of styles) {
    const mine = descriptors.filter(d => String(d.style || '').toUpperCase().trim() === style);
    const cand = [];
    candidates[style] = cand;
    for (const variant of ssStyleSearchVariants(style)) {
      if (mine.every(d => resolved[d.key])) break; // all lines matched — no looser search needed
      const items = await fetchItems(variant);
      if (lookupErrors.has(variant.code)) erroredStyles.add(style);
      const map = {}; // normalized "color|size" -> sku, from this variant's products
      for (const r of items) {
        const sku = String(r.sku || r.Sku || r.gtin || '');
        if (!sku) continue;
        const color = r.colorName || r.color || '';
        const size = r.sizeName || r.size || '';
        cand.push({ color, size, sku });
        const mk = _smNorm(color) + '|' + _smSizeNorm(size);
        if (color && size && !(mk in map)) map[mk] = sku;
      }
      for (const d of mine) {
        if (resolved[d.key]) continue;
        const mk = _smNorm(d.color) + '|' + _smSizeNorm(d.size);
        if (map[mk]) resolved[d.key] = map[mk];
      }
    }
    // Safe fuzzy fallback for lines the exact color+size match missed — same rule the SanMar
    // resolver uses. It closes two vendor-naming gaps once spacing/case is ignored: (1) the
    // order color carries extra qualifier words S&S abbreviates ("Green/White Pl" vs S&S's
    // "Green/ White Plaid"); (2) youth sizes labelled "YL"/"YS" against a bare "L"/"S".
    // smColorSubset is one-directional (S&S's words must be a subset of the order's, never the
    // reverse) and we assign ONLY when exactly one S&S sku qualifies — any ambiguity leaves the
    // line blank so it's ordered manually. Never risk shipping the wrong colorway or size.
    for (const d of mine) {
      if (resolved[d.key]) continue;
      const dsz = _smSizeNorm(d.size);
      const skus = new Set();
      let hit = '';
      for (const c of cand) {
        if (!c.sku) continue;
        if (!smSizeMatch(dsz, _smSizeNorm(c.size))) continue;
        if (!smColorSubset(c.color, d.color)) continue;
        skus.add(c.sku); hit = c.sku;
      }
      if (skus.size === 1) resolved[d.key] = hit;
    }
  }
  // failedStyles: styles we never got an answer for. Only report the ones still unresolved —
  // a style that errored on one variant and matched on another is not a failure.
  const failedStyles = [...erroredStyles].filter(st => descriptors.some(d =>
    String(d.style || '').toUpperCase().trim() === st && !resolved[d.key]));
  return { resolved, candidates, failedStyles, lookupError: failedStyles.length ? (lookupErrors.values().next().value || '') : '' };
};


return { sanmarResolvePartIds, ssResolveSkus };
}
module.exports = { createVendorResolvers };
