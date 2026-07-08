-- RLS lockdown — step 4: the tables deferred by 00173–00176.
--
-- Live advisors (2026-07-07) still show 26 tables with a permissive
-- `FOR ALL USING(true)` policy: anyone holding the shipped anon key can read AND
-- write them. Every reader/writer of each table was traced through src/,
-- netlify/functions, supabase/functions, bot-worker/, scripts/, and the built
-- bundle before deciding its policy (full matrix: RLS_LOCKDOWN_STEP4_2026-07-07.md).
--
-- This migration locks the 17 tables that are safe to lock:
--
--   Tier 1 — staff-only ALL (only the authenticated staff app touches them; public
--   inserts, where they exist, already go through service-role functions):
--     customer_pending_shipping, customer_pending_shipping_usage,
--     rep_product_favorites, store_templates, catalog_order_requests,
--     estimate_items_audit*, coach_hire_leads*, uniform_designs*,
--     uniform_order_requests*, uniform_patterns*, uniform_settings*
--     (* = no writer found anywhere in the repo — locked as orphans; see the
--        matrix doc's "unknown writers" section and confirm before applying)
--
--   Tier 2 — service-role only (written exclusively by sync functions with the
--   service key, which bypasses RLS; zero client readers — vendor stock reads go
--   through the SECURITY DEFINER views, which run as owner):
--     momentec_inventory, richardson_inventory, sanmar_inventory, ss_inventory,
--     nike_inventory, slack_notifications
--
-- Deliberately NOT locked here (anon access is load-bearing today — each needs a
-- redesign, not a predicate; documented in the matrix doc):
--     quote_requests / quote_request_items      (public ?quote= token editor, anon)
--     webstore_roster                            (public ?portal= coach portal, anon)
--     adidas_inventory, adidas_size_maps, agron_inventory, agron_products_staging,
--     ua_inventory, ua_products_staging          (COWORK bot writes with the anon key)
--
-- Idempotent and existence-guarded: several targets were created outside the repo
-- migration chain, so each table is skipped if absent. All existing policies on a
-- target are dropped by name from pg_policies (the permissive ones vary in name),
-- then the intended policy is created. Service-role access is unaffected by RLS.

do $$
declare
  t text;
  r record;
begin
  -- Tier 1 — staff-only ALL, mirroring the 00173–00176 pattern
  foreach t in array array[
    'customer_pending_shipping','customer_pending_shipping_usage',
    'rep_product_favorites','store_templates','catalog_order_requests',
    'estimate_items_audit','coach_hire_leads','uniform_designs',
    'uniform_order_requests','uniform_patterns','uniform_settings'
  ] loop
    if to_regclass('public.'||t) is null then
      raise notice 'step4: % does not exist — skipped', t;
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

  -- Tier 2 — RLS on, zero policies: only the service role (RLS-exempt) gets through.
  foreach t in array array[
    'momentec_inventory','richardson_inventory','sanmar_inventory',
    'ss_inventory','nike_inventory','slack_notifications'
  ] loop
    if to_regclass('public.'||t) is null then
      raise notice 'step4: % does not exist — skipped', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('revoke select, insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Post-apply assertion: none of the 17 targets may retain a permissive
-- always-true policy. (Raises if the drop loop missed anything.)
do $$
declare bad int;
begin
  select count(*) into bad from pg_policies
   where schemaname='public'
     and tablename in (
       'customer_pending_shipping','customer_pending_shipping_usage',
       'rep_product_favorites','store_templates','catalog_order_requests',
       'estimate_items_audit','coach_hire_leads','uniform_designs',
       'uniform_order_requests','uniform_patterns','uniform_settings',
       'momentec_inventory','richardson_inventory','sanmar_inventory',
       'ss_inventory','nike_inventory','slack_notifications')
     and qual = 'true';
  if bad > 0 then
    raise exception 'step4: % permissive always-true policies survived', bad;
  end if;
end $$;
