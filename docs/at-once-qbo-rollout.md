# At-Once / 24/7 accounting

## Routing

Native Club and All School paid checkouts retain their real portal customer,
including promo-dollar attribution. New QBO invoices use the shared customer
**24/7 Store Customers** and sales item **At-Once / 24/7 Revenue**, mapped to
income account **40010**. Ordinary stores and OMG ingest retain existing routing.
The order number stays in the invoice note; invoice numbering remains unchanged.

The existing hourly sales runner creates the invoice and applies the immutable
checkout payment, with existing leases, duplicate checks and read-back. No staff
invoice action is required. A batch limit or temporary failure can defer work to
subsequent runs. Tax remains in state tax liability items. Stripe fees remain
part of payout reconciliation, not a deduction from gross sales. Payout matching
uses the invoice's verified QBO customer without changing the portal customer.

Club conversion now includes checkout shipping, tax and processing fees and
records the Stripe payment-intent reference. Conversion and payment creation are
one database transaction. Existing invoices are not rewritten by the migration.
Historical mismatches, refunds and missing payment evidence go to QBO review.

## Setup and rollout status, 2026-10-12

Created and independently read back in National Sports Apparel LLC:

| Object | QBO ID | Mapping |
| --- | --- | --- |
| Income account | 157 | 40010 — At-Once / 24/7 Revenue |
| Sales item | 1328 | IncomeAccountRef 157 |
| Shared customer | 2800 | Due on receipt, term 6 |

The live existing runner settings were `background_enabled=true`,
`writes_enabled=true`, `kill_switch=false`, `phase=hourly`.
The accounting backend was deployed on 2026-10-12 as Edge Function version 21
(JWT verification enabled). Applied migrations, matched by name to repo files:

| Live migration version | Name |
| --- | --- |
| 20261012153046 | all_school_checkout_accounting |
| 20261012153054 | stripe_payout_deposit_automation |
| 20261012153058 | at_once_qbo_revenue |

Only the accounting dependencies were deployed in this step. The other PR #2501
purchasing, picking, numbering and fulfillment migrations remain pending.
Automatic Stripe bank-deposit posting remains disabled.

Read-only preflight run: `3c2aa0a7-c1aa-4f9c-b2d1-81b829673661`.
Completed successfully at the API level (HTTP 200), with overall `needs_review`
for five ordinary-sales exceptions: two existing invoice total differences
(INV-63510, INV-63520), the explicit block on INV-63831, and payment-total
mismatches on INV-63101 and INV-63372. None were modified by this read-only run.
It examined 1,341 invoices and 777 payment rows; created zero customers, invoices,
or payments. Configuration and postflight were verified. The original hourly
write setting was restored after verification. QBO customer 2800 still has zero
invoices and payments.

Live snapshot version 1 verified. Both new service-only SQL entrypoints deny
anonymous/authenticated execution. The payout ledger intentionally has RLS with
no browser policies (service-role only).

No native Club or All School checkout orders exist in production at deployment
time, so real-order invoice/payment verification cannot be performed yet.
No ordinary store order was substituted and no fake transaction was posted.

## Verification

- 138 focused routing, QBO invoice/payment and payout tests.
- Real in-memory Club/All School conversion through picking, DTF, production and
  fulfillment, plus 18 dashboard reconciliation checks.
- Club fixture includes $50 garments, $2 processing, $5 shipping and $4 tax:
  $61 invoice/payment, $52 operational revenue excluding shipping/tax.
- Source snapshot checks native Club/All School inclusion and ordinary/OMG exclusion.
- Shared QBO customer payout test posts once and preserves portal customer.
- Fixtures run offline and are rolled back; scratch files are wiped. No fake
  transaction or supplier order was sent to live services.
