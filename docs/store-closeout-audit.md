# Close Store adversarial and historical review — 2026-10-11

Status: automated checks pass; **not a production accounting sign-off**. Historical reconciliation and a staging end-to-end run remain release gates.

## Evidence examined (read-only)

- All 75 store-linked portal SOs: 53 OMG and 22 webstore (including three demo SOs).
- Their 501 linked checkout orders, 74 invoices, 45 payment rows, 937 items, 689 decorations and 161 jobs.
- Current production column definitions and invoice payment/version triggers; 51 distinct linked OMG report records; customer receipt balances and rep assignments.
- Seven real QuickBooks invoices and six associated payments; verified account 111 is 11010 Undeposited Funds.
- Four OMG deposit statements containing 34 lines. These import fees as negative amounts: gross + signed OMG fee + signed card fee = net, with zero arithmetic mismatches. Do not subtract those signed fees again. SO Accounting Report fees use positive cost values.

Exports contain only the fields needed for the replay and stay outside the repository. Production queries were SELECT-only. No production closeout, migration, invoice/payment mutation or bank transaction was executed.

## Historical replay

`scripts/pgtest/store_history_replay.cjs` reconstructs an isolated database using production column types/defaults and the actual payment/version triggers, loads the exported records, then applies the proposed migration. Every closeout runs in a transaction that is rolled back. Successful closes are retried and checked for unchanged invoice/payment counts and dollar totals. Failed closes are checked for complete rollback.

Of 75 attempts, 10 paid OMG SOs closed locally with **zero new invoices and zero new payments**. The other 65 stopped:

| Reason | SOs |
| --- | ---: |
| Unfinished production jobs | 18 |
| Invoice paid field disagrees with payment ledger | 13 |
| Multiple active invoices | 7 |
| Existing web invoice differs from current checkout totals | 7 |
| Multiple SOs for the same OMG store | 4 |
| No invoice draft supplied for an uninvoiced OMG SO in the historical replay | 4 |
| No linked checkout orders (demo SOs) | 3 |
| Refund/cancellation history | 3 |
| Product totals disagree with checkout collections | 2 |
| Partially applied funds require reconciliation | 2 |
| OMG report changed since SO creation | 1 |
| Missing/unreconciled OMG reports | 1 |

These are first-failure categories, not a claim that every blocked SO has only one issue. The four missing-draft cases are a replay coverage limitation, not an accounting defect. The replay deliberately does not mark real production jobs complete.

## Rehearsing the new deferred flow

For three selected orders, a separate local transaction removes the historical invoice/payment and finishes the local jobs to represent future pre-closeout state. The source prices/collections remain unchanged. This is a counterfactual rehearsal, not a statement about current fulfillment.

| Source SO | Invoice / applied funds | New invoices | New payments | Additional money on retry |
| --- | ---: | ---: | ---: | ---: |
| SO-2852, webstore | $319.03 | 1 | 1 | $0 |
| SO-2782, webstore | $405.91 | 1 | 1 | $0 |
| SO-2825, OMG | $7,020.00 | 1 | 1 | $0 |

SO-2825 also freezes $601.04 of OMG/card costs for commission calculations. The real corresponding QBO invoices (INV-64347, INV-64253, INV-64319) show those same invoice/payment amounts. Modern webstore QBO invoices separate collected tax into 25200 Sales Tax Payables; the linked payment clears the invoice through Undeposited Funds.

## Defects corrected during this pass

1. **Stale OMG reports:** SO-1250's SO snapshot has $750.41 collected, while the later source report has $1,170.16 and different fees. The server now locks the report and rejects disagreement with the SO instead of silently selecting one amount.
2. **Missing OMG costs in commission math:** the SO cost view included platform/card fees, but the commission calculation did not. Closeout now captures platform/card/invoiced fees in a protected field and the commission calculation includes that cost exactly once. Historical frozen commission snapshots are not silently rewritten.
3. **Untrusted invoice totals:** a modified browser request could supply internally consistent but incorrect OMG prices. New OMG invoices now have to reconcile to persisted SO item prices and shipping; inconsistent quantities/rates and custom-price differences stop for review.
4. **Cross-store source references:** a transaction-scoped source-reference lock serializes reuse of the same platform sale code even across different SO/store IDs.

The earlier review also fixed automatic Club/All School conversion compatibility, invalidation after child-only cost/job edits, refund handling, and malformed/auth-outage endpoint responses.

## Unresolved release gates

- **Existing QBO duplicate:** SO-1694 has INV-63982 and INV-64393, both $488.05, representing the same described order. INV-63982 remains open; INV-64393 is paid. Both include $445 of Sales and $43.05 of tax liability. This is pre-existing and was not changed. Portal guards alone cannot certify the absence of QBO-only duplicates.
- **Legacy webstore billing:** older invoices can contain product revenue only. Example: SO-2030/INV-63598 is $2,023, versus $2,266.86 in linked checkout order totals. Closeout blocks this difference rather than creating another invoice or silently changing previously posted revenue. Refunds/current pricing may also affect comparisons; accounting must determine the correction.
- **OMG gross-report remainder:** SO-2825 reports $8,079.77 collected while its historical invoice/payment is $7,020. This PR preserves the existing product-invoice basis and caps application at the invoice balance. It does not prove where the remainder (shipping/tax/processing/fundraising) is posted, or create an additional revenue/deposit entry for it. Reconcile that complete gross-to-ledger path before declaring production accounting complete.
- **Historical commissions:** 35 linked store commission snapshots already exist. Prior payouts and incomplete-cost snapshots require deliberate review; this change neither pays them again nor automatically restates historical statements.
- **End-to-end staging:** run a migrated staging database through the actual browser, Netlify endpoint and QBO sandbox, including simultaneous requests and a dropped-response retry. The local PGlite tests serialize requests and are not a true multi-connection concurrency load test. Other unrelated production triggers are not all reproduced in the replay.

## Repeatable checks

151 targeted tests passed across closeout, commissions, OMG ingestion/monthly profit, QBO payment push and account mapping. Synthetic PostgreSQL cases include retries, duplicate references, partial receipts, refunds, missing shipments/costs, stale header/child edits, changed OMG reports, altered invoice amounts, permissions and commission gating. The synthetic SQL suite runs in CI; the historical replay requires private exports supplied through `STORE_HISTORY`, `STORE_DETAILS`, and optionally `STORE_REPLAY_OUTPUT`.
