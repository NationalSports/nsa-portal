# Financials expenses

The Expenses tab lets the existing Financials owners (Steve, Gayle, and Mike) submit USD business expenses, retain a private receipt, review the exact account mapping, and post to National or Methodic's existing QuickBooks connection. No expense data is seeded or imported from Expensify.

## Monthly schedules

National starts with three monthly reminders in September 2026: SchoolsFirst FCU Tesla ($1,129.77), SchoolsFirst FCU Rivian ($1,211.99), and T-Mobile. The T-Mobile amount is intentionally variable because the connected historical bills change month to month; the current statement amount is required when recording each occurrence. A partial unique index permits one active occurrence per schedule and month, while a cancelled entry can be corrected and re-entered.

Schedules create a monthly review item in the portal, not an unattended QuickBooks transaction. T-Mobile can be submitted through the normal account-number review and QBO posting flow. The vehicle payments remain flagged for principal/interest allocation and are blocked from the single-line expense flow: principal normally reduces the loan liability, while interest uses an expense account. Record the split in QuickBooks until the portal supports split-line loan transactions.

## Direct credit-card feed

The card feed uses Plaid Link and Transactions Sync. Cardholders authenticate inside Plaid's connection experience; National Sports Connect never receives or stores a bank username or password. The long-lived provider access token is encrypted server-side with AES-256-GCM before it is stored. Direct browser access to connections, tokens, accounts, imported transactions, and merchant rules is revoked.

Available workflow:

- Connect multiple card accounts to National or Methodic and map each one to a verified live QBO bank/credit-card account.
- Refresh manually or through the six-hour Netlify sweep. Each invocation handles up to three oldest connections concurrently; additional connections wait for the next sweep or refresh. Pending charges remain read-only until they clear.
- Review a monthly inbox, apply a verified QBO expense/COGS account and business purpose, optionally remember the merchant rule, flag receipt requirements, or ignore a non-business charge.
- View totals for uncategorized, ready, submitted, posted, and missing-receipt transactions; filter the inbox by status, group spending by QBO account, and export the month to CSV. Gross spending counts cleared positive USD charges only; refunds, pending authorizations, ignored and removed charges are excluded. Reports paginate through the entire month rather than stopping at the API's default row cap; exports escape spreadsheet formulas in source text.
- Prepare a cleared charge in the existing expense form. Provider merchant/date/amount, the merchant-rule category, and the mapped card account are revalidated server-side. The user can add the receipt, then use the existing explicit QBO review/post action. Database uniqueness prevents the same imported transaction from producing two active expense submissions.

This is the card-import, categorization, receipt-control, report, and QBO-posting portion of an Expensify replacement. It does not yet include receipt OCR/email ingestion, mileage/per-diem, employee reimbursements, card issuing, or multi-level approval policies.

### Provider configuration

Configure these server-only Netlify environment variables:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV` (`sandbox`, `development`, or `production`)
- `PLAID_TOKEN_ENCRYPTION_KEY` (exactly 32 random bytes encoded as base64, or 64 hexadecimal characters)
- `PLAID_REDIRECT_URI` only when an institution's OAuth flow requires it; register the exact URI in the Plaid dashboard.

Use a dedicated production encryption key and retain it: rotating it requires decrypting and re-encrypting stored access tokens. The UI remains visibly unconfigured and disables card connection when any required credential is missing. No real card was connected during development.

## Accounting behavior

- Business-paid: creates a QBO `Purchase` (the QuickBooks Expense screen), debiting the chosen expense/COGS account and using the explicitly selected business bank or credit card account. Bank feeds should be matched to the resulting transaction rather than added again.
- Personally paid: creates an unpaid QBO `Bill`, using the chosen expense account, accounts payable account, and existing vendor representing the reimbursement recipient. Payment remains a separate action in QuickBooks. The merchant and business purpose appear on the bill's line and memo.
- The portal loads active accounts and their `AcctNum` values from the chosen company's chart. Applicable account choices show number first and sort by number. The verified number and fully qualified name are saved with the submission and repeated in the queue and posting review. Each selected account/payee is validated server-side at submission and posting, and the submission is pinned to that connection's realm ID. A reconnected different realm cannot receive an old expense. Renumbering remains a QuickBooks chart-of-accounts action; refresh the Expenses tab afterward to bring in the change.
- USD only. Receipts are optional PDF/JPEG/PNG files up to 3 MB, retained privately in the portal; receipt binaries are not exported to QBO. Personal totals are submitted amounts, not an outstanding reimbursement balance.
- Account details are immutable once saved. Before the first posting attempt, an incorrect submission can be cancelled from its review and re-entered. Cancellation races safely with the posting claim. A failed/ambiguous posting must be reconciled first; corrections to a posted transaction are made in QuickBooks.

## Security and recovery

`financial-expenses` and `financial-card-feed` verify the existing QBO role gate and the Financials identity allowlist for every action. The browser has no direct expense, monthly-schedule, card-feed, or receipt-bucket access. RLS is enabled on all finance tables with client grants revoked; the endpoints use the existing server-only Supabase client. A restrictive storage policy prevents pre-existing permissive policies from exposing the new receipt bucket. Receipt links are generated on demand and expire after 60 seconds.

Submissions use a client-generated UUID, with same-ID retries returning the stored record. Posting claims use a conditional database update; active claims cannot be reused for two minutes. A fixed QBO payload, stable `requestid`, deterministic document number, and remote identity/amount/account verification recover from an upstream success followed by a lost local acknowledgement. Conflicting or subsequently edited remote records block automatic linking. The form freezes ambiguous failed submissions for retry while it remains mounted; after navigating away, inspect the queue before re-entering an expense.

Card sync acquires a two-minute connection lease, fetches the complete provider update (restarting the original cursor on a pagination mutation), then commits accounts, transactions, removals and cursor in one service-only database transaction. Timeout or malformed data preserves the previous complete update. Provider updates cannot overwrite user categories, QBO mappings, or expense links. Insert, cancellation and posting update the card inbox atomically through database triggers. Card and category mappings pin the QBO realm; older unpinned mappings require remapping. Changed/removed source charges are flagged for reconciliation and cannot initiate a fresh QBO write, while recovery of an already-written QBO record still works.

The provider and QBO flows have automated simulation coverage and isolated PostgreSQL checks. A real institution login, OAuth return, sandbox history import, and end-to-end QBO posting still need deployment validation after provider configuration. Linking the same physical card a second time under a different provider connection is not automatically deduplicated, and existing QBO bank-feed transactions are not automatically matched.

## Rollout

1. Apply `supabase/migrations/20260908012527_financial_expenses.sql`, `supabase/migrations/20260922090000_financial_card_feed.sql`, and `supabase/migrations/20260923033522_harden_financial_card_feed.sql` in order to the intended portal database before enabling the deployed endpoints.
2. Configure the server-only Plaid variables above, then deploy the frontend and Netlify functions together. No new production package is required; the existing QuickBooks OAuth connections continue to supply QBO credentials.
3. Verify real sign-in for an allowed Financials owner, account loading in each business, private receipt upload/read, and one approved expense in QBO before routine use. No live accounting transaction was created during development.

The table and receipt bucket are additive; existing finance calculation and account mappings are not changed. Submitted expenses are recorded in QuickBooks; the portal's existing matched P&L remains its order/invoice-based calculation and does not incorporate these operating expenses.

## Validation

`CI=true npm test -- --runInBand src/__tests__/financialExpenses.test.js src/__tests__/ExpensesWorkspace.test.js src/__tests__/CardFeedPanel.test.js src/__tests__/plaidHelpers.test.js src/__tests__/financialCardFeed.test.js src/__tests__/financialAccess.test.js src/__tests__/qbApiAuthorization.test.js`

`GENERATE_SOURCEMAP=false npm run build`

For isolated PostgreSQL schema and permission checks, install `@electric-sql/pglite@0.3.16` outside the repository and run:

`PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/check-financial-expenses-schema.cjs`

The schema check applies the actual migration to an isolated PostgreSQL engine with minimal Supabase role/storage fixtures. It verifies client denials, service writes, existing-policy isolation, constraints, and posting claims. It does not change the hosted database.
