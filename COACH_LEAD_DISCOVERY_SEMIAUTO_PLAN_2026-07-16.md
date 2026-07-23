# Semi-Automated Coach-Lead Discovery — Build Plan (2026-07-16)

**Scope:** the *discovery front-end* for the auto-store program. The store side already exists
(see `COACH_AUTO_STORE_PLAN_2026-07-10.md` and PR #1649 on
`claude/auto-store-creation-coaches-ik127c`). What's missing is the top of the funnel: getting
new-coach-hire **candidate leads to flow in on their own**, so a human only has to *confirm*, not
hunt.

**Design target: semi-automation, on purpose.** Candidates are discovered automatically from
low-fragility sources and land in `coach_leads` as `status:'new'` with a citation. A human spends
~10 min/day triaging the review queue; confirming a lead triggers the existing draft-store build.
The publish gate stays human — same trust model as the rest of the program.

**Explicitly *not* in this plan:** a statewide CIF-Home / MaxPreps roster scraper. That's a
~10-section, JS-rendered, freshness-dependent, ToS-encumbered completeness play — high maintenance
for a small team. It's parked as optional (see "Deferred"), to be revisited only if detection
*coverage* proves to be the bottleneck after the funnel is live.

---

## What already exists (reuse — do not rebuild)

Verified in-repo on the coach-store branch:

| Piece | Where | Role in this plan |
|---|---|---|
| `coach_leads` table (`source`, `status`, `enrichment` jsonb, `colors`, `logo_url`, `customer_id`, `webstore_id`, `raw`) | `supabase/migrations/00188_coach_leads.sql`, `00189_coach_lead_enrichment.sql` | Every feeder writes rows here. No schema change needed for v1. |
| Enrichment agent (Haiku: web-search → structured extract of colors/mascot) | `netlify/functions/coach-leads-enrich.js` | Runs on any `status:'new'` lead **with a school** — so every discovered lead auto-enriches next run. Free downstream. |
| Sheet-sync intake (Google Sheet → insert-if-new) | `netlify/functions/coach-leads-sheet-sync.js` | Is itself feeder #4 (the manual drop-box). Its `insertNewLeads` dedup pattern is the template for the new feeders. |
| Store builder (customer + draft store from sport template + coach invite) | `netlify/functions/store-quick-build.js` | Fires when a human confirms a lead. Unchanged. |
| "New Coaches" review card / Quick Build | `src/Webstores.js` | The one human step. Needs a small addition (show provenance). |
| Scheduled-function wiring | `netlify.toml` | New feeders are added here as scheduled functions, same as enrich/sheet-sync. |

Because enrichment + build + review already exist, **this plan is essentially just the feeders +
one UI addition.**

---

## The feeders (automatic discovery)

Each feeder's only job: write **new** `coach_leads` rows with `status:'new'`, the right `source`,
and a provenance stamp in `enrichment.discovery`. They never build or email — they fill the queue.

Common write shape:

```
enrichment.discovery = {
  method:       'x' | 'maxpreps_jobs' | 'school_sweep' | 'sheet',
  source_url:   '<link to the tweet / listing / announcement>',
  source_handle:'<@handle, for x>',      // null otherwise
  announced_at: '<ISO date of the hire/opening, if known>',
  kind:         'hire' | 'opening',      // opening = leading indicator
  confidence:   'high' | 'medium' | 'low'
}
```

### Feeder 1 — X watch-list poller  ·  `netlify/functions/coach-leads-x-discover.js`  ·  *fastest value*
- Polls a **hand-picked watch-list** of handles (start: `@chriscfore`; the MaxPreps CIF-section
  accounts, e.g. `@SacMaxPreps`; SoCal/NorCal prep beat reporters — verify each handle first) via
  the **X API v2 user-timeline** endpoint.
- **Cost control:** X moved to usage-based pricing (~$0.005/post read). Keep a **`since_id` cursor
  per handle** (store in `app_state` or a small `coach_lead_sources` row) so each tweet is read
  once. A focused watch-list is a few thousand reads/month = single-digit dollars.
- Each new tweet → **Haiku structured-extract** (reuse the `extractBrand`/`EXTRACT_SCHEMA` pattern
  from `coach-leads-enrich.js`, new schema: `is_hire`, `coach_name`, `school`, `sport`,
  `confidence`). No web-search call needed here — the tweet text *is* the input, so it's the cheap
  single structured call, not the two-call dance.
- Non-hire tweets are dropped. Hire tweets → insert-if-new, `source:'hire_feed'`,
  `discovery.method:'x'`.
- **New secrets/config:** `X_BEARER_TOKEN`, `COACH_X_WATCHLIST` (comma-sep handles).
- **Fragility:** low (official API).

### Feeder 2 — Customer-seeded web-search sweep  ·  `netlify/functions/coach-leads-school-sweep.js`
- Iterates a **bounded** set of target schools — seed from `customers` (your warm base; flag the
  ones you want watched) — and runs the **same Haiku two-call research→extract** as the enrich
  function, query: *"{school} new head coach {year}"* across sports.
- Extract recent hires with a **citation + announcement date + recency gate** (ignore anything
  older than N months). Insert-if-new, `source:'hire_feed'`, `discovery.method:'school_sweep'`.
- Bound the work per run exactly like enrich (`MAX_PER_CALL`, `TIME_BUDGET_MS`); walk the school
  list across runs.
- **Config:** a `watch` flag on `customers` (or a `COACH_SWEEP_SCHOOLS` list to start), recency
  months, confidence floor.
- **Fragility:** low-medium (no scraping; noisier than X, but uniform across sports and all of CA).

### Feeder 3 — MaxPreps jobs-directory poller  ·  `netlify/functions/coach-leads-maxpreps-jobs.js`  ·  *best-effort*
- Weekly fetch of the MaxPreps coaching-**openings** listings filtered to CA
  (`maxpreps.com/directories/jobs...`). Parse (school, sport, posted date, link).
- Openings are a **leading indicator** — you can reach the school *before* the hire is announced —
  so write these with `discovery.kind:'opening'` and let the review card treat them differently
  (watch/nurture vs. build-now).
- Insert-if-new keyed on (school + sport + posted_date). `source:'hire_feed'`.
- **Fragility:** higher (HTML parse, no API). **Isolate it** — a parse break must not affect the
  other feeders. Optional; add after 1 & 2 prove out.

### Feeder 4 — Google-Sheet drop-box  ·  `coach-leads-sheet-sync.js`  ·  **already built**
- The zero-code manual path: a rep pastes a name / tweet link / announcement into the shared sheet;
  the existing sync ingests it (`source:'sheet'`). Keep as the always-on manual feeder — it works
  today with no new code.

---

## Shared discovery logic (build once)

- **Dedup + no-clobber:** all feeders use the `insertNewLeads` pattern from `coach-leads-sheet-sync.js`
  (plain insert of only-unseen rows, never an upsert). Dedup key: `email` when present, else
  normalized `(school + sport + coach_name)`. Check against **both** `coach_leads` **and the legacy
  `coach_hire_leads`** (14 existing rows) so old leads don't reappear.
- **Existing-customer awareness:** if a discovered school already maps to a `customers`/`webstores`
  record, flag it as *upsell/existing* rather than a net-new cold lead (different play, different
  email).
- **Recency + confidence gates:** drop stale announcements; write low-confidence candidates but
  mark them so the review card can sort them last or hide below a threshold.
- **Attribution is the point:** the `enrichment.discovery` stamp lets you measure **which feeder /
  which handle actually produces leads that convert**, so the watch-list self-prunes. Keep the 3
  that work; drop the noise.
- **Auto-enrich chains for free:** a written `status:'new'` lead with a school is picked up by the
  existing enrich agent on its next run → colors/mascot filled in. No extra wiring.

---

## The one human step (existing card + small addition)

The "New Coaches" review card in `src/Webstores.js` already lists `status:'new'` leads and can
build a store. Add:
- **Provenance row:** source method, clickable `source_url`, `confidence`, and a
  hire-vs-opening badge.
- **Dismiss** action (mark junk / not-a-fit) so the queue stays clean.

Confirm → existing `store-quick-build` (draft) → staff publish → congrats email. That confirm *is*
the "semi": everything up to it is automatic; the human decision and the publish stay human.

---

## Data / schema touches (minimal)

- **v1 needs no migration** — `coach_leads.source`, `.status`, `.enrichment` already carry
  everything. Cursors/config live in `app_state` + env vars.
- **Optional later:** a `coach_lead_sources` table (handle, enabled flag, last `since_id`) if the
  watch-list outgrows env vars; a `watch boolean` on `customers` for the sweep set.

## Scheduling (`netlify.toml`)

- X poller: a few times daily.
- School sweep: daily-light or weekly (bounded per run).
- MaxPreps jobs: weekly.
- (Enrich + sheet-sync already scheduled.)

## New secrets/config

`X_BEARER_TOKEN`, `COACH_X_WATCHLIST`, sweep school set (`customers.watch` or `COACH_SWEEP_SCHOOLS`),
recency-months + confidence-floor thresholds. (`ANTHROPIC_API_KEY`, `COACH_LEADS_SHEET_URL` already
exist.)

---

## Rollout

1. **Step 1 (~1 session):** X watch-list poller + provenance in the review card. → semi-auto live.
2. **Step 2 (~1 session):** customer-seeded web-search sweep.
3. **Step 3 (~½ session):** MaxPreps jobs poller (isolated, best-effort).
4. **Measure 3–4 weeks:** per-source conversion. Prune/expand the watch-list from real data.

Fragility, low → high: **sheet drop-box → X poller → web-search sweep → MaxPreps parse.** The
statewide CIF-Home crawl is deliberately excluded.

## Deferred (only if coverage becomes the proven bottleneck)

- **MaxPreps team-page coach-diff**, bounded to your target/customer schools (one site, few hundred
  pages) — realistic before any statewide effort.
- **CIF-Home per-section directory diff** — the "Coaches and Sports" widget data across the ten
  sections. Highest coverage, highest maintenance; needs a rendered-crawl feasibility probe first.

## Risks / decisions (carried from the master plan)

- **Contactability:** directories/tweets give name + school + sport, rarely email. Email stays a
  human-confirmed step before any send.
- **Cold-email compliance:** separate sending subdomain, CAN-SPAM (postal address, unsubscribe),
  suppression honored — as already specified in `COACH_AUTO_STORE_PLAN_2026-07-10.md` Phase 3.
- **MaxPreps ToS:** low-volume, polite, isolated; treat as best-effort, not load-bearing.
- **No auto-send / no auto-publish:** the draft-first human gate is retained end-to-end.
