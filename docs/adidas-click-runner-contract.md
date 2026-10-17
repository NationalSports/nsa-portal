# adidas CLICK runner contract

The portal creates `assigned_todos` rows for Grok Bot with:

- `bot_payload.task_type = "adidas_click_cart_v2"`
- `bot_payload.contract_version = 2`
- `bot_payload.resolved_plan`: the reviewed, deterministic order plan
- `bot_payload.customer_po`, `ship_method`, and `delivery_location`
- `bot_payload.lines`: source PO lines for audit/fallback only

The runner must use `resolved_plan.import_rows`, not reinterpret `lines`.
Each import row has `article`, `rdd` (`YYYY-MM-DD`), `click_size` (CLICK's exact
label), and `qty`. The workbook format is:

- sheet: `Apparel`
- `E1 = Cart Name`, `F1 = customer_po`
- `E4 = Ship To Location Number`, `F4 = delivery_location.number`
- row 5: `Sold To | Article Number | RDD | Size | Comments | Qty`
- one row per planned article/RDD/size; Sold To is `6017364000`

For `delivery_location.type = "one_time"`, import with the default ship-to number
and then set the supplied `delivery_location.address` in CLICK. Set the exact
shipping method and Customer PO after import. Never submit the order.

## Claim and status lifecycle

Claim one row atomically by updating `queued -> in_progress` only when the row
is still `queued`. A scheduled row is not claimable; the hourly database job
changes it to `queued` after every requested exact CLICK size has enough
current `adidas_inventory.stock_qty` and refreshes every held import row's RDD
to that date.

Terminal runner updates:

- `needs_review`: cart/import is ready for a person to inspect and submit.
- `needs_review` with `result.rejected_lines`: CLICK rejected one or more rows;
  keep the accepted cart intact and list each rejected row and CLICK reason.
- `blocked`: authentication, account selection, CAPTCHA, or another condition
  prevented useful work.
- `failed`: an unexpected runner/import failure; include a safe error summary.

Write the result to `bot_payload.result` without removing the original
`resolved_plan`. Recommended result fields:

```json
{
  "status": "needs_review",
  "summary": "Imported 319 units; stopped before submit.",
  "cart_url": "https://…",
  "imported_rows": 42,
  "imported_qty": 319,
  "rejected_lines": [
    {
      "article": "IS1111",
      "rdd": "2026-10-17",
      "click_size": "S 7\"",
      "qty": 5,
      "reason": "HAS_SIZE_SUFFICIENT_INVENTORY"
    }
  ],
  "header": {
    "customer_po_set": true,
    "delivery_location_set": true,
    "ship_method_set": true
  }
}
```

The legacy Mac Mini worker continues to process fallback and other-vendor
`task_type = "add_to_cart"` tasks. Availability-aware adidas assignments from
the portal use v2; the Mac Mini deliberately ignores them, preventing two
browser runners from racing for the same CLICK cart.

## Scope

The v2 planner is selected from the PO vendor name (`adidas`), never from a
product's `inventory_source`. Non-adidas products tagged `click` therefore stay
on their normal vendor path.

This contract covers regular CLICK articles represented by current stock plus
one dated future-delivery quantity in `adidas_inventory`. Preorder-section
articles with season delivery windows are intentionally not inferred from those
fields. They must remain unresolved until the catalog/sync exposes an explicit
season-window shape and the contract is versioned to carry it.

Portal/CLICK comparisons normalize equivalent names (`2XS`/`XXS`,
`2XL`/`XXL`, and numeric waist labels with a trailing inch mark) while retaining
the exact CLICK label in import rows. Tall-2 labels such as `LT2`, `XLT2`, and
`2XT2` remain distinct sizes. Inventory age comes from the browser-safe
`adidas_inventory_freshness` projection of successful sync runs, with row
`last_synced` as a fallback. A 15-minute database refresh keeps that projection
working regardless of whether PR #2526's run table or this PR migrates first.
