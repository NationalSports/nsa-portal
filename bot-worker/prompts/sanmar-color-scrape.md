# SanMar Style Pull (sanmarsports.com) — runbook

Goal: refresh the Supabase `sanmar_style_seeds` table with every style on
sanmarsports.com, so the daily `sanmar-brands-sync-background` ingests them into
the catalog. **No scraping needed** — sanmarsports.com is a Shopify store and
exposes a public products JSON API.

## The data source (preferred — API, not scraping)

`https://sanmarsports.com/products.json?limit=250&page=N` returns up to 250
products per page as JSON. Page through it (page=1,2,3,…) until a page returns an
empty `products` array. Each product has:

- `handle` — the **style number**, lowercase (e.g. `pc78yzh` → `PC78YZH`)
- `title` — ends with the same style number
- `vendor` — the brand (e.g. "Port Authority", "New Era", "Gildan")
- `variants[].sku` — SanMar's per-color/size SKUs (not needed for seeding)

As of the last pull there were ~750 styles across ~27 brands over 3 pages.

## Steps

1. Fetch each page of `products.json` until empty. Collect, per product:
   - `style` = `handle` upper-cased and trimmed
   - `brand` = `vendor`
2. Canonicalize brand so the four it shares with our catalog match exactly:
   Port Authority, Sport-Tek, District, Bella+Canvas (others: keep vendor as-is).
3. Deduplicate by `style`.
4. Upsert to Supabase `sanmar_style_seeds` via the REST API:
   - URL: `{SUPABASE_URL}/rest/v1/sanmar_style_seeds`
   - Method: POST
   - Headers: `apikey: {SERVICE_ROLE_KEY}`, `Authorization: Bearer {KEY}`,
     `Content-Type: application/json`,
     `Prefer: resolution=merge-duplicates,return=minimal`
   - Body: array of `{ "style": "K500", "brand": "Port Authority",
     "source": "shopify_api", "scraped_at": "<ISO timestamp>" }`
   - Batch in groups of 500.
5. Report: pages read, unique styles found, rows upserted.

## What the sync does with the seeds

`sanmar-brands-sync-background` reads `sanmar_style_seeds` and pulls each style
from SanMar's PromoStandards API — EXCEPT:
- **Nike** — handled by `sanmar-nike-sync` (kept branded "Nike")
- **Richardson** — its own live feed (`richardson-sync`)
- **Off-profile long-tail brands** — trimmed to keep the catalog tight:
  tentree, Tommy Bahama, Red Kap, Stanley/Stella, Brooks Brothers.
  (They stay in the seed list — this only gates what gets ingested.)

Everything else lands in the catalog and shows under the **"Non Branded"** filter
on LiveLook (each card still shows its real brand). Re-running this pull is safe
and idempotent (primary key = `style`); new styles are picked up on the next
sync, large sets converge over a couple of runs.

## Notes

- Public page, no login. If `products.json` is ever blocked, fall back to the
  Playwright browser tool on the category/color pages, but the JSON API is the
  reliable path.
- This only refreshes the *seed list*. Inventory, images, sizes, and pricing all
  come from the SanMar PromoStandards API inside the sync, not from this pull.
