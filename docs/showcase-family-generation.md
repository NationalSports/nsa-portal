# Shared Showcase garments

Store Appearance groups active catalog rows by supplier, brand and style SKU,
stripping only a matching full color suffix. Explicit school/style grouping is a
fallback; product names are never used as identity. This combines legacy rows
with the same supplier style without merging unrelated garments.

Each base-item job makes at most one OpenAI edit for a blank master garment.
The master uses green main fabric so the renderer can separate fabric from the
white background, manufacturer marks and hardware. Kimi identifies clean fabric
patches in each original supplier photo; Sharp samples their actual sRGB pixels.
The renderer transfers the sampled color onto the master's shading. Fine heather
uses high-frequency texture from a supplier patch. This is a photographic color
reference, not a calibrated measurement of physical cloth.

Exact transparent logo files are reused, fitted to their original aspect ratios
on mapped garment planes. Artwork hue comes from the original sRGB file, independent of garment RGB. New renders apply bounded neutral lighting (90–106%) and subtle simulated raised-finish relief, without substituting a different ink palette. Source texture and alpha edges are retained. Placement
planes are shared across colors and designs with matching saved coordinates.
Drawstrings and narrow zippers use curved centerlines with per-point widths, with anti-aliased boundaries. Broad polygon cutouts and ordinary fold occlusion are rejected in new jobs. Traces are limited to 2.5% of image width and require human review against the garment. Source artwork uses premultiplied bilinear sampling to avoid jagged enlarged detail edges. Raised finishes receive subtle relief at alpha boundaries while keeping source hues independent of garment color. Brand
marks and neutral background pixels are protected from recoloring.

Complex patterned or contrasting-panel products, differing manufacturer-mark
colors, green brand marks that overlap the master masking color, unreliable mappings, missing artwork/placements and missing supplier
photos fail clearly. These cases need separate rendering support; the pipeline
does not silently substitute guessed colors or branding. All outputs require
human comparison of color, texture, construction, marks and decoration placement.
The mapper and master generator remain probabilistic; tests do not establish
production visual quality.

## Jobs and rollout

The additive `showcase_family_jobs` migration must be applied before the UI is
deployed. It adds a private RLS-enabled family cache plus service-role-only RPCs
for atomic queue, claim, cache, finish and cancel/fail transitions. The existing
per-combination assets and approval/publication contracts remain in place.
Approved URLs survive regeneration. Stale/canceled workers cannot commit a
partial set, and catalog changes prevent generation completion or approval.
Old browser bundles are instructed to refresh instead of generating individual
paid images. Already-queued legacy jobs can still finish or be canceled.

Generate whole item reuses a valid cached master. New base garment explicitly
invalidates it and incurs another image edit. Analysis calls, storage and local
rendering still have costs; no fixed total-price promise is made. Outputs and
masters have immutable storage paths.

## Verification

- Jest: grouped controls, expand/review behavior, existing Showcase tests.
- Node renderer tests: actual decoded pixels, color sampling, mask/protected
  pixels, logo-only changes and drawstring occlusion.
- Postgres (PGlite): applied migration, service permissions, duplicate claims,
  cancellation, atomic completion, preserved approvals, and an injected-provider
  worker run producing 15 combinations with one master edit and zero further
  edits on a cached rerender.
- Isolated Netlify bundle: Supabase startup and Sharp native PNG processing.

Before merging, review a real provider-generated family in the deploy preview.
Local testing uses injected provider responses; it does not spend live provider
credits or certify Kimi's garment mapping.

## Decoration details

Each front decoration gets a square detail crop for each color/design row.
The working canvas is 2048px (the master is resampled, not AI-regenerated), and
original artwork is composited at that resolution. Detail crops reuse those exact
finished pixels, with context around the mapped artwork and no crop upscaling.
They add zero OpenAI image edits, but do add rendering and storage costs.
Small placements that cannot yield a useful 160px crop fail for staff correction.
This is a rendered preview, not evidence of real twill weave, stitch construction
or production depth. Real finished-decoration photographs are needed to verify
those properties. The storefront labels detail previews accordingly.

Candidate detail metadata is stored in the same atomic job result as the hero
(`qa_result.detail_images`). Approval copies it to `approved_detail_images` in the
same guarded update as the approved hero URL. Rejection and regeneration preserve
the old set; Use Standard clears both. Apply `showcase_decoration_details` before
deploying this code. Existing approvals have no details until regeneration and
review. Product detail controls follow the selected logo/color and never use an
unapproved candidate; staff reviews the full image set in the comparison dialog.

New relief renders carry `qa_result.artwork_color_policy=source-hue-relief-v2`; older color-locked renders use `original-srgb-v1`.
Older outputs can be regenerated using the cached base; this does not require
purchasing a new garment master. Existing approved imagery remains unchanged
until staff approves replacements. The relief and weave are simulations, not evidence of actual stitch construction.

The Appearance card reports generated, currently approved and awaiting-review counts separately. Regenerate whole item reuses the cached garment and produces new review candidates; saved older images do not change automatically. The review button opens the same modal as Before / After, with sticky close and approval controls.

## Athletic pose and mapping recovery

Master pose version `athletic-hood-down-v2` restores fit-aware athletic volume, a restrained 10–12 degree turn and a chest-level camera. Hoodie hoods rest down behind the neck. The master signature includes the pose version, so the next generation replaces an older pose once instead of silently reusing it; subsequent renders reuse the new base. Existing approved images remain unchanged.

Mapping validates all protected polygons, drawstring traces and requested placement quads before rendering. Numeric string coordinates and explicit x/y objects normalize without changing units. Pixel/percentage coordinates, extra dimensions, missing placements and unsafe traces trigger one corrected analysis using the same image references. A second invalid response fails with an actionable retry message and retains the cached master. This retry does not purchase another master image.

Comparison now receives explicit catalog identity and fit even when using the custom mapping prompt. Temporary chroma color, lowered hood and modest presentation changes are distinguished from actual construction changes. A rejected comparison gets one contextual recheck against the same images; confirmed mismatches remain blocked. Provider rejection details stay in diagnostic logs. Staff see an actionable replacement-base message without internal color or coordinate terminology.

### Full-front torso placement

For named tops (hoodies, pullovers, crews, sweatshirts, polos and tees), full-front
placement uses corresponding front-neckline, bottom-hem and torso-side landmarks.
The worker transfers saved editor coordinates through these two garment bases;
it does not accept the analyzer's guessed logo quad for these placements. The
hood top is not a neckline landmark. Each supplier image gets its own placement
IDs, even when its editor coordinates match another color. Other placements keep
the existing quad mapping. Generated QA records retain landmarks and final quads
for diagnosis. Existing approved images and cached master signatures are unchanged.

The geometry and worker tests use controlled landmarks. They do not establish
that a live analyzer identifies the correct landmarks: visually check a newly
rendered hood-down example against the original before releasing this change.
