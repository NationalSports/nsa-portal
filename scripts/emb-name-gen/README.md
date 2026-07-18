# emb-name-gen — auto-generated embroidery name/number stitch files

Turns a job's names/numbers rosters into per-piece `.DST` machine files via
[Ink/Stitch](https://inkstitch.org) lettering, headless in CI. Replaces the
per-name digitizer round-trip for standard lettering work (sew-test approved
2026-07-11 on the shop's Ricoma; Barstitch bold @ ~1").

## The pipeline (increments)

1. **Plan (done)** — `src/embNameGen.js` `buildEmbNameGen(decos)` turns a job's
   embroidery names/numbers decorations into an ordered per-piece plan: sew
   order grouped by size (SZ_ORD), names before numbers within a size,
   CODE39-safe sew-order filenames (`001-L-NAME-SMITH`, `002-L-NUM-12`, …), a
   change-detection `fingerprint`, and human warnings.
2. **Generate (this folder + `.github/workflows/emb-name-gen.yml`)** — a
   `workflow_dispatch` Action runs Ink/Stitch's `batch_lettering` once per
   piece and uploads the DSTs + `manifest.json` as the `emb-name-dsts`
   artifact. No secrets needed. Run it with an empty payload for a SELFTEST.
3. **Wire (next)** — a scheduled sweep (same pattern as `followup-sweep`)
   finds staging/in-process embroidery jobs where `embNameGenNeeded()` is true
   and the stored fingerprint is stale, dispatches this workflow via the
   GitHub API, then uploads results to Cloudinary and attaches them to the
   job's art files — at which point the existing `emb-machine-manifest` → Pi →
   barcode pipeline delivers them to the machine with zero changes.

   Known limits / queued optimizations:
   - `workflow_dispatch` inputs are capped at 64KB — very large rosters must
     be chunked into multiple dispatches or moved to artifact/DB transport
     when the sweep is built.
   - Measured CI cost is ~3.2s process startup per piece — batching
     same-(font,scale) pieces into one multi-line `batch_lettering` call
     (supported: `--text` with a `\n` separator emits one file per line) cuts
     a 60-piece roster from ~3.3min to ~40s; queued for the wiring increment.
   - The Ink/Stitch tarball is now cached between runs.

## Triggering generation manually

GitHub → Actions → **emb-name-gen** → Run workflow.

- Empty payload → selftest (SMITH + 12, default font).
- Real payload: JSON of `{job_id, fingerprint, pieces}` exactly as returned by
  `buildEmbNameGen()`.

## fonts.json

Maps the portal's deco font keys (`num_font`/`name_font`: `block`, `serif`, …)
to Ink/Stitch fonts. `generate.py` resolves the exact font display name at
runtime from the bundle's own `fonts/<fontDir>/font.json` (spelling/case vary
between Ink/Stitch releases), computes scale% from the requested height in
inches, and clamps to the font's allowed range (with a warning recording the
achieved height). To add a font the shop approves: add a key here with its
`fontDir` from the Ink/Stitch bundle (or a custom font dropped into
`~/.inkstitch/fonts` on the runner) and its design height + scale range from
the font's `font.json`.

Known gap: `names` decorations don't yet carry a size/font (numbers do —
`num_size`/`num_font`); name pieces use the plan's defaults (~1", block) until
`name_size`/`name_font` fields are added to the editor.

## Validation status

- Plan logic: 12/12 unit tests (`src/__tests__/embDesigns.test.js` +
  `embNameGen.test.js`).
- `generate.py` mechanics (payload → scale math → zip handling → renames →
  manifest): smoke-tested against a stub inkstitch binary.
- The real Ink/Stitch invocation: **validated in CI** (run #4, commit dc75832) —
  the selftest produced valid Tajima DSTs headless: `001-L-NAME-SMITH.DST`
  (1,959 stitches, ~25mm tall) and `002-L-NUM-12.DST` (656 stitches), both with
  correct DST headers. Getting there required (found only by live runs): the
  archive layout (binary at `inkstitch/bin/`, fonts at `inkstitch/fonts/`),
  surfacing crashes that Ink/Stitch prints to stdout, and the wayland/EGL libs
  the bundled wxPython needs on ubuntu-latest.
