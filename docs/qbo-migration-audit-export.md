# Read-only migration audit export

The May 31, 2026 reconciliation needs full transaction distributions and application links. The Intuit report connector returns the A/P summary but errors on detail, including vendor-filtered requests. The existing Portal screen has no general transaction export.

This change adds **QuickBooks Sync → Audit export** using the existing staff/accounting-authorized `qb-api` endpoint. It changes no backend authorization and adds no posting action. It does not invoke the sync engine, persist links, write a sync log, or change automation controls. The existing server-side credential refresh may still occur normally.

After deployment, choose a capture-through date (default today) and click **Read audit data — no changes**. Download the complete JSON. Do not close or leave the tab during capture. The reader includes all records through that date, including records before 2026, and includes inactive account/vendor/customer/item mappings. Full lines and `LinkedTxn` fields are preserved. Later transactions are needed to trace post-May applications; they must not be included in January–May activity totals.

The collector verifies the live realm is `9341456492604246` and company name is National Sports Apparel LLC before querying, and rechecks connection identity at completion. It uses a fixed entity list, sequential pages starting at 500 records and a 100,000-record per-entity safety limit. HTTP 500/502/503/504 failures retry the same offset at 100 and then 20 records; the smaller size remains in use for that entity. Persistent errors, authorization failures, QBO faults, wrong identity, malformed pages and repeated IDs fail the capture. Errors identify the entity and offset. An incomplete capture has no download button. Each HTTP request has a 45-second timeout. A retry starts a fresh capture.

## Accounting limits

This is a current-record capture, not historical aging or an atomic database snapshot. It does not recover deleted records, prior versions, or historical changes to payment applications. The supplied May aging and NetSuite GL remain necessary controls. Raw `Balance` fields describe the present record and must not be labeled May balances. Referenced items absent from the capture must remain unresolved rather than inferred.

Deployment does not authorize any correction. Journal reversals, new credits, bill changes, vendor merges and payment applications require a separately supported and approved schedule. January–February P&L is preserved, and June–September cutover work remains separate.

## Validation

Run `CI=true npm test -- --runInBand --runTestsByPath src/__tests__/QBAuditExportCard.test.js src/__tests__/qbAuditExport.test.js`.

Ten tests cover explicit user initiation, read-only actions, correct company routing, full line/link preservation, inactive mappings, pagination, bounded smaller-page recovery without omissions or duplicates, failure handling, duplicate pages, invalid dates, cancellation and a changed connection. Live queries still need verification after deployment; unit fixtures are not evidence of successful production retrieval.
