# Artwork Data Coherence & Persistence Test Plan

**Date:** 2026-03-08
**Scope:** Full lifecycle — Estimate → SO → Art Workflow → Dashboard
**Deco Types:** Screen Print + Embroidery
**Roles Tested:** Artist, Sales Rep, Coach/Admin
**Primary Focus:** File visibility, data persistence, and information completeness across all views

---

## Phase 1: Create Estimate with Artwork

### Step 1.1 — Create a new Estimate
- [ ] Create a new estimate for a test customer
- [ ] Add at least 2 line items (one for screen print, one for embroidery)
- [ ] Fill in quantities across multiple sizes
- **Screenshot:** Estimate overview showing both line items

### Step 1.2 — Add Artwork Entries to Estimate
- [ ] Add art file #1 (Screen Print): set deco type, PMS ink colors, art size, upload a sample design file
- [ ] Add art file #2 (Embroidery): set deco type, thread colors, stitch count, art size, upload a sample design file
- [ ] Verify both art entries appear in the estimate art section with correct metadata
- **Screenshot:** Estimate art section showing both entries with all fields populated

### Step 1.3 — Verify Estimate Art Persistence
- [ ] Refresh the browser (hard reload)
- [ ] Re-open the estimate
- [ ] Confirm both art files still appear with correct: deco type, colors, sizes, uploaded files
- **Screenshot:** Same view after reload — compare to Step 1.2

---

## Phase 2: Convert Estimate to Sales Order

### Step 2.1 — Approve & Convert Estimate to SO
- [ ] Approve the estimate and convert to a Sales Order
- [ ] Verify SO is created with both line items intact
- **Screenshot:** New SO overview showing items carried over

### Step 2.2 — Verify Art Files Carried Over to SO
- [ ] Open the SO and navigate to artwork section
- [ ] Confirm both art entries exist on the SO (screen print + embroidery)
- [ ] Verify all metadata transferred: deco type, colors (PMS/thread), stitch count, art size, notes
- [ ] Verify uploaded sample files are accessible/viewable on the SO
- **Screenshot:** SO art section showing both entries with all metadata and files

### Step 2.3 — Verify Jobs Were Created
- [ ] Check that SO jobs were generated (one per decoration)
- [ ] Confirm each job references the correct art file
- [ ] Verify job art_status starts at the expected initial state (e.g., `needs_art` or `waiting_for_art`)
- **Screenshot:** SO jobs list showing art file linkage and status

---

## Phase 3: Artist Workflow — Upload & Submit Art

### Step 3.1 — Artist View: Job Visibility
- [ ] Switch to (or log in as) an **Artist** role user
- [ ] Open the Artist Workboard (dashboard)
- [ ] Verify the screen print job appears with: customer name, SO #, art name, deco type, PMS colors, art size, unit count, deadline
- [ ] Verify the embroidery job appears with: customer name, SO #, art name, deco type, thread colors, stitch count, art size, unit count, deadline
- **Screenshot:** Artist workboard showing both jobs with full context info

### Step 3.2 — Artist: Upload Mockup Files
- [ ] Open the screen print job
- [ ] Upload a general mockup file
- [ ] Upload an item-specific mockup (if applicable)
- [ ] Verify mockup file count updates in the job card
- [ ] Repeat for the embroidery job
- **Screenshot:** Both jobs showing mockup uploads and file counts

### Step 3.3 — Artist: Upload Production Files
- [ ] Upload production file(s) for the screen print job (e.g., separations)
- [ ] Upload production file(s) for the embroidery job (e.g., DST/EMB file)
- [ ] Verify prod file counts update
- **Screenshot:** Both jobs showing production file uploads

### Step 3.4 — Artist: Move Art Status Forward
- [ ] Move screen print job art_status to `needs_approval` (or `waiting_approval`)
- [ ] Move embroidery job art_status to `needs_approval`
- [ ] Verify status badges update on the workboard
- **Screenshot:** Workboard showing both jobs in approval-pending state

### Step 3.5 — Verify File Persistence After Upload
- [ ] Refresh the browser
- [ ] Re-open artist workboard
- [ ] Confirm all uploaded files (sample art, mockups, prod files) still appear on both jobs
- [ ] Confirm file counts are accurate
- **Screenshot:** Artist workboard after reload — compare to Step 3.4

---

## Phase 4: Sales Rep View — Review Art

### Step 4.1 — Rep Dashboard: Art Approval Todos
- [ ] Switch to (or log in as) a **Sales Rep** role user
- [ ] Open the Rep dashboard
- [ ] Verify "waiting for approval" todos appear for both jobs
- [ ] Confirm todo shows: customer, SO #, art name, deco type
- **Screenshot:** Rep dashboard showing art approval action items

### Step 4.2 — Rep: Review Art Files
- [ ] Click into the art approval for the screen print job
- [ ] Verify visible: sample art files, mockup files, production files, PMS colors, art size, notes
- [ ] Verify all files are viewable/downloadable (not broken links)
- [ ] Repeat for embroidery job: verify thread colors, stitch count, all files visible
- **Screenshot:** Art review modal/panel for each job showing all files and info

### Step 4.3 — Rep: Test Art Rejection Flow
- [ ] Reject the screen print art with a reason (e.g., "Colors don't match PMS spec")
- [ ] Verify rejection is recorded (rejection reason, date, rejector)
- [ ] Verify the job moves back to a rework state for the artist
- **Screenshot:** Rejection confirmation and updated job status

### Step 4.4 — Artist: Verify Rejection Visible
- [ ] Switch back to Artist view
- [ ] Confirm the screen print job shows the rejection: reason, who rejected, when
- [ ] Confirm the embroidery job is still in `needs_approval` (unaffected)
- **Screenshot:** Artist workboard showing rejection details on screen print job

### Step 4.5 — Artist: Resubmit Art
- [ ] Upload revised mockup/files for the screen print job
- [ ] Move status back to `needs_approval`
- [ ] Verify the revision appears alongside or replaces the previous files
- **Screenshot:** Updated screen print job with revised files

---

## Phase 5: Coach/Admin View — Final Review

### Step 5.1 — Coach Dashboard: Art Approval Queue
- [ ] Switch to (or log in as) a **Coach/Admin** role user
- [ ] Open the admin dashboard
- [ ] Verify both jobs appear in todos or art approval queue
- **Screenshot:** Admin dashboard showing pending art approvals

### Step 5.2 — Coach: Review Complete Art Package
- [ ] Open the screen print job review
- [ ] Verify ALL of the following are visible:
  - Original sample/design files
  - Latest mockup files (post-revision)
  - Production files
  - PMS ink colors
  - Art size
  - Rejection history (previous rejection + reason)
  - Artist notes
- [ ] Open the embroidery job review
- [ ] Verify ALL of the following are visible:
  - Sample/design files
  - Mockup files
  - Production files (DST/EMB)
  - Thread colors
  - Stitch count
  - Art size
  - Artist notes
- **Screenshot:** Full art review view for each job

### Step 5.3 — Coach: Approve Art
- [ ] Approve the screen print job art
- [ ] Approve the embroidery job art
- [ ] Verify both jobs move to `art_complete` status
- **Screenshot:** Both jobs showing approved/complete status

---

## Phase 6: Post-Approval Verification

### Step 6.1 — SO View: Art Status Reflects Approval
- [ ] Open the original Sales Order
- [ ] Verify art files show approved status
- [ ] Verify all uploaded files (sample, mockup, prod) are still accessible from the SO view
- **Screenshot:** SO art section showing approved status and all files

### Step 6.2 — Dashboard Coherence Check
- [ ] Check Rep dashboard: art approval todos should be cleared for these jobs
- [ ] Check Artist workboard: jobs should show as complete
- [ ] Check Admin dashboard: jobs no longer in pending queue
- **Screenshot:** Each dashboard confirming clean state

### Step 6.3 — Final Persistence Check
- [ ] Hard refresh the browser
- [ ] Spot-check the SO: art files, mockups, prod files, statuses all intact
- [ ] Spot-check the artist workboard: completed jobs still show full file history
- **Screenshot:** Final confirmation after reload

---

## Summary Checklist

| # | Check | Pass? |
|---|-------|-------|
| 1 | Estimate art files persist after save/reload | |
| 2 | Art files carry over from Estimate → SO correctly | |
| 3 | Jobs reference correct art files with correct metadata | |
| 4 | Artist workboard shows all needed context (colors, sizes, deco type, deadlines) | |
| 5 | Sample art files are viewable by Artist, Rep, and Coach | |
| 6 | Mockup files are viewable by Artist, Rep, and Coach | |
| 7 | Production files are viewable by Artist, Rep, and Coach | |
| 8 | Art rejection records reason, date, rejector — visible to all roles | |
| 9 | Revised art uploads appear correctly after rejection | |
| 10 | Art approval updates status across all views (SO, artist board, dashboards) | |
| 11 | Dashboard todos appear/clear correctly through the art lifecycle | |
| 12 | All data survives browser refresh at every stage | |
