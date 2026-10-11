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
   Women's items receive explicit natural shoulder, bust, waist and hip guidance
   for invisible support while preserving the supplier's actual cut and ease.
   This applies to new color images; cached images keep their existing silhouette
   until a pose revision creates a replacement.
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

On 2026-10-11, six single-image in-app-browser cycles completed, each followed
by a five-minute wait and inspection of the new request's actual result:

- Black NKFD9889 with original Serra artwork and Serra Tail artwork rendered
  successfully, but the compact, square silhouette read as youth/unisex.
- Explicit women's form guidance plus adult-proportion review feedback produced
  a longer, less square NKFD9889 torso with gentle waist definition. This is one
  observed improvement, not proof that the default prompt always gets fit right.
- A medium-quality refresh reused that revised high-quality color image. The
  silhouette, pocket, cords and Swoosh looked stable, but the logo moved slightly
  lower. Usage reported 1,756 output tokens versus 7,024 for high quality; billed
  dollars per accepted image were not measured.
- Team Anthracite CN9402, previously blocked by drawstring tracing, generated
  successfully with visible heather, white cords, zipper and women's shape. Its
  first artwork was undersized. A feedback revision brought the artwork closer
  to the supplier reference's scale; exact artwork/placement remains unverified.

The subsequent whole-item test generated all 12 NKFD9889 combinations together:
four colors, each with three designs. One batch queued four concurrent color
jobs, producing four high-quality color seeds and eight medium-quality edits.
All 12 finished without generation errors and were individually inspected in
Before/After and enlarged hero views after a five-minute wait.

Within each color, the three designs retained visually consistent pose,
silhouette, pockets, cuffs, fabric color, lighting and sleeve Swoosh. Different
colors use independent seeds, so their pose and waist shaping are not identical.
The first Royal block SERRA edit lost/darkened the artwork's white inner outline;
one medium refresh against the same Royal seed visibly restored it. The charcoal
set's supplier neck label is not visible; concealment versus omission remains
unconfirmed. No exact pixel-preservation or production-artwork guarantee follows
from this visual review.

The second whole-item test generated all 12 Port & Co PC90H combinations under
batch `e8f9bd52-f869-4148-b261-f966db452ba9`, started 07:12:09 UTC on October 11.
Gold, Jet Black, Royal and White each produced three designs, with four high
color seeds and eight medium design edits. All 12 finished by 07:14:53 UTC with
no errors or retries. Each was inspected in Before/After and enlarged hero views
after the five-minute wait. Within-color hood, drawstrings, pocket, cuffs,
fabric, neck label and pose remained visually consistent. Expected lettering
and artwork borders were visible. The prior Gold horizontal placement issue
was not apparent. Logo scale varies between independent color seeds: Gold and
Jet Black look smaller across the chest than their standard references. This
remains a review flag; exact size, label lettering and artwork pixels were not
verified. No code change was made for this additional data point.

The third whole-item test generated all six women's CN9402 combinations under
batch `dc34b59e-52dc-4e76-802d-cb66c7cb2397`, started 07:28:26 UTC on October 11.
Team Black, Team Anthracite and Team Royal each produced two designs, with three
high color seeds and three medium edits. All six finished by 07:30:39 UTC with
no errors or additional retries, including Royal despite its prior missing-photo
error. Each was inspected against the current supplier reference and enlarged
after the five-minute wait. All six showed adult women's shoulder proportions,
gentle waist shaping and full torso length, without obvious cropping or artificial
cinching. Within each color the silhouette, zipper, white cords, pockets,
heather, neck tag and Swoosh remained visually consistent. Serra script appears
smaller than its standard reference, most noticeably on Black; this remains a
review flag. Exact fit dimensions, decoration size and artwork pixels were not
verified. No code change was made for this additional silhouette test.

All new candidates remain in review. Nothing was approved or published. Keep
PR #2509 draft: PC90H logo scale, the charcoal NKFD9889 neck-label detail, and
CN9402 script scale and other styles/colors still need review. Successful generation and passing
automated tests do not establish exact garment or artwork fidelity.
