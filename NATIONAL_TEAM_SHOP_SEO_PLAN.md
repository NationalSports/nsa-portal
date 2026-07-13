# National Team Shop — SEO Upgrade Plan

_Date: 2026-07-12 · Scope: the customer-facing team-store storefronts ("National
Team Shop") served at **nationalteamshop.com** `/shop/<slug>` and the store
directory that feeds them._

---

## Domain model (confirmed)

| URL | Serves | Notes |
|---|---|---|
| **`nationalteamshop.com/shop/<slug>`** | Portal storefront **SPA, directly** (Netlify domain alias → `nsa-portal` site) | **Canonical store domain.** No iframe. Same app + same `/shop/*` paths as the portal (no host-based routing). |
| `nsa-portal.netlify.app/shop/<slug>` | Same SPA, raw Netlify origin | Off-brand duplicate of the canonical. |
| `nationalsportsapparel.com/shop/<slug>` | Static `shop.html` shell that **iframes** the portal | Secondary/marketing entry point. Should redirect to the canonical. |

**Key consequence:** the real customer-facing store surface
(`nationalteamshop.com`) is **not** iframed — it serves the storefront SPA
directly. That's good. But it *is* a **client-rendered SPA with no server
rendering, no `robots.txt`, and no `sitemap.xml`**, so crawlers still get an
empty shell. The iframe problem is confined to the secondary
`nationalsportsapparel.com/shop/*` path, which should simply 301 to the canonical.

The existing OG edge function (`nsa-portal/netlify/edge-functions/
og-storefront.js`, configured `path: '/shop/*'`) runs on the portal Netlify site
— so it **already runs on `nationalteamshop.com/shop/*`**. Per-store `<title>`
and OG/Twitter link previews therefore already work on the canonical domain. It
just doesn't emit a `<meta name="description">`, canonical, `robots`, JSON-LD, or
any crawlable body — which is the gap this plan closes.

---

## TL;DR

The marketing site (`nsa-website`) has genuinely good SEO. The **stores
themselves — nationalteamshop.com — have almost none**, and that's where the
buying-intent, long-tail traffic lives ("<school> team store", "<club> spirit
wear").

Root cause: `nationalteamshop.com` serves a **client-rendered React SPA** with an
empty `<div id="root">`, **no `robots.txt`, and no `sitemap.xml`**. Crawlers that
don't run JS (Bing, DuckDuckGo, most social/AI crawlers) see nothing; Google's
render pass is budget-gated and unreliable behind multiple client-side Supabase
fetches. On top of that, the same store is reachable at three origins with no
canonical, and there's no discovery path (no sitemap, no crawlable directory).

**The single highest-leverage fix:** server-render the store page at the Netlify
edge (extend the OG edge function that already fetches store data) so
`nationalteamshop.com/shop/<slug>` returns real, crawlable HTML — head + product
content — that React hydrates over. Then add `robots.txt` + a dynamic store
sitemap, and consolidate the three origins onto the `nationalteamshop.com`
canonical. Everything else multiplies on top of that.

---

## What's already good (don't touch)

- **Marketing pages are well-optimized.** `nsa-website/public/index.html` ships
  valid `Organization` + `LocalBusiness` JSON-LD; sport/hub pages have clean
  titles, descriptions, canonicals, OG/Twitter, and `robots`
  `max-image-preview:large`. `robots.txt`, `sitemap.xml`, and `llms.txt` exist.
- **Per-store link previews already work on the canonical domain.**
  `og-storefront.js` fetches per-store data at the edge (anon `webstores_public`
  view) and rewrites `<title>` + OG/Twitter with the store's name, blurb, and a
  Cloudinary-reshaped banner — and it runs on `nationalteamshop.com/shop/*`. This
  is the exact pattern we extend for full SEO; the hard part (edge data fetch) is
  done.
- **The content exists in the database.** Stores carry `name`, `hero_blurb`,
  `logo_url`, `banner_url`, brand colors, `open_at`/`close_at`, `public_listed`,
  `require_login`, `status`. Products carry name, category, color, sizes, images,
  price, and AI-cleaned marketing copy (`description` / `description_ai` on the
  `webstore_storefront_products` view). Plenty to render and mark up — it just
  never reaches the HTML.

---

## Current-state findings (the gaps)

Ranked by SEO impact. Each is grounded in a specific file.

### 1. Storefront is client-only rendered — no SSR — **critical**
`nsa-portal` is Create React App (`react-scripts`/`craco`); `public/index.html`
is an empty `<div id="root">`. `src/storefront/Storefront.js` (2,254 lines)
fetches store + products client-side from Supabase and renders in the browser. A
grep of that file for `document.title`, `canonical`, `application/ld+json`, or any
`<meta>` handling returns **nothing**. So `nationalteamshop.com/shop/<slug>` ships
an empty shell to any crawler that doesn't execute JS, and is render-budget-gated
for the ones that do. This is the central issue for the canonical domain.

### 2. No `robots.txt` and no `sitemap.xml` on the store domain — **critical**
`nsa-portal/public/` contains no `robots.txt` and no `sitemap.xml`, and nothing
in `netlify/` generates them. So `nationalteamshop.com` gives crawlers **no crawl
directives and no discovery path** to any store. (Contrast: the marketing site
has both.)

### 3. No per-store canonical / description / robots / structured data in HTML — **high**
The OG edge function emits a per-store `<title>` and `og:`/`twitter:` tags, but
**not** `<meta name="description">`, `<link rel="canonical">`, `<meta name="robots">`,
or any JSON-LD. Search engines get a decent social card but no canonical signal,
no meta description, and no rich-result eligibility.

### 4. Same store lives at three origins, none canonicalized — **high**
A store is reachable at `nationalteamshop.com/shop/<slug>`,
`nsa-portal.netlify.app/shop/<slug>`, and `nationalsportsapparel.com/shop/<slug>`
(iframe shell). None declares a canonical. Google can index the `netlify.app`
subdomain or the marketing shell, splitting signals and surfacing off-brand URLs.

### 5. Marketing `/shop/*` still iframes (secondary path) — **medium**
`nsa-website/netlify.toml` rewrites `/shop/*` → `shop.html`, whose `<main>` is a
cross-origin `<iframe>` into the portal. Cross-origin iframe content isn't
credited to the parent URL — but since `nationalteamshop.com` is now the
canonical surface, the fix here is simply to **301 `nationalsportsapparel.com/
shop/*` → `nationalteamshop.com/shop/*`** and retire the iframe shell.

### 6. No crawlable store directory — **high**
`nsa-website/public/team-stores.html` iframes the portal's directory
(`nsa-portal.netlify.app/team-stores?embed=1`), and the portal's own
`/team-stores` route is the same client-rendered SPA. So there is **no crawlable
page anywhere that links to individual stores** with real `<a href>` anchors —
stores get no internal link equity and no non-sitemap discovery path.

### 7. No product/store structured data — **medium/high**
No `Store`, `Product`, `Offer`, `BreadcrumbList`, or `ItemList` JSON-LD anywhere
in the storefront. No eligibility for product rich results (price, availability,
image), breadcrumbs, or a sitelinks search box.

### 8. Store lifecycle produces thin / soft-404 pages — **medium**
Stores open and close (`close_at`) and can be private (`public_listed=false`) or
login-gated (`require_login`). Nothing signals this to crawlers today: a closed
or private store can return a live 200 with a "store closed" screen — classic
thin/soft-404 content that drags on site-quality signals.

---

## Recommended architecture

**Canonical = `nationalteamshop.com`. Server-render the store at the edge, add
crawl infrastructure, and consolidate the other two origins onto it.**

1. **Edge-render the store page** (the core fix). Extend `og-storefront.js` from
   "rewrite the `<head>` tags" to "**render a crawlable store page**": inject the
   full SEO `<head>` (title, meta description, canonical → `nationalteamshop.com`,
   robots, OG/Twitter, JSON-LD) **and** a server-rendered above-the-fold HTML
   snapshot — `<h1>` store name, hero blurb, category nav, and a product grid
   (name, image + descriptive `alt`, price, link) — into the served HTML. React
   hydrates over identical markup. Because `nationalteamshop.com` is an alias of
   the portal site, this **automatically** makes the canonical store pages
   crawlable. The data fetch already exists in `og-storefront.js`; we add a body
   template and a products query against `webstore_storefront_products`. Same
   HTML to bots and users → **no cloaking risk**.

2. **Add crawl infrastructure on the store domain.** Ship a `robots.txt` and a
   **dynamic `sitemap.xml`** (a Netlify function querying `webstores_public` for
   open + `public_listed` stores, emitting `nationalteamshop.com/shop/<slug>`
   with `<lastmod>`).

3. **Consolidate origins onto the canonical.** 301
   `nationalsportsapparel.com/shop/*` → `nationalteamshop.com/shop/*` (retire the
   iframe shell); `noindex` (or canonical) `nsa-portal.netlify.app/shop/*` so
   Google credits `nationalteamshop.com`.

4. **Build a crawlable store directory** at `nationalteamshop.com/team-stores`
   (edge-rendered or statically built) with real `<a href="/shop/<slug>">` links,
   and point the marketing `/team-stores` at it.

**Alternatives considered**
- **Bot-detection prerendering** (headless Chromium — deps `@sparticuz/chromium`
  + `puppeteer` are already present). Lower code change, but ongoing
  latency/cost and cloaking risk from serving crawlers different HTML. Stopgap
  only.
- **Next.js SSR migration.** Correct long-term end state, but a large rewrite of
  a 2,254-line storefront; not justified by SEO alone right now.

Recommendation: **edge-rendered store pages + crawl infrastructure** — biggest
gain, least disruption, reuses infra that already exists and already runs on the
canonical domain.

---

## The upgrades list

Effort: S (hours), M (a day or two), L (a week+). Impact: ★★★ = moves
indexation/rankings materially, ★ = polish.

### Phase 0 — Crawl infrastructure & origin consolidation (ship first) ✅ DONE
Safe, self-contained, no storefront re-architecture. _Shipped 2026-07-12._

- [x] **Host-aware `robots.txt`** — ★★★ · S
  `nsa-portal/netlify/edge-functions/robots.js`. `nationalteamshop.com` allows
  `/shop`, `/team-stores`, `/static`, disallows checkout/cart and every app route,
  and points at the store sitemap; the staff host and the raw `netlify.app`
  origin get `Disallow: /`. Fixes half of finding 2.
- [x] **Dynamic store `sitemap.xml`** — ★★★ · M
  `nsa-portal/netlify/edge-functions/sitemap.js`. Queries `webstores_public`
  (status `open` + `public_listed=true`, drops `require_login`) and emits
  `nationalteamshop.com/shop/<slug>` + the `/team-stores` directory. _(lastmod
  omitted — the public view exposes no modified timestamp; add later if we
  surface one.)_ Fixes the other half of finding 2.
- [x] **Per-store canonical + lifecycle robots via the edge function** — ★★★ · S
  Extended `og-storefront.js`: adds `<meta name="description">`, `<link
  rel="canonical" href="…nationalteamshop.com/shop/<slug>">`, and a `<meta
  name="robots">` that is `index` only for open + `public_listed` + non-gated
  stores on the canonical host — else `noindex`. Unknown/archived slugs get
  canonical + `noindex` so the app shell isn't indexed as a phantom store. Fixes
  finding 3 (partial) + 8 (crawl side).
- [x] **De-dupe origins** — ★★★ · S
  `nsa-website/netlify.toml`: 301 `nationalsportsapparel.com/shop/*` →
  `nationalteamshop.com/shop/*` (retires the iframe shell). The raw
  `nsa-portal.netlify.app` origin is de-duped via `robots.js` (`Disallow: /`) plus
  the edge function forcing `noindex` on any non-canonical host. Fixes findings
  4 + 5.

### Phase 1 — Crawlable store pages (the core fix) ✅ DONE
_Shipped 2026-07-13._

- [x] **Edge-render the store `<head>` per store** — ★★★ · M
  Done in Phase 0 (`og-storefront.js`): real `<title>`, unique `<meta
  name="description">`, canonical, lifecycle robots, OG/Twitter. Completes
  finding 3.
- [x] **Edge-render above-the-fold store body** — ★★★ · L
  `og-storefront.js` now renders the store's `<h1>`, logo, hero blurb, category
  list, and a deduped product grid (name, image + `alt`, price, link to
  `/shop/<slug>/p|b/<id>`) INTO `#root`. React's `createRoot` clears + replaces
  it on mount — a no-JS fallback, not hydration, so no mismatch and no cloaking.
  Scoped to the indexable store **home** on the canonical host; deeper/
  transactional pages and the noindex duplicate stay head-only; fail-safe to
  head-only if the store/products lookup or the `#root` markup ever changes.
  Fixes finding 1. _(Product-detail SSR is Phase 3; those subpages are head-only
  for now.)_
- [x] **Crawlable store directory** at `nationalteamshop.com/team-stores` — ★★★ · M
  New `directory-seo.js`: renders real `<a href="/shop/<slug>">` anchors for
  every open, publicly-listed store into `#root` (the SPA directory is otherwise
  search-only, so nothing linked to stores before). Fixes finding 6. _(Optionally
  repoint the marketing `nationalsportsapparel.com/team-stores` at this directory
  — deferred; discovery is already covered by the sitemap + this hub.)_

### Phase 2 — Structured data & rich results
- [ ] **`Store` / `LocalBusiness` JSON-LD per store** — ★★ · S
  Name, logo, URL, `parentOrganization` → National Sports Apparel, `sameAs`.
- [ ] **`BreadcrumbList` JSON-LD** — ★★ · S
  Team Stores → `<Store>` (→ Product). Breadcrumb rich results.
- [ ] **`Product` + `Offer` JSON-LD on product pages** — ★★★ · M
  Name, image, `description_ai`, price/currency, availability from size stock —
  gated on real, in-stock inventory to stay within Google's product policy.
  Completes finding 7.
- [ ] **`ItemList` on the store landing** — ★ · S

### Phase 3 — Content depth & per-store authority
- [ ] **Server-render product detail pages** (`/shop/<slug>/p/<id>`) — ★★★ · L
  The long-tail-keyword pages ("<school> <sport> jersey"); full `description_ai`,
  specs, images, price.
- [ ] **Descriptive, keyword-aware `alt` text** for product/store imagery — ★★ · M
- [ ] **Unique intro copy per store landing** — ★★ · M
  Use `hero_blurb`; template from team + sport + season where empty (consider
  extending the `ai-clean-description` pipeline to store blurbs) so no store is thin.
- [ ] **Internal linking** — ★ · S
  Store ↔ parent sport hub on the marketing site; related stores by school/club.

### Phase 4 — Lifecycle, performance & measurement
- [ ] **Store lifecycle SEO rules** — ★★ · M
  Open+listed → indexable + in sitemap. Closed → `noindex` (or evergreen "opening
  again" landing, not a dead 200). Private/login-gated → `noindex` + out of
  sitemap. Formalizes finding 8.
- [ ] **Core Web Vitals on store pages** — ★★ · M
  Edge-rendered above-the-fold HTML for good LCP; preconnect Cloudinary/Supabase;
  lazy-load below-the-fold; right-size hero images (the OG function's Cloudinary
  transform generalizes).
- [ ] **Search Console + Bing Webmaster** — ★★ · S
  Verify `nationalteamshop.com`, submit the sitemap, watch Coverage/Indexing and
  the "Crawled – currently not indexed" bucket.
- [ ] **Organic analytics for stores** — ★ · S
  GA4 segment for `/shop/*` organic entrances to measure lift vs. this baseline.

---

## Per-store `<head>` spec (reference for Phase 1)

```html
<title>La Verne Lazers Team Store | National Team Shop</title>
<meta name="description" content="<hero_blurb, ~150 chars, or templated
  'Official La Verne Lazers team store — custom jerseys, spirit wear, and gear,
  decorated and delivered. Order before the store closes.'>">
<link rel="canonical" href="https://nationalteamshop.com/shop/la-verne-lazers">
<meta name="robots" content="index,follow,max-image-preview:large">  <!-- noindex if closed/private -->
<meta property="og:type" content="website">
<meta property="og:title" content="La Verne Lazers Team Store">
<meta property="og:description" content="…">
<meta property="og:image" content="<Cloudinary 1200×630 banner>">
<meta property="og:url" content="https://nationalteamshop.com/shop/la-verne-lazers">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ "@context":"https://schema.org",
  "@type":"Store", "name":"La Verne Lazers Team Store",
  "url":"https://nationalteamshop.com/shop/la-verne-lazers",
  "parentOrganization":{"@type":"Organization","name":"National Sports Apparel"} }
</script>
```

_(Optional later enhancement: host-based routing so stores live at the cleaner
`nationalteamshop.com/<slug>` root instead of `/shop/<slug>`. Not required — pick
one canonical path and stick to it.)_

---

## Guardrails

- **No cloaking.** Serve identical HTML to bots and users; hydrate, don't swap.
- **Only advertise `Product` structured data for real, in-stock, priced items** —
  invalid markup earns manual actions.
- **Respect the anon RLS boundary.** Everything renderable is already exposed via
  `webstores_public` / `webstore_storefront_products`; render only what those
  views expose — don't widen anon read access for SEO.
- **`noindex` private/closed/login-gated stores** and keep them out of the
  sitemap, so store lifecycle never pollutes site-quality signals.

---

## Suggested sequencing

1. **Phase 0** — `robots.txt`, dynamic sitemap, per-store canonical/robots, and
   the 301/`noindex` origin consolidation. Cheap, safe, immediately improves
   discovery and de-dup.
2. **Phase 1** — edge-render the store `<head>` + body and build the crawlable
   directory. This is where indexation actually turns on.
3. **Phases 2–3** — structured data, then product-page SSR and content depth.
4. **Phase 4** — lifecycle rules, CWV, and measurement in Search Console.

The pivotal move is **Phase 1: server-render the storefront at the edge on
`nationalteamshop.com`.** Until crawlers get real HTML there, the rest is polish
on a page Google can't read.
