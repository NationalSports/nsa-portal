-- Credit memos issued from portal invoices. The original invoice and its payment
-- history remain immutable; posting a memo creates an equal customer_credits row
-- that can be applied to a later estimate/SO.

begin;

create table if not exists public.invoice_credit_memos (
  id                 text primary key,
  invoice_id         text not null references public.invoices(id) on delete restrict,
  customer_id        text not null references public.customers(id) on delete restrict,
  customer_credit_id text not null unique references public.customer_credits(id) on delete restrict,
  memo_date          date not null default current_date,
  subtotal           numeric(12,2) not null default 0 check (subtotal >= 0),
  tax                numeric(12,2) not null default 0 check (tax >= 0),
  shipping           numeric(12,2) not null default 0 check (shipping >= 0),
  amount             numeric(12,2) not null check (amount > 0),
  reason             text not null check (length(btrim(reason)) > 0),
  line_items         jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  created_by         text,
  created_at         timestamptz not null default now(),
  constraint invoice_credit_memos_components_match
    check (abs(amount - (subtotal + tax + shipping)) < 0.005)
);

create index if not exists idx_invoice_credit_memos_invoice
  on public.invoice_credit_memos(invoice_id);
create index if not exists idx_invoice_credit_memos_customer
  on public.invoice_credit_memos(customer_id, memo_date desc);

alter table public.invoice_credit_memos enable row level security;

drop policy if exists invoice_credit_memos_staff_all on public.invoice_credit_memos;
create policy invoice_credit_memos_staff_all
  on public.invoice_credit_memos
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

revoke all on public.invoice_credit_memos from public, anon;
grant select, insert, update, delete on public.invoice_credit_memos to authenticated;
grant all on public.invoice_credit_memos to service_role;

-- One database transaction owns both sides of the posting. This prevents an
-- account credit without its memo (or a memo without its account credit) if a
-- browser disconnects between requests.
create or replace function public.create_invoice_credit_memo(
  p_invoice_id text,
  p_subtotal numeric,
  p_tax numeric,
  p_shipping numeric,
  p_reason text,
  p_memo_date date,
  p_line_items jsonb,
  p_created_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_memo public.invoice_credit_memos%rowtype;
  v_credit public.customer_credits%rowtype;
  v_amount numeric(12,2);
  v_already_credited numeric(12,2);
  v_next_number integer;
  v_memo_id text;
  v_credit_id text;
  v_created_by text;
  v_line jsonb;
  v_original_line jsonb;
  v_seen_line_indexes integer[] := '{}';
  v_line_index integer;
  v_requested_qty numeric;
  v_original_qty numeric;
  v_original_rate numeric;
  v_prior_qty numeric;
  v_expected_subtotal numeric(12,2) := 0;
begin
  if not public.is_team_member() then
    raise exception 'Only staff can create invoice credit memos';
  end if;

  select * into v_invoice
    from public.invoices
   where id = p_invoice_id
   for update;

  if not found then
    raise exception 'Invoice % was not found', p_invoice_id;
  end if;
  if coalesce(v_invoice.status, '') = 'void' then
    raise exception 'A void invoice cannot be credited';
  end if;
  if coalesce(v_invoice.type, 'invoice') <> 'invoice' then
    raise exception 'Only invoices can receive a credit memo';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A credit memo reason is required';
  end if;
  if jsonb_typeof(coalesce(p_line_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Credit memo line_items must be an array';
  end if;
  if coalesce(p_subtotal, 0) < 0 or coalesce(p_tax, 0) < 0 or coalesce(p_shipping, 0) < 0 then
    raise exception 'Credit memo components cannot be negative';
  end if;

  -- When an invoice has stored lines, validate each credited quantity against
  -- both the original quantity and earlier memos. The invoice row lock above
  -- makes this safe even if two staff members post at the same time.
  if jsonb_array_length(coalesce(v_invoice.line_items, '[]'::jsonb)) > 0 then
    for v_line in
      select value from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb))
    loop
      if not (coalesce(v_line ->> 'line_index', '') ~ '^[0-9]+$') then
        raise exception 'Every credited invoice line must include a valid line_index';
      end if;
      v_line_index := (v_line ->> 'line_index')::integer;
      if v_line_index = any(v_seen_line_indexes) then
        raise exception 'Invoice line % appears more than once in the credit memo', v_line_index + 1;
      end if;
      v_seen_line_indexes := array_append(v_seen_line_indexes, v_line_index);

      v_original_line := v_invoice.line_items -> v_line_index;
      if v_original_line is null then
        raise exception 'Invoice line % does not exist', v_line_index + 1;
      end if;

      v_requested_qty := coalesce(nullif(v_line ->> 'qty', '')::numeric, 0);
      v_original_qty := coalesce(nullif(v_original_line ->> 'qty', '')::numeric, 0);
      if v_requested_qty <= 0 or v_original_qty <= 0 then
        raise exception 'Credited quantities must be greater than zero';
      end if;

      select coalesce(sum(
        case
          when (prior_line ->> 'qty') ~ '^[0-9]+([.][0-9]+)?$'
          then (prior_line ->> 'qty')::numeric
          else 0
        end
      ), 0)
        into v_prior_qty
        from public.invoice_credit_memos prior_memo
        cross join lateral jsonb_array_elements(prior_memo.line_items) as prior_lines(prior_line)
       where prior_memo.invoice_id = p_invoice_id
         and prior_line ->> 'line_index' = v_line_index::text;

      if v_requested_qty > greatest(0, v_original_qty - v_prior_qty) + 0.000005 then
        raise exception 'Credit quantity exceeds the remaining quantity on invoice line %', v_line_index + 1;
      end if;

      v_original_rate := coalesce(
        nullif(v_original_line ->> 'rate', '')::numeric,
        nullif(v_original_line ->> 'unit_price', '')::numeric,
        case when v_original_qty > 0
          then coalesce(nullif(v_original_line ->> 'amount', '')::numeric, 0) / v_original_qty
          else 0
        end
      );
      v_expected_subtotal := v_expected_subtotal + round(v_requested_qty * v_original_rate, 2);
    end loop;

    if abs(round(coalesce(p_subtotal, 0)::numeric, 2) - v_expected_subtotal) > 0.005 then
      raise exception 'Credit memo subtotal does not match the selected invoice quantities';
    end if;
  end if;

  v_amount := round(coalesce(p_subtotal, 0)::numeric, 2)
    + round(coalesce(p_tax, 0)::numeric, 2)
    + round(coalesce(p_shipping, 0)::numeric, 2);
  if v_amount <= 0 then
    raise exception 'Credit memo amount must be greater than zero';
  end if;

  select coalesce(sum(amount), 0) into v_already_credited
    from public.invoice_credit_memos
   where invoice_id = p_invoice_id;

  if v_amount > greatest(0, least(coalesce(v_invoice.total, 0), coalesce(v_invoice.paid, 0)) - v_already_credited) + 0.005 then
    raise exception 'Credit exceeds the remaining creditable amount on invoice %', p_invoice_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('nsa_invoice_credit_memo_id'));
  select coalesce(max((regexp_match(id, '^CM-([0-9]+)$'))[1]::integer), 1000) + 1
    into v_next_number
    from public.invoice_credit_memos
   where id ~ '^CM-[0-9]+$';
  v_memo_id := 'CM-' || v_next_number;
  v_credit_id := 'credit-' || lower(v_memo_id);

  select tm.id into v_created_by
    from public.team_members tm
   where tm.auth_id = auth.uid()
   limit 1;
  v_created_by := coalesce(v_created_by, p_created_by);

  insert into public.customer_credits (
    id, customer_id, amount, used, source, created_by, created_at
  ) values (
    v_credit_id,
    v_invoice.customer_id,
    v_amount,
    0,
    'Credit memo ' || v_memo_id || ' for ' || v_invoice.id || ' — ' || btrim(p_reason),
    v_created_by,
    now()
  )
  returning * into v_credit;

  insert into public.invoice_credit_memos (
    id, invoice_id, customer_id, customer_credit_id, memo_date,
    subtotal, tax, shipping, amount, reason, line_items, created_by
  ) values (
    v_memo_id,
    v_invoice.id,
    v_invoice.customer_id,
    v_credit_id,
    coalesce(p_memo_date, current_date),
    round(coalesce(p_subtotal, 0)::numeric, 2),
    round(coalesce(p_tax, 0)::numeric, 2),
    round(coalesce(p_shipping, 0)::numeric, 2),
    v_amount,
    btrim(p_reason),
    coalesce(p_line_items, '[]'::jsonb),
    v_created_by
  )
  returning * into v_memo;

  return jsonb_build_object(
    'memo', to_jsonb(v_memo),
    'credit', to_jsonb(v_credit)
  );
end;
$$;

revoke all on function public.create_invoice_credit_memo(text, numeric, numeric, numeric, text, date, jsonb, text) from public, anon;
grant execute on function public.create_invoice_credit_memo(text, numeric, numeric, numeric, text, date, jsonb, text) to authenticated, service_role;

commit;
