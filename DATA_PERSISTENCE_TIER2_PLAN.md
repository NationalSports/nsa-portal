# Data Persistence — Tier 2 Plan (handoff for a fresh session)

**Date:** 2026-07-07 · **Status:** planned, not started.
**Source:** the 07-07 data-persistence deep dive (two full audit passes over the
current post-dbEngine-extraction code, with column diffs verified against the LIVE
database via information_schema, project `hpslkvngulqirmbstlfx`). Tier 1 of that audit
(cost-lock whitelist, SO scalar-clobber guard, bill-apply ordering, invoice `_version`,
refund idempotency) is being implemented on branch `claude/persistence-tier1`.

## Read this first (sequencing + prerequisites)

- **Item C depends on the "workflow leaks" sprint PR** (branch
  `claude/workflow-leaks-sprint`): that PR generalizes the `_batchPosDirtyUntil`
  dirty-window to more app_state keys. C builds on that mechanism — branch from it or
  wait for its merge. Starting C from plain main will conflict.
- **Items A and C touch `src/lib/dbEngine.js` and `src/App.js` hydration/merge code**
  — the same files as `claude/persistence-tier1` and `claude/workflow-leaks-sprint`.
  Do not start A or C until both of those PRs are merged. **Item B is independent**
  (migrations + scripts only) and can start immediately.
- **Model tier:** B and C are fully specified below — mid-tier (Sonnet/Opus)
  executable. A's *design* (the version-gate rule in A2) is the load-bearing decision
  — review that at top tier before implementing; the implementation itself is
  delegable.

---

## A. Durable edit outbox — fixes the two HIGH structural findings (~2–3 days)

### The problem (verified)
- The failed-save ledger persists **IDs only**: `nsa_save_failed_ids` is in the
  localStorage essential set (`dbEngine.js` ~2166–2173), but the entity **content**
  is never routinely cached — `nsa_sos`/`nsa_ests`/`nsa_invs` are written only inside
  a one-time ID-migration branch (`App.js` ~2040–2043; only other writer is the
  "Clear Cache" button ~30302). After a reload with a failed save: boot state has no
  copy of the edit, the merge guard falls through to the DB row, the edit is gone,
  and a content-less "N failed to save" banner persists. (Audit finding F1.)
- On unrecoverable session death, `_forceReauth` (`App.js` ~5140–5145, triggered from
  `dbEngine.js` ~1744) dispatches a flush event whose save fails (session is dead),
  then unmounts the app — destroying all dirty React state. The recovery button in
  `index.js` (~133) runs `localStorage.clear()`, which also wipes the failed-ID
  ledger. (Finding F2.)

### Design (3 pieces)
1. **Outbox on failure.** In each `_dbSave*Inner` failure path (where
   `_dbSaveFailedIds.add(id)` happens today), also persist the full entity payload to
   localStorage key `nsa_outbox`: `{ [table+':'+id]: {payload, baseVersion, ts,
   attempts} }`. `baseVersion` = the `_version` the edit was based on. Add
   `nsa_outbox` to `_LS_ESSENTIAL` (`dbEngine.js` ~2150+) so the 4 MB budget/quota
   logic can never silently drop it. Cap total outbox size; oldest-first eviction
   WITH a loud console/toast if eviction ever happens.
2. **Rehydrate on boot — the load-bearing rule.** On `_dbLoad` completion, for each
   outbox entry: if the DB row's `_version` **≤ baseVersion**, re-apply the outbox
   payload into state and let the normal retry flow save it; if the DB row's
   `_version` **> baseVersion** (server moved on), do NOT apply — surface a conflict
   card ("unsaved edit from <ts>; server has newer changes — view / apply anyway /
   discard") and leave the DB copy in state. Never silently overwrite newer server
   data with a stale outbox: that failure mode is worse than the loss it prevents.
   Entities without `_version` (until the Tier-1 invoice migration lands everywhere)
   fall back to conflict-card-always.
3. **Session-death capture + guardrails.** In `_forceReauth`, BEFORE `setCu(null)`,
   synchronously snapshot every entity in `_dbSaveFailedIds` + `_dbSavePendingIds` +
   any open editor's dirty draft into the outbox (localStorage needs no session).
   Exclude `nsa_outbox` + `nsa_save_failed_ids` from the `index.js` recovery button's
   clear. Add a `beforeunload` warning while the outbox or pending set is non-empty.

### Acceptance
- Kill network → edit SO → reload → edit is back in state, banner names it, retry
  saves it when network returns.
- Simulate `_version` advance by another client between failure and reload → conflict
  card, no silent overwrite.
- Simulate session death mid-edit → after re-login the outbox restores the draft.

---

## B. Schema-drift reconciliation (~1 day + a process change) — start anytime

### The problem (verified against live DB this session)
Live DB and `supabase/migrations/` disagree in BOTH directions:
- Live columns with **no migration**: `sales_orders.source`, `sales_orders.webstore_id`,
  all `sales_orders._omg_*` columns (added out-of-band).
- Migration exists but **absent from live**: `invoices.shipping_name` /
  `shipping_address` (migration 00101 never applied) — this is why the invoice
  shipping-override feature silently doesn't persist (the columns sit in
  `_invExtraCols`, get stripped on the error-retry, and the invoice saves without
  them).
- Consequence: `scripts/check-schema-drift.js` + `migration-baseline.json` are
  validating against a fiction; whitelist audits based on migration files alone reach
  wrong verdicts.

### Steps
1. Dump the live schema (`supabase db pull` or an information_schema export).
2. Write ONE reconciliation migration capturing the out-of-band DDL exactly as it
   exists live (comment each column with "reconciliation — added out-of-band").
3. Decide `invoices.shipping_name/shipping_address`: **recommend applying** (the code
   already tries to write them; applying un-breaks the feature). Remove them from
   `_invExtraCols` once live.
4. Regenerate `migration-baseline.json`.
5. Point drift checking at the LIVE schema on a schedule (scheduled job or CI step
   with a read-only connection), not just the files.
6. Team rule going forward: all DDL through migrations — including hotfixes.

---

## C. app_state hardening — the deferred Tier-1 item (~1 day; AFTER the sprint PR merges)

Full key inventory with risk ranking is in the 07-07 audit (part 1, §3). The
dangerous keys, all last-write-wins whole-blob upserts via `_saveAppState`
(`App.js` ~3641):

1. **Document counters** — `inv_po_counter`, `batch_counter`,
   `batch_vendor_counters`: two machines advancing concurrently mint duplicate PO
   numbers. **Fix:** Postgres sequences behind a tiny RPC, exactly like the existing
   webstore PO sequence (`supabase_migration_072_po_number_seq.sql` — copy its
   shape). Replace read-increment-write call sites with the RPC.
2. **Money keys** — `labor_rates` (payroll rates, ~27640), `comm_overrides`
   (~11857, DB-hydrated since the 07-07 hardening PR): per-key compare-and-swap —
   store a `_v` counter inside the blob; on save, `UPDATE ... WHERE value->>'_v' =
   <expected>` (or an RPC doing CAS); on mismatch, refetch + notify instead of
   clobbering.
3. **Append-blob logs** — `change_log`, `so_history`, `est_history`, `inv_adj_log`,
   `job_time_logs`, `wh_recent_actions`: a client holding a stale blob drops entries
   another client just appended. **Fix (right):** append-only rows in a real table
   (one `app_events(key, entry jsonb, created_at)` table covers all of them; readers
   aggregate). **Fix (minimum):** extend the sprint PR's dirty-window guard to every
   one of these keys. Migrate the highest-value one first: `job_time_logs`
   (payroll-adjacent).

### Acceptance
- Two browsers create inventory POs simultaneously → distinct numbers, always.
- Two browsers edit labor rates → second save gets a conflict refetch, not a silent
  revert.
- Concurrent warehouse actions on two phones → both time-log entries survive.

---

## Pointers for the executing session
- Audit evidence lives in this repo's history: the two 07-07 audit reports are
  summarized in the PR descriptions of `claude/persistence-tier1` and referenced in
  `FABLE_HANDOFF_SPECS_2026-07-07.md` (earlier specs 1–4, still valid, partly done).
- Follow repo CLAUDE.md: branch `claude/<task>`, PR to main, deploy-preview review,
  never merge without owner approval. Migrations are files-only until the owner
  applies them.
