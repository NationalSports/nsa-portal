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

## One thing to confirm against live data

`_cp` assumes our catalog SKU **is** Champro's `ProductMaster`. Champro marks adult/youth
with an `A`/`Y` suffix; if a master returns no SKUs, `_cp` retries once against the
suffix-stripped base and keeps only SKUs that still start with our SKU (so it can never
surface another configuration's stock). Verify the exact master↔SKU rule with the live key
and tighten `_cp` if Champro encodes adult/youth as a `Configuration` rather than a SKU
prefix.

## Not yet wired (deferred)

- `PlaceOrder` / `OrderSandBox` — automatic PO submission to Champro.
- `OrderStatus` — tracking/status pull.
- JUICE custom-sublimated items (excluded from the catalog import; the API's custom-product
  configs would be needed to quote/order them).
