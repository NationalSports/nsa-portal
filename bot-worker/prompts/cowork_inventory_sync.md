# Cowork Inventory Sync — task instructions

Goal: keep the Supabase `adidas_inventory` table current from Adidas Cowork.
One row per SKU+size with:

- `stock_qty` — units available now
- `future_delivery_date` — the next inbound delivery date for that size
- `future_delivery_qty` — units arriving on that date  ← (this is the new part)
- `last_synced`, `source`

The portal display and the order screen already read all of these; the only gap
today is `future_delivery_qty` (always null), plus `future_delivery_date` being
saved only on the out-of-stock branch.

## How the data is fetched (API — no UI clicking)

The sync calls the Adidas materials/information API once per SKU. The default
response gives, per size code:

- `sizes[code].inventory` → current stock → `stock_qty`
- `sizes[code].restockDate` → the next inbound delivery date → `future_delivery_date`
  (present for **every** size, in stock or not — it's the next replenishment date
  regardless of current stock; confirmed: XL has 36 now and restockDate 2026-06-09)

The **quantity** projected for a future date comes from the *same* call with the
request-body parameter `requestedDeliveryDates: ['YYYY-MM-DD']`; the response's
`sizes[code].inventory` is the quantity available by that date. (Confirmed: KV4646
size S returns 0 today and 41 for 2026-07-19.) Read-only — no calendar clicking.

## Per SKU

1. Default call. For each size: `stock_qty = sizes[code].inventory`, and
   `future_delivery_date = sizes[code].restockDate` for **every** size that has one
   (in stock or not).
2. Collect the **distinct** restock dates among the **out-of-stock** sizes.
3. For each distinct date, make one call with `requestedDeliveryDates: [thatDate]`.
   From that one response, set `future_delivery_qty` for **every** size whose
   `restockDate` equals that date (in-stock sizes that share the date are captured
   for free in the same response):

       future_delivery_qty = inventory_at_date − current stock_qty

   For out-of-stock sizes current stock is 0, so it's just `inventory_at_date`.
   (This assumes the date's `inventory` is the cumulative available-by-then figure
   — verify once on an in-stock size: XL's number for 2026-06-09 should be ≥ 36.
   If the API instead returns only that shipment's units, store it directly without
   subtracting.)
4. Upsert per size: `sku, size, stock_qty, future_delivery_date,
   future_delivery_qty, last_synced, source` (on conflict `sku,size`).

## Efficiency / safety

- The next-inbound **date** is free for every size (it's in the default response) —
  save it for all sizes, not just zero-stock ones.
- Extra calls are driven by **out-of-stock** sizes' distinct dates; each call also
  yields the amounts for in-stock sizes sharing that date. **Fully-stocked products
  make no extra calls.**
- Optional fuller mode: to also get amounts for in-stock sizes whose restock date
  isn't shared by any out-of-stock size, collect distinct dates among *all* sizes in
  step 2 — but that adds ~1–3 calls to essentially every product, so only if wanted.
- Never place or submit an order — `requestedDeliveryDates` is a read-only projection.
- If a call fails, leave that size's `future_delivery_qty` null and continue — the
  order screen just shows the date without "· N coming"; it never blocks the sync.

## Notes

- Dates normalize to `YYYY-MM-DD` (e.g. "Re-stock in Jun 9, 2026" → `2026-06-09`).
- This documents the inventory-sync task only. Adding items to a cart is a separate
  task (see `add_to_cart.md`).
