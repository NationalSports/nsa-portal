# Click-through audit: information and workflow preservation

## Scope and method

This is an audit of the design prototype, not an application rollout. The runtime files on the PR branch were inspected as the comparison baseline. The prototype was checked for missing fields, actions, statuses, record context, navigation, and misleading interactions. Sample-data browser checks validate the corrected preview interactions; they do not validate live persistence, permissions, integrations, or financial policies.

The earlier claim that 22 navigation areas were clickable described navigation coverage, not feature parity. Several areas had been reduced too far. The design is not ready to replace the full existing portal.

## October 11: page-by-page source comparison and preview pass

The latest `main` was fetched read-only for this comparison: `738f91e73552aaffd6cdafdf5d94baad50fb5253`. Its runtime files match the earlier local comparison checkout. No runtime files were edited. Source review inventoried 1,405 UI label/header/action entries across the relevant files; that inventory guides the review, but is not a claim that every conditional state has been modeled.

The prototype now separates navigation, record context, and operational views instead of sending every section through a generic five-column table and detail form. Every staff navigation page was opened and inspected visually. Priority record tabs were exercised separately. Wide tables reflow into labeled records at narrower widths; money values remain intact, and mobile receiving keeps its size inputs beside the quantities and status they affect. Secondary actions use an explicit More actions menu.

| Preview page | Comparison source | Information/actions restored or retained |
|---|---|---|
| Dashboard | `App.js:rDash` | New-UI role selector, work queues, owner/source links, overdue context, business pulse, and workflow entry points retained. Values remain illustrative; complete role-specific dashboards remain a separate requirement. |
| Messages | `App.js:rMsg` | Read/unread and department/thread controls, source reference, recipients, mentions, attachments, compose/reply, mark-read actions; independent sample conversations retained. |
| AI Inbox | `AiInbox.js` | Sender/date, matched customer, intent/summary, original request, SKU/color/sizes, stock-match state, acknowledgement/error, proposed reply, ignore, draft-estimate/Gmail-draft and reviewed cart-command entry points. |
| AI Tasks | `AiTasks.js` | Email requests distinguished from bot jobs; task/source IDs, customer, dates, status, acknowledgement, errors, instructions, cart/result context, and source-email links. The previous ordinary to-do list was the wrong model. |
| Estimates | `App.js:rEst`, `OrderEditor.js` | Created/customer/memo/items/total/rep/status/SO/email; filters and sorting; quote lines with size/pricing/decoration detail, ledger, billing/delivery context, art/messages, send/schedule/approval/PDF, copy/delete/conversion controls. |
| Sales Orders | `App.js:rSO` | Created, customer/memo/rep, expected date, total, art, receiving, unread/shipping, and independent overall status; filters and record actions. Other-account orders still open their own context. |
| Invoices | `InvoicesPage.js` | Total/paid/balance, dates/age/due, rep/source, customer grouping, past-due actions, invoice lines, payment links, credit/split/void actions, cost variance and POs, PDF/packing-slip/send/SMS/follow-up controls. Drafts remain separate from collectible balances. |
| Receive Payments | `ReceivePaymentsPage.js` | Received payment vs invoice allocation, unapplied vs other credits, date/method/reference/note, family scope, fill-oldest/clear, allocation history, manage/unapply, unapplied deletion, historical-payment entry points. |
| OMG Stores | `App.js:rOMG` | Channel, customer, rep/CSR/artist, dates/status, ingestion, SKU/art/deco groups, parent orders, production packet, profit ledger, deposits, collected/remitted tax, filing/reversal and export entry points. This is no longer a copy of the webstore tabs. |
| Webstores | `Webstores.js` | Store metadata and create/clone/launch/close; catalog variants/packages, cost/price/fundraising, live-stock/ETA fields, art/color-way/personalization controls, buyer orders/refunds/labels, reports/exports, batches, per-size sourcing/decoration stock, roster invitations, coupons, appearance/settings. |
| Sales Tools | `App.js:rSalesTools` | Actual My Day, Quote Forms, Numbers List, Size Sorter, Quick Reorder, Deco Calculator, Mockup Helper, and Image Vectorizer workspaces; their inputs, source records, and actions replace the earlier invented generic tool list. |
| Jobs | `App.js:rJobs`, `OrderEditor.js` | Existing rich List/Kanban and separate item/art/production statuses retained. Job size allocations are capped to demand even if the PO records an overage. |
| Uniform Jobs | `uniform/UniformOrdersAdmin.js` | Queue/Board lanes, customer/contact/account and working/commission rep, quantity/total, payment and production separately, proof/approved version and lock, rep review, roster/downloads, tracking, and SO-conversion controls. Latest-proof lock gates are visible. |
| Art Dashboard | `App.js:rArtist` | Order proof collections retained; additional artist request queue and production-file views expose assignment, request state, mock/file readiness, method/placement/size/color-way, versions, claim/edit/reject, file upload and rep-approval entry points. |
| Production Board | `App.js:rProd2` | Rich job context and same data across List/Kanban retained, with separate art/goods/production readiness rather than one readiness badge. Live floor clocks/machine assignment and release permissions still require implementation review. |
| Warehouse | `App.js:rWarehouse`, `BaggingStation.js` | Item Fulfillment, Scan to Receive, Ready for Deco, Ready to Ship, Deliver, Bagging Queue, Stock POs, My Tasks, and Recent Actions; rep/source/age/destination/stock coverage; assignment, short-pull, per-size receipt, overage review, boxes, carrier/weight/dimensions/cost, labels, delivery, task, and shortage-resolution entry points. |
| Purchase Orders | `App.js:rPOs`, `rBatchPOs`, `OrderEditor.js` PO detail | Sales-order, batch, inventory, decoration, booking, and drop-ship distinctions; PO/vendor/customer/SO/rep/item, ordered/received/cancelled/open, created/expected, cost/source/batch, filters/sort/scan/new-stock-PO; size-ledger receiving, history, labels, tracking, editing/cancellation, vendor bills/freight/claims, email/PDF actions. |
| Customers | `CustDetail.js`, `App.js:rCust` | Parent/subaccount context, tag, rep/CSR, tier/terms/tax/colors/search tags, balances; Orders, Jobs, Messages, Contacts, Overview, Stores, Promo/credits, Artwork, Catalog, Roster, Reporting, Invoices, Addresses; statement/email/payment/portal/copy/archive/delete actions. |
| Vendors | `modals.js:VendDetail/VendorModal`, `App.js:rVend` | Type/provider, contact/rep/address, terms, owed, PO eligibility, inventory, automation/scan settings, catalog/B2B placeholders, scoped PO list, product catalog, API test/pricing-sync and edit actions. No real credentials are included. |
| Team | `App.js:rTeam` | Directory, access management, onboarding, inactive members, role/status/email/phone, CSR assignment, page-access checkboxes, role defaults, invite/link/add-email/deactivate/reactivate controls. Production permissions are not changed. |
| Reports | `App.js:rReports` | Sales/Customers/Production/Finance groups; all 14 report views, rep/customer/date controls, raw tables and export entry points alongside the proposed charts; pipeline, products, reps, stores, customer/CSR, production/decorator/time/labor, inventory/warehouse, receivables and tax fields. Sample report views do not reconcile to a live ledger. |
| Settings | `App.js:rSettings` | Actual Company Info, Decoration, Financial, Customer Tiers, Lists & Options, Labor Rates, Coach Portal, Webstores, Uniform Builder/Patterns/Orders tabs; contact/terms/logo, price breaks/vendor routing, tax/payment/freight, bins/lists, rates/follow-ups/disclaimer, store/uniform fields and actions. |
| Coach sections | `CoachPortal.js` | Home/rep/balance/review context; order sizes and receiving; customer-only invoice totals/lines/PDF/payment preview; roster invitations/opened/ordered; shop size/art/personalization/delivery choices and builder/cart entry points; spend/program periods and statements; continuous approval collection and account-scoped messages retained. Staff costs, jobs, and vendor threads stay out of the customer review. |

### Priority procurement and warehouse checks

- **Open quantity is per size:** ordered, received, cancelled, billed/shipped, open, and overage are individually readable. A cancelled quantity remains visible, and active receipt-box denominators exclude cancellations.
- **Overages remain enterable:** a receipt can exceed the open ordered quantity. The preview names the overage in a review dialog, then records the receipt date, worker, bin, sizes, quantity, and notes. Job/coach fulfillment shows the units that cover demand; the PO preserves the actual larger receipt.
- **Drop ship and service POs do not arrive at the warehouse:** they retain their destination/service context and bypass warehouse receipt entry. Billed direct-shipment quantities appear as shipped.
- **Batch/source identity stays visible:** batch/vendor/customer/SO references and source-PO labels survive the combined view. Standalone inventory POs can be created without a sales order.
- **Picking is different from receiving:** IF detail exposes per-size shelf stock, requested/pulled/still-needed/short, bin, destination, rep, and age. Short-close actions retain the order demand concept; they are not cancellation actions.
- **Shipping is job-based:** finished-job identity, ready date, size contents, boxes, carrier/tracking, weight/dimensions, actual shipping cost vs customer charge, label/pickup and rep-notification controls are represented separately from receipt entry.

### Validation and limits of this pass

The browser walk passed 22 staff navigation pages and 217 tab/detail selections, plus the nine coach sections at desktop and phone widths. It exercised partial/overage receipt review/history, IF detail, shipping detail, bagging detail, all 14 report views, and mobile navigation. Staff layouts were checked at 1024, 736, 390, and 320 pixels; coach layouts at 1024, 390, and 320. The existing proof review, per-placement/shared changes, bulk reviewed approvals, lightbox navigation, revision isolation, and artwork attachment checks also passed.

This pass restores design destinations for the principal fields/actions seen in the source. It is **not** a guarantee of exhaustive production parity. Advanced actions mostly open contextual sample dialogs; many filters and integrations are visual representations. This does not execute vendor ordering, live inventory changes, label purchase, messaging, payment posting, refunds, invitations, permissions, or server-side approvals. Actual row sets, access rules, calculation definitions, loading/failure states, multi-order/source allocations, destructive-action guards, and provider-specific dialogs still need validation when a production implementation is authorized. The application routes listed later in this audit remain outside this click-through's current navigation scope.


## Earlier corrections

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
12. **Status visibility was incomplete:** The order editor now keeps item, art, and production statuses, a received/required meter, PO/vendor/batch context, linked jobs, and labeled colored size boxes visible without expanding extra details. Jobs, order Jobs, List/Kanban, job details, and Tracking reuse these size quantities. Job Art and Sizes / receiving tabs are scoped to the selected job. Partial receiving updates all related sample views; PO/warehouse list statuses are derived rather than contradictory fixtures. On mobile, receiving rows become labeled cards with all counts, statuses, and entry controls visible.

Visual review captured all 22 staff navigation screens and separately inspected the order editor, order Jobs, job details, job Art, job Sizes / receiving, PO receiving, Tracking, and Kanban. Order/job layouts were checked at 1024, 736, 390, and 320 pixels. A partial-size receipt was verified across receiving, the order item, and job details. This remains a sample-data visual review; the remaining operational gaps below are still open.

## Earlier findings and remaining production-validation requirements

This table records the earlier audit baseline. The dated October 11 mapping above supersedes its descriptions of reduced visual coverage; the live policies and advanced edge cases listed here remain implementation checks.

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

## October 11 — Pro-inspired page character and compact rows

Compared the operational lists with the current source, especially `rSOs` in `src/app.js` (compact rows with separate art, item coverage, messages, shipping and order status). The production browser required sign-in, so the source and supplied production screenshots were the comparison evidence. Arc Pro's public references informed the composition; no gated source or licensed components were copied.

| Preview page | Visual treatment / public reference | Information and actions retained |
| --- | --- | --- |
| Dashboard | Athletic overview, compact priority queue, metrics dashboard | Existing business metrics, roles, workflow links, trends |
| Messages | Inbox triage / support conversation split | Three scoped threads, recipients, departments, attachments, replies, record links |
| AI Inbox | Source email / extraction split, review workspace | Email, intent, sizes, SKU, customer, acknowledgement/error, draft/cart/estimate actions |
| AI Tasks | Agent-run queue, status counts and compact task grid | Source request, task kind, error/acknowledgement, detail/result/source actions |
| Estimates | Compact quote register / data grid | ID, created, account/memo, items/total, rep, status, linked SO, email, open/convert/copy/delete |
| Sales Orders | Compact operational register / data grid | Created/account/memo/due/rep, total, art, receipt count, unread, shipping, status, open/copy/delete |
| Invoices | Accounting register + invoice-studio document detail | Totals/paid/balance, dates/age/source/rep, payments, credits, cost variance, documents and actions |
| Receive Payments | Cash ledger with distinct funds-on-account band | Applied/unapplied, credits, invoice balances, allocation and management actions |
| OMG Stores | Branded store rows with financial context | Channels, rep, dates, orders/revenue, profit/deposits and ingestion/export actions |
| Webstores | Branded storefront directory | Revenue/orders, dates, customer/SO, clone/new/default actions; all detail tabs |
| Sales Tools | Compact tool workbench | All eight tools, inputs/results and contextual actions |
| Jobs | Dense list and project board | Independent item/art/production statuses, garment/size coverage, PO/batch, notes, artist, actions |
| Uniform Jobs | Compact review register + board | Quote/units, customer/contact, commission/working reps, proof version/lock, payment, fulfillment/due/age |
| Art Dashboard | Gallery-led order collection, artist queue, production-file grid | Continuous placement proofs, versioned approvals, library, assignments and file/production readiness |
| Prod Board | Stage-coded board and compact list | Same fields and actions as Jobs, with per-size garment rows |
| Warehouse | Station header + dispatch/receipt grids | All nine queues, size-level stock/receipt data, shortages, assignments, packing, labels and bagging |
| Purchase Orders | Receipt register with inline status-colored size tiles | All source types, dates/rep/batch, cost, raw receipt/cancel/open units, overages, receipt history and actions |
| Customers | Account-family directory with tagged identities | Tag/family, rep/CSR/contact, tier/terms/tax, search tags, A/R and all detail tabs/actions |
| Vendors | Supplier directory and connection types | Provider/type/contact/terms/owed/status, eligibility, catalogs, pricing and API-test previews |
| Team | Compact avatar directory / roles & permissions | Roles/CSR, email/phone, access/assignments, invite/deactivate actions and all access controls |
| Reports | Split bar / metrics explorer plus labeled comparisons | All 14 report views, complete raw tables, record links, filters and export actions |
| Settings | Section rail / settings page | All 11 sections, fields, pricing/shipping matrices and configuration actions |
| Coach portal | High-contrast branded navigation + continuous gallery | All nine sections; per-placement/version approvals, reviewed scope, changes/conversation and order/billing/roster/store context |

Public references: [Data grid](https://uiarc.dev/components/data-grid), [Invoice studio](https://uiarc.dev/components/blocks/invoice-studio), [Inbox triage](https://uiarc.dev/components/blocks/inbox-triage), [Project board](https://uiarc.dev/components/blocks/project-board), [Team directory](https://uiarc.dev/components/blocks/team-directory), [Settings page](https://uiarc.dev/components/blocks/settings-page), [Metrics dashboard](https://uiarc.dev/components/blocks/metrics-dashboard), [Release readiness](https://uiarc.dev/components/blocks/release-readiness).

Validation: all 22 staff pages were visually inspected individually, followed by key record details, report subviews, coach proof review, mobile and theme screens. Existing 217 tab/detail checks, receipt-overage/job-allocation guards, warehouse workflows and scoped coach approvals passed. A separate density check measured desktop SO rows at 57px versus 206–216px before this pass; uniform review rows at 105px. Wider tables use contained horizontal scrolling on narrow desktop panels, and labeled rows on phones. Checked 1440, 1024, 736, 390 and 320px. No production runtime files changed. Earlier functional limitations remain: illustrative data, some filters and advanced actions are contextual previews, and this does not establish exhaustive production parity.
