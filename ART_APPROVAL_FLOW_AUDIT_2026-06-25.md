# Art Approval Flow Audit — 2026-06-25

Triggered by SO-1199 (Fresno Pacific Women's Soccer, "Fall 2026 Gear"): a coach
requested changes on two jobs, but the portal kept showing them as **"waiting for
approval"** and the mockups vanished from the job view while still appearing on the
Art Dashboard.

This document maps the art approval state machine, the forensic root cause of the
incident, every defect found, and the fixes applied.

---

## 1. The state machine

Art moves through **two parallel status fields** that must stay in sync:

| Stage | Job `so_jobs.art_status` | Art file `so_art_files.status` |
|-------|--------------------------|--------------------------------|
| Art requested from artist | `needs_art` → `art_requested` | `waiting_for_art` |
| Artist working | `art_in_progress` | `waiting_for_art` |
| Sent to rep / coach for approval | `waiting_approval` | `needs_approval` |
| Approved (awaiting prod files) | `production_files_needed` / `order_dtf_transfers` / `upload_emb_files` | `approved` |
| Done | `art_complete` | `art_complete` |

**Coach requests changes** (via the public portal, `netlify/functions/portal-action.js`):
- Job: `art_status` → `art_requested`, `coach_rejected` → `true`, append to `rejections[]`
- Art file: `status` → `waiting_for_art`, append "Coach feedback: …" to `notes`

The Art Dashboard column is derived almost entirely from the **job** `art_status`
(`getArtFileStatus` in `App.js`); the per-job badge on the order page uses the same
mapping (`jobArtBadgeSt` in `OrderEditor.js`). Mockups live on the **art file**
(`mockup_files`, `files`, and per-garment `item_mockups[sku|color]`).

---

## 2. What actually happened (forensics)

Reconstructed from `audit_log` for the two affected jobs and their art files. Both
followed an identical three-step sequence:

| Time (UTC) | Actor | Job `art_status` | Art file `status` | Notes |
|-----------|-------|------------------|-------------------|-------|
| ~21:24–21:27 | Rep (Steve) | → `waiting_approval` | → `needs_approval` | Mockup sent for approval |
| 21:53–21:54 | **Coach** (service role, `changed_by = null`) | → `art_requested` | → `waiting_for_art` | `coach_rejected=true`, feedback saved ✅ |
| **22:15** | **Rep (Steve)** | → **`waiting_approval`** | → **`needs_approval`** | **"Mockup sent to rep for approval" — reverted** ❌ |

The coach's rejection worked correctly. **~21 minutes later the rep re-sent the same,
un-revised mockup for approval**, which flipped both statuses back to the pre-rejection
state. The re-send only touched `art_status` + `art_messages` (job) and `status`
(art file) — it left `coach_rejected=true` and the `rejections[]`/`notes` feedback
stranded, producing a self-contradictory record:

> `art_status = waiting_approval` **and** `coach_rejected = true`

That is exactly the reported symptom: the board says "waiting for approval" while the
coach had in fact asked for changes.

The mockups were **never deleted** — all three garment mockups remained intact in
`item_mockups` (valid Cloudinary URLs). They "disappeared" from the job only because of
a display gate (Bug B below).

---

## 3. Defects found

### Bug A — Forward transitions silently clobber a coach rejection  *(root cause)*
Every code path that moves a job *forward* past a rejection sets `art_status` without
checking or clearing `coach_rejected`:
- `App.js` Art Dashboard card → "Send to Rep"
- `App.js` Art Mockup modal → "📤 Send to Rep"
- `App.js` art job-detail modal → `sendForApproval()`
- `App.js` "Send for Approval" notification modal → `doSend()`
- the shared `moveArtStatus(j,'waiting_approval')`
- `OrderEditor.js` rep "✅ Approve Artwork" → `_approveArtTo(...)`

So re-sending **or approving** art that the coach had just rejected — whether a real
revision or an accidental click — silently advanced the status and left
`coach_rejected=true` stranded. Nothing warned the user that a coach change-request was
being overwritten. In the SO-1199 incident this happened **twice**: first a re-send
reverted `art_requested → waiting_approval`, then an approval pushed it on to
`production_files_needed` / `order_dtf_transfers` (art files → `approved`) — all while
`coach_rejected` stayed `true`.

### Bug B — Mockups + coach feedback vanish from the job once status ≠ `waiting_approval`
The per-item mockup panel in the order's **Jobs** tab (`OrderEditor.js`) was gated
solely on `art_status === 'waiting_approval'`. The moment a coach rejection flipped the
job to `art_requested`, the job view showed only a generic "Art Request Sent — waiting
for the artist" banner: **no mockups, no coach feedback**. The Art Dashboard reads
`item_mockups` unconditionally, so it kept showing them — the precise asymmetry that was
reported. The structured `rejections[]` feedback was never surfaced in the order view at
all.

### Bug C — No reconciliation of the contradictory state
`coach_rejected=true` together with `art_status=waiting_approval` is internally
inconsistent and nothing detects or repairs it. Because the dashboard keys off
`art_status`, a clobbered job re-appears under "Needs Approval," hiding the fact that the
coach asked for changes.

---

## 4. Fixes applied

### Fix 1 — Moving forward supersedes the rejection, consistently (Bug A, C)
- `moveArtStatus(...)` now clears `coach_rejected` whenever a job transitions to
  `waiting_approval`. The `rejections[]` history is preserved.
- All four "send for approval" handlers explicitly set `coach_rejected:false` in their
  job patch (the local `sos` snapshot can be stale right after `moveArtStatus`, so the
  flag is cleared at each site too).
- `_approveArtTo(...)` (rep "Approve Artwork") clears `coach_rejected` as well, so an
  approved / in-production job can never carry a stranded rejection flag.

### Fix 2 — Guard against clobbering an unaddressed change-request (Bug A)
- A shared helper `_confirmResendIfRejected(job)` warns the rep/artist when they re-send
  a job that still carries a coach rejection, showing the coach's last feedback verbatim
  and requiring confirmation. Wired into all four send-for-approval handlers.
- `_approveArtTo(...)` shows an equivalent "approve anyway? this overrides the coach's
  change request" confirmation before approving rejected art.

### Fix 3 — Keep the mockup + feedback visible after a change-request (Bug B)
The order's **Jobs** tab now renders a "Coach Requested Changes" panel for
`art_requested` / `art_in_progress` jobs that carry a rejection. It shows the coach's
feedback and the reviewed mockup thumbnails (click to enlarge), mirroring the Art
Dashboard so the job view no longer goes blank. The generic "Art Request Sent" banner is
suppressed in that case to avoid duplication. (Also surfaces rep-side rejection feedback,
which previously had no prominent display.)

### Data fix — SO-1199
By the time the code fixes landed, JOB-1199-02 ("Fresno Pacific Soccer Shield") and
JOB-1199-03 ("3in Shield Heat Press") had been pushed forward again to
`production_files_needed` / `order_dtf_transfers` (art files `approved`) while
`coach_rejected` was still `true` — the same clobber, one stage further along. The final
state for these two records is a business decision (honor the coach's change request, or
keep the rep's approval and just clear the stranded flag) and is handled separately from
this code change. Mockups were never lost — all three garment mockups remain intact in
`item_mockups`.

---

## 5. Verification checklist

- [ ] Coach requests changes → job shows "Coach Requested Changes" with feedback + mockup, **not** "waiting for approval".
- [ ] Art Dashboard and the order's Jobs tab agree on status and both show the mockup.
- [ ] Re-sending a coach-rejected job prompts a confirmation showing the coach's feedback.
- [ ] After a confirmed re-send, `coach_rejected` is cleared and the job reads `waiting_approval` cleanly (no stranded flag).
- [ ] `rejections[]` history is preserved across the re-send.
