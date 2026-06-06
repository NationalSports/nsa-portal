# Cowork Inventory Sync — task instructions

Goal: keep the Supabase `adidas_inventory` table current from Adidas Cowork.
One row per SKU+size with:

- `stock_qty` — units available now
- `future_delivery_date` — the restock date for an out-of-stock size
- `future_delivery_qty` — units arriving on that restock date  ← (this is the new part)
- `last_synced`, `source`

The portal display and the order screen already read all of these; the only gap
today is `future_delivery_qty` (it's always written null).

## How the data is fetched (API — no UI clicking)

The sync calls the Adidas materials/information API once per SKU. The default
response is keyed by the earliest delivery date (today) and gives, per size code:

- `sizes[code].inventory` → current stock → `stock_qty`
- `sizes[code].restockDate` → the "Re-stock in <date>" date → `future_delivery_date`

The **incoming quantity** for a future date comes from the *same* call with the
request-body parameter `requestedDeliveryDates: ['YYYY-MM-DD']`. The response's
`sizes[code].inventory` is then the quantity projected to be available by that
date. (Confirmed: KV4646 size S returns 0 today and **41** for `2026-07-19`.)
No calendar clicking required — it's a read-only projection.

## Per SKU

1. Normal call (default date). For each size: `stock_qty = sizes[code].inventory`;
   if it's out of stock, `future_delivery_date = sizes[code].restockDate`.
2. Collect the **distinct** restock dates among the **out-of-stock** sizes.
3. For each distinct restock date, make one extra call with
   `requestedDeliveryDates: [thatDate]`. For each out-of-stock size whose
   `restockDate` equals that date, read its `inventory` from this response →
   `future_delivery_qty`.
4. Upsert per size: `sku, size, stock_qty, future_delivery_date,
   future_delivery_qty, last_synced, source` (on conflict `sku,size`).

## Efficiency / safety

- Only **out-of-stock** sizes need the extra calls; in-stock sizes already have
  their quantity from step 1.
- Dedupe restock dates → ~1–2 extra calls per out-of-stock product. Products with
  nothing out of stock make **no** extra calls.
- Never place or submit an order — `requestedDeliveryDates` is a read-only
  projection only.
- If an extra call fails, leave that size's `future_delivery_qty` null and keep
  going — the order screen just shows the date without "· N coming"; it never
  blocks the sync.

## Notes

- Dates normalize to `YYYY-MM-DD` (e.g. "Re-stock in Jun 9, 2026" → `2026-06-09`).
- This documents the inventory-sync task only. Adding items to a cart is a
  separate task (see `add_to_cart.md`).
