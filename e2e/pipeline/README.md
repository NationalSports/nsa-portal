# Team Shop / Club order pipeline — end-to-end verification harness

A reproducible, from-scratch harness that proves the Team Shop / Club
"automated spine" (order → SO → jobs → invoice → release → production →
shipped) actually works against **real Postgres 16 running the real
migration RPCs** — the thing the existing jest suite (mocked Supabase
client) structurally cannot prove.

## What this proves

Running `./run.sh` creates a fresh scratch database, applies migrations
`00191`→`00212` from `supabase/migrations/` **unmodified**, seeds two
realistic paid orders, and then, entirely through the real RPCs (no direct
table writes standing in for them), verifies:

1. **Convert** — `create_teamshop_sales_order` and `create_club_sales_order`
   each turn a paid webstore order into a Sales Order with correct
   `so_items` (`unit_sell`, `nsa_cost`, merged `sizes`), correct
   `so_item_decorations`, `so_jobs` born with the right `art_status` —
   including **auto-art** (00207): a job whose logo resolves to a
   production-ready `customers.art_files` entry is born `art_complete` with
   `art_file_id` set and `job_stage_events` payload `auto_art:true`, while a
   sibling job on the same order (raw coach upload / transfer code) is born
   `needs_art` — and a settled invoice (club also gets a fundraise
   `customer_credits` row).
2. **Replay safety** — calling either conversion RPC again returns
   `replayed:true` and creates zero duplicate SO/invoice/job/credit rows.
3. **Commission visibility** — the invoice created by conversion links back
   to its SO via `invoices.so_id` (the join `CommissionsPage.calcGP` walks).
4. **Readiness + release gate (00205)** — `advance_job_stage('release', …)`
   on a `needs_art`/`need_to_order` job raises `NSA_NOT_READY`; fixing
   `art_status`/`item_status` makes the same release succeed; a second,
   still-not-ready job releases via `p_override:=true` and the override is
   audited verbatim in `job_stage_events.payload`.
5. **Stage machine** — a job driven `release → start_run → decorated →
   packed` produces the right `prod_status` and exactly one
   `job_stage_events` row per step, with `decorated_at`/`completed_at`/
   `packed_at` all stamped.
6. **Transfer pull (00206)** — `pull_webstore_transfers` decrements
   `webstore_transfers.on_hand` atomically and stamps
   `webstore_orders.transfers_pulled`; a second pull **accumulates** on the
   live row rather than losing the first decrement (the exact race the
   migration exists to close).
7. **Shipped bridge** — flipping `sales_orders._shipped` fires the
   pre-existing `webstore_status_monotonic` trigger (migration 037, not part
   of 00191-00212 but a real dependency), advancing every linked
   `webstore_order_items.line_status` to `shipped`; a subsequent
   earlier-stage status write does **not** downgrade it (monotonic, as
   named).
8. **DTF lane (00211/00212)** — `teamshop_dtf_print_needs` rows never leak
   into / get suppressed by `teamshop_auto_po_needs` (a real garment need
   for the same SO is provably untouched, and the table has no `job_id`
   column at all — they are structurally separate on purpose), and the
   seeded threshold/backstop settings are shown to cross the batch condition
   the JS `dtfBatchDecision` gate would act on.
9. **Guards, as a byproduct** — `NSA_NOT_PAID` (unpaid Team Shop / unpaid
   club order) and `NSA_BAD_SOURCE` (a paid order on a non-club store) are
   also exercised, since they were cheap given the seed data already in
   place.

**Result: PASS.** 93 assertions (73 equality, 16 boolean, 4
expect-a-specific-error), 0 failures, 0 bugs found in migrations
00191-00212. See the session report for the full pass/fail transcript.

## What this does NOT prove

- **The real Stripe network hop.** Nothing here calls Stripe or verifies a
  webhook signature against Stripe's servers — orders are seeded directly as
  already-`'paid'` webstore_orders rows. `stripe-webhook.js`'s own signature
  verification, retry behavior, and the `payment_intent.succeeded` →
  `create_teamshop_sales_order` call site are untested here.
- **The actual Netlify function runtime.** `teamshop-checkout.js`,
  `teamshop-auto-po.js`, `teamshop-auto-release.js`, `job-scan.js`, etc. are
  never invoked as Netlify functions — this harness calls their underlying
  RPCs (or, for the JS-only pure functions, imports them directly — see
  below) straight in SQL/Node, bypassing HTTP, auth headers, CORS, and
  Netlify's own environment.
- **Real ShipStation.** No shipping-label or tracking integration is
  exercised; the "shipped bridge" test only proves the SQL trigger that
  reacts to `sales_orders._shipped`/`_shipping_status`, which is what a real
  ShipStation webhook handler would ultimately set.
- **RLS / policy correctness under real Supabase auth.** This harness runs
  as the Postgres superuser and simulates roles only via
  `request.jwt.claims`/`app.is_staff` GUCs to satisfy the RPCs' own
  `SECURITY DEFINER` internal role checks — it does not re-verify the RLS
  policy matrix (that was covered by a separate, earlier scratch pass; see
  `FABLE_SYSTEM_AUDIT_2026-07-03.md` / `RLS_MATRIX_TODO.md`).
- **A real Supabase project's exact schema.** `seed.sql`'s stubs are a
  best-effort reconstruction of the pre-00191 baseline (see "Stub
  boundary" below); any drift between them and the live project's actual
  columns/types would not be caught here. Where a real drift was previously
  found (`webstore_order_items.id` is `uuid` in production, not the
  originally-assumed `serial`), it was corrected and is called out inline in
  `seed.sql`.
- **teamshop-auto-po.js's `generateForSo`/`sweepDtf` orchestration**,
  `teamshop-auto-release.js`'s `runRelease` orchestration, and
  `job-scan.js`'s HTTP surface — these call the Supabase client with network
  I/O and are covered by their own jest suites with a mocked client
  (`teamshopAutoPo.test.js`, `autoRelease.test.js`), not by this harness.
- **CI wiring.** This is a dev/test artifact, run by hand. Wiring `run.sh`
  into CI (a GitHub Actions job with a Postgres service container) is a
  follow-up, not done here.

## How to run it

Requires a Postgres 16 instance you're willing to throw a scratch database
at (the harness creates and drops its own database; it never touches
anything else). In this sandbox, a scratch instance is already running on
port 55433 with a unix socket at `/tmp`, owned by the `postgres` OS user:

```bash
cd e2e/pipeline
./run.sh
```

`run.sh` auto-detects whether it needs to `su postgres` to reach that
instance (true when running as root with a `postgres` OS user present, which
is this sandbox's posture) or can just call `psql` directly. Override with
env vars if your setup differs:

```bash
PGHOST=/tmp PGPORT=55433 E2E_DB=nsa_e2e_pipeline ./run.sh
# force the su-postgres wrapping on/off explicitly:
E2E_AS_POSTGRES=1 ./run.sh
E2E_AS_POSTGRES=0 ./run.sh
```

It prints a `PASS`/`FAIL` banner and exits non-zero on any failure —
assertion, RPC error, or a migration that doesn't apply. It is safe to
re-run any number of times (drops and recreates its own database each
time).

### Companion JS check (pure functions, not SQL)

Three JS pure functions the pipeline depends on that live outside SQL —
`dtfBatchDecision` (`netlify/functions/teamshop-auto-po.js`, the DTF
threshold/backstop gate), `classifyScan` (`netlify/functions/
_jobScanResolver.js`, shop-floor scan classification), and the auto-release
readiness recompute (`jobReleasable`/`jobArtReady`/`jobFulfillment`/
`jobDtfReady`, `netlify/functions/teamshop-auto-release.js`) — already have
dedicated jest coverage (`src/__tests__/teamshopAutoPo.test.js`,
`src/__tests__/jobScanResolver.test.js`, `src/__tests__/autoRelease.test.js`
respectively). Nothing new was added here — see the session report for
confirmation they pass (89 tests, 3 suites). Run them with:

```bash
CI=true npx react-scripts test --watchAll=false \
  src/__tests__/teamshopAutoPo.test.js \
  src/__tests__/jobScanResolver.test.js \
  src/__tests__/autoRelease.test.js
```

## Files

- `seed.sql` — Supabase-parity role/schema stubs (roles, `auth.uid()`,
  `storage` schema, `is_team_member()` gated on the `app.is_staff` GUC) plus
  every base table the conversion RPCs read/write that migrations
  00191-00212 do **not** create themselves, and baseline reference data
  (team member, both customers with production-ready `art_files`, both
  stores, products, the club's transfer/catalog rows). Also carries the
  `webstore_status_monotonic` trigger verbatim from
  `supabase_migration_037_webstore_status_monotonic.sql` (a real, pre-00191
  dependency the "shipped bridge" assertion needs).
- `drive.sql` — `\ir`-includes the 22 real migration files from
  `supabase/migrations/` in order, then drives and asserts the pipeline
  described above, with `\echo` section headers and `RAISE EXCEPTION` on any
  failed assertion.
- `run.sh` — creates the fresh scratch database and runs the two files
  above against it, in order.

### Stub boundary — what's in `seed.sql` vs `drive.sql` (read before editing)

`seed.sql` defines/seeds **only** tables and columns that pre-date migration
00191 — i.e. nothing in 00191-00212 creates them via `create table if not
exists` / `alter table … add column if not exists`. This was verified
exhaustively (every `create table` / `add column` statement across all 22
files was enumerated and cross-checked), not assumed. One concrete
consequence: order A (Team Shop) needs `webstore_orders.order_source` /
`coach_id` / `customer_id` and `webstore_order_items.decorations` /
`unit_deco_price` — all added by migration `00195` — plus a
`teamshop_logos` row (table created by `00194`). Pre-creating any of these
in `seed.sql` would let a bug in that migration's own DDL hide behind a
silent no-op `if not exists`, defeating the point of the harness. So order
A's order rows (and its `teamshop_logos` row) are seeded in `drive.sql`,
*after* the `\ir` migration block, clearly commented. Order B (Club) touches
no such column, so it's seeded in full in `seed.sql`. Same reasoning for
`webstore_transfers.unit_cost` (added by `00204`).

## Known follow-ups

- Not wired into CI — see "What this does NOT prove."
- The DTF lane's actual batch/PO-creation flow (`sweepDtf`) is not driven
  end-to-end here (it makes network-shaped calls the JS jest suite already
  covers with mocks); this harness only proves the SQL data shape and the
  sibling-table isolation the migration's design rationale claims.
