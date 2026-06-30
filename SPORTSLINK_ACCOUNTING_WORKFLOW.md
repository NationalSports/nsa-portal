# Sports Inc Bills (SportsLink API) — Accounting Workflow / SOP

**Audience:** Accounting team
**Purpose:** How supplier bills that come through Sports Inc are imported, matched,
reviewed, and approved into the portal — and what still needs to be done by hand.

> **Status (read first).** The automated engine is **live**: every morning the system
> pulls Sports Inc bills, matches them to orders, and emails accounting a digest.
> The **"Sports Inc Bills" screen** described below — where you review and approve —
> is the final piece being built and ships next. This document is the operating
> procedure for when that screen is live. Nothing in this process posts to your books
> automatically; **every bill waits for a person to approve it.**

---

## 1. The big picture (what changed and why)

Sports Inc is the buying group most of our supplier bills run through (adidas, SanMar,
Augusta, Richardson, Rawlings, and ~16 other brands). They now send us that bill data
through a direct connection (an "API"), so for those suppliers we **no longer download
and hand-key PDFs** — the bills arrive already itemized and matched to the right order.

Three things still need a person:
1. **Approving** each matched bill (nothing auto-posts).
2. **Grabbing the PDF** for suppliers Sports Inc only scans (S&S and ~250 others) — the
   connection gives us their totals but not a usable itemized bill or the PDF.
3. **Clearing pre-portal POs** (orders that predate the portal) — those are billed
   through NetSuite → QuickBooks, not here.

**What does NOT change:** the **Billed tracking** on each Sales Order (SO Tracking tab →
"Inbound / Purchase Orders") works exactly as it does today. Approving a Sports Inc bill
fills in the same Billed-by-size, cost, freight, and tracking columns you already use.

---

## 2. The daily rhythm

| When | What happens | Who |
|---|---|---|
| ~11:30 AM ET (after Sports Inc finishes its overnight processing at 10:30 AM ET) | The system pulls every **active** Sports Inc document dated on/after the portal go-live (April 1, 2026) into the **Sports Inc Bills** queue. | Automatic |
| Right after | A **digest email** goes to **accounting@nationalsportsapparel.com**: how many new bills, split into 🟢 ready to approve / 🟡 to grab / 🔵 old-system, plus any credits and the dollar total. | Automatic |
| During the day | Accounting opens the queue, works each bucket, and **approves**. | **You** |

You can also press **"Pull now"** any time to refresh the queue on demand.

---

## 3. Where you work: the "Sports Inc Bills" tab

Open **Imports → Sports Inc Bills**. At the top is a **completeness summary** for a date
range you choose, e.g.:

> **June 1–23:** 412 documents · **355 captured** · 18 to grab · 9 outside portal · **30 pending your approval**

Below it, the queue is grouped into four buckets. Work them top to bottom.

---

## 4. The four buckets and exactly how to work each

### 🟢 Bucket 1 — Ready to Approve (matched EDI bills)

These came in fully itemized and the system matched them to a portal order with high
confidence. Each row shows: **supplier · invoice # · PO · customer · $ total · match
confidence · 🤖 (if AI adjusted a label).**

**To work it:**
1. Click a row to expand. You'll see the **bill's line items beside the order** —
   sizes and quantities lined up, with any AI label fixes highlighted (e.g. the vendor
   wrote "OSFM," the order says "OSFA").
2. Confirm the supplier, PO/customer, and that the lines look right.
3. Click **Approve.** This writes the billed quantities, cost, freight, and tracking
   onto that order's **Billed tracking** and stamps your name + the date/time.
4. For a batch of clean ones, use **"Approve all high-confidence"** to clear them in one
   click.

**What "confidence" means** (so you know how hard to look):
- **High** — PO number *and* customer *and* supplier *and* items all line up. Safe to
  approve quickly; spot-check.
- **Medium** — most signals line up (e.g. customer + supplier + items, PO number off).
  Glance before approving.
- **Low / shown as candidates** — the system lists its best 1–3 guesses with the reason
  for each ("PO #3332 + Civica + 4 of 5 items"). Pick the right one, or send to Review.

> **QuickBooks:** approving posts to the **portal** only right now. The QuickBooks bill
> is still its own separate step (as today). Once we go live on the QB side, "Approve"
> will be able to do both — no change to how you work here.

---

### 🟡 Bucket 2 — Grab from Sports Inc (scanned / OCR suppliers)

For these suppliers (S&S Activewear today, plus the ~250 non-EDI brands), Sports Inc only
has a **scanned** copy — the connection gives us the header totals but **no itemized lines
and no PDF.** They **cannot** be auto-applied, so they appear here as a **to-do list of
exactly what to retrieve.** Each row shows **supplier · Sports Inc document # · invoice #
· PO · total** — everything you need to find it.

**To work it:**
1. Log into the **Sports Inc Invoice Center (SportsWeb)** and pull up that document
   (search by the Sports Inc document # or invoice #).
2. Download the PDF.
3. Bring it into the portal the **existing way**: **Imports → Upload Supplier Bills
   (PDF)**, parse, review, and push — the same process you use today.
4. When you push it, the queue **automatically checks that bill off** (it recognizes the
   document number) and moves it to **Captured**. That's how we prove nothing was missed.

> If S&S (or any supplier) later switches to the full data feed, those bills will simply
> start showing up in Bucket 1 (Ready to Approve) on their own — no action needed from you.

---

### 🔵 Bucket 3 — Outside of Portal (pre-portal / old-system POs)

**The rule:** every **portal** PO has a **space after "PO"** — `PO 3545`. The **old
NetSuite system** runs them together — `PO3454`. A no-space PO is therefore a **pre-portal
order**, and those are billed through **NetSuite → QuickBooks, not here.** The system
recognizes them and parks them in this bucket so they **never touch the portal's Billed
tracking** (which would double-bill).

**To work it:**
1. Skim the list to confirm they're genuinely old-system (the bill PO shows no space).
2. Click **"Mark Outside of Portal."** The row clears from your active worklist, stays
   fully auditable, and counts toward "captured" (i.e. accounted for).
3. Handle the actual bill in NetSuite/QuickBooks as you do today.

> This bucket exists purely so you can **see** these and confirm we're not missing any —
> not to process them in the portal.

---

### ⚠️ Bucket 4 — Needs Review (matched, but doesn't reconcile — or no PO found)

Two kinds land here:

**(a) Discrepancy — the bill doesn't match the order.**
Our rule of thumb: **the bill is the source of truth.** The supplier shipped and billed
what's real; the order may have been keyed wrong. The row shows a **side-by-side diff**,
e.g.:

> Bill: **12 × Medium** of IU2788 · Order: **10 × Medium** ordered

**To work it:**
- If the bill is right (usually), click **"Correct the order from the bill"** — it
  updates the order's quantities/sizes to match, with an audit note, then lets you
  approve. (This is also a quiet quality signal on order entry.)
- If the *bill* looks wrong (rare), leave it and flag the rep/supplier.

**(b) No portal PO found.**
The customer may exist, but that **PO number isn't in the portal** — usually a PO that
was never entered (a data-entry gap), or an order that didn't fully make it in. Example
we found in testing: a Reedley HS Volleyball bill for **PO 3281**, billed across 3 partial
shipments, where the customer exists but PO 3281 was never recorded.

**To work it:**
- If it should be a portal order: have the PO line created on that order, then it moves
  to Ready to Approve.
- If it's actually old-system/not ours: **Mark Outside of Portal.**

---

## 5. Credits / returns

Credit memos arrive **flagged** and apply as **negatives**. They show in the queue with a
↩️ marker. Review them like any other bill, confirm they tie to the right order, and
approve — the negative flows to the Billed tracking the same way.

---

## 6. "Did we get everything?" — the completeness check

Because every Sports Inc document lands in the queue, the **summary bar is your proof of
completeness.** At month-end (or any time), set the date range and confirm:

> documents in = **captured (approved + grabbed + outside-portal)** + still-open

Anything still open (pending, to-grab, or in review) is your worklist. When the open
count is zero for a period, **every Sports Inc bill for that period is accounted for.**

---

## 7. What you can expect (from a live test on real orders)

We tested the matching against real orders before launch. For bills on **portal-era
orders** (PO + space):
- **~94%** matched the correct order automatically at high confidence — quick approve.
- **~5%** flagged a **discrepancy** (bill vs. order) — the "correct the order from the
  bill" case.
- The rest were **POs not yet in the portal** — a real gap to fix, surfaced in Review.

Most of the un-matched volume in a given day is **pre-portal adidas team POs** (old
system) — those route to **Outside of Portal** and are not yours to process here.

---

## 8. Quick decision guide

| You see… | Do this |
|---|---|
| 🟢 Row, high confidence, lines look right | **Approve** (or Approve-all) |
| 🟢 Row, AI 🤖 adjusted a size/SKU | Glance at the highlighted change, then Approve |
| 🟡 Scanned supplier (S&S, etc.) | Grab the PDF from Sports Inc → Upload Supplier Bills → push |
| 🔵 PO has **no space** (`PO3454`) | **Mark Outside of Portal** (NetSuite/QB handles it) |
| ⚠️ Bill qty ≠ order qty | **Correct the order from the bill** (bill is truth), then approve |
| ⚠️ "No PO found," customer exists | Get the PO line created, or Mark Outside of Portal |
| ↩️ Credit memo | Review, confirm the order, approve (posts as a negative) |
| Not sure it matched the right order | Open the candidate list, verify customer + items, pick or send to Review |

---

## 9. Guardrails (what the system will NOT let happen)

- **No auto-posting.** Nothing reaches the Billed tracking without an Approve click.
- **No double-billing.** A document already applied (here or via PDF) is detected and
  skipped.
- **No pre-portal contamination.** Old-system (no-space) POs cannot be approved into the
  Billed tracking — Approve is disabled for them.
- **Full audit trail.** Every approval records who/when; every AI label change is logged
  with its reason.

---

## 10. Who to contact

- **A bill won't match / looks wrong / a PO is missing in the portal:** route to the rep
  who owns the order (the order page shows the rep).
- **Something about the import itself looks off** (e.g. the digest didn't arrive, a
  supplier is mis-classified EDI/OCR): flag to the portal admin.

---

*This SOP covers Sports Inc–routed bills only. Suppliers we don't buy through Sports Inc
continue to come in via Upload Supplier Bills (PDF) exactly as today.*
