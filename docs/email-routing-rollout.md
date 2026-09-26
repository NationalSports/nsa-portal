# District email routing rollout

Interactive sends and automatic follow-ups now use `_emailRouter.js`. It reads all pages of estimate, sales-order, invoice and artwork send history. An unavailable history table stops the send instead of guessing. No database migration is required.

## Behavior

- Only diagnosed sender blocks switch a district to Gmail. Temporary and unknown failures do not.
- A reasonless Brevo suppression is held for administrator review, rather than being treated as proof of a district-wide block.
- Known invalid mailboxes, opt-outs and spam complaints stop the entire send, including CC/BCC. These checks use recorded history; they are not a complete synchronization of Brevo's external suppression list.
- Linked attachments on a Gmail route stop with instructions to upload a file. They never fall back to Brevo.
- Reminders preserve the unsubscribe footer and one-click headers on both providers.
- A later Brevo delivery/open for the same address clears its old sender-block evidence. A Gmail success does not clear a Brevo block.
- An uncertain delegated send does not fall back and risk a duplicate.

## Temporary administrator overrides

Set `EMAIL_ROUTING_OVERRIDES` in the server environment to a JSON array. For example:

```json
[{"target":"coach@district.example","route":"gmail","reason":"District IT confirmed a Brevo sender block; no opt-out","reviewUntil":"2026-10-30T00:00:00Z"}]
```

`target` may be an exact address or domain; `route` is `gmail` or `brevo`. Reason and expiry are mandatory. Expired entries are ignored and history-based policy resumes. Only an exact-address Gmail override resolves a reasonless suppression. Overrides never clear a recorded opt-out, complaint or invalid mailbox. Review the original Brevo rejection before adding one. A `brevo` override can temporarily test a repaired sender block without deleting history. The pre-send browser notice is advisory; the server policy remains authoritative.

## Delivery visibility

Gmail sends say **Sent through Gmail — delivery unconfirmed**. The existing staff delivery poll now checks the shared Gmail mailbox for correlated permanent delivery-status reports and uses the existing failure alert/dashboard flow. It matches the original Message-ID and failed recipient, never the subject alone. No bounce is not proof of delivery.

This is a bounded check of the 20 most recent mailer-daemon/postmaster reports within 30 days, with a one-minute cache; the staff portal polls recent sends while open. Unrecognized report formats, older reports beyond this window, and sends from delegated rep mailboxes remain unconfirmed. Rep delegation retains its send-only scope; this change does not grant inbox access. A full background delivery ledger/webhook integration remains separate work.

## Scheduled sends: deploy in order

The Supabase Edge worker is deployed separately from Netlify. Keep `REACT_APP_ROUTED_SCHEDULED_EMAILS` unset until these steps are complete:

1. Deploy the Netlify changes, including `scheduled-email-send` and existing Gmail OAuth settings.
2. Set the Supabase worker's `EMAIL_ROUTER_URL` to the production Netlify site's `/.netlify/functions/scheduled-email-send` URL. It must be HTTPS. Set the same `INTERNAL_FUNCTION_SECRET` on both services if used; otherwise both use their existing service-role key. Never put either secret in a `REACT_APP_` variable.
3. Deploy `supabase/functions/send-scheduled-emails`. Its existing cron remains unchanged. It now claims pending rows before sending. A crash leaves `processing` for operator review; an uncertain result becomes `failed` rather than auto-retrying a possibly delivered message. Check provider history before resetting either state.
4. Validate a controlled scheduled send, then set `REACT_APP_ROUTED_SCHEDULED_EMAILS=true` in Netlify and rebuild. Only then will the UI allow scheduling to known blocked districts.

Do not point the production worker at a deploy-preview URL. No production secrets, migrations, worker deployments or live customer sends were performed as part of the code review fixes.

## Live acceptance checks

Coordinate one expected test with each affected district, confirm PDF receipt and replies reaching the rep, and inspect provider rejection details if it fails. Check Brevo sender-domain authentication and work with district IT on approved sender allowlisting. Do not use Gmail to bypass unsubscribes or spam complaints. Test a controlled invalid recipient to verify a returned DSN is reflected in the portal.
