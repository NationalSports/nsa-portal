# Art Approval — Deep Audit, 2026-07-10

**Scope.** The full art-approval path across both repos: rep request/approve/recall/update,
artist board, the coach portal (public link → `portal-action.js` → `apply_coach_art_decision`
RPC), the follow-up sweep, previous-art reuse, and the webstore/OMG art bridge into SO jobs.
Every finding below was read against current source and, for the load-bearing ones, re-derived
by hand or checked against the live DB — not taken from commit messages.

**Method.** Six parallel finder passes (prior-finding reconciliation, state-writer inventory,
this-week's-fixes regression scan, rep handlers, reuse paths, artist board, webstore bridge,
RLS/website/tests) → dedupe → adversarial verification of each survivor. Sources:
`src/OrderEditor.js`, `src/App.js`, `src/CoachPortal.js`, `src/CustDetail.js`, `src/Webstores.js`,
`src/businessLogic.js`, `src/constants.js`, `src/lib/{syncJobsMatch,artIdentity,artGrid,dbEngine}.js`,
`netlify/functions/{portal-action,followup-sweep}.js`, migration `00172`, live project `hpslkvngulqirmbstlfx`.

---

## Bottom line

**The thing that caused this week's incidents — the coach-decision write path — is now solid.**
The `apply_coach_art_decision` RPC (migration `00172`, confirmed applied live) locks the job,
rejects a stale-tab decision (`NSA_STALE_STATE`), rejects an approval whose mocks changed under
it (`NSA_MOCKS_CHANGED`), and writes the complete approve/reject set atomically. `portal-action.js`
scopes every write to the portal's own customer family and only lets the portal *clear*
`prod_files_attached`, never set it. Of the four HIGH items in the 2026-07-02 audit, **H1, H2, H4
are fully fixed and H3 is fixed on the rep dropdown.** That's the good news and it's most of the surface.

**But the audit surfaced one new HIGH business-logic gap and one confirmed regression, plus a
band of mediums.** Ranked, most severe first:

| # | Severity | One-line | Status |
|---|---|---|---|
| A1 | **HIGH** | Coach portal shows & lets the coach approve `waiting_approval` art that was **never sent to them** — the rep-review gate is bypassable | New |
| A2 | **HIGH** | Embroidery approval gate accepts a **stale `.dst`** left over after a recall/update — reopens the July-2 "stale separations" fix, for embroidery only | **Regression (2026-07-07)** |
| A3 | MED | `doSendCoach` stamps `sent_to_coach_at` + schedules follow-ups even when only a mailto **draft** opened (or nothing sent) | July-2 M9, still open |
| A4 | MED | Rep-side "Portal preview" approve/reject in `CustDetail` bypasses the state-guarded RPC and omits `coach_approved_at:null` on reject | New drift |
| A5 | MED | Inline "Request Update" on the waiting-approval banner only resets the **first** art file, clears no seps/coach flags, logs no request | July-2 M1, still open |
| A6 | MED | `applyPriorMock` flips **every** art file on the job to `approved`, not just the one whose mock was reused | New |
| A7 | MED | Wizard "Skip Artist" releases a **partially-mocked** group straight to `art_complete` (group-wide mock check) | New |
| A8 | MED | Webstore/OMG batch **force-approves** any non-approved library art, and the fresh job then re-enters the coach queue (A1) | New interaction |
| A9 | MED | `so_jobs` save has **no version/CAS guard**; the schema-retry path silently strips every coach/follow-up column | July-2 L11 + new |
| — | LOW | A cluster of reuse-identity, shared-art, and label issues (see §4) | Mixed |

None of these is in the same class as the pre-`00172` "a coach approves something nobody intended"
hole — that hole is closed. A1 is the closest remaining relative and is the one I'd fix first.

---

## 1. HIGH findings

### A1 — The coach can approve art that was never sent to them *(new, HIGH)*

`CoachPortal.js:761`
```js
const waitingArtJobs = allPortalJobs.filter(j => j.art_status === 'waiting_approval');
```
`allPortalJobs` is every job on every non-complete SO for the customer **and its sub-teams**
(`activeSOs`, line 721; `custSOs`, line 709). There is **no `sent_to_coach_at` filter.** This list
feeds the dashboard "Designs to Review" card verbatim (`:2026`, `waitingArtJobs.slice(0,3)`), and
"Review" opens the job detail whose Approve / Request-Changes buttons are gated only on
`art_status==='waiting_approval'` (`:1523,1530`). The server RPC likewise only checks
`art_status='waiting_approval'` — not whether the job was ever forwarded.

**Why this is a gate bypass.** Every artist mockup submission parks the job at `waiting_approval`
with `sent_to_coach_at` still null (`App.js:19621`, `:20208` "Send to Rep" set `art_status:'waiting_approval'`).
The intended flow is: artist submits → **rep reviews** → rep clicks "Send to Coach" (`doSendCoach`
stamps `sent_to_coach_at`). During the (routine, often multi-day) window before the rep reviews,
a coach who opens their persistent per-customer portal link sees the proof under **"Awaiting Your
Approval"** and can approve it — skipping internal rep review entirely. The whole `sent_to_coach_at`
mechanism (the Send-to-Coach modal, the email, the follow-up scheduler) is bypassed for display and
approval. This is the direct descendant of the July-2 top-priority class ("a customer can approve
something nobody intended"); `00172` closed the *stale-tab* version, but not this *never-sent* version.

**Failure scenario.** Artist uploads a first-draft mockup Tuesday AM (job → `waiting_approval`, rep
hasn't looked). Coach opens their bookmarked portal Tuesday night, sees "Designs to Review (1)",
clicks Approve. Job jumps to `production_files_needed`/`art_complete`; the rep never reviewed the
draft they intended to revise, and the customer has now "approved" it.

**Fix direction.** Gate `waitingArtJobs` (and the RPC's approve path) on `sent_to_coach_at` being set —
i.e. a coach can only act on art a rep actually forwarded. This is partly a policy call (do you ever
want proactive coach review?), so confirm the intended rule before changing it; but at minimum the
"Awaiting Your Approval" label on un-forwarded art is wrong.

### A2 — Embroidery approval accepts a stale `.dst` after a recall/update *(regression, HIGH)*

`constants.js:355`
```js
export const artProdFilesConfirmed=(af)=>{if(!af)return false;if(af.prod_files_attached===true)return true;
  if((af.deco_type||'')==='embroidery')return[...(af.files||[]),...(af.prod_files||[])].some(isDstFile);return false};
```
`git log -L` pins the embroidery branch to commit **93401d1 (2026-07-07), "Let an embroidery .dst
confirm production files even when prod_files_attached=false."** That change removed the
`prod_files_attached===false → return false` short-circuit for embroidery — which is exactly the
guard the 2026-07-02 audit's PR #1501 added ("an old `.dst` left on the row after a Recall/Update no
longer lets re-approval skip the seps re-check"). So the July-2 fix is **reopened for embroidery.**

The recall/update handlers (`_recallArt` `OrderEditor.js:159`, both `submitArtReq` copies) set the art
file to `status:'waiting_for_art', prod_files_attached:false` but **never strip the `.dst` out of
`files`/`prod_files`.** The approve gate (`OrderEditor.js:9082`) and `moveArtStatus` (`App.js:19422`)
call `artProdFilesConfirmed` directly on the raw art file, with no `af.status` check first — despite
the code comment at `constants.js:350-352` claiming callers gate on status. They don't.

**Failure scenario.** Embroidery job reaches `art_complete` with a real DST. Rep recalls it for a
design change (`prod_files_attached→false`, but the old `.dst` stays in the array). Artist redoes the
digitizing, job returns to `waiting_approval`. Rep clicks **Approve Artwork** → `artProdFilesConfirmed`
sees the *old* `.dst` still present → returns true → the production-files stage is skipped → job goes
straight to `art_complete`, and the embroidery machine runs the **stale** digitized file.

**Fix direction.** Two intents collide here: 93401d1 wanted a legit DST to confirm even if the flag is
false (fixing a false "waiting for files" banner); July-2 wanted `false` to mean "invalidated." Reconcile
by making the pullback the source of truth: on recall/update, **drop the `.dst` (and the
`dtf_order`/`emb_sent` markers, cf. L13) from `files`/`prod_files`** so the array honestly reflects
"no current production file," *then* the DST-based confirm is safe. Alternatively gate the embroidery
branch on `af.status==='approved'`. Do not simply revert 93401d1 — that re-breaks its banner fix.

---

## 2. MEDIUM findings

### A3 — "Sent to Coach" is stamped on a mail draft, or on nothing *(July-2 M9, open)*
`OrderEditor.js:9707-9708,9735,9738`. With no Brevo key, the email path opens `mailto:` and pushes
`'email draft opened'` to `actions`; the job is then stamped `sent_to_coach_at` + a follow-up scheduled
(`:9735`) regardless. The toast at `:9738` even reads `actions.length>0 ? 'Sent…' : 'No notification
method selected'` — the code *knows* `actions` can be empty, yet still stamps the send. Result: a job
reads "Sent to Coach for Approval," the follow-up sweep will nag, but nothing was delivered. **Fix:**
only stamp `sent_to_coach_at`/schedule follow-ups when a confirmed send occurred; for the draft path,
mark "draft opened" distinctly.

### A4 — The rep-side "Portal preview" writes bypass the guarded RPC *(new)*
`CustDetail.js:1830-1850` renders an in-app preview of the coach portal with live Approve / Request-Changes
buttons that write directly via `onSaveSO` — **not** through `_portalAction`/`apply_coach_art_decision`.
So none of `00172`'s stale-state or mock-change guards apply, and (unlike every other reject write set)
the reject at `:1846` omits `coach_approved_at:null`, leaving a job `coach_rejected:true` with a stale
non-null `coach_approved_at` — the contradictory-state class `00172` closes everywhere else. Its own
comment says it "mirrors the coach portal's reject write set"; the mirror has drifted. **Fix:** route
this preview's writes through `_portalAction`, or drop the write buttons from a *preview*.

### A5 — Inline "Request Update" diverges from the real Update path *(July-2 M1, open)*
`OrderEditor.js:9088-9095`. The waiting-approval banner's "Request Update" resets only
`af.id===j.art_file_id` (the single primary art file, not the job's full `_art_ids`), clears no
`prod_files_attached`/`sent_to_coach_at`/`follow_up_at`, and logs no `art_request`. On a multi-design
job, sibling designs keep `status:'approved'`; combined with A2, a stale confirmed-seps flag is never
invalidated here either. **Fix:** give it the same clears as `submitArtReq`/`_recallArt`, or route it
through the Update modal.

### A6 — `applyPriorMock` approves the whole job's art, not just the reused design *(new)*
`OrderEditor.js:339`. When a mock is reused for one art file, the map flips **every** id in
`jobArtIds` to `approved`/`needs_approval`:
```js
if(jobArtIds.includes(a.id)) na={...na,status:sendToCoach?'needs_approval':'approved'};
```
On a two-design job (front logo A un-mocked, back logo B reused), reusing B's mock also marks A
`approved` — A shows the "✓ Approved" badge with no mock and can satisfy downstream `status==='approved'`
gates. **Fix:** only advance the art file(s) whose mock was actually applied.

### A7 — "Skip Artist" releases a partially-mocked group as complete *(new)*
`OrderEditor.js:9918-9925`. `_hasMock` is true if *any* `item_mockups` key across the group's art is
non-empty — not whether each released garment has its own mock. A reused-mock group where garment 1
has a mock and garment 2 never did releases the **whole group** (incl. garment 2) to `art_complete`
("Ready for Production"). **Fix:** require a mock per released garment, mirroring `skusMissingMockups`.

### A8 — Webstore/OMG force-approve + `_newArtSt` = false coach queue *(new interaction)*
`Webstores.js:2801` / `App.js:14933` force any reused library art to `status:'approved'` on batch-SO
creation (the store sale is treated as the approval). But `_newArtSt` (`OrderEditor.js:2795`, added
2026-07-05) forces a brand-new job whose art is already approved back down to `waiting_approval` on
first sync — and via A1 that job then appears in the coach's "Designs to Review" as if approval were
pending, for a design the customer already bought. The force-approve also can't distinguish
"never reviewed" / "sent back" from "approved elsewhere," and doesn't reset a carried-over
`prod_files_attached:true` (unlike the manual reuse path at `OrderEditor.js:399`), so a stale confirmed-seps
flag can ride in and (with A2) skip the seps stage. **Fix:** decide the intended rule for store-origin
art (skip the coach gate entirely, or require it) and make display + `_newArtSt` + the force honor it
consistently; reset `prod_files_attached` on the cloned art.

### A9 — `so_jobs` persistence has no concurrency guard *(July-2 L11 + new)*
`dbEngine.js:1389-1414`. Unlike `so_items` (version-conflict guard) and `estimates` (status-rank
merge that specifically protects a coach approval from a stale client save), `so_jobs` is a blind
`upsert` of whatever the client holds, plus an unconditional delete of any DB job id the client lacks.
A stale-closure handler (A5, the manual dropdown, `_recallArt`, `doSendCoach` — all build from the
render closure `o` and call plain `onSave`) or a background diff-save can overwrite a just-merged coach
decision with no server rejection. Separately, the schema-cache retry (`:1396`) strips **every**
`_jobExtraCols` entry — `sent_to_coach_at`, `coach_approved_at`, `coach_rejected`, `follow_up_*`,
`art_requests` — in one shot, so a first-upsert column error lands the `art_status` change but drops
all the coach flags. **Fix:** a CAS/version guard on `so_jobs` (the standing "art-status RPC"
recommendation), and retry per-missing-column rather than dropping the whole extra set.

---

## 3. What I verified is CLEAN (the assurance you asked for)

- **The coach-decision transaction.** `00172` locks the job `FOR UPDATE`, rejects `art_status<>'waiting_approval'`
  (`NSA_STALE_STATE`), rejects an approve whose `seen_mocks` no longer exist in the art pools
  (`NSA_MOCKS_CHANGED`), and writes the full approve/reject set (incl. `coach_rejected` cleared on
  approve, `sent_to_coach_at`/`coach_approved_at` cleared on reject, timestamp under both `at` and
  `rejected_at`) atomically. Live check: the function and `coach_approved_mocks` column are both present.
- **`portal-action.js` boundary.** Every target is scoped to the portal's `alpha_tag` customer family;
  `JOB_COLS`/`ART_COLS` allowlists reject arbitrary columns; the portal may only *clear*
  `prod_files_attached`, never set it; the legacy direct-patch path is state-guarded on `art_status`.
- **RLS.** Every table the portal reads still has an `anon` SELECT policy (live `pg_policies` check);
  no `anon` write path the portal depends on for `so_jobs`/`so_art_files`/`sales_orders`. (Two adjacent
  notes outside art-approval scope: a leftover table-level `anon` INSERT/UPDATE/DELETE *grant* on the
  five core order tables — not exploitable because RLS default-denies, but inconsistent; and
  `webstore_roster` anon writes from `CoachPortal.js` are broken by an earlier lockdown — already tracked
  in `RLS_MATRIX_TODO.md`.)
- **H1/H2/H4** (July-2 HIGH): fixed. **H3**: fixed on the rep dropdown (confirm dialog, no self-stamp).
- **Reuse honesty (H4/color-way):** one shared `garmentColorClass`/`_cwMatchForItem`; a fallback match
  no longer shows a green ✓. **syncJobs rejection bleed (SO-1159):** the `matchExistingJob` +
  single-claim rewrite holds; cross-sibling `coach_rejected` bleed is closed. **Cross-team contamination
  (SO-1057):** `artIdentity.js` keeps team art authoritative over the parent library in the write paths.
- **Follow-up sweep** send-safety (claim-before-send CAS, resolved-doc stop, unsubscribe) is sound.

---

## 4. LOW / watch-list

- **M8 (open):** shared-art sibling jobs must be coach-approved one-by-one — the RPC updates only the
  acted job (`00172:104`), and the portal renders one card per `j.id` with no "approve all." Live DB: 3
  currently-waiting jobs share a line with a sibling. Low blast radius, real friction.
- **`58` reuse-identity gaps (M12):** `addArt` stamps a random `design_id`; Quick-Mock art and
  `promoteArtToLibrary` stamp none — so a rename breaks name-based reuse matching (`OrderEditor.js:2405,
  10002,2447`). Also, `resolvePriorMockKey`/auto-wire use `design_id` only as a positive signal, never a
  veto, so two designs with *different* ids but the same name can still auto-match (`artIdentity.js:131`).
- **`hydrateStoreArt` (artGrid.js:121):** the size-normalized name fallback can bridge a bare store
  upload to a differently-named sibling's library art across a shared parent — the football-on-volleyball
  class via the newest match tier. Also overwrites a store's own `color_ways` even when not richer (`:125`).
- **syncJobs size-override loop (OrderEditor.js:2825):** re-derives `existing` without consulting the
  `_claimedExistingIds` set the main loop threads, so two same-art jobs at different positions can both
  inherit one job's split-size overrides. Narrow trigger.
- **`__tbd` upload fallback (App.js:20471):** an upload with `artId==='__tbd'` mints a real art row with
  `id:'__tbd'`; two such uploads collide on that sentinel id and cross-write mockups. Doesn't bypass the
  approval gate (`jobHasUnresolvedArt` hardcodes `'__tbd'` as never-live) but mixes two jobs' mocks.
- **Duplicate todo generators (App.js:7260 vs :10261):** the coach-rejected gate is currently identical
  in both, but the mobile copy already dropped the "mockup ready to review" branch the desktop copy has —
  drift in progress. **L3:** follow-up cap default is `4` client-side vs `6` in the sweep. **L12:** recall
  of a job already `prod_status:'completed'` neither re-holds nor warns.

---

## 5. Recommended sequence

1. **A1** — gate coach visibility/approval on `sent_to_coach_at` (confirm the policy first). This is the
   one that can manufacture an unintended customer approval; everything the July-2 audit worried about
   assumes it's closed.
2. **A2** — strip stale `.dst`/markers on recall/update (also closes L13), so the embroidery gate can't
   be satisfied by an old file. Confirmed regression from 2026-07-07; touches a production-quality path.
3. **A3 + A4 + A5** — make the remaining write paths (send-to-coach stamping, the `CustDetail` preview,
   the inline Request-Update) agree with the guarded flow so "sent," "approved," and "invalidated" mean
   the same thing everywhere.
4. **A6 + A7 + A8** — reuse/store-art correctness: approve only the reused design, require a mock per
   released garment, and settle the store-origin approval rule.
5. **A9** — the `so_jobs` CAS guard; it's the structural backstop that makes the stale-closure handlers
   safe rather than merely usually-fine.

None of these was auto-fixed — several (A1, A8) hinge on a business-rule decision (is the rep-review
gate mandatory? do store orders need coach approval?) that's yours to make. Say which you want and I'll
implement them one focused PR at a time.
