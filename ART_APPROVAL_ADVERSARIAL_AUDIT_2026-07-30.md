# Art-Approval Adversarial Audit — 2026-07-30

**Method:** four parallel read-only adversarial passes over the art subsystem (status/coach/file
desync; syncJobs rebuild & heal; multi-location/multi-design; coach-approval & previous-art reuse),
each required to *disprove* its own findings, plus an independent DB invariant sweep against
production and a manual re-derivation of every load-bearing claim. **No code was changed for this
audit.** It maps what is still broken after the five fixes already shipped on PR #1860.

Severity = (can art print wrong / can a fake approval stand) > (silent wrong data persisted) >
(display only). Each finding is tagged **CONFIRMED** (code re-derived here), **PLAUSIBLE** (real but
needs a specific data/timing window), **LATENT** (correct-but-unreachable), or **TRADEOFF**.

**The one root theme:** almost every finding is *hand-duplicated logic that drifted* — the same
transition, clear-set, derivation, or approval gate copied across `App.js`, `OrderEditor.js`,
`CustDetail.js`, and the portal, where only some copies received each past fix — **or** identity
keyed on a *name / sku|color / primary slot* instead of a stable *design_id / line / location*. A
per-site patch is what created this class; the durable fixes below are all "collapse to one seam" or
"key on a stronger identity," not "add another copy."

---

## Already shipped on PR #1860 (context — verified still intact by the passes)

1. Close the artist's open art request when a mockup is sent for approval.
2. Stop auto-snoozing the "Mockup ready for review" to-do on click.
3. Send-for-approval advances **all** location art files (`jobLiveArtIds`), not just the primary.
4. `isPureArtExpansion` guard so the art-pointer heal can't *save* a downgrade when a location is
   only added.
5. Recall / Send-back reset the whole split family (`_artFamilyIdxs`), not one slice.

Fixes 3–5 are **partial relative to their root** — see F1, F5, and F6 below. That is the honest
headline of this audit: two of my own fixes closed the *path* in front of me but left the *seam*.

---

## Production invariant sweep (hard counts, today)

| Contradiction in live data | Count |
|---|---|
| `waiting_approval`/complete **+ still-open art request** | 79 jobs |
| saved `needs_art` **+ art actually submitted/approved** | 9 jobs |
| saved `needs_art` **+ a declared file at `uploaded` with a real mockup** (F1) | 9 jobs / 8 orders |
| multi-location item, one print advanced + one behind | 33 items / 18 orders |
| `coach_rejected=true` **+ art_status advanced** ("SO-1199 shape") | 7 jobs |
| `coach_approved_at` set **+ art regressed** | 2 jobs |
| `art_complete` (**Ready for Production**) **+ a design's file not `approved`** | 16 jobs |

These are the fingerprints of the findings below; none are auto-swept (a blind sweep would mark
genuinely-unfinished art "ready" — some `waiting_for_art` locations are legitimately mid-draw).

---

# Tier 1 — a job can go to press wrong, or a fake approval can stand

## F1. Approval gate is per-garment, not per-location — a mockless second print reaches Ready-for-Production — CONFIRMED
- **Where:** `src/safeHelpers.js:611-614` (`skusMissingMockups` — `perSku` pools `item_mockups[sku|color]`
  across *all* the garment's art files and passes if **any** one is non-empty). The only per-location
  requirement is the reversible-slot check at `:624-626` (`s.reversible && !s.primary`).
- **Mechanism:** a normal second print ("Back Marketing") is a non-reversible art deco. Its own slot
  is never required; the *front* logo's mockup under `sku|color` satisfies the gate for the garment.
  All three send-for-approval handlers and both coach gates call this function, and coach-approve
  flips **every** `jArtIds` file to `approved` (`CoachPortal.js:1751`, RPC `00172:114-115`). So the
  back print reaches `art_complete` having never had a mockup made or seen.
- **Second look:** confirmed by reading the function — `perSku` needs only one non-empty file; the
  reversible filter drops a plain second art deco; the cross-job augmentation loop (`:567-573`) can
  even satisfy an embroidery job's gate with a *different* job's front mockup. Guard does not hold.
- **Interaction with shipped fix #3:** my "advance all locations" fix flips a mockless second
  location to `needs_approval` on send, trusting this gate to have required a mockup. It doesn't. So
  **fix #3 is only durable once this gate is per-location.** (Before and after fix #3 the terminal
  production risk already existed via coach-approve-all; fix #3 does surface the "ready" status on a
  mockless location earlier.)
- **Durable fix:** require a filled slot for *every* `mockSlotKeys` entry the job's decos own (scoped
  by `deco_idxs`), not just the primary. A "also require non-reversible secondary slots" patch fixes
  the single-job case but **not** the cross-job augmentation leak — it would move the problem.

## F2. Coach-decision guard is one-directional — a stale tab RESURRECTS a cleared approval — CONFIRMED
- **Where:** `src/lib/dbEngine.js:1816-1821`. The guard only restores a coach column when **DB is
  non-null and the incoming row is null** (protects against a stale client *nulling* a live
  decision). There is no branch for **DB-null / row-non-null**, so a stale *non-null* passes into the
  blind upsert (`:1831`).
- **Trigger:** coach approves (DB `coach_approved_at=T1`, `art_complete`) → rep recalls the art
  (`ART_PULLBACK_CLEARS` nulls it, artist redraws) → a second tab opened *before* the recall still
  holds `coach_approved_at=T1` + `art_complete` (and did **not** set `_coach_cleared`); it saves any
  edit. Guard sees DB-null, skips, and writes T1 back. Job now reads **coach-approved / ready for
  production on art the coach never saw.**
- **Second look:** no heal catches it (`_healArtPointers` only fires on an art-id-set change; a
  redraw on the same id doesn't). `coach_approved_at` is in `_jobCols`, so every client save carries
  it, and only the portal RPC ever legitimately mints a non-null value. Survives.
- **Durable fix:** because the RPC is the *only* legitimate writer of `coach_approved_at`, reject a
  client save presenting non-null-over-DB-null (pair it with the existing restore for the null
  direction). "Clear harder on recall" does **not** help — any *other* stale tab reintroduces it.

## F3. Portal `jobs[]` loop — a coach-column patch without `art_status` skips every state gate — CONFIRMED
- **Where:** `netlify/functions/portal-action.js:187-195`. A patch containing `art_status` is gated
  (`art_status='waiting_approval'` AND `sent_to_coach_at IS NOT NULL`); a patch **without** it falls
  to the unconditional `admin.from('so_jobs').update(patch)` at `:194`. `JOB_COLS` allows
  `coach_approved_at`, `coach_rejected`, `sent_to_coach_at`, `rejections`.
- **Trigger:** the portal link (`?portal=<alpha_tag>`) is a semi-public URL. A payload
  `{jobs:[{so_id,id,coach_approved_at:'…'}]}` (no `art_status`) writes a coach approval onto **any**
  job in that customer family **in any state** — un-sent, recalled, already-in-production, rejected.
  The `waiting_approval`/`sent_to_coach_at` guards and the whole RPC transaction are bypassed.
- **Second look:** not dead — the handler iterates `jobs` on every call; `portalArtDecision.test.js`
  covers only the `artDecision` RPC path, not this loop. Survives.
- **Durable fix:** state-gate the *decision* columns (`coach_approved_at`, `coach_rejected`,
  `sent_to_coach_at`) specifically. Append-only columns (`art_messages`, `rejections`) legitimately
  need ungated writes, so a blanket gate would over-restrict.

## F4. "Reuse art as-is" bypasses the re-confirm gate → cross-customer approval — CONFIRMED
- **Where:** `src/OrderEditor.js:529-534` (`addPrevArt` clones a prior design but **never resets
  `clone.status`** — a library/promoted copy is `status:'approved'`); `:476` (`applyPriorMock` sets
  an **existing** job straight to `art_complete`/prod-files when `sendToCoach=false`); the re-confirm
  gate at `:3230-3245` only forces carried-in approved art to `waiting_approval` for a **brand-new**
  job (`!existing`).
- **Mechanism:** "reuse as-is" operates on an existing job id, so the gate treats it as intentional
  human advancement and `_preservedArtSt` keeps `art_complete`. Reusing **another team's** design
  (surfaced by the family toggle) marks the job production-ready with zero coach approval for this
  order/customer, and because `coach_approved_at` stays null, none of the "was this approved?"
  badges fire — it reads complete silently.
- **Second look:** the normal picker path *is* caught (fresh art id → no `existing` match → gate
  flips to `waiting_approval`); `applyPriorMock` is the hole because it mutates an existing job.
  Survives.
- **Durable fix:** two roots — reset `clone.status` in `addPrevArt`, **and** make the re-confirm gate
  apply to reuse-driven advancement of an existing job. Fixing either alone leaves the other.

---

# Tier 2 — status silently flips to the wrong value and is saved

## F5. `_artStForFile` omits the `'uploaded'` branch that `buildJobs` has — the true root of the Oak Grove class — CONFIRMED
- **Where:** `src/OrderEditor.js:3038` maps `status==='needs_approval'` → (mock? `waiting_approval` :
  `needs_art`) and **everything else, including `'uploaded'`, → `needs_art`**. `src/businessLogic.js:392`
  maps `(needs_approval || uploaded)` → the same waiting-approval track. Every artist mockup upload
  sets the file to `'uploaded'` (`App.js:20661/21232/21288`, saving only `art_files`).
- **Mechanism:** a job whose design just received an uploaded proof derives `needs_art` in the
  OrderEditor rebuild (and in `_healArtPointers`) while `buildJobs` would say `waiting_approval` — so
  a submitted proof reads "Needs Art" on the order page and, on the next save, persists.
- **Relation to shipped fix #4:** `isPureArtExpansion` stopped this from persisting on the *expansion*
  path only. A single-design job whose file is `'uploaded'` still regresses here. **This is the
  durable seam I missed.** DB: 9 jobs / 8 orders sit at `needs_art` with an `uploaded`-with-mockup
  file right now.
- **Durable fix:** add `|| artF?.status==='uploaded'` to the `needs_approval` branch of
  `_artStForFile` (keeping the `_hasMockupContent` check, so a *mockless* uploaded file still reads
  `needs_art` — this does **not** hide a missing mock). Best: extract the one derivation both
  `buildJobs` and `_artStForFile` call, so they can never drift again. `mergeJobsArtState`'s
  least-advanced rule then propagates the *correct* value instead of amplifying the bug.

## F6. Forward art actions are per-slice — only pull-backs were made split-family-aware — CONFIRMED
- **Where:** `src/OrderEditor.js:189` (`_approveArtTo` advances `jj.id===jobId` only); `:10725`
  (coach-send stamps `i===jIdx` only). My recall/send-back fix wired `_artFamilyIdxs` into the
  *pull-back* paths but not these *forward* ones.
- **Mechanism:** approve one slice of a split job → that slice → `art_complete`, shared file →
  `approved`, but sibling slice stays `waiting_approval`; it never reaches production while the
  family re-appears in the approval queue (dashboard collapses to least-advanced). Coach-send stamps
  one slice → coach approves it → the rest hang un-sent.
- **Second look:** split siblings preserve their own `art_status` (`:3313`); no propagation exists;
  `_artFamilyIdxs` is defined and simply not called here. Survives.
- **Durable fix:** route `_approveArtTo` and the coach-send stamp through `_artFamilyIdxs`, exactly
  as recall/send-back now do.

## F7. Partial art-load persists `art_complete → needs_art` via the unguarded jobs upsert — PLAUSIBLE (narrow trigger, high blast radius)
- **Where:** the syncJobs art heals (`OrderEditor.js` `_healUnresolvedArt` ~:3440 via
  `jobHasUnresolvedArt`, `safeHelpers.js:55`) run off `af = o.art_files || []`; the jobs upsert
  (`dbEngine.js:1802`) has **no `_artHydrated`/`_jobsHydrated` guard**, and the coach guard preserves
  only coach columns, not `art_status`/`_art_ids`.
- **Trigger:** `so_art_files` times out while decorations hydrate (independent queries) → art list
  empty but jobs present → `jobHasUnresolvedArt` returns true (conflating "deleted" with "not
  hydrated") → a completed job is forced to `needs_art` and **saved over** the DB `art_complete`.
- **Second look:** the art *delete* path is guarded `_artHydrated!==false` (`:1395`) and the
  empty-jobs wipe guard exists — proving the codebase knows to gate on hydration — but the jobs
  *status* upsert has no equivalent. If decorations *also* time out, no downgrade fires (hence
  PLAUSIBLE, not unconditional).
- **Durable fix:** don't run art-status heals / don't persist recomputed `art_status` when
  `o._artHydrated===false`; and/or add the `_artHydrated` guard to the jobs upsert mirroring `:1395`.
  Making `jobHasUnresolvedArt` hydration-aware alone is insufficient — F5's derivation also computes
  `needs_art` off the empty list, so the regression would just move.

## F8. External-sync adopts coach *job* state without the *art-file* state when the editor is dirty — CONFIRMED (persist conditional)
- **Where:** `src/OrderEditor.js:573` (`hasExternalJobChange` — **no** dirty gate) vs `:574`
  (`hasExternalArtChange` — gated `&& !dirty`); merge at `:582` (jobs) vs `:608` (art files).
- **Mechanism:** rep has unsaved edits; a coach approves via portal (job → `art_complete` +
  `coach_approved_at`, files → `approved`). The job merge fires but the art-file merge is skipped
  (dirty), leaving `art_status=art_complete` with local files `needs_approval`. Saving persists the
  contradiction; the next open derives the job *down* from the worst file — erasing a real approval.
- **Durable fix:** gate both merges on one predicate (coach approval is one upstream transaction —
  adopt job status and its files together, or neither).

## F9. `CustDetail` coach-preview approval records against `_art_ids` only — CONFIRMED
- **Where:** `src/CustDetail.js:1875-1888` uses `liveJob._art_ids || [art_file_id]` with **no** deco
  augmentation (the real `CoachPortal.js` augments from every item's decos and passes the full set).
- **Mechanism:** `_art_ids` carries only the first group-item's designs, so a multi-garment job with
  design2 on the 2nd garment approves design1 only; the job can even reach `art_complete` with
  design2's production files unconfirmed.
- **Durable fix:** build `jArtIds` in CustDetail with the same augmentation CoachPortal uses — a
  copy-drift repair, not a new mechanism.

---

# Tier 3 — display / wrong art identity

## F10. Mockup viewer reads the PRIMARY art file only — a second location's proof is hidden — CONFIRMED (display)
- **Where:** `src/App.js:20605-20606` (`af = allArtFiles2[0]`; `mockupFiles` pooled from `af`), the
  empty-state at `:20767`, and the artist header at `:21052`. The per-item slot grid (`:20913`)
  renders it correctly, so **one popup disagrees with itself** ("No mockups" banner over a grid that
  shows the mock). A contributor to "it was there, it's not now."
- **Durable fix:** compute `mockupFiles`/empty-state across `allArtFiles2`, not `af`.

## F11. `prevArtDedupKey` collides on same-named designs and merges their file buckets — CONFIRMED
- **Where:** `src/lib/artIdentity.js:33-38` (key = `name|deco_type|art_size|color_ways.length`,
  `design_id` deliberately excluded); picker merge `OrderEditor.js:5805-5811` unions `prod_files`,
  `mockup_files`, `item_mockups`.
- **Mechanism:** two different "Front Logo" designs of the same size/CW-count collapse to one card;
  design A's separations get pooled onto B → the wrong art can be attached to a job.
- **Durable fix:** prefer `design_id` when present, fall back to the name composite only when absent
  — **but first verify `promoteArtToLibrary` preserves `design_id` on the minted copy**, or this
  re-breaks the promoted-copy dedup the current key intentionally avoids.

## F12. `prevArtAutoWireTargets` name-only match re-points an in-progress decoration onto the reused clone — CONFIRMED (moderate)
- **Where:** `src/lib/artIdentity.js:175-180` — the typed branch re-points when deco_type matches AND
  (`design_id` match **OR** name match) AND `cur.status` is empty/`waiting_for_art`. The `window.confirm`
  (`OrderEditor.js:554`) lists garments, not the fact that it's *replacing* existing art.
- **Mechanism:** for two same-named different designs, a garment's genuinely-in-progress (unapproved)
  art is silently swapped for the reused design; its prior file is orphaned. Approved art is safe
  (the status gate), which caps severity.
- **Durable fix:** require `design_id` equality for the typed re-point (same family as F11).

## F13. `_mockKey(sku|color)` collides for two lines sharing SKU+color — PLAUSIBLE
- **Where:** `src/App.js:20635/21161`. Two distinct SO lines of the same product+color in one job
  share a mockup slot; one upload satisfies both and renders for both. Needs the specific duplicate-
  line shape to fire (not found in live data on this pass).
- **Durable fix:** key mockups/slots by a line-unique id (`item_idx`/line key), not `sku|color`.

---

# Latent / not a live bug

## F14. `rejectArt` strands coach-send state + flips only the primary file — LATENT (dead code)
- `src/App.js:20218-20226` would leave `sent_to_coach_at`/`follow_up_at` set on an `art_in_progress`
  job and flip only `j.art_file_id`. **Verified unreachable:** `artRejectModal` has no opener
  (`grep setArtRejectModal({` → none), so `rejectArt` cannot fire from the UI today. It is a landmine:
  if the reject button is ever wired up it ships the SO-1199 + per-location shape.
- **Durable fix (when revived):** it needs `ART_PULLBACK_CLEARS` (with `_coach_cleared`) **and** a
  `jobLiveArtIds` fan-out — which it can't get today because `ART_PULLBACK_CLEARS` is a module-local
  const inside `OrderEditor.js`. Promote that clear-set (and the family/`jobLiveArtIds` helpers) into
  a shared module both files import.

## F15. `matchExistingJob` drops a job when its key changed and its art id is shared — TRADEOFF
- `src/lib/syncJobsMatch.js:38-80` intentionally disables the art-id fallback for shared ids to avoid
  the SO-1159 cross-contamination class. A real loss (a coach-approved job with a shared logo and a
  renamed key re-enters the pipeline), but the alternative is worse. Genuinely needs a stable
  per-job identity (design+position fingerprint) to fix without reopening SO-1159 — flagged for
  awareness, not a quick patch.

---

# The durable direction (not a fix list — the shape of the fixes)

1. **Collapse the duplicated seams.** `ART_PULLBACK_CLEARS`, `_artFamilyIdxs`, and the art-status
   derivation each exist in one file and are re-implemented (or skipped) elsewhere. Promote each to a
   single shared module and route every call site through it. This dissolves F5, F6, F9, F14 and
   prevents the *next* drift — the mechanism that produced this whole class.
2. **Key on identity, not labels.** `design_id` (F11, F12), line id (F13), and per-location slot
   (F1) instead of `name` / `sku|color` / primary-file. This dissolves the multi-location and
   reuse-collision families.
3. **Make the guards bidirectional and gate the right columns.** The coach guard (F2) and the portal
   loop (F3) each reason about one direction / one path; both have a clean invariant available (only
   the RPC mints an approval).
4. **Never persist a recomputed art_status off a partial load.** One `_artHydrated` gate on the jobs
   upsert (F7) closes the highest-blast-radius silent regression.

Fixing any of these at the symptom (one more per-site patch) is precisely what "runs the problem to
the next step." Each durable fix above is a consolidation or an identity change, which is why it
holds.
