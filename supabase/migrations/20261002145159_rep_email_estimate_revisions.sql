-- Read-only, consistent graph for review. RPCs are service-only and invoker.
create function public.rep_email_estimate_snapshot(p_estimate_id text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'estimate',to_jsonb(e),
  'customer',(select jsonb_build_object('id',c.id,'name',c.name,'tax_rate',c.tax_rate,'tax_exempt',c.tax_exempt) from public.customers c where c.id=e.customer_id),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.item_index,i.id) from public.estimate_items i where i.estimate_id=e.id),'[]'::jsonb),
  'decorations',coalesce((select jsonb_agg(to_jsonb(d) order by d.estimate_item_id,d.deco_index,d.id) from public.estimate_item_decorations d join public.estimate_items i on i.id=d.estimate_item_id where i.estimate_id=e.id),'[]'::jsonb),
  'art',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.estimate_art_files a where a.estimate_id=e.id),'[]'::jsonb),
  'sales_orders',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status) order by s.id) from public.sales_orders s where s.estimate_id=e.id),'[]'::jsonb)
 ) from public.estimates e where e.id=p_estimate_id
$$;
revoke all on function public.rep_email_estimate_snapshot(text) from public,anon,authenticated;
grant execute on function public.rep_email_estimate_snapshot(text) to service_role;

create table public.rep_email_estimate_revisions (
 id uuid primary key default gen_random_uuid(),
 team_member_id text not null references public.team_members(id),
 gmail_thread_id text not null,
 source_insight_id text not null references public.rep_email_insights(id),
 original_estimate_id text not null references public.estimates(id),
 revised_estimate_id text not null references public.estimates(id),
 request_key text not null,
 before_snapshot jsonb not null,
 removed_items jsonb not null,
 created_at timestamptz not null default now(),
 unique(team_member_id,gmail_thread_id,request_key)
);
create index rep_email_revisions_source_idx on public.rep_email_estimate_revisions(source_insight_id);
create index rep_email_revisions_original_idx on public.rep_email_estimate_revisions(original_estimate_id);
create index rep_email_revisions_revised_idx on public.rep_email_estimate_revisions(revised_estimate_id);
alter table public.rep_email_estimate_revisions enable row level security;
revoke all on public.rep_email_estimate_revisions from public,anon,authenticated;
grant select on public.rep_email_estimate_revisions to authenticated;
grant all on public.rep_email_estimate_revisions to service_role;
create policy rep_email_revisions_owner_read on public.rep_email_estimate_revisions for select to authenticated using (
 team_member_id=(select tm.id from public.team_members tm where tm.auth_id=(select auth.uid()) and tm.is_active is not false limit 1)
);

create function public.create_rep_email_revision(p_work_id uuid,p_owner text,p_revision uuid)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.rep_email_work%rowtype; original public.estimates%rowtype;
 r jsonb; snap jsonb; removed jsonb; item jsonb; art jsonb; deco jsonb; header jsonb;
 eid text; prior text; key text; n bigint; new_item_id bigint; new_art_id text;
 art_map jsonb:='{}'; item_cols text; deco_cols text; idx integer:=0;
begin
 if p_owner<>'00000000-0000-0000-0000-000000000001' then raise exception 'Pilot owner only'; end if;
 select * into w from public.rep_email_work where id=p_work_id and team_member_id=p_owner for update;
 if not found then raise exception 'Prepared request not found'; end if;
 if w.revision<>p_revision or w.status<>'ready' then raise exception 'Request changed. Re-read and review again.'; end if;
 if not exists(select 1 from public.rep_email_insights where id=w.source_insight_id and team_member_id=p_owner and customer_id=w.customer_id and status<>'dismissed') then raise exception 'Email account or status changed'; end if;
 r:=w.prepared->'estimate_revision';
 if r->>'state'='created' then return r->>'revised_estimate_id'; end if;
 if r->>'state' is distinct from 'ready' or r->>'kind' is distinct from 'remove_items' then raise exception 'No reviewed removal proposal'; end if;
 select * into original from public.estimates where id=r->>'estimate_id' for update;
 if not found or original.customer_id is distinct from w.customer_id or original.deleted_at is not null then raise exception 'Estimate is unavailable for this customer'; end if;
 if original.status not in ('open','sent','draft') then raise exception 'Estimate status changed. Review in the editor.'; end if;
 if exists(select 1 from public.sales_orders where estimate_id=original.id) then raise exception 'Already converted to a sales order. Review that order.'; end if;
 snap:=public.rep_email_estimate_snapshot(original.id);
 if snap is distinct from r->'snapshot' then raise exception 'Estimate changed. Re-read and review the new totals.'; end if;
 if original.promo_applied or original.credit_applied or jsonb_array_length(coalesce(original.deco_pos,'[]'))>0 then raise exception 'Promotions, credits or decoration POs require manual review'; end if;
 removed:=r->'removed';
 if jsonb_typeof(removed) is distinct from 'array' or jsonb_array_length(removed)=0 or jsonb_array_length(removed)>=jsonb_array_length(snap->'items') then raise exception 'Invalid removal'; end if;
 for item in select value from jsonb_array_elements(removed) loop
  if not exists(select 1 from jsonb_array_elements(snap->'items') i where i.value=item) then raise exception 'Removal line changed'; end if;
 end loop;
 key:=md5(snap::text||(select jsonb_agg(value->'id' order by (value->>'id')::bigint)::text from jsonb_array_elements(removed)));
 select revised_estimate_id into prior from public.rep_email_estimate_revisions where team_member_id=p_owner and gmail_thread_id=w.gmail_thread_id and request_key=key;
 if prior is not null then
  update public.rep_email_work set prepared=jsonb_set(prepared,'{estimate_revision}',r||jsonb_build_object('state','created','revised_estimate_id',prior)),updated_at=now() where id=w.id;
  return prior;
 end if;
 perform pg_advisory_xact_lock(hashtext('rep_email_estimate_number'));
 select greatest(coalesce(max(substring(id from '^EST-([0-9]+)$')::bigint),1000),1000)+1 into n from public.estimates where id ~ '^EST-[0-9]+$';
 header:=to_jsonb(original)||jsonb_build_object('status','draft','created_by',p_owner,'created_at',now()::text,'updated_at',now(),'_version',1,'memo',left(coalesce(original.memo,'')||E'\nRevision of '||original.id||' — email removal reviewed; original preserved.',2000),'email_status',null,'email_sent_at',null,'email_opened_at',null,'email_viewed_at',null,'approved_at',null,'approved_by',null,'sent_history','[]'::jsonb,'print_history','[]'::jsonb,'update_requests',null,'follow_up_auto',false,'follow_up_at',null,'follow_up_count',0,'follow_up_last_sent_at',null,'source_inbox_message_id',null);
 loop
  eid:='EST-'||n;
  begin
   insert into public.estimates select (jsonb_populate_record(null::public.estimates,header||jsonb_build_object('id',eid))).*;
   exit;
  exception when unique_violation then n:=n+1;
  end;
 end loop;
 for art in select value from jsonb_array_elements(snap->'art') loop
  new_art_id:='af-email-'||gen_random_uuid()::text;
  art_map:=art_map||jsonb_build_object(art->>'id',new_art_id);
  insert into public.estimate_art_files select (jsonb_populate_record(null::public.estimate_art_files,art||jsonb_build_object('id',new_art_id,'estimate_id',eid,'_version',1))).*;
 end loop;
 -- Copy every persisted item/deco field except generated row ids. Shared files
 -- remain references; cloned artwork ids and stable line ids are independent.
 select string_agg(quote_ident(column_name),',' order by ordinal_position) into item_cols from information_schema.columns where table_schema='public' and table_name='estimate_items' and column_name<>'id';
 select string_agg(quote_ident(column_name),',' order by ordinal_position) into deco_cols from information_schema.columns where table_schema='public' and table_name='estimate_item_decorations' and column_name<>'id';
 for item in select value from jsonb_array_elements(snap->'items') loop
  if exists(select 1 from jsonb_array_elements(removed) x where x.value->>'id'=item->>'id') then continue; end if;
  execute format('insert into public.estimate_items (%s) select %s from jsonb_populate_record(null::public.estimate_items,$1) returning id',item_cols,item_cols)
   into new_item_id using item||jsonb_build_object('estimate_id',eid,'item_index',idx,'line_id',gen_random_uuid());
  for deco in select value from jsonb_array_elements(snap->'decorations') where value->>'estimate_item_id'=item->>'id' loop
   execute format('insert into public.estimate_item_decorations (%s) select %s from jsonb_populate_record(null::public.estimate_item_decorations,$1)',deco_cols,deco_cols)
    using deco||jsonb_build_object('estimate_item_id',new_item_id,'art_file_id',coalesce(art_map->>(deco->>'art_file_id'),deco->>'art_file_id'),'custom_font_art_id',coalesce(art_map->>(deco->>'custom_font_art_id'),deco->>'custom_font_art_id'));
  end loop;
  idx:=idx+1;
 end loop;
 insert into public.rep_email_estimate_revisions(team_member_id,gmail_thread_id,source_insight_id,original_estimate_id,revised_estimate_id,request_key,before_snapshot,removed_items)
 values(p_owner,w.gmail_thread_id,w.source_insight_id,original.id,eid,key,snap,removed);
 update public.rep_email_work set prepared=jsonb_set(prepared,'{estimate_revision}',r||jsonb_build_object('state','created','revised_estimate_id',eid)),updated_at=now() where id=w.id;
 return eid;
end $$;
revoke all on function public.create_rep_email_revision(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_rep_email_revision(uuid,text,uuid) to service_role;
