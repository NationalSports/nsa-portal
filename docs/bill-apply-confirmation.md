# Supplier bill confirmation boundary

Portal-only pushes, credits, QBO completion and Retry save share one confirmation session.

- Prepare the entire bill's target mutations synchronously, outside React state updaters.
- Reject missing targets, stale mappings, no-op mutations and invalid credit reversals before writing.
- Require explicit successful persistence of every changed SO and batch/inventory app-state record.
- SO bill writes use an exact queue attempt, so an unrelated autosave cannot coalesce them away.
- Publish local changes only after all target saves confirm. Record the applied ledger afterward; only then mark the bill successful and close supplier queue rows.
- Retry a failed attempt's exact remaining writes. If only the ledger failed, retry bookkeeping without changing quantities again.
- Hold other bill mutations while an attempt is incomplete; reject stale snapshots rather than overwriting intervening edits.
- Persist an incomplete-attempt marker in `nsa_bill_incomplete_attempts`. After a page reload, the original write set is unavailable: hold the bill for reconciliation instead of inferring success from one target's details or reapplying a partial bill. Do not clear that marker without reconciling all affected targets and the applied ledger.

Invoice and credit identities are separate in both document and supplier-order key spaces. Legacy credit details with negative costs/size deltas remain recognized. Legacy `_applied` flags alone are not proof of persistence.

The Sports Inc queue remains readable during partial loading. Automatic `outside_portal` writes require a complete, current order/customer snapshot; a hydration transition triggers re-triage.

## Verification

Behavioral tests in `billApplyConfirmation.test.js` execute the actual App mutation builders and confirmation functions with mocked persistence. They cover the audited no-op/retry/credit/QBO/inventory failures, real multi-order mapping, stale targets and safety holds. Session tests cover deferred/rejected/unconfirmed saves, concurrency, ledger-only retry and interrupted-page recovery. Dedup and hydration have separate regression suites.

This change does not repair historically stranded production bills. Their target quantities/costs and applied-ledger rows require a separate, controlled reconciliation. It also does not introduce a distributed transaction spanning SOs, app-state records, QBO and the applied ledger.
