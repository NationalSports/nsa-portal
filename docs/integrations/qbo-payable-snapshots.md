# Checkpointed payable review

Apply the payable-snapshots migration before deploying the function. Only the
service role can read/write the two diagnostic tables; no business records change.
The existing staff authorization, realm flag and single-running-review lock apply.

POST `/.netlify/functions/qbo-payable-review-background` with `{}` to acquire a
new snapshot. It freezes the Portal input, then reads seven QBO entities sequentially
in 500-row pages. Each successful page is immutable; counts before/after each entity,
unique IDs and canonical content hashes must validate. Transient failures have four
attempts with bounded exponential backoff and jitter. A nine-minute acquisition
budget leaves time to persist a failure before the background invocation expires.

On failure, read `snapshot_id` from the existing review status endpoint. POST
`{"snapshotId":"<id>"}` to resume; completed pages and entities are reused. A completed
snapshot ID replays with zero QBO reads. Count drift/corruption requires a new snapshot,
not a forced completion. A hard-killed invocation retains the existing running lock:
inspect execution state before explicitly abandoning it; never run overlapping reviews.

Two reviews execute from the identical validated snapshot before a report publishes.
`report.replay` contains the comparison hash and run count. Failure cannot publish a
partial report. `sourceHash` now covers all frozen Portal and QBO inputs. Pages persist
fetch timestamps; the manifest contains per-entity counts, pages, hashes and completion.

This is an acquisition interval, not an atomic cross-system accounting snapshot.
`apBasis` explicitly identifies frozen A/P: before/after describe the same captured
balances and do not measure live concurrent activity. Fresh live duplicate, paid-status,
mapping and balance checks remain mandatory immediately before any separately approved
canary. This change adds no transaction writer and enables no recurring automation.

Validation: `node --test tests/qbo-payable-snapshot.test.cjs`, plus the existing
`src/__tests__/qboPayableServerReview.test.js` suite.
