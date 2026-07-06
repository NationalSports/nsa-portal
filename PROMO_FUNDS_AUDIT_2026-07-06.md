# Promo Funds Audit — 2026-07-06

Audit of the promo dollars system: how funds are earned/allocated, how they're
applied to sales orders, and where the code diverges from the stated business
rules. Requested rules (from ownership):

1. Promo is allotted either as **$X per semester** (H1 = Jan 1–Jun 30, H2 = Jul 1–Dec 31)
   or as **10% of total spend**, excluding tax and shipping.
2. Promo is earned from **PAID invoices only** — spend doesn't qualify until paid.
3. Promo can be used on **any apparel order**.
4. When promo is applied, items are priced at **full retail** (not the discounted sell).

## System map

Tables (`supabase_migration_003_promo_dollars.sql`):

| Table | Role |
|---|---|
| `customer_promo_programs` | Config only: `fixed` ($/period) or `percent_of_spend` (fraction, e.g. 0.10) |
| `customer_promo_periods` | One row per semester with `allocated` and `used` (stored counters) |
| `customer_promo_usage` | Ledger: which SO/estimate consumed how much from which period |

Plus flags: `sales_orders.promo_applied` / `promo_amount`, `so_items.is_promo`
(estimates mirror). Promo is owned by the parent account; sub-accounts share it.

Key code:

- Promo $ tab UI: `src/CustDetail.js:560-765` (header math `577-579`, earning calc `584-591`, Pull Forward `595-601`, auto true-up effect `126-145`)
- Apply Promo Funds to an order: `src/OrderEditor.js:3306-3399`; Remove Promo `3400-3416`
- Promo totals memo: `src/OrderEditor.js:2436-2457`; canonical copy `src/businessLogic.js:731-790`
- Qualifying spend: `src/pricing.js:264-296` and duplicate `src/businessLogic.js:821-853`
- Deduct on estimate→SO convert: `src/App.js:5576-5651`; reversals `6039-6048`, `6441-6450`

## Why "Allocated" vs "Programs" is misleading

**A program allocates nothing.** Programs are pure configuration ("this customer
earns 10% of spend"). The ALLOCATED / USED / REMAINING tiles sum only
`customer_promo_periods` rows whose `period_start` equals the current semester
(`CustDetail.js:567,577-579`). So:

- A customer with an active **10% of Spend** program shows **ALLOCATED $0** until
  someone clicks "Pull Forward" (or the once-per-rollover auto true-up runs on
  page open). The green "Earning This Half" number is *next semester's* money and
  never feeds the tiles.
- **Fixed** programs behave differently: opening the page (or the Apply Promo
  button) auto-creates the current period from `fixed_amount`
  (`CustDetail.js:569-576`, duplicated at `OrderEditor.js:3313-3323`,
  `App.js:5599-5642`). So fixed self-populates ALLOCATED but percent does not —
  inconsistent and confusing.
- The **Program dropdown in "Allocate Period" is decorative**: the dollar amount
  is whatever is typed in "Allocated ($)"; `program_id` is stored only as a label
  (`CustDetail.js:717-733`). It reads as "allocate from this program's formula"
  but doesn't compute anything.
- The Promo $ tab badge counts programs + unused credits, not dollars
  (`CustDetail.js:271`), so it can disagree with the balance inside.

## Business rules vs. code

| Rule | Status | Evidence |
|---|---|---|
| Semester periods H1/H2 | ✅ Enforced | `businessLogic.js:857-866` (but re-inlined in 4+ places, see F7) |
| 10% of spend excl. tax & shipping (earn side) | ⚠️ Partly | `calcQualifyingSpend` excludes tax/ship — but also silently drops any line with <20% margin (`pricing.js:264`, `businessLogic.js:849`), which is an extra rule nobody stated |
| **Paid invoices only** | ❌ Not enforced | Earning counts SOs with status `approved`, `paid`, or `complete` (`CustDetail.js:588`) — approved-but-unpaid orders earn promo today |
| Apparel orders only (spend side) | ❌ Not enforced | Apply Promo loops over **all** line items with no category/type filter (`OrderEditor.js:3337`); nothing anywhere gates promo on apparel |
| Tax excluded from promo consumption | ✅ Enforced | Promo portion taxed $0 (`businessLogic.js:782-784`, `OrderEditor.js:2452`, invoice `6246-6247`) |
| Shipping excluded from promo consumption | ❌ Opposite | Promo **consumes shipping, marked up 25%**: `PROMO_SHIP_MULT=1.25` (`businessLogic.js:722,779`; `OrderEditor.js:3345-3346`) |
| Full retail when promo applied | ✅ Enforced | `unit_sell` → `retail_price` (fallback `nsa_cost×2`) on promo lines (`OrderEditor.js:3340,3350`; `businessLogic.js:724-727`); decorations sell ×1.25 |

## Findings

### F1 — Promo earns on unpaid orders (confirmed vs. stated rule)
`_fulfilled = ['approved','paid','complete'].includes(so.status) || calcSOStatus(so)==='complete'`
(`CustDetail.js:588`). Per ownership, promo should accrue from **paid** revenue only.
Fix: gate qualifying spend on paid status (open question Q1: SO paid status vs.
paid `customer_invoices` records as the source of truth).

### F2 — No apparel restriction
Any line item — footwear, equipment, anything — can be flipped to promo. If the
apparel-only rule is real, Apply Promo needs a per-item eligibility filter
(open question Q2: how do we identify "apparel" — category, `is_footwear` flag, vendor?).

### F3 — Shipping consumed by promo (and marked up 25%)
Promo budget is drained by `shipBase × 1.25` per covered item
(`OrderEditor.js:3345-3346`). The stated rule was promo applies to spend
*excluding* tax and shipping. Tax is handled correctly; shipping is not.
(Open question Q3: is the 25% shipping/deco markup on promo intentional policy?)

### F4 — Hidden ≥20% margin qualifier on earning
`calcQualifyingSpend` only counts a line toward 10%-of-spend earning if its
margin is ≥20% (`businessLogic.js:849`). Not part of the stated rules — either
it's intended policy that should be surfaced in the UI more clearly, or it
should be removed. (Open question Q4.)

### F5 — Over-spend is only warned, never blocked, in the editor
The editor shows a red "exceeds available funds" warning (`OrderEditor.js:3526`)
but nothing prevents saving. Editing an order **after** promo is applied (adding
qty/items) inflates the live promo total while the recorded deduction stays
frozen at apply-time — the ledger and the order silently diverge. Convert does
re-check (`App.js:5597-5604`); the editor does not.

### F6 — Balance counters can drift (non-atomic writes)
`period.used` is a mutated counter, not derived from the usage ledger. On
convert, the period save and usage insert can partially fail
(`App.js:5648` logs and skips the usage insert), leaving `used` incremented with
no ledger row — that spend can never be reversed by delete (reversal keys off
usage rows). Recommendation: derive `used` from `customer_promo_usage` (or wrap
in an RPC/transaction).

### F7 — Five hand-synced copies of core promo logic (already drifting)
- `calcPromoTotals`: canonical `businessLogic.js:731` vs. inline memo
  `OrderEditor.js:2436-2457` — **already diverged**: the memo includes
  `_promo_credit` (partial coverage), the canonical copy doesn't (`businessLogic.js:787`).
- `calcQualifyingSpend`: `pricing.js:264` + `businessLogic.js:821`.
- Semester boundary `m<6 ? H1 : H2`: `businessLogic.js:857` re-inlined in
  `OrderEditor.js:3308,3480`, `App.js:5599,5630`, `CustDetail.js:565`.
- Auto-allocate-from-fixed-program block: `OrderEditor.js:3313-3323`,
  `App.js:5599-5642`, `CustDetail.js:569-576`.
- Deduct/restore usage: `OrderEditor.js:3376-3416`, `App.js:5626-5652,6039-6048,6441-6450`.
- `calcPromoSpendAllocation` (`businessLogic.js:801-816`) is a third, different
  spend formula (no margin filter, no deco) referenced **only by tests** — dead
  code that misleads.

### F8 — Usage is bucketed by the clock, not the order date
Apply/convert attaches usage to whichever semester the **system clock** is in
(`OrderEditor.js:3308`, `App.js:5630`), not the order's date. An order from late
June converted in July deducts from H2.

### F9 — Date-string fragility in spend filters
Spend filters compare `(so.order_date||so.created_at).slice(0,10) >= '2026-01-01'`
(`CustDetail.js:589`), but SOs are created with `created_at: new Date().toLocaleString()`
(`App.js:5607`) — a locale string like `"7/6/2026, 3:04 PM"`. Orders without an
`order_date` are mis-bucketed or dropped from qualifying spend.

### F10 — Minor
- Greedy item coverage follows line order, not price/value (`OrderEditor.js:3337`).
- "Close Promo Order" backfill (`OrderEditor.js:3477-3489`) records the
  *current* (possibly edited) promo total, not the originally drawn amount.
- Percent display can show float artifacts (`spend_percentage*100`, `CustDetail.js:681`).

## Recommendations (proposed order)

1. **Fix F1 (paid-only earning)** — small, high-trust change once Q1 is answered.
2. **Redesign the Promo $ tab presentation** to kill the Allocated/Programs
   confusion (no schema change needed):
   - Rename "Promo Programs" → "Earning Rules"; add a one-line explainer.
   - Make percent programs behave like fixed ones (auto-materialize the current
     period), or replace "Pull Forward" with an automatic accrual display.
   - Either make the "Allocate Period" program dropdown actually compute the
     amount, or drop it and label the card "Manual Allocation / Adjustment".
3. **Enforce rules at apply time**: apparel filter (after Q2), stop consuming
   shipping from promo (after Q3), block save when promo exceeds funds (F5),
   re-sync the deduction when a promo order is edited.
4. **Consolidate to one implementation** (F7): one `promoEngine` module
   (period math, qualifying spend, apply/remove, deduct/restore) imported
   everywhere; delete `calcPromoSpendAllocation`.
5. **Harden the ledger** (F6, F8, F9): derive `used` from usage rows, bucket by
   order date, write ISO timestamps.

## Ownership decisions (2026-07-06)

Answers received after the initial audit; these define the fix scope:

- **Q1 (paid-only): PAID INVOICES, not SO status.** Qualifying spend for % of
  Spend earning must count only paid revenue. Note: NetSuite-imported
  `customer_invoices` are totals-only (no line items), so the margin gate and
  tax/shipping exclusion can only be computed from SO lines — the design is to
  compute qualifying spend from SO line items but gate qualification on the
  order actually being paid.
- **Q2 (apparel): exclude footwear.** Promo application must skip
  `is_footwear` line items; everything else is eligible.
- **Q3 (deco/ship markup): OUT OF SCOPE — leave as-is.** Initially "just do the
  gear" (promo covers gear at retail only; deco/shipping handled manually), then
  revised: **ignore the gear-only change, keep current consumption math**
  (deco ×1.25 and shipping ×1.25 continue to draw from promo). Reps adjust
  manually when needed. Main priority is the earning/allocation logic.
- **Q4 (margin gate): KEEP.** The ≥20%-margin qualifier on earning is intended
  policy.
- **Q5 (early draw): KEEP.** Drawing against future semesters' allocations is
  allowed.

Additional requirement (reported as a live bug): **adding a "10% of spend"
program should immediately auto-calculate the current semester's allocation
from last semester's spend.** Today the auto true-up effect
(`CustDetail.js:126-145`) only runs on `[initCust.id, sos]` — it fires on
customer open, not when a program is added mid-session, so a newly created %
program shows ALLOCATED $0 until the customer is reopened.

### Fix scope (agreed)

1. % of Spend earning counts **paid** orders only (paid signal per Q1).
2. Adding/having a % program **auto-materializes** the current period's
   allocation = last semester's qualifying paid spend × pct (no reload, no
   manual Pull Forward required for the baseline).
3. Promo application **skips footwear** items.
4. No changes to deco/shipping promo consumption, margin gate, or early draw.

### Follow-up decisions (same day)

- **Paid signal = BOTH sources combined.** Investigation showed SOs have no
  paid status of their own (`calcSOStatus` is fulfillment-only; the `'paid'`
  literal in the old earning filter was dead code). Payment lives on (a)
  portal invoices (`invs`, linked by `so_id`, with `paid`/`total`/`status`)
  and (b) NetSuite-imported `customer_invoices` (paid/open status, totals
  only, **no SO link, no line items**). Ownership chose **both combined**:
  line-level qualifying spend (margin gate, tax/ship excluded) for SOs whose
  portal invoices are fully paid, PLUS paid NetSuite invoice subtotals
  (tax excluded; shipping not separable at the header level). No linking key
  exists between the two, so the UI shows the breakdown for manual overlap
  adjustment.
- **Overdraft carry-forward (FPU case).** A period that ends with
  `used > allocated` (negative remaining) previously just sat there; the new
  semester started fresh. Now the deficit carries into the current period as
  starting `used`, so new earnings pay the negative down first.

## Implementation (2026-07-06, this branch)

- **`src/pricing.js`** — new canonical helpers (single copy, no businessLogic
  mirror):
  - `promoDateKey(v)` — normalizes ISO *and* legacy locale date strings to
    `YYYY-MM-DD` (fixes audit F9 for the earning path).
  - `soIsPaid(so, invs)` — an SO is paid when its non-void portal invoices
    exist and payments cover the invoiced total ($0 totals fall back to
    status === 'paid').
  - `calcPaidQualifyingSpend({sos, invs, histInvs, famIds, start, end})` —
    returns `{soSpend, histSpend, total}` combining paid SO line-level
    qualifying spend and paid NetSuite invoice subtotals (credit memos
    negative).
- **`src/CustDetail.js`**:
  - Earning calc and the auto-allocation effect now use
    `calcPaidQualifyingSpend`; the dead `['approved','paid','complete']`
    status filter is gone (fixes F1).
  - The auto-allocation effect re-runs when **programs change**, so adding a
    "10% of spend" program immediately computes last semester's paid spend ×
    pct and populates the current period's ALLOCATED (the reported bug). It
    only ever raises the allocation (`Math.max`), never claws back.
  - **Overdraft carry-forward**: past periods with `used > allocated` push
    their deficit into the current period's `used`, write a usage-ledger row
    ("Overdraft carried forward from H1 2026"), and stamp the source period's
    notes with `[overdraft carried to …]` so the deficit can't be carried
    twice (a session ref guards double-fires before state settles).
  - Earning card now says "paid invoices only" and shows the source
    breakdown (portal orders vs NetSuite invoices) with an overlap warning.
- **`src/OrderEditor.js`**:
  - Apply Promo Funds skips `is_footwear` line items (they stay
    customer-paid); notifications report how many footwear items were
    excluded (fixes F2 per Q2).
  - The per-line Promo checkbox is hidden for footwear items.
- **`src/__tests__/promoPaidSpend.test.js`** — 20 tests covering date
  normalization, the paid gate (partial/void/$0 invoices), margin gate still
  applying, credit-memo netting, family/period filtering, and legacy
  locale-date bucketing. Full suite: 381 passing; production build clean.

### Still open (not in this pass)

- F5 (editor-side overspend is warn-only; edits after apply don't re-sync the
  deduction), F6 (non-atomic `used` counter), F8 (usage bucketed by clock
  date at apply time), F7 consolidation of the remaining duplicated promo
  copies (`calcPromoTotals` drift, semester-boundary inlines).
- NetSuite invoice import is a manual batch step — paid statuses lag until
  someone re-runs the loader.

## Open questions for ownership (original)

- **Q1 (paid-only):** Should "paid" mean the SO's paid status, or strictly paid
  `customer_invoices` records? (Invoices are the accounting source of truth but
  not every SO may have invoice rows.)
- **Q2 (apparel):** How should the system identify "apparel" for promo
  eligibility — product category, `is_footwear` exclusion, vendor, or a manual
  per-line toggle for the rep?
- **Q3 (shipping/deco markup):** Is the 25% markup on decoration and shipping for
  promo-covered lines intentional policy? And should shipping consume promo at
  all, given the stated tax-and-shipping exclusion?
- **Q4 (margin gate):** Is the ≥20%-margin qualifier on 10%-of-spend earning
  intended? If yes it should be surfaced in the UI; if no it should be removed.
- **Q5 (early draw):** Applying promo can draw from *future* semesters'
  allocations once the current one is exhausted (`OrderEditor.js:3326`). Keep?
