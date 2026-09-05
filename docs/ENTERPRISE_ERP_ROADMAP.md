# Enterprise ERP reliability: staged work and acceptance criteria

## What is verified now

- PR #2182 is merged. Production build metadata reported commit `e0940ac22fe94155ffc191f38f84ea115eed0328` on September 5, 2026.
- Both original migrations were applied. Full SO saves and estimate saves have a database transaction boundary, stable line identity, revision checks, and receipts for identical requests.
- Live browser verification found a production-only trigger dependency: `enforce_so_estimate_customer` uses an unqualified `estimates` reference, while the typed writer originally cleared search_path. The approved corrective migration restores `public, pg_temp` for the SECURITY INVOKER writer. Neither authenticated nor anon can CREATE in public.
- After that correction, SO-1140 saved through the production UI: its version advanced from 153 to 155 (retry plus manual save), two commit receipts were recorded, two item lines and four decorations remained, and the failed/unsaved indicators cleared. No quantities, prices, or memo text were deliberately edited.
- EST-2434 has four saved lines, all with empty quantities, and one decoration. Clicking Save correctly requested quantities. That is validation evidence, not a successful-save test or proof of historical completeness.

## First increment: safer draft protection

This branch adds a secondary IndexedDB journal for full estimate/SO save attempts. The local transaction finishes before dispatch. Each tab has its own document lane; acknowledgement and failure updates compare exact revisions within a transaction. A tab cannot acknowledge another tab's snapshot. Recovery lists are scoped to the signed-in staff identifier; this is browser organization, not a replacement for server authorization.

The old localStorage outbox remains during rollout, including its synchronous unload capture, but its size-cap eviction is removed. If browser storage fails, older disk backups are retained, the current journal draft stays in memory where possible, and the user is told to keep the tab open or download a recovery copy. Online saves can still succeed. Recovery is explicit: selecting a draft opens the existing review flow and does not automatically overwrite cloud data. An exact recovered revision is cleared only after confirmed save or explicit discard.

This increment does not migrate every legacy outbox into IndexedDB, replace every save path, or guarantee recovery after the user clears site storage, loses the device, closes a private browser session, or exceeds storage before capture. Artwork-only saves retain their existing independent path so they cannot overwrite a failed full-document draft. Drafts are captured at save attempts, not every keystroke. Wider save-path adoption and edit-time capture are later work.

Validation includes unit tests with an IndexedDB implementation, storage-quota failures, separate connections, stale completion races, owner switching, and a native browser harness at `scripts/browser/draft-journal-check.html`. Serve the repo locally, open that harness, run checks, then reload. The harness uses synthetic data and sends no ERP requests.

## Follow-up: preserve the attempted edit through retry

Review found three competing automatic retry paths plus a manual path. They reconstructed requests from React arrays; two cleanup paths treated an absent loaded row as deletion and removed its outbox. The warning bar's Clear action also removed recovery entries while claiming it did not delete data.

The branch now has one backoff scheduler and one shared retry coordinator for foreground/manual/background triggers. It snapshots the attempted payload and original revision in this tab, rechecks session/owner before each send, skips in-flight saves, and rotates bounded batches so later records are not starved. Boot-restored outbox content enters the same registry. Retry never substitutes a freshly loaded screen row. Missing snapshots remain flagged for review; absence from loaded state never erases the outbox. The blanket Clear action is removed, and the banner no longer promises unconditionally that browser storage succeeded. Existing explicit conflict-review discard remains available.

Verification: after merging the latest main branch, all 322 suites / 4,902 tests passed, including four integration tests through the actual persistence wrappers with no cloud connection. Production build passed. The native browser harness passed nine checks, followed by a real reload recovery check. These tests use synthetic documents, not live customer edits. This follow-up changes client retry orchestration; it does not make invoice or inventory writes transactional or provide edit-time capture. Memo-only writes remain the next separate increment.

## Prioritized next increments

| Priority | Work | Evidence / reason | Acceptance criterion |
| --- | --- | --- | --- |
| 1 | Production-faithful staging and release gates | The trigger failure passed the simplified fixture. The existing persistence DB workflow is manual and requires a throwaway database. | Every release runs complete order/estimate save, reorder, artwork, receiving and invoice scenarios against all deployed triggers and policies. Missing required RPCs prevent frontend rollout. |
| 1 | Draft recovery rollout and edit-time capture | Legacy localStorage has no cross-tab transaction, and save-attempt capture leaves a typing interval. | Old drafts survive upgrade, failure/reload/logout tests preserve edits, tabs cannot erase each other's drafts, and recovery is accessible to each staff role. Test classic, new and mobile editors. |
| 1 | Small updates for simple fields | Full document saves currently prepare items/jobs/art even for small edits. | A memo-only change updates the memo with a checked revision and never writes items, inventory, artwork or financial totals. Concurrent unrelated edits are preserved; actual same-field conflicts show both values. |
| 1 | One persistence contract for every writer | Invoice saves and fast receipt/PO writers still have separate entry points. | Map each writer, then require immutable inputs, explicit revision/intent, atomic business operations, stable IDs, retry identity and truthful acknowledgement. Migrate one workflow per PR. |
| 2 | Financial and inventory invariants | Saves must preserve more than row counts. | Tests prove invoice totals reconcile, posted payments cannot be duplicated, received quantities cannot regress accidentally, and adjustments retain their provenance. Business owners approve correction/void rules. |
| 2 | Integration delivery and reconciliation | ERP APIs, webhooks and timeouts can repeat or miss work. | Duplicate webhook/order/payment submissions are harmless; failures enter a durable retry queue; reconciliation detects discrepancies; a failed vendor response never invites duplicate purchasing. |
| 2 | Server authorization and audit review | Browser role filtering cannot be the security boundary. Existing server audit triggers are present; the UI change log is separately mutable state. | A staff-role matrix is enforced in database/functions, tested with unauthorized requests, and critical actions have attributable server audit events. Define retention and access for recovery drafts. |
| 2 | Backup restoration drills | Backup existence alone does not demonstrate recovery. Recovery settings and restore time have not been verified here. | Restore a recent backup into an isolated environment, reconcile orders/invoices/inventory, and measure the time and amount of recoverable data. Agree recovery targets with the owner. |
| 3 | Operational visibility and capacity | Sentry is configured for errors; performance sampling is currently disabled. Save receipts exist but are not a complete operations dashboard. | Track save success, latency, retries, unresolved drafts and integration lag with request IDs. Load-test realistic record sizes and user concurrency. Alert on sustained actionable failures. |

## Implementation order and safeguards

Release the compatibility migration record and draft protection as reviewable work. Verify recovery with synthetic data before rollout. Then implement memo-only writes as the first narrow operation and expand after both editor versions pass. Avoid a simultaneous rewrite of accounting, receiving, authorization and storage.

A system is not certified enterprise-ready by this document or by one passing suite. Each row above needs measured evidence. The owner should set recovery expectations, staff responsibility boundaries, and financial correction policies before those become enforcement rules.

## Relevant documented patterns

- NetSuite checks for concurrent modifications before commit: [optimistic locking](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2877583.html).
- Microsoft Dataverse supports conditional updates using record versions: [conditional operations](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/perform-conditional-operations-using-web-api).
- Business Central supports transactional batches when configured without intermediate commits: [transactional requests](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/webservices/use-odata-batch).
- Intuit supplies selected-field update examples: [QuickBooks sparse update](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/_Samples/CustomerSparseUpdate.php).
- IndexedDB provides browser transactions and documents quota, shutdown and version-change considerations: [MDN guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).

These sources describe mechanisms, not a guarantee that any vendor has zero save failures. The roadmap applies those mechanisms to observed portal gaps.

## Validation for this increment

Final run: 319 suites / 4,879 tests passed, production build succeeded, and the SQL transaction scenarios passed with the production-style trigger dependency included. Native browser checks passed for immutable capture, independent connections, stale acknowledgement/failure rejection, owner filtering, and persistence across an actual reload. The security advisor reported no new findings after the approved compatibility correction. The new draft-protection UI is reviewed through component tests and a build; it has not yet been deployed or exercised against live customer edits.
