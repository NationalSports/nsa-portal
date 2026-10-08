-- Server-verified Stripe status is separate from cash applied to invoices.
-- A processing ACH debit must be visible without booking uncleared cash.
create table public.invoice_payment_intents (
  id text primary key,
  invoice_ids text[] not null,
  status text not null,
  amount_cents bigint not null,
  received_cents bigint not null default 0,
  method text not null,
  submitted_at timestamptz not null,
  observed_at timestamptz not null default now(),
  applied_at timestamptz,
  review_reason text
);
create index invoice_payment_intents_invoice_ids_idx on public.invoice_payment_intents using gin(invoice_ids);
alter table public.invoice_payment_intents enable row level security;
create policy invoice_payment_intents_staff_read on public.invoice_payment_intents
  for select to authenticated using (public.is_team_member());
revoke all on public.invoice_payment_intents from public, anon, authenticated;
grant select on public.invoice_payment_intents to authenticated;
grant all on public.invoice_payment_intents to service_role;

-- Called only by server code after retrieving the intent directly from Stripe.
-- SECURITY INVOKER + service-role-only EXECUTE: neither a coach nor staff browser
-- can manufacture a succeeded intent. No keys, client secrets or bank details stored.
create or replace function public.reconcile_stripe_invoice_payment(p_intent jsonb, p_apply boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id text := p_intent->>'id';
  v_status text := p_intent->>'status';
  v_ids text[];
  v_row public.invoice_payment_intents%rowtype;
  v_inv public.invoices%rowtype;
  v_req public.invoice_pay_requests%rowtype;
  v_req_id text := nullif(p_intent->>'pay_request_id','');
  v_method text := case when p_intent->>'method' = 'ach' then 'ach' else 'cc' end;
  v_collected numeric := (p_intent->>'received_cents')::numeric / 100;
  v_balance numeric := 0;
  v_base numeric;
  v_fee numeric;
  v_part numeric;
  v_part_fee numeric;
  v_fee_left numeric;
  v_count integer := 0;
  v_n integer := 0;
  v_existing integer;
  v_recorded numeric;
  v_reason text;
  v_result text[] := '{}';
begin
  if v_id is null or v_id !~ '^pi_[A-Za-z0-9]+$' or p_intent->>'currency' is distinct from 'usd'
     or p_intent->>'livemode' is distinct from 'true' then
    raise exception 'Invalid live USD Stripe intent';
  end if;
  select array_agg(distinct x order by x) into v_ids
    from jsonb_array_elements_text(p_intent->'invoice_ids') x;
  if coalesce(cardinality(v_ids),0)=0 then return jsonb_build_object('reconciled','[]'::jsonb); end if;
  -- Non-invoice checkouts also use this webhook. Do not create misleading records for them.
  if not exists(select 1 from public.invoices where id=any(v_ids)) then
    return jsonb_build_object('reconciled','[]'::jsonb);
  end if;
  insert into public.invoice_payment_intents(id,invoice_ids,status,amount_cents,received_cents,method,submitted_at,observed_at)
    values(v_id,v_ids,v_status,(p_intent->>'amount_cents')::bigint,(p_intent->>'received_cents')::bigint,
      v_method,(p_intent->>'submitted_at')::timestamptz,(p_intent->>'observed_at')::timestamptz)
    on conflict(id) do nothing;
  select * into v_row from public.invoice_payment_intents where id=v_id for update;
  if v_row.invoice_ids is distinct from v_ids then raise exception 'Stripe invoice references changed'; end if;
  if v_row.observed_at <= (p_intent->>'observed_at')::timestamptz and v_row.applied_at is null then
    update public.invoice_payment_intents set status=v_status,received_cents=(p_intent->>'received_cents')::bigint,
      amount_cents=(p_intent->>'amount_cents')::bigint,method=v_method,
      observed_at=(p_intent->>'observed_at')::timestamptz where id=v_id;
  end if;
  if v_row.applied_at is not null then
    return jsonb_build_object('reconciled',v_ids,'already',true);
  end if;
  if v_status <> 'succeeded' then
    return jsonb_build_object('reconciled','[]'::jsonb,'status',v_status);
  end if;

  -- Lock every referenced invoice in stable order. Invoice, payment rows, pay-request
  -- and intent marker commit together; any write error rolls back ALL of them.
  for v_inv in select * from public.invoices where id=any(v_ids) order by id for update loop
    v_count := v_count+1;
    v_balance := v_balance + greatest(0,round(coalesce(v_inv.total,0)-coalesce(v_inv.paid,0),2));
    if v_inv.status='void' or v_inv.deleted_at is not null then v_reason := 'Invoice is void or deleted'; end if;
  end loop;
  if v_count <> cardinality(v_ids) then v_reason := 'Invoice reference missing'; end if;

  -- Legacy payments predate the intent marker. A fully represented payment is a
  -- no-op; inconsistent legacy evidence requires review, NEVER another debit/application.
  select count(*),coalesce(sum(amount),0) into v_existing,v_recorded
    from public.invoice_payments where ref='Stripe '||v_id;
  if v_existing>0 then
    if v_existing=cardinality(v_ids) and abs(v_recorded-v_collected)<0.01 and v_reason is null
      and not exists(select 1 from public.invoice_payments p left join public.invoices i on i.id=p.invoice_id
        where p.ref='Stripe '||v_id and (not(p.invoice_id=any(v_ids)) or i.id is null or p.amount<=0
          or coalesce(i.paid,0)<p.amount)) then
      update public.invoice_payment_intents set applied_at=now(),status='succeeded',review_reason=null where id=v_id;
      return jsonb_build_object('reconciled',v_ids,'already',true);
    end if;
    v_reason := 'Existing Stripe payment needs manual reconciliation';
  end if;

  if not p_apply then
    update public.invoice_payment_intents set review_reason=v_reason where id=v_id;
    return jsonb_build_object('reconciled','[]'::jsonb,'status',v_status);
  end if;

  if v_req_id is not null then
    select * into v_req from public.invoice_pay_requests where id=v_req_id for update;
    if not found or cardinality(v_ids)<>1 or v_req.invoice_id is distinct from v_ids[1] then
      v_reason := 'Payment request does not match invoice';
    elsif v_req.status='paid' then v_reason := 'Payment request already paid';
    elsif v_req.amount>v_balance+0.005 then v_reason := 'Payment request exceeds remaining balance';
    end if;
    v_base := v_req.amount;
  else
    v_base := v_balance;
    if exists(select 1 from public.invoices where id=any(v_ids) and coalesce(total,0)-coalesce(paid,0)<=0.005) then
      v_reason := 'Invoice balance changed or another payment already applied';
    end if;
  end if;
  if v_base is null or v_base<=0 or v_collected<v_base then v_reason := 'Captured amount below invoice payment amount'; end if;
  -- Newly created intents carry the server-checked base amount. Do not disguise a
  -- changed balance / another payment as a larger card surcharge at settlement.
  if nullif(p_intent->>'base_cents','') is not null and (p_intent->>'base_cents')::numeric <> round(v_base*100) then
    v_reason := 'Invoice balance changed since payment started';
  end if;
  if coalesce((p_intent->>'refunded_cents')::bigint,0)>0 or coalesce((p_intent->>'disputed')::boolean,false) then
    v_reason := 'Refunded or disputed payment requires accounting review';
  end if;
  v_fee := round(v_collected-v_base,2);
  if (v_method='ach' and v_fee<>0) or v_fee > round(v_base*0.05,2)+1 then
    v_reason := 'Captured amount exceeds expected payment';
  end if;
  if v_reason is not null then
    update public.invoice_payment_intents set review_reason=v_reason where id=v_id;
    return jsonb_build_object('reconciled','[]'::jsonb,'error',v_reason);
  end if;

  v_fee_left := v_fee;
  for v_inv in select * from public.invoices where id=any(v_ids) order by id loop
    v_n := v_n+1;
    v_part := case when v_req_id is not null then v_base else round(v_inv.total-coalesce(v_inv.paid,0),2) end;
    v_part_fee := case when v_n=v_count then v_fee_left else round(v_fee*v_part/v_base,2) end;
    v_fee_left := v_fee_left-v_part_fee;
    insert into public.invoice_payments(invoice_id,amount,method,ref,date,cc_fee)
      values(v_inv.id,v_part+v_part_fee,v_method,'Stripe '||v_id,
        to_char(now() at time zone 'America/Los_Angeles','MM/DD/YYYY'),v_part_fee);
    update public.invoices set total=round(total+v_part_fee,2),paid=round(coalesce(paid,0)+v_part+v_part_fee,2),
      cc_fee=round(coalesce(cc_fee,0)+v_part_fee,2),
      status=case when coalesce(paid,0)+v_part>=total-0.005 then 'paid' else 'partial' end,updated_at=now()
      where id=v_inv.id;
    v_result := array_append(v_result,v_inv.id);
  end loop;
  if v_req_id is not null then
    update public.invoice_pay_requests set status='paid',paid_at=now(),payment_intent_id=v_id where id=v_req_id;
  end if;
  update public.invoice_payment_intents set applied_at=now(),status='succeeded',review_reason=null where id=v_id;
  return jsonb_build_object('reconciled',v_result,'partial',v_req_id is not null and v_base<v_balance,'applied',v_base,'fee',v_fee);
end;
$$;
revoke all on function public.reconcile_stripe_invoice_payment(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_stripe_invoice_payment(jsonb,boolean) to service_role;
