# Durable QBO links: first migration release gate

## Live evidence — September 5, 2026

Read-Only Live Preflight was run in the in-app browser at 6:33 AM Pacific.
It succeeded for National Sports Apparel LLC, realm `9341456492604246`.
All configured account numbers and types resolved, including 40000 Sales,
51300 Purchases, 51000 Freight In, 40100 Shipping Expense, and 52000 Outside Decoration.
QBO reported 2,345 customers, 169 items, 81 bills, and 9 purchase orders.
No QBO records were created or updated during that initial read-only investigation; later preview canary activity is recorded below.

The Overview showed 0/2540 customer links and 0/10575 product links after a
fresh portal login. A read-only database query independently confirmed that
`app_state.qb_config` contained zero entries in all four migration maps, while
31 sync-log entries remained. The zero counters therefore reflect missing
saved maps, not evidence that QBO entities disappeared.

## This release

Verified customer, product, Estimate, and Purchase Order canaries save separate
`app_state` receipts keyed by realm, map, and source ID. Each save is awaited,
compares any prior value before updating, and requires database read-back.
Conflicting QBO IDs block. Inactive-link cleanup retains a tombstone, so an old
configuration or stale retry cannot resurrect the removed link.

Both initial-load paths restore all four maps and verification logs from these
receipts. Receipts already acknowledged in the current session also win over a
late initial-load response. Background polling excludes these initial-load-only
rows to avoid repeatedly fetching the entire migration ledger.

Existing matching NonInventory items are linked without QBO updates; type,
inactive-state, SKU, and account conflicts block. Customer read-back rejects
inactive records. SO/PO read-back verifies dates as well as identity and total.
Taxable Estimates block. Sync Everything and customer/product/SO/PO batches stay
locked in the UI and engine, independently of supplier-bill approval.

## Required live verification after deployment

1. Run Read-Only Live Preflight and check the exact company and realm again.
2. Run Del Lago Academy as link-only recovery. Require QBO customer #2380;
   stop on a creation prompt, a term-change prompt, or an ID mismatch.
3. Run SKU 0000 and require QBO item #263 as a link-only result (operator approved replacement of inactive Inventory item #183 on September 5). Stop on any conflict.
4. Verify the two receipts in the database, including realm, source ID, QBO ID,
   API verification, and result. Capture the operator-reviewed canary screens.
5. Hard reload, then sign out/in, and verify links, counters, and receipt logs.
6. Independently verify Dana Hills Football #575 and a supplier-bill SKU.

Do not seed links from this document or from counters. Every recovered link
requires a fresh QBO read-back through the canary.

## Still pending

This release does not complete the migration. Customer production read-back,
exception manifests, per-entity batch approval, complete product backfill,
Estimate product-detail/fallback approval, and native PO-to-existing-bill
reconciliation remain later controlled releases. Inventory PO scope is still
undecided. No customer/product/SO/PO production batch has run in this task.
The live reload/fresh-login acceptance gate is pending deployment and canaries.

## Local verification

The full Jest run passed 313 suites / 4,823 tests. The focused migration run
passed 6 suites / 88 tests, including failed storage, conflicting IDs,
cross-realm isolation, restoration of all four maps, tombstones, customer retry,
link-only SKU variants, and batch locks. The production build passed with the
repository's existing third-party source-map warnings.


## Live preview verification — September 5, 2026

- 07:12 Pacific: read-only preflight passed for National Sports Apparel LLC, realm 9341456492604246; approved account references resolved.
- Del Lago Academy linked to existing customer #2380, Net 30, without a QBO write; customer counter 1/2540 survived reload.
- A duplicate legacy/receipt log entry was found in the live check and corrected with regression coverage.
- **Unexpected SKU result:** the 0000 test created item #263 rather than relinking historical #183. API read-back verified #263 as NonInventory, 40000/51300. This does not satisfy the required link-only canary. Further migration writes stopped pending an explicit read of #183, including inactive items.
- Product recovery now blocks when no active match is returned. A read-only QBO item-ID audit is available to investigate historical IDs without changing them.
- Gate 1 remains open. No customer/product/SO/PO bulk batches have run; no bill recreation or cleanup was performed.

- Read-only historical lookup returned #183 as `0000 (deleted)`, SKU `0000`, `Active:false`, `Type:Inventory`, expense account #149 (Cost of Goods Sold). The handoff's description of #183 as a reusable NonInventory item does not match current QBO state. Do not reactivate or convert it.
- The attempted #263 retry encountered a browser timeout before any newer receipt was saved. It is not counted as verified. The recovery button now performs link-only work without a redundant native confirmation dialog; a missing match still blocks.

- Fresh-login verification: after the operator reported signing out/in, the preview showed customer 1/2540 and product 1/10575. The guarded SKU retry then reused #263 with no QBO change; the independent database receipt at 2026-09-05T15:08:19.145Z records `result:linked`, API read-back, and 40000/51300 references. Operator acceptance of replacing the handoff's expected #183 with #263 remains pending.

- Steve Peterson explicitly approved #263 in place of #183 and instructed continuation. PR #2180 merged as fbadbf11816e72abd3f842e8dc5376c42982ef96. The public production build metadata confirms that exact commit, built at 2026-09-05T15:38:14.347Z. Production counter/preflight verification awaits operator sign-in after the session reset.
