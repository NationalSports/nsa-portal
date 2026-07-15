# Auto Store Creation for New Coaches — Plan (2026-07-10)

**Goal:** From a new-coach data point (hire announcement or cold list) — name, email, school,
sport — plus one logo, produce a fully branded team store + coach portal access, paired with a
"congrats on the new job" email that links both. Minimal human effort: pick a sport, drop a logo,
click build.

## What already exists (verified in this repo)

The substrate is ~70% built. Key reusable pieces:

| Piece | Where | State |
|---|---|---|
| Webstore schema + branding columns (`logo_url`, `primary_color`, `accent_color`, `hero_blurb`, `theme`) | `supabase_migration_011_webstores.sql` + | Live |
| Store templates + clone (`is_template`, `duplicateStore`, `startStoreFromStoreTemplate`) | `src/Webstores.js:1617,1981`, migrations 039/059 | Live |
| Self-serve store submission with server-side price locking → `status:'draft'` | `supabase/functions/coach-store-submit/index.ts`, `src/storefront/BuildStore.js` | Live |
| Coach provisioning + magic-link invite (`coach_accounts`, `coach_customer_access`) | `netlify/functions/coach-invite.js` | Live |
| "Store is live" launch email w/ team colors, QR, PDF flyer, portal link | `launchEmailHtml` / `notifyCoachPublished`, `src/Webstores.js:657,1291` | Live — fires when a coach-built draft is published |
| Customer branding fields: `customers.logo_url`, `customers.school_colors` | migrations 065, 00130 | Live but **not connected** to store theme |
| Brevo transactional email (server + `brevo-proxy.js`) | portal functions; website `send-email.js` | Live |
| Lead capture (Design Lab → Google Sheet + Brevo list 2) | nsa-website `save-lead.js` | Live, sheet-only |

## What's missing

1. **No intake for new-coach data.** A `coach_hire_leads` table name exists in RLS docs but is
   orphaned — no writer, reader, or CREATE TABLE. No CSV import, no enrichment.
2. **No `sport` field** anywhere (customers or webstores) — sport is free text today.
3. **No customer auto-creation.** Every coach path assumes `customer_id` exists.
4. **No logo→theme pipeline.** `school_colors`/`logo_url` on the customer don't flow into store
   `primary_color`/`accent_color`/`logo_url`; no auto-cutout (documented but unbuilt in
   `WEB_LOGOS_CW_AUTOMATION_RESEARCH_2026-07-02.md`); logo-on-mockup is fully manual
   (QuickMockBuilder).
5. **No congrats/outreach email** — the launch email exists but only for already-known coaches.

## Architecture

Keep the codebase's proven trust model: **automation builds the draft; a human clicks publish.**
Every existing coach-facing write path is draft-first/staff-gated, and the CW research doc warns
that a wrong auto-picked color way is "the most expensive mistake in this whole program." We
automate everything up to the publish button, not past it.

```
lead in (CSV / manual / Claude-enriched)          rep in Webstores admin
  → coach_leads row                                 → "Quick Build": pick/enter
  → [review card: confirm logo, colors,               customer, pick sport,
     sport, store name]  ← the only human step        drop logo
        └──────────────┬──────────────────────────────────┘
  → one click: store-quick-build → customer record + coach invite
    + draft store from sport template, branded with logo + extracted colors
  → staff publish (existing flow; rep path can "Build & publish" in one click)
  → congrats/launch email fires (new template, existing notifyCoachPublished hook)
```

### Phase 1 — Foundation (mechanical; Sonnet-tier implementation)

1. **`coach_leads` table** (revive the orphaned concept properly):
   `name, email, phone, school, sport, source ('hire_feed'|'cold_list'|'manual'|'design_lab'),
   status ('new'→'enriched'→'ready'→'store_built'→'emailed'→'claimed'), logo_url,
   colors jsonb, customer_id nullable, webstore_id nullable, notes`. Unique on email —
   idempotent imports.
2. **`sport` column** on `webstores` + `customers` (or on the lead + store only, to start).
   Structured enum-ish text; powers template selection and future segmentation.
3. **Sport → template mapping.** One curated `store_templates` row per sport (staff builds each
   once — football, soccer, basketball, baseball/softball, volleyball, wrestling, track, golf).
   `store_templates.sport` column keys the lookup.
4. **"New Coaches" admin screen** (new tab or section in Webstores admin): paste/import CSV of
   hires, see the lead funnel, and per-lead a **review card**: logo preview, extracted colors
   (editable hex), sport picker, proposed store name + slug. One button: **Build store**.
5. **`store-quick-build` server function** (service role, mirrors `coach-store-submit`
   patterns) — one shared capability with **two entry points**:
   creates or links the `customers` record (name, `alpha_tag`, `logo_url`, `school_colors`),
   calls the template-clone path to make a store with `created_via:'auto'` (new value), threads
   logo + colors into store branding, and links everything back onto the lead when one exists.
   Idempotent per lead / per customer+sport.
   - **Lead entry point:** the New Coaches review card (above) → builds a `status:'draft'`
     store; staff publish is the human gate.
   - **Rep entry point ("Quick Build"):** a button in the Webstores admin. Rep picks an
     existing customer (or types a new school name), picks sport, drops a logo — one click
     builds the whole store. Because the rep *is* the human gate, this path offers
     **"Build & publish"**: create, open the store, fire the launch/congrats email and coach
     invite in the same click. Default stays "build as draft" with publish one click away;
     the checkbox makes it a true single action when the rep is confident. Logo cutout +
     color extraction (Phase 2) apply identically here — in Phase 1 the rep's dropped logo
     and picked colors thread straight into store branding.
6. **Congrats email template.** New Brevo-sent HTML alongside `launchEmailHtml` — personal tone
   ("Congrats on the new job at {school}!"), coach portal link (`/coach?portal=<alpha_tag>`),
   parent store link (`/shop/<slug>`), the existing QR + PDF flyer. `notifyCoachPublished`
   picks this template when the store's lead `source` is a hire/cold lead. Coach invite
   (magic link) fires at the same moment.

### Phase 2 — Enrichment & logo automation

7. **Claude enrichment agent** (Supabase edge fn or Netlify background fn, Haiku/Sonnet): given
   school + sport, web-search the athletics site for mascot, official colors, and logo
   candidates; write results onto the lead as *suggestions*. The review card shows 2–3 logo
   candidates + color swatches; human confirms. (This is the "Claude/COWORK gathers the info"
   piece — it fills the card, never builds unattended.)
8. **Cloudinary logo pipeline** (already the documented P1 idea): on logo confirm, run
   background removal + trim → web-ready cutout; run Cloudinary color extraction → dominant
   hex pair → `primary_color`/`accent_color`, and map to nearest catalog color families for
   `school_colors` (so the coach's catalog filters pre-load correctly).
9. **Visual decoration without production risk:** auto-populate `webstore_products.decorations`
   with the cutout at a default left-chest placement so the storefront *looks* decorated on day
   one — while actual production art/ink (CW selection) stays rep-confirmed per the existing
   art-approval flow. No auto mock baking in this phase.

### Phase 3 — Cold outreach at scale

10. **Preview ("ghost") stores:** new store state where the storefront renders fully branded but
    checkout is disabled, replaced with a "Claim your team store" CTA → coach magic link. The
    cold email becomes *"Congrats on the new job — we already built {School} {Sport} a team
    store. Take a look."* A live, personalized artifact converts far better than a pitch.
11. **Brevo sequence:** congrats → day-3 "parents can shop in 2 clicks" → day-10 flyer/QR nudge,
    stopping on claim. Send cold volume from a separate subdomain (e.g. `hello@teams.…`) so
    outreach can't damage transactional deliverability (order confirmations, invites).
12. **Funnel metrics** on the lead status column: imported → built → emailed → claimed → first
    parent order (the `ad_spend_tracking` work from migration 064 shows the measurement pattern).

## Risks / decisions to make

- **Publish gate:** plan keeps human-click-to-publish. Going fully unattended is a trust-model
  change this codebase deliberately avoids — recommend revisiting only after ~20 successful
  auto-built stores.
- **Payments:** the money audit (2026-07-02) found native card checkout has near-zero production
  mileage and a hidden 5% fee setting. First auto-created stores should get explicit review of
  `payment_mode` + fee config at publish.
- **Logo IP:** school marks are trademarks. Using a scraped logo in a *cold* preview store shown
  publicly is a business/legal call — safest posture: preview stores are link-gated (only the
  emailed coach sees them) until the coach claims/uploads or approves art.
- **Cold-email compliance:** CAN-SPAM basics (real postal address, working unsubscribe) on the
  congrats template; suppression list honored across sequences.

## Effort sketch

- Phase 1: ~2–3 sessions. Mostly mechanical (schema, admin screen, one server function, one
  email template) — good Sonnet work with a review pass.
- Phase 2: ~2 sessions. Cloudinary transforms are config-level; enrichment agent is a small
  edge function (Haiku for the search/extract steps).
- Phase 3: ~2 sessions + Brevo dashboard setup.

Phase 1 alone already delivers the ask, from either seat: a lead card or a rep's Quick Build —
select sport, drop logo, one click → store + portal + congrats email.
