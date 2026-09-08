-- Persist verified QuickBooks supplier-bill receipts on the server ledger.
--
-- Previously App.js stored qbStatus/qbMsg only in nsa_saved_bills localStorage.
-- Browser storage is origin-scoped, so a backfill run on a Netlify deploy preview
-- appeared completely unsynced on connect.nationalsportsapparel.com even though
-- the preview had created or verified the live QuickBooks bills.

alter table public.applied_bills
  add column if not exists qb_status    text,
  add column if not exists qb_bill_id   text,
  add column if not exists qb_message   text,
  add column if not exists qb_synced_at timestamptz;

alter table public.applied_bills
  drop constraint if exists applied_bills_qb_status_chk;
alter table public.applied_bills
  add constraint applied_bills_qb_status_chk
  check (qb_status is null or qb_status = 'success');

create index if not exists applied_bills_qb_bill_id_idx
  on public.applied_bills (qb_bill_id)
  where qb_bill_id is not null;

-- Upsert is deliberate: some pre-ledger bills are known as Portal-complete only
-- from the older Bill History cache. The QBO backfill sends their full, stripped
-- metadata with portal_status=success so those old rows join the durable ledger.
-- Existing rows only receive the QBO fields; their Portal audit fields are never
-- overwritten by browser data.
create or replace function public.record_qbo_bill_receipts(p_receipts jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' then
    raise exception 'p_receipts must be a JSON array';
  end if;

  with receipts as (
    select distinct on (lower(trim(x.doc_number)), coalesce(x.is_credit, false))
      lower(trim(x.doc_number)) as doc_norm,
      trim(x.doc_number) as doc_number,
      nullif(lower(trim(x.si_doc_number)), '') as si_doc_number,
      coalesce(x.is_credit, false) as is_credit,
      nullif(x.vendor, '') as vendor,
      nullif(x.po_number, '') as po_number,
      x.doc_total,
      nullif(x.source, '') as source,
      nullif(x.applied_by, '') as applied_by,
      x.raw_meta,
      nullif(trim(x.qb_bill_id), '') as qb_bill_id,
      nullif(x.qb_message, '') as qb_message,
      coalesce(x.qb_synced_at, now()) as qb_synced_at
    from jsonb_to_recordset(p_receipts) as x(
      doc_number text,
      si_doc_number text,
      is_credit boolean,
      vendor text,
      po_number text,
      doc_total numeric,
      source text,
      applied_by text,
      raw_meta jsonb,
      qb_bill_id text,
      qb_message text,
      qb_synced_at timestamptz
    )
    where nullif(trim(x.doc_number), '') is not null
      and nullif(trim(x.qb_bill_id), '') is not null
    order by lower(trim(x.doc_number)), coalesce(x.is_credit, false), x.qb_synced_at desc nulls last
  ), written as (
    insert into public.applied_bills (
      doc_norm, doc_number, si_doc_number, is_credit, vendor, po_number,
      doc_total, source, applied_by, status, portal_status, raw_meta,
      qb_status, qb_bill_id, qb_message, qb_synced_at, updated_at
    )
    select
      r.doc_norm, r.doc_number, r.si_doc_number, r.is_credit, r.vendor,
      r.po_number, r.doc_total, r.source, r.applied_by, 'pushed', 'success',
      r.raw_meta, 'success', r.qb_bill_id, r.qb_message, r.qb_synced_at, now()
    from receipts r
    where true -- disambiguates INSERT ... SELECT ... ON CONFLICT for PostgreSQL
    on conflict (doc_norm, is_credit) do update
      set qb_status = 'success',
          qb_bill_id = excluded.qb_bill_id,
          qb_message = excluded.qb_message,
          qb_synced_at = excluded.qb_synced_at,
          updated_at = now()
    returning id
  )
  select count(*)::integer into v_updated from written;

  return v_updated;
end;
$$;

revoke all on function public.record_qbo_bill_receipts(jsonb) from public;
revoke all on function public.record_qbo_bill_receipts(jsonb) from anon;
grant execute on function public.record_qbo_bill_receipts(jsonb) to authenticated;
