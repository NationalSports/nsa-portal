# Sports Inc "SportsLink" API → Supplier-Bill Automation — Plan

Status: **design proposal, build pending** (review before implementation).
Replaces the manual PDF upload step for **Sports Inc–routed** supplier bills and
feeds them straight into the **Billed tracking** on each Sales Order.

---

## TL;DR

Sports Inc now exposes a REST API (`https://api.sportsinc.com/`) that returns the
**exact same invoice data we currently scrape out of PDFs** — as clean JSON, no
upload, no OCR. The whole point of this plan: **don't rebuild billing.** We write
one thin adapter that turns a SportsLink document into the parsed-bill object our
pipeline already understands, then reuse everything downstream — PO matching,
duplicate detection, the review screen, AI size/SKU reconciliation, "Push to
Portal," and the **Billed** columns on the SO Tracking tab — unchanged.

What changes for the team: instead of saving PDFs and dragging them into the Bill
Uploads box, a **"Sports Inc Inbox"** fills itself every morning with every
document Sports Inc has for us, each already matched (or flagged) against a PO, so
you can **see every item coming in at a glance** and apply them in a click.

What does **not** change: anything not billed through Sports Inc (other suppliers,
local decorators, etc.) still comes in as PDFs through the existing flow. This is
additive — the PDF parser stays.

---

## How billing works today (current state)

The flow we're augmenting lives in `src/App.js`:

1. Staff upload supplier PDFs → `processBillPdfs()` (line ~23863) →
   `parseSupplierBill()` / `parseSingleInvoice()` (line ~23419/23813) scrape each
   invoice into a **parsed-bill object**:
   ```js
   {
     po_number, doc_number, doc_date, due_date, ship_date,
     supplier, vendor, tracking,
     merchandise_total, freight, si_upcharge, doc_total,
     items: [ { sku, size, qty, unit_price, extension, color, desc } ],
     kind: 'goods' | 'decoration', warnings: []
   }
   ```
2. **Dedup**: `_docAlreadyApplied(doc_number)` drops invoices already on the Portal.
3. **PO match**: the bill's `po_number` is matched, in order, against
   `submittedBatches` → `invPOs` → `sos[].deco_pos[]` → `sos[].items[].po_lines[]`.
4. **Review UI** (`billImport` state, step `upload → review`): triage banner, PO
   match card, editable line items, manual match wizard, AI reconcile pass.
5. **Push to Portal**: `applyBillToSO()` writes billed quantities, cost, tracking
   and freight onto the matched record.
6. Optional **Push to QuickBooks** (`pushBillsToQB → qb-api`).

The **Billed tracking section** is the **Tracking tab → "Inbound (Purchase
Orders)"** block in `src/OrderEditor.js` (≈ lines 5038–5119). It is backed by the
`so_item_po_lines` table:

| Column (so_item_po_lines) | Meaning |
|---|---|
| `billed` (jsonb `{size: qty}`) | units the supplier has billed, per size |
| `tracking_numbers` (jsonb) | tracking numbers from the bill |
| `_bill_cost` (runtime) | accumulated actual cost from bills |
| `_bill_details` (runtime `[{doc,date,sizes,tracking,cost}]`) | per-bill audit trail |

Decoration POs carry the same fields on `sales_orders.deco_pos[]`. The Tracking
tab renders **SIZE · ORDERED · BILLED · RECEIVED · SHIPMENTS** plus **Total
Merchandise Billed / Inbound Freight / Total Inbound Cost**. The Items tab also
shows a **Billed** column and an "all billed" chip.

**Key fact:** today, supplier bills are *not* stored in their own table — their
effect is written onto the SO/PO records, and a 200-row history lives in browser
`localStorage` (`nsa_saved_bills`). The API path will add a real shared table (see
below) so the inbox is the same for everyone, not per-browser.

---

## What the SportsLink API gives us

`GET https://api.sportsinc.com/dealers/documents/` — Auth via `X-API-KEY` header.

**Filtering we'll use:** `poNumber`, `siDocNumber`, `supplierDocNumber`,
`siDocStartDate/siDocEndDate`, `active=true`, `lines=true`,
`excludeScannedDocuments`, `moveToHistorical`, plus paging (`page`, `pageSize`,
max **1000/call**) and `orderBy`.

**Document fields** (per invoice): `poNumber`, `siDocNumber`, `siDocDate`,
`supplierDocNumber`, `supplierDocDate`, `shipDate`, `dueDate`, `supplier`,
`trackingNumber`, `carrier`, `merchandiseTotal`, `freightAmount`,
`freightAllowance`, `siUpcharge`, `svcHandleCharge`, `salesTax`, `exciseTax`,
`docTotal`, `isCredit`, `supplierAddress{}`, `shippingAddress{}`, and `lines[]`.

**Line items** (`lines[]`): `supplierItemNumber`, `upc`, `quantityShipped`,
`quantityOrdered`, `quantityBackOrdered`, `unit`, `listPrice`, `discountPercent`,
`netPrice`, `extension`, `size`, `color`, `description`.

**Status control:** `PATCH dealers/documents/status` with
`{ siDocNumbers:[...], isActive:false }` moves documents to "Historical" in the SI
Invoice Center — our "mark as imported" lever.

### Two hard constraints from the docs (read these twice)

1. **Line items exist for EDI documents only.** OCR/scanned documents return
   header **totals** (`merchandiseTotal`, `docTotal`, `freight`…) but **no
   `lines[]`** — so they cannot populate the *size-level* Billed columns. Use
   `lines=true`; treat `lines`-less docs as **header-only** (cost + freight land
   at the PO level, flagged "no line detail — verify"). This is the single biggest
   reason the PDF path stays as a fallback.
2. **Do not pull before 10:30am EST** — SI's nightly processing must finish first.
   Our cron runs late-morning UTC accordingly.

---

## The join key: `poNumber`

`poNumber` (the **Dealer PO Number**) is what ties a SportsLink document to one of
our orders — and it's the *same* value our existing matcher keys on
(`po_lines[].po_id`, batch `po_number`, `deco_pos[].po_id`). If the PO we send
Sports Inc round-trips back unchanged, **auto-match just works** and the bill lands
on the right SO with zero human effort.

> ⚠️ **Make-or-break validation (Phase 0):** confirm the exact PO string SI
> returns vs. what we store. Our matcher already tolerates a `PO` prefix and
> prefix-matches (`_normalizeDecoPO`, `po_id.startsWith(poLc)`), but if SI strips
> or reformats the PO, we tune the adapter's normalization here once and the whole
> thing clicks. Pull ~20 real documents and eyeball `poNumber` against live SOs
> **before** building anything else.

---

## Adapter: SportsLink document → existing parsed-bill object

The entire integration hinges on `mapSportsLinkDocToBill(doc)` (new, in
`src/vendorApis.js`). It is a pure data shimmer — no new billing logic:

| SportsLink field | → parsed-bill field | Notes |
|---|---|---|
| `poNumber` | `po_number` | join key; normalize like `_normalizeDecoPO` |
| `siDocNumber` | `si_doc_number` + **idempotency key** | integer, globally unique in SI |
| `supplierDocNumber` | `doc_number` / `supplier_doc_number` | invoice # staff & QB recognize* |
| `supplier` | `supplier` → `vendor` | real vendor (adidas, Nike…) mapped to our vendor list |
| `supplierDocDate` / `siDocDate` | `doc_date` | |
| `dueDate`, `shipDate` | `due_date`, `ship_date` | |
| `trackingNumber` | `tracking` | EDI only |
| `merchandiseTotal` | `merchandise_total` | |
| `freightAmount` (− `freightAllowance`) | `freight` | net inbound freight |
| `siUpcharge`, `svcHandleCharge` | `si_upcharge` (+ handling) | landed-cost adders |
| `docTotal` | `doc_total` | reconciliation check |
| `isCredit` | `is_credit` | **new** — negative/credit handling |
| `lines[].supplierItemNumber` | `items[].sku` | reuse CUSTOM/style token matching |
| `lines[].upc` | `items[].upc` | extra match signal |
| `lines[].size` / `color` | `items[].size` / `color` | runs through existing `_alignSize` |
| `lines[].quantityShipped` | `items[].qty` | billed = shipped |
| `lines[].netPrice` | `items[].unit_price` | |
| `lines[].extension` | `items[].extension` | |
| `lines[].description` | `items[].desc` | |

\* *Phase-0 check:* confirm whether today's PDF `doc_number` corresponds to SI's
`siDocNumber` or `supplierDocNumber`, and set the adapter so `_docAlreadyApplied`
keeps recognizing bills applied before the cutover (no double-billing across the
switch). We key the new table on `siDocNumber` regardless.

Because the output is byte-for-byte the shape `applyBillToSO()` already consumes,
**the Billed tracking section needs no changes at all** — billed qty, `_bill_cost`,
`_bill_details`, tracking and freight flow into `so_item_po_lines` (and batch/deco
POs) exactly as they do for PDFs today.

---

## New data model — `si_documents` table (Supabase)

The shared backing store for the inbox (replaces per-browser localStorage on the
API path). One row per SportsLink document, deduped by `si_doc_number`:

```sql
si_documents (
  si_doc_number      bigint PRIMARY KEY,   -- SportsLink siDocNumber (idempotency)
  supplier_doc_number text,                -- supplier invoice #
  po_number          text,                 -- dealer PO (join key) — indexed
  supplier           text,                 -- real vendor (adidas, Nike, …)
  si_doc_date        date,
  supplier_doc_date  date,
  ship_date          date,
  due_date           date,
  tracking_number    text,
  merchandise_total  numeric,
  freight_amount     numeric,
  si_upcharge        numeric,
  svc_handle_charge  numeric,
  sales_tax          numeric,
  doc_total          numeric,
  is_credit          boolean default false,
  has_lines          boolean default false, -- EDI (true) vs scanned/header-only (false)
  raw                jsonb,                 -- full API document (re-parse / audit)
  match_status       text default 'unmatched', -- 'unmatched' | 'matched' | 'multi'
  matched_so_ids     jsonb default '[]',    -- SO ids the PO resolves to
  portal_status      text default 'new',    -- 'new' | 'reviewed' | 'applied' | 'ignored'
  applied_at         timestamptz,
  applied_by         text,
  si_historical      boolean default false, -- mirrors SI Active/Historical
  first_seen_at      timestamptz default now(),
  updated_at         timestamptz default now()
)
```

`portal_status` is the lifecycle the inbox filters on; `si_historical` mirrors the
state back in SI's Invoice Center so the two systems agree on "imported."

---

## Backend — three Netlify functions (mirrors our other vendor integrations)

All vendor APIs already go through Netlify proxies (`*-proxy.js`) gated by
`verifyUser`/`verifyUserOrInternal` in `_shared.js`, with secrets in env vars and
daily cron+background pairs registered in `netlify.toml`. SportsLink follows suit:

1. **`netlify/functions/sportslink-proxy.js`** — staff/internal-gated passthrough.
   Reads `SPORTSLINK_API_KEY`, forwards `GET`/`PATCH` to `SPORTSLINK_API_BASE_URL`
   with the `X-API-KEY` header, returns the body. Used for the manual "Refresh"
   button and by the background job (via `X-Internal-Secret`).
2. **`netlify/functions/sportslink-sync-cron.js`** — scheduled trigger (template
   identical to `richardson-sync-cron.js`). Fires the background job.
   `netlify.toml`: `schedule = "30 16 * * *"` (≈ 11:30 EST / 12:30 EDT — safely
   after the 10:30 EST cutoff, after the existing morning syncs).
3. **`netlify/functions/sportslink-sync-background.js`** — pulls
   `dealers/documents/?active=true&lines=true` (paged, ≤1000), **upserts** each
   into `si_documents` keyed on `si_doc_number`, resolves PO match
   (`match_status`/`matched_so_ids`), and leaves rows `new` for review. Does **not**
   move documents to historical here.

**Env vars (Netlify UI):** `SPORTSLINK_API_KEY`,
`SPORTSLINK_API_BASE_URL=https://api.sportsinc.com/`.

**Front-end callers (`src/vendorApis.js`):** `sportsLinkGetDocuments(filters)`,
`sportsLinkSetStatus(siDocNumbers, isActive)`, and `mapSportsLinkDocToBill(doc)`.

---

## Idempotency / two-way sync (so nothing doubles or disappears)

- Cron pulls `active=true` → SI's "Active" tab == **"not yet imported by us."**
- Upsert on `si_doc_number` → re-pulling the same doc never creates a duplicate.
- We **don't** auto-`moveToHistorical` on pull (premature historical = lost
  document). A doc moves to historical **only after** it's been applied in the
  Portal: on successful `applyBillToSO`, set `portal_status='applied'` then
  `PATCH dealers/documents/status {siDocNumbers:[…], isActive:false}`.
- Belt-and-suspenders: the existing `_docAlreadyApplied()` still guards against
  re-applying onto a PO line that already carries that doc in `_bill_details`.

---

## The workflow — "Sports Inc Inbox" (see every item coming in)

A new sub-view in the existing Bills area (`billView` gains a `'sportsinc'` tab
next to `import` / `later`). It reads `si_documents` so the whole team sees the
same list. Daily rhythm:

1. **Morning auto-pull.** Cron loads every active SI document into the inbox. No
   one has to do anything for items to appear.
2. **Scan the inbox.** One row per document:
   `Supplier · Invoice# · PO# · Date · Merch $ · Freight $ · Doc Total · Match`,
   with a status pill. Filters across the top: **New · Matched · Needs PO ·
   Credits · No line detail · Applied.** This is the "see clearly all items coming
   in" view.
3. **Green rows (matched + EDI lines)** → **"Apply"** (or **"Apply all matched"**).
   Behind the button it runs the existing adapter → `billImport.parsed` →
   `applyBillToSO`, so billed qty/cost/tracking/freight land on the SO's **Billed
   tracking**. Row flips to `applied`; the doc is pushed to Historical in SI.
4. **Amber rows (no PO / over-billing / no line detail)** → click opens the **same
   review screen + manual match wizard** used for PDFs. Header-only docs apply
   cost/freight and are flagged "verify against PDF" since they carry no sizes.
5. **Credits (`isCredit`)** → shown distinctly; apply as negative cost (Phase 3).
6. **Optional QuickBooks push** reuses `pushBillsToQB` unchanged.

End state on the order: open the SO → **Tracking → Inbound (Purchase Orders)** and
the **BILLED** column, `_bill_details` history, tracking links and **Total
Merchandise Billed / Inbound Freight** are populated automatically — identical to
the PDF path, just without anyone touching a PDF.

---

## Step-by-step implementation

**Phase 0 — Validate (no code).**
- Email `mhoerner@hq.sportsinc.com` for the API key.
- `curl` ~20 live documents; eyeball `poNumber` vs. our SO PO ids; note EDI-vs-OCR
  ratio (how many carry `lines[]`); confirm `doc_number` lineage for dedup.
- Decide auto-apply policy (manual-confirm first is safest).

**Phase 1 — Prove the matching (thin slice, highest value fastest).**
- `sportslink-proxy.js` + env vars.
- `sportsLinkGetDocuments()` + `mapSportsLinkDocToBill()` in `vendorApis.js`.
- A **"Pull from Sports Inc"** button in the Bills view that maps documents into
  `billImport.parsed` and drops into the **existing review screen**. Push to Portal
  and confirm the **Billed tracking** populates. *No new table yet — reuse the
  in-memory/localStorage path.* This validates matching end-to-end against the real
  Billed columns.

**Phase 2 — The shared inbox + automation.**
- `si_documents` migration.
- `sportslink-sync-cron.js` + `sportslink-sync-background.js`; register cron in
  `netlify.toml`.
- "Sports Inc Inbox" sub-view (list, filters, Apply / Apply-all-matched).
- Two-way historical sync on apply.

**Phase 3 — Polish.**
- Auto-apply clean matches (cron applies green EDI rows, parks the rest).
- `isCredit` handling (negative cost / QB credit memo).
- `svcHandleCharge` / `freightAllowance` landed-cost handling.
- QuickBooks wiring from the inbox.
- Alerts (e.g. so-health-style email) for documents unmatched > N days or
  over-billing a PO.

---

## Edge cases & risks to design for

- **EDI vs OCR** — header-only docs can't fill size-level Billed; flag, don't fake.
- **PO format drift** — the Phase-0 validation; one normalization point.
- **Multi-SO / batch POs** — already handled by `_applyBillToBatchSOs`; the adapter
  feeds the same matcher.
- **Credits** — `isCredit` must subtract, not add.
- **Cost adders** — decide whether `siUpcharge`/`svcHandleCharge` fold into unit
  cost, freight, or a landed-cost field (affects GP math at `App.js` ~15835).
- **Timing & paging** — cron after 10:30 EST; page through > 1000 docs.
- **Premature historical** — only mark imported after a durable apply.
- **Cutover dedup** — don't re-bill invoices already applied from PDFs.

---

## Why this is low-risk

The new code is a **data adapter + a list view + a cron** — all modeled on
patterns already in the repo (six vendor proxies, daily cron/background pairs,
`verifyUser` gating). The billing brain — matching, reconciliation, the Billed
tracking writes — is **reused untouched**, so the part that matters most to your
books behaves exactly as it does today, only fed automatically.

---

## Phase 0 — Live API validation log (2026-06-23)

Validated the issued dealer key against `GET dealers/documents/` (read-only — no
document statuses were changed).

- **Connection:** ✅ 200 OK. The account holds **28,857 documents**.
- **Coverage is the whole distributor-routed book, not just "Sports Inc."** A
  200-doc sample spanned **21 suppliers**: ADIDAS US TEAM SERVICES (~66%), SANMAR,
  S&S ACTIVEWEAR, AUGUSTA SPORTSWEAR, AGRON, STAHLS, RICHARDSON, AVERY DENNISON,
  CHAMPRO, MV SPORT, UNDER ARMOUR, MOLTEN, RAWLINGS… One API covers a large
  majority of supplier bills.
- **Line-item detail (EDI vs scanned):** every doc carries a `lines` array, but
  scanned/OCR documents put a single zero-qty `SEE VENDOR INVOICE FOR DETAIL`
  placeholder there instead of real lines. The real split shows in `totalCount`:
  **23,299 EDI documents** (with usable lines) of **28,857 total** (~81% EDI,
  ~19% scanned). The pull uses **`excludeScannedDocuments=true`** so only the EDI
  docs come in; scanned ones (notably **S&S Activewear**) stay on the manual PDF
  parse — per team workflow.
- **Cost tie-out:** ✅ `merchandiseTotal + freightAmount + siUpcharge == docTotal`
  on every non-credit doc. `siUpcharge` is a small SI fee (~0.8%);
  `svcHandleCharge`/`salesTax` absent in the sample. The adapter maps these exactly.
- **Document identity:** `siDocNumber` = 8-digit stable SI key; `supplierDocNumber`
  = the supplier's invoice number (our dedup key). Confirmed distinct.
- **PO format:** free-text with the real PO embedded amid prefixes/suffixes and
  inconsistent spacing — `PO 3332 CIVB`, `PO8602 CSFB REP`, `DPO 3239 TLL`,
  `NSA 4519`, `PO8635EXPRESSMM`, `3177 OLUSPL`. The PDF parser stores this **same**
  string (`App.js:23470`) and matching normalizes whitespace on both sides, so API
  bills match **at parity** with PDFs. ~0.5% had a blank PO (Sports Inc's own
  service charges — no PO; these correctly fall to manual review).
- **Per-supplier line quality** (drives how often auto-match needs help):
  - **adidas** — clean: `supplierItemNumber` + `upc` + `size` (color in description).
  - **SanMar** — clean: `supplierItemNumber` + `size` + `color` (no upc).
  - **S&S Activewear** — weak: empty `supplierItemNumber`, no `size`/`color` →
    leans on AI reconcile / manual match.
  - **Richardson** — style in `supplierItemNumber` (size embedded), `upc`, no size.
- **Credits (`isCredit`)** come back **already negative** (e.g. merch −13.12,
  docTotal −28.35) and may print "SEE VENDOR INVOICE FOR DETAIL" with a
  zero-extension line. The adapter passes negatives through and flags credits for
  manual review; the line-vs-merch mismatch is expected on these.

**Verdict:** viable and high-coverage. Manual-confirm + AI reconcile is the right
posture given the per-supplier line variance. Remaining unknowns are confirmation
items (older-doc line coverage, exact credit convention, historical-flag etiquette,
timing/DST, rate limits) — see the questions sent to Sports Inc.

---

## Phase 2 — Dedicated accounting queue (finalized design)

A dedicated **"Sports Inc Bills"** tab under Supplier Bills, backed by the shared
`si_documents` queue (migration `00147`), so all of accounting sees the same list
and approval history. The queue is the **single source of truth for every supplier
document Sports Inc has for us** — nothing slips through.

**Two paths, by what the document actually carries** (not just the supplier list):

- 🟢 **EDI / auto** — real line items → matched to the PO, AI-reconciled (same
  `ai-bill-matcher` as the parse), shown ready for accounting to **approve**.
- 🟡 **OCR / manual** — header totals only, **no PDF over the API** → shown as a
  **"Grab from Sports Inc"** worklist (supplier, SI doc #, invoice #, PO, total) so
  the team pulls the PDF from the SI Invoice Center and runs it through the existing
  parser. The row clears when that doc# lands → **completeness reconciliation**.

**Supplier routing.** National Sports' EDI/OCR list (22 EDI suppliers / 252 OCR)
seeds `supplier_method` as the *expectation*, but the **actual route follows the
line data** (`has_usable_lines`). So when **S&S Activewear flips to EDI** (coming,
not yet), it auto-promotes to the approve flow with no code change; the list just
flags surprises both ways. The EDI set lives in `src/sportsLink.js`
(`SI_EDI_SUPPLIERS`).

**Two-step approval, phased to QuickBooks.** Bills land **matched but pending** —
nothing auto-applies. Accounting reviews, then clicks **Approve**, which writes to
the SO **Billed tracking** and stamps `resolved_by` / `resolved_at`. **QuickBooks
is held off** for now (its own button, as today); the "approve also pushes QB"
behavior sits behind a single flag so going live later is a one-line flip.

**Lifecycle (`si_documents.status`):**

| status | meaning | counts as captured? |
|---|---|---|
| `pending` | EDI, **matches a portal PO**, AI-reconciled, awaiting approval | no |
| `manual_pending` | OCR, matches a portal PO, on the "grab from Sports Inc" worklist | no |
| `review` | **no portal PO match** — likely pre-portal; needs a human look | no |
| `approved` | EDI applied to the Billed tracking (who/when stamped) | ✅ |
| `manual_done` | OCR PDF was grabbed + parsed + applied (auto-detected by doc#) | ✅ |
| `outside_portal` | confirmed pre-portal / not ours — billed via NetSuite→QB | ✅ |
| `ignored` | intentionally skipped (e.g. an SI service charge handled elsewhere) | ✅ |

**Pre-portal POs (Outside of Portal).** Sports Inc's history predates the portal, and
some bills reference POs that live only in NetSuite→QuickBooks. Two guards keep those
out of the Billed tracking without losing sight of them:
1. **Date cutover** — the sync only pulls documents on/after a configured portal
   cutover date (`siDocStartDate`), so the queue isn't flooded with years of
   pre-portal history.
2. **"Outside Portal — review" section** — any post-cutover document whose PO doesn't
   match a portal PO lands here (🔵). Accounting either fixes a typo'd PO (it moves
   into the approve/grab flow) or clicks **"Outside of Portal"** (`outside_portal`) —
   seen, acknowledged, handled by NetSuite→QB, and cleared from the active worklist
   while staying auditable. **Approve is disabled for these**, so they can never hit
   the Billed tracking by accident.

**Sync.** A daily background job (`sportslink-sync-background` + `-cron`, after the
10:30 EST cutoff) pulls **all active** documents and **upserts** them into the
queue by `siDocNumber`, **never clobbering** a human decision (`status`/`resolved_*`).
A manual "Pull now" does the same on demand. PO matching + AI run in the browser
(reusing the proven logic) when the queue renders.

**Completeness dashboard.** Header counts: *N pending · M to grab from Sports Inc ·
K captured* over a date range, so accounting can confirm at a glance that every
Sports Inc document for the period is accounted for.

**Build status:** adapter classification + `si_documents` migration done; the sync
functions and the dedicated tab/approval UI are the next increment.
