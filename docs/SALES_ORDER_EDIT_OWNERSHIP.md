# Sales-order editing ownership and draft isolation

## Release order

1. Ship the session-isolated outbox first. Leave `REACT_APP_SO_EDIT_LEASES` unset.
   Existing order screens and save behavior remain available. New emergency
   backups use independent owner/session/document keys; IndexedDB remains the
   transactional draft recovery authority.
2. Apply `20261008194803_sales_order_edit_leases_pilot.sql` before enabling the editor.
   It has no effect on ordinary saves until an editor acquires a claim. It adds
   a private coordination table and patches the installed atomic save function,
   retaining existing version, child-token, rollback and idempotency checks.
   This pilot version only permits claims on `SO-TEST-SAVE-20261008`; a later
   migration is required before enabling ownership for other orders.
3. Deploy previews build with `REACT_APP_SO_EDIT_LEASES=1` and
   `REACT_APP_SO_EDIT_PILOT_ORDER_ID=SO-TEST-SAVE-20261008`. Verify the
   rep, CSR, art, warehouse and accounting workflows below before production
   enablement. The flag is build-time; change it and rebuild to enable/disable.
   A preview pointed at production can acquire a real claim on the synthetic order.
4. Enable on production only after those checks. This PR does not apply its
   migration or enable the flag on production.

## Behavior

Opening a sales order shows a read-only overview (items, sizes, decorations,
PO status, jobs and artwork). **Edit order** acquires a 120-second server lease
and loads a complete current document before mounting either existing editor.
Heartbeat renewal runs every 30 seconds. Viewing does not acquire a lease.
The original editor's detailed tabs and actions remain available after entering
edit mode. The initial overview is not a replacement for those detailed views.

Another tab—even with the same login—stays view-only. The same authenticated
user can take over their own tab; admin/super_admin/gm can take over another
user after confirmation. The takeover checks the generation displayed to the
user. The old generation cannot save, renew or release the new owner's lease.
All roles come from active team_members records, never user-editable JWT data.

Loss of ownership, expiry or failed renewal pauses the mounted editor, blocks
its full-save callbacks, and attempts to preserve its actual buffered contents
through the existing IndexedDB recovery handoff. Storage failure leaves the
editor mounted and displays an error; it does not claim the draft is durable.
**Keep draft & close** waits for that preservation before leaving. There is no
silent reacquisition or automatic application of old drafts. Reviewed recovery
obtains a temporary claim but still pins the cloud token the user reviewed.

## Scope and limits

The database protects full order saves, item replacements and firm-date writes
through save_sales_order_atomic. Leased payloads include session + generation;
these are retained on failed attempts so old queued requests remain fenced.
The save guard runs before retry receipts and again under the existing order
transaction lock. No transaction remains open while a user is editing.

Targeted artwork, memo, receipt and server integration paths retain their
existing concurrency checks. This is not a universal row/table lock. Direct
REST writes and privileged service-role writes are not made lease-aware by
this migration. A leased editor can still encounter a genuine conflict when
one of those operations changes its business data. It must review that change.

Some operational screens still follow a narrow command with a full-order save.
That full save will be refused if another editor holds the lease. Preview checks
must confirm the user sees truthful results and required follow-up changes are
not lost. Do not enable globally until these role-specific paths are accepted
or converted to narrow commands. Estimates are not lease-gated in this release.

## Recovery compatibility

New localStorage keys are independent per user, session and document. New code
never rewrites the legacy shared nsa_outbox blob or another session's key.
Exact-value acknowledgement receipts hide reviewed legacy/foreign copies; a
newer value always becomes visible again. Already-saved copies can be retired
through the existing comparison; other sessions' drafts require explicit review.
The legacy blob and recovery journal are not purged. Older deployed bundles
cannot coordinate through the new keys, so the journal and server guards remain
necessary during rollout. Reload staff tabs after saving/reviewing their work.

## Verification

Automated tests exercise two outbox sessions, revision-aware acknowledgement,
account isolation, legacy coexistence, strict-mode editor mounting, authoritative
load failure, ownership loss, sleep expiry, delayed acquisition, and reconnect.
The scratch PostgreSQL harness executes the real migration and atomic save RPC:
claim/takeover/expiry, anonymous and nonstaff denial, table privacy, retry receipts,
fenced delayed saves, and targeted artwork writes. It never connects to production.

Run `PGLITE_MODULE=<path-to-pglite> node scripts/pgtest/edit_lease_scenarios.cjs`
and the existing `scripts/pgtest/order_save_scenarios.cjs` regression harness.

Before enabling, use two browsers and both editor designs. Save changed sizes,
leave a dirty editor asleep, take over, then resume the old tab. Confirm the
saved order and both recoverable drafts. Exercise receiving/labels, PO creation,
art approval, memo changes, invoice creation and QBO metadata updates during an
active edit. Confirm that no unrelated whole-order retry loop develops.

## Rollback

Disable the flag and redeploy. Existing claims expire within 120 seconds after
their last renewal (existing enabled tabs must close/reload or their heartbeats
continue). Keep the migration and backups; deleting them would remove fencing
and recovery protection. A retained leased draft still needs reviewed recovery.
