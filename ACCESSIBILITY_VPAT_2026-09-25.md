# Accessibility / VPAT Readiness — Customer-Facing Site

*Round 1: 2026-09-25 · Round 2: 2026-09-26*

## The short version

A **VPAT** (Voluntary Product Accessibility Template) is not a certification you pass.
It's a form you fill out *about* your site, stating how well it meets **WCAG 2.1 Level AA**,
the accessibility standard schools and colleges are now held to under the ADA Title II rule
and Section 508. The completed form is called an **ACR** (Accessibility Conformance Report).
Schools ask vendors for one so they can show their procurement is accessible.

**Where we stand after round 2:** every customer-facing page now passes the automated
WCAG 2.1 AA scan, is fully usable with a keyboard (including the coach portal), has a skip
link, descriptive page titles, labeled form fields, and a published Accessibility Statement.
**What's still owed before sending a VPAT is human testing:** a screen-reader walkthrough, a
200% zoom check, and a text-spacing check (see "Still to do"). Those rows are marked
*Not yet evaluated* in the draft table below.

## What was tested and how

**Scope: the pages schools, coaches, players and parents use.** The internal staff portal is
out of scope because schools don't buy access to it. The uniform builder is not offered to
customers yet, so it is out of scope until it launches.

| Page | URL |
|---|---|
| Team Shop: home, catalog, decoration, FAQ, start order, cart (checkout needs a filled cart, so its changes were code-reviewed, not scanned) | `nationalteamshop.com` (scanned at `/teamshop/*`, same code; the domain itself is still behind the "Opening soon" gate) |
| Team Stores directory | `/team-stores` |
| Individual team store (parents/players buy here) | `/shop/<slug>`, scanned against three real stores (including SJM girls basketball) |
| Order tracking | `/shop/order/<id>` (the "not found" state; real orders sit behind a private per-buyer link, so the order view itself was fixed by code review) |
| Adidas live catalog | `/adidas` (`/livelook`) |
| Coach portal | `/?portal=<tag>`: dashboard, Orders (and order detail), Art Locker (and artwork viewer), Billing (and invoice detail), scanned on two real coach accounts |
| Accessibility Statement | `/accessibility` |

**Method:**
1. **axe-core** (Deque's scanner, the industry standard), testing every WCAG 2.0/2.1/2.2 A and
   AA rule it covers. Round 1 ran against the live site; round 2 ran against a local build of
   this branch loaded with live data.
2. Scripted **keyboard tests**: first Tab lands on the skip link and Enter jumps to the content;
   Enter on an order row / invoice / artwork opens it; Escape closes the artwork viewer and focus
   starts on its Close button.
3. **Reflow check**: shrink to 320px wide and confirm nothing scrolls sideways (WCAG 1.4.10).
4. **Code review** for patterns scanners miss: click-only `<div>`s, removed focus outlines,
   unlabeled inputs, and text drawn in a school's own colors.

Automated tools catch roughly a third to a half of real accessibility problems. The rest need
a person using a screen reader (NVDA/JAWS on Windows, VoiceOver on Mac/iPhone). See "Still to do".

## Results

### Before (live site, 2026-09-25)

| Page | axe failures | Keyboard / other |
|---|---|---|
| Team Shop home | 9 low-contrast text, 4 too-small tap targets | Good focus rings |
| Team Shop catalog / decoration / FAQ / start order | 5 / 8 / 1 / 2 low-contrast | Start order scrolls sideways at 320px |
| Team Stores directory | 1 low-contrast | Search box unlabeled; focus not visible |
| **Team store** | 1–5 low-contrast (school colors) | **Product cards unreachable by keyboard (Level A)**; no `<h1>`; generic tab title |
| Order tracking | 2 low-contrast | Generic tab title |
| Adidas catalog | **76** low-contrast | Inputs labeled by placeholder only |
| **Coach portal** | (not reachable by the scanner in round 1) | **~37 click-only elements: orders, invoices, estimates, artwork couldn't be opened by keyboard (Level A)** |

### After (round 2, 2026-09-26)

| Page | axe failures | Keyboard / titles / reflow |
|---|---|---|
| Team Shop home | 0 real (see note) | Skip link works; per-page tab titles; no sideways scroll |
| Team Shop start order / cart | 0 | Skip link works; no sideways scroll at 320px (was broken) |
| Team Stores directory | 0 | Search labeled, focus ring, main landmark |
| Team stores (3 real stores) | 0 | Skip link; product cards open with Enter; `<h1>` = store name; tab title = store name |
| Order tracking | 0 | Tab title "Order Status"; email is a real link |
| Adidas catalog | 0 (was 76) | Skip link; every field labeled |
| Coach portal: dashboard, Orders, Art Locker, Billing, plus order/invoice detail and artwork viewer | 0 | Skip link; tab title; rows open with Enter; viewer closes with Escape; no sideways scroll at 320px |
| Accessibility Statement | 0 | Skip link, headings, contact info |

*Note:* on the Team Shop home and decoration pages, axe still reports the big faded
"01 / 02 / 03" step numbers. They're decorative and hidden from screen readers
(`aria-hidden`), and WCAG 1.4.3 exempts pure decoration, so they're left as designed.

## What was fixed

### Round 1 (2026-09-25)

| Fix | WCAG | Files |
|---|---|---|
| Team store product/package cards, bundle banner and store-name link became real keyboard controls with a visible focus ring | 2.1.1, 2.4.7, 4.1.2 | `src/storefront/Storefront.js` |
| Team store + directory search boxes labeled | 1.3.1, 4.1.2 | `Storefront.js`, `TeamStores.js` |
| Team store and order tracking tab titles | 2.4.2 | `Storefront.js`, `OrderTrack.js` |
| Team Shop faint gray `#8790A5 → #666E85`, red eyebrow text on navy `#D94A52 → #E4737A` | 1.4.3 | `src/teamshop/theme.js` |
| Carousel dots get a 24×24px tap area | 2.5.8 | `src/teamshop/Home.js` |
| Directory, order tracking and Adidas catalog gray text fixed | 1.4.3 | `TeamStores.js`, `OrderTrack.js`, `AdidasInventory.js` |

### Round 2 (2026-09-26)

| Fix | WCAG | Files |
|---|---|---|
| **Coach portal keyboard access**: order/estimate/invoice rows, art tiles, proof thumbnails, image previews, the back link and logo all open with Enter/Space and show a focus ring. Proof tiles put the keyboard target on the thumbnail so it doesn't wrap the Approve / Request-changes buttons. | 2.1.1, 2.4.7, 4.1.2 | `src/CoachPortal.js` |
| **Coach portal viewers** (image lightbox, Art Locker) are dialogs: Escape closes them, focus starts on a Close button that's announced as "Close" (was "×"). | 2.1.1, 2.4.3, 4.1.2 | `src/CoachPortal.js` |
| **School colors are contrast-checked automatically.** New `readable()` / `legibleOn()` helpers keep the designed color when it passes and only switch (white ↔ dark text, or nudge the accent) when it doesn't. Applied to the team store cart button, ribbon, badges, top strip and footer; the order-tracking summary card, step circles and buttons; the coach portal's accent text, accent buttons and "Order with this design". | 1.4.3 | `src/lib/a11y.js`, `Storefront.js`, `OrderTrack.js`, `CoachPortal.js` |
| Coach portal gray text (`#94A0B0`/`#94a3b8`/`#64748b`) darkened to `#5A6075`; invoice "Pay" button green darkened to `#15803D` (white text 5.0:1). | 1.4.3 | `src/CoachPortal.js` |
| **Skip to main content** link on the Team Shop, team stores, Adidas catalog and coach portal; `main` landmark on every page. | 2.4.1, 1.3.1 | `src/lib/a11y.js` (`SkipLink`), `TeamShopApp.js`, `Storefront.js`, `AdidasInventory.js`, `CoachPortal.js`, `TeamStores.js`, `OrderTrack.js` |
| Team store `<h1>` = store name (screen-reader-only; the visible team name is decorative) | 1.3.1, 2.4.6 | `Storefront.js` |
| Tab titles: Team Shop updates on every in-app page change (cart, checkout, product name, etc.); coach portal shows "<Team> · Coach Portal" | 2.4.2 | `TeamShopApp.js`, `CoachPortal.js` |
| **40 form fields labeled** that relied on placeholder text (search boxes, roster entry, jersey number/name, contact forms, messages, date pickers). | 1.3.1, 3.3.2, 4.1.2 | `AdidasInventory.js`, `Storefront.js`, `OrderTrack.js`, `CoachPortal.js`, `ChatWidget.js`, `CoachGate.js` |
| `autocomplete` on name/email/phone/address fields (Team Shop checkout, Adidas coach form, coach portal contact form) | 1.3.5 | `CheckoutPage.js`, `AdidasInventory.js`, `CoachPortal.js` |
| "Added to cart", catalog toasts and roster notices are announced (`role="status"`) | 4.1.3 | `Storefront.js`, `AdidasInventory.js`, `CoachPortal.js` |
| Team Shop start-order page no longer scrolls sideways at 320px; coach portal header name truncates instead of overflowing | 1.4.10 | `StartWithLogo.js`, `CoachPortal.js` |
| Removed a duplicate, hidden "Open chat" button on the Team Shop home. It sat under the real chat launcher on desktop (an invisible Tab stop) and covered the tab bar's Account tab on phones. | 2.4.3, 2.5.8 | `src/teamshop/Home.js` |
| Team store focus ring uses the always-dark team color so it shows on pale school colors | 1.4.11, 2.4.7 | `Storefront.js` |
| **Accessibility Statement** at `/accessibility`, linked from every public footer | (best practice) | `public/accessibility.html`, `public/_redirects`, footers |

## Still to do before signing a VPAT

1. **Manual screen-reader pass.** Using NVDA (free, Windows) or VoiceOver (Mac/iPhone), walk:
   find a store → open a product → pick a size → add to cart → checkout → order tracking; and
   in the coach portal: open an order → approve artwork → open an invoice. Note anything that
   isn't announced clearly. (Stripe's payment fields are Stripe's responsibility; they publish
   their own VPAT.)
2. **200% zoom check** (1.4.4) and **text-spacing check** (1.4.12) on the same pages.
3. **Use of color review** (1.4.1): confirm color swatches and status chips always have a text
   label too.
4. **Error messages** (3.3.1, 3.3.3): submit checkout and the coach forms with mistakes and
   confirm the errors are clear and announced.
5. **Text-field borders (1.4.11).** Darken input/select borders from the light grays (`#EEF1F6`, `#E2E8F0`) to at least `#8C93A3` (3:1) across the public pages. Automated scanners don't test this rule, so it was found by review.
6. **Guardrail (recommended):** add the axe scan to the Playwright e2e suite so new pages don't
   regress. `@axe-core/playwright` drops into `e2e/` in a few lines.
7. **Uniform builder:** when it launches, review it separately. A visual designer is typically
   declared "Partially Supports" with an alternative ("call or email your rep to design your
   uniform").

## Draft ACR — WCAG 2.1 Level A & AA

**DRAFT — do not send to a school until the manual checks above are done.** Status reflects
the site *after* round 2. Conformance terms are the official VPAT ones: *Supports*,
*Partially Supports*, *Does Not Support*, *Not Applicable*, plus *Not yet evaluated* where a
manual test is still owed (must be resolved before sending).
Evaluation methods: automated (axe-core 4.x), scripted keyboard testing, code review. Manual
assistive-technology testing: **not yet performed.**

### Level A

| Criterion | Status | Remarks |
|---|---|---|
| 1.1.1 Non-text Content | Supports | Product images carry the product name; decorative images use empty `alt`; image buttons have labels. |
| 1.2.1–1.2.3 Audio/Video | Not Applicable | No audio or video content. (If product videos are added, captions are required.) |
| 1.3.1 Info and Relationships | Supports | Headings, `main` landmarks, labeled form fields and list/table structure on all in-scope pages. |
| 1.3.2 Meaningful Sequence | Supports | DOM order matches visual order. |
| 1.3.3 Sensory Characteristics | Supports | Instructions don't rely on shape/position alone. |
| 1.4.1 Use of Color | Not yet evaluated | Stock badges use text ("In stock", "Low stock"); swatches and chips need manual review. |
| 1.4.2 Audio Control | Not Applicable | No auto-playing audio. |
| 2.1.1 Keyboard | Supports | All interactive elements on the Team Shop, team stores, directory, order tracking, Adidas catalog and coach portal are keyboard-operable (code review of every click handler, plus scripted keyboard tests of the main flows). |
| 2.1.2 No Keyboard Trap | Supports | Dialogs close with Escape; no traps found. |
| 2.1.4 Character Key Shortcuts | Not Applicable | No single-key shortcuts on public pages. |
| 2.2.1 Timing Adjustable | Supports | No session time limits found on public pages (code review). |
| 2.2.2 Pause, Stop, Hide | Supports | Team Shop hero carousel pauses on hover/focus and is disabled under reduced-motion. |
| 2.3.1 Three Flashes | Supports | No flashing content. |
| 2.4.1 Bypass Blocks | Supports | "Skip to main content" link on every page with repeated navigation. |
| 2.4.2 Page Titled | Supports | Every page and in-app view sets a descriptive title. |
| 2.4.3 Focus Order | Supports | Tab order follows reading order; dialogs move focus to their Close button. |
| 2.4.4 Link Purpose | Supports | Link/card text describes the destination. |
| 2.5.1 Pointer Gestures | Supports | No path-based or multipoint gestures required on in-scope pages. |
| 2.5.2 Pointer Cancellation | Supports | Actions fire on click (up-event). |
| 2.5.3 Label in Name | Supports | Visible labels match accessible names. |
| 2.5.4 Motion Actuation | Not Applicable | No motion-triggered features. |
| 3.1.1 Language of Page | Supports | `<html lang="en">`. |
| 3.2.1 On Focus / 3.2.2 On Input | Supports | No unexpected context changes found. |
| 3.3.1 Error Identification | Not yet evaluated | Needs a manual screen-reader check that checkout errors are announced. |
| 3.3.2 Labels or Instructions | Supports | Every form field has a label (40 added in round 2). |
| 4.1.1 Parsing | Supports | (Obsolete in WCAG 2.2; React produces well-formed markup.) |
| 4.1.2 Name, Role, Value | Supports | Custom controls expose role and name; toggles expose pressed state. |

### Level AA

| Criterion | Status | Remarks |
|---|---|---|
| 1.2.4–1.2.5 Captions (Live) / Audio Description | Not Applicable | No video. |
| 1.3.4 Orientation | Supports | No orientation lock; pages reflow at phone width. |
| 1.3.5 Identify Input Purpose | Supports | Name/email/phone/address fields carry `autocomplete`. Team store checkout address uses Stripe's address form. |
| 1.4.3 Contrast (Minimum) | Supports | 0 automated failures on all in-scope pages. Text in school colors is contrast-checked automatically. Decorative, `aria-hidden` step numbers exempt. |
| 1.4.4 Resize Text | Not yet evaluated | Needs a manual 200% zoom check. |
| 1.4.5 Images of Text | Supports | Text is real text; logos exempt. |
| 1.4.10 Reflow | Supports | No sideways scrolling at 320px on any in-scope page. |
| 1.4.11 Non-text Contrast | Partially Supports | Focus rings use dark team/navy colors. Many text-field borders are very light gray (about 1.2:1 on white); WCAG asks for 3:1 so people with low vision can find the box. See "Still to do" #5. |
| 1.4.12 Text Spacing | Not yet evaluated | Needs a manual check with a text-spacing bookmarklet. |
| 1.4.13 Content on Hover or Focus | Supports | No hover-only tooltips carrying essential info. |
| 2.4.5 Multiple Ways | Supports | Navigation, category filters, and search. |
| 2.4.6 Headings and Labels | Supports | Every page has a descriptive top-level heading; labels describe their fields. |
| 2.4.7 Focus Visible | Supports | Visible focus ring on all interactive elements. |
| 3.1.2 Language of Parts | Not Applicable | Single language. |
| 3.2.3 Consistent Navigation / 3.2.4 Consistent Identification | Supports | Shared header/footer component per surface. |
| 3.3.3 Error Suggestion / 3.3.4 Error Prevention (Legal, Financial) | Not yet evaluated | Checkout has a cart review step before payment; error wording needs a manual review. |
| 4.1.3 Status Messages | Supports | Cart confirmations, toasts and roster notices use `role="status"`. |

## Next steps (business side)

- **Do the manual checks** in "Still to do" (1–4) and the border fix (#5). A few hours for someone careful plus one small PR.
- **Fill the official form.** Download the current **VPAT® 2.5 "WCAG" edition** from the
  Information Technology Industry Council (itic.org). The table above maps directly into it.
  Product name "National Sports Apparel Team Shop, Team Stores & Coach Portal", version = the
  deploy date.
- **Optional but persuasive for larger districts/universities:** have a third-party firm
  (e.g. Level Access, Deque, TPGi, or a smaller WCAG consultant) review or co-sign the ACR.
  Some university procurement offices only accept third-party-validated VPATs.
- **Re-issue yearly** or after a major redesign, and update the "Last reviewed" date on
  `public/accessibility.html`.
- **Legal context to confirm with your attorney:** the DOJ's April 2024 ADA Title II rule
  requires public schools and colleges to meet WCAG 2.1 AA on the web content they provide,
  **including content provided through vendors**, with compliance dates in 2026–2027 depending
  on the entity's size. That's why these requests are showing up. Check current dates and any
  DOJ updates before quoting them to a customer.
