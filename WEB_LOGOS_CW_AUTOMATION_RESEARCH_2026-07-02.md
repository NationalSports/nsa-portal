# Web Logos × Color Ways — Automation Research (2026-07-02)

Deep-dive across the CW / web-logo branches, PRs (#942, #1305, #1307, #1311, #1397,
#1422, #1446, #1471), the decision records (`ARTWORK_CW_WEBLOGO_MODEL_2026-06-27.md`,
`ART_ONE_PROCESS_TARGET_2026-06-27.md`), and the live code in `Webstores.js`,
`OrderEditor.js`, `CoachPortal.js`, `CustDetail.js`, `businessLogic.js`, and
`storefront/`. Scope: making web logos the backbone of webstores, coach-portal
ordering/mockups, and automated CW selection — ideas + downsides per initiative.

---

## TL;DR — where the system actually stands

The **model is fully designed and locked** (one design → N color ways → one web logo
+ one mock per CW, keyed on stable `color_way_id`, resolved through one function).
The **plumbing is ~15% built**:

| Piece | Status |
|---|---|
| `pickCwAsset` shared resolver (web logo + mock, full fallback chain) | ✅ built + unit-tested (`businessLogic.js:195`) — **zero UI callers** |
| `design_id` cross-order identity + `priorMocks` reuse | ✅ merged (#1397) |
| Artist per-CW coverage banner + empty upload slots | ✅ shipped (CustDetail only) |
| Builder → SO logo carry-through (one `kind:'art'` deco per placement) | ✅ merged (#1307) |
| Per-color web-logo pick in builder (`cw_by_color`) | ✅ merged (#1311) — **label/URL keyed, not CW-id keyed** |
| `web_logos[]` re-keyed to `color_way_id` + backfill (B2) | ⛔ not built |
| Per-used-CW approval gate (Decision 1) | ⛔ not built — current gate accepts *any* image |
| Web logos surviving on SO/estimate art records | ⛔ **broken — silently stripped on save** (see Landmine 1) |
| Coach portal touching web logos at all | ⛔ zero references |

So every one of the five initiatives below is *architecturally ready* — the docs
already anticipate all of them — but they all sit on the same 3 foundation gaps.
Fix those once and the five features become thin UI work instead of five new systems.

---

## Landmines (fix these first — they silently break everything above them)

### L1 — Web logos don't persist on orders. At all.
`_artCols` (`constants.js:26`) — the column whitelist used for every
`so_art_files` / `estimate_art_files` upsert — **does not include `web_logos` or
`web_logo_url`**. Yet:
- `CustDetail.saveWebLogos` (`CustDetail.js:1055-1063`) fans web logos onto every
  matching SO's art records, and
- `batchOrders` (`Webstores.js:2193-2199`) sets `web_logo_url` on SO art at handoff —

…all of it stripped by `_pick(a,_artCols)` (`App.js:1139,1457,1596`) before the DB
save. Order-side web logos evaporate on reload; only the copy on
`customers.art_files` survives. Same story for SO decoration fields: `_decoCols`
lacks `web_url`, `placement`, `side`, `color_label` — the webstore handoff writes
them (`Webstores.js:2212`) and the save layer discards them.
(The decision record even claims these columns persist — the doc is wrong vs. code.)

**Any automation that reads a web logo off an order will be reading data that
randomly disappears.** One-line-per-column fix + a re-fan-out backfill.

### L2 — Three keying schemes for the same relationship
- `web_logos[]` entries are written keyed on the **CW label string**
  (`{url, color_way:'Black'}` — `CustDetail.js:1071`, `Webstores.js:1780`).
- `pickCwAsset` and SO decorations key on **stable `color_way_id`** — a
  label-only entry falls through to legacy fallback (tested and documented in
  `pickCwAsset.test.js:31-35` as "until B2 backfills").
- The builder's `cw_by_color` keys on **lowercased garment-color name → URL**,
  losing the CW identity entirely — so at SO handoff the production CW is
  *re-guessed* from the garment color instead of read from the rep's actual pick.

Plus **three different garment-color→CW matchers** that can disagree: exact/fuzzy
label match (`Webstores.js:2205-2211`), light/dark regex heuristic
(`OrderEditor.js:250-252`, duplicated at `:9651`), word-token match
(`Webstores.js:4929-4939`). And **two divergent `decoUrlForColor`s** — the builder
auto-matches by label, the public storefront only reads baked `cw_by_color` (a color
added after the last item-save shows the wrong logo).

### L3 — The resolver exists but nothing calls it
`pickCwAsset` was built as "the one function" replacing ~9 ad-hoc fallback chains
(`webLogoDefault`, `artImgUrl`, `artThumbUrl`, `artPlaceUrl`, `logoUrlOf`, two
`decoUrlForColor`s, OrderEditor thumb chains, CustDetail thumb). All 9 chains are
still live; the resolver has zero call sites outside its test file. Until wiring
happens, every surface can disagree about which image represents a design.

---

## Initiative 1 — Coaches creating orders using web logos in their portal

### Today
- Coach portal is **link-gated, no login** (`/?portal=<alpha_tag>`); all writes go
  through serverless `_portalAction` / edge functions because anon RLS can't write.
- Coaches already have an **Art Locker** (`CoachPortal.js:342-362, 1602-1646`) built
  by scanning their SOs' art files — but its "Order with this design →" CTA just
  **pre-fills a text note** in the Live Look cart ("Logo on file: <url>"). No
  structured art reference reaches the order request.
- Order paths that exist: Live Look cart → `catalog_order_requests` → staff builds a
  draft estimate (`estFromCatReq`, `App.js:7794-7834`); roster orders; coach store
  builder → draft webstore. **None carry art as data.**
- `web_logo` appears **nowhere** in CoachPortal/BuildStore/AdidasInventory/RosterOrders.

### Ideas
1. **Structured art on order requests (smallest step, big payoff).** The Art Locker
   CTA passes `design_id` + `art_file_id` + chosen `color_way_id` into the Live Look
   cart and `catalog_order_requests` (the migration already left a column open for
   expansion). `estFromCatReq` then attaches the real library art record to the
   draft estimate — the rep receives an estimate with art already attached and CW
   already pinned, instead of a URL in a note.
2. **"See your logo on the color you pick."** In Live Look and the coach store
   builder, when a coach picks a garment color, resolve
   `pickCwAsset(art, {kind:'web_logo', colorWayId})` and overlay it on the product
   photo (same CSS overlay the storefront already uses — `DecoOverlay`,
   `Storefront.js:762-770`). This is literally build-step 5 in the decision record.
3. **Coach "quick order" wizard**: pick design from Art Locker → pick garments from
   the LiveLook pool (in-stock, photo-backed, tier-priced — all exists) → pick
   colors (web logo previews live) → sizes/roster → submits as a rich order request.
   Staff converts with one click because art, CW, placement, and quantities all
   arrive structured.
4. **Reuse-first ordering**: `priorMocks` keyed on `design_id` (#1397, merged) can
   surface "your last approved mockup on this garment" during coach ordering —
   which doubles as expectation-setting (they approve against a real proof, not a
   CSS preview).

### Downsides / risks
- **Auth is a link, not an identity.** Letting coaches *create* order intents from a
  forwarded URL raises the stakes of the existing link-gate model. Mitigation: keep
  the pattern of `coach-store-submit` — server-side re-validation, server-locked
  prices, staff review before anything becomes real. Never let the coach path write
  an SO directly.
- **Expectation gap**: a CSS overlay is not a production proof (no distressing,
  stitch density, print size limits). If coaches "see" the logo at checkout, some
  will treat it as approved art. Mitigate with explicit "preview only — final proof
  comes from our art team" framing, and keep the coach approval step.
- **Coverage dependency**: this feature is only as good as web-logo coverage. A
  coach whose designs have no web PNG gets a broken-feeling experience. Ship
  Initiative 5 (artist coverage) first or in parallel; show a graceful "art preview
  pending" state.
- The Art Locker scans SOs client-side today; a big customer's portal payload is
  already heavy. Consider precomputing the locker (or reading `customers.art_files`
  directly) rather than scanning all orders.

---

## Initiative 2 — Webstore mockup creation happening more automatically

### Today — three coexisting mechanisms
1. **Live CSS overlay** (default): garment photo + absolutely-positioned logo
   `<img>`s (`DecoOverlay`). Never persisted as an image anywhere.
2. **Baked mock**: only via rep-driven **QuickMockBuilder** (fabric.js canvas →
   PNG → sets `webstore_products.image_url`, clears `decorations` to avoid
   double-stamping — `Webstores.js:1660-1701`).
3. **Manual upload** of `image_url` / `image_back_url`.

**The gap that matters:** checkout captures the *plain* `wp.image_url`
(`webstore-checkout.js:120,384`) — so unless a rep baked a mock, the Sales Order's
"mockup" is the **undecorated garment photo**. The nice composited view the shopper
saw is thrown away.

### Ideas
1. **Persist the composite at publish time (highest leverage).** Everything needed
   to bake a mock already exists as data: garment image + `decorations[]`
   (x/y/w %, side, per-color URL). Add a "bake mocks" pass on store publish — either
   client-side reusing QuickMockBuilder's render (`_renderSceneMock`) headlessly per
   color/side, or a small serverless canvas (node-canvas/sharp) — and write results
   into `item_mockups` keyed `sku|color` (+ `color_way_id`). Then:
   - checkout/order confirmations show the decorated garment,
   - `batchOrders`' existing `item_mockups` merge (`Webstores.js:2150-2177`) puts a
     *real* proof on the SO automatically,
   - the Art Dashboard job arrives with a mockup already in place → the
     `skusMissingMockups` send-gate is already satisfied for reorder-class work.
2. **Auto-draft, artist-confirm.** Don't mark auto-baked mocks as approved proofs;
   land them as `status:'draft'` mockups the artist can one-click confirm or replace.
   That keeps the artist as QA instead of production bottleneck.
3. **Cloudinary auto-cutout for the default web logo.** The builder already
   rasterizes vectors through Cloudinary for QuickMockBuilder inputs
   (`Webstores.js:3796-3847`) and does pixel recolors (`recolorToBlob`). A
   background-removal / trim transform on upload of production art could
   auto-generate the *default* web logo so the "AI only — add a web logo" dead-end
   (`Webstores.js:8224`) mostly disappears; artists then only hand-make the per-CW
   recolors that actually need judgment.
4. **Back-side + personalization coverage**: the baker should render back images and
   the perso number/name tokens (`perso_number`/`perso_name` already ride in
   `decorations[]`) so stores with numbers show them on the saved mock.

### Downsides / risks
- **A baked image is a promise.** CSS previews are obviously approximate; a baked
  PNG on an order confirmation reads as "this is what you'll get." Placement % on a
  product photo ≠ print placement on a real garment (photo crops vary by vendor).
  Consider a subtle "digital preview" watermark on auto-baked mocks until an artist
  confirms.
- **Double-stamping bug class**: `saveStoreMocks` clears `decorations[]` when baking
  so the overlay doesn't re-stamp. Any auto-bake pass must respect this invariant or
  shoppers see the logo twice. If you bake into `item_mockups` for SO use but keep
  the overlay for the storefront, you avoid touching `image_url` at all — safer.
- **Vendor photo drift**: catalog images get resynced; a baked mock pinned to an old
  photo can diverge from the live card. Store the source image URL with the bake and
  re-bake on image change.
- **Cloudinary auto-cutouts are wrong sometimes** (gradients, white elements on
  white). Must be a draft-with-review, never silent.

---

## Initiative 3 — Coach portal + Art Dashboard show the web logo on the selected color

### Today
- **Coach portal**: proof approval shows staff-uploaded mockups only; zero web-logo
  awareness. Product rows show the bare `_colorImage` photo.
- **Art Dashboard / OrderEditor**: deco thumbnails read legacy
  `web_logo_url` only (`OrderEditor.js:3548,3888`) — per-CW entries are ignored, so
  an art with only per-CW logos shows the wrong (or no) image. CW selection falls
  back to the light/dark regex guess (`_cwForItem`), which
  `ARTWORK_WORKFLOW_MAP.md` already flags as "a guess shown as a fact" (RC-3).

### Ideas
1. **This is exactly "wire `pickCwAsset`" (B1 finish).** Replace the legacy reads in
   OrderEditor deco cards, Art Dashboard job modal, CustDetail thumbs, and add it to
   CoachPortal's proof view: given the deco's `color_way_id` (or the item's garment
   color → CW), show that CW's web logo composited on the garment color swatch/photo.
   Pure read-path change, no migration, no behavior loss (the resolver's fallback
   chain ends at exactly today's legacy fields).
2. **Make the CW guess visible and correctable.** Wherever `_cwForItem` guessed,
   render a small "CW: White-on-dark (auto)" chip with a one-click switcher instead
   of silently showing a maybe-wrong ink set. Artists and coaches both benefit —
   wrong-CW approvals are the expensive failure here.
3. **Reversibles**: decorations already carry `color_way_id_b`; the display layer
   should show both faces' logos, which no surface does today.

### Downsides / risks
- Genuinely low-risk — this is the "safest first" step the target-architecture doc
  recommends. The main trap is **partial wiring**: replacing 6 of 9 chains leaves
  surfaces disagreeing, which is arguably worse than today. Treat it as one PR that
  deletes the old helpers (or aliases them to the resolver) so there's no drift.
- Slight perf note: CoachPortal renders from big in-memory props; resolving per-item
  per-color is cheap, but don't scan all SOs per render — memoize per art record.

---

## Initiative 4 — Webstores auto-select the CW from the web logo ("just add the main art")

### Today
- The chain runs the **wrong direction**. Rep picks/auto-matches a web logo per
  garment color → baked to `cw_by_color` as **URL keyed by color name** → at batch,
  `batchOrders` **re-guesses** the production CW by fuzzy garment-color matching
  (`Webstores.js:2205-2211`), ignoring which web logo the rep actually chose. The
  rep's pick and the production CW can silently disagree.
- The information to do it right already exists at pick time: every per-CW
  `web_logos[]` entry belongs to exactly one CW — the moment a web logo is chosen
  for a color card, the CW is *known*, not guessable.

### Ideas
1. **Carry the CW id, not just the URL.** Change `cw_by_color` values from a bare
   URL to `{url, color_way_id}` (back-compat: string = legacy). The builder's
   auto-match (`webLogoForGarmentColor`) and manual override both know which entry
   they picked. Then `batchOrders` reads `color_way_id` directly and the fuzzy match
   becomes a fallback for legacy data only. **This single change makes "webstore
   auto-selects the CW" real** — the guessing code path becomes dead weight.
2. **"Just add the main art" flow.** With #1 in place, the target UX is: rep drops
   one production art (.ai) on the store → default web logo auto-cut (Initiative 2
   idea 3) or artist adds per-CW PNGs → builder auto-places per color card with the
   right CW variant → SO handoff carries `art_file_id + color_way_id + placement`
   with production files already attached from the library record. The only human
   decisions left: placement tweaks and approving the auto-cut.
3. **Ad-hoc upload hardening**: logos uploaded straight into the builder without a
   library record become stub art on the SO ("Store logo", no production files, no
   CWs — `Webstores.js:2198-2199`). Nudge/require the library-save path
   (`onSaveLogo`) so every placed logo has a parent design — otherwise the
   automation chain has nothing to select from.
4. **Confidence + review queue**: where auto-selection had to fall back to fuzzy
   matching (legacy stores), flag the SO deco `cw_source:'guessed'` and surface a
   review chip in OrderEditor rather than pretending certainty.

### Downsides / risks
- **A wrong auto-picked CW is the most expensive mistake in this whole program** —
  it means wrong ink colors in production, not a cosmetic preview glitch. That's why
  the source of truth must be the *explicit* web-logo pick (deterministic), never
  the color-name fuzzy match. Keep a human-visible CW on the SO deco (already
  exists: the CW `<select>` at `OrderEditor.js:3935-3945`) as the override point.
- **Depends hard on B2 re-keying** (web_logos entries getting `color_way_id` +
  label backfill). Until then the builder literally cannot know the CW of a picked
  logo except by label matching — building this before B2 bakes in the fragility.
- CW renames: today a `garment_color` rename breaks label matches. After re-keying,
  renames are safe — one more reason B2 goes first.
- Multi-logo garments: an item can carry several decorations with different arts;
  "the store's CW" is per-decoration, not per-item. The SO shape already supports
  this (#1307's one-deco-per-placement) — keep the automation per-deco.

---

## Initiative 5 — Are artists required to do web logos now? Is it explained to them?

### Today — honest answer: **no, and barely.**
- **No gate anywhere requires a web logo.** The send-for-approval image gate
  (`_hasArtImage`, loosened by PR #1471) accepts *any* image — a mockup alone
  passes. Two of the three send paths (kanban card, mockup modal) skip even that.
  Rep approve / Mark Complete / Send to Coach: zero web-logo checks. Decision 1
  (per-used-CW requirement) is **locked on paper, unimplemented in code**.
- **The Art Dashboard — where artists actually live — has no web-logo upload at
  all.** Upload lives in the customer Art Library modal (CustDetail) and the
  webstore builder — surfaces artists may never open. The coverage banner
  (amber/red, per-CW empty slots) exists *only* in CustDetail.
- **Explanation** is a handful of tooltips ("Add a clean transparent PNG/SVG so this
  art can be placed & recolored on garments") and the banner copy. No onboarding, no
  artist doc, nothing that says *when* it's expected or *why* (the recolor/white-box
  rationale lives in code comments).

### Ideas
1. **Bring the work to the artist**: add the per-CW web-logo slots + coverage banner
   into the **Art Dashboard job detail modal** (next to the mockup dropzones and the
   existing CW editor at `App.js:22543-22565`). Artists shouldn't need CustDetail.
2. **Enforce Decision 1 at the right moment, softly first.**
   - Phase 1 (audit mode): banner on send-for-approval — "2 of 3 used color ways
     have no web logo" — allow send, log it. Track the coverage rate for a couple of
     weeks.
   - Phase 2: hard gate on **used color ways only** (exactly as Decision 1 scopes
     it), on *all three* send paths, with the default/blank-CW logo satisfying it.
     Never require CWs the order doesn't use — that's how you stall the queue.
   - Alternative placement: gate at "Mark Art Complete" instead of send-for-approval
     if you'd rather not delay customer approval on web assets.
3. **Explain it once, in-app**: a dismissible explainer on the Art Dashboard ("Web
   logos power webstore previews, coach ordering, and automatic mockups — one
   transparent PNG per color way") plus a short handbook page. The onboarding
   handbook module (`onboardingHandbook.js`) already exists as a home.
4. **Coverage visibility for managers**: a small "web-logo coverage" stat on the Art
   Dashboard (designs touched this month: N% full per-CW coverage, list of gaps).
   What gets measured gets uploaded.
5. **Reduce the ask**: with Cloudinary auto-cutout (Initiative 2) generating the
   default entry, the artist's *required* work per design often drops to "verify the
   auto-cut + add dark-garment variant" — a far easier mandate to enforce.

### Downsides / risks
- **Throughput hit**: a hard gate adds real minutes per design and will be felt on
  rush orders. The used-CWs-only scoping + audit-mode rollout + auto-cutout assist
  are the mitigations; without them expect artists to route around the gate (e.g.,
  uploading the mockup PNG as the "web logo" — garbage-in for every downstream
  feature).
- **Gate placement matters**: gating send-for-approval delays *customers*; gating
  art-complete delays *production files*. Pick one; don't do both.
- **Legacy debt**: thousands of existing designs won't meet the bar. The gate must
  apply to designs going through the pipeline *now*, with the coverage report
  driving opportunistic backfill — not a big-bang requirement on the back catalog.
- Quality enforcement is hard to automate: "is this PNG actually transparent /
  actually the right recolor for a dark garment" still needs eyes. Cheap automated
  checks worth adding: reject non-transparent PNGs (alpha-channel scan), warn when
  a "dark garment" CW's logo is predominantly dark pixels.

---

## Cross-cutting downsides (the honest list)

1. **JSONB blob concurrency.** Everything lives in `customers.art_files` (one big
   JSONB array per customer) with read-modify-write saves from CustDetail, the
   builder, and App fan-outs. Two staff editing the same customer can clobber each
   other's web logos today; more writers (auto-bake, auto-cutout, coach flows) make
   this more likely. Worth a targeted fix (per-art-record update helper, or
   optimistic version check) before adding automated writers.
2. **Denormalized snapshots go stale**: `webstores.store_art` and the baked
   `cw_by_color` are point-in-time copies of the library; there's already an ad-hoc
   "prefer the copy with more web_logos" patch (`Webstores.js:3913`). Automation
   multiplies snapshot count — prefer *resolving at read time via ids* (the whole
   point of `pickCwAsset` + `design_id`) over baking, except where anon storefront
   access forces denormalization.
3. **The public storefront is anon-facing**: whatever the builder bakes into
   `decorations`/`cw_by_color` ships to every visitor via the storefront view. Keep
   URLs-only there (as today); never leak library metadata into it.
4. **Webstore checkout has no production mileage** (per
   `WEBSTORE_MONEY_AUDIT_2026-07-02.md`: 0 real card payments; all rows are OMG
   mirrors). Automating mockups/CW into a checkout path that hasn't carried real
   load means the first real store exercises a lot of new code at once. Sequence the
   money-audit criticals alongside this work.
5. **Doc drift**: the decision record claims web logos persist via `_artCols` (they
   don't) and cites stale line numbers / a `pickItemMockups` helper that doesn't
   exist. Small thing, but these docs are steering multi-PR work — worth a
   correction pass so the next session doesn't build on the wrong assumption.

---

## Recommended build order

Everything above collapses into one dependency chain:

- **P0 — Foundation (unblocks all five):**
  1. Add `web_logos`/`web_logo_url` to `_artCols` and `web_url`/`placement`/`side`/
     `color_label` to `_decoCols` (+ one-time re-fan-out from customer libraries). *(L1)*
  2. Finish B1: wire `pickCwAsset` into all 9 read chains, delete/alias the ad-hoc
     helpers. *(L3 — also delivers Initiative 3 almost for free)*
  3. B2: uploaders stamp `color_way_id` on `web_logos[]`; label backfill;
     `cw_by_color` values become `{url, color_way_id}`. *(L2)*
- **P1 — Webstore automation:** `batchOrders` reads the deco's `color_way_id`
  (fuzzy match demoted to legacy fallback); publish-time mock baking into
  `item_mockups`; Cloudinary auto-cutout drafts. *(Initiatives 2 + 4)*
- **P2 — Artist requirement:** per-CW slots + banner in the Art Dashboard modal;
  audit-mode → hard gate on used CWs across all send paths; coverage stat +
  handbook page. *(Initiative 5 — start audit mode during P1 to build coverage
  before coach features depend on it)*
- **P3 — Coach portal:** structured art on order requests; color-select →
  `pickCwAsset` preview in Live Look/builder; quick-order wizard on top. *(Initiative 1)*

P0 is small (days, not weeks), pure-read-path or additive, and every later phase
gets cheaper because of it. The single most valuable *product* step after P0 is the
publish-time mock bake — it simultaneously fixes the "SO mockup is a bare garment
photo" gap, pre-satisfies the artist mockup gate for store orders, and gives coaches
real previews.
