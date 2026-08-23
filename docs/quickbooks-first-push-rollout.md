# QuickBooks first-push rollout plan

## Goal

Prove the chart-of-accounts routing with a tiny, reviewable sample, then move the full backlog with resumable batches. No browser tab, function timeout, rate limit, duplicate click, or partial failure may cause a duplicate transaction or lose the run's position.

## Stage 0 — deployment prerequisites

1. Apply and verify `supabase/migrations/00134_qb_oauth_tokens.sql` before connecting QBO. The application expects server-side OAuth token storage.
2. Connect the intended QBO company and record the company/realm ID in the run manifest.
3. Run account preflight. Every required account number must exist exactly once, be active, and have the expected QBO account type.
4. Resolve the taxable-invoice design before enabling taxable invoice pushes. A QBO TaxCode/TxnTaxDetail mapping is required; 25201 must not be faked as a sales line.
5. Confirm opening-balance/cutover dates so historical and portal-created transactions cannot overlap.

## Stage 1 — dry run (zero QBO writes)

The UI should create an immutable preflight manifest with a run ID and show:

- source counts by entity and transaction type;
- exact debit/credit account preview for every posting type;
- QBO IDs already linked in the portal;
- duplicate source IDs, duplicate document numbers, and duplicate QBO candidates;
- missing customers, vendors, items, PO/SO links, account mappings, or dates;
- bill line-to-document-total discrepancies;
- taxable invoices blocked pending QBO tax-code mapping;
- estimated API call count, batch count, and completion time range.

Dry run is the default action. It must use the same payload builders and validators as the real push; it may only replace the final API write with a recorded preview.

## Stage 2 — controlled canary

The approved first test is a live-company canary of 3–5 explicitly selected real records, but only after the portal has read the live company, account list, vendors, customers, items, and likely duplicate document numbers with zero writes. A sandbox rehearsal remains optional if the live preflight exposes setup uncertainty.

The live canary should include, when available:

- one merchandise bill with freight and Sports Inc fee;
- one outside-decoration bill with freight;
- one tax-exempt invoice that includes customer-billed shipping;
- one inventory item/adjustment;
- one customer payment.

Every canary transaction carries `NSA-QB-CANARY:<run_id>` in its memo/private note and its normal portal source ID as the idempotency key. Successful real canaries are marked complete and excluded from the later full run. After pushing, the UI reads each transaction back from QBO and compares total, vendor/customer, date, document number, line accounts, A/R or A/P side, and payment deposit account.

The portal pauses after the canary. The operator opens each record in QuickBooks and supplies screenshots/photos of the transaction detail and account impact. The operator must explicitly approve both the API read-back report and the visual QBO review before the production queue can start. Canary approval never auto-starts the full run.

## Stage 3 — production queue

### Durable job model

Add durable `qb_sync_runs` and `qb_sync_run_items` tables. A run item contains source entity/type/ID, payload hash, dependency IDs, state, attempt count, next-attempt time, QBO ID, last error, and timestamps. Use a unique constraint on `(qbo_realm_id, entity_type, source_id)`.

The browser creates, pauses, resumes, and monitors a run. A server-side worker performs writes. Closing the tab cannot stop or lose the migration.

### Ordering and batches

Process dependencies in this order:

1. account and connection preflight;
2. customers and vendors;
3. QBO items/inventory setup;
4. estimates and purchase orders (non-posting);
5. invoices and bills;
6. payments and inventory adjustments;
7. read-back reconciliation.

Start with batches of 20 and concurrency of 2. Make both settings configurable without a deploy. Each worker invocation claims only enough work for a short execution window, checkpoints every item, and schedules the next invocation. This avoids relying on a single long-running Netlify request.

### Idempotency and retry rules

- Query by stored QBO ID or portal document number before every create retry.
- Persist the QBO ID immediately after a successful create, before advancing the queue.
- A repeated click or worker retry must return the existing result, never create a second transaction.
- Honor QBO `Retry-After` on rate limits. Retry 429 and transient 5xx/network failures with exponential backoff and jitter.
- Refresh OAuth once on an authentication failure, then retry. Pause the run if refresh still fails.
- Do not retry account, payload, tax, duplicate, or other validation 4xx responses automatically. Move them to `needs_review` with the exact QBO error.
- Cap automatic attempts and support operator retry after correction.

### Operator controls

- Dry run / canary / production modes are visibly distinct.
- Show queued, running, succeeded, needs-review, retrying, and remaining counts.
- Pause stops new claims but lets in-flight requests finish.
- Resume continues from checkpoints.
- Cancel never deletes QBO records; it only prevents remaining queue items from starting.
- Export a final CSV/JSON reconciliation report containing source ID, QBO ID, amount, accounts, status, attempts, and error.

## Stage 4 — completion gates

The migration is complete only when:

- every queued item is succeeded or explicitly dispositioned;
- source totals equal QBO totals by transaction type and account;
- no duplicate portal source IDs or QBO document numbers exist;
- all successful transactions pass read-back checks;
- A/R, A/P, inventory asset, purchases, freight, outside decoration, Sports Inc fee, inventory loss, sales, deposits, and sales-tax liability reports agree with the approved manifest;
- the final report and run configuration are retained for audit.

## Recommended rollout sizes

1. Dry run: full population, no writes.
2. Canary: 3–5 selected records.
3. Pilot: 20 records, concurrency 1.
4. Ramp: 100 records, batches of 20, concurrency 2.
5. Full: continue batches of 20; increase concurrency only after rate-limit and error metrics remain clean.
