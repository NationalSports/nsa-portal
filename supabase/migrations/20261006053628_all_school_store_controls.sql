-- Keep normal Team/Club defaults. 24/7 shipment estimates remain in
-- all_school_settings.target_ship_days, frozen on paid orders.
alter table public.webstores drop constraint if exists webstores_delivery_window_weeks_check;
alter table public.webstores add constraint webstores_delivery_window_weeks_check
 check (delivery_window_weeks in ('2-2','2-3','3-4','4-5','5-6'));

-- Also repairs installations missing the older alert migrations.
alter table public.webstore_transfers add column if not exists low_stock_notified_at timestamptz;
alter table public.webstore_transfers add column if not exists low_stock_threshold integer not null default 10
 check (low_stock_threshold >= 0);
alter table public.teamshop_settings add column if not exists backorder_alert_email text;

-- Inventory counts, incoming receipts and alert stamps do not change artwork.
-- Only changes to the production definition invalidate a reviewed offering.
create or replace function public.invalidate_all_school_transfer_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
 foreach k in array array['code','kind','tsize','color','digit','production_file','width_in','height_in','application_method','application_instructions','artwork_version','supplier_id','decoration_type'] loop
  if to_jsonb(new)->k is distinct from to_jsonb(old)->k then
   update public.webstore_products set production_approved_at=null,production_approved_by=null
    where store_id=new.store_id and (transfer_code=old.code or old.code=any(transfer_codes)
      or (old.kind='number' and takes_number=true));
   exit;
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.invalidate_all_school_transfer_approval() from public,anon,authenticated;

-- Enforce launch readiness at the database so reopening via a date edit or
-- another client cannot bypass the approval gate. Existing regular stores
-- and their launch workflow are deliberately unaffected.
create or replace function public.check_all_school_store_launch()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.org_type is distinct from 'all_school' then return new; end if;
 new.delivery_mode := 'ship_home';
 if new.status <> 'open' then return new; end if;
 if tg_op='UPDATE' then
  if old.status='open' and old.org_type='all_school' then return new; end if;
 end if;
 if not exists(select 1 from public.webstore_products where store_id=new.id and active is distinct from false) then
  raise exception 'Add at least one active offering before launching this 24/7 store.';
 end if;
 if exists(select 1 from public.webstore_products where store_id=new.id and active is distinct from false
  and (production_approved_at is null or nullif(btrim(production_approved_by),'') is null or nullif(btrim(image_url),'') is null)) then
  raise exception 'Complete and approve production art for every active offering before launching this 24/7 store. Review setups in Sports & collections.';
 end if;
 return new;
end $$;
revoke all on function public.check_all_school_store_launch() from public,anon,authenticated;
create trigger check_all_school_store_launch before insert or update on public.webstores
for each row execute function public.check_all_school_store_launch();
