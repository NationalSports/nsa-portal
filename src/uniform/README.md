# Custom Uniform Builder

A production-grade, self-serve custom-uniform designer for National Sports Apparel.
A coach (or a rep) picks a sport, designs a team jersey in a live 3D preview, adds
numbers/names/logos, builds a roster, and hands the design off as an order — with a
vector production proof for the shop.

- **Standalone route:** `/uniform-builder` (login-free, so it's shareable and testable
  in deploy previews).
- **In-app:** opened as an overlay from the Coach Portal and from the Order Editor.
- **Live preview:** a real three.js GLB garment, not a locked image — every color,
  pattern, number, and logo is editable and re-renders in 3D.

---

## Entry points & wiring

| Where | How it opens | Code |
|---|---|---|
| Public demo | `/uniform-builder` route (short-circuits before the login gate) | `src/App.js` (`isUniformBuilder`), `src/index.js` |
| Coach Portal | "Design Uniform" button → full-screen overlay | `src/CoachPortal.js` (`setUniformBuilder`) |
| Order Editor | "🎽 Design Uniform" button → overlay | `src/OrderEditor.js` (`showUniformBuilder`) |
| Marketing site | iframe of `/uniform-builder?embed=1` under the site header | `EMBEDDED` flag in `ProBuilder.js` |

The component is always lazy-loaded (`React.lazy`) so its jsPDF/canvas/three.js deps
only download when the builder is actually opened.

### Embedding (`?embed=1`)

Same convention as `/team-stores` and `/livelook`: when the standalone route is iframed
onto `nationalsportsapparel.com` under the site header, `?embed=1` drops the builder's own
top-left back button (it has nowhere to go on the public route) so it sits cleanly as page
content. The iframe + proxy rewrite themselves live in the marketing site's Netlify config
(a rewrite mirroring the `/team-stores` one), not in this repo.

---

## User flow

A guided 5-step wizard (`STEPS` in `ProBuilder.js`):

1. **Team** — team name, one shared color palette (add/remove swatches), cut & style
   (V-Neck / Crew / artist bases), fabric.
2. **Jersey** — per-zone colors and patterns on the live 3D garment; "Change Design"
   dropdown ports the current colors/numbers/logos onto an alternate design.
3. **Embellish** — numbers, names (arched / spacing / outline / double-outline), and
   logos (upload, drag-to-place, resize, rotate, vectorize) at kit-standard positions.
   **The garment starts clean** — every decoration is added by the user, like a real
   kit order.
4. **Roster** — player rows (name + number) mapped onto the design.
5. **Finalize** — save the design, export proofs, and submit an order request.

---

## Architecture

The builder keeps a small, human **`config`** (colors, pattern, number/name/font, logos)
and maps it onto a richer **design spec** (`designSpec.js`) via `specFromConfig()`. That
one spec drives both render paths, so the coach's 3D preview matches the printed proof:

```
config ──specFromConfig()──▶ design spec ──┬─▶ Viewer3D.js     (live three.js GLB preview)
                                           └─▶ renderCanvas.js (2D PNG / PDF / SVG proof)
```

### File map (`src/uniform/`)

| File | Role |
|---|---|
| `ProBuilder.js` | **Main component** — the guided wizard, rail UI, config state, autosave, order hand-off. |
| `Viewer3D.js` | three.js GLB viewer — zone detection, per-fabric surface, decals (numbers/logos), camera. |
| `templates.js` | Garment registry — 3D bases + 2D zoned templates and their anchors. |
| `designSpec.js` | The spec schema, defaults, and merge logic. |
| `renderCanvas.js` | 2D production renderer → PNG (view), front+back proof sheet, vector SVG, spec JSON, PDF. |
| `lettering.js` | Shared athletic-text engine (arch, letter-spacing, fill + double outline). |
| `fonts.js` | Jersey font list + `fontShorthand()`. |
| `patterns.js` | Pattern tiles (stripes, chevron, camo, hex mesh, carbon, …). |
| `fabricInfo.js` | Fabric option metadata + swatch data URLs. |
| `raster.js` | Raster-template zone-tinting helpers. |
| `builderSettings.js` | Admin-managed defaults (palette, etc.), hydrated from Supabase. |
| `UniformBuilder.js` | The original full-power SVG editor (per-zone patterns, SVG upload, AI, PDF). Still available as the "advanced" surface. |
| `BuilderSettingsAdmin.js` · `PatternLibraryAdmin.js` · `UniformOrdersAdmin.js` | Staff admin surfaces (Settings tabs). |

### AI design

`netlify/functions/uniform-ai-design.js` — a plain-English brief goes to Claude, which is
**forced through a tool schema** (`propose_uniform_designs`) to return 2–3 structured design
candidates (colors, neck style, number style, patterns, etc.). Candidates auto-apply to the
editable spec — nothing is a locked image. Model is configurable via `UNIFORM_AI_MODEL`
(default `claude-haiku-4-5`); degrades gracefully with a friendly message if
`ANTHROPIC_API_KEY` isn't set.

---

## 3D viewer (`Viewer3D.js`)

- **Zone detection** — `matchZone()` maps a mesh **or** material name to a zone id
  (`body`, `sleeveL/R`, `collar`, `sidePanel*`, `yoke`, `pocket`, `hood`), tolerant of vendor
  naming variants. Meshes that match no zone (e.g. stitch geometry) keep their original
  material.
- **Vendor-material replacement** — vendor GLB materials are swapped for a controlled
  `MeshPhysicalMaterial` (CLO3D's `KHR_materials_specular` otherwise washes tinted colors to
  pastel). Rendered **double-sided** so the garment interior shows fabric, not the background,
  through the neck/arm openings.
- **Fabric surface system** — each fabric (matte/mesh/heather/sublimated/gloss) gets a
  procedurally generated normal/bump so solid colors read as cloth, not plastic. If a vendor
  ships a **flat** normal map (all `128,128,255`), `isFlatNormalTexture()` detects it and falls
  back to the procedural knit so the surface still looks like fabric.
- **Pattern repeat** — computed per-zone from the dominant UV span (`zoneUvSpan` /
  `zoneRepeat`) so stripe width stays continuous across multi-panel bodies.
- **Decals** — numbers/logos are projected as decal geometry onto a torso box (body art) or
  the full-model box (sleeve logos).
- **Framing** — dramatic tilt + a lens-shift (`camera.setViewOffset`) that pans the image
  without moving the orbit pivot, so the garment stays centered while rotating.

### Garment bases (`templates.js`)

| Template | `neckStyle` id | Source | Notes |
|---|---|---|---|
| `octa_jersey` | — | "Octa Asa 6" (CC BY) | Built-in photoreal fallback. |
| Program garments | `vneck` / `crew` | — | The default V-neck / crew per program. |
| `nsapro_jersey` | `newbase` | Sahrul (CLO3D), v1 | First artist test base. |
| `sahrul2_jersey` | `sahrul2` | Sahrul (Blender), v2 | **Production-spec base:** full PBR set + real modeled stitch geometry. Draco 26 MB → 5.2 MB. |
| `vikram_jersey` | `vikram` | Vikram (Blender) | Second artist test base (evaluation only). |

The artist bases are exposed side-by-side in the **Cut & Style** pills so they can be compared
head-to-head in the same colors.

---

## 2D production output (`renderCanvas.js`)

The interactive preview and the printed proof share the same templates, pattern tiles, and
fonts, so they match. Exports:

- High-res **PNG** of the current view
- **Front + back proof sheet**
- Vector **SVG**
- **Spec JSON** (per-zone colorway names/hex + lettering/fonts) for the shop
- Vector **PDF** production proof (jsPDF)

---

## Persistence

- **localStorage (offline source of truth):**
  - `nsa_uniform_pro_autosave` — the live `{ config, assignments, playerNames, ts }`
    ("Continue your last design").
  - Saved designs list + local order queue (`nsa_uniform_orders`).
- **Supabase (best-effort sync, RLS-enabled):**
  - `uniform_designs` (migration 070) — saved designs.
  - `uniform_patterns` (migration 071) — admin pattern library.
  - `uniform_order_requests` (migration 072) — submitted order requests.

The builder works fully offline; Supabase writes are best-effort and never block the UI.

---

## Admin surfaces

Under **Settings** in the main app (`src/App.js`):

- **Uniform Builder** → `BuilderSettingsAdmin.js` (palette + defaults)
- **Uniform Patterns** → `PatternLibraryAdmin.js`
- **Uniform Orders** → `UniformOrdersAdmin.js`

---

## Build & verify

```bash
CI=true npx craco build            # production build (ESLint warnings are errors)
npx serve -s build -l 8099         # serve the static build
# open http://localhost:8099/uniform-builder
```

Deploy previews (Netlify) expose the route at
`deploy-preview-<PR>--nsa-portal.netlify.app/uniform-builder`.

---

## Status & open items

- **Merge:** branch is merged up to date with `main`; the standalone route is embed-ready.
- **Artist decision:** proceeding with **Sahrul**. His v2 base is built to the production
  pipeline (clean albedo, packed metallic-roughness, normal, AO) with **real modeled stitch
  geometry**. Vikram withdrew (his workflow is marketing renders, not the apparel pipeline).
- **Outstanding upgrade asks to Sahrul** (measured from his `.blend`):
  1. **Normal map** — currently near-flat; bake in fabric weave + stitch detail.
  2. **AO map** — currently empty; bake real ambient occlusion into the occlusion channel.
  3. **Roughness** — currently ~0.2 (too glossy); raise to matte-fabric ~0.8.
  4. **Collar** — a separate low-poly band with ~1–4 cm gaps to the body; weld it to the
     neckline and add segments to smooth its curve.
  (The albedo is already clean.)
- **2D proof for artist bases** still reuses the octa flat art as a placeholder.
