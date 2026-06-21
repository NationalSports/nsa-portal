# Champro API — setup & status

Champro exposes a REST/JSON ordering API at <https://api.champrosports.com/>. This repo
now has **live inventory** wired through it (ordering/PO submission is intentionally
deferred — see "Not yet wired"). The integration follows the same proxy pattern as
SanMar / S&S: the browser never sees the API key.

## What's wired (inventory)

| Piece | File |
|-------|------|
| Netlify proxy (injects key, avoids CORS) | `netlify/functions/champro-proxy.js` |
| Client wrappers (`champroApiCall`, `champroGetProductInfo`, `champroGetInventory`) | `src/vendorApis.js` |
| Shared stock parser (`_cp`) + source mapping (`'cp'`) | `src/vendorInventory.js` |
| Order Editor live-stock badges (`isChamproItem`, `CP` refresh chip) | `src/OrderEditor.js` |
| Catalog sizing sync (ProductInfo → `available_sizes`) | `netlify/functions/champro-catalog-sync-background.js` + `-cron.js` |

**How a stock check works.** Our catalog SKU (e.g. `BS25Y`, vendor `ns_49`) is Champro's
*ProductMaster*. `ProductInfo` expands it into the size/color-specific SKUs (e.g.
`BS25YGRBM`); those SKUs are sent to `Inventory`, and the per-warehouse quantities are
rolled up by size. `MORE_EXPECTED_ON` becomes the next-available (restock) date, shown the
same way Richardson backorders are.

The Champro vendor row (`ns_49`) is matched by **name** (`"Champro"`), so no DB change is
required. Setting `api_provider = 'champro'` on that row is optional but makes the intent
explicit.

## Required before it works live

1. **`CHAMPRO_API_KEY`** — the per-customer "API Customer Key" (a GUID). Generate it at
   <https://champrosports.com/AccountAndContactInfo> and set it as a Netlify environment
   variable. The proxy returns a clear error until this is set.

2. **IP allowlisting** ⚠️ — Champro rejects any request from a non-allowlisted source IP
   with error 15 ("IP Address is not allowed"). The **outbound** IP of the Netlify function
   must be allowlisted on the same Account & Contact Info page. Netlify Functions do **not**
   have a static outbound IP by default, so going live needs a fixed-egress path (a static
   outbound IP add-on, or routing the proxy through a host with a stable IP). Read-only
   `ProductInfo` / `Inventory` calls are safe to test against production once the IP is
   allowlisted; there is no separate sandbox for them (the `OrderSandBox` host is for order
   placement only).

## SKU → ProductMaster + sizing (the real work)

Live testing (with the key + IP working) showed two shapes of Champro product:

- **Apparel / configurable goods** — `ProductInfo` expands the master (e.g. `BS25Y`) into
  size/color SKUs. `_cp` queries those and buckets by `Size`. Works.
- **Hard goods / single-size stock** (balls, bats, bags, boards, belts…) — `ProductInfo`
  returns `ProductSKUs: null` (e.g. `CBB703CS`, `BB7`). `_cp` now falls back to querying
  `Inventory` with the catalog SKU directly and buckets it as **OSFA**.

**Sizing is the blocker for hard goods.** The catalog import left every Champro item's
`available_sizes` empty, and the app defaults empty → apparel `S–2XL` (`OrderEditor.js`).
~878 of 1,368 active Champro items (64%) are hard goods that should be single-size, so a
basketball showed `S/M/L/XL/2XL` — and the OSFA stock from `Inventory` couldn't display
against apparel columns.

**Fixed by the catalog sizing sync.** `champro-catalog-sync-background.js` reads each
Champro product's real sizes from `ProductInfo` (apparel → the actual size range; `null`
SKUs → OSFA) and writes `available_sizes`. It's idempotent and, by default, only touches
rows whose sizes are still empty — so the daily cron is cheap after the first backfill and
naturally resumes if a run hits the 15-min limit. Reprocess everything with `?all=1`.

Run the **first backfill** once the deploy with these functions is live (needs
`CHAMPRO_API_KEY` + the allowlisted egress, which the proxy already uses):

```
curl -X POST https://<site>/.netlify/functions/champro-catalog-sync-background
```

After it completes, hard goods become OSFA (single column) and their `Inventory` stock
shows; apparel items get their true size range instead of the `S–2XL` default.

## Not yet wired (deferred)

- `PlaceOrder` / `OrderSandBox` — automatic PO submission to Champro.
- `OrderStatus` — tracking/status pull.
- JUICE custom-sublimated items (excluded from the catalog import; the API's custom-product
  configs would be needed to quote/order them).
