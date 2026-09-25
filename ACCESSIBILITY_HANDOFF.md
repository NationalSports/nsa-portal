# Handoff: Accessibility (VPAT) work

**Context:** Schools and colleges are asking National Sports Apparel for a VPAT, which reports
how well a site meets WCAG 2.1 AA. The first pass on the customer-facing site landed in
[PR #2393](https://github.com/NationalSports/nsa-portal/pull/2393). Read
`ACCESSIBILITY_VPAT_2026-09-25.md` first. It has the before/after scan results, a prioritized
to-do list, and a draft WCAG 2.1 A/AA conformance table.

**Scope:** only the pages schools, coaches and parents use:

- Team Shop (`/teamshop`, nationalteamshop.com)
- Team stores (`/shop/<slug>`)
- Team Stores directory (`/team-stores`)
- Order tracking (`/shop/order/<id>`)
- Adidas catalog (`/adidas`)
- Uniform builder
- Coach portal (`/?portal=<alpha_tag>`)

The staff portal is out of scope.

## Fixes in PR #2393

1. **`src/storefront/Storefront.js`**
   - Added a `kbActivate(fn)` helper (just above `VsCategoryCard`). It returns `role="link"`,
     `tabIndex=0`, `data-kb-activate`, `onClick`, and an `onKeyDown` where Enter or Space
     activates.
   - Applied it to the product cards, package cards, bundle banner, and the store-name home
     link in both headers. These were click-only `<div>`s, so keyboard users couldn't open a
     product (WCAG 2.1.1, Level A).
   - Added a `[data-kb-activate]:focus-visible` focus ring in the style block.
   - Added `aria-label` to both "Search the store" inputs.
   - Added a `useEffect` that sets `document.title` to the store's name.
2. **`src/teamshop/theme.js`**
   - `TEXT_FAINT` changed from `#8790A5` to `#666E85` (now 4.8:1 contrast).
   - `RED_SOFT` changed from `#D94A52` to `#E4737A` (now 4.8:1 on navy).
3. **`src/teamshop/Home.js`:** carousel dots now have a 24×24px tap area (padding plus
   `backgroundClip: content-box`). The painted dot looks the same, and the container's bottom
   offset was adjusted by 7px so the dot stays in place.
4. **`src/storefront/TeamStores.js`:** search input `aria-label`, a focus-visible ring, and
   the hint text darkened to `#5A6075`.
5. **`src/storefront/OrderTrack.js`:** splash text darkened to `#475569`, the `opacity: 0.7`
   removed from the not-found hint, and a `document.title` added.
6. **`src/storefront/AdidasInventory.js`**
   - Gray text on light backgrounds changed to `#5F6675`; this replaced `#6A7180` and
     `#9AA1AC`.
   - Gray text on dark backgrounds (`#191919`/`#2B2F38`: header, footer, sign-in strip,
     account panel header) changed to `#A6ACB8`.
   - The `Grey: '#9AA1AC'` swatch color was deliberately left unchanged.

## Verified

- An axe-core rescan of a local build against live data shows 0 violations on the Team Shop
  catalog, FAQ and start-order pages, the directory, order tracking, the Adidas catalog
  (was 76) and the uniform builder.
- Tab to a team-store product card and press Enter, and the product page opens.
- 39 Jest suites (588 tests) pass, and `lint:undef` shows 0 errors in the changed files.

## Still flagged (by design or pending)

- The large "01/02/03" step numbers on Team Shop home and decoration are decorative and
  `aria-hidden`, so WCAG exempts them.
- The chat button is partly covered by its "Need a hand?" bubble.
- Team-store text drawn in school colors can fail contrast.

## Next work, in priority order

1. **Coach portal keyboard access (`src/CoachPortal.js`).** About 37 click-only `<div>`s
   (order rows, art tiles, proof thumbnails, back links) are the main Level A blocker. Use the
   same `kbActivate` pattern. The portal never finished loading in the headless browser, so
   check it by hand.
2. **Automatic contrast guard for school colors** in the storefront theme builder. When a
   school's colors don't reach 4.5:1, pick black or white text, or shift the accent color.
   This covers the top-strip text, cart button, badges and footer.
3. **Skip-to-content link** on the public pages, plus an `<h1>` on the team store page and
   page titles for the cart, uniform builder and coach portal.
4. **`aria-label`s** for inputs that only have placeholder text (Adidas search and date
   fields, staff login).
5. **Horizontal scroll at 320px** on the Team Shop start-order page.
6. **Accessibility Statement page**, linked from the Team Shop and team-store footers.
7. **axe check in the Playwright e2e suite** (`@axe-core/playwright`) to catch regressions.
8. **Manual screen-reader pass** on the buying path, then fill in the official VPAT 2.5 WCAG
   form from itic.org.

## Tooling notes for the cloud sandbox

- Chromium doesn't trust the egress proxy's certificate. Route traffic through Node with
  `context.route('**/*', async r => r.fulfill({ response: await r.fetch() }))` and run with
  `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Never disable TLS checks.
- nationalteamshop.com is behind an "Opening soon" gate, so scan `/teamshop/*` on
  nsa-portal.netlify.app instead.
- To test a local build with real data:
  - Build with `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` set to the
    project's public anon key (get it from Supabase `get_publishable_keys`).
  - Serve `build/` with SPA fallback.
  - Forward `/.netlify/*` requests to `https://nsa-portal.netlify.app`.
- Cap each page at about 90 seconds, because some pages hang axe.
- Test stores with products: `olu-creative-worship-team-store` and
  `bishop-alemany-basketball-team-store`. A coach portal tag that has a store: `OLuOCW`.

## Repo rules (from CLAUDE.md)

- Push to the designated branch, then open a PR to `main`, subscribe to its activity, and
  never merge without the user's approval.
- Any change to `OrderEditor.js` must also be made in `OrderEditorClassic.js`. That doesn't
  affect this work.
