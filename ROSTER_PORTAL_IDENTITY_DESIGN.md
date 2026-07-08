# Roster Portal Identity — Design (audit #11)

Design proposal for closing the roster-portal write exposure. **No code changes yet** — this
is the design to review before implementing.

## Problem

The coach roster portal (`RosterOrdersCoach`, rendered by `CoachPortal.js`) lets coaches fill
out team rosters/kit orders. It runs with the **anon** Supabase key and **no login**. Every
`roster_*` table has RLS `FOR ALL TO anon USING(true) WITH CHECK(true)` (migration 00160, which
explicitly notes this was "intentionally permissive … tighten later").

Consequences, in order of severity:
1. **Anyone with the shipped anon key can read/insert/update/delete *any* team's roster** —
   directly, from a browser console, without even the portal link. The `alpha_tag` in the
   portal URL is **not enforced at the write layer** for roster tables; it's just how the UI
   navigates. This is the real hole.
2. No integrity: duplicate jersey numbers, cross-team edits, deletion of another club's rosters.

Tables in scope: `roster_order_sessions`, `roster_teams`, `roster_players`,
`roster_player_sizes`, `roster_kit_templates`, `roster_team_coaches`.

## Constraint that shapes the design

The portal is **deliberately login-free** — coaches get a link and fill a form, no account or
password. That's a business UX choice (the whole point vs. the old Google-Sheets flow). A design
that forces coach logins is a real regression, so it's the fallback, not the default.

## Data model (what we can scope on)

```
roster_order_sessions (customer_id TEXT)          ← the anchor: everything roots here
  └─ roster_teams (session_id)
        ├─ roster_players (team_id)
        │     └─ roster_player_sizes (player_id)
        └─ roster_team_coaches (team_id, coach_id → coach_accounts)
roster_kit_templates (customer_id TEXT)
```

Every writable row reaches a `customer_id` by walking up to its session (or directly, for
sessions/templates). So a write can be authorized by proving the caller may act for that
`customer_id`.

## Options

### A. Route roster writes through a service-role function, scoped by `alpha_tag` (recommended Phase 1)
Mirror `portal-action.js` (which already does exactly this for coach *art* decisions). A new
`roster-write` function (or a `roster-*` action added to `portal-action`) takes `{alpha_tag,
op, payload}`, verifies `alpha_tag` → customer family (same lookup #3 now uses), confirms the
target rows belong to that customer's sessions, and performs the write with the service role.
Then **revoke anon/authenticated direct write** on `roster_*` (keep read for now).

- **Closes:** "any anon can edit any roster" → "only a holder of the customer's `alpha_tag`
  can edit *that customer's* roster." Same trust level as the rest of the coach portal.
- **Cost:** one function + a migration; reroute ~5-6 write ops in `RosterOrdersCoach`/`SessionDetail`.
- **Limit:** `alpha_tag` is a shared knowledge-factor — every coach for a customer shares it,
  and it doesn't expire. Good enough to match the portal's existing posture; not per-coach.

### B. Per-session capability token (recommended Phase 2 / target)
The invite link already comes from `coach-invite.js`. Embed a **signed, scoped token** in it:
`?portal=<alpha_tag>&t=<token>` where `t` = HMAC(server_secret, {session_id|team_id, customer_id,
exp}). The `roster-write` function verifies the signature + expiry + that the payload's rows fall
within the token's scope. No login; the link *is* the credential (like a signed URL), but now
**scoped per team/session and expirable** instead of "whole customer, forever."

- **Closes:** cross-team edits even among a customer's own coaches; leaked-link blast radius
  (bounded to one team, and time-boxed).
- **Cost:** token mint in `coach-invite.js` + verify in the function + a server secret. Builds
  directly on top of A.

### C. Magic-link coach login + RLS scoped via `roster_team_coaches` / `coach_customer_access` (fallback)
Require coaches to sign in (the `supabaseCoach` magic-link already exists for the catalog). Then
`roster_*` RLS scopes writes to `EXISTS (…coach_accounts ca join … where ca.auth = auth.uid()
and <row's customer/team> is in the coach's access)`. Real per-coach identity, enforced in the DB.

- **Strongest**, and no service-role function needed.
- **Cost:** the portal stops being login-free — the UX regression the business avoided. Only
  choose this if identity strength outweighs the frictionless-link goal.

## Recommendation

**Phase 1 = Option A now** (immediate, high-value risk reduction; consistent with `portal-action.js`
and the #3 guard just shipped). **Phase 2 = Option B** as the target that keeps the login-free UX
while giving real per-team, expiring scope. Hold Option C unless the business decides mandatory
coach login is acceptable.

Do them in this order because B reuses A's function and A alone already removes the worst hole
(direct anon writes to arbitrary rosters).

## Phase 1 concrete sketch

1. **Migration** (`00176`): on each `roster_*` table, drop the `*_anon` / `*_auth` `FOR ALL
   USING(true)` **write** policies; add a `*_read` `SELECT` policy for anon+authenticated (the
   portal must still read to render) and — for staff — a `*_staff_write` `is_team_member()` policy.
   Result: **no client can write `roster_*` directly**; staff write via RLS, coaches write only
   through the function (service role, bypasses RLS). *Branch-test + role-sim before prod, exactly
   like 00175.*
2. **Function** `netlify/functions/roster-write.js`: `{alpha_tag, op, payload}` → verify
   `alpha_tag` maps to `payload.customer_id` (family lookup), assert the target row(s) resolve to
   that customer via the session chain, then service-role write. Whitelist ops
   (`upsert_player`, `set_sizes`, `save_session`, `add_team`, …) and columns (like
   `portal-action.js`'s `JOB_COLS`/`ART_COLS` allow-lists).
3. **Frontend**: replace the direct `supabase.from('roster_*')...` writes in `RosterOrdersCoach`
   / `SessionDetail` (coach context) with calls to the function, passing `alpha_tag:
   customer.alpha_tag`. Staff-context roster editing (`RosterOrdersStaff`) keeps writing directly
   (now via the `*_staff_write` RLS policy).

## Still-open after Phase 1 (note honestly)

- **Reads** stay anon-open in Phase 1 (a coach could still *read* another customer's roster by
  guessing ids). Read-scoping needs a SECURITY DEFINER view or function-mediated reads — a
  Phase 1.5. Writes are the higher risk (integrity + tampering), so they go first.
- **Jersey-number uniqueness** (audit #11's data-integrity half): add
  `unique (team_id, jersey_number) where jersey_number <> ''` — but existing duplicates/empties
  must be cleaned first, so it's its own guarded step.
