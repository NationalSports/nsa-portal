# Security Posture — verified 2026-07-03

Point-in-time verification of the security findings carried across
`DATA_PERSISTENCE_AUDIT_2026-05-25/06-09.md`, `WEBSTORE_FLOW_AUDIT_2026-06-10.md`,
and `WEBSTORE_MONEY_AUDIT_2026-07-02.md`. Every claim below was checked against
**current code on `main` and the live database** (Supabase security advisors run
today) — not against the audit docs. Several headline findings are stale: the
team fixed them since the audits were written. This doc records what is actually
still open, so the next pass works the real list.

## Phase 1 — public server functions: mostly FIXED, one gap closed today

| Function | Audit claim | Verified state today |
|---|---|---|
| `shipstation-webhook` | leaks API creds via attacker `resource_url` (SSRF) | **Fixed previously**: https-only, host pinned to `ssapi.shipstation.com`, `redirect:'error'`. Remaining gap — token auth was *enforce-only-if-configured* — **fixed in this PR: fail-closed**. Pre-merge checklist: confirm `SHIPSTATION_WEBHOOK_SECRET` is set in Netlify and the same `?token=` is on the webhook URL in ShipStation. |
| `image-proxy` | SSRF (fetch any URL) | **Fixed previously**: supplier-domain allowlist (SanMar/S&S/Momentec/Salsify/Cloudinary). |
| `brevo-proxy` | open email relay | **Fixed previously**: staff JWT (`verifyUser`) required; public surfaces use content-locked senders instead. |
| `qb-api` | client-supplied QuickBooks tokens | **Fixed previously**: staff JWT required; tokens live in a service-role-only store, refreshed server-side, never returned to the client. |
| `pdf-generator` | unauthenticated headless-browser rendering | **Fixed previously**: staff JWT + 8MB payload cap. |
| `receipt` | unauthenticated | **Public by design** and content-locked: every byte comes from Stripe + our DB keyed on a high-entropy PaymentIntent id; a caller can only (re)send a real receipt. Acceptable. |
| `stripe-payment` `refund` action | open refund endpoint | **Fixed previously**: admin-only; the recorded path is `refund_webstore_order` (staff JWT, capped, idempotent per attempt). |
| `portal-action` | coach writes with no state guard | **Fixed this week** (#1520): decisions go through the `apply_coach_art_decision` transaction; legacy patches are state-guarded. |

Still worth a look (not blocking, edge functions deploy separately from Netlify):
`taxcloud-capture` idempotency (double-reported filings, 06-09 audit) and the
`send-scheduled-emails` duplicate-send window.

## Phase 2 — the live exposure: row-level security (NOT fixed)

Supabase security advisors, run today: **159 findings**, dominated by:

- **101 × `rls_policy_always_true` (WARN)** across ~70 tables — the migration-011-era
  `Allow all USING(true) FOR ALL` pattern is still on the entire core schema:
  `customers`, `estimates`(+items/art/decos), `sales_orders`, `so_items`, `so_jobs`,
  `so_art_files`, `so_item_pick_lines`/`po_lines`, `invoices`(+items/payments),
  `products`, `product_inventory`, `messages`, `app_state`, `team_members`,
  `scheduled_emails`, promo/credit tables, vendor inventory tables, roster tables.
  **Anyone with the shipped anon key can write all of it.**
- **4 × `security_definer_view` (ERROR)** — views that bypass RLS entirely.
- **11 anon + 14 authenticated `security_definer_function_executable` (WARN)**.
- 13 × `function_search_path_mutable`; 1 × leaked-password protection off (dashboard toggle).
- 14 × `rls_enabled_no_policy` (INFO) — these are *intentional* service-role-only
  tables (e.g. `webstore_stock_holds`); no action.

### Why the fix is a matrix, not a find-replace

The portal has **three caller classes** sharing two Postgres roles:

1. **anon** — storefront shoppers, coach-portal links, OMG portals. Need SELECT on
   a small set (storefront views, `sales_orders`/`so_jobs`/`so_art_files`/`estimates`
   for the coach portal) and **no direct writes** (writes go through Netlify
   functions with the service key: `webstore-checkout`, `portal-action`, …).
2. **authenticated: staff** — the main portal app after login. Needs broad
   read/write on the core schema.
3. **authenticated: coaches** — magic-link coach accounts are ALSO `authenticated`,
   so `TO authenticated USING(true)` is **not sufficient** for staff-only tables
   (the 06-09 audit's exact point). Staff-only writes need a
   `is_team_member(auth.uid())`-style SECURITY DEFINER predicate; coach-facing
   tables (rosters, coach favorites, saved orders) need coach-scoped predicates.

### Sequenced plan (one subsystem per PR, portals re-tested after each)

1. `team_members`, `app_state`, `scheduled_emails`, QB/token/config tables →
   staff-only writes, no anon read (highest value, lowest breakage risk).
2. Core order flow (`customers`, `estimates*`, `sales_orders`, `so_*`, `invoices*`,
   `messages`) → staff writes via `is_team_member()`; keep the anon/coach SELECT
   grants the portals rely on (enumerate from `portal-action`/CoachPortal reads first).
3. Products/inventory/vendor tables → staff writes; anon SELECT only where the
   storefront actually reads them (check the storefront views' grants instead of
   direct table reads).
4. The 4 SECURITY DEFINER views → convert to `security_invoker` or replace with
   explicit grants.
5. Function hygiene: pin `search_path`, revoke anon/authenticated EXECUTE on the
   25 flagged security-definer functions that don't need it.
6. Dashboard: enable leaked-password protection.

Each step: write the migration, apply to live, run the storefront + coach portal +
OMG portal happy paths, and re-run `get_advisors` to watch the counts fall.
