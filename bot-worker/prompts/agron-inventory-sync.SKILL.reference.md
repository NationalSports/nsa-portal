<!--
Version-controlled REFERENCE copy of the external "agron-inventory-sync" skill
that runs the scheduled Agron (adidas accessories) inventory sync. Like its
adidas-CLICK sibling, the live skill lives outside this repo, in the Claude
desktop app's skills on the Mac Mini, and runs inside a logged-in Chrome tab.

This file is NOT executed by this app. It exists so the live skill can be diffed
against a known-good version. Companion: adidas-inventory-sync.SKILL.reference.md
(the CLICK sync) and the spec these mirror.

Agron is the COMPLEMENT to adidas CLICK: socks, bags, headwear, underwear, sport
accessories and knit caps are Agron-licensed and NEVER appear on Cowork (the
CLICK sync reports them as "not-found"). This skill covers exactly those, writing
to agron_inventory instead of adidas_inventory. The /adidas catalog reads both
through the inventory_unified view, so Agron items render identically to CLICK.
-->
---
name: agron-inventory-sync
description: Sync Agron B2B (adidas accessories — socks, bags, headwear, underwear, sport accessories, knit caps) per-size stock into the NSA Portal Supabase agron_inventory table, and (optionally, service role) create/backfill the matching products rows. Use for "run the agron sync", "update agron stock", "refresh agron inventory", "sync agron accessories".
---

# Agron Inventory Sync

Goal: keep the Supabase `agron_inventory` table current from the Agron B2B
portal. One row per SKU+size with:
- `stock_qty` — units available now (at-once catalog)
- `future_delivery_date` — null on the at-once catalog (prebook/seasonal only; out of scope v1)
- `future_delivery_qty` — null on the at-once catalog
- `upc` — the per-size UPC (the join key to live stock; stored for traceability)
- `size_code` — the per-size Agron SKU incl. the …B/C/D suffix (stored for portal cross-checks)
- `last_synced`, `source` ('agron-api')

Supabase project: `hpslkvngulqirmbstlfx` · URL `https://hpslkvngulqirmbstlfx.supabase.co`
Anon key (PostgREST, header `apikey` + `Authorization: Bearer <key>`) — same as the CLICK sync:
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2xrdm5ndWxxaXJtYnN0bGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDEyNDAsImV4cCI6MjA4NzAxNzI0MH0.s5OKUjim-EfBmKpuWt8x7c1QxiSoOY7_sTzvThNaYLw`

`agron_inventory` writes go through the anon key (RLS is open for the app role,
same as `adidas_inventory`). **`products` writes do NOT** — anon is RLS-blocked;
a 200/204 is NOT proof of a write, so verify row counts. Product create/backfill
(Step 4b/4c) needs an `authenticated`/service-role key. Stock sync (Steps 1–4)
is the anon-key core and is all a "real inventory run" needs.

Tables:
- `agron_inventory` (id, sku, size, stock_qty, future_delivery_date, future_delivery_qty, last_synced, source, created_at, upc, size_code) on-conflict `sku,size`, id = `{sku}-{size}`.
- `products` (id, vendor_id, sku, name, brand, color, category, retail_price, nsa_cost, is_active, is_archived, available_sizes, image_front_url, description, inventory_source, …). Agron rows: `brand='Adidas'`, `vendor_id='v1777312659133'` (the "Agron" vendor), `inventory_source='agron'`.

Data is fetched from the Agron Elastic Order Entry portal's HTTP API (no UI
clicking once the session is armed). Run inside a logged-in
`agron.elasticsuite.com` tab so the session cookie is present; calls use
`credentials: 'include'`.

---

## Site & account

- Site: `https://agron.elasticsuite.com` (Elastic Order Entry / Magento-style B2B).
- Account: **NATIONAL SPORTS APPAREL LLC**, customer number **`NATSPO3`**, login user `nasport1`.
- Auth: **session cookie** (set after login).

## SKU model (read this first — it drives the join)

Agron's SKU is the **numeric colorway code** (e.g. `5159078`, sometimes 7–8
digits). Single-size items (bags = OSFA) use the bare code. Multi-size items
(socks, underwear) expose a **per-size code that appends a letter** — observed
`…B / …C / …D` for the size run (e.g. `5159078B/C/D`). The friendly size LABEL
(`OSFA`, `S`, `M`, `L`, `XL`) comes from the API (`stock_item.name`) — use that
as `size`; keep the suffixed per-size code in `size_code` only for cross-checking
the portal's Quantity Entry screen.

**Canonical keying (this sync): one `agron_inventory` row per (numeric colorway
code, size label), and one `products` row per COLORWAY** (sku = the numeric
colorway code), with `available_sizes` = the size run. This renders on `/adidas`
exactly like adidas CLICK — one colorway card, a size grid — not one entry per
size. The adidas `Article #` (e.g. `JK3382`) is NOT the SKU here; ignore it for
keying (it may be captured as a note only).

> Reconciliation note: the `products` table currently holds Agron rows under
> THREE legacy keyings for the same items — numeric colorway (`5160708`, bags),
> numeric+letter per-size (`5159078B/C/D`, socks/underwear), and adidas-article
> (`JJ7433`). This sync converges on the numeric-colorway keying. Bags already
> match and light up directly; for socks/underwear the create-if-missing step
> adds the colorway row and the old per-size / article rows stay hidden (no
> stock). De-duping those orphans is a separate, supervised cleanup — do NOT
> mass-delete here.

---

## Confirmed API (reverse-engineered, read-only)

### Step 0 — Auth (self-login, never type the password)
Find/open a logged-in `agron.elasticsuite.com` tab. If not logged in, mirror the
adidas self-login: click the password-manager-autofilled **Login** button (a
trusted Claude-in-Chrome click). **Never type or hardcode the password.** Confirm
a catalog call returns 200 with cookies before paging.

### Step 1 — Arm the catalog session (REQUIRED)
The products API returns `{results: []}` on a fresh page until the catalog SPA has
been "opened". Replay these first, with cookies (`credentials: 'include'`):
- `GET /api/catalogs/6165c4a6474b3f0001258de6/tags?customer=NATSPO3`
- `GET /api/custom_catalogs/collections_preview?user_id=6594458d5e42420001656e65&customer_number=NATSPO3&catalog_key=AllProducts`
- then the at-once catalog grid view.
If `results` is still empty, re-open the "Available Products for At-Once Ordering"
catalog tile in the UI and retry.

### Step 2 — Page the one endpoint that returns everything
```
GET https://agron.elasticsuite.com/api/products/
    ?catalog=AllProducts&customer=NATSPO3&dropped=false
    &sort[type]=workbook&sort[direction]=asc&hoist_quantities=true
Header:  Range: items=<start>-<end>      // steps of ~50; stop when results is empty
```
`hoist_quantities=true` attaches live stock. Response:
```jsonc
{
  "results": [ <product> ],          // page of STYLES
  "stock_shipments": [               // stock for THIS page only, keyed by UPC
    { "key": "<upc>", "warehouse_id": "000", "quantity": 25,
      "ats_date": null, "available_on": null, "release_date": "…" }
  ],
  "facets": { ... }                  // ignore for sync
}
```
Nested product → `variations[]` (one per COLORWAY) → `stock_items[]` (one per SIZE):
```
product.number                       e.g. "984518"   (style number; shared across colorways)
product.name                         e.g. "Adaptive Backpack"
product.description, features
variation.name                       color label, e.g. "Black"
variation.code                       ← SKU: numeric colorway code, e.g. "5159894"
variation.base_color, tags
  tags["Product"]:        ["Bag"]    ← category source (map below)
  tags["Gender"]:         ["Unisex"]
  tags["Colorway Status"]:["ACTIVE"] ← is_active = (== "ACTIVE")
  tags["adidas Article #"]:["JK3382"]← NOTE only; NOT the SKU
variation.images                     OBJECT keyed by view: images[firstKey][0].large = image url
stock_item.name                      ← size label: "OSFA","S","M","L","XL"
stock_item.sku                       ← per-size code incl. …B/C/D → size_code (NOT unique enough to key on)
stock_item.upc                       ← UNIQUE per size → join key to stock_shipments[].key
stock_item.prices                    { elastic_wholesale: 35, elastic_retail: 70, … }
```

### Step 3 — Per page: build stock, then walk the tree
1. Build `upcStock = { <upc>: sum(quantity) }` from `stock_shipments` (sum if a UPC
   repeats across warehouse rows). `ats_date`/`available_on` are null on at-once.
2. For each `product` → `variation` → `stock_item`:
   - `sku   = variation.code` (numeric colorway code)
   - `size  = stock_item.name` (label)
   - `qty   = upcStock[stock_item.upc] || 0`
   - `upc   = stock_item.upc`, `size_code = stock_item.sku`

### Step 4 — Upsert `agron_inventory` (anon key)
Per size, upsert `{ id: `${sku}-${size}`, sku, size, stock_qty: qty,
future_delivery_date: null, future_delivery_qty: null, upc, size_code,
last_synced: now, source: 'agron-api' }` on conflict `sku,size`.
**Write zero-stock rows too** (so the catalog can show "out of stock" rather than
hiding the colorway). Batch ~500/upsert. Verify with a row count, not the HTTP code.

### Step 4b/4c — products create/backfill (OPTIONAL, needs service role)
For each colorway, create-if-missing a `products` row keyed by `sku=variation.code`.
**Only create missing rows and only fill empty image/description fields — never
clobber edited portal copy/images** (same rule as the CLICK backfill).
Field mapping (Agron → products):

| products column    | from Agron                                                              |
|--------------------|------------------------------------------------------------------------|
| `id`               | `p-<epoch-ms>-<n>` (only when creating)                                 |
| `sku`              | `variation.code` (numeric colorway code)                               |
| `name`             | `product.name` (+ color) — match the existing "Adidas …" naming        |
| `brand`            | `"Adidas"`                                                             |
| `vendor_id`        | `"v1777312659133"` (the Agron vendor)                                  |
| `color`            | `variation.name` / `base_color`                                       |
| `category`         | map `tags["Product"]` (table below)                                    |
| `retail_price`     | `stock_item.prices.elastic_retail`                                     |
| `nsa_cost`         | `stock_item.prices.elastic_wholesale` — **actual wholesale, NO markup** |
| `available_sizes`  | array of `stock_item.name` across the variation                       |
| `image_front_url`  | `variation.images[firstKey][0].large` (fill-empty only)               |
| `description`      | `product.description` (+ `features`) (fill-empty only)                 |
| `is_active`        | `tags["Colorway Status"][0] === "ACTIVE"`                              |
| `inventory_source` | `"agron"`                                                             |

Category map (`tags["Product"]` → portal category):

| Agron product_type | Portal category   |
|--------------------|-------------------|
| Sock, Sock-Team    | Socks             |
| Bag                | Bags              |
| Headwear           | Hats              |
| Underwear          | Underwear         |
| Sp Acc             | Sport Accessories |
| Knit               | Hats              |

(Portal category enum in use: Socks, Bags, Hats, Underwear, Sport Accessories,
Accessories, Other.)

### Step 5 — Report
Run-end report: styles paged, colorways, size rows upserted, rows with stock>0,
products created (service-role runs only), images/descriptions backfilled, and
any `tags["Product"]` value that didn't map (so the category map can grow).

## Cadence

Daily stock refresh of `agron_inventory` (the at-once catalog ships now, so stock
is the moving part). Self-login runs unattended as long as Chrome is open and the
password manager is unlocked, same as the CLICK sync. Prebook/seasonal catalogs
(future-delivery dates, a different `catalog_key`) are out of scope for v1.

## Coordination with the adidas CLICK sync (no collision)

- CLICK & Agron SKUs are disjoint; the catalog joins by SKU, so the
  `inventory_unified` union is safe.
- Scope each sync so neither wastes lookups on the other's items:
  - **This (Agron) sync** processes the Agron catalog (→ `inventory_source='agron'`
    products, `vendor_id='v1777312659133'`).
  - **The CLICK sync** already treats socks/bags/accessories as "not-found"; its
    SKU query may additionally exclude Agron rows
    (`… AND coalesce(inventory_source,'click') <> 'agron'`) to skip them entirely.

## Sanity targets (from the live read-only pull)

~459 styles · ~1,828 colorways · ~2,908 size rows · ~2,395 in stock · ~5.36M units.
Spot-check: pick 3 SKUs and confirm `stock_qty` matches the Agron portal's
Quantity Entry screen (cross-ref the per-size `size_code`, e.g. `5159078B`).

## Notes
- Read-only: never submit an order / add to a cart.
- `agron_inventory` writes use raw `fetch` + the anon key (PostgREST), same data
  path as the CLICK sync; product writes need a service/authenticated key.
- Diff the live skill against this reference when changing the sync.
