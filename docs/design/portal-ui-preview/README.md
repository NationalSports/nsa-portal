# Portal UI design preview

This is a design review prototype, using sample data and local interactions. It does not connect to authentication, Supabase, purchasing, payments, messaging, or production systems. Approval buttons and replies only change the preview's local state.

Read [AUDIT.md](AUDIT.md) for the information/workflow audit, corrections made to the click-through, remaining weaknesses, and actual application routes not yet represented. Clickable navigation does not imply feature parity.

Open `index.html` in a browser to explore it. Fonts and the bundled preview runtime load from approved external CDNs, so an internet connection is needed for the complete presentation. The HTML includes the inline design source; `portal-art-preview.fragment.html` is the editable source retained separately.

## Review paths

- Start in **Purchase Orders** for the procurement and warehouse pass. Use All POs and source/vendor/rep filters; inspect a regular PO, INVPO-1007 (booking inventory), DPO-8001 (service), or PO-60660 (drop ship). The Receiving tab shows the complete size ledger and receipt-review/history flow.
- In **Warehouse**, explore Item Fulfillment, Scan to Receive, Ready for Deco, Ready to Ship, Deliver, Bagging Queue, Stock POs, My Tasks, and Recent Actions.
- Open the **SO-2877 order editor** to inspect the item status, art status, production status, receiving progress, PO/batch links, and colored per-size received/required boxes. They remain visible with extra details collapsed.
- Navigate to **Art Dashboard** and open **Fall Gear** to review the staff proof collection.
- Choose **Preview coach portal** or **Coach view** for the customer experience. The coach sees one order collection, with a continuous garment and placement strip, an enlarged gallery, and one art conversation.
- Approve a placement and advance, or inspect multiple placements and approve the reviewed placements together.
- Request changes for one garment/placement or for all placements using shared artwork. The dialog names the affected placements before saving.
- Return to the staff view, open **Overview**, and add a revised proof. Only that placement returns to pending approval; the other approvals remain.
- Navigate to **Sales Orders** and open a record. The editor retains the vertical ledger, visible **Create PO**, full-width item editors, collapsed editing, size additions, and decoration editing.
- Explore the order tabs, reports, production board, customer records, purchase orders, and uniform roster preview.

## Job visibility and layout

The order's Jobs tab defaults to **List** and offers **Kanban** as an alternate view of the same job records. Order jobs are scoped to that order; the global Production Board can show jobs from multiple orders.

The global Jobs screen uses the same rich List/Kanban layout. Job details retain separate statuses and per-size receiving boxes; Art and Sizes / receiving tabs show the selected job's information. Partial receipts remain amber, complete receipts green, in-transit units purple, and cancellations red, with text labels accompanying color. PO and warehouse statuses derive from the same sample quantities. Receiving switches to labeled size cards on mobile so its entry controls remain visible.

The list preserves the current production UI's core information: job identity, artwork, decoration method and position, garment count, received/total units, items status, art status, production status, and job actions. Garment subrows keep SKU, name, color, and received/expected quantities for every size visible. The richer Kanban cards display these same fields, plus artist, need-by, PO context, and notes. Split, count, outside-decoration, and tracking context can also appear when present.

Both layouts are local sample views. Updating a preview production stage is reflected in both; the sample blocks production progression until art is complete and goods are received. Production implementation must use the existing live allocation, mock checks, permissions, and workflow gates rather than the sample model.

## Detailed page pass

The rest of the click-through now has section-specific fields and action entry points based on the current runtime code: estimates/orders, invoices/payments, customer/vendor/team records, AI email requests and bot jobs, real sales tools, uniform Queue/Board and proof-lock states, OMG financial/tax operations, webstore catalog/order/sourcing/roster/coupon tabs, all 14 reporting views, and the actual settings tabs. Coach orders, billing/invoice details, roster invitations, shop choices, and spend statements were expanded too. Read the dated page-by-page map in AUDIT.md for the source references and remaining production-validation requirements.

Advanced actions usually open contextual sample dialogs. Many filters are visual controls; this is still a design click-through, not a working application. The browser walk checked 22 staff pages, 217 tab/detail selections, and the nine coach sections at desktop/mobile widths. Procurement checks include overage receipt/history, inventory/booking/service/drop-ship distinctions, and capped job fulfillment.

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

The prototype includes illustrative AI-generated garment photographs and sample artwork. These are layout examples, not final production proof assets. Reports include sample account breakdowns and sample conversion cohorts. Arc UI informed the interface direction; this prototype does not include licensed Arc Pro source.

No production components, routes, dependencies, database schema, or deployment configuration are changed by this proposal.

## Pro-inspired page design pass

The local preview now uses compact order/quote registers, inline size-level PO receipts, a warehouse station layout, paper-style invoice details, source/extraction AI intake, directory identities, branded store rows and a settings section rail. Reports add labeled comparisons from their existing sample rows. The continuous coach art review remains one collection with exact placement/version approvals. Desktop SO rows measure 57px (previously 206–216px); all fields and action intents remain represented. This is an independent preview inspired by public Arc Pro examples, with no licensed Pro source copied. See AUDIT.md for the page map and validation.

## Art and coach proof studio pass

Photographic garment mockups now show the pullover, cap, and crewneck front/back with separate artwork overlays and width guides. These are illustrative assets, not manufacturer photography or calibrated production proofs. A compact order-wide placement strip shows version, method, and status; Next pending proof returns to unfinished reviews. Specifications, placement/version-specific approvals, scoped changes, conversations, files, and final review remain available. Desktop, dark mode, and 320/390/736/1024px layouts were visually checked. All four proof placements and the sequential approval flow passed browser checks, alongside the art and page parity suites. Preview only.

The garment sheet was generated with the image_gen tool from an instruction for four unbranded studio garment views (royal quarter-zip front, black perforated cap front, gray crewneck front and back), compressed to WebP, and embedded once in the preview. Existing artwork is rendered independently of this illustrative image.

## Current coach appearance + new review flow

The coach preview now carries the current CoachPortal.js visual language: NSA logo on a white header, team stripe, condensed athletic headings, Team HQ quick-access dashboard, and navy Art Locker tiles. The new continuous collection review lives inside that shell. Garment sizes, proof specifications, status/version, scoped changes, conversations and approval actions remain visible. Use Art Locker → Continue review; return to the library without losing sample review state. The CCAA navy/burgundy theme is illustrative. Production customer colors/logo and business logic are unchanged. Desktop/mobile checks passed down to 320px.
