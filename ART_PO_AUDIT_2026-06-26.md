# Art PO + Art Application — Click Audit (Visual)

**Date:** 2026-06-26 · **Scope:** outside-decoration PO flow + art application/approval flow
**Read left → right.** Each `●` on a ruler is one user click. The goal: find where clicks
pile up and collapse them.

> Legend  ● = a click   ▢ = a modal/dialog opens   ⌨ = typing   ↗ = leaves the app (manual email)
> 🔴 = redundant / avoidable   🟢 = the proposed shortcut

---

## 0. The two systems that don't talk to each other

Outside decoration is recorded in **two disconnected places**, and a correct job touches both.

```
   ITEM-LEVEL DECORATION                          SO-LEVEL DECO PO
   OrderEditor.js:3957-3975                        OrderEditor.js:6643-6744
  ┌───────────────────────────┐                  ┌───────────────────────────┐
  │ 🎨 + Outside Deco (per item)│                  │ 🎨 Create Deco PO (modal)  │
  │  • vendor        ───────────┼───🔴 same ──────▶│  • vendor   (re-search)    │
  │  • deco_type     ───────────┼───🔴 same ──────▶│  • deco_type (re-pick)     │
  │  • which items   ───────────┼───🔴 implied ───▶│  • item checkboxes (re-tick)│
  │  • cost_each     ───────────┼───🔴 same ──────▶│  • unit_cost (re-enter)    │
  │  • notes         ───────────┼───🔴 same ──────▶│  • notes (re-type)         │
  │  → bills the CUSTOMER        │                  │  → the PO/cost to DECORATOR │
  └───────────────────────────┘                  └───────────────────────────┘
            ▲                                                   │
            └──────────── NOTHING flows between them ───────────┘
```

Five inputs entered twice. Nothing carries over. **This is the "clunky" feeling.**

And the **art never rides along**: the approved mockup lives in a separate system
(`so_art_files` / `item_mockups`); the deco PO sends the decorator only a plaintext
notes field (`6714`), so the rep emails the real artwork out-of-band ↗.
The one vendor that does it right is **Topstar**, which attaches images to the PO email
(`OrderEditor.js:361-389, 6771-6815`) — that pattern just isn't extended to other vendors.

---

## 1. Outside-deco job, end-to-end (the worst offender)

Horizontal swimlane. Same job, three actors. Watch the ruler accumulate.

```
ARTIST ───────────────▶ REP ──────────────────────────────────▶ COACH ─────────▶ REP (deco) ──────────────────────▶ DECORATOR
  ●        ●      ●        ●        ●        ▢●●      ●            ●       ●          ●   ▢ ●●●●●●●●            ●           ↗
 open    upload  send    view    Send to   pick    Send         open   approve    search  Create Deco PO       Create     email
 detail  mockup  to rep  mockup  Coach▢   recips           ↘    card             vendor  (re-pick everything)  PO         art file
                                                       email                                                              MANUALLY
 │────────── art approval ──────────│──── coach ────│──────────── deco PO (double entry) ──────────│── art sent by hand ──│

 click ruler:  ●●●●  ●●●  ●●  │  ●●  │  ●●●●●●●●  │  ↗
               (~4)  (3) (2)    (2)    (~8 redundant)  (manual)        TOTAL ≈ 20+ clicks + 1 out-of-band email
```

File anchors: detail `App.js:21051` · upload `App.js:21515-21539` · send-to-rep `App.js:22556`
· view mockup `App.js:21046` · Send-to-Coach modal `OrderEditor.js:8304, 8955-8959`
· coach approve `CoachPortal.js:985` · deco vendor search `OrderEditor.js:6646`
· deco PO modal `OrderEditor.js:6660-6744`.

---

## 2. Art-application (approval) flow — click ruler

```
 STAGE        ARTIST ───────────────────────────▶ REP ──────────────────▶ COACH ──────────▶ DONE
              ┌─────────────────────────────────┐ ┌────────────────────┐ ┌───────────────┐
 happy path   │ open  upload  [send to rep]     │ │ view   Send-to-    │ │ open   approve│
              │  ●      ●          ●             │ │  ●     Coach ▢●●   │ │  ●       ●    │
              └─────────────────────────────────┘ └────────────────────┘ └───────────────┘
 clicks:            ●  ●  ●                              ●  ●  ●                ●  ●          ≈ 10 ●

 rejection    ...coach ❌ Request Changes (⌨ required) ──▶ artist must:
 detour                                           🔴 [Start Working] ● → [Send to Rep] ●   (2 clicks to do 1 thing)
                                                  App.js:21024 / 21034
```

Per-garment cost: mockups upload **one SKU at a time** (`App.js:21515-21539`); a 5-SKU
order = 5 uploads, no "apply to all." The `🔗 link` chip reuses art but is still 1 click/garment.

Friction modals that each add a click:
`window.confirm` resend-after-reject `App.js:20877` · production-file gate `OrderEditor.js:5700-5717`
· coach feedback `alert` if blank `CoachPortal.js:987`.

---

## 3. Coach side — per **job**, not per **order**

```
 ORDER WITH 5 JOBS  →  coach must repeat the unit FIVE times:

 job1  ● open ─ ● approve ─ ● next ┐
 job2  ● open ─ ● approve ─ ● next ┤   no "approve all"
 job3  ● open ─ ● approve ─ ● next ┤   = 5 opens + 5 approves + 4 next
 job4  ● open ─ ● approve ─ ● next ┤   = 14 clicks for one order
 job5  ● open ─ ● approve ────────┘
 CoachPortal.js:730 (open) · 985 (approve) · 1015 (next)

 Send-to-Coach modal: every recipient = its own checkbox, no Select-All
 OrderEditor.js:8955-8959   →   ● ● ● per contact
```

---

## 4. Where the clicks go — and where they could

```
                                  NOW                          PROPOSED
 Outside-deco PO data entry   ●●●●●●●● (re-enter 5 fields)   🟢 ● review & confirm (prefilled)
 Art → decorator              ↗ manual email                🟢 ● attached to PO (Topstar pattern)
 Coach recipients             ● ● ● per contact              🟢 (default all) + ● Select-All
 Coach approves 5-job order   ●●●●●●●●●●●●●● (14)             🟢 ● Approve-all-on-order
 Resend after rejection       ● ● (Start Working→Send)       🟢 ● direct re-send
 Mockups, 5 SKUs same art     ● ● ● ● ●                      🟢 ● apply-to-all
```

---

## 5. Prioritized fixes (clicks saved ÷ effort)

| # | Fix | Targets | Code | Saves |
|---|-----|---------|------|-------|
| **1** | **"Create Deco PO from outside-deco decorations"** — prefill vendor / items / type / cost / notes from the item-level `kind:'outside_deco'` decorations; rep reviews & confirms | §0 double-entry | read `OrderEditor.js:3957-3975` → prefill `6660-6744` | ~8 clicks/PO |
| **2** | **Attach approved mockups to the deco PO send** — reuse the Topstar image-attach path for all deco vendors | §0 art-by-hand | `OrderEditor.js:361-389, 6815` | 1 manual email/PO |
| **3** | **Auto-select recipients + Select-All** in coach modal | §3 | `OrderEditor.js:8955-8959` | 2-3 clicks/send |
| **4** | **Batch "approve all artwork on this order"** on the portal | §3 | `CoachPortal.js:985` | up to 9 clicks/order |
| **5** | **Direct re-send after rejection** (`art_requested → waiting_approval`) | §2 detour | `App.js:21024-21034` | 1 click/resend |
| **6** | **"Apply mockup to all items"** for shared art | §2 | `App.js:21515-21539` | n-1 clicks/job |

**Fixes 1 & 2 are the ones that specifically kill the outside-deco clunk.** The rest are
general click savings across every art job.

---

## Appendix — status-field note (not a click issue, but related)

Art state is mirrored across `so_jobs.art_status` and `so_art_files.status` and kept in sync
by hand at every transition (`CoachPortal.js:970/979`, `OrderEditor.js:122` updates the job but
not the art file). This is the root of the SO-1199 incident documented in
`ART_APPROVAL_FLOW_AUDIT_2026-06-25.md`. Worth collapsing to one source of truth, but it's a
data-model fix, separate from the click-reduction work above.
