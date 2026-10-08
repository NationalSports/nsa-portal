# Unapply a manual invoice payment

Accounting users with Receive Payments access can open an invoice, find its Payment History, select **Unapply**, enter a reason, and confirm. The server removes only that application, reopens the invoice balance, and preserves the original payment as money on account. It does not refund the customer. Cards, account credits, store funds, and NetSuite-imported payments are outside this command.

For an existing receipt, its original amount and remaining applications stay intact. A legacy per-invoice payment becomes a receipt using its original amount/date/reference. Every reversal retains the original payment, actor, reason, time, and known QBO payment IDs in `invoice_payment_unapplications`.

## QuickBooks limitation

This operation does **not** change QuickBooks. If the invoice/payment/receipt has a QBO link, the receipt is held for reconciliation and excluded from both automatic payment-writing paths. Staff cannot spend, delete, or clear the hold. An absent payment-link record alone is not proof that no QBO payment exists, so a QBO invoice link also requires review.

Before an operator releases a hold, accounting must reconcile the check, original QBO payment(s), replacement entries, and customer allocation. If correct entries already exist, the held amount is not additional credit to spend. There is intentionally no unchecked “release hold” button. This release requires a separate verified reconciliation; changing the boolean alone may create another QBO payment and is not a supported repair.

## Implementation / deployment

Apply `20261008152808_unapply_invoice_payments.sql` before deploying the frontend/function. The RPC is service-role-only; the endpoint derives the actor from a verified JWT and the database rechecks the accounting identity allowlist. RLS protects the immutable audit. The operation serializes with invoice/payment writes and the existing hourly QBO claim; an active run makes it retryable without changing any sync settings.

`payment_revision` fences old invoice snapshots. The application reference is permanently tombstoned, including for service writers, preventing stale tabs/imports from restoring the payment. The QBO snapshot wrapper omits held receipts and their remaining payment rows. Preserve that wrapper in future snapshot migrations.

## Verification

Focused Jest suites cover API authorization, required confirmation/reason, UI success/failure, invoice history, receipt allocation and deletion safeguards. `scripts/test-unapply-payment-sql.cjs` executes the migration in isolated PostgreSQL (PGlite), testing partial/full unapply, receipt preservation, retry idempotency, stale saves, reinsert attempts, held receipts, sync exclusion, authorization, and rollback on conflicts. Set `PGLITE_MODULE` to an installed `@electric-sql/pglite` module path to run it. No production financial records are changed by these tests.
