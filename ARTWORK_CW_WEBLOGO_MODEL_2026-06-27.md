# Per-Color-Way Web Logo & Mock Reuse — Decision Record

**Date:** 2026-06-27 · For PR #1422 (unified artwork/deco). Builds on `design_id` (from #1397,
already merged) and the CW-tagged mocks of **#942** (open). Locks two decisions.

---

## The model (one coherent system)

```
 DESIGN  (design_id — stable identity, survives renames)
   │
   ├── color_ways[]                       each CW has a stable color_way_id
   │      ├─ color_way_id: "cw_abc"       (e.g. "White ink on dark")
   │      ├─ garment_color / inks
   │      ├─ web_logo  ───────────────────┐  the web-ready cutout for THIS color way
   │      └─ mock      ───────────────────┤  the CW-tagged mockup (#942)
   │                                       │
 RESOLUTION when a garment color is picked: │
   pick garment color → its color_way_id ──┴─▶ web_logos.find(color_way_id)   → place on the card
                                               item_mockups / mockup_files tagged color_way_id (#942)
   fallbacks:  blank-CW default → legacy web_logo_url → preview_url (design-level default)
   reuse across orders: keyed on (design_id, color_way_id)
```

One design → **N web logos and N mocks, one per color way** — not one per design.

---

## Decision 1 — The web-logo requirement is **per used color way**, not one per design

- The send-for-approval gate becomes: **every color way actually used on the order has a web
  logo** (a `web_logos[]` entry matching its `color_way_id`, or the blank-CW default).
- `preview_url` stays as the **design-level default thumbnail / final fallback** — it is *not*
  the requirement itself. (Supersedes the earlier single-`preview_url` LOGO-1 framing.)
- Rationale: the same logo renders differently per CW (e.g. white inks on a dark garment vs. dark
  inks on a light one), so the thing that gets dropped on the selected garment color is per-CW.

## Decision 2 — Standardize on `color_way_id` (stable), never the CW label string

- Today `web_logos[]` entries key on **`color_way`** (a label like `"Black"`) — fragile: a rename
  breaks auto-apply and it won't reliably match across reused orders. This is the exact problem
  `design_id` solved for design names.
- **#942** already stamps the stable **`color_way_id`** onto *mocks*. We align the **web logos to
  the same key**, so web logo **and** mock both resolve off `(design_id, color_way_id)` — one
  keying scheme, not two.

---

## Data shape (target)

| Field | Shape | Key | Notes |
|---|---|---|---|
| `art_files[].web_logos[]` | `[{ url, color_way_id, color_way?, is_default? }]` | **`color_way_id`** | per-CW web logo; `color_way` label kept for display/back-compat only; blank/`is_default` = "all garments" |
| `art_files[].web_logo_url` | string | — | legacy single default; keep as fallback, mirror the default entry |
| `art_files[].preview_url` | string | — | design-level default thumbnail / final fallback |
| `art_files[].color_ways[].color_way_id` | string | **stable** | the canonical CW identity decorations already reference (`color_way_id` / `color_way_id_b`) |
| mock tags (`item_mockups` / `mockup_files`) | tagged | **`color_way_id`** | #942 already does this — keep |

**Resolver (single helper, used by web logo *and* mock):** given a decoration's `color_way_id`,
return the matching `web_logos`/mock entry → blank-CW default → legacy `web_logo_url` → `preview_url`.
Mirrors the existing `webLogoDefault`/candidate chain (`Webstores.js:5375-5413`) and #942's
`pickItemMockups()` (`utils.js`), unified on `color_way_id`.

---

## Back-compat / migration (additive, non-destructive)

1. **No column drop.** `web_logos`, `web_logo_url`, `preview_url`, `color_ways` all persist today
   (`_artCols` in `constants.js`). Adding `color_way_id` to `web_logos[]` entries is a JSON shape
   change, not a schema change.
2. **Backfill `color_way_id` on existing `web_logos`**: match each entry's `color_way` label to the
   design's `color_ways[]` to recover the id; unmatched/blank → treat as the default entry.
3. **Legacy untagged web logos** (only `web_logo_url`, no `web_logos[]`) keep working as the
   default — exactly today's behavior.
4. **#942's mock tags need no change** (already `color_way_id`); just ensure the shared resolver is
   the one path both call.

---

## How it fits what's already in #1422

- **`design_id`** (merged from #1397) supplies the cross-order design identity; this record adds the
  **per-CW axis** under it.
- **#942** is the **mock** half of this model and is still an **open PR** — to avoid shipping two
  keying schemes it should be brought into #1422 (or rebased) and aligned with the `color_way_id`
  web-logo resolver here. *(Pending your go-ahead, same as #1397/#1226.)*
- The unified-deco routing work is unaffected — this is the *design/reuse* axis, orthogonal to
  in-house↔outside fulfillment.

---

## Build steps (Phase 2 of the artwork track)

1. Shared resolver `pickCwAsset(art, color_way_id, kind)` → web logo | mock, with the fallback
   chain above; replace the ad-hoc chains in `Webstores.js` / `OrderEditor.js` / `CoachPortal.js`.
2. Web-logo uploader writes `color_way_id` onto each `web_logos[]` entry (CW selector already exists
   in the Art Library editor per #942).
3. Backfill helper: stamp `color_way_id` onto legacy `web_logos[]` by label match.
4. Approval gate: require a web logo for **each used `color_way_id`** (Decision 1); `preview_url`
   only as the design-level fallback.
5. Coach portal "apply art on the selected color card": on color select, call `pickCwAsset` so the
   right CW's web logo + mock appear; reuse surfaces prior designs via `design_id` (`priorMocks`).
6. Bring #942 in / align it with the shared `color_way_id` resolver.
