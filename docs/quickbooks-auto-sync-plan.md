# QuickBooks Automatic Sync — Build Plan

Status: **plan, not built.** Written 2026-09-07 after the customer and vendor
migrations finished and the product batches started. Build begins once the
manual migration is complete (see §10). Canonical copy of this plan lives here;
`docs/quickbooks-first-push-rollout.md` and `docs/quickbooks-durable-links-rollout.md`
describe the manual tooling this plan grows out of.

---

## 0. In plain terms

**What "automatic" will mean.** Every night, with nobody logged in, the portal
pushes new customers, purchase orders, estimates and invoices to QuickBooks,
pulls payments and bills back, records a receipt for every write, and emails a
short exception list only when something needs a human. Nothing in the team's
day-to-day workflow changes.

**Why it is not a switch we can flip today.** Three separate things:

1. The sync engine is browser code. It runs against the lists loaded into the
   React app and reports by updating React state. A server cannot call it.
2. The automatic path is hard-locked. `syncAll` begins with a lock that returns
   `true` unconditionally; every automatic run exits on its first line.
3. The scheduler is a browser timer. It only fires while someone has the
   QuickBooks page open in a tab.

**What automatic will never do on its own.** Create a vendor in QuickBooks,
create a product that is not on a purchase order, post a taxable invoice before
accounting approves the tax mapping, or write a receipt without reading the
record back from QuickBooks first. Those rules already hold for the manual
batches and carry over unchanged.

**Rough size.** About four to five working days, built in stages, each stage
run in dry-run mode first and promoted only after its first verified live run.

---

## 1. Where things stand (verified 2026-09-07)

### 1.1 The engine today

`src/qbSyncEngine.js` exports pure helpers (manifest builders, name matching,
duplicate guards, term resolution, PO grouping) and one factory,
`createQBSyncEngine(ctx)`. The factory closes over the browser's live state:

```
ctx = { cust, sos, invs, prod, vend, invAdjLog, invPOs, submittedBatches,
        qbApi, qbConfig, persistQbLink, nf, dP,
        setQBConfig, setQbSyncing, setInvs, setInvPOs, setSOs, setSubmittedBatches, setVend }
```

`syncAll` runs customers → sales orders → invoices → payments pull → purchase
orders. It does **not** run products, vendors, or the bills pull. It cannot run
at all: `migrationBatchLocked()` returns `true` with no condition.

The browser scheduler (`App.js` ≈ line 4566) is a `setInterval` that checks
every 60 s and calls `syncAll` when `autoSync` is `hourly|daily|realtime`,
`initialMigrationApproved` is true, and the last sync is older than the
interval. Config today: `autoSync: manual`, `initialMigrationApproved: true`,
`preflight.status: success`.

Per-stage state the engine reads and writes (this is what a server port must
reproduce exactly):

| Stage | Reads | Writes | Receipt |
|---|---|---|---|
| customers | `customers`, QBO Customer + Term | `custQBMap`, `lastCustomerBatch` | ledger `custQBMap` |
| sales orders → Estimates | `sales_orders`, `customers`, `products`, `qbSOMap`, `_salesOrderSyncOffset` | `qbSOMap`, offset | ledger `qbSOMap` |
| invoices | `invoices` (`!qb_invoice_id`), `customers`, `sales_orders`, `_invoiceSyncOffset` | `invoices.qb_invoice_id`, offset, `_portalSalesItemId` | none today (**gap**) |
| payments pull | `invoices` (with `qb_invoice_id`), QBO Payment, `_paidSyncOffset` | `invoice_payments` rows (via `invoices.payments[]`), `invoices.paid/status`, offset | ledger `qbPaymentMap` |
| purchase orders | `sales_orders` item `po_lines`, `products`, `vendors`, `prodQBMap`, `qbPOMap` | `qbPOMap`, `vendors.qb_vendor_id`, `lastPurchaseOrderBatch` | ledger `qbPOMap` |
| bills pull | QBO Bill, `qbPOMap`, `sales_orders`, `inv_pos`, `submitted_batches`, `_syncedBillIds` | `sales_orders`, `inv_pos`, `submitted_batches`, `_syncedBillIds` | ledger `qbPOBillMap` |
| products | `products`, QBO Item | `prodQBMap` | ledger `prodQBMap` |
| vendors | `vendors`, `deco_vendors`, QBO Vendor | `vendors` rows | ledger `vendorQBMap` |

Batches rotate 20 records per call (`QB_SYNC_BATCH_SIZE = 20`) using the
`_*SyncOffset` keys, so 827 unsynced invoices would take 42 browser runs.

### 1.2 What the server already has

- **QBO access with no browser.** `netlify/functions/_qb.js` holds token
  storage, refresh (`getValidAccessToken(admin)`) and `qbRequest(method, path,
  token, body, sandbox)`. Tokens live only in the service-role `qb_oauth_tokens`
  table. `qb-api.js` is a thin proxy over this; a scheduled job calls `_qb.js`
  directly.
- **Long-running jobs.** The repo's pattern is a cron function that POSTs to a
  `*-background` function with a 15-minute budget (`momentec-image-verify-cron`
  → `momentec-image-verify-background`; ten such pairs exist). Ordinary
  functions cap at 26 s, which is why the sync cannot be a plain scheduled
  function.
- **Internal auth.** `verifyUserOrInternal` accepts `X-Internal-Secret`
  (`INTERNAL_FUNCTION_SECRET`, falling back to the service-role key) for
  function-to-function calls.
- **Shared code.** Functions `require('../../src/lib/*.js')` today, listed in
  `netlify.toml` `included_files`. Every shared file is CommonJS
  (`module.exports`). The QuickBooks helpers are ESM (`export function`) and
  are not currently importable from a function.
- **Digest emails.** `bill-anomaly-digest.js` shows the pattern: Brevo, a
  recipients env var, and the never-spam rule (no findings, no email).

### 1.3 The durable ledger

Every verified link is one `app_state` row keyed
`_qb_link_v1_<encodeURIComponent(JSON.stringify([realmId, mapKey, sourceId]))>`
with value `{realm_id, map_key, source_id, qbo_id, active, verified_at, evidence, log}`.
`persistVerifiedQBLink(client, {...})` in `src/qbLinkLedger.js` writes it with
an optimistic-concurrency check and refuses to overwrite a conflicting or
explicitly-removed link. On load, `mergeDurableQBLinks` rebuilds every `*QBMap`
from these rows, so **the ledger, not `qb_config`, is the source of truth for
links.** The server must write the same rows through the same function.

### 1.4 A hazard the plan has to design around

The browser saves `qb_config` wholesale on every change
(`_saveAppState('qb_config', qbConfig)` in an effect). Any key a server job
writes into `qb_config` can be silently overwritten by an open tab holding a
stale copy. The ledger exists for exactly this reason. Therefore the server
**never writes into `qb_config`.** It keeps its own state (§4.3) and the
browser merges that state on load, the way it already merges ledger rows.

### 1.5 Numbers tonight

| | |
|---|---|
| Customers linked, receipts verified | 2,528 of 2,540 (16 permanent exceptions, 2 archived) |
| Vendors linked | 27 of 30 in QuickBooks (3 held for a name decision) |
| Products linked | 1,093 after three clean batches (1,056 created, all read back, no duplicates) |
| Purchase orders | 2,156 pending, 33 linked; 987 now have every item linked |
| Invoices unsynced | 827 total; **61 since the 2026-09-01 cutover** |
| Sales orders (active) | 1,320; 0 estimates linked |
| Payments pulled | 0 |
| PO-to-bill links | 1 (the canary) |

### 1.6 The orphan-SKU ceiling (found 2026-09-07, unresolved)

Of the 2,134 distinct SKUs on the 2,156 pending purchase orders:

| | |
|---|---|
| Linked to QBO | 1,090 |
| Have a product record, not yet linked | 195 (175 active, 20 inactive) |
| **No product record at all** | **850** |

`buildQBProductManifest` walks the **products table**. A SKU that exists only on
an order line (`so_items.sku` with no matching `products` row, and
`so_items.product_id` null — 2,743 of 5,435 pending PO lines have a null
`product_id`) never appears in the review, never gets an item, and every
purchase order referencing it stays blocked permanently. Running more product
batches cannot fix this; the third batch shrank to 56 rows for exactly this
reason.

Effect on the PO stage: 987 of 2,156 pending POs have every item linked today;
the remaining 1,169 are mostly waiting on orphan SKUs. Finishing the creatable
175 gets the product gate to its ceiling, not to done.

**Decision D9 (open) — how to handle orphan SKUs.** Two candidate fixes:

- *Backfill*: create product records from the order lines (SKU, name, brand,
  cost) for SKUs that are genuinely products, then let the normal product stage
  create their QBO items. Correct if these are real catalogue gaps.
- *Generic line*: post orphan lines against a shared NonInventory item
  (e.g. `NSA Portal Purchase`, 51300) carrying the SKU in the line description.
  Correct if these are one-off custom items that should never become catalogue
  entries.

The two are not exclusive: backfill the real products, generic-line the
one-offs. Until D9 is decided the PO stage must ship with a cap that skips
orphan-SKU POs rather than failing on them, and the digest must report the
count so it does not silently stall at 45% coverage.

---

## 2. Target architecture

```
netlify.toml
  [functions."qb-auto-sync-cron"]         schedule = "0 9 * * *"     # 01:00/02:00 PT nightly
  [functions."qb-payments-pull-cron"]     schedule = "0 14-1 * * *"  # hourly, business hours (decision D5)

qb-auto-sync-cron.js        → POST /.netlify/functions/qb-auto-sync-background   (X-Internal-Secret)
qb-payments-pull-cron.js    → POST /.netlify/functions/qb-auto-sync-background?stages=payments

qb-auto-sync-background.js  (15-min budget)
  1. load qb_config + auto-sync state from app_state (service role)
  2. readiness check (§3)  → if not ready: record run as skipped with reasons; exit
  3. take the shared sync lock (§4.4)
  4. for each enabled stage, in order (§5): run with per-stage cap and time budget
  5. write qb_sync_runs row; release lock; send digest if any exceptions/failures (§6)

src/lib/qb/                 CommonJS, shared by browser and server (one copy — CLAUDE.md)
  names.js        normalizeQBDuplicateKey, findExactQBCustomerMatches, findQBDuplicateCandidates, portalCustomerDisplayName
  terms.js        portalCustomerTermSpec, resolveQBCustomerTerm, normalizeBlankTermsDefault
  customers.js    buildQBCustomerManifest, buildQBCustomerMatchDiagnostic, qbCustomerBatchReady
  products.js     buildQBProductManifest, normalizeProductSKU, qbProductBatchReadiness
  vendors.js      buildQBVendorReview, vendorDuplicateKey
  purchaseOrders.js  groupPortalPurchaseOrders, buildQBPurchaseOrderPreviewRows
  invoices.js     buildQBInvoicePostingLines
  payments.js     qbPaymentsAppliedToInvoice
  bills.js        billReferencesPortalPO, findQbPOBillCandidates, buildQBBillPOReplacement
  ledger.js       qbLinkKey, persistVerifiedQBLink, mergeDurableQBLinks
  response.js     qbResponseErrorDetail
  serverEngine.js createServerSyncEngine({admin, qb, config, state, budget, log})
```

The browser engine keeps working exactly as it does now; it just imports the
helpers from `src/lib/qb/` instead of defining them. The manual batch tools stay
for exceptions and for anything the readiness check keeps closed.

`createServerSyncEngine` mirrors the browser engine stage for stage but takes a
Supabase admin client and a `qb(method, path, body)` closure instead of React
state and setters. It reads tables directly, writes tables directly, and calls
`persistVerifiedQBLink` with the admin client. It has no `nf`, no `setState`,
and no `window`.

---

## 3. Readiness check (replaces the unconditional lock)

Runs at the top of every automatic run **and** at the top of the browser's
`syncAll`, from the same shared function. All conditions must hold; the run
records every failing condition and exits without touching QuickBooks.

| # | Condition | Source |
|---|---|---|
| R1 | Kill switch on: `auto_sync.enabled === true` | `app_state.qb_auto_sync` (§4.3) |
| R2 | Not paused: `auto_sync.paused_until` absent or in the past | same |
| R3 | `qb_config.autoSync` is `daily` or `hourly` | `app_state.qb_config` |
| R4 | `qb_config.initialMigrationApproved === true` | same |
| R5 | `qb_config.preflight.status === 'success'` and its `realm_id` matches `qb_config.realm_id` | same |
| R6 | `qb_config.sandbox !== true` | same |
| R7 | A valid access token can be obtained (`getValidAccessToken`) | `qb_oauth_tokens` |
| R8 | Customer term canary proven (`custTermCanaryVerifiedAt`, or a `custQBMap` ledger row with `evidence.result = updated`) | ledger |
| R9 | Product link **and** create canaries proven (`prodLinkCanaryVerifiedAt`, `prodCreateCanaryVerifiedAt`, or the equivalent ledger rows) | ledger |
| R10 | `NSA Portal Sales` item verified (`_portalSalesItemId` set and read back within 30 days) | `qb_config`, QBO |
| R11 | One purchase-order canary proven: a `qbPOMap` row with `evidence.result = created` and `api_readback = true` | ledger |
| R12 | One payment pull proven: at least one `qbPaymentMap` row | ledger |
| R13 | Ledger health: zero rows with `api_readback` not true; every row's `realm_id` equals the connected realm | ledger |
| R14 | No other sync holds the lock (§4.4) | `app_state.qb_sync_lock` |

R8–R12 are read from the ledger, not from `syncLog`, so the 100-entry log cap
can never silently expire them (this is the failure that bit the product and
customer gates on 2026-09-06).

Every stage additionally has its own mode (§4.2). A stage that is `off` is
skipped; `dry` computes and reports but writes nothing to QuickBooks.

---

## 4. Server-side state and controls

### 4.1 New table: `qb_sync_runs`

```
id            uuid pk
started_at    timestamptz
finished_at   timestamptz
trigger       text      -- 'nightly' | 'payments' | 'manual'
status        text      -- 'skipped' | 'success' | 'partial' | 'failed'
readiness     jsonb     -- {ok:bool, failed:[R1..R14]}
stages        jsonb     -- {customers:{mode,attempted,linked,created,updated,blocked,skipped,ms}, ...}
exceptions    jsonb     -- [{stage, source_id, reason}]
budget_ms     int
notes         text
```

The Sync Log page gets an "Automatic runs" card reading this table. The
Overview header's *Last sync* shows the later of `qb_config.lastSync` and the
last successful run.

### 4.2 Per-stage mode

`app_state.qb_auto_sync` (one row, written only by the server and by the
Settings page's toggles):

```json
{
  "enabled": false,
  "paused_until": null,
  "stages": {
    "customers":  "off",   "vendors":   "off",
    "products":   "off",   "purchase_orders": "off",
    "estimates":  "off",   "invoices":  "off",
    "payments":   "off",   "bills":     "off"
  },
  "caps": { "customers": 200, "products": 300, "purchase_orders": 100,
            "estimates": 100, "invoices": 100, "payments": 500, "bills": 500 },
  "digest_to": ["accounting@nationalsportsapparel.com", "steve@nationalsportsapparel.com"]
}
```

Mode values: `off`, `dry`, `live`. Every stage ships as `off`, is promoted to
`dry` when built, and to `live` only after a human reviews its first dry run
report and its first live run reconciles.

### 4.3 Where the server keeps state

- Links: the ledger (unchanged).
- Run history and exceptions: `qb_sync_runs`.
- Controls: `app_state.qb_auto_sync`.
- Per-record sync state: the records themselves (`invoices.qb_invoice_id`,
  ledger presence). No rotating offsets; each run processes "everything
  unsynced, up to the cap", oldest first.
- Log lines for the Sync Log page: `qb_sync_runs.stages[*].log` (capped per
  run), not `qb_config.syncLog`.

Nothing is written into `qb_config` by the server. On load the browser merges
`qb_auto_sync` and the latest run the same way it merges ledger rows.

### 4.4 Shared sync lock

`app_state.qb_sync_lock = {holder, taken_at, expires_at}`. Both the server run
and every browser batch (`syncCustomers`, `syncInventory`, `syncPurchaseOrders`,
…) take it before writing and release it after. A lock older than 20 minutes is
treated as stale. This prevents a nightly run and a manual batch from writing
the same entity at once, which today nothing prevents.

---

## 5. Stages, in run order

Each stage: what it selects, the guards it must pass per record, what it
writes, and what stays manual. All writes follow the canary pattern:
duplicate preflight → write → API read-back → receipt → only then counted.

### 5.1 Customers
- **Select:** active portal customers with no `custQBMap` ledger row, plus
  linked customers whose portal terms changed since the receipt.
- **Guards:** `buildQBCustomerManifest` with `blankTermsDefault: net30`
  (approved 2026-09-06). Rows that are `blocked` (multiple QBO matches,
  duplicate portal names, near-duplicate names via `normalizeQBDuplicateKey`,
  unresolved terms) are reported, never created.
- **Writes:** create or update-terms in QBO; ledger `custQBMap`.
- **Manual forever:** the 16 exception records and any future blocked row.

### 5.2 Vendors (QuickBooks → portal, link only)
- **Select:** `buildQBVendorReview` over all active QBO vendors.
- **Guards:** existing decoration-vendor hold and `vendorDuplicateKey` hold.
- **Writes:** link and contact-patch rows; **new portal vendors are created with
  `po_eligible = false`** so overhead accounts never reach a PO picker until a
  human turns them on (decision D3).
- **Never:** create a vendor in QuickBooks.

### 5.3 Products (PO-scoped)
- **Select:** SKUs appearing on purchase orders awaiting sync that have no
  `prodQBMap` row (`buildQBPurchaseOrderPreviewRows` → `skus`), through
  `buildQBProductManifest`.
- **Guards:** exact SKU/name match, NonInventory type, 40000/51300 routing;
  any conflict blocks and reports.
- **Writes:** link or create NonInventory item; ledger `prodQBMap`.
- **Never:** touch quantity on hand or inventory value; sync a SKU that is not
  on a purchase order (decision D4).

### 5.4 Purchase orders
- **Select:** grouped portal POs (`groupPortalPurchaseOrders`) with no
  `qbPOMap` row, whose vendor **is already linked** and whose every SKU **is
  already linked**. POs containing an orphan SKU (§1.6) are skipped and counted
  in the digest, never retried in a loop, until decision D9 lands.
- **Guards:** the preview's `blocked` reasons; header and line read-back.
- **Writes:** QBO PurchaseOrder; ledger `qbPOMap`.
- **Never:** create a vendor as a side effect (the browser engine does this
  today; the server refuses and reports "vendor not linked").

### 5.5 Sales orders → Estimates (non-posting)
- **Select:** sales orders created on or after the cutover (decision D1) with
  a linked customer and no `qbSOMap` row.
- **Writes:** QBO Estimate; ledger `qbSOMap`.

### 5.6 Invoices (posting)
- **Select:** invoices with empty `qb_invoice_id`, created on or after the
  2026-09-01 cutover (61 today), customer linked, `NSA Portal Sales` verified.
- **Guards:** taxable invoices stay blocked until the tax mapping is approved
  (existing rule); discount and A/R account mappings must resolve.
- **Writes:** QBO Invoice; `invoices.qb_invoice_id`; **a new ledger map
  `qbInvoiceMap`** so invoices get the same receipt every other entity has
  (closes the gap in §1.1).

### 5.7 Payments pull (QuickBooks → portal)
- **Select:** invoices with `qb_invoice_id`; QBO Payments linked to them
  (`qbPaymentsAppliedToInvoice`).
- **Writes:** `invoice_payments` rows keyed `(invoice_id, ref = 'QBO Payment #<id>')`
  with **QuickBooks' `TxnDate`, never today's date** (commissions rate on days
  to pay; a wrong date underpays reps permanently); `invoices.paid` and
  `status`; ledger `qbPaymentMap`.
- **Cadence:** nightly, plus hourly during business hours (decision D5).

### 5.8 Bills pull and PO↔bill matching
- **Select:** QBO Bills not in `_syncedBillIds` (moved to `qb_auto_sync`).
- **Match:** reverse `qbPOMap` → `LinkedTxn`; then `DocNumber`/memo
  `PO:` reference (`billReferencesPortalPO`).
- **Writes:** on an exact, reciprocal match: `qbPOBillMap` ledger row and the
  existing PO-line updates. Anything else is reported as a candidate, not
  linked.
- **Note:** `VendorCredit` is still unhandled anywhere in the sync (Silver
  Screen has one for $1,539.47). Out of scope here; tracked separately.

### 5.9 Stage isolation
A failure inside a stage stops **that stage** at the failing record (matching
today's batch behaviour) and the run continues to the next stage. A readiness
failure stops the whole run before any stage.

---

## 6. Time budget, rate limits, retries

- Background budget 15 min. Reserve the last 90 s for writing the run row and
  digest. Each stage checks remaining budget before every record.
- Intuit's published throttle is roughly 500 requests per minute per company
  and 10 concurrent; the engine runs records serially, which is well under it.
- Retry `429` and transient network/5xx errors with bounded exponential backoff
  and jitter, honouring `Retry-After`. Never automatically retry account, tax,
  duplicate-conflict or payload-validation errors; report them
  (`docs/quickbooks-first-push-rollout.md` §"Retry", unchanged).
- Per-stage caps (§4.2) bound a single night's blast radius. At the caps above
  a fully backed-up night is under 1,500 QBO calls.
- The error text recorded per record uses `qbResponseErrorDetail`, so a timeout
  reads as a timeout and an HTTP failure names its status (PR #2210).

---

## 7. Reporting

- Every run writes a `qb_sync_runs` row, including skipped runs with the
  failing readiness conditions.
- **Digest email** (Brevo, same shape as `bill-anomaly-digest`): sent only when
  a run has exceptions, a stage failed, or readiness failed for a new reason.
  A clean night sends nothing. Contents: per-stage counts, the exception list
  with portal IDs and reasons, and a link to the Sync Log.
- The Sync Log page shows the last 30 runs with expandable stage detail. The
  existing manual batch cards are unchanged.
- The Overview counters already derive from database state (an invoice is
  "to sync" when `qb_invoice_id` is empty), so they update on the next page
  load with no extra work.

---

## 8. Safety rules carried over (non-negotiable)

1. Preflight, write, read-back, receipt — in that order, every record.
2. The ledger is written only through `persistVerifiedQBLink`. No hand-written
   rows, ever.
3. Duplicate guards in both directions: portal→QBO (`normalizeQBDuplicateKey`,
   same-name creations) and QBO→portal (`vendorDuplicateKey`, decoration hold).
4. Never loosen a gate to make a run pass. A blocked record is a report.
5. Payments carry QuickBooks' transaction date.
6. Inventory quantities and values never leave the portal.
7. Vendors are never created in QuickBooks automatically.
8. Every stage starts `off`, then `dry`, then `live`, each promotion by a human
   after reviewing the prior run.
9. The kill switch (`enabled: false`) and `paused_until` are honoured before
   anything else, including by the browser's `syncAll`.

---

## 9. Build order

| Phase | What | Effort | Done when |
|---|---|---|---|
| 0 | Controls: `qb_auto_sync` row, `qb_sync_lock`, `qb_sync_runs` table, shared readiness function; browser `syncAll` uses it (replaces the unconditional lock); browser batches take the lock; Settings toggles | ½ day | Browser `syncAll` runs only when R1–R14 pass; a manual batch cannot overlap a run |
| 1 | Move pure helpers to `src/lib/qb/*.js` (CommonJS); browser imports them; tests unchanged and passing; `included_files` updated | ½ day | Zero duplicated logic; suite green |
| 2 | `qb-auto-sync-cron`, `qb-auto-sync-background`, `createServerSyncEngine` skeleton, readiness, run row, digest — all stages `off` | 1 day | A nightly run records itself as skipped/ready with correct reasons and sends no email |
| 3a | **Payments pull** → `dry` → `live` | ½ day | First live run reconciles against QuickBooks Payments for the same invoices |
| 3b | Customers → `dry` → `live` | ½ day | First live run creates/updates only rows the manual review would have |
| 3c | Products (PO-scoped) → `dry` → `live` | ½ day | |
| 3d | Purchase orders → `dry` → `live` (vendor and items must already be linked) | ½ day | |
| 3e | Invoices (cutover forward) + `qbInvoiceMap` → `dry` → `live` | ½ day | Taxable invoices still reported, not posted, until D6 |
| 3f | Estimates → `dry` → `live` | ½ day | |
| 3g | Bills pull and PO↔bill matching → `dry` → `live` | ½ day | Only exact reciprocal matches link |
| 4 | Remove the browser `setInterval`; the Settings page's `autoSync` buttons become the real control; hourly payments cron | ¼ day | Nothing syncs from a browser timer any more |

Payments go first because they are the highest-value, lowest-risk stage
(read-mostly, feeds commissions and A/R) and they exercise the whole pipeline.

---

## 10. Prerequisites: "dialled in" means all of these

The readiness check will refuse to run until these are true, so they are the
finish line for the manual migration:

- [ ] Product batches complete for the creatable PO-scoped SKUs (175 remain of
      2,134); the 9 blocked SKUs reviewed.
- [ ] **Decision D9 on the 850 orphan SKUs (§1.6)** — backfill, generic line, or
      both. Without it the PO stage tops out near 45% coverage.
- [ ] Purchase-order canary passed (**Test 1 Purchase Order**), then PO batches.
- [ ] Payment pull canary passed on one paid invoice.
- [ ] Tax mapping decision from accounting (blocks 60 taxable invoices, $20,774).
- [ ] The 16 customer exceptions resolved or explicitly accepted as permanent
      (Liberty and Lincoln parents are also mis-parented; see session notes).
- [ ] Visalia Youth Baseball Club: reactivate and run once with PR #2210 live
      to learn the real failure; whatever it is will recur.
- [ ] El Camino HS Football 2594: confirm it is not a third copy in QuickBooks.
- [ ] Three vendor renames in QuickBooks (Astra Sport, BYOG Screenprinting,
      Pacific Screen Printing), then re-import.
- [ ] Thirteen imported overhead vendors: **Can be written POs** unticked.

---

## 11. Decisions needed before Phase 3

| # | Decision | Recommendation |
|---|---|---|
| D1 | Estimates: all 1,320 active sales orders, or only those created on/after 2026-09-01? | Cutover forward. Historical estimates add nothing to the books. |
| D2 | Invoices: cutover forward only (61 today)? | Yes. Matches the documented 2026-09-01 cutover; NetSuite history stays where it is. |
| D3 | Auto-imported vendors arrive with **Can be written POs** off? | Yes. A human turns it on for a real supplier; overhead never leaks into pickers. |
| D4 | Products: auto-create only SKUs on purchase orders awaiting sync? | Yes. Never the 62k catalogue. |
| D5 | Schedule: nightly full run at 09:00 UTC plus an hourly payments-only pull 06:00–18:00 PT? | Yes. Payments feed commissions and A/R; the pull is cheap and read-mostly. |
| D6 | Taxable invoices stay blocked until accounting approves the state tax codes? | Yes. Existing rule; nothing changes until Andrea signs off. |
| D7 | May the server **create** customers (guard-clean rows only), or link-only with creations reported for a human? | Create. Tonight's 136 guard-clean creations produced zero duplicates; every creation is listed in the digest. |
| D8 | Digest recipients | accounting@ and steve@, matching the bill anomaly digest. |
| D9 | Orphan SKUs on purchase orders (§1.6): backfill product records, post against a shared generic item, or both? | Both, split by kind. Backfill genuine catalogue gaps; generic-line true one-offs. Needs a sample of the 850 to classify. |

---

## 12. Out of scope for this plan (tracked separately)

- `VendorCredit` handling (none exists anywhere in the sync).
- Multi-company (`methodic`) sync; `_qb.js` supports the key, the engine does not.
- The dead Overview buttons and the `v1777312659133` vendor-ID display leak on
  purchase-order rows.
- Server-side catalogue sync beyond PO scope.
