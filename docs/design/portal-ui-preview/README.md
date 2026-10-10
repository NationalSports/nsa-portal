# Portal UI design preview

This is a design review prototype, using sample data and local interactions. It does not connect to authentication, Supabase, purchasing, payments, messaging, or production systems. Approval buttons and replies only change the preview's local state.

Read [AUDIT.md](AUDIT.md) for the information/workflow audit, corrections made to the click-through, remaining weaknesses, and actual application routes not yet represented. Clickable navigation does not imply feature parity.

Open `index.html` in a browser to explore it. Fonts and the bundled preview runtime load from approved external CDNs, so an internet connection is needed for the complete presentation. The HTML includes the inline design source; `portal-art-preview.fragment.html` is the editable source retained separately.

## Review paths

- Start in **Art Dashboard** and open **Fall Gear** to review the staff proof collection.
- Choose **Preview coach portal** or **Coach view** for the customer experience. The coach sees one order collection, with a continuous garment and placement strip, an enlarged gallery, and one art conversation.
- Approve a placement and advance, or inspect multiple placements and approve the reviewed placements together.
- Request changes for one garment/placement or for all placements using shared artwork. The dialog names the affected placements before saving.
- Return to the staff view, open **Overview**, and add a revised proof. Only that placement returns to pending approval; the other approvals remain.
- Navigate to **Sales Orders** and open a record. The editor retains the vertical ledger, visible **Create PO**, full-width item editors, collapsed editing, size additions, and decoration editing.
- Explore the order tabs, reports, production board, customer records, purchase orders, and uniform roster preview.

## Job visibility and layout

The order's Jobs tab defaults to **List** and offers **Kanban** as an alternate view of the same job records. Order jobs are scoped to that order; the global Production Board can show jobs from multiple orders.

The list preserves the current production UI's core information: job identity, artwork, decoration method and position, garment count, received/total units, items status, art status, production status, and job actions. Garment subrows keep SKU, name, color, and received/expected quantities for every size visible. The richer Kanban cards display these same fields, plus artist, need-by, PO context, and notes. Split, count, outside-decoration, and tracking context can also appear when present.

Both layouts are local sample views. Updating a preview production stage is reflected in both; the sample blocks production progression until art is complete and goods are received. Production implementation must use the existing live allocation, mock checks, permissions, and workflow gates rather than the sample model.

## Proposed approval model

The customer-facing review belongs to an order-level proof collection. Production jobs remain available to staff, but they do not divide the coach's review into separate destinations.

Approval still identifies an exact garment, placement, method, size, and proof version. Shared artwork can appear on several garments; identical source artwork alone does not imply approval of every placement. A scoped request can affect one placement or each use of shared artwork. Revised proofs reopen only the affected approvals.

Before production implementation, define the rules for published collection versions, shared artwork revisions, reviewer permissions, audit records, and release of partially approved orders. These policies are represented visually here, not connected to live business logic.

## Validation

Local headless-browser checks covered all 22 staff navigation areas and six order tabs in the portal preview. The art upgrade was checked for continuous gallery navigation, coach/staff switching, scoped change requests, bulk approval of reviewed placements, preservation of unaffected approvals after revisions, order-level conversations, artwork attachment, and editable roster rows.

Desktop and mobile layouts were checked at 1024, 736, and 390 pixels, with no document-level horizontal overflow in the coach review. Screenshots were inspected locally. The inline scripts passed JavaScript syntax checks.

The updated order-jobs preview was also checked for List as the default, matching job scopes and field visibility across List/Kanban, per-size fulfillment, gated sample production changes, and responsive overflow at 736 and 390 pixels.

The audit pass restores contextual record/customer links, size-level partial receiving, payment allocations and unapplied balances, invoice payment history, distinct message conversations with retained replies, AI email intake, broader customer/store/coach navigation, and live sample ledger updates including decoration costs. Remaining functional and information gaps are listed in AUDIT.md.

## Scope

The prototype includes illustrative garment shapes and sample artwork. These are layout examples, not final production proof assets. Reports include sample account breakdowns and sample conversion cohorts. Arc UI informed the interface direction; this prototype does not include licensed Arc Pro source.

No production components, routes, dependencies, database schema, or deployment configuration are changed by this proposal.
