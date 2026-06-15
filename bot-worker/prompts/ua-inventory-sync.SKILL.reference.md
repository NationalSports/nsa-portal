<!--
Version-controlled REFERENCE copy of the external "ua-inventory-sync" skill that
runs the scheduled Under Armour "Armour House" B2B inventory sync. Like its
adidas-CLICK and Agron siblings, the LIVE skill lives outside this repo, in the
Claude desktop app's skills on the Mac Mini (COWORK), and runs inside a logged-in
armourhouse.underarmour.com Chrome tab.

This file is NOT executed by this app. It exists so the live skill can be diffed
against a known-good version. Companions: adidas-inventory-sync.SKILL.reference.md
(adidas CLICK) and agron-inventory-sync.SKILL.reference.md (adidas accessories).

✅ ENDPOINTS VERIFIED 2026-06-15 (live COWORK discovery). See §Confirmed API for the
captured, replay-tested contract: live stock = GraphQL `getInventory`; catalog/range =
the Algolia index; pricing = GraphQL `getPricesByStyle`. Cookies alone 401 — the auth
Bearer is grabbed off a live in-app request at runtime. The §Discovery runbook below is
kept for reference / re-discovery. Everything downstream of the writes (tables, the
/adidas Team Catalog, the order screen) is already built and waiting for rows.
-->
---
name: ua-inventory-sync
description: Sync Under Armour B2B (Armour House — armourhouse.underarmour.com) per-size stock, next-delivery date, and projected future quantity into the NSA Portal Supabase ua_inventory table; discover the UA team range, stage missing product rows, and backfill images/descriptions. Use for "run the UA inventory sync", "update under armour stock", "refresh armour house inventory", "sync under armour".
---

# Under Armour (Armour House) Inventory Sync

Goal: keep the Supabase `ua_inventory` table current from Under Armour's Armour
House B2B. One row per SKU+size with:
- `stock_qty` — units available now
- `future_delivery_date` — next inbound date for that size (saved for EVERY size that has one)
- `future_delivery_qty` — projected available-to-promise (ATP) for that date
- `last_synced`, `source` ('armourhouse')

This is the UA analog of the adidas CLICK (Cowork) sync. The data path, cadence,
zero-row rule, size-label discipline, and staging→promote handoff all mirror it —
read `adidas-inventory-sync.SKILL.reference.md` first; this file documents only
what differs for UA.

Supabase project: `hpslkvngulqirmbstlfx` · URL `https://hpslkvngulqirmbstlfx.supabase.co`
Anon key (PostgREST, header `apikey` + `Authorization: Bearer <key>`) — SAME as the adidas/agron syncs:
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2xrdm5ndWxxaXJtYnN0bGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDEyNDAsImV4cCI6MjA4NzAxNzI0MH0.s5OKUjim-EfBmKpuWt8x7c1QxiSoOY7_sTzvThNaYLw`

Tables (already migrated — migration 00120):
- `ua_inventory` (id, sku, size, stock_qty, future_delivery_date, future_delivery_qty, last_synced, source, created_at, style_number, color_code, upc) on-conflict `sku,size`, id = `{sku}-{size}`. Anon read+write (like adidas_inventory).
- `ua_products_staging` (sku, style_number, name, color, product_type, gender, retail_price, image_url, description, sizes, is_active, …) — anon read+write. The discovery handoff.
- `products` — UA rows are `brand='Under Armour'`, `vendor_id='v2'`, `inventory_source='ua'`. ~2,239 today.

`ua_inventory` AND `ua_products_staging` writes go through the ANON key (RLS open,
same as adidas/agron). **`products` writes do NOT** (anon is RLS-blocked). So
product create/backfill is a staging handoff: the bot writes to
`ua_products_staging` (anon), then Claude Code (service role) promotes:
```sql
select * from public.promote_ua_products_from_staging();   -- returns (created, updated)
```

## Site & account

- Site: `https://armourhouse.underarmour.com` (Under Armour Wholesale / Armour House B2B).
- Account: National Sports Apparel's UA team-dealer account (UA vendor `teamdealer@underarmour.com`).
- Auth: self-login like the adidas/agron syncs — click the password-manager-autofilled
  **Sign In** button (a trusted Claude-in-Chrome click). **Never type or hardcode the
  password.** Confirm a catalog/API call returns 200 with the session before paging.
  If the platform uses SSO/Okta, complete the redirect once; the session cookie /
  bearer then persists for the run. Treat token expiry as **stop-and-pause** (preserve
  the in-flight queue, ask the user to re-auth) exactly like the adidas 401 handling.

## ⚠️ Discovery runbook — confirm the API on the first live run

Armour House is a modern B2B storefront (likely a SPA hitting a JSON API or
GraphQL). Do NOT click through the UI per SKU — find the API the way the adidas
sync was found:

1. Log in. Open DevTools → **Network** → filter **Fetch/XHR**.
2. Browse to a product / open a size-run / run a search. Watch the XHR calls.
   Identify the call that returns, per size: **on-hand quantity** and ideally a
   **next-available / ATP date**. Note the request URL, method, headers
   (`Authorization: Bearer …`? cookie? an `apikey`/`x-api-key`?), and body.
3. Find the **catalog/search** call that enumerates styles (returns style number,
   colorway, sizes, price, image URL, description). Note its paging params.
4. Replay both with `fetch(..., {credentials:'include'})` from the console to
   confirm they work headless (no UI). Capture the JSON shape (where stock, dates,
   size labels, images, prices live).
5. Fill the confirmed endpoints/fields into this file's §Confirmed API block and
   the runner, then proceed. Spot-check 3 SKUs against the Armour House UI.

Likely shapes to look for (UA/Salesforce-Commerce/MuleSoft style — verify!):
- Inventory: a `…/inventory` or `…/availability` endpoint keyed by SKU/UPC →
  per-size `ATS`/`availableToSell`/`quantity` and a `nextAvailableDate`/`eta`.
- Catalog: a `…/products` or `…/search` endpoint with `styleNumber`, `colorway`,
  `sizes[]`, `listPrice`/`msrp`, `imageUrl`, `description`, `gender`, `category`.

## Confirmed API (VERIFIED LIVE 2026-06-15 — Armour House uses TWO backends)

Discovery is DONE — endpoints captured from a logged-in session and replayed
headless. The catalog and the live stock come from different backends:

```
Auth — a Bearer JWT the SPA decrypts from encrypted localStorage (the `@secure.s.ua`
       store). COOKIES ALONE RETURN 401. Capture the `authorization` header off a
       live in-app request at runtime: install a fetch interceptor, then open/navigate
       a product so the app fires getInventory, and read the header it sent. A WAF also
       inspects headers — replay them ALL verbatim (`authorization`, `content-type`,
       and the `x-rum-*` pair). Token is short-lived → re-grab each run; 401 = stop-and-pause.

Inventory (LIVE stock) — GraphQL:
   POST https://armourhouse.underarmour.com/graphql      operation `getInventory`
   Variables: a list of per-size SKUs. Response per SKU: `qty` (on-hand) and
   `future[]` = an ARRAY of { qty, effectiveDate } inbound deliveries (NOT one date).
   Verified 200 with real data by replaying the app's EXACT captured body + headers.

Catalog (full range) — Algolia (NOT GraphQL):
   App ID `3X10FE38S0`, index `prod_new_products_en_us_1wh01uszzz` (~33,137 colorways).
   Each hit: style number, name, colors, `sizes{}` (per-size SKUs), images, description,
   and a per-plant `inv` SNAPSHOT (point-in-time — use getInventory for real-time stock).
   This is the enumeration source for discovery + the per-size SKU list feeding getInventory.

Pricing — GraphQL `getPricesByStyle`: `accountPrice` (list wholesale = retail × 0.5),
   `msrp` (→ retail_price), `promoPrice`.

Size order — GraphQL `getStyle`: per-style size ordering.
```

### Resolved deviations from the original draft (confirmed against live data)
1. **`future` is an ARRAY**, not a single date. The `ua_inventory` schema (and the
   order screen / catalog) carry ONE `future_delivery_date` + `future_delivery_qty`,
   so store the **earliest** `future[]` entry's `effectiveDate` + its `qty` (the next
   inbound), same semantics as the adidas next-restock. (The later entries are dropped;
   revisit only if multi-date inbound is ever surfaced in the UI.)
2. **Cost basis:** `accountPrice` is the LIST wholesale (retail × 0.5) and does NOT
   include NSA's extra 15% — same situation as Agron (elastic_wholesale = retail × 0.5,
   true cost lower). So `nsa_cost = msrp × 0.5 × 0.85` (= retail × 0.425 = accountPrice ×
   0.85), and `retail_price = msrp`. The promote function already computes retail × 0.425 —
   write `retail_price = msrp` to staging and let promote derive cost. Do NOT store
   accountPrice as nsa_cost.
3. **Range:** for the INVENTORY sync, don't enumerate all 33k — Step 1 scopes to the
   ~2,239 UA SKUs already in `products`; pull each colorway's per-size SKUs from the
   Algolia hit (or getStyle) and batch them into getInventory. The team-assortment
   `catalogs`/`activeIn` filter only matters for DISCOVERY (creating new product rows);
   confirm NSA's team catalog code before enabling full-range discovery.

## Step 1 — SKU list (re-query EVERY run — never a cached list)

The public `/adidas` Team Catalog now includes UA and hides any product with NO
`ua_inventory` rows (general "no live stock + nothing in-house → don't show" rule),
so re-query `products` every run so catalog imports are picked up:

```sql
SELECT sku, category FROM products
WHERE brand ILIKE 'under armour' AND COALESCE(is_active,true) AND NOT COALESCE(is_archived,false)
  AND COALESCE(inventory_source,'click') <> 'nike';   -- (UA rows are inventory_source='ua')
```

Daily run may prioritize active/recent SKUs; a WEEKLY sweep re-checks every UA SKU.

## Step 2 — Per SKU (GraphQL getInventory; see §Confirmed API)

For each UA style from Step 1, gather its per-size SKUs (from the Algolia hit's
`sizes{}` or `getStyle`) and batch them into `getInventory`. Per returned SKU:

1. `stock_qty = qty` (on-hand). From `future[]` (array of { qty, effectiveDate },
   sorted ascending by date), take the EARLIEST entry: `future_delivery_date =
   future[0].effectiveDate`, `future_delivery_qty = future[0].qty` (later inbounds are
   dropped — the schema + order screen carry one next-restock). Empty `future[]` →
   leave both null. **Write zero rows** (all-0 SKUs still upsert) so the catalog shows
   "out of stock — inbound" instead of hiding the style.
2. Map any "unlimited" sentinel (≥ 1e6) on a qty → null.
3. Upsert per size `{ id: sku+'-'+label, sku, size: label, stock_qty,
   future_delivery_date, future_delivery_qty, last_synced, source:'armourhouse',
   style_number, color_code, upc }` on conflict `sku,size`. Batch ~500/upsert.
   **Verify with a row count, not the HTTP code.**

Note: `sku` keying — use the per-COLORWAY code that matches the `products.sku` already
in the portal (the colorway/style identifier), so live rows light up the existing UA
product cards. The per-SIZE Armour House SKU goes in nothing extra unless needed for the
getInventory call itself; size labels are the grid columns (Step 3).

## Step 3 — Size labels

Write sizes as LABELS (`S`,`M`,`L`,`XL`,`2XL`,`3XL`,`OSFA`,`SM/MD/LG/XL`-normalized).
UA mostly uses standard apparel labels via the catalog's size array — prefer the
label the catalog returns. Normalize UA's `SM/MD/LG/XG` → `S/M/L/XL`, `XXL`→`2XL`,
etc., so they fold onto the same grid columns as adidas (the portal's
`adidasCanonSize` / `normSzName` handle most of this on read, but write clean
labels). Footwear uses numeric sizes legitimately — leave as-is.

## Step 4 — Product discovery → staging (anon), then promote (Claude Code)

So the FULL UA team range renders on `/adidas` — not just SKUs already in
`products` — capture per-colorway metadata during the catalog pass and write it to
`ua_products_staging` with the anon key. **Always grab the image** (a card with no
image shows a placeholder). One staging row per colorway
(`POST …/rest/v1/ua_products_staging?on_conflict=sku`, `Prefer: resolution=merge-duplicates`):

| staging column | from Armour House catalog            |
|----------------|--------------------------------------|
| `sku`          | the UA style/colorway code (= ua_inventory.sku) |
| `style_number` | base style number                    |
| `name`         | product name (prefix "Under Armour " if absent) |
| `color`        | colorway name                        |
| `product_type` | UA category/silhouette (→ mapped by `_ua_map_category`) |
| `gender`       | gender                               |
| `retail_price` | UA MSRP                              |
| `image_url`    | primary image URL (**required**)     |
| `description`  | plain-text description (fabric/fit)  |
| `sizes`        | size-run array (optional; promote prefers live ua_inventory) |
| `is_active`    | colorway active flag                 |

Then Claude Code (service role) runs `select * from promote_ua_products_from_staging();`.
Create-if-missing keys on `sku` + `brand='Under Armour'` (`vendor_id='v2'`,
`inventory_source='ua'`). **Cost rule: `nsa_cost = retail × 0.5 × 0.85` (= retail ×
0.425)** for UA DIRECT — NOT the 0.375 adidas/Agron rule. (UA sells at the coach's
`adidas_ua_tier` discount off retail, same tiers as adidas.) Fill-empty only on
existing rows — never clobber edited portal copy/images.

> SKU keying: the S&S-sourced UA sync (ss-ua-sync-background, netlify) writes its
> own disjoint SKUs (`<style>-<colorCode>`) and uses the distributor price model
> (cost × 1.65, no tier). Armour House is the DIRECT team range. Keep the two SKU
> spaces distinct; both flow to `ua_inventory` and render identically on /adidas.

## Cadence

- **Daily, overnight:** stock refresh of `ua_inventory` (prioritized subset OK).
- **Weekly:** full UA SKU sweep, no time filters.
- **Periodic / first run / when new colorways appear:** also write
  `ua_products_staging` (incl. images), then have Claude Code run the promote.

## Coordination (no collision)

- adidas CLICK / Agron / UA / Nike SKUs are disjoint; the catalog + order screen
  join `inventory_unified` by SKU, so the union is safe.
- This (UA) sync owns `brand='Under Armour'` / `inventory_source='ua'` rows.
- Nike (SanMar) is synced by the netlify `sanmar-nike-sync` (service role) — not COWORK.

## Notes
- Read-only: never place or submit a UA order / add to a cart (a separate task).
- `ua_inventory` writes use raw `fetch` + the anon key (PostgREST), same data path
  as the adidas/agron syncs; product writes need the staging→promote handoff.
- A puppeteer fallback scaffold (heuristic page-scrape, no API) is in
  `scripts/ua-armourhouse-sync.js` — use it only if the JSON API can't be found.
- Diff the live skill against this reference when changing the sync; update the
  §Confirmed API block the moment the real endpoints are captured.
