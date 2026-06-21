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
| Catalog sizing sync (parses sizes from product names) | `netlify/functions/champro-catalog-sync-background.js` + `-cron.js` |

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

## Our catalog SKUs ≠ Champro's API SKUs (important)

Live testing surfaced the core constraint: **Champro's `ProductInfo` does not recognize our
catalog SKUs.** Even apparel masters like `BS25A` return `ProductSKUs: null` (not just hard
goods like `CBB703CS` / `BB7`). Our SKUs came from the PDF price list and are not Champro's
API `ProductMaster` codes. This has two consequences:

- **Sizing can't come from the API** — but the size range is right there in each product
  *name* (`A: S-2XL`, `Y: S-XL`, `Sizes: S-3XL`), so we parse that instead.
- **Live inventory is limited** — `_cp` still tries `ProductInfo` then a direct `Inventory`
  call on the catalog SKU. Where Champro's `Inventory` recognizes the SKU you get stock;
  where it doesn't, the Order Editor now shows **⚠ CP** with Champro's reason (e.g.
  "SKU does not Exist") instead of a blank badge. Full live inventory would need a
  catalog-SKU → Champro-SKU mapping (open item).

## Sizing — fixed via product-name parsing (done)

The import left every Champro `available_sizes` empty, and the app defaults empty →
apparel `S–2XL` (`OrderEditor.js`), so hard goods (≈64% of the catalog) wrongly showed
`S/M/L/XL/2XL`. `champro-catalog-sync-background.js` parses the size range from the product
name (no API): apparel → its real range, names with no range (balls/bats/bags/boards) →
OSFA. It's idempotent, only touches empty-sized rows by default (cheap daily cron that
self-heals new imports), and leaves the 3 curated pre-existing SKUs (FV, HC7, WBCCV) alone.
Reprocess everything with `?all=1`.

The initial backfill has already been applied to the live catalog (465 apparel rows got
real ranges, 903 hard goods → OSFA). To re-run after a future import:

```
curl -X POST https://<site>/.netlify/functions/champro-catalog-sync-background
```

## Not yet wired (deferred)

- `PlaceOrder` / `OrderSandBox` — automatic PO submission to Champro.
- `OrderStatus` — tracking/status pull.
- JUICE custom-sublimated items (excluded from the catalog import; the API's custom-product
  configs would be needed to quote/order them).
