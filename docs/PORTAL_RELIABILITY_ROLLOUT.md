# Portal audit fixes and release gates

This branch implements the nine findings in the Portal code review. It has not
been deployed and has not modified production records. Live schema history must
be checked before rollout; the connected Supabase query/deployment tools were not
available during implementation.

| Finding | Changed behavior |
| --- | --- |
| F1 public core order reads | A fixed-column, customer-scoped gateway replaces direct public core-table reads. Hash-only credentials support new opaque links and gradual legacy-link revocation. Public configuration is restricted to branding and portal settings. |
| F2/F3 Stripe retry and ledger failures | One transaction records original cent allocations, invoice balances and payment history. Retries reuse allocations; failures propagate to Stripe and the portal. Ambiguous historical partial applications stop for accounting review. |
| F4 contact replacement | Parent and contacts commit together. An explicit empty list deletes contacts; a failed or unhydrated list cannot erase them. |
| F5 stale invoice edits | The database checks the version under a row lock. Failed creates carry a persistent random identity and exact draft fingerprint so a lost response cannot silently duplicate an invoice or acknowledge a different draft. |
| F6 promo/credit allocation | The database locks balances, validates ledger counters, allocates funds and records usage together. Pending allocations remain visible. Funded documents require funds to be removed and saved before deletion. |
| F7 outbox acknowledgment | Each staged draft has a revision. Old responses and coalesced saves cannot remove a newer revision; reminted document IDs retain correct recovery keys. |
| F8 deletion persistence | Required estimate-art deletions are checked, firm-date replacement is transactional, and invoice payment history rejects destructive edits. Unpaid invoice splits commit both invoices together. |
| F9 diagnostic exposure | The Richardson diagnostic requires an active staff session and an allowed method. |

## Release sequence

1. Check the production migration inventory and table/column definitions against
   this branch. Review new migration preconditions using a database copy. Fund
   counter/usage discrepancies, overdrawn balances, duplicate live conversions,
   or duplicate normalized legacy tags must be reconciled deliberately; the
   migrations stop rather than choosing or rewriting historical money records.
2. Apply the new save, settlement, allocation, invoice-split and create-identity
   migrations, plus the credential compatibility migration. Deploy compatible
   Netlify functions/browser code and the `coach-store-submit` Supabase Edge
   Function. New save paths fail closed if their required RPC is absent.
3. Follow [PORTAL_CREDENTIAL_ROLLOUT.md](PORTAL_CREDENTIAL_ROLLOUT.md) for the exact
   gateway verification, core read lockdown, public configuration restriction,
   and per-customer legacy credential rotation. Do not apply every pending
   migration at once before deploying the compatible gateway.
4. Verify staff customer/invoice saves, explicit contact removal, stale-tab
   conflict recovery, an unpaid split, estimate conversion and fund removal on
   disposable staging records. Verify two unrelated portal credentials cannot
   read or act on each other's documents, and verify card/ACH settlement using
   Stripe test mode. Run browser checks on both editor variants.

There is no automatic production rollback in this change. Once public reads are
revoked, keep the scoped gateway available; deploying an older browser alone
would break portals. Prefer a forward correction over restoring broad public
access. Do not delete immutable payment applications to make an error disappear.

## Offline verification

The transaction workflow uses a pinned PostgreSQL 17.5 PGlite runtime in an
isolated database and requires no production secrets. It executes the actual
migration functions, rollback fixtures, role switches and repeat-payment cases.
The `scripts/pgtest/portal_audit_scenarios.cjs` and
`scripts/pgtest/fund_allocation_scenarios.cjs` runners accept `PGLITE_MODULE` as the
path to an independently installed `@electric-sql/pglite@0.3.14` package.

PGlite has one connection. These tests verify real SQL execution, rollback and
sequential retry behavior; they do not prove two-session blocking/deadlock
behavior. That remains a staging gate on PostgreSQL/Supabase. The Deno Edge
Function was inspected and covered by source tests; a Deno runtime was unavailable.

## Remaining scope

- The full sales-order save still spans multiple transactions. Stale versions
  already present at its precheck are rejected, but the complete save is not
  protected by a single database compare-and-swap transaction.
- The localStorage outbox still lacks a cross-tab atomic transaction. Revision
  checks fix delayed acknowledgment and coalescing races, not arbitrary
  simultaneous whole-storage writes or storage exhaustion.
- Public staff-directory and roster-table reads remain exposed as described in
  the credential rollout document. This branch is not a complete security audit
  or lockdown of every public feature.
- Historical partial Stripe applications and fund-counter discrepancies need
  accounting review. The fixes prevent guessing at those records.
- Posted payments cannot be edited/deleted through a full-invoice snapshot.
  Paid/credited/deposit invoices cannot use the unpaid split workflow; an
  auditable accounting adjustment is required.
