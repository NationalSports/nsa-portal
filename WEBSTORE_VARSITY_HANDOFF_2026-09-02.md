# Team Store "Varsity" Redesign — Handoff

**Date:** 2026-09-02
**Branch:** `claude/web-team-stores-redesign-mz8umt`
**PR:** [NationalSports/nsa-portal#2104](https://github.com/NationalSports/nsa-portal/pull/2104) — open, CI green, mergeable
**Preview:** https://deploy-preview-2104--nsa-portal.netlify.app/shop/sjmgirlsbball2026
**Diff:** 1 file, ~+505 / −100 — all in `src/storefront/Storefront.js`

> **Status: the banner is done.** An earlier revision of this doc said the design
> HTML had never been read and that the hero was the open problem. That was true
> when written and is no longer. Steve applied the approved Design HTML directly
> in `59dd7d6` ("Finish varsity storefront redesign"), which settled it. The
> history below is kept only because the traps it records will bite anyone who
> measures this page again.

---

## What is in the branch

The public team/web store at `/shop/:slug` gets a new look ("varsity"):
top strip, team-color header, hero with the team logo in front of the team name,
starred marquee, Featured Sections category grid, flat All Items grid, restyled
product cards, product-page chrome, deep team-color footer.

**Chrome only.** Every varsity component reads the same store/product rows and
calls the same `navTo` / cart / stock / decoration helpers as the existing looks.
Pricing, inventory, size logic, personalization and checkout are untouched.
`ProductPage` was deliberately **not** forked — its size/stock/cart logic is the
money path, so the varsity treatment is conditional styling inside it.

Verified: 255 test files / 4319 tests pass, `lint:undef` clean, no horizontal
overflow at 2000 / 1440 / 390px, legacy look unchanged via `?look=open`.

---

## Code map

`src/storefront/Storefront.js`, line numbers as of `59dd7d6`:

| Line | Symbol | Purpose |
|---|---|---|
| ~198 | `hexA` | hex → rgba, for the ghosted word |
| ~208 | `luminance` | sRGB luminance |
| ~221 | `bandColor` | darkens a light team primary until white type is legible |
| ~229 | `lookOverride` | reads `?look=` |
| ~331 | `useTheme` | resolves the look; varsity token overrides |
| ~687 | `VS_HATCH`, `vsDots` | hero textures — **values come from the Design HTML** |
| ~697 | `storeShortName` | strips the "Team Store" / season-year tail |
| ~708 | `productCategory` | curated `store_category`, falling back to catalog `category` |
| ~717 | `mascotWord` | the word set behind the logo |
| ~727 | `VsTopStrip` | near-black utility bar (fixed 36px) |
| ~746 | `VsHeader` | team-color band, nav, search, cart (fixed 76/60px) |
| ~786 | `VsHero` | the banner |
| ~824 | `VsMarquee` | starred selling-point band |
| ~841 | `VsSectionHead` | eyebrow + two-tone headline + rule |
| ~858 | `VsCategoryCard` | Featured Sections tile |
| ~878 | `VsFooter` | deep team-color footer |
| ~924 | `VsCrumbs` | product-page breadcrumb |
| ~1065 | `Home` | varsity branch: hero, marquee, categories, grid |
| ~1460 | `Card` | `vs` flag branches the card styling |
| ~1630 | `ProductPage` | `theme.varsity` branches the chrome |
| ~2913 | `sizeBtn` / `thumbBtn` / `cta` | branch on `t.varsity` |

### How the look is selected

```js
// useTheme()
const pinned = store?.hero_look === 'bold' ? 'bold'
             : store?.hero_look === 'open' ? 'open'
             : 'varsity';
const look = lookOverride() || pinned;
```

`?look=varsity|open|bold` on any store URL renders that look for comparison
without touching the store row.

---

## Open decisions — these are still open

### 1. Rollout is all-or-nothing today

**`hero_look` is not a column on `webstores`.** The read above always yields
`undefined`, so **every store flips to varsity the moment this merges**, with no
per-store way back. (Also why the older `bold` look has never been reachable —
pre-existing dead code.) `?look=` is per-visit, so it's fine for comparing and
useless for holding a school on the old design.

**To make rollout incremental:** add `hero_look text` to `webstores`, expose it
in the `webstores_public` view, add a toggle in the store builder. The code
switch is already in place — that's the only work needed.

### 2. Nav items in the mockup that are features, not styling

The mockup's header shows `TEAMS ▾`, `ATHLETES ▾`, `ATHLETE SIGN UP ↗` and a
wishlist heart. Not built — they'd be dead controls. The nav ships as
*Shop by Category / All Items / search / cart*. Someone needs to decide whether
to build a teams dropdown, athlete accounts + sign-up, and a wishlist.

### 3. Other deviations from the mockup

| Mockup | Shipped | Why |
|---|---|---|
| "Size guide" link on PDP | omitted | No size chart exists. (The classic look's "Size guide" label has never done anything either.) |
| "FREE SHIPPING ON TEAM ORDERS $150+" | store's real delivery mode + close date | Can't honour a blanket claim per-store |
| Brand name on cards ("ADIDAS") | store category | **No brand column on `products`.** `inventory_source` is the *distributor* (sanmar, momentec, click, ss_activewear, agron) — "SANMAR" on a card would be wrong. A real `brand` column is the fix. |

---

## Behaviour changes worth knowing

- **`productCategory()` fallback.** Category grouping now uses the curated
  `store_category` and falls back to the catalog `category`. This fixed stores
  that showed **no** Featured Sections at all — `sjmgirlsbball2026` went from 0
  category cards to 4. Note it also applies to the classic look's category
  sub-nav and sectioning, so a store pinned to `?look=open` will show category
  sections where it previously showed one flat grid.
- **White plate behind the header/footer logo.** A dark logo on the team's own
  dark band disappears — San Joaquin Memorial's navy "M" on navy was invisible
  in both. The Cal Poly mockup couldn't reveal this because its mark is light.
- **`storeShortName()`.** Nearly every store is named `<Team> Team Store`.
  Without stripping that tail the ribbon read *"the official Orange Lutheran
  Football Team Store team store"* and the word behind the logo read **STORE**
  instead of **FOOTBALL**.
- **`useTheme` spreads `NEUTRAL` first** so team tokens win. `ink_color` was
  previously clobbered by the spread — latent bug, no behaviour change today
  since that column doesn't exist.

---

## Traps — read before measuring this page again

Three rounds of matching the hero to screenshots produced "the numbers match,
it still looks wrong." Two of those rounds were corrupted by harness bugs, and
the third was chasing a spec that pixels can't carry. If you build a
render-and-measure harness:

1. **Never block `fonts.googleapis.com`.** An early harness aborted it along
   with analytics. Every width was then measured against a fallback face, and a
   sizing constant got tuned to that wrong value. Numbers reported to the user
   had to be retracted.
2. **`clip-path` parsing.** Chrome normalises `0` to `0px` in computed
   `clip-path`, so a percent-only regex silently drops a coordinate — this read
   a fixed wedge's bottom edge as `0` and reported it as still broken.
3. **Measure the character advance at an unclamped size.** A `clamp()` that is
   capping the font makes the face read narrower and skews the constant.
4. **Proportions were never the gap.** Every ratio matched the mockup — wedge
   angle, name width, name height, logo-to-name — and it still read wrong. The
   real differences were in the Design HTML: the edge treatment is a **notched
   zigzag on both sides**, not a plain diagonal wedge; the ghosted word is far
   more opaque (0.28) and much larger; the ribbon and cart are skewed −6°/−3°;
   the header accent rule is a full-width gradient, not a short bar. None of
   that is recoverable from a screenshot. **Get the source, don't measure the
   picture.**

### Getting the design source

The design was delivered as Dropbox Transfer links. Those could not be read from
the agent sandbox — the page renders but the file list stays a permanent
skeleton (`fp.dropbox.com` fingerprinting plus a `POST /log/blocked` in the
trace: bot detection, not a bug to fix). If you need design files in a sandbox,
paste them into chat or commit them to the repo.

---

## Reproducing the verification harness

Renders the **real component against production data** and measures it, with no
database writes. Sandbox constraints:

- The headless browser's own tunnels through the agent proxy get reset. Forward
  every external request through Node (`https` + `HttpsProxyAgent` with
  `/root/.ccr/ca-bundle.crt`) and fulfil it back into the page via `page.route`.
- Playwright's bundled Chromium doesn't match `/opt/pw-browsers`; launch with
  `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
- Follow redirects **inside** the forwarder — Chromium does not re-route a 3xx
  you hand back, and the follow-up escapes to the real network.
- Dev server needs `.env.local` (gitignored) with `REACT_APP_SUPABASE_URL` and
  `REACT_APP_SUPABASE_ANON_KEY` (publishable anon key, via Supabase MCP
  `get_publishable_keys`).

**Substituting a school** (e.g. to compare against a Cal Poly mockup when Cal
Poly isn't a real store): intercept the `webstores_public` REST response and
overwrite `name`, `primary_color`, `accent_color` before fulfilling. Everything
downstream is the real component and real products. The logo stays whatever
store you borrowed, so logo *width* ratios aren't comparable — only height.

**Good test stores:**

| Slug | Why |
|---|---|
| `sjmgirlsbball2026` | open; navy logo on navy — the contrast case; exercises the `productCategory` fallback |
| `orange-lutheran-football-team-store` | 14 products across 9 curated categories |
| `san-marcos-hs-field-hockey-team-store` | open, 39 products — larger grid |

---

## Don't redo

- Don't fork `ProductPage` — the varsity treatment is intentionally conditional
  styling inside it, because that component owns size/stock/cart correctness.
- Don't re-derive hero geometry from screenshots. The values in `VsHero`,
  `VS_HATCH` and `vsDots` come from the approved Design HTML.
- Don't chase Dropbox Transfer from a sandbox. It's a bot wall.
