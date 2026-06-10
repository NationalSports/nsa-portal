<!--
Version-controlled REFERENCE copy of the external "adidas-inventory-sync" skill
that runs the scheduled Adidas Cowork inventory sync (it lives outside this repo,
in the Claude desktop app at ~/Documents/Claude/Scheduled/adidas-inventory-sync/SKILL.md).

This file is NOT executed by the app. It exists so the live skill can be diffed
against a known-good version. The companion spec is cowork_inventory_sync.md.

When updating the live skill, change ONLY the size-label mapping and the per-SKU
processing shown here — keep its existing Cowork login/auth, catalog pre-filter,
materials/information API helper (matCall), Supabase client, and batch runner.
-->

---
name: adidas-inventory-sync
description: Sync Adidas Cowork B2B inventory into Supabase `adidas_inventory` — current stock, next-delivery date, and projected future quantity per SKU/size.
---

# Adidas Inventory Sync

Keep `adidas_inventory` current from Adidas Cowork. One row per SKU+size:
`stock_qty`, `future_delivery_date`, `future_delivery_qty`, `last_synced`, `source`.

> KEEP AS-IS from the current skill: Cowork login/auth, the catalog pre-filter
> that finds which SKUs are on B2B, the materials/information API helper
> (`matCall`), the Supabase client, and the batch/queue runner. Only the
> size-label mapping and the per-SKU processing below change.

## Size labels — build COMPLETE maps (resolve before processing)

Each numeric size code (e.g. `220`) maps to a label (`XL`) per the SKU's
conversionId, read from the product page's SizeBar
(`[id^="CartModule-SizeBar-SizeTranslation-<cid>-"]`). Two failure modes to avoid:
slow pages timing out the loader, and a single example SKU not exposing the
conversionId's full size run (extended/tall sizes then fall back to raw codes
like `240`).

**(0) Load persisted maps FIRST — before any SKU is processed** — so the first write
is a label, never a raw code. The live skill folder is read-only, so the durable home
is the `adidas_size_maps` table (not `size-maps.json`):
```js
window._sizeMaps = window._sizeMaps || {};
{ const { data } = await supabase.from('adidas_size_maps').select('conversion_id, code_labels');
  (data || []).forEach(r => { window._sizeMaps[r.conversion_id] =
    { ...(r.code_labels || {}), ...(window._sizeMaps[r.conversion_id] || {}) }; }); } // union; in-memory wins ties
```

**(1) In the catalog pre-filter, record the FULL expected code set + every example per conversionId:**
```js
window._convExpected = window._convExpected || {}; // cid -> Set of size codes (UNION across all SKUs)
window._convExamples = window._convExamples || {}; // cid -> [{sku, n}]
(data.products || []).forEach(p => {
  const cid = p.conversionId; if (!cid) return;
  const codes = (p.sizes || []).map(String);
  (window._convExpected[cid] = window._convExpected[cid] || new Set());
  codes.forEach(c => window._convExpected[cid].add(c));
  (window._convExamples[cid] = window._convExamples[cid] || []).push({ sku: p.articleNumber, n: codes.length });
});
Object.values(window._convExamples).forEach(a => a.sort((x,y)=>y.n-x.n)); // richest first
```

**(2) Loader tolerance:** in the iframe loader use a **90s** timeout (slow pages)
and run **2 at a time** (not 5 — less renderer contention).

**(3) Learn each conversionId to completeness (union across examples) + one retry:**
```js
window._mapGaps = {};
window._learnConvMap = async function(cid, expected, examples){
  window._sizeMaps[cid] = window._sizeMaps[cid] || {};
  for (const ex of examples) {
    if ([...expected].every(c => c in window._sizeMaps[cid])) break;   // already complete
    let r = await window._loadSizeMap(ex.sku, cid);
    if (r.c === 0) r = await window._loadSizeMap(ex.sku, cid);         // retry transient timeout
    if (r.c > 0) Object.assign(window._sizeMaps[cid], r.m);            // MERGE, never overwrite
  }
  const missing = [...expected].filter(c => !(c in window._sizeMaps[cid]));
  if (missing.length) window._mapGaps[cid] = missing;
};
const cids = Object.keys(window._convExpected).filter(cid => cid !== '51' && !window._footwearCids?.has(cid));
for (let i=0;i<cids.length;i+=2) await Promise.all(
  cids.slice(i,i+2).map(cid => window._learnConvMap(cid, window._convExpected[cid], window._convExamples[cid] || [])));
```

- **Persist** each conversionId back to the `adidas_size_maps` table after learning
  (merge, never overwrite), so the next run/machine starts complete:
  ```js
  for (const cid of Object.keys(window._sizeMaps)) {
    await supabase.from('adidas_size_maps').upsert(
      { conversion_id: cid, code_labels: window._sizeMaps[cid], updated_at: new Date().toISOString() },
      { onConflict: 'conversion_id' });
  }
  ```
  Re-learn (and re-upsert) a conversionId whenever a richer example appears.
  localStorage may still mirror the maps for speed, but the table is the source of
  truth — a file in the read-only skill folder can't persist across runs/machines.
- **Footwear:** exclude footwear conversionIds (`window._footwearCids`, derived
  from the catalog division/product type) — their numeric codes are real labels.
- Apply `label = map[conversionId][code]`; report `window._mapGaps` (apparel codes
  still unmapped — **goal: empty**). Never silently accept a numeric apparel code
  as final.

## Per SKU
```js
const now = new Date().toISOString();
// `sizes` = sizes[code] from the SKU's default materials/information response
// `conversionId` = this SKU's size-run id; `sizeMap` = persisted code→label maps

// 1) Base row for EVERY size: current stock + next-delivery date (in stock or not)
const rows = {};
for (const [code, sd] of Object.entries(sizes)) {
  const label = sizeMap[conversionId]?.[code] || code;
  rows[code] = {
    id: `${sku}-${label}`,
    sku, size: label,
    stock_qty: sd.inventory || 0,
    future_delivery_date: sd.restockDate || null,   // saved for ALL sizes
    future_delivery_qty: null,
    last_synced: now,
    source: 'api-materials',
  };
}

// 2) Distinct restock dates among the OUT-OF-STOCK sizes
const futureDates = [...new Set(
  Object.values(rows)
    .filter(r => r.stock_qty === 0 && r.future_delivery_date)
    .map(r => r.future_delivery_date)
)];

// 3) One read-only projection call per date → fill qty for every size on that date
for (const d of futureDates) {
  try {
    const resp = await matCall([{ materialNumber: sku, requestedDeliveryDates: [d] }]);
    const day = resp[0].days[0];
    const sz = day[Object.keys(day)[0]].sizes || {};
    for (const [code, r] of Object.entries(rows)) {
      if (r.future_delivery_date === d && sz[code]?.inventory != null) {
        const v = sz[code].inventory;
        r.future_delivery_qty = (v >= 1000000) ? null : v; // store directly; sentinel → null
      }
    }
  } catch (e) { /* leave qty null for this date; continue */ }
}

// 4) Upsert (on conflict sku,size)
await supabase.from('adidas_inventory').upsert(Object.values(rows), { onConflict: 'sku,size' });

// 5) Self-heal: drop THIS SKU's superseded raw-code rows. Because the conflict key is
//    (sku,size), a relabel ('370' → '3XL') writes a NEW row, so the raw twin would
//    otherwise linger and double-count in the portal's B2B totals. Scope it to exactly
//    the codes that now resolve to a DIFFERENT label — footwear codes map to themselves
//    (or aren't in the map), so real numeric shoe sizes are never touched.
const staleRawSizes = Object.keys(sizes)
  .filter(code => { const lbl = sizeMap[conversionId]?.[code]; return lbl && lbl !== code; });
if (staleRawSizes.length) {
  await supabase.from('adidas_inventory').delete().eq('sku', sku).in('size', staleRawSizes);
}
```

## Health check (run AFTER all SKUs are upserted)

Surface size-map regressions so stale numeric codes can't quietly accrue again.
`window._mapGaps` already holds the apparel conversionIds whose maps came back
incomplete this run; just report it. Empty = every apparel code resolved to a
label (no numeric rows written). Non-empty = a map regressed (a richer example
wasn't reachable) and codes may have been written — re-learn that conversionId
before the next run. This is **report-only**; it never deletes.
```js
const gaps = Object.entries(window._mapGaps || {})
  .filter(([cid]) => cid !== '51' && !window._footwearCids?.has(cid));

if (!gaps.length) {
  console.log('[health] size maps complete — 0 unmapped apparel codes ✓');
} else {
  console.warn(`[health] ${gaps.length} conversionId(s) still unmapped:`);
  for (const [cid, codes] of gaps) {
    const ex = (window._convExamples?.[cid] || [])[0];      // richest example for re-learning
    console.warn(`  conv ${cid}: [${codes.join(', ')}]${ex ? ` — re-learn from ${ex.sku}` : ''}`);
  }
}
```
- Apparel `_mapGaps` is expected to be **empty** every run. If it isn't, re-learn the
  listed conversionId(s) (the report names a rich example SKU to learn from), then
  re-run those SKUs — don't let numeric codes persist.
- Stale raw-code rows are now **self-healed per SKU** (Per-SKU step 5): each relabel
  drops its own superseded raw twin, scoped to that SKU's remapped codes, so numeric
  duplicates can't accrue across runs. A broad supervised `^[0-9]{3}$` sweep stays
  available as a one-off backstop, but the sync no longer relies on it.

## Rules
- `requestedDeliveryDates` is a **read-only projection** — NEVER place/submit an order.
- Only OUT-OF-STOCK sizes drive the extra per-date calls; fully-stocked products make none.
- `future_delivery_qty` is stored **directly** (projected ATP at that date); do **not**
  subtract current stock (it can legitimately be lower than current).
- The `~9,999,999` "unlimited" sentinel → `null`.
- On a failed per-date call, leave that size's `future_delivery_qty` null and continue.
- Optional speed-up: group the per-date calls **across SKUs** (one call per distinct
  date carrying all materials that need it), since `requestedDeliveryDates` is
  one-date-per-call.
