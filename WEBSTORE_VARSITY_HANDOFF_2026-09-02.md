# Team Store "Varsity" Redesign — Handoff

**Date:** 2026-09-02
**Branch:** `claude/web-team-stores-redesign-mz8umt`
**PR:** [NationalSports/nsa-portal#2104](https://github.com/NationalSports/nsa-portal/pull/2104) — open, CI green, mergeable
**Preview:** https://deploy-preview-2104--nsa-portal.netlify.app/shop/sjmgirlsbball2026
**Diff:** 1 file, +502 / −39 — all in `src/storefront/Storefront.js`

---

## Read this first

**The hero banner is not matching the mockup, and after three rounds it was not
converging.** Everything in this branch was reverse-engineered from four
screenshots. The design HTML was never obtained (see *The blocker* below). The
rest of the page — header, categories, product grid, product page, footer — is
in good shape. The banner is the open problem.

If you are picking this up: **get the HTML before writing any more CSS.** Three
rounds of measuring screenshots produced three "matches the numbers, still looks
wrong" results, which is the signature of a spec that can't be recovered from
pixels — specifically the typeface (see *The typeface trap*).

---

## The blocker: the design HTML was never read

The design was delivered as two Dropbox Transfer links:

- `https://www.dropbox.com/t/cs3TLj2Xw5ZKQiyB`
- `https://www.dropbox.com/t/SrJi8Al37kpBqZyK` (the HTML)

Neither could be read from the agent sandbox. What was tried:

| Attempt | Result |
|---|---|
| `curl` the transfer URL | 200, but the file list is client-rendered — not in the HTML |
| Guessed Dropbox transfer API paths (`/transfer/api/transfers/<key>`, `/details`, `/view`) | 404 |
| Headless Chromium, direct | `ERR_CONNECTION_RESET` — the sandbox proxy resets browser tunnels |
| Headless Chromium with all traffic forwarded through Node (works for every other host) | Page renders fully: *"Steve Peterson sent you 1 item · 0 bytes"* — but the file row stays a permanent grey skeleton. The app never fires the request that populates it. `fp.dropbox.com` (fingerprinting) and a `POST /log/blocked` in the trace point at bot detection. |

**This is a bot wall, not a bug to fix.** Ways to unblock:

1. Paste the HTML into the chat.
2. Commit the file into the repo (anywhere) and name the path.
3. Any non-Dropbox host that serves raw files.

The transfer key extracted from the page, in case it is useful:
`AAAAACiZc0AGXFK7ch7GNif0yG021sSeW6TJ9jo-EqxnvASrJVbG2vo`

---

## The typeface trap — why the banner keeps missing

This is the single most important technical finding.

The storefront's display face is **Barlow Condensed** (already the NSA design
system font, used by the classic look too). The mockup was drawn in a
**noticeably wider face**. Measured on the loaded webfont, Barlow Condensed 800
uppercase advances **~0.473em per character**.

That difference makes two of the mockup's targets mutually exclusive:

- Team name spans **~80% of the viewport** (mockup)
- Team name letters stand **~27% of the hero's height** (mockup)

With a wider face you get both. With Barlow Condensed, sizing for the width
pushes the letters to **33%** of the hero — tall enough to compete with the
logo, which breaks the whole point of the hero ("logo in front, team name
behind", the user's one hard requirement).

Current resolution (commit `319a6a9`): hold the **height** at the mockup ratio
and open **letter-spacing** to reach the span. This is a guess at intent. The
real answer is in the HTML — it may specify a different font entirely, in which
case all of this sizing logic should be replaced, not tuned.

### Two measurement bugs that produced wrong numbers along the way

Both are worth knowing because they silently corrupt any harness you build:

1. **Blocking Google Fonts.** An early harness aborted `fonts.googleapis.com`
   along with analytics. Every width measured against the fallback face was
   wrong, and the word-sizing constant was tuned to that wrong value. Numbers
   reported to the user in two messages had to be retracted.
2. **`clip-path` parsing.** Chrome normalises `0` to `0px` in computed
   `clip-path`, so a percent-only regex silently drops a coordinate. This read
   the wedge's bottom edge as `0` and reported a fixed wedge as still broken.

---

## Where the code is

Everything is in `src/storefront/Storefront.js` (the public store at
`/shop/:slug`). Line numbers as of `319a6a9`:

| Line | Symbol | Purpose |
|---|---|---|
| 198 | `hexA` | hex → rgba, for the ghosted word |
| 208 | `luminance` | sRGB luminance |
| 221 | `bandColor` | darkens a light team primary until white type is legible |
| 229 | `lookOverride` | reads `?look=` |
| 331 | `useTheme` | resolves the look; varsity token overrides |
| 681 | `VS_HATCH`, `vsDots` | hero background textures |
| 690 | `storeShortName` | strips the "Team Store" / year tail |
| 703 | `mascotWord` | the word set behind the logo |
| 713 | `VsTopStrip` | near-black utility bar |
| 732 | `VsHeader` | team-color band, nav, search, cart |
| **770** | **`VsHero`** | **the banner — this is the open problem** |
| 821 | `VsMarquee` | starred selling-point band |
| 838 | `VsSectionHead` | eyebrow + two-tone headline + rule |
| 855 | `VsCategoryCard` | Featured Sections tile |
| 875 | `VsFooter` | deep team-color footer |
| 921 | `VsCrumbs` | product-page breadcrumb |
| 1062 | `Home` | varsity branch: hero, marquee, categories, grid |
| 1457 | `Card` | `vs` flag branches the card styling |
| 1627 | `ProductPage` | `theme.varsity` branches the chrome |
| 2910–2914 | `sizeBtn` / `thumbBtn` / `cta` | branch on `t.varsity` |

**Architectural note:** this is chrome only. Every varsity component reads the
same store/product rows and calls the same `navTo` / cart / stock / decoration
helpers as the existing looks. Pricing, inventory, size logic, personalization
and checkout are untouched. `ProductPage` was deliberately **not** forked —
its ~200 lines of size/stock/cart logic are the money path, so the varsity
treatment is conditional styling inside the existing component.

### How the look is selected

```js
// useTheme(), ~line 331
const pinned = store?.hero_look === 'bold' ? 'bold'
             : store?.hero_look === 'open' ? 'open'
             : 'varsity';
const look = lookOverride() || pinned;
```

`?look=varsity|open|bold` on any store URL renders that look for comparison
without touching the store row. Useful for A/B during review.

---

## Open decisions (business, not code)

### 1. Rollout is all-or-nothing today

**`hero_look` is not a column on `webstores`.** The read above always yields
`undefined`, so **every store flips to varsity the moment this merges**, with no
per-store way back. (This is also why the older `bold` look has never been
reachable for any store — pre-existing dead code.)

`?look=` is per-visit — fine for comparing, useless for holding a school on the
old design.

**To make rollout incremental:** add `hero_look text` to `webstores`, expose it
in the `webstores_public` view, and add a toggle in the store builder. The code
switch is already in place — that's the only work needed. Roughly a half-hour.

### 2. Nav items in the mockup that are features, not styling

The mockup's header shows `TEAMS ▾`, `ATHLETES ▾`, `ATHLETE SIGN UP ↗` and a
wishlist heart. These were **deliberately not built** — they'd have been dead
controls. The nav ships as *Shop by Category / All Items / search / cart*.

Someone needs to decide whether to build: a teams dropdown, athlete accounts +
sign-up, a wishlist.

### 3. Other deliberate deviations from the mockup

| Mockup | Shipped | Why |
|---|---|---|
| "Size guide" link on PDP | omitted | No size chart exists. (The classic look's "Size guide" label has never done anything either — pre-existing dead control.) |
| "FREE SHIPPING ON TEAM ORDERS $150+" | store's real delivery mode + close date | Can't honour a blanket claim per-store |
| Brand name on product cards ("ADIDAS") | store category | **No brand column on `products`.** `inventory_source` is the *distributor* (sanmar, momentec, click, ss_activewear, agron) — "SANMAR" on a card would be wrong. Adding a real brand column is the fix. |

---

## What is done and verified

- Top strip, header, marquee, Featured Sections grid, All Items grid, product
  cards, product page chrome, footer.
- `bandColor()` — a light team primary (vegas gold, columbia blue) is stepped
  down until white type on it is legible, so the header band never ships
  white-on-yellow.
- **White plate behind the header/footer logo.** A dark logo on the team's own
  dark band disappears — San Joaquin Memorial's navy "M" on navy was invisible
  in both. The Cal Poly mockup couldn't reveal this because its mark is light.
- `storeShortName()` — nearly every store is named `<Team> Team Store`. Without
  stripping that tail the ribbon read *"the official Orange Lutheran Football
  Team Store team store"*, the footer read *"Team Store Team Store"*, and the
  word behind the logo read **STORE** instead of **FOOTBALL**.
- `useTheme` spreads `NEUTRAL` first so team tokens actually win. `ink_color`
  was previously clobbered by the spread — no behaviour change today since that
  column doesn't exist, but the latent bug is fixed.
- Verified at 2000px / 1440px / 390px with the webfont loaded. No horizontal
  overflow at any width. Legacy look confirmed unchanged via `?look=open`.
- **255 test files / 4319 tests pass.** `lint:undef` clean.

### Current banner measurements (1440px, vs mockup)

| | Mockup | Current |
|---|---|---|
| Angled edge, top | 85.0% | 85.2% |
| Angled edge, bottom | 96.5% | 96.1% |
| Team name width | 80.3% | 79.1% |
| Team name height ÷ hero | 26.8% | 26.7% |
| Logo height ÷ hero | 56.3% | 54.6% |
| Logo : name height | 2.1× | 2.04× |
| Header height | 6.5% | 6.5% |

**Every number matches and the user still says it's wrong.** That is the
evidence that the remaining gap is not proportional — it's typeface, texture,
colour, or a detail only the HTML carries.

---

## Reproducing the verification harness

This is the useful part to inherit. It renders the **real component against
production data** and measures it, with no database writes.

**Constraints in this sandbox:**
- The headless browser's own tunnels through the agent proxy get reset. Every
  external request must be forwarded through Node (`https` +
  `HttpsProxyAgent` with `/root/.ccr/ca-bundle.crt`) and fulfilled back into the
  page via `page.route`.
- Playwright's bundled Chromium version doesn't match `/opt/pw-browsers`; launch
  with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
- Follow redirects **inside** the forwarder — Chromium does not re-route a 3xx
  you hand back, and the follow-up request escapes to the real network.
- **Never abort `fonts.googleapis.com`.** See *the typeface trap*.

**Cal Poly substitution** (for comparing against the mockup — Cal Poly is not a
real store): intercept the `webstores_public` REST response and overwrite
`name`, `primary_color`, `accent_color` before fulfilling. Everything downstream
is the real component and real products. Note the logo will be whatever store
you borrowed, so logo *width* ratios aren't comparable — only height.

**Dev server:** needs `.env.local` (gitignored) with
`REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` (the publishable anon
key, retrievable via the Supabase MCP `get_publishable_keys`).

**Good test stores:**

| Slug | Why |
|---|---|
| `sjmgirlsbball2026` | open; navy logo on navy — the contrast case; 10-letter mascot word |
| `orange-lutheran-football-team-store` | 14 products across 9 categories — exercises Featured Sections |
| `san-marcos-hs-field-hockey-team-store` | open, 39 products, no categories — the flat-grid path |

---

## Suggested order of work

1. **Get the HTML.** Everything below is guesswork until then.
2. Diff the HTML's hero against `VsHero` (line 770) — especially the font stack,
   the ghosted word's colour/opacity, the hatch, and the wedge geometry.
3. Decide the rollout question (§Open decisions 1). If incremental, add the
   `hero_look` column before merging.
4. Decide on the nav features (§Open decisions 2).
5. Consider a `brand` column on `products` so cards can show "ADIDAS" as drawn.

## Things not to redo

- Don't fork `ProductPage` — the varsity treatment is intentionally conditional
  styling inside it, because that component owns size/stock/cart correctness.
- Don't re-derive the character-advance constant from a screenshot. Measure it
  in the browser with the webfont loaded, at a size the `clamp()` is not
  capping (a clamped size reads narrower and skews the constant).
- Don't chase Dropbox. It's a bot wall.
