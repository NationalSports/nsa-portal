# Cowork Inventory Sync — task instructions

Goal: keep the Supabase `adidas_inventory` table current from Adidas Cowork.
For every Adidas SKU, record one row per size with:

- `stock_qty` — units available now
- `future_delivery_date` — the "Re-stock in <date>" date shown when a size is out of stock
- `future_delivery_qty` — how many units arrive on that restock date  ← (this is the new part)
- `last_synced` — now

The portal display and the order screen already read all of these; the only
gap today is `future_delivery_qty` (it's been coming back empty).

## Per SKU

1. Open the product's size table. For each size, read the current quantity → `stock_qty`.
2. For each **out-of-stock** size (qty 0) that shows **"Re-stock in <date>"** on its
   calendar icon, record that date → `future_delivery_date`.
3. Capture the incoming amount → `future_delivery_qty`. **Try the cheap way first:**
   a. **Click** the size's calendar icon (the one that shows "Re-stock in <date>" on hover).
      If the box that opens also shows a quantity (e.g. "240 units", "240 available"),
      record it. Done — no delivery-date change needed.
   b. **Only if no quantity is shown there:** group the out-of-stock sizes by restock date.
      For each distinct restock date, change the size table's **Delivery Date** (click the
      date chip → pick that date in the calendar) and wait for the grid to reload — each
      grouped size's number is now the amount arriving on that date → `future_delivery_qty`.
      Reset the Delivery Date to the default when done.
4. Upsert the row(s) to `adidas_inventory`
   (`sku, size, stock_qty, future_delivery_date, future_delivery_qty, last_synced`),
   on conflict (`sku,size`).

## Efficiency / safety

- Skip sizes that are **in stock** — they need no date or quantity.
- Skip products with **no out-of-stock sizes** entirely (no date changes at all).
- Change the Delivery Date **once per distinct restock date**, never per size.
- Prefer step 3a; step 3b is the fallback and the only "slow" path.
- **Never** change ordered quantities and **never** place/submit an order. Reset the
  Delivery Date to the default before leaving each product.
- If one size fails, leave its `future_delivery_qty` null and keep going — a missing
  amount just shows the date without "· N coming"; it never blocks the sync.

## Notes

- Dates normalize to `YYYY-MM-DD` (e.g. "Re-stock in Jun 9, 2026" → `2026-06-09`).
- This file documents the inventory-sync task only. Adding items to a cart is a
  separate task (see `add_to_cart.md`).
