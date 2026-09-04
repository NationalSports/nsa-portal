-- Apply a Stripe collection to every referenced invoice as one transaction.
-- The allocation rows preserve the original cent split independently of mutable
-- invoice summaries, while invoice_payments remains the required accounting ledger.

create table if not exists public.stripe_invoice_payment_allocations (
  payment_intent_id text not null,
  invoice_id text not null references public.invoices(id) on delete restrict,
  captured_cents bigint not null check (captured_cents > 0),
  principal_cents bigint not null check (principal_cents > 0),
  fee_cents bigint not null check (fee_cents >= 0),
  amount_cents bigint not null check (amount_cents = principal_cents + fee_cents),
  total_cents bigint not null,
  paid_cents bigint not null,
  invoice_fee_cents bigint not null check (invoice_fee_cents >= 0),
  method text not null,
  payment_date text not null,
  created_at timestamptz not null default now(),
  primary key (payment_intent_id, invoice_id)
);

alter table public.stripe_invoice_payment_allocations enable row level security;
revoke all on table public.stripe_invoice_payment_allocations from public, anon, authenticated;
grant all on table public.stripe_invoice_payment_allocations to service_role;

create or replace function public.settle_stripe_invoice_payment(
  p_payment_intent_id text,
  p_invoice_ids text[],
  p_captured_cents bigint,
  p_payment_method text,
  p_payment_date text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
  v_expected integer;
  v_found integer;
  v_existing integer;
  v_existing_ids text[];
  v_existing_cents bigint;
  v_principal_cents bigint;
  v_fee_cents bigint;
  v_fee_remaining bigint;
  v_index integer := 0;
  v_ref text;
  v_allocations jsonb;
  v_row record;
  v_row_fee bigint;
  v_row_amount bigint;
  v_new_total bigint;
  v_new_invoice_fee bigint;
  v_ledger_count integer;
begin
  if p_payment_intent_id is null
      or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
      or p_captured_cents is null or p_captured_cents <= 0
      or p_payment_method not in ('cc', 'ach', 'stripe')
      or p_payment_date is null or p_payment_date !~ '^\d{2}/\d{2}/\d{4}$' then
    raise exception 'invalid Stripe settlement input' using errcode = '22023';
  end if;

  select array_agg(x order by x)
    into v_ids
    from (select distinct btrim(i) x
            from unnest(coalesce(p_invoice_ids, array[]::text[])) i
           where btrim(i) <> '') s;
  v_expected := coalesce(cardinality(v_ids), 0);
  if v_expected = 0 or v_expected > 100 then
    raise exception 'Stripe settlement must reference 1 to 100 invoices' using errcode = '22023';
  end if;

  -- Serialize portal finalize, webhook delivery, and Stripe retry for this exact collection.
  perform pg_advisory_xact_lock(hashtextextended(p_payment_intent_id, 0));
  v_ref := 'Stripe ' || p_payment_intent_id;

  -- A completed transaction has one durable allocation per invoice. Reuse that original split
  -- and repair only a missing invoice_payments mirror from those exact persisted cents.
  select count(*)::integer, array_agg(a.invoice_id order by a.invoice_id),
         coalesce(sum(a.amount_cents), 0)::bigint
    into v_existing, v_existing_ids, v_existing_cents
    from public.stripe_invoice_payment_allocations a
   where a.payment_intent_id = p_payment_intent_id;

  if v_existing > 0 then
    if v_existing <> v_expected or v_existing_ids is distinct from v_ids
        or v_existing_cents <> p_captured_cents then
      raise exception 'PaymentIntent allocation does not match this retry' using errcode = '23514';
    end if;

    insert into public.invoice_payments (invoice_id, amount, method, ref, date, cc_fee)
    select a.invoice_id, a.amount_cents::numeric / 100, a.method, v_ref,
           a.payment_date, a.fee_cents::numeric / 100
      from public.stripe_invoice_payment_allocations a
     where a.payment_intent_id = p_payment_intent_id
    on conflict (invoice_id, ref) do nothing;

    select count(*)::integer into v_ledger_count
      from public.invoice_payments p
      join public.stripe_invoice_payment_allocations a
        on a.payment_intent_id = p_payment_intent_id and a.invoice_id = p.invoice_id
     where p.ref = v_ref
       and round(coalesce(p.amount, 0) * 100)::bigint = a.amount_cents
       and round(coalesce(p.cc_fee, 0) * 100)::bigint = a.fee_cents;
    if v_ledger_count <> v_expected then
      raise exception 'PaymentIntent ledger conflicts with persisted allocation' using errcode = '23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'invoice_id', a.invoice_id, 'principal_cents', a.principal_cents,
             'fee_cents', a.fee_cents, 'amount_cents', a.amount_cents,
             'total_cents', a.total_cents, 'paid_cents', a.paid_cents,
             'invoice_fee_cents', a.invoice_fee_cents, 'method', a.method,
             'date', a.payment_date
           ) order by a.invoice_id), '[]'::jsonb)
      into v_allocations
      from public.stripe_invoice_payment_allocations a
     where a.payment_intent_id = p_payment_intent_id;
    return jsonb_build_object('ok', true, 'already_applied', true, 'allocations', v_allocations);
  end if;

  -- Lock the entire invoice set in a stable order before validating any balance.
  perform 1 from public.invoices i where i.id = any(v_ids) order by i.id for update;
  select count(*)::integer into v_found from public.invoices i where i.id = any(v_ids);
  if v_found = 0 then
    -- Non-portal Stripe payments can carry unrelated metadata. They are not invoice failures.
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'no_invoices', 'allocations', '[]'::jsonb);
  end if;
  if v_found <> v_expected then
    raise exception 'PaymentIntent references an incomplete invoice set' using errcode = '23503';
  end if;

  -- No allocation record means this is either wholly fresh or a legacy partial attempt. A paid
  -- target or an old ledger row is ambiguous; do not infer that its missing balance is new fee.
  if exists (
    select 1 from public.invoices i
     where i.id = any(v_ids)
       and (lower(btrim(coalesce(i.status, ''))) = 'paid'
            or round((coalesce(i.total, 0) - coalesce(i.paid, 0)) * 100)::bigint <= 0)
  ) or exists (
    select 1 from public.invoice_payments p where p.invoice_id = any(v_ids) and p.ref = v_ref
  ) then
    raise exception 'legacy partial Stripe application requires manual review' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.invoices i
     where i.id = any(v_ids)
       and lower(btrim(coalesce(i.status, ''))) not in ('open', 'partial', 'overdue')
  ) then
    raise exception 'Stripe collection references an invoice that is not payable' using errcode = '23514';
  end if;

  select coalesce(sum(round((coalesce(i.total, 0) - coalesce(i.paid, 0)) * 100)::bigint), 0)
    into v_principal_cents from public.invoices i where i.id = any(v_ids);
  if v_principal_cents <= 0 or p_captured_cents < v_principal_cents then
    raise exception 'Stripe collection is less than the locked invoice balance' using errcode = '23514';
  end if;
  v_fee_cents := p_captured_cents - v_principal_cents;
  if p_captured_cents > v_principal_cents + ceil(v_principal_cents * 0.10)::bigint then
    raise exception 'Stripe collection exceeds the allowed invoice surcharge' using errcode = '23514';
  end if;
  if p_payment_method = 'ach' and v_fee_cents <> 0 then
    raise exception 'ACH invoice collection cannot include a card surcharge' using errcode = '23514';
  end if;

  v_fee_remaining := v_fee_cents;
  for v_row in
    select i.id,
           round((coalesce(i.total, 0) - coalesce(i.paid, 0)) * 100)::bigint balance_cents,
           round(coalesce(i.total, 0) * 100)::bigint old_total_cents,
           round(coalesce(i.cc_fee, 0) * 100)::bigint old_fee_cents
      from public.invoices i where i.id = any(v_ids) order by i.id
  loop
    v_index := v_index + 1;
    v_row_fee := case when v_index = v_expected then v_fee_remaining
      else floor(v_fee_cents::numeric * v_row.balance_cents / v_principal_cents)::bigint end;
    v_fee_remaining := v_fee_remaining - v_row_fee;
    v_row_amount := v_row.balance_cents + v_row_fee;
    v_new_total := v_row.old_total_cents + v_row_fee;
    v_new_invoice_fee := v_row.old_fee_cents + v_row_fee;

    update public.invoices
       set total = v_new_total::numeric / 100,
           paid = v_new_total::numeric / 100,
           cc_fee = v_new_invoice_fee::numeric / 100,
           status = 'paid', updated_at = now()
     where id = v_row.id;

    insert into public.invoice_payments (invoice_id, amount, method, ref, date, cc_fee)
    values (v_row.id, v_row_amount::numeric / 100, p_payment_method, v_ref,
            p_payment_date, v_row_fee::numeric / 100);

    insert into public.stripe_invoice_payment_allocations (
      payment_intent_id, invoice_id, captured_cents, principal_cents, fee_cents,
      amount_cents, total_cents, paid_cents, invoice_fee_cents, method, payment_date
    ) values (
      p_payment_intent_id, v_row.id, p_captured_cents, v_row.balance_cents, v_row_fee,
      v_row_amount, v_new_total, v_new_total, v_new_invoice_fee,
      p_payment_method, p_payment_date
    );
  end loop;

  if v_fee_remaining <> 0 then
    raise exception 'Stripe surcharge allocation did not balance' using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object(
           'invoice_id', a.invoice_id, 'principal_cents', a.principal_cents,
           'fee_cents', a.fee_cents, 'amount_cents', a.amount_cents,
           'total_cents', a.total_cents, 'paid_cents', a.paid_cents,
           'invoice_fee_cents', a.invoice_fee_cents, 'method', a.method,
           'date', a.payment_date
         ) order by a.invoice_id)
    into v_allocations
    from public.stripe_invoice_payment_allocations a
   where a.payment_intent_id = p_payment_intent_id;

  if coalesce((select sum((x->>'amount_cents')::bigint)
                 from jsonb_array_elements(v_allocations) x), 0) <> p_captured_cents then
    raise exception 'Stripe allocation cents do not equal captured cents' using errcode = '23514';
  end if;

  return jsonb_build_object('ok', true, 'already_applied', false, 'allocations', v_allocations);
end;
$$;

revoke all on function public.settle_stripe_invoice_payment(text, text[], bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_stripe_invoice_payment(text, text[], bigint, text, text)
  to service_role;

comment on function public.settle_stripe_invoice_payment(text, text[], bigint, text, text) is
  'Service-only atomic and idempotent Stripe PaymentIntent settlement across invoices and invoice_payments.';
