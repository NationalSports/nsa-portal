# Showcase generation by color and design

The catalog UI still groups supplier styles, colors and designs together. The
worker uses a separate finished image for each actual product/color. It no longer
uses a green shared master, color sampling, texture reconstruction, AI placement
quads, strand tracing, or automatic visual-placement rejection.

## Image flow

1. Fetch the actual color's blank supplier photo, with existing SanMar recovery
   and store-local supplier-photo overrides.
2. Composite the assigned exact artwork onto the supplier photo using its saved
   editor position in a contain-fitted 1000 × 1250 frame. This reference has no
   AI geometry transfer and no synthesized decoration detail.
3. Create the first finished image in that color at high quality: natural matte
   lighting, restrained athletic volume, slight hero turn, hood down.
4. Cache this finished image by product and color. For each additional design,
   pass that same original color image, the new decorated supplier reference,
   the actual blank supplier photo, and exact artwork to an image edit at medium
   quality. Ask to change only customer decoration and preserve the garment.
   Never chain an edit's output into the next edit.
5. Return candidates for human approval. Existing approved images remain in use
   until approval. The whole generated image is the review surface; no automatic
   detail crop claims exact production stitching or placement.

Image editing is generative: the preservation instructions are not a guarantee
of unchanged pixels. Compare exact artwork, placement, manufacturer marks,
material, color, pose and lighting before approval.

## Cache and jobs

Pipeline version: `showcase-color-design-v2`; renderer: `color-design-v1`.
Old green masters are incompatible and cannot seed new color images.
Color signatures include source photo, product, color, name and pose/review notes.
Changing notes or replacing the supplier photo invalidates that color's seed.
Changing a design/finish requests an edit against its matching color image.

Generate all queues one job per product/color and dispatches after every job is
queued and the notification batch is marked pending. Each color retains the
whole style's catalog guard, so later artwork/catalog edits block completion and
approval. The existing per-image request guards preserve cancellation and prevent
concurrent jobs from changing the same asset. Single-image jobs can reuse a color
job's cache and touch only the selected combination. Failed initial color calls
are not repeatedly retried for each design; other color jobs still proceed.

The cache is per store and supplier family; product/color identity prevents
cross-color reuse even when placeholder URLs are shared. Missing photos are
skipped through existing recovery logic and explicit failure records.

## Cost and observability

Every initial color image and every follow-up design edit is a paid image call.
The first uses high quality; follow-up edits use medium quality. A smaller edit
area alone does not imply a lower API bill. The direct Images API does not provide
cached input billing merely because a reference is reused.

QA records generation stage, requested quality, provider-reported usage when
available, color, source color-image URL and human-review requirements. Full cost
includes image/text input plus output; retries and reference sizes affect it.
Do not claim measured savings without actual billed usage and accepted outputs.

For GPT Image 2, official documentation supports both high and medium quality and
high-fidelity inputs automatically:
https://developers.openai.com/api/docs/guides/image-generation

## Verification and release status

The Node fixtures exercise real PNG reference construction with mocked provider
responses, multipart quality/usage handling, color isolation/cache reuse,
cancellation, partial failures, batch queuing, and PGlite database transitions.
The UI suites cover generation, review/revision, approval, and bulk actions.
They do not establish real image quality or exact artwork preservation.

Keep PR #2509 draft until actual full-color generations and follow-up design
edits have been visually reviewed. The requested two in-app-browser generation
cycles remain blocked in the previous session because its Browser control tools
were absent. Do not treat unit-test counts as those live checks.
