\set ON_ERROR_STOP 1
\set QUIET 1

-- ═══ Scenario 1: happy path — order + items + claim + hold, defaults fire ═══
do $$
declare r jsonb; oid uuid; n int;
begin
  r := place_webstore_order(
    p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"pending_payment","payment_mode":"paid","order_kind":"individual","buyer_name":"Pat","buyer_email":"pat@example.com","subtotal":40,"total":43.5,"shipping_fee":0,"processing_fee":2,"tax":1.5,"client_ref":"ref-scenario-1-aaaaaaaa"}'::jsonb,
    p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":2,"unit_price":20,"name":"Tee"},{"product_id":"p1","sku":"TEE","size":"M","qty":1,"unit_price":20,"player_number":"10","player_name":"Sam"}]'::jsonb,
    p_claims => '[{"player_number":"10","player_name":"Sam"}]'::jsonb,
    p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":2,"max_avail":3,"label":"Tee (size L)"}]'::jsonb,
    p_hold_minutes => 30);
  oid := (r->'order'->>'id')::uuid;
  if oid is null then raise exception 'S1: no order id returned'; end if;
  if (r->'order'->>'status_token') is null then raise exception 'S1: status_token default did not fire'; end if;
  if (r->'order'->>'created_at') is null then raise exception 'S1: created_at default did not fire'; end if;
  select count(*) into n from webstore_order_items where order_id = oid;
  if n <> 2 then raise exception 'S1: expected 2 items, found %', n; end if;
  select count(*) into n from webstore_number_claims where order_id = oid and player_number = '10';
  if n <> 1 then raise exception 'S1: claim missing'; end if;
  select count(*) into n from webstore_stock_holds where order_id = oid and qty = 2
    and expires_at between now() + interval '29 minutes' and now() + interval '31 minutes';
  if n <> 1 then raise exception 'S1: hold missing or wrong expiry'; end if;
  raise notice 'S1 happy path: OK';
end $$;

-- ═══ Scenario 2: taken number aborts EVERYTHING (no orphan order/items/holds) ═══
do $$
declare n int; before_orders int; before_items int; before_holds int;
begin
  select count(*) into before_orders from webstore_orders;
  select count(*) into before_items from webstore_order_items;
  select count(*) into before_holds from webstore_stock_holds;
  begin
    perform place_webstore_order(
      p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Sky","subtotal":20,"total":20}'::jsonb,
      p_items  => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20,"player_number":"10"}]'::jsonb,
      p_claims => '[{"player_number":"10","player_name":"Riley"}]'::jsonb,
      p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"S","qty":1,"max_avail":5}]'::jsonb);
    raise exception 'S2: expected NSA_NUMBER_TAKEN, got success';
  exception when others then
    if sqlerrm not like 'NSA_NUMBER_TAKEN:10%' then raise exception 'S2: wrong error: %', sqlerrm; end if;
  end;
  select count(*) into n from webstore_orders;
  if n <> before_orders then raise exception 'S2: orphan order left behind'; end if;
  select count(*) into n from webstore_order_items;
  if n <> before_items then raise exception 'S2: orphan items left behind'; end if;
  select count(*) into n from webstore_stock_holds;
  if n <> before_holds then raise exception 'S2: orphan holds left behind'; end if;
  raise notice 'S2 number-taken rollback: OK';
end $$;

-- ═══ Scenario 3: sold out — active holds + new qty exceed max_avail, full rollback ═══
do $$
declare n int; before_orders int;
begin
  select count(*) into before_orders from webstore_orders;
  -- S1 holds 2 of max 3 for size L; asking 2 more must fail.
  begin
    perform place_webstore_order(
      p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Lee","subtotal":40,"total":40}'::jsonb,
      p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":2,"unit_price":20}]'::jsonb,
      p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":2,"max_avail":3,"label":"Tee (size L)"}]'::jsonb);
    raise exception 'S3: expected NSA_SOLD_OUT, got success';
  exception when others then
    if sqlerrm not like 'NSA_SOLD_OUT:Tee (size L)%' then raise exception 'S3: wrong error: %', sqlerrm; end if;
  end;
  select count(*) into n from webstore_orders;
  if n <> before_orders then raise exception 'S3: orphan order left behind'; end if;
  -- 1 more of size L still fits (2 held + 1 = 3 = max)
  perform place_webstore_order(
    p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Lee","subtotal":20,"total":20}'::jsonb,
    p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":1,"unit_price":20}]'::jsonb,
    p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":1,"max_avail":3}]'::jsonb);
  raise notice 'S3 sold-out boundary: OK';
end $$;

-- ═══ Scenario 4: expired pending holds release, accepted demand stays reserved ═══
do $$
begin
  update webstore_stock_holds set expires_at = now() - interval '1 minute';
  -- S3's accepted unpaid order still reserves one L from its live item even
  -- though its short checkout hold has expired, so three more cannot fit.
  begin
    perform place_webstore_order(
      p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Blocked","subtotal":60,"total":60}'::jsonb,
      p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":3,"unit_price":20}]'::jsonb,
      p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":3,"max_avail":3,"label":"Tee (size L)"}]'::jsonb);
    raise exception 'S4: expected accepted demand to stay reserved';
  exception when others then
    if sqlerrm not like 'NSA_SOLD_OUT:Tee (size L)%' then raise exception 'S4: wrong error: %', sqlerrm; end if;
  end;

  -- Once that accepted order is cancelled, its live demand releases and all
  -- three units become sellable again.
  update webstore_orders set status = 'cancelled'
   where buyer_name = 'Lee' and status = 'unpaid' and so_id is null;
  perform place_webstore_order(
    p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Max","subtotal":60,"total":60}'::jsonb,
    p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":3,"unit_price":20}]'::jsonb,
    p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":3,"max_avail":3}]'::jsonb);

  -- New checkout callers pass the gross pool too. That keeps full demand
  -- reserved after conversion, even before/without an auto-PO ledger write.
  update webstore_stock_holds set expires_at = now() - interval '1 minute';
  insert into sales_orders (id, status) values ('SO-LIFECYCLE', 'waiting_receive');
  update webstore_orders set status = 'batched', so_id = 'SO-LIFECYCLE'
   where buyer_name = 'Max' and status = 'unpaid';
  begin
    perform place_webstore_order(
      p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Still Blocked","subtotal":20,"total":20}'::jsonb,
      p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":1,"unit_price":20}]'::jsonb,
      p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":1,"max_avail":3,"gross_max_avail":3,"label":"Tee (size L)"}]'::jsonb);
    raise exception 'S4: expected unfinished SO demand to stay reserved';
  exception when others then
    if sqlerrm not like 'NSA_SOLD_OUT:Tee (size L)%' then raise exception 'S4: wrong converted error: %', sqlerrm; end if;
  end;

  -- A finished SO releases the production reservation.
  update sales_orders set status = 'complete' where id = 'SO-LIFECYCLE';
  perform place_webstore_order(
    p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"After Complete","subtotal":60,"total":60}'::jsonb,
    p_items  => '[{"product_id":"p1","sku":"TEE","size":"L","qty":3,"unit_price":20}]'::jsonb,
    p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"L","qty":3,"max_avail":3,"gross_max_avail":3}]'::jsonb);
  raise notice 'S4 durable accepted + unfinished-SO demand and releases: OK';
end $$;

-- ═══ Scenario 5: duplicate client_ref aborts the transaction (idempotency backstop) ═══
do $$
declare before_orders int; n int;
begin
  select count(*) into before_orders from webstore_orders;
  begin
    perform place_webstore_order(
      p_order => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Dupe","subtotal":20,"total":20,"client_ref":"ref-scenario-1-aaaaaaaa"}'::jsonb,
      p_items => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20}]'::jsonb);
    raise exception 'S5: expected unique violation, got success';
  exception when unique_violation then null;
  end;
  select count(*) into n from webstore_orders;
  if n <> before_orders then raise exception 'S5: orphan order left behind'; end if;
  raise notice 'S5 client_ref dedup backstop: OK';
end $$;

-- ═══ Scenario 6: order delete cascades holds + claims + items (PI-failure rollback path) ═══
do $$
declare oid uuid; n int; r jsonb;
begin
  r := place_webstore_order(
    p_order  => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"pending_payment","payment_mode":"paid","buyer_name":"Cas","subtotal":20,"total":20}'::jsonb,
    p_items  => '[{"product_id":"p1","sku":"TEE","size":"XL","qty":1,"unit_price":20,"player_number":"42"}]'::jsonb,
    p_claims => '[{"player_number":"42","player_name":"Cas"}]'::jsonb,
    p_holds  => '[{"webstore_product_id":"00000000-0000-0000-0000-0000000000aa","size":"XL","qty":1,"max_avail":9}]'::jsonb);
  oid := (r->'order'->>'id')::uuid;
  delete from webstore_orders where id = oid;
  select count(*) into n from webstore_order_items where order_id = oid;
  if n <> 0 then raise exception 'S6: items did not cascade'; end if;
  select count(*) into n from webstore_number_claims where order_id = oid;
  if n <> 0 then raise exception 'S6: claims did not cascade'; end if;
  select count(*) into n from webstore_stock_holds where order_id = oid;
  if n <> 0 then raise exception 'S6: holds did not cascade'; end if;
  raise notice 'S6 cascade on rollback delete: OK';
end $$;

-- ═══ Scenario 7: coupon quota is atomic; failed pending attempts release ═══
do $$
declare r jsonb; oid uuid; n int;
begin
  perform place_webstore_order(
    p_order => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Coupon Winner","coupon_code":"LAST","discount_amt":2,"subtotal":20,"total":18}'::jsonb,
    p_items => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20}]'::jsonb);
  select used_count into n from webstore_coupons where code = 'LAST';
  if n <> 1 then raise exception 'S7: first coupon claim was not counted'; end if;

  begin
    perform place_webstore_order(
      p_order => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"Coupon Loser","coupon_code":"LAST","discount_amt":2,"subtotal":20,"total":18}'::jsonb,
      p_items => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20}]'::jsonb);
    raise exception 'S7: expected max-use coupon to reject the second order';
  exception when others then
    if sqlerrm not like 'NSA_COUPON_USED%' then raise exception 'S7: wrong coupon error: %', sqlerrm; end if;
  end;

  r := place_webstore_order(
    p_order => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"pending_payment","payment_mode":"paid","buyer_name":"Pending Coupon","coupon_code":"PEND","discount_amt":2,"subtotal":20,"total":18}'::jsonb,
    p_items => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20}]'::jsonb);
  oid := (r->'order'->>'id')::uuid;
  delete from webstore_orders where id = oid;
  select used_count into n from webstore_coupons where code = 'PEND';
  if n <> 0 then raise exception 'S7: deleted pending reservation was not released'; end if;

  perform place_webstore_order(
    p_order => '{"store_id":"00000000-0000-0000-0000-000000000001","status":"unpaid","payment_mode":"unpaid","buyer_name":"After Release","coupon_code":"PEND","discount_amt":2,"subtotal":20,"total":18}'::jsonb,
    p_items => '[{"product_id":"p1","sku":"TEE","size":"S","qty":1,"unit_price":20}]'::jsonb);
  raise notice 'S7 atomic coupon quota + pending release: OK';
end $$;

\echo ALL_SCENARIOS_PASSED
