# SanMar Color Page Scrape — COWORK runbook

Goal: pull every style/SKU number listed on `https://sanmarsports.com/pages/color` and
upsert them into the Supabase `sanmar_style_seeds` table so the daily SanMar brands sync
(`sanmar-brands-sync-background`) automatically picks them up.

## What the page contains

`https://sanmarsports.com/pages/color` is a SanMar public catalog page listing styles
grouped by brand and color family. Each style has a style number (e.g. `K500`, `PC61`,
`DT6000`, `3001C`). The goal is to collect **every style number visible on the page**,
including any that require scrolling or clicking "load more" / pagination.

## Steps

1. Navigate to `https://sanmarsports.com/pages/color`. Wait for the page to fully load
   (watch for style numbers or product tiles to appear).

2. Scroll to the bottom of the page, clicking any "load more", "show all", or pagination
   controls until no new items appear. The page may be infinite-scroll or paginated.

3. Extract all style numbers from the page. Style numbers are short alphanumeric codes
   (e.g. `K500`, `PC61`, `DT6000`, `3001C`, `ST850`, `DM108`). They typically appear:
   - In product tile headings or captions
   - In product URLs (e.g. `/products/K500`)
   - In `data-style` or `data-sku` attributes
   Collect them into a deduplicated list. Ignore color codes (e.g. `K500-537`); keep only
   the base style (everything before the first `-`).

4. Report how many unique styles you found.

5. Upsert to Supabase `sanmar_style_seeds` table. Use the Supabase REST API:
   - URL: `{SUPABASE_URL}/rest/v1/sanmar_style_seeds`
   - Method: POST
   - Headers: `apikey: {SUPABASE_SERVICE_ROLE_KEY}`, `Authorization: Bearer {KEY}`,
     `Content-Type: application/json`, `Prefer: resolution=merge-duplicates,return=minimal`
   - Body: array of `{ "style": "K500", "source": "cowork_scrape", "scraped_at": "<ISO timestamp>" }`
   - Batch in groups of 500 to avoid payload limits.

6. After upserting, trigger the brands sync to process the newly seeded styles:
   - POST to `{SITE_URL}/.netlify/functions/sanmar-brands-sync-background`
   - (Optional — safe to skip if the daily cron will run soon)

7. Report: styles found, styles upserted, any errors.

## Environment variables needed

- `SUPABASE_URL` — the project's Supabase REST URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (never the anon key)
- `SITE_URL` — the Netlify site URL (for triggering the sync, optional)

## Notes

- This is a read-only scrape of a public page — no login required.
- Re-running is safe; the upsert is idempotent (primary key = style).
- If a style number is already in `products` with a SanMar vendor, the sync will just
  refresh it; no duplicates are created.
- Brands in scope: Port Authority, Sport-Tek, District, Bella+Canvas. The sync function
  filters by brand after fetching style info, so scraping all visible styles is fine.
- If the page requires JavaScript to render (SPA), use the Playwright browser tool to
  wait for the product grid to load before extracting style numbers.
