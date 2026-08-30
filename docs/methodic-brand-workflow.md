# Methodic brand workflow

Methodic is an in-house brand and operating company. This workflow is intentionally independent of the public custom-uniform builder.

## Rep flow

1. Open a normal National sales order and select the **Methodic** tab.
2. Create a Methodic request for pricing, a mockup, or both.
3. For a mockup, select the sales order's existing art job. The request is added directly to that job's `art_requests`, so it appears on the normal **Art Dashboard**.
4. The rep can see pricing, mockup, sample, order, shipping, due dates, blockers, and recent activity without leaving the sales order.
5. The **Methodic Operations** dashboard gives the Methodic team the cross-order work queue.

## Operations dashboard

The dashboard includes:

- Open, art, sample, production, overdue, and blocked counts
- Requests, Pricing, Art, Samples, Orders, Tracking, Blocked, Overdue, and Mine views
- Search by request, SO, customer, style, PO/order number, and tracking number
- Rep and Methodic-owner assignment
- Earliest-due-first ordering, with blocked and overdue work promoted
- Pricing and setup costs
- Reference uploads and detailed art direction
- Sample and production tracking
- Direct links back to each National sales order

## Art integration

`methodic-workflow.js` appends an idempotent request to the selected `so_jobs.art_requests` record. It sets a job at `needs_art` to `art_requested`, preserving the existing Art Dashboard assignment and approval process.

A database trigger maps later art-job moves back into Methodic:

| Art Dashboard | Methodic mockup |
| --- | --- |
| Requested / in progress | With art |
| Waiting approval | Ready for rep |
| Production files / art complete | Approved |

## Data and security

- `methodic_requests` stores the current operational state.
- `methodic_request_events` stores the audit trail.
- Both tables have RLS enabled.
- Active staff may read them; browser writes are revoked.
- All mutations require a verified staff JWT and run through the server function.
- The function derives the customer and assigned rep from the sales order rather than trusting browser-supplied ownership fields.

## Intercompany accounting

Methodic and National use two named QuickBooks connections:

1. Methodic issues an invoice to National in the Methodic QuickBooks company.
2. National receives the same document number and amount as a Methodic vendor bill in the National QuickBooks company.
3. Accounting records a payment as a National `BillPayment` and the matching Methodic customer `Payment`.
4. The portal shows the invoice amount, open balance, due date, both QuickBooks IDs, payment history, partial failures, and retry state on the sales order.

Posting is fail-closed. It remains disabled until accounting approves the Methodic customer, income item, and tax code plus the National vendor and expense/COGS account. Payment recording additionally requires the National bank account and Methodic deposit account.

Each side is idempotent by Methodic invoice/payment number. The server saves a successful external ID immediately; if the second company fails, the request is marked partial and retrying resumes only the missing side. Concurrent payments are reserved under a database row lock so they cannot exceed the open invoice balance.

The payment action records completed ledger activity in both QuickBooks companies. It does not initiate ACH, print a check, or move funds; the bank transfer/check happens through the approved treasury process and its reference is then recorded here.

This accounting layer is designed to inherit PR #2041's fail-closed National account routing when that PR merges. No live transaction should be posted until both companies are connected, the included migrations/functions are deployed, and accounting has approved the mappings.
