# Customer email preparation pilot

Enabled only for Steve's team-member id in `_repEmailWork.PILOT`. Other mailboxes retain their current inbox behavior.

New important customer quote/order/stock messages queue a Netlify background function after import. The preview checks mail once per minute while My Email is visible. Netlify schedules run on production only; a closed preview does not discover incoming mail. Once queued, preparation continues without an open browser. Older messages can be prepared using **AI prepare estimate**.

Preparation reads up to 20 messages / 50,000 text characters from the connected rep's Gmail thread. Attachment names are included, but attachment contents are not parsed. The model extracts requests, not product IDs or prices. Exact, unambiguous SKU + supplied color/brand matches can be selected automatically. Other products require review and can be searched in the full catalog. Pricing uses the portal's shared tier/markup calculator, including clearance cost. Decoration, size upcharges, tax, shipping and availability still require review.

`rep_email_work` stores one prepared request per owner/thread, with a revision and source insight. Superseded workers cannot overwrite newer revisions. Failed dispatches are visible and can be retried; stuck processing can be retried after ten minutes. Browser edits carry their original revision and are preserved when a newer preparation arrives.

Stock in background preparation comes from `inventory_unified` for supported Adidas/Agron/UA/Nike snapshots, with source timestamps. **Check stock** also runs the existing live supplier adapters where supported. Unknown availability remains unknown, not zero. Stock is not reserved. Momentec's available flag is never displayed as a literal 999-unit quantity. Live stock is a temporary UI lookup; the durable stock record contains supplier snapshots.

**Create draft estimate** calls a service-only SECURITY INVOKER RPC that locks the preparation, creates the estimate and items transactionally, and links the same estimate to the conversation. Repeated calls return the same estimate. Existing estimates are never overwritten by preparation or follow-up emails. Draft creation does not send, order, allocate inventory, or create purchase orders. A suggested reply opens the normal signature-enabled composer and still requires draft review and explicit sending.

## Validation

- `node --test scripts/tests/rep-email-work.test.cjs scripts/tests/rep-gmail-routing.test.cjs scripts/tests/customer-email-filter.test.cjs scripts/tests/rep-gmail-reply.test.cjs`
- `CI=true npm test -- --runInBand --watchAll=false --runTestsByPath src/__tests__/customerEmailWork.test.js`
- `GENERATE_SOURCEMAP=false npm run build`
- Database transaction rollback tests verified one estimate on repeated calls, child items, draft status and client grants. Separate authenticated-role checks verified owner-read and non-owner denial.

## Existing estimate removal revisions

Steve’s pilot can prepare removal of entire lines from an existing estimate. The model must identify the source Gmail message and quote exact authored customer text; quoted history is stripped before extraction. Partial reductions, additions and mixed changes remain manual. The server verifies the estimate reference against the thread or existing link, customer, status and unique line matches. Ambiguous references/lines require manual review. An absent line is reported as already removed only when the estimate audit confirms the removal. Converted estimates, approved/other statuses, credits, promotions and decoration purchase orders are blocked.

Review shows the original account, estimate and exact removed lines, plus before/after totals computed with `calcOrderTotals`, the portal’s existing calculator. It uses existing line prices and recalculates decoration volume pricing, shipping and tax. Size upcharges and pricing settings still require editor review; attachments are not parsed. No suggested reply is generated for revisions, so the CRM cannot imply that the revision has already been completed or sent.

**Create reviewed revision draft** explicitly creates a separate numbered draft, cloning retained items, artwork and decorations with independent ids. The original sent estimate is untouched. The service-only, SECURITY INVOKER RPC locks the preparation and original estimate, verifies the entire saved graph, rejects conversion or stale data, and creates all records transactionally. `rep_email_estimate_revisions` retains the full original graph, exact removed rows, original/revised ids, owner and source email. Owner-only read policies apply. Identical removals of the same source snapshot in the same Gmail thread return the existing draft on repeated clicks or follow-up preparation. Further changes to the original require fresh review. Sending and conversion remain separate normal editor actions.

Migration: `20261002145159_rep_email_estimate_revisions.sql`. Rollback verification: wrap the migration and `scripts/tests/rep-email-revision.rollback.sql` in one transaction when testing before application, or run `begin;` followed by that script after application. The synthetic fixture verifies draft status, unchanged original, retained decoration/art links, deduplication, owner checks, stale review/status rejection, conversion blocking and RPC grants, then rolls back. No real customer quote is revised by the test.

Additional validation: `node --test scripts/tests/rep-email-revision.test.cjs`, plus the existing Node/React suites and production build. Live signed-in customer UI verification remains required; the cloud preview was signed out during this session.
