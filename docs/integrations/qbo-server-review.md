# Server-side QBO reconciliation — stage 1

This is a **read-only foundation**, not automated transaction sync or a cleared
cutover gate. It changes only its own run-history rows (and normal OAuth token
refresh storage), never invoices, payments, links, customers, or accounting data.

## Deployment and operation

1. Apply `20260908061438_qbo_server_review_runs.sql` after review. Verify RLS and
   service-role-only grants on the table and snapshot function.
2. Deploy the functions to production. Preview workers always refuse to run.
   The npm postbuild step bundles the build-time Netlify context in
   `_qboDeployContext.json`; runtime guards do not rely on `process.env.CONTEXT`,
   which Netlify does not supply to Lambda functions. The checked-in stamp is
   `unknown` (disabled). Do not commit a generated production stamp. Stamp-write
   failures fail the build; every preview/local build overwrites the stamp.
3. Explicitly configure `QBO_REVIEW_REALM_ID` to the reviewed National company
   realm and `QBO_SERVER_REVIEW_ENABLED=true`. Missing configuration fails closed.
4. In QuickBooks Sync, use **Server QBO review — read only** → **Refresh server
   history** to check readiness, then **Run read-only server review**. Refresh
   history after acceptance to inspect the actual durable outcome. A request with
   an unknown outcome disables another start in that tab. Expanding a run shows
   exclusions and exact source IDs; old completed runs do not verify a new request.
   Accounting/admin users can also POST to `/.netlify/functions/qbo-review-background`
   using their existing Supabase bearer JWT. Request bodies cannot select a
   company, query, write operation, or mode. Netlify's background HTTP acceptance
   is **not success**; inspect `GET /.netlify/functions/qbo-review-status` with the
   same authentication for durable results. No schedule is enabled by this PR.
5. Compare two completed reports and their exact populations before considering
   scheduling. `complete` means the **linked, nondeleted DB rows** compared cleanly;
   it does not certify unlinked/deleted rows, native payment details, or the full
   migration. Source changes during review force `needs_review`.

## Safety and failure handling

- A unique partial database index allows one running review per company. It does
  not lock legacy browser sync; snapshot changes force review, and this worker
  never writes transactions. Future write runners need a shared write fence.
- No automatic retries, lock expiry, or overlapping takeover. A killed worker
  remains `running`; first verify the invocation has ended (Netlify background
  maximum is 15 minutes), then an authorized database operator may mark that exact
  run `abandoned`, with `finished_at` and an explanatory `error_code`. Preserve it.
- Read errors produce `failed`; if saving the outcome fails, the running lock
  remains. Do not report success from a request acknowledgment or local state.
- Each run stores source IDs, exclusions, a source hash, per-invoice comparisons,
  and counts. QBO faults/tokens are not stored in history or returned to clients.
- The snapshot function includes soft-deleted and unlinked invoices explicitly.
  It does not hydrate browser maps or silently infer links from document numbers.
- QBO reads happen in batches of 100; snapshots above 20,000 rows fail closed.
  Long/outage runs require operator review. Snapshot checks do not provide a
  transactionally consistent snapshot across QBO and Portal.

## Remaining stages

Production verification of run controls/history and repeated live dry runs;
explain browser-vs-database population differences; real payment-detail canary;
shared write fencing and durable per-operation receipts; controlled retry policy;
accounting reconciliation/sign-off; then a separately approved schedule and small
live rollout. Existing sync locks are unchanged.

## Verification before merge

The migration was executed inside a rolled-back transaction against the National
database: snapshot query returned 833 rows; service-role insert worked; a second
running row was rejected; RLS and anonymous/authenticated privilege checks passed.
The table and function were confirmed absent after rollback. This validates SQL
without deploying the schema or enabling the worker. The new unit/endpoint tests
and existing payment regression suite pass (68 tests). A deployed worker run is
still required after approval.
