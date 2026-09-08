# Financials expenses

The Expenses tab lets the existing Financials owners (Steve, Gayle, and Mike) submit USD business expenses, retain a private receipt, review the exact account mapping, and post to National or Methodic's existing QuickBooks connection. No expense data is seeded or imported from Expensify.

## Accounting behavior

- Business-paid: creates a QBO `Purchase` (the QuickBooks Expense screen), debiting the chosen expense/COGS account and using the explicitly selected business bank or credit card account. Bank feeds should be matched to the resulting transaction rather than added again.
- Personally paid: creates an unpaid QBO `Bill`, using the chosen expense account, accounts payable account, and existing vendor representing the reimbursement recipient. Payment remains a separate action in QuickBooks. The merchant and business purpose appear on the bill's line and memo.
- The portal loads active accounts from the chosen company's chart, validates each selected account/payee server-side at submission and posting, and pins the submission to that connection's realm ID. A reconnected different realm cannot receive an old expense.
- USD only. Receipts are optional PDF/JPEG/PNG files up to 3 MB, retained privately in the portal; receipt binaries are not exported to QBO. Personal totals are submitted amounts, not an outstanding reimbursement balance.
- Account details are immutable once saved. Before the first posting attempt, an incorrect submission can be cancelled from its review and re-entered. Cancellation races safely with the posting claim. A failed/ambiguous posting must be reconciled first; corrections to a posted transaction are made in QuickBooks.

## Security and recovery

`financial-expenses` verifies the existing QBO role gate and the Financials identity allowlist for every action. The browser has no direct table or receipt-bucket access. Table RLS is enabled with client grants revoked; the endpoint uses the existing server-only Supabase client. A restrictive storage policy prevents pre-existing permissive policies from exposing the new receipt bucket. Receipt links are generated on demand and expire after 60 seconds.

Submissions use a client-generated UUID, with same-ID retries returning the stored record. Posting claims use a conditional database update; active claims cannot be reused for two minutes. A fixed QBO payload, stable `requestid`, deterministic document number, and remote identity/amount/account verification recover from an upstream success followed by a lost local acknowledgement. Conflicting or subsequently edited remote records block automatic linking. The form freezes ambiguous failed submissions for retry while it remains mounted; after navigating away, inspect the queue before re-entering an expense.

## Rollout

1. Apply `supabase/migrations/20260908012527_financial_expenses.sql` to the intended portal database before enabling the deployed endpoint.
2. Deploy the frontend and Netlify function together. No new production packages or environment variables are required. Existing QuickBooks OAuth connections supply the credentials.
3. Verify real sign-in for an allowed Financials owner, account loading in each business, private receipt upload/read, and one approved expense in QBO before routine use. No live accounting transaction was created during development.

The table and receipt bucket are additive; existing finance calculation and account mappings are not changed. Submitted expenses are recorded in QuickBooks; the portal's existing matched P&L remains its order/invoice-based calculation and does not incorporate these operating expenses.

## Validation

`CI=true npm test -- --runInBand src/__tests__/financialExpenses.test.js src/__tests__/ExpensesWorkspace.test.js src/__tests__/financialAccess.test.js src/__tests__/qbApiAuthorization.test.js`

`GENERATE_SOURCEMAP=false npm run build`

For isolated PostgreSQL schema and permission checks, install `@electric-sql/pglite@0.3.16` outside the repository and run:

`PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/check-financial-expenses-schema.cjs`

The schema check applies the actual migration to an isolated PostgreSQL engine with minimal Supabase role/storage fixtures. It verifies client denials, service writes, existing-policy isolation, constraints, and posting claims. It does not change the hosted database.
