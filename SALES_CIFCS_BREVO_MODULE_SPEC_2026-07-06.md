# Sales Tools — CIFCS Prospecting → Brevo Marketing Module (Spec)

**Date:** 2026-07-06 · **Branch:** `claude/brevo-cifcs-email-integration` · **Status:** Draft for review

A self-contained Sales Tools module that (1) ingests the CIFCS school directory
(athletic directors + coaches, by school and sport) into a staff-only prospect
store, and (2) runs compliant, throttled marketing sends through Brevo — reusing
the portal's existing locked email infrastructure rather than adding a new relay.

---

## 0. "Is a controlled module safer than just sending?" — Yes, and here's why

Short answer: **materially safer, because the guardrails stop being human discipline
and become code that runs on every send.** A module doesn't change the underlying
legal posture — this is still cold B2B outreach to contacts harvested from a public
directory — but it makes doing it *correctly* the default instead of the exception.

Concretely, a module lets us enforce, in code, the six things that actually protect us:

| Risk if done ad-hoc | What the module enforces automatically |
|---|---|
| Emailing someone who opted out / bounced | **Hard suppression gate** — every send is filtered against a global suppression list before it leaves. You cannot send to a suppressed address. |
| Blasting hundreds of emails at once → spam-trap hits, domain blacklisting | **Throttling / batching** — sends drip through the existing `scheduled_emails` queue at a safe rate. |
| Cold outreach reputation damage bleeding into order/receipt emails | **Sender isolation** — cold campaigns go from a dedicated subdomain/subaccount, never the transactional `noreply@nationalsportsapparel.com` identity. |
| Forgetting the legally-required unsubscribe / physical address | **Compliant template** — CAN-SPAM footer (one-click unsubscribe + postal address) is injected by the sender, not hand-added per email. |
| No record of who was emailed what, when | **Audit log** — every recipient/campaign/timestamp/result is a row. That log *is* your CAN-SPAM compliance evidence. |
| Brevo suspending the account over a scraped list | **One controllable choke point** — we can add double-opt-in, seed-list warmup, or complaint-rate circuit-breakers in exactly one place. |

So the module is the safe way to do this. The parts it *can't* fix are policy
decisions, not code — see §8 (compliance) and §11 (decisions for you).

---

## 1. Goal & scope

**In scope**
- Pull the CIFCS directory (all 13 sections, or a chosen subset) into a `marketing_contacts` table: school, role (AD/coach/etc.), name, email, phone, sport.
- Browse/segment prospects inside Sales Tools (by section, sport, role, school).
- Compose a branded campaign, preview, send a test, then send/schedule to a segment.
- Throttled delivery through Brevo with per-recipient logging, open tracking, one-click unsubscribe, and bounce/complaint suppression.

**Out of scope (non-goals for v1)**
- Two-way inbox / reply handling (Brevo inbound). Replies go to a real mailbox.
- Automated multi-step drip sequences (Phase 3 — the pattern exists, see §6.4).
- Converting prospects into `customers` automatically (manual "promote" button only).

---

## 2. The data source — what CIFCS actually exposes (verified 2026-07-06)

The URL you shared is a jQuery *widget*; the real data comes from two **unauthenticated
JSON endpoints** (no API key, no login). Both were hit live and confirmed:

**School search (typeahead)**
```
GET https://www.cifcshome.org/widget/schools/get?school=<query>&section_id=<n>&status=active&hide_from_directory=0
→ [{ "id": 1711, "name": "Bakersfield" }, ...]
```

**Full school record (the payload we ingest)**
```
GET https://www.cifcshome.org/widget/get-school-details/<schoolId>/details   → application/json
```
Returns, per school:
- `school` — full/common name, street + mailing address, city/state/zip, main phone/fax,
  website, enrollment, mascot, colors, and social handles (school + athletic dept).
- `athleticFaculties[]` — Principal, Vice Principal, **Athletic Director**, AD Assistant,
  Activities Director, Athletic Trainer, Financial Contact, Unified Contact — each with
  first/last name, **email**, work phone, extension.
- `coaches[]` — per sport & level, **Head/Assistant Coach**, name, **email**.

**Enumerating a whole section:** the directory page for a section
(`/widget/school/directory?section_id=<n>`) server-renders every school as a button
carrying its `data-id`. One scrape of that page → all school IDs in the section →
fan out to the detail endpoint. Sample: Bakersfield HS alone returned **28 contact
emails** across faculty + coaches.

**Sections:** Central = 9, Southern = 1, SAC-Joaquin = 5, San Diego = 3, Central Coast
= 4, North Coast = 7, Northern = 8, Oakland = 2, San Francisco = 13, LA City = 6, plus
FHSAA/NC/NJ (out-of-state, ids 10/11/12).

**Caveats (drive design):** it's an *undocumented internal* endpoint — treat the shape
as unstable (defensive parsing + schema-drift tolerance), cache aggressively, and re-sync
on a slow cadence rather than hammering it. Check CIFCS/HomeCampus ToS before bulk-syncing
the entire federation on a schedule (see §8).

---

## 3. How it reuses what the portal already has

This is the key to keeping the change minimal. Nothing here is greenfield plumbing:

| Need | Existing asset to reuse | File |
|---|---|---|
| Send through Brevo, staff-only | `brevo-proxy` (already locked to `verifyUser`; the historical open-relay hole is closed) | `netlify/functions/brevo-proxy.js` |
| Browser → Brevo send helper (attaches Supabase JWT, refresh/retry) | `sendBrevoEmail()` over `authFetch()` | `src/utils.js:109` / `:23` |
| Existing bulk-send precedent (to model on / improve past) | Past-Due Email Modal — a per-recipient browser send loop | `src/App.js:13084` (`pdBulkModal`) |
| Throttled/queued delivery | `scheduled_emails` table + cron worker (batch 25, 5 retries, 30-day retention, `*/15` cron) | `supabase/migrations/00076_scheduled_emails.sql`, `supabase/functions/send-scheduled-emails/index.ts` |
| Multi-step nudges w/ cadence + caps + claim-before-send lease | follow-up automation pattern | `netlify/functions/followup-sweep.js` |
| One-click unsubscribe (HMAC per-recipient token) | follow-up unsubscribe helper | `netlify/functions/_followupShared.js` |
| Auth / role gating on functions | `verifyUser` / `verifyAdmin` (bearer → `team_members`) | `netlify/functions/_shared.js` |
| Branded email HTML (navy `#16223F` / gold `#B6985A`) | rep A/R digest template | `netlify/functions/rep-ar-digest.js` |
| Scheduled-function wiring | `netlify.toml` `[functions."..."].schedule` cron entries | `netlify.toml` |
| Open-rate tracking | `brevo-proxy?endpoint=stats` | `netlify/functions/brevo-proxy.js` |

**Anti-goal (per `FABLE_SYSTEM_AUDIT` / `CLAUDE.md`):** do **not** add a 20th hand-copied
`fetch('https://api.brevo.com/v3/smtp/email')`. Marketing sends go through the
`scheduled_emails` queue, which already owns the one send path.

---

## 4. Architecture

```
                    ┌─────────────────────────────────────────────┐
   CIFCS widget ───▶│ cifcs-sync (Netlify fn, staff/cron)          │
   JSON endpoints   │  enumerate section → fetch details → upsert  │
                    └───────────────────┬─────────────────────────┘
                                        ▼
                          marketing_contacts  (staff-only RLS)
                                        │
        Sales Tools UI  ◀──── browse / segment / promote-to-customer
        (new tab)             │
              compose ───────▶│ marketing-campaign-send (enqueue)
              preview/test    │   segment → filter suppressions →
                              │   inject unsub + CAN-SPAM footer →
                              │   throttle into queue
                                        ▼
                          scheduled_emails  ──*/15 cron*──▶ send-scheduled-emails ──▶ Brevo
                                        │                                               │
        results dashboard ◀── marketing_sends (per-recipient log, opens)               │
                                        ▲                                               ▼
                    marketing_suppressions ◀──── brevo-webhook (bounce/complaint/unsub)
```

---

## 5. Data model (new tables — all staff-only RLS, no anon read/write)

Per `SECURITY_POSTURE_2026-07-03.md` §2, new tables must be locked from the start
(the `Allow all USING(true)` era is what the RLS lockdown is unwinding). These are
staff-write, staff-read, **no anon grants**.

**`marketing_contacts`** — the prospect store (source of truth from CIFCS)
```
id uuid pk · source text ('cifcs') · source_ref text (cifcs school+person key, unique w/ source)
school_id int · school_name text · section_id int · section_name text
role text ('Athletic Director' | 'Head Coach' | ...) · sport text (null for faculty)
first_name · last_name · email (citext) · phone · ext
school_city · school_state · school_website
customer_id uuid null  -- set when promoted to / matched with an existing customer
status text ('active'|'archived') · first_seen_at · last_synced_at
```
Unique on `(source, source_ref)` for idempotent re-sync. Index on `email`, `section_id`, `sport`.

**`marketing_campaigns`** — one row per send
```
id uuid pk · name · subject · html_template · sender_name · sender_email · reply_to
segment jsonb  -- {section_id?, sport?, role?, school_id?, contact_ids?}
status ('draft'|'scheduled'|'sending'|'sent'|'cancelled') · send_at · created_by · counts jsonb
```

**`marketing_sends`** — per-recipient log (audit + dedupe + open tracking)
```
id uuid pk · campaign_id fk · contact_id fk · email · scheduled_email_id fk null
status ('queued'|'sent'|'bounced'|'suppressed'|'failed') · message_id · sent_at
opened_at · error · created_at
```
Unique on `(campaign_id, email)` — a contact is emailed at most once per campaign.

**`marketing_suppressions`** — the global do-not-email list (the hard gate)
```
email (citext pk) · reason ('unsubscribe'|'hard_bounce'|'complaint'|'manual') · created_at · campaign_id null
```

Reuse **`scheduled_emails`** as-is for delivery (add `related_type='marketing'`, `related_id=<campaign_id>`).

---

## 6. Backend functions

### 6.1 `cifcs-sync` (Netlify, `verifyUser` for manual + cron for scheduled)
- Input: `{ section_id }` (or `all`).
- Scrape the section directory page for school `data-id`s → for each, GET the details JSON.
- Normalize faculty + coaches into contact rows; **upsert** on `(source, source_ref)`.
- Defensive parsing (endpoint is undocumented); polite rate limit + backoff; cache.
- Returns a summary (schools seen, contacts upserted/updated). Slow cron (e.g. weekly) once trusted.

### 6.2 `marketing-campaign-send` (Netlify, `verifyAdmin`)
- Resolve the campaign's segment → candidate contacts.
- **Filter against `marketing_suppressions` (hard gate)** and drop rows already in `marketing_sends` for this campaign.
- For each remaining recipient: render template with merge fields, inject the unsubscribe link + CAN-SPAM footer, and **enqueue into `scheduled_emails`** spread over time (throttle) rather than one blast.
- Write a `queued` `marketing_sends` row per recipient. Flip campaign → `scheduled`/`sending`.

### 6.3 Delivery — reuse `send-scheduled-emails` (edge fn, `*/15` cron)
- Already picks up due rows, POSTs to Brevo, retries, prunes. On success, stamp the linked
  `marketing_sends` row `sent` + `message_id`. Consider a per-run rate cap dedicated to
  marketing so it never starves transactional invoice emails.

### 6.4 `marketing-unsubscribe` (Netlify, public, HMAC-verified)
- Mirror `_followupShared.js`: HMAC token over the contact/campaign, no auth needed, can only
  suppress the address the link points at → insert into `marketing_suppressions`. One click, no login.

### 6.5 `brevo-webhook` (Netlify, public, signature-verified)
- Receive Brevo bounce/complaint/unsubscribe events → upsert `marketing_suppressions` and mark
  `marketing_sends`. This is what keeps the list clean and the domain reputation intact.

---

## 7. Frontend — where it plugs in

The UI is a single monolith `src/App.js` (~32.5k lines) with page-based nav (`pg` state +
`r*()` render functions), no router. There is a **`sales_tools` page** (`rSalesTools()`,
`src/App.js:30337`) with its own sub-tab system (`stTab`, tab bar at `:30530`: My Day, Quote
Forms, Numbers List, Size Sorter, Quick Reorder, Deco Calculator, Mockup Helper, Image
Vectorizer), and a separate **lazy-loaded `sales_history` page** (`src/SalesHistory.js`). Both
sit under the nav "Sales" section and are already access-granted to `rep` and `csr` roles
(admins get everything). Confirmed: **no CRM/campaign/blast/leads module exists today.**

Two ways to add the module — I recommend **(B)**:

**(A) New sub-tab under `rSalesTools()`** — smallest surface. Add an entry to the tab array
(`src/App.js:30530`), the `st=` deep-link whitelist (`:3891`), and a `{stTab==='outreach'&&…}`
render block. Downside: grows the 32.5k-line monolith with a whole CRM's worth of UI.

**(B) New lazy-loaded top-level page** (recommended) — a new `src/Marketing.js` (or
`SalesOutreach.js`), lazy-imported like `SalesHistory` (`const Marketing = lazyRetry(() =>
import('./Marketing'))`). Keeps the CRM UI *out* of `App.js` — only registry entries touch it.
Register the page id in all five places the app keeps in sync (this is the repo's known
hand-synced-registry tax — do it once, correctly):
`_PG_IDS` (`:1940`), `RESTRICTED_PAGES` (`:5077`), `DEFAULT_ACCESS_BY_ROLE` (`:5079`) + the
duplicate `DEFAULT_ACCESS` (`:28962`), `ALL_PAGES` (`:28937`), `nav` (`:31751`), `titles`
(`:31752`), and a `{pg==='marketing'&&…}` mount (`:32030`). Gate it to `rep`/`csr`/admin via the
existing `canAccess()` machinery (`:5097`) — the same pattern that already gates Sales Tools.

**Sub-views (either option):**
1. **Prospects** — filterable table of `marketing_contacts` (section, sport, role, school,
   has-email). Bulk-select → "Add to campaign." Row action "Promote to customer" (sets
   `customer_id`). Per-section "Sync from CIFCS" button (calls `cifcs-sync`).
2. **Campaigns** — list + composer. Subject + branded HTML (start from the rep-digest template),
   segment picker, live preview, **test send to an internal `@nationalsportsapparel.com` address**
   (same guard the digests use), then Send now / Schedule.
3. **Results** — per campaign: queued / sent / opened / bounced / unsubscribed from
   `marketing_sends`; opens via `brevo-proxy?endpoint=stats`.

**Sending from the browser:** reuse `sendBrevoEmail()` (`src/utils.js:109`) over `authFetch`
**only** for the test-send / single preview. The real campaign must **not** loop `sendBrevoEmail`
per recipient in the browser (that's what the Past-Due modal at `src/App.js:13084` does, and it's
exactly the blast pattern we're replacing) — it calls `marketing-campaign-send`, which enqueues
into `scheduled_emails` for throttled server-side delivery.

---

## 8. Compliance & deliverability — the safety core

**CAN-SPAM (US, governs commercial email):** cold B2B to these addresses is legal *without*
prior opt-in **if** every message has (a) truthful from/subject, (b) a valid physical postal
address, and (c) a working unsubscribe honored within 10 business days. The module bakes (b)
and (c) into the template and the suppression gate so a non-compliant email can't be sent.

**Brevo's own anti-spam policy is stricter than the law.** ESPs generally prohibit
purchased/scraped lists and will suspend accounts over high complaint/bounce rates. Mitigations,
all enforceable in the module:
- **Sender isolation** — dedicated subdomain (e.g. `outreach.nationalsportsapparel.com`) or a
  separate Brevo subaccount, with its own SPF/DKIM/DMARC, so a reputation hit can never touch
  the transactional domain that runs webstore/roster/invoice mail.
- **Warmup + throttling** — ramp volume; drip via the queue, never blast.
- **List hygiene** — validate addresses on ingest; honor bounces/complaints instantly via webhook.
- **Low-and-relevant** — targeted, genuinely useful outreach (team-gear offers to the AD/coach
  who actually buys) keeps complaint rates down.

**CIFCS / HomeCampus ToS** — confirm bulk extraction is permitted before scheduling a
full-federation sync; keep syncs slow and cached regardless.

**Recommended posture:** treat CIFCS as *prospecting into the CRM*, not a blast list. Optionally
gate the first touch as an opt-in invite ("want deals for your program?") — lower legal/ToS
surface, higher engagement. This is a **policy decision** (see §11), not a code constraint.

---

## 9. RLS / security

- All four new tables: `ENABLE ROW LEVEL SECURITY`; staff-only read/write via an
  `is_team_member(auth.uid())`-style predicate (coaches are also `authenticated`, so
  `TO authenticated USING(true)` is **not** sufficient — per Security Posture §2). **No anon grants.**
- Writes happen through service-role Netlify/edge functions; the browser never writes these tables directly.
- Reuse `verifyUser`/`verifyAdmin`; `cifcs-sync` and campaign send are staff/admin only.
- Secrets stay server-side: `BREVO_API_KEY`, plus a `MARKETING_UNSUB_SECRET` (or reuse the
  follow-up secret pattern) and the Brevo webhook signing secret. Nothing new in the browser bundle.

---

## 10. Rollout phases

- **Phase 1 — Ingest & browse (no sending).** `cifcs-sync` + `marketing_contacts` + the Prospects
  view. Proves the CIFCS→Supabase loop with real data; zero send risk. *(This is the smallest
  end-to-end slice and the recommended first PR.)*
- **Phase 2 — One compliant campaign.** Composer + `marketing-campaign-send` + queue delivery +
  unsubscribe + suppression + Results. Requires the sender-domain and postal-address decisions
  from §11. Ship behind an admin-only flag; first real send to a *small* segment.
- **Phase 3 — Sequences & polish.** Multi-step drip (reuse the follow-up cadence/lease pattern),
  richer templates, per-rep ownership, opt-in-first flow if chosen.

---

## 11. Decisions I need from you before Phase 2

1. **Sender identity** — dedicated subdomain or separate Brevo subaccount for cold outreach?
   (Strongly recommended — protects your transactional deliverability.)
2. **Physical postal address** for the CAN-SPAM footer (legally required).
3. **Consent stance** — pure cold B2B (legal under CAN-SPAM) vs. opt-in-first invite (safer for
   Brevo ToS + reputation). My lean: opt-in-first for a widget-harvested list.
4. **First target segment** — which section(s)/sport(s) to start with (e.g. Central = 9)?
5. **CIFCS ToS** — OK to proceed with bulk sync, or keep it on-demand per school for now?

---

## 12. Risks & non-goals

- **Undocumented source** — CIFCS can change/break the endpoint; sync is defensive and non-critical.
- **Reputation** — the entire point of the module is to contain this; §8 mitigations are mandatory
  before any real send.
- **Not a full marketing automation platform** — if volume/features outgrow this, a purpose-built
  Brevo campaign in their UI (with the contacts synced via API) may be the better home; this module
  is the portal-native, rep-driven version.
