-- Preserve every intervening conversion fix; fail closed if the expected
-- accounting block has changed. Existing invoices are intentionally not rewritten.
alter table public.invoices add column if not exists tax_state text;

do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_all_school_sales_order(uuid)'::regprocedure);
  if position('all_school_checkout_accounting_v1' in definition)>0 then return; end if;
  if position($old$    -- Card-settlement clamp (00199's batch-path rule): apply the smaller of the
    -- invoice total and what the store order actually collected.
    v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

$old$ in definition)=0 then
    raise exception 'All School invoice block changed; review accounting migration';
  end if;
  definition := replace(definition,$old$    -- Card-settlement clamp (00199's batch-path rule): apply the smaller of the
    -- invoice total and what the store order actually collected.
    v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

$old$,$new$    -- all_school_checkout_accounting_v1: checkout is the money source of truth.
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

-- Carry the buyer's jurisdiction through the existing snapshot wrappers. The
-- school's address may differ from the ship-to address on an individual order.
do $migration$
declare definition text;
begin
  if to_regprocedure('public.qbo_sales_source_snapshot_without_links(timestamp with time zone)') is null then
    return; -- compact isolated test schemas do not install the QBO integration
  end if;
  definition := pg_get_functiondef('public.qbo_sales_source_snapshot_without_links(timestamp with time zone)'::regprocedure);
  if position($$'tax_state',i.tax_state$$ in definition)>0 then return; end if;
  if position($$'tax',i.tax,'tax_rate',i.tax_rate$$ in definition)=0 then
    raise exception 'QBO snapshot tax fields changed; review accounting migration';
  end if;
  execute replace(definition,$$'tax',i.tax,'tax_rate',i.tax_rate$$,
    $$'tax',i.tax,'tax_state',i.tax_state,'tax_rate',i.tax_rate$$);
end $migration$;
