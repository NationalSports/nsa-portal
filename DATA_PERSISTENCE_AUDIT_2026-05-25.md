# Data Persistence Audit — 2026-05-25

Scope: client-side persistence engine (`src/App.js` and friends), live Supabase
database security/performance posture, hydration/read path, and server-side
functions (`netlify/functions/*`, `supabase/functions/*`). Read-only audit — no
code or schema was changed.

Priority legend: **P0** = act now (exposure / financial / data-loss), **P1** =
should fix soon, **P2** = hygiene / performance.

---

## Executive summary

The **client-side write engine is genuinely well-fortified** — it has clearly
been hardened in response to past data-loss incidents (quasi-transactional
saves, post-write verification, failed-save tracking, retry/backoff, snapshot
regression scanning, hydration guards). The real risks are **not** in the React
save logic.

The real risks are:

1. **The database is effectively public.** The shipped `anon` key can read
   ~41 tables (customer PII, invoices, orders) and fully read/write/delete a
   dozen tables, regardless of the app's own login. (P0)
2. **Schema drift** — production is ahead of this branch (the entire
   `webstore_*` feature is live but its migrations/code aren't here). (P0 to
   investigate)
3. A couple of **isolated unprotected writes** that don't follow the otherwise-
   solid pattern. (P1/P2)

---

## P0 — Database is wide open to the public anon key

The app authenticates users with real Supabase Auth
(`supabase.auth.signInWithPassword`, sessions — `src/App.js:407+`,
`src/LoginGate.js`). **But Row-Level Security does not leverage that auth.**
Policy audit of the live DB (`pg_policies`):

| Role | Command | # policies | Effect |
|------|---------|-----------:|--------|
| `anon` | SELECT | 41 | `USING (true)` — readable by anyone with the bundled key |
| `anon` | ALL | 1 | full read/write/delete (`adidas_inventory`) |
| `public` | ALL | 13 | full read/write/delete |
| `public` | SELECT | 3 | readable by anyone |

The `anon` key is embedded in the JS bundle and is trivially extractable, so:

- **Customer PII + all business data is readable with no login** — `customers`
  (2,344 rows), `sales_orders`, `invoices`, `estimates`, `products`, etc.
- **Full `ALL` (incl. UPDATE/DELETE) to `public`/`anon`** on:
  `customer_invoices`, `customer_invoice_lines`, `scheduled_emails`
  (an email-send abuse vector), `adidas_inventory`, and all 8 `webstore_*`
  tables. Anyone could delete invoices, rewrite storefront prices, or tamper
  with orders/jersey-number claims.
- **2 ERROR-level `SECURITY DEFINER` views** (`webstore_storefront_products`,
  `webstore_product_eta`) bypass the querying user's RLS.
- 5 `SECURITY DEFINER` functions executable by `authenticated`, 3 by `anon`
  (`is_admin`, `is_admin_or_gm`, `current_profile_id`, …).

**Caveat / judgment:** some of the `webstore_*` openness is *probably*
intentional — a public storefront needs `anon` to INSERT orders without an
account. But granting `ALL` (UPDATE/DELETE) where only INSERT/SELECT is required
is over-broad. The always-true SELECT on `customers`/`invoices`/`estimates`
looks **unintentional** and is the most urgent exposure.

**Recommended remediation (needs sign-off + live testing before applying):**
- Move data-table policies from `anon`/`public` to `authenticated`, keyed on the
  user's profile/role where appropriate.
- For the storefront, scope `anon` to exactly what it needs: `SELECT` on
  `webstore_products`/`webstores`, `INSERT` on
  `webstore_orders`/`webstore_order_items`/`webstore_roster`/
  `webstore_number_claims` — **not** UPDATE/DELETE.
- Recreate the two views as `security_invoker`.
- Enable leaked-password protection in Auth settings.

> Changing RLS can instantly break the live app for all users — do this behind a
> deploy preview with the app exercised against it first.

---

## P0 — Schema drift: production is ahead of this branch

The live DB has migrations `011_webstores` … `018_transfer_variants` (dated
2026-05-24/25) and tables `webstores`, `webstore_products`, `webstore_orders`
(50 rows), `webstore_order_items` (66), `webstore_number_claims` (50),
`webstore_transfers` (21), etc.

**None of these migrations, and no code referencing `webstore_*`, exist in this
branch** (`grep -ri webstore src/ netlify/ supabase/` → 0 matches). The feature
is deployed to prod but unmerged here.

Action: confirm where the webstore code/migrations live (another branch?) before
any schema work, so an RLS migration written here doesn't collide with or
clobber that work.

---

## P1 — Unprotected write: `omg_store_products` delete-then-insert

`src/App.js:3212`

```js
if(supabase){supabase.from('omg_store_products').delete().eq('store_id',s.id)
  .then(()=>{supabase.from('omg_store_products').insert(prods)
    .then(r=>{if(r.error)console.error('[DB] omg products save:',r.error.message)})})}
```

This is the exact anti-pattern the SO/estimate flow was rewritten to avoid:
- **Un-awaited**, no `_retryNet`, no failed-id tracking.
- **DELETE error is never checked.**
- **Non-atomic delete-then-insert**: if the insert fails after the delete
  resolves (network blip, schema mismatch), the store's products are gone with
  no rollback and no alert.

Blast radius is small (22 rows, regenerable from the OMG sync), but it should be
brought in line with the fortified pattern (or routed through `_dbSave` /
insert-verify-then-delete).

---

## P2 — Fire-and-forget deletes in the otherwise-solid save flow

In both the SO save (`src/App.js:1293–1306`) and estimate save (`820–931`), the
final **commit-delete of old rows** and the **rollback-delete of new rows** are
`await supabase…delete()` with **no error check**:

- `so_items`/`estimate_items` have no unique `(parent_id, item_index)`
  constraint (noted in the code comments at 822–824), so if a commit-delete
  fails, the old rows survive *alongside* the new ones → **duplicate line
  items** on next hydration.
- The post-insert verification counts `decorations`/`pick_lines`/`po_lines`
  rows, but does **not** re-check the parent item count after the commit delete,
  so this duplication goes undetected.

Risk is duplication (visible, recoverable), not silent loss — lower severity
than P0/P1, but currently invisible. Suggest: check the delete results and, on
failure, mark the entity failed (it's already wired for retry).

Also fire-and-forget, lower impact:
- `updated_at` bumps (`1312`, `1637`) — failure only causes cross-tab staleness.

---

## What's already solid (no action needed)

The client write/hydration engine is well-defended. Notable mechanisms:

- **Quasi-transactional SO/estimate saves** (`1155–1318`, `822–934`): insert new
  alongside old → verify with `COUNT` → commit-delete-old or rollback-delete-new.
- **Failed-save tracking** persisted to localStorage (`_dbSaveFailedIds`,
  `_dbSaveFailedErrors`), with exponential-backoff retry (`3732+`), retry on tab
  focus (`3702`), and a `beforeunload` warning when saves are pending (`3698`).
- **Per-entity save queue** (`_queuedEntitySave`, `1646`) collapses concurrent
  saves and avoids racing the same record.
- **Network-vs-server error distinction** + retry (`_retryNet`, `1704`); only
  transport errors are retried.
- **Optimistic-concurrency `_version` guards** on art files (`1155–1175`) — never
  overwrite a DB row newer than the client's.
- **Hydration guards**: per-table `_itemsHydrated`/`_artHydrated` flags
  (`634`, `657`) so a timed-out load is never mistaken for "empty" and can't
  trigger a delete; writes double-gated on `_initialLoadDone && _dbLoadSuccess`
  (`3124`).
- **Boot-time snapshot regression scan** (`3653`) alerts if an SO has fewer items
  than its last good snapshot.
- **localStorage quota budgeting** (`1668–1682`) — 1 MB/key, 4 MB total, cloud is
  source of truth, unbounded logs are cloud-only.
- **Paged reads with per-query timeout** (`_safeQuery`, `327`) — handles >1000
  rows and won't hang forever.

---

## Full line-by-line code audit — `App.js` + `OrderEditor.js`

Both files were read end to end (App.js 1–25,966; OrderEditor.js 1–8,965).
Findings below are *in addition* to the engine review above. Items marked
**(verified)** were re-read and confirmed by hand.

### P1 — fulfillment / financial integrity

- **Batch "Confirm Received" records the wrong quantity** — `App.js:8718`
  **(verified)**. The received-qty inputs are rendered with id `rcv-<i>-<size>`
  where `i` indexes the *filtered* PO items (`:8667`), but read back with
  `document.getElementById('rcv-'+allPOLines.indexOf(ml)+'-'+k)` — the *global*
  index across all PO lines. For any multi-line / batch PO the two index spaces
  diverge, the lookup returns `null`, and the code falls back to `rcv[k]=v` —
  **the full ordered quantity**. So receiving a batch silently writes "received =
  everything ordered" regardless of what was counted, then `savSO` persists it.
  Corrupts fulfillment/short-ship tracking. (Single-line POs happen to line up;
  the invoice-PO receive at `:25793/:25808` uses a consistent scheme and is fine.)

- **~~"Apply Credit" can be spent more than once~~ — NOT A BUG (verified).**
  Initial read of `OrderEditor.js:2236` suggested applying a credit never
  decrements the ledger. On verification, the deduction happens at estimate→SO
  conversion (`App.js:4583–4598`): `credit_applied`/`credit_amount` is consumed
  via `_dbSaveCreditUsage`/`_dbSaveCredit` against the *current* balance, so an
  exhausted credit can't be re-spent on a later order. The editor click only sets
  the flag; consumption is recorded at conversion. No fix needed. (Left here as a
  record of the false positive.)

- **Final invoice closes the SO even if the invoice didn't save** —
  `OrderEditor.js:4869–4871` **(verified)**. `onInv(prev=>[...prev,inv])` then,
  for a final invoice, `onSave({...o,status:'complete'})` — neither result is
  checked. A failed invoice insert can leave a *completed* SO with no invoice
  (unbilled work), with no rollback.

- **Editor reports itself "saved" on a failed write** — `OrderEditor.js:718`
  **(verified)**, and the pervasive `setO(x); onSave(x); setDirty(false)` pattern
  throughout the editor (e.g. `1884, 1992, 2084, 5939, 6361, 7166, 8108, 8790`).
  `onSave`'s result is never checked and `setDirty(false)` runs unconditionally,
  so the editor's own unsaved-changes guard (and 30s autosave) treat a failed
  save as success. **Backstop:** the App-level `_dbSaveFailedIds` tracker still
  catches `_dbSaveSO`/`_dbSaveInvoice` failures and raises the global banner —
  so it is not *total* silent loss, but the editor's local state lies.

### P2 — fragile inputs, money model, mutation

- **Money & quantities read straight from uncontrolled DOM inputs** —
  `OrderEditor.js:5340–5573` (PO / deco-PO create), `7943, 8000, 8723, 8768,
  8837` (receive / cancel / shipment edit), `App.js:8836` (batch-PO edit). These
  use `defaultValue` + `document.getElementById(...).value` read at save time.
  If React re-renders/remounts the node mid-edit (a background poll/realtime
  update), typed-but-unsaved numbers silently revert to the default. These feed
  cost, commission, and inventory math.
- **CC surcharge inflates `invoice.total`** — `App.js:9109`. Each card payment
  does `newTotal = inv.total + fee`; two card payments double-add the fee, and
  commission/GP reporting reads `inv.total`. Surcharge should be tracked
  separately.
- **In-place mutation that can desync the snapshot diff** — `App.js:1072/1109`
  **(verified)** (SO PO/pick restore reassigns `ci.po_lines`/`ci.pick_lines` on
  possibly-live state objects; rare restore path only), `App.js:13338` (OMG
  cost-lookup mutates `p.cost` on live products), `OrderEditor.js:8268`
  (delete-PO mutates an item inside a shallow copy).
- **Ship-modal merge drops sizes** — `App.js:15164/15202`. Merging into an
  existing box rebuilds `sizes` from only the incoming `ai.sizes`, dropping any
  size already in the box but absent from the new add → undercounts box units.
- **UPS auto-pickup loop overwrites from a stale SO snapshot** —
  `App.js:13660–13663, 14838`. The loop calls `savSO({...shp.so,...})` from a
  base captured at loop build; multiple shipments on one SO each overwrite from
  the same base, so only the last pickup flag survives. (The receive flow groups
  by SO to avoid this; the pickup loops don't.)
- **`Date.now()`-based IDs can collide** — `OrderEditor.js:3934` (batch PO),
  `5604` (messages). Rapid successive creates in the same millisecond collide;
  deco/Topstar POs add `Math.random()`, these don't.
- **Inventory CSV zeroes stock on non-numeric cells** — `App.js:18883`. A
  non-empty, non-numeric cell (e.g. "N/A") parses to `0` and is written,
  overwriting real on-hand with zero.
- **Vendor import looks successful but persists nothing** — `App.js:18753–18771`
  (read-only by design; misleading to the user).
- **Promo/credit usage writes are fire-and-forget after the period save** —
  `App.js:4577, 4592`; `OrderEditor.js:2202–2295`. Optimistic in-memory update
  with no rollback if the usage insert fails → promo/credit balance can drift.
- **OMG store financial fields may not persist** — `App.js:13244–13374`. The
  `_omg_shipping/_tax/grand_total/...` fields written here are saved only if they
  are in the `omg_stores` column allowlist used by `_dbSave`; worth confirming
  they aren't dropped by the `_pick` filter.

### Confirmed clean (large portions)
The invoice detail/modals, reports & analytics, commissions, QB sync,
bill-apply (freight proration with remainder handling), sales tools, team
management, and the warehouse receive (grouped-by-SO) paths are well-guarded:
money uses `safeNum` + `Math.round(x*100)/100`, state changes auto-persist via
the `_diffSave` effects, and the async art/email saves correctly branch on the
result before clearing state.

---

## P2 — Performance advisors (live DB)

- **67 unused indexes** — write overhead; candidates for removal once confirmed
  unused over a full business cycle.
- **9 unindexed foreign keys** — slower joins/cascade deletes.
- **23 tables with multiple permissive policies** — symptom of the always-true
  policy sprawl; consolidating RLS (P0) fixes this too.
- **2 `auth_rls_initplan`** — wrap `auth.uid()`/`auth.role()` calls in a scalar
  subquery (`(select auth.uid())`) so they're evaluated once per query, not per
  row.

---

## Server-side functions (`netlify/functions/*`, `supabase/functions/*`)

Ranked by data-loss / financial risk. File:line references spot-checked and
confirmed.

### P0 — financial / double-processing / abuse

- **`stripe-payment.js:34` — creates Stripe PaymentIntents with no idempotency
  key and no caller auth.** CORS `*`, no token/signature — *any* internet caller
  can mint intents and set `receipt_email` (`:45`) to spam arbitrary addresses
  with NSA receipts. `amount_cents` is only floor-checked (`>=50`, `:30`), no
  ceiling. A client retry creates a fresh intent each time (duplicate intents;
  duplicate charges less likely since confirmation is per-intent client-side).
  Secret read from env (`:6`) — good. **Fix: require auth, add an idempotency
  key, add an amount ceiling.**
- **`supabase/functions/taxcloud-capture/index.ts:129,174` — `AuthorizedWith
  Capture`/`Returned` to TaxCloud with no idempotency.** `cartID=invoice_id`,
  `orderID=so_id`, so re-invoking with the same IDs **re-reports the same tax
  transaction → double-counting in state filings.** Lookup→Capture is two
  non-atomic calls. Always returns `status:200` (`:143,:188`) even on failure,
  so cron/callers can't detect errors.
- **`qb-api.js:56,80–222` — QuickBooks customer/invoice/payment/PO/inventory
  mutations driven by a client-supplied `access_token`+`realm_id` from the
  request body; no server auth, no idempotency** on invoice/payment upserts.

### P1 — silent data loss / unauthenticated service-role writes

- **`omg-store-ingest.js:126–148` — server-side DELETE-then-INSERT of
  `omg_store_products`** (same anti-pattern as App.js:3212, here in the trusted
  tier). DELETE result not checked (`:128`); if the INSERT (`:134`) fails,
  products are already gone. Store upsert failure (`:120`) only `console.error`'d
  but still returns 200. **No auth — a public webhook anyone can trigger to
  ingest/wipe.**
- **`create-quote-request.js:40` — inserts `quote_requests` via service role,
  no auth.** CORS `*`; `created_by`/`customer_id` are caller-supplied and
  trusted (forgeable). Client-supplied `id` (`:34`) gives accidental PK-collision
  protection but no real dedupe.
- **`portal-action.js` — service-role writes with a column allowlist (`:16–18`,
  good) but no caller auth and does not verify the `so_id`/`id` belongs to the
  portal's `alpha_tag`** (acknowledged in its own comment, `:14`). Any caller can
  patch any SO's allowlisted columns / approve any estimate. Idempotent, so no
  duplication.
- **`send-scheduled-emails/index.ts` — solid overall** (batch cap,
  `attempt_count`/`MAX_ATTEMPTS`, per-row status, prune) but **not idempotent**:
  if Brevo send succeeds and the status UPDATE (`:121`) fails, the row stays
  `pending` and re-sends next run (duplicate email).
- `roster-submit.js:54` — emails roster CSV; send result *is* checked (`:61`),
  no DB write. A double-POST sends duplicate emails (no dedupe). Lower risk.

### P1 — hardcoded credential

- **`richardson-inventory.js:26` — `DEFAULT_KEY = 'A9fK2Qm8ZxP7L4R3WcH6D'`**
  committed to source, used as the fallback feed apikey at `:36` when
  `RICHARDSON_FEED_KEY` is unset. **Rotate it and make it env-only.** (Verified.)

### Clean

- `team-invite.js` / `team-deactivate.js` — gated by `verifyAdmin()` (JWT +
  admin role, `_shared.js:28–47`); write errors surfaced.
- `qb-callback/index.ts` — idempotent token upsert on `key`; errors surfaced.
- `ai-order-builder/index.ts` — parse-only, no DB write.

### Top server-tier fixes
1. Add caller auth + Stripe idempotency key + amount ceiling to
   `stripe-payment.js`.
2. Authenticate the public service-role endpoints (`omg-store-ingest`,
   `create-quote-request`, `portal-action`) and scope `portal-action` to the
   requesting `alpha_tag`.
3. Add idempotency to `taxcloud-capture` and `qb-api` invoice/payment writes.
4. Make the `omg-store-ingest` product replace transactional and check the
   DELETE result.
5. Rotate and remove the hardcoded Richardson key.
