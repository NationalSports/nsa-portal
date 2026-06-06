# Cowork Inventory Sync — task instructions

Goal: keep the Supabase `adidas_inventory` table current from Adidas Cowork.
One row per SKU+size with:

- `stock_qty` — units available now
- `future_delivery_date` — the next inbound delivery date for that size
- `future_delivery_qty` — projected available-to-promise for that date  ← (new)
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
`sizes[code].inventory` is then the **projected available-to-promise (ATP)** for
that date — i.e. how many you could order for delivery then. (Confirmed: KV4646
size S returns 0 today and 41 for 2026-07-19.) Read-only — no calendar clicking.
Note: this projection can be **lower** than current stock, and far-out dates may
return a ~9,999,999 "unlimited" sentinel.

## Per SKU

1. Default call. For each size: `stock_qty = sizes[code].inventory`, and
   `future_delivery_date = sizes[code].restockDate` for **every** size that has one
   (in stock or not).
2. Collect the **distinct** restock dates among the **out-of-stock** sizes.
3. For each distinct date, make one call with `requestedDeliveryDates: [thatDate]`.
   From that one response, set `future_delivery_qty` for **every** size whose
   `restockDate` equals that date (in-stock sizes that share the date are captured
   for free in the same response). Store the projected ATP **directly**:

       future_delivery_qty = sizes[code].inventory at that date   (store as-is)

   Do NOT subtract current stock — the projection can legitimately be lower than
   current. If the value is the ~9,999,999 "unlimited" sentinel, store **null**
   (the order screen then shows the date with no number).
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
  order screen just shows the date without "· N available"; it never blocks the sync.

## Size labels

- Write sizes as **labels** (`S`, `M`, `2XL`, `4XL`, `XLT`…), never raw numeric
  codes. Build each conversionId's code→label map from the **full size run** (the
  union of codes seen across all SKUs on that conversionId, or a SKU known to
  carry the complete run) — a map learned from one short-run SKU leaves longer
  SKUs' extra sizes (extended/tall) as raw codes like `240`.
- Persist the maps (localStorage/table) and reuse across runs; only re-learn when
  a brand-new conversionId appears. (True footwear SKUs use numeric sizes
  legitimately — leave those as-is.)

## Notes

- `future_delivery_qty` is the projected available quantity for that delivery date
  (it can be lower than current stock); the order screen labels it "available".
- Dates normalize to `YYYY-MM-DD` (e.g. "Re-stock in Jun 9, 2026" → `2026-06-09`).
- This documents the inventory-sync task only. Adding items to a cart is a separate
  task (see `add_to_cart.md`).
