-- QBO: post a received check (payment_receipts) as ONE QuickBooks payment.
--
-- Accounting asked for a check that pays several invoices to land in QBO as a single payment
-- split across those invoices, with any overpayment left on the customer as an unapplied
-- payment. The sales sync (supabase/functions/qbo-sales-background) needs three things for that:
--
--   1. an off-by-default switch, so deploying the code changes nothing until someone turns it on
--      (receipt_payments_enabled — with it off, receipt-tagged payments keep posting one QBO
--      payment per invoice exactly as before);
--   2. the receipts and each payment's receipt_id in its source snapshot, plus the durable
--      receipt → QBO payment links (map_key qbReceiptMap, same app_state ledger as the others);
--   3. somewhere to stamp the QBO payment on the receipt, so the Portal can refuse to delete a
--      receipt QuickBooks already holds.
--
-- The snapshot wrapper is the live qbo_sales_source_snapshot plus three keys; the existing keys
-- (and so the run's source hash) are unchanged.

alter table public.qbo_sales_settings add column if not exists receipt_payments_enabled boolean not null default false;
alter table public.payment_receipts add column if not exists qb_payment_id text;

create or replace function public.qbo_sales_source_snapshot(p_source_cutoff timestamp with time zone)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
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
      ) x),
      'receipt_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
        select value::jsonb->>'source_id' source_id, value::jsonb row_value
        from public.app_state
        where left(id,12) = '_qb_link_v1_'
          and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbReceiptMap'
          and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
      ) x),
      'receipts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'customer_id',r.customer_id,'amount',r.amount,'method',r.method,'ref',r.ref,
        'received_date',r.received_date,'ns_applications',r.ns_applications,'qb_payment_id',r.qb_payment_id,
        'created_at',r.created_at,'updated_at',r.updated_at
      ) order by r.id),'[]'::jsonb) from public.payment_receipts r where r.created_at <= p_source_cutoff),
      'payment_receipt_ids', (select coalesce(jsonb_object_agg(p.id::text,p.receipt_id),'{}'::jsonb)
        from public.invoice_payments p where p.receipt_id is not null)
    );
$function$;
