# Portal slowness investigation — September 10, 2026

Inspected main commit `caf8f317`, plus read-only observations of the existing Backup & Data tab. This investigation does not establish that UPS caused all slowness or that today's save problems are resolved. No production records were modified and no user tabs were reloaded or closed.

## Findings and confidence

1. **Confirmed inefficient local processing.** Realtime merges, poll merges, and `_diffSave` repeatedly use `Array.find` for every incoming row. Even an unchanged refresh runs the diff comparison. This creates quadratic ID matching in the browser, before counting JSON comparisons and rendering. The patch indexes each local snapshot once, preserves first-match/strict-ID semantics, and builds fresh indexes inside React state updaters so they see the latest local edits. It preserves version guards, protected records, art merging, snapshot timing, comparisons, save batching, and rollback rules.
2. **Confirmed poll re-entry path.** Navigation calls `_runPollRef`, which can invoke `runPoll` during an earlier run. There was no in-flight guard. The patch prevents this overlap and keeps the existing recovery schedule. Tests exercise the actual callback with deferred and rejected loads.
3. **Remaining cross-source overlap concern.** Realtime has its own coalescer but polling and the loader do not share that lock. The loader also shares `_lastLoadTimedOut` and `_unconfirmedLoadTables` across loads. Overlap could interfere with these markers. The source permits this; a production save failure caused by it has not been demonstrated. A complete solution needs per-load failure metadata and tests of timeout interleavings, rather than simply suppressing refreshes and risking lost updates.
4. **Remaining large refresh and hydration workload.** `_dbLoad` loads entity groups and child tables, then assembles them using nested filters. Table batches allow five concurrent queries; each paged table can also fetch five pages in a wave. Thus five is not a global network-request cap. Startup, focus refresh, realtime, and periodic polls can all contribute. Server latency, query plans, and an actual browser profile remain unmeasured.
5. **Backup-page rendering cost.** `rBackup` stringifies the operational dataset every render to calculate its size and rebuilds job counts. The inspected live page displayed 58.18 MB. This is a page-specific source of synchronous work, not evidence that every page serializes that amount. The "Auto-Backup to Browser — Enabled" UI is also stale: the actual automatic localStorage backup was removed in code. Do not disable or clear recovery data as a performance workaround.
6. **Live diagnostic blind spot.** The open page displayed "All checks passing" together with "permission denied for function get_health_report". Lost Art & Jobs displayed a missing-function/schema-cache error for `recent_lost_art_and_jobs`. Those zero counts are not a successful health check. This needs a separate diagnostic/UI and backend review; this performance patch does not change RPC permissions.

## Live observations and limits

The browser had five portal tabs open. The inspected tab's console included a catalog load of 10,593 products, repeated UPS 502 warnings, and a realtime `CHANNEL_ERROR` for estimates. Console entries may predate inspection; capture timestamps do not establish event timing or persistence. Hidden-tab polling already has a guard, so five tabs does not prove five simultaneous polling loops.

The page displayed a blocked save in its change log where the client had zero items but the database had ten. This is evidence of a protective refusal, not evidence that records were deleted. It may predate today's fixes. No blocked save was retried during the investigation.

The browser inspection interface did not expose the Performance API, so no live main-thread or request-duration profile was obtained. Synthetic Node measurements below isolate one operation; they do not estimate end-to-end portal speed or confirm the cause of the reported severe slowdown.

## Reproducible benchmark

Run `node scripts/benchmark-refresh-lookups.cjs` from the repo root. It executes the actual old and new `_diffSave` callbacks against unchanged synthetic rows (no network writes), compares with baseline `caf8f317`, and reports the median of three runs. Results from local Node v24.13.1:

| Rows | Before | After |
| --- | ---: | ---: |
| 5,000 | 84.16 ms | 0.54 ms |
| 10,000 | 340.42 ms | 1.21 ms |
| 20,000 | 479.66 ms | 2.76 ms |

`refresh-benchmark.json` contains the measurements. These use a simple comparison value and exclude real-data serialization, browser rendering, and network costs. The operation-count regression test is the stable performance guard; CI does not rely on millisecond thresholds.

## Validation and remaining work

Targeted tests execute actual App callbacks for refresh merging, diff-save, and polling. Coverage includes unchanged 20,000-row refreshes causing no writes, failed/pending saves, newer local versions, latest edits at state-application time, server deletions, no-op render identity, failed-save rollback, newer edits during failed saves, and poll recovery. Existing editor save races, line identities, retry recovery, quantity drafts, artwork merges, and receipt-save tests are also run. Production build passes with existing third-party source-map warnings.

Before production rollout, review the isolated patch and verify the deployed build contains today's save fixes. Then measure a representative edit/save and a refresh using the same dataset before and after. Keep stale/partial-load protections enabled. Investigate cross-source load overlap, failed health RPCs, and data hydration next; none is ruled out by this patch.
