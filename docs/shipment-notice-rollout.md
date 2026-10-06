# Shipment notice coverage rollout

The shipment sweep now examines completed SOs and pages beyond 500 records. Warehouse can find an SO by its number or a job ID, including fully shipped closed SOs, and send saved customer shipment records to the assigned rep. Both order editor versions expose the same action. Manual customer shipments and Clear Shipment offer a checked-by-default rep notice option after a successful save. Transfers are excluded. Rep-only notices do not mark customer notices sent.

## Deployment order

1. Apply `supabase/migrations/20261006052100_so_rep_shipment_outbox.sql` before deploying the functions. It creates an empty, service-role-only queue; it does not send email or rewrite SOs.
2. Review `SO_SHIPMENT_AUTONOTIFY` and its existing maximum age before enabling the revised sweep. Previously excluded completed orders inside that window can become eligible for customer notices. The Oct 1–6 rep catch-up was handled separately; it does not authorize an older customer backfill. Use a dry run to review the eligible set before an armed rollout.
3. Deploy the PR, including the five-minute `so-rep-shipment-sweep` schedule.
4. In a test SO assigned to an internal rep, verify both classic and new Tracking tabs and Warehouse → Ship / Override → SO or job search. Confirm the recipient preview, a tracked shipment, a pickup without tracking, and an already closed SO. Verify one message arrives and a repeated click does not send a duplicate.
5. Check queue states below. An email accepted by Brevo is recorded as `sent`; inbox delivery still depends on the provider and recipient mailbox. The browser shows queued or error status. After eight failed attempts, a row becomes `dead` and requires operational attention.

```sql
select status, count(*) from public.so_rep_shipment_outbox group by status;
select id, so_id, status, attempts, available_at, last_error
from public.so_rep_shipment_outbox
where status <> 'sent'
order by available_at;
```

## Reliability limits

Durability begins when the queue insert succeeds. A database failure before insertion is shown/logged, not automatically reconstructed. The customer send and its rep-copy enqueue are not one transaction; a process crash between them remains a recovery case. Brevo's idempotency window is finite, so a prolonged ambiguous provider/database failure is not an exactly-once guarantee. The scheduled customer sweep still depends on a valid go-live setting, tracking, contact data, grace period and age guard; the explicit rep-only action bypasses the tracking/contact requirements but requires an assigned rep with a valid email and saved customer shipment records.

## Validation

Targeted Jest suites cover pagination at 501 SOs, completed orders, customer sends, rep override/fallback, cleared shipments, transfer exclusion, staff authentication, recipient spoofing prevention, duplicate requests, retry after provider failure, provider duplicate acknowledgements, recipient confirmation and visible UI errors. The migration was executed in an isolated Postgres runtime, including service-role claims, stale-claim recovery, sent-row exclusion and denial to anon/authenticated roles. No production migration or live portal test was performed as part of preparing this PR.
