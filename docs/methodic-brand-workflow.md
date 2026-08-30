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

## Accounting continuation

The schema reserves National PO, Methodic order, billing status, invoice number, and the two QuickBooks transaction IDs. Intercompany automation should be activated only after the separate Methodic QuickBooks company exists and National/Methodic account, item, and tax mappings are approved.
