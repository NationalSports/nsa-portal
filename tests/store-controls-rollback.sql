-- Run after the store-controls migration. Fixtures and changes are rolled back.
begin;

do $test$
declare sid uuid:=gen_random_uuid(); pid uuid; tid uuid; regular_id uuid:=gen_random_uuid(); blocked boolean; approved timestamptz;
begin
 insert into public.webstores(id,slug,name,store_code,org_type,status,delivery_mode,delivery_window_weeks)
 values(sid,'controls-test-'||sid,'Rollback-only controls test','TEST-'||sid,'all_school','draft','deliver_club','2-2');
 if (select delivery_mode from public.webstores where id=sid)<>'ship_home' then raise exception 'Home shipping not enforced'; end if;
 blocked:=false;
 begin update public.webstores set status='open' where id=sid;
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Empty catalog incorrectly launched'; end if;
 insert into public.webstore_products(store_id,sku,retail_price,image_url,active,transfer_codes)
 values(sid,'TEST',10,'test.png',true,array['TEST']) returning id into pid;
 blocked:=false;
 begin update public.webstores set status='open' where id=sid;
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Unapproved art incorrectly launched'; end if;
 update public.webstore_products set production_approved_at=now(),production_approved_by='test' where id=pid;
 update public.webstores set status='open' where id=sid;
 if (select status from public.webstores where id=sid)<>'open' then raise exception 'Approved launch failed'; end if;
 insert into public.webstore_transfers(store_id,code,label,kind,on_hand) values(sid,'TEST','Test','design',5) returning id into tid;
 update public.webstore_transfers set incoming=10,low_stock_threshold=20,low_stock_notified_at=now() where id=tid;
 select production_approved_at into approved from public.webstore_products where id=pid;
 if approved is null then raise exception 'Inventory-only update invalidated art'; end if;
 update public.webstore_transfers set width_in=12 where id=tid;
 if (select production_approved_at from public.webstore_products where id=pid) is not null then raise exception 'Art change failed to invalidate approval'; end if;
 update public.webstores set status='closed' where id=sid;
 blocked:=false;
 begin update public.webstores set status='open' where id=sid;
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Reopen bypassed art approval'; end if;
 insert into public.webstores(id,slug,name,store_code,org_type,status,delivery_mode)
 values(regular_id,'controls-test-'||regular_id,'Rollback-only regular test','TEST-'||regular_id,'team','draft','deliver_club');
 update public.webstores set status='open' where id=regular_id;
 if (select delivery_mode from public.webstores where id=regular_id)<>'deliver_club' then raise exception 'Regular delivery changed'; end if;
end $test$;
select 'all launch, shipping, and approval invalidation checks passed' as verification;

rollback;
