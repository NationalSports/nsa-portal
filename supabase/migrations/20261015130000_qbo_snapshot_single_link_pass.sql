-- The hourly QBO sales snapshot parsed the ~7,300 `_qb_link_v1_` app_state rows from
-- text to jsonb seven times per run (three link maps in _without_links, all four again
-- in _before_unapply, which overwrites the first three) and several times per row
-- inside each pass. That pushed qbo_sales_source_snapshot to ~11s, past the 8s
-- PostgREST statement_timeout, and most hourly runs failed with source_snapshot_failed
-- again from 2026-10-14 17:17 UTC. Now the link rows are parsed once, in one pass, and
-- _without_links no longer builds maps that were always overwritten. Output unchanged.
create or replace function public.qbo_sales_source_snapshot_without_links(p_source_cutoff timestamp with time zone)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.qbo_sales_settings s where s.company_key='national'),
    'legacy_config', (select jsonb_build_object(
      'mapping', coalesce(value::jsonb->'mapping','{}'::jsonb),
      'aliases', coalesce(value::jsonb->'custQBAliasApprovals','{}'::jsonb),
      'realm_id', value::jsonb->>'realm_id'
    ) from public.app_state where id='qb_config'),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'alpha_tag',c.alpha_tag,'payment_terms',c.payment_terms,
      'is_active',c.is_active,'billing_address_line1',c.billing_address_line1,
      'billing_address_line2',c.billing_address_line2,'billing_city',c.billing_city,
      'billing_state',c.billing_state,'billing_zip',c.billing_zip,
      'shipping_address_line1',c.shipping_address_line1,'shipping_address_line2',c.shipping_address_line2,
      'shipping_city',c.shipping_city,'shipping_state',c.shipping_state,'shipping_zip',c.shipping_zip,
      'contact_email',(select cc.email from public.customer_contacts cc where cc.customer_id=c.id and nullif(btrim(cc.email),'') is not null order by cc.sort_order,cc.id limit 1),
      'contact_phone',(select cc.phone from public.customer_contacts cc where cc.customer_id=c.id and nullif(btrim(cc.phone),'') is not null order by cc.sort_order,cc.id limit 1),
      'updated_at',c.updated_at
    ) order by c.id),'[]'::jsonb) from public.customers c
      where c.updated_at is null or c.updated_at <= p_source_cutoff),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'customer_id',i.customer_id,'so_id',i.so_id,'date',i.date,'due_date',i.due_date,
      'total',i.total,'paid',i.paid,'memo',i.memo,'status',i.status,'qb_invoice_id',i.qb_invoice_id,
      'tax',i.tax,'tax_state',i.tax_state,'tax_rate',i.tax_rate,'shipping',i.shipping,'credit_amount',i.credit_amount,
      'created_at',i.created_at,'updated_at',i.updated_at,'deleted_at',i.deleted_at,'cc_fee',i.cc_fee
    ) order by i.id),'[]'::jsonb) from public.invoices i
      where (i.updated_at is null or i.updated_at <= p_source_cutoff)),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'invoice_id',p.invoice_id,'amount',p.amount,'method',p.method,
      'ref',p.ref,'date',p.date,'cc_fee',p.cc_fee
    ) order by p.invoice_id,p.date,p.id),'[]'::jsonb) from public.invoice_payments p),
    'sales_orders', (select coalesce(jsonb_object_agg(s.id,jsonb_build_object('id',s.id,'memo',s.memo)),'{}'::jsonb)
      from public.sales_orders s where s.deleted_at is null)
  );
$function$;

create or replace function public.qbo_sales_source_snapshot_before_unapply(p_source_cutoff timestamp with time zone)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with link_text as materialized (
    select value from public.app_state
    where left(id,12) = '_qb_link_v1_' and value is not null and left(btrim(value),1)='{'
  ), link_json as materialized (
    select value::jsonb v from link_text
  ), links as materialized (
    select v->>'map_key' map_key, v->>'source_id' source_id, v row_value from link_json
    where v->>'map_key' in ('custQBMap','qbInvoiceMap','qbPaymentMap','qbReceiptMap')
      and v->>'realm_id'='9341456492604246' and coalesce((v->>'active')::boolean,true)
  )
  select public.qbo_sales_source_snapshot_without_links(p_source_cutoff)
    || jsonb_build_object(
      'customer_links', (select coalesce(jsonb_object_agg(l.source_id,l.row_value),'{}'::jsonb) from links l where l.map_key='custQBMap'),
      'invoice_links', (select coalesce(jsonb_object_agg(l.source_id,l.row_value),'{}'::jsonb) from links l where l.map_key='qbInvoiceMap'),
      'payment_links', (select coalesce(jsonb_object_agg(l.source_id,l.row_value),'{}'::jsonb) from links l where l.map_key='qbPaymentMap'),
      'receipt_links', (select coalesce(jsonb_object_agg(l.source_id,l.row_value),'{}'::jsonb) from links l where l.map_key='qbReceiptMap'),
      'receipts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'customer_id',r.customer_id,'amount',r.amount,'method',r.method,'ref',r.ref,
        'received_date',r.received_date,'ns_applications',r.ns_applications,'qb_payment_id',r.qb_payment_id,
        'created_at',r.created_at,'updated_at',r.updated_at
      ) order by r.id),'[]'::jsonb) from public.payment_receipts r where r.created_at <= p_source_cutoff),
      'payment_receipt_ids', (select coalesce(jsonb_object_agg(p.id::text,p.receipt_id),'{}'::jsonb)
        from public.invoice_payments p where p.receipt_id is not null)
    );
$function$;
