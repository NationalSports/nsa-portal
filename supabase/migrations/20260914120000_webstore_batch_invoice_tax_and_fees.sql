-- Webstore batch money on the Sales Order and its invoice.
--
-- Until now the batch invoice billed garments only (tax-exempt, $0 tax) and the
-- SO carried none of the checkout money beyond product: the sales tax, online
-- processing fee and shipping the buyers paid, and the Stripe card fees NSA was
-- charged, lived only in the store's Analytics tab.  Books did not tie out: the
-- invoice said $4,485 "paid" while Stripe deposited $5,056 less fees.
--
-- This version of finalize_webstore_batch, derived from the locked orders only:
--   * invoice total = product lines + shipping charged + processing fee + sales tax
--     (tax in invoices.tax, shipping in invoices.shipping, processing as its own
--     line), so the card payment recorded equals what the cards were charged and
--     the team-tab balance equals the tab orders' gross;
--   * writes the same money onto the SO's existing store columns
--     (_omg_processing = revenue, _omg_tax = pass-through collected for the state,
--     _omg_shipping = shipping charged, _omg_cc_fees = Stripe cost) so the SO
--     editor, print and commissions see it;
--   * absorbs cents-level line-price drift (coupon scaling) with a rounding line,
--     capped at 0.1% of product money (at least $1), so the invoice product total
--     is exactly the product money collected; a larger gap is returned, not hidden;
--   * scales tax / processing / shipping by each order's net-of-refund share;
--   * returns store_money and the SO's new _version so the client can patch the
--     SO it just created without tripping its own version guard.
-- Same locking, claim validation, idempotency and grants as 20260902070000.

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
  v_garment_net numeric := 0;
  v_rounding numeric := 0;
  v_rounding_gap numeric := 0;
  v_round_cap numeric := 1.00;
  v_so_version bigint;
  v_tax numeric := 0;
  v_processing numeric := 0;
  v_shipping numeric := 0;
  v_cc_fees numeric := 0;
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

  -- Every dollar of the batch, rebuilt from the locked orders.  Product money
  -- (subtotal + fundraise, less the garment share of coupons) is what the SO
  -- lines were priced from; tax, processing and shipping are the checkout
  -- extras every order paid (card or team tab); cc_fee is the Stripe cost NSA
  -- was charged on the card orders.
  select
    coalesce(round(sum(greatest(coalesce(o.original_total, o.total, 0) - coalesce(o.refunded_amt, 0), 0))
      filter (where o.payment_mode = 'paid'), 2), 0),
    coalesce(round(sum(greatest(coalesce(o.original_total, o.total, 0) - coalesce(o.refunded_amt, 0), 0))
      filter (where o.payment_mode is distinct from 'paid'), 2), 0),
    coalesce(sum(greatest(coalesce(o.subtotal, 0) + coalesce(o.fundraise_amt, 0), 0)), 0),
    coalesce(sum(least(greatest(coalesce(o.discount_amt, 0), 0),
                           greatest(coalesce(o.subtotal, 0) + coalesce(o.fundraise_amt, 0), 0))), 0),
    coalesce(round(sum(greatest(coalesce(o.tax, 0), 0) * f.net_factor), 2), 0),
    coalesce(round(sum(greatest(coalesce(o.processing_fee, 0), 0) * f.net_factor), 2), 0),
    coalesce(round(sum(greatest(coalesce(o.shipping_fee, 0), 0) * f.net_factor), 2), 0),
    coalesce(round(sum(greatest(coalesce(o.cc_fee, 0), 0)) filter (where o.payment_mode = 'paid'), 2), 0)
    into v_card_total, v_tab_total, v_garment_gross, v_discount,
         v_tax, v_processing, v_shipping, v_cc_fees
    from public.webstore_orders o
    -- A partial refund is not broken down by tax/fee, so the extras are scaled by the
    -- order's net-of-refund share; the card total is already net, and this keeps the
    -- invoice from billing tax or fees on money that was handed back. Stripe keeps its
    -- fee on a refund, so cc_fee stays gross.
    cross join lateral (
      select case when coalesce(o.original_total, o.total, 0) > 0
                  then greatest(coalesce(o.original_total, o.total, 0) - coalesce(o.refunded_amt, 0), 0)
                       / coalesce(o.original_total, o.total, 0)
                  else 1 end as net_factor
    ) f
   where o.id = any(v_ids) and o.so_id = p_so_id;

  v_garment_net := round(greatest(v_garment_gross - v_discount, 0), 2);

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

  -- Cents-level drift only: a unit_sell scaled by a coupon (or averaged) cannot
  -- always be multiplied back to the exact collected amount.  The cap scales with
  -- the batch (0.1% of product money, at least $1) so a big coupon batch still
  -- ties out; a larger gap (a partial refund, a data problem) is left visible and
  -- returned as rounding_gap for the client to flag, never papered over.
  -- Both extra lines carry _so_balance_adjustment so the SO↔invoice reconciler
  -- treats them as billed money, not as product lines that vanished from the SO.
  v_round_cap := greatest(1.00, round(v_garment_net * 0.001, 2));
  v_rounding := round(v_garment_net - v_items_total, 2);
  if v_items_total > 0 and abs(v_rounding) >= 0.005 and abs(v_rounding) <= v_round_cap then
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'desc', 'Line-price rounding (ties product lines to the amount collected)',
      'qty', 1, 'rate', v_rounding, 'amount', v_rounding,
      '_sku', '', '_name', 'Line-price rounding', '_color', '', '_so_balance_adjustment', true));
    v_items_total := round(v_items_total + v_rounding, 2);
  elsif abs(v_rounding) >= 0.005 then
    v_rounding_gap := v_rounding;
    v_rounding := 0;
  else
    v_rounding := 0;
  end if;

  if v_processing > 0 then
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'desc', 'Online processing fee (charged at checkout)',
      'qty', 1, 'rate', v_processing, 'amount', v_processing,
      '_sku', '', '_name', 'Online processing fee', '_color', '', '_so_balance_adjustment', true));
  end if;

  v_inv_total := round(v_items_total + v_processing + v_shipping + v_tax, 2);
  -- Card orders are already collected; whatever the team tab does not owe is
  -- applied from those funds, capped at what the cards were actually charged.
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

    -- The SO's money columns are derived here, never taken from the client, and only
    -- together with the invoice that bills them: an SO whose invoice was created by
    -- the earlier product-only finalizer must not gain fees its invoice never billed.
    update public.sales_orders
       set _omg_processing = v_processing,
           _omg_tax = v_tax,
           _omg_shipping = v_shipping,
           _omg_cc_fees = v_cc_fees
     where id = p_so_id;

    -- tax is the amount the store collected (Stripe Tax / store rate per order),
    -- not a rate applied to the subtotal, so tax_rate stays 0 and the amount is
    -- carried directly; tax_exempt reflects whether any tax was collected.
    insert into public.invoices (
      id, customer_id, so_id, idempotency_key, type, inv_type, date, due_date,
      total, paid, status, memo, tax, tax_rate, tax_exempt, shipping,
      line_items, created_at, updated_at
    ) values (
      v_inv_id, v_so.customer_id, p_so_id, 'webstore:' || p_so_id,
      'invoice', 'full', v_date, v_due_date,
      v_inv_total, v_applied, v_status,
      'Invoice — ' || coalesce(v_so.memo, p_so_id)
        || ' (includes checkout sales tax, shipping & processing fee)',
      v_tax, 0, (v_tax <= 0), v_shipping, v_line_items, now(), now()
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

    if v_rounding <> 0 then
      insert into public.invoice_items (invoice_id, sku, name, qty, unit_price, total, description)
      values (v_inv_id, '', 'Line-price rounding', 1, v_rounding, v_rounding,
              'Line-price rounding (ties product lines to the amount collected)');
    end if;

    if v_processing > 0 then
      insert into public.invoice_items (invoice_id, sku, name, qty, unit_price, total, description)
      values (v_inv_id, '', 'Online processing fee', 1, v_processing, v_processing,
              'Online processing fee (charged at checkout)');
    end if;

    if v_applied > 0 then
      -- cc_fee on a payment row is a surcharge ADDED to an invoice when a customer
      -- pays by card here; the Stripe cost of the store's card orders is not that,
      -- so it stays 0 and lives on the SO as _omg_cc_fees (a cost).
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

  -- The SO update above bumps sales_orders._version; hand it back so the client
  -- that just inserted the row does not see its own bump as a foreign edit.
  select _version into v_so_version from public.sales_orders where id = p_so_id;

  return jsonb_build_object(
    'ok', true,
    'so_id', p_so_id,
    'so_version', v_so_version,
    'linked_count', v_expected,
    'invoice_id', v_inv_id,
    'credit_id', v_credit_id,
    'invoice_total', v_inv_total,
    'applied', v_applied,
    'team_tab_balance', round(v_inv_total - v_applied, 2),
    'store_money', jsonb_build_object(
      'processing', v_processing,
      'tax', v_tax,
      'shipping', v_shipping,
      'cc_fees', v_cc_fees,
      'rounding', v_rounding,
      'rounding_gap', v_rounding_gap
    )
  );
end;
$$;

revoke all on function public.finalize_webstore_batch(text, uuid[]) from public;
revoke all on function public.finalize_webstore_batch(text, uuid[]) from anon;
grant execute on function public.finalize_webstore_batch(text, uuid[]) to authenticated;
grant execute on function public.finalize_webstore_batch(text, uuid[]) to service_role;

comment on function public.finalize_webstore_batch(text, uuid[]) is
  'Atomically claims webstore orders for a saved batch SO, records its invoice (product + checkout tax/shipping/processing) and card payment, writes the checkout money onto the SO, and books the fundraising credit. Staff/service only; idempotent for the same SO and order IDs.';
