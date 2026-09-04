-- Atomic customer/contact and invoice save boundaries.
--
-- The browser used to write these parent and child rows through separate PostgREST
-- requests.  A contact fallback could delete valid contacts after an upsert error,
-- and invoice's pre-read version check could be overtaken before its whole-row
-- upsert.  These SECURITY INVOKER functions make each replacement one transaction.

create or replace function public.save_customer_atomic(
  p_customer jsonb,
  p_contacts jsonb default null,
  p_base_version integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.customers%rowtype;
  v_next public.customers%rowtype;
  v_update_set text;
  v_insert_columns text;
  v_insert_values text;
  v_contact jsonb;
  v_customer_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if p_customer is null or jsonb_typeof(p_customer) <> 'object'
     or nullif(btrim(coalesce(p_customer ->> 'id', '')), '') is null then
    raise exception 'NSA_BAD_INPUT:customer id required' using errcode = '22023';
  end if;
  if p_contacts is not null and jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'NSA_BAD_INPUT:contacts must be an array or null' using errcode = '22023';
  end if;

  v_customer_id := p_customer ->> 'id';
  select * into v_existing from public.customers where id = v_customer_id for update;

  if found then
    if p_base_version is null then
      return jsonb_build_object('ok', false, 'reason', 'VERSION_REQUIRED', 'version', v_existing._version);
    end if;
    if v_existing._version is distinct from p_base_version then
      return jsonb_build_object('ok', false, 'reason', 'STALE', 'version', v_existing._version);
    end if;

    -- Overlay only supplied values onto the locked row. This preserves fields from
    -- older clients that do not know a newer customer column.
    v_next := jsonb_populate_record(null::public.customers,
      to_jsonb(v_existing) || (p_customer - array['id', '_version']));
    v_next.id := v_existing.id;

    select string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum)
      into v_update_set
      from pg_attribute
     where attrelid = 'public.customers'::regclass
       and attnum > 0 and not attisdropped and attname not in ('id', '_version');
    execute format(
      'insert into public.customers select ($1::public.customers).* on conflict (id) do update set %s',
      v_update_set
    ) using v_next;
  else
    if p_base_version is not null then
      return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
    end if;
    -- Insert only supplied columns. Inserting a whole populated record would
    -- explicitly send NULL for omitted fields and bypass their table defaults.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('(jsonb_populate_record(null::public.customers, $1)).%I', a.attname), ', ' order by a.attnum)
      into v_insert_columns, v_insert_values
      from pg_attribute a
      join jsonb_object_keys(p_customer - '_version') as key(name) on key.name = a.attname
     where a.attrelid = 'public.customers'::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('insert into public.customers (%s) select %s', v_insert_columns, v_insert_values)
      using (p_customer - '_version');
  end if;

  -- null means this client never loaded contacts; [] means the user explicitly
  -- removed every contact. Delete/reinsert is safe here because any insert error
  -- aborts the complete transaction and restores the original list.
  if p_contacts is not null then
    delete from public.customer_contacts where customer_id = v_customer_id;
    for v_contact in
      select value || jsonb_build_object('sort_order', ordinal - 1)
        from jsonb_array_elements(p_contacts) with ordinality as contact(value, ordinal)
    loop
      insert into public.customer_contacts (customer_id, name, email, phone, role, sort_order)
      values (
        v_customer_id,
        v_contact ->> 'name',
        v_contact ->> 'email',
        v_contact ->> 'phone',
        v_contact ->> 'role',
        coalesce((v_contact ->> 'sort_order')::integer, 0)
      );
    end loop;
  end if;

  select * into v_existing from public.customers where id = v_customer_id;
  return jsonb_build_object('ok', true, 'version', v_existing._version);
end;
$$;

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
  select * into v_existing from public.invoices where id = v_invoice_id for update;
  if found then
    if p_base_version is null then
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
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('(jsonb_populate_record(null::public.invoices, $1)).%I', a.attname), ', ' order by a.attnum)
      into v_insert_columns, v_insert_values
      from pg_attribute a
      join jsonb_object_keys(p_invoice - '_version') as key(name) on key.name = a.attname
     where a.attrelid = 'public.invoices'::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('insert into public.invoices (%s) select %s', v_insert_columns, v_insert_values)
      using (p_invoice - '_version');
  end if;

  -- An invoice payment is accounting history. This save may add or correct a
  -- referenced payment, but it never turns an omitted row into a silent delete;
  -- a separate reversal workflow must record that decision.
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

revoke all on function public.save_customer_atomic(jsonb, jsonb, integer) from public, anon;
revoke all on function public.save_invoice_atomic(jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function public.save_customer_atomic(jsonb, jsonb, integer) to authenticated, service_role;
grant execute on function public.save_invoice_atomic(jsonb, jsonb, jsonb, integer) to authenticated, service_role;

-- This is deliberately scoped to firm dates. The full sales-order save has many
-- independently guarded children, but the old date path deleted the old rows in
-- one request and inserted replacements in another. This boundary prevents a
-- failed replacement from committing an empty schedule.
create or replace function public.replace_so_firm_dates_atomic(
  p_so_id text,
  p_firm_dates jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_date jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_so_id, '')), '') is null
     or jsonb_typeof(p_firm_dates) <> 'array' then
    raise exception 'NSA_BAD_INPUT:order id and date array required' using errcode = '22023';
  end if;
  perform 1 from public.sales_orders where id = p_so_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  delete from public.so_firm_dates where so_id = p_so_id;
  for v_date in select value from jsonb_array_elements(p_firm_dates) loop
    insert into public.so_firm_dates (so_id, item_desc, date, approved)
    values (p_so_id, v_date ->> 'item_desc', v_date ->> 'date', coalesce((v_date ->> 'approved')::boolean, false));
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.replace_so_firm_dates_atomic(text, jsonb) from public, anon;
grant execute on function public.replace_so_firm_dates_atomic(text, jsonb) to authenticated, service_role;
