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
on mapped garment planes, shaded and given lightweight finish texture. Placement
planes are shared across colors and designs with matching saved coordinates.
Drawstring/zipper occlusion regions keep artwork behind those features. Brand
marks and neutral background pixels are protected from recoloring.

Complex patterned or contrasting-panel products, differing manufacturer-mark
colors, unreliable mappings, missing artwork/placements and missing supplier
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
