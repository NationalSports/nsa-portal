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

## place_webstore_order (00171)

```sh
initdb -D /tmp/pgtest/data -U postgres -A trust
pg_ctl -D /tmp/pgtest/data -o "-p 54999 -k /tmp/pgtest" start
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/schema_fixture.sql
psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/00171_place_webstore_order_txn.sql
psql -h /tmp/pgtest -p 54999 -U postgres -f scripts/pgtest/place_webstore_order_scenarios.sql
```

Expected output ends with `ALL_SCENARIOS_PASSED`. Scenarios covered:

1. Happy path — order + items + claim + hold in one call; column defaults
   (id, status_token, created_at) still fire; hold expiry lands at ~30 min
2. Taken jersey number aborts the whole transaction — no orphan order/items/holds
3. Sold out — active holds + requested qty over max_avail aborts everything;
   the exact remaining quantity still fits (boundary check)
4. Expired holds stop counting against availability
5. Duplicate client_ref aborts the transaction (idempotency backstop for 00170)
6. Deleting the order cascades items, claims, and holds (the PaymentIntent-failure
   rollback path)

The concurrency property (second buyer blocks on the per-(product,size) advisory
lock until the first commits, then correctly reads the committed holds) was
verified with two racing sessions; it needs two live connections, so it isn't in
the scripted scenarios — see the PR that introduced 00171 for the transcript.
