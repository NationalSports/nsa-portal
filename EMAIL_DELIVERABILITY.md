# Email deliverability (school districts)

School and district filters (Google Workspace for Education, Microsoft 365,
Barracuda, etc.) are stricter than consumer Gmail. Most blocks we see are
**authentication / sender reputation**, not content bugs in the portal.

## Live DNS diagnosis (2026-07-09)

Checked public DNS for `nationalsportsapparel.com`:

| Check | Status | Notes |
|-------|--------|--------|
| MX | OK | Google Workspace (`aspmx.l.google.com`, etc.) |
| Brevo domain verify TXT | OK | `brevo-code:…` present |
| Brevo DKIM | OK | `brevo1` / `brevo2` CNAMEs → Brevo |
| **SPF** | **MISSING** | No `v=spf1` TXT on the root domain |
| **Google DKIM** | **MISSING** | No `google._domainkey` (or similar) record |
| DMARC | Weak | `p=none` only — monitors, does not enforce |

**This is why `steve@`, `chase@`, and other work mailboxes get blocked** even when
mail is sent from Gmail/Google Workspace (not just portal/Brevo mail). Districts
fail or quarantine unauthenticated Google mail. Portal/Brevo mail can still
DKIM-pass via Brevo’s keys, but work mail has neither SPF nor Google DKIM.

Code changes below help portal sends. **They cannot fix steve@/chase@** — that
requires the DNS steps in the next section.

## Fix work email (Google Workspace) — do this first

Add these DNS records at your domain registrar / DNS host. Wait ~15–60 minutes,
then retest.

### 1. SPF (required)

One TXT record on `@` / `nationalsportsapparel.com`:

```
v=spf1 include:_spf.google.com include:spf.brevo.com ~all
```

- `include:_spf.google.com` — authorizes Gmail / Google Workspace (steve@, chase@, …)
- `include:spf.brevo.com` — authorizes portal / Brevo transactional sends
- Use **exactly one** SPF TXT record. If an SPF record already exists elsewhere,
  merge into this single line — multiple SPF records break authentication.

### 2. Google DKIM (required)

1. Google Admin → Apps → Google Workspace → Gmail → **Authenticate email**
2. Generate a new DKIM key for `nationalsportsapparel.com`
3. Publish the TXT (or CNAME) record Google shows (usually
   `google._domainkey.nationalsportsapparel.com`)
4. Click **Start authentication** in Admin after DNS propagates

Without this, school filters often treat Workspace mail as unauthenticated even
when SPF is present.

### 3. DMARC (tighten after SPF+DKIM pass)

Current record:

```
v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com
```

Keep `p=none` for a few days while you watch reports, then move to:

```
v=DMARC1; p=quarantine; pct=100; rua=mailto:rua@dmarc.brevo.com; adkim=r; aspf=r
```

and later `p=reject` once reports show clean Google + Brevo alignment.

### 4. Verify

1. Send from `steve@` (or chase@) to a personal Gmail → open the message →
   **Show original** → confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`
2. Repeat to a known school address
3. Google Admin Toolbox → [Check MX](https://toolbox.googleapps.com/apps/checkmx/)
   for `nationalsportsapparel.com`

## What we changed in portal code

1. **Default From is `hello@nationalsportsapparel.com`**, not `noreply@`.
   Override with env `BREVO_DEFAULT_SENDER` if needed.
2. **When a rep has an `@nationalsportsapparel.com` address**, school-facing
   mail (estimates, invoices, follow-ups, art approval) sends **From that rep**
   and keeps Reply-To aligned — person-to-person beats bulk/noreply heuristics.
3. **Emoji stripped from outbound subject lines** that hit coaches/staff
   (approval notifications, buyer replies, chargebacks).
4. Shared helpers: `netlify/functions/_emailSender.js` and
   `resolveBrevoSender` in `src/utils.js`.

These only affect Brevo/portal sends. Work Gmail still depends on SPF + Google
DKIM above.

## Ops checklist

1. Publish **SPF** + **Google DKIM** (section above) — unblocks steve@/chase@.
2. Confirm `hello@`, `stores@`, `accounting@`, and rep addresses are verified
   senders in **Brevo**.
3. Tighten **DMARC** after auth is clean.
4. Ask district IT to **allowlist** `@nationalsportsapparel.com` only if a
   specific school still quarantines after headers show PASS.
5. Prefer **portal links over large PDF attachments** when a district strips
   attachments.
6. Watch Brevo **bounces / blocks / spam complaints** and remove dead
   `.edu` / `.k12.*` addresses from contacts.

## Quick verification (portal mail)

1. Send a test estimate to a personal Gmail and a known school address.
2. Check message headers: SPF/DKIM/DMARC should pass and From should be
   `hello@…` or the rep’s NSA address (not `noreply@`).
3. In Brevo → Transactional → Logs, confirm the message was accepted (not
   blocked/deferred by the destination).
