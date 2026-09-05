-- A transport failure can happen after PostgreSQL commits but before the browser
-- receives the RPC response. A stable creation nonce makes that retry idempotent
-- without treating matching business fields as proof of document ownership.

alter table public.invoices
  add column if not exists client_create_id uuid,
  add column if not exists client_create_fingerprint text;

create unique index if not exists invoices_client_create_id_unique
  on public.invoices (client_create_id)
  where client_create_id is not null;

create or replace function public.save_invoice_atomic(
  p_invoice jsonb,
  p_items jsonb default null,
  p_payments jsonb default null,
  p_base_version integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.invoices%rowtype;
  v_next public.invoices%rowtype;
  v_update_set text;
  v_insert_columns text;
  v_insert_values text;
  v_invoice_id text;
  v_client_create_id uuid;
  v_create_fingerprint text;
  v_existing_payment record;
  v_requested_payment record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if p_invoice is null or jsonb_typeof(p_invoice) <> 'object'
     or nullif(btrim(coalesce(p_invoice ->> 'id', '')), '') is null then
    raise exception 'NSA_BAD_INPUT:invoice id required' using errcode = '22023';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'NSA_BAD_INPUT:items must be an array or null' using errcode = '22023';
  end if;
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'NSA_BAD_INPUT:payments must be an array or null' using errcode = '22023';
  end if;

  v_invoice_id := p_invoice ->> 'id';
  v_client_create_id := nullif(btrim(coalesce(p_invoice ->> 'client_create_id', '')), '')::uuid;
  v_create_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'invoice', p_invoice - array['_version', 'client_create_fingerprint'],
    'items', p_items, 'payments', p_payments
  )::text, 'UTF8')), 'hex');
  select * into v_existing from public.invoices where id = v_invoice_id for update;
  if found then
    if p_base_version is null then
      -- A nonce identifies the create, while its fingerprint identifies the exact
      -- draft. New edits made after a lost response must never be acknowledged as
      -- saved just because they carry the same create identity.
      if v_client_create_id is not null
         and v_existing.client_create_id = v_client_create_id then
        if v_existing._version = 1 and v_existing.client_create_fingerprint = v_create_fingerprint then
          return jsonb_build_object('ok', true, 'version', v_existing._version, 'idempotent', true);
        end if;
        return jsonb_build_object('ok', false, 'reason', 'STALE', 'version', v_existing._version);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'ID_EXISTS', 'version', v_existing._version);
    end if;
    if v_existing._version is distinct from p_base_version then
      return jsonb_build_object('ok', false, 'reason', 'STALE', 'version', v_existing._version);
    end if;

    -- Validate the immutable payment ledger before changing the header. A JSON
    -- status return after a header UPDATE would otherwise commit a partial save.
    if p_payments is not null then
      if exists (
        select 1 from jsonb_to_recordset(p_payments) as p(ref text)
        group by ref having ref is null or count(*) <> 1
      ) then
        raise exception 'NSA_BAD_INPUT:every payment needs one unique reference' using errcode = '22023';
      end if;
      for v_existing_payment in
        select amount, method, ref, date, cc_fee
          from public.invoice_payments where invoice_id = v_invoice_id for update
      loop
        select p.amount, p.method, p.ref, p.date, coalesce(p.cc_fee, 0) as cc_fee
          into v_requested_payment
          from jsonb_to_recordset(p_payments) as p(amount numeric, method text, ref text, date text, cc_fee numeric)
         where p.ref = v_existing_payment.ref;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'PAYMENT_REMOVAL_REQUIRES_REVERSAL');
        end if;
        if v_requested_payment.amount is distinct from v_existing_payment.amount
           or v_requested_payment.method is distinct from v_existing_payment.method
           or v_requested_payment.date is distinct from v_existing_payment.date
           or v_requested_payment.cc_fee is distinct from v_existing_payment.cc_fee then
          return jsonb_build_object('ok', false, 'reason', 'PAYMENT_IMMUTABLE');
        end if;
      end loop;
    end if;

    v_next := jsonb_populate_record(null::public.invoices,
      to_jsonb(v_existing) || (p_invoice - array['id', '_version']));
    v_next.id := v_existing.id;
    v_next._version := v_existing._version;
    select string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum)
      into v_update_set
      from pg_attribute
     where attrelid = 'public.invoices'::regclass
       and attnum > 0 and not attisdropped and attname not in ('id', '_version');
    execute format(
      'insert into public.invoices select ($1::public.invoices).* on conflict (id) do update set %s',
      v_update_set
    ) using v_next;
  else
    if p_base_version is not null then
      return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
    end if;
    if v_client_create_id is not null and exists (
      select 1 from public.invoices where client_create_id = v_client_create_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'CREATE_NONCE_COLLISION');
    end if;
    p_invoice := p_invoice || jsonb_build_object('client_create_fingerprint', v_create_fingerprint);
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('(jsonb_populate_record(null::public.invoices, $1)).%I', a.attname), ', ' order by a.attnum)
      into v_insert_columns, v_insert_values
      from pg_attribute a
      join jsonb_object_keys(p_invoice - '_version') as key(name) on key.name = a.attname
     where a.attrelid = 'public.invoices'::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('insert into public.invoices (%s) select %s', v_insert_columns, v_insert_values)
      using (p_invoice - '_version');
  end if;

  -- An invoice payment is accounting history. This save may add a referenced
  -- payment, but it never turns an omitted row into a silent delete.
  if p_payments is not null then
    insert into public.invoice_payments (invoice_id, amount, method, ref, date, cc_fee)
    select v_invoice_id, p.amount, p.method, p.ref, p.date, coalesce(p.cc_fee, 0)
      from jsonb_to_recordset(p_payments) as p(amount numeric, method text, ref text, date text, cc_fee numeric)
    on conflict (invoice_id, ref) do nothing;
  end if;

  if p_items is not null then
    delete from public.invoice_items where invoice_id = v_invoice_id;
    insert into public.invoice_items (invoice_id, sku, name, qty, unit_price, total, description)
    select v_invoice_id, i.sku, i.name, i.qty, i.unit_price, i.total, i.description
      from jsonb_to_recordset(p_items) as i(
        sku text, name text, qty integer, unit_price numeric, total numeric, description text
      );
  end if;

  select * into v_existing from public.invoices where id = v_invoice_id;
  return jsonb_build_object('ok', true, 'version', v_existing._version);
end;
$$;

revoke all on function public.save_invoice_atomic(jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function public.save_invoice_atomic(jsonb, jsonb, jsonb, integer) to authenticated, service_role;
