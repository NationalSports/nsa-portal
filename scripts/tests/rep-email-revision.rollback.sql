-- Run after the migration in a transaction; this script always rolls back.
-- Uses synthetic email/estimate records and never revises a customer estimate.
do $$
declare owner_id text:='00000000-0000-0000-0000-000000000001'; wid uuid; rev uuid:=gen_random_uuid();
 snap jsonb; proposal jsonb; backpack_id bigint; polo_id bigint; eid text; retry_id text; before_count bigint; rejected boolean;
begin
 insert into public.rep_email_insights(id,team_member_id,gmail_message_id,gmail_thread_id,sender_email,customer_id,status)
 values('test-email-revision-rollback',owner_id,'test-email-revision-rollback','test-thread-revision-rollback','test@example.invalid','c-ns-2886','new');
 insert into public.estimates(id,customer_id,status,created_by,memo,default_markup,shipping_type,shipping_value,_version)
 values('EST-REVISION-ROLLBACK','c-ns-2886','open',owner_id,'Synthetic rollback fixture',1.65,'pct',5,1);
 insert into public.estimate_items(estimate_id,item_index,sku,name,color,unit_sell,sizes,line_id)
 values('EST-REVISION-ROLLBACK',0,'5159394','Adidas Defender 5 Backpack','Black/Black',34.75,'{"OSFA":15}',gen_random_uuid()) returning id into backpack_id;
 insert into public.estimate_items(estimate_id,item_index,sku,name,unit_sell,sizes,line_id)
 values('EST-REVISION-ROLLBACK',1,'POLO','Polo',32.5,'{"M":5}',gen_random_uuid()) returning id into polo_id;
 insert into public.estimate_art_files(id,estimate_id,name,deco_type,ink_colors,_version)
 values('af-revision-rollback','EST-REVISION-ROLLBACK','Test embroidery','embroidery',1,1);
 insert into public.estimate_item_decorations(estimate_item_id,deco_index,kind,art_file_id,sell_override)
 values(polo_id,0,'art','af-revision-rollback',9);
 snap:=public.rep_email_estimate_snapshot('EST-REVISION-ROLLBACK');
 proposal:=jsonb_build_object('kind','remove_items','state','ready','estimate_id','EST-REVISION-ROLLBACK','snapshot',snap,'removed',jsonb_build_array((select to_jsonb(i) from public.estimate_items i where id=backpack_id)));
 insert into public.rep_email_work(team_member_id,gmail_thread_id,source_insight_id,customer_id,status,revision,prepared)
 values(owner_id,'test-thread-revision-rollback','test-email-revision-rollback','c-ns-2886','ready',rev,jsonb_build_object('estimate_revision',proposal)) returning id into wid;
 select count(*) into before_count from public.estimates;
 rejected:=false;
 begin perform public.create_rep_email_revision(wid,'other-owner',rev); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Owner isolation failed'; end if;
 rejected:=false;
 begin perform public.create_rep_email_revision(wid,owner_id,gen_random_uuid()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale work revision accepted'; end if;
 -- Wrong status and stale graph fail without leaving a partial draft.
 update public.estimates set status='approved' where id='EST-REVISION-ROLLBACK';
 rejected:=false;
 begin perform public.create_rep_email_revision(wid,owner_id,rev); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Approved quote accepted'; end if;
 update public.estimates set status='open',memo='Changed after review' where id='EST-REVISION-ROLLBACK';
 rejected:=false;
 begin perform public.create_rep_email_revision(wid,owner_id,rev); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale snapshot accepted'; end if;
 update public.estimates set memo='Synthetic rollback fixture' where id='EST-REVISION-ROLLBACK';
 snap:=public.rep_email_estimate_snapshot('EST-REVISION-ROLLBACK');
 proposal:=jsonb_set(proposal,'{snapshot}',snap);
 update public.rep_email_work set prepared=jsonb_build_object('estimate_revision',proposal) where id=wid;
 insert into public.sales_orders(id,customer_id,estimate_id,status) values('SO-REVISION-ROLLBACK','c-ns-2886','EST-REVISION-ROLLBACK','need_order');
 rejected:=false;
 begin perform public.create_rep_email_revision(wid,owner_id,rev); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Converted estimate accepted'; end if;
 delete from public.sales_orders where id='SO-REVISION-ROLLBACK';
 if (select count(*) from public.estimates)<>before_count then raise exception 'Rejected request left a draft'; end if;
 eid:=public.create_rep_email_revision(wid,owner_id,rev);
 if (select status from public.estimates where id=eid)<>'draft' then raise exception 'Not a draft'; end if;
 if (select count(*) from public.estimate_items where estimate_id=eid)<>1 then raise exception 'Wrong revised line count'; end if;
 if exists(select 1 from public.estimate_items where estimate_id=eid and sku='5159394') then raise exception 'Backpack retained'; end if;
 if public.rep_email_estimate_snapshot('EST-REVISION-ROLLBACK')<>snap then raise exception 'Original changed'; end if;
 if not exists(select 1 from public.estimate_item_decorations d join public.estimate_items i on i.id=d.estimate_item_id join public.estimate_art_files a on a.id=d.art_file_id where i.estimate_id=eid and a.estimate_id=eid and d.sell_override=9) then raise exception 'Decoration/art copy broken'; end if;
 retry_id:=public.create_rep_email_revision(wid,owner_id,rev);
 if retry_id<>eid then raise exception 'Click retry duplicated revision'; end if;
 -- A fresh preparation of the same removal must return the same saved draft.
 update public.rep_email_work set prepared=jsonb_build_object('estimate_revision',proposal) where id=wid;
 retry_id:=public.create_rep_email_revision(wid,owner_id,rev);
 if retry_id<>eid or (select count(*) from public.estimates)<>before_count+1 then raise exception 'Follow-up duplicated revision'; end if;
 if (select count(*) from public.rep_email_estimate_revisions where gmail_thread_id='test-thread-revision-rollback')<>1 then raise exception 'Duplicate audit records'; end if;
 if has_function_privilege('authenticated','public.create_rep_email_revision(uuid,text,uuid)','execute') or has_function_privilege('anon','public.rep_email_estimate_snapshot(text)','execute') then raise exception 'Public RPC grants'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select auth_id::text from public.team_members where id='00000000-0000-0000-0000-000000000001'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.rep_email_estimate_revisions where gmail_thread_id='test-thread-revision-rollback')<>1 then raise exception 'Owner cannot read revision'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.rep_email_estimate_revisions where gmail_thread_id='test-thread-revision-rollback') then raise exception 'Non-owner can read revision'; end if;
end $$;
reset role;
select 'revision rollback checks passed' as result;
rollback;
