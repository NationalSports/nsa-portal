-- The original collation-sensitive upper bound returned no durable receipts in
-- production. Keep the original snapshot implementation, then overlay the
-- three receipt maps using an exact prefix predicate.
alter function public.qbo_sales_source_snapshot(timestamptz)
  rename to qbo_sales_source_snapshot_without_links;

create function public.qbo_sales_source_snapshot(p_source_cutoff timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.qbo_sales_source_snapshot_without_links(p_source_cutoff)
    || jsonb_build_object(
      'customer_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
        select value::jsonb->>'source_id' source_id, value::jsonb row_value
        from public.app_state
        where left(id,12) = '_qb_link_v1_'
          and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='custQBMap'
          and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
      ) x),
      'invoice_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
        select value::jsonb->>'source_id' source_id, value::jsonb row_value
        from public.app_state
        where left(id,12) = '_qb_link_v1_'
          and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbInvoiceMap'
          and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
      ) x),
      'payment_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
        select value::jsonb->>'source_id' source_id, value::jsonb row_value
        from public.app_state
        where left(id,12) = '_qb_link_v1_'
          and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbPaymentMap'
          and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
      ) x)
    );
$$;

revoke all on function public.qbo_sales_source_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.qbo_sales_source_snapshot(timestamptz) to service_role;
