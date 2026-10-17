# Accounting Connections Audit — 2026-10-17

**Question asked:** how have the accounting connections gone, are they working properly, and
what can we build or change to make accounting simpler and more efficient?

**Scope:** every path money takes through the portal — QuickBooks (customers, invoices,
payments, supplier bills, deposits), Sports Inc and S&S supplier-bill feeds, Stripe, commissions,
tax, and the NetSuite leftovers. Three independent code reviews (QuickBooks connector, supplier-bill
pipeline, customer-side money) were run and their claims re-checked against live Supabase data,
live QuickBooks reports, and the last 45 days of accounting email. Every number below was taken
today from the live database or QuickBooks unless marked otherwise. Nothing was changed by this
audit except the supplier-bill hold rules already in PR #2586.

---

## 1. Bottom line

1. **The customer side works.** The hourly server job that keeps QuickBooks in step with portal
   invoices and payments is healthy: 1,369 of 1,415 invoices linked, 863 of 864 payments
   reflected, zero failed runs since Oct 15, eight items waiting on a person (named below).
2. **The supplier-bill side has stalled.** 126 bills ($57.9K) are applied to orders in the portal
   but **not in QuickBooks**; the last one reached QuickBooks on Oct 7. Root cause is verified
   (section 3.1): a reset flag in the shared QuickBooks config plus a one-time "canary" gate blocks
   every push Andrea attempts, while the daily email keeps telling her to push. Separately, the two
   wrong hold rules fixed today in PR #2586 kept 196 invoices (~$78K) parked.
3. **Bills only move when someone opens a browser tab.** The nightly jobs copy Sports Inc and
   S&S documents into the database; matching, applying to orders, and pushing to QuickBooks all
   run inside the Supplier Bills screen. 360 Sports Inc documents ($166K, oldest May 18) have never
   entered review at all. If accounting is out for a week, nothing lands.
4. **Stripe deposits never reach QuickBooks automatically.** 70 payouts, $360K net since June,
   zero posted. The automation is built and sits behind an off switch.
5. **Receivables are the biggest money number:** QuickBooks shows $1.50M past due across 322 of
   384 customers, $171K of it over 90 days. That is a collections problem, not a sync problem,
   but the portal only emails past-due reminders for one rep's accounts.
6. **QuickBooks itself carries two clean-up items the connector exposed**: 28 "ghost" invoices
   ($188K) that were deleted in the portal after being pushed and re-issued under new numbers,
   so QuickBooks A/R counts them twice; and 39 supplier bills posted twice in July, 14 pairs
   still open ($7K) and 25 pairs both paid ($12.9K, vendors likely paid twice). Details in 3b.
7. **Three security leftovers**: legacy QuickBooks token functions deployed without
   authentication, and about 70 one-off QuickBooks "runner" functions still deployed that are not
   in the repo (4 of them unauthenticated).

The ranked fix list is in section 5. The first four items are a few hours each and close the
two live money gaps (bills not in QuickBooks, nobody told when a feed dies).

---

## 2. Scorecard — every connection, measured today

| Connection | Status | What the data says (today) | Who does the clicking |
|---|---|---|---|
| Portal → QuickBooks: customers, invoices, payments, check receipts | **Working** (server, hourly at :17) | 24 runs/day, 0 failed since Oct 15; 1,369/1,415 invoices linked; 863/864 payments; 11 invoices held as future-dated, 29 excluded as $0, 3 void | Nobody; 8 review items need a person (section 3.4) |
| Portal → QuickBooks: supplier bills | **Stalled since Oct 7** (browser only) | 126 applied bills, $57,893, no QuickBooks bill; 105 of them from October; all auto-pushed in the portal | Andrea pushes by hand; every attempt is blocked (3.1) |
| Sports Inc → portal (bill feed) | **Half working** (copy nightly 16:30 UTC; match/apply browser-only) | `si_documents`: 795 "new" docs; 414 are also parked in Set aside; **360 ($166K) are nowhere else**; 696 "outside portal" ($442K, pre-portal, intentional) | Whoever opens Supplier Bills first each day triggers the pull |
| S&S → portal (bill feed) | Same shape as Sports Inc (copy 12:30 UTC) | Feeds `ss_documents`; applied bills show source `ss_orders` | Same |
| Set aside (parked bills) | **Backlog** | Oct: 375 distinct invoices parked ($286K incl. duplicate copies); Sept: 379 parked, 150 resolved. PR #2586 clears 196 invoices (~$78K); 55 (~$25K) need a human because the bill names a different PO; 62 (~$40K) held for price gaps | Andrea |
| Stripe → QuickBooks deposits | **Not running** (built, switched off) | 70 payouts since Jun 30, $359,864 net, 0 posted to QuickBooks; $305K of payout activity not linked to webstore orders | Andrea books deposits by hand (inferred, not verified) |
| Stripe reconciliation monitor | **Working** | 139 order checks, 4 incidents (3 resolved); 1 open critical "order amount mismatch" since Oct 8; chargeback SO-2796 response due Oct 23 | Steve |
| Commissions | **Computed, delivered by hand** | Snapshots exist for Aug/Sep/Oct per rep; Andrea asked Oct 16 for September amounts for Chase and Jered and had not received them | Steve emails amounts |
| Sales tax | **Partly manual** | TaxCloud functions deployed; 1 remittance ledger row (Jul); invoices since June: 1,172 with tax, 0 marked reported to TaxCloud | Unverified who files |
| A/R follow-up | **Working, narrow** | Weekly "Past-due A/R" email: $238K across 87 invoices on Steve's accounts. QuickBooks: $1.497M overdue total | Reps |
| NetSuite (legacy) | **Should be shut off** | 11 saved-search emails still arrive daily; `customer_invoices` mirror last updated Sept 1; FarApp credential question in email | Nobody |

Portal vs QuickBooks receivables agree where I could compare: the two customers I spot-checked
(West Valley College Soccer, Orange Lutheran Store) carry the same open invoices in both systems.

---

## 3. Findings, most important first

### 3.1 Supplier bills are not reaching QuickBooks — $57.9K, 126 bills (CONFIRMED)

**Evidence.** `applied_bills` rows with `status=pushed`, `portal_status=success` and no
`qb_bill_id`: 6 from July, 15 from September, 105 from October (first Oct 5, last Oct 17). All
carry `_auto_pushed:true`. The Rawlings bill 4105234 ($265.76, applied Oct 16) is absent from the
QuickBooks A/P detail, which lists only three Rawlings bills from August.

**Why.** Two gates in the browser push, both tripped:

- The shared QuickBooks config (`app_state.qb_config`) has `initialMigrationApproved=false`,
  `preflight=null`, `autoPushBillsToQB` unset, and `_qbCanaryBillIds` holding 4 ids. The push
  button (`src/App.js` `pushBillsToQB`) refuses without a passing preflight, and with approval
  false it is in canary mode; with 3 canaries already done it stops with *"Three QBO canary bills
  are complete. Review them in QuickBooks and approve the migration before any production
  batch."* That matches Andrea's Oct 15 reply with a screenshot after following the push steps;
  the Oct 17 daily email still says "0 sent yesterday" and asks her to push again.
- The approval flag is **wiped** by any 401 or 409 from `qb-api` (`src/App.js` ~27165) and by any
  `connection_status` reply of not-connected (~5204). The server job now owns invoice and payment
  writes and answers browser writes with a deliberate 409, so one click on an old browser sales
  button resets the bill gates for everyone. Which event fired this time is not provable from
  logs; the trap is.
- Auto-send to QuickBooks (`autoPushBillsToQB`) is off, so even a healthy gate needs a human click.

**Consequence.** A/P in QuickBooks is understated by ~$58K; vendor bills can age unpaid; the
bill-anomaly digest still reports these as "pushed".

**Fix (hours).** An admin re-runs preflight and clicks approve on the QuickBooks page, then pushes
the 126 in batches; stop treating 409 as "disconnected" and stop clearing approval on transient
connection checks; then turn auto-send on (owner decision, the switch exists).

### 3.2 Matching and applying bills happens only inside a browser (CONFIRMED)

The Sports Inc and S&S crons only mirror documents into `si_documents` / `ss_documents`. The daily
pull that matches, applies, auto-pushes, and sends to QuickBooks fires on the first visit to
Supplier Bills per browser per day (`src/App.js` ~26584). Results: 360 Sports Inc documents
($166K) are "new" and in neither Set aside nor the applied ledger; oldest May 18. Two staff
browsers mean two pulls, two AI passes, and per-device switches (auto-push on/off, review session,
duplicate override) that can disagree.

### 3.3 Nobody is told when a bill feed or digest dies (CONFIRMED in code)

All three bill crons return an HTTP error and log to console only. The anomaly digest returns
success without email if the mail key is missing. A dead feed looks exactly like a quiet day. By
contrast, the sales sync has run tables, a first-failure email, and a watchdog; the bill side has
none of that.

### 3.4 Sales sync items waiting on a person (8)

| Item | Why held | Action |
|---|---|---|
| INV-64475 Oakwood HS Baseball ($1,485), INV-64492 Santa Fe HS Baseball ($1,566) | customer not yet in QuickBooks | sync reaches them within days; "new customers first" change ready, needs Steve's go-ahead |
| 4 customers: Lake SC Online, Power Surge, Portola Boys Soccer, SLO Cross Country | name differs between portal and QuickBooks | rename one side |
| INV-63831 | blocked on purpose | none |
| payment:1384 | partially reflected | Andrea to apply the remainder in QuickBooks |

The 31 failed runs on Oct 13–15 were a database statement timeout, fixed Oct 15 by raising the
service-role timeout; none since.

### 3.5 Stripe deposits are not in QuickBooks (CONFIRMED)

`stripe_payouts`: 70 rows, all reconciliation status "exact", `qbo_deposit_id` null on every one.
`qbo_sales_settings.stripe_payouts_enabled=false`. The posting runner and the settings card
(`src/StripePayoutAutomation.js`) exist; they need a bank account, a fee account, a start date and
one canary payout. Until then every Stripe deposit and fee is a manual QuickBooks entry.
$305K of payout activity is not tied to a webstore order (invoice card payments and team-shop
flows), which is the part a manual booking is most likely to get wrong.

### 3.6 Receivables: $1.50M past due in QuickBooks

QuickBooks A/R aging today: $1,497,548 overdue (1–30: $454K; 31–60: $746K; 61–90: $127K;
91+: $171K), 322 of 384 customers. The portal shows $1.54M open. The weekly past-due email covers
one rep's accounts ($238K, 87 invoices). West Valley College's Oct 15 email shows the typical
blocker: the school holds payment on nine invoices over short items, wrong PO numbers on
invoices, and one invoice (INV-64217) that is $2,660 above its quote. Collections speed is tied to
fulfillment accuracy and invoice-vs-quote checks, not to the sync.

### 3.7 Late bills land on finished orders with no notice

A supplier bill applies to any order, including completed and paid ones (no status guard in the
apply path). Commission for paid invoices is frozen in `commission_snapshots`, so statements do not
move, but live gross profit does, and the gap shows only when someone opens the Commissions page.
`_cost_corrections` is written on every price sync and read by nothing. 243 of the orders matched
by today's parked bills are already complete.

### 3.8 Customer-side gaps found in code (CONFIRMED unless marked)

- **A chargeback on an invoice card payment is invisible.** The Stripe webhook handles a dispute
  only when the charge belongs to a webstore order (`netlify/functions/stripe-webhook.js` ~363):
  it records a dispute row and emails staff. A coach paying an invoice through the portal's Pay
  button has no such path: the invoice stays paid, QuickBooks keeps the payment, nobody is told.
  The dispute does block that payout's automatic deposit, which is the only trace. Today's open
  chargeback (SO-2796) is a webstore order, so it was caught; an invoice one would not be.
- **Deleting an invoice that already went to QuickBooks leaves the QuickBooks copy open.** Voids
  and deletes are portal-only; the UI tells the user to ask accounting to void in QuickBooks. A
  real case exists (INV-63982 and INV-64393, both $488.05, one still open in QuickBooks).
- **Some deliberate database refusals still look like save failures.** The INV-63464 fix stopped
  one case (a payment accounting had unapplied). The same class remains for a stale
  `payment_revision`, for payments held for QuickBooks reconciliation, and for two payments on one
  invoice with the same reference: each falls into the generic "Payment NOT saved, retrying" loop
  instead of a plain message (PLAUSIBLE, from code reading; not reproduced).
- **Store closeouts post the gross payment, fees stay out of QuickBooks.** A team-shop closeout
  records one "store" payment for the gross collected; OMG and card fees are kept only as a
  commission cost. QuickBooks therefore shows gross in Undeposited Funds while the bank receives
  net, and the fee difference is a manual entry. The same holds for the new Credit Card button on
  Receive Payments (no fee recorded by design).
- **The admin Stripe refund action leaves the invoice marked paid.** It refunds in Stripe and
  writes a best-effort negative payment row but never adjusts the invoice total, paid amount or
  status, and nothing pushes a negative payment to QuickBooks.
- **TaxCloud is effectively unused and not idempotent.** Since June, 1,172 invoices carry tax and
  0 are marked reported to TaxCloud; 5 lifetime usage rows. The capture function does not read or
  set the reported flag server-side (the 07-03 audit's double-filing finding; auth was added,
  idempotency was not). Tax appears to be filed from QuickBooks' liability account; unverified.
- **Pricing drift is fixed.** The embroidery cost table that had diverged in July is now
  byte-identical in all three copies and guarded by a drift test (18/18 pass today).

### 3.9 Security leftovers (CONFIRMED via Supabase function list)

- `qb-auth`, `qb-callback`, `qb-refresh-token` Edge Functions deployed with `verify_jwt=false`;
  `qb-refresh-token` returns a raw access token to any caller. They read an `app_state` row that
  no longer exists, so they currently fail, but the client secret is in them.
- `qbo-postportal-vendor-payment-preflight`, `qbo-postportal-vendor-payment-runner`,
  `qbo-postportal-ready-vendor-payment-runner`, `qbo-ns-held-payment-audit`: unauthenticated,
  not in the repo.
- About 70 one-off `qbo-*` migration runners (history batches, vendor A/P runners, invoice
  posters) still deployed and not in the repo. None are scheduled. Unverified whether any still
  write.

### 3.10 Duplicated logic that drifts (the repo's known failure mode)

Both reviews found the same pattern in accounting code: invoice line building, tax plan, customer
matching, date parsing, and ledger keys exist once in the browser engine and once in the server
job and have already diverged (browser supports a "manual tax" mode the server forbids). On the
bill side: four different "old-system PO" regexes, five vendor-name normalizers, six "which keys
are sizes" lists, three order writers each with their own duplicate guard, and the Sports Inc
upcharge included in landed cost by only one of the three writers. The digest emails and SOP
still say "nothing is applied automatically", which has been false since auto-push became the
default.

---

## 3b. QuickBooks vs portal, line by line (connector reconciliation)

Pulled through the QuickBooks connector today: every invoice dated May 1 onward (2,190), the
A/R aging by customer (500 customers), open bills for nine vendors, and the balance sheet. Each
was matched against the portal's own tables.

### Receivables: QuickBooks $2,600,474 vs portal $1,541,150, and where the gap is

| QuickBooks invoices since May 1 | Count | Open balance | Open count |
|---|---:|---:|---:|
| Linked to a portal invoice (`qb_invoice_id`) | 1,370 | $1,487,008 | 524 |
| Portal-numbered but **deleted in the portal** (ghosts) | 33 | **$188,283** | 28 |
| NetSuite-era numbering (pre-portal, migrated) | 787 | $938,383 | 266 |
| Total | 2,190 | $2,613,674 | 818 |

- **Linked invoices agree.** 1,366 of 1,415 portal invoices match QuickBooks on total and 1,350
  on balance. The 37 portal invoices absent from QuickBooks are 24 zero-dollar invoices (excluded
  by design), 6 future-dated (held until their date), and the 2 new-customer holds.
- **28 ghost invoices, $188,283, still open in QuickBooks.** Each was created in the portal,
  pushed to QuickBooks, then hard-deleted in the portal (audit log shows the DELETE) and
  re-issued under a new number on the same order. The replacement was pushed too, so QuickBooks
  carries both. Largest: INV-63844 Encinitas Express Soccer $57,985 (replacement INV-64006 paid),
  INV-63462 College of San Mateo Football $36,776 (replacements INV-63909/63910/63911 open, so
  CSM shows double in QuickBooks), INV-63878 Biola Baseball $34,815 (replacement paid). This is
  the whole of the "College of San Mateo $81K in QuickBooks vs $44K in the portal" difference.
  **Action: void these 28 in QuickBooks** (full list in Appendix A). The hourly sync cannot see
  them because it iterates portal invoices, and the portal row is gone.
- **17 invoices paid in QuickBooks but still open in the portal, $16,743.** Payments keyed
  directly into QuickBooks do not flow back; the pull exists only as a browser button nobody
  runs. Until it runs, reps see these as unpaid and the past-due email will nudge customers who
  have paid. Largest: INV-64346 Servite Football $3,266, INV-63464 Porterville Baseball $2,936,
  INV-64293 Seton Catholic Football $1,967 (Appendix B).
- **2 the other way**, open in QuickBooks but paid in the portal: INV-64152 West Valley
  $2,748.63 (the "$659 short" item in the daily email) and INV-63472 Mission College $953.34.
- **5 invoices the portal shows as $0 that QuickBooks shows with an amount** (INV-63449 Slate
  Group $5,100, INV-63249 Redbirds $2,600, INV-63174 $972, INV-63472 $953, INV-63137 $60). Four
  are paid in QuickBooks; INV-63472 is open there. Someone zeroed the portal copies; QuickBooks
  kept the originals.
- **NetSuite-era receivables are the other $938K.** 266 open invoices in QuickBooks carry the old
  numbering (INV6xxxx / NS-INV6xxxx) and exist in the portal only as the read-only NetSuite
  mirror, last refreshed Sept 1. QuickBooks is the only live record of that money.
- Per-customer totals cannot be matched exactly because QuickBooks rolls sub-customers (West
  Valley College Soccer, Biola teams) into parents in the aging report; the invoice-level match
  above is the reliable comparison.

### Payables: QuickBooks $456,461 (balance sheet) vs the portal ledger

- Every open QuickBooks bill for Agron (35), Augusta (15), Richardson (14), Momentec (10), S&S
  (6), Under Armour (4), Rawlings (3) and Badger (2) exists in the portal's applied-bill ledger
  with a QuickBooks id. Rocket Science's 5 open bills ($4,100) were entered directly in
  QuickBooks, which is fine. Adidas (305 open bills) and SanMar (89) exceed the connector's
  50-row limit and were not listed.
- **39 bills were posted to QuickBooks twice in July** ($19,857 face value): once under the
  Sports Inc document number (vendor "Adidas", "Agron", "Momentec"…) and once under the vendor's
  own invoice number ("ADIDAS US TEAM SERVICES", "AUGUSTA SPORTSWEAR/ASI"…). The dedup-on-both-
  numbers fix dated 2026-07-23 stopped new ones; these are the leftovers. As of the Sept 18
  QuickBooks snapshot:
  - **14 pairs both still open, $6,962**: A/P is overstated by that amount and either copy could
    be paid. Delete one copy of each (Appendix C).
  - **25 pairs both paid, each with a linked payment, $12,894**: Adidas $3,815, Schutt $5,484,
    Richardson $3,082, Twin City $514. Unless the vendor issued a credit, these vendors were
    paid twice. **Action: Andrea to check vendor statements and recover or apply credits.**
- The 126 portal-applied bills missing from QuickBooks ($57,893, section 3.1) are confirmed
  absent (Rawlings 4105234 checked directly).

### Balance sheet (as of today, accrual)

| Account | QuickBooks | Note |
|---|---:|---|
| Accounts Receivable | $2,600,474 | includes $188K ghosts and $938K NetSuite-era |
| Accounts Payable | $456,461 | understated ~$58K (bills not pushed), overstated ~$7K (open duplicates) |
| Undeposited Funds | $16,242 | deposits are being booked by hand; low balance is healthy |
| Inventory Asset | $285,082 | never trued up since cutover; the posting routine exists but was never run |
| Sales Tax Payable (CA) | $257,654 | large; TaxCloud unused, so this is the filing source. Reconcile against returns filed |
| Bank | $238,593 | |

## 4. What is working well (keep it)

- Server-side sales sync design: leases, claims, read-back verification, per-source review rows,
  run tables, first-failure email, watchdog. This is the template for the bill side.
- `applied_bills` ledger with a unique key per document, plus the apply-session journal: a bill
  cannot post twice to an order, including copies of the same invoice inside one bulk push.
- Stripe reconciliation monitor with incidents and alert outbox.
- Payment receipts, unapply, and the oldest-first application flow Andrea uses daily.

---

## 5. What to build or change, ranked

| # | Change | Removes | Size |
|---|---|---|---|
| 1 | **Unblock the 126 bills now**: admin re-approves the QuickBooks bill migration (preflight + approve on the QuickBooks page), pushes in batches, spot-checks | $58K A/P gap | 1 hour, no code |
| 2 | **Stop the gate wipe**: treat qb-api 409 as a plain message, never clear approval on a transient connection check; store approval in the database, not the shared browser blob | the trap that will re-break item 1 | half day |
| 3 | **Turn on auto-send to QuickBooks** for clean bills once item 2 ships | Andrea's daily "Push next" clicks | owner switch |
| 4 | **Failure alerts for the bill crons** (one email on non-200, a `last_run` row, and a daily "feed is alive" line in the existing daily check email) | silent feed death | half day |
| 5 | **Move the daily pull, match, auto-push and QuickBooks send to the server** (same `applied_bills`/`si_documents`, same safety gates) | the "someone must open the tab" dependency, two-browser double pulls, per-device switches | 1–2 weeks |
| 6 | **Turn on Stripe payout deposits** (bank + fee account, start date, one canary) | manual deposit entry for every payout | 1 day + canary review |
| 7 | **Monthly commission statements emailed automatically** to Andrea and each rep from `commission_snapshots` | the "did you send September?" loop | half day |
| 8 | **Received-but-not-billed digest** (open `so_item_po_lines` > 30 days by vendor/PO) | the invisible unbilled exposure found in the Aug 31 audit | half day |
| 9 | **Bill-on-finished-order notice**: when a bill applies to a completed or invoiced order, note the GP change and surface `_cost_corrections` on the order and in the weekly digest | silent margin changes | 1 day |
| 10 | **Delete browser QuickBooks write paths** for customers/invoices/payments (server owns them), the legacy `qb-*` Edge Functions, and the ~70 one-off runners after a read-only check | ~1,000 lines, the 409 trap, four drifted copies, the token exposure | 1 day |
| 11 | **One shared module** for PO normalization, vendor names, size-key lists, EDI supplier list, used by browser and Netlify alike | four regex variants, five normalizers, six key lists | 2 days |
| 12 | **Collections tooling**: past-due email for every rep's accounts, and a quote-vs-invoice variance flag before an invoice is sent | West Valley-style payment holds | 1–2 days |
| 13 | **Shut down NetSuite**: stop the 11 daily saved-search emails, archive the `customer_invoices` mirror, close FarApp | daily noise and a stale $884K "open balance" table | admin tasks |
| 14 | Correct the SOP and the two digest emails that say nothing is applied automatically | false sense of a human gate | 1 hour |
| 15 | **Handle chargebacks on invoice payments** like webstore ones (flag the invoice, alert staff) | silent lost money | half day |
| 16 | **Make TaxCloud capture idempotent server-side**, or retire TaxCloud if tax is filed from QuickBooks (decide which) | double filing risk, dead integration | half day |
| 17 | **Turn known database refusals into plain messages** (stale payment revision, reconciliation hold, duplicate reference) instead of the retry loop | scary "Payment NOT saved" loops | half day |
| 18 | **Block delete of an invoice that is already in QuickBooks** (void instead, and queue the QuickBooks void for accounting) | orphaned open invoices in QuickBooks | half day |
| 19 | **Post store fees with the closeout** (fee line with the gross payment, or a payment-side adjustment) | manual bank reconciliation per store | 1 day |
| 20 | **Void the 28 ghost invoices in QuickBooks** ($188K A/R that does not exist) and add a nightly check: any open QuickBooks invoice whose number no longer exists in the portal | overstated A/R, double-counted customers | 1 hour + half day |
| 21 | **Clean the July double-posted bills**: delete one copy of each of the 14 open pairs ($7K); check the 25 paid pairs ($12.9K) with vendors for credits | overstated A/P, money possibly paid twice | Andrea, 2 hours |
| 22 | **Pull QuickBooks payments into the portal on the server** (the browser-only pull, moved into the hourly job) | 17 paid invoices still showing open, wrong reminders | 1 day |

Items 1–4 close the two live money gaps this week; item 15 closes the one silent-loss path. Item 5 is the structural fix and the largest
single reduction in daily accounting work; items 10 and 11 make everything after it cheaper.

---

## 6. Numbers used (all live, 2026-10-17)

| Measure | Value |
|---|---|
| Portal invoices / linked to QuickBooks | 1,415 / 1,369 |
| Portal open invoices / open balance | 550 / $1,541,150 |
| QuickBooks invoices since May 1 / linked to portal / ghosts / NetSuite-era | 2,190 / 1,370 / 33 / 787 |
| Ghost invoices open in QuickBooks | 28 / $188,283 |
| Bills posted twice in July (open pairs / paid pairs) | 14 ($6,962) / 25 ($12,894) |
| Portal invoices matching QuickBooks on total / on balance | 1,366 / 1,350 of 1,415 |
| QuickBooks A/R total (balance sheet) / overdue / 91+ days | $2,600,474 / $1,497,548 / $171,011 |
| QuickBooks A/P open (all current) | $465,844 (Adidas $229K, SanMar $101K) |
| Applied bills Jul–Oct / without QuickBooks bill | 2,381 / 126 ($57,893) |
| Parked bill copies / distinct invoices | 1,076 / 528 |
| PR #2586 effect: invoices clearing hold / still held (PO) / still held (other) | 196 (~$78K) / 55 (~$25K) / 62 (~$40K) |
| Sports Inc docs "new" / never entered review | 795 / 360 ($166K) |
| Stripe payouts / posted to QuickBooks | 70 ($359,864 net) / 0 |
| Sales sync runs Oct 13–15 failed (timeout, fixed) | 31 |
| Open sales-sync review items | 8 |

## 7. Not verified

- Which event reset the QuickBooks approval flag (three code paths can; no log).
- Whether the ~70 deployed one-off `qbo-*` functions still write anything.
- Who files sales tax today and whether TaxCloud capture is in use.
- Actual size of the per-browser `nsa_saved_bills` store (a 1 MB cap would silently stop local
  review state from saving).
- Whether Andrea books Stripe deposits manually in QuickBooks (inferred from zero postings).

## 8. Sources

Live Supabase (`qbo_sales_runs`, `qbo_sales_manual_reviews`, `qbo_sales_settings`,
`applied_bills`, `supplier_bill_holds`, `si_documents`, `invoices`, `invoice_payments`,
`stripe_payouts`, `stripe_reconciliation_incidents`, `commission_snapshots`, `app_state.qb_config`);
QuickBooks A/R and A/P aging reports and invoice reads via the QuickBooks connector; Gmail threads
Oct 15–17 (daily QuickBooks & Stripe check, supplier bills steps, West Valley invoices, Andrea's
requests); code reviews of `src/App.js`, `src/qbSyncEngine.js`, `src/billResolve.js`,
`netlify/functions/*`, `supabase/functions/qbo-sales-background/*`; prior audits
`SPORTS_INC_BILLING_AUDIT_2026-08-31.md`, `FABLE_SYSTEM_AUDIT_2026-07-03.md`.

---

## Appendix A — Ghost invoices open in QuickBooks (deleted in the portal, replacement issued)

| QuickBooks invoice | Customer | Date | Open balance |
|---|---|---|---:|
| INV-63844 | Encinitas Express Soccer (ENCE) | 2026-09-03 | 57,985.30 |
| INV-63462 | College of San Mateo Football (CSMF) | 2026-08-07 | 36,775.95 |
| INV-63878 | Biola University Baseball (BUB) | 2026-09-08 | 34,815.01 |
| INV-63896 | Saugus Cross Country (SAUC) | 2026-09-08 | 7,725.43 |
| INV-63980 | Biola University (BU) | 2026-09-15 | 6,459.15 |
| INV-1061 | Santa Barbara HS Basketball (SANTB) | 2026-06-15 | 5,155.00 |
| INV-63336 | Sanchez Cross Country (SXC) | 2026-07-29 | 5,016.95 |
| INV-63940 | Beach BreakaWave LLC (BBL) | 2026-09-11 | 3,592.12 |
| INV-64235 | Los Altos HS Boy's Basketball (LAHBB) | 2026-09-30 | 3,213.38 |
| INV-64239 | Los Altos HS Boy's Basketball (LAHBB) | 2026-10-01 | 3,213.38 |
| INV-63943 | Tustin HS Girl's Soccer (THGS) | 2026-09-14 | 2,718.91 |
| INV-63959 | Amador Valley Boosters (AMAV) | 2026-09-14 | 2,690.31 |
| INV-63960 | Amador Valley Boosters (AMAV) | 2026-09-14 | 2,666.06 |
| INV-64033 | Amador Valley Boosters (AMAV) | 2026-09-18 | 2,528.27 |
| INV-64108 | The Soccer Spot (TSS) | 2026-09-23 | 2,338.88 |
| INV-63916 | Vista High School Girl's Volleyball (VHSVB) | 2026-09-10 | 2,267.84 |
| INV-64101 | Monte Vista Football (MONTV) | 2026-09-23 | 2,048.91 |
| INV-64009 | Apple Valley HS Baseball (AVHB) | 2026-09-17 | 1,248.97 |
| INV-63697 | SONC Santa Cruz (SONSA) | 2026-08-25 | 1,186.27 |
| INV-1008 | El Camino HS Athletics (ECHS) | 2026-05-20 | 1,019.63 |
| INV-64129 | Special Olympics of Southern California (SOOSC) | 2026-09-24 | 669.89 |
| INV-64304 | Santa Ana College Women's Basketball (SACWB) | 2026-10-03 | 652.10 |
| INV-63975 | Arroyo High School Volleyball (AHSV) | 2026-09-15 | 637.99 |
| INV-63982 | Amador Valley Boosters (AMAV) | 2026-09-15 | 488.05 |
| INV-1007 | Tiffany Barden (TBAR) | 2026-05-20 | 370.02 |
| INV-63458 | Clarksville Football (CLAF) | 2026-08-07 | 315.00 |
| INV-64309 | Helix High School (HEL) | 2026-10-05 | 294.63 |
| INV-64476 | Seton Catholic High School (SETOCA) | 2026-10-15 | 189.24 |

Five more ghosts (INV-63691/63693/63695 SONC Santa Cruz, INV-63895, INV-64089) are already paid
in QuickBooks and need no action.

## Appendix B — Balance differs between portal and QuickBooks

| Invoice | Customer | Date | Total | Portal open | QuickBooks open |
|---|---|---|---:|---:|---:|
| INV-64346 | Servite Football | 2026-10-07 | 3,266.02 | 3,266.02 | 0.00 |
| INV-63464 | Porterville College Baseball | 2026-08-31 | 2,936.34 | 2,936.34 | 0.00 |
| INV-64152 | West Valley College Athletics | 2026-09-27 | 3,408.08 | 0.00 | 2,748.63 |
| INV-64293 | Seton Catholic Football | 2026-10-02 | 1,966.64 | 1,966.64 | 0.00 |
| INV-63622 | Bishop Alemany HS Flag Football | 2026-08-18 | 1,670.76 | 1,670.76 | 0.00 |
| INV-64341 | Orange Lutheran Football | 2026-10-13 | 1,537.34 | 1,537.34 | 0.00 |
| INV-63463 | Tustin HS Mens Soccer | 2026-08-07 | 995.05 | 995.05 | 0.00 |
| INV-63472 | Mission College | 2026-08-09 | 0.00 | 0.00 | 953.34 |
| INV-64443 | Mission Viejo HS Football | 2026-10-13 | 670.19 | 670.19 | 0.00 |
| INV-64414 | Golden Eagles FC | 2026-10-12 | 609.53 | 609.53 | 0.00 |
| INV-63751 | Bishop Alemany HS Flag Football | 2026-08-27 | 528.63 | 528.63 | 0.00 |
| INV-64477 | Sonoma County Premier | 2026-10-15 | 590.21 | 590.21 | 64.86 |
| INV-64090 | Seton Catholic Cheer | 2026-09-22 | 2,361.99 | 2,361.99 | 1,851.30 |
| INV-64294 | Seton Catholic Football | 2026-10-02 | 317.78 | 317.78 | 0.00 |
| INV-64434 | Servite Basketball | 2026-10-15 | 23,027.59 | 23,027.59 | 22,715.29 |
| INV-64415 | Twelve Academy | 2026-10-12 | 298.80 | 298.80 | 0.00 |
| INV-64425 | Golden Eagles FC | 2026-10-12 | 185.63 | 185.63 | 0.00 |
| INV-64327 | Bishop Alemany HS Flag Football | 2026-10-06 | 160.09 | 160.09 | 0.00 |
| INV-64383 | Sonoma County Premier | 2026-10-08 | 87.65 | 87.65 | 0.00 |
| INV-64194 | Fresno Pacific Athletics | 2026-09-29 | 5,601.70 | 5,601.70 | 5,523.70 |
| INV-64353 | Twelve Academy | 2026-10-07 | 37.36 | 37.36 | 0.00 |

## Appendix C — Bills posted to QuickBooks twice (July 2026)

State is from the Sept 18 QuickBooks snapshot; "both paid" rows each carry a linked payment on
both copies.

| Vendor | Vendor invoice # | Sports Inc doc # | Amount | State |
|---|---|---|---:|---|
| AUGUSTA SPORTSWEAR/ASI | 030578217 | 24639913 | 3,407.35 | both open |
| RICHARDSON CAP CO | 4674648 | 24646416 | 610.40 | both open |
| AUGUSTA SPORTSWEAR/ASI | 030553317 | 24606887 | 578.78 | both open |
| AGRON INC. | 100982990 | 24621130 | 472.72 | both open |
| AGRON INC. | 100982117 | 24616497 | 320.44 | both open |
| AGRON INC. | 100984590 | 24632638 | 293.55 | both open |
| AGRON INC. | 100975472 | 24611511 | 249.59 | both open |
| ADIDAS US TEAM SERVICES | 6165858589 | 24644511 | 222.77 | both open |
| AGRON INC. | 100984970 | 24632739 | 211.79 | both open |
| AGRON INC. | 100985131 | 24632755 | 211.79 | both open |
| AUGUSTA SPORTSWEAR/ASI | 030583783 | 24646593 | 123.98 | both open |
| AGRON INC. | 100986163 | 24638206 | 121.07 | both open |
| AUGUSTA SPORTSWEAR/ASI | 030553557 | 24606999 | 71.08 | both open |
| AGRON INC. | 100983085 | 24621147 | 67.01 | both open |
| SCHUTT SPORTS | 3005241 | 24604087 | 3,427.20 | both paid |
| SCHUTT SPORTS | 3006299 | 24616100 | 2,056.32 | both paid |
| RICHARDSON CAP CO | 4665290 | 24606713 | 1,760.98 | both paid |
| RICHARDSON CAP CO | 4666864 | 24611525 | 679.49 | both paid |
| RICHARDSON CAP CO | 4670528 | 24628659 | 641.17 | both paid |
| ADIDAS US TEAM SERVICES | 6165782128 | 24603659 | 616.15 | both paid |
| ADIDAS US TEAM SERVICES | 6165782126 | 24603658 | 571.82 | both paid |
| ADIDAS US TEAM SERVICES | 6165781592 | 24605931 | 558.59 | both paid |
| TWIN CITY KNITTING CO | 00320994 | 24628589 | 514.32 | both paid |
| ADIDAS US TEAM SERVICES | 6165776466 | 24605207 | 489.43 | both paid |
| ADIDAS US TEAM SERVICES | 6165781588 | 24605927 | 331.65 | both paid |
| ADIDAS US TEAM SERVICES | 6165781589 | 24605928 | 267.39 | both paid |
| ADIDAS US TEAM SERVICES | 6165776462 | 24605204 | 262.07 | both paid |
| ADIDAS US TEAM SERVICES | 6165808964 | 24626433 | 123.50 | both paid |
| ADIDAS US TEAM SERVICES | 6165795209 | 24615331 | 101.22 | both paid |
| ADIDAS US TEAM SERVICES | 6165806804 | 24620387 | 82.32 | both paid |
| ADIDAS US TEAM SERVICES | 6165808965 | 24626434 | 78.14 | both paid |
| ADIDAS US TEAM SERVICES | 6165782130 | 24603660 | 66.80 | both paid |
| ADIDAS US TEAM SERVICES | 6165776457 | 24606006 | 55.46 | both paid |
| ADIDAS US TEAM SERVICES | 6165795206 | 24615329 | 44.52 | both paid |
| ADIDAS US TEAM SERVICES | 6165840326 | 24637957 | 44.12 | both paid |
| ADIDAS US TEAM SERVICES | 6165806799 | 24620384 | 44.07 | both paid |
| ADIDAS US TEAM SERVICES | 6165781591 | 24605930 | 36.53 | both paid |
| ADIDAS US TEAM SERVICES | 6165811249 | 24626714 | 21.44 | both paid |
| ADIDAS US TEAM SERVICES | 6165808962 | 24626432 | 19.53 | both paid |
