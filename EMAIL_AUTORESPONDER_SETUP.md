# hello@ Order-Status Auto-Responder — Setup & Rollout

Instantly answers team-store parents who email hello@nationalsportsapparel.com
asking where their order is. Code: `netlify/functions/hello-inbound.js` (webhook)
+ `netlify/functions/_orderInquiry.js` (order lookup/summary — shared with the
future website chatbot). Log table: `email_auto_replies` (migration 075).

## How it decides

Every inbound email is classified (Claude Haiku, keyword fallback) into a lane:

| Lane | What happens |
|---|---|
| **status** — "where's my order?" | Order # found in subject/body (7-digit store or 9-digit OMG), **or sender's address matches `buyer_email`** → instant reply: stage in plain English, tracking links, estimated ship date, private `/shop/order/<token>` page. No identifier → asks for the order number (their reply re-enters the same pipeline). Number given but not in the DB → "a person is on it" + staff alert (never asks twice). |
| **problem** — missing/wrong/damaged/refund/cancel | Short human-tone acknowledgment ("a real person will get back to you today") + order link, and a staff alert with the full email. Never sends a robotic status blurb to an upset customer. |
| **other** — POs, quotes, invoices, job applications | No reply. Logged only. (School districts never get botted.) |
| **automated** — alerts, newsletters, bounces, spam | No reply. Logged only. |

Safety rails: shared-secret webhook URL; skips anything from @nationalsportsapparel.com
(portal alerts CC hello@; live replies BCC it), no-reply senders, and auto-submitted
mail; idempotent per Message-Id; max 2 auto-replies per sender per 3 days; kill switch.

## One-time wiring (~15 min)

1. **Run migration 075** in the Supabase SQL editor
   (`supabase_migration_075_email_auto_replies.sql`).
2. **Brevo inbound parsing**: Brevo dashboard → Transactional → Settings → Inbound
   parsing → create an inbound domain/address (e.g. `hello@inbound.nationalsportsapparel.com`;
   Brevo will give MX instructions for that subdomain) and set the webhook URL to
   `https://nsa-portal.netlify.app/.netlify/functions/hello-inbound?key=<HELLO_INBOUND_KEY>`
3. **Gmail forwarding**: in the hello@ Google account → Settings → Forwarding →
   add the Brevo inbound address as a forwarding destination (Gmail sends a
   confirmation code — it will arrive at the webhook; check the function logs or
   the `email_auto_replies` snippet column to read it), then add a filter
   `to:(hello@nationalsportsapparel.com)` → "Forward to <inbound address>", and
   **keep Gmail's copy in the inbox** so nothing changes about how you read mail.
4. **Verify the sender**: make sure `hello@nationalsportsapparel.com` is a verified
   sender in Brevo (like stores@/noreply@ already are) so replies come from hello@.
5. **Netlify env vars** (portal site):
   - `HELLO_INBOUND_KEY` — any long random string (must match the webhook URL)
   - `AUTORESPONDER_MODE` — `shadow` (default) | `live` | `off`
   - `ANTHROPIC_API_KEY` — already the repo convention; strongly recommended
     (without it, a keyword fallback classifier runs)
   - Optional: `AUTORESPONDER_SHADOW_TO` / `AUTORESPONDER_ALERT_TO`
     (default steve@), `AUTORESPONDER_FROM` (default hello@),
     `TEAM_STORE_TURNAROUND_DAYS` (default 21 — days from store close to ship,
     used for the estimated ship date when nothing has shipped yet).

## Rollout

- **Week 1 — shadow mode** (`AUTORESPONDER_MODE=shadow`, the default): every
  would-be reply is delivered to `AUTORESPONDER_SHADOW_TO` instead of the
  customer, with a banner showing who it *would* have gone to. Real mail flows
  through the real pipeline; customers see nothing.
- **Go live**: flip `AUTORESPONDER_MODE=live`. Live replies thread under the
  customer's email and BCC hello@ so the conversation history stays visible in
  the shared inbox.
- **Kill switch**: `AUTORESPONDER_MODE=off` (still logs, never sends), or delete
  the Gmail forwarding filter.

## Measuring the win

Every inbound email and outcome is a row in `email_auto_replies`. Deflection rate =
`replied_status` rows ÷ all `status`-lane rows. `replied_number_not_found` rows point
at ingestion gaps (orders parents have receipts for that aren't in the portal).

## Estimated ship date — current logic & upgrade path

There is no promised-ship-date field on orders today. The reply estimates
`store.close_at + TEAM_STORE_TURNAROUND_DAYS` and phrases it as an estimate; if
that lands in the past (or the store has no close date), it says the order is
"in the final stretch" instead of inventing a date. If you want real per-store
promises later, add a `ships_by` column staff set per store and prefer it here.
