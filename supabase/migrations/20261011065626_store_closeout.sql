-- Closeout is separate from collecting customer money or finishing production.
-- Ship this migration before the UI. No existing invoice/payment is rewritten.
alter table public.sales_orders
  add column if not exists store_closed_at timestamptz,
  add column if not exists store_costs_recorded_at timestamptz,
  add column if not exists store_closed_by text,
  add column if not exists store_closeout_platform_cost numeric;

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
  if not found or v_so.omg_store_id is not null or v_so.webstore_id is null
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
     and so_id is null;

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
    update public.sales_orders
       set _omg_processing = v_processing,
           _omg_tax = v_tax,
           _omg_shipping = v_shipping,
           _omg_cc_fees = v_cc_fees
     where id = p_so_id;
  end if;

  if v_inv_id is null and current_setting('nsa.close_store', true) = p_so_id then
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
      v_inv_total, 0, 'open',
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

    -- close_store applies funds after checking existing receipts and source references.

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


-- Staff UI goes through the authenticated endpoint. Only its service connection
-- may attest costs and shipment, with the actor resolved from the session.
create function public.close_store(p_so_id text, p_expected_version bigint, p_actor_id text,
  p_costs_recorded boolean, p_shipped boolean, p_invoice jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.sales_orders%rowtype;
  i public.invoices%rowtype;
  v_omg public.omg_stores%rowtype;
  v_platform_cost numeric := 0;
  v_saved_total numeric;
  v_processing numeric; v_tax numeric; v_shipping numeric; v_fundraise numeric;
  v_count integer; v_num bigint; v_funds numeric; v_paid numeric; v_apply numeric;
  v_ref text; v_ids uuid[]; v_result jsonb; v_lines jsonb; v_total numeric;
begin
  if current_user <> 'service_role' then raise exception 'Staff closeout endpoint required'; end if;
  if not exists(select 1 from public.team_members where id=p_actor_id and is_active is not false) then
    raise exception 'Active staff actor required';
  end if;
  -- Same order as batch finalization; store lock also serializes two SOs for one OMG store.
  perform pg_advisory_xact_lock(hashtext('webstore_batch:' || p_so_id));
  select * into s from public.sales_orders where id=p_so_id for update;
  if not found or s.deleted_at is not null or (s.omg_store_id is null and s.webstore_id is null) then
    raise exception 'Store sales order required';
  end if;
  if s.omg_store_id is not null then
    perform pg_advisory_xact_lock(hashtext('omg-close:' || s.omg_store_id));
    if exists(select 1 from public.sales_orders x where x.omg_store_id=s.omg_store_id and x.id<>s.id and x.deleted_at is null) then
      raise exception 'Multiple sales orders share this OMG store. Reconcile their funds before closing.';
    end if;
  end if;
  if s.store_closed_at is null then
    if exists(select 1 from public.so_item_decorations d join public.so_items it on it.id=d.so_item_id where it.so_id=s.id and coalesce((to_jsonb(d)->>'inventory_cost_missing')::boolean,false)) then raise exception 'Record missing inventory costs before closing the store'; end if;
    if not coalesce(p_costs_recorded,false) or not coalesce(p_shipped,false) then
      raise exception 'Confirm all costs are recorded and every item has shipped to families';
    end if;
    if p_expected_version is null or s._version is distinct from p_expected_version then
      raise exception 'Sales order changed. Reload and review costs before closing.';
    end if;
    if exists(select 1 from public.so_jobs j where j.so_id=s.id
      and coalesce(j.prod_status,'') not in ('completed','shipped','outside')
      and coalesce(j.key,'') not like 'outside_art:%') then
      raise exception 'Finish all production jobs before closing the store';
    end if;
  end if;
  -- Deleted portal invoices can remain open in QBO (SO-1694 audit).
  -- Do not manufacture a replacement while an exported historical invoice is absent.
  if exists(select 1 from public.audit_log a where a.table_name='invoices' and a.op='DELETE'
    and a.old_data->>'so_id'=s.id and nullif(a.old_data->>'qb_invoice_id','') is not null
    and not exists(select 1 from public.invoices restored where restored.id=a.row_id and restored.deleted_at is null and coalesce(restored.status,'')<>'void'))
    or exists(select 1 from public.invoices discarded where discarded.so_id=s.id
      and (discarded.deleted_at is not null or discarded.status='void')
      and nullif(to_jsonb(discarded)->>'qb_invoice_id','') is not null) then
    raise exception 'Deleted invoice was exported to QuickBooks. Reconcile its QuickBooks copy before closeout.';
  end if;
  -- Never pick an arbitrary invoice from duplicate/split history.
  perform 1 from public.invoices where so_id=s.id order by id for update;
  select count(*) into v_count from public.invoices where so_id=s.id and coalesce(status,'')<>'void' and deleted_at is null;
  if v_count=0 and exists(select 1 from public.invoices where so_id=s.id) then raise exception 'Voided or deleted accounting exists. Accounting review required before closeout.'; end if;
  if v_count>1 then raise exception 'Multiple active invoices exist. Accounting must reconcile them before closeout.'; end if;
  select * into i from public.invoices where so_id=s.id and coalesce(status,'')<>'void' and deleted_at is null;
  if s.store_closed_at is not null then
    if i.id is null then raise exception 'Closed store accounting is missing. Accounting review required.'; end if;
    return jsonb_build_object('ok',true,'already_closed',true,'sales_order',to_jsonb(s),'invoice',to_jsonb(i),
      'todo',(select to_jsonb(t) from public.assigned_todos t where t.id='store-closeout:'||s.id),
      'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.invoice_payments p where p.invoice_id=i.id));
  end if;
  -- Avoid inventing another receipt while collected customer money is unallocated.
  -- Conservative: ambiguous customer-level funds require accounting reconciliation.
  perform 1 from public.payment_receipts where customer_id=s.customer_id order by id for update;
  if exists(select 1 from public.payment_receipts r where r.customer_id=s.customer_id and
    (r.reconciliation_hold or r.amount - coalesce((select sum(p.amount) from public.invoice_payments p where p.receipt_id=r.id),0)
      - coalesce((select sum((a->>'amount')::numeric) from jsonb_array_elements(r.ns_applications) a),0)>0.005)) then
    raise exception 'Customer has unapplied or held receipts. Reconcile existing funds before Close Store.';
  end if;
  if exists(select 1 from public.invoice_payment_unapplications u where u.invoice_id=i.id) then
    raise exception 'This invoice has unapplied payment history. Accounting review is required.';
  end if;
  perform set_config('nsa.close_store',s.id,true);
  if s.omg_store_id is null then
    if exists(select 1 from public.webstore_orders o where o.so_id=s.id and (coalesce(o.refunded_amt,0)>0 or coalesce(o.status,'') ~* '^(refunded|cancelled|canceled)$')) then
      raise exception 'Refunded or cancelled store orders require accounting review before closeout';
    end if;
    select array_agg(o.id order by o.id) into v_ids from public.webstore_orders o
      where o.so_id=s.id and o.backorder_of is null and coalesce(o.status,'') !~* '^(cancelled|canceled|pending_payment|refunded)$';
    if coalesce(cardinality(v_ids),0)=0 then raise exception 'No linked customer orders found. Reload or reconcile the batch.'; end if;
    -- The existing finalizer owns checkout tax/fees/rounding. It reuses an invoice
    -- and never reclaims or downgrades shipped customer orders.
    v_result := public.finalize_webstore_batch(s.id,v_ids);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Batch changed. Reload before closeout.'; end if;
    if abs(coalesce((v_result->'store_money'->>'rounding_gap')::numeric,0))>=0.005 then raise exception 'Store product totals differ from collections. Reconcile refunds/prices before closing.'; end if;
    v_funds := greatest((v_result->>'applied')::numeric,0);
    v_ref := 'WEB ' || s.id;
    select * into i from public.invoices where id=v_result->>'invoice_id';
    if i.total is distinct from (v_result->>'invoice_total')::numeric then raise exception 'Existing invoice differs from store totals. Reconcile before closing.'; end if;
  else
    select * into v_omg from public.omg_stores where id=s.omg_store_id for update;
    v_funds := greatest(coalesce(v_omg._omg_acct_collected,0),0);
    v_ref := 'OMG ' || coalesce(nullif(v_omg._omg_sale_code,''),replace(s.omg_store_id,'OMG-sale_',''));
    if coalesce(v_omg._omg_grand_total,0)<=0 or abs(v_funds-v_omg._omg_grand_total)>0.005 then
      raise exception 'OMG Dollar and Accounting Reports must reconcile before closeout';
    end if;
    if abs(coalesce(s._omg_acct_collected,0)-v_funds)>0.005
      or abs(coalesce(s._omg_omg_fees,0)-coalesce(v_omg._omg_omg_fees,0))>0.005
      or abs(coalesce(s._omg_cc_fees,0)-coalesce(v_omg._omg_cc_fees,0))>0.005 then
      raise exception 'OMG report changed since SO creation. Reconcile SO collections and fees before closeout';
    end if;
    v_processing := coalesce((to_jsonb(v_omg)->>'_omg_processing')::numeric,0);
    v_tax := coalesce((to_jsonb(v_omg)->>'_omg_tax')::numeric,0);
    v_shipping := coalesce((to_jsonb(v_omg)->>'_omg_shipping')::numeric,0);
    v_fundraise := coalesce((to_jsonb(v_omg)->>'_omg_fundraise')::numeric,0);
    if least(v_processing,v_tax,v_shipping,v_fundraise)<0 then
      raise exception 'Negative OMG net charge requires accounting review';
    end if;
    if abs(coalesce(s._omg_processing,0)-v_processing)>0.005
      or abs(coalesce(s._omg_tax,0)-v_tax)>0.005
      or abs(coalesce(s._omg_shipping,0)-v_shipping)>0.005
      or abs(coalesce((to_jsonb(s)->>'_omg_fundraise')::numeric,0)-v_fundraise)>0.005 then
      raise exception 'OMG net charges changed since SO creation. Review the saved order and Dollar Report';
    end if;
    v_platform_cost := coalesce(v_omg._omg_omg_fees,0)+coalesce(v_omg._omg_cc_fees,0)+coalesce(v_omg._omg_invoiced_fees,0);
    if v_platform_cost<0 or coalesce(v_omg._omg_omg_fees,0)<0 or coalesce(v_omg._omg_cc_fees,0)<0 or coalesce(v_omg._omg_invoiced_fees,0)<0 then
      raise exception 'OMG platform costs must be nonnegative';
    end if;
    if v_funds is null or v_funds<=0 then raise exception 'Enter and verify the OMG Accounting Report collections before closeout.'; end if;
    if i.id is null then
      if exists(select 1 from public.invoices where idempotency_key='omg:'||s.omg_store_id or so_id=s.id) then
        raise exception 'Previous store accounting exists. Reconcile it before creating another invoice.';
      end if;
      -- The existing pricing engine supplies the reviewed line breakdown. Only
      -- accounting fields are accepted; identity, payment and audit data are server-owned.
      v_lines := p_invoice->'line_items';
      if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines)=0 then raise exception 'Review the store pricing before closing'; end if;
      select round(sum((l->>'amount')::numeric)+coalesce((p_invoice->>'shipping')::numeric,0),2)
        into v_total from jsonb_array_elements(v_lines) l;
      if v_total is null or v_total<=0 or v_total is distinct from (p_invoice->>'total')::numeric then raise exception 'Store pricing does not reconcile'; end if;
      -- Standard OMG ingest stores the complete retail sell on each SO item;
      -- decorations arrive at zero sell. Never accept arbitrary browser totals.
      select round(sum(coalesce(it.unit_sell,0)*q.qty),2) into v_saved_total
      from public.so_items it cross join lateral(select case when coalesce(sum(v.value::numeric),0)>0 then sum(v.value::numeric) else greatest(coalesce(it.est_qty,0),0) end qty from jsonb_each_text(coalesce(it.sizes,'{}')) v) q
      where it.so_id=s.id;
      v_saved_total := round(v_saved_total + case when s.shipping_type='pct' then round(v_saved_total*coalesce(s.shipping_value,0)/100,2) else coalesce(s.shipping_value,0) end,2);
      if v_saved_total is null or abs(v_total-v_saved_total)>0.005 then
        raise exception 'OMG draft differs from saved order pricing. Reconcile custom prices before closeout';
      end if;
      if exists(select 1 from jsonb_array_elements(v_lines) l where coalesce((l->>'qty')::numeric,0)<=0 or coalesce((l->>'rate')::numeric,-1)<0 or abs(coalesce((l->>'amount')::numeric,0)-(l->>'qty')::numeric*(l->>'rate')::numeric)>0.005) then
        raise exception 'OMG invoice line quantities and prices do not reconcile';
      end if;
      -- The browser reviews products; net checkout charges and tax are server-owned.
      -- Subtract any draft shipping before using the report's shipping, so it is not doubled.
      if coalesce((p_invoice->>'shipping')::numeric,0)<>0 and abs((p_invoice->>'shipping')::numeric-v_shipping)>0.005 then
        raise exception 'OMG saved shipping differs from net report shipping';
      end if;
      v_total := round(v_total-coalesce((p_invoice->>'shipping')::numeric,0)+v_processing+v_tax+v_shipping+v_fundraise,2);
      if abs(v_total-v_funds)>0.005 then
        raise exception 'OMG gross collections differ from invoice total. Reconcile net report charges and refunds before closeout.';
      end if;
      select jsonb_agg(l||jsonb_build_object('_omg_closeout_component','product')) into v_lines from jsonb_array_elements(v_lines) l;
      if v_processing>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('desc','OMG online processing fee (net of refunds)','_name','OMG online processing fee','qty',1,'rate',v_processing,'amount',v_processing,'_omg_closeout_component','processing'));end if;
      if v_fundraise>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('desc','OMG fundraising (net of refunds)','_name','OMG fundraising','qty',1,'rate',v_fundraise,'amount',v_fundraise,'_omg_closeout_component','fundraise'));end if;
      perform pg_advisory_xact_lock(hashtext('nsa_invoices_id_mint'));
      select greatest(coalesce(max((regexp_match(id,'(\d+)'))[1]::bigint),0),1000)+1 into v_num from public.invoices;
      insert into public.invoices(id,customer_id,so_id,idempotency_key,type,inv_type,date,due_date,total,paid,status,memo,tax,tax_rate,tax_exempt,shipping,line_items,created_at,updated_at)
      values('INV-'||v_num,s.customer_id,s.id,'omg:'||s.omg_store_id,'invoice','full',to_char(current_date,'YYYY-MM-DD'),to_char(current_date,'YYYY-MM-DD'),
        v_total,0,'open','Store closeout — '||coalesce(s.memo,s.id),v_tax,0,(v_tax=0),v_shipping,v_lines,now(),now()) returning * into i;
      insert into public.invoice_items(invoice_id,sku,name,qty,unit_price,total,description)
        select i.id,l->>'_sku',l->>'_name',(l->>'qty')::numeric,(l->>'rate')::numeric,(l->>'amount')::numeric,l->>'desc' from jsonb_array_elements(v_lines) l;
    end if;
    -- A paid product-only invoice does not account for the rest of gross collections.
    -- Until tax/processing/fundraising allocation is reconciled, leave the store open.
    if abs(v_funds-coalesce(i.total,0))>0.005 or abs(coalesce(i.tax,0)-v_tax)>0.005 or abs(coalesce(i.shipping,0)-v_shipping)>0.005 then
      raise exception 'OMG gross collections differ from invoice total. Reconcile tax, processing, shipping, fundraising and refunds before closeout.';
    end if;
  end if;
  if i.id is null or i.so_id is distinct from s.id or i.customer_id is distinct from s.customer_id then raise exception 'Existing accounting needs review before closeout'; end if;
  -- Different SO/store IDs can still refer to the same platform sale code.
  perform pg_advisory_xact_lock(hashtext('store-funds:'||v_ref));
  select coalesce(sum(amount),0) into v_paid from public.invoice_payments where invoice_id=i.id;
  if abs(v_paid-coalesce(i.paid,0))>0.005 then raise exception 'Invoice paid total and payment ledger differ. Reconcile before closeout.'; end if;
  -- Any existing application counts toward the invoice balance. A store-ref row
  -- is immutable: never overwrite an exported payment to manufacture more funds.
  v_apply := round(least(greatest(i.total-v_paid,0),greatest(v_funds-v_paid,0)),2);
  if v_apply>0 then
    if exists(select 1 from public.invoice_payments where invoice_id=i.id) then
      raise exception 'Partly applied funds need accounting review; existing receipts will not be recreated.';
    end if;
    if exists(select 1 from public.invoice_payments where ref=v_ref) then
      raise exception 'These store funds are already applied elsewhere. Reconcile before closeout.';
    end if;
    insert into public.invoice_payments(invoice_id,amount,method,ref,date,cc_fee)
      values(i.id,v_apply,'store',v_ref,to_char(current_date,'MM/DD/YYYY'),0);
    v_paid := v_paid+v_apply;
  end if;
  update public.invoices set paid=v_paid,status=case when v_paid>=total-0.005 then 'paid' when v_paid>0 then 'partial' else 'open' end,updated_at=now()
    where id=i.id returning * into i;
  update public.sales_orders set store_closed_at=now(),store_costs_recorded_at=now(),store_closed_by=p_actor_id,store_closeout_platform_cost=v_platform_cost,status='complete'
    where id=s.id returning * into s;
  update public.assigned_todos set status='completed',completed_at=now(),completed_by=p_actor_id,
    completion_note='Store closed; costs confirmed and payments reconciled.',updated_at=now() where id='store-closeout:'||s.id;
  return jsonb_build_object('ok',true,'sales_order',to_jsonb(s),'invoice',to_jsonb(i),
    'todo',(select to_jsonb(t) from public.assigned_todos t where t.id='store-closeout:'||s.id),
      'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.invoice_payments p where p.invoice_id=i.id));
end $$;
revoke all on function public.close_store(text,bigint,text,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.close_store(text,bigint,text,boolean,boolean,jsonb) to service_role;

-- Protect the closeout gate from old browser tabs and manual invoice creation.
create function public.guard_store_closeout() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='sales_orders' then
    if (tg_op='INSERT' and (new.store_closed_at is not null or new.store_costs_recorded_at is not null or new.store_closed_by is not null or new.store_closeout_platform_cost is not null))
      or (tg_op='UPDATE' and (new.store_closed_at,new.store_costs_recorded_at,new.store_closed_by,new.store_closeout_platform_cost) is distinct from (old.store_closed_at,old.store_costs_recorded_at,old.store_closed_by,old.store_closeout_platform_cost)) then
      if current_user<>'service_role' or current_setting('nsa.close_store',true) is distinct from new.id then raise exception 'Use Close Store to confirm costs and shipment'; end if;
    end if;
  elsif tg_table_name='invoices' then
    if not exists(select 1 from public.invoices where id=new.id)
      and exists(select 1 from public.sales_orders s where s.id=new.so_id and (s.omg_store_id is not null or s.webstore_id is not null))
      and current_setting('nsa.close_store',true) is distinct from new.so_id then raise exception 'Use Close Store after fulfillment and cost review'; end if;
  elsif tg_table_name='invoice_payments' then
    if new.method='store' and not exists(select 1 from public.invoice_payments p where p.invoice_id=new.invoice_id and p.ref=new.ref and p.amount=new.amount)
      and exists(select 1 from public.invoices i join public.sales_orders s on s.id=i.so_id where i.id=new.invoice_id and (s.omg_store_id is not null or s.webstore_id is not null)
        and current_setting('nsa.close_store',true) is distinct from s.id) then raise exception 'Use Close Store to apply collected store funds'; end if;
  end if;
  return new;
end $$;
create trigger guard_store_closeout before insert or update on public.sales_orders for each row execute function public.guard_store_closeout();
create trigger guard_store_invoice before insert on public.invoices for each row execute function public.guard_store_closeout();
create trigger guard_store_payment before insert or update on public.invoice_payments for each row execute function public.guard_store_closeout();

create index if not exists sales_orders_store_closeout_omg_idx on public.sales_orders(omg_store_id) where omg_store_id is not null and deleted_at is null;

-- Durable rep task, due 35 days after SO creation. No browser/timer dependency.
-- No floor jobs means vendor/direct fulfillment; explicit outside decoration also
-- qualifies mixed orders. Outside-art-only jobs are not floor jobs.
create function public.refresh_store_closeout_todo(p_so_id text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sales_orders%rowtype; v_rep text; v_due date; v_outside boolean;
begin
  select * into s from public.sales_orders where id=p_so_id;
  if not found or (s.omg_store_id is null and s.webstore_id is null) then return; end if;
  if s.deleted_at is not null or s.store_closed_at is not null then
    update public.assigned_todos set status='completed',updated_at=now() where id='store-closeout:'||s.id and status='open'; return;
  end if;
  v_outside := not exists(select 1 from public.so_jobs j where j.so_id=s.id and coalesce(j.prod_status,'')<>'outside' and coalesce(j.key,'') not like 'outside_art:%')
    or exists(select 1 from public.so_item_decorations d join public.so_items it on it.id=d.so_item_id where it.so_id=s.id and (d.kind='outside_deco' or d.fulfillment='outside' or d.deco_po_id is not null))
    or exists(select 1 from jsonb_array_elements(coalesce(s.deco_pos,'[]')) d where coalesce(d->>'topstar_service','')='');
  if not v_outside then
    delete from public.assigned_todos where id='store-closeout:'||s.id and status='open'; return;
  end if;
  select coalesce(s.rep_id,c.primary_rep_id,s.created_by) into v_rep from public.customers c where c.id=s.customer_id;
  if not exists(select 1 from public.team_members where id=v_rep and is_active is not false) then return; end if;
  begin v_due := s.created_at::timestamp::date + 35; exception when others then return; end;
  if v_due is null then return; end if;
  insert into public.assigned_todos(id,title,description,created_by,assigned_to,so_id,customer_id,priority,status,due_date,created_at,updated_at)
  values('store-closeout:'||s.id,'Closeout check — '||s.id,
    'Confirm every item has shipped to families and all garment, decoration, freight and platform costs are recorded. Use Close Store to reconcile existing payments. Five weeks alone never releases commissions.',
    coalesce(s.created_by,v_rep),v_rep,s.id,s.customer_id,2,'open',v_due,now(),now())
  on conflict(id) do update set assigned_to=excluded.assigned_to,due_date=excluded.due_date,updated_at=now();
end $$;
revoke all on function public.refresh_store_closeout_todo(text) from public,anon,authenticated;
grant execute on function public.refresh_store_closeout_todo(text) to service_role;
create function public.store_closeout_todo_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v_id text;
begin
  if tg_table_name='sales_orders' then v_id:=new.id;
  elsif tg_table_name='so_jobs' then v_id:=coalesce(new.so_id,old.so_id);
  else select so_id into v_id from public.so_items where id=coalesce(new.so_item_id,old.so_item_id); end if;
  if v_id is not null then perform public.refresh_store_closeout_todo(v_id); end if;
  return null;
end $$;
revoke all on function public.store_closeout_todo_changed() from public,anon,authenticated;
create trigger store_closeout_todo_changed after insert or update on public.sales_orders for each row execute function public.store_closeout_todo_changed();
create trigger store_closeout_todo_changed after insert or update or delete on public.so_jobs for each row execute function public.store_closeout_todo_changed();
create trigger store_closeout_todo_changed after insert or update or delete on public.so_item_decorations for each row execute function public.store_closeout_todo_changed();

-- Closing a paid store is a prerequisite for NEW commission freezes as well as UI payout eligibility.
create function public.guard_store_commission_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.sales_orders s where (s.id=new.so_id or exists(select 1 from public.invoices i where i.id=new.invoice_id and i.so_id=s.id)) and (s.omg_store_id is not null or s.webstore_id is not null)
    and (s.store_closed_at is null or s.store_costs_recorded_at is null)) then raise exception 'Close Store with all costs recorded before earning commission'; end if;
  return new;
end $$;
create trigger guard_store_commission_snapshot before insert or update on public.commission_snapshots for each row execute function public.guard_store_commission_snapshot();
-- Backfill reminders only; never infer costs/fulfillment or rewrite historical money.
select public.refresh_store_closeout_todo(id) from public.sales_orders where deleted_at is null and (omg_store_id is not null or webstore_id is not null);

-- The existing integrity scanner must not label intentionally deferred invoices
-- as lost accounting. Preserve every other scanner rule and its service-only ACL.
do $$
declare v_sql text; v_old text;
begin
  if to_regprocedure('public.scan_webstore_integrity()') is not null then
    v_sql := pg_get_functiondef('public.scan_webstore_integrity()'::regprocedure);
    v_old := 'where s.source = ''webstore'' and s.webstore_id is not null'
      || E'\n    and exists (select 1 from public.webstore_orders o where o.so_id = s.id)';
    if position(v_old in v_sql)=0 then raise exception 'Review integrity scanner before migrating closeout'; end if;
    execute replace(v_sql,v_old,replace(v_old,E'\n    and exists',E'\n    and s.store_closed_at is not null\n    and exists'));
  end if;
end $$;

-- Automatic Club/All School conversions also produce webstore SOs. Defer their
-- legacy invoice block so the new invoice guard cannot roll back a paid order's
-- conversion. Keep the production/item/fundraising work and replay behavior.
do $$
declare v_name text; v_sql text; v_old text := 'if not exists (select 1 from invoices where so_id = v_so_id) then';
begin
  foreach v_name in array array['public.create_club_sales_order(uuid)','public.create_all_school_sales_order(uuid)'] loop
    if to_regprocedure(v_name) is not null then
      v_sql := pg_get_functiondef(to_regprocedure(v_name));
      if position(v_old in v_sql)=0 then raise exception 'Review store converter % before migrating closeout',v_name; end if;
      execute replace(v_sql,v_old,'if false then -- Invoice and payment deferred to Close Store.');
    end if;
  end loop;
end $$;

-- Child-only cost/job edits previously left the SO header version unchanged.
-- Serialize those writes with closeout and invalidate a review from an older tab.
-- BEFORE triggers take the same parent row lock before changing any cost input.
create function public.invalidate_store_closeout_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_ids text[]; v_id text;
begin
  if tg_table_name in ('so_item_decorations','so_item_pick_lines','so_item_po_lines') then
    select array_agg(distinct i.so_id order by i.so_id) into v_ids from public.so_items i
      where i.id in ((to_jsonb(new)->>'so_item_id')::integer,(to_jsonb(old)->>'so_item_id')::integer);
  else
    select array_agg(distinct x order by x) into v_ids from unnest(array[to_jsonb(new)->>'so_id',to_jsonb(old)->>'so_id']) x where x is not null;
  end if;
  foreach v_id in array coalesce(v_ids,array[]::text[]) loop
    update public.sales_orders set _version=_version+1 where id=v_id and store_closed_at is null
      and (omg_store_id is not null or webstore_id is not null);
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.invalidate_store_closeout_review() from public,anon,authenticated;
do $$
declare v_table text;
begin
  foreach v_table in array array['so_items','so_item_decorations','so_item_pick_lines','so_item_po_lines','so_art_files','so_jobs','so_firm_dates'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('create trigger invalidate_store_closeout_review before insert or update or delete on public.%I for each row execute function public.invalidate_store_closeout_review()',v_table);
    end if;
  end loop;
end $$;
