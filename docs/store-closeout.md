# Store closeout

Team/webstore batching, automatic Club/All School conversion, and OMG Sales Order creation no longer create or settle an invoice. The SO exposes **Close Store** in both editors. Closing requires a saved, current order, completed/shipped production jobs, and staff confirmation that every item has shipped to families and all garment, decoration, freight and platform costs are recorded. Outside-art jobs do not count as floor production.

Out-of-house stores receive a durable rep todo due 35 calendar days after `sales_orders.created_at`. The assigned rep falls back to the customer's primary rep, then the SO creator. Mixed outside/in-house orders also get the check. A check is not automatic closeout or commission approval. Closing completes the todo; completing the todo alone does not close the store.

The authenticated `close-store` function resolves the staff actor and calls a service-only database transaction. That transaction reuses a single existing invoice or creates the deferred invoice, checks the payment ledger and applies only eligible, previously collected store funds. It does not charge a card or collect money again. Webstore checkout tax/shipping/processing calculations remain in the existing batch finalizer; card fees remain costs. Team-tab balances remain receivable. OMG requires reported gross collections to match the accounting invoice total before applying funds, without subtracting fees a second time. A product-only invoice with additional reported tax/fees is held for reconciliation; closeout does not silently discard the remainder. The locked Accounting Report must match its Dollar Report and the SO collection/fee snapshot. New invoice totals must reconcile to saved item prices and shipping; custom price differences stop for review. At closeout, platform, card, and invoiced fees are frozen separately as commission costs.

Repeated closeout requests return the existing result. Exported invoices that were deleted from the portal audit history, or exported voided/soft-deleted invoices, block closeout until accounting has reconciled the QBO copy and portal history. Duplicate invoices/SOs, reused source payment references, unapplied or held customer receipts, removed payment history, partial applications requiring reconciliation, and mismatched ledger or store totals stop closeout for accounting review. Existing invoices already represent revenue: closeout does not create another invoice for them. This is not a cleanup of historical QuickBooks entries or bank deposits; those require accounting reconciliation before any ambiguous funds are reapplied.

Paid store invoices earn new commissions only after both closeout and cost confirmation. New commission dates are the later of payment and closeout; waiting for closeout does not impose a late-payment penalty. Ported OMG stores are excluded from the separate monthly-report commission path. Historical frozen commission amounts/dates are preserved; accounting must review and deliberately re-freeze any legacy snapshot that captured incomplete costs. No historical commission payouts are rewritten by this migration.

## Rollout and verification

Apply `20261011065626_store_closeout.sql` before deploying the endpoint/UI. It backfills reminders, not financial closeouts or payments. Child-only cost/item/job edits invalidate the SO review version and serialize with closeout. The automatic Club and All School converters defer their former invoice blocks so paid-order conversion still succeeds. It protects against old browser tabs creating store invoices/payments through the former paths. Existing integrity monitoring is updated to require invoices only for closed stores. This PR does not deploy the migration or change production accounting.

Targeted unit tests:

```sh
CI=true npm test -- --env=node --runInBand src/__tests__/storeCloseout.test.js src/__tests__/closeStoreHandler.test.js src/__tests__/commissionSnapshots.test.js src/__tests__/webstoreBatchFinalization.characterization.test.js src/__tests__/omgCreationGuard.test.js
```

Isolated PostgreSQL regression test (install `@electric-sql/pglite` in a temporary directory, then point at its module):

```sh
PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/test-store-closeout-sql.cjs
```

The SQL test covers deferred accounting, SO-based due date, in-house/outside task changes, job/cost/version guards, retry safety, existing paid invoices, duplicate invoices, unapplied receipts, team-tab balances, a reused webstore payment reference with full rollback, protected audit fields, service-only access and the commission gate. The closeout SQL suite also runs in the Order save transactions CI workflow. Regression coverage includes actual converter-definition migration compatibility, parent version triggers, stale child edits, partial receipts, refunds, and a checked-off todo that must not release commission. Run a staging smoke test with normal SO save/version triggers and QBO sync before production rollout.

The 2026-10-11 historical/adversarial review is documented in `store-closeout-audit.md`. The replay harness accepts private exports through environment variables; no customer/order export is committed to Git.

## Multi-connection verification

The `closeout-concurrency` CI job runs the same synthetic regression suite against a disposable PostgreSQL 17.6 service, then tests eight simultaneous closes, shared source references across SOs, a racing child edit, and a lost-response retry through the actual Netlify handler. The handler test substitutes staff authentication and invokes the database RPC directly. It does not exercise hosted Supabase authentication, PostgREST, the browser, or QBO. The adapter refuses non-local hosts and any database name other than `closeout_test`.

Hosted staging remains required. Do not use a deploy-preview URL as proof of database isolation: Netlify preview environment variables may still point to production. Verify a disposable Supabase project/branch first, seed synthetic stores, deploy the migration and function against those credentials, then test browser confirmation, persistence after reload, concurrent requests and a lost-response retry. Leave QBO exports disabled unless a separate QBO sandbox is configured. Verify invoice, payment, ledger account and commission totals in the sandbox before releasing.

October 12 staging database/API results and the schema-baseline repair are recorded in `store-closeout-audit.md`. The new OMG parser nets refunded processing and tax. New closeout invoices include those net components; existing paid product-only invoices remain held rather than rewritten.
