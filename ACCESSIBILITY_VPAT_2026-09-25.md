# Accessibility / VPAT Readiness — Customer-Facing Site (2026-09-25)

## The short version

A **VPAT** (Voluntary Product Accessibility Template) is not a certification you pass —
it is a form you fill out *about* your site, stating how well it meets **WCAG 2.1 Level AA**
(the accessibility standard schools and colleges are now held to under the ADA Title II rule
and Section 508). The completed form is called an **ACR** (Accessibility Conformance Report).
Schools ask vendors for one so they can show their procurement is accessible.

Where we stand today: the customer-facing site is **in decent shape but not yet ready for an
honest "Supports" across the board.** The Team Shop (nationalteamshop.com) is the strongest
part. The team stores (`/shop/<slug>`) had one serious blocker: **a keyboard-only or
screen-reader user could not open a product at all.** This PR fixes that plus most of the
automated-scan failures. A handful of items remain (listed below), and **manual screen-reader
testing has not been done yet** — a VPAT should not be sent until it has.

## What was tested and how

**Scope — the pages schools, coaches, players and parents use** (the internal staff portal is
out of scope; schools don't buy access to it):

| Page | URL |
|---|---|
| Team Shop — home, catalog, decoration, FAQ, start order, cart | `nationalteamshop.com` (scanned at `/teamshop/*`, same code; the domain itself is still behind the "Opening soon" gate) |
| Team Stores directory | `/team-stores` |
| Individual team store (parents/players buy here) | `/shop/<slug>` — scanned two real open stores |
| Order tracking | `/shop/order/<id>` |
| Adidas live catalog | `/adidas` (`/livelook`) |
| Uniform builder | `/uniform-builder` |
| Coach portal | `/?portal=<tag>` — **not scanned** (didn't finish loading in the headless browser; see gaps) |

**Method:**
1. **axe-core** (Deque's scanner, the industry standard) against the **live production site**,
   testing every WCAG 2.0/2.1/2.2 A and AA rule it covers.
2. Scripted **keyboard probe**: Tab through each page, record whether focus is visible.
3. **Reflow probe**: shrink to 320px wide and check for sideways scrolling (WCAG 1.4.10).
4. **Code review** of the public-facing source for patterns scanners miss (clickable `<div>`s
   with no keyboard support, removed focus outlines, unlabeled inputs, missing alt text).
5. Re-ran the scan on a local build with this PR's fixes to confirm them.

Automated tools catch roughly a third to a half of real accessibility problems. The rest need
a person using a screen reader (NVDA/JAWS on Windows, VoiceOver on Mac/iPhone) — see "Next steps".

## Results

### Before (live site, 2026-09-25)

| Page | axe failures | Keyboard / other |
|---|---|---|
| Team Shop home | 9 low-contrast text, 4 too-small tap targets (carousel dots 10×10px) | Good — every stop had a visible focus ring |
| Team Shop catalog | 5 low-contrast | Good |
| Team Shop decoration | 8 low-contrast | Good |
| Team Shop FAQ / start order | 1 / 2 low-contrast | Good; start order scrolls sideways at 320px |
| Team Stores directory | 1 low-contrast | Search box had no label; 5 focus stops with no visible ring |
| **Team store** | 1–5 low-contrast | **Product cards were click-only `<div>`s — unreachable by keyboard (WCAG 2.1.1, Level A)**; search box unlabeled; no `<h1>` |
| Order tracking | 2 low-contrast | — |
| Adidas catalog | **76** low-contrast (one gray a hair under the limit, plus a lighter gray) | Search + date inputs unlabeled; 4 stops without a visible ring |
| Uniform builder | 0 | 3 Tab presses landed nowhere |

Every automated failure was **color contrast** or **target size** — no missing alt text,
missing form labels (by axe's definition), broken ARIA, or missing page language. That's a good
foundation.

### Fixed in this PR

| Fix | WCAG | Files |
|---|---|---|
| Team store product cards, package cards, bundle banner and the store-name home link are now real keyboard controls (Tab to reach, Enter/Space to open) with a visible focus ring. **Verified:** Tab to a card + Enter opens the product page. | 2.1.1 (A), 2.4.7 (AA), 4.1.2 (A) | `src/storefront/Storefront.js` |
| Team store search boxes get an accessible label | 1.3.1, 4.1.2 (A) | `src/storefront/Storefront.js` |
| Team store and order-tracking tabs get descriptive page titles (was the generic "National Sports Connect") | 2.4.2 (A) | `src/storefront/Storefront.js`, `src/storefront/OrderTrack.js` |
| Team Shop "faint" gray text darkened `#8790A5 → #666E85` (3.0:1 → 4.8:1); red eyebrow text on navy lightened `#D94A52 → #E4737A` (3.4:1 → 4.8:1). One token change each, applied everywhere they're used. | 1.4.3 (AA) | `src/teamshop/theme.js` |
| Carousel dots get a 24×24px tap area (the painted dot is unchanged) | 2.5.8 (AA, WCAG 2.2) | `src/teamshop/Home.js` |
| Team Stores directory: search box labeled, visible focus ring, hint text darkened | 1.3.1, 2.4.7, 1.4.3 | `src/storefront/TeamStores.js` |
| Order tracking: gray/faded text darkened | 1.4.3 | `src/storefront/OrderTrack.js` |
| Adidas catalog: gray text darkened to `#5F6675` (≥5.3:1) on light backgrounds, lightened to `#A6ACB8` (7.7:1) on the black header/footer. Product swatch colors untouched. | 1.4.3 | `src/storefront/AdidasInventory.js` |

**After (local build with these fixes, live data):** Team Shop catalog, FAQ, start order,
Team Stores directory, order tracking, Adidas catalog (was 76) and uniform builder have
**zero axe failures**. Remaining automated flags:
- Team Shop home/decoration: the big faded "01 / 02 / 03" step numbers. They're decorative and
  hidden from screen readers (`aria-hidden`), which WCAG 1.4.3 exempts, so they're left as designed.
- Team Shop home: the chat button is partly covered by its "Need a hand?" bubble (to do #6).
- Team stores: text drawn in the school's own colors (to do #2).

## Still to do before signing a VPAT (priority order)

1. **Coach portal keyboard access (Level A — blocker).** `src/CoachPortal.js` has ~37 click-only
   `<div>`s: order rows, art tiles, proof thumbnails, "back" links. A keyboard or screen-reader
   coach can't open an order or approve art. Same fix pattern as the team store (`kbActivate`),
   but it's a bigger file and deserves its own PR plus a manual check, since the portal didn't
   finish loading in the automated browser.
2. **Team store colors come from each school's own colors.** Remaining failures on team stores
   (gold cart button with white text, gold top-strip text on maroon, footer pink-on-maroon) are
   computed from the store's primary/accent colors. Fix: have the storefront theme automatically
   choose black or white text (or darken/lighten the accent) when a school's colors don't reach
   4.5:1. One change in the theme builder fixes every store.
3. **Skip link, headings, page titles.** Cart, uniform builder and coach portal still use the generic tab title "National Sports Connect" (2.4.2).
   **Skip link + headings:** No page has a "Skip to main content" link (2.4.1, Level A), and the
   team store page has no `<h1>` (1.3.1 / 2.4.6). Small changes.
4. **Adidas catalog + staff-login inputs** labeled only by placeholder text (3.3.2). Add
   `aria-label`s.
5. **Team Shop start-order page scrolls sideways at 320px** (1.4.10 reflow).
6. **Chat button** partly covered by its "Need a hand?" bubble (2.5.8, minor).
7. **Uniform builder** — the 3D/SVG designer is inherently visual. Plan to declare it "Partially
   Supports" with an alternative ("call or email your rep to design your uniform"), which is an
   accepted approach, and make sure its controls have labels.
8. **Publish an Accessibility Statement page** (commitment to WCAG 2.1 AA, contact for
   accessibility help, date of last review). Schools look for this; linking it in the footer of
   the Team Shop and every team store is expected.
9. **Manual screen-reader pass** on the core buying path: find store → pick product → choose
   size → add to cart → checkout (Stripe's hosted fields are Stripe's responsibility and they
   publish their own VPAT) → order tracking.
10. **Guardrail:** add the axe scan to the existing Playwright e2e suite so new pages don't
    regress. `@axe-core/playwright` drops into `e2e/` in a few lines.

Items 1–4 are the ones that turn "Does Not Support" rows into "Supports" on the form.

## Draft ACR — WCAG 2.1 Level A & AA

**DRAFT — do not send to a school yet.** Status reflects the site *after* this PR. Conformance
terms are the official VPAT ones: *Supports*, *Partially Supports*, *Does Not Support*,
*Not Applicable* — plus *Not yet evaluated* where a manual test is still owed (must be resolved before sending). "Partially" means most of the site meets it with known exceptions (listed).
Evaluation methods: automated (axe-core 4.x), scripted keyboard testing, code review. Manual
assistive-technology testing: **not yet performed.**

### Level A

| Criterion | Status | Remarks |
|---|---|---|
| 1.1.1 Non-text Content | Supports | Product images carry the product name; decorative images use empty `alt`. Automated scan found no missing alt text. |
| 1.2.1–1.2.3 Audio/Video | Not Applicable | No audio or video content. (If product videos are added, captions are required.) |
| 1.3.1 Info and Relationships | Partially Supports | Semantic buttons, links, `<main>` on most pages. Exceptions: team store page lacks an `<h1>`; some inputs labeled by placeholder only. |
| 1.3.2 Meaningful Sequence | Supports | DOM order matches visual order. |
| 1.3.3 Sensory Characteristics | Supports | Instructions don't rely on shape/position alone. |
| 1.4.1 Use of Color | Not yet evaluated | Stock badges use text ("In stock", "Low stock"); color swatches need manual review. |
| 1.4.2 Audio Control | Not Applicable | No auto-playing audio. |
| 2.1.1 Keyboard | Partially Supports | Team Shop and team stores fully keyboard-operable (team store fixed in this PR). **Coach portal: order rows, art tiles are mouse-only (to do #1).** Uniform builder canvas is pointer-driven. |
| 2.1.2 No Keyboard Trap | Supports | No traps found in keyboard probe. |
| 2.1.4 Character Key Shortcuts | Not Applicable | No single-key shortcuts on public pages. |
| 2.2.1 Timing Adjustable | Supports | No session time limits found on public pages (code review). |
| 2.2.2 Pause, Stop, Hide | Supports | Team Shop hero carousel pauses on hover/focus and is disabled under reduced-motion. |
| 2.3.1 Three Flashes | Supports | No flashing content. |
| 2.4.1 Bypass Blocks | Does Not Support | No skip link (to do #3). |
| 2.4.2 Page Titled | Partially Supports | Team Shop, directory, Adidas catalog have descriptive titles; team stores and order tracking get them in this PR. Cart, uniform builder and coach portal still show the generic "National Sports Connect". |
| 2.4.3 Focus Order | Supports | Tab order follows reading order. |
| 2.4.4 Link Purpose | Supports | Link/card text describes the destination. |
| 2.5.1 Pointer Gestures | Partially Supports | Uniform builder drag interactions have no single-pointer alternative for every action. |
| 2.5.2 Pointer Cancellation | Supports | Actions fire on click (up-event). |
| 2.5.3 Label in Name | Supports | Visible labels match accessible names. |
| 2.5.4 Motion Actuation | Not Applicable | No motion-triggered features. |
| 3.1.1 Language of Page | Supports | `<html lang="en">`. |
| 3.2.1 On Focus / 3.2.2 On Input | Supports | No unexpected context changes found. |
| 3.3.1 Error Identification | Not yet evaluated | Needs a manual screen-reader check that checkout errors are announced. |
| 3.3.2 Labels or Instructions | Partially Supports | Some search/date inputs rely on placeholder text (to do #4). |
| 4.1.1 Parsing | Supports | (Obsolete in WCAG 2.2; React produces well-formed markup.) |
| 4.1.2 Name, Role, Value | Partially Supports | Fixed on team stores; coach portal click-only elements lack role/name (to do #1). |

### Level AA

| Criterion | Status | Remarks |
|---|---|---|
| 1.2.4–1.2.5 Captions (Live) / Audio Description | Not Applicable | No video. |
| 1.3.4 Orientation | Supports | No orientation lock in the code; pages reflow at phone width. |
| 1.3.5 Identify Input Purpose | Partially Supports | Checkout name/email/address fields should carry `autocomplete` attributes — verify. |
| 1.4.3 Contrast (Minimum) | Partially Supports | Team Shop, directory, tracking and Adidas catalog pass after this PR. Team stores using school colors can fail depending on the school's palette (to do #2). |
| 1.4.4 Resize Text | Not yet evaluated | Needs a manual 200% zoom check. |
| 1.4.5 Images of Text | Supports | Text is real text; logos exempt. |
| 1.4.10 Reflow | Partially Supports | All scanned pages reflow at 320px except Team Shop start-order (to do #5). |
| 1.4.11 Non-text Contrast | Partially Supports | Focus rings and borders pass on Team Shop; team store controls depend on school colors. |
| 1.4.12 Text Spacing | Not yet evaluated | Needs a manual check with a text-spacing bookmarklet. |
| 1.4.13 Content on Hover or Focus | Supports | No hover-only tooltips carrying essential info. |
| 2.4.5 Multiple Ways | Supports | Navigation, category filters, and search. |
| 2.4.6 Headings and Labels | Partially Supports | Team store page lacks a top-level heading (to do #3). |
| 2.4.7 Focus Visible | Partially Supports | Team Shop and team stores show focus rings (team stores fixed in this PR). Adidas catalog and coach portal have elements with no visible ring. |
| 3.1.2 Language of Parts | Not Applicable | Single language. |
| 3.2.3 Consistent Navigation / 3.2.4 Consistent Identification | Supports | Shared header/footer component per surface. |
| 3.3.3 Error Suggestion / 3.3.4 Error Prevention (Legal, Financial) | Not yet evaluated | Checkout has a cart review step before payment; error wording needs a manual review. |
| 4.1.3 Status Messages | Partially Supports | "Added to cart" and similar messages are visual; should be announced with `role="status"`. |

## Next steps (business side)

- **Fix items 1–4**, then do the manual screen-reader pass (item 9). Realistically a few
  focused PRs.
- **Fill the official form.** Download the current **VPAT® 2.5 "WCAG" edition** from the
  Information Technology Industry Council (itic.org). The table above maps directly into it.
  Product name "National Sports Apparel Team Shop & Team Stores", version = the deploy date.
- **Optional but persuasive for larger districts/universities:** have a third-party firm
  (e.g. Level Access, Deque, TPGi, or a smaller WCAG consultant) review or co-sign the ACR.
  Some university procurement offices only accept third-party-validated VPATs.
- **Re-issue yearly** or after a major redesign. A VPAT with a date more than a year old is
  usually questioned.
- **Legal context to confirm with your attorney:** the DOJ's April 2024 ADA Title II rule
  requires public schools and colleges to meet WCAG 2.1 AA on the web content they provide,
  **including content provided through vendors**, with compliance dates in 2026–2027 depending
  on the entity's size. That's why these requests are showing up. Check current dates and any
  DOJ updates before quoting them to a customer.
