# Sales Workflow & Sales Tools Guide

> **Audience:** Sales reps, CSRs, and sales managers working in the NSA Portal.
> **Purpose:** Document the full end‑to‑end sales workflow, the options available at
> each step (including **assigning player names & numbers**), and the sales
> functions/features available — plus a set of recommended enhancements.
>
> This guide describes the portal **as it works today**. Sections explicitly
> labeled **"Recommended enhancement"** are proposals, not current behavior.

---

## 1. Where sales work lives in the portal

The left navigation is grouped into sections. The pages a rep touches most are in
the **Overview**, **Sales**, and **Analytics** groups:

| Section | Page | What it's for |
|---|---|---|
| Overview | **Dashboard** | Your daily cockpit: open estimates, active SOs, active jobs, unread messages & @mentions, follow‑up reminders |
| Overview | **Messages** | Internal threads tied to customers/orders, with @mentions |
| Sales | **Estimates** | Quotes / proposals to customers (the start of every deal) |
| Sales | **Sales Orders** | Confirmed orders that go into production |
| Sales | **Invoices** | Billing, payments, credits, promo dollars |
| Sales | **OMG Stores** | Online team stores (OMG) — order aggregation |
| Sales | **Webstores** | Club / team webstores with name‑&‑number products |
| Sales | **Sales Tools** | Quoting / pricing helper utilities |
| Sales | **Sales History** | Read‑only search across historical NetSuite transactions (SOs, invoices, credit memos) |
| Analytics | **Reports** | Reports & analytics |
| Analytics | **Commissions** | Per‑rep commission calculation (visible to `admin` and `rep`) |
| People | **Customers** | Customer records, contacts, terms, price levels |

Other groups (**Production**: Jobs, Art, Prod Board, Warehouse, Purchase Orders,
Batch POs; **Catalog**: Products, Inventory) are mostly downstream of sales but a rep
will glance at Jobs/Art to track an order's progress.

### Roles & what each can see

Page access is role‑gated. The relevant sales roles:

- **`rep`** — full sales surface: Dashboard, Estimates, Orders, Invoices, OMG,
  Customers, Messages, Commissions, Reports, Products, Art, Sales Tools, Sales
  History, Import.
- **`csr`** — customer‑service flavor: Dashboard, Estimates, Orders, Invoices,
  Customers, Messages, Products, Inventory, Sales Tools, Sales History, Import.
- **`accounting`** — Dashboard, Invoices, Customers, Reports, QuickBooks, Import.
- **`admin`** — everything, including Settings and the per‑invoice commission
  overrides.

If you land on a page you can't access you'll see an **Access Denied** card with a
button back to your first allowed page.

---

## 2. The big picture — the sales pipeline

```
  ┌─────────┐    ┌───────────┐    ┌──────────────┐    ┌────────────┐    ┌──────────┐    ┌────────────┐
  │ Customer│ →  │ Estimate  │ →  │ Sales Order  │ →  │ Production │ →  │ Invoice  │ →  │ Commission │
  │  (lead) │    │ (quote)   │    │ (confirmed)  │    │ Jobs/Art   │    │ & Payment│    │  (paid)    │
  └─────────┘    └───────────┘    └──────────────┘    └────────────┘    └──────────┘    └────────────┘
                 draft→sent→         convert from         art approval     open→paid       30% / 15% of
                 approved            estimate, take        → pick → ship                    gross profit
                                     deposit
```

Two entry lanes feed the **Sales Order** stage:

1. **Direct / custom orders** — rep builds an Estimate, customer approves, it
   converts to a Sales Order. This is the main lane and the focus of this guide.
2. **Online stores** — an **OMG Store** or **Webstore** collects many individual
   buyers (e.g. a whole team ordering jerseys with their own name & number); the
   store's orders roll up into Sales Orders automatically.

---

## 3. Step‑by‑step workflow (with options at each step)

### Step 0 — Start your day on the Dashboard

The Dashboard gives clickable stat cards that jump straight into a filtered view:

- **Open Estimates** → Estimates filtered to `status: open`, `rep: me`.
- **Active SOs** → Orders filtered to active (not complete), `rep: me`.
- **Active Jobs** → Jobs board filtered to your in‑flight production.
- **Unread Msgs / @ Mentions** → Messages filtered to unread or mentions.

Below the stats is a **follow‑ups / notifications** feed: estimate update requests,
estimate approvals, deposit‑needed reminders, invoice follow‑ups, and art
approvals — each row deep‑links to the relevant estimate/order/invoice.

> **Options here:** click any stat card to filter, click any notification to open
> the record, or use global Search.

---

### Step 1 — Find or create the customer

Go to **Customers** (or **+ New Customer** from the dashboard).

**Options when creating/editing a customer:**

- **Name & type** — organization (club, school, team, business) vs. individual.
- **Parent / child relationship** — a parent org (e.g. a club) with child teams.
- **Contacts** — multiple contacts, each with name + email (these emails become the
  default recipients when you email estimates or send a roster link).
- **Terms / price level** — drives default pricing on that customer's quotes.
- **Tax** — taxable vs. exempt.
- **Assigned rep / owner** — who owns the account (used for the `rep` filters and
  commission attribution).
- **Credits & promo dollars** — store credit and promo balances that can be applied
  on invoices later.

> **Tip:** search Customers before creating — the portal supports fuzzy search so
> you don't create duplicates.

---

### Step 2 — Create an Estimate (the quote)

Go to **Estimates → New Estimate** (or start one from the customer record). An
estimate opens in the **Order Editor** in estimate mode.

#### 2a. Add line items — several ways

- **Catalog search** against connected vendors — SanMar, S&S (SanMar/SS APIs),
  Momentec, Richardson — pulls live product info, pricing, and inventory by
  SKU/style.
- **Products** already in your local catalog.
- **Manual / custom line** — type your own SKU, description, and price for
  one‑offs.

#### 2b. Enter quantities & size runs (the first kind of "numbers")

Each apparel line has **per‑size quantities** (XS, S, M, L, XL, 2XL, 3XL, 4XL, and
tall sizes LT–3XLT). You type a quantity into each size cell; the line total and
extended price roll up automatically. Size breaks (e.g. 12 / 24 / 48) can move the
unit price into a cheaper tier.

#### 2c. Add decoration

For each item you can attach one or more **decorations**:

- **Embroidery** — priced by stitch count × quantity tier.
- **Screen print** — priced by color count × quantity tier (+ upcharges such as
  underbase, fleece, mesh).
- **DTF** — priced by size category × quantity tier.
- **Outside decoration** — sent to a deco vendor via a Deco PO (vendor pricing can
  pre‑fill the cost).
- A decoration can also be a **name & number** decoration — this is what unlocks the
  roster / "assign numbers" controls described in **Section 4**.

Each decoration carries its own **location** (left chest, full back, etc.),
**art/logo**, and **cost vs. charge** so margin is tracked per decoration.

#### 2d. Pricing options

- **Price level** inherited from the customer, overridable per line.
- **Margin / markup** controls — set a target margin and let the price compute, or
  type a price directly.
- **Promo dollars** — apply promotional credit.
- **Discounts**, **setup fees**, **shipping**, and **tax**.

#### 2e. Estimate status & sending

An estimate moves through statuses:

- **`draft`** — you're still building it.
- **`sent`** — emailed to the customer (recipients default to the customer's
  contacts). The customer can request changes or approve.
- **`approved`** — customer accepted; ready to convert to a Sales Order.

> **Options here:** Save draft · Email to customer · Duplicate estimate · Request
> deposit · Convert to Sales Order (after approval).

---

### Step 3 — Convert the approved estimate to a Sales Order

Once an estimate is **approved**, convert it to a **Sales Order (SO)**. The SO
carries over all items, sizes, decorations, and pricing. At this point you typically:

- **Collect a deposit** (the "deposit needed" reminder fires on the dashboard until
  it's handled).
- Confirm **ship date / in‑hands date**.
- Lock the **roster deadline** if name & numbers are required (Section 4).

> **Options here:** Convert to SO · Copy SO · Revert to Estimate · Set job link
> group (so multiple SOs share one production job).

---

### Step 4 — Build the order: **adding player names & numbers (rosters)**

This is the "adding numbers" workflow, and it lives on each **name/number
decoration** of an item inside the Order Editor.

Each such decoration shows an **📋 Assign Numbers (filled/total pcs)** button. The
roster grid is laid out **by size**: for every size with a quantity, you get that
many slots, each slot taking a **Number** and an optional **Name**.

**Your options for filling a roster:**

| Option | What it does |
|---|---|
| **Type directly** | Enter each player's number (and name) by size, slot by slot. The button shows live progress, e.g. *Assign Numbers (11/18 pcs)*. |
| **📥 Download Template** | Exports a `Size,Number,Name` CSV pre‑expanded to the exact size quantities — hand it to a coach to fill offline. |
| **📤 Upload Roster** | Drag‑and‑drop / pick a filled CSV. It maps the `Number` and `Name` columns (the name column also accepts the header `Player`) back onto the size slots. |
| **Email the coach a link (Roster Send)** | Sends the coach a **Roster Number Assignment** email (via Brevo) with a link. Recipient defaults to a customer contact (or enter a custom address), and you set the coach's name. The link encodes the SO, item, color, and sizes, plus your rep name/email, so the coach fills it in remotely and it flows back to the order. |
| **Auto‑fill numbers** | Quick‑populate sequential numbers (0–99) across the slots, or a **basketball** preset that uses standard basketball numbering. Useful for placeholders. |
| **Copy from another decoration** | If the same player numbers apply to another item on the order, copy the roster across with one click (*"Numbers copied from SKU"*). |
| **Clear** | Wipe the roster and start over. |

**Name upcharge:** items/products can be flagged `takes_number` / `takes_name` with
an optional **name upcharge** — when a buyer adds a custom name, the configured
upcharge is added automatically (this is how webstore name/number products price the
extra).

> **Practical flow:** set sizes & quantities first (the roster can't lay out slots
> until it knows the size breakdown — you'll see *"Add sizes above first"* if you
> haven't). Then either fill the roster yourself, email the coach the link, or send
> the CSV template and upload it when it comes back.

---

### Step 5 — Decoration art & approval

- Art is attached per decoration; the order flows to the **Art Dashboard**.
- Art statuses include *waiting for art → art in progress → waiting approval →
  approved*. Customer art‑approval requests and approvals surface as dashboard
  notifications.
- Reps mostly **watch** this stage and nudge the customer for approval, but can
  request art and message the artist via the order's message thread.

---

### Step 6 — Purchase Orders & sourcing

From the order you can generate:

- **Blank goods POs** to garment vendors (SanMar, S&S, Richardson, Momentec, etc.).
- **Deco POs** for outside decoration — select which items go to which deco vendor;
  vendor pricing can **pre‑fill unit costs**. Items on a deco PO get a purple **DPO**
  badge.
- **Batch POs** — consolidate many SOs' needs into one vendor PO via the Batch PO
  queue.

> **Options here:** create PO · pick which items/sizes to include · auto‑fill costs
> from vendor pricing · override costs · track received quantities.

---

### Step 7 — Production, pick & ship

- **Jobs** / **Production Board** track the order through staging, in‑process, and
  completion.
- **Warehouse** handles picking (`pick → pulled → completed`) against on‑hand
  inventory.
- **Shipping** integrates with **ShipStation**; ship status (`shipped`) and tracking
  flow back onto the order.

A rep monitors these via the dashboard's *Active Jobs* card and the order's status,
stepping in when the customer asks for an update.

---

### Step 8 — Invoice & payment

- Convert the SO to an **Invoice**; invoice status moves **`open → paid`** (also
  `billed` / `closed` for historical NetSuite records).
- Apply **customer credits** and **promo dollars**.
- **Credit memos** handle returns/adjustments.
- Invoice **follow‑up** reminders appear on the dashboard until paid.

---

### Step 9 — Commission

The **Commissions** page computes rep commission from paid invoices.

**Commission policy (as configured in the portal):**

> 30% of **gross profit** on invoices paid **within 90 days** of the invoice date.
> **15%** on invoices paid **after 90 days** (a 50% penalty). An admin can restore
> the full 30% on any late invoice, or set a **custom rate per invoice** via
> *Edit %*.
>
> **Gross profit = Revenue − Product Cost − Decoration Cost − Outbound Shipping −
> Inbound Freight.**
>
> **Promo orders:** costs from promo orders (product, decoration, shipping) are
> deducted from monthly commission, since they represent real cost with no customer
> revenue.

> **Options here (admin):** restore full rate on a late invoice · set a custom rate
> per invoice · review monthly totals per rep.

---

## 4. The online‑store lane (OMG Stores & Webstores)

When a whole team/club orders individually — each buyer picking their own size,
**name, and number** — use a store instead of one big manual order:

- **OMG Stores** — aggregate many individual orders into a roll‑up SO.
- **Webstores** — club/team storefronts. Products can be flagged `takes_number` /
  `takes_name` with a **name upcharge**; the buyer enters their own number & name at
  checkout, so the roster builds itself. Stores support bundles, coupons, shipping
  margins, transfers, and ShipStation fulfillment.

The rep's job is to **set up the store** (products, name/number flags, pricing,
open/close dates), then let orders accumulate and convert to production.

---

## 5. Sales functions & features reference

| Feature | Where | What it gives the rep |
|---|---|---|
| **Estimates / quotes** | Estimates | Build, price, send, and track quotes (draft → sent → approved). |
| **Order Editor** | Orders | One screen for items, sizes, decorations, rosters, pricing, POs, art, shipping. |
| **Roster / Assign Numbers** | Order Editor | Type / template / upload / email‑to‑coach / auto‑fill / copy player names & numbers. |
| **Vendor catalog search** | Order Editor | Live SanMar / S&S / Momentec / Richardson product, price, inventory lookups. |
| **Pricing & margin tools** | Order Editor, Sales Tools | Price levels, margins, promo dollars, discounts. |
| **Deco POs & Batch POs** | Orders, Batch POs | Source blanks & outside decoration with cost pre‑fill. |
| **OMG & Webstores** | OMG, Webstores | Online team stores with self‑service name/number. |
| **Invoices, credits, promo dollars** | Invoices | Billing, store credit, promotional balances. |
| **Commissions** | Commissions | Automatic gross‑profit commission with admin overrides. |
| **Sales History** | Sales History | Fast search across historical SOs / invoices / credit memos (NetSuite import). |
| **Messages & @mentions** | Messages | Internal collaboration tied to customers/orders. |
| **Tasks / follow‑ups** | Dashboard | Assigned to‑dos, deposit/art/invoice reminders, estimate follow‑ups. |
| **Reports** | Reports | Sales analytics. |

---

## 6. Recommended enhancements

The portal already covers a lot of ground; these proposals tighten the four areas
called out for sales. Each notes **what exists today** vs. **the gap**.

### 6.1 Quote → Order pipeline

- **Today:** estimates carry `draft / sent / approved`; the dashboard surfaces
  estimate follow‑ups and approvals.
- **Gaps & proposals:**
  - Add **`expired`** and **`lost`/`won`** statuses with a **quote validity /
    expiry date** so stale quotes auto‑flag for follow‑up.
  - A **lost‑reason** dropdown (price, timing, competitor, no response) for win/loss
    reporting.
  - A **pipeline / kanban view** of estimates by status with $ value per column, so
    a rep sees their funnel at a glance.
  - **Auto follow‑up reminders** at configurable intervals after `sent` (e.g. +3 /
    +7 days) instead of only manual follow‑ups.

### 6.2 Rep attribution & commission

- **Today:** customers/orders carry an owner/`created_by`; `rep: _me_` filters exist
  across Estimates/Orders/Jobs; the Commissions page computes 30%/15% of gross
  profit with per‑invoice overrides.
- **Gaps & proposals:**
  - **Split commissions** — allow two reps to share an order (e.g. 70/30) for
    team‑sold deals.
  - **House / unassigned account** handling and bulk **reassignment** when a rep
    leaves.
  - A **per‑rep commission statement** export (PDF/CSV) per month.
  - **Forecasted commission** on open SOs (not just paid invoices) so reps see
    pipeline earnings.

### 6.3 Sales dashboard / metrics

- **Today:** dashboard stat cards (open estimates, active SOs, active jobs, unread
  msgs/mentions) and a notification feed; Reports page for analytics.
- **Gaps & proposals:**
  - A dedicated **rep scorecard**: MTD/QTD/YTD **booked vs. invoiced** revenue,
    **gross margin %**, **quote win‑rate**, **average order value**, and
    **period‑over‑period** comparison.
  - **Top customers** and **top products** for the rep, with quick re‑order.
  - **Aging**: oldest open estimates, oldest unpaid invoices, orders past their
    in‑hands date.
  - **Goal / quota tracking** with a progress bar against a monthly target.

### 6.4 Tasks & follow‑ups

- **Today:** assigned to‑dos (`assigned_todos`, `todo_comments`), `onAssignTodo` /
  `onCompleteTodo` on orders, and system reminders (deposit needed, art approval,
  invoice follow‑up, estimate follow‑up).
- **Gaps & proposals:**
  - A unified **My Tasks** list (manual to‑dos + system reminders) with **due dates**
    and **snooze**.
  - **Per‑customer activity log** (calls, emails, notes) so account history is in one
    place.
  - **Recurring reminders** (e.g. "re‑order season approaching") and a **roster
    deadline reminder** that nudges the coach automatically as the cutoff nears.

---

## 7. Quick reference — "what are my options at this step?"

| You are… | Your main options |
|---|---|
| On the **Dashboard** | Click a stat to filter · open a follow‑up/notification · search |
| Creating a **Customer** | Type, parent/child, contacts, terms, price level, tax, assigned rep, credits |
| Building an **Estimate** | Add via catalog/manual · set sizes · add decoration · set margin/promo/discount · save/send/duplicate |
| On an **approved estimate** | Convert to SO · request deposit · revert to estimate |
| **Assigning numbers** | Type · download template · upload CSV · email coach a link · auto‑fill (sequential/bball) · copy from another item · clear |
| Sourcing on an **order** | Blank PO · Deco PO (cost pre‑fill) · Batch PO · pick items/sizes · override cost |
| Setting up a **store** | OMG roll‑up or Webstore · flag takes_name/takes_number · name upcharge · open/close dates · coupons/shipping |
| Billing an **invoice** | open→paid · apply credits/promo dollars · credit memo · follow‑up |
| On **Commissions** (admin) | restore late‑invoice rate · set custom % per invoice · review monthly totals |

---

*This document reflects the portal's current sales surface plus clearly‑labeled
enhancement proposals. As features ship, update the relevant section and move items
out of "Recommended enhancements."*
