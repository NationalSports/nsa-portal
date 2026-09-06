# QuickBooks first-push rollout plan

## Non-negotiable controls

- Read the connected company and live QBO chart before writing anything.
- Fail if any required account number is missing, inactive, duplicated, or the wrong account type.
- Use the portal document ID/number plus stored QBO ID as the idempotency key.
- Never mark a portal transaction applied until the QBO create/update succeeds or an exact existing QBO record is verified.
- Reconcile every bill's categorized lines to its document total before sending.
- Keep taxable invoices blocked until live QBO tax-code behavior is verified.

## 1. Read-only preflight

The first action makes zero QBO changes. It records the company name and realm ID, resolves every approved account by account number, counts relevant QBO entities, and checks existing customers, vendors, items, document numbers, and stored QBO links.

Preflight must specifically confirm that 51300 is now a Cost of Goods Sold account. If QBO still reports it as Expense, stop and ask Andrea to correct it.

## 2. Dry-run manifest

Run the complete backlog through the same builders and validators used for live writes, but stop before each API write. The report should contain source ID, document number, customer/vendor, date, total, every account/item line, dependency status, duplicate candidates, and the exact blocking error.

The dry run should report counts for:

- QBO NonInventory items by SKU;
- customers and vendors;
- estimates and purchase orders;
- invoices, bills, and payments;
- blocked taxable invoices;
- OMG vendor-bill fee manifests for 57000;
- OMG payout deposit manifests showing gross QBO Payment(s), 57000 OMG fee, 71400 processing fee, and the exact net received in the configured bank account;
- discounted invoice manifests showing gross sales in 40000 and the approved discount/credit in 40200;
- confirmation that 55200/55400 labor is excluded from Connect posting;
- Deposit Statements containing refunds, which remain blocked until their QBO credit-memo/refund links are complete;
- bills with missing SKUs or total discrepancies;
- duplicate source IDs or QBO document numbers.

## 3. Live canary

Select 3–5 real, easy-to-recognize records:

1. one merchandise bill with SKU quantity, freight, and a Sports Inc fee;
2. one outside-decoration bill with freight;
3. one tax-exempt invoice containing customer shipping;
4. one payment linked to that invoice;
5. one QBO NonInventory SKU item and, if useful, its PO.

Tag them `NSA-QB-CANARY:<run_id>`. Read each record back from QBO and compare document number, vendor/customer, date, total, SKU quantity, account lines, A/R or A/P control account, and payment deposit account.

Pause. The operator opens the records in QBO and sends screenshots/photos. Production remains locked until the API read-back and visual review are both approved.

## 3a. Blank portal payment terms

Most portal customers (2,338 of 2,540 active on September 6, 2026) have no payment terms saved, and the portal itself bills them as Net 30. The customer review handles that without guessing a financial term:

- A customer that already exists in QBO is linked with the QBO terms it has today. No QBO write happens, and the plan is marked "kept from QBO".
- A customer that is not in QBO yet, or whose QBO term is inactive, gets the reviewer's selected default, Net 30 (the portal's own due-date default, approved by Steve Peterson on September 6, 2026); the reviewer can switch the selector to Block before the review. The plan is marked "reviewer default", and the batch is rejected if the default changed after the review.
- Real portal terms always win over both.

Every receipt records `term_source` (`portal`, `qbo`, or `default`) so the choice is auditable.

Reading the review counters correctly matters here. With the selector on **Block**, a blank-terms customer is unblocked only if it already matches a QBO customer; everything else still counts as blocked, which is the pre-change behavior. With the selector on **Net 30**, those same rows become proposed creations. A Block-mode review is therefore a measurement of name matching, not of this control.

## 3c. Duplicate-creation guard

Exact matching is case- and whitespace-insensitive only, so `Crean Lutheran Boy's Volleyball` and `Crean Lutheran Boys Volleyball` were two different customers to it, and the second one would have been created as a duplicate in QBO. Before proposing a creation the review now also compares a looser key: apostrophes removed, `&` read as `and`, punctuation flattened, a leading `The` and trailing `Inc`/`LLC`/`Ltd`/`Co`/`Corp`/`Company` dropped. A hit blocks the row and names the QBO record and ID. It never links on that basis; a human decides.

Sibling accounts that genuinely differ (`Crean Lutheran High School` and `Crean Lutheran High School Staff`) still propose creation, and an inactive QBO near-match does not block.

## 3d. Name-match diagnostic

Customers tab, **Name Match Diagnostic — No QBO Changes**. It reads both customer lists and reports how many QBO records are claimed by a portal customer, how many are unclaimed, and how many portal customers have no QBO match, with a sample of the actual unmatched names on each side and a full downloadable comparison.

This exists because the counters cannot answer the question that gates the whole customer migration: when the portal fails to match a QBO customer, is that a naming difference or genuinely a different account? Creating on the wrong answer duplicates a live customer list. Run it before approving any batch that contains creations.

## 3b. Sales-tax setup read

The Invoices tab has **Read Sales Tax Setup — No QBO Changes**. It reads Preferences (Automated Sales Tax on or off), TaxCode, TaxRate, and TaxAgency, logs them to the sync log, and keeps a compact copy in `qb_config.taxPreflight`. It writes nothing and does not unblock taxable invoices; accounting still has to approve a mapping from those codes before any taxable invoice can post.

## 4. Resumable production batches

Process dependencies in this order:

1. customers and vendors;
2. NonInventory SKU items;
3. estimates and purchase orders;
4. invoices and bills;
5. payments;
6. read-back reconciliation.

Start with 20 records per batch and concurrency 1 for posting transactions. Persist success or failure after every record. A new run skips exact verified successes and resumes the remaining records. A browser retry or duplicate click must query QBO by stored ID or document number before creating anything.

Batch cursors rotate across customers, invoices, SKUs, estimates, and purchase orders. A permanent blocker in the first 20 records cannot prevent later records from being tested. Missing or impossible source dates block rather than defaulting into today's accounting period.

After a clean 20-record pilot, continue in batches of 20. Increase concurrency only for independent non-posting records and only after error/rate-limit results are clean. Do not depend on one long browser request to process the entire migration.

Retry 429 and transient network/5xx errors with bounded exponential backoff and jitter. Respect `Retry-After`. Do not automatically retry account, tax, duplicate-conflict, or payload validation errors; mark them for review.

## 5. Completion checks

The migration is complete only when:

- every source record is succeeded, intentionally excluded, or explicitly in needs-review;
- no duplicate portal source IDs or QBO document numbers exist;
- QBO read-back totals equal portal totals by transaction type;
- 40000, 40100, 40200, 51000, 51300, 52000, 57000, 58000, 71400, the configured bank account, 11000, 11010, 21100, and the state tax balances agree with the approved manifest;
- no posting uses retired account 67000;
- all successful canary and production records retain their QBO IDs;
- the final reconciliation report is saved for audit.

## Confirmed historical scope

- customer invoices and payments beginning with the confirmed 2026-09-01 cutover; QBO customer terms control due dates and the portal does not override them;
- currently unpaid vendor bills;
- paid/closed historical vendor bills, including SilverScreen, are excluded.

Before NetSuite transaction access ends, export the transaction saved searches with Internal IDs and all supporting File Cabinet documents. A NetSuite Full CSV Export alone is not a complete archive.

## Still needed before the full historical push

- live QBO TaxCode/TxnTaxDetail results;
- the portal source for outbound UPS/FedEx expenses;
- confirmation that 51300 has been changed to Cost of Goods Sold in live QBO.
