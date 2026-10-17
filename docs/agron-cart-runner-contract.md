# Agron vendor-cart runner contract

The portal creates `assigned_todos` rows with:

- `bot_payload.task_type = "vendor_cart_v1"`
- `bot_payload.vendor = "agron"`
- `bot_payload.contract_version = 1`
- `bot_payload.customer_po`
- `bot_payload.ship_to = { type: "default" | "drop_ship", address }`
- `bot_payload.ship_via`, `arrive_on`, and `cancel_on`
- `bot_payload.plan.rows`: the deterministic rows the runner executes
- `bot_payload.lines`: source PO snapshots for audit only

Each plan row contains `sku`, `size`, `upc`, `product_number`, `color_code`,
`qty`, `unit_cost`, `so_id`, and `po_line_id`. UPC is resolved from the Agron
catalog by exact SKU + size when the task is created. A row with no match stays
in `plan.rows` with `upc: null` and a matching `issues` entry. The runner must
not reconstruct, replace, or silently discard plan rows from `lines`.

## Claim and status lifecycle

The external box runner claims one task atomically:

1. Select an open task assigned to the configured bot member where
   `bot_status = "queued"`, `task_type = "vendor_cart_v1"`, and
   `vendor = "agron"`.
2. Update that task to `bot_status = "in_progress"` with predicates on its id,
   `status = "open"`, the same `assigned_to`, `bot_status = "queued"`,
   `task_type`, and vendor.
3. Continue only when exactly one row was updated. Otherwise another runner
   owns the task.

The runner finishes with one of:

- `needs_review`: a useful cart is ready for human review, including when some
  rows were rejected and are reported.
- `blocked`: authentication, account selection, CAPTCHA, missing required
  runner input, or another condition prevented useful cart work.
- `failed`: an unexpected runner or website failure.

It writes `bot_payload.result` without removing the original plan:

```json
{
  "status": "needs_review",
  "summary": "Added 18 of 19 rows; stopped before submit.",
  "cart_id": "abc123",
  "cart_number": "CART-1042",
  "cart_url": "https://agron.elasticsuite.com/...",
  "order_summary": {
    "customer_po": "PO 4021",
    "lines": 19,
    "sizes": 7,
    "qty": 124,
    "totals": {
      "merchandise": 2150.5,
      "shipping": 0,
      "tax": 0,
      "grand_total": 2150.5,
      "currency": "USD"
    },
    "ship_to": {
      "type": "default",
      "address": null
    },
    "ship_via": null
  },
  "fingerprint": "sha256:...",
  "issues": [],
  "rejected_rows": [
    {
      "sku": "5155948D",
      "size": "OSFA",
      "qty": 1,
      "po_line_id": 12345,
      "reason": "missing_upc"
    }
  ]
}
```

`fingerprint` must be a stable digest of the task identity and immutable input
contract (task id, contract version, customer PO, ship-to, dates, and ordered
`plan.rows`). It lets a reviewer detect a stale result after task input changes.
`issues` records cart-level warnings; `rejected_rows` records every plan row the
runner could not add, with a safe reason.

## Safety boundary

The runner may sign in, create or update a cart, and read totals. It must never
submit or place the order. Submission is a separate human-approved action
outside the portal. Credentials and passwords must never be stored in vendor
rows, task payloads, results, logs, or screenshots.

The legacy Mac Mini worker handles `add_to_cart` only and deliberately ignores
`vendor_cart_v1`, preventing two workers from claiming the same Agron task.
