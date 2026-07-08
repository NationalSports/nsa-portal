# Ready-to-Run Specs — 2026-07-07

Written during the 07-07 hardening pass (commissions persistence, reporting guardrails,
art-approval portal guards, Sports Inc writeback durability — see that branch's commits).
Each spec below is a bounded follow-up that deliberately did NOT fit that pass. They are
sized and sequenced for a mid-tier model (Sonnet/Opus) to execute without re-deriving the
analysis; file:line references are from the 07-07 branch.

Priority order: Spec 1 > Spec 2 > Spec 3 > Spec 4. Specs are independent of each other.

---

## Spec 1 — One server-side source of truth for supplier-bill status + history

**Problem.** Bill lifecycle state lives in three places, synced best-effort by hand:

1. `savedBills` — localStorage `nsa_saved_bills`, **capped at 200 entries**
   (`App.js`, `.slice(0,200)` in the save path near the PDF parser ~22380). It doubles as
   the "Bill History" view and as a dedup fallback in `_docAlreadyApplied` (~23470).
2. `supplier_bill_holds` — server, Look-at-Later holds only (migration `00177`). Parked/
   resolved bills survive re-pull cross-machine; *pushed* bills do not.
3. `si_documents` — server, Sports Inc queue rows with their own `status`/`resolved_*`.

Consequences: pushed-bill history evaporates per-browser (cleared cache, >200 newer
bills); dedup for pushed bills then rests solely on SO `_bill_details`; the UI literally
warns "Flagged on this device only — server save failed" (~23690, ~23880).

**Design.**
- New table `supplier_bills` (migration via `supabase/migrations/` + drift-checker flow):
  `id uuid pk`, `doc_number text`, `si_doc_number text null`, `supplier text`,
  `po_number text`, `doc_total numeric`, `status text` ('pushed'|'parked'|'resolved'|
  'failed'), `portal_status text`, `resolution jsonb`, `applied_so_ids text[]`,
  `pushed_by text`, `pushed_at timestamptz`, `raw_meta jsonb`, `updated_at timestamptz`.
  Unique on `(doc_number, supplier)`; index on `si_doc_number`. RLS: authenticated staff
  read/write, no anon.
- On every successful push (`applyBillToSO` success path, where `portalStatus==='success'`
  is set, ~24040), insert/upsert the row **awaited with retry** (reuse the `_siMarkDoc`
  retry shape added 07-07 at ~20986).
- `_docAlreadyApplied` (~23470): consult `supplier_bills` (loaded once alongside
  `loadBillHolds`, ~21030) *before* the localStorage fallback. Keep the SO `_bill_details`
  check — it is the ground truth that money moved.
- Bill History view reads the union of `supplier_bills` + local unsaved entries;
  localStorage becomes a cache, drop the 200-cap semantics (cap stays fine for cache).
- Migrate `supplier_bill_holds` reads to the same table only if trivial; otherwise leave
  holds alone (they work) and note the eventual merge.

**Verify.** Push a bill → row exists; clear localStorage → Bill History still shows it and
re-importing the same PDF dedups. Two browsers: push in A, pull in B → B shows captured.
**Size.** 1–2 days.

## Spec 2 — Commission snapshot at payment time

**Problem.** Commissions are 100% derived at render (`CommissionsPage.js` `calcGP`/
`buildCommLines`). Editing an SO after an invoice is paid retroactively changes the
already-earned commission and can move it between monthly statements. (07-07 fixed
override hydration and the nondeterministic paid-date; this is the remaining structural
gap.)

**Design.**
- Migration: `commission_snapshots` table — `invoice_id text pk`, `so_id`, `customer_id`,
  `rep_id`, `gp numeric`, `rate numeric`, `amount numeric`, `paid_date date`,
  `days_to_pay int`, `override jsonb null`, `snapped_at timestamptz`, `inputs jsonb`
  (the calcGP components: rev, cost, ship, freight, fundraise — for audit).
- Write path: when an invoice transitions to `paid`/`partial` — client `recordPayment`
  (`InvoicesPage.js:27`) and server `reconcileInvoiceFromIntent` (`_shared.js:188`) — the
  CLIENT snapshot on next CommissionsPage mount is acceptable v1: on mount, for any
  earned line lacking a snapshot, compute via the existing `calcGP` and insert; lines WITH
  a snapshot render from it. This avoids duplicating calcGP server-side (known mirror-drift
  hazard — see FABLE_SYSTEM_AUDIT Rebuild 2) while still freezing numbers once seen.
- Admin "re-snapshot" button per line (visible on admin role only) for deliberate
  corrections; overrides update the snapshot row, not just app_state.
- Statement month keys off `paid_date` in the snapshot, immutably.

**Verify.** Pay invoice → snapshot row; edit SO garment cost → commission line unchanged;
re-snapshot button reflects the edit. Tests: extend `src/__tests__` commission tests
(attribution tests exist since commit `82cd74b`) with a snapshot round-trip.
**Size.** ~1 day.

## Spec 3 — Reports beyond the 20k row cap

**Problem.** Every Reports number is a client-side reduce over arrays capped at 20,000
rows per table (`dbEngine.js` `hardLimit` ~105, history explicitly `limit:20000` ~365).
07-07 added detection + a partial-data banner (`_truncatedTables`); this spec removes the
limit's impact rather than just disclosing it.

**Design (pick per table, smallest first).**
- `customer_invoices` (NetSuite history — biggest near-term risk, date-desc so the OLDEST
  rows drop first, and monthly-billed YoY at ~12080 is exactly what breaks): replace the
  client reduce with a SQL view + RPC, e.g. `hist_invoice_monthly(rep_name?, year?)`
  returning month × rep × total. The YoY tab reads the RPC; raw rows stay capped for
  drill-down only.
- `invoices`/`sales_orders`: raise no caps; these are bounded by active business volume
  for now. Re-check when the banner fires.
- Keep `_truncatedTables` — it's the tripwire that tells you when the next table needs
  its own RPC.

**Verify.** Seed >20k hist rows locally (or lower hardLimit to 100 in a test) → YoY totals
match SQL sums, banner gone for migrated tables.
**Size.** 0.5–1 day for the history RPC.

## Spec 4 — Small consistency sweeps (batchable, mechanical)

1. **Rep attribution:** ~10 remaining inline `primary_rep_id||created_by` copies in
   `App.js` (dashboard todos ~7041, messages ~6848, CSR views ~7883, repOf ~7129, etc.) →
   `commissionRepId()`. Pure find/replace + eyeball; do NOT touch semantics where the
   fallback differs deliberately (e.g. `getRepForCustomer` has no created_by fallback).
2. **`invoice_payments.cc_fee` schema drift:** `dbEngine.js:1631` writes `cc_fee` and
   upserts `onConflict:'invoice_id,ref'`, but `supabase/migrations/00007:514` shows
   neither the column nor the unique constraint, and the load select (`dbEngine.js:474`)
   drops `cc_fee`. Check live schema (`supabase db diff`); add migration for the column +
   unique constraint, and add `cc_fee` to the payments select. Commission math is
   unaffected (uses invoice-level cc_fee) — this is hygiene that prevents the
   DELETE+INSERT upsert fallback from firing.
3. **Days-to-pay `updated_at` fallback** (Reports ~11952): tolerated for analytics, but
   once Spec 2 lands, read `paid_date` from snapshots instead.

**Size.** Half a day together.

---

### Explicitly out of scope (tracked in FABLE_SYSTEM_AUDIT_2026-07-03.md)

- Margin-math consolidation (soCalc / calcOrderMargin / calcTotals / OrderEditor totals —
  "Rebuild 2"): do not attempt piecemeal; it needs the shared-pricing-module rebuild.
- Finishing the Sports Inc queue approve → QB posting flow (product decision pending).
- app_state last-write-wins versioning (audit Targeted improvement 4.3).
