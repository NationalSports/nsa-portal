# National Team Shop — Go-Live Checklist

Sequenced steps to take the Team Shop / club-store build from the feature branch
(`claude/orchestrator-vs-advisor-4i7qlh`, PR #1646) to production. **Order matters** —
the hazards below are real (one of them hard-fails club checkout 100% of the time if
skipped). Nothing here is destructive if done in sequence.

Verified live-DB state at time of writing (project `hpslkvngulqirmbstlfx`):
- **Applied:** migrations `00191`–`00203` (storefront, teamshop conversion, auto-PO,
  delivery timelines). `create_teamshop_sales_order` is live.
- **NOT applied:** `00204`–`00212` (club conversion, release gate, transfer RPC,
  auto-art, auto-release, DTF lane). `create_club_sales_order`, `pull_webstore_transfers`,
  the 8-arg `advance_job_stage`, `teamshop_settings`, `teamshop_dtf_print_needs`,
  `so_jobs.dtf_prints_status/notes`, `webstore_transfers.unit_cost` are all absent on live.

---

## Step 1 — Apply migrations 00204 → 00212 (in order)

Nine migrations, applied strictly in numeric order:

```
00204_club_store_conversion          -- create_club_sales_order + webstore_transfers.unit_cost
00205_release_gate                   -- advance_job_stage gains the readiness gate (8-arg)
00206_pull_transfers_txn             -- pull_webstore_transfers (atomic, kills the pull race)
00207_auto_art                       -- both conversion RPCs born-complete for ready saved logos
00208_teamshop_auto_release          -- teamshop_settings (auto_release_enabled, scope) + sweep fn
00209_teamshop_auto_po_needs_dismiss -- dismiss/resolve for unmapped auto-PO lines
00210_so_jobs_notes                  -- job notes for the iPad floor sheet
00211_teamshop_dtf_auto_po           -- DTF print-needs sibling table + DTF vendor lane
00212_so_jobs_dtf_prints_status      -- DTF prints-in-hand readiness + staging bin
```

> ⚠️ **HAZARD — apply BEFORE any `org_type='club'` store opens.** Club checkout calls
> `create_club_sales_order` (00204). Until 00204 is applied, the first paid club order
> hard-fails conversion 100% and strands silently. There are **zero** club orders today,
> so applying now is inert — but this must precede the first club store going live.

> ℹ️ **00205 note:** it `DROP`s the old 6-arg `advance_job_stage` and recreates it 8-arg.
> All three callers use named args and keep working. Existing in-flight jobs are unaffected.

All nine were verified together on a full-schema scratch Postgres 16 this session
(`e2e/pipeline/run.sh` applies 00191–00212 and drives real orders through — 104 assertions,
exit 0). Re-run it against a Supabase branch first if you want a live-parity dry run before
touching prod.

## Step 2 — Environment variables

**Portal (nsa-portal Netlify):**
- `ANTHROPIC_API_KEY` — activates the Sonnet chat assistant (runs in rule-based fallback until set).
- `VENDOR_DIGITIZING_TOKEN` — gates the Top Star vendor portal (`/vendor-digitizing`). Send the vendor their URL with this token.
- `STUCK_SWEEP_ALERT_EMAIL` — where the hourly stuck-order sweep sends alerts.

**Website (nsa-website Netlify):**
- `GENERATE_VIDEO_TOKEN` — gates the Sora video endpoint.

**Verify already-set (correctness depends on these):**
- `STRIPE_WEBHOOK_SECRET` — see Step 3. ACH orders convert ONLY via the webhook.
- `SHIPSTATION_WEBHOOK_SECRET` — the shipped-confirmation email fires only on the ShipStation callback.

## Step 3 — Webhook configuration

**Stripe dashboard:**
- Subscribe **`payment_intent.succeeded`** AND **`payment_intent.payment_failed`**.
- Point at the deployed webhook endpoint; set `STRIPE_WEBHOOK_SECRET`.
- > ⚠️ **HAZARD:** ACH conversion is webhook-only. A missing/misconfigured endpoint or
  > unset secret strands 100% of ACH orders in `pending_payment`. (Card orders have a
  > browser-finalize backstop; ACH does not.)

**ShipStation:** configure the `SHIP_NOTIFY` webhook + `SHIPSTATION_WEBHOOK_SECRET`, else
no shipped email ever fires (internal state still flips to shipped, so it's silent).

## Step 4 — Supabase Auth

Add `nationalteamshop.com` (and `www.`) to the Auth redirect allow-list so coach sign-in
works on the production domain.

## Step 5 — Merge

- Portal PR **#1646** (this branch) → deploys the storefront, Production HQ, all Netlify
  functions, and the scheduled sweeps (stuck-sweep hourly, auto-release ~15min, DTF sweep hourly).
- Website PR **#30** → the Sora video endpoint + banner assets.

## Step 6 — One real end-to-end order (the last unproven link)

The e2e harness proves the whole data pipeline on real Postgres, but NOT the literal
Stripe payment→webhook network hop. Close that gap once deployed:
1. Place one **Stripe test-mode** card order through the live storefront checkout.
2. Confirm: webhook fires → order flips `paid` → SO + jobs + invoice created → (if the
   logo was a ready saved logo) the embroidery job is born `art_complete` → confirmation email.
3. Repeat for one ACH order (verifies the webhook-only path) and one School-PO order
   (verifies staff approve/reject).

## Step 7 — Turn automations on (only after you trust them)

Everything ships **default-OFF**. Enable in this order, watching the stuck-sweep alerts:
1. **Auto-art** is already on (safe by construction — only fires on already-finished art). No toggle.
2. **Auto-release** — `teamshop_settings.auto_release_enabled = true`, start with
   `auto_release_scope = 'auto_art_only'` (reorders only). Widen to `'all'` later.
3. **Auto-submit POs** — per vendor in Production HQ → Settings → Auto-PO vendors: set
   `contact_email`, then flip `auto_submit_enabled`. Start with one trusted vendor.
4. **DTF lane** — set the DTF vendor's `contact_email`, `threshold_qty`, `max_age_days`
   in the same settings tab. It's inert until configured.

---

## What's automated once this is done

A clean card order with a saved logo: **pays → auto-converts → goods auto-ordered →
staff check in → job auto-releases → staff decorate & scan → staff ship.** Staff touch
only check-in, production, and shipping. The stuck-order sweep watches for anything that
stalls and emails an alert.

## Known honest gaps (not blockers, tracked for later)

- DTF PO cost is $0 (print pricing not modeled — staff price the draft PO).
- Customer notifications cover confirmation + shipped only; no intermediate-stage updates
  (the chat assistant answers "where's my order" on demand).
- Auto-release fulfillment gate is deliberately conservative (only releases fully-in-hand jobs).
- The e2e harness is not yet wired into CI (`e2e/pipeline/README.md` notes this).
