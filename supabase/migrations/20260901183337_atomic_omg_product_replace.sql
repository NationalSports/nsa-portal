-- Replace an OMG store's product snapshot atomically. The former client flow
-- inserted the new rows and then deleted the old ids in separate requests. Two
-- overlapping autosaves could both insert before either delete, leaving complete
-- duplicate snapshots (SO-2277's source store had four copies of 28 lines).
create or replace function public.replace_omg_store_products(
  p_store_id text,
  p_products jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_team_member() then
    raise exception 'staff authentication required' using errcode = '42501';
  end if;
  if p_store_id is null or btrim(p_store_id) = '' then
    raise exception 'store id is required' using errcode = '22023';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'products must be a JSON array' using errcode = '22023';
  end if;

  -- Serialize saves for this store; DELETE + INSERT are one transaction, so an
  -- insert error restores the prior snapshot automatically.
  perform pg_advisory_xact_lock(hashtext(p_store_id));
  delete from public.omg_store_products where store_id = p_store_id;

  insert into public.omg_store_products
    (store_id, sku, name, color, retail, cost, deco_type, deco_cost, sizes,
     image_url, manufacturer, vendor_id, art_group, _cost_source, art_ready,
     art_cust_ids)
  select
    p_store_id,
    x.sku, x.name, x.color, x.retail, x.cost, x.deco_type, x.deco_cost,
    coalesce(x.sizes, '{}'::jsonb), x.image_url, x.manufacturer, x.vendor_id,
    x.art_group, x._cost_source, coalesce(x.art_ready, false), x.art_cust_ids
  from jsonb_to_recordset(p_products) as x(
    sku text, name text, color text, retail numeric, cost numeric,
    deco_type text, deco_cost numeric, sizes jsonb, image_url text,
    manufacturer text, vendor_id text, art_group text, _cost_source text,
    art_ready boolean, art_cust_ids text
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_omg_store_products(text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_omg_store_products(text, jsonb) to authenticated;
