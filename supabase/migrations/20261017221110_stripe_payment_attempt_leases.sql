-- Durable, server-owned identity for Stripe PaymentIntents.
--
-- IMPORTANT ROLLOUT ORDER: apply this migration before deploying the Netlify
-- functions that call these RPCs. The functions fail closed when the claim
-- cannot be made, so code-first deployment temporarily disables new payments.

create table public.stripe_payment_attempts (
  payable_scope_key text not null,
  payable_key text not null,
  attempt_version integer not null check (attempt_version > 0),
  payable_type text not null,
  customer_ids text[] not null,
  invoice_ids text[] not null default '{}',
  sales_order_ids text[] not null default '{}',
  pay_request_id text,
  amount_cents bigint not null check (amount_cents >= 50),
  currency text not null check (currency = lower(currency) and length(currency) = 3),
  method text not null,
  idempotency_key text not null unique,
  stripe_intent_id text unique,
  stripe_status text not null default 'claimed',
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (payable_key, attempt_version)
);

create unique index stripe_payment_attempts_one_current_scope_uidx
  on public.stripe_payment_attempts (payable_scope_key)
  where superseded_at is null;

-- One current payable scope per invoice. This prevents overlapping groups
-- (INV-A versus INV-A+INV-B) and separate partial-pay links for the same
-- invoice from each acquiring an independently chargeable attempt.
create table public.stripe_invoice_payment_leases (
  invoice_id text primary key,
  payable_scope_key text not null,
  updated_at timestamptz not null default now()
);

create index stripe_payment_attempts_invoice_ids_idx
  on public.stripe_payment_attempts using gin (invoice_ids);
create index stripe_payment_attempts_sales_order_ids_idx
  on public.stripe_payment_attempts using gin (sales_order_ids);

alter table public.stripe_payment_attempts enable row level security;
alter table public.stripe_invoice_payment_leases enable row level security;
revoke all on public.stripe_payment_attempts from public, anon, authenticated;
revoke all on public.stripe_invoice_payment_leases from public, anon, authenticated;
grant all on public.stripe_payment_attempts to service_role;
grant all on public.stripe_invoice_payment_leases to service_role;

-- Claim the one current attempt for an authoritative payable fingerprint.
-- The advisory lock serializes concurrent first claims; the primary key is the
-- permanent backstop. The supplied facts are retained for audit and checked on
-- every replay so a hash/canonicalization regression fails loudly.
create or replace function public.claim_stripe_payment_attempt(
  p_payable_scope_key text,
  p_payable_key text,
  p_payable_type text,
  p_customer_ids text[],
  p_invoice_ids text[],
  p_sales_order_ids text[],
  p_pay_request_id text,
  p_amount_cents bigint,
  p_currency text,
  p_method text
) returns public.stripe_payment_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.stripe_payment_attempts%rowtype;
  v_idempotency_key text;
  v_invoice_id text;
  v_other_scope text;
begin
  if p_payable_scope_key is null or length(p_payable_scope_key) <> 64
     or p_payable_key is null or length(p_payable_key) <> 64
     or p_payable_type is null or p_amount_cents < 50
     or p_currency <> lower(p_currency) or length(p_currency) <> 3
     or coalesce(cardinality(p_customer_ids), 0) = 0 then
    raise exception 'Invalid Stripe payment attempt claim';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe_payment:' || p_payable_scope_key, 0)
  );
  for v_invoice_id in
    select distinct x from unnest(p_invoice_ids) x order by x
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('stripe_invoice:' || v_invoice_id, 0)
    );
  end loop;

  select l.payable_scope_key into v_other_scope
    from public.stripe_invoice_payment_leases l
    where l.invoice_id = any(p_invoice_ids)
      and l.payable_scope_key <> p_payable_scope_key
    order by l.payable_scope_key
    limit 1;
  if found then
    select * into v_row
      from public.stripe_payment_attempts
      where payable_scope_key = v_other_scope and superseded_at is null
      order by attempt_version desc limit 1;
    if found then return v_row; end if;
    raise exception 'Stripe invoice lease points to a missing attempt';
  end if;

  select * into v_row
    from public.stripe_payment_attempts
    where payable_scope_key = p_payable_scope_key
      and superseded_at is null
    order by attempt_version desc
    limit 1
    for update;

  if not found then
    v_idempotency_key := 'nsa_pi_' || p_payable_key || '_v1';
    insert into public.stripe_payment_attempts (
      payable_scope_key, payable_key, attempt_version, payable_type, customer_ids, invoice_ids,
      sales_order_ids, pay_request_id, amount_cents, currency, method,
      idempotency_key
    ) values (
      p_payable_scope_key, p_payable_key, 1, p_payable_type, p_customer_ids, coalesce(p_invoice_ids, '{}'),
      coalesce(p_sales_order_ids, '{}'), p_pay_request_id, p_amount_cents,
      p_currency, p_method, v_idempotency_key
    )
    returning * into v_row;
    insert into public.stripe_invoice_payment_leases(invoice_id, payable_scope_key)
      select distinct x, p_payable_scope_key from unnest(p_invoice_ids) x
      on conflict (invoice_id) do update
        set payable_scope_key = excluded.payable_scope_key, updated_at = now();
  elsif v_row.payable_key = p_payable_key
     and (v_row.payable_type is distinct from p_payable_type
       or v_row.customer_ids is distinct from p_customer_ids
       or v_row.invoice_ids is distinct from coalesce(p_invoice_ids, '{}')
       or v_row.sales_order_ids is distinct from coalesce(p_sales_order_ids, '{}')
       or v_row.pay_request_id is distinct from p_pay_request_id
       or v_row.amount_cents is distinct from p_amount_cents
       or v_row.currency is distinct from p_currency
       or v_row.method is distinct from p_method) then
    raise exception 'Stripe payable fingerprint collision';
  end if;

  return v_row;
end;
$$;

-- Both concurrent callers can receive the claim and call Stripe, but they use
-- the exact same deterministic Stripe key. Stripe returns the same intent, and
-- this compare-and-set prevents any different intent from being attached.
create or replace function public.attach_stripe_payment_intent(
  p_payable_key text,
  p_attempt_version integer,
  p_stripe_intent_id text,
  p_stripe_status text
) returns public.stripe_payment_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.stripe_payment_attempts%rowtype;
begin
  update public.stripe_payment_attempts
    set stripe_intent_id = coalesce(stripe_intent_id, p_stripe_intent_id),
        stripe_status = p_stripe_status,
        updated_at = now()
    where payable_key = p_payable_key
      and attempt_version = p_attempt_version
      and (stripe_intent_id is null or stripe_intent_id = p_stripe_intent_id)
    returning * into v_row;
  if not found then
    raise exception 'Stripe payment attempt already has a different intent';
  end if;
  return v_row;
end;
$$;

-- Replace the current attempt after server code has verified and canceled an
-- obsolete open intent, observed a full refund, or observed a succeeded intent
-- followed by a new authoritative balance. The scope lock and partial unique
-- index ensure concurrent replacements converge on one current row.
create or replace function public.supersede_stripe_payment_attempt(
  p_payable_scope_key text,
  p_prior_intent_id text,
  p_terminal_status text,
  p_payable_key text,
  p_payable_type text,
  p_customer_ids text[],
  p_invoice_ids text[],
  p_sales_order_ids text[],
  p_pay_request_id text,
  p_amount_cents bigint,
  p_currency text,
  p_method text
) returns public.stripe_payment_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior public.stripe_payment_attempts%rowtype;
  v_latest public.stripe_payment_attempts%rowtype;
  v_next integer;
  v_invoice_id text;
begin
  if p_terminal_status not in ('refunded', 'canceled', 'succeeded') then
    raise exception 'Stripe payment attempt is not eligible for advancement';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe_payment:' || p_payable_scope_key, 0)
  );
  select * into v_latest
    from public.stripe_payment_attempts
    where payable_scope_key = p_payable_scope_key
      and superseded_at is null
    order by attempt_version desc
    limit 1
    for update;
  if not found then raise exception 'Stripe payment attempt does not exist'; end if;

  if v_latest.stripe_intent_id is distinct from p_prior_intent_id then
    return v_latest;
  end if;
  for v_invoice_id in
    select distinct x
      from unnest(v_latest.invoice_ids || coalesce(p_invoice_ids, '{}')) x
      order by x
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('stripe_invoice:' || v_invoice_id, 0)
    );
  end loop;
  if exists (
    select 1 from public.stripe_invoice_payment_leases
    where invoice_id = any(coalesce(p_invoice_ids, '{}'))
      and payable_scope_key <> v_latest.payable_scope_key
  ) then
    raise exception 'Another Stripe payment attempt overlaps these invoices';
  end if;

  update public.stripe_payment_attempts
    set stripe_status = p_terminal_status, superseded_at = now(), updated_at = now()
    where payable_key = v_latest.payable_key
      and attempt_version = v_latest.attempt_version
    returning * into v_prior;
  delete from public.stripe_invoice_payment_leases
    where payable_scope_key = v_prior.payable_scope_key;

  v_next := v_prior.attempt_version + 1;
  insert into public.stripe_payment_attempts (
    payable_scope_key, payable_key, attempt_version, payable_type, customer_ids, invoice_ids,
    sales_order_ids, pay_request_id, amount_cents, currency, method,
    idempotency_key
  ) values (
    p_payable_scope_key, p_payable_key, v_next, p_payable_type, p_customer_ids,
    coalesce(p_invoice_ids, '{}'), coalesce(p_sales_order_ids, '{}'), p_pay_request_id,
    p_amount_cents, p_currency, p_method,
    'nsa_pi_' || p_payable_key || '_v' || v_next::text
  )
  returning * into v_latest;
  insert into public.stripe_invoice_payment_leases(invoice_id, payable_scope_key)
    select distinct x, p_payable_scope_key from unnest(p_invoice_ids) x;
  return v_latest;
end;
$$;

revoke all on function public.claim_stripe_payment_attempt(text,text,text,text[],text[],text[],text,bigint,text,text)
  from public, anon, authenticated;
revoke all on function public.attach_stripe_payment_intent(text,integer,text,text)
  from public, anon, authenticated;
revoke all on function public.supersede_stripe_payment_attempt(text,text,text,text,text,text[],text[],text[],text,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_payment_attempt(text,text,text,text[],text[],text[],text,bigint,text,text)
  to service_role;
grant execute on function public.attach_stripe_payment_intent(text,integer,text,text)
  to service_role;
grant execute on function public.supersede_stripe_payment_attempt(text,text,text,text,text,text[],text[],text[],text,bigint,text,text)
  to service_role;
