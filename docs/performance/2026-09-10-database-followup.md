# Portal slowness and save failures: database follow-up

Read-only production inspection on 2026-09-10 PDT / 2026-09-11 UTC. Source baseline: main 712883f682ff65611ca5c894ae677c95891e4872. No production records or permissions changed.

## Confirmed findings

- In the inspected preceding 24-hour client-events window, 60 `save_failed` events were recorded. 58 were `ESTIMATE_LINE_ID_AMBIGUOUS: reload this estimate`, across seven estimates. Two were invoice foreign-key failures (`invoices_so_id_fkey`). Separately, seven `auth_save_failed` events were recorded.
- Five ambiguity events across EST-2487 and EST-2516 occurred after the line-identity fix deployment at 2026-09-10 23:09:25 UTC. Both estimates currently have two stored rows with two distinct non-null `line_id` values, but only one distinct (sku, color, product_id) combination. A legacy draft missing its stable IDs could therefore be ambiguous. This is a possible explanation, not proof of the originating browser state.
- No save/auth-failure events were recorded after the final deployment at 2026-09-11 00:50:38 UTC at inspection time. This does not establish recovery: traffic was quiet, events are throttled per entity (10 minutes), and event details do not identify the browser build. Event counts are not counts of every failed save attempt.
- `get_health_report()` exists, but the authenticated role cannot execute it. `recent_lost_art_and_jobs(timestamptz)` is missing. Both UI cards incorrectly derive zero issues from missing data. The accompanying UI change hides result counts and healthy states until a successful response, and labels failed checks unavailable. It does not restore either backend diagnostic.
- Initial-only app-state values total 14,763,437 text bytes. `so_history` is 12,225,270 bytes and `est_history` 2,173,791 bytes: about 14.4 MB combined. Product image fallback values add 3,351,472 bytes and QBO receipt values 4,226,241 bytes. These are database value-text sizes, not compressed network transfer measurements. Current initial full-state code can load the entire app_state table; essential initial loading excludes image/receipt prefixes but includes the histories. Routine loads exclude the six initial-only keys.

## Database performance evidence and limits

At 01:13 UTC: 42 connections of a configured 160 maximum, one other active connection, zero lock waiters, zero idle transactions, and zero cumulative deadlocks. This snapshot does not rule out earlier spikes.

Statement statistics cover 2026-09-01 17:03:06 UTC onward, so they combine older and newer portal builds. Representative historical query variants:

| Request | Calls | Mean database execution | Maximum |
| --- | ---: | ---: | ---: |
| Sales-order paged reads | 321,686 | 353 ms | 7,997 ms |
| Decoration paged reads | 325,385 | 226 ms | 3,937 ms |
| Item paged reads (one variant) | 126,981 | 441 ms | 2,923 ms |
| Message-read reads | 117,142 | 466 ms | 7,084 ms |
| App-state filtered reads (one variant) | 29,326 | 1,155 ms | 7,985 ms |
| Sales-order atomic-save RPC | 3,535 | 167 ms | 5,819 ms |
| Eight-argument estimate-save RPC | 1,451 | 80 ms | 3,124 ms |

Database execution is not CPU time or complete user-visible latency. Saves also prepare drafts, make prerequisite reads, wait in per-document queues, and confirm results. Successful statement timing alone does not capture every failed attempt.

A fresh sample from 01:14:50.841 to 01:15:32.314 UTC showed no additional calls for the tracked read/save queries. Samples were aggregated across roles by query ID before subtraction. No live throughput conclusion is possible from that quiet interval.

## Next focused investigations

1. Reproduce a save from a current-build browser with a safely preserved draft, recording stable line IDs and build version. Do not guess which identical garment line is which, bypass atomic-save guards, or reload a tab that may contain unsaved work.
2. Measure startup with a browser performance trace. Attribute download, parsing, hydration, and rendering costs, including the large history blobs. Consider loading history on demand only after reviewing history editing and compare-and-swap persistence requirements.
3. Sample statement deltas and lock activity during an actual slow period; distinguish requests from multiple open portal tabs. Historical totals alone are insufficient to justify speculative indexes or resource upgrades.
4. Restore backend health diagnostics only after reviewing staff authorization and security-definer behavior. Do not solve the permission error with an unrestricted grant.

The existing UPS timeout and refresh lookup fixes address demonstrated issues. They do not establish that UPS caused the save failures, nor that all remaining slowness is resolved.

## Follow-up repair (2026-09-11 02:10 UTC)

Production diagnostics now have staff-authorized invoker facades over a private implementation schema. Restored the missing dismissal table with RLS and user attribution checks. Both functions successfully returned under service-role and active-staff test contexts. Non-staff callers were rejected with 42501; anon execute grants are absent. The security advisor reported no findings for the changed diagnostic functions/schema/table.

Restoring the report exposed a slow query shape: repeated audit scans and text casts on numeric item IDs. The final implementation materializes deletion evidence once and uses a validated numeric join. An EXPLAIN ANALYZE of the full report query completed in 3,244 ms after cache warming; this is not a cold-cache or end-to-end guarantee. The seven-day removal function returned 21,190 events, so the UI requests only the newest 100 and labels its counts as displayed events. Deletion attribution labels now describe evidence rather than claiming confirmed data loss or user intent.

Order/estimate reconstruction now indexes child collections once per load instead of repeatedly filtering entire item, decoration, PO, pick, job, and art collections. Regression fixtures compare the complete resulting documents against filter-based lookups, including duplicate-row recovery, child ordering, carry-over art/jobs, and hydration metadata. This reduces browser processing; it does not remove or shrink the approximately 14.4 MB of history text. No saved history or business records were deleted or rewritten.

Browser follow-up: neither EST-2487 nor EST-2516 was in the open tab URLs; EST-2495 was open. Chrome inspection was blocked by a pending reload warning. After that dialog cleared, EST-2495 rendered four lines without a visible save/recovery error. Its logs report one preserved outbox conflict, not identified by the visible UI. The backup tab was at sign-in. Do not interpret this as proof that no preserved drafts exist. The two estimates have no recorded failures since the 00:50:38 deployment, but recovery of a particular old draft remains unverified.

The Chrome reload prompt also exposed a mismatch between automatic reload eligibility and the existing beforeunload protection. Automatic deploy/manifest/idle reload paths now defer while an editor is dirty or there are pending saves, failed saves, or preserved outbox entries. The guard is rechecked immediately before delayed reloads. Explicit user reload remains available with the existing browser warning. Manifest reload scheduling is coalesced and cancelled on unmount. Regression tests cover deadline deferral, changes during jitter, and manual reload.

Recorded failures for EST-2487 came from Jered Hunt's account; EST-2516 failures came from Jeff Bianchini's account. Their browser-local drafts cannot be verified from Steve's browser sessions. Their stored estimate timestamps precede the last recorded failures. Those edits must not be marked recovered without checking the originating drafts.
