# Stored-procedure verification harnesses

Executable proof for the transactional RPCs, run against a **scratch
PostgreSQL — never a real database** (each fixture CREATEs its tables from
their production definitions).

Harnesses:
- `schema_fixture.sql` + `place_webstore_order_scenarios.sql` — migration `00171`
- `art_decision_fixture.sql` + `art_decision_scenarios.sql` — migration `00172`
  (coach art decision: H1 stale-link guard, H2 mock pinning, complete
  reject/approve write sets, SO-1199 contradictory-state heal). Same runner
  recipe as below, substituting the art fixture/scenarios and migration 00172.
- `webstore_batches_scenarios.sql` — migration `00177` (webstore batch numbering:
  per-store backfill order, trigger sequencing, upsert-no-clobber, non-webstore SOs
  untouched, duplicate numbers rejected). Self-contained: run it after
  `schema_fixture.sql` and it applies 00177 itself. Ends with
  `ALL_WEBSTORE_BATCH_SCENARIOS_PASSED`.
- `rls_step1_fixture.sql` + `rls_step1_scenarios.sql` — migration `00173`
  (RLS lockdown step 1). Stubs `auth.uid()` and switches Postgres roles to prove,
  end to end, that anon/authenticated-coach WRITES are blocked while every current
  READ is preserved and linked staff + service_role keep full access. Ends with
  `ALL_RLS_STEP1_SCENARIOS_PASSED`. Same runner recipe, substituting the RLS
  fixture/scenarios and migration 00173.
- `so_shipping_labels_scenarios.sql` — migration
  `20261007120000_so_shipping_labels_out_of_orders` (label PDFs out of
  `sales_orders._shipments`: backfill, insert/update trigger, stale-tab write-back
  dedup, staff-only reads). Self-contained — builds its own fixture and applies the
  migration itself; run it on an empty scratch DB from the repo root. Ends with
  `ALL_SO_SHIPPING_LABEL_SCENARIOS_PASSED`.

## place_webstore_order (00171)

```sh
initdb -D /tmp/pgtest/data -U postgres -A trust
pg_ctl -D /tmp/pgtest/data -o "-p 54999 -k /tmp/pgtest" start
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/schema_fixture.sql
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/00171_place_webstore_order_txn.sql
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260902053000_durable_unconverted_webstore_inventory_reservations.sql
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260902060000_atomic_webstore_coupon_quota.sql
psql -h /tmp/pgtest -p 54999 -U postgres -f scripts/pgtest/place_webstore_order_scenarios.sql
```

Expected output ends with `ALL_SCENARIOS_PASSED`. Scenarios covered:

1. Happy path — order + items + claim + hold in one call; column defaults
   (id, status_token, created_at) still fire; hold expiry lands at ~30 min
2. Taken jersey number aborts the whole transaction — no orphan order/items/holds
3. Sold out — active holds + requested qty over max_avail aborts everything;
   the exact remaining quantity still fits (boundary check)
4. Durable reservation — expired pending holds release, while accepted unpaid
   and converted order items stay reserved until cancellation or SO completion
5. Duplicate client_ref aborts the transaction (idempotency backstop for 00170)
6. Deleting the order cascades items, claims, and holds (the PaymentIntent-failure
   rollback path)
7. Coupon quota claims are atomic/order-idempotent, and deleting a failed
   pending card attempt releases its reservation

The concurrency property (second buyer blocks on the per-(product,size) advisory
lock until the first commits, then correctly reads the committed holds) was
verified with two racing sessions; it needs two live connections, so it isn't in
the scripted scenarios — see the PR that introduced 00171 for the transcript.

## At-Once / 24/7 fake-order proof

`verify_at_once_flow.cjs` runs disposable Club and All School PGlite scenarios,
checks atomic automatic pick-task assignment, then passes their hydrated orders into the actual React order-status, value,
and dashboard calculations. Install `@electric-sql/pglite@0.3.14` in a scratch
prefix and expose its `node_modules` through `NODE_PATH`; run this script from
the repository root with the normal project dependencies installed.

The scenarios cover paid conversion and replay, purchasing/receiving,
garment picking, transfer inventory, production, partial/full dispatch, and
completion without a second invoice. Club supplier purchasing remains a
review queue by design; neither garment nor DTF supplier POs are automatically
created for Club orders. The scheduled pick worker queues available stock without
a manual Send to Warehouse step, while physical pull confirmation stays required.
All School also covers shipment void/reopening and reversed event arrival.

These tests use synthetic payment and physical-work confirmations. They do
not contact Stripe, suppliers, ShipStation, or a hosted database. The All
School scenario exercises dedicated garment procurement and inventory
replenishment as distinct lanes. A physical pick/receipt/production/dispatch
confirmation remains necessary; paying an order cannot manufacture stock or
prove shipment. Deployment settings still control scheduled automation.

Each database is created in memory. Fixture cleanup runs in `finally`; the
Club transaction rolls back and the All School disposable schema is removed.
The combined runner removes its exported snapshot directory on success and
failure. No fake orders are inserted into production or the shared preview.
