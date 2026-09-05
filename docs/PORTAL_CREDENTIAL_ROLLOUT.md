# Portal credential and read-boundary rollout

These changes must be released in phases. Applying both pending migrations before
the new browser gateway is live will make coach portals load no core data.

## Phase A: compatibility

1. Apply only `20260904224715_portal_access_credentials.sql`.
2. Deploy the Netlify functions and browser gateway from this change.
3. Verify an existing legacy `?portal=<alpha_tag>` link can load its own parent/team
   family, and cannot load a known order from another family.
4. Verify a newly issued opaque token works for the browser loader and every portal
   action, roster, invite, uniform-order, reopen, and follow-up link path.

The compatibility migration stores domain-separated hashes of existing tags. It
does not modify `customers.alpha_tag` or invalidate an existing link. The resolver
uses direct alpha-tag lookup only if the credentials table itself is absent. Once
the table exists, an unknown, expired, or disabled credential is rejected without
legacy fallback. Resolver caches can retain a successful credential for at most 60
seconds after it is disabled.

## Phase B: public read lockdown

1. Apply `20260904224722_lock_core_reads_to_staff.sql` and then
   `20260904230554_restrict_public_app_state.sql` only after Phase A smoke tests
   pass in the deployed environment.
2. Repeat the legacy and opaque-token portal smoke tests.
3. From an anonymous Supabase client, verify `customers`, `sales_orders`, and
   `invoices` return a permission error and `search_customers` cannot execute.
4. From a staff session, verify the normal application still loads and can save a
   disposable test estimate through the established test workflow.

Do not run an unrestricted migration command that applies both Phase A and Phase B
in one deployment unless the compatible gateway is already live.

## Phase C: rotation

For each customer, active staff can issue a 256-bit random opaque token through
the credential endpoint. Replace generated and manually managed links, then
verify the new link. An admin must disable the customer's `legacy_alpha_tag`
credential only after its known links have been replaced. The endpoint records
`disabled_at`; record the old and replacement credential IDs in the rotation
inventory. It does not populate `replaced_by`. Do not change or delete
`customers.alpha_tag`, because it remains business display/search data.

Rotation is deliberately per customer and reversible by clearing `disabled_at`
during the transition. Never bulk-disable legacy credentials without an external
inventory of distributed links and an approved customer communication plan.

## Remaining public bootstrap surfaces

`20260904230554_restrict_public_app_state.sql` narrows anonymous and nonstaff
authenticated reads to `company_info` and `portal_settings`. Apply it with Phase B;
staff retain their existing row access and `comm_rep_comp` remains admin-only.

The `coach-store-submit` change is a Supabase Edge Function and must be deployed
separately from the Netlify functions before opaque store-builder links are issued.

`team_members` remains broadly readable because the pre-authentication LoginGate
looks up its roster before a user session exists, and the coach portal uses rep
contact fields. Replacing that query with a curated server projection remains a
separate requirement. Do not infer that this rollout closes that public surface.

The six roster tables (`roster_kit_templates`, `roster_order_sessions`,
`roster_teams`, `roster_team_coaches`, `roster_players`, and
`roster_player_sizes`) also retain the broad anonymous SELECT policies created by
00176. They expose every customer's roster names, jersey numbers, sizes, session
notes, and kit definitions. `roster-write` and the now credential-scoped
`roster-order-submit` close direct public mutations, but read isolation still
requires routing `RosterOrdersCoach` through a family-scoped loader before those
SELECT policies can be revoked.
