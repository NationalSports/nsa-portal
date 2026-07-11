-- Team Shop handoff codes (Coach Crossover, Workstream 1): one-time
-- server-minted codes that carry a signed-in Connect coach to
-- nationalteamshop.com already signed in. The code is ONLY a transport
-- handle: netlify/functions/teamshop-handoff.js mints it (storing only its
-- sha256 hash here), and the exchange step mints the actual session
-- server-side via admin.generateLink + verifyOtp({ token_hash }) — no
-- sign-in credential ever appears in a URL, only this opaque single-use code.
--
-- Rows are EPHEMERAL: 60-second TTL (expires_at = mint + 60s), single use
-- (used_at set atomically on exchange). Expired/used rows are inert and can
-- be swept at leisure via the expires_at index below.
--
-- Writes/reads: NONE via RLS on purpose (no policies at all) — only the
-- service-role teamshop-handoff function touches this table (service_role
-- bypasses RLS), mirroring the 00189 purchase_orders / 00190 teamshop_logos
-- pattern. Not even staff read: the hashes are useless to humans and the
-- table is pure machinery.

create table if not exists public.teamshop_handoff_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,             -- sha256 hex of the raw code; the raw code is never stored
  coach_id    uuid not null references public.coach_accounts(id) on delete cascade,
  customer_id text,                             -- optional team (customers.id) to preselect on arrival
  created_at  timestamptz default now(),
  expires_at  timestamptz not null,             -- mint time + 60s
  used_at     timestamptz                       -- set once, atomically, on exchange
);

-- Cleanup sweeps scan by expiry.
create index if not exists idx_teamshop_handoff_codes_expires
  on public.teamshop_handoff_codes (expires_at);

alter table public.teamshop_handoff_codes enable row level security;
-- No policies on purpose: service-role only (00189/00190 pattern).
revoke select, insert, update, delete on public.teamshop_handoff_codes from anon, authenticated;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_handoff_codes;
