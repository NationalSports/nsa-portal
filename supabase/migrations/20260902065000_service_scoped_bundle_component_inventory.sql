-- Checkout inventory lookup for standalone and bundle-component listings.
--
-- Package components can reference an archived webstore_products card: it is
-- hidden as a standalone storefront item but remains intentionally sellable in
-- the package. The anonymous storefront view filters those cards out. Keep that
-- public posture unchanged and expose the minimum stock projection only to the
-- service-role checkout server.

create or replace function public.get_webstore_checkout_inventory(
  p_store_id uuid,
  p_webstore_product_ids uuid[] default '{}'::uuid[],
  p_product_ids text[] default '{}'::text[]
) returns table (
  webstore_product_id uuid,
  product_id text,
  name text,
  size_stock jsonb,
  vendor_size_stock jsonb,
  vendor_on_hand bigint,
  on_order_qty numeric,
  earliest_eta text,
  vendor_eta text,
  track_inventory boolean,
  inventory_source text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wp.id as webstore_product_id,
    wp.product_id,
    coalesce(wp.display_name, p.name) as name,
    inv.size_stock,
    av.vendor_size_stock,
    coalesce(av.vendor_on_hand, 0::bigint) as vendor_on_hand,
    coalesce(eta_pid.on_order_qty, eta_sku.on_order_qty) as on_order_qty,
    coalesce(eta_pid.earliest_eta, eta_sku.earliest_eta) as earliest_eta,
    av.vendor_eta,
    coalesce(wp.track_inventory, true) as track_inventory,
    p.inventory_source
  from public.webstore_products wp
  left join public.products p on p.id = wp.product_id
  left join lateral (
    select jsonb_object_agg(pi.size, pi.quantity) as size_stock
    from public.product_inventory pi
    where pi.product_id = wp.product_id
  ) inv on true
  left join public.webstore_product_eta eta_pid
    on eta_pid.product_id = wp.product_id
  left join public.webstore_product_eta eta_sku
    on eta_sku.product_id is null and eta_sku.sku = wp.sku
  left join lateral (
    select
      jsonb_object_agg(ai.size, ai.stock_qty) as vendor_size_stock,
      coalesce(sum(greatest(ai.stock_qty, 0)), 0::bigint) as vendor_on_hand,
      min(nullif(ai.future_delivery_date, ''))
        filter (where coalesce(ai.stock_qty, 0) <= 0) as vendor_eta
    from public.inventory_unified ai
    where regexp_replace(upper(ai.sku), '[^A-Z0-9]', '', 'g')
            = regexp_replace(upper(wp.sku), '[^A-Z0-9]', '', 'g')
      and ai.source = p.inventory_source
      and (
        p.available_sizes is null
        or ai.size in (select jsonb_array_elements_text(p.available_sizes))
        or case upper(ai.size)
          when 'ST' then 'S' when 'MT' then 'M' when 'LT' then 'L'
          when 'XLT' then 'XL' when 'XST' then 'XS'
          when '2XLT' then '2XL' when '3XLT' then '3XL'
          when '4XLT' then '4XL' when '5XLT' then '5XL'
          else null
        end in (select jsonb_array_elements_text(p.available_sizes))
      )
  ) av on true
  where wp.store_id = p_store_id
    and (
      wp.id = any(coalesce(p_webstore_product_ids, '{}'::uuid[]))
      or wp.product_id = any(coalesce(p_product_ids, '{}'::text[]))
    );
$$;

revoke all on function public.get_webstore_checkout_inventory(uuid, uuid[], text[]) from public;
revoke all on function public.get_webstore_checkout_inventory(uuid, uuid[], text[]) from anon;
revoke all on function public.get_webstore_checkout_inventory(uuid, uuid[], text[]) from authenticated;
grant execute on function public.get_webstore_checkout_inventory(uuid, uuid[], text[]) to service_role;

comment on function public.get_webstore_checkout_inventory(uuid, uuid[], text[]) is
  'Service-only stock projection for checkout, including archived cards referenced by bundles.';
