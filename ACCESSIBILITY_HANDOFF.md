# Handoff: Accessibility (VPAT) work

**Context:** Schools and colleges are asking National Sports Apparel for a VPAT, which reports
how well a site meets WCAG 2.1 AA. Two rounds of fixes landed in
[PR #2393](https://github.com/NationalSports/nsa-portal/pull/2393). Read
`ACCESSIBILITY_VPAT_2026-09-25.md` first. It has before/after scan results, everything fixed,
what's left, and the draft WCAG 2.1 A/AA conformance table.

**Scope:** only the pages schools, coaches and parents use:

- Team Shop (`/teamshop`, nationalteamshop.com)
- Team stores (`/shop/<slug>`)
- Team Stores directory (`/team-stores`)
- Order tracking (`/shop/order/<id>`)
- Adidas catalog (`/adidas`)
- Coach portal (`/?portal=<alpha_tag>`)
- Accessibility Statement (`/accessibility`)

The staff portal is out of scope. The uniform builder isn't offered to customers yet, so it's
out of scope until it launches.

## Where things stand

- **Automated scan:** 0 axe WCAG 2.1 AA failures on every in-scope page, checked against a
  local build with live data.
- **Keyboard:** everything is keyboard-operable. Scripted tests confirm:
  - The skip link works.
  - Team store product cards open with Enter.
  - Coach portal order rows and invoices open with Enter.
  - The Art Locker viewer opens with Enter, focuses its Close button, and closes with Escape.
- **Reflow:** no sideways scrolling at 320px.
- **Tests:** full Jest suite passes (443 suites).
- **Owed before sending a VPAT (manual):**
  - Screen-reader walkthrough
  - 200% zoom check
  - Text-spacing check
  - Color-only review
  - Error-message review
- **One known code issue left:** text-field borders are very light gray (about 1.2:1). WCAG
  1.4.11 wants 3:1. It was logged, not fixed, because it changes the look of every form.

## Shared helpers: `src/lib/a11y.js`

Use these instead of writing new copies.

- **`kbActivate(fn, role = 'link')`** makes a clickable `<div>` a keyboard control. Spread it
  onto the element: `<div {...kbActivate(fn)}>`. Use `'button'` for in-page actions. Don't put
  it on an element that contains other buttons; put it on an inner non-interactive part (see
  the proof tiles in `CoachPortal.js`). Each surface's CSS adds
  `[data-kb-activate]:focus-visible` for the focus ring.
- **`SkipLink` + `MAIN_ID`** render `<SkipLink />` first in the page and put
  `id={MAIN_ID}` on the `<main>`. It focuses the target in JavaScript, so the pushState
  routers never see a `#hash`.
- **`readable(bg, preferred)`** returns `preferred` if it has 4.5:1 contrast on `bg`,
  otherwise white or near-black.
- **`legibleOn(fg, bg)`** nudges a brand color (usually the school accent) toward white or
  black just enough to reach 4.5:1 on `bg`.
- **`contrastRatio(a, b)`** is the WCAG contrast ratio.

**Rule of thumb for school colors:** never draw text in, or on, `theme.accent` /
`theme.primary` / `tAccent` / `cpTheme.*` directly. Wrap it:

- In the storefront, use `readable(theme.accent, '#fff')` or `theme.accentOnDark`.
- In the coach portal, use `tAccentText` or `readable(tAccent, '#fff')`.

## Where the changes are

| Area | Files |
|---|---|
| Team stores | `src/storefront/Storefront.js`: `kbActivate` on cards/banner/header link, `SkipLink`, screen-reader `<h1>` in `VsHero`, `accentOnDark` theme token, `readable()` on accent buttons/badges, tab title, labels, `role="status"` on "Added to cart", Accessibility link in footers |
| Team Shop | `src/teamshop/theme.js` (`TEXT_FAINT`, `RED_SOFT`), `Home.js` (dot tap targets; removed a duplicate hidden "Open chat" button), `TeamShopApp.js` (`SkipLink`, per-route `document.title`, footer link), `StartWithLogo.js` (320px overflow), `CheckoutPage.js` (autocomplete), `ChatWidget.js`, `CoachGate.js` (labels) |
| Coach portal | `src/CoachPortal.js`: `kbActivate` on ~20 row/tile/thumbnail elements, dialog semantics + Escape + focused "Close" on viewers, `tAccentText`, `readable()` on accent fills, gray text → `#5A6075`, Pay button → `#15803D`, `SkipLink` + main, tab title, 19 labels, autocomplete, header name truncates at 320px, footer link |
| Order tracking | `src/storefront/OrderTrack.js`: `readable()` on summary card, step circles and buttons; darker grays; `role="main"`; tab title; email as a link |
| Adidas catalog | `src/storefront/AdidasInventory.js`: grays (light vs dark backgrounds), `SkipLink`, 12 labels, autocomplete, `role="status"` toast, footer link |
| Directory | `src/storefront/TeamStores.js`: label, focus ring, `role="main"` |
| Statement | `public/accessibility.html`, `/accessibility` in `public/_redirects` |

## Tooling notes for the cloud sandbox

- Chromium doesn't trust the egress proxy's certificate. Route traffic through Node with
  `context.route('**/*', async r => r.fulfill({ response: await r.fetch() }))` and run with
  `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Never disable TLS checks.
- nationalteamshop.com is behind an "Opening soon" gate, so scan `/teamshop/*` instead.
- To test a local build with real data:
  - Build with `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` set to the public
    anon key (Supabase `get_publishable_keys`).
  - Serve `build/` with SPA fallback.
  - Forward `/.netlify/*` to `https://nsa-portal.netlify.app`.
- The coach portal loads all customers first. Wait for `.nsa-nav` (up to about 60s) before
  scanning.
- Test data:
  - Stores with products: `olu-creative-worship-team-store`, `sjmbasketball2026`.
  - Coach tags: `OLuOCW` (no orders) and `FPUTR` (orders, art, invoices).
- A first-Tab test must not click the page first. Clicking sets the browser's Tab starting
  point past the skip link.

## Repo rules (from CLAUDE.md)

- Push to the designated branch, then open a PR to `main`, subscribe to its activity, and
  never merge without the user's approval.
- Any change to `OrderEditor.js` must also be made in `OrderEditorClassic.js`. Neither was
  touched here.
