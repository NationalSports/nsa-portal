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

## Size labels (resolve before processing)
- Each numeric size code (e.g. `220`) maps to a label (e.g. `XL`) per the SKU's
  conversionId.
- Build each conversionId's code→label map from the **FULL size run** — the union
  of codes across all SKUs on that conversionId (or a SKU known to carry the full
  run). A map learned from one short-run SKU leaves longer SKUs' extended/tall
  sizes as raw codes (`240`).
- **Persist** the maps to a file in this skill folder (e.g. `size-maps.json`) and
  reuse across runs; only re-learn when a new conversionId appears.
- Apply `label = map[conversionId][code]`. If a code has no label, log it — never
  silently write a numeric code for apparel. (True footwear SKUs are numeric — fine.)

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
```

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
