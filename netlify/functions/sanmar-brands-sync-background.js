// Background function (15-min limit): syncs SanMar styles into the portal so the
// public Team Catalog (/adidas, /livelook) shows SanMar-sourced styles with
// images, sizes, and live inventory. Ingests the team-relevant SanMar brands
// (excludes Nike & Richardson — own feeds — plus a few off-profile long-tail
// lines; see EXCLUDE_BRAND_RE). On LiveLook these surface under the "Non Branded"
// filter while each card keeps its real brand.
//
// SanMar's API is style-number-gated (no "list by brand" endpoint), so the
// style set is seeded from:
//   1. The sanmar_style_seeds table. This sync REFRESHES that table itself at the
//      start of every run by paging sanmarsports.com/products.json (the dealer's
//      public Shopify catalog, ~3k+ styles) — so new SanMar styles flow into the
//      catalog automatically and the seed list can't silently go stale. Best-effort:
//      a fetch failure just falls back to the seeds already on file.
//   2. Products already SanMar-sourced in the DB (refresh runs on every sync)
//   3. The SANMAR_BRAND_STYLES env var — a comma-separated list of style
//      numbers to add (e.g. "K500,PC61,DT6000,3001C")
// Styles without one of THIS sync's own rows (id 'smb-…') are processed first so
// the 15-min budget always makes forward progress; already-synced styles refresh
// afterward. Priority keys off 'smb-' specifically, not any sanmar row, so a style
// that only has hand-added 'sm-…' rows (e.g. a manual quick-add) still counts as
// not-yet-synced and gets its full color set built instead of being stuck at the
// back of the queue forever. Large seed sets converge over several runs.
//
// On-demand: POST { "styles": ["PC90H","PC55"] } runs a TARGETED pass over exactly
// those styles (skips the seed refresh and the S&S cutover) — for backfilling or
// validating specific styles without waiting for the daily full pass.
//
// Writes:
//   products        — one row per style+color, id 'smb-{style}-{colorCode}',
//                     brand = SanMar brandName, vendor_id = SanMar vendor,
//                     MAP/MSRP as retail, piece price as nsa_cost,
//                     catalog_sell_price = cost × 1.65
//   sanmar_inventory — per sku+size stock from PromoStandards getInventoryLevels
//
// Triggered by sanmar-brands-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/sanmar-brands-sync-background
//
// Env: SANMAR_BRAND_STYLES (optional seed), URL,
//      REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      (SANMAR_USERNAME + SANMAR_PASSWORD are used inside sanmar-proxy)

// We ingest the team-relevant SanMar brands and exclude:
//   • Nike, Richardson — have their own dedicated feeds (avoid dup cards); Nike
//     stays branded "Nike", Richardson keeps its own live feed.
//   • Off-profile "long tail" lines (resort / dress / industrial workwear /
//     lifestyle) — trimmed to keep the Non Branded catalog tight for a team
//     dealer: tentree, Tommy Bahama, Red Kap, Stanley/Stella, Brooks Brothers.
//     (Seeds keep the full site list; this only gates ingest.)
// Everything else (Port Authority, Sport-Tek, District, Bella+Canvas, Gildan,
// New Era, OGIO, Eddie Bauer, North Face, Carhartt, TravisMathew, …) is pulled in.
const EXCLUDE_BRAND_RE = /nike|richardson|tentree|tommy\s*bahama|red\s*kap|stanley|brooks\s*brothers/i;

const CATEGORY_RULES = [
  ['1/4 Zips', /QUARTER[- ]ZIP|1\/4[- ]ZIP/i],
  ['Outerwear', /FULL[- ]ZIP|JACKET|VEST|WINDBREAKER|OUTERWEAR|RAIN/i],
  ['Polos', /POLO/i],
  ['Hats', /HEADWEAR|\bCAP\b|BEANIE|VISOR/i],
  ['Crew', /CREW/i],
  ['Hoods', /HOOD|FLEECE|SWEATSHIRT|PULLOVER/i],
  ['Shorts', /SHORT/i],
  ['Pants', /PANT|LEGGING|BOTTOM|JOGGER|TIGHT/i],
  ['Tees', /T-SHIRT|\bTEE\b|ACTIVEWEAR/i],
  ['Bags', /\bBAG\b|BACKPACK|DUFFEL|SACKPACK/i],
  ['Socks', /\bSOCK\b/i],
  ['Accessories', /ACCESSOR|GLOVE|SCARF|TOWEL|SLEEVE/i],
];
function mapCategory(title) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(String(title || ''))) return cat;
  return 'Other';
}
function canonicalBrand(name) {
  const n = String(name || '');
  if (/port\s*authority/i.test(n)) return 'Port Authority';
  if (/sport-?tek/i.test(n)) return 'Sport-Tek';
  if (/^district$/i.test(n)) return 'District';
  if (/bella\+?canvas/i.test(n)) return 'Bella+Canvas';
  // Match the S&S canonical name exactly so the S&S→SanMar cutover finds the
  // old rows to retire (S&S maps Gildan + Jerzees → "Gildan").
  if (/gildan/i.test(n)) return 'Gildan';
  return (n || 'Other').trim();
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

exports.handler = async (event) => {
  const site  = (process.env.URL || '').replace(/\/+$/, '');
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Optional targeted run: POST { "styles": ["PC90H","PC55"] } ingests exactly those
  // styles and nothing else (skips the seed refresh and the S&S cutover). Used to
  // backfill / validate specific styles on demand without waiting for the daily pass
  // to grind through the full ~3k-style queue.
  let targetStyles = [];
  try {
    const body = event && event.body ? JSON.parse(event.body) : null;
    if (body && Array.isArray(body.styles)) {
      targetStyles = body.styles.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean);
    }
  } catch { /* ignore malformed body — fall through to a normal full run */ }
  const targeted = targetStyles.length > 0;
  if (!site || !sbUrl || !sbKey) {
    console.error('[sanmar-brands-sync] missing config');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sm = async (service, action, body, tries = 3) => {
    let lastErr;
    for (let t = 0; t < tries; t++) {
      try {
        const res = await fetch(site + '/.netlify/functions/sanmar-proxy?service=' + service + '&action=' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET || sbKey },
          body: JSON.stringify(body || {}),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(service + '/' + action + ': ' + (j.error || res.status));
        return j;
      } catch (e) { lastErr = e; if (t < tries - 1) await sleep(600 * (t + 1)); }
    }
    throw lastErr;
  };

  // Refresh sanmar_style_seeds from sanmarsports.com/products.json (the dealer's
  // public Shopify catalog). `handle` is the style number (e.g. "pc90h" → PC90H),
  // `vendor` is the brand. Idempotent — upsert on style (PK), never deletes, so a
  // short/partial pull only adds fewer styles (never loses any). A page that fails
  // after retries is skipped, not treated as the end, so one flaky page can't
  // truncate the whole pull. Whole thing is best-effort: on total failure we keep
  // the seeds already on file.
  const refreshSeeds = async () => {
    const seen = new Map(); // STYLE -> brand (vendor as-is; brand filter matches substrings either way)
    let pages = 0;
    for (let page = 1; page <= 40; page++) {
      let ok = false, prods = [];
      for (let t = 0; t < 4 && !ok; t++) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 30000);
          const res = await fetch('https://sanmarsports.com/products.json?limit=250&page=' + page, {
            headers: { 'User-Agent': 'Mozilla/5.0 (nsa-portal seed sync)' }, signal: ctrl.signal,
          }).finally(() => clearTimeout(to));
          if (res.ok) { const d = await res.json(); prods = arr(d && d.products); ok = true; }
        } catch { /* transient — retry */ }
        if (!ok) await sleep(1500 * (t + 1));
      }
      if (!ok) { console.warn('[sanmar-brands-sync] seed page', page, 'failed after retries — skipping'); continue; }
      if (!prods.length) break; // a successful, empty page is the real end of the catalog
      pages++;
      for (const p of prods) {
        const style = String(p.handle || '').trim().toUpperCase();
        if (style && !seen.has(style)) seen.set(style, String(p.vendor || '').trim());
      }
      await sleep(300);
    }
    if (!seen.size) { console.warn('[sanmar-brands-sync] seed refresh pulled 0 styles — using existing seeds'); return; }
    const nowIso = new Date().toISOString();
    const rows = [...seen].map(([style, brand]) => ({ style, brand, source: 'shopify_api', scraped_at: nowIso }));
    let upserted = 0;
    for (let j = 0; j < rows.length; j += 500) {
      const r = await sb('sanmar_style_seeds?on_conflict=style', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(j, j + 500)),
      });
      if (!r.ok) { console.warn('[sanmar-brands-sync] seed upsert', r.status, (await r.text()).slice(0, 200)); break; }
      upserted += rows.slice(j, j + 500).length;
    }
    console.log('[sanmar-brands-sync] seed refresh: ' + pages + ' pages, ' + upserted + ' styles upserted from sanmarsports.com');
  };

  try {
    // SanMar vendor id
    const vRes = await sb('vendors?api_provider=eq.sanmar&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No SanMar vendor configured' };

    // Keep the seed list current before we read it — best-effort, never fatal.
    // Skipped on a targeted run (we already know exactly which styles to do).
    if (!targeted) {
      try { await refreshSeeds(); } catch (e) { console.warn('[sanmar-brands-sync] seed refresh failed (non-fatal):', e.message); }
    }

    // Style list: existing SanMar-sourced products (refresh) + DB seeds + env seed
    const existing = await (await sb('products?vendor_id=eq.' + vendorId + '&inventory_source=eq.sanmar&select=id,sku')).json();
    const dbSeeds = await (await sb('sanmar_style_seeds?select=style,brand')).json();
    const styleOf = (sku) => String(sku || '').split('-')[0].trim();
    const seed = (process.env.SANMAR_BRAND_STYLES || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Skip seeds for the dedicated-feed brands (Nike/Richardson); seeds with no
    // brand recorded are always tried.
    const seedStyles = arr(dbSeeds).filter((r) => !EXCLUDE_BRAND_RE.test(r.brand || '')).map((r) => r.style);
    const existingStyles = arr(existing).map((p) => styleOf(p.sku)).filter(Boolean);
    // Prioritise by THIS sync's own rows (id 'smb-…'), not by any sanmar row. A style
    // that only has hand-added 'sm-…' rows (a different id scheme, e.g. from a manual
    // quick-add or an old catalog import) has never been through this sync and still
    // needs its full color set built — but it *looks* "already synced" if we key off
    // every sanmar row, so it gets sorted to the back and, at ~200 styles/run, never
    // reached. Keying off 'smb-' keeps those styles in the priority (new) bucket.
    const smbSet = new Set(arr(existing).filter((p) => String(p.id).startsWith('smb-')).map((p) => styleOf(p.sku)).filter(Boolean));
    // New (no smb- row yet) styles go first so first-time ingest wins the 15-min
    // budget; already-synced styles refresh afterward and roll forward run to run.
    const newStyles = [...seedStyles, ...seed].filter((s) => s && !smbSet.has(s));
    const styles = targeted ? targetStyles : [...new Set([...newStyles, ...existingStyles])];
    console.log('[sanmar-brands-sync]', targeted ? 'TARGETED run —' : 'styles to sync:', styles.length, seed.length ? '(seed: ' + seed.length + ')' : '');
    if (!styles.length) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No brand styles to sync. Add SanMar style numbers to SANMAR_BRAND_STYLES env var (e.g. "K500,PC61,DT6000,3001C") to seed the catalog.', styles: 0 }) };
    }

    let productsUpserted = 0, invRows = 0;
    const errors = [];
    const syncedBrands = new Set(); // brands actually ingested this run (drives the S&S cutover)

    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      try {
        if (i > 0) await sleep(900);
        const prod = await sm('product', 'getProductInfoByStyleColorSize', { style, color: '', size: '' });
        const items = arr(prod.items).map((raw) => ({ ...(raw.productBasicInfo || {}), ...(raw.productImageInfo || {}), ...(raw.productPriceInfo || {}), ...raw }));
        if (!items.length) continue;

        // Skip brands that have their own dedicated feed (Nike, Richardson).
        const brandText = String(items[0].brandName || items[0].brand || '');
        if (EXCLUDE_BRAND_RE.test(brandText)) {
          console.warn('[sanmar-brands-sync] style', style, 'is dedicated-feed brand "' + brandText + '" — skip');
          continue;
        }
        const brand = canonicalBrand(brandText);

        // Inventory
        const stockByCS = {};
        try {
          const inv = await sm('promostandards', 'getInventoryLevels', { productId: style });
          const variations = arr(
            inv?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory ||
            inv?.ProductVariationInventoryArray?.ProductVariationInventory ||
            inv?.inventory || inv?.items
          );
          variations.forEach((v) => {
            const color = String(v?.attributeColor || v?.color || '').toLowerCase();
            const size  = String(v?.attributeSize || v?.size || v?.labelSize || 'OSFA').trim();
            let qty = 0;
            const parts = arr(v?.partInventoryArray?.partInventory || v?.PartInventoryArray?.PartInventory);
            parts.forEach((p) => { qty += num(p?.quantityAvailable?.Quantity || p?.quantityAvailable?.quantity || p?.quantityAvailable); });
            if (qty <= 0) qty = num(v?.quantityAvailable || v?.totalQty || v?.qty);
            if (qty > 0) stockByCS[color + '|' + size] = (stockByCS[color + '|' + size] || 0) + qty;
          });
        } catch (e) { console.warn('[sanmar-brands-sync] inventory', style, e.message); }

        const byColor = {};
        for (const it of items) {
          const colorName = it.colorName || it.color || it.catalogColor || 'NA';
          const code = String(it.colorCode || colorName).replace(/\s+/g, '');
          (byColor[code] = byColor[code] || { colorName, recs: [] }).recs.push(it);
        }
        const prodRows = [], invUpserts = [];
        for (const [colorCode, grp] of Object.entries(byColor)) {
          const recs = grp.recs, r0 = recs[0];
          const sku = style + '-' + colorCode;
          const sizes = [...new Set(recs.map((r) => String(r.size || r.labelSize || '').trim()).filter(Boolean))];
          // Our real per-size cost: the sale/program price when SanMar has one, else the
          // piece price. Base cost = the LOWEST size's price (the XS–XL tier) — recs[0] is
          // whatever size SanMar lists first (often an upsized 2XL+ row), which inflated
          // nsa_cost for every color (e.g. LPC380 stored 4.52 vs the real 3.05 base).
          const costOf = (r) => num(r.myPrice) || num(r.salePrice) || num(r.piecePrice) || num(r.customerPrice) || num(r.casePrice);
          const _perSize = recs.map(costOf).filter((c) => c > 0);
          const cost   = _perSize.length ? Math.min(..._perSize) : 0;
          const retail = num(r0.msrp || r0.mapPrice) || num(r0.piecePrice) || (cost > 0 ? Math.round(cost * 2) : 0);
          // Per-size cost (2XL/3XL+ often run higher). Capture only sizes that differ from
          // the base; nsa_cost stays the base, size_costs is null when uniform.
          const _scMap = {};
          for (const r of recs) { const sz = String(r.size || r.labelSize || '').trim(); const sc = costOf(r); if (sz && sc > 0 && _scMap[sz] == null) _scMap[sz] = sc; }
          const sizeCosts = {};
          for (const [sz, sc] of Object.entries(_scMap)) { if (Math.abs(sc - cost) > 0.001) sizeCosts[sz] = sc; }
          const img    = r0.colorProductImage || r0.productImage || r0.colorProductImageThumbnail || r0.thumbnailImage || '';
          // SanMar prefixes retired styles with "DISCONTINUED" — strip it (still sells from stock).
          const title  = (r0.productTitle || r0.productDescription || (style + ' ' + grp.colorName)).replace(/DISCONTINUED/ig, '').replace(/\s{2,}/g, ' ').trim();
          prodRows.push({
            id: 'smb-' + sku,
            vendor_id: vendorId,
            sku,
            name: brand + ' ' + title,
            brand,
            color: grp.colorName,
            category: mapCategory(title),
            retail_price: retail,
            nsa_cost: cost,
            size_costs: Object.keys(sizeCosts).length ? sizeCosts : null,
            catalog_sell_price: cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img || null,
            inventory_source: 'sanmar',
          });
          for (const size of sizes) {
            const key = String(grp.colorName).toLowerCase() + '|' + size;
            invUpserts.push({
              id: sku + '-' + size, sku, size, stock_qty: stockByCS[key] || 0,
              last_synced: new Date().toISOString(), source: 'sanmar',
              style_number: style, color_code: colorCode,
            });
          }
        }

        const pr = await sb('products?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(prodRows),
        });
        if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
        productsUpserted += prodRows.length;
        if (prodRows.length) syncedBrands.add(brand);

        for (let j = 0; j < invUpserts.length; j += 500) {
          const ir = await sb('sanmar_inventory?on_conflict=sku,size', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('sanmar_inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push(style + ': ' + e.message);
        if (errors.length > 90) break;
      }
    }

    // Cutover: now that SanMar is the source for these brands, retire the old
    // S&S rows for any brand we actually ingested this run (e.g. Gildan moves
    // from S&S → SanMar). Scoped to synced brands only, so a brand we didn't
    // reach this run keeps its existing rows — no empty gap. Boxercraft stays on
    // S&S because SanMar doesn't carry it (never enters syncedBrands).
    // Skipped on a targeted run: a handful of styles is not a full brand pass, so
    // it must not retire that brand's S&S rows wholesale.
    let ssRetired = 0;
    if (!targeted && syncedBrands.size) {
      const inList = [...syncedBrands].map((b) => '"' + String(b).replace(/"/g, '') + '"').join(',');
      const cr = await sb('products?inventory_source=eq.ss_activewear&is_active=eq.true&brand=in.(' + inList + ')', {
        method: 'PATCH', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (cr.ok) { const rows = await cr.json().catch(() => []); ssRetired = Array.isArray(rows) ? rows.length : 0; }
      else console.warn('[sanmar-brands-sync] S&S cutover failed', cr.status, (await cr.text()).slice(0, 200));
    }

    console.log('[sanmar-brands-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', ssRetired, 'S&S rows retired,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ targeted, styles: styles.length, products: productsUpserted, inventory_rows: invRows, ss_retired: ssRetired, synced_brands: [...syncedBrands], errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[sanmar-brands-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
