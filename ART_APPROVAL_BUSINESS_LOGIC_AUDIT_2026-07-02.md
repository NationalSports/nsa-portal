# Art Approval Business Logic Audit — 2026-07-02

**Scope:** the full art-approval state machine (rep approve / artist submit / coach approve-reject / recall / update), the coach portal loop, and every previous-art reuse path. Everything below was verified against current source (post Recall-vs-Update split, PR #1501), not against the older audit docs.

**Sources:** `src/OrderEditor.js`, `src/App.js`, `src/CoachPortal.js`, `netlify/functions/portal-action.js`, `netlify/functions/followup-sweep.js`, `src/businessLogic.js`, `src/constants.js`, migration `00152`.

---

## 0. Fixed in PR #1501 (this branch)

| Fix | Where |
|---|---|
| **Recall vs Update are now separate actions.** Recall = pull the design back entirely (released jobs return to the dashboard). Update = modal that sends a typed change straight to the assigned artist, job stays in place, revised art re-enters the approval path. | `OrderEditor.js` jobs list + job detail |
| **Stale separations can't skip the re-approval gate.** Recall and Update clear `prod_files_attached` on the affected art files. | recall handlers + both `submitArtReq` copies |
| **No bogus coach state after a pull-back.** Recall and Update clear `sent_to_coach_at`/`follow_up_at` (kills phantom "follow up on art approval" todos and the wrong "Sent to Customer" badge); Recall also clears `coach_rejected`/`coach_approved_at`; Update clears `coach_approved_at`. | same handlers |
| **Production re-holds when art is pulled back.** If a job was `staging`/`in_process`, Recall/Update force `prod_status:'hold'` and the toast warns the rep. | same handlers |

---

## 1. HIGH severity — fix next

### H1. Stale coach-portal links can resurrect a recalled job and push it toward production
`netlify/functions/portal-action.js:88,97,106` — approve/reject writes are unconditional (`update(patch).eq('so_id').eq('id')`), with **no current-state guard**. A coach whose portal tab predates a rep Recall still sees the job at `waiting_approval` (`CoachPortal.js:1090`) and their Approve writes `art_status=production_files_needed` + art files `approved` — resurrecting a job the rep just pulled back. Same class of clobbering for any concurrent rep edit.
**Fix:** gate the server-side job update on `.eq('art_status','waiting_approval')` (estimates on `status='sent'`) and return a conflict the portal can show ("this artwork changed — reload").

### H2. Coach approval isn't pinned to a mockup version
`CoachPortal.js:852-856,912,965-971` render mockups live from the art file; `sent_history` (`OrderEditor.js:9266`) and `coach_approved_at` store no image URL/hash. If the artist re-uploads after the link is sent (which does **not** clear `sent_to_coach_at` — only explicit re-send paths do, `App.js:21859` etc.), the coach approves the *new* image while the rep's records describe the *old* send. Neither side can tell.
**Fix:** snapshot the mock URLs into `sent_history` on send and into a `coach_approved_mocks` field on approve; flag "mock changed since send" when job mockups change after `sent_to_coach_at`.

### H3. The manual art-status dropdown bypasses every approval gate
`OrderEditor.js:8847` — forcing "Art Complete" gates only on the weak `artProdFilesReady` (constants.js:315 — *any* file in `prod_files` passes, e.g. an order-sheet PDF) then **stamps `prod_files_attached:true` itself**, while every button path uses the strict `artProdFilesConfirmed` (constants.js:320). It also jumps to complete with no coach approval and clears nothing (`coach_rejected` survives). Same weak gate in `moveArtStatus` (`App.js:21670`).
**Fix:** gate the dropdown's `art_complete` on `artProdFilesConfirmed` + a confirm dialog; clear rework flags on transition.

### H4. Color-way ✓ in the reuse picker lies on fallback matches
`OrderEditor.js:252` (`_cwForItem`) and `:9660` (`_grpCw`) duplicate a hardcoded light/dark regex. A garment color outside the list (Charcoal, Maroon, Royal…) falls through to `cws[0]`, and the picker still renders a green **"✓ Use for Navy"** for a White-approved mock. The rep trusts the ✓ and a white-garment mock flows onto a navy garment as approved. (Doc REUSE-3 — still open.)
**Fix:** one shared `garmentColorClass()` with a color→shade table; when the match is only the `cws[0]` fallback, drop the ✓ and show "approved on White — confirm".

---

## 2. MEDIUM severity

### State machine
- **M1 — Inline "send it back to the artist" diverges from the Update path.** `OrderEditor.js:8637-8644` (waiting_approval banner) sets `art_in_progress`, touches **only** `j.art_file_id` (not all `_art_ids`), leaves `prod_files_attached`/`sent_to_coach_at`/`follow_up_at` intact, and creates no `art_request` record. Reused-mock jobs come back and re-approve straight to `art_complete` on stale seps. **Fix:** give it the same clears as `submitArtReq` (or route it through the Update modal).
- **M2 — Coach reject leaves `prod_files_attached` set.** `CoachPortal.js:1119,1125`; the flag isn't even in the portal's `ART_COLS` allowlist (`portal-action.js:17`) so the server *can't* clear it. Confirmed seps survive a rejection round-trip. **Fix:** clear on reject + add the column to the allowlist.
- **M3 — Two handlers save from stale closures.** The art-status dropdown (`:8847`) and inline send-back (`:8637`) build from closure `o` and call `onSave` directly, unlike `_approveArtTo` which reads `oRef.current` (`:117`). A click landing right after the portal-merge effect (`:314-356`) overwrites a freshly-merged coach decision, and the `updated_at` bump stops the merge from re-pulling it. **Fix:** read `oRef.current` + `saveSONow` in both.
- **M4 — Approve doesn't clear `coach_rejected`; reject doesn't clear `sent_to_coach_at`** in the portal write set (`CoachPortal.js:1103,1125`). Not fatal (artist re-send resets both) but the write set isn't self-consistent and strands states if any path skips the re-send. **Fix:** make each write set complete.

### Coach loop
- **M5 — Coach decisions can silently email no one.** Approve/reject notify `REPS.find(r=>r.id===liveSO.created_by)` and skip email entirely if that misses (`CoachPortal.js:1098,1121`) — imported/admin-created SOs or an offboarded rep mean the coach responded and nobody hears. The estimate path already falls back `created_by → primary_rep_id → monitored inbox` (`:679-680`). **Fix:** same fallback for art.
- **M6 — A rejection goes invisible once the job moves to `art_in_progress`.** The "❌ Coach rejected art" todo requires `art_status==='art_requested'` (`App.js:8389`, dup `:11345`); assigning an artist hides it though nothing was re-sent. **Fix:** drive the todo off `coach_rejected` until a re-send clears it.
- **M7 — Non-auto follow-ups only exist in-app.** With auto off, `follow_up_at` is still stamped (`OrderEditor.js:9265`) but the server sweep only selects `follow_up_auto=true` (`followup-sweep.js:223`) — the "reminder" fires only if the rep happens to be on the dashboard. **Fix:** label it "in-app reminder" or route through the sweep.
- **M8 — Art files shared across jobs give mixed approval signals.** Portal approve flips the shared `so_art_files` row to `approved` (`CoachPortal.js:1104`) while sibling jobs stay `waiting_approval`; coach must approve N split jobs one-by-one (`:1138-1140`). **Fix:** "approve all mockups on this order" + key approval on the job, not the shared file row.
- **M9 — "Sent to Coach" can mean "a mailto draft opened".** `doSendCoach` stamps `sent_to_coach_at` even when no Brevo key exists and only a local mail draft opened (`OrderEditor.js:9246-9249`). **Fix:** stamp only on confirmed delivery; show "draft opened" otherwise.

### Previous-art reuse
- **M10 — Name-fallback matching ignores `deco_type`.** `OrderEditor.js:231` matches `keyByName[name]` with no deco check — an embroidery "Spirit Logo" mock surfaces for a screen-print job. **Fix:** require `deco_type` equality on the name path.
- **M11 — Legacy mocks in `mockup_files` never surface for reuse.** `priorMocks` reads only `item_mockups` (`:226,233-239`); older approved art shows an empty picker and the rep re-requests from the artist for a design the customer already approved. **Fix:** also emit `mockup_files` as a general group.
- **M12 — `design_id` is only deterministic for backfilled/cloned art.** Backfill uses `md5(name|deco)` (migration `:18`) but `addArt` stamps a random id (`OrderEditor.js:2208`) and Quick-Mock art gets none (`:9522`) — two reps creating "Eagle Logo" independently never link, and a rename breaks reuse again (REUSE-1 half-done). **Fix:** stamp the deterministic id at creation.
- **M13 — The Previous Artwork picker offers un-approved art with no status badge.** `prevArtList` filters only `archived` (`:4875`), the clone keeps the source status (`:296`), the card shows no approval state (`:4924-4937`) — reusing a `waiting_for_art` design dead-ends (no mock, no picker, back to the artist). **Fix:** badge approval state; warn on non-approved reuse.
- **M14 — Reuse still requires hand-wiring decorations.** `addPrevArt` appends the clone but re-points nothing (`:291-309`); the rep must open every item and swap `art_file_id` manually (`changeArtFileId` `:2150`). This is the single biggest click cost in the reuse flow (REUSE-2 — still open). **Fix:** auto-point matching garments' decorations on reuse.
- **M15 — Reuse pickers are unreachable from a fresh job.** Check-Mock and the wizard reuse-pick require `art_complete`/prod-file statuses (`:8188`, `:9645`, `:9832`) — a fresh `needs_art` job with previously-approved art can't reach them, so the "cheap path" is only discoverable after release. Actual cost of the "3-click" reuse advertised in the workflow map is ~7+ clicks plus per-item wiring plus a wizard↔job↔wizard bounce. **Fix:** surface "♻️ Reuse approved art from SO-xxxx?" directly on `needs_art` jobs (REUSE-5).

---

## 3. LOW severity / polish

- **L1** Rejection timestamp key mismatch: portal writes `rej.at` (`CoachPortal.js:1115`) but the todo reads `rejected_at` (`App.js:8389`) → date falls back to `updated_at`.
- **L2** Duplicate todo generators (`App.js:8378-8389` vs `:11341-11345`) and duplicate art-request modals (`OrderEditor.js:9130` vs `:10031`, currently byte-equivalent) — consolidate before they drift again.
- **L3** Follow-up cap default mismatch: modal `max:4` (`OrderEditor.js:9267`) vs sweep `DEFAULT_MAX=6` (`followup-sweep.js:22`).
- **L4** Same state shown as "Sent to Customer" / "Sent to Coach for Approval" / "Awaiting Your Approval" in three surfaces — pick one term.
- **L5** Coach approval always parks at a prod-files status even when seps are already confirmed (`CoachPortal.js:1094`), forcing a no-information "Mark Art Complete" click. Route to `art_complete` when `_art_ids.every(artProdFilesConfirmed)`.
- **L6** On re-approval after a rejection, the coach sees no echo of their prior feedback or what changed (`CoachPortal.js:1083-1134`).
- **L7** Skip-Artist's mock guard accepts a mock for the wrong color-way (`OrderEditor.js:9445` counts *any* `item_mockups` entry); caught later by Check-Mock, so briefly-wrong rather than dangerous.
- **L8** `addPrevArt`'s `selUrls` keep-mockups parameter is dead code — the only caller passes `new Set()` (`:4935`).
- **L9** Proof page doesn't name the color-way being approved (`CoachPortal.js:926-930`).

---

## 4. Reconciliation with earlier docs

Previously-reported issues now **verified fixed** in current code: `mock_links` persistence (migration 00152 + `constants.js:26`), `applyPriorMock` stranding `coach_rejected` (`OrderEditor.js:268,279`), Skip-Artist reaching `art_complete` with zero mocks (`:9445`), clone "+Add" silently attaching prod files / stale mock_links (`:301,308`), fire-and-forget reuse saves (`:281`, `saveSONow`).

Still open from `ARTWORK_RECOMMENDATIONS.md` / `ARTWORK_WORKFLOW_MAP.md`: REUSE-2 (one reuse action, auto re-point), REUSE-3 (honest color-way matching → **H4**), REUSE-4 (approval provenance → **H2/M8**), REUSE-5 (proactive reuse → **M15**), plus the deterministic-`design_id` gap (**M12**).

---

## 5. Suggested sequencing

1. **H1 + H2** — server-side state guard and mock-version pinning. These are the two ways a customer can "approve" something nobody intended; everything else assumes they're closed.
2. **H3 + M1 + M2** — close the remaining gate bypasses (dropdown, inline send-back, coach reject) so `prod_files_attached` and the approve gate mean the same thing on every path.
3. **H4 + M10-M13** — make reuse matching honest (color-way, deco type, legacy mocks, deterministic design_id, status badges). Low-risk logic fixes, big trust payoff.
4. **M14 + M15** — the reuse workflow redesign (auto re-point + proactive offer). This is the "previous art approvals are too clunky" fix: it turns ~7+ clicks and a wizard bounce into a one-confirm reuse.
5. **M5-M9, L1-L9** — notification robustness and polish, as capacity allows.
