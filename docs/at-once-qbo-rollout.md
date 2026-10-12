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
The new source snapshot and runner routing are part of PR #2501; they have NOT
been deployed by this change. The live database does not yet contain the earlier
24/7 migrations on this branch. Deploy the PR's migrations in order, including
`20261012141544_at_once_qbo_revenue.sql`, before deploying
`qbo-sales-background`. Its preflight explicitly requires snapshot version 1.
Run the endpoint's read-only preflight and inspect the manifest before allowing
the newly deployed runner's next scheduled write. Do not bulk rewrite historical
invoices or turn on Stripe payout writes as part of this routing change.

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
