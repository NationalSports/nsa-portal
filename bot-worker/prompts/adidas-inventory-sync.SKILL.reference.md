<!--
Version-controlled REFERENCE copy of the external "adidas-inventory-sync" skill
that runs the scheduled Adidas Cowork inventory sync (it lives outside this repo,
in the Claude desktop app's skills on the Mac Mini).

This file is NOT executed by this app. It exists so the live skill can be diffed
against a known-good version. The companion task spec is cowork_inventory_sync.md.

Updated 2026-06-12 to the expanded spec: full-range discovery (creates missing
products rows), image/description backfill (fill-empties-only), zero-stock rows,
weekly full-sweep cadence, and the _unmappedSeen health check — authored by the
sync bot, reviewed against the spec in this repo.
-->
---
name: adidas-inventory-sync
description: Sync Adidas B2B (Cowork) per-size stock, next-delivery date, and projected future-delivery quantity into the NSA Portal Supabase; discover the full adidas range, create missing product rows, and backfill product images/descriptions. Use for "run the inventory sync", "update adidas stock", "refresh adidas inventory", "sync adidas".
---

# Adidas Inventory Sync

Goal: keep the Supabase `adidas_inventory` table current from Adidas Cowork.
One row per SKU+size with:
- `stock_qty` — units available now
- `future_delivery_date` — the next inbound delivery date for that size (saved for EVERY size)
- `future_delivery_qty` — projected available-to-promise (ATP) for that date
- `last_synced`, `source` ('api-materials')

Supabase project: `hpslkvngulqirmbstlfx` · URL `https://hpslkvngulqirmbstlfx.supabase.co`
Anon key (PostgREST, header `apikey` + `Authorization: Bearer <key>`):
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2xrdm5ndWxxaXJtYnN0bGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDEyNDAsImV4cCI6MjA4NzAxNzI0MH0.s5OKUjim-EfBmKpuWt8x7c1QxiSoOY7_sTzvThNaYLw`

Tables: `adidas_inventory` (id, sku, size, stock_qty, future_delivery_date, future_delivery_qty, last_synced, source) on-conflict `sku,size` (id = `{sku}-{label}`); `adidas_size_maps` (conversion_id PK, code_labels JSONB, updated_at); `products` (id, vendor_id, sku, name, brand, color, category, retail_price, nsa_cost, is_active, is_archived, available_sizes, image_front_url, description, …).

Data is fetched via Cowork's HTTP APIs (no UI clicking). Run inside a logged-in
b2bportal.adidas-group.com tab so `localStorage.sid` (bearer) and cart cookies are present.

---

## Confirmed API endpoints (reverse-engineered, read-only)

**Catalog search** (also yields conversionId, size codes, soldOut, price, image, description):
`POST https://clapp-v2.whs.adidas.com/service/catalog/products/6040/6017364000/adidas/reorder?system=CLICK`
Body: `{"searchTerm":"<space-joined article numbers, up to 50>","page":1,"pageSize":50,"orderType":"OR"}`
Headers: `Authorization: Bearer <sid>`, `Content-Type: application/json`.
Each `products[]` item: `articleNumber`, `conversionId`, `sizes` (numeric code array),
`soldOut`, `retailPrice`, `listPrice` (wholesale), `name`, `shortDescription`,
`longDescription`, `materialComposition`, `features`, `searchColorName`, `primaryColor`,
`assetUrl` (product image), `gender`, `ageGroup`. Filter responses to the batch SKUs only
(search returns relevance extras). Enumerate the FULL range via paging (`page` 1..N, blank
searchTerm or per category) — this is how discovery sees SKUs not yet in `products`.

**Materials / information** (stock + restock date + projected ATP):
`POST https://clapp-v2.whs.adidas.com/service/cart/0000270384/cart/{cartId}/materials/information?meta=delivery%2Cproduct%2Citems&context=default`
Headers: `Authorization: Bearer <sid>`, `Content-Type: application/json`, **`request-id: <UUID v4>`** (REQUIRED — missing/malformed request-id returns HTTP 500).
Body MUST be an array: `[{ "materialNumber":"SKU", "requestedDeliveryDates":[] }]`.
Response is a top-level array; per item:
- `item.days[0][<date>].sizes[<code>].inventory` → current stock (`stock_qty`)
- `item.days[0][<date>].sizes[<code>].restockDate` → next inbound date (`future_delivery_date`), present for EVERY size in stock or not
- `item.deliveryInformation.sizeRun` → fallback size codes when `sizes` is empty (sold-out SKU)

**Projected future quantity:** re-call the SAME endpoint with
`requestedDeliveryDates:["YYYY-MM-DD"]` per item; the response's `sizes[code].inventory` is
then projected ATP for that date. Group by date (one call per distinct date, all SKUs needing
it). Store AS-IS — do NOT subtract current stock (can be lower). Map any value `>= 1,000,000`
(the ~9,999,999 "unlimited" sentinel) to `null`. Read-only; never places an order.

**Cart list:** `GET https://clapp-v2.whs.adidas.com/service/cart/0000270384/storefronts/1/cart`
→ `data._embedded.cart[]`; filter `status==='OPEN'`. Rotate across all OPEN carts when calling
materials/information (it 500s intermittently on rapid repeat hits to one cart; rotate + retry clears it).

---

## Step 0 — Auth (and token-expiry handling)

Find/open a b2bportal.adidas-group.com tab. Confirm `localStorage.getItem('sid')` exists and a
cart GET returns 200. The `sid` token EXPIRES after ~10–15 min of an idle automation session;
when it does, materials/cart calls return **401** (and the portal may reload under a different
account with a permissions error). The runner treats 401 as stop-and-pause: stop cleanly,
PRESERVE the in-flight batch in the queue, and tell the user to re-log-in / re-select the NSA
account (0000270384). Do NOT drain the queue as errors. Resume from the preserved queue after
the user restores the session. If no token at all, notify the user that manual login is needed and stop.

## Step 1 — SKU list (re-query EVERY run — never a cached list)

The public coach catalog `/adidas` hides any product with NO `adidas_inventory` rows, so
"never checked" looks like "not carried". Re-query `products` every run so catalog imports are
picked up automatically:

```sql
SELECT sku, category FROM products
WHERE brand='Adidas' AND COALESCE(is_active,true) AND NOT COALESCE(is_archived,false);
```

~4,000 SKUs today; only ~2,100 have inventory rows — close that gap.
**Cadence:** every catalog SKU re-checked at least WEEKLY. A daily run may prioritize SKUs with
existing stock / recent activity (skip synced<24h, footwear<7d, zero-stock<7d); the weekly
sweep drops the time filters and covers everything.

## Step 2 — Catalog pre-filter + full-range discovery (batches of 50)

Run the catalog search API in batches of 50 article numbers. For each returned product
(restricted to the batch): `window._convMap[sku]=conversionId`,
`window._catalogResults[sku]=soldOut?'soldOut':'inStock'`, and track the RICHEST example SKU
per conversionId (largest `sizes`) in `window._convSizes[cid]={sku,n}`. Capture `assetUrl` +
description fields for backfill. SKUs the catalog never returns are **not-found** → report,
don't retry every run, re-test weekly (socks/bags/accessories are Agron-licensed, never on Cowork).

**Discovery:** enumerate Cowork's full range via catalog paging (not just `products` SKUs).
Already in `products` → sync + backfill. NOT in `products` → create the row (Step 4c) then sync.

## Step 3 — Size label maps (table-first, union, never raw codes)

Write sizes as LABELS (`S`,`M`,`2XL`,`4XL`,`XLT`…), never raw numeric codes. **Load the durable
`adidas_size_maps` table BEFORE processing** so the first write is a label:

```js
window._sizeMaps = window._sizeMaps || {};
{ const SB='https://hpslkvngulqirmbstlfx.supabase.co'; const SK='<anon key>';
  const res = await fetch(SB+'/rest/v1/adidas_size_maps?select=conversion_id,code_labels',{headers:{'apikey':SK,'Authorization':'Bearer '+SK}});
  (res.ok?await res.json():[]).forEach(r=>{ window._sizeMaps[r.conversion_id]={...(r.code_labels||{}),...(window._sizeMaps[r.conversion_id]||{})}; }); }
window._sizeMaps["51"]={"210":"XS","230":"S","250":"M","270":"L","290":"XL","310":"2XL","320":"3XL","330":"4XL","340":"5XL","360":"6XL","370":"7XL","380":"LT","390":"XLT","400":"2XLT","410":"3XLT","420":"4XLT","430":"5XLT","450":"LT2","460":"XLT2","470":"2XT2"};
```

Re-learn a conversionId only when a richer/new example appears (`_convSizes[cid].n` > stored
size). Learn from the FULL size run via the hidden product-page iframe loader (query
`[id^="CartModule-SizeBar-SizeTranslation-<cid>-"]`, chunks of 5, ~45s timeout each), MERGE
(union) into the map, then **re-upsert to `adidas_size_maps`**
(`POST .../adidas_size_maps?on_conflict=conversion_id`, `Prefer: resolution=merge-duplicates,return=minimal`).
A map learned from one short-run SKU leaves longer SKUs' extended/tall sizes as raw codes
(`240` instead of `4XL`). True footwear conversionIds use numeric labels legitimately — leave as-is.

## Step 4 — Materials sync runner (per SKU)

Install once; cart rotation + UUID `request-id` + 401-aware stop + per-SKU self-heal. Per SKU:
1. Default call → EVERY size: `stock_qty=sizes[code].inventory`,
   `future_delivery_date=sizes[code].restockDate` (in stock or not). Sold-out SKU with empty
   `sizes` → use `deliveryInformation.sizeRun`, stock 0, date null.
   **Write zero rows** (all-0 SKUs still upsert) so the catalog shows "out of stock — inbound"
   instead of hiding the item.
2. Collect DISTINCT restock dates among the OUT-OF-STOCK sizes.
3. One call per date with `requestedDeliveryDates:[date]`; set `future_delivery_qty` for every
   size whose `restockDate` equals that date (in-stock sizes sharing the date captured free).
   Store ATP as-is; sentinel `>=1e6` → null. Fully-stocked SKUs make no extra calls.
4. Upsert per size `{id:sku+'-'+label, sku, size:label, stock_qty, future_delivery_date,
   future_delivery_qty, last_synced, source:'api-materials'}` on conflict `sku,size`.
5. Self-heal: after upsert, DELETE this SKU's rows whose size is a raw code that now maps to a
   different label (`sm[code] && sm[code]!==code`), scoped to the SKU — leaves real footwear sizes.

Efficiency/safety: the next-inbound DATE is free for all sizes; extra calls driven only by
out-of-stock dates. Never submit an order. On a call failure leave that size's
`future_delivery_qty` null and continue. matCall = retry(≤6)+cart-rotation; on HTTP 401 set an
auth-stop flag, preserve the batch, halt.

## Step 4b — Image / description backfill (fill empties only)

For a SKU whose `products` row has empty `image_front_url` and/or `description`, capture from the
catalog response: `assetUrl` → `image_front_url`; a plain-text blend of
`longDescription`/`features`/`materialComposition` → `description`. **Only fill empties — never
overwrite** (portal mockups & edited copy win). One-time per SKU; once filled, skip. Footwear and
hats are the biggest image gaps. PATCH `products` by `sku` (`?sku=eq.<sku>`,
`Prefer: return=minimal`), and only send columns that are currently null/empty.

## Step 4c — Discovery row creation (create missing only)

For an enumerated SKU NOT in `products`, INSERT a row (never overwrite an existing one):
`id`=`p-<epoch-ms>-<n>` · `vendor_id`=`v1` · `brand`='Adidas' · `is_active`=true ·
`name`="Adidas "+style name (SKU ending **W**→women's, **Y**→youth) · `color`=searchColorName ·
`category` mapped to the portal list (Tees, Jersey, Hoods, Shorts, Pants, Polos, 1/4 Zips,
Footwear, Hats, Bags, Socks, Sport Accessories, Outerwear, Crew, Ball, Accessories, Other) ·
`retail_price`=catalog retailPrice · `nsa_cost`=retail×0.375 (50%×75%), or actual wholesale
(listPrice×0.75) if shown · `available_sizes`=labels from the size map ·
`image_front_url`/`description` from the product page. Then sync its inventory like any other.
Report SKUs discovered/created each run for sanity-check (they go live on `/adidas` once rows exist).

## Step 5 — Health check (report-only) + report

After upserting, report TWO signals:
- `window._mapGaps` — apparel conversionIds whose maps came back incomplete vs the
  catalog-derived expected set (exclude conv `51` and true footwear cids
  `97,S1,S2,K1,8B,8E,AU,AQ,M7,TR,F4,BC`). Expected empty.
- `window._unmappedSeen` — codes that ACTUALLY appeared in a SKU's response with no map entry at
  write time (written raw). The stronger signal — catches extended big-&-tall tails
  (`440/480/500/510/520`) no catalog example advertised. Names an example SKU.

Either non-empty = a map regressed / new tail appeared → re-learn that conversionId from the
named SKU and re-sync it before stale `240`-style rows accumulate. A supervised
`DELETE … WHERE size ~ '^[0-9]{3}$' AND EXISTS(labeled twin)` sweep is the backstop.

Run-end report: SKUs synced, rows written, rows with date / with future_qty, errors,
discovered/created rows, images/descriptions backfilled, not-found list, and the two health
signals verbatim.

## Notes
- Dates normalize to `YYYY-MM-DD`.
- `future_delivery_qty` is projected ATP for that date (can be < current stock); order screen labels it "available".
- Adding items to a cart is a SEPARATE task (`add_to_cart.md`).
- A version-controlled reference copy lives in `adidas-inventory-sync.SKILL.reference.md` — diff against it when changing the sync.
- The live skill uses raw `fetch` + the anon key (no `supabase` JS client); PostgREST REST calls with `apikey`/`Authorization` headers are the data path.
