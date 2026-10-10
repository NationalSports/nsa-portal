# Click-through audit: information and workflow preservation

## Scope and method

This is an audit of the design prototype, not an application rollout. The runtime files on the PR branch were inspected as the comparison baseline. The prototype was checked for missing fields, actions, statuses, record context, navigation, and misleading interactions. Sample-data browser checks validate the corrected preview interactions; they do not validate live persistence, permissions, integrations, or financial policies.

The earlier claim that 22 navigation areas were clickable described navigation coverage, not feature parity. Several areas had been reduced too far. The design is not ready to replace the full existing portal.

## Corrections in this pass

1. **Wrong record context:** Other sales orders previously opened CCAA's sample editor. They now open their own contextual sample details, items, jobs, and billing records. CCAA remains the fully editable editor fixture. Customer-related records are filtered to the selected account, and records without attached sample art no longer show CCAA art.
2. **Frozen financial ledger:** Item edits changed a line total but left the order ledger fixed. Decoration cost is now visible beside decoration sell price. The sample ledger, quantities, sales-order total, and related draft invoice update from the same sample item model. The initial sample remains $3,795.62 total and $2,001.24 cost. This calculation does not cover all of the application's costing cases.
3. **Receiving lost shortages:** The old generic receiving form exposed only a total and could mark an entire PO received. It now shows SKU, color, size, expected, received, outstanding, and receive-now quantity. Partial receipts update the same job fulfillment model and remain partial rather than silently completing the PO.
4. **Payments lost allocation:** The old preview was an invoice list and a one-click paid label. It now exposes received payments, method/reference, invoice allocations, applied amount, unapplied amount, open invoice balances, and payment history. Sample allocation cannot exceed the payment or invoice balance. Draft invoices are not eligible for payment allocation.
5. **Customer records were generic:** Contextual Orders, Estimates, Invoices, Jobs, Art, Contacts, Addresses, Terms/credits, Stores, and Activity views were restored to the sample customer record. These are still incomplete representations of the richer account model.
6. **Messages changed only their heading:** Each sample thread now has its own conversation, related reference, and retained replies. Coach messaging is scoped to the CCAA sample conversation rather than exposing vendor or other-customer threads.
7. **AI Inbox was ordinary messaging:** It now shows the source request, extracted SKU/color/size quantities, stock-check state, customer, need-by, decoration, and staff review before creating a draft estimate.
8. **Coach navigation was reduced:** Home, Billing, Roster, Store, Shop, and Spend/promo are represented again alongside Orders, Art review, and Messages. The real portal conditionally enables several of these; the sample account exposes them for review.
9. **Store details were four generic tabs:** Catalog, Orders, Art & Logos, Analytics, Batches, Inventory, Roster, Coupons, Appearance, and Settings are represented with section-specific sample fields instead of the same detail form everywhere.
10. **Sorting and new IDs were misleading:** Need-by sorting now actually sorts dates, and new sample estimate/order IDs are unique. Homepage overdue links open the matching sample account/order rather than always opening CCAA.
11. **Search coverage was misleading:** The global search field advertised orders, jobs, and customers but searched only orders. It now shows results across sample record types. Search on restored table-based screens no longer tries to update a nonexistent generic list.

## Section-by-section findings still to resolve

| Area | Important information/actions to retain | Audit status |
|---|---|---|
| Dashboard | Rep/role-specific queues, task ownership, due dates, unread messages, source-record links | Record links corrected. Real role dashboards, personal workspaces, and full queue coverage remain incomplete. |
| Sales orders | Customer/memo/rep, need-by, items, fulfillment, status, billing, delivery, linked records | Wrong-record navigation corrected. Only SO-2877 has a fully editable fixture; other orders have contextual sample views. Full filters, grouping, and bulk actions remain. |
| Order editor | Garment and decoration costs/sells, sizes, fulfillment, purchasing, shipment history, notes, names/numbers, alternate methods | Ledger and related draft-invoice line consistency improved. Per-size pricing, promotions, reversible decorations, outside costs, inbound freight, actual shipping spend, picks, billed PO costs, and split-run pricing are not fully modeled. |
| Estimates | Item pricing, margin, customer/ship-to/bill-to, approvals, revisions, quote sharing, conversion | Still substantially weaker than the shared production editor. Conversion and messaging are sample actions. |
| Jobs | Artwork/method/position, garments, per-size received/expected, items/art/production statuses, artist, request state, actions | List/Kanban restores core visibility. Real split/merge/link groups, workflow permissions, clocks, production packets, and allocation edge cases remain unimplemented in the preview. |
| Uniform jobs | Roster, personalization, player-specific orders, vendor/designer stages, fulfillment and proof context | Editable roster exists, but the production workflow and roster invitation/order states remain incomplete. |
| Art Dashboard | Requests, artist assignment, proof availability, methods, production files, versions, coach approval state | Order-wide collection is improved. Full artist queue, original production files, names/numbers/reversible proofs, and real per-garment mock gates remain. |
| Coach art review | Continuous collection, shared-art scope, placement-specific decisions, version pinning, partial decisions, comments | Sample flows checked. Real transactional decisions, stale-proof conflicts, missing mocks, reversible/color-way completeness, and existing server rejection/notification behavior must be retained before implementation. |
| Production Board | Rich job context, independent goods/art/production states, readiness gates, overdue items, workload and clocks | Core sample information is visible in List/Kanban. Live floor actions and permissions are not represented fully. |
| Purchase orders | SO/customer/vendor, SKU, ordered/received/cancelled/open sizes, cost, booking/batch source, expected date, ship-to | Receiving and context improved. Cancellations, batch aggregation, booking, decoration POs, vendor APIs, claims, and cost reconciliation remain incomplete. |
| Warehouse | Size-level partial receipts, inventory picks, discrepancies, boxes, shipping, count verification | Partial receipts restored. Picks, returns, overages, cancellations, counted discrepancies, boxes, and shipping operations still need a dedicated view. |
| Invoices | Total/paid/balance, source SO, terms/PO/date/due, lines, deposit/partial types, payment history, credit memos | Core amounts/history restored. Deposit/partial billing, posted-credit locks, reminders, fees, cost variance, and reconciliation remain incomplete. |
| Receive Payments | One receipt across invoices, unapplied balances, other credits, method/reference, historical invoice support, unapply | Sample allocation restored. Historical invoices, cross-account allocation rules, refunds/unapply, deduplication, and accounting integrations remain. |
| Customers | Parent/subaccounts, contacts, addresses, reps, terms/tax, estimates/orders/jobs, invoices/AR, stores, promo/credits, history | Navigation/context restored. Family hierarchy, tax exemptions/rates, historical AR, promo allocations, pending shipping, archive rules, and all management actions remain incomplete. |
| Vendors | Vendor details, contacts, products, POs, terms, integration/routing context | Contextual PO/contact/terms views restored. Product catalog, vendor API setup, routing, and vendor-specific management remain under-modeled. |
| Team | Roles, departments, access, invitation/session states, assignments | Generic role fields are inadequate. A permissions/access design must preserve the real role matrix and restrictions. |
| Messages | Thread identity, source entity, recipients, internal/customer distinction, mentions, unread/read states, attachments | Thread identity/context/replies fixed. Recipient selection, mentions, attachments, notifications, and unread workflows remain. |
| AI Inbox | Source email, extraction, SKU/sizes, availability, human confirmation, estimate creation | Intake sample restored. Extraction editing, deduplication, actual stock lookup, processing failures, and attachment review remain. |
| AI Tasks | Owner, due/priority, source record, description, state, completion evidence | Still a simplified task list. Assignment, recurrence, payload/context, failures, and permissions need further design. |
| OMG Stores | Store/order status, campaign dates, parent/customer/rep, finance, tax remittance, fulfillment, fundraising | More sample tabs exist, but OMG-specific finance/tax/profit reconciliation and operations remain under-modeled. |
| Webstores | Catalog variants/packages, art/colors, orders/payment/delivery, batches, inventory/shortages, roster, coupons, analytics, appearance | Tabs and example fields restored. Catalog grouping, packages, shared-school programs, bagging/shipping, coupons, personalization and sourcing actions are not fully designed. |
| Reports | Rep/customer/date filters, pipeline/AR, booked/billed views, exact totals, drilldowns, raw rows, reconciliation | The visual charts are useful but too small a subset of real reporting. Charts must augment detailed tables and retain the existing revenue/cost definitions. |
| Sales Tools | Products/catalog, stock, pricing, proposals, actual tool scope | Sample dialogs remain shallow. Product/variant search, pricing cases, and quote-building context need a dedicated pass. |
| Settings | Real company defaults, financial/tax/shipping settings, notifications, role access, integrations | Generic editable strings do not preserve the real settings schema, validation, or access controls. Needs a dedicated design. |

## Navigation areas absent from the earlier prototype

The application's route inventory also contains Products, Inventory, Batch POs, Methodic operations, Commissions, Financials, Sales Map, Issues, Import, QuickBooks, Backup, Sales History, Marketing, and Search. These were not represented as complete routes in the 22-area prototype. Availability depends on the user and configuration. They must remain available wherever the current application exposes them; the redesign must not remove them simply because they are outside this preview's scope.

## Comparison sources

- `src/OrderEditor.js`: existing job list/details, live fulfillment allocations, readiness gates, split/merge actions, and production/art controls.
- `src/App.js`: actual route inventory, customer actions, PO aggregation, warehouse/report/message/settings flows.
- `src/CustDetail.js`: family account context, transaction/order/job tables, account credits, promo programs, stores and historical AR.
- `src/ReceivePaymentsPage.js`: received payments, allocations, unapplied balances, account credits and history.
- `src/InvoicesPage.js`: line-level invoices, payment history, credit and cost-variance context.
- `src/CoachPortal.js`: conditional navigation, review gates, per-item decisions, stale-proof handling, billing and roster context.
- `src/Webstores.js` and `src/WebstoreReports.js`: actual store tabs, catalog, sourcing, batching, roster/coupons and analytics fields.
- `src/AiInbox.js` and `src/AiTasks.js`: source intake and task workflow.

## Design acceptance rule

Before any production implementation, every current field, action, filter, status, and access rule needs a visible or deliberately placed destination. Layout changes can make the interface calmer; they cannot silently narrow what users can see or do. Every remaining gap above stays open until its replacement is reviewed.
