# RLS Authorization Matrix — Hand-off for the Fable session

> ## ✅ APPLIED & VERIFIED on production — Fable pass (2026-07-05)
>
> `00175` was applied to prod (schema_migrations version `20260706123717`) after an
> adversarial 4-lens review caught and fixed a read-breakage bug (see below), and was
> verified live by role simulation:
> - **staff** (`is_team_member()`=true): reads + writes all 24 tables. ✓
> - **coach** (authenticated, non-staff): reads `products` (53,421) + `product_inventory`
>   (1,018) — the catalog works; reads `issues`/`coach_customer_access` = **0** (hardened);
>   cannot write (only `is_team_member()` write policy remains). ✓
> - **anon**: still reads the public catalog (`products`, `product_inventory`, `webstores`). ✓
> - Write exposure: permissive write policies `25 → 0`; `_staff_write` on all 24 tables.
> - Review found the first draft would have blanked the coach catalog (dropping `ALL(true)`
>   also stripped the authenticated read); fixed by restoring an explicit `authenticated`
>   SELECT on `products` + `product_inventory` only.
> - Note: DB migration version is timestamp-based (`20260706…`) while the repo file is
>   `00175` — the existing migration-numbering divergence (audit #10), not a blocker.
>

>
> The coach-auth model was traced end-to-end. Key facts that made the matrix decidable:
> - The **only** magic-link-coach client is `supabaseCoach` (used solely in
>   `src/storefront/AdidasInventory.js`); it writes **only** `coach_saved_orders` and
>   `coach_favorite_items`, which are **already correctly coach-scoped** (nothing to do).
> - `CoachPortal.js` / `CoachCatalogAccess.js` use the **staff** client despite their names.
> - The public storefront (`Storefront.js`) writes **nothing** directly; checkout + vendor
>   sync run as the **service role** (bypasses RLS).
>
> **Deliverable:** `supabase/migrations/00175_rls_lockdown_step3_coach_auth_writes.sql`
> — locks the write surface of **24 tables** to staff-only (`is_team_member()`) while leaving
> every read policy untouched, and closes the `coach_customer_access` self-grant (**#4**).
> `is_team_member()` verified sound (SECURITY DEFINER over active `team_members`).
> **Not yet applied to any database — pending branch test + owner approval.**
>
> **Still open (need decisions / coordinated changes):**
> - **#3 coach-invite.js** — has no auth guard, but all 3 callers currently send **no auth
>   token**. Fix = require a staff/coach JWT in the function **and** update the 3 callers to
>   send `Authorization: Bearer <session>`, plus decide the caller rule (staff-only vs
>   staff-or-authorized-coach). Multi-file + decision — not done here.
> - **#11 roster_\* portal** — anon-writable with no DB identity; needs a capability-token or
>   service-role redesign (architectural).
> - `catalog_order_requests`, `quote_request_items`/`quote_requests`, `coach_hire_leads`,
>   `uniform_*`, `adidas_inventory` — deferred (public/coach write paths or unknown writer).
> - Separate: several internal tables (`issues`, `assigned_todos`, …) have anon **READ**
>   policies — a read-hardening pass, out of scope for this write-focused migration.

---

**Status:** analysis complete, no changes applied. Live-verified 2026-07-05 against
project `hpslkvngulqirmbstlfx` via **read-only** `pg_policies` queries. Nothing has been
written to the database or to a branch.

This is the input for the RLS / coach-authorization work (audit items **#2, #3, #4, #11**).
It is deliberately a *decision doc*, not a migration — the migration can't be written until
the per-table writer decisions below are made, because a wrong "plausible" policy either
breaks the coach portal or leaves a hole. That judgment is the Fable task.

---

## Correction to audit finding #2 (important)

The audit claimed the RLS lockdown (00173/00174) was inert and **anyone with the anon key
could rewrite the entire order book.** On the **live database that is not true.** Every core
order table is correctly locked:

| Table group | Live policies | Verdict |
|---|---|---|
| `customers`, `estimates`, `estimate_items`, `sales_orders`, `so_items`, `so_jobs`, `invoices`, `invoice_items`, `invoice_payments` | `<t>_read` (SELECT → anon+auth) + `<t>_staff_write` (ALL → `is_team_member()`) | ✅ locked |
| `messages`, `message_reads` | `<t>_staff_all` (ALL → `is_team_member()`), no anon | ✅ locked |

The migration **case-mismatch** the audit found (`drop policy "Allow all"` vs the created
`"allow_all"`) is real in the migration *files*, but production was reconciled by other means.
**There is no order-book emergency.** → **Do not touch these tables.**

---

## The real problem: ~40 tables writable by any `authenticated` user

Magic-link coaches share the `authenticated` role with staff. These tables still have an
unconditional write policy (`USING(true) WITH CHECK(true)` for `authenticated`), so **any
signed-in coach can write them.** Plus the entire `roster_*` family is **anon-writable**
(the public coach portal uses the anon key with no identity).

### The decision to make, per table

Pick a writer class for each:

- **S** — staff only: `ALL TO authenticated USING (is_team_member()) WITH CHECK (is_team_member())`
- **C** — coach-scoped: authenticated, but constrained to the coach's own customer/team
  (needs a join to `coach_customer_access`) — harder, only where coaches genuinely edit
- **A** — anon public portal: currently `USING(true)`; needs an **identity/token** to scope
  (architectural — see the roster section)
- **X** — service-role only: no legitimate client write → revoke `authenticated`/`anon`
  writes entirely; Netlify functions keep working (service role bypasses RLS)

### How to decide (evidence already gathered)

`src_wr` = count of client write calls (`.from('t').insert/update/upsert/delete`) in `src/`
(the browser client, which runs as authenticated **staff or coach**, or anon).
`nf` = the table is touched by a Netlify function (runs as **service role**, bypasses RLS).

- `src_wr = 0` and `nf > 0` → strong **X** candidate (only the service role writes it).
- `src_wr > 0` → a client writes it; decide **S** vs **C** by *who* — staff admin UI
  (`Webstores.js`, staff pages) → **S**; the public/coach portal → **C** or **A**.

### Provisional matrix (VERIFY each — this is a starting point, not the answer)

| Table | Current write access | src_wr / nf | Provisional | Open question |
|---|---|---|---|---|
| `products` | `"Allow all"` **and** `products_write` (both ALL→auth) | 14 / 5 | **S** | staff UI + vendor sync only? confirm no coach writes. Also drop the redundant duplicate policy. |
| `product_inventory` | Allow all (auth) | 3 / 0 | **S** | staff-only? |
| `vendors` | Allow all (auth) | 1 / 0 | **S** | staff-only |
| `deco_vendors`, `deco_vendor_pricing` | allow_all (auth) | 1 / 0 | **S** | staff-only |
| `adidas_inventory` | anon **and** auth ALL | 1 / 0 | **X / A** | COWORK sync writes as anon — move sync to service role, then lock? |
| `webstore_orders` | auth ALL | 11 / 11 | **S** | client writes are staff admin (`Webstores.js`); checkout is service role. Confirm no storefront client write. |
| `webstore_order_items` | auth ALL | 13 / 6 | **S** | as above |
| `webstore_products` | auth ALL | 31 / 2 | **S** | staff admin |
| `webstores` | auth ALL | 11 / 14 | **S** | staff admin |
| `webstore_roster` | auth ALL | 6 / 3 | **S / C** | does a coach edit their store roster from the portal? |
| `webstore_coupons` | auth ALL | 3 / 2 | **S** | staff admin |
| `webstore_bundle_items` | auth ALL | 6 / 1 | **S** | staff admin |
| `webstore_shipments`, `webstore_transfers`, `webstore_settings`, `webstore_number_claims` | auth ALL | mixed | **S / X** | staff admin + service role |
| `omg_stores`, `omg_store_products` | auth ALL | 1–3 / 1–2 | **S** | staff admin |
| `issues` | Allow all (auth) | 0 / 0 | **S** | client reads only; lock writes to staff |
| `assigned_todos`, `dismissed_todos`, `dismissed_notifs`, `todo_comments` | Allow all (auth) | 0–11 / 0–1 | **S** | internal staff todo system |
| `rep_csr_assignments` | Allow all (auth) | 0 / 1 | **S / X** | staff/service-role |
| `catalog_order_requests` | auth UPDATE (true) | 7 / 0 | **S / C** | portal update — coach or staff? |
| `quote_requests`, `quote_request_items` | auth insert / allow_all | 2–3 / 1 | **S + public-insert** | storefront quote form may need anon/auth INSERT only |
| `slack_notifications` | auth INSERT (true) | 0 / 0 | **X** | service-role only |
| `uniform_designs`, `uniform_order_requests`, `uniform_patterns`, `uniform_settings` | anon/auth insert + auth ALL | 0 / 0 | **verify** | no writes found in main `src/` bundle — written from a lazy storefront chunk? |
| `coach_hire_leads` | anon **and** auth ALL | 0 / 0 | **anon INSERT only** | public "hire a coach" lead form — allow anon INSERT, nothing else |

---

## The `roster_*` anon portal (audit #11) — architectural, flag for design

`roster_teams`, `roster_players`, `roster_team_coaches`, `roster_player_sizes`,
`roster_kit_templates`, `roster_order_sessions` are all **`anon ALL USING(true)`** because the
public coach roster portal talks to Supabase with the **anon key and no login**. So *anyone*
can read/update/delete *any* team's roster.

This cannot be fixed with a policy predicate alone — there is **no identity at the DB layer**
to scope by. Options for Fable to weigh:
1. Give the portal a per-session/per-team **capability token** (signed link) and scope policies to it.
2. Move all roster writes behind an **authenticated edge/Netlify function** (service role) and
   revoke direct anon write.
3. Accept anon read but route writes through a function.

Also (data integrity, separate from RLS): `roster_players.jersey_number` has **no uniqueness
constraint** per team, and is `TEXT DEFAULT ''`. A partial unique index
`(team_id, jersey_number) WHERE jersey_number <> ''` is wanted — but **existing duplicates/empties
must be cleaned first** or the index creation fails. Not a blind add.

---

## `coach_customer_access` + `coach-invite.js` (audit #3, #4)

- **Live:** `coach_customer_access` has one policy: `ALL TO authenticated USING(true) WITH CHECK(true)`.
  Any signed-in coach can `INSERT` a row granting **themselves** access to any `customer_id`
  (self-serve cross-tenant escalation), or delete others' grants.
- **`netlify/functions/coach-invite.js`** has **no auth guard** and provisions
  `coach_accounts` + `coach_customer_access` rows via the service role for an
  attacker-supplied email + customer_id.
- **Target model** (the core Fable decision): coaches may **SELECT their own** grants only;
  **INSERT/UPDATE/DELETE only via service role** (the invite function) — and the invite
  function must require a caller who is either staff or an already-authorized coach for that
  customer.

---

## Verification protocol (for whatever migration Fable produces)

Do **not** apply to production directly. Test on an isolated branch first:

1. `create_branch` (costs apply — confirm with the owner) → get the branch `project_ref`.
2. `apply_migration` on the branch.
3. Assert behavior with role/JWT simulation, e.g.:
   ```sql
   -- staff write should SUCCEED
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<staff-auth-uid>","email":"<staff>"}';
   -- (is_team_member() resolves via the staff's team_members row)
   -- try an UPDATE, expect success

   -- coach write should FAIL on staff-only tables
   set local request.jwt.claims = '{"sub":"<coach-uid>","email":"<coach>"}';
   -- try the same UPDATE, expect 0 rows / RLS denial

   -- anon write should FAIL on locked tables
   set local role anon;
   -- try INSERT, expect denial
   ```
4. Confirm the **order book still writes for staff** (regression guard) and that
   **Netlify/service-role paths are unaffected** (they bypass RLS).
5. Only after branch verification + owner sign-off: apply to production.

## What NOT to do

- Don't blanket-drop every `USING(true)` policy — some anon/public-insert paths are legitimate
  (lead forms, storefront inserts). Decide per table.
- Don't lock a table the coach portal legitimately writes without providing the replacement
  path (function or scoped policy) first.
- Don't touch the order-book tables — they're already correct.
- Never apply to production without a branch test and explicit owner approval.

---

*Prepared by the Opus pass (audit follow-up). The read-only investigation is done; the
per-table writer decisions and the resulting migration are the Fable work.*
