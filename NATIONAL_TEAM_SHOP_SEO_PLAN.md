# National Team Shop — SEO Upgrade Plan

_Date: 2026-07-12 · Scope: the customer-facing team-store storefronts ("National
Team Shop · A National Sports Apparel company") at `/shop/<slug>` and the
`/team-stores` directory that feeds them._

---

## TL;DR

The marketing site (`nsa-website`) has genuinely good SEO. The **stores
themselves have almost none** — and the store pages are where the buying intent
and the long-tail traffic ("<school name> team store", "<club> spirit wear")
actually lives.

The root cause is one architectural decision: every public store URL
(`nationalsportsapparel.com/shop/<slug>`) serves a static shell whose only real
content is a **cross-origin `<iframe>`** into a **client-rendered React SPA** on
`nsa-portal.netlify.app`. Search engines do not credit iframed, cross-origin,
JS-only content to the parent URL. So to a crawler, every store page looks like
the same near-empty shell with a generic title and no product content, no
canonical, no structured data, and no entry in the sitemap.

**The single highest-leverage fix:** render a real, crawlable HTML store page at
the canonical URL (server-side, at the Netlify edge) and drop the iframe. React
then hydrates the interactive store over it. Everything else in this plan is
either a prerequisite for that or a multiplier on top of it.

---

## What's already good (don't touch)

- **Marketing pages are well-optimized.** `nsa-website/public/index.html` ships
  valid `Organization` + `LocalBusiness` JSON-LD; sport and hub pages have clean
  titles, descriptions, canonicals, OG/Twitter tags, and `robots`
  `max-image-preview:large`. `robots.txt`, `sitemap.xml`, and a hand-written
  `llms.txt` all exist.
- **Rich link previews for stores partially exist.** `nsa-portal/netlify/
  edge-functions/og-storefront.js` already fetches per-store data at the edge
  (from the anon `webstores_public` view) and rewrites `<title>` + OG/Twitter
  tags with the store's name, blurb, and Cloudinary-reshaped banner. This is the
  exact pattern we extend for full SEO — the hard part (edge data fetch) is done.
- **The content exists in the database.** Stores carry `name`, `hero_blurb`,
  `logo_url`, `banner_url`, brand colors, `open_at`/`close_at`, `public_listed`,
  `require_login`, `status`. Products carry name, category, color, sizes, images,
  price, and cleaned marketing copy (`description` / AI-cleaned `description_ai`,
  exposed on the `webstore_storefront_products` view). We have plenty to render
  and mark up — it's just never reaching the HTML.

---

## Current-state findings (the gaps)

Ranked by SEO impact. Each is grounded in a specific file.

### 1. Cross-origin iframe makes store content unindexable — **critical**
`nsa-website/netlify.toml` rewrites `/shop/*` → `shop.html` (200). `shop.html`'s
`<main>` is a single `<iframe>` pointing at
`https://nsa-portal.netlify.app/shop/<slug>?embed=1`. Iframed content — and
especially cross-origin iframed content — is **not attributed to the parent
page** for indexing or ranking. The canonical public store URL therefore has
effectively zero unique indexable body content.

### 2. Storefront is client-only rendered — **critical**
`nsa-portal` is Create React App (`react-scripts`/`craco`); `public/index.html`
is an empty `<div id="root">`. `src/storefront/Storefront.js` (2,254 lines) fetches
store + products client-side from Supabase and renders in the browser. A grep of
that file for `document.title`, `canonical`, `application/ld+json`, or any `<meta>`
handling returns **nothing** — the SPA sets no title, description, canonical, or
structured data. Even the portal-origin URL ships an empty shell to a crawler
that doesn't run JS (Bing, DuckDuckGo, most social/AI crawlers) and is
render-budget-gated for the ones that do (Google's second wave).

### 3. Every store shares one generic `<title>` and description — **high**
`shop.html` hardcodes `<title>Team Store | National Sports Apparel</title>` and
one generic `<meta name="description">` for **all** stores. Inline JS rewrites
only the title, and only from the URL slug (e.g. "La Verne Lazers"), not the real
store name — and JS-set titles are unreliable for indexing. Description, OG, and
Twitter tags stay generic for every store.

### 4. No canonical + two live origins = duplicate content — **high**
Each store is reachable at both `nationalsportsapparel.com/shop/<slug>` **and**
`nsa-portal.netlify.app/shop/<slug>`. Neither declares a canonical (`shop.html`
has no `<link rel="canonical">` at all). Google can index the raw `netlify.app`
subdomain, splitting link signals and surfacing an off-brand URL.

### 5. Store link-previews likely don't fire on the canonical URL — **high**
`og-storefront.js` is configured `path: '/shop/*'` on the **portal** Netlify
site. But the public/shared URL is `nationalsportsapparel.com/shop/<slug>`, which
the **marketing** site serves as static `shop.html` (generic OG). So the
store-specific preview only appears if someone shares the raw `netlify.app` URL —
not the branded one people actually share. _(Confirm live; the two `netlify.toml`
files disagree about how `/shop/*` is served — see finding 9.)_

### 6. The `/team-stores` directory hides its own store links — **high**
`nsa-website/public/team-stores.html` also iframes the portal
(`nsa-portal.netlify.app/team-stores?embed=1`). The one page whose job is to link
to every open store — and pass internal link equity to them — locks those links
inside a cross-origin iframe. Crawlers on the indexable marketing domain have
**no crawlable internal link** to any individual store.

### 7. Zero store URLs in the sitemap — **high**
`sitemap.xml` lists only the ~28 static marketing pages. Not a single
`/shop/<slug>` appears, and there's no dynamic sitemap generated from
`webstores_public`. Combined with finding 6, search engines have no discovery
path to store pages at all.

### 8. No structured data for stores or products — **medium/high**
No `Store`, `Product`, `Offer`, `BreadcrumbList`, or `ItemList` JSON-LD anywhere
in the storefront. No eligibility for product rich results (price, availability,
image), breadcrumbs, or sitelinks search box.

### 9. The two sites disagree on how `/shop/*` is served — **medium (risk)**
`nsa-website/netlify.toml` serves `/shop/*` as an **iframe** in `shop.html`.
`nsa-portal/netlify.toml`'s comment describes `/shop/*` as a **200-proxy that
serves the portal's `index.html` at nationalsportsapparel.com** — a different
design. This drift means at least one comment is stale and the live behavior may
not match either. Reconcile before building on top of it.

### 10. Store lifecycle produces thin / soft-404 pages — **medium**
Stores open and close (`close_at`) and can be private (`public_listed=false`) or
login-gated (`require_login`). Today nothing distinguishes these to crawlers: a
closed or private store can return a live 200 with a "store closed" screen —
classic thin/soft-404 content that drags down site quality signals.

---

## Recommended architecture

**Render the store at the canonical URL, at the edge, and delete the iframe.**

Extend the existing `og-storefront.js` edge pattern from "rewrite the `<head>`
tags" to "**render a crawlable store page**": inject the full SEO `<head>` (title,
meta description, canonical, robots, OG/Twitter, JSON-LD) **and** a
server-rendered, above-the-fold HTML snapshot (store name/`<h1>`, hero blurb,
category list, and a product grid of name + image + price + link) into the served
HTML. The same edge function runs for **every** visitor — no bot-only branch — so
React hydrates over identical markup and there is **no cloaking risk**. The data
fetch this needs already exists in `og-storefront.js`; we're adding a body
template and a products query against `webstore_storefront_products`.

This requires the store to be served from **one origin** with edge rendering. The
cleanest move is to make the marketing site's `/shop/*` a **200-proxy of the
portal's `index.html`** (the design the portal's own `netlify.toml` already
anticipates, and why `PUBLIC_URL` pins assets to `nsa-portal.netlify.app`) and
run the SEO edge function there — instead of the current static-`shop.html`
iframe. That keeps the branded URL, kills the iframe, and lets one edge function
own store SEO.

**Alternatives considered**
- **Bot-detection prerendering** (serve headless-Chromium snapshots only to
  crawler user-agents). The deps are already present (`@sparticuz/chromium`,
  `puppeteer`). Lower code change, but ongoing latency/cost, and serving crawlers
  different HTML than users risks cloaking penalties. Use only as a stopgap.
- **Framework migration to Next.js SSR.** The correct long-term end state, but a
  large rewrite of a 2,254-line storefront. Not justified by SEO alone right now.

Recommendation: **edge-rendered store pages** — biggest SEO gain for the least
disruption, and it reuses infrastructure that already exists.

---

## The upgrades list

Grouped into phases. Effort: S (hours), M (a day or two), L (a week+).
Impact: ★★★ = moves rankings/indexation materially, ★ = polish.

### Phase 0 — Quick wins (ship this week, no re-architecture)
These don't depend on killing the iframe and are individually safe.

- [ ] **Per-store canonical + robots on the store shell** — ★★★ · S
  In the edge layer (or, interim, `shop.html`) emit
  `<link rel="canonical" href="https://nationalsportsapparel.com/shop/<slug>">`
  and `noindex` for stores that are closed, `public_listed=false`, `require_login`,
  or `status=archived`. Fixes findings 4 + 10.
- [ ] **De-dupe the `netlify.app` origin** — ★★★ · S
  Add `X-Robots-Tag: noindex` (or a canonical to the branded URL) on
  `nsa-portal.netlify.app/shop/*` so Google consolidates on the branded domain.
- [ ] **Dynamic store sitemap** — ★★★ · M
  A Netlify function that queries `webstores_public` for `status='open'` +
  `public_listed=true` (+ open window) and emits `sitemap-stores.xml` with
  `<lastmod>`. Reference it from `robots.txt` and add a sitemap **index**.
  Fixes finding 7.
- [ ] **Make the store-specific OG fire on the branded URL** — ★★ · S
  Ensure `og-storefront.js` (or its successor) runs for
  `nationalsportsapparel.com/shop/*`, not only the portal origin. Fixes finding 5.
- [ ] **Reconcile the `/shop/*` serving path** — ★★ · S
  Resolve the iframe-vs-200-proxy contradiction (finding 9) and update the stale
  `netlify.toml` comment. This is the prerequisite decision for Phase 1.

### Phase 1 — Crawlable store pages (the core fix)
- [ ] **Edge-render the store `<head>` per store** — ★★★ · M
  Real `<title>` (`<Store Name> Team Store | National Sports Apparel`), unique
  `<meta name="description">` from `hero_blurb`/store copy, canonical, OG/Twitter.
  Fixes finding 3.
- [ ] **Edge-render above-the-fold store body** — ★★★ · L
  Server-render `<h1>` store name, hero blurb, category nav, and a product grid
  (name, image w/ descriptive `alt`, price, link to `/shop/<slug>/p/<id>`) so the
  page has real indexable content and crawlable internal links. React hydrates
  over it. Fixes findings 1 + 2.
- [ ] **Kill the iframe; serve one origin** — ★★★ · M
  Replace the `shop.html` iframe with the 200-proxy + edge render. Fixes finding 1.
- [ ] **Un-iframe the `/team-stores` directory** — ★★★ · M
  Server-render (or statically build) the open-store directory as real HTML with
  crawlable `<a href="/shop/<slug>">` links, so link equity flows to stores.
  Fixes finding 6.

### Phase 2 — Structured data & rich results
- [ ] **`Store` / `LocalBusiness` JSON-LD per store** — ★★ · S
  Name, logo, URL, parent-brand link, `sameAs`.
- [ ] **`BreadcrumbList` JSON-LD** — ★★ · S
  Home → Team Stores → `<Store>` (→ Product). Enables breadcrumb rich results.
- [ ] **`Product` + `Offer` JSON-LD on product detail pages** — ★★★ · M
  Name, image, `description` (`description_ai`), price/currency, availability from
  size stock. Gate on real, in-stock inventory to stay within Google's product
  policy. Fixes the product-snippet half of finding 8.
- [ ] **`ItemList` on the store landing** — ★ · S
  Ordered product list for the store page.

### Phase 3 — Content depth & per-store authority
- [ ] **Server-render product detail pages** (`/shop/<slug>/p/<id>`) — ★★★ · L
  Full description (`description_ai`), specs, images, price. These are the
  long-tail-keyword pages ("<school> <sport> jersey").
- [ ] **Descriptive, keyword-aware `alt` text** for all product/store imagery — ★★ · M
  Generate from `name` + `color` + team, not filenames.
- [ ] **Unique intro copy per store landing** — ★★ · M
  Use `hero_blurb`; where empty, template from team + sport + season so no store
  is thin. Consider extending the existing AI-copy pipeline
  (`ai-clean-description`) to store blurbs.
- [ ] **Internal linking** — ★ · S
  Store → parent sport hub and back; related stores by school/club.

### Phase 4 — Lifecycle, performance & measurement
- [ ] **Store lifecycle SEO rules** — ★★ · M
  Open+listed → indexable + in sitemap. Closed → `noindex` (or evergreen
  "opening again" landing rather than a dead 200). Private/login-gated → `noindex`
  + excluded from sitemap. Formalizes finding 10.
- [ ] **Core Web Vitals on store pages** — ★★ · M
  With edge-rendered above-the-fold HTML, target good LCP; preconnect the
  Cloudinary/Supabase origins, lazy-load below-the-fold, right-size hero images
  (the OG function's Cloudinary transform pattern generalizes).
- [ ] **Google Search Console + Bing Webmaster** — ★★ · S
  Verify the branded domain, submit both sitemaps, watch Coverage/Indexing and
  the "Crawled – currently not indexed" bucket to confirm the fix landed.
- [ ] **Analytics for organic store traffic** — ★ · S
  GA4 (`G-CVT4XWNNKL` is already on the shells) segment for `/shop/*` organic
  entrances, so we can measure lift against this baseline.

---

## Per-store `<head>` spec (reference for Phase 1)

```html
<title>La Verne Lazers Team Store | National Sports Apparel</title>
<meta name="description" content="<hero_blurb, ~150 chars, or templated
  'Official La Verne Lazers team store — custom jerseys, spirit wear, and gear,
  decorated and delivered. Order before the store closes.'>">
<link rel="canonical" href="https://nationalsportsapparel.com/shop/la-verne-lazers">
<meta name="robots" content="index,follow,max-image-preview:large">  <!-- or noindex if closed/private -->
<meta property="og:type" content="website">
<meta property="og:title" content="La Verne Lazers Team Store">
<meta property="og:description" content="…">
<meta property="og:image" content="<Cloudinary 1200×630 banner>">
<meta property="og:url" content="https://nationalsportsapparel.com/shop/la-verne-lazers">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ "@context":"https://schema.org",
  "@type":"Store", "name":"La Verne Lazers Team Store",
  "url":"https://nationalsportsapparel.com/shop/la-verne-lazers",
  "parentOrganization":{"@type":"Organization","name":"National Sports Apparel"} }
</script>
```

---

## Guardrails

- **No cloaking.** Serve identical HTML to bots and users; hydrate, don't swap.
- **Only advertise `Product` structured data for real, in-stock, priced items** —
  invalid/aspirational markup earns manual actions.
- **Respect the anon RLS boundary.** Everything renderable is already exposed
  through `webstores_public` / `webstore_storefront_products`; do not widen anon
  read access to satisfy SEO — render only what those views already expose.
- **`noindex` private/closed/login-gated stores** and keep them out of the
  sitemap, so store lifecycle never pollutes site-quality signals.

---

## Suggested sequencing

1. **Decide the serving architecture** (Phase 0: reconcile `/shop/*`; commit to
   edge-render + 200-proxy over the iframe).
2. **Ship the cheap, safe wins** (canonical, `netlify.app` de-dupe, dynamic
   sitemap, OG-on-branded-URL).
3. **Build edge-rendered store `<head>` + body and un-iframe the directory**
   (Phase 1) — this is where indexation actually turns on.
4. **Layer structured data, then product-page SSR and content depth**
   (Phases 2–3).
5. **Formalize lifecycle rules, CWV, and measurement** (Phase 4) and read the
   result in Search Console.

The pivotal decision is #1/#3: **stop iframing the storefront and render it at
the canonical URL.** Until that happens, the rest is polish on a page Google
can't read.
