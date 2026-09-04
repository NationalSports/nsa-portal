-- Webstore batch finalization used to be split across four browser writes:
-- sales order, fundraising credit, invoice/payment, then order links.  The credit
-- and invoice writes were not awaited, so closing the tab (or one failed request)
-- could leave a production SO without its accounting records.  Finalize the
-- money-of-record rows and order claim in one server transaction instead.

create or replace function public.finalize_webstore_batch(
  p_so_id text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.sales_orders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_eligible int;
  v_inv_id text;
  v_inv_num bigint;
  v_line_items jsonb := '[]'::jsonb;
  v_items_total numeric := 0;
  v_card_total numeric := 0;
  v_tab_total numeric := 0;
  v_garment_gross numeric := 0;
  v_discount numeric := 0;
  v_discount_ratio numeric := 1;
  v_tab_product numeric := 0;
  v_tab_extras numeric := 0;
  v_inv_total numeric := 0;
  v_applied numeric := 0;
  v_status text;
  v_term_days int := 30;
  v_date text := to_char(now(), 'YYYY-MM-DD');
  v_due_date text;
  v_credit_id text;
begin
  if not public.is_team_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'active staff session required' using errcode = '42501';
  end if;

  select array_agg(distinct x order by x)
    into v_ids
    from unnest(coalesce(p_order_ids, array[]::uuid[])) x;
  v_expected := coalesce(cardinality(v_ids), 0);
  if p_so_id is null or btrim(p_so_id) = '' or v_expected = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_sales_order_or_orders');
  end if;

  -- Serialize retries/double-clicks for this SO and lock the production document.
  perform pg_advisory_xact_lock(hashtext('webstore_batch:' || p_so_id));
  select * into v_so from public.sales_orders where id = p_so_id for update;
  if not found or v_so.source is distinct from 'webstore' or v_so.webstore_id is null
      or v_so.customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_webstore_sales_order');
  end if;

  -- Lock every requested order before validating the complete claim.  A retry is
  -- allowed when rows already point at this same SO; a competing SO is never stolen.
  perform 1
    from public.webstore_orders o
   where o.id = any(v_ids)
   order by o.id
   for update;

  select count(*)::int into v_eligible
    from public.webstore_orders o
   where o.id = any(v_ids)
     and o.store_id = v_so.webstore_id
     and o.backorder_of is null
     and coalesce(btrim(o.status), '') !~* '^(cancelled|canceled|pending_payment|refunded)$'
     and (o.so_id is null or o.so_id = p_so_id);

  if v_eligible <> v_expected then
    return jsonb_build_object(
      'ok', false,
      'reason', 'order_claim_changed',
      'expected_count', v_expected,
      'eligible_count', v_eligible
    );
  end if;

  update public.webstore_orders
     set so_id = p_so_id, status = 'batched'
   where id = any(v_ids)
     and (so_id is null or so_id = p_so_id);

  -- Rebuild the exact settlement split from the locked orders.  This mirrors
  -- Webstores.js: original total less refunds, discounts allocated over the
  -- product/fundraising share, and only team-tab extras added above SO lines.
  select
    coalesce(round(sum(greatest(coalesce(o.original_total, o.total, 0) - coalesce(o.refunded_amt, 0), 0))
      filter (where o.payment_mode = 'paid'), 2), 0),
    coalesce(round(sum(greatest(coalesce(o.original_total, o.total, 0) - coalesce(o.refunded_amt, 0), 0))
      filter (where o.payment_mode is distinct from 'paid'), 2), 0),
    coalesce(sum(greatest(coalesce(o.subtotal, 0) + coalesce(o.fundraise_amt, 0), 0)), 0),
    coalesce(sum(least(greatest(coalesce(o.discount_amt, 0), 0),
                           greatest(coalesce(o.subtotal, 0) + coalesce(o.fundraise_amt, 0), 0))), 0),
    coalesce(sum(greatest(coalesce(o.subtotal, 0) + coalesce(o.fundraise_amt, 0), 0))
      filter (where o.payment_mode is distinct from 'paid'), 0)
    into v_card_total, v_tab_total, v_garment_gross, v_discount, v_tab_product
    from public.webstore_orders o
   where o.id = any(v_ids) and o.so_id = p_so_id;

  if v_garment_gross > 0 then
    v_discount_ratio := greatest(0, (v_garment_gross - v_discount) / v_garment_gross);
  end if;
  v_tab_product := round(v_tab_product * v_discount_ratio, 2);
  v_tab_extras := least(v_tab_total, greatest(0, round(v_tab_total - v_tab_product, 2)));

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'desc', li.description, 'qty', li.qty, 'rate', li.rate, 'amount', li.amount,
      '_sku', li.sku, '_name', li.name, '_color', li.color
    ) order by li.item_index), '[]'::jsonb),
    coalesce(round(sum(li.amount), 2), 0)
    into v_line_items, v_items_total
    from (
      select it.item_index, it.sku, it.name, it.color,
             coalesce(it.sku, '') || case when coalesce(it.name, '') <> '' then ' ' || it.name else '' end
               || case when coalesce(it.color, '') <> '' then ' — ' || it.color else '' end as description,
             q.qty,
             coalesce(it.unit_sell, 0) as rate,
             round(q.qty * coalesce(it.unit_sell, 0), 2) as amount
        from public.so_items it
        cross join lateral (
          select case when coalesce(sum(v.value::numeric), 0) > 0
                      then coalesce(sum(v.value::numeric), 0)
                      else greatest(coalesce(it.est_qty, 0), 0) end as qty
            from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v
        ) q
       where it.so_id = p_so_id and q.qty > 0
    ) li;

  v_inv_total := round(v_items_total + v_tab_extras, 2);
  v_applied := round(least(greatest(v_inv_total - v_tab_total, 0), greatest(v_card_total, 0)), 2);
  v_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                   when v_applied > 0 then 'partial'
                   else 'open' end;

  select i.id into v_inv_id
    from public.invoices i
   where i.so_id = p_so_id or i.idempotency_key = 'webstore:' || p_so_id
   order by (i.idempotency_key = 'webstore:' || p_so_id) desc
   limit 1
   for update;

  if v_inv_id is null then
    perform pg_advisory_xact_lock(hashtext('nsa_invoices_id_mint'));
    select greatest(coalesce(max((regexp_match(id, '(\d+)'))[1]::bigint), 0), 1000) + 1
      into v_inv_num from public.invoices;
    v_inv_id := 'INV-' || v_inv_num;

    select coalesce(nullif(regexp_replace(c.payment_terms, '\D', '', 'g'), '')::int, 30)
      into v_term_days from public.customers c where c.id = v_so.customer_id;
    v_term_days := coalesce(nullif(v_term_days, 0), 30);
    v_due_date := to_char(current_date + v_term_days, 'YYYY-MM-DD');

    insert into public.invoices (
      id, customer_id, so_id, idempotency_key, type, inv_type, date, due_date,
      total, paid, status, memo, tax, tax_rate, tax_exempt, shipping,
      line_items, created_at, updated_at
    ) values (
      v_inv_id, v_so.customer_id, p_so_id, 'webstore:' || p_so_id,
      'invoice', 'full', v_date, v_due_date,
      v_inv_total, v_applied, v_status,
      'Invoice — ' || coalesce(v_so.memo, p_so_id)
        || case when v_tab_extras > 0 then ' (shipping line = team-tab tax/ship/processing)' else '' end,
      0, 0, true, v_tab_extras, v_line_items, now(), now()
    );

    insert into public.invoice_items (invoice_id, sku, name, qty, unit_price, total, description)
    select v_inv_id, it.sku, it.name, q.qty::int, coalesce(it.unit_sell, 0),
           round(q.qty * coalesce(it.unit_sell, 0), 2),
           coalesce(it.sku, '') || case when coalesce(it.name, '') <> '' then ' ' || it.name else '' end
             || case when coalesce(it.color, '') <> '' then ' — ' || it.color else '' end
      from public.so_items it
      cross join lateral (
        select case when coalesce(sum(v.value::numeric), 0) > 0
                    then coalesce(sum(v.value::numeric), 0)
                    else greatest(coalesce(it.est_qty, 0), 0) end as qty
          from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v
      ) q
     where it.so_id = p_so_id and q.qty > 0
     order by it.item_index;

    if v_applied > 0 then
      insert into public.invoice_payments (invoice_id, amount, method, ref, date, cc_fee)
      values (v_inv_id, v_applied, 'store', 'WEB ' || p_so_id, to_char(now(), 'MM/DD/YYYY'), 0)
      on conflict (invoice_id, ref) do nothing;
    end if;
  end if;

  if coalesce(v_so._webstore_fundraise, 0) > 0 then
    v_credit_id := 'cr_fund_so_' || p_so_id;
    insert into public.customer_credits (
      id, customer_id, amount, used, is_fundraise, source, created_by, created_at
    ) values (
      v_credit_id, v_so.customer_id, round(v_so._webstore_fundraise, 2), 0, true,
      'Webstore fundraising — ' || coalesce(v_so.memo, 'store') || ' · ' || p_so_id,
      'System (webstore batch)', now()
    ) on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'so_id', p_so_id,
    'linked_count', v_expected,
    'invoice_id', v_inv_id,
    'credit_id', v_credit_id,
    'invoice_total', v_inv_total,
    'applied', v_applied,
    'team_tab_balance', round(v_inv_total - v_applied, 2)
  );
end;
$$;

revoke all on function public.finalize_webstore_batch(text, uuid[]) from public;
revoke all on function public.finalize_webstore_batch(text, uuid[]) from anon;
grant execute on function public.finalize_webstore_batch(text, uuid[]) to authenticated;
grant execute on function public.finalize_webstore_batch(text, uuid[]) to service_role;

comment on function public.finalize_webstore_batch(text, uuid[]) is
  'Atomically claims webstore orders for a saved batch SO and records its invoice/payment and fundraising credit. Staff/service only; idempotent for the same SO and order IDs.';
