-- RLS lockdown — vendor-stock cache tables (the six deferred by 00179).
--
-- ⚠️ APPLY ONLY AFTER the COWORK bot skills and the cron scripts are running
-- with the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY, the bot-worker/.env
-- convention). Anon writes to these tables STOP WORKING the moment this is
-- applied — a bot/script still on the anon key will get RLS errors (or,
-- worse, PostgREST 2xx-with-zero-rows on reads), and the caches will go stale.
-- Prerequisites (this repo, same branch):
--   * scripts/adidas-cowork-sync.js + scripts/ua-armourhouse-sync.js now
--     require SUPABASE_SERVICE_ROLE_KEY (crontab env / scripts/.env must be
--     updated on the Mac Mini before applying).
--   * bot-worker/prompts/*.md now direct the COWORK skills to the service-role
--     key; the LIVE skills on the Mac Mini must be replaced from the updated
--     references and a run verified before applying.
--
-- Policy design (traced 2026-07-08; pattern mirrors 00179):
--
--   adidas_inventory — staff_all (is_team_member): the staff app writes it
--   directly (src/App.js ~3035 upserts a scraped batch) and reads last_synced
--   (src/App.js ~641), both as authenticated staff. Anon is fully revoked;
--   the COWORK bot and cron sync write with the service role (RLS-exempt).
--
--   adidas_size_maps, agron_inventory, agron_products_staging, ua_inventory,
--   ua_products_staging — RLS on, ZERO policies, anon+authenticated revoked:
--   service-role only. No client reader touches these base tables — all app
--   reads go through the inventory_unified SECURITY DEFINER view (owner-
--   privileged, unaffected), the staging tables are only read by the
--   service-role promote functions / Claude Code, and the size-map load in
--   the sync skill now uses the service key.
--
-- Idempotent and existence-guarded (some targets were created outside the
-- repo migration chain). All existing policies are dropped by name from
-- pg_policies (the permissive ones vary in name), then the intended state is
-- created. Service-role access is unaffected by RLS.

do $$
declare
  t text;
  r record;
begin
  -- adidas_inventory — staff-only ALL (staff app writes/reads it directly)
  t := 'adidas_inventory';
  if to_regclass('public.'||t) is null then
    raise notice 'vendor-caches: % does not exist — skipped', t;
  else
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t||'_staff_all', t);
    execute format('revoke select, insert, update, delete on public.%I from anon', t);
  end if;

  -- The other five — RLS on, zero policies: only the service role (RLS-exempt) gets through.
  foreach t in array array[
    'adidas_size_maps','agron_inventory','agron_products_staging',
    'ua_inventory','ua_products_staging'
  ] loop
    if to_regclass('public.'||t) is null then
      raise notice 'vendor-caches: % does not exist — skipped', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('revoke select, insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;
