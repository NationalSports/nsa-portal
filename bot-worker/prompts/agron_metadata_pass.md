# Agron Metadata + Images Pass — task instructions for COWORK

Companion to the stock sync (`agron-inventory-sync.SKILL.reference.md`). The stock
sync writes live availability to `agron_inventory`. This pass writes per-colorway
**product metadata + images** to `agron_products_staging` so every Agron colorway
gets a product card on the coach-facing `/adidas` page — not just the ones that
already had a product row.

You write staging with the **anon key** (you cannot write `products` directly —
that's RLS-blocked). Claude Code promotes staging → `products` afterward with the
service role.

Supabase project: `hpslkvngulqirmbstlfx` · URL `https://hpslkvngulqirmbstlfx.supabase.co`
Anon key (PostgREST, header `apikey` + `Authorization: Bearer <key>`) — same as the stock sync:
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2xrdm5ndWxxaXJtYnN0bGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDEyNDAsImV4cCI6MjA4NzAxNzI0MH0.s5OKUjim-EfBmKpuWt8x7c1QxiSoOY7_sTzvThNaYLw`

---

## 1. Same session, same endpoint as the stock run

Log in to `agron.elasticsuite.com` via the password-manager-autofilled **Login**
button (never type the password). Arm the catalog session (replay the
`/api/catalogs/.../tags` + `/api/custom_catalogs/collections_preview` calls, then
open the "Available Products for At-Once Ordering" catalog). Page:

```
GET https://agron.elasticsuite.com/api/products/
    ?catalog=AllProducts&customer=NATSPO3&dropped=false
    &sort[type]=workbook&sort[direction]=asc&hoist_quantities=true
Header:  Range: items=0-49   (then 50-99, … until results is empty)
```

## 2. Per colorway (`product.variations[]`) build one staging row

| field | from Agron |
|---|---|
| `code` | `variation.code` (numeric colorway code = `agron_inventory.sku`) |
| `product_number` | `product.number` |
| `name` | `product.name` |
| `color` | `variation.name` (or `base_color`) |
| `product_type` | `variation.tags["Product"][0]` (Bag, Sock, Sock-Team, Headwear, Underwear, Sp Acc, Knit) |
| `gender` | `variation.tags["Gender"][0]` |
| `adidas_article` | `variation.tags["adidas Article #"][0]` (reference only) |
| `colorway_status` | `variation.tags["Colorway Status"][0]` (ACTIVE/…) |
| `retail_price` | `stock_item.prices.elastic_retail` |
| `nsa_cost` | `stock_item.prices.elastic_wholesale` — **actual wholesale, NO markup** |
| **`image_url`** | **`variation.images[firstKey][0].large` — REQUIRED. Without it the card shows an "image coming soon" placeholder.** |
| `description` | `product.description` (+ `features`) |
| `sizes` | array of `stock_item.name` (optional; promote prefers the live `agron_inventory` size run) |

## 3. Upsert each batch (anon key)

```
POST https://hpslkvngulqirmbstlfx.supabase.co/rest/v1/agron_products_staging?on_conflict=code
Headers:
  apikey: <anon key above>
  Authorization: Bearer <anon key above>
  Content-Type: application/json
  Prefer: resolution=merge-duplicates,return=minimal
Body (array, one object per colorway):
  [ { "code":"5159894", "product_number":"984518", "name":"Adidas …",
      "color":"Black", "product_type":"Bag", "gender":"Unisex",
      "adidas_article":"JK3382", "colorway_status":"ACTIVE",
      "retail_price":70, "nsa_cost":35,
      "image_url":"https://…/large.jpg", "description":"…",
      "sizes":["OSFA"], "source":"agron-api" }, … ]
```

## 4. Verify

```
GET https://hpslkvngulqirmbstlfx.supabase.co/rest/v1/agron_products_staging?select=code
```
Expect ~1,828 rows (one per colorway). Confirm `image_url` is populated — that is
the whole point of this pass. Report colorways written and how many have an image.

## 5. Hand off to Claude Code (promote)

`products` writes need the service role, so Claude Code runs:

```sql
select * from public.promote_agron_products_from_staging();   -- returns (created, updated)
```

This create-if-missing's one `products` row per colorway (keyed by `code`):
`brand='Adidas'`, `vendor_id='v1777312659133'`, `inventory_source='agron'`,
`category` mapped from `product_type`, `available_sizes` from the live
`agron_inventory` size run, `image_front_url` from `image_url`, and the description.
Fill-empty only — it never clobbers edited portal copy/images. Once promoted, the
colorways render on `/adidas` with size grids and images, identical to CLICK.

## Cadence

- **Daily, overnight:** stock refresh → `agron_inventory` (the moving part).
- **Periodic / first run / whenever new colorways appear:** this metadata pass →
  `agron_products_staging` (incl. images), then Claude Code promotes. Idempotent:
  upsert by `code`; promote is fill-empty only, safe to re-run.
- Read-only on Agron: never submit an order / add to a cart.

## Notes

- Numeric colorway code is the SKU; multi-size items also carry a per-size `…B/C/D`
  code on the portal — the size LABEL comes from the API (`stock_item.name`), so you
  do not need to decode the suffix here.
- Legacy duplicate product rows (the same item saved per-size or under the adidas
  article #) were consolidated to one numeric-colorway row each; promote keeps to
  that one-row-per-colorway model.
