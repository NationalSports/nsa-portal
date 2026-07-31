# "PO dropped from portal" — code-level root cause + prevention plan (SO-1663)

**Date:** 2026-07-31
**Trigger:** SO-1663 shorts (PO 28950 SANBA) lost its purchase-order line. Data already
restored by a prior session as PO 35700 SANBA (see the SO1663 handoff). This doc records what the
*code* actually does, so the prevention fix is designed against facts rather than the incident summary.

## What this session shipped (safe, independent — no money-path code touched)

- **Detection.** `scripts/data_integrity_monitor.sql` gains the `so_orphaned_po_claim` invariant, and
  `scripts/order-integrity-scan.sql` gains drill-down §2g. Together they flag any order that reserved a
  PO number (`po_number_claims`) which never became a `so_item_po_lines` row **while the order still has
  an uncovered line item** — the SO-1663 signature — so the next occurrence surfaces same-day instead of
  via a customer email. De-noised (claim older than a day, whole-number match, order genuinely has a
  zero-PO item) because `po_number_claims` is intentionally noisy: a claim is written every time a PO
  form opens (`OrderEditor.js:681`), and reps abandon numbers routinely. **A non-zero count is a triage
  lead, not a proven loss.**
- **NOTE — not yet executed against production.** The Supabase connection was down for the whole session,
  so these queries were written and reviewed but **not run**. First run must (a) confirm they execute and
  (b) establish the baseline count in `DATA_INTEGRITY_MONITOR_2026-07-30.md`. Also re-verify SO-1663 shows
  PO 35700 on the shorts (item 314540) — reported fixed by the prior session, unverified here.

## Root cause (confirmed by reading the code, not inferred from the incident)

PO 28950 / 35700 are **individual "Create PO" numbers** (`PO nnnnn TAG`, seeded from `poCounter`), not
batch (`NSA nnnn`) numbers — so this was an individual Create PO, not a batch-queue PO.

The loss is a **first-flush race**, not a save-path bug:

1. **Create PO is local-first.** `OrderEditor.js:8663-8664` builds the new PO line into the item, then
   `setO(updated); onSave(updated)`. `onSave` saves the tab's copy and syncs to the cloud
   *asynchronously* ("saved locally — syncing to cloud…"). The PO *number* is reserved the instant the
   form opened (`po_number_claims` upsert, `OrderEditor.js:681-689`) — well before the line is persisted.
2. **The window.** Between `onSave` firing and the row actually landing in `so_item_po_lines`, the line
   exists **only in that one tab's memory**. If a second tab (or another rep) has the order open and its
   save lands first — or a poll/realtime reload replaces this tab's order state with the DB copy that
   lacks the new line, or this tab closes/fails before its sync completes — the un-flushed line is gone.
   Its reserved number remains as an orphaned `po_number_claims` row. That is SO-1663 exactly, and matches
   Jered's "2 tabs open with same order" description.
3. **Why the existing net can't catch it.** The SO save path (`src/lib/dbEngine.js`) is heavily guarded —
   `_version` optimistic-concurrency (`~1204`), the stale-content guard (`~1364`), and the PO-line restore
   pass (`~1560`). But every one of those operates on **rows that reached the DB**: the restore pass
   re-injects DB PO lines the client's payload is missing, and blocks if it can't match them. A line that
   was **never written to the DB** is invisible to all of them — there is nothing to restore or compare
   against (`so_item_po_lines` has zero audit history for item 314540 / PO 28950). **So there is no
   save-path-only fix for this class** — the fix must make the line durable *before* it can be raced.

## Related second hole (distinct, worth closing separately)

Batch POs live in `app_state.batch_pos` (one JSON blob) until submitted (`App.js:3951` writes it;
`orderVendorBatch`, `App.js:8804`, promotes queued lines into `so_item_po_lines`). That blob's only
cross-tab protection is a **12-second** last-writer-wins dirty window (`_batchPosDirtyUntil`,
`App.js:2706/3951`); after it lapses a reload adopts the incoming blob wholesale. A PO queued in one tab
can be dropped by another tab's write before the batch is submitted — same fingerprint (claimed number,
no line), different path. Not SO-1663's cause, but the same failure mode.

## Prevention — recommended, in priority order (design + test deliberately; money path)

1. **Durably persist a new PO line at creation.** On Create PO, write the line to `so_item_po_lines`
   immediately/atomically (mirroring the direct-write pattern of `_dbUpdatePickLineStatus`,
   `dbEngine.js:2890`) instead of relying only on the debounced whole-SO save — or enroll the create in
   the durable outbox so it retries until it lands even if the tab closes. This is the direct cure: it
   removes the "line lives only in one tab's memory" window. **Risk: duplicate PO lines** if the immediate
   write and the subsequent full-SO save both insert — must dedupe by a stable line key. Needs a
   regression test in `dbEngineHardening.test.js` reproducing the two-tab drop (fails before, passes after).
2. **Harden `batch_pos` cross-tab sync** (merge queued entries by a stable key instead of LWW, tombstoning
   anything already in `submitted_batches` so an ordered PO can't resurrect). Closes the second hole.
   **Risk: double-ordering inventory** — the reason this is not a quick change.
3. **Optimistic-concurrency on the whole SO already exists** and covers the broader two-tab class *where
   the data reached the DB*. It does **not** recover SO-1663's never-flushed line (verified above), so it
   is not sufficient on its own for this bug — (1) is.

## Files
- `scripts/data_integrity_monitor.sql` — new `so_orphaned_po_claim` check.
- `scripts/order-integrity-scan.sql` — new §2g drill-down.
- Prevention work (not done here): `src/lib/dbEngine.js` (SO save / PO write), `src/OrderEditor.js`
  (Create PO), `src/App.js` (`batch_pos` sync), tests in `src/__tests__/dbEngineHardening.test.js`.
