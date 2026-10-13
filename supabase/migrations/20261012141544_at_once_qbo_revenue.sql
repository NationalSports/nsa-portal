-- Preserve every intervening conversion fix; fail closed if the expected
-- accounting block has changed. Existing invoices are intentionally not rewritten.
alter table public.invoices add column if not exists tax_state text;

do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_club_sales_order(uuid)'::regprocedure);
  if position('club_checkout_accounting_v1' in definition)>0 then return; end if;
  if position($old$    -- Card-settlement clamp (00199's batch-path rule): apply the smaller of the
    -- invoice total and what the store order actually collected.
    v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

$old$ in definition)=0 then
    raise exception 'Club invoice block changed; review accounting migration';
  end if;
  definition := replace(definition,$old$    -- Card-settlement clamp (00199's batch-path rule): apply the smaller of the
    -- invoice total and what the store order actually collected.
    v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

$old$,$new$    -- club_checkout_accounting_v1: checkout is the money source of truth.
    -- This runs inside conversion's transaction, so invalid money rolls back
    -- the SO, jobs, reservations and order state together.
    if v_ord.total is null or v_ord.total < 0
       or least(coalesce(v_ord.subtotal,0),coalesce(v_ord.fundraise_amt,0),
                coalesce(v_ord.discount_amt,0),coalesce(v_ord.shipping_fee,0),
                coalesce(v_ord.processing_fee,0),coalesce(v_ord.tax,0)) < 0
       or coalesce(v_ord.discount_amt,0) > coalesce(v_ord.subtotal,0)+coalesce(v_ord.fundraise_amt,0)
       or round(v_ord.total::numeric,2) <> round((coalesce(v_ord.subtotal,0)
            +coalesce(v_ord.fundraise_amt,0)-coalesce(v_ord.discount_amt,0)
            +coalesce(v_ord.shipping_fee,0)+coalesce(v_ord.processing_fee,0)
            +coalesce(v_ord.tax,0))::numeric,2) then
      raise exception 'NSA_CHECKOUT_MONEY: checkout components do not match total';
    end if;
    if v_ord.total > 0 and nullif(trim(v_ord.stripe_pi_id),'') is null then
      raise exception 'NSA_CHECKOUT_MONEY: paid checkout requires Stripe payment identity';
    end if;
    if coalesce(v_ord.tax,0)>0 and nullif(trim(v_ord.tax_state),'') is null then
      raise exception 'NSA_CHECKOUT_MONEY: collected tax requires checkout jurisdiction';
    end if;

    -- Bound rounding by the actual units that were rounded to cents by the
    -- converter, rather than accepting arbitrary checkout/line discrepancies.
    v_applied := round((coalesce(v_ord.subtotal,0)+coalesce(v_ord.fundraise_amt,0)
                         -coalesce(v_ord.discount_amt,0)-v_inv_total)::numeric,2);
    if abs(v_applied) > greatest(0.01,v_total_units*0.005+0.005) then
      raise exception 'NSA_CHECKOUT_MONEY: product lines do not match checkout';
    end if;
    if v_applied <> 0 then
      v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
        'desc','Line-price rounding','qty',1,'rate',v_applied,'amount',v_applied,
        '_sku','','_name','Line-price rounding','_color','','_so_balance_adjustment',true));
    end if;
    if coalesce(v_ord.processing_fee,0)>0 then
      v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
        'desc','Online processing fee','qty',1,'rate',v_ord.processing_fee,'amount',v_ord.processing_fee,
        '_sku','','_name','Online processing fee','_color','','_so_balance_adjustment',true));
    end if;
    v_inv_total := round(v_ord.total::numeric,2);
    v_applied := v_inv_total;
    v_inv_status := 'paid';
    update sales_orders set _omg_processing=coalesce(v_ord.processing_fee,0),
      _omg_tax=coalesce(v_ord.tax,0),_omg_shipping=coalesce(v_ord.shipping_fee,0),
      _omg_cc_fees=coalesce(v_ord.cc_fee,0) where id=v_so_id;

$new$);
  definition := replace(definition,
    'memo, tax, tax_rate, tax_exempt, shipping,',
    'memo, tax, tax_rate, tax_exempt, shipping, tax_state,');
  definition := replace(definition,
    $$v_inv_total, v_applied, v_inv_status, 'Invoice — ' || v_memo, 0, 0, true, 0,$$,
    $$v_inv_total, v_applied, v_inv_status, 'Invoice — ' || v_memo,
      coalesce(v_ord.tax,0), 0, coalesce(v_ord.tax,0)=0, coalesce(v_ord.shipping_fee,0), upper(trim(v_ord.tax_state)),$$);
  definition := replace(definition,
    $$v_pay_ref := 'CLUB ' || coalesce(v_ord.order_number::text, v_ord.id::text);$$,
    $$v_pay_ref := 'Stripe ' || v_ord.stripe_pi_id;$$);
  -- The preceding SO sequence migration also matched the invoice MAX()
  -- expression in this function. Restore invoice-specific numbering only.
  definition := replace(definition,
    $old$max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 0), 1000) + 1
      into v_inv_num
      from invoices;$old$,
    $new$max(substring(id from 5)::bigint) filter (where id ~ '^INV-[0-9]{4,7}$'), 0), 1000) + 1
      into v_inv_num
      from invoices;$new$);
  execute definition;
end $migration$;


-- Attach source evidence without changing the portal customer or existing wrappers.
alter function public.qbo_sales_source_snapshot(timestamptz) rename to qbo_sales_source_snapshot_before_at_once;
create function public.qbo_sales_source_snapshot(p_source_cutoff timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select public.qbo_sales_source_snapshot_before_at_once(p_source_cutoff) || jsonb_build_object(
    'at_once_version',1,
    'at_once_sources',coalesce((select jsonb_object_agg(so_id,orders) from (
      select o.so_id,jsonb_agg(jsonb_build_object(
        'id',o.id,'order_number',o.order_number,'org_type',s.org_type,
        'customer_id',s.customer_id,'status',o.status,'total',o.total,
        'stripe_pi_id',o.stripe_pi_id,'refunded_amt',o.refunded_amt,
        'tax',o.tax,'shipping',o.shipping_fee
      )) orders
      from public.webstore_orders o join public.webstores s on s.id=o.store_id
      where o.so_id is not null and o.created_at <= p_source_cutoff
        and s.org_type in ('club','all_school')
        and coalesce(s.source,'webstore') <> 'omg'
        and coalesce(o.order_source,'') in ('','webstore','club','all_school')
      group by o.so_id
    ) sources),'{}'::jsonb)
  );
$$;
revoke all on function public.qbo_sales_source_snapshot(timestamptz) from public,anon,authenticated;
grant execute on function public.qbo_sales_source_snapshot(timestamptz) to service_role;
