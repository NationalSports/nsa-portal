-- Private, durable email preparation. One working draft per rep + Gmail thread.
create table public.rep_email_work (
 id uuid primary key default gen_random_uuid(),
 team_member_id text not null references public.team_members(id) on delete cascade,
 gmail_thread_id text not null,
 source_insight_id text not null references public.rep_email_insights(id) on delete cascade,
 source_received_at timestamptz,
 customer_id text references public.customers(id) on delete set null,
 status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
 revision uuid not null default gen_random_uuid(),
 prepared jsonb not null default '{}'::jsonb,
 estimate_id text references public.estimates(id) on delete restrict,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(team_member_id,gmail_thread_id)
);
create index rep_email_work_source_idx on public.rep_email_work(source_insight_id);
create index rep_email_work_customer_idx on public.rep_email_work(customer_id);
create index rep_email_work_estimate_idx on public.rep_email_work(estimate_id);
alter table public.rep_email_work enable row level security;
revoke all on public.rep_email_work from public,anon,authenticated;
grant select on public.rep_email_work to authenticated;
grant all on public.rep_email_work to service_role;
create policy rep_email_work_owner_read on public.rep_email_work for select to authenticated using (
 team_member_id=(select tm.id from public.team_members tm where tm.auth_id=(select auth.uid()) and tm.is_active is not false limit 1)
);
-- Service-only, invoker function: creates header + lines + thread link in ONE
-- transaction. Repeated clicks and concurrent tabs return the same estimate.
create function public.create_rep_email_estimate(p_work_id uuid,p_owner text,p_revision uuid)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.rep_email_work%rowtype; line jsonb; eid text; n bigint; idx int:=0;
begin
 select * into w from public.rep_email_work where id=p_work_id and team_member_id=p_owner for update;
 if not found then raise exception 'Prepared request not found'; end if;
 if w.estimate_id is not null then return w.estimate_id; end if;
 if w.revision<>p_revision or w.status<>'ready' then raise exception 'Request changed. Reload before creating the estimate.'; end if;
 if w.customer_id is null then raise exception 'Choose the customer account first'; end if;
 if jsonb_array_length(coalesce(w.prepared->'lines','[]'))=0 then raise exception 'No estimate lines'; end if;
 for line in select value from jsonb_array_elements(w.prepared->'lines') loop
  if line->'product'->>'id' is null then raise exception 'Choose each catalog product before creating the estimate'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtext('rep_email_estimate_number'));
 select greatest(coalesce(max(substring(id from '^EST-([0-9]+)$')::bigint),1000),1000)+1 into n from public.estimates where id ~ '^EST-[0-9]+$';
 loop
  eid:='EST-'||n;
  begin
   insert into public.estimates(id,customer_id,memo,status,created_by,created_at,updated_at,default_markup,shipping_type,shipping_value,ship_to_id)
   values(eid,w.customer_id,left('Email draft: '||coalesce(w.prepared->>'title','Customer request')||E'\nReview product matches, decoration, stock, shipping and pricing before sending. '||coalesce(w.prepared->>'notes',''),2000),'draft',p_owner,now()::text,now()::text,
    coalesce((select catalog_markup from public.customers where id=w.customer_id),1.65),'pct',5,'default');
   exit;
  exception when unique_violation then n:=n+1;
  end;
 end loop;
 for line in select value from jsonb_array_elements(w.prepared->'lines') loop
  insert into public.estimate_items(estimate_id,item_index,product_id,sku,name,brand,color,vendor_id,nsa_cost,retail_price,unit_sell,sizes,available_sizes,qty_only,est_qty,notes,no_deco,is_custom)
  values(eid,idx,line->'product'->>'id',line->'product'->>'sku',line->'product'->>'name',line->'product'->>'brand',line->'product'->>'color',line->'product'->>'vendor_id',
    coalesce((line->'pricing'->>'nsa_cost')::numeric,0),coalesce((line->'pricing'->>'retail_price')::numeric,0),coalesce((line->'pricing'->>'unit_sell')::numeric,0),
    coalesce(line->'sizes','{}'),coalesce(line->'product'->'available_sizes','[]'),coalesce(line->'sizes','{}')='{}'::jsonb,(line->>'quantity')::int,
    left('Requested: '||coalesce(line->>'name','')||'. '||coalesce(line->>'evidence','')||' Decoration to review: '||coalesce(line->>'decoration','Not specified'),1500),false,false);
  idx:=idx+1;
 end loop;
 update public.rep_email_work set estimate_id=eid,updated_at=now() where id=w.id;
 update public.rep_email_insights set estimate_id=eid,updated_at=now() where team_member_id=p_owner and gmail_thread_id=w.gmail_thread_id and customer_id=w.customer_id and estimate_id is null;
 return eid;
end $$;
revoke all on function public.create_rep_email_estimate(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_rep_email_estimate(uuid,text,uuid) to service_role;
