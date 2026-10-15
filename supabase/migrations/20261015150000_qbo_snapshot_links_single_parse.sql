-- The hourly QBO sync snapshot took ~60s on 2026-10-15 (limit: 60s service_role
-- statement_timeout). The link layer scanned app_state four times (once per map_key)
-- and re-parsed every _qb_link_v1_ row's JSON several times per scan. Parse the link
-- rows once, filter once, then split by map_key. Output is unchanged: verified
-- identical per map_key on production data (2621/458/798/13 links, no duplicate
-- source_ids, so jsonb_object_agg order cannot matter).
create or replace function public.qbo_sales_source_snapshot_before_unapply(p_source_cutoff timestamp with time zone)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with parsed as materialized (
    select value::jsonb v from public.app_state
    where left(id,12) = '_qb_link_v1_' and value is not null and left(btrim(value),1)='{'
  ), links as materialized (
    select v->>'map_key' mk, v->>'source_id' source_id, v row_value from parsed
    where v->>'map_key' in ('custQBMap','qbInvoiceMap','qbPaymentMap','qbReceiptMap')
      and v->>'realm_id'='9341456492604246' and coalesce((v->>'active')::boolean,true)
  )
  select public.qbo_sales_source_snapshot_without_links(p_source_cutoff)
    || jsonb_build_object(
      'customer_links', (select coalesce(jsonb_object_agg(source_id,row_value),'{}'::jsonb) from links where mk='custQBMap'),
      'invoice_links', (select coalesce(jsonb_object_agg(source_id,row_value),'{}'::jsonb) from links where mk='qbInvoiceMap'),
      'payment_links', (select coalesce(jsonb_object_agg(source_id,row_value),'{}'::jsonb) from links where mk='qbPaymentMap'),
      'receipt_links', (select coalesce(jsonb_object_agg(source_id,row_value),'{}'::jsonb) from links where mk='qbReceiptMap'),
      'receipts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'customer_id',r.customer_id,'amount',r.amount,'method',r.method,'ref',r.ref,
        'received_date',r.received_date,'ns_applications',r.ns_applications,'qb_payment_id',r.qb_payment_id,
        'created_at',r.created_at,'updated_at',r.updated_at
      ) order by r.id),'[]'::jsonb) from public.payment_receipts r where r.created_at <= p_source_cutoff),
      'payment_receipt_ids', (select coalesce(jsonb_object_agg(p.id::text,p.receipt_id),'{}'::jsonb)
        from public.invoice_payments p where p.receipt_id is not null)
    );
$function$;
