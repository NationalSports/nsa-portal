-- Lock quote_requests / quote_request_items to staff-only.
--
-- APPLY ORDER — DO NOT APPLY EARLY: apply only AFTER the Netlify deploy that
-- contains netlify/functions/quote-portal.js (and the modals.js QuoteForm that
-- calls it) is live. Until that deploy, the public ?quote=<token> editor still
-- reads/writes these tables directly with the anon key, and this migration
-- would break every outstanding quote link instantly.
--
-- Background: these two tables were deliberately skipped by 00179 because the
-- public token editor depended on their permissive `FOR ALL USING(true)`
-- policies — which also let anyone with the shipped anon key enumerate all
-- customer quote PII (contact names/emails, notes). That editor now goes
-- through the service-role quote-portal function (token-keyed), the public
-- form INSERT already went through create-quote-request, and quote-notify
-- reads with the service role. Remaining direct clients are the authenticated
-- staff app paths, which the is_team_member() policy below preserves.
--
-- Same pattern as 00179 Tier 1: existence-guarded, drop every existing policy
-- by name from pg_policies (the permissive ones vary in name), create
-- <t>_staff_all, revoke anon privileges. Service role bypasses RLS.

do $$
declare
  t text;
  r record;
begin
  foreach t in array array['quote_requests','quote_request_items'] loop
    if to_regclass('public.'||t) is null then
      raise notice '00182: % does not exist — skipped', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t||'_staff_all', t);
    execute format('revoke select, insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

-- Post-apply assertion: no permissive always-true policy may survive.
do $$
declare bad int;
begin
  select count(*) into bad from pg_policies
   where schemaname='public'
     and tablename in ('quote_requests','quote_request_items')
     and qual = 'true';
  if bad > 0 then
    raise exception '00182: % permissive always-true policies survived', bad;
  end if;
end $$;
