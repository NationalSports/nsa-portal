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

## 4. Resumable production batches

Process dependencies in this order:

1. customers and vendors;
2. NonInventory SKU items;
3. estimates and purchase orders;
4. invoices and bills;
5. payments;
6. read-back reconciliation.

Start with 20 records per batch and concurrency 1 for posting transactions. Persist success or failure after every record. A new run skips exact verified successes and resumes the remaining records. A browser retry or duplicate click must query QBO by stored ID or document number before creating anything.

After a clean 20-record pilot, continue in batches of 20. Increase concurrency only for independent non-posting records and only after error/rate-limit results are clean. Do not depend on one long browser request to process the entire migration.

Retry 429 and transient network/5xx errors with bounded exponential backoff and jitter. Respect `Retry-After`. Do not automatically retry account, tax, duplicate-conflict, or payload validation errors; mark them for review.

## 5. Completion checks

The migration is complete only when:

- every source record is succeeded, intentionally excluded, or explicitly in needs-review;
- no duplicate portal source IDs or QBO document numbers exist;
- QBO read-back totals equal portal totals by transaction type;
- 40000, 40200, 51000, 51300, 52000, 58000, 67000, 11000, 11010, 21100, and the state tax balances agree with the approved manifest;
- all successful canary and production records retain their QBO IDs;
- the final reconciliation report is saved for audit.

## Still needed before the full historical push

- the official portal/QBO cutover date;
- exact scope for closed history, paid historical invoices, unpaid bills, and payments;
- live QBO TaxCode/TxnTaxDetail results;
- the portal source for outbound UPS/FedEx expenses;
- confirmation that 51300 has been changed to Cost of Goods Sold in live QBO.
