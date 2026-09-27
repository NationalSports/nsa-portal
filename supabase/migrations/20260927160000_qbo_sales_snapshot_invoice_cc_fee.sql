-- Carry each invoice's recorded card fee into the QBO sales snapshot.
--
-- A card surcharge added when a customer pays online raises the Portal total
-- after the QBO invoice was already written, and the sync holds that drift for
-- review. The sync can close the common case itself -- add a "Customer
-- credit-card processing fee" line, the same line the books already use -- but
-- only when the drift is provably the fee, which needs the fee in the snapshot.
-- The single change from 20260916144434 is the trailing 'cc_fee' field.

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
    'customer_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where id >= '_qb_link_v1_' and id < '_qb_link_v1_\uffff'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='custQBMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'invoice_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where id >= '_qb_link_v1_' and id < '_qb_link_v1_\uffff'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbInvoiceMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'payment_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where id >= '_qb_link_v1_' and id < '_qb_link_v1_\uffff'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbPaymentMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'customer_id',i.customer_id,'so_id',i.so_id,'date',i.date,'due_date',i.due_date,
      'total',i.total,'paid',i.paid,'memo',i.memo,'status',i.status,'qb_invoice_id',i.qb_invoice_id,
      'tax',i.tax,'tax_rate',i.tax_rate,'shipping',i.shipping,'credit_amount',i.credit_amount,
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

revoke all on function public.qbo_sales_source_snapshot_without_links(timestamptz) from public, anon, authenticated;
grant execute on function public.qbo_sales_source_snapshot_without_links(timestamptz) to service_role;
