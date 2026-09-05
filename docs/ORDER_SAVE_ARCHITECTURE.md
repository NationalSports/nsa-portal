# Order save architecture

The EST-2429 failure compared decorations by array position. Removing earlier lines moved undecorated pants into positions previously occupied by decorated polos. Both the browser guard and the estimate RPC treated display position as identity.

## Boundaries

- Estimate and sales-order lines have persistent `line_id` values. Display order is independent. Legacy drafts match unique garment identities; ambiguous matches require a reload. Decoration deletion intent follows the line.
- Full sales-order saves submit one prepared plan to `save_sales_order_atomic`. Header, items, decorations, picking, purchasing, artwork, jobs and firm dates commit together or roll back together. Artwork-only writes use the same transaction boundary without advancing the order's header revision.
- Estimate artwork now commits inside `save_estimate`, alongside its header and lines. No unsafe REST fallback remains for these saves.
- Aggregate fingerprints cover child-only changes. The server locks the document and existing children, then checks the fingerprint again before writing. A receiving update racing a prepared order save therefore causes a rejection instead of being overwritten.
- Exact repeated prepared requests return a stored commit receipt. A changed request must pass revision and fingerprint checks again.
- The browser stages an immutable snapshot before dispatch and serializes document saves. Completion acknowledges only its outbox revision and its editor edit/attempt revision. A late completion cannot mark newer edits saved. Failed writes retain their draft.
- Apply-anyway first reads the current cloud revision. Offline or deleted-record failures leave the conflict available for review.

This addresses estimate and sales-order persistence. Network failures and genuine simultaneous edits can still reject a save; rejection must preserve the draft and must not report success. Existing localStorage capacity and cross-tab coordination limits remain. Invoice/customer transaction work is separate. The revision-aware outbox block overlaps draft PR #2179 and should be reconciled when that branch merges.

## Rollout

1. Apply `20260905134208_atomic_sales_order_save.sql`, then `20260905135224_stable_order_line_identity.sql` to a staging database with the complete production schema and policies.
2. Verify staff authorization, existing production triggers, estimate line reorder/deletion, explicit decoration removal, SO artwork-only edits, and receiving during a full save.
3. Apply both migrations before deploying the frontend. The new frontend deliberately fails closed when the RPCs are unavailable. Reload old browser tabs to replace their positional guards and nontransactional SO save code.
4. Repeat the canary checks after deployment. Review preserved drafts individually; do not automatically discard or force-apply them.

No production migrations or application deployment were performed while developing this change. Receipt retention needs an operational cleanup policy; none is scheduled by these migrations.

## Validation

`CI=true npm test -- --runInBand` passes 312 suites / 4,826 tests. `GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=12288 npm run build` succeeds.

Run the isolated PostgreSQL transaction scenarios without credentials:

```sh
npm install --prefix /tmp/order-save-pg @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/order-save-pg/node_modules/@electric-sql/pglite node scripts/pgtest/order_save_scenarios.cjs
```

The fixture includes 430 column definitions captured from read-only schema metadata, essential foreign keys, and version triggers. It does not reproduce every production trigger or RLS policy, so staging validation remains necessary.

For two-session races, use a disposable native PostgreSQL 17 server on a Unix socket under `/private/tmp/`, with database/user `postgres` and port 54991. Install `pg` and PGlite outside the repository, set `PG_MODULE`, `PGLITE_MODULE`, and `PG_SCRATCH_SOCKET`, then run `order_save_scenarios.cjs` followed by `order_save_concurrency.cjs`. `PG_SCRATCH_RESET=1` destroys the fixture schema and is only for that disposable server. The scripts reject network database URLs.

Native two-session scenarios verify competing saves, identical retries, reader isolation, and a receiving update racing a full save. Transaction scenarios also cover late-child failure rollback, stale bases, malformed collections, artwork-only writes, estimate artwork rollback, stable identities, and RPC access restrictions.
