-- Split only invoices with no applied money. The UI used to set both invoice
-- objects locally and let two independent autosaves race; a failed second save
-- could leave the original reduced with no sibling invoice.

create or replace function public.split_unpaid_invoice_atomic(
  p_original jsonb,
  p_split jsonb,
  p_base_version integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_live public.invoices%rowtype;
  v_original_result jsonb;
  v_split_result jsonb;
  v_original_id text;
  v_split_id text;
  v_original_total numeric;
  v_split_total numeric;
  v_original_shipping numeric;
  v_split_shipping numeric;
  v_original_tax numeric;
  v_split_tax numeric;
  v_original_items jsonb;
  v_split_items jsonb;
  v_original_header jsonb;
  v_split_header jsonb;
  v_live_partition jsonb;
  v_requested_partition jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if p_original is null or p_split is null
     or jsonb_typeof(p_original) <> 'object' or jsonb_typeof(p_split) <> 'object' then
    raise exception 'NSA_BAD_INPUT:two invoice objects required' using errcode = '22023';
  end if;
  v_original_id := nullif(btrim(coalesce(p_original ->> 'id', '')), '');
  v_split_id := nullif(btrim(coalesce(p_split ->> 'id', '')), '');
  if v_original_id is null or v_split_id is null or v_original_id = v_split_id
     or p_base_version is null then
    raise exception 'NSA_BAD_INPUT:distinct invoice ids and a base version required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_original -> 'line_items', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_split -> 'line_items', '[]'::jsonb)) <> 'array' then
    raise exception 'NSA_BAD_INPUT:split line_items must be arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_original -> 'line_items', '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p_split -> 'line_items', '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY_SPLIT');
  end if;

  select * into v_live from public.invoices where id = v_original_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_live._version is distinct from p_base_version then
    return jsonb_build_object('ok', false, 'reason', 'STALE', 'version', v_live._version);
  end if;
  if exists (select 1 from public.invoices where id = v_split_id) then
    return jsonb_build_object('ok', false, 'reason', 'ID_EXISTS');
  end if;
  if (p_original ->> 'customer_id') is distinct from v_live.customer_id
     or (p_split ->> 'customer_id') is distinct from v_live.customer_id
     or (p_original ->> 'so_id') is distinct from v_live.so_id
     or (p_split ->> 'so_id') is distinct from v_live.so_id then
    return jsonb_build_object('ok', false, 'reason', 'PARENT_MISMATCH');
  end if;

  -- No split may alter money already applied. Payment tuples, deposits, credits,
  -- and card fees stay on their original financial document until an auditable
  -- reversal/credit workflow handles them. Only an open invoice may be split.
  if coalesce(v_live.paid, 0) <> 0
     or coalesce(v_live.credit_amount, 0) <> 0
     or coalesce(v_live.deposit_applied, 0) <> 0
     or coalesce(v_live.deposit_pct, 0) <> 0
     or coalesce(v_live.cc_fee, 0) <> 0
     or coalesce(v_live.status, 'open') <> 'open'
     or exists (select 1 from public.invoice_payments where invoice_id = v_original_id) then
    return jsonb_build_object('ok', false, 'reason', 'INVOICE_NOT_UNPAID');
  end if;

  -- The request is a whole frontend object, so explicitly prevent it from
  -- smuggling money or a non-open lifecycle state into either saved header.
  if coalesce((p_original ->> 'paid')::numeric, 0) <> 0
     or coalesce((p_split ->> 'paid')::numeric, 0) <> 0
     or coalesce((p_original ->> 'credit_amount')::numeric, 0) <> 0
     or coalesce((p_split ->> 'credit_amount')::numeric, 0) <> 0
     or coalesce((p_original ->> 'deposit_applied')::numeric, 0) <> 0
     or coalesce((p_split ->> 'deposit_applied')::numeric, 0) <> 0
     or coalesce((p_original ->> 'deposit_pct')::numeric, 0) <> 0
     or coalesce((p_split ->> 'deposit_pct')::numeric, 0) <> 0
     or coalesce((p_original ->> 'cc_fee')::numeric, 0) <> 0
     or coalesce((p_split ->> 'cc_fee')::numeric, 0) <> 0
     or coalesce(p_original ->> 'status', 'open') <> 'open'
     or coalesce(p_split ->> 'status', 'open') <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'SPLIT_MONEY_FIELDS_FORBIDDEN');
  end if;

  -- The two requested arrays must be a true partition of the locked original,
  -- including duplicate lines. jsonb text is canonicalized, so ordering does
  -- not affect this multiset comparison.
  select coalesce(jsonb_agg(value order by value::text), '[]'::jsonb)
    into v_live_partition
    from jsonb_array_elements(coalesce(v_live.line_items, '[]'::jsonb));
  select coalesce(jsonb_agg(value order by value::text), '[]'::jsonb)
    into v_requested_partition
    from (
      select value from jsonb_array_elements(p_original -> 'line_items')
      union all
      select value from jsonb_array_elements(p_split -> 'line_items')
    ) requested;
  if v_live_partition is distinct from v_requested_partition then
    return jsonb_build_object('ok', false, 'reason', 'LINE_PARTITION_MISMATCH');
  end if;

  v_original_total := round(coalesce((p_original ->> 'total')::numeric, 0), 2);
  v_split_total := round(coalesce((p_split ->> 'total')::numeric, 0), 2);
  v_original_shipping := round(coalesce((p_original ->> 'shipping')::numeric, 0), 2);
  v_split_shipping := round(coalesce((p_split ->> 'shipping')::numeric, 0), 2);
  v_original_tax := round(coalesce((p_original ->> 'tax')::numeric, 0), 2);
  v_split_tax := round(coalesce((p_split ->> 'tax')::numeric, 0), 2);
  if abs(round(coalesce(v_live.total, 0), 2) - round(v_original_total + v_split_total, 2)) >= 0.005 then
    return jsonb_build_object('ok', false, 'reason', 'TOTAL_MISMATCH');
  end if;
  if abs(round(coalesce(v_live.shipping, 0), 2) - round(v_original_shipping + v_split_shipping, 2)) >= 0.005
     or abs(round(coalesce(v_live.tax, 0), 2) - round(v_original_tax + v_split_tax, 2)) >= 0.005
     or abs(v_original_total - round(
       coalesce((select sum((value ->> 'amount')::numeric) from jsonb_array_elements(p_original -> 'line_items')), 0)
       + v_original_shipping + v_original_tax, 2)) >= 0.005
     or abs(v_split_total - round(
       coalesce((select sum((value ->> 'amount')::numeric) from jsonb_array_elements(p_split -> 'line_items')), 0)
       + v_split_shipping + v_split_tax, 2)) >= 0.005 then
    return jsonb_build_object('ok', false, 'reason', 'SPLIT_COMPONENT_MISMATCH');
  end if;

  -- line_items is the split editor's canonical source. Rebuild the legacy
  -- relational cache from each new array; never copy the old cache to both
  -- documents. save_invoice_atomic whitelists the actual invoice columns, so
  -- transient frontend fields in these whole-object inputs are ignored.
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku', coalesce(value ->> 'sku', value ->> '_sku'),
    'name', coalesce(value ->> 'name', value ->> '_name'),
    'qty', value -> 'qty',
    'unit_price', coalesce(value -> 'unit_price', value -> 'rate'),
    'total', coalesce(value -> 'total', value -> 'amount'),
    'description', coalesce(value ->> 'description', value ->> 'desc')
  )), '[]'::jsonb)
    into v_original_items
    from jsonb_array_elements(p_original -> 'line_items');
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku', coalesce(value ->> 'sku', value ->> '_sku'),
    'name', coalesce(value ->> 'name', value ->> '_name'),
    'qty', value -> 'qty',
    'unit_price', coalesce(value -> 'unit_price', value -> 'rate'),
    'total', coalesce(value -> 'total', value -> 'amount'),
    'description', coalesce(value ->> 'description', value ->> 'desc')
  )), '[]'::jsonb)
    into v_split_items
    from jsonb_array_elements(p_split -> 'line_items');

  select public.save_invoice_atomic(p_original, v_original_items, null, p_base_version)
    into v_original_result;
  if coalesce((v_original_result ->> 'ok')::boolean, false) is not true then
    raise exception 'SPLIT_ORIGINAL_SAVE_FAILED:%', coalesce(v_original_result ->> 'reason', 'UNKNOWN');
  end if;
  -- A split is one server-side transaction, not a browser create retry. Do not
  -- clone the original's client-create nonce onto the sibling invoice.
  select public.save_invoice_atomic(p_split - 'client_create_id', v_split_items, null, null)
    into v_split_result;
  if coalesce((v_split_result ->> 'ok')::boolean, false) is not true then
    -- An exception rolls the first successful save back too (including an ID
    -- collision that slipped in after the initial absence check).
    raise exception 'SPLIT_NEW_SAVE_FAILED:%', coalesce(v_split_result ->> 'reason', 'UNKNOWN');
  end if;

  select to_jsonb(i) into v_original_header from public.invoices i where i.id = v_original_id;
  select to_jsonb(i) into v_split_header from public.invoices i where i.id = v_split_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb)
    into v_original_items from public.invoice_items i where i.invoice_id = v_original_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb)
    into v_split_items from public.invoice_items i where i.invoice_id = v_split_id;
  return jsonb_build_object(
    'ok', true,
    'original', v_original_header,
    'split', v_split_header,
    'original_items', v_original_items,
    'split_items', v_split_items
  );
end;
$$;

revoke all on function public.split_unpaid_invoice_atomic(jsonb, jsonb, integer) from public, anon;
grant execute on function public.split_unpaid_invoice_atomic(jsonb, jsonb, integer) to authenticated, service_role;
