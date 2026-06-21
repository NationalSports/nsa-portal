-- Secure, server-only store for QuickBooks Online OAuth tokens.
--
-- Before this, tokens lived in app_state.id = 'qb_config' (whose RLS is USING(true), i.e.
-- readable with the public anon key) and were round-tripped through the browser and the OAuth
-- callback URL hash. This table is reachable ONLY by the Netlify functions using the service-role
-- key: RLS is enabled with NO anon/authenticated policy, and table privileges are revoked from
-- those roles. service_role bypasses RLS, which is the intended (and only) access path.

create table if not exists public.qb_oauth_tokens (
  realm_id         text primary key,
  access_token     text not null,
  refresh_token    text not null,
  expires_in       integer,
  token_created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at       timestamptz not null default now()
);

alter table public.qb_oauth_tokens enable row level security;

-- Intentionally NO policies: with RLS on and no permissive policy, anon + authenticated are
-- denied everything. Revoke table privileges too, so a future broad GRANT can't re-expose rows.
revoke all on public.qb_oauth_tokens from anon, authenticated;
grant all on public.qb_oauth_tokens to service_role;

-- Scrub credentials previously persisted in the anon-readable app_state row. The new client no
-- longer writes tokens here; this removes the exposed copy at rest. NOTE: tokens that were
-- already exposed should also be rotated by disconnecting + reconnecting the QuickBooks app
-- (Intuit issues a fresh grant on reconnect).
update public.app_state
   set value = ((value::jsonb) - 'access_token' - 'refresh_token' - 'token_created_at')::text,
       updated_at = now()
 where id = 'qb_config'
   and value is not null
   and value <> ''
   and (value::jsonb) ? 'access_token';
