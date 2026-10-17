-- Browser-safe Agron cart catalog. The assignment flow needs only the
-- sku/size UPC key and non-sensitive product identifiers; stock and wholesale
-- catalog details remain service-role-only.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agron_inventory'
      and policyname = 'agron_inventory_staff_cart_read'
  ) then
    create policy agron_inventory_staff_cart_read
      on public.agron_inventory
      for select
      to authenticated
      using (public.is_team_member());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agron_products_staging'
      and policyname = 'agron_products_staff_cart_read'
  ) then
    create policy agron_products_staff_cart_read
      on public.agron_products_staging
      for select
      to authenticated
      using (public.is_team_member());
  end if;
end
$$;

revoke all on public.agron_inventory from authenticated;
revoke all on public.agron_products_staging from authenticated;
grant select (sku, size, upc) on public.agron_inventory to authenticated;
grant select (code, product_number) on public.agron_products_staging to authenticated;

create or replace view public.agron_cart_catalog
with (security_invoker = true) as
select
  inventory.sku,
  inventory.size,
  inventory.upc,
  products.product_number,
  inventory.sku as color_code
from public.agron_inventory as inventory
left join public.agron_products_staging as products
  on products.code = inventory.sku;

revoke all on public.agron_cart_catalog from anon;
grant select on public.agron_cart_catalog to authenticated;
