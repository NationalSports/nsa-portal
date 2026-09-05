# Sales-order memo commands

## Scope and behavior

For an existing versioned sales order, clicking its Memo field opens a separate editor in both classic and redesigned interfaces. New orders and estimates keep their existing form. Other unsaved order edits must be saved or reviewed before opening this editor.

A memo edit calls `save_sales_order_memo` with only the order ID, expected memo, new memo and stable request UUID. It bypasses `savSO`, price locking, promotion/shipping updates, the full-order outbox and child preparation. Only the confirmed memo is adopted into screen state and the diff snapshot; the RPC's newer aggregate version is **not** applied to old item data. Later full saves retain their original revision checks.

The RPC takes the same advisory order lock as full saves and a parent row lock. It compares the current memo, so another person's PO-number edit can coexist, while a competing memo edit returns both values for explicit review. A deliberate replacement uses a new UUID and the reviewed cloud memo as its expected value. If that value changes again, the command conflicts again.

Receipts share the existing staff-only, RLS-protected document receipt table under `memo:<uuid>` keys. Retries return the original acknowledgement without reapplying over a later edit. The response also returns the current memo, avoiding an old receipt masquerading as current cloud content. Reusing an ID with different content is rejected. A receipt-write failure rolls the memo update back.

## Recovery and authorization

Typed memo changes receive a separate IndexedDB recovery copy (`sales_order_memos`). A memo success cannot acknowledge a full-order draft. Network failures retain the command and request UUID. Recovery, explicit discard, same-field conflict review and downloads are available in the dialog. If browser storage fails, closing unsaved work is disabled until the user saves online or explicitly discards; download remains available. Recovery copies still require the same browser/device and are not an off-device backup.

The service copies its input before queueing. It checks the signed-in owner before dispatch and between network retries. The RPC remains SECURITY INVOKER, requires staff authorization, and respects existing row visibility and UPDATE policies. It is not executable by anon or PUBLIC. Client owner IDs organize drafts; they are not server authorization.

The existing `enforce_so_estimate_customer` trigger is restricted to INSERT and UPDATE OF estimate_id/customer_id. Memo-only edits must not repair unrelated legacy relationships. Existing full writes still invoke the relationship guard. An additional before/after assertion rolls back the memo command if another trigger changes unrelated parent fields.

## Rollout and rollback

1. Review and apply `20260905174346_sales_order_memo_command.sql` before enabling the frontend. It is additive except for narrowing the existing relationship trigger's UPDATE columns.
2. Verify capability returns 1 for an authorized staff session; verify anon/nonstaff cannot write. Run schema/security advisors and compare with the existing baseline.
3. Deploy the frontend. The separate editor is exposed only when `sales_order_memo_capabilities()` reports version 1. A missing migration does not cause the frontend to try the new write RPC.
4. Test a designated order in both interfaces. Verify memo acknowledgement, unchanged children and totals, audit/receipt records, and recovery. Production memo edits were not performed during development of this PR.

For an application rollback, redeploy the previous frontend while retaining the additive RPC and receipts. Do not delete recovery entries or receipts to roll back. If disabling the capability, keep the write RPC available for already-open/newer tabs and pending recovery commands. The previous frontend does not offer memo-command recovery controls; return to this frontend to review those drafts.

## Validation

- Unit tests drive the real dialog and persistence adapter: stage before dispatch, stable retry identity, explicit conflict choice, owner changes during retry, quota failure, exact recovery acknowledgement, no full-order outbox/child writes and no adoption of the memo version into the full-order version registry.
- Scratch SQL tests cover memo-only child preservation, concurrent unrelated fields, competing memos, replay after a later edit, request-ID reuse, future-trigger rollback, receipt failure rollback, relationship trigger behavior, anonymous/nonstaff access, and staff RLS/UPDATE-policy enforcement.
- Native PostgreSQL tests use separate connections for actual competing memo transactions and an unrelated header write. PGlite runs the same transaction fixture in CI.
- Native browser checks use `node scripts/browser/build-memo-check.cjs /private/tmp/nsa-memo-browser`, served on localhost. They exercise the actual dialog with synthetic cloud responses and native IndexedDB: conflicting text review, explicit replacement, failed network, recovery in a fresh tab, and recovery after closing the dialog and reloading. No ERP requests are made by the harness.

See [Supabase database functions](https://supabase.com/docs/guides/database/functions) for invoker permissions and schema-resolution behavior. The current Supabase changelog was checked; the listed hosted PostgreSQL changes do not alter this RPC contract.
