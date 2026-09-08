# Stripe accounting verification

The QuickBooks page’s Stripe Payouts tab now includes **Stripe Connection & Payment Verification** above the existing payout ledger.

## Setup and live check

This uses the portal’s existing server-only `STRIPE_SECRET_KEY`, independently of any Codex Stripe plugin. No new database tables or browser credentials are required. The server key needs read access to the Stripe account, balance, PaymentIntents and expanded charges. Do not replace the existing payment-processing key with a read-only key: other portal functions use it for payment operations.

After deploying, sign in as an active accounting or admin team member. Click **Check Stripe connection** and confirm the displayed account is `acct_1ApgafAMQp5OHLq6` and shows LIVE. Available and pending balances are current Stripe API values, displayed separately by currency. Charges/payouts enabled are Stripe account flags, not evidence that QuickBooks is connected.

Choose dates and click **Verify payments**. Dates are inclusive UTC dates filtering PaymentIntent creation time, not settlement, payout, or invoice date. Each request checks 25 PaymentIntents; keep selecting **Next 25 payments** until “End of results” to inspect the entire selected range. Summaries apply only to the displayed page. January 1, 2024 can be selected for historical review.

## Meaning of a match

A portal record matches only when a live USD PaymentIntent succeeded, its expanded latest charge is available without refund/dispute flags, all metadata invoice IDs exist, each has exactly one positive payment row with the exact `Stripe <PaymentIntent ID>` reference, there are no extra invoice allocations under that reference, and the sum equals Stripe’s captured amount in cents. Multi-invoice payments are supported. Missing audit rows remain exceptions even when an invoice balance happens to be zero.

Other currencies, test payments, incomplete payments, unreferenced/webstore payments, refunds, disputes, duplicates and differences require review. Webstore/payout activity remains available in the existing payout reconciliation section. Checks do not repair payment rows, collect/refund funds, post to QuickBooks or change webhook settings. A matched invoice payment is not a QBO or bank match. Historical refund/dispute events, legacy Charges without PaymentIntents, and payments created before the selected date are outside this view.

## Security and validation

The endpoint checks the existing accounting/admin role gate before requesting Stripe or database data. Responses allowlist evidence fields, omit client secrets/customer payment details, and disable caching. Database reads use exact-count pagination and fail closed on incomplete reads. Stripe/database failures produce an error, never a successful verification result.

Tests cover role denial, split payments, missing/duplicate/wrong allocations, amounts, currency, refunds/disputes, test mode, missing charge evidence, pagination/date boundaries, sanitized responses, database failure and the UI’s connection/pagination/error flow.

## Automatic issue-only monitoring

The existing production `stripe-reconciliation-sweep` scheduled function now includes invoice verification at 09:17 UTC daily (2:17 AM Pacific daylight time / 1:17 AM standard time). No additional scheduler or database migration is required. Deployment of this PR is required before these invoice checks run.

It scans successful live invoice PaymentIntents created in the preceding seven days, excluding those created within the last hour to allow finalization/webhook retries. It follows Stripe pages and rechecks earlier unresolved payment incidents individually. Ordinary abandoned checkouts and webstore payments without invoice metadata do not generate invoice alerts. Existing webstore/payout monitoring remains in place. This is ongoing monitoring, not the January 2024 historical migration or an audit of every historical payment; use the manual date-range check for older history. Refunds/disputes on older previously healthy invoice payments are outside this invoice lookback.

Findings join the existing durable reconciliation incident/outbox pipeline. Healthy runs create no email. Open issues produce a consolidated email with the invoice IDs, payment reference and review reasons, with reminders limited by the existing nightly/23-hour deduplication window. A successful recheck resolves the issue. Recipient precedence is `STRIPE_RECONCILIATION_ALERT_EMAIL`, then `SYSTEM_HEALTH_ALERT_EMAIL`, then `steve@nationalsportsapparel.com`; delivery uses the existing Brevo configuration. No test email is sent by building or testing the PR.

A scan time/page limit or Stripe API failure raises an incomplete-monitor issue and preserves unrechecked findings. It never reports a truncated scan as healthy. The existing Netlify 26-second limit is shared with payout work; invoice work checks a five-second deadline, with Stripe requests limited to three seconds and no automatic network retries. Hard function termination or database/email-provider outages can prevent email delivery; deployment/function logs must be monitored separately for those infrastructure failures.
