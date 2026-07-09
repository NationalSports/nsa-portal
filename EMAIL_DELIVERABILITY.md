# Email deliverability (school districts)

School and district filters (Google Workspace for Education, Microsoft 365,
Barracuda, etc.) are stricter than consumer Gmail. Most blocks we see are
**authentication / sender reputation**, not content bugs in the portal.

## What we changed in code

1. **Default From is `hello@nationalsportsapparel.com`**, not `noreply@`.
   Override with env `BREVO_DEFAULT_SENDER` if needed.
2. **When a rep has an `@nationalsportsapparel.com` address**, school-facing
   mail (estimates, invoices, follow-ups, art approval) sends **From that rep**
   and keeps Reply-To aligned — person-to-person beats bulk/noreply heuristics.
3. **Emoji stripped from outbound subject lines** that hit coaches/staff
   (approval notifications, buyer replies, chargebacks).
4. Shared helpers: `netlify/functions/_emailSender.js` and
   `resolveBrevoSender` in `src/utils.js`.

## Ops checklist (required for districts to accept mail)

These are **outside the repo** — DNS + Brevo dashboard:

1. **Authenticate the domain in Brevo** for `nationalsportsapparel.com`
   (SPF + DKIM). Confirm `hello@`, `stores@`, `accounting@`, and any rep
   addresses used as From are verified senders.
2. **DMARC** on the domain — start with `p=none` monitoring, then
   `p=quarantine` / `p=reject` once alignment is clean. Alignment failures
   are a common district hard-fail.
3. **Do not send From `nsa-teamwear.com`** for portal mail unless that domain
   is also authenticated in Brevo with matching SPF/DKIM/DMARC.
4. Ask district IT to **allowlist** `@nationalsportsapparel.com` (and/or
   Brevo’s sending IPs from their docs) when a specific school still
   quarantines after auth is green.
5. Prefer **portal links over large PDF attachments** when a coach’s district
   strips attachments — the send UI still attaches PDFs; reps can omit them
   for stubborn districts.
6. Watch Brevo **bounces / blocks / spam complaints**. Repeated sends to dead
   `.edu` / `.k12.*` addresses hurt domain reputation; remove bad addresses
   from contact records.

## Quick verification

1. Send a test estimate to a personal Gmail and a known school address.
2. Check message headers: SPF/DKIM/DMARC should pass and From should be
   `hello@…` or the rep’s NSA address (not `noreply@`).
3. In Brevo → Transactional → Logs, confirm the message was accepted (not
   blocked/deferred by the destination).
