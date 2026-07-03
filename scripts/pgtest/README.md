# place_webstore_order verification harness

Executable proof for `supabase/migrations/00171_place_webstore_order_txn.sql`,
run against a **scratch PostgreSQL — never a real database** (the fixture
CREATEs the webstore tables from their production definitions).

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
