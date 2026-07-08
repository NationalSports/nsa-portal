# RLS Lockdown — Step 4 (deferred tables) — 2026-07-07

**Status: migration authored (`00179`), NOT applied. Apply only after the owner
confirms the "unknown writer" tables below.**

Live Supabase security advisors (run 2026-07-07): **100 findings**, down from 159 on
07-03 — steps 1–3 (00173–00176) cleared the core order book. What remains on the
always-true list is **26 tables** where anyone with the shipped anon key can read AND
write, plus **4 ERROR-level SECURITY DEFINER views**. Every reader/writer of all 26
tables was traced through `src/`, `netlify/functions/`, `supabase/functions/`,
`bot-worker/`, `scripts/`, and the built bundle before deciding anything.

## What 00179 locks (17 tables)

| Table | Evidence | Policy |
|---|---|---|
| customer_pending_shipping(+_usage) | staff save engine only (`dbEngine.js:1919–1943`) | staff-only ALL |
| rep_product_favorites | staff only (`Webstores.js:8412–8429`) | staff-only ALL |
| store_templates | staff only (`Webstores.js:7056–7656`) | staff-only ALL |
| catalog_order_requests | public form inserts via **service-role** function (`catalog-order-request.js:114`); staff updates in App.js | staff-only ALL (service bypasses RLS) |
| estimate_items_audit | no writer in repo; described as a delete-recovery trail (`dbEngine.js:822`) — presumed trigger written under the deleting (staff) role | staff-only ALL ⚠️ |
| coach_hire_leads, uniform_designs, uniform_order_requests, uniform_patterns, uniform_settings | **no writer, reader, or CREATE TABLE anywhere in the repo or built bundle** — orphans | staff-only ALL ⚠️ |
| momentec/richardson/sanmar/ss/nike_inventory | written only by service-role sync functions; zero client readers (vendor stock is read via the definer views) | RLS on, **no policies** (service-role only) |
| slack_notifications | Deno edge functions with service role only | RLS on, **no policies** |

⚠️ = the migration can't be contradicted by any code in this repo, but the writer was
never found. If something outside the repo (an old Zap, a form on another site) writes
these with the anon key, locking will break it **silently**. Confirm they're dead — or
be ready to re-open one table — before applying.

## Deliberately NOT locked (anon access is load-bearing — needs redesign, not a predicate)

1. **`quote_requests` / `quote_request_items`** — the public `?quote=<token>` editor
   SELECTs by token and rewrites items **as anon** (`modals.js:751–788`). RLS cannot
   scope "the row whose token you queried by," so today's policy also allows full-table
   enumeration of customer PII. **Fix shape:** move the token editor's reads/writes into
   a service-role function that validates the token (like `create-quote-request.js`
   already does for inserts), then staff-only the tables. ~half a day, small blast
   radius, highest PII value — do this one next.
2. **`webstore_roster`** — the public coach portal inserts/updates/deletes roster rows
   as anon (`CoachPortal.js:190–197`). Same shape as the roster_* redesign flagged as
   #11 in `RLS_MATRIX_TODO.md` (capability token or service-role route).
3. **COWORK anon-key caches** — `adidas_inventory`, `adidas_size_maps`,
   `agron_inventory`, `agron_products_staging`, `ua_inventory`, `ua_products_staging`.
   The bot-worker inventory syncs POST with the **anon key** (explicit in
   `bot-worker/prompts/*.md`, migrations 00136/00138). Locking these breaks nightly
   stock sync. **Fix shape:** give the bot the service-role key (its `worker.js`
   already holds one) and update the prompts; then a follow-up migration locks all six.

## The 4 SECURITY DEFINER views (advisor ERRORs) — accepted by design, for now

`webstores_public`, `inventory_unified`, `webstore_storefront_products`,
`webstore_product_eta` are the **public read API**: each is a curated projection over
staff-locked base tables, and the anon storefront/coach catalog only works *because*
they bypass RLS (verified: base `webstores` is authenticated-only since 00134; the anon
storefront reads products exclusively through `webstore_storefront_products`).
Risk to keep in mind: any column added to these views is instantly public — treat view
DDL changes as security-sensitive. `webstore_product_eta` surfaces data derived from
staff-only order tables (ETA aggregates); confirm it exposes nothing per-customer.

## Verification plan (before/after applying — same drill as the 00175 pass)

```sql
-- before/after: policy inventory on the 17 targets
select tablename, policyname, roles, cmd, qual from pg_policies
 where schemaname='public' and tablename in ('customer_pending_shipping', /* …all 17 */ 'slack_notifications')
 order by tablename;
```
- **staff** simulation: reads and writes on Tier-1 tables succeed.
- **anon** simulation: `select` on every locked table returns permission-denied/0 rows;
  the storefront (`webstores_public`, `webstore_storefront_products`) still renders;
  the `?quote=` editor and coach-portal roster still work (untouched).
- Vendor stock still shows on /adidas and product pages (`inventory_unified` definer).
- Nightly syncs (service role) unaffected; COWORK bot unaffected (its tables untouched).
- Re-run `get_advisors`: `rls_policy_always_true` should drop 37 → ~20 (the deferred
  quote/roster/COWORK tables remain until their redesigns land).
