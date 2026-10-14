-- The receipt-hold filter referenced the inner snapshot three times; Postgres inlined
-- the single-use CTE, so the whole portal snapshot was built three times (~8.5s alone).
-- With the at-once layer on top the RPC passed the 8s PostgREST statement_timeout and
-- every hourly qbo-sales-background run failed with source_snapshot_failed from
-- 2026-10-14 00:17 UTC. MATERIALIZED builds it once; the output is unchanged.
create or replace function public.qbo_sales_source_snapshot_before_at_once(p_source_cutoff timestamp with time zone)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  with snapshot as materialized (select public.qbo_sales_source_snapshot_before_unapply(p_source_cutoff) s)
  select s || jsonb_build_object(
    'receipts',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(s->'receipts') r where not exists(select 1 from public.payment_receipts h where h.id=r->>'id' and h.reconciliation_hold)),
    'payments',(select coalesce(jsonb_agg(p),'[]') from jsonb_array_elements(s->'payments') p where not exists(select 1 from public.invoice_payments ip join public.payment_receipts h on h.id=ip.receipt_id where ip.id=(p->>'id')::integer and h.reconciliation_hold))
  ) from snapshot;
$function$;
