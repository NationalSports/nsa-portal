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
6. **Three security leftovers**: legacy QuickBooks token functions deployed without
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

Items 1–4 close the two live money gaps this week; item 15 closes the one silent-loss path. Item 5 is the structural fix and the largest
single reduction in daily accounting work; items 10 and 11 make everything after it cheaper.

---

## 6. Numbers used (all live, 2026-10-17)

| Measure | Value |
|---|---|
| Portal invoices / linked to QuickBooks | 1,415 / 1,369 |
| Portal open invoices / open balance | 550 / $1,541,150 |
| QuickBooks A/R overdue / 91+ days | $1,497,548 / $171,011 |
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
