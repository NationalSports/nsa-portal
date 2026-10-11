# Store closeout

Team/webstore batching and OMG Sales Order creation no longer create or settle an invoice. The SO exposes **Close Store** in both editors. Closing requires a saved, current order, completed/shipped production jobs, and staff confirmation that every item has shipped to families and all garment, decoration, freight and platform costs are recorded. Outside-art jobs do not count as floor production.

Out-of-house stores receive a durable rep todo due 35 calendar days after `sales_orders.created_at`. The assigned rep falls back to the customer's primary rep, then the SO creator. Mixed outside/in-house orders also get the check. A check is not automatic closeout or commission approval. Closing completes the todo; completing the todo alone does not close the store.

The authenticated `close-store` function resolves the staff actor and calls a service-only database transaction. That transaction reuses a single existing invoice or creates the deferred invoice, checks the payment ledger and applies only eligible, previously collected store funds. It does not charge a card or collect money again. Webstore checkout tax/shipping/processing calculations remain in the existing batch finalizer; card fees remain costs. Team-tab balances remain receivable. OMG uses reported gross collections, capped at the invoice balance, without subtracting fees a second time.

Repeated closeout requests return the existing result. Duplicate invoices/SOs, reused source payment references, unapplied or held customer receipts, removed payment history, partial applications requiring reconciliation, and mismatched ledger or store totals stop closeout for accounting review. Existing invoices already represent revenue: closeout does not create another invoice for them. This is not a cleanup of historical QuickBooks entries or bank deposits; those require accounting reconciliation before any ambiguous funds are reapplied.

Paid store invoices earn new commissions only after both closeout and cost confirmation. New commission dates are the later of payment and closeout; waiting for closeout does not impose a late-payment penalty. Ported OMG stores are excluded from the separate monthly-report commission path. Historical frozen commission amounts/dates are preserved; accounting must review and deliberately re-freeze any legacy snapshot that captured incomplete costs. No historical commission payouts are rewritten by this migration.

## Rollout and verification

Apply `20261011065626_store_closeout.sql` before deploying the endpoint/UI. It backfills reminders, not financial closeouts or payments. It protects against old browser tabs creating store invoices/payments through the former paths. Existing integrity monitoring is updated to require invoices only for closed stores. This PR does not deploy the migration or change production accounting.

Targeted unit tests:

```sh
CI=true npm test -- --env=node --runInBand src/__tests__/storeCloseout.test.js src/__tests__/closeStoreHandler.test.js src/__tests__/commissionSnapshots.test.js src/__tests__/webstoreBatchFinalization.characterization.test.js src/__tests__/omgCreationGuard.test.js
```

Isolated PostgreSQL regression test (install `@electric-sql/pglite` in a temporary directory, then point at its module):

```sh
PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/test-store-closeout-sql.cjs
```

The SQL test covers deferred accounting, SO-based due date, in-house/outside task changes, job/cost/version guards, retry safety, existing paid invoices, duplicate invoices, unapplied receipts, team-tab balances, a reused webstore payment reference with full rollback, protected audit fields, service-only access and the commission gate. Run a staging smoke test with normal SO save/version triggers and QBO sync before production rollout.
