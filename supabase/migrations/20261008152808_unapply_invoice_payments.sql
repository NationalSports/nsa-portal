-- Explicit manual-payment unapplication. Preserve the receipt, retain a permanent
-- audit/tombstone, fence stale invoice saves, and hold QBO-linked money for review.
alter table public.invoices add column if not exists payment_revision integer not null default 0;
alter table public.payment_receipts add column if not exists reconciliation_hold boolean not null default false;
create table public.invoice_payment_unapplications (
  payment_id integer primary key,
  invoice_id text not null,
  payment_ref text not null,
  receipt_id text not null references public.payment_receipts(id),
  payment jsonb not null,
  reason text not null,
  actor_id text not null,
  qbo_review_required boolean not null,
  created_at timestamptz not null default now(),
  unique(invoice_id,payment_ref)
);
alter table public.invoice_payment_unapplications enable row level security;
create policy unapplications_staff_read on public.invoice_payment_unapplications
  for select to authenticated using (public.is_team_member());
grant select on public.invoice_payment_unapplications to authenticated;
grant all on public.invoice_payment_unapplications to service_role;

-- Old tabs cannot reinsert a removed application or spend held money. Unchanged
-- rows may still be upserted by normal invoice saves.
create function public.guard_unapplied_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    perform 1 from public.invoices where id=old.invoice_id for update;
    return old;
  end if;
  -- Serialize even old-tab inserts with unapplication before checking tombstones.
  perform 1 from public.invoices where id=new.invoice_id for update;
  if new.receipt_id is not null then perform 1 from public.payment_receipts where id=new.receipt_id for update; end if;
  if exists(select 1 from public.invoice_payment_unapplications a where a.invoice_id=new.invoice_id and a.payment_ref=new.ref) then
    raise exception 'This payment was unapplied. Reload the invoice; do not recreate the old application.';
  end if;
  if new.receipt_id is not null and exists(select 1 from public.payment_receipts r where r.id=new.receipt_id and r.reconciliation_hold) then
    if not exists(select 1 from public.invoice_payments p where p.invoice_id=new.invoice_id and p.ref=new.ref
      and p.receipt_id=new.receipt_id and p.amount=new.amount and p.method is not distinct from new.method and p.date is not distinct from new.date) then
      raise exception 'This payment is held for QuickBooks reconciliation and cannot be applied again yet.';
    end if;
  end if;
  return new;
end $$;
create trigger guard_unapplied_payment before insert or update or delete on public.invoice_payments
  for each row execute function public.guard_unapplied_payment();

create function public.guard_invoice_payment_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_revision integer;
begin
  select payment_revision into v_revision from public.invoices where id=new.id;
  if v_revision is not null and new.payment_revision is distinct from v_revision then
    if not (current_user='service_role' and current_setting('nsa.unapply_payment',true)='on' and new.payment_revision=v_revision+1) then
      raise exception 'Invoice payments changed. Reload this invoice before saving.' using errcode='40001';
    end if;
  end if;
  return new;
end $$;
create trigger guard_invoice_payment_revision before insert or update on public.invoices
  for each row execute function public.guard_invoice_payment_revision();

create function public.guard_payment_reconciliation_hold() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.reconciliation_hold and current_user <> 'service_role' then
    if tg_op='DELETE' or new is distinct from old then
      raise exception 'This receipt is held for QuickBooks reconciliation.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger guard_payment_reconciliation_hold before update or delete on public.payment_receipts
  for each row execute function public.guard_payment_reconciliation_hold();

-- Server-only command; actor identity comes from a verified JWT in the endpoint.
create function public.unapply_invoice_payment(p_invoice_id text,p_payment_ref text,p_expected_payment jsonb,p_reason text,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.invoice_payments%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_prior public.invoice_payment_unapplications%rowtype;
  v_sum numeric;
  v_qbo boolean;
  v_qbo_ids jsonb;
  v_actor text;
begin
  if current_user <> 'service_role' then raise exception 'Server authorization required'; end if;
  select name into v_actor from public.team_members where id=p_actor_id and coalesce(is_active,true)
    and id in ('00000000-0000-0000-0000-000000000001','35436542-e7f2-49db-8120-6111cf83b960','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041');
  if not found then raise exception 'Payment accounting access required'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 or length(p_reason)>1000 then raise exception 'Enter a reason (3–1000 characters)'; end if;
  -- Serialize against the existing hourly run claim. Never change its settings.
  perform 1 from public.qbo_sales_settings where company_key='national' for update;
  if exists(select 1 from public.qbo_sales_runs where company_key='national' and status='running' and lease_expires_at>now()) then
    raise exception 'QuickBooks sync is running. Retry after it finishes.';
  end if;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into v_prior from public.invoice_payment_unapplications where invoice_id=p_invoice_id and payment_ref=p_payment_ref;
  if found then
    return jsonb_build_object('already_unapplied',true,'invoice',to_jsonb(v_invoice),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.invoice_payments p where invoice_id=p_invoice_id),'receipt_id',v_prior.receipt_id,'qbo_review_required',v_prior.qbo_review_required);
  end if;
  select * into v_payment from public.invoice_payments where invoice_id=p_invoice_id and ref=p_payment_ref for update;
  if not found then raise exception 'Payment no longer exists. Reload the invoice.'; end if;
  if jsonb_build_object('amount',v_payment.amount,'method',v_payment.method,'date',v_payment.date,'receipt_id',v_payment.receipt_id)
    is distinct from p_expected_payment then raise exception 'Payment changed. Reload before unapplying.'; end if;
  if v_payment.method not in ('check','ach','venmo','zelle','cash') or v_payment.amount<=0 or coalesce(v_payment.cc_fee,0)<>0 then
    raise exception 'Only manual cash/check/ACH/Zelle/Venmo applications can be unapplied here. Card, credit, and imported payments need separate review.';
  end if;
  if lower(coalesce(v_invoice.status,''))='void' then raise exception 'Cannot unapply from a void invoice'; end if;
  select coalesce(sum(amount),0) into v_sum from public.invoice_payments where invoice_id=p_invoice_id;
  if abs(v_sum-coalesce(v_invoice.paid,0))>0.005 then raise exception 'Invoice paid total and payment history differ. Reconcile before unapplying.'; end if;
  -- Any QBO invoice link is enough to require review: a missing payment link is
  -- not proof that a previous QBO write never happened.
  v_qbo := nullif(v_invoice.qb_invoice_id,'') is not null;
  select coalesce(jsonb_agg(value::jsonb->>'qbo_id'),'[]') into v_qbo_ids from public.app_state
    where left(id,12)='_qb_link_v1_' and value is not null and left(btrim(value),1)='{'
      and value::jsonb->>'map_key'='qbPaymentMap' and value::jsonb->>'source_id'='payment:'||v_payment.id;
  v_qbo := v_qbo or jsonb_array_length(v_qbo_ids)>0 or exists(select 1 from public.app_state where left(id,12)='_qb_link_v1_' and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbInvoiceMap' and value::jsonb->>'source_id'=p_invoice_id);
  if v_payment.receipt_id is not null then
    select * into v_receipt from public.payment_receipts where id=v_payment.receipt_id for update;
    if not found then raise exception 'Original receipt is missing'; end if;
    v_qbo := v_qbo or v_receipt.qb_payment_id is not null or v_receipt.reconciliation_hold;
    update public.payment_receipts set reconciliation_hold=reconciliation_hold or v_qbo,updated_at=now()
      where id=v_receipt.id returning * into v_receipt;
  else
    insert into public.payment_receipts(id,customer_id,amount,method,ref,received_date,memo,created_by,reconciliation_hold)
      values('RCPT-UNAPPLY-'||v_payment.id,v_invoice.customer_id,v_payment.amount,v_payment.method,v_payment.ref,v_payment.date,
        'Unapplied from '||p_invoice_id||'. '||btrim(p_reason)||case when v_qbo then ' QuickBooks review required; this is not new cash received.' else '' end,v_actor,v_qbo)
      returning * into v_receipt;
  end if;
  insert into public.invoice_payment_unapplications(payment_id,invoice_id,payment_ref,receipt_id,payment,reason,actor_id,qbo_review_required)
    values(v_payment.id,p_invoice_id,p_payment_ref,v_receipt.id,to_jsonb(v_payment)||jsonb_build_object('qbo_payment_ids',v_qbo_ids),btrim(p_reason),p_actor_id,v_qbo);
  delete from public.invoice_payments where id=v_payment.id;
  perform set_config('nsa.unapply_payment','on',true);
  update public.invoices set paid=v_sum-v_payment.amount,
    status=case when v_sum-v_payment.amount>=total-0.005 then 'paid' when v_sum-v_payment.amount>0.005 then 'partial' else 'open' end,
    payment_revision=payment_revision+1 where id=p_invoice_id returning * into v_invoice;
  perform set_config('nsa.unapply_payment','off',true);
  return jsonb_build_object('invoice',to_jsonb(v_invoice),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.invoice_payments p where invoice_id=p_invoice_id),
    'receipt_id',v_receipt.id,'qbo_review_required',v_qbo);
end $$;
revoke all on function public.unapply_invoice_payment(text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.unapply_invoice_payment(text,text,jsonb,text,text) to service_role;

-- Hold the ENTIRE receipt, including its remaining applications, from either QBO
-- payment writer. Other invoices/payments and the hourly settings are unchanged.
alter function public.qbo_sales_source_snapshot(timestamptz) rename to qbo_sales_source_snapshot_before_unapply;
create function public.qbo_sales_source_snapshot(p_source_cutoff timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  with snapshot as (select public.qbo_sales_source_snapshot_before_unapply(p_source_cutoff) s)
  select s || jsonb_build_object(
    'receipts',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(s->'receipts') r where not exists(select 1 from public.payment_receipts h where h.id=r->>'id' and h.reconciliation_hold)),
    'payments',(select coalesce(jsonb_agg(p),'[]') from jsonb_array_elements(s->'payments') p where not exists(select 1 from public.invoice_payments ip join public.payment_receipts h on h.id=ip.receipt_id where ip.id=(p->>'id')::integer and h.reconciliation_hold))
  ) from snapshot;
$$;
revoke all on function public.qbo_sales_source_snapshot(timestamptz) from public,anon,authenticated;
grant execute on function public.qbo_sales_source_snapshot(timestamptz) to service_role;
